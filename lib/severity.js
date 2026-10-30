// Stages 6–8 of the due diligence, deterministic part: the grade of a finding from its
// features, the exclusion catalogue, themes (findings about the same subject merged by a
// stable key), the calibration decisions and the overall assessment.
//
// Severity rules, in this order:
//   1. hit in the exclusion catalogue → no finding
//   2. affected party is not the target → at most yellow (unless the rule allows it)
//   3. only a secondary source → at most yellow, "unbestätigt"
//   4. red: established defect and (amount above the materiality threshold or core prerequisite)
//   5. red: gap concerning a core prerequisite that the Nachweis-Abgleich did not find
//   6. yellow otherwise (defect below the threshold, gap without core prerequisite, amount unknown)
//   7. green: checked, unremarkable or cured (findings of the kind "Hinweis")
//   8. a theme takes the highest grade of its evidence
import { EXCLUSIONS, RULES_ALLOW_NON_TARGET, THEME_KEY_WITHOUT_COUNTERPARTY, DD_AREAS, DEAL_IMPACTS } from './ddconfig.js'
import { deceased, factsOf, nameTokens } from './facts.js'
import { terms } from './search.js'

export const GRADE_RANK = { red: 0, amber: 1, green: 2, info: 3 }
const LOWER = { red: 'amber', amber: 'green', green: 'green' }
const HIGHER = { green: 'amber', amber: 'red', red: 'red' }
// Change-of-control and similar clauses: one theme per counterparty, whatever the wording of the subject.
const BY_COUNTERPARTY = ['VERT-001', 'FIN-001', 'IMMO-003', 'IP-004', 'ARB-001']
const INSTRUMENT_RANK = ['Abbruch', 'CP', 'Kaufpreis', 'Freistellung', 'Garantie', 'Nachfrage', 'keine']
const textOf = (f) => `${f.title} ${f.description} ${f.quote}`.toLowerCase()
const iso = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '')

/** Rule 1: the exclusion catalogue. Returns { id, label } of the matching exclusion or null. */
export function exclusionOf(f, reg, settings) {
  const t = textOf(f)
  const hit = (id) => EXCLUSIONS.find((x) => x.id === id)
  if (/reverse.?charge|§\s*19\s*abs\.?\s*1a|übergang der steuerschuld/.test(t) && /bau/.test(t) && !/fehlerhaft|unrichtig|falsch|zu unrecht|nicht angewe?nde?t|nicht beachtet|nachzahlung|festgesetzt|haftung/.test(t)) return hit('AUS-1')
  if (settings.transaction !== 'asset' && settings.sellers !== 'partial' && /vinkul|aufgriffsrecht|vorkaufsrecht|zustimmung (der|aller) gesellschafter zur (abtretung|übertragung)|abtretung.{0,40}zustimmung/.test(t) && !/(kontrollwechsel|change of control)/.test(t)) return hit('AUS-2')
  if (/aussch[üu]ttung|dividende|gewinnaussch/.test(t)) {
    const ref = iso(settings.stichtag) || new Date().toISOString().slice(0, 10)
    const paid = factsOf(reg, 'zahlung_gesellschafter', (e) => /aussch[üu]ttung|dividende|gewinn/i.test(`${e.attribute} ${e.value} ${e.subject}`) && e.validFrom && e.validFrom < ref)
    if (paid.length && !/verdeckt|unzulässig|verboten|einlagenrückgewähr|§ 82/.test(t)) return hit('AUS-3')
  }
  if (/fruchtgenuss|stimmbind|syndikat|wohnrecht|vorkaufsrecht|veto/.test(t)) {
    const gone = deceased(reg).filter((p) => nameTokens(p.name).length >= 2 && nameTokens(p.name).every((w) => t.includes(w)))
    const lapsed = factsOf(reg, 'recht_dritter', (e) => e.flags.includes('erloschen') && nameTokens(e.counterparty).length && nameTokens(e.counterparty).every((w) => t.includes(w)))
    if (gone.length || lapsed.length) return hit('AUS-4')
  }
  if ((f.area === 'finanzierung' || /\bbank|kredit/.test(t)) && /(allgemeine geschäftsbedingungen|\bagb\b|standardklausel|bankübliche|marktübliche|übliche (bank)?klausel)/.test(t) && !/kontrollwechsel|change of control|gesellschafterwechsel|eigentümerwechsel|cross.?default|anteils(übertragung|verkauf)/.test(t) && ['keine', 'Nachfrage', 'Garantie'].includes(f.dealImpact)) return hit('AUS-5')
  return null
}

/** Rules 2–7: the grade of one finding from its features. Returns { grade, unconfirmed, why }. */
export function gradeOf(f, settings) {
  const threshold = Number(settings.materialityEur) || 50_000
  let grade, why
  if (f.art === 'hinweis') { grade = 'green'; why = 'Hinweis' }
  else if (f.art === 'mangel' && f.betrag != null && f.betrag > threshold) { grade = 'red'; why = `Mangel über der Wesentlichkeitsschwelle (${Math.round(f.betrag).toLocaleString('de-DE')} EUR)` }
  else if (f.art === 'mangel' && f.kernvoraussetzung) { grade = 'red'; why = 'Mangel an einer Kernvoraussetzung' }
  else if (f.art === 'luecke' && f.kernvoraussetzung && !f.proof?.found) { grade = 'red'; why = 'Lücke an einer Kernvoraussetzung, im Akt nicht nachgewiesen' }
  else { grade = 'amber'; why = f.art === 'luecke' ? 'Lücke ohne Kernvoraussetzung' : f.betrag == null ? 'Mangel, Betrag unbekannt' : 'Mangel unter der Wesentlichkeitsschwelle' }
  let unconfirmed = false
  if (grade === 'red' && f.betroffen && f.betroffen !== 'Zielgesellschaft' && !RULES_ALLOW_NON_TARGET.includes(f.rule) && !RULES_ALLOW_NON_TARGET.includes(f.aktRule)) { grade = 'amber'; why += `; betrifft ${f.betroffen}, nicht die Zielgesellschaft (höchstens gelb)` }
  if (f.quelle === 'hypothese' && !f.belegOriginal) { unconfirmed = true; if (grade === 'red') grade = 'amber'; why += '; nur in einer Sekundärquelle (unbestätigt, höchstens gelb)' }
  return { grade, unconfirmed, why }
}

const areaCode = (k) => DD_AREAS.find((a) => a.key === k)?.code || 'ALL'
// Words (stemmed) and numbers: "Halle 2" and "Halle 3" are different subjects.
const tokensOf = (s) => [...terms(s), ...(String(s || '').toLowerCase().match(/\b\d+[a-z]?\b/g) || [])]
const keyPart = (s) => [...new Set(tokensOf(s))].sort().join(' ')
/** Stable theme key: rule | subject | counterparty (normalised); also the anchor of review decisions. */
export function themeKey(f) {
  const rule = f.rule || f.aktRule || `${areaCode(f.area)}-000`
  if (BY_COUNTERPARTY.includes(rule) && keyPart(f.gegenpartei)) return `${rule}|${keyPart(f.gegenpartei)}`
  if (THEME_KEY_WITHOUT_COUNTERPARTY.includes(rule)) return `${rule}|${keyPart(f.gegenstand || f.title)}`
  return `${rule}|${keyPart(f.gegenstand || f.title)}|${keyPart(f.gegenpartei)}`
}
/** Stable key of a finding across runs (document, rule, subject, title). */
export const findingKey = (f, docHash = '') => `${(docHash || f.docId || '').slice(0, 16)}|${f.rule || f.aktRule || ''}|${keyPart(f.gegenstand)}|${keyPart(f.title).slice(0, 60)}`

export const effectiveGrade = (t) => t.review?.grade || t.gradeCalibrated || t.gradeComputed
export const liveTheme = (t) => !t.discarded && !t.mergedInto && t.review?.status !== 'rejected'
const maxGrade = (gs) => gs.filter(Boolean).sort((a, b) => GRADE_RANK[a] - GRADE_RANK[b])[0] || 'green'
const topInstrument = (xs) => INSTRUMENT_RANK.find((i) => xs.includes(i)) || 'keine'

/**
 * Builds the themes from the graded findings (rule 8), applying the reviewer's operations
 * (reassigned findings, merges, manual themes) and carrying reviews over by theme key.
 * Returns { themes, orphans }.
 */
export function buildThemes(matter, prevThemes = [], { carry = false } = {}) {
  const ops = matter.themeOps ||= { assign: {}, merges: {}, manual: [] }
  const groups = new Map()
  const resolve = (k) => { let x = k, n = 0; while (ops.merges[x] && n++ < 20) x = ops.merges[x]; return x }
  for (const f of matter.findings) {
    f.themeId = null
    if (f.excluded || f.discarded || !f.severity) continue
    const a = ops.assign[f.key]
    if (a === 'removed') continue
    const k = resolve(a || themeKey(f))
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(f)
  }
  for (const m of ops.manual) if (!groups.has(m.key)) groups.set(m.key, [])
  const prevByKey = new Map(prevThemes.map((t) => [t.key, t]))
  matter.seq ||= {}; matter.seq.theme ||= 0
  const themes = []
  for (const [key, fs] of groups) {
    const manual = ops.manual.find((m) => m.key === key)
    const prev = prevByKey.get(key)
    const lead = [...fs].sort((a, b) => GRADE_RANK[a.severity] - GRADE_RANK[b.severity] || (b.evidence === 'verified') - (a.evidence === 'verified'))[0]
    const areaCount = {}; for (const f of fs) areaCount[f.area] = (areaCount[f.area] || 0) + 1
    const t = {
      id: prev?.id || `th_${(++matter.seq.theme).toString(36)}_${Math.random().toString(36).slice(2, 8)}`, no: prev?.no || `T-${String(matter.seq.theme).padStart(3, '0')}`, key,
      title: manual?.title || lead?.title || 'Thema', description: manual?.description || lead?.description || '', area: manual?.area || Object.entries(areaCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
      rule: lead?.rule || lead?.aktRule || '', gegenstand: lead?.gegenstand || '', gegenpartei: lead?.gegenpartei || '',
      findingIds: fs.map((f) => f.id), docIds: [...new Set(fs.map((f) => f.docId).filter(Boolean))],
      gradeComputed: fs.length ? maxGrade(fs.map((f) => f.severity)) : (manual?.grade || 'amber'), gradeWhy: lead?.gradeWhy || '', gradeCalibrated: null, calibration: null,
      instrument: topInstrument(fs.map((f) => f.dealImpact)), recommendation: lead?.recommendation || '', unconfirmed: fs.length > 0 && fs.every((f) => f.unconfirmed),
      sources: [...new Set(fs.map((f) => f.quelle))], norms: [...new Set(fs.flatMap((f) => f.norms || []))].slice(0, 10), normStatus: [],
      legal: prev?.legal || null, manual: Boolean(manual),
      review: prev?.review || manual?.review || { status: 'open', grade: null, instrument: null, note: '', ts: null },
    }
    if (t.review.title) t.title = t.review.title
    if (t.review.description) t.description = t.review.description
    // Review operations between runs keep the calibration of the last run.
    if (carry && prev) { t.gradeCalibrated = prev.gradeCalibrated; t.calibration = prev.calibration; t.discarded = prev.discarded || null; t.gradeWhy = prev.gradeWhy || t.gradeWhy }
    for (const f of fs) f.themeId = t.id
    themes.push(t)
  }
  // Reviewed themes whose key no longer occurs stay visible as "verwaist" (not in the report).
  const orphans = prevThemes.filter((t) => !groups.has(t.key) && !t.orphaned && (t.review?.status !== 'open' || t.review?.note)).map((t) => ({ ...t, orphaned: true, findingIds: [], docIds: [] }))
  for (const o of matter.orphanThemes || []) if (!groups.has(o.key) && !orphans.some((x) => x.key === o.key)) orphans.push(o)
  themes.sort((a, b) => GRADE_RANK[a.gradeComputed] - GRADE_RANK[b.gradeComputed] || a.no.localeCompare(b.no))
  return { themes, orphans }
}

/** Candidate pairs for the short merge check: same area, different key, similar subject. */
export function borderlinePairs(themes, max = 40) {
  const out = []
  const tk = themes.map((t) => new Set(tokensOf(`${t.gegenstand} ${t.gegenpartei} ${t.title}`)))
  for (let i = 0; i < themes.length; i++) for (let j = i + 1; j < themes.length; j++) {
    const a = themes[i], b = themes[j]
    if (a.area !== b.area || a.manual || b.manual) continue
    const x = tk[i], y = tk[j]
    const inter = [...x].filter((w) => y.has(w)).length
    const jac = inter / Math.max(1, new Set([...x, ...y]).size)
    if (jac >= 0.45) out.push([a, b, jac])
  }
  return out.sort((p, q) => q[2] - p[2]).slice(0, max)
}

/** Applies the calibration decisions (merge / downgrade / discard / exceptional upgrade, each with a reason). */
export function applyCalibration(themes, decisions) {
  const byNo = new Map(themes.map((t) => [t.no, t]))
  for (const t of themes) { t.gradeCalibrated = t.gradeComputed; t.calibration = null; t.discarded = null }
  for (const d of decisions || []) {
    const t = byNo.get(String(d.theme || '').trim())
    if (!t || t.mergedInto) continue
    const reason = String(d.reason || '').slice(0, 400)
    if (d.action === 'verwerfen') { t.discarded = { by: 'Kalibrierung', reason }; t.calibration = { action: 'verworfen', reason }; continue }
    if (d.action === 'zusammenführen') {
      const into = byNo.get(String(d.target || '').trim())
      if (!into || into === t || into.mergedInto) continue
      into.findingIds.push(...t.findingIds); into.docIds = [...new Set([...into.docIds, ...t.docIds])]; into.norms = [...new Set([...into.norms, ...t.norms])]
      into.gradeComputed = maxGrade([into.gradeComputed, t.gradeComputed]); into.gradeCalibrated = maxGrade([into.gradeCalibrated, t.gradeCalibrated])
      t.mergedInto = into.no; t.calibration = { action: 'zusammengeführt', reason: `${reason} → ${into.no}` }
      continue
    }
    if (d.action === 'herabstufen') { const g = GRADE_RANK[d.grade] > GRADE_RANK[t.gradeComputed] ? d.grade : LOWER[t.gradeComputed]; t.gradeCalibrated = g; t.calibration = { action: 'herabgestuft', reason, from: t.gradeComputed, to: g }; continue }
    // An upgrade is the exception: one level at most, and only for themes that are not unconfirmed.
    if (d.action === 'hochstufen' && !t.unconfirmed) { const g = HIGHER[t.gradeComputed]; t.gradeCalibrated = g; t.calibration = { action: 'hochgestuft', reason, from: t.gradeComputed, to: g }; continue }
    t.calibration = { action: 'behalten', reason }
  }
  return themes
}

/** Overall assessment by rules (never by the model). */
export function overallAssessment(themes) {
  const live = themes.filter(liveTheme)
  const instr = (t) => t.review?.instrument || t.instrument
  if (live.some((t) => instr(t) === 'Abbruch')) return 'Abbruch erwägen'
  if (live.some((t) => effectiveGrade(t) === 'red' && instr(t) === 'CP')) return 'unter Bedingungen fortführen'
  return 'fortführen mit Garantien und Freistellungen'
}
export { INSTRUMENT_RANK, DEAL_IMPACTS }
