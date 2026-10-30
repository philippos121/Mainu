// Due-diligence pipeline: the Akt context first, conclusions once per issue.
//
// Documents deliver facts and clauses; conclusions are drawn only at the level of the Akt,
// once per issue (Sachverhalt), with the whole context and the relevant documents:
//   0 inventory  SHA-256 across the Akt (duplicates), archives and e-mails unpacked on upload,
//                role from the file name (lib/inventory.js)
//   1 text       text of every document (OCR for scans, handwriting and stamps marked), text
//                duplicates, role and legal subject from the first page; secondary sources
//                are not read further (unless they are to be read as hypotheses)
//   2 read       every document in full, one call per section: facts (with identifiers such
//                as date of birth or FN) and the clauses that are risky by themselves – no
//                statements about other documents; quotes that are not in the text are dropped
//   3 Akt model  facts merged, entities resolved across documents (namesakes stay apart),
//                functions, deaths, contradictions (lib/aktmodel.js) – no model
//   4 issues     rules over the Akt model, clauses bundled per kind and counterparty, one
//                model pass over the whole Akt model; every issue once (lib/issues.js)
//   5 review     one call per issue: the slice of the Akt model, the clauses and the relevant
//                document passages → confirmed / unclear / refuted, features, evidence, the
//                legal question and its difficulty; grade by rules (lib/severity.js)
//   6 legal      easy: internal knowledge; hard: web search (RIS first); very hard: AI:ssociate
//   7 summary    areas and executive summary from the issues; overall assessment by rules
//   8 verify     cited norms against the RIS
//   9 report     Red-Flag report or full report (Word) and the workbook (Excel)
//
// A checkpoint after each stage, tokens and cost per stage; model results are cached by
// content, so a new document is read alone and only the issues whose input changed are
// reviewed again. The hard limit per due diligence (DD_HARD_IN / DD_HARD_OUT) holds over
// all runs: every model call reserves its estimated tokens before it starts.
import crypto from 'node:crypto'
import { DD_AREAS, DD_AREA_KEYS, SEVERITIES, DEAL_IMPACTS, TRANSACTION_NOTES, PIPELINE_VERSION, INVENTORY_SCHEMA, READ_SCHEMA, AKT_ISSUES_SCHEMA, ISSUE_REVIEW_SCHEMA, LEGAL_EASY_SCHEMA, AREA_SYNTHESIS_SCHEMA, EXEC_SUMMARY_SCHEMA, CORE_PREREQUISITES, EXCLUSIONS, FINDING_KINDS, LEGAL_SUBJECTS, DOC_ROLES, SKIP_REASONS, CLAUSE_KINDS, ISSUE_STATUS, DIFFICULTY } from './ddconfig.js'
import { buildDdDocx, buildDdXlsx, buildTableXlsx } from './report.js'
import { JsonStore } from './store.js'
import { roleByRule, subjectByRule, textHash, handwritingPages, reconcile } from './inventory.js'
import { buildAktModel, aktText, documentList, keyFigures } from './aktmodel.js'
import { collectIssues, keyPart } from './issues.js'
import { exclusionOf, gradeOf, effectiveGrade, liveTheme, overallAssessment, applyVerdict, verdictOf, GRADE_RANK } from './severity.js'

const CHUNK_CHARS = 150_000
const CHUNK_OVERLAP = 2_000
// Documents are read in full; only beyond 6 million characters (40 sections) the rest is listed as not read.
const MAX_CHUNKS_PER_DOC = 40
const SEV_RANK = GRADE_RANK
// Hard limit per due diligence (all runs together), not adjustable in the UI.
export const DD_HARD_IN = Number(process.env.DD_MAX_INPUT_TOKENS || 100_000_000)
export const DD_HARD_OUT = Number(process.env.DD_MAX_OUTPUT_TOKENS || 10_000_000)
const SECONDARY_AS_HYPOTHESES = /^(1|true|on|yes)$/i.test(process.env.DD_SECONDARY_AS_HYPOTHESES || '')
const DD_RED_WARN = Number(process.env.DD_RED_WARN || 12)
// Very hard legal questions go to AI:ssociate, at most this many per run (the rest by web search).
const DD_MAX_KB_CALLS = Math.min(60, Number(process.env.DD_MAX_KB_CALLS || 30))
// Document text per issue review: whole documents up to this size, else the passages around the evidence.
const REVIEW_DOC_FULL = 25_000, REVIEW_MAX_CHARS = Number(process.env.DD_REVIEW_MAX_CHARS || 120_000)
export const DD_STAGES = ['inventory', 'text', 'read', 'aktmodel', 'issues', 'review', 'legal', 'summary', 'verify', 'report']
const TEXT_STATES = ['read', 'analysed']

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
    id: JsonStore.newId('m'), ownerKey, name: String(name || 'Neuer Akt').slice(0, 120), kind: kind === 'dd' ? 'dd' : 'matter', client: String(client || '').slice(0, 120), version: 3,
    createdAt: Date.now(), updatedAt: Date.now(), settings: s, seq: { doc: 0, finding: 0, theme: 0 },
    documents: [], findings: [], themes: [], orphanThemes: [], facts: null, factCorrections: [], aktIssues: null, themeOps: { assign: {}, merges: {}, manual: [] },
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
  // Issues scale with the Akt, not with the number of times a matter is mentioned.
  const issues = Math.max(5, Math.round(all.length * 0.4)), hard = Math.round(issues * 0.4), veryHard = Math.min(DD_MAX_KB_CALLS, Math.round(issues * 0.1))
  const areasTouched = Math.min(matter.settings.areas.length, Math.max(1, all.length))
  const inTok = Math.round(chars / 3.2 + chunks * 3000 + (all.length * 250 + 20_000) + issues * 30_000 + hard * 16_000 + veryHard * 6000 + issues * 2500 + 25_000 * areasTouched + 15_000)
  const outTok = Math.round(chunks * 6000 + 8000 + issues * 4000 + hard * 1500 + issues * 800 + 4000 * areasTouched + 4000)
  const kbCalls = matter.settings.knowledgeBase !== false ? veryHard : 0
  const minutes = Math.max(3, Math.round(Math.ceil(chunks / concurrency) * 1.2 + 2 + Math.ceil(issues / concurrency) * 1.5 + 3))
  const inC = Math.min(inTok, DD_HARD_IN), outC = Math.min(outTok, DD_HARD_OUT)
  return { documents: open.length, chunks, issues, inTok: inC, outTok: outC, usd: +((inC / 1e6) * priceIn + (outC / 1e6) * priceOut).toFixed(2), kbCalls, minutes, limitIn: DD_HARD_IN, limitOut: DD_HARD_OUT, cached: true }
}

function newUsage() { return { byModel: {}, inTok: 0, outTok: 0, cachedTok: 0, webSearchCalls: 0, aissociateCalls: 0, calls: 0 } }

/** Model-call context of a matter: usage accumulates over every run; the limits are the hard ones. */
function matterCtx(matter) {
  const u = (matter.job.usage ||= newUsage())
  for (const [k, v] of Object.entries(newUsage())) if (u[k] == null) u[k] = v
  return { usage: u, limits: { inMax: DD_HARD_IN, outMax: DD_HARD_OUT } }
}

export function newDocument({ name, size, source = 'upload', ms = null, no = '' }) {
  return { id: JsonStore.newId('d'), no, name: String(name).slice(0, 200), size: Number(size) || 0, source, ms, file: null, status: 'new', note: '', textChars: 0, pages: null, chunks: 0, truncated: false, docType: '', area: '', title: '', summary: '', date: '', parties: [], keyTerms: [], flags: { red: 0, amber: 0, green: 0, info: 0 }, sha256: '', textHash: '', duplicateOf: null, parent: null, container: false, role: '', roleBy: '', subject: '', skipReason: '', facts: null, issueNos: [], handwritingPages: [], addedAt: Date.now(), analysedAt: null }
}
/** Marks a document as skipped (it stays in the inventory with the reason). */
export function skipDoc(d, reason, detail = '') { d.status = 'skipped'; d.skipReason = reason; d.note = [SKIP_REASONS[reason] || reason, detail].filter(Boolean).join(': ') }

/** A clause of a document (stage 2) or a finding entered by hand – the raw material of the issues. */
export function newFinding(matter, d, f) {
  const kind = CLAUSE_KINDS[f.kind] ? f.kind : 'sonstiges'
  const x = {
    id: JsonStore.newId('f'), no: nextNo(matter, 'finding'), docId: d?.id || '', docNo: d?.no || '', docName: d?.name || '', kind,
    area: DD_AREA_KEYS.includes(f.area) ? f.area : CLAUSE_KINDS[kind].area !== 'none' ? CLAUSE_KINDS[kind].area : (DD_AREA_KEYS.includes(d?.area) ? d.area : 'none'),
    rule: String(f.rule || '').slice(0, 20), title: String(f.title || '').slice(0, 200), gegenstand: String(f.gegenstand ?? f.subject ?? '').slice(0, 120), gegenpartei: String(f.gegenpartei ?? f.counterparty ?? '').slice(0, 120),
    art: FINDING_KINDS[f.art] ? f.art : 'mangel', betrag: Number.isFinite(f.betrag ?? f.amount) ? (f.betrag ?? f.amount) : null,
    description: String(f.description || ''), quote: String(f.quote || '').slice(0, 600), location: String(f.location || '').slice(0, 120), recommendation: String(f.recommendation || ''),
    dealImpact: DEAL_IMPACTS.includes(f.dealImpact || f.deal_impact) ? (f.dealImpact || f.deal_impact) : 'keine',
    norms: Array.isArray(f.norms) ? f.norms.map(String).slice(0, 8) : [], normStatus: [],
    quelle: f.quelle || (f.source === 'manual' ? 'manual' : 'einzelanalyse'), source: f.source === 'manual' ? 'manual' : 'model',
    evidence: 'unverified', belegOriginal: d?.role !== 'Sekundärquelle', severity: SEVERITIES.includes(f.severity) ? f.severity : null, excluded: null, discarded: null, themeId: null,
    review: { status: 'open', severity: null, note: '', ts: null },
  }
  x.key = `${(d?.sha256 || d?.id || '').slice(0, 16)}|${kind}|${keyPart(x.gegenpartei)}|${keyPart(x.gegenstand)}|${keyPart(x.title).slice(0, 60)}`
  return x
}
/** Severity after review (reviewer override wins). */
export const effectiveSeverity = (f) => (f.review?.severity && SEVERITIES.includes(f.review.severity) ? f.review.severity : f.severity)
export const isRejected = (f) => f.review?.status === 'rejected' || Boolean(f.excluded) || Boolean(f.discarded)

const areaLabel = (k) => DD_AREAS.find((a) => a.key === k)?.label || (k === 'none' ? 'Allgemein' : k)
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zäöüß0-9]+/g, ' ').trim()
const dealLine = (s) => `${s.transaction === 'asset' ? 'Asset Deal' : 'Share Deal'}, Perspektive ${s.perspective === 'seller' ? 'Verkäufer' : 'Käufer'}${s.target ? `, Zielgesellschaft ${s.target}` : ''}${s.targetFn ? ` (FN ${s.targetFn})` : ''}${s.stichtag ? `, Stichtag ${s.stichtag}` : ''}`

const FACT_GUIDE = `- gesellschafter: subject = Name des Gesellschafters; ident = Geburtsdatum bzw. FN; attribute "Geschäftsanteil"; value = Anteil bzw. Stammeinlage; valid_from/valid_to = Erwerb/Ausscheiden
- organ / prokura: subject = Name der Person; ident = Geburtsdatum; attribute = Funktion (Geschäftsführer, Vorstand, Aufsichtsrat, Prokurist); value = Vertretungsbefugnis; Flags ausgeschieden/verstorben
- todesfall: subject = Name der verstorbenen Person; ident = Geburtsdatum; valid_to = Todestag; value = Erben/Verlassenschaft
- funktionstraeger: Personen, die ein Bescheid als Funktionsträger nennt – subject = Name; ident = Geburtsdatum (wenn genannt, unbedingt erfassen); attribute = Funktion (z. B. gewerberechtlicher Geschäftsführer, abfallrechtlicher Geschäftsführer, verantwortliche/fachkundige Person, Verkehrsleiter); counterparty = Behörde; value = Berechtigung; valid_from = Bestellung
- genehmigung: subject = Gegenstand der Genehmigung/Berechtigung; counterparty = Inhaber; site = Standort; valid_to = Befristung; attribute = Behörde, Geschäftszahl und Datum
- standort: subject = Standort/Liegenschaft; attribute = Nutzungsrecht (Eigentum, Miete, Pacht, Baurecht); counterparty = Eigentümer/Vermieter; valid_to = Ende
- vertrag: subject = Vertragsgegenstand; counterparty = Vertragspartner; amount = Vertragswert/Kreditbetrag; valid_to = Laufzeitende; Flag kontrollwechsel bei Change-of-Control-/Gesellschafterwechselklausel
- zahlung_gesellschafter: subject = Zahlungsgrund; counterparty = empfangender Gesellschafter; amount; valid_from = Datum (auch Ausschüttungen)
- kennzahl (nur aus Jahresabschlüssen): subject = Gesellschaft; attribute = Umsatz, Jahresergebnis, Eigenkapital, Eigenkapitalquote, Bilanzsumme, Liquide Mittel, Bankverbindlichkeiten, Verbindlichkeiten gegenüber Gesellschaftern; amount = Wert (Quote in Prozent); valid_from = Bilanzstichtag
- beschluss: subject = Beschlussgegenstand; value = Namen der abstimmenden bzw. unterzeichnenden Gesellschafter, mit Komma getrennt; valid_from = Datum
- recht_dritter: subject = Recht (Fruchtgenuss, Stimmbindung, Pfandrecht, Vorkaufsrecht) und woran; counterparty = Berechtigter; Flag erloschen, wenn erloschen`

function readInstructions(matter) {
  const s = matter.settings
  const areas = DD_AREAS.filter((a) => s.areas.includes(a.key))
  return `Du bist Rechtsanwalt in einer österreichischen Transaktionskanzlei und liest für eine Due Diligence (${dealLine(s)}) EIN Dokument des Datenraums vollständig. Du lieferst zwei Dinge: die FAKTEN und die KLAUSELN, die aus diesem Dokument selbst heraus ein Risiko bergen. Schlüsse über den ganzen Akt zieht ein späterer Schritt. Antworte ausschließlich als JSON nach Schema.

FAKTEN (nur was im Dokument steht)
${FACT_GUIDE}

KLAUSELN (nur Risiken, die das Dokument selbst zeigt; Red-Flag-Katalog mit Regel-IDs)
${areas.map((a) => `- ${a.key}: ${a.redFlags}`).join('\n')}

VERBOTEN: Aussagen über andere Dokumente oder darüber, was im Akt fehlt, nicht belegt oder ungeklärt ist ("keine Nachfolge belegt", "Nachweis fehlt"). Das prüft der Akt-Schritt.

REGELN
- Jede Tatsache und jede Klausel mit wörtlichem Zitat (exakt aus dem Text kopiert – es wird maschinell gesucht) und Fundstelle; ohne Zitat nicht erfassen.
- Personen immer mit Geburtsdatum (ident), Gesellschaften mit Firmenbuchnummer, wenn im Text genannt.
- Daten als JJJJ-MM-TT (nur Jahr: JJJJ), Beträge als Zahl in EUR. Nichts schätzen.
- Handschriftliches ([handschriftlich: …]) und Stempel ([Stempel: …]) sind Teil des Dokuments.
- Vollständig bei Fakten, knapp bei Beschreibungen. Sprache: Deutsch.`
}

function aktPassInstructions(matter) {
  return `Du bist Partner einer österreichischen Transaktionskanzlei (${dealLine(matter.settings)}). Vor dir liegt das AKTMODELL: alle Tatsachen des Datenraums, zusammengeführte Personen und Gesellschaften (mit Geburtsdatum bzw. FN), ihre Funktionen, Todesfälle, Widersprüche und namensgleiche Personen. Finde die Sachverhalte, die nur der ganze Akt zeigt und die für die Transaktion rechtlich zu prüfen sind (Zusammenhänge zwischen Dokumenten, zeitliche Abfolgen, Personen in mehreren Rollen, Lücken in Ketten von Bestellungen, Übertragungen oder Genehmigungen). Die bereits erkannten Sachverhalte sind aufgelistet – NICHT wiederholen. Nur wesentliche Punkte; lieber wenige als viele. Antworte als JSON nach Schema mit den Entitäts-IDs (E-…) und Dokumentnummern (D-…) aus dem Aktmodell.`
}

function reviewInstructions(matter) {
  const s = matter.settings
  return `Du bist erfahrener österreichischer Transaktionsanwalt und Steuerberater und prüfst für eine ${s.transaction === 'asset' ? 'Asset-Deal' : 'Share-Deal'}-Due-Diligence (Perspektive ${s.perspective === 'seller' ? 'Verkäufer' : 'Käufer'}) EINEN Sachverhalt – mit dem Ausschnitt des Aktmodells und den Wortlauten der einschlägigen Dokumente. Antworte ausschließlich als JSON nach Schema.

TRANSAKTIONSSTRUKTUR: ${TRANSACTION_NOTES[s.transaction] || TRANSACTION_NOTES.share}

KERNVORAUSSETZUNGEN DES GESCHÄFTS
${CORE_PREREQUISITES.map((x) => '- ' + x).join('\n')}

KEIN RISIKO (Ausschlusskatalog)
${EXCLUSIONS.map((x) => '- ' + x.label).join('\n')}

REGELN
- Entscheide aus dem GANZEN gelieferten Material: status bestaetigt (Risiko liegt vor), ungeklaert (der Akt lässt es offen – etwa Erforderliches nicht belegt oder Identität einer Person unklar), widerlegt (der Akt zeigt, dass kein Risiko besteht; Begründung in description).
- Achte auf Identitäten: namensgleiche Personen nur gleichsetzen, wenn Geburtsdatum oder Zusammenhang es tragen; Widersprüche ausdrücklich benennen.
- evidence: wörtliche Zitate aus den gelieferten Auszügen (Dokumentnummer D-…), nur aus Originalunterlagen; jede wesentliche Aussage belegen.
- Du vergibst keinen Schweregrad, nur Merkmale: art (mangel, luecke = ungeklärt/nicht belegt, hinweis), betrag, betroffen, heilbar, kernvoraussetzung, instrument. Wesentlichkeitsschwelle ${s.materialityEur.toLocaleString('de-DE')} EUR.
- difficulty der Rechtsfrage: leicht (gesichertes Grundwissen), schwer (Normen/Judikatur nachsehen), sehr_schwer (ungeklärte oder sehr spezielle Frage). Fristen nur als Prüfpunkt mit Rechtsgrundlage, keine Fristberechnung.
- Österreichisches Recht, konkrete Normen, keine erfundenen Fundstellen. Sprache: Deutsch, Kanzleistil.`
}

/** Merge the readings of the sections of one document. */
function mergeReadings(parts) {
  const out = { ...parts[0], parties: [], key_terms: [], facts: [], clauses: [] }
  const seen = { parties: new Set(), terms: new Set(), facts: new Set(), clauses: new Set() }
  for (const p of parts) {
    for (const x of p.parties || []) { const k = norm(x); if (k && !seen.parties.has(k)) { seen.parties.add(k); out.parties.push(x) } }
    for (const t of p.key_terms || []) { const k = norm(t.term); if (k && !seen.terms.has(k)) { seen.terms.add(k); out.key_terms.push(t) } }
    for (const f of p.facts || []) { const k = norm(`${f.type} ${f.subject} ${f.ident} ${f.attribute} ${f.value} ${f.counterparty}`); if (k && !seen.facts.has(k)) { seen.facts.add(k); out.facts.push(f) } }
    for (const c of p.clauses || []) { const k = norm(`${c.kind} ${c.title} ${c.subject}`).slice(0, 120); if (k && !seen.clauses.has(k)) { seen.clauses.add(k); out.clauses.push(c) } }
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

/** Earlier matters (pipeline v1/v2): texts stay, everything from the reading on is redone. */
function migrate(matter, log) {
  if ((matter.version || 1) >= 3) return
  for (const d of matter.documents) {
    if (['extracted', 'analysed'].includes(d.status)) d.status = 'read'
    else if (d.status === 'error') { if (/kein text|gescannt|ocr|nicht lesbar/i.test(d.note || '')) { d.status = 'new'; d.note = '' } else skipDoc(d, 'failed', d.note) }
    Object.assign(d, { sha256: d.sha256 || '', textHash: d.textHash || '', duplicateOf: d.duplicateOf || null, parent: d.parent || null, role: d.role || '', subject: d.subject || '', facts: null, issueNos: [] })
  }
  matter.findings = (matter.findings || []).filter((f) => f.source === 'manual')
  Object.assign(matter, { themes: [], orphanThemes: [], facts: null, aktIssues: null, factCorrections: matter.factCorrections || [], themeOps: { assign: {}, merges: {}, manual: [] }, areaSummaries: {}, executive: null, verification: null, version: 3 })
  matter.seq.theme ||= 0
  matter.job.checkpoints = {}; matter.job.stageUsage = {}
  log('Akt auf die neue Pipeline umgestellt: Texte bleiben, Lesen, Aktmodell, Sachverhalte und Prüfung werden neu erstellt.')
}

/** Text an issue review sees from one document: whole up to REVIEW_DOC_FULL, else the passages around the evidence. */
function excerpt(text, quotes, budget) {
  if (text.length <= Math.min(REVIEW_DOC_FULL, budget)) return text
  const spans = []
  for (const q of quotes) { const loc = locateQuote(text, q); if (loc.offset >= 0) spans.push([Math.max(0, loc.offset - 3000), Math.min(text.length, loc.offset + 3500)]) }
  if (!spans.length) return text.slice(0, Math.min(budget, REVIEW_DOC_FULL))
  spans.sort((a, b) => a[0] - b[0])
  const merged = []
  for (const sp of spans) { const last = merged[merged.length - 1]; if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]); else merged.push([...sp]) }
  return [text.slice(0, 1500), ...merged.map(([a, b]) => `[…] ${text.slice(a, b)}`)].join('\n').slice(0, budget)
}

/** Carries number, review and (for local rebuilds) the last result over to the issue of the same key. */
function baseIssue(matter, seed, prev) {
  matter.seq.theme ||= 0
  const t = {
    id: prev?.id || `th_${(++matter.seq.theme).toString(36)}_${Math.random().toString(36).slice(2, 8)}`, no: prev?.no || `T-${String(matter.seq.theme).padStart(3, '0')}`, key: seed.key,
    source: seed.source, rule: seed.rule, title: prev?.title || seed.title, question: seed.question, area: prev?.area || seed.area, entityKeys: seed.entityKeys, factIds: seed.factIds, docIds: seed.docIds, findingIds: seed.findingIds,
    review: prev?.review || { status: 'open', grade: null, instrument: null, note: '', ts: null }, manual: seed.source === 'manuell',
    legal: prev?.legal || null, // reused when the legal question is unchanged (signature)
  }
  return t
}

/** Rebuild after a review operation (merge, split, move a clause, facts correction) – no model calls. */
export function rebuildIssuesLocal(matter) {
  if (!matter.facts) return
  const prev = new Map([...(matter.themes || []), ...(matter.orphanThemes || [])].map((t) => [t.key, t]))
  const seeds = collectIssues(matter, matter.facts)
  const themes = seeds.map((sd) => {
    const p = prev.get(sd.key)
    const t = { ...(p || {}), ...baseIssue(matter, sd, p) }
    if (!p) { const m = (matter.themeOps.manual || []).find((x) => x.key === sd.key); Object.assign(t, { status: m ? 'bestaetigt' : 'offen', pending: !m, description: m?.description || '', evidence: [], gradeComputed: m?.grade || 'amber', instrument: m?.review?.instrument || 'Nachfrage', norms: [], normStatus: [], requests: [] }); if (m?.review) t.review = m.review }
    if (t.review?.title) t.title = t.review.title
    if (t.review?.description) t.description = t.review.description
    return t
  })
  const keys = new Set(themes.map((t) => t.key))
  matter.orphanThemes = [...prev.values()].filter((t) => !keys.has(t.key) && (t.orphaned || t.review?.status !== 'open' || t.review?.note)).map((t) => ({ ...t, orphaned: true }))
  matter.themes = themes.sort((a, b) => GRADE_RANK[effectiveGrade(a)] - GRADE_RANK[effectiveGrade(b)] || a.no.localeCompare(b.no))
  linkDocuments(matter)
  if (matter.executive) matter.executive.overall_assessment = overallAssessment(matter.themes)
}

/** Which issues every document belongs to – the coverage proof per document. */
function linkDocuments(matter) {
  for (const d of matter.documents) { d.issueNos = []; d.flags = { red: 0, amber: 0, green: 0, info: 0 } }
  const byId = new Map(matter.documents.map((d) => [d.id, d]))
  for (const t of matter.themes || []) {
    if (!liveTheme(t)) continue
    const ids = new Set([...(t.docIds || []), ...(t.evidence || []).map((e) => e.docId)])
    for (const id of ids) { const d = byId.get(id); if (!d) continue; d.issueNos.push(t.no); const g = effectiveGrade(t); if (d.flags[g] != null) d.flags[g]++ }
  }
  for (const f of matter.findings || []) f.themeId = (matter.themes || []).find((t) => t.findingIds?.includes(f.id))?.id || null
}

/**
 * Run (or resume) the DD pipeline of a matter.
 * deps: { store, callModel, extractText, modelMain, modelExtract, effort, concurrency, verifyAnswer,
 *   computeCost, send, askKnowledgeBase, answerEasyLegal, cache: { get, set } }
 * opts: { fromStage: 3 } recomputes from the Akt model (facts corrections, review changes);
 *       { reanalyse: true } ignores the cache.
 */
export async function runDd(matter, deps, opts = {}) {
  const { store, send } = deps
  const ctx = matterCtx(matter)
  const log = (message) => { matter.job.log.push({ t: Date.now(), message }); if (matter.job.log.length > 600) matter.job.log.splice(0, matter.job.log.length - 600); send('dd', { matterId: matter.id, stage: matter.job.stage, progress: matter.job.progress, message }) }
  const save = () => store.saveMatter(matter)
  const paused = () => matter.job.pauseRequested
  const overBudget = () => ctx.usage.inTok >= DD_HARD_IN || ctx.usage.outTok >= DD_HARD_OUT
  const s = matter.settings
  // Knowledge-base answers have no token report: they count with an estimate (chars / 3.2 + retrieval overhead).
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
  const isHalt = (e) => e?.message === 'halt' || isBudget(e)
  /** One structured model call within the pool and the limit; cached by content; one more try after a pause. */
  const ask = async (p, schemaName, schema, cacheKey = null) => {
    const key = cacheKey ? `${schemaName}|${hash([cacheKey, p.model, p.instructions, p.input])}` : null
    if (key && !noCache) { const hit = await cache.get(key); if (hit) return hit }
    const estIn = Math.ceil((String(p.instructions || '').length + JSON.stringify(p.input || '').length) / 2.5) + 1500
    const maxOut = p.maxOut || 8000
    const out = await limit(() => reserved(estIn, maxOut, async () => {
      const call = () => deps.callModel(ctx, { ...p, maxOut, temperature: 0, ...(schema ? { text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } } } : {}) })
      let resp
      try { resp = await call() } catch (e) { if (isBudget(e)) throw e; await new Promise((r) => setTimeout(r, 8000)); resp = await call() }
      if (!schema) return resp
      let parsed = null
      try { parsed = JSON.parse(resp.output_text || '') } catch {}
      if (!parsed) throw new Error('Modell lieferte kein gültiges JSON' + (resp.status === 'incomplete' ? ' (Ausgabe abgeschnitten)' : ''))
      return parsed
    }))
    if (key) await cache.set(key, out)
    return out
  }
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
  const settingsSig = hash([s.transaction, s.perspective, s.materialityEur, s.target, s.targetFn, s.stichtag, s.closing, s.areas, s.sellers])
  const docText = new Map()
  const textOf = async (d) => { if (!docText.has(d.id)) docText.set(d.id, await store.getText(matter.id, d.id)); return docText.get(d.id) }

  let from = Number(opts.fromStage) || 0
  if (from >= 3 && matter.documents.some((d) => !d.container && ['new', 'read'].includes(d.status))) from = 0

  try {
    if (from < 3) {
      // ---- 0 inventory ----
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
      log(`Inventar: ${matter.documents.filter((d) => !d.container).length} Dokumente, ${matter.documents.filter((d) => d.duplicateOf).length} Duplikate (SHA-256)`)
      await endStage('inventory')

      // ---- 1 text ----
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
      await Promise.all(unknown.map(async ([d, head]) => {
        try {
          const r = await ask({ model: deps.modelExtract, effort: 'low', maxOut: 800, instructions: `Ordne ein Dokument aus dem Datenraum einer Due Diligence ein (${dealLine(s)}). Antworte als JSON nach Schema.`, input: [{ role: 'user', content: `DATEI: ${d.folder ? d.folder + '/' : ''}${d.name}\n\n${head}` }] }, 'dd_inventory', INVENTORY_SCHEMA, `${PIPELINE_VERSION.inventory}|${d.sha256}|${s.target}`)
          if (!d.role) { d.role = DOC_ROLES.includes(r.role) ? r.role : 'Originalunterlage'; d.roleBy = 'Modell' }
          if (!d.subject) d.subject = r.subject
          if (!d.docType) d.docType = r.doc_type
        } catch (e) { if (isHalt(e)) return; d.role ||= 'Originalunterlage'; d.roleBy ||= 'Standard' }
      }))
      if (halt) return stop(halt[0], halt[1])
      for (const d of matter.documents) if (d.status === 'read' && d.role === 'Sekundärquelle' && !s.secondaryAsHypotheses) skipDoc(d, 'secondary', 'nur als Hinweisquelle, nicht gelesen')
      await endStage('text')

      // ---- 2 read: every document in full – facts and clauses ----
      const toReadFull = matter.documents.filter((d) => d.status === 'read')
      beginStage('read', toReadFull.length)
      const rInstr = readInstructions(matter)
      await Promise.all(toReadFull.map(async (d) => {
        try {
          const text = await textOf(d)
          const { chunks, truncated } = chunkText(text)
          const parts = await Promise.all(chunks.map((chunk, i) => ask({ model: deps.modelExtract, effort: 'medium', maxOut: 16_000, instructions: rInstr, input: [{ role: 'user', content: `DOKUMENT: ${d.no} ${d.folder ? d.folder + '/' : ''}${d.name} · Rolle: ${d.role || 'Originalunterlage'}${chunks.length > 1 ? ` (Teil ${i + 1}/${chunks.length})` : ''}\n\n=== TEXT ===\n${chunk}` }] }, 'dd_read', READ_SCHEMA, `${PIPELINE_VERSION.read}|${settingsSig}|${d.sha256 || d.textHash}|${i}`)))
          const r = mergeReadings(parts)
          const facts = [], dropped = { facts: 0, clauses: 0 }
          for (const f of r.facts || []) { const st = locateQuote(text, f.quote).status; if (st !== 'unverified') facts.push({ ...f, evidence: st }); else dropped.facts++ }
          Object.assign(d, { docType: r.doc_type, area: r.area, title: r.title, date: r.date || '', summary: r.summary, parties: r.parties, keyTerms: r.key_terms, facts, chunks: chunks.length, truncated, coverage: { sections: chunks.length, truncated, chars: text.length } })
          if (d.roleBy !== 'Prüfer') d.subject = r.subject || d.subject
          // Clauses of this document are rebuilt; numbers and reviewer decisions stay with the clause key.
          const previous = matter.findings.filter((f) => f.docId === d.id && f.source !== 'manual')
          matter.findings = matter.findings.filter((f) => !(f.docId === d.id && f.source !== 'manual'))
          for (const c of r.clauses || []) {
            const nf = newFinding(matter, d, { ...c, quelle: d.role === 'Sekundärquelle' ? 'hypothese' : 'einzelanalyse' })
            nf.evidence = locateQuote(text, nf.quote).status
            if (nf.evidence === 'unverified') { dropped.clauses++; matter.seq.finding--; continue }
            const old = previous.find((p) => p.key === nf.key)
            if (old) { nf.id = old.id; nf.no = old.no; nf.review = old.review; matter.seq.finding-- }
            matter.findings.push(nf)
          }
          d.status = 'analysed'; d.analysedAt = Date.now(); d.skipReason = ''
          d.note = [d.ocr ? 'per OCR gelesen' : '', d.role === 'Sekundärquelle' ? 'Sekundärquelle: nur Hinweise' : '', truncated ? `über ${MAX_CHUNKS_PER_DOC} Abschnitte – Rest nicht gelesen` : '', dropped.facts + dropped.clauses ? `${dropped.facts + dropped.clauses} Angaben ohne wörtlichen Beleg verworfen` : ''].filter(Boolean).join(' · ')
          matter.job.progress.done++
          log(`Gelesen: ${d.no} ${d.title || d.name} · ${chunks.length} Abschnitt${chunks.length > 1 ? 'e' : ''}, ${facts.length} Fakten, ${(r.clauses || []).length - dropped.clauses} Klauseln${d.note ? ' · ' + d.note : ''}`)
        } catch (e) {
          if (isHalt(e)) { if (isBudget(e)) halt ||= ['paused', limitMsg]; return }
          skipDoc(d, 'failed', 'Lesen: ' + String(e?.message || e).slice(0, 160))
          log(`Lesen fehlgeschlagen: ${d.no} ${d.name}`)
        }
        await saveSoon()
      }))
      await save()
      if (halt) return stop(halt[0], halt[1])
      // The Akt model is built only when every document is read.
      if (matter.documents.some((d) => d.status === 'read')) return stop('paused', 'Nicht alle Dokumente gelesen – „Analyse fortsetzen“ macht dort weiter.')
      await endStage('read')
    }

    // ---- 3 Akt model (no model calls) ----
    beginStage('aktmodel', 1)
    const model = buildAktModel(matter)
    matter.facts = model
    log(`Aktmodell: ${model.entries.length} Fakten, ${model.entities.length} Personen/Gesellschaften, ${model.ambiguities.length} Namensgleichheiten, ${model.contradictions.length} Widersprüche`)
    await endStage('aktmodel')

    // ---- 4 issues: rules, bundled clauses, one pass over the whole Akt model ----
    beginStage('issues', 1)
    const ruleSeeds = collectIssues({ ...matter, aktIssues: [] }, model)
    const fullText = aktText(matter, model)
    try {
      const r = await ask({ model: deps.modelMain, effort: deps.effort || 'medium', maxOut: 8000, instructions: aktPassInstructions(matter), input: [{ role: 'user', content: `AKTMODELL:\n${fullText}\n\nDOKUMENTE (Nr | Typ | Rolle | Datum | Titel):\n${documentList(matter)}\n\nBEREITS ERKANNTE SACHVERHALTE:\n${ruleSeeds.map((x) => '- ' + x.title).join('\n') || '(keine)'}` }] }, 'dd_akt_issues', AKT_ISSUES_SCHEMA, `${PIPELINE_VERSION.issues}|${settingsSig}`)
      const entById = new Map(model.entities.map((e) => [e.id, e.key])), docByNo = new Map(matter.documents.map((d) => [d.no, d.id]))
      matter.aktIssues = (r.issues || []).slice(0, 40).map((x) => ({ key: `AKT|${keyPart(x.title)}`, title: x.title, question: x.question, area: DD_AREA_KEYS.includes(x.area) ? x.area : 'none', entityKeys: (x.entities || []).map((id) => entById.get(id)).filter(Boolean), docIds: (x.documents || []).map((no) => docByNo.get(no)).filter(Boolean) }))
    } catch (e) { if (isHalt(e)) return stop(halt?.[0] || 'paused', halt?.[1] || limitMsg); log('Akt-Durchgang fehlgeschlagen: ' + String(e?.message || e).slice(0, 160)) }
    const seeds = collectIssues(matter, model)
    log(`Sachverhalte: ${seeds.length} (${seeds.filter((x) => x.source === 'regel').length} aus Regeln, ${seeds.filter((x) => x.source === 'klausel').length} aus Klauseln, ${seeds.filter((x) => x.source === 'akt').length} aus dem Akt-Durchgang${seeds.filter((x) => x.source === 'hypothese').length ? `, ${seeds.filter((x) => x.source === 'hypothese').length} Hypothesen` : ''})`)
    await endStage('issues')

    // ---- 5 review per issue: Akt-model slice + relevant document passages ----
    beginStage('review', seeds.length)
    const prev = new Map([...(matter.themes || []), ...(matter.orphanThemes || [])].map((t) => [t.key, t]))
    const docById = new Map(matter.documents.map((d) => [d.id, d])), docByNo = new Map(matter.documents.map((d) => [d.no, d]))
    const factById = new Map(model.entries.map((e) => [e.id, e])), findingById = new Map(matter.findings.map((f) => [f.id, f]))
    const vInstr = reviewInstructions(matter)
    const themes = []
    await Promise.all(seeds.map(async (sd) => {
      const p = prev.get(sd.key)
      const t = baseIssue(matter, sd, p)
      themes.push(t)
      if (sd.source === 'manuell') { const m = matter.themeOps.manual.find((x) => x.key === sd.key); Object.assign(t, { status: 'bestaetigt', description: m?.description || '', evidence: [], gradeComputed: m?.grade || 'amber', instrument: m?.review?.instrument || 'Nachfrage', norms: [], normStatus: [], requests: [] }); matter.job.progress.done++; return }
      try {
        // Documents: the issue's own, those of its facts and clauses, and of its entities (most relevant first).
        const clauses = sd.findingIds.map((id) => findingById.get(id)).filter(Boolean)
        const facts = sd.factIds.map((id) => factById.get(id)).filter(Boolean)
        const entFacts = model.entries.filter((e) => (e.entityKeys || []).some((k) => sd.entityKeys.includes(k)))
        const quotesByDoc = new Map()
        const addQ = (docId, q) => { if (!docId) return; if (!quotesByDoc.has(docId)) quotesByDoc.set(docId, []); if (q) quotesByDoc.get(docId).push(q) }
        for (const id of sd.docIds) addQ(id, '')
        for (const c of clauses) addQ(c.docId, c.quote)
        for (const f of [...facts, ...entFacts]) for (const ev of f.evidence || []) addQ(ev.docId, ev.quote)
        const docs = [...quotesByDoc.keys()].map((id) => docById.get(id)).filter((d) => d && !d.duplicateOf).slice(0, 14)
        let budget = REVIEW_MAX_CHARS
        const parts = []
        for (const d of docs) { if (budget < 2000) break; const tx = excerpt(await textOf(d), quotesByDoc.get(d.id) || [], Math.min(budget, 40_000)); budget -= tx.length; parts.push(`=== ${d.no} ${d.title || d.name} (${d.docType || '?'}, ${d.role || '?'}, ${d.date || 'ohne Datum'}) ===\n${tx}`) }
        const slice = aktText(matter, model, { entityKeys: sd.entityKeys, factIds: [...sd.factIds, ...entFacts.map((e) => e.id)], maxChars: 40_000 })
        const input = `SACHVERHALT: ${sd.title}\nZU PRÜFEN: ${sd.question}${sd.hints.length ? `\nHINWEISE: ${sd.hints.join(' | ')}` : ''}${clauses.length ? `\n\nKLAUSELN AUS DEN DOKUMENTEN:\n${clauses.map((c) => `- ${c.docNo} ${c.location}: ${c.title} – „${c.quote}“`).join('\n')}` : ''}\n\nAKTMODELL (Ausschnitt):\n${slice}\n\nDOKUMENTE (Wortlaut bzw. Auszüge):\n${parts.join('\n\n') || '(keine)'}`
        const r = await ask({ model: deps.modelMain, effort: deps.effort || 'medium', maxOut: 8000, instructions: vInstr, input: [{ role: 'user', content: input }] }, 'dd_issue_review', ISSUE_REVIEW_SCHEMA, `${PIPELINE_VERSION.review}|${settingsSig}`)
        // Evidence: verbatim in an original document of the material, else dropped.
        const evidence = []
        for (const ev of r.evidence || []) {
          const d = docByNo.get(String(ev.doc).trim()); if (!d || d.role === 'Sekundärquelle') continue
          const st = locateQuote(await textOf(d), ev.quote).status
          if (st !== 'unverified' && !evidence.some((x) => x.docId === d.id && x.quote === ev.quote)) evidence.push({ docId: d.id, docNo: d.no, docName: d.name, location: ev.location, quote: ev.quote, status: st })
        }
        Object.assign(t, {
          status: r.status, title: t.review?.title || r.title || sd.title, area: DD_AREA_KEYS.includes(r.area) ? r.area : sd.area, description: t.review?.description || r.description, evidence,
          art: r.status === 'ungeklaert' ? 'luecke' : r.art, betrag: r.betrag, betroffen: r.betroffen, heilbar: r.heilbar, kernvoraussetzung: r.kernvoraussetzung, instrument: r.instrument, dealImpact: r.instrument, recommendation: r.recommendation,
          legalQuestion: r.legal_question, difficulty: r.difficulty, requests: (r.requests || []).slice(0, 2), norms: (r.norms || []).slice(0, 8), normStatus: [],
          docIds: [...new Set([...sd.docIds, ...evidence.map((e) => e.docId), ...clauses.map((c) => c.docId)])], belegOriginal: evidence.length > 0, unconfirmed: sd.source === 'hypothese' && !evidence.length, pending: false,
        })
        matter.job.progress.done++
        log(`Geprüft: ${t.no} ${t.title} · ${ISSUE_STATUS[r.status]}${evidence.length ? ` · ${evidence.length} Belege in ${new Set(evidence.map((e) => e.docId)).size} Dok.` : ''}`)
      } catch (e) {
        if (isHalt(e)) { if (isBudget(e)) halt ||= ['paused', limitMsg]; return }
        Object.assign(t, { status: 'ungeklaert', description: `Prüfung fehlgeschlagen: ${String(e?.message || e).slice(0, 160)}`, evidence: [], art: 'luecke', gradeComputed: 'amber', pending: true, requests: [], norms: [], normStatus: [] })
      }
      await saveSoon()
    }))
    if (halt) { matter.themes = themes; return stop(halt[0], halt[1]) }
    // Grade by rules (no model): exclusion catalogue, features, secondary-only evidence.
    for (const t of themes) {
      if (t.manual) continue
      t.discarded = null; t.excluded = null
      if (t.status === 'widerlegt') { t.discarded = { by: 'Prüfung', reason: t.description.split(/(?<=[.!?])\s/)[0] || 'Der Akt zeigt kein Risiko.' }; t.gradeComputed = 'green'; continue }
      const asFinding = { title: t.title, description: t.description, quote: (t.evidence || []).map((e) => e.quote).join(' '), area: t.area, dealImpact: t.instrument }
      t.excluded = exclusionOf(asFinding, model, s)
      if (t.excluded) { t.discarded = { by: 'Ausschlusskatalog', reason: `${t.excluded.id}: ${t.excluded.label}` }; t.gradeComputed = 'green'; continue }
      const g = gradeOf({ art: t.art, betrag: t.betrag, betroffen: t.betroffen, kernvoraussetzung: t.kernvoraussetzung, rule: t.rule, quelle: t.source === 'hypothese' ? 'hypothese' : 'regel', belegOriginal: t.belegOriginal }, s)
      t.gradeComputed = t.pending ? 'amber' : g.grade; t.gradeWhy = g.why; t.unconfirmed = g.unconfirmed || t.unconfirmed
    }
    matter.themes = themes.sort((a, b) => GRADE_RANK[a.gradeComputed] - GRADE_RANK[b.gradeComputed] || a.no.localeCompare(b.no))
    const keys = new Set(themes.map((t) => t.key))
    matter.orphanThemes = [...prev.values()].filter((t) => !keys.has(t.key) && (t.orphaned || t.review?.status !== 'open' || t.review?.note)).map((t) => ({ ...t, orphaned: true }))
    linkDocuments(matter)
    log(`Prüfung: ${themes.filter((t) => t.status === 'bestaetigt').length} bestätigt, ${themes.filter((t) => t.status === 'ungeklaert').length} ungeklärt, ${themes.filter((t) => t.discarded).length} widerlegt oder ausgeschlossen`)
    await endStage('review')

    // ---- 6 legal check by difficulty ----
    const toCheck = matter.themes.filter((t) => liveTheme(t) && !t.manual && !t.pending && ['red', 'amber'].includes(t.gradeComputed) && t.legalQuestion)
    beginStage('legal', toCheck.length)
    const kbOn = s.knowledgeBase !== false && typeof deps.askKnowledgeBase === 'function'
    let kbLeft = kbOn ? DD_MAX_KB_CALLS : 0
    // Very hard questions of red issues first, so the AI:ssociate quota goes where it matters most.
    toCheck.sort((a, b) => GRADE_RANK[a.gradeComputed] - GRADE_RANK[b.gradeComputed])
    const legalQuestion = (t) => `${dealLine(s)}. Prüfe einen Sachverhalt aus der Due Diligence: Ist das Risiko unter diesen Fakten rechtlich zutreffend und noch relevant? Beginne mit „zutreffend“, „teilweise zutreffend“ oder „nicht zutreffend“, dann Rechtsgrundlage nach österreichischem Recht und übliche Absicherung im Kaufvertrag. Kurz. Fristen nur als Prüfpunkt, keine Fristberechnung.\n\nRECHTSFRAGE: ${t.legalQuestion}\n\nSACHVERHALT ${t.no}: ${t.title}\n${String(t.description || '').slice(0, 1500)}\n\nBELEGE:\n${(t.evidence || []).slice(0, 6).map((e) => `- ${e.docNo} ${e.docName}${e.location ? ', ' + e.location : ''}: „${e.quote.slice(0, 300)}“`).join('\n') || '(keine)'}`
    await Promise.all(toCheck.map(async (t) => {
      const question = legalQuestion(t)
      let via = t.difficulty === 'sehr_schwer' && kbLeft > 0 ? 'aissociate' : t.difficulty === 'leicht' ? 'intern' : 'web'
      if (via === 'web' && typeof deps.answerEasyLegal !== 'function') via = 'intern'
      const sig = hash([PIPELINE_VERSION.legal, via, question])
      if (t.legal?.sig === sig) { applyVerdict(t); matter.job.progress.done++; return }
      if (via === 'aissociate') kbLeft--
      try {
        if (via === 'aissociate') {
          const a = DD_AREAS.find((x) => x.key === t.area)
          const legalArea = a?.profession === 'tax' ? 'tax' : t.area === 'compliance' ? 'public' : 'civil'
          const kr = await limit(() => reserved(Math.ceil(question.length / 2.5) + 2500, 8000, () => deps.askKnowledgeBase({ question, legalArea })))
          countExternal(question, kr.answer)
          t.legal = { via, question, answer: String(kr.answer || '').trim().slice(0, 20_000), verdict: verdictOf(kr.answer), sources: (kr.sources || []).slice(0, 12).map((x) => ({ title: x.title, url: x.url })), sig, at: Date.now() }
        } else if (via === 'web') {
          const wr = await limit(() => reserved(Math.ceil(question.length / 2.5) + 14_000, 5000, () => deps.answerEasyLegal(ctx, { question, ris: true, maxSearches: 3 })))
          t.legal = { via, question, answer: String(wr.answer || '').trim().slice(0, 12_000), verdict: verdictOf(wr.answer), sources: (wr.sources || []).slice(0, 8), sig, at: Date.now() }
        } else {
          const r = await ask({ model: deps.modelMain, effort: 'low', maxOut: 3000, instructions: 'Du bist österreichischer Transaktionsanwalt. Beantworte die Rechtsfrage aus gesichertem Wissen nach österreichischem Recht, knapp, mit Rechtsgrundlage. Keine erfundenen Fundstellen. Antworte als JSON nach Schema.', input: [{ role: 'user', content: question }] }, 'dd_legal_easy', LEGAL_EASY_SCHEMA)
          t.legal = { via, question, answer: `**${r.verdict}** – ${r.answer}`, verdict: r.verdict, sources: [], norms: r.norms || [], sig, at: Date.now() }
          for (const n of r.norms || []) if (!t.norms.includes(n)) t.norms.push(n)
        }
        applyVerdict(t)
      } catch (e) { if (isHalt(e)) { if (isBudget(e)) halt ||= ['paused', limitMsg]; return } t.legal = { via: 'error', question, answer: '', error: String(e?.message || e).slice(0, 200), sig: '', at: Date.now() } }
      matter.job.progress.done++
      await saveSoon()
    }))
    if (halt) return stop(halt[0], halt[1])
    linkDocuments(matter)
    const redLive = matter.themes.filter((t) => liveTheme(t) && effectiveGrade(t) === 'red')
    const by = (v) => toCheck.filter((t) => t.legal?.via === v).length
    log(`Rechtsprüfung: ${by('intern')} leicht (internes Wissen), ${by('web')} schwer (Websuche RIS), ${by('aissociate')} sehr schwer (AI:ssociate) · ${matter.themes.filter((t) => t.discarded?.by === 'Rechtsprüfung').length} als nicht zutreffend verworfen · ${redLive.length} rot`)
    if (redLive.length > DD_RED_WARN) log(`Hinweis: ${redLive.length} rote Themen (mehr als ${DD_RED_WARN}) – bitte im Review prüfen, ob alle wirklich deal-relevant sind.`)
    await endStage('legal')

    // ---- 7 summaries from the issues ----
    const live = matter.themes.filter(liveTheme)
    const areas = s.areas.filter((k) => live.some((t) => t.area === k) || matter.documents.some((d) => d.area === k && d.status === 'analysed'))
    beginStage('summary', areas.length + 1)
    matter.areaSummaries = {}
    await Promise.all(areas.map(async (key) => {
      const a = DD_AREAS.find((x) => x.key === key)
      const ts = live.filter((t) => t.area === key).sort((x, y) => GRADE_RANK[effectiveGrade(x)] - GRADE_RANK[effectiveGrade(y)])
      const docs = matter.documents.filter((d) => d.area === key && d.status === 'analysed')
      try {
        const sy = await ask({
          model: deps.modelMain, effort: deps.effort, maxOut: 6000,
          instructions: `Du bist österreichischer Transaktionsanwalt und Steuerberater. Fasse den Prüfbereich „${a.label}“ einer Due Diligence (${dealLine(s)}) aus den gelieferten THEMEN zusammen – nichts erfinden. Erwartete Dokumente: ${a.documents}. requests: höchstens 6 priorisierte, gebündelte Nachfragen (aus den Nachfragen der Themen); missing_documents: höchstens 4 wirklich fehlende Standarddokumente (was laut Dokumentliste vorliegt, fehlt nicht); cross_document_issues aus den Widersprüchen; Empfehlungen als Garantien, Freistellungen, Conditions Precedent oder Kaufpreismechanismen. Antworte als JSON nach Schema.`,
          input: [{ role: 'user', content: `THEMEN (${ts.length}):\n${ts.map((t) => `- ${t.no} [${effectiveGrade(t)}] ${t.title} · ${t.instrument}: ${String(t.description || '').slice(0, 400)}${t.requests?.length ? ` | Nachfragen: ${t.requests.join('; ')}` : ''}${t.review?.note ? ` | Reviewer: ${t.review.note.slice(0, 200)}` : ''}`).join('\n') || '(keine)'}\n\nDOKUMENTE IM BEREICH (${docs.length}):\n${docs.map((d) => `- ${d.no} ${d.title || d.name} (${d.docType}, ${d.role})`).join('\n').slice(0, 12_000) || '(keine)'}\n\nWIDERSPRÜCHE IM AKTMODELL:\n${model.contradictions.slice(0, 12).map((c) => `- ${c.subject} ${c.attribute}: ${c.values.map((v) => `${v.value} (${v.docNo})`).join(' vs. ')}`).join('\n') || '(keine)'}` }],
        }, 'dd_area', AREA_SYNTHESIS_SCHEMA)
        sy.requests = (sy.requests || []).slice(0, 6); sy.missing_documents = (sy.missing_documents || []).slice(0, 4)
        matter.areaSummaries[key] = { ...sy, label: a.label, documents: docs.length, findings: ts.length, themes: ts.length }
      } catch (e) { if (isHalt(e)) return; matter.areaSummaries[key] = { summary: 'Zusammenfassung fehlgeschlagen.', key_risks: [], cross_document_issues: [], missing_documents: [], requests: [], deal_recommendations: [], label: a.label, documents: docs.length, findings: ts.length, themes: ts.length } }
      matter.job.progress.done++
      log(`Bereich zusammengefasst: ${a.label}`)
    }))
    if (halt) return stop(halt[0], halt[1])
    {
      const kf = keyFigures(model)
      const redT = live.filter((t) => effectiveGrade(t) === 'red'), keyAmber = live.filter((t) => effectiveGrade(t) === 'amber' && ['CP', 'Kaufpreis'].includes(t.review?.instrument || t.instrument))
      const overall = overallAssessment(matter.themes)
      try {
        const ex = await ask({
          model: deps.modelMain, effort: deps.effort, maxOut: 5000,
          instructions: `Du bist österreichischer Transaktionsanwalt und Steuerberater und schreibst das Executive Summary eines Red-Flag-Berichts (${dealLine(s)}). Mandantentauglich, präzise, keine Floskeln, nur aus den gelieferten Themen und Kennzahlen. Die Gesamteinschätzung steht fest: „${overall}“ – begründe sie, ändere sie nicht. Antworte als JSON nach Schema.`,
          input: [{ role: 'user', content: `ROTE THEMEN:\n${redT.map((t) => `- ${t.no} ${areaLabel(t.area)}: ${t.title} · ${t.review?.instrument || t.instrument} – ${String(t.description || '').slice(0, 300)}`).join('\n') || '(keine)'}\n\nGELBE THEMEN MIT CP/KAUFPREIS:\n${keyAmber.map((t) => `- ${t.no} ${t.title} · ${t.review?.instrument || t.instrument}`).join('\n') || '(keine)'}\n\nKENNZAHLEN:\n${Object.entries(kf).map(([k, e]) => `- ${k}: ${e.amount != null ? e.amount.toLocaleString('de-DE') : e.value} (${e.validFrom || ''})`).join('\n') || '(keine im Akt)'}` }],
        }, 'dd_exec', EXEC_SUMMARY_SCHEMA)
        matter.executive = { ...ex, overall_assessment: overall, keyFigures: Object.fromEntries(Object.entries(kf).map(([k, e]) => [k, { value: e.amount ?? e.value, date: e.validFrom, docNo: e.evidence?.[0]?.docNo || '' }])) }
      } catch (e) { if (isHalt(e)) return stop(halt?.[0] || 'paused', halt?.[1] || limitMsg); matter.executive = { executive_summary: 'Executive Summary fehlgeschlagen.', top_red_flags: [], next_steps: [], overall_assessment: overall } }
      matter.job.progress.done++
      log(`Executive Summary erstellt · Gesamteinschätzung (nach Regeln): ${overall}`)
    }
    await endStage('summary')

    // ---- 8 norms against the RIS ----
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
      await endStage('verify')
    }

    // ---- 9 report ----
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
