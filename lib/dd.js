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
import { DD_AREAS, DD_AREA_KEYS, DOC_ANALYSIS_SCHEMA, AREA_SYNTHESIS_SCHEMA, EXEC_SUMMARY_SCHEMA, SEVERITIES } from './ddconfig.js'
import { buildDdDocx, buildDdXlsx, buildTableXlsx } from './report.js'
import { JsonStore } from './store.js'

const CHUNK_CHARS = 45_000
const CHUNK_OVERLAP = 1_500
const MAX_CHUNKS_PER_DOC = 14
const SEV_RANK = { red: 0, amber: 1, green: 2, info: 3 }

export function newMatter({ ownerKey, name, kind = 'matter', client = '', settings = {} }) {
  const s = {
    transaction: settings.transaction === 'asset' ? 'asset' : 'share',
    perspective: settings.perspective === 'seller' ? 'seller' : 'buyer',
    areas: Array.isArray(settings.areas) && settings.areas.length ? settings.areas.filter((a) => DD_AREA_KEYS.includes(a)) : DD_AREA_KEYS.slice(),
    materialityEur: Number(settings.materialityEur) > 0 ? Number(settings.materialityEur) : 50_000,
    target: String(settings.target || '').slice(0, 200),
    budgetTokens: Number(settings.budgetTokens) > 0 ? Number(settings.budgetTokens) : 8_000_000,
    language: 'de',
  }
  return {
    id: JsonStore.newId('m'), ownerKey, name: String(name || 'Neue Akte').slice(0, 120), kind: kind === 'dd' ? 'dd' : 'matter', client: String(client || '').slice(0, 120),
    createdAt: Date.now(), updatedAt: Date.now(), settings: s,
    documents: [], findings: [], areaSummaries: {}, executive: null, verification: null, reports: [], tables: [], conversations: [],
    job: { status: 'idle', stage: null, progress: { done: 0, total: 0 }, usage: newUsage(), startedAt: null, finishedAt: null, error: null, pauseRequested: false, log: [], jobId: null, cost: null },
  }
}

function newUsage() { return { byModel: {}, inTok: 0, outTok: 0, cachedTok: 0, webSearchCalls: 0, aissociateCalls: 0, calls: 0 } }

/** Model-call context of a matter: usage accumulates over every run; the budget is the matter's own. */
function matterCtx(matter) {
  const u = (matter.job.usage ||= newUsage())
  for (const [k, v] of Object.entries(newUsage())) if (u[k] == null) u[k] = v
  return { usage: u, limits: { inMax: matter.settings.budgetTokens, outMax: Infinity } }
}

export function newDocument({ name, size, source = 'upload', ms = null }) {
  return { id: JsonStore.newId('d'), name: String(name).slice(0, 200), size: Number(size) || 0, source, ms, file: null, status: 'new', note: '', textChars: 0, pages: null, chunks: 0, truncated: false, docType: '', area: '', title: '', summary: '', parties: [], dates: [], keyTerms: [], missing: [], questions: [], flags: { red: 0, amber: 0, green: 0, info: 0 }, addedAt: Date.now(), analysedAt: null }
}

const areaLabel = (k) => DD_AREAS.find((a) => a.key === k)?.label || (k === 'none' ? 'Allgemein' : k)
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zäöüß0-9]+/g, ' ').trim()

function docInstructions(matter) {
  const s = matter.settings
  const areas = DD_AREAS.filter((a) => s.areas.includes(a.key))
  return `Du bist ein erfahrener österreichischer Transaktionsanwalt und Steuerberater und führst eine ${s.transaction === 'asset' ? 'Asset-Deal' : 'Share-Deal'}-Due-Diligence aus Sicht des ${s.perspective === 'seller' ? 'Verkäufers (Vendor DD)' : 'Käufers'} durch${s.target ? ` (Zielunternehmen: ${s.target})` : ''}. Du analysierst EIN Dokument aus dem Datenraum und antwortest ausschließlich als JSON nach dem vorgegebenen Schema.

PRÜFBEREICHE UND TYPISCHE RED FLAGS
${areas.map((a) => `- ${a.key} (${a.label}): Dokumente: ${a.documents}. Red Flags: ${a.redFlags}`).join('\n')}

REGELN
- Klassifiziere Dokumenttyp und Prüfbereich. Fasse Gegenstand, Parteien und Kernregelungen zusammen; extrahiere Daten (Abschluss, Laufzeit, Fristen) und Key Terms.
- Befunde nur, wenn sie im Dokument belegt sind: jeder Befund mit wörtlichem Zitat (max. 300 Zeichen) und Fundstelle (Punkt/§/Seite). Keine generischen Befunde ("Vertrag sollte geprüft werden").
- Schweregrad: red = deal-relevant (Kaufpreis, Condition Precedent, möglicher Abbruch; z. B. Change of Control bei einem wesentlichen Vertrag, ungesicherte Haftung, laufendes Großverfahren), amber = wesentlich, aber durch Garantie/Freistellung/Nachverhandlung lösbar, green = unkritisch, aber dokumentationswürdig, info = reiner Hinweis. Wesentlichkeitsschwelle: ${s.materialityEur.toLocaleString('de-AT')} EUR; Beträge darunter sind höchstens green/info, außer sie betreffen Strukturfragen (Eigentum, Genehmigungen, Haftung).
- Rechtliche Einordnung nach österreichischem Recht mit konkreten Normen (z. B. § 38 UGB, § 14 BAO, § 1409 ABGB, § 36 AngG, AVRAG, § 30 MRG, § 8 KStG, § 1 GrEStG); keine Normen erfinden; Unsicheres als Nachfrage formulieren.
- Fehlende Anlagen, unleserliche Stellen und Verweise auf nicht vorliegende Dokumente in missing_or_unclear; konkrete Nachfragen in questions.
- Sprache: Deutsch, präzise, Kanzleistil.`
}

/** Merge chunk analyses of one document into one result. */
function mergeChunkResults(parts) {
  const first = parts[0]
  const out = { ...first, parties: [], dates: [], key_terms: [], findings: [], missing_or_unclear: [], questions: [] }
  const seen = { parties: new Set(), dates: new Set(), terms: new Set(), findings: new Set(), missing: new Set(), questions: new Set() }
  for (const p of parts) {
    for (const x of p.parties || []) { const k = norm(x); if (k && !seen.parties.has(k)) { seen.parties.add(k); out.parties.push(x) } }
    for (const d of p.dates || []) { const k = norm(d.label + d.date); if (k && !seen.dates.has(k)) { seen.dates.add(k); out.dates.push(d) } }
    for (const t of p.key_terms || []) { const k = norm(t.term); if (k && !seen.terms.has(k)) { seen.terms.add(k); out.key_terms.push(t) } }
    for (const f of p.findings || []) { const k = norm(f.title).slice(0, 60); if (k && !seen.findings.has(k)) { seen.findings.add(k); out.findings.push(f) } }
    for (const m of p.missing_or_unclear || []) { const k = norm(m); if (k && !seen.missing.has(k)) { seen.missing.add(k); out.missing_or_unclear.push(m) } }
    for (const q of p.questions || []) { const k = norm(q); if (k && !seen.questions.has(k)) { seen.questions.add(k); out.questions.push(q) } }
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
  for (const d of docs) {
    if (matter.job.pauseRequested) return 'paused'
    try {
      const buf = d.file ? await store.getFile(matter.id, d.file) : null
      if (!buf) throw new Error('Datei nicht gefunden')
      const r = await deps.extractText(d.name, buf)
      d.textChars = r.text.length; d.pages = r.pages ?? null
      if (r.unsupported) { d.status = 'error'; d.note = 'Dateityp nicht lesbar' }
      else if (!r.text.trim()) { d.status = 'error'; d.note = 'Kein Text extrahierbar (gescannt? OCR nötig)' }
      else { await store.putText(matter.id, d.id, r.text); d.status = 'extracted'; d.note = '' }
    } catch (e) { d.status = 'error'; d.note = String(e?.message || e).slice(0, 200) }
    if (matter.job.progress) matter.job.progress.done++
    log(`Text extrahiert: ${d.name}${d.note ? ' · ' + d.note : ''}`)
    await store.saveMatter(matter)
  }
  return 'done'
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
  const overBudget = () => ctx.usage.inTok >= matter.settings.budgetTokens
  const stop = async (status, reason) => { matter.job.status = status; matter.job.error = reason || null; matter.job.pauseRequested = false; matter.job.finishedAt = Date.now(); await save(); send('dd', { matterId: matter.id, stage: matter.job.stage, progress: matter.job.progress, status, message: reason || status }); return matter }

  matter.job.status = 'running'; matter.job.error = null; matter.job.pauseRequested = false; matter.job.startedAt = matter.job.startedAt || Date.now(); matter.job.finishedAt = null
  await save()
  try {
    // ---- extract ----
    matter.job.stage = 'extract'
    const toExtract = matter.documents.filter((d) => d.status === 'new')
    matter.job.progress = { done: 0, total: toExtract.length }
    const r = await extractDocuments(matter, deps, toExtract, log)
    if (r === 'paused') return stop('paused', 'Pausiert')

    // ---- analyse ----
    matter.job.stage = 'analyse'
    const toAnalyse = matter.documents.filter((d) => d.status === 'extracted')
    matter.job.progress = { done: 0, total: toAnalyse.length }
    const instr = docInstructions(matter)
    for (const d of toAnalyse) {
      if (paused()) return stop('paused', 'Pausiert')
      if (overBudget()) return stop('paused', `Token-Budget der Akte erreicht (${(matter.settings.budgetTokens / 1e6).toFixed(1)} Mio.). Budget in den Einstellungen erhöhen und fortsetzen.`)
      const text = await store.getText(matter.id, d.id)
      const { chunks, truncated } = chunkText(text)
      d.chunks = chunks.length; d.truncated = truncated
      const parts = []
      try {
        for (let i = 0; i < chunks.length; i++) {
          const prev = parts.length ? `\n\nBISHERIGE ERKENNTNISSE AUS DEN VORHERIGEN TEILEN (nur NEUE Befunde melden): Dokumenttyp ${parts[0].doc_type}, Bereich ${parts[0].area}, ${parts.reduce((n, p) => n + p.findings.length, 0)} Befunde bisher: ${parts.flatMap((p) => p.findings.map((f) => f.title)).slice(0, 40).join('; ')}` : ''
          const resp = await deps.callModel(ctx, {
            model: deps.modelExtract, instructions: instr, effort: deps.effort, maxOut: 12_000,
            input: [{ role: 'user', content: `DOKUMENT: ${d.name}${chunks.length > 1 ? ` (Teil ${i + 1}/${chunks.length})` : ''}${prev}\n\n=== TEXT ===\n${chunks[i]}` }],
            text: { format: { type: 'json_schema', name: 'dd_document', schema: DOC_ANALYSIS_SCHEMA, strict: true } },
          })
          let parsed = null
          try { parsed = JSON.parse(resp.output_text || '') } catch {}
          if (!parsed) throw new Error('Analyse lieferte kein gültiges JSON' + (resp.status === 'incomplete' ? ' (Ausgabe abgeschnitten)' : ''))
          parts.push(parsed)
        }
        const r = mergeChunkResults(parts)
        d.docType = r.doc_type; d.area = r.area; d.title = r.title; d.summary = r.summary; d.parties = r.parties; d.dates = r.dates; d.keyTerms = r.key_terms; d.missing = r.missing_or_unclear; d.questions = r.questions
        matter.findings = matter.findings.filter((f) => f.docId !== d.id)
        d.flags = { red: 0, amber: 0, green: 0, info: 0 }
        for (const f of r.findings) {
          const sev = SEVERITIES.includes(f.severity) ? f.severity : 'info'
          d.flags[sev]++
          matter.findings.push({ id: JsonStore.newId('f'), docId: d.id, docName: d.name, area: DD_AREA_KEYS.includes(f.area) ? f.area : (DD_AREA_KEYS.includes(d.area) ? d.area : 'none'), severity: sev, title: f.title, description: f.description, quote: f.quote, location: f.location, recommendation: f.recommendation, norms: Array.isArray(f.norms) ? f.norms.slice(0, 8) : [] })
        }
        d.status = 'analysed'; d.analysedAt = Date.now(); d.note = truncated ? `Nur die ersten ${chunks.length} Teile analysiert (Dokument sehr lang)` : ''
      } catch (e) {
        d.status = 'error'; d.note = 'Analyse fehlgeschlagen: ' + String(e?.message || e).slice(0, 200)
      }
      matter.job.progress.done++
      log(`Analysiert: ${d.name} · ${d.flags.red} rot / ${d.flags.amber} gelb${d.note ? ' · ' + d.note : ''}`)
      await save()
    }

    // ---- synthesize per area ----
    matter.job.stage = 'synthesize'
    const areas = matter.settings.areas.filter((k) => matter.findings.some((f) => f.area === k) || matter.documents.some((d) => d.area === k))
    matter.job.progress = { done: 0, total: areas.length }
    for (const key of areas) {
      if (paused()) return stop('paused', 'Pausiert')
      const a = DD_AREAS.find((x) => x.key === key)
      const fs = matter.findings.filter((f) => f.area === key).sort((x, y) => SEV_RANK[x.severity] - SEV_RANK[y.severity])
      const docs = matter.documents.filter((d) => d.area === key)
      const resp = await deps.callModel(ctx, {
        model: deps.modelMain, effort: deps.effort, maxOut: 8000,
        instructions: `Du bist österreichischer Transaktionsanwalt und Steuerberater. Fasse den Prüfbereich „${a.label}“ einer ${matter.settings.transaction === 'asset' ? 'Asset-Deal' : 'Share-Deal'}-Due-Diligence aus Käufer-/Verkäufersicht (${matter.settings.perspective}) zusammen. Erwartete Dokumente: ${a.documents}. Typische Red Flags: ${a.redFlags}. Standard-Nachfragen: ${a.questions}. Antworte als JSON nach Schema; keine Befunde erfinden, nur aus den gelieferten Daten ableiten; fehlende Standarddokumente benennen; Widersprüche zwischen Dokumenten aufzeigen; Empfehlungen als Garantien, Freistellungen, Conditions Precedent oder Kaufpreismechanismen formulieren.`,
        input: [{ role: 'user', content: `DOKUMENTE IM BEREICH (${docs.length}):\n${docs.map((d) => `- ${d.name}: ${d.docType}; ${d.summary.slice(0, 300)}${d.missing.length ? ` | fehlt/unklar: ${d.missing.slice(0, 3).join('; ')}` : ''}`).join('\n') || '(keine)'}\n\nBEFUNDE (${fs.length}):\n${fs.map((f) => `- [${f.severity}] ${f.title} (${f.docName}, ${f.location}): ${f.description.slice(0, 400)} | Empfehlung: ${f.recommendation.slice(0, 200)}`).join('\n') || '(keine)'}\n\nNACHFRAGEN AUS DEN DOKUMENTEN:\n${docs.flatMap((d) => d.questions).slice(0, 40).map((q) => '- ' + q).join('\n') || '(keine)'}` }],
        text: { format: { type: 'json_schema', name: 'dd_area', schema: AREA_SYNTHESIS_SCHEMA, strict: true } },
      })
      try { matter.areaSummaries[key] = { ...JSON.parse(resp.output_text || ''), label: a.label, documents: docs.length, findings: fs.length } } catch { matter.areaSummaries[key] = { summary: 'Zusammenfassung fehlgeschlagen.', key_risks: [], cross_document_issues: [], missing_documents: [], requests: [], deal_recommendations: [], label: a.label, documents: docs.length, findings: fs.length } }
      matter.job.progress.done++
      log(`Bereich zusammengefasst: ${a.label}`)
      await save()
    }

    // ---- executive summary ----
    matter.job.stage = 'summary'
    matter.job.progress = { done: 0, total: 1 }
    {
      const top = matter.findings.filter((f) => f.severity === 'red' || f.severity === 'amber').sort((x, y) => SEV_RANK[x.severity] - SEV_RANK[y.severity]).slice(0, 40)
      const resp = await deps.callModel(ctx, {
        model: deps.modelMain, effort: deps.effort, maxOut: 6000,
        instructions: `Du bist österreichischer Transaktionsanwalt und Steuerberater und schreibst das Executive Summary eines Due-Diligence-Berichts (${matter.settings.transaction === 'asset' ? 'Asset Deal' : 'Share Deal'}, Perspektive ${matter.settings.perspective === 'seller' ? 'Verkäufer' : 'Käufer'}${matter.settings.target ? `, Zielunternehmen ${matter.settings.target}` : ''}). Mandantentauglich, präzise, keine Floskeln, nur aus den gelieferten Befunden. Antworte als JSON nach Schema.`,
        input: [{ role: 'user', content: `BEREICHSZUSAMMENFASSUNGEN:\n${Object.values(matter.areaSummaries).map((s) => `## ${s.label}\n${s.summary}\nRisiken: ${s.key_risks.join('; ')}\nFehlend: ${s.missing_documents.join('; ')}`).join('\n\n') || '(keine)'}\n\nTOP-BEFUNDE:\n${top.map((f) => `- [${f.severity}] ${areaLabel(f.area)}: ${f.title} (${f.docName}) – ${f.recommendation.slice(0, 160)}`).join('\n') || '(keine)'}\n\nSTATISTIK: ${matter.documents.length} Dokumente, davon ${matter.documents.filter((d) => d.status === 'analysed').length} analysiert, ${matter.documents.filter((d) => d.status === 'error').length} nicht lesbar; Befunde: ${matter.findings.filter((f) => f.severity === 'red').length} rot, ${matter.findings.filter((f) => f.severity === 'amber').length} gelb.` }],
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
  let done = 0
  for (const d of docs) {
    if (matter.job.pauseRequested) break
    const text = (await store.getText(matter.id, d.id)).slice(0, CHUNK_CHARS * 2)
    try {
      const resp = await deps.callModel(ctx, {
        model: deps.modelExtract, effort: deps.effort, maxOut: 6000,
        instructions: `Du extrahierst für eine juristische Übersichtstabelle (österreichische Kanzlei) aus EINEM Dokument genau die angefragten Spalten. Jede Zelle: kurze Antwort, wörtlicher Beleg, Fundstelle. Nicht Enthaltenes als "–" markieren, nichts erfinden. Antworte als JSON nach Schema. Spalten: ${table.columns.join(' | ')}.`,
        input: [{ role: 'user', content: `DOKUMENT: ${d.name}\n\n=== TEXT ===\n${text}` }],
        text: { format: { type: 'json_schema', name: 'review_row', schema, strict: true } },
      })
      const parsed = JSON.parse(resp.output_text || '{}')
      const cells = {}
      for (const c of parsed.cells || []) cells[c.column] = { value: c.value, quote: c.quote, location: c.location }
      table.rows.push({ docId: d.id, docName: d.name, cells })
    } catch (e) {
      table.rows.push({ docId: d.id, docName: d.name, cells: {}, error: String(e?.message || e).slice(0, 160) })
    }
    done++
    send('table', { matterId: matter.id, tableId: table.id, done, total: docs.length, docName: d.name })
    await store.saveMatter(matter)
  }
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
  lines.push(`AKTE: ${matter.name}${matter.client ? ` (Mandant: ${matter.client})` : ''}${matter.settings?.target ? ` · Zielunternehmen: ${matter.settings.target}` : ''} · ${matter.documents.length} Dokumente, ${matter.findings.length} Befunde`)
  if (matter.executive) lines.push(`\nEXECUTIVE SUMMARY (${matter.executive.overall_assessment}):\n${matter.executive.executive_summary}`)
  for (const s of Object.values(matter.areaSummaries || {})) lines.push(`\n## ${s.label}\n${s.summary}\nRisiken: ${s.key_risks.join('; ')}\nFehlend: ${s.missing_documents.join('; ')}\nNachfragen: ${s.requests.join('; ')}`)
  const fs = [...matter.findings].sort((x, y) => SEV_RANK[x.severity] - SEV_RANK[y.severity])
  lines.push(`\nBEFUNDE:\n${fs.map((f) => `- [${f.severity}] ${areaLabel(f.area)} · ${f.title} (${f.docName}, ${f.location}): ${f.description.slice(0, 300)} | Zitat: "${f.quote.slice(0, 160)}" | Empfehlung: ${f.recommendation.slice(0, 160)}`).join('\n')}`)
  lines.push(`\nDOKUMENTE:\n${matter.documents.map((d) => `- ${d.name} [${d.status}] ${d.docType || ''} ${d.area ? '(' + areaLabel(d.area) + ')' : ''}: ${d.summary.slice(0, 200)}`).join('\n')}`)
  return lines.join('\n').slice(0, maxChars)
}
