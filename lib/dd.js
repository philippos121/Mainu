// Due-diligence pipeline v2: Akt context instead of document silos.
//
// Stages (a checkpoint after each; tokens and cost are counted per stage):
//   0 inventory   SHA-256 across the Akt (duplicates), roles from file names; archives and
//                 e-mails were unpacked on upload (lib/inventory.js)
//   1 text        text of every document (OCR for scans, handwriting/stamps marked), text
//                 hash (duplicates), role and legal subject from the first page – by rules,
//                 else one small model call; secondary sources are not analysed
//   2 extract     facts of every original document (one call per document, cached per
//                 SHA-256); stage 3 starts only when every document is extracted
//   3 facts       facts register of the Akt (no model): precedence, contradictions, the
//                 compact Akt context (lib/facts.js)
//   4 analyse     risk analysis per document WITH the Akt context and the document list:
//                 findings carry features (kind, amount, affected party, curable, core
//                 prerequisite), no grade; quotes that are not in the text are discarded
//   5 crosscheck  Akt rules, Nachweis-Abgleich, hypotheses, exclusion catalogue, grade
//                 by rules (lib/crosscheck.js, lib/severity.js)
//   6 themes      findings merged into themes by a stable key; borderline cases by one
//                 short model call
//   7 legal       every red theme to AI:ssociate, yellow ones by web search (RIS first),
//                 then one calibration call over all red and yellow themes
//   8 summary     area summaries and executive summary from the themes; overall
//                 assessment by rules
//   9 verify      cited norms against the RIS, per theme
//  10 report      Red-Flag report or full report (Word) and the workbook (Excel)
//
// The hard limit per due diligence (DD_HARD_IN / DD_HARD_OUT) holds over all runs: every
// model call reserves its estimated tokens before it starts.
import crypto from 'node:crypto'
import { DD_AREAS, DD_AREA_KEYS, SEVERITIES, DEAL_IMPACTS, TRANSACTION_NOTES, PIPELINE_VERSION, INVENTORY_SCHEMA, EXTRACT_SCHEMA, ANALYSIS_SCHEMA, PROOF_SCHEMA, THEME_MERGE_SCHEMA, CALIBRATION_SCHEMA, AREA_SYNTHESIS_SCHEMA, EXEC_SUMMARY_SCHEMA, CORE_PREREQUISITES, EXCLUSIONS, FACT_TYPES, FINDING_KINDS, LEGAL_SUBJECTS, DOC_ROLES, SKIP_REASONS } from './ddconfig.js'
import { buildDdDocx, buildDdXlsx, buildTableXlsx } from './report.js'
import { JsonStore } from './store.js'
import { roleByRule, subjectByRule, textHash, handwritingPages, reconcile } from './inventory.js'
import { buildRegister, aktContext, documentList, keyFigures } from './facts.js'
import { aktRules, findProof } from './crosscheck.js'
import { exclusionOf, gradeOf, buildThemes, borderlinePairs, applyCalibration, overallAssessment, findingKey, effectiveGrade, liveTheme, GRADE_RANK } from './severity.js'

const CHUNK_CHARS = 150_000
const CHUNK_OVERLAP = 2_000
const MAX_CHUNKS_PER_DOC = 8
const SEV_RANK = GRADE_RANK
// Hard limit per due diligence (all runs together), not adjustable in the UI.
export const DD_HARD_IN = Number(process.env.DD_MAX_INPUT_TOKENS || 100_000_000)
export const DD_HARD_OUT = Number(process.env.DD_MAX_OUTPUT_TOKENS || 10_000_000)
const DD_CONTEXT_MAX_TOKENS = Number(process.env.DD_CONTEXT_MAX_TOKENS || 4000)
const DD_RED_WARN = Number(process.env.DD_RED_WARN || 12)
const SECONDARY_AS_HYPOTHESES = /^(1|true|on|yes)$/i.test(process.env.DD_SECONDARY_AS_HYPOTHESES || '')
// AI:ssociate questions: by default one per red theme, at most 30 (DD_MAX_KB_CALLS lowers the cap).
const DD_MAX_KB_CALLS = Math.min(30, Number(process.env.DD_MAX_KB_CALLS || 30))
export const DD_STAGES = ['inventory', 'text', 'extract', 'facts', 'analyse', 'crosscheck', 'themes', 'legal', 'summary', 'verify', 'report']
const TEXT_STATES = ['read', 'extracted', 'analysed']

/** Runs async tasks with at most n at a time (one pool for all model calls of a run). */
function pool(n) {
  let active = 0
  const waiting = []
  const next = () => { if (active >= n || !waiting.length) return; active++; const { fn, ok, fail } = waiting.shift(); Promise.resolve().then(fn).then(ok, fail).finally(() => { active--; next() }) }
  return (fn) => new Promise((ok, fail) => { waiting.push({ fn, ok, fail }); next() })
}
const hash = (x) => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 24)

export function newMatter({ ownerKey, name, kind = 'matter', client = '', settings = {} }) {
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '')
  const s = {
    transaction: settings.transaction === 'asset' ? 'asset' : 'share',
    perspective: settings.perspective === 'seller' ? 'seller' : 'buyer',
    areas: Array.isArray(settings.areas) && settings.areas.length ? settings.areas.filter((a) => DD_AREA_KEYS.includes(a)) : DD_AREA_KEYS.slice(),
    materialityEur: Number(settings.materialityEur) > 0 ? Number(settings.materialityEur) : 50_000,
    target: String(settings.target || '').slice(0, 200),
    targetFn: String(settings.targetFn || '').replace(/\s+/g, '').slice(0, 20),
    stichtag: date(settings.stichtag),
    closing: date(settings.closing),
    sellers: settings.sellers === 'partial' ? 'partial' : 'all',
    reportType: settings.reportType === 'full' ? 'full' : 'redflag',
    secondaryAsHypotheses: settings.secondaryAsHypotheses == null ? SECONDARY_AS_HYPOTHESES : Boolean(settings.secondaryAsHypotheses),
    reference: String(settings.reference || '').slice(0, 60),
    budgetTokens: DD_HARD_IN,
    budgetOutTokens: DD_HARD_OUT,
    knowledgeBase: settings.knowledgeBase !== false,
    language: 'de',
  }
  return {
    id: JsonStore.newId('m'), ownerKey, name: String(name || 'Neuer Akt').slice(0, 120), kind: kind === 'dd' ? 'dd' : 'matter', client: String(client || '').slice(0, 120), version: 2,
    createdAt: Date.now(), updatedAt: Date.now(), settings: s, seq: { doc: 0, finding: 0, theme: 0 },
    documents: [], findings: [], themes: [], orphanThemes: [], facts: null, factCorrections: [], themeOps: { assign: {}, merges: {}, manual: [] },
    areaSummaries: {}, executive: null, verification: null, reports: [], tables: [], conversations: [],
    job: { status: 'idle', stage: null, progress: { done: 0, total: 0 }, usage: newUsage(), startedAt: null, finishedAt: null, error: null, pauseRequested: false, log: [], jobId: null, cost: null, checkpoints: {}, stageUsage: {} },
  }
}

/** Stable display ids (D-001, F-001) that stay identical in UI, Word and Excel. */
export function nextNo(matter, kind) {
  matter.seq ||= { doc: 0, finding: 0 }
  matter.seq[kind] ||= 0
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

const charsOf = (d) => d.textChars || Math.min(d.size || 0, 4_000_000) * (/\.pdf$/i.test(d.name) ? 0.35 : /\.docx$/i.test(d.name) ? 0.08 : 1)
const chunksOf = (d) => Math.min(MAX_CHUNKS_PER_DOC, Math.max(1, Math.ceil(charsOf(d) / CHUNK_CHARS)))
/** Rough pre-run estimate so the user sees tokens, cost and time before confirming. */
export function estimateRun(matter, priceIn = 2, priceOut = 10, concurrency = 24) {
  const open = matter.documents.filter((d) => !d.container && ['new', 'read', 'extracted'].includes(d.status))
  const all = matter.documents.filter((d) => !d.container && d.status !== 'skipped' && d.status !== 'error')
  let chars = 0
  for (const d of open) chars += Math.min(charsOf(d), CHUNK_CHARS * MAX_CHUNKS_PER_DOC)
  const chunks = open.reduce((n, d) => n + chunksOf(d), 0)
  const ctxTok = DD_CONTEXT_MAX_TOKENS + all.length * 30 + 3000
  // stage 2 (extraction) and stage 4 (analysis with the Akt context) read every new document once each
  const extractIn = chars / 3.2 + chunks * 2500, analyseIn = chars / 3.2 + chunks * (2500 + ctxTok)
  const themesGuess = Math.max(5, Math.round(all.length * 0.35)), redGuess = Math.min(DD_MAX_KB_CALLS, Math.max(2, Math.round(themesGuess * 0.2)))
  const areasTouched = Math.min(matter.settings.areas.length, Math.max(1, all.length))
  const legalIn = redGuess * 6000 + (themesGuess - redGuess) * 16_000, proofIn = Math.round(all.length * 0.4) * 5000
  const inTok = Math.round(extractIn + analyseIn + proofIn + legalIn + 60_000 + 25_000 * areasTouched + 15_000)
  const outTok = Math.round(chunks * 3000 + chunks * 6000 + proofIn / 10 + themesGuess * 1500 + 8000 + 4000 * areasTouched + 4000)
  const kbCalls = matter.settings.knowledgeBase !== false ? redGuess : 0
  // Waves of parallel calls: extraction (fast) and analysis (medium effort), then legal checks and summaries.
  const minutes = Math.max(3, Math.round(Math.ceil(chunks / concurrency) * 1.6 + Math.ceil(themesGuess / concurrency) * 0.8 + 3))
  const inC = Math.min(inTok, DD_HARD_IN), outC = Math.min(outTok, DD_HARD_OUT)
  return { documents: open.length, chunks, inTok: inC, outTok: outC, usd: +((inC / 1e6) * priceIn + (outC / 1e6) * priceOut).toFixed(2), kbCalls, minutes, limitIn: DD_HARD_IN, limitOut: DD_HARD_OUT, cached: true }
}

function newUsage() { return { byModel: {}, inTok: 0, outTok: 0, cachedTok: 0, webSearchCalls: 0, aissociateCalls: 0, calls: 0 } }

/** Model-call context of a matter: usage accumulates over every run; the limits are the hard ones. */
function matterCtx(matter) {
  const u = (matter.job.usage ||= newUsage())
  for (const [k, v] of Object.entries(newUsage())) if (u[k] == null) u[k] = v
  return { usage: u, limits: { inMax: DD_HARD_IN, outMax: DD_HARD_OUT } }
}

export function newDocument({ name, size, source = 'upload', ms = null, no = '' }) {
  return { id: JsonStore.newId('d'), no, name: String(name).slice(0, 200), size: Number(size) || 0, source, ms, file: null, status: 'new', note: '', textChars: 0, pages: null, chunks: 0, truncated: false, docType: '', area: '', title: '', summary: '', date: '', parties: [], dates: [], keyTerms: [], missing: [], questions: [], flags: { red: 0, amber: 0, green: 0, info: 0 }, sha256: '', textHash: '', duplicateOf: null, parent: null, container: false, role: '', roleBy: '', subject: '', skipReason: '', facts: null, handwritingPages: [], addedAt: Date.now(), analysedAt: null }
}
/** Marks a document as skipped (it stays in the inventory with the reason). */
export function skipDoc(d, reason, detail = '') { d.status = 'skipped'; d.skipReason = reason; d.note = [SKIP_REASONS[reason] || reason, detail].filter(Boolean).join(': ') }

/** A finding as stored on the matter: features from the model or a rule, grade from lib/severity.js. */
export function newFinding(matter, d, f) {
  const x = {
    id: JsonStore.newId('f'), no: nextNo(matter, 'finding'), docId: d?.id || '', docNo: d?.no || '', docName: d?.name || '',
    area: DD_AREA_KEYS.includes(f.area) ? f.area : (DD_AREA_KEYS.includes(d?.area) ? d.area : 'none'),
    rule: String(f.rule || '').slice(0, 20), aktRule: String(f.aktRule || '').slice(0, 20), title: String(f.title || '').slice(0, 200), gegenstand: String(f.gegenstand || '').slice(0, 120), gegenpartei: String(f.gegenpartei || '').slice(0, 120),
    art: FINDING_KINDS[f.art] ? f.art : 'mangel', betrag: Number.isFinite(f.betrag) ? f.betrag : null, betroffen: LEGAL_SUBJECTS.includes(f.betroffen) ? f.betroffen : 'Zielgesellschaft', heilbar: Boolean(f.heilbar), kernvoraussetzung: Boolean(f.kernvoraussetzung),
    description: String(f.description || ''), quote: String(f.quote || '').slice(0, 600), location: String(f.location || '').slice(0, 120), recommendation: String(f.recommendation || ''),
    dealImpact: DEAL_IMPACTS.includes(f.instrument || f.deal_impact || f.dealImpact) ? (f.instrument || f.deal_impact || f.dealImpact) : 'keine',
    norms: Array.isArray(f.norms) ? f.norms.map(String).slice(0, 8) : [], normStatus: [], nachweis: String(f.nachweis || '').slice(0, 200),
    quelle: f.quelle || (f.source === 'manual' ? 'manual' : 'einzelanalyse'), source: f.source === 'manual' ? 'manual' : 'model', facts: f.facts || [],
    evidence: 'unverified', belegOriginal: d?.role !== 'Sekundärquelle', fromDraft: d?.role === 'Entwurf', severity: SEVERITIES.includes(f.severity) ? f.severity : null, gradeWhy: '', unconfirmed: false, proof: null, excluded: null, discarded: null, themeId: null,
    review: { status: 'open', severity: null, note: '', ts: null },
  }
  x.key = findingKey(x, d?.sha256)
  return x
}
/** Severity after review (reviewer override wins). */
export const effectiveSeverity = (f) => (f.review?.severity && SEVERITIES.includes(f.review.severity) ? f.review.severity : f.severity)
export const isRejected = (f) => f.review?.status === 'rejected' || Boolean(f.excluded) || Boolean(f.discarded)

const areaLabel = (k) => DD_AREAS.find((a) => a.key === k)?.label || (k === 'none' ? 'Allgemein' : k)
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zäöüß0-9]+/g, ' ').trim()
const dealLine = (s) => `${s.transaction === 'asset' ? 'Asset Deal' : 'Share Deal'}, Perspektive ${s.perspective === 'seller' ? 'Verkäufer' : 'Käufer'}${s.target ? `, Zielgesellschaft ${s.target}` : ''}${s.targetFn ? ` (FN ${s.targetFn})` : ''}${s.stichtag ? `, Stichtag ${s.stichtag}` : ''}`

const FACT_GUIDE = `- gesellschafter: subject = Name des Gesellschafters; attribute "Geschäftsanteil"; value = Anteil bzw. Stammeinlage; valid_from/valid_to = Erwerb/Ausscheiden
- organ / prokura: subject = Name der Person; attribute = Funktion (Geschäftsführer, Vorstand, Aufsichtsrat, Prokurist); value = Vertretungsbefugnis; Flags ausgeschieden/verstorben
- todesfall: subject = Name der verstorbenen Person; valid_to = Todestag; value = Erben/Verlassenschaft
- funktionstraeger: Personen, die ein Bescheid als Funktionsträger nennt – subject = Name; attribute = Funktion (gewerberechtlicher Geschäftsführer, abfallrechtlicher Geschäftsführer, fachkundige Person, Verkehrsleiter); counterparty = Behörde/Bescheid; value = Berechtigung
- genehmigung: subject = Gegenstand der Genehmigung/Berechtigung; counterparty = Inhaber; site = Standort; valid_to = Befristung; attribute = Behörde und Datum
- standort: subject = Standort/Liegenschaft; attribute = Nutzungsrecht (Eigentum, Miete, Pacht, Baurecht); counterparty = Eigentümer/Vermieter; valid_to = Ende
- vertrag: subject = Vertragsgegenstand; counterparty = Vertragspartner; amount = Vertragswert/Kreditbetrag; valid_to = Laufzeitende; Flag kontrollwechsel, wenn eine Change-of-Control-/Gesellschafterwechselklausel enthalten ist
- zahlung_gesellschafter: subject = Zahlungsgrund; counterparty = empfangender Gesellschafter; amount; valid_from = Datum (auch Ausschüttungen)
- kennzahl (nur aus Jahresabschlüssen): attribute = Umsatz, Jahresergebnis, Eigenkapital, Eigenkapitalquote, Bilanzsumme, Liquide Mittel, Bankverbindlichkeiten, Verbindlichkeiten gegenüber Gesellschaftern; amount = Wert (Quote in Prozent); valid_from = Bilanzstichtag
- beschluss: subject = Beschlussgegenstand; value = Namen der abstimmenden bzw. unterzeichnenden Gesellschafter, mit Komma getrennt; valid_from = Datum
- recht_dritter: subject = Recht (Fruchtgenuss, Stimmbindung, Pfandrecht, Vorkaufsrecht) und woran; counterparty = Berechtigter; Flag erloschen, wenn erloschen`

function extractInstructions(matter) {
  return `Du bist Rechtsanwaltsanwärter in einer österreichischen Transaktionskanzlei und erfasst für eine Due Diligence (${dealLine(matter.settings)}) die FAKTEN aus EINEM Dokument des Datenraums – ohne Bewertung. Antworte ausschließlich als JSON nach Schema.

FAKTENTYPEN (nur erfassen, was im Dokument steht)
${FACT_GUIDE}

REGELN
- Jede Tatsache mit wörtlichem Beleg (exakt aus dem Text kopiert, max. 200 Zeichen – wird maschinell gesucht) und Fundstelle; ohne Beleg nicht erfassen.
- Daten als JJJJ-MM-TT (nur Jahr: JJJJ), Beträge als Zahl in EUR. Nichts schätzen, nichts ergänzen.
- subject (Rechtssubjekt des Dokuments): Zielgesellschaft, Gesellschafter, Vorbetreiber (frühere Betreiber/Rechtsvorgänger) oder Dritter.
- Handschriftliches ([handschriftlich: …]) und Stempel ([Stempel: …]) sind Teil des Dokuments.
- Kurz und vollständig: lieber alle Gesellschafter, Organe, Genehmigungen und Verträge als lange Beschreibungen.`
}

function analyseInstructions(matter, context, docList) {
  const s = matter.settings
  const areas = DD_AREAS.filter((a) => s.areas.includes(a.key))
  return `Du bist ein erfahrener österreichischer Transaktionsanwalt und Steuerberater und führst eine ${s.transaction === 'asset' ? 'Asset-Deal' : 'Share-Deal'}-Due-Diligence aus Sicht des ${s.perspective === 'seller' ? 'Verkäufers (Vendor DD)' : 'Käufers'} durch. Du prüfst EIN Dokument – mit dem Wissen über den ganzen Akt (Aktkontext unten). Antworte ausschließlich als JSON nach Schema.

TRANSAKTIONSSTRUKTUR: ${TRANSACTION_NOTES[s.transaction] || TRANSACTION_NOTES.share}

PRÜFBEREICHE UND RED-FLAG-KATALOG (Regel-IDs)
${areas.map((a) => `- ${a.key} (${a.label}): ${a.redFlags}`).join('\n')}

KERNVORAUSSETZUNGEN DES GESCHÄFTS (Merkmal kernvoraussetzung)
${CORE_PREREQUISITES.map((x) => '- ' + x).join('\n')}

KEINE BEFUNDE ZU (Ausschlusskatalog)
${EXCLUSIONS.map((x) => '- ' + x.label).join('\n')}

REGELN
- Du vergibst KEINEN Schweregrad. Jeder Befund beschreibt Merkmale: art (mangel = festgestellter Mangel; luecke = Erforderliches ist nicht nachgewiesen; hinweis), betrag (EUR oder null), betroffen (wen das Risiko rechtlich trifft), heilbar (vor Closing), kernvoraussetzung, instrument (CP, Garantie, Freistellung, Kaufpreis, Abbruch, Nachfrage, keine).
- Nur im Dokument belegte Befunde: WÖRTLICHES Zitat (exakt kopiert, max. 300 Zeichen; Zitate, die nicht im Text stehen, werden verworfen) und Fundstelle. Keine generischen Befunde.
- Nutze den Aktkontext: Was laut Aktkontext oder Dokumentliste anderswo im Akt belegt ist, ist KEINE Lücke. Widersprüche zum Aktkontext sind Befunde (art mangel).
- gegenstand knapp und gleichbleibend benennen (z. B. "abfallrechtliche Erlaubnis Standort Wels"), damit gleiche Themen über Dokumente hinweg zusammengeführt werden; gegenpartei = Vertragspartner/Behörde/Person.
- Wesentlichkeitsschwelle ${s.materialityEur.toLocaleString('de-DE')} EUR. Höchstens 8 Befunde je Dokumentteil, nur wesentliche; Hinweise knapp.
- Rechtliche Einordnung nach österreichischem Recht mit konkreten Normen; keine Normen erfinden.
- missing_or_unclear höchstens 3; questions höchstens 2 wesentliche Nachfragen.
- Sprache: Deutsch, präzise, Kanzleistil.

AKTKONTEXT (Faktenregister des ganzen Akts)
${context}

DOKUMENTLISTE (Nr | Typ | Rolle | Datum | Titel)
${docList}`
}

/** Merge chunk extractions of one document into one result. */
function mergeExtractions(parts) {
  const first = parts[0]
  const out = { ...first, parties: [], key_terms: [], facts: [] }
  const seen = { parties: new Set(), terms: new Set(), facts: new Set() }
  for (const p of parts) {
    for (const x of p.parties || []) { const k = norm(x); if (k && !seen.parties.has(k)) { seen.parties.add(k); out.parties.push(x) } }
    for (const t of p.key_terms || []) { const k = norm(t.term); if (k && !seen.terms.has(k)) { seen.terms.add(k); out.key_terms.push(t) } }
    for (const f of p.facts || []) { const k = norm(`${f.type} ${f.subject} ${f.attribute} ${f.value} ${f.counterparty}`); if (k && !seen.facts.has(k)) { seen.facts.add(k); out.facts.push(f) } }
  }
  return out
}
function mergeAnalyses(parts) {
  const out = { findings: [], missing_or_unclear: [], questions: [] }
  const seen = new Set()
  for (const p of parts) {
    for (const f of p.findings || []) { const k = norm(f.title).slice(0, 60) + '|' + norm(f.gegenstand); if (!seen.has(k)) { seen.add(k); out.findings.push(f) } }
    for (const m of p.missing_or_unclear || []) if (!out.missing_or_unclear.some((x) => norm(x) === norm(m))) out.missing_or_unclear.push(m)
    for (const q of p.questions || []) if (!out.questions.some((x) => norm(x) === norm(q))) out.questions.push(q)
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

/** Text of the given documents (status new|inventoried → read | skipped); 'paused' when interrupted. */
async function readDocuments(matter, deps, docs, log) {
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
      if (r.unsupported) skipDoc(d, 'unsupported')
      else if (!r.text.trim()) skipDoc(d, room ? 'unreadable' : 'budget', r.ocrError ? `OCR fehlgeschlagen: ${r.ocrError.slice(0, 80)}` : room ? 'auch nicht per OCR' : 'OCR nicht mehr möglich')
      else {
        await store.putText(matter.id, d.id, r.text)
        d.status = 'read'; d.skipReason = ''; d.note = r.ocr ? `per OCR gelesen${r.ocrTruncated ? ' (nur die ersten Seiten)' : ''}` : ''
        d.textHash = textHash(r.text); d.handwritingPages = handwritingPages(r.text)
      }
    } catch (e) { skipDoc(d, 'failed', String(e?.message || e).slice(0, 160)) }
    if (matter.job.progress) matter.job.progress.done++
    log(`Text gelesen: ${d.no || ''} ${d.name}${d.note ? ' · ' + d.note : ''}`)
    if (Date.now() - lastSave > 2000) { lastSave = Date.now(); await store.saveMatter(matter) }
  })))
  await store.saveMatter(matter)
  return paused ? 'paused' : 'done'
}

/** Old matters (pipeline v1): texts stay, the analysis is redone with the new pipeline. */
function migrate(matter, log) {
  if ((matter.version || 1) >= 2) return
  for (const d of matter.documents) {
    if (d.status === 'extracted' || d.status === 'analysed') d.status = 'read'
    else if (d.status === 'error') { if (/kein text|gescannt|ocr|nicht lesbar/i.test(d.note || '')) { d.status = 'new'; d.note = '' } else skipDoc(d, 'failed', d.note) }
    Object.assign(d, { sha256: d.sha256 || '', textHash: d.textHash || '', duplicateOf: d.duplicateOf || null, parent: d.parent || null, role: d.role || '', subject: d.subject || '', facts: null })
  }
  matter.findings = (matter.findings || []).filter((f) => f.source === 'manual')
  Object.assign(matter, { themes: [], orphanThemes: [], facts: null, factCorrections: matter.factCorrections || [], themeOps: matter.themeOps || { assign: {}, merges: {}, manual: [] }, areaSummaries: {}, executive: null, verification: null, version: 2 })
  matter.seq.theme ||= 0
  matter.job.checkpoints = {}; matter.job.stageUsage = {}
  log('Akt auf die Pipeline v2 umgestellt: Texte bleiben, Fakten, Befunde und Themen werden neu erstellt.')
}

/**
 * Run (or resume) the DD pipeline of a matter.
 * deps: { store, callModel, extractText, modelMain, modelExtract, effort, concurrency, verifyAnswer,
 *   computeCost, send, askKnowledgeBase, answerEasyLegal, cache: { get, set }, searchIndex(matter) }
 * opts: { fromStage: 5 } recomputes from the crosscheck (facts corrections, review changes).
 */
export async function runDd(matter, deps, opts = {}) {
  const { store, send } = deps
  const ctx = matterCtx(matter)
  const log = (message) => { matter.job.log.push({ t: Date.now(), message }); if (matter.job.log.length > 600) matter.job.log.splice(0, matter.job.log.length - 600); send('dd', { matterId: matter.id, stage: matter.job.stage, progress: matter.job.progress, message }) }
  const save = () => store.saveMatter(matter)
  const paused = () => matter.job.pauseRequested
  const overBudget = () => ctx.usage.inTok >= DD_HARD_IN || ctx.usage.outTok >= DD_HARD_OUT
  const s = matter.settings
  // Knowledge-base and web answers have no token report: they count with an estimate (chars / 3.2 + retrieval overhead).
  const countExternal = (question, answer) => { const i = Math.ceil(String(question || '').length / 3.2) + 2500; const o = Math.ceil(String(answer || '').length / 3.2); ctx.usage.inTok += i; ctx.usage.outTok += o; const m = (ctx.usage.byModel.aissociate ||= { inTok: 0, outTok: 0, cachedTok: 0, calls: 0 }); m.inTok += i; m.outTok += o; m.calls++; ctx.usage.aissociateCalls++ }
  const stop = async (status, reason) => { matter.job.status = status; matter.job.error = reason || null; matter.job.pauseRequested = false; matter.job.finishedAt = Date.now(); await save(); send('dd', { matterId: matter.id, stage: matter.job.stage, progress: matter.job.progress, status, message: reason || status }); return matter }
  const cache = deps.cache || { get: async () => null, set: async () => {} }
  const noCache = Boolean(opts.reanalyse)

  matter.job.status = 'running'; matter.job.error = null; matter.job.pauseRequested = false; matter.job.startedAt = matter.job.startedAt || Date.now(); matter.job.finishedAt = null
  matter.job.checkpoints ||= {}; matter.job.stageUsage ||= {}
  migrate(matter, log)
  await save()

  // ---- shared machinery: one pool for every model call, the hard limit with reservations ----
  let halt = null
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
  const isBudget = (e) => e?.name === 'BudgetExceeded' || /Token-Budget/.test(String(e?.message))
  /** One structured model call within the pool and the limit; one more try after a pause (rate limits). */
  const ask = (p, schemaName, schema) => {
    const estIn = Math.ceil((String(p.instructions || '').length + JSON.stringify(p.input || '').length) / 2.5) + 1500
    const maxOut = p.maxOut || 8000
    return limit(() => reserved(estIn, maxOut, async () => {
      const call = () => deps.callModel(ctx, { ...p, maxOut, temperature: 0, ...(schema ? { text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } } } : {}) })
      let resp
      try { resp = await call() } catch (e) { if (isBudget(e)) throw e; await new Promise((r) => setTimeout(r, 8000)); resp = await call() }
      if (!schema) return resp
      let parsed = null
      try { parsed = JSON.parse(resp.output_text || '') } catch {}
      if (!parsed) throw new Error('Modell lieferte kein gültiges JSON' + (resp.status === 'incomplete' ? ' (Ausgabe abgeschnitten)' : ''))
      return parsed
    }))
  }
  // Checkpoints and token counters per stage.
  let stageStart = null
  const beginStage = (name, total = 0) => { matter.job.stage = name; matter.job.progress = { done: 0, total }; stageStart = { in: ctx.usage.inTok, out: ctx.usage.outTok, calls: ctx.usage.calls } }
  const endStage = async (name) => {
    const u = (matter.job.stageUsage[name] ||= { inTok: 0, outTok: 0, calls: 0, usd: 0 })
    u.inTok += ctx.usage.inTok - stageStart.in; u.outTok += ctx.usage.outTok - stageStart.out; u.calls += ctx.usage.calls - stageStart.calls
    if (deps.computeCost) { const c = deps.computeCost({ ...ctx.usage, inTok: u.inTok, outTok: u.outTok, byModel: { [deps.modelExtract]: { inTok: u.inTok, outTok: u.outTok, cachedTok: 0, calls: u.calls } } }, 0); u.usd = c?.totalUsd ?? 0 }
    matter.job.checkpoints[name] = Date.now()
    await save()
  }
  let lastSave = 0
  const saveSoon = async () => { if (Date.now() - lastSave > 2000) { lastSave = Date.now(); await save() } }
  const settingsSig = hash([s.transaction, s.perspective, s.materialityEur, s.target, s.targetFn, s.stichtag, s.areas, s.sellers])
  const docText = new Map()
  const textOf = async (d) => { if (!docText.has(d.id)) docText.set(d.id, await store.getText(matter.id, d.id)); return docText.get(d.id) }

  // Recompute from the crosscheck only when no document is waiting for stages 0–4.
  let from = Number(opts.fromStage) || 0
  if (from >= 5 && matter.documents.some((d) => !d.container && ['new', 'read', 'extracted'].includes(d.status))) from = 0

  try {
    if (from < 5) {
      // ---- 0 inventory: hashes across the Akt, duplicates, roles from file names ----
      beginStage('inventory', matter.documents.length)
      for (const d of matter.documents) if (d.status === 'skipped' && ['unreadable', 'failed', 'budget'].includes(d.skipReason) && d.file) { d.status = 'new'; d.skipReason = ''; d.note = '' } // scans and failures are tried again
      const bySha = new Map()
      for (const d of matter.documents) {
        if (d.container) continue
        if (!d.sha256 && d.file) { const buf = await store.getFile(matter.id, d.file); if (buf) d.sha256 = crypto.createHash('sha256').update(buf).digest('hex') }
        const first = d.sha256 && bySha.get(d.sha256)
        if (first && first.id !== d.id) { if (d.duplicateOf !== first.id || d.status !== 'skipped') { d.duplicateOf = first.id; skipDoc(d, 'duplicate', `von ${first.no}`) } }
        else if (d.sha256) bySha.set(d.sha256, d)
        if (!d.role) { const r = roleByRule({ name: d.name, folder: d.folder }); if (r) { d.role = r; d.roleBy = 'Dateiname' } }
        matter.job.progress.done++
      }
      log(`Inventar: ${matter.documents.filter((d) => !d.container).length} Dokumente, ${matter.documents.filter((d) => d.duplicateOf).length} Duplikate (SHA-256)`)
      await endStage('inventory')

      // ---- 1 text (+ text-hash duplicates, roles and legal subjects from the first page) ----
      const toRead = matter.documents.filter((d) => !d.container && d.status === 'new')
      beginStage('text', toRead.length)
      if ((await readDocuments(matter, deps, toRead, log)) === 'paused') return stop('paused', 'Pausiert')
      const byText = new Map()
      for (const d of matter.documents) {
        if (d.container || !d.textHash || d.duplicateOf) continue
        const first = byText.get(d.textHash)
        if (first && first.id !== d.id) { d.duplicateOf = first.id; skipDoc(d, 'duplicate', `inhaltsgleich mit ${first.no}`) }
        else byText.set(d.textHash, d)
      }
      const unknown = []
      for (const d of matter.documents.filter((x) => x.status === 'read' && (!x.role || !x.subject))) {
        const head = (await textOf(d)).slice(0, 3000)
        if (!d.role) { const r = roleByRule({ name: d.name, folder: d.folder, head }); if (r) { d.role = r; d.roleBy = 'erste Seite' } }
        if (!d.subject) { const sj = subjectByRule({ head, target: s.target }); if (sj) d.subject = sj }
        if (!d.role || !d.subject) unknown.push([d, head])
      }
      if (unknown.length) log(`Rolle/Rechtssubjekt per Modell für ${unknown.length} Dokument${unknown.length > 1 ? 'e' : ''} (erste 3.000 Zeichen)`)
      await Promise.all(unknown.map(async ([d, head]) => {
        try {
          const key = `inv|${PIPELINE_VERSION.inventory}|${d.sha256}|${hash(s.target)}`
          let r = noCache ? null : await cache.get(key)
          if (!r) { r = await ask({ model: deps.modelExtract, effort: 'low', maxOut: 800, instructions: `Ordne ein Dokument aus dem Datenraum einer Due Diligence ein (${dealLine(s)}). Antworte als JSON nach Schema.`, input: [{ role: 'user', content: `DATEI: ${d.folder ? d.folder + '/' : ''}${d.name}\n\n${head}` }] }, 'dd_inventory', INVENTORY_SCHEMA); await cache.set(key, r) }
          if (!d.role) { d.role = DOC_ROLES.includes(r.role) ? r.role : 'Originalunterlage'; d.roleBy = 'Modell' }
          if (!d.subject) d.subject = r.subject
          if (!d.docType) d.docType = r.doc_type
        } catch (e) { if (e?.message === 'halt' || isBudget(e)) return; d.role ||= 'Originalunterlage'; d.roleBy ||= 'Standard' }
      }))
      if (halt) return stop(halt[0], halt[1])
      for (const d of matter.documents) if (d.status === 'read' && d.role === 'Sekundärquelle' && !s.secondaryAsHypotheses) skipDoc(d, 'secondary', 'nur als Hinweisquelle, nicht analysiert')
      await endStage('text')

      // ---- 2 extraction: facts per document (cached per SHA-256) ----
      const toExtract = matter.documents.filter((d) => d.status === 'read' && d.role !== 'Sekundärquelle')
      beginStage('extract', toExtract.length)
      const exInstr = extractInstructions(matter)
      await Promise.all(toExtract.map(async (d) => {
        try {
          const text = await textOf(d)
          const key = `ext|${PIPELINE_VERSION.extract}|${d.sha256 || d.textHash}`
          let r = noCache ? null : await cache.get(key)
          if (!r) {
            const { chunks } = chunkText(text)
            const parts = await Promise.all(chunks.map((chunk, i) => ask({ model: deps.modelExtract, effort: 'low', maxOut: 10_000, instructions: exInstr, input: [{ role: 'user', content: `DOKUMENT: ${d.no} ${d.folder ? d.folder + '/' : ''}${d.name}${chunks.length > 1 ? ` (Teil ${i + 1}/${chunks.length})` : ''}\n\n=== TEXT ===\n${chunk}` }] }, 'dd_extract', EXTRACT_SCHEMA)))
            r = mergeExtractions(parts)
            await cache.set(key, r)
          }
          // Facts without a quote that is really in the text do not enter the register.
          const facts = []
          for (const f of r.facts || []) { const st = locateQuote(text, f.quote).status; if (st !== 'unverified') facts.push({ ...f, evidence: st }) }
          Object.assign(d, { docType: r.doc_type, area: r.area, title: r.title, date: r.date || '', summary: r.summary, parties: r.parties, keyTerms: r.key_terms, facts, factsDropped: (r.facts || []).length - facts.length })
          if (!d.subject || d.roleBy !== 'Prüfer') d.subject = r.subject || d.subject
          d.status = 'extracted'
          matter.job.progress.done++
          log(`Fakten erfasst: ${d.no} ${d.title || d.name} · ${facts.length} Fakten${d.factsDropped ? ` (${d.factsDropped} ohne Beleg verworfen)` : ''}`)
        } catch (e) {
          if (e?.message === 'halt') return
          if (isBudget(e)) { halt ||= ['paused', limitMsg]; return }
          skipDoc(d, 'failed', 'Extraktion: ' + String(e?.message || e).slice(0, 160))
          log(`Extraktion fehlgeschlagen: ${d.no} ${d.name}`)
        }
        await saveSoon()
      }))
      await save()
      if (halt) return stop(halt[0], halt[1])
      // Lock: the facts register is built only when every document is extracted.
      if (matter.documents.some((d) => d.status === 'read' && d.role !== 'Sekundärquelle')) return stop('paused', 'Nicht alle Dokumente extrahiert – „Analyse fortsetzen“ macht dort weiter.')
      await endStage('extract')
    }

    // ---- 3 facts register (no model) ----
    beginStage('facts', 1)
    const reg = buildRegister(matter)
    matter.facts = reg
    const context = aktContext(matter, reg, DD_CONTEXT_MAX_TOKENS)
    matter.aktContext = context
    log(`Faktenregister: ${reg.entries.length} Fakten aus ${reg.documents} Dokumenten, ${reg.contradictions.length} Widersprüche`)
    await endStage('facts')

    if (from < 5) {
      // ---- 4 risk analysis per document with the Akt context ----
      const hypotheses = s.secondaryAsHypotheses
      const toAnalyse = matter.documents.filter((d) => (d.status === 'extracted' || (hypotheses && d.status === 'read' && d.role === 'Sekundärquelle')))
      beginStage('analyse', toAnalyse.length)
      const instr = analyseInstructions(matter, context, documentList(matter))
      await Promise.all(toAnalyse.map(async (d) => {
        try {
          if (d.role === 'Plan/Zeichnung' || d.role === 'Datenblatt') { d.status = 'analysed'; d.analysedAt = Date.now(); d.note = 'nur Fakten erfasst (Plan/Datenblatt)'; matter.job.progress.done++; return }
          const text = await textOf(d)
          const key = `ana|${PIPELINE_VERSION.analyse}|${d.sha256 || d.textHash}|${settingsSig}|${d.role}`
          let r = noCache ? null : await cache.get(key)
          const { chunks, truncated } = chunkText(text)
          d.chunks = chunks.length; d.truncated = truncated
          if (!r) {
            const parts = await Promise.all(chunks.map((chunk, i) => ask({ model: deps.modelExtract, effort: 'medium', maxOut: 16_000, instructions: instr, input: [{ role: 'user', content: `DOKUMENT: ${d.no} ${d.folder ? d.folder + '/' : ''}${d.name} · Rolle: ${d.role || 'Originalunterlage'}${d.role === 'Sekundärquelle' ? ' (Sekundärquelle: Aussagen sind nur Hinweise, die im Akt zu belegen sind)' : ''}${chunks.length > 1 ? ` (Teil ${i + 1}/${chunks.length}; nur Befunde aus diesem Teil)` : ''}\n\n=== TEXT ===\n${chunk}` }] }, 'dd_analysis', ANALYSIS_SCHEMA)))
            r = mergeAnalyses(parts)
            await cache.set(key, r)
          }
          d.missing = (r.missing_or_unclear || []).slice(0, 3); d.questions = (r.questions || []).slice(0, 2)
          // Findings of this document are rebuilt; numbers and reviewer decisions stay with the finding key.
          const previous = matter.findings.filter((f) => f.docId === d.id && f.quelle !== 'akt_regel' && f.source !== 'manual')
          matter.findings = matter.findings.filter((f) => !(f.docId === d.id && f.quelle !== 'akt_regel' && f.source !== 'manual'))
          let dropped = 0
          for (const raw of r.findings || []) {
            const nf = newFinding(matter, d, { ...raw, quelle: d.role === 'Sekundärquelle' ? 'hypothese' : 'einzelanalyse' })
            nf.evidence = locateQuote(text, nf.quote).status
            if (nf.evidence === 'unverified') { dropped++; matter.seq.finding--; continue } // quote not in the text: discarded
            const old = previous.find((p) => p.key === nf.key)
            if (old) { nf.id = old.id; nf.no = old.no; nf.review = old.review; matter.seq.finding-- }
            matter.findings.push(nf)
          }
          d.status = 'analysed'; d.analysedAt = Date.now()
          d.note = [d.ocr ? 'per OCR gelesen' : '', d.role === 'Sekundärquelle' ? 'Sekundärquelle: Aussagen nur als Hypothesen' : '', truncated ? `nur die ersten ${chunks.length} Teile analysiert (sehr lang)` : '', dropped ? `${dropped} Befund${dropped > 1 ? 'e' : ''} ohne wörtlichen Beleg verworfen` : ''].filter(Boolean).join(' · ')
          matter.job.progress.done++
          log(`Analysiert: ${d.no} ${d.title || d.name} · ${(r.findings || []).length - dropped} Befunde${d.note ? ' · ' + d.note : ''}`)
        } catch (e) {
          if (e?.message === 'halt') return
          if (isBudget(e)) { halt ||= ['paused', limitMsg]; return }
          skipDoc(d, 'failed', 'Analyse: ' + String(e?.message || e).slice(0, 160))
          log(`Analyse fehlgeschlagen: ${d.no} ${d.name}`)
        }
        await saveSoon()
      }))
      await save()
      if (halt) return stop(halt[0], halt[1])
      await endStage('analyse')
    }

    // ---- 5 crosscheck: Akt rules, Nachweis-Abgleich, hypotheses, exclusions, grade by rules ----
    beginStage('crosscheck', 0)
    const docById = new Map(matter.documents.map((d) => [d.id, d]))
    const prevRule = new Map(matter.findings.filter((f) => f.quelle === 'akt_regel').map((f) => [f.key, f]))
    matter.findings = matter.findings.filter((f) => f.quelle !== 'akt_regel')
    for (const rf of aktRules(matter, reg)) {
      const d = docById.get(rf.docId)
      const nf = newFinding(matter, d, rf)
      nf.evidence = d && rf.quote ? locateQuote(await textOf(d), rf.quote).status : 'verified'
      const old = prevRule.get(nf.key)
      if (old) { nf.id = old.id; nf.no = old.no; nf.review = old.review; matter.seq.finding-- }
      matter.findings.push(nf)
    }
    log(`Akt-Regeln: ${matter.findings.filter((f) => f.quelle === 'akt_regel').length} Befunde aus dem Faktenregister`)
    const index = await deps.searchIndex(matter)
    const proveInstr = 'Du prüfst für eine Due Diligence, ob einer der Auszüge aus dem Akt belegt, was gesucht ist. Nur ein eindeutiger Beleg zählt (das gesuchte Dokument bzw. die gesuchte Tatsache liegt vor); bloße Erwähnungen oder Absichten zählen nicht. Antworte als JSON nach Schema.'
    const prove = (f, hits) => ask({ model: deps.modelExtract, effort: 'low', maxOut: 1500, instructions: proveInstr, input: [{ role: 'user', content: `GESUCHT: ${f.quelle === 'hypothese' ? `Bestätigung der Aussage „${f.title}: ${f.description.slice(0, 400)}“` : `Nachweis zu „${f.title}“ – ${f.nachweis || f.gegenstand}`}\n\n${hits.map((p, i) => `[${i + 1}] ${p.docNo} ${p.docName}${p.page ? ` S. ${p.page}` : ''}:\n${p.text}`).join('\n\n')}` }] }, 'dd_proof', PROOF_SCHEMA)
    const toProve = matter.findings.filter((f) => f.source !== 'manual' && ((f.art === 'luecke' && f.quelle === 'einzelanalyse') || f.quelle === 'hypothese'))
    matter.job.progress = { done: 0, total: toProve.length }
    for (const f of matter.findings) { f.excluded = null; f.discarded = null; if (f.quelle !== 'hypothese') f.unconfirmed = false }
    await Promise.all(toProve.map(async (f) => {
      try {
        const memoKey = hash([f.key, f.nachweis, index.signature])
        let r = f.proofMemo === memoKey ? f.proof : await findProof(f, index, prove)
        f.proofMemo = memoKey; f.proof = r
        if (f.quelle === 'hypothese') {
          if (r?.found) { const src = docById.get(f.docId); f.hypothesisFrom = { docId: src?.id, docNo: src?.no, docName: src?.name }; const od = docById.get(r.docId); Object.assign(f, { docId: r.docId, docNo: r.docNo, docName: r.docName, location: r.location || f.location, quote: r.quote || f.quote, belegOriginal: true }); if (od && r.quote) f.evidence = locateQuote(await textOf(od), r.quote).status }
          else { f.belegOriginal = false; f.unconfirmed = true }
        } else if (r?.found) f.discarded = `Nachweis im Akt gefunden: ${r.docNo}${r.location ? ' ' + r.location : ''}${r.note ? ' – ' + r.note : ''}`
      } catch (e) { if (e?.message === 'halt') return; if (isBudget(e)) { halt ||= ['paused', limitMsg]; return } }
      matter.job.progress.done++
    }))
    if (halt) return stop(halt[0], halt[1])
    let excluded = 0
    for (const f of matter.findings) {
      if (f.source === 'manual') { f.severity = f.review?.severity || f.severity || 'amber'; continue }
      f.excluded = exclusionOf(f, reg, s)
      if (f.excluded) { excluded++; f.severity = null; continue }
      if (f.discarded) { f.severity = null; continue }
      const g = gradeOf(f, s)
      if (f.fromDraft && g.grade === 'red') { g.grade = 'amber'; g.why += '; nur in einem Entwurf (höchstens gelb)' }
      f.severity = g.grade; f.gradeWhy = g.why; f.unconfirmed = g.unconfirmed
    }
    for (const d of matter.documents) { d.flags = { red: 0, amber: 0, green: 0, info: 0 }; d.findings = 0 }
    for (const f of matter.findings) { const d = docById.get(f.docId); if (d && f.severity) { d.flags[f.severity]++; d.findings++ } }
    log(`Crosscheck: ${matter.findings.filter((f) => f.discarded).length} Lücken im Akt belegt (verworfen), ${matter.findings.filter((f) => f.quelle === 'hypothese' && f.belegOriginal).length} Hypothesen bestätigt, ${excluded} im Ausschlusskatalog`)
    await endStage('crosscheck')

    // ---- 6 themes ----
    beginStage('themes', 1)
    const built = buildThemes(matter, [...(matter.themes || []), ...(matter.orphanThemes || [])])
    let themes = built.themes
    matter.orphanThemes = built.orphans
    const pairs = borderlinePairs(themes)
    matter.mergeMemo ||= {}
    const open = pairs.filter(([a, b]) => matter.mergeMemo[`${a.key}§${b.key}`] === undefined)
    if (open.length) {
      try {
        const r = await ask({ model: deps.modelMain, effort: 'low', maxOut: 2000, instructions: 'Du prüfst für einen Due-Diligence-Bericht, ob zwei Themen denselben Sachverhalt betreffen (gleicher Gegenstand, gleiche Gegenpartei, gleiche rechtliche Frage) und daher zusammengeführt werden. Im Zweifel getrennt lassen. Antworte als JSON nach Schema.', input: [{ role: 'user', content: open.map(([a, b], i) => `${i + 1}. A: ${a.title} (${a.gegenstand}; ${a.gegenpartei || '–'}) | B: ${b.title} (${b.gegenstand}; ${b.gegenpartei || '–'})`).join('\n') }] }, 'dd_theme_merge', THEME_MERGE_SCHEMA)
        open.forEach(([a, b], i) => { matter.mergeMemo[`${a.key}§${b.key}`] = (r.same || []).includes(i + 1) })
      } catch (e) { if (isBudget(e) || e?.message === 'halt') return stop(halt?.[0] || 'paused', halt?.[1] || limitMsg) }
    }
    for (const [a, b] of pairs) {
      if (!matter.mergeMemo[`${a.key}§${b.key}`] || a.mergedInto || b.mergedInto) continue
      a.findingIds.push(...b.findingIds); a.docIds = [...new Set([...a.docIds, ...b.docIds])]; a.norms = [...new Set([...a.norms, ...b.norms])]
      if (GRADE_RANK[b.gradeComputed] < GRADE_RANK[a.gradeComputed]) a.gradeComputed = b.gradeComputed
      b.mergedInto = a.no
      for (const f of matter.findings) if (f.themeId === b.id) f.themeId = a.id
    }
    themes = themes.filter((t) => !t.mergedInto)
    matter.themes = themes
    log(`Themen: ${themes.length} (${themes.filter((t) => t.gradeComputed === 'red').length} rot, ${themes.filter((t) => t.gradeComputed === 'amber').length} gelb vor der Kalibrierung)`)
    await endStage('themes')

    // ---- 7 legal check of red and yellow themes, then the calibration ----
    const reds = themes.filter((t) => liveTheme(t) && !t.manual && t.gradeComputed === 'red')
    const ambers = themes.filter((t) => liveTheme(t) && !t.manual && t.gradeComputed === 'amber')
    beginStage('legal', reds.length + ambers.length + 1)
    const findingById = new Map(matter.findings.map((f) => [f.id, f]))
    const factById = new Map(reg.entries.map((e) => [e.id, e]))
    const themeQuestion = (t) => {
      const fs = t.findingIds.map((id) => findingById.get(id)).filter(Boolean)
      const facts = [...new Set(fs.flatMap((f) => f.facts || []))].map((id) => factById.get(id)).filter(Boolean).slice(0, 12)
      return `${dealLine(s)}. Prüfe einen Befund aus der Due Diligence: Ist der Befund unter diesen Fakten rechtlich zutreffend und noch relevant? Beginne mit „zutreffend“, „teilweise zutreffend“ oder „nicht zutreffend / nicht mehr relevant“, dann Rechtsgrundlage (österreichisches Recht) und übliche Absicherung im Kaufvertrag. Kurz.\n\nTHEMA ${t.no}: ${t.title}\n${t.description.slice(0, 1200)}\n\nBELEGE:\n${fs.slice(0, 6).map((f) => `- ${f.docNo} ${f.docName}${f.location ? ', ' + f.location : ''}: „${f.quote.slice(0, 300)}“`).join('\n')}${facts.length ? `\n\nFAKTEN AUS DEM AKT:\n${facts.map((e) => `- ${e.subject} ${e.attribute}: ${e.value}${e.validFrom || e.validTo ? ` (${e.validFrom || '…'}–${e.validTo || '…'})` : ''}`).join('\n')}` : ''}`
    }
    const kbOn = s.knowledgeBase !== false && typeof deps.askKnowledgeBase === 'function'
    let kbLeft = kbOn ? Math.min(DD_MAX_KB_CALLS, reds.length) : 0
    await Promise.all([...reds, ...ambers].map(async (t) => {
      const question = themeQuestion(t)
      const sig = hash([PIPELINE_VERSION.legal, question])
      if (t.legal?.sig === sig) { matter.job.progress.done++; return }
      const viaKb = t.gradeComputed === 'red' && kbLeft > 0
      if (viaKb) kbLeft--
      try {
        if (viaKb) {
          const a = DD_AREAS.find((x) => x.key === t.area)
          const legalArea = a?.profession === 'tax' ? 'tax' : t.area === 'compliance' ? 'public' : 'civil'
          const kr = await limit(() => reserved(Math.ceil(question.length / 2.5) + 2500, 8000, () => deps.askKnowledgeBase({ question, legalArea })))
          countExternal(question, kr.answer)
          t.legal = { via: 'aissociate', question, answer: String(kr.answer || '').trim().slice(0, 20_000), sources: (kr.sources || []).slice(0, 12).map((x) => ({ title: x.title, url: x.url })), sig, at: Date.now() }
        } else if (typeof deps.answerEasyLegal === 'function' && s.knowledgeBase !== false) {
          const wr = await limit(() => reserved(Math.ceil(question.length / 2.5) + 14_000, 5000, () => deps.answerEasyLegal(ctx, { question, ris: true, maxSearches: 3 })))
          t.legal = { via: 'web', question, answer: String(wr.answer || '').trim().slice(0, 12_000), sources: (wr.sources || []).slice(0, 8), sig, at: Date.now() }
        }
      } catch (e) { if (e?.message === 'halt') return; if (isBudget(e)) { halt ||= ['paused', limitMsg]; return } t.legal = { via: 'error', question, answer: '', error: String(e?.message || e).slice(0, 200), sig: '', at: Date.now() } }
      matter.job.progress.done++
      await saveSoon()
    }))
    if (halt) return stop(halt[0], halt[1])
    log(`Rechtsprüfung: ${reds.length} rote Themen (${[...reds].filter((t) => t.legal?.via === 'aissociate').length} an AI:ssociate), ${ambers.length} gelbe per Websuche (RIS)`)
    // Calibration: one call over all red and yellow themes.
    const calItems = themes.filter((t) => liveTheme(t) && !t.manual && ['red', 'amber'].includes(t.gradeComputed))
    if (calItems.length) {
      const input = calItems.map((t) => `${t.no} [${t.gradeComputed}] ${areaLabel(t.area)} · ${t.title}${t.unconfirmed ? ' (unbestätigt)' : ''} · Instrument ${t.instrument} · Regelgrund: ${t.gradeWhy}\n  Belege: ${t.findingIds.map((id) => findingById.get(id)).filter(Boolean).slice(0, 4).map((f) => `${f.docNo} ${f.location}`).join('; ')}\n  ${t.description.slice(0, 500)}${t.legal?.answer ? `\n  Rechtsprüfung (${t.legal.via === 'aissociate' ? 'AI:ssociate' : 'Websuche'}): ${t.legal.answer.replace(/\s+/g, ' ').slice(0, 900)}` : ''}`).join('\n\n')
      const calKey = hash([PIPELINE_VERSION.calibrate, input])
      let decisions = matter.calibrationMemo?.key === calKey ? matter.calibrationMemo.decisions : null
      if (!decisions) {
        try {
          const r = await ask({ model: deps.modelMain, effort: deps.effort || 'medium', maxOut: 12_000, instructions: `Du bist Partner einer österreichischen Transaktionskanzlei und kalibrierst die Themen eines Red-Flag-Berichts (${dealLine(s)}, Wesentlichkeit ${s.materialityEur.toLocaleString('de-DE')} EUR). Für jedes Thema eine Entscheidung mit Begründung in einem Satz:\n- verwerfen: rechtliche Prüfung verneint den Befund, er ist erledigt/nicht mehr relevant oder fällt unter den Ausschlusskatalog (${EXCLUSIONS.map((x) => x.label).join('; ')});\n- herabstufen: Risiko geringer als nach dem Regelgrad (Betrag unwesentlich, mit Standardgarantie abgedeckt, rechtlich nur teilweise zutreffend);\n- zusammenführen (target = Ziel-Thema): derselbe Sachverhalt wie ein anderes Thema;\n- hochstufen: nur ausnahmsweise, wenn eine Kernvoraussetzung des Geschäfts konkret gefährdet ist;\n- behalten.\nZiel ist ein Bericht mit wenigen, wirklich deal-relevanten roten Themen. Antworte als JSON nach Schema.`, input: [{ role: 'user', content: input }] }, 'dd_calibration', CALIBRATION_SCHEMA)
          decisions = r.decisions || []
          matter.calibrationMemo = { key: calKey, decisions }
        } catch (e) { if (isBudget(e) || e?.message === 'halt') return stop(halt?.[0] || 'paused', halt?.[1] || limitMsg); log('Kalibrierung fehlgeschlagen: ' + String(e?.message || e).slice(0, 160)); decisions = [] }
      }
      applyCalibration(themes, decisions)
      matter.themes = themes.filter((t) => !t.mergedInto)
      for (const t of themes.filter((x) => x.mergedInto)) { const into = matter.themes.find((x) => x.no === t.mergedInto); for (const f of matter.findings) if (f.themeId === t.id && into) f.themeId = into.id }
    }
    matter.job.progress.done = matter.job.progress.total
    const redLive = matter.themes.filter((t) => liveTheme(t) && effectiveGrade(t) === 'red')
    log(`Kalibrierung: ${redLive.length} rote, ${matter.themes.filter((t) => liveTheme(t) && effectiveGrade(t) === 'amber').length} gelbe Themen; ${matter.themes.filter((t) => t.calibration && t.calibration.action !== 'behalten').length} geändert`)
    if (redLive.length > DD_RED_WARN) log(`Warnung: ${redLive.length} rote Themen (mehr als ${DD_RED_WARN}) – bitte im Review prüfen, ob alle wirklich deal-relevant sind.`)
    await endStage('legal')

    // ---- 8 summaries from the themes ----
    const live = matter.themes.filter(liveTheme)
    const areas = s.areas.filter((k) => live.some((t) => t.area === k) || matter.documents.some((d) => d.area === k && d.status === 'analysed'))
    beginStage('summary', areas.length + 1)
    matter.areaSummaries = {}
    await Promise.all(areas.map(async (key) => {
      const a = DD_AREAS.find((x) => x.key === key)
      const ts = live.filter((t) => t.area === key).sort((x, y) => GRADE_RANK[effectiveGrade(x)] - GRADE_RANK[effectiveGrade(y)])
      const docs = matter.documents.filter((d) => d.area === key && d.status === 'analysed')
      const contra = reg.contradictions.slice(0, 12).map((c) => `- ${c.subject} ${c.attribute}: ${c.values.map((v) => `${v.value} (${v.docNo})`).join(' vs. ')}`).join('\n')
      try {
        const sy = await ask({
          model: deps.modelMain, effort: deps.effort, maxOut: 6000,
          instructions: `Du bist österreichischer Transaktionsanwalt und Steuerberater. Fasse den Prüfbereich „${a.label}“ einer Due Diligence (${dealLine(s)}) aus den gelieferten THEMEN zusammen – nichts erfinden. Erwartete Dokumente: ${a.documents}. Standard-Nachfragen: ${a.questions}. requests: höchstens 6 priorisierte, gebündelte Nachfragen (nur deal-relevant); missing_documents: höchstens 4 wirklich fehlende Standarddokumente (was laut Dokumentliste vorliegt, fehlt nicht); cross_document_issues aus den Widersprüchen; Empfehlungen als Garantien, Freistellungen, Conditions Precedent oder Kaufpreismechanismen. Antworte als JSON nach Schema.`,
          input: [{ role: 'user', content: `THEMEN (${ts.length}):\n${ts.map((t) => `- ${t.no} [${effectiveGrade(t)}] ${t.title} · ${t.instrument}: ${t.description.slice(0, 400)}${t.review?.note ? ` | Reviewer: ${t.review.note.slice(0, 200)}` : ''}`).join('\n') || '(keine)'}\n\nDOKUMENTE IM BEREICH (${docs.length}):\n${docs.map((d) => `- ${d.no} ${d.title || d.name} (${d.docType}, ${d.role})`).join('\n').slice(0, 12_000) || '(keine)'}\n\nNACHFRAGEN AUS DEN DOKUMENTEN:\n${docs.flatMap((d) => d.questions || []).slice(0, 30).map((q) => '- ' + q).join('\n') || '(keine)'}${contra ? `\n\nWIDERSPRÜCHE IM FAKTENREGISTER:\n${contra}` : ''}` }],
        }, 'dd_area', AREA_SYNTHESIS_SCHEMA)
        sy.requests = (sy.requests || []).slice(0, 6); sy.missing_documents = (sy.missing_documents || []).slice(0, 4)
        matter.areaSummaries[key] = { ...sy, label: a.label, documents: docs.length, findings: ts.length, themes: ts.length }
      } catch (e) { if (e?.message === 'halt' || isBudget(e)) return; matter.areaSummaries[key] = { summary: 'Zusammenfassung fehlgeschlagen.', key_risks: [], cross_document_issues: [], missing_documents: [], requests: [], deal_recommendations: [], label: a.label, documents: docs.length, findings: ts.length, themes: ts.length } }
      matter.job.progress.done++
      log(`Bereich zusammengefasst: ${a.label}`)
    }))
    if (halt) return stop(halt[0], halt[1])
    {
      const kf = keyFigures(reg)
      const redT = live.filter((t) => effectiveGrade(t) === 'red'), keyAmber = live.filter((t) => effectiveGrade(t) === 'amber' && ['CP', 'Kaufpreis'].includes(t.review?.instrument || t.instrument))
      const overall = overallAssessment(matter.themes)
      try {
        const ex = await ask({
          model: deps.modelMain, effort: deps.effort, maxOut: 5000,
          instructions: `Du bist österreichischer Transaktionsanwalt und Steuerberater und schreibst das Executive Summary eines Red-Flag-Berichts (${dealLine(s)}). Mandantentauglich, präzise, keine Floskeln, nur aus den gelieferten Themen und Kennzahlen. Die Gesamteinschätzung steht fest: „${overall}“ – begründe sie, ändere sie nicht. Antworte als JSON nach Schema.`,
          input: [{ role: 'user', content: `ROTE THEMEN:\n${redT.map((t) => `- ${t.no} ${areaLabel(t.area)}: ${t.title} · ${t.review?.instrument || t.instrument} – ${t.description.slice(0, 300)}`).join('\n') || '(keine)'}\n\nGELBE THEMEN MIT CP/KAUFPREIS:\n${keyAmber.map((t) => `- ${t.no} ${t.title} · ${t.review?.instrument || t.instrument}`).join('\n') || '(keine)'}\n\nKENNZAHLEN:\n${Object.entries(kf).map(([k, e]) => `- ${k}: ${e.amount != null ? e.amount.toLocaleString('de-DE') : e.value} (${e.validFrom || ''})`).join('\n') || '(keine im Akt)'}` }],
        }, 'dd_exec', EXEC_SUMMARY_SCHEMA)
        matter.executive = { ...ex, overall_assessment: overall, keyFigures: Object.fromEntries(Object.entries(kf).map(([k, e]) => [k, { value: e.amount ?? e.value, date: e.validFrom, docNo: e.evidence?.[0]?.docNo || '' }])) }
      } catch (e) { if (e?.message === 'halt' || isBudget(e)) return stop(halt?.[0] || 'paused', halt?.[1] || limitMsg); matter.executive = { executive_summary: 'Executive Summary fehlgeschlagen.', top_red_flags: [], next_steps: [], overall_assessment: overall } }
      matter.job.progress.done++
      log(`Executive Summary erstellt · Gesamteinschätzung (nach Regeln): ${overall}`)
    }
    await endStage('summary')

    // ---- 9 norms against the RIS, per theme ----
    beginStage('verify', 0)
    {
      const norms = [...new Set(live.flatMap((t) => t.norms).map((n) => String(n).trim()).filter(Boolean))].slice(0, 80)
      matter.job.progress = { done: 0, total: norms.length }
      let v = null
      try { v = norms.length ? await deps.verifyAnswer(norms.join('; ')) : null } catch (e) { log('RIS-Prüfung fehlgeschlagen: ' + e.message) }
      if (v) {
        const items = [...(v.norms || []), ...(v.decisions || [])]
        matter.verification = { summary: v.summary, items: items.map((x) => ({ label: x.label, status: x.status, note: x.note, url: x.url || '', title: x.title || '' })) }
        const statusOf = (n) => { const hit = items.find((x) => norm(n).includes(norm(x.label)) || norm(x.label).includes(norm(n))); return { norm: n, status: hit?.status || 'unchecked', url: hit?.url || '' } }
        for (const t of matter.themes) t.normStatus = t.norms.map(statusOf)
        for (const f of matter.findings) f.normStatus = (f.norms || []).map(statusOf)
      }
      matter.job.progress.done = norms.length
      log(`RIS-Prüfung: ${v ? `${v.summary.ok} von ${v.summary.checked} Normen bestätigt` : 'keine Normen'}`)
      await endStage('verify')
    }

    // ---- 10 report ----
    beginStage('report', 2)
    const names = await buildReports(matter, deps)
    log(`Bericht erstellt: ${names[0]}`)
    await endStage('report')
    matter.job.stage = 'done'
    matter.job.recompute = null
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
  matter.inventory = reconcile(matter)
  const full = matter.settings.reportType === 'full'
  const docxBuf = await buildDdDocx(matter)
  const docxName = await store.putReport(matter.id, `${full ? 'DD_Vollbericht' : 'Red_Flag_Report'}_${stem}_${stamp}.docx`, docxBuf)
  if (matter.job.progress) matter.job.progress.done = 1
  const xlsxBuf = await buildDdXlsx(matter)
  const xlsxName = await store.putReport(matter.id, `DD_Themen_${stem}_${stamp}.xlsx`, xlsxBuf)
  if (matter.job.progress) matter.job.progress.done = 2
  matter.reports = (matter.reports || []).filter((r) => r.name !== docxName && r.name !== xlsxName)
  matter.reports.unshift({ name: docxName, kind: 'docx', type: full ? 'full' : 'redflag', size: docxBuf.length, createdAt: Date.now() }, { name: xlsxName, kind: 'xlsx', size: xlsxBuf.length, createdAt: Date.now() })
  await store.saveMatter(matter)
  return [docxName, xlsxName]
}

/** Review table: user-defined columns extracted per document with quote + location (duplicates skipped). */
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
  const inScope = (d) => !d.container && !d.duplicateOf && (table.docIds?.length ? table.docIds.includes(d.id) : true)
  // Documents that were only uploaded get their text read first.
  const fresh = matter.documents.filter((d) => inScope(d) && d.status === 'new')
  if (fresh.length) {
    matter.job.progress = { done: 0, total: fresh.length }
    await readDocuments(matter, deps, fresh, (message) => send('table', { matterId: matter.id, tableId: table.id, done: 0, total: 0, docName: '', message }))
  }
  const docs = matter.documents.filter((d) => inScope(d) && TEXT_STATES.includes(d.status) && !table.rows.some((r) => r.docId === d.id))
  let done = 0, lastSave = 0
  const limit = pool(Math.max(1, deps.concurrency || 24))
  await Promise.all(docs.map((d) => limit(async () => {
    if (matter.job.pauseRequested) return
    const text = (await store.getText(matter.id, d.id)).slice(0, CHUNK_CHARS * 2)
    try {
      const resp = await deps.callModel(ctx, {
        model: deps.modelExtract, effort: 'low', maxOut: 6000, temperature: 0,
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

/** Compact textual context of a matter for chat questions ("Fragen zum Akt"): facts register, themes, findings, documents. */
export function matterContext(matter, maxChars = 60_000) {
  const lines = []
  lines.push(`AKT: ${matter.name}${matter.client ? ` (Mandant: ${matter.client})` : ''}${matter.settings?.target ? ` · Zielgesellschaft: ${matter.settings.target}` : ''} · ${matter.documents.length} Dokumente, ${(matter.themes || []).length} Themen`)
  if (matter.executive) lines.push(`\nEXECUTIVE SUMMARY (${matter.executive.overall_assessment}):\n${matter.executive.executive_summary}`)
  if (matter.facts) lines.push(`\nFAKTENREGISTER:\n${aktContext(matter, matter.facts, 6000)}`)
  const live = (matter.themes || []).filter(liveTheme).sort((a, b) => GRADE_RANK[effectiveGrade(a)] - GRADE_RANK[effectiveGrade(b)])
  if (live.length) lines.push(`\nTHEMEN:\n${live.map((t) => `- ${t.no} [${effectiveGrade(t)}] ${areaLabel(t.area)} · ${t.title} (${t.instrument}; Belege: ${t.docIds.map((id) => matter.documents.find((d) => d.id === id)?.no).filter(Boolean).join(', ')}): ${t.description.slice(0, 300)}${t.calibration?.reason ? ` | Kalibrierung: ${t.calibration.reason}` : ''}${t.legal?.answer ? ` | Rechtsprüfung: ${t.legal.answer.replace(/\s+/g, ' ').slice(0, 300)}` : ''}${t.review?.note ? ' | Reviewer: ' + t.review.note.slice(0, 120) : ''}`).join('\n')}`)
  for (const s of Object.values(matter.areaSummaries || {})) lines.push(`\n## ${s.label}\n${s.summary}\nFehlend: ${(s.missing_documents || []).join('; ')}\nNachfragen: ${(s.requests || []).join('; ')}`)
  const fs = (matter.findings || []).filter((f) => !isRejected(f)).sort((x, y) => SEV_RANK[effectiveSeverity(x) || 'info'] - SEV_RANK[effectiveSeverity(y) || 'info'])
  lines.push(`\nBEFUNDE:\n${fs.map((f) => `- ${f.no || ''} [${effectiveSeverity(f)}] ${f.title} (${f.docNo} ${f.docName}, ${f.location}): ${f.description.slice(0, 240)} | Zitat: "${f.quote.slice(0, 160)}"`).join('\n')}`)
  lines.push(`\nDOKUMENTE:\n${matter.documents.filter((d) => !d.container).map((d) => `- ${d.no || ''} ${d.name} [${d.status}${d.duplicateOf ? ', Duplikat' : ''}] ${d.docType || ''} · ${d.role || ''} ${d.area ? '(' + areaLabel(d.area) + ')' : ''}: ${(d.summary || '').slice(0, 200)}`).join('\n')}`)
  return lines.join('\n').slice(0, maxChars)
}
