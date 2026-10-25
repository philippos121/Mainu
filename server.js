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

// TEST ONLY: hardcoded keys so the app runs without configuring env vars.
// The env vars override these. Delete the fallbacks and rotate the keys before
// any real or public deployment.
const E2B_API_KEY = process.env.E2B_API_KEY || 'e2b_bd1a9240aeb8ea21578a5fc7ab87befd408f074e'
const AISSOCIATE_API_KEY = process.env.AISSOCIATE_API_KEY || 'ck:77bac49b-a3ab-4b41-b554-633280f33f5a:51002748-9102-4d40-8f23-9463f43df7f4'
const AISSOCIATE_BASE_URL = (process.env.AISSOCIATE_BASE_URL || 'https://app.aissociate.at').replace(/\/+$/, '')
const AISSOCIATE_TIMEOUT_MS = Number(process.env.AISSOCIATE_TIMEOUT_MS || 240_000)

// Models: Sol decides the legal area, reviews the knowledge-base answer, writes
// the final answer and runs document tasks; Luna only generates follow-up
// suggestions. The code model writes the Python for file generation.
const MODEL_MAIN = process.env.OPENAI_MODEL_MAIN || process.env.OPENAI_MODEL || 'gpt-6-sol'
const MODEL_FAST = process.env.OPENAI_MODEL_FAST || 'gpt-6-luna'
const MODEL_CODE = process.env.OPENAI_MODEL_CODE || MODEL_MAIN
const EFFORT_MAIN = process.env.OPENAI_EFFORT_MAIN || 'medium'
const EFFORT_PLAN = process.env.OPENAI_EFFORT_PLAN || 'low'
const EFFORT_CODE = process.env.OPENAI_EFFORT_CODE || 'medium'

// Hard per-question budgets (summed over every model call of one question).
const MAX_INPUT_TOKENS = Number(process.env.MAX_INPUT_TOKENS || 1_000_000)
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 100_000)
const MAX_OUTPUT_PER_CALL = Number(process.env.MAX_OUTPUT_PER_CALL || 16_000)
// Step limits: one knowledge-base call, at most 3 web searches, few tool steps.
const MAX_WEB_SEARCHES = Number(process.env.MAX_WEB_SEARCHES || 3)
const DOC_MAX_STEPS = Number(process.env.DOC_MAX_STEPS || 8)

// Web search (OpenAI hosted tool) — only as a fallback after the knowledge base.
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
const AISSOCIATE_PRICE_PER_CALL = Number(process.env.AISSOCIATE_PRICE_PER_CALL || 0)
const E2B_PRICE_PER_SEC = Number(process.env.E2B_PRICE_PER_SEC || 0.00014)

const UA = 'AIssociate-Playground/2.1 (+https://aissociate.at)'
const RIS_BASE = 'https://data.bka.gv.at/ris/api/v2.6'

function priceFor(model) {
  return PRICES[model] || PRICES[String(model).replace(/-\d{4}-\d{2}-\d{2}$/, '')] || { in: 2, cached: 0.2, out: 10 }
}

// ---------------------------------------------------------------------------
// Usage / cost / budget
// ---------------------------------------------------------------------------
function newUsage() {
  return { byModel: {}, inTok: 0, outTok: 0, cachedTok: 0, webSearchCalls: 0, aissociateCalls: 0, calls: 0 }
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
  const aissociateUsd = acc.aissociateCalls * AISSOCIATE_PRICE_PER_CALL
  const e2bUsd = (seconds || 0) * E2B_PRICE_PER_SEC
  return {
    inTok: acc.inTok, outTok: acc.outTok, cachedTok: acc.cachedTok, calls: acc.calls,
    webSearchCalls: acc.webSearchCalls, aissociateCalls: acc.aissociateCalls, seconds: Math.round(seconds || 0),
    openaiUsd: +openaiUsd.toFixed(4), webSearchUsd: +webSearchUsd.toFixed(4), aissociateUsd: +aissociateUsd.toFixed(4), e2bUsd: +e2bUsd.toFixed(4),
    totalUsd: +(openaiUsd + webSearchUsd + aissociateUsd + e2bUsd).toFixed(4), byModel,
    budget: { inMax: MAX_INPUT_TOKENS, outMax: MAX_OUTPUT_TOKENS },
  }
}

// ---------------------------------------------------------------------------
// OpenAI (lazy client + robust Responses API call)
// ---------------------------------------------------------------------------
let _openai
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: OPENAI_API_KEY, ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}) })
  return _openai
}

class BudgetExceeded extends Error {}

/**
 * One Responses API call with budget enforcement and graceful fallbacks
 * (models that reject `reasoning`, hosted web_search, max_tool_calls or
 * structured output).
 */
async function callModel(ctx, { model, instructions, input, tools, toolChoice, effort, prevId, maxOut, text, maxToolCalls }) {
  const remainingOut = MAX_OUTPUT_TOKENS - ctx.usage.outTok
  const remainingIn = MAX_INPUT_TOKENS - ctx.usage.inTok
  if (remainingOut < 800 || remainingIn < 2000) throw new BudgetExceeded('Token-Budget für diese Frage ausgeschöpft.')
  const params = {
    model,
    instructions,
    input,
    max_output_tokens: Math.max(800, Math.min(maxOut || MAX_OUTPUT_PER_CALL, remainingOut)),
    ...(tools?.length ? { tools, tool_choice: toolChoice || 'auto' } : {}),
    ...(tools?.length && maxToolCalls ? { max_tool_calls: maxToolCalls } : {}),
    ...(effort ? { reasoning: { effort } } : {}),
    ...(prevId ? { previous_response_id: prevId } : {}),
    ...(text ? { text } : {}),
  }
  let resp
  try {
    resp = await getOpenAI().responses.create(params)
  } catch (e) {
    const msg = String(e?.message || e)
    const isBad = e?.status === 400 || /400|unsupported|not supported|invalid|unknown parameter/i.test(msg)
    if (!isBad) throw e
    const p2 = { ...params }
    let changed = false
    if (p2.max_tool_calls && /max_tool_calls/i.test(msg)) { delete p2.max_tool_calls; changed = true }
    if (p2.reasoning && /reasoning/i.test(msg)) { delete p2.reasoning; changed = true }
    if (p2.tools && /web_search/i.test(msg)) { p2.tools = p2.tools.filter((t) => !String(t.type).startsWith('web_search')); if (!p2.tools.length) { delete p2.tools; delete p2.tool_choice; delete p2.max_tool_calls }; changed = true }
    if (p2.text && /text|format|schema/i.test(msg)) { delete p2.text; changed = true }
    if (!changed && p2.reasoning) { delete p2.reasoning; changed = true }
    if (!changed) throw e
    resp = await getOpenAI().responses.create(p2)
  }
  addUsage(ctx.usage, model, resp)
  if (resp?.status === 'incomplete') console.warn(`responses: incomplete (${resp.incomplete_details?.reason || '?'}) model=${model} max_output_tokens=${params.max_output_tokens}`)
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
// HTTP helpers
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
  s = s.replace(/<span[^>]*(sr-only|visually-?hidden|screenreader)[^>]*>[\s\S]*?<\/span>/gi, '')
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6]|table|blockquote|section|article|title)>/gi, '\n')
  s = s.replace(/<(p|div|h[1-6]|table|blockquote|section|article)\b[^>]*>/gi, '\n')
  s = s.replace(/<(li)[^>]*>/gi, '• ').replace(/<\/t[dh]>/gi, '\t')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ')
  return s.trim()
}

// ---------------------------------------------------------------------------
// AI:ssociate API (knowledge base, itself agentic) — SSE client
// Reference: PyPI package "aissociate" 0.2.1 (POST /api/public/v1/chat/ask,
// header x-api-key, SSE events id/event/data with types message,
// document_number, anonymization_meta, qa_metadata, evaluation_metadata).
// ---------------------------------------------------------------------------
const LEGAL_AREAS = { civil: 'zivilrechtogh', criminal: 'strafrecht', tax: 'steuerrecht', public: 'publiclaw' }
const LEGAL_AREA_LABEL = { civil: 'Zivilrecht', criminal: 'Strafrecht', tax: 'Steuerrecht', public: 'Öffentliches Recht', none: 'allgemein' }
const SCOPES = ['Bund', 'Steiermark', 'Tirol', 'Wien', 'Kärnten', 'Niederösterreich', 'Oberösterreich', 'Vorarlberg', 'Burgenland', 'Salzburg']

function parseSseBlock(block) {
  const ev = { id: '', event: '', data: [] }
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line || line.startsWith(':')) continue
    const i = line.indexOf(':')
    const key = (i >= 0 ? line.slice(0, i) : line).trim()
    const value = i >= 0 ? line.slice(i + 1).replace(/^ /, '') : ''
    if (key === 'data') ev.data.push(value)
    else if (key === 'event') ev.event = value.trim()
    else if (key === 'id') ev.id = value.trim()
  }
  return ev
}

function risLinkForDocNumber(s) {
  const id = String(s || '').trim()
  const m = id.match(/^(JJT|JJR|JFT|JFR|JWT|JWR|NOR|LNO|BVWGT|BVWGR|LVWGT|LVWGR|DSBT|BGBLA|LGBLA)[_\d]?/i)
  if (!m) return ''
  const p = m[1].toUpperCase()
  const app = p.startsWith('JJ') ? 'Justiz' : p.startsWith('JF') ? 'Vfgh' : p.startsWith('JW') ? 'Vwgh' : p === 'NOR' ? 'Bundesnormen' : p === 'LNO' ? 'Landesnormen' : p.startsWith('BVWG') ? 'Bvwg' : p.startsWith('LVWG') ? 'Lvwg' : p === 'DSBT' ? 'Dsk' : p === 'BGBLA' ? 'BgblAuth' : 'LgblAuth'
  return `https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=${app}&Dokumentnummer=${encodeURIComponent(id)}`
}

function sourceFromDocumentEvent(text, meta) {
  const m = meta && typeof meta === 'object' ? meta : {}
  const pick = (...keys) => { for (const k of keys) { const v = m[k] ?? m.document?.[k] ?? m.source?.[k]; if (typeof v === 'string' && v.trim()) return v.trim() } return '' }
  const url = pick('url', 'link', 'document_url', 'source_url', 'href', 'ris_url') || risLinkForDocNumber(pick('document_number', 'dokumentnummer', 'id') || text)
  const title = pick('title', 'name', 'kurztitel', 'citation', 'label', 'geschaeftszahl', 'document_number') || String(text || '').trim()
  return { title: title || url || 'Dokument', url, raw: String(text || '').trim(), meta: Object.keys(m).length ? m : null }
}

/**
 * Ask the AI:ssociate knowledge base; streams text via onDelta.
 * The timeout is an idle timeout between chunks (like the reference client's
 * httpx read timeout), not a total deadline: agentic answers may stream for
 * minutes. A stream that breaks after the answer arrived still returns it.
 */
async function askAissociate({ question, legalArea, scope, threadId, onDelta, signal }) {
  if (!AISSOCIATE_API_KEY) throw new Error('AISSOCIATE_API_KEY fehlt.')
  const payload = {
    question,
    law: LEGAL_AREAS[legalArea] || null,
    sub_law: scope && SCOPES.includes(scope) ? scope : null,
    file_context: [],
    file_query_type: 'general',
    ...(threadId ? { thread_id: threadId } : {}),
  }
  const ctrl = new AbortController()
  let timer = null
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), AISSOCIATE_TIMEOUT_MS) }
  const onOuterAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onOuterAbort, { once: true })
  const out = { answer: '', sources: [], threadId: threadId || null, events: 0, errors: [], meta: {} }
  let rawHead = ''
  let contentType = ''
  try {
    arm()
    const r = await fetch(`${AISSOCIATE_BASE_URL}/api/public/v1/chat/ask`, {
      method: 'POST',
      headers: { 'x-api-key': AISSOCIATE_API_KEY, 'Content-Type': 'application/json', Accept: 'text/event-stream', 'User-Agent': UA },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      throw new Error(`AI:ssociate API ${r.status}${r.status === 401 ? ' (API-Key ungültig)' : ''}: ${body.slice(0, 300)}`)
    }
    contentType = r.headers.get('content-type') || ''
    const handle = (block) => {
      if (!block.trim()) return
      const ev = parseSseBlock(block)
      if (!ev.data.length) return
      out.events++
      const raw = ev.data.join('\n')
      let j
      try { j = JSON.parse(raw) } catch { if (ev.event === 'error') out.errors.push(raw.slice(0, 300)); return }
      if (ev.event === 'error') { out.errors.push(String(j?.text || raw).slice(0, 300)); return }
      const type = j?.type || 'message'
      const text = typeof j?.text === 'string' ? j.text : ''
      if (type === 'message') { out.answer += text; if (text) onDelta?.(text) }
      else if (type === 'document_number') out.sources.push(sourceFromDocumentEvent(text, j?.meta))
      else if (type === 'qa_metadata') { const tid = j?.meta?.qa_metadata?.thread_id || j?.meta?.thread_id; if (tid) out.threadId = tid; out.meta.qa = j?.meta || null }
      else out.meta[type] = j?.meta ?? text
    }
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        arm()
        const chunk = dec.decode(value, { stream: true })
        if (rawHead.length < 300) rawHead += chunk.slice(0, 300 - rawHead.length)
        buf += chunk
        let m
        while ((m = buf.match(/\r?\n\r?\n/))) { handle(buf.slice(0, m.index)); buf = buf.slice(m.index + m[0].length) }
      }
      buf += dec.decode()
      if (buf.trim()) handle(buf)
    } catch (e) {
      // Stream interrupted (idle timeout, reset, client gone): keep a received answer.
      if (!out.answer.trim()) throw e
      out.errors.push(`Stream unterbrochen: ${e?.name === 'AbortError' ? 'Zeitüberschreitung/Abbruch' : String(e?.message || e)}`)
    }
    if (out.events === 0) throw new Error(`AI:ssociate: unerwartete Antwort (${contentType || 'ohne Content-Type'}): ${rawHead.trim().slice(0, 300) || '(leer)'}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
  if (!out.answer.trim()) throw new Error('AI:ssociate: ' + (out.errors[0] || 'leere Antwort'))
  return out
}

// ---------------------------------------------------------------------------
// RIS (Rechtsinformationssystem des Bundes) — OGD API v2.6, used for citation
// verification only.
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
    doc.longTitle = str(br.Titel || deepFind(br, 'Titel')).slice(0, 300)
    if (kons) doc.title = `${doc.section ? doc.section + ' ' : ''}${doc.abbr || doc.law}${doc.abbr && doc.law ? ` (${doc.law})` : ''}`.trim()
    else { doc.kind = 'gazette'; doc.title = doc.longTitle || doc.law || id }
  } else if (jud) {
    doc.kind = 'decision'
    const sub = jud.Justiz || jud.Vfgh || jud.Vwgh || jud.Bvwg || jud.Lvwg || jud.Dsk || jud[app] || {}
    doc.court = str(sub.Gericht || deepFind(jud, 'Gericht')) || app
    doc.gz = str(jud.Geschaeftszahl || deepFind(jud, 'Geschaeftszahl'))
    doc.date = str(jud.Entscheidungsdatum || deepFind(jud, 'Entscheidungsdatum'))
    doc.docType = str(jud.Dokumenttyp || deepFind(jud, 'Dokumenttyp'))
    doc.title = `${doc.court} ${doc.gz}${doc.date ? ' vom ' + doc.date : ''}${doc.docType ? ' · ' + doc.docType : ''}`.trim()
  } else {
    doc.title = str(deepFind(md, 'Kurztitel') || deepFind(md, 'Titel')) || id
  }
  return doc
}

async function risRequest(controller, params) {
  const url = new URL(`${RIS_BASE}/${controller}`)
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v))
  const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, RIS_TIMEOUT_MS)
  if (!r.ok) throw new Error(`RIS HTTP ${r.status}`)
  const j = await r.json()
  const res = j?.OgdSearchResult || j
  if (res?.Error) throw new Error('RIS: ' + str(res.Error.Message || JSON.stringify(res.Error)).slice(0, 200))
  const dr = res?.OgdDocumentResults || {}
  const hits = Number(str(dr.Hits)) || 0
  const docs = asArray(dr.OgdDocumentReference).map(normalizeRisDoc).filter(Boolean)
  return { hits, docs }
}

// RIS only accepts these page sizes (schema type PageSize): Ten, Twenty, Fifty, OneHundred.
const RIS_PAGE_SIZE = 'Ten'
const RIS_TIMEOUT_MS = Number(process.env.RIS_TIMEOUT_MS || 10_000)
const VERIFY_DEADLINE_MS = Number(process.env.VERIFY_DEADLINE_MS || 25_000)

// ---------------------------------------------------------------------------
// Citation verification (deterministic checks against RIS)
// ---------------------------------------------------------------------------
// EU and foreign law is not in RIS Bundesrecht (the EMRK is: it has Verfassungsrang and is consolidated there).
const FOREIGN_LAWS = new Set(['BGB', 'HGB', 'GG', 'VwGO', 'AO', 'InsO', 'DSGVO', 'GRC', 'AEUV', 'EUV', 'ZGB', 'OR'])
const NUM = '\\d{1,4}[a-z]{0,2}'
const NUM_LIST = `(?:\\s*(?:,|und|bis|–|-)\\s*${NUM})*`
const NORM_RE = new RegExp(
  `(§§?|Art\\.?|Artikel)\\s*(${NUM})${NUM_LIST}\\s*(?:ff?\\.?\\s*)?` +
  `(?:(?:Abs\\.?|Absatz)\\s*${NUM}${NUM_LIST}\\s*)?(?:(?:Z|Ziffer|Zif\\.?)\\s*${NUM}${NUM_LIST}\\s*)?` +
  `(?:lit\\.?\\s*[a-z]{1,2}\\s*)?(?:sublit\\.?\\s*[a-z]{1,2}\\s*)?` +
  `(?:(?:erster|zweiter|dritter|vierter|fünfter|letzter|vorletzter)\\s+Satz\\s*)?(?:(?:Satz|S\\.?)\\s*\\d+\\s*)?(?:ff?\\.?\\s*)?` +
  `([A-ZÄÖÜ][A-Za-zÄÖÜäöüß]{0,9}(?:-(?:VG|BG|G|K|L|JZG|KUVG|VO|DG|BetrG)\\b)?)(?![\\wäöüß-])`,
  'g',
)
const LAW_STOP = new Set(['Abs', 'Satz', 'Z', 'Art', 'Nr', 'Rz', 'Rn', 'RS', 'OGH', 'VwGH', 'VfGH', 'OLG', 'LG', 'BG', 'BVwG', 'LVwG', 'EuGH', 'EGMR', 'Und', 'Oder', 'Iv', 'Ivm', 'IVm', 'Ff', 'F', 'Bzw', 'Vgl', 'Siehe', 'Dazu', 'Der', 'Die', 'Das', 'Des', 'Dem', 'Den', 'Q', 'GmbH', 'AG', 'KG', 'OG', 'HG', 'BGBl', 'LGBl', 'ABl', 'Nov'])

function extractNormCitations(text) {
  const out = new Map()
  let m
  NORM_RE.lastIndex = 0
  while ((m = NORM_RE.exec(text)) && out.size < 40) {
    const kind = /^Art/.test(m[1]) ? 'Art' : '§'
    const num = m[2]
    const law = m[3].replace(/\s+/g, '')
    if (LAW_STOP.has(law) || law.length < 2 || !/[A-ZÄÖÜ].*[A-ZÄÖÜ]/.test(law)) continue
    const key = `${kind} ${num} ${law}`
    if (!out.has(key)) out.set(key, { kind, num, law, label: key })
  }
  return [...out.values()]
}

const GZ_PATTERNS = [
  { app: 'Justiz', re: /\b(\d{1,2})\s?(ObA|ObS|Ob|Os|Nc|Nd|Ns|Fsc|Fss|Bkd|Ds|Dg|Präs|R|Bs|Cga|Cgs|Cgb|Cg|Ra|Rs|Msch|Fam|Hv|U|St|HR|Kt|Okt)\s?(\d{1,4})\/(\d{2})([a-z])?(?![\d/])/g, fmt: (m) => `${m[1]}${m[2]}${m[3]}/${m[4]}${m[5] || ''}` },
  { app: 'Vwgh', re: /\b(Ra|Ro|Fr|Fe|Fra|Ko)\s?(\d{4})\/(\d{2})\/(\d{4})(?![\d/])/g, fmt: (m) => `${m[1]} ${m[2]}/${m[3]}/${m[4]}` },
  // Pre-2014 VwGH numbering (e.g. 2012/15/0123), only when VwGH is named nearby and
  // the number carries no letter prefix (those are matched above).
  { app: 'Vwgh', re: /VwGH[^\n]{0,40}?(?<![A-Za-z]\s?)\b(\d{4})\/(\d{2})\/(\d{4})(?![\d/])/g, fmt: (m) => `${m[1]}/${m[2]}/${m[3]}` },
  { app: 'Vfgh', re: /\b(G|B|E|V|SV|WI|KI|KR|KIV|A|UA)\s?(\d{1,4})\/(\d{4})(?:-\d+)?(?![\d/])/g, fmt: (m) => `${m[1]} ${m[2]}/${m[3]}` },
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

// RIS stores some abbreviations with a year (EStG 1988, GewO 1994, WEG 2002): compare by prefix,
// also against the Kurztitel, so a hit in a *different* statute is never reported as confirmed.
function lawMatches(doc, law) {
  const l = law.toLowerCase()
  const abbr = (doc.abbr || '').toLowerCase()
  const title = (doc.law || '').toLowerCase().replace(/[^a-zäöüß0-9]/g, '')
  return (abbr && (abbr === l || abbr.startsWith(l + ' ') || abbr.startsWith(l))) || (title && title === l.replace(/[^a-zäöüß0-9]/g, ''))
}

async function verifyNorm(n) {
  if (FOREIGN_LAWS.has(n.law)) return { ...n, status: 'skipped', note: 'EU-Recht/ausländisches Recht – nicht im RIS (Bundesrecht) enthalten, nicht geprüft.' }
  const attempts = n.kind === 'Art'
    ? [{ Titel: n.law, Artikel: n.num }, { Suchworte: n.law, Artikel: n.num }]
    : [{ Titel: n.law, Paragraf: n.num }, { Suchworte: n.law, Paragraf: n.num }]
  let lastErr = null
  let otherHit = null
  for (const extra of attempts) {
    try {
      const r = await risRequest('Bundesrecht', { Applikation: 'BrKons', DokumenteProSeite: RIS_PAGE_SIZE, Seitennummer: 1, ...extra })
      if (r.hits > 0 && r.docs.length) {
        const best = r.docs.find((d) => lawMatches(d, n.law))
        if (!best) { otherHit = otherHit || r.docs[0]; continue }
        const today = new Date().toISOString().slice(0, 10)
        const expired = best.inForceTo && best.inForceTo <= today
        return {
          ...n,
          status: expired ? 'expired' : 'ok',
          title: best.title, url: best.url, htmlUrl: best.htmlUrl, inForceFrom: best.inForceFrom, inForceTo: best.inForceTo, id: best.id,
          note: expired ? `Außer Kraft seit ${best.inForceTo}` : (best.inForceFrom ? `Geltende Fassung seit ${best.inForceFrom}` : 'Im RIS gefunden'),
        }
      }
    } catch (e) { lastErr = e; break } // transport/validation errors would repeat identically
  }
  if (lastErr) return { ...n, status: 'error', note: `RIS nicht erreichbar (${lastErr.message})` }
  if (otherHit) return { ...n, status: 'unsure', title: otherHit.title, url: otherHit.url, note: `Nur Treffer in einem anderen Gesetz (${otherHit.title}) – Zitat prüfen` }
  return { ...n, status: 'not_found', note: 'Im RIS (Bundesrecht konsolidiert) nicht gefunden – Landesrecht/EU-Recht oder Zitierfehler?' }
}

async function verifyDecision(d) {
  const variants = [d.gz, d.gz.replace(/\s+/g, ''), d.gz.replace(/(\d)([A-Za-z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2')]
  let lastErr = null
  for (const gz of [...new Set(variants)]) {
    try {
      const r = await risRequest('Judikatur', { Applikation: d.app, Geschaeftszahl: gz, DokumenteProSeite: RIS_PAGE_SIZE, Seitennummer: 1 })
      if (r.hits > 0 && r.docs.length) {
        const best = r.docs.find((x) => x.docType === 'Entscheidungstext') || r.docs[0]
        return { ...d, status: 'ok', title: best.title, url: best.url, htmlUrl: best.htmlUrl, date: best.date, court: best.court, id: best.id, hits: r.hits, note: `Im RIS gefunden (${r.hits} Dokument${r.hits === 1 ? '' : 'e'})` }
      }
    } catch (e) { lastErr = e; break }
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
  const count = (s) => all.filter((x) => x.status === s).length
  const skipped = count('skipped')
  return {
    norms: n, decisions: d,
    // "checked" excludes citations that were deliberately not verified (EU/foreign law).
    summary: { checked: all.length - skipped, ok: count('ok'), warn: count('expired'), unsure: count('unsure'), notFound: count('not_found'), error: count('error'), skipped },
  }
}

// ---------------------------------------------------------------------------
// Uploads: server-side text extraction
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
// Prompts
// ---------------------------------------------------------------------------
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['legal', 'document', 'general'] },
    legal_area: { type: 'string', enum: ['civil', 'criminal', 'tax', 'public', 'none'] },
    scope: { type: 'string', enum: ['', ...SCOPES] },
    question: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['mode', 'legal_area', 'scope', 'question', 'title'],
}
const PLAN_INSTRUCTIONS = `Du bist AI:ssociate, KI-Assistent für österreichische Rechtsanwältinnen und Rechtsanwälte. Analysiere die Anfrage (inkl. Gesprächsverlauf) und entscheide als JSON:
- mode: "legal" = Rechtsfrage, Rechtsauskunft, Recherche, Prüfung eines Sachverhalts (→ juristische Wissensdatenbank). "document" = hochgeladene Dateien analysieren/bearbeiten, Dateien (Word/Excel/PDF) erzeugen, Dokumente vergleichen, Entwürfe als Datei. "general" = ohne Rechtsrecherche lösbar: Umformulieren, Übersetzen, Zusammenfassen von eingefügtem Text, Small Talk, Rückfrage, Folgefrage, die allein aus dem Verlauf beantwortbar ist.
- legal_area: Rechtsgebiet der Wissensdatenbank. "civil" = Zivilrecht im weiten Sinn (ABGB, Schadenersatz, Vertrags-, Miet-, Familien-, Erb-, Arbeits-, Unternehmens-, Gesellschafts-, Insolvenz-, Zivilverfahrens-, Exekutionsrecht, Konsumentenschutz; OGH-Judikatur). "criminal" = Straf- und Strafverfahrensrecht. "tax" = Steuer- und Abgabenrecht (BAO, EStG, UStG, KStG, Finanzstrafrecht). "public" = öffentliches Recht (Verfassungs- und Verwaltungsrecht, Verwaltungsverfahren, Gewerbe-, Bau-, Raumordnungs-, Fremden-, Asyl-, Vergabe-, Datenschutzrecht, Landesrecht; VwGH/VfGH/BVwG). "none" nur bei mode general/document ohne Rechtsfrage.
- scope: nur bei "public": "Bund" oder ein Bundesland (Wien, Niederösterreich, Oberösterreich, Salzburg, Steiermark, Tirol, Vorarlberg, Kärnten, Burgenland), wenn Landesrecht einschlägig ist; sonst leer "".
- question: die Frage an die Wissensdatenbank – eigenständig, präzise, vollständig (relevanten Kontext und Fakten aus Anfrage und Verlauf einarbeiten, keine Verweise wie "siehe oben"), auf Deutsch. Bei mode document/general: kurze Beschreibung der Aufgabe.
- title: prägnanter Titel (max. 6 Wörter) für die Verlaufsliste.`

// The web-search wording depends on whether the hosted tool is actually offered.
const WEB_SOURCES = 'bevorzugt ris.bka.gv.at, eur-lex.europa.eu, curia.europa.eu, parlament.gv.at, jusline.at, offizielle Quellen'
const webClause = (web) => web
  ? `nutze die Websuche, höchstens ${MAX_WEB_SEARCHES} Suchen (${WEB_SOURCES})`
  : 'eine Websuche ist NICHT verfügbar – ergänze nur aus gesichertem Wissen und kennzeichne Unsicheres ausdrücklich als nicht verifiziert'

const reviewInstructions = (web) => `Du bist AI:ssociate (Modell Sol) und prüfst die Antwort der juristischen Wissensdatenbank (AI:ssociate, österreichisches Recht; sie recherchiert selbst agentisch in Normen und Judikatur). Du bekommst die Nutzerfrage und diese Antwort.

Prüfe: Ist die Frage damit vollständig, aktuell und belegt beantwortet?
- JA → erste Zeile exakt "VERDICT: AUSREICHEND". Danach entweder nichts oder höchstens 1–3 Sätze mit einem wichtigen Hinweis (z. B. Frist, Risiko, Praxis-Tipp). Keine Wiederholung der Antwort.
- NEIN (wesentliche Lücke, Unsicherheit, veraltete Rechtslage, fehlendes EU-/ausländisches Recht, aktuelle Entwicklung, Widerspruch) → ${webClause(web)}. Dann erste Zeile exakt "VERDICT: ERGAENZT", danach eine kompakte Ergänzung in Markdown: nur was fehlt oder zu korrigieren ist, mit Fundstellen (§, Gesetz; Gericht, Datum, Geschäftszahl)${web ? ' und Links' : ''}. Keine Wiederholung der Wissensdatenbank-Antwort.
Nie Normen, Entscheidungen oder Fundstellen erfinden. Sprache: wie die Nutzerfrage.`

const directInstructions = (web) => `Du bist AI:ssociate (Modell Sol), KI-Assistent für österreichische Rechtsanwältinnen und Rechtsanwälte. Die juristische Wissensdatenbank ist gerade nicht verfügbar. Beantworte die Rechtsfrage selbst: ${webClause(web)}. Antworte strukturiert in Markdown: **Kurzantwort**, **Rechtliche Grundlagen** (§, Gesetz; Gericht, Datum, Geschäftszahl), **Beurteilung**, **Ergebnis / Empfehlung**. ${web ? 'Belege mit Links. ' : ''}Nie Fundstellen erfinden; Unsicheres kennzeichnen.`

const GENERAL_INSTRUCTIONS = `Du bist AI:ssociate, KI-Assistent für österreichische Rechtsanwältinnen und Rechtsanwälte. Erledige die Aufgabe direkt, präzise und in der Sprache der Nutzerin (Markdown, keine Floskeln). Keine Rechtsrecherche nötig; falls doch eine Rechtsfrage enthalten ist, beantworte sie nach bestem Wissen und weise darauf hin, dass dafür keine Datenbankrecherche erfolgte.`

const docInstructions = (web) => `Du bist AI:ssociate (Modell Sol), KI-Assistent für österreichische Rechtsanwältinnen und Rechtsanwälte, und bearbeitest eine Dokumentaufgabe mit wenigen, gezielten Schritten.

WERKZEUGE
- read_document: hochgeladene Dateien lesen (in Teilen; lies so viel wie nötig, nicht mehr).
- ask_aissociate: EIN Aufruf an die juristische Wissensdatenbank (österreichisches Recht, agentisch, mit Normen und Judikatur) für die rechtliche Beurteilung. Formuliere die Frage vollständig und eigenständig, mit den relevanten Fakten/Klauseln aus dem Dokument. Nur einmal verfügbar – bündle alle Rechtsfragen.
${web ? `- web_search: nur falls die Wissensdatenbank nicht ausreicht (höchstens ${MAX_WEB_SEARCHES} Suchen).` : '- Eine Websuche ist NICHT verfügbar; Unsicheres ausdrücklich kennzeichnen.'}
- create_or_edit_file: erzeugt/bearbeitet Dateien (Word/Excel/PDF/HTML). Ein Aufruf je Deliverable. Die gesamte juristische Arbeit (welche Klausel, welcher Kommentar, welche Formulierung) machst DU vorher und gibst sie wörtlich in task mit. Niemals generische oder identische Kommentare für mehrere Absätze; jeder Kommentar nennt das konkrete Problem der konkreten Klausel.

ABLAUF: lesen → (eine) Rechtsfrage an die Wissensdatenbank → Deliverable erzeugen → kurze Antwort. Keine unnötigen Schritte, keine Wiederholungen, keine Nachkontrollen durch erneutes Lesen. Antworte am Ende in Markdown: was erstellt/geändert wurde, die wesentlichen inhaltlichen Punkte (konkret) und Prüfpunkte für die Anwältin. Fundstellen mit §/Gesetz bzw. Gericht/GZ. Nie Fundstellen erfinden.`

const FOLLOWUP_INSTRUCTIONS = 'Formuliere 3 kurze, konkrete Folgefragen oder nächste Schritte (je max. 12 Wörter), die eine Anwältin nach dieser Antwort sinnvoll stellen würde. Antworte als JSON {"followups": ["…","…","…"]}.'

// Task presets: real workflows with structured inputs.
const TASK_PRESETS = {
  research: ({ question, jurisdiction, depth }) => ({
    text: `Rechtsrecherche${jurisdiction ? ` (${jurisdiction})` : ''}${depth ? `, ${depth}` : ''}: ${question}`,
    extra: `AUFGABE: Rechtsrecherche. Rechtsordnung: ${jurisdiction || 'Österreich'}. Tiefe: ${depth || 'ausführlich'}.`,
    forceMode: 'legal',
  }),
  contract_review: ({ perspective, focus, output, notes }) => ({
    text: `Vertragsprüfung${perspective ? ` aus Sicht ${perspective}` : ''}${focus ? ` – Fokus: ${focus}` : ''} – Ergebnis: ${output || 'Kommentare im Word-Dokument'}${notes ? `\nHinweise: ${notes}` : ''}`,
    extra: `AUFGABE: Vertragsprüfung der hochgeladenen Datei(en). Perspektive: ${perspective || 'neutral'}. Fokus: ${focus || 'alle wesentlichen Risiken (Haftung, Gewährleistung, Kündigung/Laufzeit, Zahlung, Gerichtsstand/Rechtswahl, Datenschutz, Vertragsstrafen, unübliche/fehlende Klauseln)'}. Gewünschtes Ergebnis: ${output || 'Kommentare im Word-Dokument'}.
Vorgehen: Dokument lesen (read_document) → klauselweise prüfen; strittige Rechtsfragen gebündelt in EINEM ask_aissociate-Aufruf klären → für jede problematische Stelle eine konkrete, klausel-spezifische Anmerkung (Problem, Risiko, Verbesserungsvorschlag) → ${/word|kommentar/i.test(output || 'Kommentare') ? 'mit create_or_edit_file die Kommentare als echte Word-Kommentare (Autor AI:ssociate) an genau diesen Absätzen einfügen (Mapping Absatztext → Kommentartext wörtlich in task übergeben) und die kommentierte .docx zurückgeben' : /excel|tabelle/i.test(output) ? 'mit create_or_edit_file eine Excel-Risikotabelle (Klausel, Zitat, Risiko, Ampel, Empfehlung) erzeugen' : 'ein strukturiertes Prüfmemo verfassen'} → Antwort mit Ampel-Übersicht der wichtigsten Risiken.`,
    forceMode: 'document',
  }),
  compare: ({ notes }) => ({
    text: `Dokumentvergleich der hochgeladenen Versionen (Delta-Ansicht + Zusammenfassung)${notes ? `\nHinweise: ${notes}` : ''}`,
    extra: `AUFGABE: Vergleiche die zwei hochgeladenen Dokumentversionen. Lies beide (read_document). Erzeuge mit create_or_edit_file (1) delta.html mit rot/grün-Hervorhebung und (2) delta.docx (Zusätze grün, Streichungen rot durchgestrichen). Antworte mit einer juristisch bewerteten Zusammenfassung der wesentlichen Änderungen (was hat sich materiell geändert, Risiko für welche Seite).`,
    forceMode: 'document',
  }),
  draft: ({ doc_type, parties, facts, extra }) => ({
    text: `Entwurf: ${doc_type || 'Dokument'}${parties ? ` – Parteien: ${parties}` : ''}\nSachverhalt/Vorgaben: ${facts || '–'}${extra ? `\nWeitere Vorgaben: ${extra}` : ''}`,
    extra: `AUFGABE: Entwurf eines Dokuments vom Typ „${doc_type || 'Schriftstück'}“ nach österreichischem Recht. Parteien: ${parties || 'siehe Sachverhalt'}. Kläre Formerfordernisse, Zuständigkeit, Fristen und zwingende Inhalte in EINEM ask_aissociate-Aufruf. Dann den vollständigen Text ausformulieren (Struktur, Rubrum/Überschriften, Klauseln, Platzhalter in eckigen Klammern für fehlende Daten) und mit create_or_edit_file als .docx (sauber formatiert) ausgeben. In der Antwort: Aufbau, getroffene Annahmen, Prüfpunkte für die Anwältin.`,
    forceMode: 'document',
  }),
  summary: ({ style, question }) => ({
    text: `Zusammenfassung (${style || 'Memo'}) der hochgeladenen Datei(en)${question ? ` – Schwerpunkt: ${question}` : ''}`,
    extra: `AUFGABE: Fasse die hochgeladenen Dokumente zusammen. Stil: ${style || 'juristisches Memo (Sachverhalt, rechtliche Würdigung, Fazit)'}. ${question ? `Schwerpunkt: ${question}.` : ''} Zuerst lesen (read_document). Konkrete Fakten, Daten, Beträge, Fristen und Parteien wiedergeben; keine Floskeln. ask_aissociate nur, wenn eine rechtliche Würdigung verlangt ist.`,
    forceMode: 'document',
  }),
  deadlines: ({ reference_date }) => ({
    text: `Fristen erkennen in den hochgeladenen Dokumenten${reference_date ? ` (Stichtag ${reference_date})` : ''}`,
    extra: `AUFGABE: Erkenne alle Fristen und fristauslösenden Ereignisse in den hochgeladenen Dokumenten (read_document). Für jede Frist: Bezug/Zitat, Auslöser, Dauer, berechnetes Fristende (Stichtag: ${reference_date || 'Datum im Dokument bzw. heute'}; Fristenregeln nach österreichischem Recht nennen – bei Unsicherheit die Regeln in EINEM ask_aissociate-Aufruf klären), Rechtsfolge bei Versäumung, Priorität. Erzeuge mit create_or_edit_file eine Excel-Tabelle fristen.xlsx und gib in der Antwort eine Tabelle mit den dringendsten Fristen zuerst.`,
    forceMode: 'document',
  }),
}

// Tools for document mode (Responses API flat function tools).
// strict: false — the schemas have optional parameters (strict mode would require
// additionalProperties:false and every key in `required`).
const TOOL_READ_DOCUMENT = {
  type: 'function', name: 'read_document', strict: false,
  description: 'Liest den Text einer hochgeladenen Datei (Teil für Teil, je ca. 24.000 Zeichen).',
  parameters: { type: 'object', properties: { name: { type: 'string', description: 'Dateiname exakt wie hochgeladen.' }, part: { type: 'integer', description: 'Teil-Nummer ab 1 (Standard 1).' } }, required: ['name'] },
}
const TOOL_ASK_AISSOCIATE = {
  type: 'function', name: 'ask_aissociate', strict: false,
  description: 'Stellt EINE vollständige Rechtsfrage an die juristische Wissensdatenbank AI:ssociate (österreichisches Recht, recherchiert selbst agentisch in Normen und Judikatur). Nur ein Aufruf pro Aufgabe – alle Rechtsfragen bündeln und die relevanten Fakten mitgeben.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Eigenständige, vollständige Rechtsfrage mit Sachverhalt (deutsch).' },
      legal_area: { type: 'string', enum: ['civil', 'criminal', 'tax', 'public'], description: 'civil = Zivil-/Unternehmens-/Arbeits-/Mietrecht; criminal = Strafrecht; tax = Steuerrecht; public = öffentliches Recht/Verwaltungsrecht/Landesrecht.' },
      scope: { type: 'string', description: 'Nur public: Bund oder Bundesland (Wien, Tirol, …).' },
    },
    required: ['question', 'legal_area'],
  },
}
const TOOL_FILE = {
  type: 'function', name: 'create_or_edit_file', strict: false,
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
      if (rows.length) children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map((r, ri) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph({ children: ri === 0 ? [new TextRun({ text: c.replace(/\*\*/g, ''), bold: true })] : inline(c) })] })) })) }))
      continue
    }
    const li = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/)
    if (li) { children.push(new Paragraph({ children: inline(li[2]), bullet: /\d/.test(li[1]) ? undefined : { level: 0 } })); i++; continue }
    if (/^\s*>\s?/.test(line)) { children.push(new Paragraph({ children: inline(line.replace(/^\s*>\s?/, '')), indent: { left: 720 } })); i++; continue }
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
  res.json({ ok: true, openai: Boolean(OPENAI_API_KEY), e2b: Boolean(E2B_API_KEY), aissociate: Boolean(AISSOCIATE_API_KEY), models: { main: MODEL_MAIN, fast: MODEL_FAST, code: MODEL_CODE }, knowledgeBase: 'AI:ssociate API', webSearch: WEB_SEARCH_ENABLED, maxWebSearches: MAX_WEB_SEARCHES, budget: { inMax: MAX_INPUT_TOKENS, outMax: MAX_OUTPUT_TOKENS } })
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

app.post('/api/verify', async (req, res) => {
  try { res.json(await verifyAnswer(String(req.body?.text || '').slice(0, 100_000))) } catch (e) { res.status(500).json({ error: e?.message }) }
})

// ---------------------------------------------------------------------------
// Jobs: every chat request runs as a server-side job whose events are kept in
// memory, so a dropped connection (mobile Safari "Load failed", proxy timeouts,
// app switched to background) can be resumed with GET /api/chat/stream/:id?after=seq.
// ---------------------------------------------------------------------------
const jobs = new Map() // id -> { seq, events: [{seq,line}], done, listeners:Set<res>, createdAt }
const JOB_TTL_MS = Number(process.env.JOB_TTL_MS || 30 * 60 * 1000)
const HEARTBEAT_MS = 10_000
setInterval(() => { const now = Date.now(); for (const [id, j] of jobs) if (now - j.createdAt > JOB_TTL_MS) jobs.delete(id) }, 60_000).unref?.()

function sseStart(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  res.write(':' + ' '.repeat(2048) + '\n\n') // initial padding: defeats proxy buffering, client connects immediately
}
function attachListener(job, res, after) {
  sseStart(res)
  for (const e of job.events) if (e.seq > after) { try { res.write(e.line) } catch {} }
  if (job.done) { res.end(); return }
  job.listeners.add(res)
  // Padded heartbeats: a bare ": ping" can sit in an intermediate proxy buffer.
  const hb = setInterval(() => { try { res.write(':' + ' '.repeat(512) + '\n\n') } catch {} }, HEARTBEAT_MS)
  hb.unref?.()
  res.on('close', () => { job.listeners.delete(res); clearInterval(hb) })
}
function newJob(id) {
  const job = { id, seq: 0, events: [], done: false, listeners: new Set(), createdAt: Date.now() }
  jobs.set(id, job)
  job.send = (event, data) => {
    const seq = ++job.seq
    const line = `data: ${JSON.stringify({ event, seq, ...data })}\n\n`
    job.events.push({ seq, line })
    for (const l of job.listeners) { try { l.write(line) } catch {} }
  }
  job.finish = () => {
    job.done = true
    for (const l of job.listeners) { try { l.end() } catch {} }
    job.listeners.clear()
  }
  return job
}

app.get('/api/chat/stream/:id', (req, res) => {
  const job = jobs.get(String(req.params.id || ''))
  if (!job) return res.status(404).json({ error: 'Auftrag unbekannt oder abgelaufen.' })
  attachListener(job, res, Number(req.query.after) || 0)
})

app.post('/api/chat', async (req, res) => {
  const body = req.body ?? {}
  // The client may supply the job id so it can resume even if this response never arrives.
  const jobId = typeof body.jobId === 'string' && /^[\w-]{8,64}$/.test(body.jobId) && !jobs.has(body.jobId) ? body.jobId : `j_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  const job = newJob(jobId)
  const send = job.send
  attachListener(job, res, 0)
  send('job', { id: jobId })
  const finish = () => job.finish()

  if (!OPENAI_API_KEY) { send('error', { message: 'Server: OPENAI_API_KEY fehlt.' }); return finish() }

  const { history = [], files: rawUploads = [], sessionId, privacy = 'off', webSearch = true, task = null, aissThreadId = null } = body
  let prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  let taskExtra = ''
  let forceMode = null
  if (task && typeof task === 'object' && TASK_PRESETS[task.type]) {
    const t = TASK_PRESETS[task.type](task.params || {})
    prompt = prompt || t.text
    taskExtra = t.extra
    forceMode = t.forceMode
  }
  if (!prompt) { send('error', { message: 'Bitte eine Frage oder Aufgabe eingeben.' }); return finish() }

  const persistent = typeof sessionId === 'string' && sessionId.length > 0
  const privacyMode = privacy === 'pseudonymize' || privacy === 'anonymize' ? privacy : 'off'
  const useWeb = WEB_SEARCH_ENABLED && webSearch !== false
  const threadIn = typeof aissThreadId === 'string' && aissThreadId.length < 200 ? aissThreadId : null

  // --- uploads: validate + extract text server-side ---
  const uploads = []
  for (const u of Array.isArray(rawUploads) ? rawUploads : []) {
    if (!u || typeof u.name !== 'string' || typeof u.base64 !== 'string') continue
    const name = path.basename(u.name).replace(/[^\w.\- ()äöüÄÖÜß]/g, '_')
    const buf = Buffer.from(u.base64, 'base64')
    if (!name || buf.length === 0) continue
    if (buf.length > MAX_UPLOAD_BYTES) { send('error', { message: `Datei „${name}“ überschreitet ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }); return finish() }
    uploads.push({ name, buf })
    if (uploads.length >= MAX_UPLOADS) break
  }

  const ctx = { usage: newUsage() }
  const startedAt = Date.now()
  let stepSeq = 0
  const step = (kind, title, extra = {}) => { const id = ++stepSeq; send('step', { id, kind, title, status: 'running', ...extra }); return id }
  const stepDone = (id, extra = {}) => send('step_update', { id, status: 'done', ...extra })
  const stepFail = (id, extra = {}) => send('step_update', { id, status: 'error', ...extra })

  // Evidence registry: knowledge-base documents and web citations get [Qn] markers.
  const evidence = []
  const byKey = new Map()
  const addEvidence = (e) => {
    const key = (e.url || e.title || '').toLowerCase()
    if (key && byKey.has(key)) return byKey.get(key)
    const item = { ...e, marker: `Q${evidence.length + 1}` }
    evidence.push(item)
    if (key) byKey.set(key, item)
    return item
  }
  const collectWebCitations = (resp) => {
    for (const o of resp.output || []) {
      if (o.type !== 'message') continue
      for (const part of o.content || []) for (const ann of part.annotations || []) {
        if (ann.type === 'url_citation' && ann.url) addEvidence({ type: 'web', url: ann.url, title: ann.title || ann.url, read: false })
      }
    }
  }
  const emitWebSteps = (resp) => {
    for (const w of (resp.output || []).filter((o) => o.type === 'web_search_call')) { const q = w.action?.query || w.query || ''; const wid = step('web', `Websuche${q ? ': ' + q : ''}`); stepDone(wid) }
  }

  let sandbox = null, sandboxReady = false, sandboxStart = null
  const before = new Map()
  const images = []
  const filesOut = []
  const uploadTexts = new Map()
  let aissThreadOut = threadIn
  let aissCalls = 0 // attempts (enforces the one-call limit)
  let aissOk = false // at least one successful knowledge-base answer
  // The job keeps running when the browser drops the connection (it can resume),
  // so there is nothing to abort here.
  const assertAlive = () => {}

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

  /** Knowledge-base call with step display, streaming deltas and evidence registration. */
  async function runAissociate({ question, legalArea, scope, stream }) {
    aissCalls++
    const label = LEGAL_AREA_LABEL[legalArea] || 'allgemein'
    const sid = step('aissociate', `AI:ssociate recherchiert (${label}${scope ? ', ' + scope : ''})`, { model: 'aissociate' })
    const t0 = Date.now()
    // Real progress events while the knowledge base works (can take minutes).
    const ticker = setInterval(() => send('step_update', { id: sid, status: 'running', detail: `recherchiert seit ${Math.round((Date.now() - t0) / 1000)} s…` }), 15_000)
    ticker.unref?.()
    const attempt = (tid) => { ctx.usage.aissociateCalls++; return askAissociate({ question, legalArea, scope, threadId: tid, onDelta: stream ? (t) => send('delta', { text: t }) : null }) }
    try {
      let r
      try {
        r = await attempt(aissThreadOut)
      } catch (e) {
        // A stale/invalid thread must not break the knowledge base for the rest
        // of the conversation: retry once without the thread, then drop it.
        if (!aissThreadOut) throw e
        console.error('aissociate (thread) failed, retrying without thread:', e?.message)
        send('step_update', { id: sid, status: 'running', detail: 'Gesprächsfaden ungültig – neuer Versuch ohne Verlauf…' })
        aissThreadOut = null
        r = await attempt(null)
      }
      aissThreadOut = r.threadId || null
      aissOk = true
      const srcs = r.sources.map((s) => addEvidence({ type: 'aissociate', url: s.url, title: s.title, raw: s.raw, read: true }))
      stepDone(sid, { detail: `Antwort erhalten${srcs.length ? ` · ${srcs.length} Dokument${srcs.length > 1 ? 'e' : ''}` : ''}${r.errors.length ? ' · Hinweis: ' + r.errors[0].slice(0, 80) : ''}` })
      return { ...r, evidence: srcs }
    } catch (e) {
      stepFail(sid, { detail: String(e?.message || e).slice(0, 200) })
      throw e
    } finally { clearInterval(ticker) }
  }

  // ---- document-mode tool implementations ----
  async function toolReadDocument(args) {
    const name = String(args.name || '')
    const t = uploadTexts.get(name) || [...uploadTexts.entries()].find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]
    if (!t) return { text: `Datei „${name}“ nicht gefunden. Vorhanden: ${[...uploadTexts.keys()].join(', ') || '(keine)'}`, detail: 'nicht gefunden' }
    if (t.unsupported) return { text: `Dateityp von „${name}“ kann nicht direkt gelesen werden (z. B. .xlsx/.pptx). Nutze create_or_edit_file, um den Inhalt per Python zu extrahieren.`, detail: 'Typ nicht lesbar' }
    if (!t.text.trim()) return { text: `„${name}“ enthält keinen extrahierbaren Text (gescannt?). Falls nötig: create_or_edit_file mit OCR (pytesseract/ocrmypdf) versuchen.`, detail: 'kein Text' }
    const parts = Math.max(1, Math.ceil(t.text.length / UPLOAD_PART_CHARS))
    const part = Math.min(parts, Math.max(1, Number(args.part) || 1))
    const chunk = t.text.slice((part - 1) * UPLOAD_PART_CHARS, part * UPLOAD_PART_CHARS)
    return { text: `${name} – Teil ${part}/${parts}${t.pages ? ` (${t.pages} Seiten)` : ''}\n\n${chunk}`, detail: `Teil ${part}/${parts}` }
  }
  async function toolAskAissociate(args) {
    if (aissCalls >= 1) return { text: `Limit erreicht: Die Wissensdatenbank wurde in dieser Aufgabe bereits befragt. Arbeite mit der vorliegenden Antwort weiter${useWeb ? ` (ggf. web_search, insgesamt höchstens ${MAX_WEB_SEARCHES} Suchen)` : ''}.`, detail: 'Limit (1 Aufruf)' }
    const r = await runAissociate({ question: String(args.question || ''), legalArea: LEGAL_AREAS[args.legal_area] ? args.legal_area : 'civil', scope: args.scope && SCOPES.includes(args.scope) ? args.scope : '', stream: false })
    const srcLines = r.evidence.map((e) => `[${e.marker}] ${e.title}${e.url ? ' · ' + e.url : ''}`).join('\n')
    return { text: `ANTWORT DER WISSENSDATENBANK:\n${r.answer}\n${srcLines ? `\nQUELLEN:\n${srcLines}` : ''}`, detail: 'Antwort erhalten', skipStep: true }
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
    read_document: (a) => `Dokument lesen: ${a.name}${a.part > 1 ? ` (Teil ${a.part})` : ''}`,
    create_or_edit_file: (a) => `Datei erstellen/bearbeiten: ${(a.output_files || []).join(', ') || 'Ergebnisdatei'}`,
  }
  const STEP_KIND = { read_document: 'upload', create_or_edit_file: 'file' }

  async function runToolCall(call) {
    let args = {}
    try { args = JSON.parse(call.arguments || '{}') } catch {}
    const name = call.name
    if (name === 'ask_aissociate') {
      try { return (await toolAskAissociate(args)).text } catch (e) { return `FEHLER: Wissensdatenbank nicht erreichbar (${String(e?.message || e).slice(0, 300)}). Beantworte die Rechtsfrage mit web_search (höchstens ${MAX_WEB_SEARCHES} Suchen) oder nach bestem Wissen – kennzeichne das.` }
    }
    const sid = step(STEP_KIND[name] || 'tool', STEP_TITLES[name] ? STEP_TITLES[name](args) : name)
    try {
      let r
      if (name === 'read_document') r = await toolReadDocument(args)
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

  /** Document-mode agent loop: few steps, one knowledge-base call, ≤3 web searches. */
  async function documentLoop({ input }) {
    let prevId
    let text = ''
    const baseTools = [TOOL_FILE, TOOL_ASK_AISSOCIATE, ...(uploads.length ? [TOOL_READ_DOCUMENT] : [])]
    for (let i = 1; i <= DOC_MAX_STEPS; i++) {
      // max_tool_calls caps built-in tool calls per response, so hand the model
      // only the web budget that is still left over the whole task.
      const remainingWeb = useWeb ? Math.max(0, MAX_WEB_SEARCHES - ctx.usage.webSearchCalls) : 0
      const tools = remainingWeb > 0 ? [...baseTools, WEB_SEARCH_TOOL] : baseTools
      const sid = step('think', i === 1 ? 'Sol plant die Bearbeitung' : 'Sol wertet Ergebnisse aus', { model: MODEL_MAIN })
      let resp
      try { resp = await callModel(ctx, { model: MODEL_MAIN, instructions: docInstructions(useWeb), input, tools, effort: EFFORT_MAIN, prevId, maxToolCalls: remainingWeb > 0 ? remainingWeb : undefined }) } catch (e) { stepFail(sid, { detail: String(e?.message || e).slice(0, 160) }); throw e }
      prevId = resp.id
      input = [] // everything sent so far is now part of the chain (previous_response_id)
      collectWebCitations(resp)
      emitWebSteps(resp)
      const calls = (resp.output || []).filter((o) => o.type === 'function_call')
      stepDone(sid, { detail: calls.length ? `${calls.length} Werkzeug${calls.length > 1 ? 'e' : ''} angefordert` : 'Antwort formuliert' })
      if (!calls.length) { text = resp.output_text || ''; break }
      for (const c of calls) input.push({ type: 'function_call_output', call_id: c.call_id, output: await runToolCall(c) })
    }
    if (!text && prevId) {
      // Only unsent tool outputs (if any) plus the wrap-up request go into the chain.
      const sid = step('think', 'Sol fasst zusammen (Schrittlimit)', { model: MODEL_MAIN })
      const resp = await callModel(ctx, { model: MODEL_MAIN, instructions: docInstructions(useWeb), input: [...input, { role: 'user', content: 'Schrittlimit erreicht. Antworte JETZT abschließend; kennzeichne offene Punkte.' }], effort: EFFORT_MAIN, prevId })
      collectWebCitations(resp)
      text = resp.output_text || ''
      stepDone(sid)
    }
    return text
  }

  try {
    // ---- 0. uploads: extract text ----
    if (uploads.length) {
      const sid = step('read', `${uploads.length} Datei${uploads.length > 1 ? 'en' : ''} wird vorbereitet`)
      for (const u of uploads) uploadTexts.set(u.name, await extractText(u.name, u.buf))
      stepDone(sid, { detail: uploads.map((u) => `${u.name} (${(uploadTexts.get(u.name).text.length / 1000).toFixed(0)}k Zeichen)`).join(', ') })
    }

    const histInput = (Array.isArray(history) ? history : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 12_000) }))

    const privacyLine =
      privacyMode === 'pseudonymize'
        ? 'DATENSCHUTZ (DSGVO) – PSEUDONYMISIERUNG AKTIV: Ersetze personenbezogene Daten (Namen natürlicher Personen, Adressen, E-Mail, Telefon, IBAN, Akten-/SV-/Steuernummern, Geburtsdaten) in Fragen an die Wissensdatenbank, in deiner Antwort und in erzeugten Dateien konsequent durch typisierte Platzhalter ([PERSON_1], [ADRESSE_1] …). Bei Dateiausgaben zusätzlich eine Zuordnungstabelle mapping.xlsx erzeugen. Weise darauf hin, dass pseudonymisierte Daten weiterhin personenbezogen sind.\n\n'
        : privacyMode === 'anonymize'
        ? 'DATENSCHUTZ (DSGVO) – ANONYMISIERUNG AKTIV: Entferne personenbezogene Daten irreversibel ([geschwärzt]) in Fragen an die Wissensdatenbank, in der Antwort und in erzeugten Dateien; keine Zuordnungstabelle.\n\n'
        : ''
    const uploadLine = uploads.length
      ? `HOCHGELADENE DATEIEN (mit read_document lesen; für Dateiausgaben liegen sie in /home/user): ${uploads.map((u) => { const t = uploadTexts.get(u.name); return `${u.name} (${t.unsupported ? 'Typ nur per create_or_edit_file lesbar' : `${t.text.length} Zeichen Text, ${Math.max(1, Math.ceil(t.text.length / UPLOAD_PART_CHARS))} Teil(e)`})` }).join('; ')}\n\n`
      : ''
    const userContent = privacyLine + (taskExtra ? taskExtra + '\n\n' : '') + uploadLine + prompt

    // ---- 1. plan (Sol decides mode + legal area) ----
    const pid = step('triage', 'Sol analysiert die Anfrage', { model: MODEL_MAIN })
    let plan = { mode: 'legal', legal_area: 'civil', scope: '', question: prompt, title: prompt.slice(0, 60) }
    try {
      const planInput = [...histInput.slice(-6), { role: 'user', content: `${uploads.length ? `Hochgeladene Dateien: ${uploads.map((u) => u.name).join(', ')}\n` : ''}${task?.type ? `Workflow: ${task.type}\n` : ''}${privacyMode !== 'off' ? 'Datenschutz: personenbezogene Daten in "question" pseudonymisieren.\n' : ''}ANFRAGE:\n${prompt.slice(0, 8000)}` }]
      const planFormat = { format: { type: 'json_schema', name: 'plan', schema: PLAN_SCHEMA, strict: true } }
      // max_output_tokens includes reasoning tokens: retry once with more room if truncated.
      let pr = await callModel(ctx, { model: MODEL_MAIN, instructions: PLAN_INSTRUCTIONS, effort: EFFORT_PLAN, maxOut: 6000, input: planInput, text: planFormat })
      let parsed = parseJsonLoose(pr.output_text || '')
      if (!parsed?.mode && pr.status === 'incomplete') {
        pr = await callModel(ctx, { model: MODEL_MAIN, instructions: PLAN_INSTRUCTIONS, effort: EFFORT_PLAN, maxOut: 16_000, input: planInput, text: planFormat })
        parsed = parseJsonLoose(pr.output_text || '')
      }
      if (parsed?.mode) plan = { ...plan, ...parsed }
      else console.error('plan: no usable JSON, using defaults')
    } catch (e) { console.error('plan failed:', e?.message) }
    if (uploads.length) plan.mode = 'document'
    // A preset decides the mode, except that attached documents must not be ignored.
    if (forceMode && !(uploads.length && forceMode === 'legal')) plan.mode = forceMode
    if (!LEGAL_AREAS[plan.legal_area]) plan.legal_area = plan.mode === 'legal' ? 'civil' : 'none'
    if (!SCOPES.includes(plan.scope)) plan.scope = ''
    if (!plan.question?.trim()) plan.question = prompt
    const areaLabel = LEGAL_AREA_LABEL[plan.legal_area] || 'allgemein'
    stepDone(pid, { detail: plan.mode === 'legal' ? `Rechtsfrage · ${areaLabel}${plan.scope ? ' (' + plan.scope + ')' : ''}` : plan.mode === 'document' ? 'Dokumentaufgabe' : 'Allgemeine Aufgabe' })
    send('route', { route: plan.mode, legalArea: plan.legal_area, legalAreaLabel: areaLabel, scope: plan.scope, title: plan.title, models: { main: MODEL_MAIN, code: MODEL_CODE, knowledgeBase: plan.mode === 'general' ? null : 'AI:ssociate' } })
    assertAlive()

    // ---- 2. answer ----
    let answer = ''
    let verdict = null
    try {
      if (plan.mode === 'legal') {
        let kb = null
        try {
          kb = await runAissociate({ question: plan.question, legalArea: plan.legal_area, scope: plan.scope, stream: true })
        } catch (e) { console.error('aissociate failed:', e?.message) }
        if (kb && kb.answer.trim()) {
          // The knowledge-base answer is the deliverable; the review only adds to it,
          // so a failing review (API error, budget) must never discard it.
          answer = kb.answer.trim()
          assertAlive()
          const sid = step('think', 'Sol prüft die Antwort', { model: MODEL_MAIN })
          try {
            const resp = await callModel(ctx, {
              model: MODEL_MAIN, instructions: reviewInstructions(useWeb), effort: EFFORT_MAIN, maxOut: 8000,
              input: [...histInput, { role: 'user', content: `${privacyLine}NUTZERFRAGE:\n${prompt}\n\nFRAGE AN DIE WISSENSDATENBANK (${areaLabel}):\n${plan.question}\n\nANTWORT DER WISSENSDATENBANK:\n${kb.answer}${kb.evidence.length ? `\n\nDOKUMENTE DER WISSENSDATENBANK:\n${kb.evidence.map((e) => `[${e.marker}] ${e.title}${e.url ? ' · ' + e.url : ''}`).join('\n')}` : ''}` }],
              tools: useWeb ? [WEB_SEARCH_TOOL] : undefined, maxToolCalls: useWeb ? MAX_WEB_SEARCHES : undefined,
            })
            collectWebCitations(resp)
            emitWebSteps(resp)
            const txt = (resp.output_text || '').trim()
            // Tolerate Markdown decoration around the verdict line (**VERDICT: …**, # VERDICT: …).
            const vm = txt.match(/^[\s*#_>`]*VERDICT:?\s*[*_`]*\s*(AUSREICHEND|ERG(?:AE|Ä)NZT)[\s*_`:.-]*/i)
            // Without a usable verdict line, let the evidence decide: a web search means "ergänzt".
            verdict = vm ? (/AUSREICHEND/i.test(vm[1]) ? 'sufficient' : 'supplemented') : (ctx.usage.webSearchCalls > 0 && txt ? 'supplemented' : 'sufficient')
            const supplement = (vm ? txt.slice(vm[0].length) : txt).trim()
            const webN = ctx.usage.webSearchCalls
            stepDone(sid, { detail: verdict === 'sufficient' ? 'ausreichend' : `ergänzt${webN ? ` (${webN} Websuche${webN > 1 ? 'n' : ''})` : ''}${resp.status === 'incomplete' ? ' · abgeschnitten' : ''}` })
            if (supplement.length > 15) answer += verdict === 'sufficient' ? `\n\n**Hinweis (Sol)**\n\n${supplement}` : `\n\n---\n\n**Ergänzung (Sol, Websuche)**\n\n${supplement}`
          } catch (e) {
            console.error('review failed:', e?.message)
            verdict = 'unreviewed'
            stepFail(sid, { detail: `Prüfung übersprungen: ${String(e?.message || e).slice(0, 140)}` })
            answer += '\n\n> Hinweis: Die Nachprüfung durch Sol konnte nicht durchgeführt werden; dies ist die ungeprüfte Antwort der Wissensdatenbank.'
          }
        } else {
          // Knowledge base unavailable → Sol answers directly with ≤3 web searches.
          assertAlive()
          const sid = step('think', 'Sol beantwortet die Frage (Wissensdatenbank nicht verfügbar)', { model: MODEL_MAIN })
          const resp = await callModel(ctx, { model: MODEL_MAIN, instructions: directInstructions(useWeb), effort: EFFORT_MAIN, input: [...histInput, { role: 'user', content: userContent }], tools: useWeb ? [WEB_SEARCH_TOOL] : undefined, maxToolCalls: useWeb ? MAX_WEB_SEARCHES : undefined })
          collectWebCitations(resp)
          emitWebSteps(resp)
          stepDone(sid, { detail: ctx.usage.webSearchCalls ? `${ctx.usage.webSearchCalls} Websuche${ctx.usage.webSearchCalls > 1 ? 'n' : ''}` : 'ohne Websuche' })
          verdict = 'fallback'
          answer = (resp.output_text || '').trim()
          answer = `> Hinweis: Die juristische Wissensdatenbank (AI:ssociate) war nicht erreichbar; diese Antwort stammt vom Sprachmodell mit Websuche.\n\n${answer}`
        }
      } else if (plan.mode === 'document') {
        answer = await documentLoop({ input: [...histInput, { role: 'user', content: userContent }] })
      } else {
        const sid = step('think', 'Sol antwortet', { model: MODEL_MAIN })
        const resp = await callModel(ctx, { model: MODEL_MAIN, instructions: GENERAL_INSTRUCTIONS, effort: EFFORT_PLAN, input: [...histInput, { role: 'user', content: userContent }] })
        answer = (resp.output_text || '').trim()
        stepDone(sid)
      }
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) throw e
      answer = answer || `**Token-Budget erreicht** (max. ${(MAX_INPUT_TOKENS / 1e6).toFixed(0)} Mio. Eingabe- / ${(MAX_OUTPUT_TOKENS / 1e3).toFixed(0)}k Ausgabe-Tokens pro Frage). Bitte die Frage enger fassen oder in Teilfragen aufteilen.`
    }
    if (!answer.trim()) answer = 'Es konnte keine Antwort erzeugt werden. Bitte die Frage präzisieren.'

    // ---- 3. verification (deterministic, against RIS, bounded by a deadline) ----
    let verification = null
    if (plan.mode !== 'general') {
      assertAlive()
      const vid = step('verify', 'Zitate werden gegen das RIS geprüft')
      try {
        verification = await Promise.race([verifyAnswer(answer), new Promise((r) => setTimeout(() => r(null), VERIFY_DEADLINE_MS).unref?.())])
        if (!verification) { stepFail(vid, { detail: 'RIS-Prüfung übersprungen (Zeitüberschreitung) – „Erneut prüfen“ in der Antwort nutzen' }) }
        else {
          const s = verification.summary
          stepDone(vid, { detail: s.checked ? `${s.ok} von ${s.checked} Fundstellen bestätigt${s.warn ? `, ${s.warn} außer Kraft` : ''}${s.unsure ? `, ${s.unsure} unklar` : ''}${s.notFound ? `, ${s.notFound} nicht gefunden` : ''}${s.error ? `, ${s.error} nicht prüfbar` : ''}${s.skipped ? ` · ${s.skipped} EU-/ausländisches Recht nicht geprüft` : ''}` : s.skipped ? `keine prüfbaren österreichischen Normzitate (${s.skipped} EU-/ausländisches Recht)` : 'keine Normzitate erkannt' })
        }
      } catch (e) { stepFail(vid, { detail: e.message }) }
    }

    // ---- 4. follow-ups (Luna, tiny) ----
    let followups = []
    assertAlive()
    try {
      const fr = await callModel(ctx, { model: MODEL_FAST, instructions: FOLLOWUP_INSTRUCTIONS, effort: 'low', maxOut: 2000, input: [{ role: 'user', content: `FRAGE: ${prompt.slice(0, 2000)}\n\nANTWORT (Auszug): ${answer.slice(0, 6000)}` }], text: { format: { type: 'json_schema', name: 'followups', schema: { type: 'object', additionalProperties: false, properties: { followups: { type: 'array', items: { type: 'string' } } }, required: ['followups'] }, strict: true } } })
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
    // Knowledge-base documents are always shown; web citations are shown directly when the web search contributed.
    const sources = evidence.map((e) => ({ marker: e.marker, type: e.type, title: e.title, url: e.url, read: Boolean(e.read), cited: cited.has(e.marker) || e.type === 'aissociate' || (e.type === 'web' && verdict !== 'sufficient'), raw: e.raw || null }))

    send('final', {
      answer, sources, verification, followups, title: plan.title, route: plan.mode, legalArea: plan.legal_area, legalAreaLabel: areaLabel, scope: plan.scope, verdict,
      models: { main: MODEL_MAIN, code: MODEL_CODE, knowledgeBase: aissOk ? 'AI:ssociate' : null },
      aissThreadId: aissThreadOut,
      execution: { images, files: filesOut },
      cost: computeCost(ctx.usage, sandboxStart ? (Date.now() - sandboxStart) / 1000 : 0),
      durationMs: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('chat error:', err)
    send('error', { message: err?.message ?? 'Unbekannter Fehler.', cost: computeCost(ctx.usage, sandboxStart ? (Date.now() - sandboxStart) / 1000 : 0) })
  } finally {
    if (!persistent && sandbox) { try { await sandbox.kill() } catch {} }
    finish()
  }
})

if (process.env.NO_LISTEN !== '1') {
  app.listen(PORT, () => {
    console.log(`AI:ssociate Playground listening on http://localhost:${PORT} (main=${MODEL_MAIN}, code=${MODEL_CODE}, kb=${AISSOCIATE_BASE_URL})`)
  })
}

// Exported for tests (NO_LISTEN=1).
export { extractNormCitations, extractDecisionCitations, normalizeRisDoc, htmlToText, markdownToDocx, askAissociate, parseSseBlock, sourceFromDocumentEvent, risLinkForDocNumber, app }
