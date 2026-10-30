// Severity of an issue (Sachverhalt) by rules, the exclusion catalogue and the overall assessment.
// The model only delivers features; the grade follows from them, in this order:
//   1. hit in the exclusion catalogue → no issue
//   2. affected party is not the target → at most yellow (unless the rule allows it)
//   3. only a secondary source → at most yellow, "unbestätigt"
//   4. red: established defect and (amount above the materiality threshold or core prerequisite)
//   5. red: open point (not documented in the Akt, identity unclear) at a core prerequisite
//   6. yellow otherwise
//   7. green: checked and unremarkable (kind "Hinweis")
// Then the legal check: "nicht zutreffend" discards the issue, "teilweise zutreffend" caps it at
// yellow unless a core prerequisite is concerned.
import { EXCLUSIONS, RULES_ALLOW_NON_TARGET, DEAL_IMPACTS } from './ddconfig.js'
import { deceased, factsOf, nameTokens } from './aktmodel.js'

export const GRADE_RANK = { red: 0, amber: 1, green: 2, info: 3 }
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
  else if (f.art === 'luecke' && f.kernvoraussetzung) { grade = 'red'; why = 'an einer Kernvoraussetzung im ganzen Akt nicht geklärt' }
  else { grade = 'amber'; why = f.art === 'luecke' ? 'offen, keine Kernvoraussetzung' : f.betrag == null ? 'Mangel, Betrag unbekannt' : 'Mangel unter der Wesentlichkeitsschwelle' }
  let unconfirmed = false
  if (grade === 'red' && f.betroffen && f.betroffen !== 'Zielgesellschaft' && !RULES_ALLOW_NON_TARGET.includes(f.rule) && !RULES_ALLOW_NON_TARGET.includes(f.aktRule)) { grade = 'amber'; why += `; betrifft ${f.betroffen}, nicht die Zielgesellschaft (höchstens gelb)` }
  if (f.quelle === 'hypothese' && !f.belegOriginal) { unconfirmed = true; if (grade === 'red') grade = 'amber'; why += '; nur in einer Sekundärquelle (unbestätigt, höchstens gelb)' }
  return { grade, unconfirmed, why }
}

export const effectiveGrade = (t) => t.review?.grade || t.gradeCalibrated || t.gradeComputed
export const liveTheme = (t) => !t.discarded && !t.mergedInto && !t.orphaned && t.review?.status !== 'rejected'
export const topInstrument = (xs) => INSTRUMENT_RANK.find((i) => xs.includes(i)) || 'keine'

/** Applies the verdict of the legal check to the grade. */
export function applyVerdict(t) {
  t.gradeCalibrated = null; t.calibration = null
  const v = t.legal?.verdict
  if (v === 'nicht zutreffend') { t.discarded = { by: 'Rechtsprüfung', reason: firstSentence(t.legal.answer) || 'Rechtsprüfung: nicht zutreffend' }; t.calibration = { action: 'verworfen', reason: 'Rechtsprüfung: nicht zutreffend' }; return }
  if (v === 'teilweise zutreffend' && t.gradeComputed === 'red' && !t.kernvoraussetzung) { t.gradeCalibrated = 'amber'; t.calibration = { action: 'herabgestuft', from: 'red', to: 'amber', reason: 'Rechtsprüfung: nur teilweise zutreffend' } }
}
const firstSentence = (s) => String(s || '').replace(/[#*]/g, '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 300) || ''
/** Verdict at the start of a free-text legal answer ("zutreffend" / "teilweise zutreffend" / "nicht zutreffend"). */
export function verdictOf(text) {
  const t = String(text || '').replace(/[#*_>]/g, ' ').slice(0, 300).toLowerCase()
  if (/nicht\s+(mehr\s+)?(zutreffend|relevant)|unzutreffend/.test(t)) return 'nicht zutreffend'
  if (/teilweise\s+zutreffend|teilweise/.test(t)) return 'teilweise zutreffend'
  if (/zutreffend/.test(t)) return 'zutreffend'
  return ''
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
