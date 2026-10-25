import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { Sandbox } from '@e2b/code-interpreter'
import mammoth from 'mammoth'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from 'docx'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const { OPENAI_API_KEY, PORT = 3000 } = process.env

// TEST ONLY: hardcoded E2B key so the app runs without configuring env vars.
// The E2B_API_KEY env var overrides this. Delete the fallback and rotate the
// key before any real or public deployment.
const E2B_API_KEY = process.env.E2B_API_KEY || 'e2b_bd1a9240aeb8ea21578a5fc7ab87befd408f074e'

// Model routing: Luna for cheap/simple work, Sol for the demanding parts.
// (There is no GPT-6 "Terra" id; set OPENAI_MODEL_CODE if you want a different
// code model, e.g. a Terra id that exists in your account.)
const MODEL_FAST = process.env.OPENAI_MODEL_FAST || 'gpt-6-luna'
const MODEL_MAIN = process.env.OPENAI_MODEL_MAIN || process.env.OPENAI_MODEL || 'gpt-6-sol'
const MODEL_CODE = process.env.OPENAI_MODEL_CODE || MODEL_MAIN
const EFFORT_FAST = process.env.OPENAI_EFFORT_FAST || 'medium'
const EFFORT_MAIN = process.env.OPENAI_EFFORT_MAIN || 'high'
const EFFORT_CODE = process.env.OPENAI_EFFORT_CODE || 'medium'
// ROUTING=auto (Luna/Sol split) | main (everything on MODEL_MAIN)
const ROUTING = process.env.ROUTING || 'auto'

// Hard per-question budgets (summed over every model call of one question).
const MAX_INPUT_TOKENS = Number(process.env.MAX_INPUT_TOKENS || 1_000_000)
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 100_000)
const MAX_OUTPUT_PER_CALL = Number(process.env.MAX_OUTPUT_PER_CALL || 16_000)
const AGENT_MAX_STEPS = Number(process.env.AGENT_MAX_STEPS || 16)
const SIMPLE_MAX_STEPS = 4

// Web search (OpenAI hosted tool) — secondary source for EU/DE law & commentary.
const WEB_SEARCH_ENABLED = process.env.OPENAI_WEB_SEARCH !== 'off'
const WEB_SEARCH_TOOL = { type: process.env.OPENAI_WEB_SEARCH_TOOL || 'web_search' }

// Sandbox (only used by the file tool).
const WORKDIR = '/home/user'
const MAX_FILES = 10
const MAX_FILE_BYTES = 15 * 1024 * 1024
const MAX_UPLOADS = 5
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const SANDBOX_LIFETIME_MS = 300_000
const CHAT_SESSION_TTL_MS = 15 * 60 * 1000

// Pricing (USD per 1M tokens). Real GPT-6 API rates; override via
// OPENAI_PRICES_JSON='{"gpt-6-sol":{"in":2,"cached":0.2,"out":10}}'.
const PRICES = {
  'gpt-6-luna': { in: 0.1, cached: 0.01, out: 0.5 },
  'gpt-6-sol': { in: 2, cached: 0.2, out: 10 },
  'gpt-6.1-sol': { in: 2, cached: 0.2, out: 10 },
}
try { Object.assign(PRICES, JSON.parse(process.env.OPENAI_PRICES_JSON || '{}')) } catch {}
const WEB_SEARCH_PRICE_PER_CALL = Number(process.env.OPENAI_WEB_SEARCH_PRICE_PER_CALL || 0.01)
const E2B_PRICE_PER_SEC = Number(process.env.E2B_PRICE_PER_SEC || 0.00014)

const UA = 'AIssociate-Playground/2.0 (+https://aissociate.at)'
const RIS_BASE = 'https://data.bka.gv.at/ris/api/v2.6'

function priceFor(model) {
  return PRICES[model] || PRICES[String(model).replace(/-\d{4}-\d{2}-\d{2}$/, '')] || { in: 2, cached: 0.2, out: 10 }
}

// ---------------------------------------------------------------------------
// Usage / cost / budget
// ---------------------------------------------------------------------------
function newUsage() {
  return { byModel: {}, inTok: 0, outTok: 0, cachedTok: 0, webSearchCalls: 0, calls: 0 }
}
function addUsage(acc, model, resp) {
  const u = resp?.usage || {}
  const inTok = u.input_tokens ?? u.prompt_tokens ?? 0
  const outTok = u.output_tokens ?? u.completion_tokens ?? 0
  const cached = u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0
  const m = (acc.byModel[model] ||= { inTok: 0, outTok: 0, cachedTok: 0, calls: 0 })
  m.inTok += inTok; m.outTok += outTok; m.cachedTok += cached; m.calls++
  acc.inTok += inTok; acc.outTok += outTok; acc.cachedTok += cached; acc.calls++
  acc.webSearchCalls += (resp?.output || []).filter((o) => o.type === 'web_search_call').length
}
function computeCost(acc, seconds) {
  let openaiUsd = 0
  const byModel = {}
  for (const [model, m] of Object.entries(acc.byModel)) {
    const p = priceFor(model)
    const nonCached = Math.max(0, m.inTok - m.cachedTok)
    const usd = (nonCached / 1e6) * p.in + (m.cachedTok / 1e6) * p.cached + (m.outTok / 1e6) * p.out
    byModel[model] = { ...m, usd: +usd.toFixed(4) }
    openaiUsd += usd
  }
  const webSearchUsd = acc.webSearchCalls * WEB_SEARCH_PRICE_PER_CALL
  const e2bUsd = (seconds || 0) * E2B_PRICE_PER_SEC
  return {
    inTok: acc.inTok, outTok: acc.outTok, cachedTok: acc.cachedTok, calls: acc.calls,
    webSearchCalls: acc.webSearchCalls, seconds: Math.round(seconds || 0),
    openaiUsd: +openaiUsd.toFixed(4), webSearchUsd: +webSearchUsd.toFixed(4), e2bUsd: +e2bUsd.toFixed(4),
    totalUsd: +(openaiUsd + webSearchUsd + e2bUsd).toFixed(4), byModel,
    budget: { inMax: MAX_INPUT_TOKENS, outMax: MAX_OUTPUT_TOKENS },
  }
}
const estTokens = (s) => Math.ceil(String(s || '').length / 3.5)

// ---------------------------------------------------------------------------
// OpenAI (lazy client + robust Responses API call)
// ---------------------------------------------------------------------------
let _openai
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: OPENAI_API_KEY })
  return _openai
}

class BudgetExceeded extends Error {}

/**
 * One Responses API call with budget enforcement and graceful fallbacks
 * (models that reject `reasoning`, hosted web_search or structured output).
 */
async function callModel(ctx, { model, instructions, input, tools, toolChoice, effort, prevId, maxOut, text }) {
  const remainingOut = MAX_OUTPUT_TOKENS - ctx.usage.outTok
  const remainingIn = MAX_INPUT_TOKENS - ctx.usage.inTok
  if (remainingOut < 800 || remainingIn < 2000) throw new BudgetExceeded('Token-Budget für diese Frage ausgeschöpft.')
  const params = {
    model,
    instructions,
    input,
    max_output_tokens: Math.max(800, Math.min(maxOut || MAX_OUTPUT_PER_CALL, remainingOut)),
    ...(tools?.length ? { tools, tool_choice: toolChoice || 'auto' } : {}),
    ...(effort ? { reasoning: { effort } } : {}),
    ...(prevId ? { previous_response_id: prevId } : {}),
    ...(text ? { text } : {}),
  }
  let resp
  try {
    resp = await getOpenAI().responses.create(params)
  } catch (e) {
    const msg = String(e?.message || e)
    const isBad = e?.status === 400 || /400|unsupported|not supported|invalid/i.test(msg)
    if (!isBad) throw e
    // Fallbacks: drop reasoning, drop hosted web search, drop structured output.
    const p2 = { ...params }
    let changed = false
    if (p2.reasoning && /reasoning/i.test(msg)) { delete p2.reasoning; changed = true }
    if (p2.tools && /web_search/i.test(msg)) { p2.tools = p2.tools.filter((t) => !String(t.type).startsWith('web_search')); if (!p2.tools.length) { delete p2.tools; delete p2.tool_choice }; changed = true }
    if (p2.text && /text|format|schema/i.test(msg)) { delete p2.text; changed = true }
    if (!changed) { if (p2.reasoning) { delete p2.reasoning; changed = true } }
    if (!changed) throw e
    resp = await getOpenAI().responses.create(p2)
  }
  addUsage(ctx.usage, model, resp)
  return resp
}

function parseJsonLoose(s) {
  if (typeof s !== 'string') return null
  try { return JSON.parse(s) } catch {}
  const a = s.indexOf('{'); const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)) } catch {} }
  return null
}

// ---------------------------------------------------------------------------
// HTTP helpers (page fetching, HTML → text)
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, opts = {}, ms = 20_000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } })
  } finally { clearTimeout(t) }
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(auml|ouml|uuml|Auml|Ouml|Uuml|szlig|sect|para|euro|ndash|mdash|hellip|laquo|raquo|bdquo|ldquo|rdquo|lsquo|rsquo);/g, (m, n) => ({ auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', sect: '§', para: '¶', euro: '€', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‚', rsquo: '’' })[n] || m)
}

function htmlToText(html) {
  let s = String(html || '')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, '')
  // RIS screen-reader expansions ("Paragraph eins,") live in visually hidden spans.
  s = s.replace(/<span[^>]*(sr-only|visually-?hidden|screenreader)[^>]*>[\s\S]*?<\/span>/gi, '')
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6]|table|blockquote|section|article|title)>/gi, '\n')
  s = s.replace(/<(p|div|h[1-6]|table|blockquote|section|article)\b[^>]*>/gi, '\n')
  s = s.replace(/<(li)[^>]*>/gi, '• ').replace(/<\/t[dh]>/gi, '\t')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ')
  return s.trim()
}

function isPublicHttpUrl(u) {
  try {
    const url = new URL(u)
    if (!/^https?:$/.test(url.protocol)) return false
    const h = url.hostname
    if (!h.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
    return true
  } catch { return false }
}

async function fetchPageText(url, maxChars = 15_000) {
  if (!isPublicHttpUrl(url)) throw new Error('URL nicht erlaubt.')
  const r = await fetchWithTimeout(url, { headers: { Accept: 'text/html,application/xhtml+xml,text/plain,*/*' } }, 25_000)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const ct = r.headers.get('content-type') || ''
  const buf = Buffer.from(await r.arrayBuffer())
  let text, title = ''
  if (/pdf/i.test(ct) || /\.pdf($|\?)/i.test(url)) {
    const p = await pdfParse(buf)
    text = p.text || ''
  } else {
    const html = buf.toString('utf8')
    title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim()
    text = /html|xml/i.test(ct) || /<html/i.test(html) ? htmlToText(html) : html
  }
  const truncated = text.length > maxChars
  return { title: decodeEntities(title), text: text.slice(0, maxChars), truncated, total: text.length }
}

// ---------------------------------------------------------------------------
// RIS (Rechtsinformationssystem des Bundes) — OGD API v2.6
// ---------------------------------------------------------------------------
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x])

function deepFind(obj, key, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return undefined
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key]
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const r = deepFind(v, key, depth + 1)
      if (r !== undefined) return r
    }
  }
  return undefined
}
const str = (v) => (v == null ? '' : typeof v === 'object' ? (v['#text'] ?? asArray(v.item).map(str).join(', ')) : String(v)).trim()

const RIS_FOLDER = { BrKons: 'Bundesnormen', LrKons: 'Landesnormen', BgblAuth: 'BgblAuth', BgblPdf: 'BgblPdf', Justiz: 'Justiz', Vfgh: 'Vfgh', Vwgh: 'Vwgh', Bvwg: 'Bvwg', Lvwg: 'Lvwg', Dsk: 'Dsk', Normenliste: 'Normenliste', LgblAuth: 'LgblAuth' }
function guessHtmlUrl(app, id) {
  return `https://ogd.ris.bka.gv.at/Dokumente/${RIS_FOLDER[app] || app}/${id}/${id}.html`
}

function normalizeRisDoc(ref) {
  const data = ref?.Data || ref || {}
  const md = data.Metadaten || {}
  const tech = md.Technisch || {}
  const id = str(tech.ID || deepFind(md, 'ID'))
  if (!id) return null
  const app = str(tech.Applikation || deepFind(md, 'Applikation'))
  const allg = md.Allgemein || {}
  const br = md.Bundesrecht || md.Landesrecht || null
  const jud = md.Judikatur || null
  const doc = { id, applikation: app, url: str(allg.DokumentUrl || deepFind(md, 'DokumentUrl')), htmlUrl: '', pdfUrl: '', title: '', kind: 'other' }
  for (const cr of asArray(data.Dokumentliste?.ContentReference)) {
    for (const cu of asArray(cr?.Urls?.ContentUrl)) {
      const t = str(cu?.DataType).toLowerCase()
      if (t === 'html' && !doc.htmlUrl) doc.htmlUrl = str(cu.Url)
      if (t === 'pdf' && !doc.pdfUrl) doc.pdfUrl = str(cu.Url)
    }
  }
  if (!doc.htmlUrl) doc.htmlUrl = guessHtmlUrl(app, id)
  if (!doc.url) doc.url = doc.htmlUrl
  if (br) {
    const kons = br.BrKons || br.LrKons || null
    doc.kind = 'norm'
    doc.law = str(br.Kurztitel || deepFind(br, 'Kurztitel'))
    doc.abbr = str(kons?.Abkuerzung || deepFind(br, 'Abkuerzung'))
    doc.section = str(kons?.ArtikelParagraphAnlage || deepFind(br, 'ArtikelParagraphAnlage')) || (str(deepFind(br, 'Paragraphnummer')) ? `§ ${str(deepFind(br, 'Paragraphnummer'))}` : '')
    doc.gesetzesnummer = str(kons?.Gesetzesnummer || deepFind(br, 'Gesetzesnummer'))
    doc.inForceFrom = str(kons?.Inkrafttretensdatum || deepFind(br, 'Inkrafttretensdatum'))
    doc.inForceTo = str(kons?.Ausserkrafttretensdatum || deepFind(br, 'Ausserkrafttretensdatum'))
    doc.gazette = str(kons?.Kundmachungsorgan || deepFind(br, 'Kundmachungsorgan'))
    doc.keywords = str(kons?.Schlagworte || deepFind(br, 'Schlagworte')).slice(0, 200)
    doc.bundesland = str(deepFind(br, 'Bundesland'))
    doc.longTitle = str(br.Titel || deepFind(br, 'Titel')).slice(0, 300)
    if (kons) {
      doc.title = `${doc.section ? doc.section + ' ' : ''}${doc.abbr || doc.law}${doc.abbr && doc.law ? ` (${doc.law})` : ''}`.trim()
    } else {
      doc.kind = 'gazette'
      doc.title = doc.longTitle || doc.law || id
    }
  } else if (jud) {
    doc.kind = 'decision'
    const sub = jud.Justiz || jud.Vfgh || jud.Vwgh || jud.Bvwg || jud.Lvwg || jud.Dsk || jud[app] || {}
    doc.court = str(sub.Gericht || deepFind(jud, 'Gericht')) || app
    doc.gz = str(jud.Geschaeftszahl || deepFind(jud, 'Geschaeftszahl'))
    doc.date = str(jud.Entscheidungsdatum || deepFind(jud, 'Entscheidungsdatum'))
    doc.docType = str(jud.Dokumenttyp || deepFind(jud, 'Dokumenttyp'))
    doc.norms = str(sub.Norm || deepFind(jud, 'Norm')).slice(0, 300)
    doc.rsNr = str(sub.Rechtssatznummer || deepFind(jud, 'Rechtssatznummer'))
    doc.entscheidungsart = str(sub.Entscheidungsart || deepFind(jud, 'Entscheidungsart'))
    doc.title = `${doc.court} ${doc.gz}${doc.date ? ' vom ' + doc.date : ''}${doc.docType ? ' · ' + doc.docType : ''}`.trim()
  } else {
    doc.title = str(deepFind(md, 'Kurztitel') || deepFind(md, 'Titel')) || id
  }
  return doc
}

async function risRequest(controller, params) {
  const url = new URL(`${RIS_BASE}/${controller}`)
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v))
  const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 25_000)
  if (!r.ok) throw new Error(`RIS HTTP ${r.status}`)
  const j = await r.json()
  const res = j?.OgdSearchResult || j
  if (res?.Error) throw new Error('RIS: ' + str(res.Error.Message || JSON.stringify(res.Error)).slice(0, 200))
  const dr = res?.OgdDocumentResults || {}
  const hits = Number(str(dr.Hits)) || 0
  const docs = asArray(dr.OgdDocumentReference).map(normalizeRisDoc).filter(Boolean)
  return { hits, docs }
}

const PAGE_SIZES = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 10: 'Ten', 20: 'Twenty', 50: 'Fifty', 100: 'OneHundred' }
function pageSize(n) {
  const want = Math.max(1, Math.min(50, Number(n) || 10))
  const keys = Object.keys(PAGE_SIZES).map(Number).sort((a, b) => a - b)
  return PAGE_SIZES[keys.find((k) => k >= want) || 50]
}
const BUNDESLAENDER = { burgenland: 'Burgenland', kaernten: 'Kaernten', kärnten: 'Kaernten', niederoesterreich: 'Niederoesterreich', niederösterreich: 'Niederoesterreich', oberoesterreich: 'Oberoesterreich', oberösterreich: 'Oberoesterreich', salzburg: 'Salzburg', steiermark: 'Steiermark', tirol: 'Tirol', vorarlberg: 'Vorarlberg', wien: 'Wien' }

/** The ris_search tool: maps a compact argument set onto the RIS endpoints. */
async function risSearch(a) {
  const corpus = String(a.corpus || 'bundesrecht').toLowerCase()
  const limit = pageSize(a.limit || 10)
  const page = Math.max(1, Number(a.page) || 1)
  let controller = 'Bundesrecht'
  const p = { DokumenteProSeite: limit, Seitennummer: page }
  if (corpus === 'judikatur') {
    controller = 'Judikatur'
    p.Applikation = a.applikation || 'Justiz'
    p.Suchworte = a.query || ''
    p.Geschaeftszahl = a.geschaeftszahl || ''
    p.Norm = a.norm || ''
    p.EntscheidungsdatumVon = a.date_from || ''
    p.EntscheidungsdatumBis = a.date_to || ''
    if (a.since) p.ImRisSeit = a.since
  } else if (corpus === 'landesrecht') {
    controller = 'Landesrecht'
    p.Applikation = a.applikation || 'LrKons'
    p.Suchworte = a.query || ''
    p.Titel = a.title || ''
    p.Paragraf = a.paragraph || ''
    if (a.in_force_on) p.FassungVom = a.in_force_on
    const bl = BUNDESLAENDER[String(a.bundesland || '').toLowerCase()]
    if (bl) p[`SucheIn${bl}`] = 'true'
  } else if (corpus === 'bundesgesetzblatt') {
    p.Applikation = a.applikation || 'BgblAuth'
    p.Suchworte = a.query || ''
    p.Titel = a.title || ''
    if (a.since) p.ImRisSeit = a.since
  } else {
    p.Applikation = a.applikation || 'BrKons'
    p.Suchworte = a.query || ''
    p.Titel = a.title || ''
    p.Paragraf = a.paragraph || ''
    p.Gesetzesnummer = a.gesetzesnummer || ''
    if (a.in_force_on) p.FassungVom = a.in_force_on
    if (a.since) p.ImRisSeit = a.since
  }
  if (!p.Suchworte && !p.Titel && !p.Paragraf && !p.Gesetzesnummer && !p.Geschaeftszahl && !p.Norm) throw new Error('Mindestens query, title, paragraph, gesetzesnummer, geschaeftszahl oder norm angeben.')
  return risRequest(controller, p)
}

// ---------------------------------------------------------------------------
// Citation verification (deterministic checks against RIS)
// ---------------------------------------------------------------------------
const KNOWN_DE_LAWS = new Set(['BGB', 'HGB', 'ZPO-DE', 'StGB-DE', 'GG', 'AktG-DE', 'GmbHG-DE', 'VwGO', 'AO', 'InsO'])
const NORM_RE = /(§§?|Art\.?|Artikel)\s*(\d{1,4}[a-z]{0,2})\s*(?:ff?\.?\s*)?(?:(?:Abs\.?|Absatz)\s*\d+[a-z]?\s*)?(?:(?:Z|Ziffer|Zif\.?)\s*\d+[a-z]?\s*)?(?:lit\.?\s*[a-z]\s*)?(?:(?:Satz|S\.)\s*\d+\s*)?(?:ff?\.?\s*)?([A-ZÄÖÜ][A-Za-zÄÖÜäöü]{0,5}(?:-[A-ZÄÖÜ][A-Za-zÄÖÜäöü]{0,8})?)\b/g
const LAW_STOP = new Set(['Abs', 'Satz', 'Z', 'Art', 'Nr', 'Rz', 'Rn', 'RS', 'OGH', 'VwGH', 'VfGH', 'OLG', 'LG', 'BG', 'EuGH', 'EGMR', 'Und', 'Oder', 'Iv', 'Ivm', 'IVm', 'Ff', 'F', 'Bzw', 'Vgl', 'Siehe', 'Dazu', 'Der', 'Die', 'Das', 'Des', 'Dem', 'Den', 'Q'])

function extractNormCitations(text) {
  const out = new Map()
  let m
  NORM_RE.lastIndex = 0
  while ((m = NORM_RE.exec(text)) && out.size < 40) {
    const kind = /^Art/.test(m[1]) ? 'Art' : '§'
    const num = m[2]
    const law = m[3].replace(/\s+/g, '')
    // Law abbreviations carry at least two capitals (ABGB, MRG, GewO, B-VG, EMRK, DSGVO).
    if (LAW_STOP.has(law) || law.length < 2 || !/[A-ZÄÖÜ].*[A-ZÄÖÜ]/.test(law)) continue
    const key = `${kind} ${num} ${law}`
    if (!out.has(key)) out.set(key, { kind, num, law, label: key })
  }
  return [...out.values()]
}

const GZ_PATTERNS = [
  { app: 'Justiz', re: /\b(\d{1,2})\s?(Ob|Os|ObA|ObS|Nc|Nd|Ns|Fsc|Fss|Bkd|Ds|Dg|Präs|R|Bs|Cg|Cga|Cgs|Cgb|Ra|Rs|Msch|Fam|Hv|U|St|HR|Kt|Okt|Nr)\s?(\d{1,4})\/(\d{2})([a-z])?\b/g, fmt: (m) => `${m[1]}${m[2]}${m[3]}/${m[4]}${m[5] || ''}` },
  { app: 'Vwgh', re: /\b(Ra|Ro|Fr|Fe|Fra|Ko)\s?(\d{4})\/(\d{2})\/(\d{4})\b/g, fmt: (m) => `${m[1]} ${m[2]}/${m[3]}/${m[4]}` },
  { app: 'Vfgh', re: /\b(G|B|E|V|SV|WI|KI|KR|KIV|A|UA)\s?(\d{1,4})\/(\d{4})(?:-\d+)?\b/g, fmt: (m) => `${m[1]} ${m[2]}/${m[3]}` },
]
function extractDecisionCitations(text) {
  const out = new Map()
  for (const pat of GZ_PATTERNS) {
    pat.re.lastIndex = 0
    let m
    while ((m = pat.re.exec(text)) && out.size < 20) {
      const gz = pat.fmt(m)
      const key = `${pat.app}:${gz}`
      if (!out.has(key)) out.set(key, { app: pat.app, gz, label: gz })
    }
  }
  return [...out.values()]
}

async function verifyNorm(n) {
  if (KNOWN_DE_LAWS.has(n.law)) return { ...n, status: 'skipped', note: 'Nicht-österreichische Norm – nicht im RIS geprüft.' }
  const attempts = n.kind === 'Art'
    ? [{ Titel: n.law, Artikel: n.num }, { Suchworte: n.law, Artikel: n.num }, { Titel: n.law, Suchworte: `"Art. ${n.num}"` }]
    : [{ Titel: n.law, Paragraf: n.num }, { Suchworte: n.law, Paragraf: n.num }]
  let lastErr = null
  for (const extra of attempts) {
    try {
      const r = await risRequest('Bundesrecht', { Applikation: 'BrKons', DokumenteProSeite: 'Five', Seitennummer: 1, ...extra })
      if (r.hits > 0 && r.docs.length) {
        // Prefer a document whose abbreviation matches the cited law exactly.
        const best = r.docs.find((d) => d.abbr && d.abbr.toLowerCase() === n.law.toLowerCase()) || r.docs[0]
        const today = new Date().toISOString().slice(0, 10)
        const expired = best.inForceTo && best.inForceTo <= today
        return {
          ...n,
          status: expired ? 'expired' : 'ok',
          title: best.title, url: best.url, htmlUrl: best.htmlUrl, inForceFrom: best.inForceFrom, inForceTo: best.inForceTo, id: best.id,
          note: expired ? `Außer Kraft seit ${best.inForceTo}` : (best.inForceFrom ? `Geltende Fassung seit ${best.inForceFrom}` : 'Im RIS gefunden'),
          exactAbbr: Boolean(best.abbr && best.abbr.toLowerCase() === n.law.toLowerCase()),
        }
      }
    } catch (e) { lastErr = e }
  }
  return { ...n, status: lastErr ? 'error' : 'not_found', note: lastErr ? `RIS nicht erreichbar (${lastErr.message})` : 'Im RIS (Bundesrecht konsolidiert) nicht gefunden – Landesrecht/EU-Recht oder Zitierfehler?' }
}

async function verifyDecision(d) {
  const variants = [d.gz, d.gz.replace(/\s+/g, ''), d.gz.replace(/(\d)([A-Za-z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2')]
  let lastErr = null
  for (const gz of [...new Set(variants)]) {
    try {
      const r = await risRequest('Judikatur', { Applikation: d.app, Geschaeftszahl: gz, DokumenteProSeite: 'Five', Seitennummer: 1 })
      if (r.hits > 0 && r.docs.length) {
        const best = r.docs.find((x) => x.docType === 'Entscheidungstext') || r.docs[0]
        return { ...d, status: 'ok', title: best.title, url: best.url, htmlUrl: best.htmlUrl, date: best.date, court: best.court, id: best.id, hits: r.hits, note: `Im RIS gefunden (${r.hits} Dokument${r.hits === 1 ? '' : 'e'})` }
      }
    } catch (e) { lastErr = e }
  }
  return { ...d, status: lastErr ? 'error' : 'not_found', note: lastErr ? `RIS nicht erreichbar (${lastErr.message})` : 'Geschäftszahl im RIS nicht gefunden – bitte prüfen.' }
}

async function verifyAnswer(answer) {
  const norms = extractNormCitations(answer).slice(0, 15)
  const decisions = extractDecisionCitations(answer).slice(0, 10)
  const [n, d] = await Promise.all([
    Promise.all(norms.map((x) => verifyNorm(x).catch((e) => ({ ...x, status: 'error', note: e.message })))),
    Promise.all(decisions.map((x) => verifyDecision(x).catch((e) => ({ ...x, status: 'error', note: e.message })))),
  ])
  const all = [...n, ...d]
  return {
    norms: n, decisions: d,
    summary: { checked: all.length, ok: all.filter((x) => x.status === 'ok').length, warn: all.filter((x) => x.status === 'expired').length, notFound: all.filter((x) => x.status === 'not_found').length, error: all.filter((x) => x.status === 'error').length },
  }
}

// ---------------------------------------------------------------------------
// Uploads: server-side text extraction (no sandbox needed for reading)
// ---------------------------------------------------------------------------
async function extractText(name, buf) {
  const ext = name.toLowerCase().split('.').pop()
  try {
    if (ext === 'pdf') { const r = await pdfParse(buf); return { text: r.text || '', pages: r.numpages } }
    if (ext === 'docx') { const r = await mammoth.extractRawText({ buffer: buf }); return { text: r.value || '' } }
    if (['txt', 'md', 'csv', 'json', 'xml', 'rtf'].includes(ext)) return { text: buf.toString('utf8') }
    if (['html', 'htm'].includes(ext)) return { text: htmlToText(buf.toString('utf8')) }
  } catch (e) {
    return { text: '', error: e?.message }
  }
  return { text: '', unsupported: true }
}
const UPLOAD_PART_CHARS = 24_000

// ---------------------------------------------------------------------------
// Sandbox (E2B) — only for the file tool
// ---------------------------------------------------------------------------
const chatSessions = new Map() // sessionId -> { sandbox, lastUsed }
async function getChatSandbox(sessionId) {
  const existing = sessionId && chatSessions.get(sessionId)
  if (existing) {
    try { await existing.sandbox.setTimeout(SANDBOX_LIFETIME_MS); existing.lastUsed = Date.now(); return existing.sandbox } catch {
      try { await existing.sandbox.kill() } catch {}
      chatSessions.delete(sessionId)
    }
  }
  const sandbox = await Sandbox.create({ apiKey: E2B_API_KEY, timeoutMs: SANDBOX_LIFETIME_MS })
  if (sessionId) chatSessions.set(sessionId, { sandbox, lastUsed: Date.now() })
  return sandbox
}
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of chatSessions) if (now - s.lastUsed > CHAT_SESSION_TTL_MS) { s.sandbox.kill().catch(() => {}); chatSessions.delete(id) }
}, 60_000).unref?.()

const DEPS_CODE = 'import importlib, subprocess, sys\n' +
  'for _p,_m in [("openpyxl","openpyxl"),("pdfplumber","pdfplumber"),("python-docx","docx"),("pandas","pandas"),("reportlab","reportlab")]:\n' +
  '    try:\n        importlib.import_module(_m)\n    except Exception:\n        subprocess.run([sys.executable,"-m","pip","install","-q",_p])\n' +
  'print("DEPS_READY")'

const CODE_SYSTEM = `Du schreibst EIN vollständiges Python-Skript für einen persistenten Jupyter-Sandbox-Kernel (Arbeitsverzeichnis /home/user, Internet verfügbar). Das Skript wird sofort ausgeführt. Antworte NUR mit einem einzigen \`\`\`python Codeblock, ohne Erklärungen.

Regeln:
- Hochgeladene Dateien liegen in /home/user (genaue Namen werden genannt). Ausgabedateien IMMER nach /home/user speichern – sie werden dem Nutzer zum Download angeboten.
- Verfügbar: python-docx (>=1.2 für echte Word-Kommentare: paragraph.add_comment(text, author="AI:ssociate", initials="AI")), openpyxl, pandas, pdfplumber/PyPDF2, reportlab, Pillow. Fehlende Pakete: subprocess.run([sys.executable,"-m","pip","install","-q","<pkg>"]).
- Exakt das geforderte Format erzeugen (.docx / .xlsx / .pdf / .html). Kein Fallback auf .txt/.csv, wenn Word/Excel verlangt ist.
- Word-Dokumente: Formatierung des Originals erhalten (Paragraphen in place bearbeiten, keine Neuanlage, wenn Bearbeitung verlangt). Kommentare NUR an die genannten Stellen mit genau dem vorgegebenen Text. Änderungen sichtbar machen (Redline: Zusätze grün, Streichungen rot durchgestrichen via RGBColor/strike), wenn verlangt.
- Vergleiche: zusätzlich delta.html (rot/grün) erzeugen.
- Alle inhaltlichen Texte (Kommentare, Klauseln, Tabellenwerte) kommen aus der Aufgabenbeschreibung – nichts erfinden, nichts weglassen.
- Am Ende: print("RESULT: " + json.dumps({"files": [...erzeugte Dateinamen...], "summary": "<1-3 Sätze, was gemacht wurde>"}, ensure_ascii=False)).
- Robust programmieren (try/except pro Datei), keine interaktiven Eingaben, keine Dateien außerhalb von /home/user.`

// ---------------------------------------------------------------------------
// Agent tool definitions (Responses API flat function tools)
// ---------------------------------------------------------------------------
const TOOL_RIS_SEARCH = {
  type: 'function', name: 'ris_search',
  description: 'Sucht im österreichischen RIS (ris.bka.gv.at): Bundesrecht (konsolidiert), Landesrecht, Judikatur (OGH/OLG/LG = Justiz, VfGH, VwGH, BVwG, LVwG, DSB) oder Bundesgesetzblatt. Liefert Treffer mit Quellen-Markern [Qn]; lies relevante Treffer danach mit ris_read.',
  parameters: {
    type: 'object',
    properties: {
      corpus: { type: 'string', enum: ['bundesrecht', 'landesrecht', 'judikatur', 'bundesgesetzblatt'], description: 'Welcher Bestand.' },
      applikation: { type: 'string', description: 'Judikatur: Justiz (OGH/OLG/LG, Standard), Vfgh, Vwgh, Bvwg, Lvwg, Dsk. Bundesrecht: BrKons (Standard). Landesrecht: LrKons. Gesetzblatt: BgblAuth.' },
      query: { type: 'string', description: 'Volltext-Suchworte (deutsch). Operatoren: und, oder, nicht; Wildcard * (z. B. Kündigung* und Mietzins).' },
      title: { type: 'string', description: 'Titel/Abkürzung des Gesetzes, z. B. ABGB, MRG, UGB, DSG.' },
      paragraph: { type: 'string', description: 'Paragraph-Nummer ohne §, z. B. 1096 (nur Bundes-/Landesrecht).' },
      gesetzesnummer: { type: 'string', description: 'RIS-Gesetzesnummer, falls bekannt.' },
      geschaeftszahl: { type: 'string', description: 'Judikatur: Geschäftszahl, z. B. 5Ob234/20b, Ra 2019/03/0012, G 123/2020.' },
      norm: { type: 'string', description: 'Judikatur: zitierte Norm, z. B. "ABGB §1096" oder "MRG §30".' },
      date_from: { type: 'string', description: 'Judikatur: Entscheidungsdatum ab (YYYY-MM-DD).' },
      date_to: { type: 'string', description: 'Judikatur: Entscheidungsdatum bis (YYYY-MM-DD).' },
      in_force_on: { type: 'string', description: 'Konsolidiertes Recht: Fassung zum Datum (YYYY-MM-DD).' },
      bundesland: { type: 'string', description: 'Landesrecht: Wien, Niederoesterreich, Oberoesterreich, Salzburg, Steiermark, Tirol, Vorarlberg, Kaernten, Burgenland.' },
      limit: { type: 'integer', description: 'Max. Treffer (1–50, Standard 10).' },
      page: { type: 'integer', description: 'Seite (ab 1).' },
    },
    required: ['corpus'],
  },
}
const TOOL_RIS_READ = {
  type: 'function', name: 'ris_read',
  description: 'Liest den Volltext eines RIS-Dokuments (Norm, Rechtssatz, Entscheidungstext) anhand der RIS-ID aus ris_search (z. B. NOR40191806, JJT_20210310_OGH0002_0050OB00234_20B0000_000). Vor dem Zitieren immer lesen.',
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'RIS-Dokument-ID oder RIS-URL.' }, max_chars: { type: 'integer', description: 'Max. Zeichen (Standard 15000, max 60000).' } }, required: ['id'] },
}
const TOOL_FETCH_PAGE = {
  type: 'function', name: 'fetch_page',
  description: 'Lädt eine öffentliche Webseite oder PDF als Text (z. B. EUR-Lex, curia.europa.eu, parlament.gv.at, gesetze-im-internet.de). Für RIS-Dokumente ris_read verwenden.',
  parameters: { type: 'object', properties: { url: { type: 'string' }, max_chars: { type: 'integer', description: 'Max. Zeichen (Standard 15000, max 60000).' } }, required: ['url'] },
}
const TOOL_READ_DOCUMENT = {
  type: 'function', name: 'read_document',
  description: 'Liest den Text einer hochgeladenen Datei (Teil für Teil, je ca. 24.000 Zeichen).',
  parameters: { type: 'object', properties: { name: { type: 'string', description: 'Dateiname exakt wie hochgeladen.' }, part: { type: 'integer', description: 'Teil-Nummer ab 1 (Standard 1).' } }, required: ['name'] },
}
const TOOL_FILE = {
  type: 'function', name: 'create_or_edit_file',
  description: 'Erzeugt oder bearbeitet Dateien (Word .docx, Excel .xlsx, PDF, HTML) in einer Sandbox. Ein Codemodell schreibt und führt das Programm aus; du siehst nur das Ergebnis. Gib ALLE Inhalte wörtlich in task an (z. B. jede Kommentarstelle mit Kommentartext, neue Klauselformulierungen, Tabellenzeilen). Ein Aufruf pro Deliverable.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Vollständige, präzise Arbeitsanweisung inkl. aller Texte/Inhalte, Quelldateien und gewünschtem Ausgabeformat.' },
      output_files: { type: 'array', items: { type: 'string' }, description: 'Gewünschte Ausgabedateinamen, z. B. ["vertrag_kommentiert.docx"].' },
    },
    required: ['task'],
  },
}

const AGENT_INSTRUCTIONS = `Du bist AI:ssociate, ein juristischer KI-Assistent für Rechtsanwältinnen und Rechtsanwälte in Österreich. Du arbeitest präzise, belegt und iterativ. Sprache: die Sprache der Nutzerin (meist Deutsch, österreichische Rechtsterminologie).

ARBEITSWEISE
1. Verstehe die Aufgabe, zerlege sie in Teilfragen und plane kurz.
2. Primärquelle für österreichisches Recht ist das RIS (ris.bka.gv.at): suche mit ris_search (Bundesrecht, Landesrecht, Judikatur, Bundesgesetzblatt) und LIES die maßgeblichen Dokumente mit ris_read, BEVOR du sie zitierst. Suche Normen UND Judikatur (Rechtssätze/Entscheidungstexte des OGH, VwGH, VfGH, BVwG, LVwG). EU-Recht über EUR-Lex/curia (fetch_page, web_search). Deutsches Recht nur, wenn ausdrücklich gefragt.
3. Prüfe Geltung (Inkrafttreten/Außerkrafttreten, Fassung) und zitiere den exakten Wortlaut, wo er entscheidend ist.
4. Iteriere: Bei fehlenden Treffern Suchbegriffe variieren (Synonyme, Abkürzungen, Paragraphnummer, Rechtssatz-Suche mit norm=). Bei strittiger Rechtslage mehrere Entscheidungen lesen und Entwicklungen/Widersprüche benennen.
5. Hochgeladene Dokumente liest du mit read_document (in Teilen, so viel wie nötig).
6. Dateien (Word/Excel/PDF/HTML) erstellst oder bearbeitest du AUSSCHLIESSLICH mit create_or_edit_file – ein Aufruf je Deliverable. Die gesamte juristische Arbeit (welche Klausel, welcher Kommentar, welche Formulierung) machst DU vorher und gibst sie wörtlich in task mit. Niemals generische oder identische Kommentare für mehrere Absätze; jeder Kommentar nennt das konkrete Problem der konkreten Klausel.
7. Antworte erst, wenn die Belege vorliegen. Erfinde keine Normen, Geschäftszahlen oder Fundstellen. Nicht verifizierbare Punkte kennzeichnest du ausdrücklich als „nicht verifiziert“.

BELEGE
Jedes Werkzeugergebnis trägt Quellen-Marker wie [Q3]. Setze diese Marker im Text direkt hinter die belegte Aussage (z. B. „… § 1096 ABGB [Q2] …“, „OGH 5 Ob 234/20b [Q5]“). Erzeuge KEINE eigene Quellenliste am Ende – die Oberfläche baut sie aus den Markern.

ANTWORTFORMAT (Markdown, prägnant, fachlich)
**Kurzantwort** – 2–5 Sätze mit dem Ergebnis.
**Rechtliche Grundlagen** – Normen (§, Abs, Gesetz) und Entscheidungen (Gericht, Datum, Geschäftszahl) mit Markern.
**Beurteilung** – Subsumtion, Argumente, Gegenargumente, offene Punkte/Unsicherheiten.
**Ergebnis / Empfehlung** – konkrete nächste Schritte, Fristen, Risiken.
Bei Dokumentaufgaben stattdessen: was erstellt/geändert wurde, die wesentlichen inhaltlichen Punkte (konkret, keine Floskeln) und worauf die Anwältin noch achten sollte.`

const RESEARCH_INSTRUCTIONS = `Du bist der Recherche-Agent von AI:ssociate (österreichisches Recht, Anwaltskanzlei). Deine Aufgabe ist NICHT die Endantwort, sondern Belege zu sammeln.

VORGEHEN: Zerlege die Frage in Teilfragen. Suche im RIS mit ris_search (Bundesrecht: Normen; Judikatur: Rechtssätze/Entscheidungen; bei Bedarf Landesrecht/Gesetzblatt) und lies die maßgeblichen Dokumente mit ris_read (Wortlaut der Norm, Kernaussagen der Entscheidungen). EU-Recht über fetch_page/web_search (EUR-Lex, curia). Variiere Suchbegriffe, wenn nichts Passendes kommt. Lies lieber 3–6 relevante Dokumente gründlich als 20 oberflächlich. Hochgeladene Dateien mit read_document lesen.

ABSCHLUSS: Wenn die Belege ausreichen (oder die Schritte knapp werden), antworte NUR mit strukturierten RECHERCHE-NOTIZEN in Stichpunkten:
- Teilfragen
- Gefundene Normen (mit Marker [Qn], Wortlaut-Kern, Geltung)
- Entscheidungen (Marker [Qn], Gericht/GZ/Datum, Rechtssatz-Kern)
- Widersprüche, Entwicklungen, Unsicherheiten
- Offene Punkte / was nicht gefunden wurde
Keine ausformulierte Antwort, keine Empfehlungen.`

const SYNTH_INSTRUCTIONS = AGENT_INSTRUCTIONS + `

WICHTIG FÜR DIESEN SCHRITT: Du erhältst die vom Recherche-Agenten gesammelten BELEGE und RECHERCHE-NOTIZEN. Stütze die Antwort ausschließlich auf diese Belege (Marker [Qn] setzen). Fehlt ein Beleg für einen wesentlichen Punkt, sage das ausdrücklich, statt ihn zu erfinden. Werkzeuge stehen dir in diesem Schritt nicht zur Verfügung.`

const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    complexity: { type: 'string', enum: ['simple', 'research', 'complex'] },
    task_type: { type: 'string', enum: ['frage', 'recherche', 'analyse', 'entwurf', 'bearbeitung', 'vergleich', 'sonstiges'] },
    needs_file_output: { type: 'boolean' },
    title: { type: 'string' },
    plan: { type: 'array', items: { type: 'string' } },
  },
  required: ['complexity', 'task_type', 'needs_file_output', 'title', 'plan'],
}
const TRIAGE_INSTRUCTIONS = `Klassifiziere die Anfrage an ein juristisches KI-System (österreichische Anwaltskanzlei). Antworte als JSON.
complexity:
- "simple": Begriffs-/Wissensfrage, kurze Auskunft, Umformulierung, Übersetzung, Small Talk, Folgefrage, die aus dem bisherigen Gesprächskontext beantwortbar ist.
- "research": Rechtsfrage, die Recherche in Normen und Judikatur (RIS, EU-Recht) erfordert.
- "complex": Gutachten mit mehreren Teilfragen, Prüfung/Analyse hochgeladener Dokumente, Entwurf von Verträgen/Schriftsätzen, Erstellung oder Bearbeitung von Dateien, Dokumentvergleich, mehrstufige Aufgaben.
Regel: Wenn Dateien hochgeladen wurden oder eine Datei erstellt/bearbeitet werden soll → "complex" und needs_file_output entsprechend.
title: prägnanter Titel (max. 6 Wörter) für die Verlaufsliste. plan: 2–5 kurze Arbeitsschritte.`

const FOLLOWUP_INSTRUCTIONS = 'Formuliere 3 kurze, konkrete Folgefragen oder nächste Schritte (je max. 12 Wörter), die eine Anwältin nach dieser Antwort sinnvoll stellen würde. Antworte als JSON {"followups": ["…","…","…"]}.'

// Task presets: real workflows with structured inputs (not just prompt text).
const TASK_PRESETS = {
  research: ({ question, jurisdiction, depth }) => ({
    text: `Rechtsrecherche${jurisdiction ? ` (${jurisdiction})` : ''}${depth ? `, ${depth}` : ''}: ${question}`,
    extra: `AUFGABE: Rechtsrecherche. Rechtsordnung: ${jurisdiction || 'Österreich (primär RIS), EU-Recht wo einschlägig'}. Tiefe: ${depth || 'ausführlich'}. Jede rechtliche Aussage mit Fundstelle belegen; Normwortlaut und Leitsätze prüfen; Rechtsprechungsentwicklung und Gegenmeinungen nennen.`,
    forceRoute: 'research',
  }),
  contract_review: ({ perspective, focus, output, notes }) => ({
    text: `Vertragsprüfung${perspective ? ` aus Sicht ${perspective}` : ''}${focus ? ` – Fokus: ${focus}` : ''} – Ergebnis: ${output || 'Kommentare im Word-Dokument'}${notes ? `\nHinweise: ${notes}` : ''}`,
    extra: `AUFGABE: Vertragsprüfung der hochgeladenen Datei(en). Perspektive: ${perspective || 'neutral'}. Fokus: ${focus || 'alle wesentlichen Risiken (Haftung, Gewährleistung, Kündigung/Laufzeit, Zahlung, Gerichtsstand/Rechtswahl, Datenschutz, Vertragsstrafen, unübliche/fehlende Klauseln)'}. Gewünschtes Ergebnis: ${output || 'Kommentare im Word-Dokument'}.
Vorgehen: Dokument vollständig lesen (read_document) → klauselweise prüfen und für jede problematische Stelle eine konkrete, klausel-spezifische Anmerkung formulieren (Problem, Risiko, Verbesserungsvorschlag; österreichisches Recht, einschlägige Normen/Judikatur bei Bedarf im RIS prüfen) → ${/word|kommentar/i.test(output || 'Kommentare') ? 'mit create_or_edit_file die Kommentare als echte Word-Kommentare (Autor AI:ssociate) an genau diesen Absätzen einfügen (Mapping Absatztext → Kommentartext wörtlich in task übergeben) und die kommentierte .docx zurückgeben' : /excel|tabelle/i.test(output) ? 'mit create_or_edit_file eine Excel-Risikotabelle (Klausel, Zitat, Risiko, Ampel, Empfehlung) erzeugen' : 'ein strukturiertes Prüfmemo verfassen'} → Antwort mit Ampel-Übersicht der wichtigsten Risiken.`,
    forceRoute: 'complex',
  }),
  compare: ({ notes }) => ({
    text: `Dokumentvergleich der hochgeladenen Versionen (Delta-Ansicht + Zusammenfassung)${notes ? `\nHinweise: ${notes}` : ''}`,
    extra: `AUFGABE: Vergleiche die zwei hochgeladenen Dokumentversionen. Lies beide (read_document). Erzeuge mit create_or_edit_file (1) delta.html mit rot/grün-Hervorhebung und (2) delta.docx (Zusätze grün, Streichungen rot durchgestrichen). Antworte mit einer juristisch bewerteten Zusammenfassung der wesentlichen Änderungen (was hat sich materiell geändert, Risiko für welche Seite).`,
    forceRoute: 'complex',
  }),
  draft: ({ doc_type, parties, facts, extra }) => ({
    text: `Entwurf: ${doc_type || 'Dokument'}${parties ? ` – Parteien: ${parties}` : ''}\nSachverhalt/Vorgaben: ${facts || '–'}${extra ? `\nWeitere Vorgaben: ${extra}` : ''}`,
    extra: `AUFGABE: Entwurf eines Dokuments vom Typ „${doc_type || 'Schriftstück'}“ nach österreichischem Recht. Parteien: ${parties || 'siehe Sachverhalt'}. Zuerst die einschlägigen Normen/Formerfordernisse im RIS prüfen (z. B. Zuständigkeit, Fristen, zwingende Inhalte). Dann den vollständigen Text ausformulieren (Struktur, Rubrum/Überschriften, Klauseln, Platzhalter in eckigen Klammern für fehlende Daten) und mit create_or_edit_file als .docx (sauber formatiert) ausgeben. In der Antwort: Aufbau, getroffene Annahmen, Prüfpunkte für die Anwältin.`,
    forceRoute: 'complex',
  }),
  summary: ({ style, question }) => ({
    text: `Zusammenfassung (${style || 'Memo'}) der hochgeladenen Datei(en)${question ? ` – Schwerpunkt: ${question}` : ''}`,
    extra: `AUFGABE: Fasse die hochgeladenen Dokumente zusammen. Stil: ${style || 'juristisches Memo (Sachverhalt, rechtliche Würdigung, Fazit)'}. ${question ? `Schwerpunkt: ${question}.` : ''} Zuerst vollständig lesen (read_document). Konkrete Fakten, Daten, Beträge, Fristen und Parteien wiedergeben; keine Floskeln.`,
    forceRoute: 'complex',
  }),
  deadlines: ({ reference_date }) => ({
    text: `Fristen erkennen in den hochgeladenen Dokumenten${reference_date ? ` (Stichtag ${reference_date})` : ''}`,
    extra: `AUFGABE: Erkenne alle Fristen und fristauslösenden Ereignisse in den hochgeladenen Dokumenten (read_document). Für jede Frist: Bezug/Zitat, Auslöser, Dauer, berechnetes Fristende (Stichtag: ${reference_date || 'Datum im Dokument bzw. heute'}; Fristenregeln nach österreichischem Recht, §§ 902 ff ABGB, § 125 ZPO, § 32 AVG beachten und die angewandte Regel nennen), Rechtsfolge bei Versäumung, Priorität. Erzeuge mit create_or_edit_file eine Excel-Tabelle fristen.xlsx und gib in der Antwort eine Tabelle mit den dringendsten Fristen zuerst.`,
    forceRoute: 'complex',
  }),
}

// Markdown → .docx (server-side export of an answer, no model call).
function markdownToDocx(title, md) {
  const children = []
  if (title) children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }))
  const inline = (s) => {
    const runs = []
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[Q\d+\])/g
    let last = 0, m
    while ((m = re.exec(s))) {
      if (m.index > last) runs.push(new TextRun(s.slice(last, m.index)))
      const t = m[0]
      if (t.startsWith('**')) runs.push(new TextRun({ text: t.slice(2, -2), bold: true }))
      else if (t.startsWith('`')) runs.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas' }))
      else if (t.startsWith('[Q')) runs.push(new TextRun({ text: ' ' + t, superScript: true, color: '0E7C8A' }))
      else runs.push(new TextRun({ text: t.slice(1, -1), italics: true }))
      last = m.index + t.length
    }
    if (last < s.length) runs.push(new TextRun(s.slice(last)))
    return runs
  }
  const lines = String(md || '').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*$/.test(line)) { i++; continue }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) { children.push(new Paragraph({ children: inline(h[2]), heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][h[1].length - 1] })); i++; continue }
    if (/^\s*\|/.test(line)) {
      const rows = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) { const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()); if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells); i++ }
      if (rows.length) {
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map((r, ri) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph({ children: ri === 0 ? [new TextRun({ text: c.replace(/\*\*/g, ''), bold: true })] : inline(c) })] })) })) }))
      }
      continue
    }
    const li = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/)
    if (li) { children.push(new Paragraph({ children: inline(li[2]), bullet: /\d/.test(li[1]) ? undefined : { level: 0 }, numbering: undefined })); i++; continue }
    if (/^\s*>\s?/.test(line)) { children.push(new Paragraph({ children: inline(line.replace(/^\s*>\s?/, '')), indent: { left: 720 } })); i++; continue }
    // paragraph: merge consecutive text lines
    let txt = line
    while (i + 1 < lines.length && !/^\s*$/.test(lines[i + 1]) && !/^(#{1,6}\s|\s*([-*•]|\d+[.)])\s|\s*\||\s*>)/.test(lines[i + 1])) { i++; txt += ' ' + lines[i] }
    children.push(new Paragraph({ children: inline(txt), spacing: { after: 120 } }))
    i++
  }
  children.push(new Paragraph({ children: [new TextRun({ text: 'KI-generiert mit AI:ssociate – vor Verwendung juristisch prüfen.', italics: true, size: 16, color: '8A98A0' })], spacing: { before: 400 } }))
  return Packer.toBuffer(new Document({ creator: 'AI:ssociate', title: title || 'Antwort', sections: [{ children }] }))
}

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------
const app = express()
app.use(express.json({ limit: '40mb' }))
app.use(express.static(path.join(__dirname, 'public')))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, openai: Boolean(OPENAI_API_KEY), e2b: Boolean(E2B_API_KEY), models: { fast: MODEL_FAST, main: MODEL_MAIN, code: MODEL_CODE }, routing: ROUTING, webSearch: WEB_SEARCH_ENABLED, budget: { inMax: MAX_INPUT_TOKENS, outMax: MAX_OUTPUT_TOKENS } })
})

app.post('/api/export/docx', async (req, res) => {
  try {
    const { title = 'Antwort', markdown = '' } = req.body || {}
    const buf = await markdownToDocx(String(title).slice(0, 200), String(markdown).slice(0, 400_000))
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${String(title).replace(/[^\w.-]+/g, '_').slice(0, 60) || 'antwort'}.docx"`)
    res.send(buf)
  } catch (e) { res.status(500).json({ error: e?.message || 'Export fehlgeschlagen' }) }
})

// Direct RIS access for the UI (verification on demand, quick lookups).
app.get('/api/ris/search', async (req, res) => {
  try { res.json(await risSearch(req.query)) } catch (e) { res.status(400).json({ error: e?.message }) }
})
app.post('/api/verify', async (req, res) => {
  try { res.json(await verifyAnswer(String(req.body?.text || '').slice(0, 100_000))) } catch (e) { res.status(500).json({ error: e?.message }) }
})

app.post('/api/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  res.write(':' + ' '.repeat(2048) + '\n\n')
  const send = (event, data) => { try { res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`) } catch {} }
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, 15_000)
  heartbeat.unref?.()
  let clientGone = false
  res.on('close', () => { clientGone = true; clearInterval(heartbeat) })

  if (!OPENAI_API_KEY) { send('error', { message: 'Server: OPENAI_API_KEY fehlt.' }); return res.end() }

  const body = req.body ?? {}
  const { history = [], files: rawUploads = [], sessionId, privacy = 'off', webSearch = true, task = null } = body
  let prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  let taskExtra = ''
  let forceRoute = null
  if (task && typeof task === 'object' && TASK_PRESETS[task.type]) {
    const t = TASK_PRESETS[task.type](task.params || {})
    prompt = prompt || t.text
    taskExtra = t.extra
    forceRoute = t.forceRoute
  }
  if (!prompt) { send('error', { message: 'Bitte eine Frage oder Aufgabe eingeben.' }); return res.end() }

  const persistent = typeof sessionId === 'string' && sessionId.length > 0
  const privacyMode = privacy === 'pseudonymize' || privacy === 'anonymize' ? privacy : 'off'
  const useWeb = WEB_SEARCH_ENABLED && webSearch !== false

  // --- uploads: validate + extract text server-side ---
  const uploads = []
  for (const u of Array.isArray(rawUploads) ? rawUploads : []) {
    if (!u || typeof u.name !== 'string' || typeof u.base64 !== 'string') continue
    const name = path.basename(u.name).replace(/[^\w.\- ()äöüÄÖÜß]/g, '_')
    const buf = Buffer.from(u.base64, 'base64')
    if (!name || buf.length === 0) continue
    if (buf.length > MAX_UPLOAD_BYTES) { send('error', { message: `Datei „${name}“ überschreitet ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }); return res.end() }
    uploads.push({ name, buf })
    if (uploads.length >= MAX_UPLOADS) break
  }

  const ctx = { usage: newUsage() }
  const startedAt = Date.now()
  let stepSeq = 0
  const step = (kind, title, extra = {}) => { const id = ++stepSeq; send('step', { id, kind, title, status: 'running', ...extra }); return id }
  const stepDone = (id, extra = {}) => send('step_update', { id, status: 'done', ...extra })
  const stepFail = (id, extra = {}) => send('step_update', { id, status: 'error', ...extra })

  // Evidence registry: every search hit / read document / web citation gets a [Qn] marker.
  const evidence = []          // { marker, type: 'ris'|'web'|'upload', id, title, url, meta, text?, read: bool }
  const byId = new Map()
  const addEvidence = (e) => {
    const key = e.id || e.url
    if (key && byId.has(key)) { const ex = byId.get(key); Object.assign(ex, { ...e, marker: ex.marker, read: ex.read || e.read, text: e.text || ex.text }); return ex }
    const item = { ...e, marker: `Q${evidence.length + 1}`, read: Boolean(e.read) }
    evidence.push(item)
    if (key) byId.set(key, item)
    return item
  }
  const risIndex = new Map() // id -> normalized doc

  let sandbox = null, sandboxReady = false, sandboxStart = null
  const before = new Map()
  const images = []
  const filesOut = []
  const uploadTexts = new Map()

  async function ensureSandbox() {
    if (sandboxReady) return
    sandboxStart = Date.now()
    sandbox = persistent ? await getChatSandbox(sessionId) : await Sandbox.create({ apiKey: E2B_API_KEY, timeoutMs: SANDBOX_LIFETIME_MS })
    for (const u of uploads) {
      const ab = u.buf.buffer.slice(u.buf.byteOffset, u.buf.byteOffset + u.buf.byteLength)
      await sandbox.files.write(`${WORKDIR}/${u.name}`, ab)
    }
    try { await sandbox.runCode(DEPS_CODE, { timeoutMs: 180_000 }) } catch (e) { console.error('dep prep failed:', e?.message) }
    try { for (const e of await sandbox.files.list(WORKDIR)) if (e.type === 'file') before.set(e.path, e.size) } catch {}
    sandboxReady = true
  }

  // ---- tool implementations ----
  const fmtHit = (d, marker) => {
    if (d.kind === 'norm') return `[${marker}] ${d.id} · ${d.title}${d.inForceFrom ? ` · gilt seit ${d.inForceFrom}` : ''}${d.inForceTo ? ` · außer Kraft ${d.inForceTo}` : ''}${d.keywords ? ` · Schlagworte: ${d.keywords}` : ''}`
    if (d.kind === 'decision') return `[${marker}] ${d.id} · ${d.title}${d.norms ? ` · Normen: ${d.norms}` : ''}`
    return `[${marker}] ${d.id} · ${d.title}`
  }
  async function toolRisSearch(args) {
    const r = await risSearch(args)
    const lines = r.docs.map((d) => { risIndex.set(d.id, d); const ev = addEvidence({ type: 'ris', id: d.id, title: d.title, url: d.url, htmlUrl: d.htmlUrl, meta: d, read: false }); return fmtHit(d, ev.marker) })
    return { text: `${r.hits} Treffer (Seite ${args.page || 1}, ${r.docs.length} angezeigt).\n${lines.join('\n') || '(keine Dokumente)'}\nNächster Schritt: relevante IDs mit ris_read lesen.`, detail: `${r.hits} Treffer` }
  }
  async function toolRisRead(args) {
    let id = String(args.id || '').trim()
    const m = id.match(/(NOR\d+|LNO\d+|JJT_[\w]+|JJR_[\w]+|JFT_[\w]+|JFR_[\w]+|JWT_[\w]+|JWR_[\w]+|BVWGT_[\w]+|BVWGR_[\w]+|LVWGT_[\w]+|LVWGR_[\w]+|DSBT_[\w]+|BGBLA_[\w]+)/)
    if (m) id = m[1]
    let doc = risIndex.get(id)
    let url = doc?.htmlUrl
    if (!url) {
      if (/^https?:/.test(args.id)) url = args.id
      else {
        const app = /^NOR/.test(id) ? 'BrKons' : /^LNO/.test(id) ? 'LrKons' : /^JJ[TR]_/.test(id) ? 'Justiz' : /^JF[TR]_/.test(id) ? 'Vfgh' : /^JW[TR]_/.test(id) ? 'Vwgh' : /^BVWG/.test(id) ? 'Bvwg' : /^LVWG/.test(id) ? 'Lvwg' : /^DSB/.test(id) ? 'Dsk' : /^BGBLA/.test(id) ? 'BgblAuth' : 'Justiz'
        url = guessHtmlUrl(app, id)
      }
    }
    const maxChars = Math.min(60_000, Math.max(2000, Number(args.max_chars) || 15_000))
    const page = await fetchPageText(url, maxChars)
    const ev = addEvidence({ type: 'ris', id, title: doc?.title || page.title || id, url: doc?.url || url, htmlUrl: url, meta: doc || null, read: true, text: page.text.slice(0, 12_000) })
    return { text: `[${ev.marker}] ${ev.title}\nURL: ${ev.url}\n${page.truncated ? `(gekürzt auf ${maxChars} von ${page.total} Zeichen)\n` : ''}\n${page.text}`, detail: ev.title }
  }
  async function toolFetchPage(args) {
    const maxChars = Math.min(60_000, Math.max(2000, Number(args.max_chars) || 15_000))
    const page = await fetchPageText(String(args.url || ''), maxChars)
    const ev = addEvidence({ type: 'web', id: null, url: String(args.url), title: page.title || String(args.url), read: true, text: page.text.slice(0, 12_000) })
    return { text: `[${ev.marker}] ${ev.title}\nURL: ${ev.url}\n${page.truncated ? `(gekürzt auf ${maxChars} von ${page.total} Zeichen)\n` : ''}\n${page.text}`, detail: ev.title }
  }
  async function toolReadDocument(args) {
    const name = String(args.name || '')
    const t = uploadTexts.get(name) || [...uploadTexts.entries()].find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]
    if (!t) return { text: `Datei „${name}“ nicht gefunden. Vorhanden: ${[...uploadTexts.keys()].join(', ') || '(keine)'}`, detail: 'nicht gefunden' }
    if (t.unsupported) return { text: `Dateityp von „${name}“ kann nicht direkt gelesen werden (z. B. .xlsx/.pptx). Nutze create_or_edit_file, um den Inhalt per Python zu extrahieren.`, detail: 'Typ nicht lesbar' }
    if (!t.text.trim()) return { text: `„${name}“ enthält keinen extrahierbaren Text (gescannt?). Falls nötig: create_or_edit_file mit OCR (pytesseract/ocrmypdf) versuchen.`, detail: 'kein Text' }
    const parts = Math.max(1, Math.ceil(t.text.length / UPLOAD_PART_CHARS))
    const part = Math.min(parts, Math.max(1, Number(args.part) || 1))
    const chunk = t.text.slice((part - 1) * UPLOAD_PART_CHARS, part * UPLOAD_PART_CHARS)
    const ev = addEvidence({ type: 'upload', id: `upload:${name}`, title: name, url: '', read: true })
    return { text: `[${ev.marker}] ${name} – Teil ${part}/${parts}${t.pages ? ` (${t.pages} Seiten)` : ''}\n\n${chunk}`, detail: `Teil ${part}/${parts}` }
  }
  async function toolCreateFile(args, stepId) {
    await ensureSandbox()
    const task = String(args.task || '')
    const wanted = Array.isArray(args.output_files) ? args.output_files.map(String) : []
    const uploadLine = uploads.length ? `Hochgeladene Dateien in /home/user: ${uploads.map((u) => u.name).join(', ')}.` : 'Keine hochgeladenen Dateien.'
    let input = [{ role: 'user', content: `${uploadLine}\nGewünschte Ausgabedateien: ${wanted.join(', ') || 'passend benennen'}.\n\nAUFGABE:\n${task}` }]
    let prevId
    let lastOut = ''
    let newFiles = []
    for (let attempt = 1; attempt <= 4; attempt++) {
      send('step_update', { id: stepId, status: 'running', detail: attempt === 1 ? 'Programm wird geschrieben…' : `Korrektur (Versuch ${attempt})…` })
      const resp = await callModel(ctx, { model: MODEL_CODE, instructions: CODE_SYSTEM, input, effort: EFFORT_CODE, prevId, maxOut: 12_000 })
      prevId = resp.id
      const code = (resp.output_text || '').match(/```(?:python|py)?\s*\n([\s\S]*?)```/i)?.[1]?.trim() || (resp.output_text || '').trim()
      if (!code) { input = [{ role: 'user', content: 'Es kam kein Code zurück. Bitte das vollständige Python-Skript in einem ```python Block.' }]; continue }
      send('step_update', { id: stepId, status: 'running', detail: attempt === 1 ? 'Wird ausgeführt…' : `Wird erneut ausgeführt (Versuch ${attempt})…` })
      const snap = new Map(); try { for (const e of await sandbox.files.list(WORKDIR)) if (e.type === 'file') snap.set(e.path, e.size) } catch {}
      let ex
      try { ex = await sandbox.runCode(code, { timeoutMs: 180_000 }) } catch (e) { ex = { logs: { stdout: [], stderr: [String(e?.message || e)] }, results: [], error: { name: 'Error', value: String(e?.message || e) } } }
      ;(ex.results || []).forEach((r) => { if (r.png) images.push(`data:image/png;base64,${r.png}`) })
      const out = (ex.logs?.stdout ?? []).join('')
      const err = (ex.logs?.stderr ?? []).join('')
      const errObj = ex.error ? `${ex.error.name}: ${ex.error.value}` : ''
      lastOut = out
      try { newFiles = (await sandbox.files.list(WORKDIR)).filter((e) => e.type === 'file' && snap.get(e.path) !== e.size).map((e) => e.name) } catch {}
      const missing = wanted.filter((w) => !newFiles.some((n) => n.toLowerCase() === w.toLowerCase()))
      if (!errObj && (!wanted.length || !missing.length)) {
        const rm = out.match(/RESULT:\s*(\{[\s\S]*\})/)
        const summary = rm ? (parseJsonLoose(rm[1])?.summary || '') : ''
        return { text: `OK. Erzeugte/geänderte Dateien: ${newFiles.join(', ') || '(keine)'}${summary ? `\nZusammenfassung: ${summary}` : ''}\nAusgabe (Ende):\n${out.slice(-2500)}`, detail: newFiles.join(', ') || 'fertig', files: newFiles }
      }
      const problem = errObj ? `FEHLER:\n${errObj}\n${err.slice(-2500)}` : `Die Dateien ${missing.join(', ')} wurden nicht erzeugt. Ausgabe:\n${out.slice(-2000)}`
      input = [{ role: 'user', content: `${problem}\n\nBitte das KOMPLETTE korrigierte Skript erneut als \`\`\`python Block liefern (gleiche Aufgabe, Fehler beheben).` }]
    }
    return { text: `Die Datei konnte nach mehreren Versuchen nicht fehlerfrei erzeugt werden. Letzte Ausgabe:\n${lastOut.slice(-2000)}\nErzeugte Dateien: ${newFiles.join(', ') || '(keine)'}`, detail: 'fehlgeschlagen', files: newFiles, failed: true }
  }

  const STEP_TITLES = {
    ris_search: (a) => `RIS-Suche: ${[a.query, a.title && `Titel ${a.title}`, a.paragraph && `§ ${a.paragraph}`, a.geschaeftszahl, a.norm].filter(Boolean).join(' · ') || a.corpus} (${a.corpus || 'bundesrecht'}${a.applikation ? '/' + a.applikation : ''})`,
    ris_read: (a) => `RIS-Dokument lesen: ${a.id}`,
    fetch_page: (a) => `Seite lesen: ${String(a.url || '').replace(/^https?:\/\//, '').slice(0, 80)}`,
    read_document: (a) => `Dokument lesen: ${a.name}${a.part > 1 ? ` (Teil ${a.part})` : ''}`,
    create_or_edit_file: (a) => `Datei erstellen/bearbeiten: ${(a.output_files || []).join(', ') || 'Ergebnisdatei'}`,
  }
  const STEP_KIND = { ris_search: 'search', ris_read: 'read', fetch_page: 'web', read_document: 'upload', create_or_edit_file: 'file' }

  async function runToolCall(call) {
    let args = {}
    try { args = JSON.parse(call.arguments || '{}') } catch {}
    const name = call.name
    const sid = step(STEP_KIND[name] || 'tool', STEP_TITLES[name] ? STEP_TITLES[name](args) : name)
    try {
      let r
      if (name === 'ris_search') r = await toolRisSearch(args)
      else if (name === 'ris_read') r = await toolRisRead(args)
      else if (name === 'fetch_page') r = await toolFetchPage(args)
      else if (name === 'read_document') r = await toolReadDocument(args)
      else if (name === 'create_or_edit_file') r = await toolCreateFile(args, sid)
      else r = { text: `Unbekanntes Werkzeug ${name}.` }
      if (r.failed) stepFail(sid, { detail: r.detail }); else stepDone(sid, { detail: r.detail })
      return r.text
    } catch (e) {
      const msg = e instanceof BudgetExceeded ? e.message : String(e?.message || e)
      stepFail(sid, { detail: msg.slice(0, 160) })
      if (e instanceof BudgetExceeded) throw e
      return `FEHLER bei ${name}: ${msg.slice(0, 500)}`
    }
  }

  // Harvest hosted web-search citations as evidence.
  const collectWebCitations = (resp) => {
    for (const o of resp.output || []) {
      if (o.type !== 'message') continue
      for (const part of o.content || []) for (const ann of part.annotations || []) {
        if (ann.type === 'url_citation' && ann.url) addEvidence({ type: 'web', id: null, url: ann.url, title: ann.title || ann.url, read: false })
      }
    }
  }

  /** Generic agent loop: model + tools until a text answer (or step cap). */
  async function agentLoop({ model, effort, instructions, input, tools, maxSteps, label }) {
    let prevId
    let text = ''
    let steps = 0
    for (let i = 1; i <= maxSteps; i++) {
      const sid = step('think', i === 1 ? `${label} analysiert die Aufgabe` : `${label} wertet Ergebnisse aus`, { model })
      let resp
      try {
        resp = await callModel(ctx, { model, instructions, input, tools, effort, prevId })
      } catch (e) { stepFail(sid, { detail: e.message?.slice(0, 160) }); throw e }
      prevId = resp.id
      collectWebCitations(resp)
      const webCalls = (resp.output || []).filter((o) => o.type === 'web_search_call')
      for (const w of webCalls) { const q = w.action?.query || w.query || ''; const wid = step('web', `Websuche${q ? ': ' + q : ''}`); stepDone(wid) }
      const calls = (resp.output || []).filter((o) => o.type === 'function_call')
      stepDone(sid, { detail: calls.length ? `${calls.length} Werkzeug${calls.length > 1 ? 'e' : ''} angefordert` : 'Antwort formuliert' })
      steps = i
      if (!calls.length) { text = resp.output_text || ''; break }
      input = []
      for (const c of calls) {
        const out = await runToolCall(c)
        input.push({ type: 'function_call_output', call_id: c.call_id, output: out })
      }
      if (clientGone) throw new Error('Verbindung geschlossen.')
    }
    if (!text && prevId) {
      // Step cap reached: ask for the answer without further tools.
      const sid = step('think', `${label} fasst zusammen (Schrittlimit)`, { model })
      const resp = await callModel(ctx, { model, instructions, input: [...input, { role: 'user', content: 'Schrittlimit erreicht. Antworte JETZT abschließend auf Basis der vorliegenden Belege; kennzeichne offene Punkte.' }], effort, prevId })
      collectWebCitations(resp)
      text = resp.output_text || ''
      stepDone(sid)
    }
    return { text, steps }
  }

  try {
    // ---- 0. uploads: extract text ----
    if (uploads.length) {
      const sid = step('upload', `${uploads.length} Datei${uploads.length > 1 ? 'en' : ''} wird gelesen`)
      for (const u of uploads) uploadTexts.set(u.name, await extractText(u.name, u.buf))
      stepDone(sid, { detail: uploads.map((u) => `${u.name} (${(uploadTexts.get(u.name).text.length / 1000).toFixed(0)}k Zeichen)`).join(', ') })
    }

    const histInput = (Array.isArray(history) ? history : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 12_000) }))

    const privacyLine =
      privacyMode === 'pseudonymize'
        ? 'DATENSCHUTZ (DSGVO) – PSEUDONYMISIERUNG AKTIV: Ersetze in deiner Antwort und in allen erzeugten Dateien personenbezogene Daten (Namen natürlicher Personen, Adressen, E-Mail, Telefon, IBAN, Akten-/SV-/Steuernummern, Geburtsdaten) konsequent durch typisierte Platzhalter ([PERSON_1], [ADRESSE_1] …). Bei Dateiausgaben zusätzlich eine Zuordnungstabelle mapping.xlsx erzeugen. Weise darauf hin, dass pseudonymisierte Daten weiterhin personenbezogen sind.\n\n'
        : privacyMode === 'anonymize'
        ? 'DATENSCHUTZ (DSGVO) – ANONYMISIERUNG AKTIV: Entferne personenbezogene Daten irreversibel ([geschwärzt]) in Antwort und erzeugten Dateien; keine Zuordnungstabelle.\n\n'
        : ''
    const uploadLine = uploads.length
      ? `HOCHGELADENE DATEIEN (mit read_document lesen; für Dateiausgaben liegen sie in /home/user): ${uploads.map((u) => { const t = uploadTexts.get(u.name); return `${u.name} (${t.unsupported ? 'Typ nur per create_or_edit_file lesbar' : `${t.text.length} Zeichen Text, ${Math.max(1, Math.ceil(t.text.length / UPLOAD_PART_CHARS))} Teil(e)`})` }).join('; ')}\n\n`
      : ''
    const userContent = privacyLine + (taskExtra ? taskExtra + '\n\n' : '') + uploadLine + prompt

    // ---- 1. triage (fast model) ----
    const tri = step('triage', 'Aufgabe wird eingeordnet', { model: MODEL_FAST })
    let triage = { complexity: 'research', task_type: 'recherche', needs_file_output: false, title: prompt.slice(0, 60), plan: [] }
    try {
      const tr = await callModel(ctx, {
        model: MODEL_FAST, instructions: TRIAGE_INSTRUCTIONS, effort: 'low', maxOut: 1500,
        input: [...histInput.slice(-4), { role: 'user', content: `${uploads.length ? `Hochgeladene Dateien: ${uploads.map((u) => u.name).join(', ')}\n` : ''}${task?.type ? `Workflow: ${task.type}\n` : ''}ANFRAGE:\n${prompt.slice(0, 6000)}` }],
        text: { format: { type: 'json_schema', name: 'triage', schema: TRIAGE_SCHEMA, strict: true } },
      })
      const parsed = parseJsonLoose(tr.output_text || '')
      if (parsed?.complexity) triage = { ...triage, ...parsed }
    } catch (e) { console.error('triage failed:', e?.message) }
    if (uploads.length || triage.needs_file_output) triage.complexity = 'complex'
    if (forceRoute) triage.complexity = forceRoute
    if (ROUTING === 'main') triage.routed = 'main'
    const route = triage.complexity
    const loopModel = ROUTING === 'main' ? MODEL_MAIN : route === 'complex' ? MODEL_MAIN : MODEL_FAST
    const finalModel = ROUTING === 'main' ? MODEL_MAIN : route === 'simple' ? MODEL_FAST : MODEL_MAIN
    const label = (m) => (m === MODEL_FAST ? 'Luna' : m === MODEL_MAIN ? 'Sol' : m)
    stepDone(tri, { detail: `${{ simple: 'einfach', research: 'Recherche', complex: 'komplex' }[route]} · ${label(loopModel)}${finalModel !== loopModel ? ' → ' + label(finalModel) : ''}` })
    send('route', { route, taskType: triage.task_type, title: triage.title, plan: triage.plan, models: { loop: loopModel, final: finalModel, code: MODEL_CODE }, labels: { loop: label(loopModel), final: label(finalModel), code: label(MODEL_CODE) } })

    const tools = [TOOL_RIS_SEARCH, TOOL_RIS_READ, TOOL_FETCH_PAGE, TOOL_FILE, ...(uploads.length ? [TOOL_READ_DOCUMENT] : []), ...(useWeb ? [WEB_SEARCH_TOOL] : [])]
    const baseInput = [...histInput, { role: 'user', content: userContent }]

    // ---- 2. agent loop / synthesis ----
    let answer = ''
    let notes = ''
    try {
      if (route === 'simple') {
        const r = await agentLoop({ model: loopModel, effort: loopModel === MODEL_FAST ? EFFORT_FAST : EFFORT_MAIN, instructions: AGENT_INSTRUCTIONS, input: baseInput, tools, maxSteps: SIMPLE_MAX_STEPS, label: label(loopModel) })
        answer = r.text
      } else if (route === 'research' && loopModel !== finalModel) {
        const r = await agentLoop({ model: loopModel, effort: EFFORT_FAST, instructions: RESEARCH_INSTRUCTIONS, input: baseInput, tools, maxSteps: AGENT_MAX_STEPS, label: label(loopModel) })
        notes = r.text
        // Build the evidence dossier for the synthesis model.
        const sid = step('final', `${label(finalModel)} formuliert die Antwort`, { model: finalModel })
        const budgetChars = 600_000
        let used = 0
        const dossier = []
        for (const e of evidence) {
          const head = `[${e.marker}] (${e.type === 'ris' ? 'RIS' : e.type === 'web' ? 'Web' : 'Upload'}${e.read ? ', Volltext gelesen' : ', nur Treffer'}) ${e.title}${e.url ? ` · ${e.url}` : ''}${e.meta?.inForceFrom ? ` · gilt seit ${e.meta.inForceFrom}` : ''}${e.meta?.inForceTo ? ` · außer Kraft ${e.meta.inForceTo}` : ''}`
          const body = e.text ? `\n${e.text.slice(0, Math.max(0, Math.min(8000, budgetChars - used)))}` : ''
          used += head.length + body.length
          dossier.push(head + body)
          if (used > budgetChars) break
        }
        const synthInput = [...histInput, { role: 'user', content: `${userContent}\n\n=== BELEGE (vom Recherche-Agenten gesammelt) ===\n${dossier.join('\n\n') || '(keine Belege gefunden)'}\n\n=== RECHERCHE-NOTIZEN ===\n${notes || '(keine)'}` }]
        const resp = await callModel(ctx, { model: finalModel, instructions: SYNTH_INSTRUCTIONS, input: synthInput, effort: EFFORT_MAIN, maxOut: 24_000 })
        answer = resp.output_text || ''
        stepDone(sid)
      } else {
        const r = await agentLoop({ model: loopModel, effort: loopModel === MODEL_FAST ? EFFORT_FAST : EFFORT_MAIN, instructions: AGENT_INSTRUCTIONS, input: baseInput, tools, maxSteps: AGENT_MAX_STEPS, label: label(loopModel) })
        answer = r.text
      }
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) throw e
      answer = answer || `**Token-Budget erreicht** (max. ${(MAX_INPUT_TOKENS / 1e6).toFixed(0)} Mio. Eingabe- / ${(MAX_OUTPUT_TOKENS / 1e3).toFixed(0)}k Ausgabe-Tokens pro Frage). ${notes ? 'Vorliegende Recherche-Notizen:\n\n' + notes : 'Bitte die Frage enger fassen oder in Teilfragen aufteilen.'}`
    }
    if (!answer.trim()) answer = 'Es konnte keine Antwort erzeugt werden. Bitte die Frage präzisieren.'

    // ---- 3. verification (deterministic, against RIS) ----
    let verification = null
    const vid = step('verify', 'Zitate werden gegen das RIS geprüft')
    try {
      verification = await verifyAnswer(answer)
      stepDone(vid, { detail: verification.summary.checked ? `${verification.summary.ok} von ${verification.summary.checked} Fundstellen bestätigt${verification.summary.notFound ? `, ${verification.summary.notFound} nicht gefunden` : ''}` : 'keine Normzitate erkannt' })
    } catch (e) { stepFail(vid, { detail: e.message }) }

    // ---- 4. follow-ups (fast model, tiny) ----
    let followups = []
    try {
      const fr = await callModel(ctx, { model: MODEL_FAST, instructions: FOLLOWUP_INSTRUCTIONS, effort: 'low', maxOut: 400, input: [{ role: 'user', content: `FRAGE: ${prompt.slice(0, 2000)}\n\nANTWORT (Auszug): ${answer.slice(0, 6000)}` }], text: { format: { type: 'json_schema', name: 'followups', schema: { type: 'object', additionalProperties: false, properties: { followups: { type: 'array', items: { type: 'string' } } }, required: ['followups'] }, strict: true } } })
      followups = (parseJsonLoose(fr.output_text || '')?.followups || []).filter((s) => typeof s === 'string').slice(0, 3)
    } catch {}

    // ---- 5. files from the sandbox ----
    if (sandboxReady) {
      try {
        const after = await sandbox.files.list(WORKDIR)
        for (const e of after.filter((x) => x.type === 'file' && before.get(x.path) !== x.size).slice(0, MAX_FILES)) {
          if (e.size > MAX_FILE_BYTES) { filesOut.push({ name: e.name, size: e.size, tooLarge: true }); continue }
          const bytes = await sandbox.files.read(e.path, { format: 'bytes' })
          filesOut.push({ name: e.name, size: e.size, base64: Buffer.from(bytes).toString('base64') })
        }
      } catch (e) { console.error('file capture failed:', e?.message) }
    }

    const cited = new Set([...answer.matchAll(/\[Q(\d+)\]/g)].map((m) => 'Q' + m[1]))
    const sources = evidence.map((e) => ({ marker: e.marker, type: e.type, id: e.id, title: e.title, url: e.url, read: e.read, cited: cited.has(e.marker), meta: e.meta ? { kind: e.meta.kind, court: e.meta.court, gz: e.meta.gz, date: e.meta.date, inForceFrom: e.meta.inForceFrom, inForceTo: e.meta.inForceTo, section: e.meta.section, law: e.meta.law, abbr: e.meta.abbr, docType: e.meta.docType } : null }))

    send('final', {
      answer, sources, verification, followups, title: triage.title, route, plan: triage.plan,
      models: { loop: loopModel, final: finalModel, code: MODEL_CODE },
      execution: { images, files: filesOut },
      cost: computeCost(ctx.usage, sandboxStart ? (Date.now() - sandboxStart) / 1000 : 0),
      durationMs: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('chat error:', err)
    send('error', { message: err?.message ?? 'Unbekannter Fehler.', cost: computeCost(ctx.usage, sandboxStart ? (Date.now() - sandboxStart) / 1000 : 0) })
  } finally {
    if (!persistent && sandbox) { try { await sandbox.kill() } catch {} }
    clearInterval(heartbeat)
    res.end()
  }
})

if (process.env.NO_LISTEN !== '1') {
  app.listen(PORT, () => {
    console.log(`AI:ssociate Playground listening on http://localhost:${PORT} (fast=${MODEL_FAST}, main=${MODEL_MAIN}, code=${MODEL_CODE})`)
  })
}

// Exported for tests (NO_LISTEN=1 node -e "import('./server.js')…").
export { extractNormCitations, extractDecisionCitations, normalizeRisDoc, htmlToText, markdownToDocx, risSearch, app }
