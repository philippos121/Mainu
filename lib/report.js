// Explicit report templates for due diligence: Word (Red Flag Report) and
// Excel (findings, documents, request list, areas) plus review-table export.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, ShadingType, ExternalHyperlink, PageBreak } from 'docx'
import ExcelJS from 'exceljs'
import { DD_AREAS, SEVERITY_LABEL, DEAL_IMPACT_LABEL, REVIEW_LABEL } from './ddconfig.js'

const sevOf = (f) => (f.review?.severity && SEV_RANK[f.review.severity] != null ? f.review.severity : f.severity)
const live = (f) => f.review?.status !== 'rejected'
const EVID = { verified: '', partial: ' (Zitat teilweise belegt)', unverified: ' (Zitat nicht belegt)' }

const SEV_RANK = { red: 0, amber: 1, green: 2, info: 3 }
const SEV_COLOR = { red: 'F8D7DA', amber: 'FFF3CD', green: 'D1E7DD', info: 'E2E3E5' }
const SEV_DE = { red: 'Rot', amber: 'Gelb', green: 'Grün', info: 'Hinweis' }
const TEAL = '0E5C69'
const areaLabel = (k) => DD_AREAS.find((a) => a.key === k)?.label || (k === 'none' ? 'Allgemein' : k)
const fmtDate = (ts) => new Date(ts || Date.now()).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })

const p = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 120 } })
const h1 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 } })
const h2 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } })
const h3 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 } })
const bullet = (text) => new Paragraph({ children: [new TextRun(text)], bullet: { level: 0 }, spacing: { after: 60 } })
const cell = (text, { bold = false, shade = null, width = null } = {}) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), bold, size: 18 })] })], ...(shade ? { shading: { type: ShadingType.CLEAR, fill: shade, color: 'auto' } } : {}), ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}) })
const table = (header, rows, widths = null) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, { bold: true, shade: 'E8EEF0', width: widths?.[i] })) }), ...rows.map((r) => new TableRow({ children: r.map((c, i) => (typeof c === 'object' && c !== null && 'text' in c ? cell(c.text, { shade: c.shade, width: widths?.[i] }) : cell(c, { width: widths?.[i] }))) }))] })

function requestCount(matter) {
  const seen = new Set(); let n = 0
  const add = (t) => { const k = String(t).toLowerCase().slice(0, 80); if (k && !seen.has(k)) { seen.add(k); n++ } }
  for (const as of Object.values(matter.areaSummaries || {})) { (as.requests || []).slice(0, 6).forEach(add); (as.missing_documents || []).slice(0, 4).forEach((m) => add('Dokument nachreichen: ' + m)) }
  return n
}

export async function buildDdDocx(matter) {
  const s = matter.settings
  const ex = matter.executive || {}
  const findings = matter.findings.filter(live).sort((a, b) => SEV_RANK[sevOf(a)] - SEV_RANK[sevOf(b)] || a.area.localeCompare(b.area))
  const rejected = matter.findings.filter((f) => !live(f))
  const red = findings.filter((f) => sevOf(f) === 'red'), amber = findings.filter((f) => sevOf(f) === 'amber')
  const openReview = findings.filter((f) => ['red', 'amber'].includes(sevOf(f)) && (f.review?.status || 'open') === 'open').length
  const analysed = matter.documents.filter((d) => d.status === 'analysed'), unreadable = matter.documents.filter((d) => d.status === 'error')
  const children = []

  // Title page
  children.push(new Paragraph({ children: [new TextRun({ text: 'Due Diligence – Red Flag Report', bold: true, size: 48, color: TEAL })], spacing: { before: 2400, after: 240 } }))
  children.push(new Paragraph({ children: [new TextRun({ text: matter.name, size: 32 })], spacing: { after: 120 } }))
  if (s.reference) children.push(p(`Aktenzeichen: ${s.reference}`, { size: 24 }))
  if (s.target) children.push(p(`Zielunternehmen: ${s.target}`, { size: 24 }))
  if (matter.client) children.push(p(`Mandant: ${matter.client}`, { size: 24 }))
  children.push(p(`${s.transaction === 'asset' ? 'Asset Deal' : 'Share Deal'} · Perspektive ${s.perspective === 'seller' ? 'Verkäufer' : 'Käufer'} · Wesentlichkeitsschwelle ${s.materialityEur.toLocaleString('de-AT')} EUR`, { size: 22 }))
  children.push(p(`Stand: ${fmtDate()} · ${matter.documents.length} Dokumente, ${analysed.length} analysiert · ${red.length} rote und ${amber.length} gelbe Befunde`, { size: 22 }))
  children.push(new Paragraph({ children: [new TextRun({ text: openReview ? `ENTWURF – ${openReview} rote/gelbe Befunde noch ohne Freigabe. KI-gestützt erstellt mit AI:ssociate; alle Befunde sind vor Verwendung durch einen Rechtsanwalt bzw. Steuerberater zu prüfen.` : 'KI-gestützt erstellt mit AI:ssociate; alle roten und gelben Befunde wurden im Review freigegeben. Vor Verwendung durch einen Rechtsanwalt bzw. Steuerberater zu prüfen.', italics: true, size: 20, color: '8A98A0' })], spacing: { before: 480 } }))
  children.push(new Paragraph({ children: [new PageBreak()] }))

  // 1 Executive Summary
  children.push(h1('1. Executive Summary'))
  if (ex.overall_assessment) children.push(p(`Gesamteinschätzung: ${ex.overall_assessment}`, { bold: true }))
  for (const para of String(ex.executive_summary || 'Kein Executive Summary vorhanden.').split(/\n{2,}/)) children.push(p(para.replace(/^#+\s*/, '')))
  if (ex.top_red_flags?.length) { children.push(h2('Wichtigste Red Flags')); ex.top_red_flags.forEach((t) => children.push(bullet(t))) }
  if (ex.next_steps?.length) { children.push(h2('Nächste Schritte')); ex.next_steps.forEach((t) => children.push(bullet(t))) }
  children.push(h2('Kennzahlen'))
  children.push(table(['Dokumente', 'analysiert', 'nicht lesbar', 'rot', 'gelb', 'grün', 'Nachfragen', 'Review offen (rot/gelb)'], [[String(matter.documents.length), String(analysed.length), String(unreadable.length), String(red.length), String(amber.length), String(findings.filter((f) => sevOf(f) === 'green').length), String(requestCount(matter)), String(openReview)]]))

  // 2 Transaction recommendations by instrument
  children.push(h1('2. Transaktionsrelevante Empfehlungen'))
  const byImpact = {}
  for (const f of [...red, ...amber]) if (f.dealImpact && f.dealImpact !== 'keine') (byImpact[f.dealImpact] ||= []).push(f)
  const impRows = Object.entries(byImpact).map(([k, fs]) => [DEAL_IMPACT_LABEL[k] || k, fs.map((f) => `${f.no || ''} ${f.title}`).join('; '), fs.map((f) => f.recommendation).filter(Boolean).slice(0, 3).join(' · ')])
  children.push(impRows.length ? table(['Instrument', 'Befunde', 'Empfehlung'], impRows, [20, 35, 45]) : p('Keine Befunde mit Transaktionsbezug.'))

  // 3 Red Flags
  children.push(h1('3. Red Flags und wesentliche Befunde'))
  const topRows = [...red, ...amber].map((f) => [f.no || '', areaLabel(f.area), f.title, { text: SEV_DE[sevOf(f)], shade: SEV_COLOR[sevOf(f)] }, `${f.docNo ? f.docNo + ' ' : ''}${f.docName}${f.location ? ' – ' + f.location : ''}${EVID[f.evidence] || ''}`, DEAL_IMPACT_LABEL[f.dealImpact] || '–', REVIEW_LABEL[f.review?.status || 'open']])
  children.push(topRows.length ? table(['ID', 'Bereich', 'Befund', 'Grad', 'Dokument / Fundstelle', 'Deal-Impact', 'Review'], topRows, [7, 13, 28, 8, 22, 12, 10]) : p('Keine roten oder gelben Befunde.'))

  // 4 Findings per area
  children.push(h1('4. Befunde nach Prüfbereich'))
  const areaKeys = [...new Set([...Object.keys(matter.areaSummaries || {}), ...findings.map((f) => f.area)])].filter((k) => k)
  for (const key of areaKeys) {
    const as = matter.areaSummaries?.[key]
    const fs = findings.filter((f) => f.area === key)
    children.push(h2(areaLabel(key)))
    if (as) {
      children.push(p(as.summary))
      if (as.key_risks?.length) { children.push(h3('Wesentliche Risiken')); as.key_risks.forEach((t) => children.push(bullet(t))) }
      if (as.cross_document_issues?.length) { children.push(h3('Dokumentübergreifende Auffälligkeiten')); as.cross_document_issues.forEach((t) => children.push(bullet(t))) }
      if (as.deal_recommendations?.length) { children.push(h3('Empfehlungen für die Transaktionsdokumentation')); as.deal_recommendations.forEach((t) => children.push(bullet(t))) }
      if (as.missing_documents?.length) { children.push(h3('Fehlende Dokumente')); as.missing_documents.forEach((t) => children.push(bullet(t))) }
      if (as.legal?.answer) {
        children.push(h3(as.legal.via === 'web' ? 'Rechtliche Einordnung je Dokument (Websuche)' : 'Rechtliche Einordnung je Dokument (AI:ssociate-Wissensdatenbank, einfache Fragen per Websuche)'))
        for (const para of String(as.legal.answer).split(/\n{2,}/).slice(0, 40)) { const t = para.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim(); if (t) children.push(p(t)) }
        if (as.legal.sources?.length) { const runs = [new TextRun({ text: 'Herangezogene Dokumente: ', size: 18, color: '566A73' })]; as.legal.sources.slice(0, 12).forEach((src, i) => { if (src.url) runs.push(new ExternalHyperlink({ children: [new TextRun({ text: src.title || src.url, size: 18, style: 'Hyperlink', color: '0E7C8A', underline: {} })], link: src.url })); else runs.push(new TextRun({ text: src.title || '', size: 18 })); if (i < Math.min(12, as.legal.sources.length) - 1) runs.push(new TextRun({ text: '; ', size: 18 })) }); children.push(new Paragraph({ children: runs, spacing: { after: 120 } })) }
      }
    }
    if (fs.length) {
      children.push(h3(`Einzelbefunde (${fs.length})`))
      for (const f of fs) {
        const sv = sevOf(f)
        children.push(new Paragraph({ children: [new TextRun({ text: `${f.no ? f.no + ' · ' : ''}${SEV_DE[sv]}: `, bold: true, color: sv === 'red' ? 'B42318' : sv === 'amber' ? '9A6700' : '3B6D11' }), new TextRun({ text: f.title, bold: true })], spacing: { before: 160, after: 60 } }))
        children.push(p(`Dokument: ${f.docNo ? f.docNo + ' ' : ''}${f.docName}${f.location ? ' · Fundstelle: ' + f.location : ''}${f.rule ? ' · Regel ' + f.rule : ''}${f.source === 'manual' ? ' · manuell erfasst' : ''} · Review: ${REVIEW_LABEL[f.review?.status || 'open']}${f.review?.severity && f.review.severity !== f.severity ? ` (Grad geändert von ${SEV_DE[f.severity]})` : ''}`, { size: 18, color: '566A73' }))
        children.push(p(f.description))
        if (f.quote) children.push(new Paragraph({ children: [new TextRun({ text: `„${f.quote}“`, italics: true }), new TextRun({ text: EVID[f.evidence] || '', size: 18, color: f.evidence === 'unverified' ? 'B42318' : '566A73' })], indent: { left: 540 }, spacing: { after: 80 } }))
        children.push(p(`Empfehlung: ${f.recommendation}${f.dealImpact && f.dealImpact !== 'keine' ? ` (${DEAL_IMPACT_LABEL[f.dealImpact]})` : ''}`))
        if (f.review?.note) children.push(p(`Reviewer-Vermerk: ${f.review.note}`, { size: 18, color: '566A73' }))
        if (f.norms?.length) {
          const runs = [new TextRun({ text: 'Normen: ', size: 18, color: '566A73' })]
          f.norms.forEach((n, i) => { const st = f.normStatus?.find((x) => x.norm === n); const label = `${n}${st ? (st.status === 'ok' ? ' ✓' : st.status === 'not_found' ? ' (im RIS nicht gefunden)' : st.status === 'expired' ? ' (außer Kraft)' : st.status === 'unsure' ? ' (?)' : '') : ''}`; if (st?.url) runs.push(new ExternalHyperlink({ children: [new TextRun({ text: label, size: 18, style: 'Hyperlink', color: '0E7C8A', underline: {} })], link: st.url })); else runs.push(new TextRun({ text: label, size: 18 })); if (i < f.norms.length - 1) runs.push(new TextRun({ text: '; ', size: 18 })) })
          children.push(new Paragraph({ children: runs, spacing: { after: 120 } }))
        }
      }
    }
  }

  // 5 Document index
  children.push(h1('5. Dokumentenindex'))
  children.push(table(['ID', 'Dokument', 'Typ', 'Bereich', 'Status', 'Rot/Gelb'], matter.documents.map((d, i) => [d.no || String(i + 1), d.name, d.docType || '–', d.area ? areaLabel(d.area) : '–', d.status === 'analysed' ? 'analysiert' : d.status === 'error' ? `nicht lesbar: ${d.note}` : d.status, `${d.flags?.red || 0} / ${d.flags?.amber || 0}`]), [6, 34, 18, 18, 14, 10]))

  // 6 Request list
  children.push(h1('6. Offene Fragen und Nachforderungen (Request List)'))
  const requests = []
  for (const key of areaKeys) { const as = matter.areaSummaries?.[key]; for (const r of (as?.requests || []).slice(0, 6)) requests.push([areaLabel(key), r, '']); for (const m of (as?.missing_documents || []).slice(0, 4)) requests.push([areaLabel(key), `Dokument nachreichen: ${m}`, '']) }
  const seen = new Set(); const uniq = requests.filter((r) => { const k = r[1].toLowerCase().slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true })
  children.push(uniq.length ? table(['Bereich', 'Frage / Nachforderung', 'Bezug'], uniq.map((r) => r), [20, 55, 25]) : p('Keine offenen Fragen.'))

  // 7 Method
  children.push(h1('7. Methodik und Einschränkungen'))
  const kbAreas = Object.values(matter.areaSummaries || {}).filter((a) => a.legal?.answer).length
  children.push(p(`Die Dokumente wurden mit AI:ssociate automatisiert gelesen, klassifiziert und nach einem festen Prüfschema (Bereiche: ${s.areas.map(areaLabel).join(', ')}) ausgewertet. Jeder Befund enthält ein wörtliches Zitat und eine Fundstelle; jedes Zitat wurde maschinell im Dokumenttext gesucht (${findings.filter((f) => f.evidence === 'verified').length} belegt, ${findings.filter((f) => f.evidence === 'partial').length} teilweise, ${findings.filter((f) => f.evidence === 'unverified').length} nicht gefunden). ${kbAreas ? `Rechtsfragen aus den Befunden wurden je Dokument geklärt: schwierige durch die juristische Wissensdatenbank AI:ssociate (${matter.documents.filter((d) => d.legal?.via === 'aissociate').length} Dokumente), einfache mit einer kurzen Websuche (${matter.documents.filter((d) => d.legal?.via === 'web').length}); die Einordnung ist je Bereich wiedergegeben. ` : ''}Zitierte Normen wurden gegen das Rechtsinformationssystem des Bundes (RIS) geprüft${matter.verification ? ` (${matter.verification.summary.ok} von ${matter.verification.summary.checked} bestätigt)` : ''}.${rejected.length ? ` ${rejected.length} Befund${rejected.length > 1 ? 'e wurden' : ' wurde'} im Review verworfen und ${rejected.length > 1 ? 'sind' : 'ist'} nicht enthalten.` : ''}`))
  if (unreadable.length) children.push(p(`Nicht auswertbar (${unreadable.length}): ${unreadable.map((d) => `${d.name} (${d.note})`).join('; ')}. Diese Dokumente sind manuell zu prüfen oder per OCR nachzuliefern.`))
  const trunc = matter.documents.filter((d) => d.truncated)
  if (trunc.length) children.push(p(`Sehr lange Dokumente wurden nur in den ersten Teilen analysiert: ${trunc.map((d) => d.name).join(', ')}.`))
  children.push(p(`Dieser Bericht ist ein KI-generierter Entwurf und ersetzt keine anwaltliche oder steuerliche Prüfung. Umfang der Auswertung: ${matter.job?.usage?.inTok ? Math.round(matter.job.usage.inTok / 1000) + 'k Eingabe-Tokens' : 'n/a'}.`, { size: 18, color: '566A73' }))

  const doc = new Document({ creator: 'AI:ssociate', title: `Red Flag Report – ${matter.name}`, styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } }, sections: [{ children }] })
  return Packer.toBuffer(doc)
}

export async function buildDdXlsx(matter) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AI:ssociate'
  const f = wb.addWorksheet('Befunde')
  f.columns = [{ header: 'ID', key: 'n', width: 8 }, { header: 'Grad', key: 'sev', width: 9 }, { header: 'Review', key: 'rev', width: 12 }, { header: 'Bereich', key: 'area', width: 26 }, { header: 'Befund', key: 'title', width: 40 }, { header: 'Beschreibung', key: 'desc', width: 70 }, { header: 'Dokument', key: 'doc', width: 32 }, { header: 'Fundstelle', key: 'loc', width: 18 }, { header: 'Zitat', key: 'quote', width: 60 }, { header: 'Zitat belegt', key: 'ev', width: 12 }, { header: 'Deal-Impact', key: 'imp', width: 18 }, { header: 'Empfehlung', key: 'rec', width: 50 }, { header: 'Regel', key: 'rule', width: 10 }, { header: 'Normen', key: 'norms', width: 28 }, { header: 'RIS-Prüfung', key: 'ris', width: 22 }, { header: 'Reviewer-Vermerk', key: 'note', width: 40 }]
  const sorted = [...matter.findings].sort((a, b) => (live(b) - live(a)) || SEV_RANK[sevOf(a)] - SEV_RANK[sevOf(b)])
  sorted.forEach((x, i) => { const sv = sevOf(x); const row = f.addRow({ n: x.no || i + 1, sev: SEV_DE[sv], rev: REVIEW_LABEL[x.review?.status || 'open'], area: areaLabel(x.area), title: x.title, desc: x.description, doc: `${x.docNo ? x.docNo + ' ' : ''}${x.docName}`, loc: x.location, quote: x.quote, ev: x.evidence === 'verified' ? 'ja' : x.evidence === 'partial' ? 'teilweise' : 'nein', imp: DEAL_IMPACT_LABEL[x.dealImpact] || '', rec: x.recommendation, rule: x.rule || '', norms: x.norms.join('; '), ris: (x.normStatus || []).map((s) => `${s.norm}: ${s.status}`).join('; '), note: x.review?.note || '' }); row.getCell('sev').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + SEV_COLOR[sv] } }; if (!live(x)) row.font = { strike: true, color: { argb: 'FF8A98A0' } } })
  f.getRow(1).font = { bold: true }; f.views = [{ state: 'frozen', ySplit: 1 }]; f.autoFilter = { from: 'A1', to: 'P1' }
  const d = wb.addWorksheet('Dokumente')
  d.columns = [{ header: 'ID', key: 'n', width: 8 }, { header: 'Dokument', key: 'name', width: 40 }, { header: 'Typ', key: 'type', width: 24 }, { header: 'Bereich', key: 'area', width: 26 }, { header: 'Status', key: 'status', width: 14 }, { header: 'Hinweis', key: 'note', width: 40 }, { header: 'Parteien', key: 'parties', width: 40 }, { header: 'Rot', key: 'red', width: 6 }, { header: 'Gelb', key: 'amber', width: 6 }, { header: 'Zusammenfassung', key: 'summary', width: 80 }, { header: 'Key Terms', key: 'terms', width: 60 }]
  matter.documents.forEach((x, i) => d.addRow({ n: x.no || i + 1, name: x.name, type: x.docType, area: x.area ? areaLabel(x.area) : '', status: x.status, note: x.note, parties: (x.parties || []).join('; '), red: x.flags?.red || 0, amber: x.flags?.amber || 0, summary: x.summary, terms: (x.keyTerms || []).map((t) => `${t.term}: ${t.value}`).join(' | ') }))
  d.getRow(1).font = { bold: true }; d.views = [{ state: 'frozen', ySplit: 1 }]
  const q = wb.addWorksheet('Nachfragen')
  q.columns = [{ header: 'Bereich', key: 'area', width: 26 }, { header: 'Frage / Nachforderung', key: 'q', width: 90 }, { header: 'Bezug', key: 'ref', width: 36 }, { header: 'Status', key: 'st', width: 12 }]
  for (const [key, as] of Object.entries(matter.areaSummaries || {})) { for (const r of (as.requests || []).slice(0, 6)) q.addRow({ area: as.label, q: r, ref: '', st: 'offen' }); for (const m of as.missing_documents || []) q.addRow({ area: as.label, q: `Dokument nachreichen: ${m}`, ref: '', st: 'offen' }) }
  q.getRow(1).font = { bold: true }
  const a = wb.addWorksheet('Bereiche')
  a.columns = [{ header: 'Bereich', key: 'area', width: 28 }, { header: 'Dokumente', key: 'docs', width: 10 }, { header: 'Befunde', key: 'f', width: 9 }, { header: 'Zusammenfassung', key: 's', width: 90 }, { header: 'Risiken', key: 'r', width: 60 }, { header: 'Empfehlungen', key: 'e', width: 60 }]
  a.columns = [...a.columns, { header: 'Rechtliche Einordnung (AI:ssociate)', key: 'l', width: 100 }]
  for (const as of Object.values(matter.areaSummaries || {})) a.addRow({ area: as.label, docs: as.documents, f: as.findings, s: as.summary, r: (as.key_risks || []).join('; '), e: (as.deal_recommendations || []).join('; '), l: as.legal?.answer ? as.legal.answer.slice(0, 30000) : '' })
  a.getRow(1).font = { bold: true }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export async function buildTableXlsx(matter, t) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(t.name.slice(0, 30) || 'Tabelle')
  ws.columns = [{ header: 'Dokument', key: 'doc', width: 36 }, ...t.columns.flatMap((c, i) => [{ header: c, key: 'c' + i, width: 34 }, { header: `Beleg: ${c}`, key: 'q' + i, width: 40 }])]
  for (const r of t.rows || []) { const row = { doc: r.docName }; t.columns.forEach((c, i) => { row['c' + i] = r.cells?.[c]?.value || (r.error ? 'Fehler: ' + r.error : '–'); row['q' + i] = r.cells?.[c] ? [r.cells[c].quote, r.cells[c].location, r.cells[c].evidence === 'unverified' ? '(nicht im Text gefunden)' : ''].filter(Boolean).join(' · ') : '' }); ws.addRow(row) }
  ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }]
  return Buffer.from(await wb.xlsx.writeBuffer())
}
