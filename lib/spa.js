// SPA draft from a due diligence: the SPA model drafts a purchase agreement under Austrian law for
// the planned transaction (share deal or asset deal, buyer or seller side), and every red and
// yellow theme lands in the instrument the review gave it – condition precedent, specific
// warranty, indemnity, purchase price adjustment; questions to clarify become open points.
// One model call; the result is a Word document under "Berichte". Counts against the hard
// token limit of the due diligence.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType } from 'docx'
import { DD_AREAS, DEAL_IMPACT_LABEL } from './ddconfig.js'
import { aktText } from './aktmodel.js'
import { effectiveGrade, liveTheme, GRADE_RANK } from './themes.js'

const SPA_MAX_OUT = Number(process.env.SPA_MAX_OUTPUT_TOKENS || 60_000)
const instrumentOf = (t) => t.review?.instrument || t.instrument || ''
const areaLabel = (k) => DD_AREAS.find((a) => a.key === k)?.label || 'Allgemein'
// Instruments that belong in the contract; "Nachfrage" and "Abbruch" are points to clear before signing.
const IN_CONTRACT = ['CP', 'Garantie', 'Freistellung', 'Kaufpreisanpassung']

const CLAUSE = { type: 'object', additionalProperties: false, properties: {
  number: { type: 'string', description: 'z. B. "5.3"' },
  title: { type: 'string' },
  text: { type: 'string', description: 'Vertragstext; Absätze mit \\n getrennt; Unbekanntes als [●]' },
  themes: { type: 'array', items: { type: 'string' }, description: 'Themennummern der DD (T-…), aus denen die Klausel folgt; leer für Standardklauseln' },
}, required: ['number', 'title', 'text', 'themes'] }
export const SPA_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  title: { type: 'string', description: 'z. B. "Abtretungsvertrag über Geschäftsanteile an der … GmbH"' },
  form_note: { type: 'string', description: 'Formerfordernisse (z. B. Notariatsakt) und Genehmigungen, knapp' },
  parties: { type: 'array', items: { type: 'string' }, description: 'Vertragsparteien mit Rolle; Unbekanntes als [●]' },
  preamble: { type: 'array', items: { type: 'string' }, description: 'Präambel, je Absatz ein Eintrag' },
  sections: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { number: { type: 'string' }, heading: { type: 'string' }, clauses: { type: 'array', items: CLAUSE } }, required: ['number', 'heading', 'clauses'] } },
  schedules: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title', 'content'] }, description: 'Anlagen (z. B. Offenlegungsschreiben, Liste der Zustimmungen)' },
  open_points: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { point: { type: 'string' }, themes: { type: 'array', items: { type: 'string' } } }, required: ['point', 'themes'] }, description: 'Vor Signing zu klären (Nachfragen, Deal Breaker, fehlende Angaben)' },
  drafting_notes: { type: 'array', items: { type: 'string' }, description: 'Hinweise an die bearbeitende Anwältin / den bearbeitenden Anwalt' },
}, required: ['title', 'form_note', 'parties', 'preamble', 'sections', 'schedules', 'open_points', 'drafting_notes'] }

function spaInstructions(s) {
  const share = s.transaction !== 'asset', buyer = s.perspective !== 'seller'
  return `Du bist Partnerin einer österreichischen M&A-Kanzlei und entwirfst den ${share ? 'Anteilskaufvertrag (Share Deal)' : 'Unternehmenskaufvertrag (Asset Deal)'} für die geplante Transaktion nach österreichischem Recht, aus Sicht ${buyer ? 'des Käufers (käuferfreundlich, aber verhandelbar)' : 'der Verkäufer (verkäuferfreundlich, aber marktüblich)'}. Grundlage sind die Themen der Due Diligence.

Aufbau (marktüblich, an die Transaktion angepasst): Parteien, Präambel, Definitionen, Kauf- und Abtretungsgegenstand, Kaufpreis und Kaufpreismechanik (Locked Box oder Stichtagsbilanz als Option in eckigen Klammern), Signing und Closing, Vollzugsbedingungen, Verhalten bis Closing, Garantien der Verkäufer, Freistellungen, Rechtsfolgen und Haftung (Ausschluss der gesetzlichen Gewährleistung zugunsten des vertraglichen Regimes, De-minimis, Freibetrag, Höchstbetrag, Verjährung), Käufergarantien, Wettbewerbsverbot und Abwerbeverbot, Vertraulichkeit, Kosten und Gebühren, Schlussbestimmungen (österreichisches Recht unter Ausschluss der Verweisungsnormen und des UN-Kaufrechts; Gerichtsstand oder Schiedsgericht als Option).
${share ? 'Share Deal: Formerfordernisse der Anteilsübertragung nach der Rechtsform beachten (bei der GmbH Notariatsakt, § 76 Abs 2 GmbHG; Vinkulierungen und Zustimmungen); Garantien zu Gesellschaft, Anteilen, Organen, Berechtigungen und Verträgen.' : 'Asset Deal: Gegenstände, Verträge und Arbeitsverhältnisse einzeln bestimmen; Übergang von Verträgen und Haftung (§ 38 UGB, § 1409 ABGB), Arbeitsverhältnisse (§ 3 AVRAG), Berechtigungen, die nicht übergehen.'}

Umsetzung der Themen nach ihrem Instrument:
- CP → Vollzugsbedingung (mit Verzichtsmöglichkeit der begünstigten Partei);
- Garantie → spezifische, selbständige Garantie im Garantiekatalog, zusätzlich zu den Standardgarantien;
- Freistellung → spezielle Freistellung, nicht durch De-minimis, Freibetrag und Kenntnis des Käufers beschränkt;
- Kaufpreisanpassung → Kaufpreisabzug, Treuhand (Escrow) oder Einbehalt in der Kaufpreismechanik;
- Nachfrage → offener Punkt vor Signing; Abbruch → offener Punkt (Deal Breaker), nicht in den Vertrag.
Jedes rote und gelbe Thema mit Vertragsinstrument muss im Vertrag vorkommen; nenne bei jeder Klausel die Themennummern, aus denen sie folgt.

Regeln: Deutsch, österreichische Vertragssprache (z. B. Geschäftsanteil, Firmenbuch, Stichtag). Keine Fakten erfinden: Namen, Beträge, Daten und Prozentsätze nur aus den Angaben, sonst [●]; Vorschläge für Schwellenwerte und Fristen in eckigen Klammern als Verhandlungsposition. Normen nur, wenn sicher. Nummeriere Abschnitte (1, 2, …) und Klauseln (1.1, 1.2, …). Antworte als JSON nach Schema.`
}

function spaInput(matter) {
  const s = matter.settings || {}
  const live = (matter.themes || []).filter(liveTheme).sort((a, b) => GRADE_RANK[effectiveGrade(a)] - GRADE_RANK[effectiveGrade(b)] || a.no.localeCompare(b.no))
  const relevant = live.filter((t) => ['red', 'amber'].includes(effectiveGrade(t)) || IN_CONTRACT.includes(instrumentOf(t)))
  const lines = [
    'TRANSAKTION',
    `- Zielgesellschaft: ${s.target || '[●]'}${s.legalForm ? ` (${s.legalForm})` : ''}${s.targetFn ? `, FN ${s.targetFn}` : ''}`,
    `- Art: ${s.transaction === 'asset' ? 'Asset Deal' : 'Share Deal'}${s.transaction !== 'asset' ? (s.sellers === 'partial' ? ', nicht alle Gesellschafter verkaufen' : ', alle Gesellschafter verkaufen') : ''}`,
    `- Mandant: ${matter.client || '[●]'} (${s.perspective === 'seller' ? 'Verkäuferseite' : 'Käuferseite'})`,
    `- Stichtag: ${s.stichtag || '[●]'} · Closing geplant: ${s.closing || '[●]'} · Wesentlichkeitsschwelle der DD: ${s.materialityEur ? s.materialityEur + ' EUR' : '[●]'}`,
  ]
  if (matter.executive) lines.push(`\nGESAMTEINSCHÄTZUNG DER DD: ${matter.executive.overall_assessment || ''}\n${String(matter.executive.executive_summary || '').slice(0, 3000)}`)
  lines.push(`\nTHEMEN DER DD (${relevant.length}):`)
  for (const t of relevant) {
    const fs = (t.evidence || []).slice(0, 3).map((e) => `${e.docNo}${e.location ? ' ' + e.location : ''}: „${String(e.quote || '').slice(0, 200)}“`).join(' | ')
    lines.push(`- ${t.no} [${effectiveGrade(t)}] Instrument: ${instrumentOf(t) || '–'} · ${areaLabel(t.area)} · ${t.title}\n  Sachverhalt: ${String(t.description || '').replace(/\s+/g, ' ').slice(0, 700)}${t.recommendation ? `\n  Empfehlung: ${String(t.recommendation).replace(/\s+/g, ' ').slice(0, 300)}` : ''}${t.legal?.answer ? `\n  Rechtsprüfung (${t.legal.verdict || ''}): ${t.legal.answer.replace(/\s+/g, ' ').slice(0, 400)}` : ''}${t.norms?.length ? `\n  Normen: ${t.norms.slice(0, 5).join('; ')}` : ''}${t.review?.note ? `\n  Vermerk: ${t.review.note.slice(0, 200)}` : ''}${fs ? `\n  Belege: ${fs}` : ''}`)
  }
  if (matter.facts?.entities) lines.push(`\nAKTMODELL (Gesellschafter, Organe, Berechtigungen):\n${aktText(matter, matter.facts, { types: ['gesellschafter', 'organ', 'prokura', 'funktionstraeger', 'genehmigung', 'standort', 'kennzahl', 'recht_dritter'], maxChars: 15_000 })}`)
  return { text: lines.join('\n'), relevant }
}

/** Drafts the SPA (one call of the SPA model), builds the Word document and lists it under "Berichte". */
export async function runSpa(matter, deps) {
  const { store, send, callModel, ctx } = deps
  const log = (message) => send('dd', { matterId: matter.id, stage: 'spa', progress: null, message })
  const { text, relevant } = spaInput(matter)
  log(`SPA-Entwurf: ${relevant.length} Themen der DD werden in den Vertrag übernommen …`)
  const resp = await callModel(ctx, { model: deps.modelSpa, effort: 'high', maxOut: SPA_MAX_OUT, temperature: 0, instructions: spaInstructions(matter.settings || {}), input: [{ role: 'user', content: text }], text: { format: { type: 'json_schema', name: 'dd_spa', schema: SPA_SCHEMA, strict: true } } })
  let spa = null
  try { spa = JSON.parse(resp.output_text || '') } catch {}
  if (!spa) throw new Error('Der SPA-Entwurf kam nicht vollständig zurück' + (resp.status === 'incomplete' ? ' (Ausgabe abgeschnitten)' : '') + '.')
  // Themes with a contract instrument that no clause names: listed in the document so nothing gets lost.
  const cited = new Set(spa.sections.flatMap((x) => x.clauses.flatMap((c) => c.themes.map((n) => String(n).trim()))))
  const uncovered = relevant.filter((t) => IN_CONTRACT.includes(instrumentOf(t)) && ['red', 'amber'].includes(effectiveGrade(t)) && !cited.has(t.no))
  const buf = await buildSpaDocx(matter, spa, relevant, uncovered)
  const stamp = new Date().toISOString().slice(0, 10)
  const stem = (matter.name || 'DD').replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 50) || 'DD'
  const name = await store.putReport(matter.id, `SPA_Entwurf_${stem}_${stamp}.docx`, buf)
  matter.reports = (matter.reports || []).filter((r) => r.name !== name)
  matter.reports.unshift({ name, kind: 'docx', type: 'spa', size: buf.length, createdAt: Date.now() })
  matter.spa = { at: Date.now(), name, clauses: spa.sections.reduce((n, x) => n + x.clauses.length, 0), themes: relevant.length, uncovered: uncovered.map((t) => t.no), openPoints: spa.open_points.length }
  if (deps.computeCost) matter.job.cost = deps.computeCost(ctx.usage, 0)
  await store.saveMatter(matter)
  log(`SPA-Entwurf erstellt: ${matter.spa.clauses} Klauseln${uncovered.length ? `, ${uncovered.length} Themen ohne Klausel (im Dokument aufgelistet)` : ''}.`)
  return matter.spa
}

// ---- Word ----
const para = (text, opts = {}, pOpts = {}) => new Paragraph({ children: [new TextRun({ text: String(text ?? ''), ...opts })], spacing: { after: 120 }, ...pOpts })
const cell = (text, { bold = false, shade = null, width = null } = {}) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), bold, size: 18 })] })], ...(shade ? { shading: { type: ShadingType.CLEAR, fill: shade, color: 'auto' } } : {}), ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}) })
const table = (header, rows, widths) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, { bold: true, shade: 'E8EEF0', width: widths?.[i] })) }), ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, { width: widths?.[i] })) }))] })

export async function buildSpaDocx(matter, spa, relevant, uncovered) {
  const out = []
  out.push(new Paragraph({ children: [new TextRun({ text: 'ENTWURF – aus der Due Diligence erstellt, anwaltlich zu prüfen', bold: true, color: 'B42318', size: 18 })], alignment: AlignmentType.CENTER, spacing: { after: 240 } }))
  out.push(new Paragraph({ text: spa.title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 240 } }))
  if (spa.form_note) out.push(para(spa.form_note, { italics: true, size: 18, color: '555555' }))
  if (spa.parties.length) { out.push(para('abgeschlossen zwischen', { bold: true })); for (const x of spa.parties) out.push(para(x)) }
  if (spa.preamble.length) { out.push(new Paragraph({ text: 'Präambel', heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 } })); spa.preamble.forEach((x, i) => out.push(para(`(${String.fromCharCode(65 + (i % 26))}) ${x}`))) }
  for (const sec of spa.sections) {
    out.push(new Paragraph({ text: `${sec.number}. ${sec.heading}`, heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 } }))
    for (const c of sec.clauses) {
      const paras = String(c.text || '').split(/\n+/).map((x) => x.trim()).filter(Boolean)
      out.push(new Paragraph({ children: [new TextRun({ text: `${c.number}  `, bold: true }), new TextRun({ text: c.title, bold: true }), ...(c.themes.length ? [new TextRun({ text: `   [DD: ${c.themes.join(', ')}]`, size: 16, color: '0E5C69' })] : [])], spacing: { before: 120, after: 80 } }))
      for (const x of paras) out.push(para(x))
    }
  }
  for (const sch of spa.schedules) { out.push(new Paragraph({ text: sch.title, heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 } })); for (const x of String(sch.content || '').split(/\n+/).filter((y) => y.trim())) out.push(para(x.trim())) }
  // Working annex: where every theme of the DD went.
  out.push(new Paragraph({ text: 'Arbeitsanhang: Umsetzung der Due Diligence', heading: HeadingLevel.HEADING_1, pageBreakBefore: true, spacing: { after: 120 } }))
  const clausesOf = (no) => spa.sections.flatMap((x) => x.clauses.filter((c) => c.themes.includes(no)).map((c) => c.number))
  out.push(table(['Thema', 'Grad', 'Instrument', 'Titel', 'Klauseln'], relevant.map((t) => [t.no, { red: 'Rot', amber: 'Gelb', green: 'Grün' }[effectiveGrade(t)] || '', DEAL_IMPACT_LABEL?.[instrumentOf(t)] || instrumentOf(t) || '–', t.title, clausesOf(t.no).join(', ') || '–']), [9, 8, 16, 52, 15]))
  if (uncovered.length) { out.push(para('')); out.push(para('Themen mit Vertragsinstrument ohne Klausel – bitte ergänzen:', { bold: true, color: 'B42318' })); for (const t of uncovered) out.push(para(`${t.no} ${t.title} (${instrumentOf(t)})`)) }
  if (spa.open_points.length) { out.push(new Paragraph({ text: 'Offene Punkte vor Signing', heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } })); out.push(table(['Punkt', 'Themen'], spa.open_points.map((o) => [o.point, o.themes.join(', ')]), [85, 15])) }
  if (spa.drafting_notes.length) { out.push(new Paragraph({ text: 'Hinweise zum Entwurf', heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } })); for (const x of spa.drafting_notes) out.push(new Paragraph({ children: [new TextRun(x)], bullet: { level: 0 }, spacing: { after: 60 } })) }
  const doc = new Document({ creator: 'AI:ssociate', title: spa.title, styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } }, sections: [{ children: out }] })
  return Packer.toBuffer(doc)
}
