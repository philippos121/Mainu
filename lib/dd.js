// Due-diligence pipeline: explicit, resumable, auditable.
//
// Stages (each persisted per document, so a run can be paused and resumed):
//   extract   → text of every document (pdf/docx/txt), scanned PDFs are flagged
//   analyse   → per-document structured analysis (type, area, parties, terms,
//               findings with quote + location + severity) with a fixed JSON
//               schema; long documents are processed in chunks and merged
//   synthesize→ per-area synthesis across documents (cross-document issues,
//               missing documents, request list, deal recommendations)
//   summary   → executive summary + overall assessment
//   verify    → every cited norm is checked against the RIS (deterministic)
//   report    → Word report + Excel workbook (explicit templates, no code generation)
//
// Review tables ("Tabellen") reuse the per-document runner with user-defined
// columns; every cell carries a quote and a location.
import { DD_AREAS, DD_AREA_KEYS, DOC_ANALYSIS_SCHEMA, AREA_SYNTHESIS_SCHEMA, EXEC_SUMMARY_SCHEMA, SEVERITIES, DEAL_IMPACTS, TRANSACTION_NOTES, REVIEW_STATUS } from './ddconfig.js'
import { buildDdDocx, buildDdXlsx, buildTableXlsx } from './report.js'
import { JsonStore } from './store.js'

// Large sections (the model reads long contexts well): fewer calls, all of them in parallel.
const CHUNK_CHARS = 150_000
const CHUNK_OVERLAP = 2_000
const MAX_CHUNKS_PER_DOC = 8
const SEV_RANK = { red: 0, amber: 1, green: 2, info: 3 }
// Hard limit per due diligence (all runs together), not adjustable in the UI.
export const DD_HARD_IN = Number(process.env.DD_MAX_INPUT_TOKENS || 100_000_000)
export const DD_HARD_OUT = Number(process.env.DD_MAX_OUTPUT_TOKENS || 10_000_000)
// The knowledge base only for very hard questions of red findings, at most this many per run.
const DD_MAX_KB_CALLS = Number(process.env.DD_MAX_KB_CALLS || 5)

/** Runs async tasks with at most n at a time (one pool for all model calls of a run). */
function pool(n) {
  let active = 0
  const waiting = []
  const next = () => { if (active >= n || !waiting.length) return; active++; const { fn, ok, fail } = waiting.shift(); Promise.resolve().then(fn).then(ok, fail).finally(() => { active--; next() }) }
  return (fn) => new Promise((ok, fail) => { waiting.push({ fn, ok, fail }); next() })
}

export function newMatter({ ownerKey, name, kind = 'matter', client = '', settings = {} }) {
  const s = {
    transaction: settings.transaction === 'asset' ? 'asset' : 'share',
    perspective: settings.perspective === 'seller' ? 'seller' : 'buyer',
    areas: Array.isArray(settings.areas) && settings.areas.length ? settings.areas.filter((a) => DD_AREA_KEYS.includes(a)) : DD_AREA_KEYS.slice(),
    materialityEur: Number(settings.materialityEur) > 0 ? Number(settings.materialityEur) : 50_000,
    target: String(settings.target || '').slice(0, 200),
    reference: String(settings.reference || '').slice(0, 60),
    budgetTokens: DD_HARD_IN,
    budgetOutTokens: DD_HARD_OUT,
    knowledgeBase: settings.knowledgeBase !== false,
    language: 'de',
  }
  return {
    id: JsonStore.newId('m'), ownerKey, name: String(name || 'Neuer Akt').slice(0, 120), kind: kind === 'dd' ? 'dd' : 'matter', client: String(client || '').slice(0, 120),
    createdAt: Date.now(), updatedAt: Date.now(), settings: s, seq: { doc: 0, finding: 0 },
    documents: [], findings: [], areaSummaries: {}, executive: null, verification: null, reports: [], tables: [], conversations: [],
    job: { status: 'idle', stage: null, progress: { done: 0, total: 0 }, usage: newUsage(), startedAt: null, finishedAt: null, error: null, pauseRequested: false, log: [], jobId: null, cost: null },
  }
}

/** Stable display ids (D-001, F-001) that stay identical in UI, Word and Excel. */
export function nextNo(matter, kind) {
  matter.seq ||= { doc: 0, finding: 0 }
  const n = ++matter.seq[kind]
  return `${kind === 'doc' ? 'D' : 'F'}-${String(n).padStart(3, '0')}`
}

const normWs = (s) => String(s || '').replace(/[„“”"»«‚‘’']/g, '"').replace(/\s+/g, ' ').trim().toLowerCase()
/**
 * Evidence binding: is the quoted passage really in the document text?
 * verified = found verbatim (whitespace/quotes normalised); partial = start and
 * end of the quote found (model shortened the middle); unverified = not found.
 */
export function locateQuote(text, quote) {
  const q = normWs(quote)
  if (q.length < 12) return { status: 'unverified', offset: -1 }
  const t = normWs(text)
  let i = t.indexOf(q)
  if (i >= 0) return { status: 'verified', offset: i }
  // Quotes shortened with an ellipsis: every segment must occur, in order.
  const segs = q.split(/\s*(?:…|\.\.\.|\[…\]|\[\.\.\.\])\s*/).map((x) => x.trim()).filter((x) => x.length >= 10)
  if (segs.length > 1) { let pos = 0, ok = true, first = -1; for (const sg of segs) { const j = t.indexOf(sg, pos); if (j < 0) { ok = false; break } if (first < 0) first = j; pos = j + sg.length } if (ok) return { status: 'partial', offset: first } }
  const head = q.slice(0, 40), tail = q.slice(-40)
  i = t.indexOf(head)
  if (i >= 0 && t.indexOf(tail, i) >= 0 && t.indexOf(tail, i) - i < q.length * 3) return { status: 'partial', offset: i }
  const bare = q.replace(/[^\p{L}\p{N} ]/gu, '')
  const tb = t.replace(/[^\p{L}\p{N} ]/gu, '')
  i = bare.length >= 12 ? tb.indexOf(bare) : -1
  return i >= 0 ? { status: 'verified', offset: -1 } : { status: 'unverified', offset: -1 }
}

/** Rough pre-run estimate so the user sees tokens, cost and time before confirming. */
export function estimateRun(matter, priceIn = 2, priceOut = 10, concurrency = 24) {
  const pending = matter.documents.filter((d) => d.status === 'new' || d.status === 'extracted')
  const charsOf = (d) => d.textChars || Math.min(d.size || 0, 4_000_000) * (/\.pdf$/i.test(d.name) ? 0.35 : /\.docx$/i.test(d.name) ? 0.08 : 1)
  let chars = 0
  for (const d of pending) chars += Math.min(charsOf(d), CHUNK_CHARS * MAX_CHUNKS_PER_DOC)
  const chunks = pending.reduce((n, d) => n + Math.min(MAX_CHUNKS_PER_DOC, Math.max(1, Math.ceil(charsOf(d) / CHUNK_CHARS))), 0)
  const legalDocs = matter.settings.knowledgeBase !== false ? Math.ceil(pending.length * 0.5) : 0 // documents with red/amber findings and a legal question
  const areasTouched = Math.min(matter.settings.areas.length, Math.max(1, matter.documents.length))
  const inTok = Math.round(chars / 3.2 + chunks * 2500 + legalDocs * 6000 + 20_000 * areasTouched + 10_000)
  const outTok = Math.round(chunks * 2000 + legalDocs * 1200 + 4000 * areasTouched + 4000)
  const kbCalls = matter.settings.knowledgeBase !== false ? Math.min(DD_MAX_KB_CALLS, pending.length) : 0
  // Calls run side by side: about a minute per wave of sections, then legal questions and the area summaries.
  const minutes = Math.max(2, Math.round(Math.ceil(chunks / concurrency) * 1.0 + Math.ceil(legalDocs / concurrency) * 0.7 + 2))
  return { documents: pending.length, chunks, inTok: Math.min(inTok, DD_HARD_IN), outTok: Math.min(outTok, DD_HARD_OUT), usd: +((Math.min(inTok, DD_HARD_IN) / 1e6) * priceIn + (Math.min(outTok, DD_HARD_OUT) / 1e6) * priceOut).toFixed(2), kbCalls, minutes, limitIn: DD_HARD_IN, limitOut: DD_HARD_OUT }
}

function newUsage() { return { byModel: {}, inTok: 0, outTok: 0, cachedTok: 0, webSearchCalls: 0, aissociateCalls: 0, calls: 0 } }

/** Model-call context of a matter: usage accumulates over every run; the budget is the matter's own. */
function matterCtx(matter) {
  const u = (matter.job.usage ||= newUsage())
  for (const [k, v] of Object.entries(newUsage())) if (u[k] == null) u[k] = v
  return { usage: u, limits: { inMax: DD_HARD_IN, outMax: DD_HARD_OUT } }
}

export function newDocument({ name, size, source = 'upload', ms = null, no = '' }) {
  return { id: JsonStore.newId('d'), no, name: String(name).slice(0, 200), size: Number(size) || 0, source, ms, file: null, status: 'new', note: '', textChars: 0, pages: null, chunks: 0, truncated: false, docType: '', area: '', title: '', summary: '', parties: [], dates: [], keyTerms: [], missing: [], questions: [], flags: { red: 0, amber: 0, green: 0, info: 0 }, addedAt: Date.now(), analysedAt: null }
}

/** A finding as stored on the matter (model output + ids, evidence status, review state). */
export function newFinding(matter, d, f) {
  const sev = SEVERITIES.includes(f.severity) ? f.severity : 'info'
  return {
    id: JsonStore.newId('f'), no: nextNo(matter, 'finding'), docId: d.id, docNo: d.no || '', docName: d.name,
    area: DD_AREA_KEYS.includes(f.area) ? f.area : (DD_AREA_KEYS.includes(d.area) ? d.area : 'none'),
    severity: sev, title: String(f.title || '').slice(0, 200), description: String(f.description || ''), quote: String(f.quote || '').slice(0, 600), location: String(f.location || '').slice(0, 120),
    recommendation: String(f.recommendation || ''), dealImpact: DEAL_IMPACTS.includes(f.deal_impact) ? f.deal_impact : 'keine', rule: String(f.rule || '').slice(0, 20),
    norms: Array.isArray(f.norms) ? f.norms.map(String).slice(0, 8) : [], normStatus: [],
    evidence: 'unverified', source: f.source === 'manual' ? 'manual' : 'model',
    review: { status: 'open', severity: null, note: '', ts: null },
  }
}
/** Severity after review (reviewer override wins). */
export const effectiveSeverity = (f) => (f.review?.severity && SEVERITIES.includes(f.review.severity) ? f.review.severity : f.severity)
export const isRejected = (f) => f.review?.status === 'rejected'

const areaLabel = (k) => DD_AREAS.find((a) => a.key === k)?.label || (k === 'none' ? 'Allgemein' : k)
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zäöüß0-9]+/g, ' ').trim()

function docInstructions(matter) {
  const s = matter.settings
  const areas = DD_AREAS.filter((a) => s.areas.includes(a.key))
  return `Du bist ein erfahrener österreichischer Transaktionsanwalt und Steuerberater und führst eine ${s.transaction === 'asset' ? 'Asset-Deal' : 'Share-Deal'}-Due-Diligence aus Sicht des ${s.perspective === 'seller' ? 'Verkäufers (Vendor DD)' : 'Käufers'} durch${s.target ? ` (Zielunternehmen: ${s.target})` : ''}. Du analysierst EIN Dokument aus dem Datenraum und antwortest ausschließlich als JSON nach dem vorgegebenen Schema.

TRANSAKTIONSSTRUKTUR: ${TRANSACTION_NOTES[s.transaction] || TRANSACTION_NOTES.share}

PRÜFBEREICHE, TYPISCHE DOKUMENTE UND RED-FLAG-KATALOG (Regel-IDs in Klammern, Basis-Schweregrad in Klammern)
${areas.map((a) => `- ${a.key} (${a.label}): Dokumente: ${a.documents}. Red Flags: ${a.redFlags}`).join('\n')}

REGELN
- Klassifiziere Dokumenttyp und Prüfbereich. Fasse Gegenstand, Parteien und Kernregelungen zusammen; extrahiere Daten (Abschluss, Laufzeit, Fristen) und Key Terms.
- Befunde nur, wenn sie im Dokument belegt sind: jeder Befund mit WÖRTLICHEM Zitat (exakt aus dem Text kopiert, max. 300 Zeichen – das Zitat wird maschinell im Dokument gesucht) und Fundstelle (Punkt/§/Seite). Keine generischen Befunde ("Vertrag sollte geprüft werden").
- Schweregrad: red = deal-relevant (Kaufpreis, Condition Precedent, möglicher Abbruch; z. B. Change of Control bei einem wesentlichen Vertrag, ungesicherte Haftung, laufendes Großverfahren), amber = wesentlich, aber durch Garantie/Freistellung/Nachverhandlung lösbar, green = unkritisch, aber dokumentationswürdig, info = reiner Hinweis. Wesentlichkeitsschwelle: ${s.materialityEur.toLocaleString('de-AT')} EUR; Beträge darunter sind höchstens green/info, außer sie betreffen Strukturfragen (Eigentum, Genehmigungen, Haftung).
- deal_impact: welches Instrument der Befund in der Transaktionsdokumentation erfordert (CP = Condition Precedent, Garantie, Freistellung, Kaufpreis = Anpassung/Escrow, Abbruch, Nachfrage, keine). rule: passende Regel-ID aus dem Katalog (z. B. VERT-001), sonst leer.
- Rechtliche Einordnung nach österreichischem Recht mit konkreten Normen (z. B. § 38 UGB, § 14 BAO, § 1409 ABGB, § 36 AngG, AVRAG, § 30 MRG, § 8 KStG, § 1 GrEStG); keine Normen erfinden; Unsicheres als Nachfrage formulieren.
- Fehlende Anlagen, unleserliche Stellen und Verweise auf nicht vorliegende Dokumente in missing_or_unclear (höchstens 3); in questions höchstens 2 wirklich wesentliche Nachfragen zu roten oder gelben Befunden, sonst keine – keine Routine- oder Formalfragen.
- legal_questions: 0 bis 3 konkrete, kompakte Rechtsfragen aus den roten/gelben Befunden (je höchstens 2 Sätze plus die nötigen Fakten: Klausel, Betrag, Konstellation), nach Rechtsfolge, Risiko und üblicher Absicherung im Kaufvertrag; legal_difficulty: none = keine Rechtsfrage, easy = mit gesichertem Grundwissen beantwortbar, hard = Recherche in Normen und Judikatur (Websuche im RIS reicht), very_hard = nur bei außergewöhnlich schwierigen, ungeklärten Fragen, bei denen auch eine Websuche im RIS nicht reicht (sehr selten).
- Grüne Befunde und Hinweise knapp halten (ein Satz); ausführlich nur rote und gelbe.
- Sprache: Deutsch, präzise, Kanzleistil.`
}

/** Merge chunk analyses of one document into one result. */
function mergeChunkResults(parts) {
  const first = parts[0]
  const out = { ...first, parties: [], dates: [], key_terms: [], findings: [], missing_or_unclear: [], questions: [], legal_questions: [], legal_difficulty: ['very_hard', 'hard', 'easy'].find((l) => parts.some((p) => p.legal_difficulty === l)) || 'none' }
  const seen = { parties: new Set(), dates: new Set(), terms: new Set(), findings: new Set(), missing: new Set(), questions: new Set(), legal: new Set() }
  for (const p of parts) {
    for (const x of p.parties || []) { const k = norm(x); if (k && !seen.parties.has(k)) { seen.parties.add(k); out.parties.push(x) } }
    for (const d of p.dates || []) { const k = norm(d.label + d.date); if (k && !seen.dates.has(k)) { seen.dates.add(k); out.dates.push(d) } }
    for (const t of p.key_terms || []) { const k = norm(t.term); if (k && !seen.terms.has(k)) { seen.terms.add(k); out.key_terms.push(t) } }
    for (const f of p.findings || []) { const k = norm(f.title).slice(0, 60); if (k && !seen.findings.has(k)) { seen.findings.add(k); out.findings.push(f) } }
    for (const m of p.missing_or_unclear || []) { const k = norm(m); if (k && !seen.missing.has(k)) { seen.missing.add(k); out.missing_or_unclear.push(m) } }
    for (const q of p.questions || []) { const k = norm(q); if (k && !seen.questions.has(k)) { seen.questions.add(k); out.questions.push(q) } }
    for (const q of p.legal_questions || []) { const k = norm(q); if (k && !seen.legal.has(k) && out.legal_questions.length < 3) { seen.legal.add(k); out.legal_questions.push(q) } }
  }
  return out
}

function chunkText(text) {
  const chunks = []
  let i = 0
  while (i < text.length && chunks.length < MAX_CHUNKS_PER_DOC) {
    const end = Math.min(text.length, i + CHUNK_CHARS)
    chunks.push(text.slice(i, end))
    if (end >= text.length) break
    i = end - CHUNK_OVERLAP
  }
  return { chunks, truncated: i < text.length && chunks.length >= MAX_CHUNKS_PER_DOC }
}

/** Extract the text of the given documents (status new → extracted | error); 'paused' when interrupted. */
async function extractDocuments(matter, deps, docs, log) {
  const { store } = deps
  const ctx = matterCtx(matter) // scanned PDFs and images are read by OCR (model calls within the hard limit)
  const run = pool(6)
  let paused = false, lastSave = 0
  await Promise.all(docs.map((d) => run(async () => {
    if (matter.job.pauseRequested) { paused = true; return }
    try {
      const buf = d.file ? await store.getFile(matter.id, d.file) : null
      if (!buf) throw new Error('Datei nicht gefunden')
      // OCR only while there is room under the hard limit (a scan costs roughly 1,500 tokens per page).
      const room = ctx.usage.inTok + 2_000_000 < DD_HARD_IN && ctx.usage.outTok + 200_000 < DD_HARD_OUT
      const r = await deps.extractText(d.name, buf, room ? { ctx } : {})
      d.textChars = r.text.length; d.pages = r.pages ?? null; d.ocr = Boolean(r.ocr)
      if (r.unsupported) { d.status = 'error'; d.note = 'Dateityp nicht lesbar' }
      else if (!r.text.trim()) { d.status = 'error'; d.note = r.ocrError ? `Kein Text erkannt (OCR fehlgeschlagen: ${r.ocrError.slice(0, 80)})` : room ? 'Kein Text erkannt (auch nicht per OCR)' : 'Kein Text extrahierbar – OCR nicht mehr möglich (Token-Grenze)' }
      else { await store.putText(matter.id, d.id, r.text); d.status = 'extracted'; d.note = r.ocr ? `per OCR gelesen${r.ocrTruncated ? ' (nur die ersten Seiten)' : ''}` : '' }
    } catch (e) { d.status = 'error'; d.note = String(e?.message || e).slice(0, 200) }
    if (matter.job.progress) matter.job.progress.done++
    log(`Text extrahiert: ${d.name}${d.note ? ' · ' + d.note : ''}`)
    if (Date.now() - lastSave > 2000) { lastSave = Date.now(); await store.saveMatter(matter) }
  })))
  await store.saveMatter(matter)
  return paused ? 'paused' : 'done'
}

/**
 * Run (or resume) the DD pipeline of a matter.
 * deps: { store, callModel(ctx, params), extractText(name, buf), modelMain, modelExtract, effort, verifyAnswer, computeCost, send(event, data) }
 */
export async function runDd(matter, deps) {
  const { store, send } = deps
  const ctx = matterCtx(matter)
  const log = (message) => { matter.job.log.push({ t: Date.now(), message }); if (matter.job.log.length > 400) matter.job.log.splice(0, matter.job.log.length - 400); send('dd', { matterId: matter.id, stage: matter.job.stage, progress: matter.job.progress, message }) }
  const save = () => store.saveMatter(matter)
  const paused = () => matter.job.pauseRequested
  const overBudget = () => ctx.usage.inTok >= DD_HARD_IN || ctx.usage.outTok >= DD_HARD_OUT
  // Knowledge-base and web answers have no token report: they count with an estimate (chars / 3.2 + retrieval overhead).
  const countExternal = (question, answer, kb) => { const i = Math.ceil(String(question || '').length / 3.2) + (kb ? 2500 : 1500); const o = Math.ceil(String(answer || '').length / 3.2); ctx.usage.inTok += i; ctx.usage.outTok += o; const m = (ctx.usage.byModel[kb ? 'aissociate' : 'web'] ||= { inTok: 0, outTok: 0, cachedTok: 0, calls: 0 }); m.inTok += i; m.outTok += o; m.calls++; if (kb) ctx.usage.aissociateCalls++ }
  const stop = async (status, reason) => { matter.job.status = status; matter.job.error = reason || null; matter.job.pauseRequested = false; matter.job.finishedAt = Date.now(); await save(); send('dd', { matterId: matter.id, stage: matter.job.stage, progress: matter.job.progress, status, message: reason || status }); return matter }

  matter.job.status = 'running'; matter.job.error = null; matter.job.pauseRequested = false; matter.job.startedAt = matter.job.startedAt || Date.now(); matter.job.finishedAt = null
  await save()
  try {
    // ---- extract ----
    matter.job.stage = 'extract'
    // Documents without text from an earlier run (scans) are read again – OCR may succeed now.
    for (const d of matter.documents) if (d.status === 'error' && /kein text|gescannt|ocr/i.test(d.note || '')) { d.status = 'new'; d.note = '' }
    const toExtract = matter.documents.filter((d) => d.status === 'new')
    matter.job.progress = { done: 0, total: toExtract.length }
    const r = await extractDocuments(matter, deps, toExtract, log)
    if (r === 'paused') return stop('paused', 'Pausiert')

    // ---- analyse (a few documents at a time; pause and budget are checked before each) ----
    matter.job.stage = 'analyse'
    const toAnalyse = matter.documents.filter((d) => d.status === 'extracted')
    matter.job.progress = { done: 0, total: toAnalyse.length }
    const instr = docInstructions(matter)
    let halt = null
    // One pool for every model call of this run: all sections of all documents side by side.
    const limit = pool(Math.max(1, deps.concurrency || 24))
    const limitMsg = `Harte Grenze der Due Diligence erreicht (${(DD_HARD_IN / 1e6).toFixed(0)} Mio. Eingabe- / ${(DD_HARD_OUT / 1e6).toFixed(0)} Mio. Ausgabe-Tokens).`
    const guard = () => {
      if (halt) return false
      if (paused()) { halt = ['paused', 'Pausiert']; return false }
      if (overBudget()) { halt = ['paused', limitMsg]; return false }
      return true
    }
    // The limit is hard: every call reserves its estimated tokens before it starts (calls run side by side).
    let resIn = 0, resOut = 0
    const reserve = (i, o) => {
      if (ctx.usage.inTok + resIn + i > DD_HARD_IN || ctx.usage.outTok + resOut + o > DD_HARD_OUT) { halt ||= ['paused', limitMsg]; return false }
      resIn += i; resOut += o; return true
    }
    const release = (i, o) => { resIn -= i; resOut -= o }
    const reserved = async (i, o, fn) => { if (!guard() || !reserve(i, o)) throw new Error('halt'); try { return await fn() } finally { release(i, o) } }
    let kbLeft = matter.settings.knowledgeBase !== false && typeof deps.askKnowledgeBase === 'function' ? DD_MAX_KB_CALLS : 0
    let lastSave = 0
    const saveSoon = async () => { if (Date.now() - lastSave > 2000) { lastSave = Date.now(); await save() } }
    const analyseOne = async (d) => {
      const text = await store.getText(matter.id, d.id)
      const { chunks, truncated } = chunkText(text)
      d.chunks = chunks.length; d.truncated = truncated
      try {
        // Every section on its own (in parallel); the results are merged and de-duplicated afterwards.
        const parts = await Promise.all(chunks.map((chunk, i) => limit(() => reserved(Math.ceil((chunk.length + instr.length) / 2.5) + 1500, 12_000, async () => {
          const call = () => deps.callModel(ctx, {
            model: deps.modelExtract, instructions: instr, effort: 'low', maxOut: 12_000,
            input: [{ role: 'user', content: `DOKUMENT: ${d.folder ? d.folder + '/' : ''}${d.name}${chunks.length > 1 ? ` (Teil ${i + 1}/${chunks.length}; nur Befunde aus diesem Teil melden)` : ''}\n\n=== TEXT ===\n${chunk}` }],
            text: { format: { type: 'json_schema', name: 'dd_document', schema: DOC_ANALYSIS_SCHEMA, strict: true } },
          })
          let resp
          try { resp = await call() } catch (e) { if (/Token-Budget/.test(String(e?.message))) throw e; await new Promise((r) => setTimeout(r, 8000)); resp = await call() } // one more try after a pause (rate limits)
          let parsed = null
          try { parsed = JSON.parse(resp.output_text || '') } catch {}
          if (!parsed) throw new Error('Analyse lieferte kein gültiges JSON' + (resp.status === 'incomplete' ? ' (Ausgabe abgeschnitten)' : ''))
          return parsed
        }))))
        const r = mergeChunkResults(parts)
        d.difficulty = r.legal_difficulty === 'hard' || r.legal_difficulty === 'very_hard' || text.length > CHUNK_CHARS ? 'hard' : 'easy'
        d.docType = r.doc_type; d.area = r.area; d.title = r.title; d.summary = r.summary; d.parties = r.parties; d.dates = r.dates; d.keyTerms = r.key_terms; d.missing = (r.missing_or_unclear || []).slice(0, 3); d.questions = (r.questions || []).slice(0, 2)
        // Reviewer decisions on earlier findings of this document survive a re-analysis when the title matches.
        const previous = matter.findings.filter((f) => f.docId === d.id)
        matter.findings = matter.findings.filter((f) => f.docId !== d.id && !(f.source === 'manual' && f.docId === d.id)).concat(previous.filter((f) => f.source === 'manual'))
        d.flags = { red: 0, amber: 0, green: 0, info: 0 }
        let unverified = 0
        for (const f of r.findings) {
          const nf = newFinding(matter, d, f)
          const old = previous.find((p) => p.source !== 'manual' && norm(p.title) === norm(nf.title))
          if (old) { nf.no = old.no; nf.review = old.review }
          const loc = locateQuote(text, nf.quote)
          nf.evidence = loc.status
          if (loc.status === 'unverified') unverified++
          d.flags[effectiveSeverity(nf)]++
          matter.findings.push(nf)
        }
        d.status = 'analysed'; d.analysedAt = Date.now(); d.note = [d.ocr ? 'per OCR gelesen' : '', truncated ? `Nur die ersten ${chunks.length} Teile analysiert (Dokument sehr lang)` : '', unverified ? `${unverified} Zitat${unverified > 1 ? 'e' : ''} nicht wörtlich im Text gefunden` : ''].filter(Boolean).join(' · ')
        // Legal questions of this document: the model with a web search in the RIS; the knowledge base
        // only for very hard questions of red findings (a few per run).
        d.legal = null
        const lq = (r.legal_questions || []).map((q) => String(q).trim()).filter(Boolean).slice(0, 3)
        const sev = matter.findings.filter((f) => f.docId === d.id).map(effectiveSeverity)
        const material = sev.includes('red') || sev.includes('amber')
        if (lq.length && material && r.legal_difficulty !== 'none' && matter.settings.knowledgeBase !== false && guard()) {
          const a = DD_AREAS.find((x) => x.key === d.area)
          const legalArea = a?.profession === 'tax' ? 'tax' : d.area === 'compliance' ? 'public' : 'civil'
          const deal = `${matter.settings.transaction === 'asset' ? 'Asset Deal' : 'Share Deal'}, Perspektive ${matter.settings.perspective === 'seller' ? 'Verkäufer' : 'Käufer'}${matter.settings.target ? `, Zielunternehmen ${matter.settings.target}` : ''}`
          const ctxMax = deps.kbContextChars || 8000
          const quotes = matter.findings.filter((f) => f.docId === d.id && ['red', 'amber'].includes(effectiveSeverity(f)) && f.quote && f.evidence !== 'unverified').slice(0, 10).map((f) => `[${f.location || 'o. A.'}] „${f.quote}“`)
          const wording = text.length <= ctxMax ? `VOLLTEXT DES DOKUMENTS:\n${text.trim()}` : `RELEVANTE KLAUSELN (wörtlich):\n${quotes.join('\n')}`.slice(0, ctxMax)
          const question = `${deal}. Dokument: ${d.title || d.name}. ` + (lq.length <= 1 ? lq[0] : `Beantworte die folgenden ${lq.length} Fragen getrennt und nummeriert:\n${lq.map((q, i) => `${i + 1}. ${q}`).join('\n')}`) + `\n\nSACHVERHALT: ${String(d.summary || '').slice(0, 800)}${d.parties?.length ? ` Parteien: ${d.parties.slice(0, 6).join(', ')}.` : ''}\n\n${wording}`
          const veryHard = r.legal_difficulty === 'very_hard' && sev.includes('red') && kbLeft > 0
          if (veryHard) kbLeft--
          try {
            if (veryHard) {
              const kr = await limit(() => reserved(Math.ceil(question.length / 2.5) + 2500, 8000, () => deps.askKnowledgeBase({ question, legalArea })))
              countExternal(question, kr.answer, true)
              d.legal = { via: 'aissociate', difficulty: 'very_hard', questions: lq, answer: String(kr.answer || '').trim().slice(0, 40_000), sources: (kr.sources || []).slice(0, 20).map((x) => ({ title: x.title, url: x.url })), at: Date.now() }
            } else if (typeof deps.answerEasyLegal === 'function') {
              const wr = await limit(() => reserved(Math.ceil(question.length / 2.5) + 12_000, 5000, () => deps.answerEasyLegal(ctx, { question, ris: true })))
              d.legal = { via: 'web', difficulty: r.legal_difficulty, questions: lq, answer: String(wr.answer || '').trim().slice(0, 20_000), sources: (wr.sources || []).slice(0, 10), at: Date.now() }
            }
          } catch (e) { if (/Token-Budget/.test(String(e?.message))) throw e; d.note = [d.note, e?.message === 'halt' ? 'Rechtsfragen nicht beantwortet (Grenze erreicht oder pausiert)' : `Rechtsfragen nicht beantwortet: ${String(e?.message || e).slice(0, 100)}`].filter(Boolean).join(' · ') }
        }
      } catch (e) {
        if (e?.message === 'halt') { d.status = 'extracted'; return }
        if (e?.name === 'BudgetExceeded' || /Token-Budget/.test(String(e?.message))) { d.status = 'extracted'; halt ||= ['paused', `Harte Grenze der Due Diligence erreicht (${(DD_HARD_IN / 1e6).toFixed(0)} Mio. Eingabe- / ${(DD_HARD_OUT / 1e6).toFixed(0)} Mio. Ausgabe-Tokens).`]; return }
        d.status = 'error'; d.note = 'Analyse fehlgeschlagen: ' + String(e?.message || e).slice(0, 200)
      }
      matter.job.progress.done++
      log(`Analysiert: ${d.name} · ${d.flags.red} rot / ${d.flags.amber} gelb${d.legal ? ` · Rechtsfragen: ${d.legal.via === 'aissociate' ? 'AI:ssociate' : 'Websuche (RIS)'}` : ''}${d.note ? ' · ' + d.note : ''}`)
      await saveSoon()
    }
    await Promise.all(toAnalyse.map((d) => analyseOne(d).catch((e) => { console.error('dd analyse:', e); halt ||= ['error', 'Analyse abgebrochen: ' + String(e?.message || e).slice(0, 200)] })))
    await save()
    if (halt) return stop(halt[0], halt[1])

    // ---- synthesize per area ----
    matter.job.stage = 'synthesize'
    const areas = matter.settings.areas.filter((k) => matter.findings.some((f) => f.area === k) || matter.documents.some((d) => d.area === k))
    matter.job.progress = { done: 0, total: areas.length }
    if (paused()) return stop('paused', 'Pausiert')
    // All areas side by side.
    await Promise.all(areas.map(async (key) => {
      const a = DD_AREAS.find((x) => x.key === key)
      const fs = matter.findings.filter((f) => f.area === key && !isRejected(f)).sort((x, y) => SEV_RANK[effectiveSeverity(x)] - SEV_RANK[effectiveSeverity(y)])
      const docs = matter.documents.filter((d) => d.area === key)
      // Legal assessments were gathered per document (knowledge base or web); the area gets them combined.
      const legalDocs = docs.filter((d) => d.legal?.answer)
      let legal = null
      if (legalDocs.length) {
        const seen = new Set(); const sources = []; const questions = []
        for (const d of legalDocs) { for (const src of d.legal.sources || []) { const k = src.url || src.title; if (k && !seen.has(k)) { seen.add(k); sources.push(src) } } for (const q of d.legal.questions || []) if (!questions.some((x) => norm(x) === norm(q))) questions.push(q) }
        legal = { questions, answer: legalDocs.map((d) => `### ${d.no || ''} ${d.title || d.name} (${d.legal.via === 'aissociate' ? 'AI:ssociate' : 'Websuche'})\n\n${d.legal.answer}`).join('\n\n').slice(0, 60_000), sources: sources.slice(0, 25), via: legalDocs.some((d) => d.legal.via === 'aissociate') ? 'aissociate' : 'web', at: Date.now() }
      }
      const resp = await deps.callModel(ctx, {
        model: deps.modelMain, effort: deps.effort, maxOut: 8000,
        instructions: `Du bist österreichischer Transaktionsanwalt und Steuerberater. Fasse den Prüfbereich „${a.label}“ einer ${matter.settings.transaction === 'asset' ? 'Asset-Deal' : 'Share-Deal'}-Due-Diligence aus Käufer-/Verkäufersicht (${matter.settings.perspective}) zusammen. Erwartete Dokumente: ${a.documents}. Typische Red Flags: ${a.redFlags}. Standard-Nachfragen: ${a.questions}. ${legal ? 'Die rechtliche Einordnung je Dokument (juristische Wissensdatenbank AI:ssociate bzw. Websuche) liegt bei und ist die maßgebliche Rechtsquelle – übernimm ihre Normen, Judikatur und Absicherungsempfehlungen, erfinde keine weiteren Fundstellen. ' : ''}Antworte als JSON nach Schema; keine Befunde erfinden, nur aus den gelieferten Daten ableiten; requests: die Nachfragen der Dokumente zu höchstens 6 priorisierten, zusammengefassten Nachfragen an den Verkäufer bündeln (nur deal-relevante, keine Einzel- oder Routinefragen); missing_documents: höchstens 4 wirklich fehlende Standarddokumente; Widersprüche zwischen Dokumenten aufzeigen; Empfehlungen als Garantien, Freistellungen, Conditions Precedent oder Kaufpreismechanismen formulieren.`,
        input: [{ role: 'user', content: `DOKUMENTE IM BEREICH (${docs.length}):\n${docs.map((d) => `- ${d.no || ''} ${d.name}: ${d.docType}; ${d.summary.slice(0, 300)}${d.missing.length ? ` | fehlt/unklar: ${d.missing.slice(0, 3).join('; ')}` : ''}`).join('\n') || '(keine)'}\n\nBEFUNDE (${fs.length}):\n${fs.map((f) => `- ${f.no} [${effectiveSeverity(f)}] ${f.title} (${f.docName}, ${f.location}): ${f.description.slice(0, 400)} | Empfehlung: ${f.recommendation.slice(0, 200)}${f.review?.note ? ` | Reviewer: ${f.review.note.slice(0, 200)}` : ''}`).join('\n') || '(keine)'}\n\nNACHFRAGEN AUS DEN DOKUMENTEN:\n${docs.flatMap((d) => d.questions).slice(0, 40).map((q) => '- ' + q).join('\n') || '(keine)'}${legal ? `\n\nRECHTLICHE EINORDNUNG JE DOKUMENT:\n${legal.answer.slice(0, 14_000)}` : ''}` }],
        text: { format: { type: 'json_schema', name: 'dd_area', schema: AREA_SYNTHESIS_SCHEMA, strict: true } },
      })
      try { const sy = JSON.parse(resp.output_text || ''); sy.requests = (sy.requests || []).slice(0, 6); sy.missing_documents = (sy.missing_documents || []).slice(0, 4); matter.areaSummaries[key] = { ...sy, label: a.label, documents: docs.length, findings: fs.length, legal } } catch { matter.areaSummaries[key] = { summary: 'Zusammenfassung fehlgeschlagen.', key_risks: [], cross_document_issues: [], missing_documents: [], requests: [], deal_recommendations: [], label: a.label, documents: docs.length, findings: fs.length, legal } }
      matter.job.progress.done++
      log(`Bereich zusammengefasst: ${a.label}`)
    }))
    await save()

    // ---- executive summary ----
    matter.job.stage = 'summary'
    matter.job.progress = { done: 0, total: 1 }
    {
      const top = matter.findings.filter((f) => !isRejected(f) && ['red', 'amber'].includes(effectiveSeverity(f))).sort((x, y) => SEV_RANK[effectiveSeverity(x)] - SEV_RANK[effectiveSeverity(y)]).slice(0, 40)
      const resp = await deps.callModel(ctx, {
        model: deps.modelMain, effort: deps.effort, maxOut: 6000,
        instructions: `Du bist österreichischer Transaktionsanwalt und Steuerberater und schreibst das Executive Summary eines Due-Diligence-Berichts (${matter.settings.transaction === 'asset' ? 'Asset Deal' : 'Share Deal'}, Perspektive ${matter.settings.perspective === 'seller' ? 'Verkäufer' : 'Käufer'}${matter.settings.target ? `, Zielunternehmen ${matter.settings.target}` : ''}). Mandantentauglich, präzise, keine Floskeln, nur aus den gelieferten Befunden. Antworte als JSON nach Schema.`,
        input: [{ role: 'user', content: `BEREICHSZUSAMMENFASSUNGEN:\n${Object.values(matter.areaSummaries).map((s) => `## ${s.label}\n${s.summary}\nRisiken: ${s.key_risks.join('; ')}\nFehlend: ${s.missing_documents.join('; ')}`).join('\n\n') || '(keine)'}\n\nTOP-BEFUNDE:\n${top.map((f) => `- ${f.no} [${effectiveSeverity(f)}] ${areaLabel(f.area)}: ${f.title} (${f.docName}) – ${f.recommendation.slice(0, 160)}`).join('\n') || '(keine)'}\n\nSTATISTIK: ${matter.documents.length} Dokumente, davon ${matter.documents.filter((d) => d.status === 'analysed').length} analysiert, ${matter.documents.filter((d) => d.status === 'error').length} nicht lesbar; Befunde: ${matter.findings.filter((f) => !isRejected(f) && effectiveSeverity(f) === 'red').length} rot, ${matter.findings.filter((f) => !isRejected(f) && effectiveSeverity(f) === 'amber').length} gelb.` }],
        text: { format: { type: 'json_schema', name: 'dd_exec', schema: EXEC_SUMMARY_SCHEMA, strict: true } },
      })
      try { matter.executive = JSON.parse(resp.output_text || '') } catch { matter.executive = { executive_summary: 'Executive Summary fehlgeschlagen.', top_red_flags: [], overall_assessment: 'wesentliche Risiken', next_steps: [] } }
      matter.job.progress.done = 1
      log('Executive Summary erstellt')
      await save()
    }

    // ---- verify norms against RIS ----
    matter.job.stage = 'verify'
    {
      const norms = [...new Set(matter.findings.flatMap((f) => f.norms).map((n) => String(n).trim()).filter(Boolean))].slice(0, 60)
      matter.job.progress = { done: 0, total: norms.length }
      let v = null
      try { v = await deps.verifyAnswer(norms.join('; ')) } catch (e) { log('RIS-Prüfung fehlgeschlagen: ' + e.message) }
      if (v) {
        const byLabel = new Map([...(v.norms || []), ...(v.decisions || [])].map((x) => [norm(x.label), x]))
        matter.verification = { summary: v.summary, items: [...(v.norms || []), ...(v.decisions || [])].map((x) => ({ label: x.label, status: x.status, note: x.note, url: x.url || '', title: x.title || '' })) }
        for (const f of matter.findings) f.normStatus = f.norms.map((n) => { const hit = [...byLabel.values()].find((x) => norm(n).includes(norm(x.label)) || norm(x.label).includes(norm(n))); return { norm: n, status: hit?.status || 'unchecked', url: hit?.url || '' } })
      }
      matter.job.progress.done = norms.length
      log(`RIS-Prüfung: ${v ? `${v.summary.ok} von ${v.summary.checked} Normen bestätigt` : 'übersprungen'}`)
      await save()
    }

    // ---- report ----
    matter.job.stage = 'report'
    matter.job.progress = { done: 0, total: 2 }
    const names = await buildReports(matter, deps)
    log(`Bericht erstellt: ${names[0]}`)
    matter.job.stage = 'done'
    return stop('done')
  } catch (e) {
    console.error('dd run failed:', e)
    return stop('error', String(e?.message || e).slice(0, 300))
  }
}

/** (Re)build the Word report and the Excel workbook from the stored analysis – no model calls. */
export async function buildReports(matter, deps) {
  const { store } = deps
  const ctx = matterCtx(matter)
  const stamp = new Date().toISOString().slice(0, 10)
  const stem = (matter.name || 'DD').replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 50) || 'DD'
  matter.job.cost = deps.computeCost(ctx.usage, 0)
  const docxBuf = await buildDdDocx(matter)
  const docxName = await store.putReport(matter.id, `Red_Flag_Report_${stem}_${stamp}.docx`, docxBuf)
  if (matter.job.progress) matter.job.progress.done = 1
  const xlsxBuf = await buildDdXlsx(matter)
  const xlsxName = await store.putReport(matter.id, `DD_Befunde_${stem}_${stamp}.xlsx`, xlsxBuf)
  if (matter.job.progress) matter.job.progress.done = 2
  matter.reports = (matter.reports || []).filter((r) => r.name !== docxName && r.name !== xlsxName)
  matter.reports.unshift({ name: docxName, kind: 'docx', size: docxBuf.length, createdAt: Date.now() }, { name: xlsxName, kind: 'xlsx', size: xlsxBuf.length, createdAt: Date.now() })
  await store.saveMatter(matter)
  return [docxName, xlsxName]
}

/** Review table: user-defined columns extracted per document with quote + location. */
export async function runReviewTable(matter, table, deps) {
  const { store, send } = deps
  const ctx = matterCtx(matter)
  const schema = {
    type: 'object', additionalProperties: false,
    properties: { cells: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { column: { type: 'string', enum: table.columns }, value: { type: 'string', description: 'Kurze Antwort; "–" wenn im Dokument nicht enthalten' }, quote: { type: 'string', description: 'Wörtlicher Beleg (max. 200 Zeichen) oder leer' }, location: { type: 'string', description: 'Fundstelle oder leer' } }, required: ['column', 'value', 'quote', 'location'] } } },
    required: ['cells'],
  }
  table.status = 'running'; table.rows = table.rows || []
  await store.saveMatter(matter)
  const inScope = (d) => (table.docIds?.length ? table.docIds.includes(d.id) : true)
  // Documents that were only uploaded get their text extracted first.
  const fresh = matter.documents.filter((d) => inScope(d) && d.status === 'new')
  if (fresh.length) {
    matter.job.progress = { done: 0, total: fresh.length }
    await extractDocuments(matter, deps, fresh, (message) => send('table', { matterId: matter.id, tableId: table.id, done: 0, total: 0, docName: '', message }))
  }
  const docs = matter.documents.filter((d) => inScope(d) && ['extracted', 'analysed'].includes(d.status) && !table.rows.some((r) => r.docId === d.id))
  let done = 0, lastSave = 0
  const limit = pool(Math.max(1, deps.concurrency || 24))
  await Promise.all(docs.map((d) => limit(async () => {
    if (matter.job.pauseRequested) return
    const text = (await store.getText(matter.id, d.id)).slice(0, CHUNK_CHARS * 2)
    try {
      const resp = await deps.callModel(ctx, {
        model: deps.modelExtract, effort: 'low', maxOut: 6000,
        instructions: `Du extrahierst für eine juristische Übersichtstabelle (österreichische Kanzlei) aus EINEM Dokument genau die angefragten Spalten. Jede Zelle: kurze Antwort, wörtlicher Beleg, Fundstelle. Nicht Enthaltenes als "–" markieren, nichts erfinden. Antworte als JSON nach Schema. Spalten: ${table.columns.join(' | ')}.`,
        input: [{ role: 'user', content: `DOKUMENT: ${d.name}\n\n=== TEXT ===\n${text}` }],
        text: { format: { type: 'json_schema', name: 'review_row', schema, strict: true } },
      })
      const parsed = JSON.parse(resp.output_text || '{}')
      const cells = {}
      for (const c of parsed.cells || []) cells[c.column] = { value: c.value, quote: c.quote, location: c.location, evidence: c.quote ? locateQuote(text, c.quote).status : '' }
      table.rows.push({ docId: d.id, docName: d.name, cells })
    } catch (e) {
      table.rows.push({ docId: d.id, docName: d.name, cells: {}, error: String(e?.message || e).slice(0, 160) })
    }
    done++
    send('table', { matterId: matter.id, tableId: table.id, done, total: docs.length, docName: d.name })
    if (Date.now() - lastSave > 2000) { lastSave = Date.now(); await store.saveMatter(matter) }
  })))
  table.status = matter.job.pauseRequested ? 'paused' : 'done'
  matter.job.pauseRequested = false
  table.updatedAt = Date.now()
  await store.saveMatter(matter)
  return table
}

export async function tableXlsx(matter, table) { return buildTableXlsx(matter, table) }

/** Compact textual context of a matter for chat questions ("Fragen zur Akte"). */
export function matterContext(matter, maxChars = 60_000) {
  const lines = []
  lines.push(`AKT: ${matter.name}${matter.client ? ` (Mandant: ${matter.client})` : ''}${matter.settings?.target ? ` · Zielunternehmen: ${matter.settings.target}` : ''} · ${matter.documents.length} Dokumente, ${matter.findings.length} Befunde`)
  if (matter.executive) lines.push(`\nEXECUTIVE SUMMARY (${matter.executive.overall_assessment}):\n${matter.executive.executive_summary}`)
  for (const s of Object.values(matter.areaSummaries || {})) lines.push(`\n## ${s.label}\n${s.summary}\nRisiken: ${s.key_risks.join('; ')}\nFehlend: ${s.missing_documents.join('; ')}\nNachfragen: ${s.requests.join('; ')}`)
  const fs = [...matter.findings].sort((x, y) => SEV_RANK[effectiveSeverity(x)] - SEV_RANK[effectiveSeverity(y)])
  for (const s of Object.values(matter.areaSummaries || {})) if (s.legal?.answer) lines.push(`\nRECHTLICHE EINORDNUNG ${s.label} (je Dokument, AI:ssociate bzw. Websuche):\n${s.legal.answer.slice(0, 4000)}`)
  lines.push(`\nBEFUNDE:\n${fs.filter((f) => !isRejected(f)).map((f) => `- ${f.no || ''} [${effectiveSeverity(f)}] ${areaLabel(f.area)} · ${f.title} (${f.docName}, ${f.location}): ${f.description.slice(0, 300)} | Zitat: "${f.quote.slice(0, 160)}"${f.evidence === 'unverified' ? ' (Zitat nicht im Text gefunden)' : ''} | Empfehlung: ${f.recommendation.slice(0, 160)}${f.review?.note ? ' | Reviewer: ' + f.review.note.slice(0, 120) : ''}`).join('\n')}`)
  lines.push(`\nDOKUMENTE:\n${matter.documents.map((d) => `- ${d.no || ''} ${d.name} [${d.status}] ${d.docType || ''} ${d.area ? '(' + areaLabel(d.area) + ')' : ''}: ${d.summary.slice(0, 200)}`).join('\n')}`)
  return lines.join('\n').slice(0, maxChars)
}
