import express from 'express'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { Sandbox } from '@e2b/code-interpreter'
import mammoth from 'mammoth'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ExternalHyperlink } from 'docx'
import { JsonStore } from './lib/store.js'
import { newMatter, newDocument, newFinding, nextNo, locateQuote, estimateRun, runDd, runReviewTable, buildReports, tableXlsx, matterContext } from './lib/dd.js'
import { DD_AREAS, DD_AREA_KEYS, REVIEW_TABLE_PRESETS, SEVERITY_LABEL, DEAL_IMPACTS, DEAL_IMPACT_LABEL, REVIEW_STATUS, REVIEW_LABEL } from './lib/ddconfig.js'

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
// the final answer and runs document tasks. The code model writes the Python
// for file generation.
const MODEL_MAIN = process.env.OPENAI_MODEL_MAIN || process.env.OPENAI_MODEL || 'gpt-6-sol'
// Luna (fast, cheap) plans, formulates the knowledge-base questions, answers
// general tasks and reads documents in the due diligence; Sol only assembles
// deliverables at the end (code generation, document tasks, DD synthesis).
const MODEL_FAST = process.env.OPENAI_MODEL_FAST || 'gpt-6-luna'
const MODEL_CODE = process.env.OPENAI_MODEL_CODE || '' // empty: follows the task's difficulty (Luna, Sol when hard)
// Optional second pass: Sol reviews the knowledge-base answer (≤ 3 web searches). Off by default – the answer is shown as is.
const REVIEW_ANSWERS = process.env.REVIEW_ANSWERS === 'on'
const KB_MAX_QUESTIONS = Number(process.env.KB_MAX_QUESTIONS || 3)
const EFFORT_MAIN = process.env.OPENAI_EFFORT_MAIN || 'medium'
const EFFORT_PLAN = process.env.OPENAI_EFFORT_PLAN || 'low'
const EFFORT_CODE = process.env.OPENAI_EFFORT_CODE || 'medium'

// Hard per-question budgets (summed over every model call of one question).
const MAX_INPUT_TOKENS = Number(process.env.MAX_INPUT_TOKENS || 1_000_000)
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 100_000)
const MAX_OUTPUT_PER_CALL = Number(process.env.MAX_OUTPUT_PER_CALL || 16_000)
const MODEL_RETRIES = Number(process.env.MODEL_RETRIES || 3)
// Step limits: one knowledge-base call, at most 3 web searches, few tool steps.
const MAX_WEB_SEARCHES = Number(process.env.MAX_WEB_SEARCHES || 3)
const DOC_MAX_STEPS = Number(process.env.DOC_MAX_STEPS || 8)

// Web search (OpenAI hosted tool) — only as a fallback after the knowledge base.
const WEB_SEARCH_ENABLED = process.env.OPENAI_WEB_SEARCH !== 'off'
const WEB_SEARCH_TOOL = { type: process.env.OPENAI_WEB_SEARCH_TOOL || 'web_search' }

// Matters (Akten) and due diligence: file-backed store (set DATA_DIR to a
// persistent disk on Render), a separate extraction model for the per-document
// pass, and a cap on concurrent long-running analyses per instance.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
const MODEL_EXTRACT = process.env.OPENAI_MODEL_EXTRACT || MODEL_FAST
const EFFORT_DD = process.env.OPENAI_EFFORT_DD || 'medium'
const DD_MAX_DOCS = Number(process.env.DD_MAX_DOCS || 300)
const DD_MAX_DOC_BYTES = Number(process.env.DD_MAX_DOC_BYTES || 30 * 1024 * 1024)
const DD_MAX_CONCURRENT = Number(process.env.DD_MAX_CONCURRENT || 2)
const DOC_EXT = /\.(pdf|docx|txt|md|csv|json|html?|rtf|xml)$/i

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

// Microsoft 365 (OneDrive / SharePoint via Microsoft Graph). Register an app in
// Entra ID (platform "Web", redirect URI https://<host>/api/ms/callback, delegated
// permissions User.Read, Files.ReadWrite.All, Sites.ReadWrite.All, offline_access).
const MS = {
  clientId: process.env.MS_CLIENT_ID || '',
  clientSecret: process.env.MS_CLIENT_SECRET || '',
  tenant: process.env.MS_TENANT || 'common',
  redirectUri: process.env.MS_REDIRECT_URI || '',
  scopes: process.env.MS_SCOPES || 'openid profile offline_access User.Read Files.ReadWrite.All Sites.ReadWrite.All',
  loginBase: (process.env.MS_LOGIN_BASE_URL || 'https://login.microsoftonline.com').replace(/\/+$/, ''),
  graphBase: (process.env.MS_GRAPH_BASE_URL || 'https://graph.microsoft.com/v1.0').replace(/\/+$/, ''),
}
// Cookie encryption key: MS_COOKIE_SECRET, else the client secret. Never a guessable
// value: without both, a random per-process key is used (logins survive until restart).
const MS_COOKIE_SECRET = process.env.MS_COOKIE_SECRET || process.env.MS_CLIENT_SECRET || ''
if (MS.clientId && !MS_COOKIE_SECRET) console.warn('MS_COOKIE_SECRET/MS_CLIENT_SECRET fehlen: Microsoft-Logins gelten nur bis zum nächsten Neustart.')
const MS_COOKIE_KEY = MS_COOKIE_SECRET ? crypto.createHash('sha256').update(MS_COOKIE_SECRET).digest() : crypto.randomBytes(32)
const MS_UPLOAD_SIMPLE_MAX = 4 * 1024 * 1024 // Graph: simple PUT up to 4 MB, else upload session
const MS_SESSION_TTL_MS = 90 * 86400 * 1000

// Never let a stray rejection take the whole service down (Node exits on unhandled rejections).
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e?.stack || e))

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
  // Per-question budgets by default; long-running matter jobs bring their own limits.
  const remainingOut = (ctx.limits?.outMax ?? MAX_OUTPUT_TOKENS) - ctx.usage.outTok
  const remainingIn = (ctx.limits?.inMax ?? MAX_INPUT_TOKENS) - ctx.usage.inTok
  if (remainingOut < 800 || remainingIn < 2000) throw new BudgetExceeded(ctx.limits ? 'Token-Budget des Akts ausgeschöpft.' : 'Token-Budget für diese Frage ausgeschöpft.')
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
  // Transient failures (429, 5xx, network) are retried with backoff – a data
  // room of 300 documents must not lose a document to one rate-limit burst.
  const create = async (p) => {
    for (let attempt = 0; ; attempt++) {
      try { return await getOpenAI().responses.create(p) }
      catch (e) {
        const st = e?.status
        const transient = st === 429 || (st >= 500 && st < 600) || /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|socket hang up|network/i.test(String(e?.message || e))
        if (!transient || attempt >= MODEL_RETRIES) throw e
        await new Promise((r) => setTimeout(r, Math.min(20_000, 1500 * 2 ** attempt)))
      }
    }
  }
  let resp
  try {
    resp = await create(params)
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
    resp = await create(p2)
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
  return { title: title || url || 'Dokument der Wissensdatenbank', url, raw: String(text || '').trim(), meta: Object.keys(m).length ? m : null }
}

/**
 * Ask the AI:ssociate knowledge base; streams text via onDelta.
 * The timeout is an idle timeout between chunks (like the reference client's
 * httpx read timeout), not a total deadline: agentic answers may stream for
 * minutes. A stream that breaks after the answer arrived still returns it.
 */
async function askAissociate({ question, legalArea, scope, threadId, onDelta, onDocument, onEvent, signal }) {
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
      else if (type === 'document_number') { const src = sourceFromDocumentEvent(text, j?.meta); out.sources.push(src); onDocument?.(src) }
      else if (type === 'qa_metadata') { const tid = j?.meta?.qa_metadata?.thread_id || j?.meta?.thread_id; if (tid) out.threadId = tid; out.meta.qa = j?.meta || null }
      else { out.meta[type] = j?.meta ?? text; onEvent?.(type, text, j?.meta) }
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
    if (!out.has(key)) out.set(key, { kind, num, law, label: key, raw: m[0].trim() })
  }
  return [...out.values()]
}

const reEsc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Regex source matching every written variant of one citation (§ 10 Abs 4 VGG, § 10 VGG, 4 Ob 150/10b, 4Ob150/10b …). */
function citationPattern(it) {
  if (it.kind) {
    const kind = it.kind === 'Art' ? '(?:Art\\.?|Artikel)' : '§§?'
    return `${kind}\\s*${reEsc(it.num)}(?:\\s*(?:Abs\\.?|Absatz)\\s*\\d+[a-z]?)?(?:\\s*(?:Z|Ziffer|Zif\\.?)\\s*\\d+[a-z]?)?(?:\\s*lit\\.?\\s*[a-z]{1,2})?(?:\\s*sublit\\.?\\s*[a-z]{1,2})?(?:\\s*(?:erster|zweiter|dritter|vierter|fünfter|letzter|vorletzter)\\s+Satz)?(?:\\s*(?:Satz|S\\.?)\\s*\\d+)?(?:\\s*ff?\\.?)?\\s+${reEsc(it.law)}(?![\\wäöüß])`
  }
  const parts = String(it.gz).replace(/\s+/g, '').replace(/([A-Za-zÄÖÜäöü])(\d)/g, '$1\u0000$2').replace(/(\d)([A-Za-zÄÖÜäöü])/g, '$1\u0000$2').split('\u0000')
  return parts.map(reEsc).join('\\s?') + '(?![\\w/])'
}

/**
 * Turns verified citations in a Markdown answer into RIS links: every written
 * variant of a confirmed § / Art / Geschäftszahl, outside existing links and
 * code, in one pass (so nothing is linked twice). extraUrls maps citation
 * labels (e.g. "§ 924 ABGB") to fallback URLs such as knowledge-base documents.
 */
function linkCitations(markdown, verification, extraUrls = new Map()) {
  if (!verification) return markdown
  const items = [...(verification.norms || []), ...(verification.decisions || [])]
    .map((x) => ({ ...x, url: ['ok', 'expired', 'unsure'].includes(x.status) && x.url ? x.url : (extraUrls.get(x.label) || null) }))
    .filter((x) => x.url)
  if (!items.length) return markdown
  const matchers = items.map((it) => ({ it, re: new RegExp('^(?:' + citationPattern(it) + ')$') }))
  const big = new RegExp(`(^|[^\\w§])(${items.map(citationPattern).join('|')})`, 'g')
  const segs = String(markdown).split(/(\[[^\]\n]*\]\([^)\s]*\)|`[^`\n]*`|https?:\/\/\S+)/)
  for (let i = 0; i < segs.length; i += 2) {
    segs[i] = segs[i].replace(big, (all, pre, txt) => { const m = matchers.find((x) => x.re.test(txt)); return m ? `${pre}[${txt}](${m.it.url})` : all })
  }
  return segs.join('')
}

const GZ_PATTERNS = [
  { app: 'Justiz', re: /\b(\d{1,2})\s?(ObA|ObS|Ob|Os|Nc|Nd|Ns|Fsc|Fss|Bkd|Ds|Dg|Präs|R|Bs|Cga|Cgs|Cgb|Cg|Ra|Rs|Msch|Fam|Hv|U|St|HR|Kt|Okt)\s?(\d{1,4})\/(\d{2})([a-z])?(?![\d/])/g, fmt: (m) => `${m[1]}${m[2]}${m[3]}/${m[4]}${m[5] || ''}`, raw: (m) => m[0] },
  { app: 'Vwgh', re: /\b(Ra|Ro|Fr|Fe|Fra|Ko)\s?(\d{4})\/(\d{2})\/(\d{4})(?![\d/])/g, fmt: (m) => `${m[1]} ${m[2]}/${m[3]}/${m[4]}`, raw: (m) => m[0] },
  // Pre-2014 VwGH numbering (e.g. 2012/15/0123), only when VwGH is named nearby and
  // the number carries no letter prefix (those are matched above).
  { app: 'Vwgh', re: /VwGH[^\n]{0,40}?(?<![A-Za-z]\s?)\b(\d{4})\/(\d{2})\/(\d{4})(?![\d/])/g, fmt: (m) => `${m[1]}/${m[2]}/${m[3]}`, raw: (m) => `${m[1]}/${m[2]}/${m[3]}` },
  { app: 'Vfgh', re: /\b(G|B|E|V|SV|WI|KI|KR|KIV|A|UA)\s?(\d{1,4})\/(\d{4})(?:-\d+)?(?![\d/])/g, fmt: (m) => `${m[1]} ${m[2]}/${m[3]}`, raw: (m) => m[0] },
]
function extractDecisionCitations(text) {
  const out = new Map()
  for (const pat of GZ_PATTERNS) {
    pat.re.lastIndex = 0
    let m
    while ((m = pat.re.exec(text)) && out.size < 20) {
      const gz = pat.fmt(m)
      const key = `${pat.app}:${gz}`
      if (!out.has(key)) out.set(key, { app: pat.app, gz, label: gz, raw: pat.raw(m).trim() })
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

/**
 * RIS OGD v2.6 (BrKons) request for one section of one law, valid today:
 * Abschnitt.Typ/Von/Bis selects the § or Art, Fassung.FassungVom the version in force.
 */
function normQueryParams(n, today, viaFulltext = false) {
  return {
    Applikation: 'BrKons',
    [viaFulltext ? 'Suchworte' : 'Titel']: n.law,
    'Abschnitt.Typ': n.kind === 'Art' ? 'Artikel' : 'Paragraph',
    'Abschnitt.Von': n.num,
    'Abschnitt.Bis': n.num,
    'Fassung.FassungVom': today,
    DokumenteProSeite: RIS_PAGE_SIZE,
    Seitennummer: 1,
  }
}
const sectionMatches = (doc, n) => {
  const s = (doc.section || '').replace(/\s+/g, '').toLowerCase()
  const want = `${n.kind === 'Art' ? 'art' : '§'}${n.num}`.toLowerCase()
  return s === want || s === want.replace('art', 'art.') || s.startsWith(want + ' ') || s === want.replace('art', 'artikel')
}

async function verifyNorm(n) {
  if (FOREIGN_LAWS.has(n.law)) return { ...n, status: 'skipped', note: 'EU-Recht/ausländisches Recht – nicht im RIS (Bundesrecht) enthalten, nicht geprüft.' }
  const today = new Date().toISOString().slice(0, 10)
  let lastErr = null
  let otherHit = null
  for (const viaFulltext of [false, true]) {
    try {
      const r = await risRequest('Bundesrecht', normQueryParams(n, today, viaFulltext))
      if (r.hits > 0 && r.docs.length) {
        // Only a document of the cited law AND the cited section counts; a hit in the
        // law's title document ("§ 0") or another section must never be reported as
        // confirmed or as "außer Kraft".
        const best = r.docs.find((d) => lawMatches(d, n.law) && sectionMatches(d, n))
        if (!best) { otherHit = otherHit || r.docs.find((d) => lawMatches(d, n.law)) || r.docs[0]; continue }
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
  if (otherHit) return { ...n, status: 'unsure', title: otherHit.title, url: otherHit.url, note: lawMatches(otherHit, n.law) ? `Gesetz im RIS gefunden, ${n.kind === 'Art' ? 'Artikel' : 'Paragraph'} ${n.num} aber nicht eindeutig – Zitat prüfen` : `Nur Treffer in einem anderen Gesetz (${otherHit.title}) – Zitat prüfen` }
  return { ...n, status: 'not_found', note: 'Im RIS (Bundesrecht, geltende Fassung) nicht gefunden – Landesrecht/EU-Recht, aufgehoben oder Zitierfehler?' }
}

async function verifyDecision(d) {
  const variants = [d.gz, d.gz.replace(/\s+/g, ''), d.gz.replace(/(\d)([A-Za-z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2')]
  let lastErr = null
  for (const gz of [...new Set(variants)]) {
    try {
      const r = await risRequest('Judikatur', { Applikation: d.app, Geschaeftszahl: gz, DokumenteProSeite: RIS_PAGE_SIZE, Seitennummer: 1 })
      if (r.hits > 0 && r.docs.length) {
        const best = r.docs.find((x) => x.docType === 'Entscheidungstext') || r.docs[0]
        // A Rechtssatz lists every decision it applies to; show only the cited number.
        const isText = best.docType === 'Entscheidungstext'
        const title = `${best.court || d.app} ${d.gz}${isText && best.date ? ' vom ' + best.date : ''}${best.docType ? ' · ' + best.docType : ''}`
        return { ...d, status: 'ok', title, url: best.url, htmlUrl: best.htmlUrl, date: best.date, court: best.court, id: best.id, hits: r.hits, note: isText ? 'Entscheidungstext im RIS' : `Rechtssatz im RIS (${r.hits} Dokument${r.hits === 1 ? '' : 'e'})` }
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

/** Verify a plain list of norm citations (due diligence: up to `max`, four at a time). */
async function verifyNormList(text, max = 60) {
  const norms = extractNormCitations(text).slice(0, max)
  const out = []
  for (let i = 0; i < norms.length; i += 4) out.push(...await Promise.all(norms.slice(i, i + 4).map((x) => verifyNorm(x).catch((e) => ({ ...x, status: 'error', note: e.message })))))
  const count = (s) => out.filter((x) => x.status === s).length
  const skipped = count('skipped')
  return { norms: out, decisions: [], summary: { checked: out.length - skipped, ok: count('ok'), warn: count('expired'), unsure: count('unsure'), notFound: count('not_found'), error: count('error'), skipped } }
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
    questions: { type: 'array', items: { type: 'string' } },
    difficulty: { type: 'string', enum: ['easy', 'hard'] },
    title: { type: 'string' },
  },
  required: ['mode', 'legal_area', 'scope', 'questions', 'difficulty', 'title'],
}
const PLAN_INSTRUCTIONS = `Du bist AI:ssociate, KI-Assistent für österreichische Rechtsanwältinnen und Rechtsanwälte. Analysiere die Anfrage (inkl. Gesprächsverlauf und ggf. Dokumenttext) und entscheide als JSON:
- mode: "legal" = Rechtsfrage, Rechtsauskunft, Recherche, Prüfung eines Sachverhalts (→ juristische Wissensdatenbank). "document" = hochgeladene Dateien analysieren/bearbeiten, Dateien (Word/Excel/PDF) erzeugen, Dokumente vergleichen, Entwürfe als Datei. "general" = ohne Rechtsrecherche lösbar: Umformulieren, Übersetzen, Zusammenfassen von eingefügtem Text, Small Talk, Rückfrage, Folgefrage, die allein aus dem Verlauf beantwortbar ist.
- legal_area: Rechtsgebiet der Wissensdatenbank. "civil" = Zivilrecht im weiten Sinn (ABGB, Schadenersatz, Vertrags-, Miet-, Familien-, Erb-, Arbeits-, Unternehmens-, Gesellschafts-, Insolvenz-, Zivilverfahrens-, Exekutionsrecht, Konsumentenschutz; OGH-Judikatur). "criminal" = Straf- und Strafverfahrensrecht. "tax" = Steuer- und Abgabenrecht (BAO, EStG, UStG, KStG, Finanzstrafrecht). "public" = öffentliches Recht (Verfassungs- und Verwaltungsrecht, Verwaltungsverfahren, Gewerbe-, Bau-, Raumordnungs-, Fremden-, Asyl-, Vergabe-, Datenschutzrecht, Landesrecht; VwGH/VfGH/BVwG). "none" nur bei mode general/document ohne Rechtsfrage.
- scope: nur bei "public": "Bund" oder ein Bundesland (Wien, Niederösterreich, Oberösterreich, Salzburg, Steiermark, Tirol, Vorarlberg, Kärnten, Burgenland), wenn Landesrecht einschlägig ist; sonst leer "".
- questions: 1 bis ${KB_MAX_QUESTIONS} KONKRETE, KOMPAKTE Fragen an die juristische Wissensdatenbank (je Frage höchstens 2 Sätze plus die unbedingt nötigen Fakten; eigenständig, keine Verweise wie "siehe oben"; auf Deutsch). Zerlege die Anfrage nur dann in mehrere Fragen, wenn sie wirklich mehrere Rechtsfragen enthält – sonst genau eine. Bei mode "document": die Rechtsfragen, die für die Bearbeitung des Dokuments geklärt sein müssen (z. B. Zulässigkeit einer konkreten Klausel, Rechtsfolge, Frist); rein redaktionelle Dokumentaufgaben (Zusammenfassen, Vergleichen, Formatieren) → leere Liste. Bei mode "general": leere Liste.
- difficulty: "hard" = schwere Aufgabe. Bei Rechtsfragen: Recherche in Normen und Judikatur nötig (Spezialmaterie, Judikaturlage, mehrere verschränkte Rechtsfragen, Rechtsfolgen/Fristen im Detail, Sachverhalt mit Dokumenten) → geht an die juristische Wissensdatenbank. Bei Dokument-/sonstigen Aufgaben: umfangreiche Dokumentbearbeitung (klauselweise Kommentierung, Vertragsentwurf, Redline, komplexe Excel-Auswertung), mehrschichtige Argumentation, lange Texte, mehrere große Dokumente. "easy" = einfache Rechtsfrage, die mit gesichertem Grundwissen und einer kurzen Websuche beantwortbar ist, bzw. kurze Entwürfe, Zusammenfassungen, Umformulierungen, einfache Dateien.
- title: prägnanter Titel (max. 6 Wörter) für die Verlaufsliste.`
// Asked of the knowledge base in front of every question: short answers, with references.
const KB_BRIEF = 'Bitte knapp und präzise antworten (Kurzantwort, dann die Rechtsgrundlagen mit § / Gesetz bzw. Gericht / Datum / Geschäftszahl und eine kurze Begründung; keine Wiederholungen, keine allgemeinen Einleitungen).\n\n'

// The web-search wording depends on whether the hosted tool is actually offered.
const WEB_SOURCES = 'bevorzugt ris.bka.gv.at, eur-lex.europa.eu, curia.europa.eu, parlament.gv.at, jusline.at, offizielle Quellen'
const webClause = (web) => web
  ? `nutze die Websuche, höchstens ${MAX_WEB_SEARCHES} Suchen (${WEB_SOURCES})`
  : 'eine Websuche ist NICHT verfügbar – ergänze nur aus gesichertem Wissen und kennzeichne Unsicheres ausdrücklich als nicht verifiziert'

const reviewInstructions = (web) => `Du bist AI:ssociate und prüfst die Antwort der juristischen Wissensdatenbank (AI:ssociate, österreichisches Recht; sie recherchiert selbst agentisch in Normen und Judikatur und ist die maßgebliche Quelle). Du bekommst die Nutzerfrage und diese Antwort.

REGELFALL: Die Antwort ist ausreichend → erste Zeile exakt "VERDICT: AUSREICHEND", danach nichts (oder höchstens ein Satz mit einem wirklich wichtigen Hinweis). Keine Wiederholung, keine Abrundung, keine Bestätigungssuche.

AUSNAHMEFALL – nur wenn mindestens eines zutrifft:
(a) ein wesentlicher Teil der Nutzerfrage wird gar nicht behandelt,
(b) die Nutzerin fragt ausdrücklich nach EU-Recht oder ausländischem Recht und das fehlt,
(c) die Frage betrifft eine tagesaktuelle Entwicklung (neue Novelle, gerade ergangene Entscheidung), die die Antwort nicht kennt,
(d) die Antwort enthält einen offensichtlichen Widerspruch.
Dann ${webClause(web)}, und antworte mit erster Zeile exakt "VERDICT: ERGAENZT", danach eine knappe Ergänzung in Markdown: nur das Fehlende, mit Fundstellen (§, Gesetz; Gericht, Datum, Geschäftszahl)${web ? ' und Links' : ''}.
Nie Normen, Entscheidungen oder Fundstellen erfinden. Sprache: wie die Nutzerfrage.`

const easyLegalInstructions = (web) => `Du bist AI:ssociate, KI-Assistent für österreichische Rechtsanwältinnen und Rechtsanwälte. Beantworte die einfache Rechtsfrage direkt und knapp nach österreichischem Recht; ${webClause(web)} und belege die Fundstellen${web ? ' mit Links' : ''}. Struktur in Markdown: **Kurzantwort**, **Rechtsgrundlagen** (§, Gesetz; Gericht, Datum, Geschäftszahl), **Begründung** (kurz). Nie Fundstellen erfinden; Unsicheres kennzeichnen.`

const directInstructions = (web) => `Du bist AI:ssociate, KI-Assistent für österreichische Rechtsanwältinnen und Rechtsanwälte. Die juristische Wissensdatenbank ist gerade nicht verfügbar. Beantworte die Rechtsfrage selbst: ${webClause(web)}. Antworte strukturiert in Markdown: **Kurzantwort**, **Rechtliche Grundlagen** (§, Gesetz; Gericht, Datum, Geschäftszahl), **Beurteilung**, **Ergebnis / Empfehlung**. ${web ? 'Belege mit Links. ' : ''}Nie Fundstellen erfinden; Unsicheres kennzeichnen.`

const GENERAL_INSTRUCTIONS = `Du bist AI:ssociate, KI-Assistent für österreichische Rechtsanwältinnen und Rechtsanwälte. Erledige die Aufgabe direkt, präzise und in der Sprache der Nutzerin (Markdown, keine Floskeln). Keine Rechtsrecherche nötig; falls doch eine Rechtsfrage enthalten ist, beantworte sie nach bestem Wissen und weise darauf hin, dass dafür keine Datenbankrecherche erfolgte.`

const docInstructions = (web) => `Du bist AI:ssociate, KI-Assistent für österreichische Rechtsanwältinnen und Rechtsanwälte, und bearbeitest eine Dokumentaufgabe mit wenigen, gezielten Schritten.

WERKZEUGE
- read_document: nur für Dateien, deren Text NICHT bereits unten im Volltext enthalten ist (in Teilen; lies so viel wie nötig, nicht mehr).
${web ? `- web_search: für Fundstellen zu einfachen Rechtsfragen bzw. nur falls die Wissensdatenbank nicht ausreicht (höchstens ${MAX_WEB_SEARCHES} Suchen).` : '- Eine Websuche ist NICHT verfügbar; Unsicheres ausdrücklich kennzeichnen.'}
- create_or_edit_file: erzeugt/bearbeitet Dateien (Word/Excel/PDF/HTML). Ein Aufruf je Deliverable. Die gesamte juristische Arbeit (welche Klausel, welcher Kommentar, welche Formulierung) machst DU vorher und gibst sie wörtlich in task mit. Niemals generische oder identische Kommentare für mehrere Absätze; jeder Kommentar nennt das konkrete Problem der konkreten Klausel.

RECHTSQUELLE: Liegt unten ein Abschnitt „ANTWORTEN DER WISSENSDATENBANK“ vor, ist er die maßgebliche Rechtsquelle – übernimm ihn inhaltlich in das Deliverable, soweit einschlägig, und erfinde keine weiteren Normen oder Entscheidungen. Fehlt er, beantworte einfache Rechtsfragen aus gesichertem Grundwissen${web ? ' mit einer kurzen Websuche für die Fundstellen' : ''} und kennzeichne Unsicheres.

ABLAUF (so kurz wie möglich): Liegt der Dokumenttext unten vor, NICHT zuerst lesen → Deliverable erzeugen (create_or_edit_file), wenn eine Datei verlangt oder sinnvoll ist; sonst direkt antworten → kurze Antwort. Keine unnötigen Schritte, keine Wiederholungen, keine Nachkontrollen durch erneutes Lesen. Antworte am Ende in Markdown: was erstellt/geändert wurde, die wesentlichen inhaltlichen Punkte (konkret) und Prüfpunkte für die Anwältin. Fundstellen mit §/Gesetz bzw. Gericht/GZ. Nie Fundstellen erfinden.`
// Documents up to this many characters (all attachments together) are handed to
// Sol directly, which saves the read_document round trip on typical contracts.
const INLINE_DOC_CHARS = Number(process.env.INLINE_DOC_CHARS || 80_000)

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
    const re = /(\[[^\[\]]+\]\(https?:[^)\s]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[Q\d+\])/g
    let last = 0, m
    while ((m = re.exec(s))) {
      if (m.index > last) runs.push(new TextRun(s.slice(last, m.index)))
      const t = m[0]
      const link = t.match(/^\[([^\[\]]+)\]\((https?:[^)\s]+)\)$/)
      if (link) runs.push(new ExternalHyperlink({ children: [new TextRun({ text: link[1], style: 'Hyperlink', color: '0E7C8A', underline: {} })], link: link[2] }))
      else if (t.startsWith('**')) runs.push(new TextRun({ text: t.slice(2, -2), bold: true }))
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
// Microsoft Graph: cookie-based login (encrypted refresh token), browsing,
// download and write-back to OneDrive / SharePoint document libraries.
// ---------------------------------------------------------------------------
function seal(obj) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', MS_COOKIE_KEY, iv)
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url')
}
function unseal(s) {
  try {
    const b = Buffer.from(String(s || ''), 'base64url')
    const d = crypto.createDecipheriv('aes-256-gcm', MS_COOKIE_KEY, b.subarray(0, 12))
    d.setAuthTag(b.subarray(12, 28))
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'))
  } catch { return null }
}
function parseCookies(req) {
  const out = {}
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    const v = part.slice(i + 1).trim()
    try { out[part.slice(0, i).trim()] = decodeURIComponent(v) } catch { out[part.slice(0, i).trim()] = v } // malformed %-escapes must not throw
  }
  return out
}
const isHttps = (req) => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https'
function setCookie(req, res, name, value, maxAge) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`]
  if (isHttps(req)) parts.push('Secure')
  const prev = res.getHeader('Set-Cookie')
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join('; ')])
}
const clearCookie = (req, res, name) => setCookie(req, res, name, '', 0)
const msRedirectUri = (req) => MS.redirectUri || `${isHttps(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}/api/ms/callback`

// Big refresh tokens that do not fit a cookie live in memory under a session id.
const msSessions = new Map() // sid -> { rt, account, createdAt }
const msTokenCache = new Map() // hash(rt) -> { accessToken, expiresAt }
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of msTokenCache) if (v.expiresAt < now) msTokenCache.delete(k)
  for (const [k, v] of msSessions) if (now - (v.createdAt || 0) > MS_SESSION_TTL_MS) msSessions.delete(k)
}, 10 * 60_000).unref?.()
const rtKey = (rt) => crypto.createHash('sha256').update(rt).digest('hex')

async function msTokenRequest(req, form) {
  const body = new URLSearchParams({ client_id: MS.clientId, redirect_uri: msRedirectUri(req), scope: MS.scopes, ...form })
  if (MS.clientSecret) body.set('client_secret', MS.clientSecret)
  const r = await fetchWithTimeout(`${MS.loginBase}/${MS.tenant}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, 20_000)
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) { const e = new Error(j.error_description || j.error || `Token-Anfrage fehlgeschlagen (${r.status})`); e.status = r.status; e.code = j.error; throw e }
  return j
}

function msReadSession(req) {
  const c = parseCookies(req)
  if (c.ms_auth) return unseal(c.ms_auth)
  if (c.ms_sid && msSessions.has(c.ms_sid)) return msSessions.get(c.ms_sid)
  return null
}
function msWriteSession(req, res, sess) {
  const old = parseCookies(req).ms_sid
  if (old) msSessions.delete(old) // never keep a superseded refresh token around
  const sealed = seal(sess)
  if (sealed.length <= 3900) { setCookie(req, res, 'ms_auth', sealed, 90 * 86400); if (old) clearCookie(req, res, 'ms_sid'); return }
  const sid = crypto.randomBytes(24).toString('base64url')
  msSessions.set(sid, { ...sess, createdAt: Date.now() })
  clearCookie(req, res, 'ms_auth')
  setCookie(req, res, 'ms_sid', sid, 90 * 86400)
}
function msClearSession(req, res) {
  const c = parseCookies(req)
  if (c.ms_sid) msSessions.delete(c.ms_sid)
  clearCookie(req, res, 'ms_auth'); clearCookie(req, res, 'ms_sid')
}

/** Refresh grant that only updates the in-memory token cache (usable after headers were sent). */
async function msRefreshToCache(req, sess) {
  const j = await msTokenRequest(req, { grant_type: 'refresh_token', refresh_token: sess.rt })
  const entry = { accessToken: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 }
  msTokenCache.set(rtKey(sess.rt), entry)
  if (j.refresh_token && j.refresh_token !== sess.rt) msTokenCache.set(rtKey(j.refresh_token), entry)
  return { token: j.access_token, newRt: j.refresh_token && j.refresh_token !== sess.rt ? j.refresh_token : null }
}

/**
 * Access token for Graph with at least minTtlMs of validity left (refreshes with
 * the stored refresh token). The session is only dropped when the identity
 * platform definitively rejects the refresh token (400/401), never on outages.
 */
async function msAccessToken(req, res, minTtlMs = 60_000) {
  const sess = msReadSession(req)
  if (!sess?.rt) return null
  const cached = msTokenCache.get(rtKey(sess.rt))
  if (cached && cached.expiresAt > Date.now() + minTtlMs) return { token: cached.accessToken, account: sess.account, session: sess }
  try {
    const { token, newRt } = await msRefreshToCache(req, sess)
    if (newRt) { const next = { ...sess, rt: newRt }; if (res) msWriteSession(req, res, next); return { token, account: sess.account, session: next } }
    return { token, account: sess.account, session: sess }
  } catch (e) {
    console.error('ms refresh failed:', e?.status, e?.message)
    if (res && (e?.status === 400 || e?.status === 401)) msClearSession(req, res)
    return null
  }
}

async function graph(token, pathOrUrl, { method = 'GET', body, headers = {}, raw = false, timeout = 30_000 } = {}) {
  const url = /^https?:/.test(pathOrUrl) ? pathOrUrl : `${MS.graphBase}${pathOrUrl}`
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetchWithTimeout(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined, redirect: raw ? 'manual' : 'follow' }, timeout)
    if (r.status === 429 || r.status === 503) { await new Promise((ok) => setTimeout(ok, Math.min(10, Number(r.headers.get('retry-after')) || 2) * 1000)); continue }
    if (raw) return r
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}))
    if (!r.ok) { const e = new Error(j.error?.message || `Graph ${r.status}`); e.status = r.status; e.code = j.error?.code; throw e }
    return j
  }
  throw new Error('Graph: zu viele Anfragen (429)')
}
const graphItem = (it) => ({ id: it.id, name: it.name, isFolder: Boolean(it.folder), size: it.size || 0, modified: it.lastModifiedDateTime || '', webUrl: it.webUrl || '', driveId: it.parentReference?.driveId || '', parentId: it.parentReference?.id || '', childCount: it.folder?.childCount ?? null })
const ITEM_SELECT = '$select=id,name,folder,file,size,lastModifiedDateTime,webUrl,parentReference'

/** Download a drive item: Graph answers 302 to a pre-authenticated URL (no bearer there). */
async function msDownload(token, driveId, itemId) {
  const meta = await graph(token, `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?${ITEM_SELECT}`)
  if (meta.folder) throw new Error(`„${meta.name}“ ist ein Ordner.`)
  if ((meta.size || 0) > MAX_UPLOAD_BYTES) throw new Error(`„${meta.name}“ überschreitet ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)
  const r = await graph(token, `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`, { raw: true })
  let buf
  if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
    const dl = await fetchWithTimeout(r.headers.get('location'), {}, 60_000)
    if (!dl.ok) throw new Error(`Download fehlgeschlagen (${dl.status})`)
    buf = Buffer.from(await dl.arrayBuffer())
  } else if (r.ok) buf = Buffer.from(await r.arrayBuffer())
  else throw new Error(`Download fehlgeschlagen (${r.status})`)
  return { meta: graphItem(meta), buf }
}

/** Upload (≤ 4 MB directly, else via upload session); existing names are kept, the new file is renamed. */
async function msUpload(token, driveId, parentId, name, buf) {
  const base = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(name)}:`
  if (buf.length <= MS_UPLOAD_SIMPLE_MAX) {
    const it = await graph(token, `${base}/content?@microsoft.graph.conflictBehavior=rename`, { method: 'PUT', body: buf, headers: { 'Content-Type': 'application/octet-stream' }, timeout: 120_000 })
    return graphItem(it)
  }
  const sess = await graph(token, `${base}/createUploadSession`, { method: 'POST', body: { item: { '@microsoft.graph.conflictBehavior': 'rename', name } } })
  const CHUNK = 5 * 1024 * 1024
  let last = null
  for (let off = 0; off < buf.length; off += CHUNK) {
    const end = Math.min(off + CHUNK, buf.length)
    const r = await fetchWithTimeout(sess.uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(end - off), 'Content-Range': `bytes ${off}-${end - 1}/${buf.length}` }, body: buf.subarray(off, end) }, 180_000)
    if (!r.ok && r.status !== 202) throw new Error(`Upload-Block fehlgeschlagen (${r.status})`)
    last = await r.json().catch(() => null)
  }
  return graphItem(last || {})
}

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------
const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '48mb' })) // one 30 MB document as base64 plus envelope
app.use(express.static(path.join(__dirname, 'public')))

// ---- Microsoft 365 routes ----
app.get('/api/ms/login', (req, res) => {
  if (!MS.clientId) return res.status(503).send('Microsoft 365 ist nicht konfiguriert (MS_CLIENT_ID fehlt).')
  const verifier = crypto.randomBytes(48).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const state = crypto.randomBytes(16).toString('base64url')
  setCookie(req, res, 'ms_oauth', seal({ verifier, state, t: Date.now() }), 600)
  const u = new URL(`${MS.loginBase}/${MS.tenant}/oauth2/v2.0/authorize`)
  for (const [k, v] of Object.entries({ client_id: MS.clientId, response_type: 'code', redirect_uri: msRedirectUri(req), response_mode: 'query', scope: MS.scopes, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' })) u.searchParams.set(k, v)
  res.redirect(u.toString())
})
app.get('/api/ms/callback', async (req, res) => {
  const o = unseal(parseCookies(req).ms_oauth)
  clearCookie(req, res, 'ms_oauth')
  if (req.query.error) return res.redirect('/?ms=error&reason=' + encodeURIComponent(String(req.query.error_description || req.query.error).slice(0, 200)))
  if (!o || !req.query.code || req.query.state !== o.state || Date.now() - o.t > 600_000) return res.redirect('/?ms=error&reason=' + encodeURIComponent('Anmeldung abgelaufen oder ungültig'))
  try {
    const j = await msTokenRequest(req, { grant_type: 'authorization_code', code: String(req.query.code), code_verifier: o.verifier })
    if (!j.refresh_token) throw new Error('Kein Refresh-Token erhalten (offline_access fehlt?)')
    let account = { name: '', email: '' }
    try { const me = await graph(j.access_token, '/me?$select=displayName,mail,userPrincipalName'); account = { name: me.displayName || '', email: me.mail || me.userPrincipalName || '' } } catch {}
    msWriteSession(req, res, { rt: j.refresh_token, account })
    msTokenCache.set(rtKey(j.refresh_token), { accessToken: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 })
    res.redirect('/?ms=connected')
  } catch (e) { res.redirect('/?ms=error&reason=' + encodeURIComponent(String(e?.message || e).slice(0, 200))) }
})
app.post('/api/ms/logout', (req, res) => { msClearSession(req, res); res.json({ ok: true }) })
app.get('/api/ms/me', async (req, res) => {
  if (!MS.clientId) return res.json({ configured: false, connected: false })
  const a = await msAccessToken(req, res)
  const sess = a ? null : msReadSession(req)
  // A session that survived a transient refresh failure still counts as connected.
  res.json({ configured: true, connected: Boolean(a || sess?.rt), degraded: Boolean(!a && sess?.rt), account: a?.account || sess?.account || null })
})
const msGuard = async (req, res) => { const a = await msAccessToken(req, res); if (!a) { res.status(401).json({ error: 'Nicht mit Microsoft 365 verbunden.', reauth: true }); return null } return a.token }
app.get('/api/ms/sites', async (req, res) => {
  const token = await msGuard(req, res); if (!token) return
  try {
    const q = String(req.query.q || '').trim()
    const j = q ? await graph(token, `/sites?search=${encodeURIComponent(q)}&$select=id,displayName,name,webUrl&$top=25`) : await graph(token, '/me/followedSites?$select=id,displayName,name,webUrl')
    res.json({ sites: (j.value || []).map((s) => ({ id: s.id, name: s.displayName || s.name, webUrl: s.webUrl })) })
  } catch (e) { res.status(e.status === 401 ? 401 : 502).json({ error: e.message, reauth: e.status === 401 }) }
})
app.get('/api/ms/site-drives', async (req, res) => {
  const token = await msGuard(req, res); if (!token) return
  try {
    const j = await graph(token, `/sites/${encodeURIComponent(String(req.query.siteId || ''))}/drives?$select=id,name,webUrl,driveType`)
    res.json({ drives: (j.value || []).map((d) => ({ id: d.id, name: d.name, webUrl: d.webUrl })) })
  } catch (e) { res.status(502).json({ error: e.message }) }
})
app.get('/api/ms/browse', async (req, res) => {
  const token = await msGuard(req, res); if (!token) return
  try {
    let { driveId = '', itemId = '' } = req.query
    let current = null
    if (!driveId) { const d = await graph(token, '/me/drive?$select=id,name,webUrl'); driveId = d.id; const root = await graph(token, `/me/drive/root?${ITEM_SELECT}`); current = graphItem(root); itemId = root.id }
    else if (!itemId) { const root = await graph(token, `/drives/${encodeURIComponent(driveId)}/root?${ITEM_SELECT}`); current = graphItem(root); itemId = root.id }
    else current = graphItem(await graph(token, `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?${ITEM_SELECT}`))
    const items = []
    let next = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children?${ITEM_SELECT}&$top=200&$orderby=name`
    while (next && items.length < 600) { const page = await graph(token, next); items.push(...(page.value || []).map(graphItem)); next = page['@odata.nextLink'] || null }
    items.sort((a, b) => (a.isFolder === b.isFolder ? a.name.localeCompare(b.name, 'de') : a.isFolder ? -1 : 1))
    res.json({ driveId, itemId, current: { ...current, driveId: driveId }, items })
  } catch (e) { res.status(e.status === 401 ? 401 : 502).json({ error: e.message, reauth: e.status === 401 }) }
})

app.get('/api/health', async (_req, res) => {
  let storeStats = null
  try { storeStats = await store.stats() } catch {}
  res.json({ ok: true, openai: Boolean(OPENAI_API_KEY), e2b: Boolean(E2B_API_KEY), aissociate: Boolean(AISSOCIATE_API_KEY), ms: Boolean(MS.clientId), models: { main: MODEL_MAIN, fast: MODEL_FAST, code: MODEL_CODE || MODEL_FAST, extract: MODEL_EXTRACT }, reviewAnswers: REVIEW_ANSWERS, knowledgeBase: 'AI:ssociate API', webSearch: WEB_SEARCH_ENABLED, maxWebSearches: MAX_WEB_SEARCHES, budget: { inMax: MAX_INPUT_TOKENS, outMax: MAX_OUTPUT_TOKENS }, store: storeStats, dd: { maxDocs: DD_MAX_DOCS, maxDocBytes: DD_MAX_DOC_BYTES, running: ddRuns.size } })
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
// Finished jobs stay for JOB_TTL_MS so a client can still replay them; running
// jobs (a due diligence can take hours) are only dropped after a hard limit.
const JOB_MAX_AGE_MS = Number(process.env.JOB_MAX_AGE_MS || 12 * 3600 * 1000)
setInterval(() => { const now = Date.now(); for (const [id, j] of jobs) if ((j.done && now - (j.finishedAt || j.createdAt) > JOB_TTL_MS) || now - j.createdAt > JOB_MAX_AGE_MS) jobs.delete(id) }, 60_000).unref?.()

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
    job.finishedAt = Date.now()
    for (const l of job.listeners) { try { l.end() } catch {} }
    job.listeners.clear()
  }
  return job
}

const streamJob = (req, res) => {
  const job = jobs.get(String(req.params.id || ''))
  if (!job) return res.status(404).json({ error: 'Auftrag unbekannt oder abgelaufen.' })
  attachListener(job, res, Number(req.query.after) || 0)
}
app.get('/api/chat/stream/:id', streamJob)
app.get('/api/jobs/:id/stream', streamJob)

// ---------------------------------------------------------------------------
// Matters (Akten): documents, due diligence, review tables, reports.
//
// Isolation: every request carries X-Owner-Key, a random key the browser
// generates once (shown in the settings so a workspace can be moved to another
// device). It separates workspaces; it is not an authentication system – bind
// it to the Microsoft login or an SSO identity before multi-tenant use.
// ---------------------------------------------------------------------------
const store = new JsonStore(DATA_DIR)
store.reconcileInterrupted().then((n) => { if (n) console.log(`matters: ${n} interrupted run(s) marked as paused`) }).catch((e) => console.error('reconcile failed:', e?.message))
const ddRuns = new Map() // matterId -> { jobId, kind }
const ownerOf = (req) => { const k = String(req.get('x-owner-key') || ''); return /^[\w-]{16,80}$/.test(k) ? k : null }
const matterSummary = (m) => ({
  id: m.id, name: m.name, kind: m.kind, client: m.client, createdAt: m.createdAt, updatedAt: m.updatedAt, settings: m.settings,
  documents: m.documents.length, analysed: m.documents.filter((d) => d.status === 'analysed').length,
  red: m.findings.filter((f) => f.severity === 'red').length, amber: m.findings.filter((f) => f.severity === 'amber').length,
  status: m.job?.status || 'idle', stage: m.job?.stage || null, progress: m.job?.progress || null, running: ddRuns.has(m.id), runningKind: ddRuns.get(m.id)?.kind || null,
  assessment: m.executive?.overall_assessment || null, reports: (m.reports || []).length, tables: (m.tables || []).length,
})
const matterView = (m) => ({ ...m, ownerKey: undefined, job: { ...m.job, log: (m.job.log || []).slice(-80), jobId: ddRuns.get(m.id)?.jobId || null, running: ddRuns.has(m.id), runningKind: ddRuns.get(m.id)?.kind || null } })
async function loadMatter(req, res) {
  const owner = ownerOf(req)
  if (!owner) { res.status(401).json({ error: 'Kein Arbeitsbereich-Schlüssel (X-Owner-Key).' }); return null }
  let m = null
  try { m = await store.getMatter(String(req.params.id || '')) } catch {}
  if (!m || m.ownerKey !== owner) { res.status(404).json({ error: 'Akt nicht gefunden.' }); return null }
  return m
}
const DD_CONCURRENCY = Number(process.env.DD_CONCURRENCY || 6) // upper bound; the run scales workers with the number of documents
const ddDeps = (send) => ({
  store, callModel, extractText, modelMain: MODEL_MAIN, modelExtract: MODEL_EXTRACT, effort: EFFORT_DD, concurrency: DD_CONCURRENCY,
  verifyAnswer: (text) => verifyNormList(text, 60), computeCost, send,
  // Per document: hard legal questions go to the knowledge base in one request; easy ones are
  // answered on the fast model with a short web search (same routing as the general agent).
  askKnowledgeBase: AISSOCIATE_API_KEY ? async ({ question, legalArea }) => { const r = await askAissociate({ question: KB_BRIEF + question, legalArea: LEGAL_AREAS[legalArea] ? legalArea : 'civil', scope: '', threadId: null }); return { answer: r.answer, sources: r.sources } } : null,
  answerEasyLegal: async (ctx, { question }) => {
    const resp = await callModel(ctx, { model: MODEL_FAST, instructions: easyLegalInstructions(WEB_SEARCH_ENABLED), effort: EFFORT_PLAN, maxOut: 5000, input: [{ role: 'user', content: question }], tools: WEB_SEARCH_ENABLED ? [WEB_SEARCH_TOOL] : undefined, maxToolCalls: WEB_SEARCH_ENABLED ? MAX_WEB_SEARCHES : undefined })
    const sources = []
    for (const o of resp.output || []) if (o.type === 'message') for (const part of o.content || []) for (const ann of part.annotations || []) if (ann.type === 'url_citation' && ann.url && !sources.some((x) => x.url === ann.url)) sources.push({ title: ann.title || ann.url, url: ann.url })
    return { answer: resp.output_text || '', sources }
  },
  modelFast: MODEL_FAST,
})

/** Run a long task of a matter as a resumable job (one per matter, few per instance). */
function startMatterJob(m, kind, runner) {
  if (ddRuns.has(m.id)) return null
  if (ddRuns.size >= DD_MAX_CONCURRENT) throw Object.assign(new Error(`Es laufen bereits ${DD_MAX_CONCURRENT} Analysen auf diesem Server – bitte später erneut starten.`), { status: 429 })
  const job = newJob(`dd_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('base64url')}`)
  m.job.jobId = job.id
  ddRuns.set(m.id, { jobId: job.id, kind })
  job.send('job', { id: job.id, matterId: m.id, kind })
  ;(async () => {
    try { await runner(ddDeps(job.send)) }
    catch (e) { console.error('matter job failed:', e); job.send('error', { message: String(e?.message || e).slice(0, 300) }) }
    finally { ddRuns.delete(m.id); job.send('end', { matterId: m.id, kind, status: m.job.status }); job.finish() }
  })()
  return job.id
}
async function addDocumentFromBuffer(m, { name, buf, source, ms }) {
  if (m.documents.length >= DD_MAX_DOCS) throw new Error(`Höchstens ${DD_MAX_DOCS} Dokumente je Akt.`)
  if (buf.length > DD_MAX_DOC_BYTES) throw new Error(`überschreitet ${Math.round(DD_MAX_DOC_BYTES / 1048576)} MB`)
  const safe = path.basename(String(name)).replace(/[^\w.\- ()äöüÄÖÜß]/g, '_').slice(0, 200)
  if (!DOC_EXT.test(safe)) throw new Error('Dateityp nicht unterstützt (PDF, Word, Text)')
  const dup = m.documents.find((d) => d.name === safe && d.size === buf.length)
  if (dup) return { doc: dup, duplicate: true }
  const d = newDocument({ name: safe, size: buf.length, source, ms, no: nextNo(m, 'doc') })
  d.file = await store.putFile(m.id, d.id, safe.split('.').pop(), buf)
  m.documents.push(d)
  return { doc: d, duplicate: false }
}
const FINDING_FIELDS = ['title', 'description', 'quote', 'location', 'recommendation', 'severity', 'area', 'dealImpact', 'norms', 'docId']
const sevOk = (s) => ['red', 'amber', 'green', 'info'].includes(s)

app.get('/api/dd/config', (_req, res) => res.json({ areas: DD_AREAS.map(({ key, label, profession, documents, code }) => ({ key, label, profession, documents, code })), presets: REVIEW_TABLE_PRESETS, severities: SEVERITY_LABEL, dealImpacts: DEAL_IMPACT_LABEL, reviewStatus: REVIEW_LABEL, limits: { maxDocs: DD_MAX_DOCS, maxDocBytes: DD_MAX_DOC_BYTES, maxConcurrent: DD_MAX_CONCURRENT }, models: { main: MODEL_MAIN, extract: MODEL_EXTRACT, knowledgeBase: AISSOCIATE_API_KEY ? 'AI:ssociate' : null } }))

// ---- findings: reviewer decisions and manual findings ----
app.patch('/api/matters/:id/findings/:fid', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  const f = m.findings.find((x) => x.id === req.params.fid)
  if (!f) return res.status(404).json({ error: 'Befund nicht gefunden.' })
  const b = req.body || {}
  f.review ||= { status: 'open', severity: null, note: '', ts: null }
  if (b.review && typeof b.review === 'object') {
    if (REVIEW_STATUS.includes(b.review.status)) f.review.status = b.review.status
    if ('severity' in b.review) f.review.severity = sevOk(b.review.severity) ? b.review.severity : null
    if (typeof b.review.note === 'string') f.review.note = b.review.note.slice(0, 1000)
    f.review.ts = Date.now()
  }
  // Content edits by the reviewer mark the finding as modified.
  let edited = false
  for (const k of FINDING_FIELDS) {
    if (!(k in b) || k === 'docId') continue
    if (k === 'severity' && !sevOk(b[k])) continue
    if (k === 'area' && !DD_AREA_KEYS.includes(b[k]) && b[k] !== 'none') continue
    if (k === 'dealImpact' && !DEAL_IMPACTS.includes(b[k])) continue
    if (k === 'norms') { if (!Array.isArray(b[k])) continue; f.norms = b[k].map(String).slice(0, 8); f.normStatus = []; edited = true; continue }
    if (typeof b[k] !== 'string') continue
    f[k] = b[k].slice(0, k === 'description' || k === 'recommendation' ? 4000 : 600); edited = true
  }
  if (edited) { if (f.review.status === 'open' || f.review.status === 'accepted') f.review.status = 'modified'; f.review.ts = Date.now(); const d = m.documents.find((x) => x.id === f.docId); if (d && f.quote) f.evidence = locateQuote(await store.getText(m.id, d.id), f.quote).status }
  await store.saveMatter(m)
  res.json({ finding: f })
})
app.post('/api/matters/:id/findings', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  const b = req.body || {}
  const d = m.documents.find((x) => x.id === b.docId)
  if (!d) return res.status(400).json({ error: 'Dokument wählen.' })
  if (!String(b.title || '').trim()) return res.status(400).json({ error: 'Titel fehlt.' })
  const f = newFinding(m, d, { ...b, severity: sevOk(b.severity) ? b.severity : 'amber', area: DD_AREA_KEYS.includes(b.area) ? b.area : d.area, deal_impact: b.dealImpact, norms: Array.isArray(b.norms) ? b.norms : String(b.norms || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean), source: 'manual' })
  f.review = { status: 'accepted', severity: null, note: String(b.note || '').slice(0, 1000), ts: Date.now() }
  f.evidence = f.quote ? locateQuote(await store.getText(m.id, d.id), f.quote).status : 'unverified'
  m.findings.push(f)
  await store.saveMatter(m)
  res.json({ finding: f })
})
app.delete('/api/matters/:id/findings/:fid', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  const i = m.findings.findIndex((x) => x.id === req.params.fid)
  if (i < 0) return res.status(404).json({ error: 'Befund nicht gefunden.' })
  if (m.findings[i].source !== 'manual') return res.status(400).json({ error: 'Modellbefunde werden verworfen, nicht gelöscht.' })
  m.findings.splice(i, 1)
  await store.saveMatter(m)
  res.json({ ok: true })
})
app.get('/api/matters/:id/dd/estimate', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  const p = priceFor(MODEL_EXTRACT)
  res.json({ estimate: estimateRun(m, p.in, p.out), usage: m.job.usage, budgetTokens: m.settings.budgetTokens, budgetOutTokens: m.settings.budgetOutTokens })
})

app.get('/api/matters', async (req, res) => {
  const owner = ownerOf(req)
  if (!owner) return res.status(401).json({ error: 'Kein Arbeitsbereich-Schlüssel (X-Owner-Key).' })
  try { res.json({ matters: (await store.listMatters(owner)).map(matterSummary) }) } catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/matters', async (req, res) => {
  const owner = ownerOf(req)
  if (!owner) return res.status(401).json({ error: 'Kein Arbeitsbereich-Schlüssel (X-Owner-Key).' })
  const b = req.body || {}
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Bitte einen Namen für den Akt angeben.' })
  try {
    const m = newMatter({ ownerKey: owner, name: String(b.name).trim(), kind: b.kind, client: b.client, settings: b.settings && typeof b.settings === 'object' ? b.settings : {} })
    await store.saveMatter(m)
    res.json({ matter: matterView(m) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.get('/api/matters/:id', async (req, res) => { const m = await loadMatter(req, res); if (m) res.json({ matter: matterView(m) }) })
app.patch('/api/matters/:id', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  const b = req.body || {}
  if (typeof b.name === 'string' && b.name.trim()) m.name = b.name.trim().slice(0, 120)
  if (typeof b.client === 'string') m.client = b.client.slice(0, 120)
  if (b.settings && typeof b.settings === 'object') m.settings = newMatter({ ownerKey: m.ownerKey, name: m.name, settings: { ...m.settings, ...b.settings } }).settings
  await store.saveMatter(m)
  res.json({ matter: matterView(m) })
})
app.delete('/api/matters/:id', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  if (ddRuns.has(m.id)) return res.status(409).json({ error: 'Für diesen Akt läuft gerade ein Vorgang – zuerst pausieren.' })
  await store.deleteMatter(m.id)
  res.json({ ok: true })
})

// ---- documents ----
app.post('/api/matters/:id/documents', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  const files = Array.isArray(req.body?.files) ? req.body.files.slice(0, 20) : []
  const added = [], errors = []
  for (const f of files) {
    if (!f || typeof f.name !== 'string' || typeof f.base64 !== 'string') continue
    try {
      const buf = Buffer.from(f.base64, 'base64')
      if (!buf.length) throw new Error('leere Datei')
      const r = await addDocumentFromBuffer(m, { name: f.name, buf, source: 'upload' })
      if (r.duplicate) errors.push(`${f.name}: bereits im Akt`); else added.push(r.doc)
    } catch (e) { errors.push(`${f.name}: ${e.message}`) }
  }
  await store.saveMatter(m)
  res.json({ added, errors, documents: m.documents })
})
app.delete('/api/matters/:id/documents/:docId', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  if (ddRuns.has(m.id)) return res.status(409).json({ error: 'Während eines laufenden Vorgangs können keine Dokumente entfernt werden.' })
  const i = m.documents.findIndex((d) => d.id === req.params.docId)
  if (i < 0) return res.status(404).json({ error: 'Dokument nicht gefunden.' })
  const [d] = m.documents.splice(i, 1)
  m.findings = m.findings.filter((f) => f.docId !== d.id)
  for (const t of m.tables || []) t.rows = (t.rows || []).filter((r) => r.docId !== d.id)
  try { await store.deleteDocument(m.id, d.id, d.file) } catch {}
  await store.saveMatter(m)
  res.json({ ok: true, documents: m.documents })
})
app.get('/api/matters/:id/documents/:docId/text', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  const d = m.documents.find((x) => x.id === req.params.docId)
  if (!d) return res.status(404).json({ error: 'Dokument nicht gefunden.' })
  const text = await store.getText(m.id, d.id)
  const offset = Math.max(0, Number(req.query.offset) || 0), limit = Math.min(200_000, Math.max(1000, Number(req.query.limit) || 60_000))
  res.json({ name: d.name, chars: text.length, offset, text: text.slice(offset, offset + limit) })
})
const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json' }
const sendFile = (res, name, buf) => { res.setHeader('Content-Type', MIME[name.toLowerCase().split('.').pop()] || 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`); res.send(buf) }
app.get('/api/matters/:id/documents/:docId/file', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  const d = m.documents.find((x) => x.id === req.params.docId)
  const buf = d?.file ? await store.getFile(m.id, d.file) : null
  if (!buf) return res.status(404).json({ error: 'Datei nicht gefunden.' })
  sendFile(res, d.name, buf)
})

// ---- import from OneDrive / SharePoint (single files or a whole folder = data room) ----
app.post('/api/matters/:id/import-ms', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  if (!MS.clientId) return res.status(503).json({ error: 'Microsoft 365 ist nicht konfiguriert.' })
  const auth = await msAccessToken(req, res, 30 * 60_000)
  if (!auth) return res.status(401).json({ error: 'Nicht mit Microsoft 365 verbunden.', reauth: true })
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).filter((f) => f && typeof f.driveId === 'string' && typeof f.itemId === 'string').slice(0, DD_MAX_DOCS)
  const folder = req.body?.folder && typeof req.body.folder.driveId === 'string' && typeof req.body.folder.itemId === 'string' ? req.body.folder : null
  if (!items.length && !folder) return res.status(400).json({ error: 'Keine Dateien oder Ordner gewählt.' })
  let jobId
  try {
    jobId = startMatterJob(m, 'import', async ({ send }) => {
      let token = auth.token
      const list = items.map((f) => ({ ...f }))
      const progress = (message) => send('dd', { matterId: m.id, stage: 'import', progress: m.job.progress, message })
      if (folder) {
        m.job.progress = { done: 0, total: 0 }
        progress('Ordner wird gelesen…')
        const walk = async (driveId, itemId, depth) => {
          let next = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children?${ITEM_SELECT}&$top=200`
          while (next && list.length + m.documents.length < DD_MAX_DOCS) {
            const page = await graph(token, next)
            for (const it of page.value || []) {
              if (list.length + m.documents.length >= DD_MAX_DOCS) break
              if (it.folder) { if (depth < 5) await walk(driveId, it.id, depth + 1) }
              else if (DOC_EXT.test(it.name || '') && (it.size || 0) <= DD_MAX_DOC_BYTES) list.push({ driveId, itemId: it.id, name: it.name })
            }
            next = page['@odata.nextLink'] || null
          }
        }
        await walk(folder.driveId, folder.itemId, 0)
      }
      m.job.progress = { done: 0, total: list.length }
      let added = 0, failed = 0
      for (const f of list) {
        if (m.job.pauseRequested) break
        try {
          const { meta, buf } = await msDownload(token, f.driveId, f.itemId)
          const r = await addDocumentFromBuffer(m, { name: meta.name, buf, source: 'ms', ms: { driveId: f.driveId, itemId: f.itemId, webUrl: meta.webUrl || '', parentId: meta.parentId || '' } })
          if (!r.duplicate) added++
          m.job.progress.done++
          progress(`Importiert: ${meta.name}`)
        } catch (e) {
          failed++
          m.job.progress.done++
          m.job.log.push({ t: Date.now(), message: `Import fehlgeschlagen: ${f.name || f.itemId} · ${e.message}` })
          progress(`Fehler: ${f.name || f.itemId} · ${String(e.message).slice(0, 120)}`)
          if (e?.status === 401 && auth.session?.rt) { try { token = (await msRefreshToCache(req, auth.session)).token } catch {} }
        }
        if (m.job.progress.done % 5 === 0) await store.saveMatter(m)
      }
      m.job.pauseRequested = false
      await store.saveMatter(m)
      send('dd', { matterId: m.id, stage: 'import', progress: m.job.progress, status: 'done', message: `${added} Dokument${added === 1 ? '' : 'e'} importiert${failed ? `, ${failed} fehlgeschlagen` : ''}` })
    })
  } catch (e) { return res.status(e.status || 500).json({ error: e.message }) }
  if (!jobId) return res.status(409).json({ error: 'Für diesen Akt läuft bereits ein Vorgang.' })
  res.json({ jobId })
})

// ---- due diligence run / pause / report ----
app.post('/api/matters/:id/dd/run', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  if (!m.documents.length) return res.status(400).json({ error: 'Der Akt enthält noch keine Dokumente.' })
  if (req.body?.reanalyse && !ddRuns.has(m.id)) {
    for (const d of m.documents) if (d.status === 'analysed') d.status = 'extracted'
    m.findings = []; m.areaSummaries = {}; m.executive = null; m.verification = null
  }
  if (req.body?.retryErrors && !ddRuns.has(m.id)) for (const d of m.documents) if (d.status === 'error') { d.status = 'new'; d.note = '' }
  let jobId
  try { jobId = startMatterJob(m, 'dd', (deps) => runDd(m, deps)) } catch (e) { return res.status(e.status || 500).json({ error: e.message }) }
  if (!jobId) return res.status(409).json({ error: 'Für diesen Akt läuft bereits ein Vorgang.' })
  res.json({ jobId })
})
app.post('/api/matters/:id/dd/pause', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  if (!ddRuns.has(m.id)) return res.json({ ok: true, running: false })
  m.job.pauseRequested = true
  res.json({ ok: true, running: true })
})
app.post('/api/matters/:id/report', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  if (ddRuns.has(m.id)) return res.status(409).json({ error: 'Bitte warten, bis der laufende Vorgang beendet ist.' })
  try { const names = await buildReports(m, ddDeps(() => {})); res.json({ reports: m.reports, created: names }) } catch (e) { res.status(500).json({ error: e.message }) }
})
app.get('/api/matters/:id/reports/:file', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  const buf = await store.getReport(m.id, String(req.params.file))
  if (!buf) return res.status(404).json({ error: 'Bericht nicht gefunden.' })
  sendFile(res, String(req.params.file), buf)
})

// ---- review tables ----
app.post('/api/matters/:id/tables', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  const b = req.body || {}
  const preset = REVIEW_TABLE_PRESETS.find((p) => p.key === b.preset)
  const columns = [...new Set((Array.isArray(b.columns) && b.columns.length ? b.columns : preset?.columns || []).map((c) => String(c).trim().slice(0, 80)).filter(Boolean))].slice(0, 16)
  if (!columns.length) return res.status(400).json({ error: 'Bitte mindestens eine Spalte angeben.' })
  const docIds = (Array.isArray(b.docIds) ? b.docIds : []).map(String).filter((id) => m.documents.some((d) => d.id === id))
  const table = { id: JsonStore.newId('t'), name: String(b.name || preset?.label || 'Tabelle').slice(0, 100), columns, docIds, rows: [], status: 'new', createdAt: Date.now(), updatedAt: Date.now() }
  m.tables = m.tables || []
  m.tables.push(table)
  await store.saveMatter(m)
  let jobId = null
  try { jobId = startMatterJob(m, 'table', (deps) => runReviewTable(m, table, deps)) } catch (e) { return res.status(e.status || 500).json({ error: e.message, table }) }
  res.json({ table, jobId })
})
app.post('/api/matters/:id/tables/:tid/run', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  const t = (m.tables || []).find((x) => x.id === req.params.tid)
  if (!t) return res.status(404).json({ error: 'Tabelle nicht gefunden.' })
  let jobId
  try { jobId = startMatterJob(m, 'table', (deps) => runReviewTable(m, t, deps)) } catch (e) { return res.status(e.status || 500).json({ error: e.message }) }
  if (!jobId) return res.status(409).json({ error: 'Für diesen Akt läuft bereits ein Vorgang.' })
  res.json({ jobId })
})
app.delete('/api/matters/:id/tables/:tid', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  m.tables = (m.tables || []).filter((x) => x.id !== req.params.tid)
  await store.saveMatter(m)
  res.json({ ok: true, tables: m.tables })
})
app.get('/api/matters/:id/tables/:tid/xlsx', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  const t = (m.tables || []).find((x) => x.id === req.params.tid)
  if (!t) return res.status(404).json({ error: 'Tabelle nicht gefunden.' })
  try { sendFile(res, `${t.name.replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim().replace(/\s+/g, '_') || 'Tabelle'}.xlsx`, await tableXlsx(m, t)) } catch (e) { res.status(500).json({ error: e.message }) }
})

// ---- write reports back to OneDrive / SharePoint ----
app.post('/api/matters/:id/sync', async (req, res) => {
  const m = await loadMatter(req, res); if (!m) return
  if (!MS.clientId) return res.status(503).json({ error: 'Microsoft 365 ist nicht konfiguriert.' })
  const auth = await msAccessToken(req, res, 5 * 60_000)
  if (!auth) return res.status(401).json({ error: 'Nicht mit Microsoft 365 verbunden.', reauth: true })
  const { driveId, itemId } = req.body || {}
  if (typeof driveId !== 'string' || typeof itemId !== 'string') return res.status(400).json({ error: 'Zielordner fehlt.' })
  const names = (Array.isArray(req.body?.files) && req.body.files.length ? req.body.files : (m.reports || []).map((r) => r.name)).map(String).slice(0, 20)
  const results = []
  let token = auth.token
  for (const name of names) {
    const buf = await store.getReport(m.id, name)
    if (!buf) { results.push({ name, ok: false, error: 'Bericht nicht gefunden' }); continue }
    try {
      let it
      try { it = await msUpload(token, driveId, itemId, name, buf) }
      catch (e) { if (e?.status !== 401 || !auth.session?.rt) throw e; token = (await msRefreshToCache(req, auth.session)).token; it = await msUpload(token, driveId, itemId, name, buf) }
      results.push({ name: it.name || name, webUrl: it.webUrl || '', ok: true })
    } catch (e) { results.push({ name, ok: false, error: String(e?.message || e).slice(0, 200) }) }
  }
  res.json({ sync: results })
})

app.post('/api/chat', async (req, res) => {
  const body = req.body ?? {}
  // The client may supply the job id so it can resume even if this response never arrives.
  const jobId = typeof body.jobId === 'string' && /^[\w-]{8,64}$/.test(body.jobId) && !jobs.has(body.jobId) ? body.jobId : `j_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  // The Microsoft 365 token is resolved before the SSE headers go out (a refresh may set cookies).
  const wantsMs = Array.isArray(body.msFiles) && body.msFiles.length > 0 || (body.msSync && body.msSync.enabled !== false && body.msSync.driveId)
  // Ask for a token that outlives the job (jobs can run for many minutes); a refresh now still sets cookies.
  const msAuth = MS.clientId && wantsMs ? await msAccessToken(req, res, 30 * 60_000) : null
  // Questions about a matter (Akte): its analysis becomes context, chosen documents become attachments.
  let matterReq = null, matterDocs = []
  if (typeof body.matterId === 'string' && body.matterId) {
    const owner = ownerOf(req)
    try { matterReq = owner ? await store.getMatter(body.matterId) : null } catch {}
    if (!matterReq || matterReq.ownerKey !== owner) return res.status(404).json({ error: 'Akt nicht gefunden.' })
    const ids = new Set((Array.isArray(body.matterDocIds) ? body.matterDocIds : []).map(String))
    matterDocs = matterReq.documents.filter((d) => ids.has(d.id) && ['extracted', 'analysed'].includes(d.status)).slice(0, MAX_UPLOADS)
  }
  const job = newJob(jobId)
  const send = job.send
  attachListener(job, res, 0)
  send('job', { id: jobId })
  const finish = () => job.finish()

  if (!OPENAI_API_KEY) { send('error', { message: 'Server: OPENAI_API_KEY fehlt.' }); return finish() }

  const { history = [], files: rawUploads = [], sessionId, webSearch = true, task = null, aissThreadId = null, msFiles: rawMsFiles = [], msSync = null } = body
  // Knowledge base picked in the UI ("Automatisch" sends nothing): pins the legal area, the planner still decides the mode.
  const pickedArea = typeof body.legalArea === 'string' && LEGAL_AREAS[body.legalArea] ? body.legalArea : null
  const pickedScope = pickedArea === 'public' && typeof body.scope === 'string' && SCOPES.includes(body.scope) ? body.scope : null
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
  const msFilesReq = (Array.isArray(rawMsFiles) ? rawMsFiles : []).filter((f) => f && typeof f.driveId === 'string' && typeof f.itemId === 'string').slice(0, MAX_UPLOADS)
  const msSources = [] // metadata of files fetched from Microsoft 365 (default write-back folder)

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
  let inlineAll = false // attachments handed to the model as full text (set once they are extracted)
  let heavy = false, workModel = MODEL_FAST // everything runs on the fast model; hard tasks switch to the main model
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
  async function runAissociate({ question, legalArea, scope, stream, brief = true, label: stepLabel = '' }) {
    aissCalls++
    const label = LEGAL_AREA_LABEL[legalArea] || 'allgemein'
    const sid = step('aissociate', `AI:ssociate recherchiert (${label}${scope ? ', ' + scope : ''})${stepLabel ? ' – ' + stepLabel : ''}`, { model: 'aissociate' })
    if (brief) question = KB_BRIEF + question
    const t0 = Date.now()
    // Real progress events while the knowledge base works (can take minutes).
    const ticker = setInterval(() => send('step_update', { id: sid, status: 'running', detail: `recherchiert seit ${Math.round((Date.now() - t0) / 1000)} s…` }), 15_000)
    ticker.unref?.()
    // The knowledge base reports the documents it consults while it works: show
    // each one as a research step (that is the visible part of its agentic run).
    const found = []
    const onDocument = (src) => {
      const ev = addEvidence({ type: 'aissociate', url: src.url, title: src.title, raw: src.raw, read: true })
      if (found.includes(ev)) return
      found.push(ev)
      const ds = step('search', `AI:ssociate zieht heran: ${ev.title}`, { url: ev.url || undefined })
      stepDone(ds)
    }
    const onEvent = (type, text) => { if (text && typeof text === 'string' && text.trim() && !/^\s*[{[]/.test(text)) send('step_update', { id: sid, status: 'running', detail: text.trim().slice(0, 160) }) }
    const attempt = (tid) => { ctx.usage.aissociateCalls++; return askAissociate({ question, legalArea, scope, threadId: tid, onDelta: stream ? (t) => send('delta', { text: t }) : null, onDocument, onEvent }) }
    // Several questions run in parallel without a thread; a single question keeps the conversation thread.
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
      stepDone(sid, { detail: `Antwort erhalten${srcs.length ? ` · ${srcs.length} Dokument${srcs.length > 1 ? 'e' : ''} herangezogen` : ''}${r.errors.length ? ' · Hinweis: ' + r.errors[0].slice(0, 80) : ''}` })
      return { ...r, evidence: srcs }
    } catch (e) {
      stepFail(sid, { detail: String(e?.message || e).slice(0, 200) })
      throw e
    } finally { clearInterval(ticker) }
  }
  /** The planned questions (1–3) go to the knowledge base in ONE streamed request, numbered. */
  async function runAissociateMany({ questions, legalArea, scope }) {
    const qs = questions.slice(0, KB_MAX_QUESTIONS)
    const question = qs.length <= 1 ? qs[0] : `Beantworte die folgenden ${qs.length} Fragen getrennt und nummeriert:\n${qs.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
    const r = await runAissociate({ question, legalArea, scope, stream: true, label: qs.length > 1 ? `${qs.length} Fragen` : '' })
    return { answer: r.answer.trim(), evidence: r.evidence, questions: qs }
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
    // Streamed, so the user watches the knowledge base answer arrive while the document task waits for it.
    const r = await runAissociate({ question: String(args.question || ''), legalArea: LEGAL_AREAS[args.legal_area] ? args.legal_area : 'civil', scope: args.scope && SCOPES.includes(args.scope) ? args.scope : '', stream: true })
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
      const resp = await callModel(ctx, { model: MODEL_CODE || workModel, instructions: CODE_SYSTEM, input, effort: heavy ? EFFORT_CODE : EFFORT_PLAN, prevId, maxOut: 12_000 })
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
    const baseTools = [TOOL_FILE, ...(uploads.length && !inlineAll ? [TOOL_READ_DOCUMENT] : [])]
    for (let i = 1; i <= DOC_MAX_STEPS; i++) {
      // max_tool_calls caps built-in tool calls per response, so hand the model
      // only the web budget that is still left over the whole task.
      const remainingWeb = useWeb ? Math.max(0, MAX_WEB_SEARCHES - ctx.usage.webSearchCalls) : 0
      const tools = remainingWeb > 0 ? [...baseTools, WEB_SEARCH_TOOL] : baseTools
      const sid = step('think', i === 1 ? 'Ergebnis wird erstellt' : 'Zwischenergebnis wird ausgewertet', { model: workModel })
      let resp
      try { resp = await callModel(ctx, { model: workModel, instructions: docInstructions(useWeb), input, tools, effort: heavy ? EFFORT_MAIN : EFFORT_PLAN, prevId, maxToolCalls: remainingWeb > 0 ? remainingWeb : undefined }) } catch (e) { stepFail(sid, { detail: String(e?.message || e).slice(0, 160) }); throw e }
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
      const sid = step('think', 'Zusammenfassung (Schrittlimit)', { model: workModel })
      const resp = await callModel(ctx, { model: workModel, instructions: docInstructions(useWeb), input: [...input, { role: 'user', content: 'Schrittlimit erreicht. Antworte JETZT abschließend; kennzeichne offene Punkte.' }], effort: EFFORT_MAIN, prevId })
      collectWebCitations(resp)
      text = resp.output_text || ''
      stepDone(sid)
    }
    return text
  }

  try {
    // ---- 0a. files from OneDrive / SharePoint ----
    if (msFilesReq.length) {
      if (!msAuth) throw new Error('Nicht mit Microsoft 365 verbunden – bitte im Menü anmelden.')
      const sid = step('cloud', `${msFilesReq.length} Datei${msFilesReq.length > 1 ? 'en' : ''} aus Microsoft 365 laden`)
      let dropped = 0
      for (const f of msFilesReq) {
        if (uploads.length >= MAX_UPLOADS) { dropped++; continue }
        const { meta, buf } = await msDownload(msAuth.token, f.driveId, f.itemId)
        const name = path.basename(meta.name).replace(/[^\w.\- ()äöüÄÖÜß]/g, '_')
        if (!uploads.some((u) => u.name === name)) uploads.push({ name, buf })
        msSources.push(meta)
      }
      if (dropped) stepFail(sid, { detail: `${msSources.map((m) => m.name).join(', ')} · ${dropped} Datei${dropped > 1 ? 'en' : ''} nicht geladen (höchstens ${MAX_UPLOADS} Anhänge je Nachricht)` })
      else stepDone(sid, { detail: msSources.map((m) => m.name).join(', ') })
    }

    // ---- 0. uploads: extract text ----
    if (uploads.length) {
      const sid = step('read', `${uploads.length} Datei${uploads.length > 1 ? 'en' : ''} wird vorbereitet`)
      for (const u of uploads) uploadTexts.set(u.name, await extractText(u.name, u.buf))
      stepDone(sid, { detail: uploads.map((u) => `${u.name} (${(uploadTexts.get(u.name).text.length / 1000).toFixed(0)}k Zeichen)`).join(', ') })
    }

    // ---- 0b. matter context: the stored analysis (findings, summaries) and chosen documents ----
    let matterCtx = ''
    if (matterReq) {
      const sid = step('read', `Akt „${matterReq.name}“ wird eingebunden`)
      matterCtx = matterContext(matterReq, 60_000)
      for (const d of matterDocs) {
        if (uploads.length >= MAX_UPLOADS || uploads.some((u) => u.name === d.name)) continue
        const text = await store.getText(matterReq.id, d.id)
        const buf = d.file ? await store.getFile(matterReq.id, d.file) : null
        if (!text || !buf) continue
        uploads.push({ name: d.name, buf })
        uploadTexts.set(d.name, { text, pages: d.pages })
      }
      stepDone(sid, { detail: `${matterReq.documents.length} Dokumente, ${matterReq.findings.length} Befunde${matterDocs.length ? ` · ${matterDocs.length} Dokument${matterDocs.length > 1 ? 'e' : ''} angehängt` : ''}` })
    }

    const histInput = (Array.isArray(history) ? history : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 12_000) }))

    // Short attachments go in as full text (one Sol turn less); long ones via read_document.
    inlineAll = uploads.length > 0 && uploads.every((u) => !uploadTexts.get(u.name).unsupported) && uploads.reduce((n, u) => n + uploadTexts.get(u.name).text.length, 0) <= INLINE_DOC_CHARS
    const uploadLine = uploads.length
      ? `HOCHGELADENE DATEIEN (${inlineAll ? 'Volltext unten enthalten – nicht erneut lesen' : 'mit read_document lesen'}; für Dateiausgaben liegen sie in /home/user): ${uploads.map((u) => { const t = uploadTexts.get(u.name); return `${u.name} (${t.unsupported ? 'Typ nur per create_or_edit_file lesbar' : `${t.text.length} Zeichen Text, ${Math.max(1, Math.ceil(t.text.length / UPLOAD_PART_CHARS))} Teil(e)`})` }).join('; ')}\n\n`
      : ''
    const inlineDocs = inlineAll ? uploads.map((u) => `=== DOKUMENT: ${u.name}${uploadTexts.get(u.name).pages ? ` (${uploadTexts.get(u.name).pages} Seiten)` : ''} ===\n${uploadTexts.get(u.name).text}\n=== ENDE ${u.name} ===`).join('\n\n') + '\n\n' : ''
    const matterLine = matterCtx ? `AKTENKONTEXT (gespeicherte Analyse des Akts; Befunde mit Zitat und Fundstelle sind belegt, alles andere ist Zusammenfassung):\n${matterCtx}\n\n` : ''
    const userContent = (taskExtra ? taskExtra + '\n\n' : '') + matterLine + uploadLine + inlineDocs + prompt

    // ---- 1. plan: Luna decides the mode and formulates compact questions for the knowledge base ----
    const pid = step('triage', 'Anfrage wird analysiert', { model: MODEL_FAST })
    let plan = { mode: 'legal', legal_area: 'civil', scope: '', questions: [], title: prompt.slice(0, 60) }
    try {
      const planInput = [...histInput.slice(-6), { role: 'user', content: `${uploads.length ? `Hochgeladene Dateien: ${uploads.map((u) => u.name).join(', ')}\n` : ''}${task?.type ? `Workflow: ${task.type}\n` : ''}${pickedArea ? `Gewählte Wissensdatenbank: ${LEGAL_AREA_LABEL[pickedArea]}${pickedScope ? ` (${pickedScope})` : ''} – Rechtsfragen in diesem Rechtsgebiet beantworten.\n` : ''}${taskExtra ? taskExtra.slice(0, 2000) + '\n' : ''}${matterCtx ? `AKTENKONTEXT (Auszug; relevante Fakten in die Fragen an die Wissensdatenbank einarbeiten):\n${matterCtx.slice(0, 6000)}\n\n` : ''}${inlineAll ? `DOKUMENTTEXT (Auszug):\n${uploads.map((u) => `--- ${u.name} ---\n${uploadTexts.get(u.name).text.slice(0, 12_000)}`).join('\n')}\n\n` : ''}ANFRAGE:\n${prompt.slice(0, 8000)}` }]
      const planFormat = { format: { type: 'json_schema', name: 'plan', schema: PLAN_SCHEMA, strict: true } }
      // max_output_tokens includes reasoning tokens: retry once with more room if truncated.
      let pr = await callModel(ctx, { model: MODEL_FAST, instructions: PLAN_INSTRUCTIONS, effort: EFFORT_PLAN, maxOut: 6000, input: planInput, text: planFormat })
      let parsed = parseJsonLoose(pr.output_text || '')
      if (!parsed?.mode && pr.status === 'incomplete') {
        pr = await callModel(ctx, { model: MODEL_FAST, instructions: PLAN_INSTRUCTIONS, effort: EFFORT_PLAN, maxOut: 16_000, input: planInput, text: planFormat })
        parsed = parseJsonLoose(pr.output_text || '')
      }
      if (parsed?.mode) plan = { ...plan, ...parsed, questions: Array.isArray(parsed.questions) ? parsed.questions.map((q) => String(q).trim()).filter(Boolean).slice(0, KB_MAX_QUESTIONS) : (parsed.question ? [String(parsed.question)] : []) }
      else console.error('plan: no usable JSON, using defaults')
    } catch (e) { console.error('plan failed:', e?.message) }
    if (uploads.length) plan.mode = 'document'
    // A preset decides the mode, except that attached documents must not be ignored.
    if (forceMode && !(uploads.length && forceMode === 'legal')) plan.mode = forceMode
    if (!LEGAL_AREAS[plan.legal_area]) plan.legal_area = plan.mode === 'legal' ? 'civil' : 'none'
    if (!SCOPES.includes(plan.scope)) plan.scope = ''
    if (pickedArea && plan.mode !== 'general') { plan.legal_area = pickedArea; if (pickedArea === 'public') plan.scope = pickedScope || plan.scope; else plan.scope = '' }
    if (plan.mode === 'legal' && !plan.questions.length) plan.questions = [prompt]
    if (plan.mode === 'general') plan.questions = []
    heavy = plan.difficulty === 'hard'
    workModel = heavy ? MODEL_MAIN : MODEL_FAST
    const areaLabel = LEGAL_AREA_LABEL[plan.legal_area] || 'allgemein'
    stepDone(pid, { detail: `${plan.mode === 'legal' ? `Rechtsfrage · ${areaLabel}${plan.scope ? ' (' + plan.scope + ')' : ''}` : plan.mode === 'document' ? 'Dokumentaufgabe' : 'Allgemeine Aufgabe'}${plan.questions.length ? ` · ${plan.questions.length} Frage${plan.questions.length > 1 ? 'n' : ''} an AI:ssociate` : ''}${heavy ? ' · komplexe Aufgabe' : ''}` })
    for (const [i, q] of plan.questions.entries()) { const qs = step('question', `Frage ${plan.questions.length > 1 ? i + 1 + ': ' : ''}${q.slice(0, 220)}`, { model: MODEL_FAST }); stepDone(qs) }
    const usedModels = () => Object.keys(ctx.usage.byModel)
    send('route', { route: plan.mode, legalArea: plan.legal_area, legalAreaLabel: areaLabel, scope: plan.scope, title: plan.title, questions: plan.questions, difficulty: plan.difficulty, models: { main: workModel, used: usedModels(), code: MODEL_CODE || workModel, knowledgeBase: heavy && plan.questions.length ? 'AI:ssociate' : null } })
    assertAlive()

    // ---- 2. answer ----
    let answer = ''
    let verdict = null
    try {
      if (plan.mode === 'legal' && !heavy) {
        // Easy legal question: answered directly on the fast model with a short web search.
        const sid = step('think', 'Antwort wird formuliert', { model: workModel })
        const resp = await callModel(ctx, { model: workModel, instructions: easyLegalInstructions(useWeb), effort: EFFORT_PLAN, maxOut: 6000, input: [...histInput, { role: 'user', content: userContent }], tools: useWeb ? [WEB_SEARCH_TOOL] : undefined, maxToolCalls: useWeb ? MAX_WEB_SEARCHES : undefined })
        collectWebCitations(resp)
        emitWebSteps(resp)
        stepDone(sid, { detail: ctx.usage.webSearchCalls ? `${ctx.usage.webSearchCalls} Websuche${ctx.usage.webSearchCalls > 1 ? 'n' : ''}` : 'ohne Websuche' })
        verdict = 'web'
        answer = (resp.output_text || '').trim()
      } else if (plan.mode === 'legal') {
        let kb = null
        try {
          kb = await runAissociateMany({ questions: plan.questions, legalArea: plan.legal_area, scope: plan.scope })
        } catch (e) { console.error('aissociate failed:', e?.message) }
        if (kb && kb.answer.trim()) {
          // The knowledge-base answer is the deliverable and is shown as is; the
          // optional Sol review (REVIEW_ANSWERS=on) only adds to it.
          answer = kb.answer.trim()
          verdict = 'direct'
          assertAlive()
          if (REVIEW_ANSWERS) {
          const sid = step('think', 'Antwort wird geprüft', { model: MODEL_MAIN })
          try {
            const resp = await callModel(ctx, {
              model: MODEL_MAIN, instructions: reviewInstructions(useWeb), effort: EFFORT_MAIN, maxOut: 8000,
              input: [...histInput, { role: 'user', content: `NUTZERFRAGE:\n${prompt}\n\nFRAGEN AN DIE WISSENSDATENBANK (${areaLabel}):\n${plan.questions.join('\n')}\n\nANTWORT DER WISSENSDATENBANK:\n${kb.answer}${kb.evidence.length ? `\n\nDOKUMENTE DER WISSENSDATENBANK:\n${kb.evidence.map((e) => `[${e.marker}] ${e.title}${e.url ? ' · ' + e.url : ''}`).join('\n')}` : ''}` }],
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
            if (supplement.length > 15) answer += verdict === 'sufficient' ? `\n\n**Hinweis**\n\n${supplement}` : `\n\n---\n\n**Ergänzung (Websuche)**\n\n${supplement}`
          } catch (e) {
            console.error('review failed:', e?.message)
            verdict = 'unreviewed'
            stepFail(sid, { detail: `Prüfung übersprungen: ${String(e?.message || e).slice(0, 140)}` })
            answer += '\n\n> Hinweis: Die Nachprüfung konnte nicht durchgeführt werden; dies ist die ungeprüfte Antwort der Wissensdatenbank.'
          }
          }
        } else {
          // Knowledge base unavailable → Sol answers directly with ≤3 web searches.
          assertAlive()
          const sid = step('think', 'Antwort ohne Wissensdatenbank (nicht erreichbar)', { model: workModel })
          const resp = await callModel(ctx, { model: workModel, instructions: directInstructions(useWeb), effort: heavy ? EFFORT_MAIN : EFFORT_PLAN, input: [...histInput, { role: 'user', content: userContent }], tools: useWeb ? [WEB_SEARCH_TOOL] : undefined, maxToolCalls: useWeb ? MAX_WEB_SEARCHES : undefined })
          collectWebCitations(resp)
          emitWebSteps(resp)
          stepDone(sid, { detail: ctx.usage.webSearchCalls ? `${ctx.usage.webSearchCalls} Websuche${ctx.usage.webSearchCalls > 1 ? 'n' : ''}` : 'ohne Websuche' })
          verdict = 'fallback'
          answer = (resp.output_text || '').trim()
          answer = `> Hinweis: Die juristische Wissensdatenbank (AI:ssociate) war nicht erreichbar; diese Antwort wurde ohne die Wissensdatenbank erstellt (mit Websuche).\n\n${answer}`
        }
      } else if (plan.mode === 'document') {
        // First pass: the knowledge base answers Luna's questions (short); then Sol
        // builds the deliverable from document + answers, or just answers.
        let kbBlock = ''
        if (heavy && plan.questions.length && plan.legal_area !== 'none') {
          try { const kb = await runAissociateMany({ questions: plan.questions, legalArea: plan.legal_area, scope: plan.scope }); kbBlock = `ANTWORTEN DER WISSENSDATENBANK (AI:ssociate, ${areaLabel}):\n${kb.answer}${kb.evidence.length ? `\n\nDOKUMENTE DER WISSENSDATENBANK:\n${kb.evidence.map((e) => `[${e.marker}] ${e.title}${e.url ? ' · ' + e.url : ''}`).join('\n')}` : ''}\n\n` }
          catch (e) { console.error('aissociate (document) failed:', e?.message); kbBlock = 'HINWEIS: Die Wissensdatenbank war nicht erreichbar – rechtliche Aussagen ausdrücklich als nicht verifiziert kennzeichnen.\n\n' }
        }
        answer = await documentLoop({ input: [...histInput, { role: 'user', content: kbBlock + userContent }] })
      } else {
        const sid = step('think', 'Antwort wird formuliert', { model: workModel })
        const resp = await callModel(ctx, { model: workModel, instructions: GENERAL_INSTRUCTIONS, effort: heavy ? EFFORT_MAIN : EFFORT_PLAN, input: [...histInput, { role: 'user', content: userContent }] })
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

    // ---- 4. link citations in the answer text to the RIS (verified ones, else
    //         to the matching knowledge-base document) ----
    if (verification) {
      const extraUrls = new Map()
      for (const e of evidence) if (e.type === 'aissociate' && e.url) { const c = extractNormCitations(e.title || '')[0]; if (c && !extraUrls.has(c.label)) extraUrls.set(c.label, e.url) }
      answer = linkCitations(answer, verification, extraUrls)
    }

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

    // ---- 5b. write results back to OneDrive / SharePoint ----
    const sync = []
    const target = msSync && typeof msSync === 'object' && msSync.driveId && msSync.itemId
      ? { driveId: String(msSync.driveId), itemId: String(msSync.itemId), name: String(msSync.name || '') }
      : msSources[0]?.driveId && msSources[0]?.parentId ? { driveId: msSources[0].driveId, itemId: msSources[0].parentId, name: 'Ordner der Quelldatei' } : null
    if (!msAuth && target && !(msSync && msSync.enabled === false) && MS.clientId) {
      sync.push({ name: 'Rückschreiben nach Microsoft 365', webUrl: '', ok: false, error: 'Nicht mit Microsoft 365 verbunden – bitte im Menü erneut anmelden.' })
    }
    if (msAuth && target && !(msSync && msSync.enabled === false)) {
      const toUpload = filesOut.filter((f) => f.base64 && !f.tooLarge).map((f) => ({ name: f.name, buf: Buffer.from(f.base64, 'base64') }))
      // The job may have outlived the token: refresh into the cache (cookies are already sent).
      let token = msAuth.token
      try { const fresh = await msAccessToken(req, null, 5 * 60_000); if (fresh?.token) token = fresh.token } catch {}
      const uploadWithRetry = async (f) => {
        try { return await msUpload(token, target.driveId, target.itemId, f.name, f.buf) }
        catch (e) {
          if (e?.status !== 401 || !msAuth.session?.rt) throw e
          token = (await msRefreshToCache(req, msAuth.session)).token
          return msUpload(token, target.driveId, target.itemId, f.name, f.buf)
        }
      }
      if (!(msSync && msSync.saveAnswer === false) && answer.trim() && plan.mode !== 'general') {
        try {
          const stem = (plan.title || 'Antwort').replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'Antwort'
          toUpload.push({ name: `AIssociate_${stem}_${new Date().toISOString().slice(0, 10)}.docx`, buf: await markdownToDocx(plan.title || 'Antwort', answer) })
        } catch (e) { console.error('answer docx failed:', e?.message) }
      }
      if (toUpload.length) {
        const sid = step('cloud', `${toUpload.length} Datei${toUpload.length > 1 ? 'en' : ''} nach Microsoft 365 speichern${target.name ? ` (${target.name})` : ''}`)
        for (const f of toUpload) {
          try { const it = await uploadWithRetry(f); sync.push({ name: it.name || f.name, webUrl: it.webUrl || '', ok: true }) }
          catch (e) { sync.push({ name: f.name, webUrl: '', ok: false, error: String(e?.message || e).slice(0, 200) }) }
        }
        const okN = sync.filter((s) => s.ok).length
        if (okN === sync.length) stepDone(sid, { detail: sync.map((s) => s.name).join(', ') })
        else stepFail(sid, { detail: `${okN}/${sync.length} gespeichert · ${sync.find((s) => !s.ok)?.error || ''}` })
      }
    }

    const cited = new Set([...answer.matchAll(/\[Q(\d+)\]/g)].map((m) => 'Q' + m[1]))
    // Knowledge-base documents are always shown; web citations are shown directly when the web search contributed.
    const sources = evidence.map((e) => ({ marker: e.marker, type: e.type, title: e.title, url: e.url, read: Boolean(e.read), cited: cited.has(e.marker) || e.type === 'aissociate' || (e.type === 'web' && verdict !== 'sufficient'), raw: e.raw || null }))

    send('final', {
      answer, sources, verification, title: plan.title, route: plan.mode, legalArea: plan.legal_area, legalAreaLabel: areaLabel, scope: plan.scope, verdict,
      models: { main: workModel, used: Object.keys(ctx.usage.byModel), code: MODEL_CODE || workModel, knowledgeBase: aissOk ? 'AI:ssociate' : null }, questions: plan.questions, difficulty: plan.difficulty,
      aissThreadId: aissThreadOut,
      sync, syncTarget: target,
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
    console.log(`AI:ssociate Playground listening on http://localhost:${PORT} (fast=${MODEL_FAST}, main=${MODEL_MAIN}, kb=${AISSOCIATE_BASE_URL})`)
  })
}

// Exported for tests (NO_LISTEN=1).
export { extractNormCitations, extractDecisionCitations, normalizeRisDoc, htmlToText, markdownToDocx, askAissociate, parseSseBlock, sourceFromDocumentEvent, risLinkForDocNumber, linkCitations, normQueryParams, verifyNormList, seal, unseal, app, store }
