// Due diligence: a simple pipeline in which agents decide.
//
//   inventory  hashes across the Akt (duplicates); archives and e-mails are unpacked on upload
//   text       text of every document (OCR for scans)
//   read       every document in full: facts and its role – no assessment (extraction model)
//   aktmodel   the overall context: facts merged, persons and companies resolved (no model)
//   issues     a review agent per document: the document in full, the context of the Akt
//              and tools to read other documents or search the Akt; it decides what is a
//              finding, how serious it is, and how hard the legal question is – easy ones
//              it answers from its own knowledge
//   review     a consolidation agent merges the findings of all documents into themes
//              (one per matter), with status, grade and instrument
//   legal      a legal agent per theme with a hard question: web search (RIS first); very
//              hard ones it puts to AI:ssociate
//   summary    areas and executive summary (with the overall assessment)
//   verify     cited norms against the RIS
//   report     Word and Excel
//
// Results are cached by content: a new document is read and reviewed alone, the others only
// when their context changed. The hard limit per due diligence (DD_HARD_IN / DD_HARD_OUT)
// holds over all runs: every model call reserves its estimated tokens before it starts.
import crypto from 'node:crypto'
import { DD_AREAS, DD_AREA_KEYS, SEVERITIES, DEAL_IMPACTS, TRANSACTION_NOTES, PIPELINE_VERSION, READ_SCHEMA, DOC_REVIEW_SCHEMA, CONSOLIDATE_SCHEMA, LEGAL_SCHEMA, AREA_SYNTHESIS_SCHEMA, EXEC_SUMMARY_SCHEMA, EXCLUSIONS, FINDING_KINDS, LEGAL_SUBJECTS, DOC_ROLES, SKIP_REASONS, CLAUSE_KINDS, ISSUE_STATUS, DIFFICULTY, LEGAL_FORMS, INDUSTRY_MODULES, OVERALL, corePrerequisitesFor, legalFormOf, requirementsFor } from './ddconfig.js'
import { buildDdDocx, buildDdXlsx, buildTableXlsx } from './report.js'
import { JsonStore } from './store.js'
import { roleByRule, textHash, handwritingPages, reconcile } from './inventory.js'
import { buildAktModel, aktText, documentList, keyFigures } from './aktmodel.js'
import { assembleThemes, linkDocuments, effectiveGrade, liveTheme, overallAssessment, GRADE_RANK } from './themes.js'

const CHUNK_CHARS = 150_000
const CHUNK_OVERLAP = 2_000
// Documents are read in full; only beyond 6 million characters (40 sections) the rest is listed as not read.
const MAX_CHUNKS_PER_DOC = 40
const SEV_RANK = GRADE_RANK
// Hard limit per due diligence (all runs together), not adjustable in the UI.
export const DD_HARD_IN = Number(process.env.DD_MAX_INPUT_TOKENS || 100_000_000)
export const DD_HARD_OUT = Number(process.env.DD_MAX_OUTPUT_TOKENS || 10_000_000)
const SECONDARY_AS_HYPOTHESES = /^(1|true|on|yes)$/i.test(process.env.DD_SECONDARY_AS_HYPOTHESES || '')
// Very hard legal questions go to AI:ssociate, at most this many per run (the agent is told how many are left).
const DD_MAX_KB_CALLS = Math.min(60, Number(process.env.DD_MAX_KB_CALLS || 30))
// Tool rounds of the document agent (reading another document, searching the Akt) – reasonable effort.
const DOC_AGENT_STEPS = Number(process.env.DD_DOC_AGENT_STEPS || 3)
const CONTEXT_CHARS = Number(process.env.DD_CONTEXT_CHARS || 30_000)
export const DD_STAGES = ['inventory', 'text', 'read', 'aktmodel', 'issues', 'review', 'legal', 'summary', 'verify', 'report']
const TEXT_STATES = ['read', 'analysed']
const CORE_TYPES = ['gesellschafter', 'organ', 'prokura', 'todesfall', 'funktionstraeger', 'genehmigung', 'standort']

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
    legalForm: LEGAL_FORMS.includes(settings.legalForm) ? settings.legalForm : '',
    modules: Array.isArray(settings.modules) ? settings.modules.filter((k) => INDUSTRY_MODULES[k]) : [],
    reportType: settings.reportType === 'full' ? 'full' : 'redflag',
    secondaryAsHypotheses: settings.secondaryAsHypotheses == null ? SECONDARY_AS_HYPOTHESES : Boolean(settings.secondaryAsHypotheses),
    reference: String(settings.reference || '').slice(0, 60),
    budgetTokens: DD_HARD_IN,
    budgetOutTokens: DD_HARD_OUT,
    knowledgeBase: settings.knowledgeBase !== false,
    language: 'de',
  }
  return {
    id: JsonStore.newId('m'), ownerKey, name: String(name || 'Neuer Akt').slice(0, 120), kind: kind === 'dd' ? 'dd' : 'matter', client: String(client || '').slice(0, 120), version: 4,
    createdAt: Date.now(), updatedAt: Date.now(), settings: s, seq: { doc: 0, finding: 0, theme: 0 },
    documents: [], findings: [], themes: [], orphanThemes: [], facts: null, factCorrections: [], themeBase: [], themeOps: { assign: {}, merges: {}, manual: [] },
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
  const open = matter.documents.filter((d) => !d.container && ['new', 'read'].includes(d.status))
  const all = matter.documents.filter((d) => !d.container && d.status !== 'skipped' && d.status !== 'error')
  let chars = 0
  for (const d of open) chars += Math.min(charsOf(d), CHUNK_CHARS * MAX_CHUNKS_PER_DOC)
  const chunks = open.reduce((n, d) => n + chunksOf(d), 0)
  const issues = Math.max(5, Math.round(all.length * 0.4)), hard = Math.round(issues * 0.4), veryHard = Math.min(DD_MAX_KB_CALLS, Math.round(issues * 0.1))
  const ctxTok = Math.ceil((CONTEXT_CHARS + all.length * 90) / 3.2)
  const areasTouched = Math.min(matter.settings.areas.length, Math.max(1, all.length))
  // reading once, the review agent once more (with context and a tool round on average), consolidation, legal checks, summaries
  const inTok = Math.round(chars / 3.2 + chunks * 2500 + (chars / 3.2 + chunks * (ctxTok + 3000)) * 1.5 + all.length * 600 + 10_000 + hard * 18_000 + veryHard * 8000 + 25_000 * areasTouched + 15_000)
  const outTok = Math.round(chunks * 3000 + chunks * 5000 + issues * 300 + hard * 2500 + 4000 * areasTouched + 5000)
  const kbCalls = matter.settings.knowledgeBase !== false ? veryHard : 0
  const minutes = Math.max(3, Math.round(Math.ceil(chunks / concurrency) * 2.2 + 2 + Math.ceil(hard / concurrency) * 1.5 + 3))
  const inC = Math.min(inTok, DD_HARD_IN), outC = Math.min(outTok, DD_HARD_OUT)
  return { documents: open.length, chunks, issues, inTok: inC, outTok: outC, usd: +((inC / 1e6) * priceIn + (outC / 1e6) * priceOut).toFixed(2), kbCalls, minutes, limitIn: DD_HARD_IN, limitOut: DD_HARD_OUT, cached: true }
}

function newUsage() { return { byModel: {}, inTok: 0, outTok: 0, cachedTok: 0, webSearchCalls: 0, aissociateCalls: 0, calls: 0 } }
/** Model-call context of a matter: usage accumulates over every run; the limits are the hard ones. */
export function matterCtx(matter) {
  const u = (matter.job.usage ||= newUsage())
  for (const [k, v] of Object.entries(newUsage())) if (u[k] == null) u[k] = v
  return { usage: u, limits: { inMax: DD_HARD_IN, outMax: DD_HARD_OUT } }
}

/** A finding of the review agent in one document (or a finding entered by hand). */
export function newFinding(matter, d, f) {
  const kind = CLAUSE_KINDS[f.kind] ? f.kind : 'sonstiges'
  const x = {
    id: JsonStore.newId('f'), no: nextNo(matter, 'finding'), docId: d?.id || '', docNo: d?.no || '', docName: d?.name || '', kind,
    area: DD_AREA_KEYS.includes(f.area) ? f.area : CLAUSE_KINDS[kind].area !== 'none' ? CLAUSE_KINDS[kind].area : (DD_AREA_KEYS.includes(d?.area) ? d.area : 'none'),
    issue: slug(f.issue || f.title), title: String(f.title || '').slice(0, 200), gegenstand: String(f.gegenstand ?? f.subject ?? '').slice(0, 120), gegenpartei: String(f.gegenpartei ?? f.counterparty ?? '').slice(0, 120),
    art: FINDING_KINDS[f.art] ? f.art : 'mangel', betrag: Number.isFinite(f.betrag ?? f.amount) ? (f.betrag ?? f.amount) : null,
    description: String(f.description || ''), quote: String(f.quote || '').slice(0, 600), location: String(f.location || '').slice(0, 120), recommendation: String(f.recommendation || ''),
    dealImpact: DEAL_IMPACTS.includes(f.instrument || f.dealImpact || f.deal_impact) ? (f.instrument || f.dealImpact || f.deal_impact) : 'keine',
    grade: ['red', 'amber', 'green'].includes(f.grade) ? f.grade : null, legalQuestion: String(f.legal_question || ''), difficulty: DIFFICULTY[f.difficulty] ? f.difficulty : '', legalAnswer: String(f.legal_answer || ''),
    norms: Array.isArray(f.norms) ? f.norms.map(String).slice(0, 8) : [], normStatus: [], relatedDocIds: [],
    quelle: f.quelle || (f.source === 'manual' ? 'manual' : 'einzelanalyse'), source: f.source === 'manual' ? 'manual' : 'model',
    evidence: 'unverified', severity: SEVERITIES.includes(f.severity) ? f.severity : null, excluded: null, discarded: null, themeId: null,
    review: { status: 'open', severity: null, note: '', ts: null },
  }
  x.key = `${(d?.sha256 || d?.id || '').slice(0, 16)}|${x.issue}|${slug(x.title).slice(0, 60)}`
  return x
}
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'befund'
/** Severity after review (reviewer override wins). */
export const effectiveSeverity = (f) => (f.review?.severity && SEVERITIES.includes(f.review.severity) ? f.review.severity : f.severity)
export const isRejected = (f) => f.review?.status === 'rejected' || Boolean(f.excluded) || Boolean(f.discarded)

const areaLabel = (k) => DD_AREAS.find((a) => a.key === k)?.label || (k === 'none' ? 'Allgemein' : k)
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zäöüß0-9]+/g, ' ').trim()
const dealLine = (s) => `${s.transaction === 'asset' ? 'Asset Deal' : 'Share Deal'}, Perspektive ${s.perspective === 'seller' ? 'Verkäufer' : 'Käufer'}${s.target ? `, Zielgesellschaft ${s.target}` : ''}${s.targetFn ? ` (FN ${s.targetFn})` : ''}${legalFormOf(s) ? `, Rechtsform ${legalFormOf(s)}` : ''}${s.stichtag ? `, Stichtag ${s.stichtag}` : ''}${s.closing ? `, Closing ${s.closing}` : ''}${s.sellers === 'partial' ? ', nicht alle Gesellschafter verkaufen' : ''}`
const moduleText = (s) => (s.modules || []).map((k) => INDUSTRY_MODULES[k]).filter(Boolean).map((m) => `- ${m.label}: ${m.redFlags}`).join('\n')

const FACT_GUIDE = `- gesellschafter: subject = Name; ident = Geburtsdatum bzw. FN; attribute "Geschäftsanteil"; value = Anteil bzw. Stammeinlage; valid_from/valid_to
- organ / prokura: subject = Name; ident = Geburtsdatum; attribute = Funktion; value = Vertretungsbefugnis; Flags ausgeschieden/verstorben
- todesfall: subject = Name der verstorbenen Person; ident = Geburtsdatum; valid_to = Todestag; value = Erben/Verlassenschaft
- funktionstraeger: Person, die ein Bescheid für eine Berechtigung bestellt – subject = Name; ident = Geburtsdatum; attribute = Funktion wie im Bescheid; counterparty = Behörde; value = die Berechtigung; valid_from = Bestellung
- genehmigung: subject = Gegenstand der Berechtigung/Genehmigung; counterparty = Inhaber; site = Standort; valid_to = Befristung; attribute = Behörde, Geschäftszahl, Datum
- standort: subject = Standort/Liegenschaft; attribute = Nutzungsrecht; counterparty = Eigentümer/Vermieter; valid_to = Ende
- vertrag: subject = Vertragsgegenstand; counterparty = Vertragspartner; amount = Vertragswert; valid_to = Laufzeitende; Flag kontrollwechsel bei Change-of-Control-Klausel
- zahlung_gesellschafter: subject = Zahlungsgrund; counterparty = empfangender Gesellschafter; amount; valid_from = Datum
- kennzahl (Jahresabschluss): subject = Gesellschaft; attribute = Umsatz, Jahresergebnis, Eigenkapital, Eigenkapitalquote, Bilanzsumme, Liquide Mittel, Bankverbindlichkeiten, Verbindlichkeiten gegenüber Gesellschaftern; amount; valid_from = Bilanzstichtag
- beschluss: subject = Gegenstand; attribute = Art der Beschlussfassung; value = abstimmende Gesellschafter, mit Komma getrennt; valid_from = Datum
- recht_dritter: subject = Recht und woran; counterparty = Berechtigter; Flag erloschen`

function readInstructions(matter) {
  return `Du erfasst für eine Due Diligence (${dealLine(matter.settings)}) die Tatsachen aus EINEM Dokument des Datenraums – ohne Bewertung. Antworte ausschließlich als JSON nach Schema.

TATSACHEN
${FACT_GUIDE}

REGELN
- Jede Tatsache mit wörtlichem Zitat (exakt aus dem Text, max. 200 Zeichen) und Fundstelle; ohne Zitat nicht erfassen.
- Personen mit Geburtsdatum, Gesellschaften mit FN, wenn genannt. Daten als JJJJ-MM-TT, Beträge in EUR. Nichts schätzen.
- role: Originalunterlage, Sekundärquelle (Bericht, Memo, Gutachten Dritter über andere Unterlagen), Entwurf, Plan/Zeichnung oder Datenblatt.`
}

/** Instructions of the document agent: the same for every document of a run (so the context is cached). */
function reviewInstructions(matter, model) {
  const s = matter.settings
  const areas = DD_AREAS.filter((a) => s.areas.includes(a.key))
  const reqs = requirementsFor(s).map((r) => `- ${r.label} (${r.basis})`).join('\n')
  return `Du bist erfahrener österreichischer Transaktionsanwalt und Steuerberater und prüfst in einer Due Diligence (${dealLine(s)}) EIN Dokument – mit dem Wissen über den ganzen Akt. Du entscheidest selbst, was ein wesentlicher Befund ist, wie schwer er wiegt und wie schwierig die Rechtsfrage ist. Antworte am Ende ausschließlich als JSON nach Schema.

VORGEHEN
- Lies das Dokument vollständig. Gleiche es mit dem Aktkontext ab: Ist ein Risiko durch andere Dokumente ausgeräumt, bestätigt oder verschärft (z. B. Nachbestellung, Verlängerung, Zustimmung, Widerspruch)?
- Werkzeuge mit vernünftigem Aufwand (höchstens ${DOC_AGENT_STEPS - 1} Runden): list_documents für die Dokumentliste des Akts; search_akt, um im ganzen Akt nach einer Tatsache zu suchen; read_document, wenn du ein anderes Dokument im Wortlaut brauchst.
- Befunde nur, wenn sie für die Transaktion wesentlich sind, mit wörtlichem Zitat aus DIESEM Dokument. Was der Akt widerlegt, ist kein Befund. Gleicher Sachverhalt in mehreren Dokumenten: gleicher issue-Schlüssel.
- Rechtsfragen: leicht → beantworte sie selbst in legal_answer (gesichertes Wissen, Rechtsgrundlage); schwer (Normen/Judikatur nachsehen) oder sehr_schwer (ungeklärt, sehr speziell) → nur Frage und Schwierigkeit angeben, die Recherche folgt.
- Personen nur gleichsetzen, wenn Geburtsdatum oder Zusammenhang es tragen. Fristen nur als Prüfpunkt mit Rechtsgrundlage, keine Fristberechnung.
- Sekundärquellen (Prüfberichte, Memos, Gutachten Dritter) sind keine Belege; ihre Aussagen sind nur Hinweise.
- Österreichisches Recht, konkrete Normen, nichts erfinden. Deutsch, Kanzleistil.

TRANSAKTION: ${TRANSACTION_NOTES[s.transaction] || TRANSACTION_NOTES.share}

PRÜFBEREICHE UND TYPISCHE RED FLAGS
${areas.map((a) => `- ${a.label}: ${a.redFlags}`).join('\n')}${moduleText(s) ? `\n\nBRANCHE\n${moduleText(s)}` : ''}

KERNVORAUSSETZUNGEN DES GESCHÄFTS (Befunde daran sind meist rot)
${corePrerequisitesFor(s).map((x) => '- ' + x).join('\n')}
Berechtigungen, die an einer bestellten Person hängen:
${reqs}

KEIN RISIKO (Ausschlusskatalog)
${EXCLUSIONS.map((x) => '- ' + x.label).join('\n')}

Wesentlichkeitsschwelle: ${s.materialityEur.toLocaleString('de-DE')} EUR.

AKTKONTEXT (Kernfakten des ganzen Akts: Gesellschafter, Organe, Funktionsträger, Genehmigungen, Standorte, Todesfälle)
${aktText(matter, model, { types: CORE_TYPES, maxChars: CONTEXT_CHARS })}`
}

const TOOL_READ = { type: 'function', name: 'read_document', strict: false, description: 'Liest ein anderes Dokument des Akts im Wortlaut (Teil für Teil, je ca. 30.000 Zeichen).', parameters: { type: 'object', properties: { no: { type: 'string', description: 'Dokumentnummer, z. B. "D-012"' }, part: { type: 'integer', description: 'Teil ab 1' } }, required: ['no'] } }
const TOOL_LIST = { type: 'function', name: 'list_documents', strict: false, description: 'Liste aller Dokumente des Akts (Nummer, Typ, Rolle, Datum, Titel).', parameters: { type: 'object', properties: {} } }
const TOOL_SEARCH = { type: 'function', name: 'search_akt', strict: false, description: 'Sucht im Volltext aller Dokumente des Akts; liefert die besten Stellen mit Dokumentnummer und Seite.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Suchbegriffe' } }, required: ['query'] } }
const TOOL_KB = { type: 'function', name: 'ask_aissociate', strict: false, description: 'Juristische Wissensdatenbank AI:ssociate (österreichisches Recht) – nur für sehr schwere Rechtsfragen. Die Frage muss den Sachverhalt vollständig enthalten.', parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } }

function mergeReadings(parts) {
  const out = { ...parts[0], parties: [], key_terms: [], facts: [] }
  const seen = { parties: new Set(), terms: new Set(), facts: new Set() }
  for (const p of parts) {
    for (const x of p.parties || []) { const k = norm(x); if (k && !seen.parties.has(k)) { seen.parties.add(k); out.parties.push(x) } }
    for (const t of p.key_terms || []) { const k = norm(t.term); if (k && !seen.terms.has(k)) { seen.terms.add(k); out.key_terms.push(t) } }
    for (const f of p.facts || []) { const k = norm(`${f.type} ${f.subject} ${f.ident} ${f.attribute} ${f.value} ${f.counterparty}`); if (k && !seen.facts.has(k)) { seen.facts.add(k); out.facts.push(f) } }
  }
  return out
}

export function newDocument({ name, size, source = 'upload', ms = null, no = '' }) {
  return { id: JsonStore.newId('d'), no, name: String(name).slice(0, 200), size: Number(size) || 0, source, ms, file: null, status: 'new', note: '', textChars: 0, pages: null, chunks: 0, truncated: false, docType: '', area: '', title: '', summary: '', date: '', parties: [], keyTerms: [], flags: { red: 0, amber: 0, green: 0, info: 0 }, sha256: '', textHash: '', duplicateOf: null, parent: null, container: false, role: '', roleBy: '', subject: '', skipReason: '', facts: null, issueNos: [], handwritingPages: [], addedAt: Date.now(), analysedAt: null }
}
/** Marks a document as skipped (it stays in the inventory with the reason). */
export function skipDoc(d, reason, detail = '') { d.status = 'skipped'; d.skipReason = reason; d.note = [SKIP_REASONS[reason] || reason, detail].filter(Boolean).join(': ') }

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

/** Matters of earlier pipelines: texts stay, the reading and everything after it are redone. */
function migrate(matter, log) {
  if ((matter.version || 1) >= 4) return
  for (const d of matter.documents) {
    if (['extracted', 'analysed'].includes(d.status)) d.status = 'read'
    else if (d.status === 'error') { if (/kein text|gescannt|ocr|nicht lesbar/i.test(d.note || '')) { d.status = 'new'; d.note = '' } else skipDoc(d, 'failed', d.note) }
    d.facts = null; d.issueNos = []
  }
  matter.findings = (matter.findings || []).filter((f) => f.source === 'manual')
  Object.assign(matter, { themeBase: [], facts: null, themeOps: { assign: {}, merges: {}, manual: (matter.themeOps?.manual || []) }, areaSummaries: {}, executive: null, verification: null, version: 4 })
  matter.job.checkpoints = {}; matter.job.stageUsage = {}
  log('Akt auf die neue DD umgestellt: Texte bleiben, Lesen und Prüfung werden neu erstellt; Review-Entscheidungen bleiben, wo das Thema gleich heißt.')
}

/** Themes from the consolidated base and the reviewer's operations (no model calls). */
export function rebuildIssuesLocal(matter) {
  const { themes, orphans } = assembleThemes(matter)
  matter.themes = themes; matter.orphanThemes = orphans
  linkDocuments(matter)
  if (matter.executive && !matter.executive.byAgent) matter.executive.overall_assessment = overallAssessment(matter.themes)
}

/**
 * Run (or resume) the due diligence of a matter.
 * deps: { store, callModel, extractText, modelMain, modelExtract, effort, concurrency, verifyAnswer, computeCost,
 *   send, askKnowledgeBase, webSearchTool, cache: { get, set }, searchIndex(matter) }
 * opts: { fromStage: 3 } recomputes from the Akt model (facts corrections); { reanalyse: true } ignores the cache.
 */
export async function runDd(matter, deps, opts = {}) {
  const { store, send } = deps
  const ctx = matterCtx(matter)
  const log = (message) => { matter.job.log.push({ t: Date.now(), message }); if (matter.job.log.length > 600) matter.job.log.splice(0, matter.job.log.length - 600); send('dd', { matterId: matter.id, stage: matter.job.stage, progress: matter.job.progress, message }) }
  const save = () => store.saveMatter(matter)
  const s = matter.settings
  const stop = async (status, reason) => { matter.job.status = status; matter.job.error = reason || null; matter.job.pauseRequested = false; matter.job.finishedAt = Date.now(); await save(); send('dd', { matterId: matter.id, stage: matter.job.stage, progress: matter.job.progress, status, message: reason || status }); return matter }
  const cache = deps.cache || { get: async () => null, set: async () => {} }
  const noCache = Boolean(opts.reanalyse)
  matter.job.status = 'running'; matter.job.error = null; matter.job.pauseRequested = false; matter.job.startedAt = matter.job.startedAt || Date.now(); matter.job.finishedAt = null
  matter.job.checkpoints ||= {}; matter.job.stageUsage ||= {}
  migrate(matter, log)
  await save()

  // ---- the hard limit: one pool for every model call, each call reserves its tokens first ----
  let halt = null
  const limitMsg = `Harte Grenze der Due Diligence erreicht (${(DD_HARD_IN / 1e6).toFixed(0)} Mio. Eingabe- / ${(DD_HARD_OUT / 1e6).toFixed(0)} Mio. Ausgabe-Tokens).`
  const limit = pool(Math.max(1, deps.concurrency || 24))
  let resIn = 0, resOut = 0
  const reserved = async (i, o, fn) => {
    if (halt) throw new Error('halt')
    if (matter.job.pauseRequested) { halt = ['paused', 'Pausiert']; throw new Error('halt') }
    if (ctx.usage.inTok + resIn + i > DD_HARD_IN || ctx.usage.outTok + resOut + o > DD_HARD_OUT) { halt = ['paused', limitMsg]; throw new Error('halt') }
    resIn += i; resOut += o
    try { return await fn() } finally { resIn -= i; resOut -= o }
  }
  const isHalt = (e) => e?.message === 'halt' || e?.name === 'BudgetExceeded' || /Token-Budget/.test(String(e?.message))
  const onError = (e) => { if (isHalt(e) && !halt) halt = ['paused', limitMsg]; return isHalt(e) }
  const kbOn = s.knowledgeBase !== false && typeof deps.askKnowledgeBase === 'function'
  let kbLeft = kbOn ? DD_MAX_KB_CALLS : 0
  const countKb = (question, answer) => { const i = Math.ceil(String(question || '').length / 3.2) + 2500, o = Math.ceil(String(answer || '').length / 3.2); ctx.usage.inTok += i; ctx.usage.outTok += o; const m = (ctx.usage.byModel.aissociate ||= { inTok: 0, outTok: 0, cachedTok: 0, calls: 0 }); m.inTok += i; m.outTok += o; m.calls++; ctx.usage.aissociateCalls++ }

  /**
   * One agent: a model call with tools in a loop (each round within the pool and the limit);
   * the last round has no tools, so the agent must answer. Result cached by content.
   */
  const agent = async ({ name, schema, model, effort = 'medium', instructions, input, tools = [], handlers = {}, web = 0, steps = 1, maxOut = 12_000, cacheKey = null }) => {
    const key = cacheKey ? `${name}|${hash([cacheKey, model, instructions, input])}` : null
    if (key && !noCache) { const hit = await cache.get(key); if (hit) return hit }
    let prevId = null, next = input, chain = String(instructions).length + JSON.stringify(input).length
    const used = { web: false, kb: false, sources: [] }
    for (let step = 1; ; step++) {
      const last = step >= steps
      const fnTools = last ? [] : tools
      const allTools = [...fnTools, ...(!last && web ? [deps.webSearchTool] : [])].filter(Boolean)
      const resp = await limit(() => reserved(Math.ceil(chain / 2.5) + 1500, maxOut, () => deps.callModel(ctx, { model, effort, instructions, input: next, prevId, maxOut, temperature: 0, tools: allTools.length ? allTools : undefined, maxToolCalls: !last && web ? web : undefined, text: { format: { type: 'json_schema', name, schema, strict: true } } })))
      for (const o of resp.output || []) {
        if (o.type === 'web_search_call') used.web = true
        if (o.type === 'message') for (const part of o.content || []) for (const a of part.annotations || []) if (a.type === 'url_citation' && a.url && !used.sources.some((x) => x.url === a.url)) used.sources.push({ title: a.title || a.url, url: a.url })
      }
      const calls = (resp.output || []).filter((o) => o.type === 'function_call')
      if (!calls.length || last) {
        let parsed = null
        try { parsed = JSON.parse(resp.output_text || '') } catch {}
        if (!parsed) throw new Error('Modell lieferte kein gültiges JSON' + (resp.status === 'incomplete' ? ' (Ausgabe abgeschnitten)' : ''))
        const out = { ...parsed, _used: used }
        if (key) await cache.set(key, out)
        return out
      }
      next = await Promise.all(calls.map(async (c) => {
        let args = {}; try { args = JSON.parse(c.arguments || '{}') } catch {}
        let output
        try { output = handlers[c.name] ? await handlers[c.name](args, used) : 'Unbekanntes Werkzeug.' } catch (e) { if (isHalt(e)) throw e; output = 'Fehler: ' + String(e?.message || e).slice(0, 200) }
        chain += String(output).length
        return { type: 'function_call_output', call_id: c.call_id, output: String(output).slice(0, 40_000) }
      }))
      prevId = resp.id
    }
  }
  let stageStart = null
  const beginStage = (name, total = 0) => { matter.job.stage = name; matter.job.progress = { done: 0, total }; stageStart = { in: ctx.usage.inTok, out: ctx.usage.outTok, calls: ctx.usage.calls } }
  const endStage = async (name) => {
    const u = (matter.job.stageUsage[name] ||= { inTok: 0, outTok: 0, calls: 0, usd: 0 })
    u.inTok += ctx.usage.inTok - stageStart.in; u.outTok += ctx.usage.outTok - stageStart.out; u.calls += ctx.usage.calls - stageStart.calls
    if (deps.computeCost) u.usd = deps.computeCost({ ...ctx.usage, inTok: u.inTok, outTok: u.outTok, byModel: { [deps.modelMain]: { inTok: u.inTok, outTok: u.outTok, cachedTok: 0, calls: u.calls } } }, 0)?.totalUsd ?? 0
    matter.job.checkpoints[name] = Date.now()
    await save()
  }
  let lastSave = 0
  const saveSoon = async () => { if (Date.now() - lastSave > 2000) { lastSave = Date.now(); await save() } }
  const sig = hash([s.transaction, s.perspective, s.materialityEur, s.target, s.targetFn, s.stichtag, s.closing, s.areas, s.sellers, s.legalForm, s.modules])
  const texts = new Map()
  const textOf = async (d) => { if (!texts.has(d.id)) texts.set(d.id, await store.getText(matter.id, d.id)); return texts.get(d.id) }
  const reviewable = (d) => d.status === 'analysed' && !d.duplicateOf && !d.container && (d.role !== 'Sekundärquelle' || s.secondaryAsHypotheses)

  let from = Number(opts.fromStage) || 0
  if (from >= 3 && matter.documents.some((d) => !d.container && ['new', 'read'].includes(d.status))) from = 0
  try {
    if (from < 3) {
      // ---- inventory: duplicates by hash, roles that the file name tells ----
      beginStage('inventory', matter.documents.length)
      for (const d of matter.documents) if (d.status === 'skipped' && ['unreadable', 'failed', 'budget'].includes(d.skipReason) && d.file) { d.status = 'new'; d.skipReason = ''; d.note = '' }
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
      log(`Inventar: ${matter.documents.filter((d) => !d.container).length} Dokumente, ${matter.documents.filter((d) => d.duplicateOf).length} Duplikate`)
      await endStage('inventory')

      // ---- text ----
      const toText = matter.documents.filter((d) => !d.container && d.status === 'new')
      beginStage('text', toText.length)
      if ((await readDocuments(matter, deps, toText, log)) === 'paused') return stop('paused', 'Pausiert')
      const byText = new Map()
      for (const d of matter.documents) {
        if (d.container || !d.textHash || d.duplicateOf) continue
        const first = byText.get(d.textHash)
        if (first && first.id !== d.id) { d.duplicateOf = first.id; skipDoc(d, 'duplicate', `inhaltsgleich mit ${first.no}`) } else byText.set(d.textHash, d)
      }
      await endStage('text')

      // ---- read: every document in full – facts and role ----
      const toRead = matter.documents.filter((d) => d.status === 'read')
      beginStage('read', toRead.length)
      const rInstr = readInstructions(matter)
      await Promise.all(toRead.map(async (d) => {
        try {
          const text = await textOf(d)
          const { chunks, truncated } = chunkText(text)
          const parts = await Promise.all(chunks.map((chunk, i) => agent({ name: 'dd_read', schema: READ_SCHEMA, model: deps.modelExtract, effort: 'low', maxOut: 10_000, instructions: rInstr, input: [{ role: 'user', content: `DOKUMENT: ${d.no} ${d.folder ? d.folder + '/' : ''}${d.name}${chunks.length > 1 ? ` (Teil ${i + 1}/${chunks.length})` : ''}\n\n=== TEXT ===\n${chunk}` }], cacheKey: `${PIPELINE_VERSION.read}|${d.sha256 || d.textHash}|${i}` })))
          const r = mergeReadings(parts)
          const facts = []
          for (const f of r.facts || []) { const st = locateQuote(text, f.quote).status; if (st !== 'unverified') facts.push({ ...f, evidence: st }) }
          Object.assign(d, { docType: r.doc_type, area: r.area, title: r.title, date: r.date || '', summary: r.summary, parties: r.parties, keyTerms: r.key_terms, facts, chunks: chunks.length, truncated, coverage: { sections: chunks.length, truncated, chars: text.length } })
          if (d.roleBy !== 'Prüfer' && d.roleBy !== 'Dateiname') { d.role = DOC_ROLES.includes(r.role) ? r.role : 'Originalunterlage'; d.roleBy = 'Agent' }
          if (d.subjectBy !== 'Prüfer') d.subject = r.subject
          d.handwritingPages = handwritingPages(text)
          if (d.role === 'Sekundärquelle' && !s.secondaryAsHypotheses) skipDoc(d, 'secondary', 'nur als Hinweisquelle, nicht geprüft')
          else { d.status = 'analysed'; d.skipReason = ''; d.note = [d.ocr ? 'per OCR gelesen' : '', truncated ? `über ${MAX_CHUNKS_PER_DOC} Abschnitte – Rest nicht gelesen` : ''].filter(Boolean).join(' · ') }
          matter.job.progress.done++
          log(`Gelesen: ${d.no} ${d.title || d.name} · ${facts.length} Fakten${d.status === 'skipped' ? ' · Sekundärquelle' : ''}`)
        } catch (e) { if (onError(e)) return; skipDoc(d, 'failed', 'Lesen: ' + String(e?.message || e).slice(0, 160)); log(`Lesen fehlgeschlagen: ${d.no} ${d.name}`) }
        await saveSoon()
      }))
      await save()
      if (halt) return stop(halt[0], halt[1])
      if (matter.documents.some((d) => d.status === 'read')) return stop('paused', 'Nicht alle Dokumente gelesen – „Analyse fortsetzen“ macht dort weiter.')
      await endStage('read')
    }

    // ---- Akt model: the overall context ----
    beginStage('aktmodel', 1)
    const model = buildAktModel(matter)
    matter.facts = model
    log(`Aktmodell: ${model.entries.length} Fakten, ${model.entities.length} Personen/Gesellschaften, ${model.ambiguities.length} Namensgleichheiten, ${model.contradictions.length} Widersprüche`)
    await endStage('aktmodel')

    // ---- issues: a review agent per document, with the context of the Akt ----
    const docs = matter.documents.filter(reviewable)
    beginStage('issues', docs.length)
    const vInstr = reviewInstructions(matter, model)
    const byNo = new Map(matter.documents.filter((d) => !d.container).map((d) => [d.no, d]))
    const index = deps.searchIndex ? await deps.searchIndex(matter) : null
    const handlers = {
      read_document: async ({ no, part = 1 }) => { const d = byNo.get(String(no || '').trim()); if (!d || !TEXT_STATES.includes(d.status) && d.status !== 'skipped') return `Dokument ${no} nicht vorhanden.`; const t = await textOf(d); const p = Math.max(1, Number(part) || 1); const piece = t.slice((p - 1) * 30_000, p * 30_000); return piece ? `${d.no} ${d.title || d.name} (${d.docType || '?'}, ${d.role || '?'}, ${d.date || 'ohne Datum'}) – Teil ${p}/${Math.max(1, Math.ceil(t.length / 30_000))}\n${piece}` : 'Kein weiterer Teil.' },
      list_documents: async () => documentList(matter).slice(0, 60_000),
      search_akt: async ({ query }) => { const hits = index ? index.search(String(query || ''), { k: 6 }) : []; return hits.length ? hits.map((h) => `[${h.docNo}${h.page ? ' S. ' + h.page : ''}] ${h.text.replace(/\s+/g, ' ').slice(0, 700)}`).join('\n\n') : 'Keine Treffer.' },
    }
    const previous = new Map(matter.findings.filter((f) => f.source !== 'manual').map((f) => [f.key, f]))
    const fresh = []
    await Promise.all(docs.map(async (d) => {
      try {
        const text = await textOf(d)
        const { chunks } = chunkText(text)
        const docFacts = (d.facts || []).map((f) => model.entries.find((e) => e.evidence?.some((x) => x.docId === d.id) && e.subject === f.subject && e.type === f.type)).filter(Boolean)
        const slice = aktText(matter, model, { entityKeys: [...new Set(docFacts.flatMap((e) => e.entityKeys || []))], factIds: docFacts.map((e) => e.id), maxChars: 15_000 })
        const head = `DOKUMENT: ${d.no} ${d.folder ? d.folder + '/' : ''}${d.name} · ${d.docType || '?'} · Rolle: ${d.role || 'Originalunterlage'} · ${d.date || 'ohne Datum'}${d.role === 'Sekundärquelle' ? ' (Sekundärquelle: Aussagen nur Hinweise)' : ''}\n\nZU DIESEM DOKUMENT IM AKT:\n${slice}`
        const results = await Promise.all(chunks.map((chunk, i) => agent({ name: 'dd_document', schema: DOC_REVIEW_SCHEMA, model: deps.modelMain, effort: deps.effort || 'medium', maxOut: 14_000, steps: DOC_AGENT_STEPS, tools: [TOOL_LIST, TOOL_SEARCH, TOOL_READ], handlers, instructions: vInstr, input: [{ role: 'user', content: `${head}\n\n=== TEXT${chunks.length > 1 ? ` (Teil ${i + 1}/${chunks.length})` : ''} ===\n${chunk}` }], cacheKey: `${PIPELINE_VERSION.review}|${sig}` })))
        const docFindings = []
        for (const r of results) for (const raw of r.findings || []) {
          const nf = newFinding(matter, d, { ...raw, quelle: d.role === 'Sekundärquelle' ? 'hypothese' : 'einzelanalyse' })
          nf.evidence = locateQuote(text, nf.quote).status
          if (nf.evidence === 'unverified') { matter.seq.finding--; continue } // a quote that is not in the document is not evidence
          nf.relatedDocIds = (raw.related_documents || []).map((no) => byNo.get(String(no).trim())?.id).filter(Boolean)
          const old = previous.get(nf.key)
          if (old) { nf.id = old.id; nf.no = old.no; nf.review = old.review; matter.seq.finding-- }
          docFindings.push(nf)
        }
        d.requests = results.flatMap((r) => r.requests || []).slice(0, 2)
        fresh.push({ docId: d.id, findings: docFindings })
        matter.job.progress.done++
        log(`Geprüft: ${d.no} ${d.title || d.name} · ${docFindings.length} Befund${docFindings.length === 1 ? '' : 'e'}`)
      } catch (e) { if (onError(e)) return; log(`Prüfung fehlgeschlagen: ${d.no} ${d.name} · ${String(e?.message || e).slice(0, 120)}`); d.note = [d.note, 'Prüfung fehlgeschlagen'].filter(Boolean).join(' · ') }
      await saveSoon()
    }))
    // Findings of the reviewed documents are replaced; manual ones and those of documents not reviewed now stay.
    const done = new Set(fresh.map((x) => x.docId))
    matter.findings = [...matter.findings.filter((f) => f.source === 'manual' || !done.has(f.docId)), ...fresh.flatMap((x) => x.findings)].filter((f) => f.source === 'manual' || matter.documents.some((d) => d.id === f.docId && reviewable(d)))
    await save()
    if (halt) return stop(halt[0], halt[1])
    log(`Dokumentprüfung: ${docs.length} Dokumente, ${matter.findings.length} Befunde`)
    await endStage('issues')

    // ---- review: one consolidation of all findings into themes (per area when the Akt is large) ----
    const fs = matter.findings.filter((f) => f.source !== 'manual' || f.issue).sort((a, b) => a.docNo.localeCompare(b.docNo) || a.no.localeCompare(b.no))
    beginStage('review', 1)
    const prevThemes = [...(matter.themes || []), ...(matter.orphanThemes || [])]
    const line = (f) => `${f.no} | ${f.docNo} | ${f.issue} | [${f.grade || f.severity || 'amber'}] ${f.title} | ${f.area}${f.gegenpartei ? ' | ' + f.gegenpartei : ''}${f.legalQuestion ? ` | Frage (${f.difficulty}): ${f.legalQuestion}` : ''} | ${f.description.replace(/\s+/g, ' ').slice(0, 260)}`
    const groups = fs.length > 350 ? Object.values(fs.reduce((g, f) => { (g[f.area] ||= []).push(f); return g }, {})) : [fs]
    const base = []
    // Unchanged findings: the themes stand, nothing to consolidate again.
    const cSig = hash([PIPELINE_VERSION.consolidate, sig, fs.map(line)])
    const reuse = matter.themeBaseSig === cSig && (matter.themeBase || []).length
    const cInstr = `Du bist Partner einer österreichischen Transaktionskanzlei (${dealLine(s)}). Vor dir liegen die Befunde der Dokumentprüfung. Fasse sie zu Sachverhalten (Themen) zusammen: gleicher Sachverhalt aus mehreren Dokumenten = EIN Thema mit allen Befunden; jeder Befund gehört zu genau einem Thema. Entscheide je Thema Status, Grad (red = deal-relevant, amber = lösbar, green = dokumentationswürdig), Instrument und die offene Rechtsfrage samt Schwierigkeit (leicht, schwer, sehr_schwer). Widersprechen sich Befunde oder räumt ein Dokument das Risiko eines anderen aus, entscheide und begründe es. Kein Thema zu: ${EXCLUSIONS.map((x) => x.label).join('; ')}. Bestehende Themenschlüssel beibehalten, wenn es derselbe Sachverhalt ist. Antworte als JSON nach Schema.`
    for (const g of reuse ? [] : groups) {
      if (!g.length) continue
      try {
        const r = await agent({ name: 'dd_consolidate', schema: CONSOLIDATE_SCHEMA, model: deps.modelMain, effort: deps.effort || 'medium', maxOut: 24_000, instructions: cInstr, input: [{ role: 'user', content: `BEFUNDE (${g.length}):\n${g.map(line).join('\n')}\n\nBESTEHENDE THEMEN (Schlüssel | Titel):\n${prevThemes.filter((t) => !t.manual).map((t) => `${t.key} | ${t.title}`).join('\n') || '(keine)'}` }], cacheKey: `${PIPELINE_VERSION.consolidate}|${sig}` })
        const byFno = new Map(g.map((f) => [f.no, f]))
        const taken = new Set()
        for (const t of r.themes || []) {
          const ids = (t.findings || []).map((no) => byFno.get(String(no).trim())).filter((f) => f && !taken.has(f.id))
          ids.forEach((f) => taken.add(f.id))
          if (!ids.length) continue
          base.push({ key: slug(t.key), source: ids.every((f) => f.quelle === 'hypothese') ? 'hypothese' : 'klausel', title: t.title, area: DD_AREA_KEYS.includes(t.area) ? t.area : ids[0].area, description: t.description, status: ISSUE_STATUS[t.status] ? t.status : 'bestaetigt', grade: t.grade, instrument: t.instrument, recommendation: t.recommendation, legalQuestion: t.legal_question, difficulty: DIFFICULTY[t.difficulty] ? t.difficulty : '', requests: (t.requests || []).slice(0, 2), findingIds: ids.map((f) => f.id), question: ids.map((f) => f.title).slice(0, 3).join(' · ') })
        }
        // Findings the agent did not place: one theme per issue key, as the document agents named it.
        for (const f of g) if (!taken.has(f.id)) { const k = `${f.issue}`; const t = base.find((x) => x.key === k); if (t) t.findingIds.push(f.id); else base.push({ key: k, source: f.quelle === 'hypothese' ? 'hypothese' : 'klausel', title: f.title, area: f.area, description: f.description, status: 'bestaetigt', grade: f.grade || 'amber', instrument: f.dealImpact, recommendation: f.recommendation, legalQuestion: f.legalQuestion, difficulty: f.difficulty, requests: [], findingIds: [f.id], question: f.title }) }
      } catch (e) { if (onError(e)) return stop(halt[0], halt[1]); throw e }
    }
    // Keys must be unique: themes of the same key from different area groups are merged.
    const merged = []
    for (const b of base) { const t = merged.find((x) => x.key === b.key); if (t) t.findingIds.push(...b.findingIds); else merged.push(b) }
    if (!reuse) { matter.themeBase = merged; matter.themeBaseSig = cSig }
    rebuildIssuesLocal(matter)
    matter.job.progress.done = 1
    log(`Themen: ${matter.themes.length} (${matter.themes.filter((t) => t.gradeComputed === 'red').length} rot, ${matter.themes.filter((t) => t.gradeComputed === 'amber').length} gelb, ${matter.themes.filter((t) => t.discarded).length} widerlegt)`)
    await endStage('review')

    // ---- legal: easy questions were answered by the document agents; an agent researches the others ----
    const open = matter.themes.filter((t) => liveTheme(t) && !t.manual && ['red', 'amber'].includes(t.gradeComputed) && t.legalQuestion)
    beginStage('legal', open.length)
    const findingById = new Map(matter.findings.map((f) => [f.id, f]))
    open.sort((a, b) => GRADE_RANK[a.gradeComputed] - GRADE_RANK[b.gradeComputed])
    const lInstr = `Du bist österreichischer Transaktionsanwalt und prüfst rechtlich einen Sachverhalt aus einer Due Diligence (${dealLine(s)}): Trifft das Risiko unter diesen Fakten rechtlich zu, und wie schwer wiegt es? Vorgehen nach Schwierigkeit: schwer – recherchiere per Websuche, bevorzugt im RIS (ris.bka.gv.at: Gesetze in geltender Fassung, OGH/VwGH/VfGH); sehr schwer – stelle die Frage mit vollständigem Sachverhalt an ask_aissociate, ergänzend Websuche. Rechtsgrundlagen konkret, nichts erfinden. Fristen nur als Prüfpunkt. Am Ende JSON nach Schema: verdict, answer, grade (red/amber/green nach der Prüfung), grade_reason (nur bei Änderung), norms.`
    await Promise.all(open.map(async (t) => {
      const fsT = t.findingIds.map((id) => findingById.get(id)).filter(Boolean)
      const question = `RECHTSFRAGE (${DIFFICULTY[t.difficulty] || 'schwer'}): ${t.legalQuestion}\n\nSACHVERHALT ${t.no}: ${t.title} – Grad bisher ${t.gradeComputed}\n${String(t.description || '').slice(0, 1500)}\n\nBELEGE:\n${fsT.slice(0, 8).map((f) => `- ${f.docNo} ${f.docName}${f.location ? ', ' + f.location : ''}: „${f.quote.slice(0, 300)}“`).join('\n')}`
      try {
        if (t.difficulty === 'leicht' || (!t.difficulty && fsT.some((f) => f.legalAnswer))) {
          const answers = [...new Set(fsT.map((f) => f.legalAnswer).filter(Boolean))]
          if (answers.length) { t.legal = { via: 'intern', question, verdict: 'zutreffend', answer: answers.join('\n\n').slice(0, 6000), sources: [], grade: t.gradeComputed, gradeReason: '', sig: 'intern', at: Date.now() }; matter.job.progress.done++; return }
        }
        const veryHard = t.difficulty === 'sehr_schwer' && kbLeft > 0
        const kbSig = veryHard ? 'kb' : 'web'
        const lsig = hash([PIPELINE_VERSION.legal, kbSig, question])
        if (t.legal?.sig === lsig) { matter.job.progress.done++; return }
        if (veryHard) kbLeft--
        const kbAnswers = []
        const r = await agent({ name: 'dd_legal', schema: LEGAL_SCHEMA, model: deps.modelMain, effort: 'medium', maxOut: 6000, steps: 3, web: 3, tools: veryHard ? [TOOL_KB] : [], instructions: lInstr, input: [{ role: 'user', content: question }], handlers: {
          ask_aissociate: async ({ question: q }, used) => {
            if (used.kb) return 'AI:ssociate wurde zu diesem Sachverhalt bereits gefragt.'
            const legalArea = DD_AREAS.find((a) => a.key === t.area)?.profession === 'tax' ? 'tax' : t.area === 'compliance' ? 'public' : 'civil'
            const kr = await limit(() => reserved(Math.ceil(String(q).length / 2.5) + 2500, 8000, () => deps.askKnowledgeBase({ question: String(q || question), legalArea })))
            countKb(q, kr.answer); used.kb = true
            for (const x of kr.sources || []) if (x.url && !used.sources.some((y) => y.url === x.url)) used.sources.push({ title: x.title, url: x.url })
            kbAnswers.push(String(kr.answer || ''))
            return String(kr.answer || '').slice(0, 20_000)
          },
        } })
        t.legal = { via: r._used.kb ? 'aissociate' : r._used.web ? 'web' : 'intern', question, verdict: r.verdict, answer: r.answer, grade: r.grade, gradeReason: r.grade_reason, sources: r._used.sources.slice(0, 12), norms: r.norms || [], sig: lsig, at: Date.now() }
        for (const n of r.norms || []) if (!t.norms.includes(n)) t.norms.push(n)
      } catch (e) { if (onError(e)) return; t.legal = { via: 'error', question, answer: '', error: String(e?.message || e).slice(0, 200), sig: '', at: Date.now() } }
      matter.job.progress.done++
      await saveSoon()
    }))
    if (halt) return stop(halt[0], halt[1])
    rebuildIssuesLocal(matter) // applies the legal results (grade after research, "nicht zutreffend")
    const by = (v) => open.filter((t) => t.legal?.via === v).length
    log(`Rechtsprüfung: ${by('intern')} aus internem Wissen, ${by('web')} per Websuche (RIS), ${by('aissociate')} mit AI:ssociate · ${matter.themes.filter((t) => t.discarded?.by === 'Rechtsprüfung').length} nicht zutreffend · ${matter.themes.filter((t) => liveTheme(t) && effectiveGrade(t) === 'red').length} rot`)
    await endStage('legal')

    // ---- summaries ----
    const live = matter.themes.filter(liveTheme)
    const areas = s.areas.filter((k) => live.some((t) => t.area === k) || matter.documents.some((d) => d.area === k && d.status === 'analysed'))
    beginStage('summary', areas.length + 1)
    matter.areaSummaries = {}
    await Promise.all(areas.map(async (key) => {
      const a = DD_AREAS.find((x) => x.key === key)
      const ts = live.filter((t) => t.area === key).sort((x, y) => GRADE_RANK[effectiveGrade(x)] - GRADE_RANK[effectiveGrade(y)])
      const ds = matter.documents.filter((d) => d.area === key && d.status === 'analysed')
      try {
        const sy = await agent({ name: 'dd_area', schema: AREA_SYNTHESIS_SCHEMA, model: deps.modelMain, effort: deps.effort, maxOut: 6000, instructions: `Du bist österreichischer Transaktionsanwalt und Steuerberater. Fasse den Prüfbereich „${a.label}“ einer Due Diligence (${dealLine(s)}) aus den gelieferten Themen zusammen – nichts erfinden. Erwartete Dokumente: ${a.documents}. requests: höchstens 6 gebündelte Nachfragen; missing_documents: höchstens 4 wirklich fehlende Standarddokumente (was laut Dokumentliste vorliegt, fehlt nicht). Antworte als JSON nach Schema.`, input: [{ role: 'user', content: `THEMEN (${ts.length}):\n${ts.map((t) => `- ${t.no} [${effectiveGrade(t)}] ${t.title} · ${t.instrument}: ${String(t.description || '').slice(0, 400)}${t.requests?.length ? ` | Nachfragen: ${t.requests.join('; ')}` : ''}`).join('\n') || '(keine)'}\n\nDOKUMENTE (${ds.length}):\n${ds.map((d) => `- ${d.no} ${d.title || d.name} (${d.docType})`).join('\n').slice(0, 12_000) || '(keine)'}` }] })
        matter.areaSummaries[key] = { ...sy, _used: undefined, requests: (sy.requests || []).slice(0, 6), missing_documents: (sy.missing_documents || []).slice(0, 4), label: a.label, documents: ds.length, findings: ts.length, themes: ts.length }
      } catch (e) { if (onError(e)) return; matter.areaSummaries[key] = { summary: 'Zusammenfassung fehlgeschlagen.', key_risks: [], cross_document_issues: [], missing_documents: [], requests: [], deal_recommendations: [], label: a.label, documents: ds.length, findings: ts.length, themes: ts.length } }
      matter.job.progress.done++
    }))
    if (halt) return stop(halt[0], halt[1])
    {
      const kf = keyFigures(model)
      try {
        const ex = await agent({ name: 'dd_exec', schema: EXEC_SUMMARY_SCHEMA, model: deps.modelMain, effort: deps.effort, maxOut: 5000, instructions: `Du bist österreichischer Transaktionsanwalt und Steuerberater und schreibst das Executive Summary eines Red-Flag-Berichts (${dealLine(s)}) mit Gesamteinschätzung (${OVERALL.join(' / ')}). Mandantentauglich, präzise, nur aus den gelieferten Themen und Kennzahlen. Antworte als JSON nach Schema.`, input: [{ role: 'user', content: `THEMEN:\n${live.filter((t) => effectiveGrade(t) !== 'green').map((t) => `- ${t.no} [${effectiveGrade(t)}] ${areaLabel(t.area)}: ${t.title} · ${t.review?.instrument || t.instrument} – ${String(t.description || '').slice(0, 300)}`).join('\n') || '(keine)'}\n\nKENNZAHLEN:\n${Object.entries(kf).map(([k, e]) => `- ${k}: ${e.amount != null ? e.amount.toLocaleString('de-DE') : e.value} (${e.validFrom || ''})`).join('\n') || '(keine im Akt)'}` }] })
        matter.executive = { executive_summary: ex.executive_summary, top_red_flags: ex.top_red_flags, next_steps: ex.next_steps, overall_assessment: OVERALL.includes(ex.overall_assessment) ? ex.overall_assessment : overallAssessment(matter.themes), byAgent: true, keyFigures: Object.fromEntries(Object.entries(kf).map(([k, e]) => [k, { value: e.amount ?? e.value, date: e.validFrom, docNo: e.evidence?.[0]?.docNo || '' }])) }
      } catch (e) { if (onError(e)) return stop(halt[0], halt[1]); matter.executive = { executive_summary: 'Executive Summary fehlgeschlagen.', top_red_flags: [], next_steps: [], overall_assessment: overallAssessment(matter.themes) } }
      matter.job.progress.done++
      log(`Executive Summary erstellt · Gesamteinschätzung: ${matter.executive.overall_assessment}`)
    }
    await endStage('summary')

    // ---- norms against the RIS ----
    beginStage('verify', 0)
    {
      const norms = [...new Set(live.flatMap((t) => t.norms || []).map((n) => String(n).trim()).filter(Boolean))].slice(0, 80)
      matter.job.progress = { done: 0, total: norms.length }
      let v = null
      try { v = norms.length ? await deps.verifyAnswer(norms.join('; ')) : null } catch (e) { log('RIS-Prüfung fehlgeschlagen: ' + e.message) }
      if (v) {
        const items = [...(v.norms || []), ...(v.decisions || [])]
        matter.verification = { summary: v.summary, items: items.map((x) => ({ label: x.label, status: x.status, note: x.note, url: x.url || '', title: x.title || '' })) }
        const statusOf = (n) => { const hit = items.find((x) => norm(n).includes(norm(x.label)) || norm(x.label).includes(norm(n))); return { norm: n, status: hit?.status || 'unchecked', url: hit?.url || '' } }
        for (const t of matter.themes) t.normStatus = (t.norms || []).map(statusOf)
      }
      matter.job.progress.done = norms.length
      log(`RIS-Prüfung: ${v ? `${v.summary.ok} von ${v.summary.checked} Normen bestätigt` : 'keine Normen'}`)
    }
    await endStage('verify')

    // ---- report ----
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

/** Compact textual context of a matter for chat questions ("Fragen zum Akt"): Akt model, issues, documents. */
export function matterContext(matter, maxChars = 60_000) {
  const lines = []
  lines.push(`AKT: ${matter.name}${matter.client ? ` (Mandant: ${matter.client})` : ''}${matter.settings?.target ? ` · Zielgesellschaft: ${matter.settings.target}` : ''} · ${matter.documents.length} Dokumente, ${(matter.themes || []).length} Themen`)
  if (matter.executive) lines.push(`\nEXECUTIVE SUMMARY (${matter.executive.overall_assessment}):\n${matter.executive.executive_summary}`)
  const live = (matter.themes || []).filter(liveTheme).sort((a, b) => GRADE_RANK[effectiveGrade(a)] - GRADE_RANK[effectiveGrade(b)])
  if (live.length) lines.push(`\nTHEMEN (Sachverhalte des Akts):\n${live.map((t) => `- ${t.no} [${effectiveGrade(t)}, ${t.status || ''}] ${areaLabel(t.area)} · ${t.title} (${t.instrument}; Belege: ${(t.evidence || []).map((e) => e.docNo + (e.location ? ' ' + e.location : '')).slice(0, 5).join(', ')}): ${String(t.description || '').slice(0, 400)}${t.legal?.answer ? ` | Rechtsprüfung: ${t.legal.answer.replace(/\s+/g, ' ').slice(0, 300)}` : ''}${t.review?.note ? ' | Reviewer: ' + t.review.note.slice(0, 120) : ''}`).join('\n')}`)
  for (const s of Object.values(matter.areaSummaries || {})) lines.push(`\n## ${s.label}\n${s.summary}\nFehlend: ${(s.missing_documents || []).join('; ')}\nNachfragen: ${(s.requests || []).join('; ')}`)
  if (matter.facts?.entities) lines.push(`\nAKTMODELL:\n${aktText(matter, matter.facts, { maxChars: 20_000 })}`)
  lines.push(`\nDOKUMENTE:\n${matter.documents.filter((d) => !d.container).map((d) => `- ${d.no || ''} ${d.name} [${d.status}${d.duplicateOf ? ', Duplikat' : ''}] ${d.docType || ''} · ${d.role || ''} ${d.area ? '(' + areaLabel(d.area) + ')' : ''}: ${(d.summary || '').slice(0, 200)}`).join('\n')}`)
  return lines.join('\n').slice(0, maxChars)
}
