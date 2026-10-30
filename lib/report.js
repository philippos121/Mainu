// Explicit report templates for due diligence, built from the THEMES of the Akt:
// - "Red Flag" (default): only red and yellow themes, 15–30 pages, at most 15,000 words;
// - "Vollbericht": additionally green themes and a summary of every document.
// Every piece of evidence names an original document; no theme appears twice; the report is
// marked "Entwurf" until every red and yellow theme has been reviewed.
// Excel: Themen, Befunde, Fakten, Dokumente, Nachfragen, Bereiche, Hinweise.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, ExternalHyperlink, PageBreak } from 'docx'
import ExcelJS from 'exceljs'
import { DD_AREAS, DEAL_IMPACT_LABEL, FACT_TYPES, CLAUSE_KINDS, SKIP_REASONS, KEY_FIGURES, ISSUE_STATUS, DIFFICULTY } from './ddconfig.js'

const SEV_RANK = { red: 0, amber: 1, green: 2, info: 3 }
const SEV_COLOR = { red: 'F8D7DA', amber: 'FFF3CD', green: 'D1E7DD', info: 'E2E3E5' }
const SEV_DE = { red: 'Rot', amber: 'Gelb', green: 'Grün', info: 'Hinweis' }
const REVIEW_DE = { open: 'offen', accepted: 'freigegeben', modified: 'geändert', rejected: 'verworfen' }
const TEAL = '0E5C69'
const MAX_WORDS = 15_000
const THEME_WORDS = 180
const areaLabel = (k) => DD_AREAS.find((a) => a.key === k)?.label || (k === 'none' ? 'Allgemein' : k)
const fmtDate = (ts) => new Date(ts || Date.now()).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
const gradeOf = (t) => t.review?.grade || t.gradeCalibrated || t.gradeComputed
const instrumentOf = (t) => t.review?.instrument || t.instrument
const liveTheme = (t) => !t.discarded && !t.mergedInto && !t.orphaned && t.review?.status !== 'rejected'
const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length
const clipWords = (s, n) => { const w = String(s || '').split(/\s+/).filter(Boolean); return w.length <= n ? w.join(' ') : w.slice(0, n).join(' ') + ' …' }
const num = (v) => (typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : String(v ?? '–'))

const p = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 120 } })
const h1 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 } })
const h2 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } })
const bullet = (text) => new Paragraph({ children: [new TextRun(text)], bullet: { level: 0 }, spacing: { after: 60 } })
const cell = (text, { bold = false, shade = null, width = null } = {}) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), bold, size: 18 })] })], ...(shade ? { shading: { type: ShadingType.CLEAR, fill: shade, color: 'auto' } } : {}), ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}) })
const table = (header, rows, widths = null) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, { bold: true, shade: 'E8EEF0', width: widths?.[i] })) }), ...rows.map((r) => new TableRow({ children: r.map((c, i) => (typeof c === 'object' && c !== null && 'text' in c ? cell(c.text, { shade: c.shade, width: widths?.[i] }) : cell(c, { width: widths?.[i] }))) }))] })

/** The consolidated request list: per area at most 6 requests and 4 missing documents. */
export function requestRows(matter) {
  const seen = new Set(), out = []
  for (const [key, as] of Object.entries(matter.areaSummaries || {})) {
    for (const m of (as.missing_documents || []).slice(0, 4)) out.push({ area: areaLabel(key), kind: 'Dokument', text: m })
    for (const r of (as.requests || []).slice(0, 6)) out.push({ area: areaLabel(key), kind: 'Nachfrage', text: r })
  }
  return out.filter((r) => { const k = r.text.toLowerCase().slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true })
}

/** Evidence of an issue: verbatim passages in original documents (checked against the text). */
function evidenceOf(matter, t) {
  return (t.evidence || []).map((e) => ({ f: e, original: true, label: `${e.docNo} ${e.docName}${e.location ? ', ' + e.location : ''}` }))
}

export async function buildDdDocx(matter) {
  const s = matter.settings
  const full = s.reportType === 'full'
  const ex = matter.executive || {}
  const themes = (matter.themes || []).filter(liveTheme).sort((a, b) => SEV_RANK[gradeOf(a)] - SEV_RANK[gradeOf(b)] || a.no.localeCompare(b.no))
  const shown = themes.filter((t) => full || ['red', 'amber'].includes(gradeOf(t)))
  const red = themes.filter((t) => gradeOf(t) === 'red'), amber = themes.filter((t) => gradeOf(t) === 'amber')
  const openReview = themes.filter((t) => ['red', 'amber'].includes(gradeOf(t)) && (t.review?.status || 'open') === 'open').length
  const inv = matter.inventory || {}
  const children = []
  let wordCount = 0
  const add = (para, text) => { children.push(para); wordCount += words(text) }

  // Title page
  children.push(new Paragraph({ children: [new TextRun({ text: full ? 'Due Diligence – Vollbericht' : 'Due Diligence – Red-Flag-Bericht', bold: true, size: 48, color: TEAL })], spacing: { before: 2400, after: 240 } }))
  children.push(new Paragraph({ children: [new TextRun({ text: matter.name, size: 32 })], spacing: { after: 120 } }))
  if (s.reference) children.push(p(`Aktenzeichen: ${s.reference}`, { size: 24 }))
  if (s.target) children.push(p(`Zielgesellschaft: ${s.target}${s.targetFn ? ` (FN ${s.targetFn})` : ''}`, { size: 24 }))
  if (matter.client) children.push(p(`Mandant: ${matter.client}`, { size: 24 }))
  children.push(p(`${s.transaction === 'asset' ? 'Asset Deal' : 'Share Deal'} · Perspektive ${s.perspective === 'seller' ? 'Verkäufer' : 'Käufer'} · Wesentlichkeitsschwelle ${s.materialityEur.toLocaleString('de-AT')} EUR${s.stichtag ? ` · Stichtag ${s.stichtag}` : ''}`, { size: 22 }))
  children.push(p(`Stand: ${fmtDate()} · ${inv.source ?? matter.documents.length} Dokumente, ${inv.analysed ?? '–'} analysiert · ${red.length} rote und ${amber.length} gelbe Themen`, { size: 22 }))
  children.push(new Paragraph({ children: [new TextRun({ text: openReview ? `ENTWURF – ${openReview} rote/gelbe Themen noch ohne Review. KI-gestützt erstellt mit AI:ssociate; vor Verwendung durch einen Rechtsanwalt bzw. Steuerberater zu prüfen.` : 'Alle roten und gelben Themen wurden im Review bearbeitet. KI-gestützt erstellt mit AI:ssociate; vor Verwendung durch einen Rechtsanwalt bzw. Steuerberater zu prüfen.', italics: true, size: 20, color: openReview ? 'B42318' : '8A98A0' })], spacing: { before: 480 } }))
  children.push(new Paragraph({ children: [new PageBreak()] }))

  // 1 Executive Summary
  children.push(h1('1. Executive Summary'))
  if (ex.overall_assessment) add(p(`Gesamteinschätzung: ${ex.overall_assessment}`, { bold: true }), ex.overall_assessment)
  for (const para of String(ex.executive_summary || 'Kein Executive Summary vorhanden.').split(/\n{2,}/)) { const t = para.replace(/^#+\s*/, ''); add(p(t), t) }
  const kf = ex.keyFigures || {}
  const kfRows = ['Eigenkapitalquote', 'Liquide Mittel', 'Bankverbindlichkeiten', 'Umsatz', ...KEY_FIGURES].filter((k, i, a) => a.indexOf(k) === i && kf[k]).map((k) => [k === 'Liquide Mittel' ? 'Liquidität (liquide Mittel)' : k, `${num(kf[k].value)}${k === 'Eigenkapitalquote' ? ' %' : ''}`, kf[k].date || '', kf[k].docNo || ''])
  children.push(h2('Kennzahlen'))
  children.push(kfRows.length ? table(['Kennzahl', 'Wert', 'Stichtag', 'Beleg'], kfRows, [34, 26, 20, 20]) : p('Keine Kennzahlen im Akt (Jahresabschluss fehlt oder wurde nicht gelesen).'))
  children.push(h2('Rote Themen'))
  children.push(red.length ? table(['ID', 'Bereich', 'Thema', 'Instrument', 'Belege'], red.map((t) => [t.no, areaLabel(t.area), t.title, DEAL_IMPACT_LABEL[instrumentOf(t)] || instrumentOf(t), evidenceOf(matter, t).filter((e) => e.original).map((e) => e.f.docNo).filter((x, i, a) => a.indexOf(x) === i).join(', ') || 'unbestätigt']), [8, 16, 40, 16, 20]) : p('Keine roten Themen.'))
  const byInstr = {}
  for (const t of [...red, ...amber]) { const i = instrumentOf(t); if (i && i !== 'keine') (byInstr[i] ||= []).push(t) }
  children.push(h2('Umsetzung in der Transaktionsdokumentation'))
  const iRows = ['Abbruch', 'CP', 'Kaufpreis', 'Freistellung', 'Garantie', 'Nachfrage'].filter((k) => byInstr[k]).map((k) => [DEAL_IMPACT_LABEL[k] || k, byInstr[k].map((t) => `${t.no} ${t.title}`).join('; '), byInstr[k].map((t) => t.recommendation).filter(Boolean).slice(0, 2).join(' · ')])
  children.push(iRows.length ? table(['Instrument', 'Themen', 'Umsetzung'], iRows, [18, 42, 40]) : p('Keine Themen mit Transaktionsbezug.'))
  if (ex.next_steps?.length) { children.push(h2('Nächste Schritte')); ex.next_steps.forEach((t) => add(bullet(t), t)) }
  children.push(new Paragraph({ children: [new PageBreak()] }))

  // 2 Themes per area – the word budget is shared so the report stays within 15,000 words.
  children.push(h1(full ? '2. Themen je Prüfbereich' : '2. Rote und gelbe Themen je Prüfbereich'))
  const reserve = 2500 + (full ? matter.documents.length * 60 : 0)
  const perTheme = Math.max(60, Math.min(THEME_WORDS, Math.floor((MAX_WORDS - wordCount - reserve) / Math.max(1, shown.length))))
  const areaKeys = [...new Set([...s.areas, ...shown.map((t) => t.area)])].filter((k) => shown.some((t) => t.area === k))
  for (const key of areaKeys) {
    const ts = shown.filter((t) => t.area === key)
    children.push(h2(`${areaLabel(key)} (${ts.filter((t) => gradeOf(t) === 'red').length} rot, ${ts.filter((t) => gradeOf(t) === 'amber').length} gelb${full ? `, ${ts.filter((t) => gradeOf(t) === 'green').length} grün` : ''})`))
    const as = matter.areaSummaries?.[key]
    if (as?.summary) { const t = clipWords(as.summary, 90); add(p(t), t) }
    for (const t of ts) {
      const g = gradeOf(t)
      children.push(new Paragraph({ children: [new TextRun({ text: `${t.no} · ${SEV_DE[g]}${t.unconfirmed ? ' (unbestätigt)' : ''}: `, bold: true, color: g === 'red' ? 'B42318' : g === 'amber' ? '9A6700' : '3B6D11' }), new TextRun({ text: t.title, bold: true })], spacing: { before: 180, after: 60 } }))
      wordCount += words(t.title) + 3
      const ev = evidenceOf(matter, t)
      const orig = ev.filter((e) => e.original)
      const meta = `Instrument: ${DEAL_IMPACT_LABEL[instrumentOf(t)] || instrumentOf(t)} · Belege: ${orig.map((e) => e.label).slice(0, 4).join('; ') || 'nur Sekundärquelle (unbestätigt)'}${t.status === 'ungeklaert' ? ' · im Akt ungeklärt' : ''}${t.calibration ? ` · ${t.calibration.reason}` : ''} · Review: ${REVIEW_DE[t.review?.status || 'open']}`
      // 180 words per theme: description, then the legal check, then one quote.
      const metaW = words(meta), descBudget = Math.max(30, perTheme - metaW - 40)
      const desc = clipWords(t.description, descBudget)
      add(p(desc), desc)
      const q = orig.find((e) => e.f.quote)
      if (q) { const qt = clipWords(q.f.quote, 35); children.push(new Paragraph({ children: [new TextRun({ text: `„${qt}“ `, italics: true }), new TextRun({ text: `(${q.label})`, size: 18, color: '566A73' })], indent: { left: 540 }, spacing: { after: 80 } })); wordCount += words(qt) }
      if (t.legal?.answer && perTheme - words(desc) - metaW > 25) { const lt = clipWords(t.legal.answer.replace(/[#*]/g, '').replace(/\s+/g, ' '), Math.min(60, perTheme - words(desc) - metaW)); add(p(`Rechtsprüfung (${t.legal.via === 'aissociate' ? 'AI:ssociate' : 'Websuche RIS'}): ${lt}`, { size: 18 }), lt) }
      add(p(meta, { size: 18, color: '566A73' }), meta)
      if (t.review?.note) add(p(`Reviewer: ${t.review.note}`, { size: 18, color: '566A73' }), t.review.note)
      if (t.norms?.length) {
        const runs = [new TextRun({ text: 'Normen: ', size: 18, color: '566A73' })]
        t.norms.slice(0, 6).forEach((n, i) => { const st = t.normStatus?.find((x) => x.norm === n); const label = `${n}${st?.status === 'ok' ? ' ✓' : st?.status === 'not_found' ? ' (im RIS nicht gefunden)' : st?.status === 'expired' ? ' (außer Kraft)' : ''}`; runs.push(st?.url ? new ExternalHyperlink({ children: [new TextRun({ text: label, size: 18, style: 'Hyperlink', color: '0E7C8A', underline: {} })], link: st.url }) : new TextRun({ text: label, size: 18 })); if (i < Math.min(6, t.norms.length) - 1) runs.push(new TextRun({ text: '; ', size: 18 })) })
        children.push(new Paragraph({ children: runs, spacing: { after: 120 } }))
      }
    }
  }
  if (!shown.length) children.push(p('Keine Themen.'))

  // 3 Missing documents and requests (before signing)
  children.push(h1('3. Fehlende Unterlagen und Nachfragen (vor Signing)'))
  const req = requestRows(matter)
  children.push(req.length ? table(['Bereich', 'Art', 'Unterlage / Nachfrage'], req.map((r) => [r.area, r.kind, r.text]), [22, 13, 65]) : p('Keine offenen Unterlagen.'))
  wordCount += req.reduce((n, r) => n + words(r.text), 0)

  // 4 Document index with reconciliation
  children.push(h1('4. Dokumentenindex'))
  children.push(p(`Abgleich: ${inv.source ?? '–'} in der Quelle · ${inv.taken ?? '–'} aufgenommen · ${inv.analysed ?? '–'} analysiert · ${inv.skipped ?? '–'} übersprungen${inv.complete ? ' – alle analysiert.' : '.'}${inv.containers ? ` ${inv.containers} Archive entpackt.` : ''}`, { bold: true }))
  const docs = matter.documents.filter((d) => !d.container)
  const byId = new Map(matter.documents.map((d) => [d.id, d]))
  children.push(table(['ID', 'Dokument', 'Typ', 'Rolle', 'Status', 'Themen / Bezug'], docs.map((d) => [d.no || '', `${d.folder ? d.folder + '/' : ''}${d.name}`, d.docType || '–', d.role || '–', d.status === 'analysed' ? `vollständig gelesen${d.truncated ? ' (Rest über Grenze)' : ''}` : d.status === 'skipped' ? `übersprungen (${SKIP_REASONS[d.skipReason] || d.skipReason || '–'})` : d.status, [d.status === 'analysed' ? ((d.issueNos || []).join(', ') || 'geprüft, unauffällig') : '', d.duplicateOf ? `Duplikat von ${byId.get(d.duplicateOf)?.no || '?'}` : '', d.parent ? `aus ${byId.get(d.parent)?.name || '?'}` : ''].filter(Boolean).join('; ')]), [7, 35, 14, 13, 15, 16]))

  // Full report: summaries per document
  if (full) {
    children.push(h1('5. Zusammenfassung je Dokument'))
    for (const d of docs.filter((x) => x.status === 'analysed' && x.summary)) { children.push(new Paragraph({ children: [new TextRun({ text: `${d.no} ${d.title || d.name}`, bold: true })], spacing: { before: 120, after: 40 } })); add(p(clipWords(d.summary, 70), { size: 20 }), d.summary) }
  }

  // Method
  children.push(h1(`${full ? 6 : 5}. Methodik und Einschränkungen`))
  const fs = matter.findings || []
  const skipped = docs.filter((d) => d.status === 'skipped' || d.status === 'error')
  const method = `Inventar mit SHA-256 und Textvergleich über den ganzen Akt (Duplikate nicht doppelt gelesen), Archive und E-Mails entpackt. Jede Originalunterlage wurde vollständig gelesen; dabei wurden nur Tatsachen und Klauseln mit wörtlichem Beleg erfasst, keine Schlüsse. Daraus entstand das Aktmodell mit ${matter.facts?.entries?.length ?? 0} Fakten und ${matter.facts?.entities?.length ?? 0} Personen und Gesellschaften (über Name, Geburtsdatum und Firmenbuchnummer zusammengeführt; ${matter.facts?.ambiguities?.length ?? 0} Fälle namensgleicher Personen, ${matter.facts?.contradictions?.length ?? 0} Widersprüche). Die Sachverhalte wurden einmal für den ganzen Akt ermittelt – aus Regeln über das Aktmodell, aus den gebündelten Klauseln und aus einem Durchgang über das gesamte Aktmodell – und jeder einzeln mit dem Aktmodell und den Wortlauten der einschlägigen Dokumente geprüft (bestätigt, ungeklärt, widerlegt). Sekundärquellen (Prüfberichte, Memos, Gutachten Dritter) zählen nicht als Beleg. Der Schweregrad folgt festen Regeln aus den Merkmalen. Rechtsfragen wurden nach Schwierigkeit geprüft: leichte aus internem Wissen, schwere per Websuche im RIS, sehr schwere durch AI:ssociate. Zitierte Normen wurden gegen das RIS geprüft${matter.verification ? ` (${matter.verification.summary.ok} von ${matter.verification.summary.checked} bestätigt)` : ''}.`
  add(p(method), method)
  if (skipped.length) children.push(p(`Übersprungen (${skipped.length}): ${skipped.map((d) => `${d.no} ${d.name} (${SKIP_REASONS[d.skipReason] || d.note || 'Fehler'})`).join('; ')}.`, { size: 18 }))
  const trunc = docs.filter((d) => d.truncated)
  if (trunc.length) children.push(p(`Sehr lange Dokumente nur in den ersten Teilen analysiert: ${trunc.map((d) => d.no + ' ' + d.name).join(', ')}.`, { size: 18 }))
  children.push(p(`Dieser Bericht ist ein KI-generierter Entwurf und ersetzt keine anwaltliche oder steuerliche Prüfung. Umfang: ${matter.job?.usage?.inTok ? Math.round(matter.job.usage.inTok / 1000) + 'k Eingabe-Tokens' : 'n/a'} · rund ${Math.round(wordCount / 100) * 100} Wörter.`, { size: 18, color: '566A73' }))

  const doc = new Document({ creator: 'AI:ssociate', title: `${full ? 'Vollbericht' : 'Red-Flag-Bericht'} – ${matter.name}`, styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } }, sections: [{ children }] })
  const buf = await Packer.toBuffer(doc)
  buf.wordCount = wordCount
  return buf
}

export async function buildDdXlsx(matter) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AI:ssociate'
  const head = (ws) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }] }
  const byId = new Map(matter.documents.map((d) => [d.id, d]))

  const t = wb.addWorksheet('Themen')
  t.columns = [{ header: 'ID', key: 'no', width: 8 }, { header: 'Grad', key: 'g', width: 8 }, { header: 'Grad (Regeln)', key: 'gc', width: 12 }, { header: 'Status', key: 'st', width: 12 }, { header: 'nach Rechtsprüfung', key: 'cal', width: 34 }, { header: 'Bereich', key: 'area', width: 24 }, { header: 'Thema', key: 'title', width: 44 }, { header: 'Beschreibung', key: 'desc', width: 70 }, { header: 'Instrument', key: 'ins', width: 18 }, { header: 'Belege (Originalunterlagen)', key: 'ev', width: 44 }, { header: 'Rechtsfrage', key: 'lq', width: 50 }, { header: 'Schwierigkeit', key: 'diff', width: 22 }, { header: 'Rechtsprüfung', key: 'legal', width: 70 }, { header: 'Normen', key: 'norms', width: 28 }, { header: 'Review', key: 'rev', width: 12 }, { header: 'Vermerk', key: 'note', width: 40 }, { header: 'Schlüssel', key: 'key', width: 40 }]
  for (const x of [...(matter.themes || [])].sort((a, b) => SEV_RANK[gradeOf(a)] - SEV_RANK[gradeOf(b)])) {
    const g = gradeOf(x)
    const row = t.addRow({ no: x.no, g: SEV_DE[g], gc: SEV_DE[x.gradeComputed], st: ISSUE_STATUS[x.status] || '', cal: x.calibration ? `${x.calibration.action}: ${x.calibration.reason}` : '', lq: x.legalQuestion || '', diff: DIFFICULTY[x.difficulty] || '', area: areaLabel(x.area), title: x.title, desc: x.description, ins: DEAL_IMPACT_LABEL[instrumentOf(x)] || instrumentOf(x), ev: evidenceOf(matter, x).filter((e) => e.original).map((e) => e.label).join('; ') || 'unbestätigt', legal: x.legal?.answer ? `${x.legal.via === 'aissociate' ? 'AI:ssociate' : x.legal.via === 'web' ? 'Websuche' : 'internes Wissen'}: ${x.legal.answer.slice(0, 30_000)}` : '', norms: (x.norms || []).join('; '), rev: x.discarded ? `verworfen (${x.discarded.by})` : REVIEW_DE[x.review?.status || 'open'], note: x.review?.note || '', key: x.key })
    row.getCell('g').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + SEV_COLOR[g] } }
    if (!liveTheme(x)) row.font = { strike: true, color: { argb: 'FF8A98A0' } }
  }
  head(t); t.autoFilter = { from: 'A1', to: 'Q1' }

  const f = wb.addWorksheet('Klauseln')
  f.columns = [{ header: 'ID', key: 'n', width: 8 }, { header: 'Thema', key: 'th', width: 8 }, { header: 'Art', key: 'kind', width: 26 }, { header: 'Bereich', key: 'area', width: 24 }, { header: 'Klausel', key: 'title', width: 40 }, { header: 'Beschreibung', key: 'desc', width: 60 }, { header: 'Gegenpartei', key: 'cp', width: 24 }, { header: 'Betrag', key: 'amt', width: 12 }, { header: 'Dokument', key: 'doc', width: 32 }, { header: 'Fundstelle', key: 'loc', width: 16 }, { header: 'Zitat', key: 'quote', width: 50 }, { header: 'Regel', key: 'rule', width: 10 }, { header: 'Quelle', key: 'q', width: 14 }]
  for (const x of matter.findings || []) {
    const th = (matter.themes || []).find((y) => (y.findingIds || []).includes(x.id))
    f.addRow({ n: x.no, th: th?.no || '', kind: CLAUSE_KINDS[x.kind]?.label || x.kind || '', area: areaLabel(x.area), title: x.title, desc: x.description, cp: x.gegenpartei, amt: x.betrag ?? '', doc: `${x.docNo} ${x.docName}`, loc: x.location, quote: x.quote, rule: x.rule || '', q: x.quelle })
  }
  head(f); f.autoFilter = { from: 'A1', to: 'M1' }

  const en = wb.addWorksheet('Entitäten')
  en.columns = [{ header: 'ID', key: 'id', width: 8 }, { header: 'Art', key: 'kind', width: 12 }, { header: 'Name', key: 'name', width: 32 }, { header: 'Geburtsdatum / FN', key: 'ident', width: 16 }, { header: 'verstorben / ausgeschieden', key: 'gone', width: 20 }, { header: 'Funktionen', key: 'fn', width: 70 }, { header: 'Dokumente', key: 'docs', width: 40 }, { header: 'Hinweis', key: 'note', width: 30 }]
  for (const e of matter.facts?.entities || []) en.addRow({ id: e.id, kind: e.kind === 'person' ? 'Person' : 'Gesellschaft/Stelle', name: e.name, ident: e.ident, gone: e.deceased ? `verstorben ${e.deceased.date || ''}` : e.left?.length ? 'ausgeschieden' : '', fn: (e.functions || []).map((x) => `${x.attribute}${x.counterparty ? ' (' + x.counterparty + ')' : ''} ${x.docNo}`).join('; '), docs: (e.docNos || []).join(', '), note: e.unclear ? 'Zuordnung unklar (namensgleich)' : '' })
  head(en)

  const fa = wb.addWorksheet('Fakten')
  fa.columns = [{ header: 'ID', key: 'id', width: 10 }, { header: 'Typ', key: 'type', width: 24 }, { header: 'Betrifft', key: 'sub', width: 32 }, { header: 'Merkmal', key: 'attr', width: 24 }, { header: 'Wert', key: 'val', width: 30 }, { header: 'Betrag', key: 'amt', width: 12 }, { header: 'Gegenpartei / Inhaber', key: 'cp', width: 26 }, { header: 'Standort', key: 'site', width: 18 }, { header: 'gültig ab', key: 'from', width: 11 }, { header: 'gültig bis', key: 'to', width: 11 }, { header: 'Merkmale', key: 'flags', width: 18 }, { header: 'Beleg', key: 'ev', width: 50 }, { header: 'Korrektur', key: 'corr', width: 24 }]
  for (const e of matter.facts?.entries || []) fa.addRow({ id: e.id, type: FACT_TYPES[e.type] || e.type, sub: e.subject, attr: e.attribute, val: e.value, amt: e.amount ?? '', cp: e.counterparty, site: e.site, from: e.validFrom, to: e.validTo, flags: (e.flags || []).join(', '), ev: (e.evidence || []).map((x) => `${x.docNo} ${x.location}: „${String(x.quote).slice(0, 120)}“`).join(' | '), corr: e.corrected ? `korrigiert${e.note ? ': ' + e.note : ''}` : '' })
  head(fa); fa.autoFilter = { from: 'A1', to: 'M1' }

  const d = wb.addWorksheet('Dokumente')
  d.columns = [{ header: 'ID', key: 'n', width: 8 }, { header: 'Dokument', key: 'name', width: 40 }, { header: 'Ordner', key: 'folder', width: 26 }, { header: 'Typ', key: 'type', width: 22 }, { header: 'Rolle', key: 'role', width: 18 }, { header: 'Rechtssubjekt', key: 'subj', width: 16 }, { header: 'Bereich', key: 'area', width: 24 }, { header: 'Status', key: 'status', width: 14 }, { header: 'Grund / Hinweis', key: 'note', width: 40 }, { header: 'Duplikat von', key: 'dup', width: 10 }, { header: 'Aus', key: 'parent', width: 24 }, { header: 'SHA-256', key: 'sha', width: 18 }, { header: 'Seiten', key: 'pages', width: 7 }, { header: 'Handschrift (Seiten)', key: 'hw', width: 12 }, { header: 'Fakten', key: 'facts', width: 7 }, { header: 'Themen', key: 'iss', width: 20 }, { header: 'Zusammenfassung', key: 'summary', width: 70 }]
  for (const x of matter.documents) { if (x.container) continue; d.addRow({ n: x.no, name: x.name, folder: x.folder || '', type: x.docType, role: x.role, subj: x.subject, area: x.area ? areaLabel(x.area) : '', status: x.status === 'skipped' ? 'übersprungen' : x.status === 'analysed' ? 'analysiert' : x.status, note: x.note, dup: x.duplicateOf ? byId.get(x.duplicateOf)?.no || '' : '', parent: x.parent ? byId.get(x.parent)?.name || '' : '', sha: (x.sha256 || '').slice(0, 16), pages: x.pages ?? '', hw: (x.handwritingPages || []).join(', '), facts: (x.facts || []).length, iss: x.status === 'analysed' ? ((x.issueNos || []).join(', ') || 'geprüft, unauffällig') : '', summary: x.summary }) }
  head(d); d.autoFilter = { from: 'A1', to: 'Q1' }

  const q = wb.addWorksheet('Nachfragen')
  q.columns = [{ header: 'Bereich', key: 'area', width: 26 }, { header: 'Art', key: 'kind', width: 12 }, { header: 'Unterlage / Nachfrage', key: 'q', width: 90 }, { header: 'Status', key: 'st', width: 12 }]
  for (const r of requestRows(matter)) q.addRow({ area: r.area, kind: r.kind, q: r.text, st: 'offen' })
  head(q)

  const a = wb.addWorksheet('Bereiche')
  a.columns = [{ header: 'Bereich', key: 'area', width: 28 }, { header: 'Dokumente', key: 'docs', width: 10 }, { header: 'Themen', key: 't', width: 9 }, { header: 'Zusammenfassung', key: 's', width: 90 }, { header: 'Risiken', key: 'r', width: 60 }, { header: 'Widersprüche', key: 'c', width: 50 }, { header: 'Empfehlungen', key: 'e', width: 60 }]
  for (const as of Object.values(matter.areaSummaries || {})) a.addRow({ area: as.label, docs: as.documents, t: as.themes ?? as.findings, s: as.summary, r: (as.key_risks || []).join('; '), c: (as.cross_document_issues || []).join('; '), e: (as.deal_recommendations || []).join('; ') })
  head(a)

  const h = wb.addWorksheet('Hinweise')
  h.columns = [{ header: 'Art', key: 'k', width: 26 }, { header: 'Bezug', key: 'ref', width: 16 }, { header: 'Gegenstand', key: 'what', width: 60 }, { header: 'Grund', key: 'why', width: 70 }]
  for (const x of matter.themes || []) if (x.discarded) h.addRow({ k: x.discarded.by === 'Ausschlusskatalog' ? 'Ausschlusskatalog' : x.discarded.by === 'Rechtsprüfung' ? 'Rechtsprüfung: nicht zutreffend' : 'Im Akt widerlegt', ref: x.no, what: x.title, why: x.discarded.reason })
  for (const a of matter.facts?.ambiguities || []) h.addRow({ k: 'Namensgleiche Personen', ref: a.id, what: a.name, why: a.note })
  for (const x of matter.orphanThemes || []) h.addRow({ k: 'Thema verwaist', ref: x.no, what: x.title, why: 'Im aktuellen Lauf nicht mehr gefunden; Review-Entscheidung bleibt erhalten' })
  for (const c of matter.facts?.contradictions || []) h.addRow({ k: 'Widerspruch im Aktmodell', ref: c.id, what: `${c.subject} – ${c.attribute}`, why: `${c.values.map((v) => `${v.value} (${v.docNo})`).join(' vs. ')} → ${c.resolved} (${c.reason})` })
  for (const x of matter.themes || []) if (x.unconfirmed) h.addRow({ k: 'Unbestätigt (nur Sekundärquelle)', ref: x.no, what: x.title, why: 'In keiner Originalunterlage belegt' })
  head(h)
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
