// Themes (issues) of a due diligence: built from the consolidation agent's result, with the
// reviewer's operations applied on top – merges, clauses moved or removed, themes created by
// hand – and the reviews carried over by the theme key. No model calls here.
export const GRADE_RANK = { red: 0, amber: 1, green: 2, info: 3 }
export const effectiveGrade = (t) => t.review?.grade || t.gradeCalibrated || t.gradeComputed
export const liveTheme = (t) => !t.discarded && !t.mergedInto && !t.orphaned && t.review?.status !== 'rejected'

/** Fallback when no executive summary was written: decided from the instruments of the live themes. */
export function overallAssessment(themes) {
  const live = (themes || []).filter(liveTheme)
  const instr = (t) => t.review?.instrument || t.instrument
  if (live.some((t) => instr(t) === 'Abbruch')) return 'Abbruch erwägen'
  if (live.some((t) => effectiveGrade(t) === 'red' && instr(t) === 'CP')) return 'unter Bedingungen fortführen'
  return 'fortführen mit Garantien und Freistellungen'
}

const evidenceOf = (findings) => findings.filter((f) => f.quote).map((f) => ({ docId: f.docId, docNo: f.docNo, docName: f.docName, location: f.location, quote: f.quote, status: f.evidence }))

/**
 * The themes of the matter: the consolidated base (matter.themeBase) plus the reviewer's
 * operations (matter.themeOps), with number, review, legal check and calibration carried
 * over from the previous themes of the same key. Returns { themes, orphans }.
 */
export function assembleThemes(matter) {
  const ops = (matter.themeOps ||= { assign: {}, merges: {}, manual: [] })
  const prev = new Map([...(matter.themes || []), ...(matter.orphanThemes || [])].map((t) => [t.key, t]))
  const findings = new Map((matter.findings || []).map((f) => [f.id, f]))
  const byKey = new Map()
  for (const b of matter.themeBase || []) byKey.set(b.key, { ...b, findingIds: [...b.findingIds] })
  for (const m of ops.manual || []) if (!byKey.has(m.key)) byKey.set(m.key, { key: m.key, source: 'manuell', title: m.title, area: m.area, description: m.description || '', status: 'bestaetigt', grade: m.grade || 'amber', instrument: m.review?.instrument || 'Nachfrage', recommendation: '', legalQuestion: '', difficulty: '', requests: [], findingIds: [], manual: true, review: m.review })
  // Clauses moved by the reviewer (or removed as evidence).
  for (const f of matter.findings || []) {
    const to = ops.assign[f.key]
    if (!to) continue
    for (const t of byKey.values()) t.findingIds = t.findingIds.filter((id) => id !== f.id)
    if (to !== 'removed' && byKey.has(to)) byKey.get(to).findingIds.push(f.id)
  }
  // Themes merged by the reviewer.
  const resolve = (k) => { let x = k, n = 0; while (ops.merges[x] && n++ < 20) x = ops.merges[x]; return x }
  for (const from of Object.keys(ops.merges)) {
    const to = resolve(from), s = byKey.get(from), t = byKey.get(to)
    if (!s || !t || s === t) continue
    t.findingIds.push(...s.findingIds.filter((id) => !t.findingIds.includes(id)))
    byKey.delete(from)
  }
  matter.seq ||= {}; matter.seq.theme ||= 0
  const themes = []
  for (const b of byKey.values()) {
    const p = prev.get(b.key)
    const fs = b.findingIds.map((id) => findings.get(id)).filter(Boolean)
    if (!fs.length && !b.manual && b.source !== 'akt') continue
    const id = p?.id || `th_${(++matter.seq.theme).toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const t = {
      id, no: p?.no || `T-${String(matter.seq.theme).padStart(3, '0')}`, key: b.key, source: b.source || 'klausel', manual: Boolean(b.manual),
      title: b.title, area: b.area, description: b.description, status: b.status, question: b.question || '', instrument: b.instrument, recommendation: b.recommendation,
      legalQuestion: b.legalQuestion, difficulty: b.difficulty, requests: b.requests || [], norms: [...new Set([...(b.norms || []), ...fs.flatMap((f) => f.norms || [])])].slice(0, 10), normStatus: p?.normStatus || [],
      findingIds: fs.map((f) => f.id), docIds: [...new Set([...fs.map((f) => f.docId), ...fs.flatMap((f) => f.relatedDocIds || [])])], evidence: evidenceOf(fs),
      gradeComputed: b.grade, gradeWhy: b.gradeWhy || '', gradeCalibrated: null, calibration: null, discarded: b.status === 'widerlegt' ? { by: 'Prüfung', reason: firstSentence(b.description) || 'Der Akt zeigt kein Risiko.' } : null,
      unconfirmed: fs.length > 0 && fs.every((f) => f.quelle === 'hypothese'), legal: p?.legal || null, review: p?.review || b.review || { status: 'open', grade: null, instrument: null, note: '', ts: null },
    }
    if (t.unconfirmed && t.gradeComputed === 'red') { t.gradeComputed = 'amber'; t.gradeWhy = 'nur in einer Sekundärquelle belegt (unbestätigt)' }
    applyLegal(t)
    if (t.review.title) t.title = t.review.title
    if (t.review.description) t.description = t.review.description
    themes.push(t)
  }
  const keys = new Set(themes.map((t) => t.key))
  const orphans = [...prev.values()].filter((t) => !keys.has(t.key) && (t.orphaned || t.review?.status !== 'open' || t.review?.note)).map((t) => ({ ...t, orphaned: true }))
  themes.sort((a, b) => GRADE_RANK[effectiveGrade(a)] - GRADE_RANK[effectiveGrade(b)] || a.no.localeCompare(b.no))
  return { themes, orphans }
}
const firstSentence = (s) => String(s || '').replace(/[#*]/g, '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 300) || ''

/** The result of the legal check on the grade (the legal agent decides the grade after its research). */
export function applyLegal(t) {
  const L = t.legal
  if (!L || L.via === 'error') return
  if (L.verdict === 'nicht zutreffend') { t.discarded = { by: 'Rechtsprüfung', reason: firstSentence(L.answer) || 'Rechtsprüfung: nicht zutreffend' }; t.calibration = { action: 'verworfen', reason: 'Rechtsprüfung: nicht zutreffend' }; return }
  if (L.grade && L.grade !== t.gradeComputed) { t.gradeCalibrated = L.grade; t.calibration = { action: GRADE_RANK[L.grade] > GRADE_RANK[t.gradeComputed] ? 'herabgestuft' : 'hochgestuft', from: t.gradeComputed, to: L.grade, reason: L.gradeReason || 'nach der Rechtsprüfung' } }
}

/** Which themes every document belongs to – the coverage proof per document – and the clause → theme link. */
export function linkDocuments(matter) {
  for (const d of matter.documents) { d.issueNos = []; d.flags = { red: 0, amber: 0, green: 0, info: 0 } }
  const byId = new Map(matter.documents.map((d) => [d.id, d]))
  for (const t of matter.themes || []) {
    if (!liveTheme(t)) continue
    for (const id of new Set([...(t.docIds || []), ...(t.evidence || []).map((e) => e.docId)])) { const d = byId.get(id); if (!d) continue; d.issueNos.push(t.no); const g = effectiveGrade(t); if (d.flags[g] != null) d.flags[g]++ }
  }
  for (const f of matter.findings || []) f.themeId = (matter.themes || []).find((t) => t.findingIds?.includes(f.id))?.id || null
}

/** How the themes of each source fared: created, confirmed, refuted, not applicable, reviewer decisions. */
export function ruleStats(matter) {
  const out = {}
  for (const t of [...(matter.themes || []), ...(matter.orphanThemes || [])]) {
    const k = t.source === 'akt' ? 'Akt-Durchgang' : t.source === 'hypothese' ? 'Hypothesen' : t.source === 'manuell' ? 'manuell' : 'Klauseln'
    const r = (out[k] ||= { source: k, label: k, issues: 0, confirmed: 0, unclear: 0, refuted: 0, excluded: 0, notApplicable: 0, accepted: 0, rejected: 0, modified: 0, open: 0 })
    r.issues++
    if (t.status === 'bestaetigt') r.confirmed++
    if (t.status === 'ungeklaert') r.unclear++
    if (t.discarded?.by === 'Prüfung') r.refuted++
    if (t.discarded?.by === 'Rechtsprüfung') r.notApplicable++
    r[{ accepted: 'accepted', rejected: 'rejected', modified: 'modified' }[t.review?.status] || 'open']++
  }
  for (const r of Object.values(out)) r.falseRate = r.issues ? Math.round((100 * (r.refuted + r.excluded + r.notApplicable + r.rejected)) / r.issues) : 0
  return Object.values(out).sort((a, b) => a.source.localeCompare(b.source))
}
