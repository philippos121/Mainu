// Stage 3 of the due diligence: the facts register of the Akt (no model calls).
//
// Every original document contributes the facts extracted in stage 2 (shareholders, organs,
// permits and their holders, sites, contracts, payments, key figures …). They are merged
// across the Akt: the Firmenbuch extract and the annual accounts take precedence, deviating
// values are kept as contradictions of their own. Reviewer corrections are applied last.
// From the register comes the compact Akt context (< DD_CONTEXT_MAX_TOKENS) that every
// risk analysis of a single document sees.
import { FACT_TYPES, KEY_FIGURES } from './ddconfig.js'

const PRIMARY_TYPES = ['Firmenbuch-/Registerauszug', 'Jahresabschluss']
const TITLES = /\b(dr|mag|ing|di|dipl|kommr|komm|rat|mba|bsc|msc|ll\.?m|prof|univ|med|jur|rer|pol|nat|techn|ba|ma|frau|herr|hr|fr)\b\.?/gi
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
export const nameTokens = (s) => norm(String(s || '').replace(TITLES, ' ')).split(' ').filter((w) => w.length >= 2)
/** Two spellings of one person or company (titles, order and middle names do not matter). */
export function sameName(a, b) {
  const x = nameTokens(a), y = nameTokens(b)
  if (!x.length || !y.length) return false
  const [small, big] = x.length <= y.length ? [x, y] : [y, x]
  const hit = small.filter((w) => big.includes(w)).length
  return hit === small.length && (hit >= 2 || (small.length === 1 && big.length <= 2))
}
const valueNorm = (f) => (f.amount != null ? String(Math.round(f.amount * 100) / 100) : norm(f.value))
const keyOf = (f) => [f.type, norm(f.subject), norm(f.attribute), f.type === 'kennzahl' ? String(f.valid_from || f.validFrom || '').slice(0, 4) : '', norm(f.counterparty), norm(f.site)].join('|')
const overlaps = (a, b) => {
  const s1 = a.validFrom || '', e1 = a.validTo || '9999', s2 = b.validFrom || '', e2 = b.validTo || '9999'
  return (!s1 && !s2) || (s1 <= e2 && s2 <= e1)
}

/** Builds the register from the documents' facts and the reviewer corrections. */
export function buildRegister(matter) {
  const entries = new Map(), contradictions = []
  const docs = matter.documents.filter((d) => Array.isArray(d.facts) && d.status !== 'skipped' && !d.duplicateOf && d.role !== 'Sekundärquelle')
  // Primary sources first, then by date (newest last, so it wins among equals).
  docs.sort((a, b) => (PRIMARY_TYPES.includes(b.docType) - PRIMARY_TYPES.includes(a.docType)) || String(a.date || '').localeCompare(String(b.date || '')))
  for (const d of docs) {
    d.facts.forEach((f, i) => {
      if (!FACT_TYPES[f.type]) return
      const e = { id: `${d.no || d.id}#${i + 1}`, type: f.type, subject: f.subject, attribute: f.attribute, value: f.value, amount: f.amount ?? null, counterparty: f.counterparty || '', site: f.site || '', validFrom: f.valid_from || '', validTo: f.valid_to || '', flags: f.flags || [], primary: PRIMARY_TYPES.includes(d.docType), evidence: [{ docId: d.id, docNo: d.no || '', docName: d.name, location: f.location || '', quote: f.quote || '', status: f.evidence || '' }] }
      const k = keyOf(e)
      const prev = entries.get(k)
      if (!prev) { entries.set(k, e); return }
      if (valueNorm(prev) === valueNorm(e)) { prev.evidence.push(...e.evidence); for (const fl of e.flags) if (!prev.flags.includes(fl)) prev.flags.push(fl); prev.validTo ||= e.validTo; return }
      if (!overlaps(prev, e)) { entries.set(k + '|' + (e.validFrom || i), e); return }
      // Contradiction: the primary source wins; otherwise the newer document.
      const keep = prev.primary && !e.primary ? prev : e
      const drop = keep === prev ? e : prev
      contradictions.push({ id: `W-${String(contradictions.length + 1).padStart(3, '0')}`, type: e.type, subject: e.subject, attribute: e.attribute, values: [{ value: keep.value, amount: keep.amount, docNo: keep.evidence[0].docNo, docId: keep.evidence[0].docId, location: keep.evidence[0].location }, { value: drop.value, amount: drop.amount, docNo: drop.evidence[0].docNo, docId: drop.evidence[0].docId, location: drop.evidence[0].location }], resolved: keep.value, reason: keep.primary && !drop.primary ? 'Firmenbuch/Jahresabschluss hat Vorrang' : 'jüngeres Dokument' })
      entries.set(k, keep)
    })
  }
  const list = [...entries.values()]
  // Reviewer corrections (edit, delete, add) – they win over every document.
  for (const c of matter.factCorrections || []) {
    if (c.action === 'add') { list.push({ id: c.id, type: c.type, subject: c.subject || '', attribute: c.attribute || '', value: c.value || '', amount: c.amount ?? null, counterparty: c.counterparty || '', site: c.site || '', validFrom: c.validFrom || '', validTo: c.validTo || '', flags: c.flags || [], primary: true, corrected: true, note: c.note || '', evidence: [] }); continue }
    const e = list.find((x) => x.id === c.factId)
    if (!e) continue
    if (c.action === 'delete') { e.deleted = true; e.note = c.note || ''; continue }
    for (const k of ['value', 'amount', 'validFrom', 'validTo', 'flags', 'subject', 'counterparty']) if (k in c && c[k] !== undefined) e[k] = c[k]
    e.corrected = true; e.note = c.note || ''
  }
  return { entries: list.filter((e) => !e.deleted), deleted: list.filter((e) => e.deleted).length, contradictions, builtAt: Date.now(), documents: docs.length }
}

/** Facts of one type (optionally about a subject). */
export const factsOf = (reg, type, pred = () => true) => (reg?.entries || []).filter((e) => e.type === type && pred(e))
/** People who died (from Todesfälle and facts flagged "verstorben"). */
export function deceased(reg) {
  const out = []
  for (const e of reg?.entries || []) {
    if (e.type === 'todesfall') out.push({ name: e.subject, date: e.validTo || e.validFrom || '', fact: e })
    else if (e.flags.includes('verstorben')) out.push({ name: e.subject, date: e.validTo || '', fact: e })
  }
  return out
}
/** Current shareholders of the target (Firmenbuch first). */
export function shareholders(reg) {
  const all = factsOf(reg, 'gesellschafter', (e) => !e.validTo && !e.flags.includes('ausgeschieden') && !e.flags.includes('verstorben'))
  const primary = all.filter((e) => e.primary)
  return (primary.length ? primary : all).map((e) => ({ name: e.subject || e.value, share: e.value, fact: e }))
}
/** Latest key figures (one per attribute). */
export function keyFigures(reg) {
  const out = {}
  for (const e of factsOf(reg, 'kennzahl')) {
    const k = [...KEY_FIGURES].sort((a, b) => b.length - a.length).find((x) => norm(e.attribute).includes(norm(x))) || e.attribute
    if (!out[k] || String(e.validFrom) > String(out[k].validFrom)) out[k] = e
  }
  return out
}

const tok = (s) => Math.ceil(String(s).length / 3.5)
const line = (e) => `${e.subject}${e.attribute ? ` – ${e.attribute}` : ''}: ${e.value}${e.amount != null && !String(e.value).includes(String(e.amount)) ? ` (${e.amount.toLocaleString('de-DE')})` : ''}${e.counterparty ? ` · ${e.counterparty}` : ''}${e.site ? ` · Standort ${e.site}` : ''}${e.validFrom || e.validTo ? ` · ${e.validFrom || '…'}–${e.validTo || '…'}` : ''}${e.flags.length ? ` [${e.flags.join(', ')}]` : ''} (${e.evidence.map((x) => x.docNo).filter(Boolean).slice(0, 3).join(', ') || 'Korrektur'})`

/**
 * The compact Akt context every single-document analysis sees: the target, its shareholders and
 * organs, functionaries, permits, sites, contracts with change of control, key figures and the
 * contradictions – at most maxTokens; the most important sections first.
 */
export function aktContext(matter, reg, maxTokens = 4000) {
  const s = matter.settings
  const head = `ZIELGESELLSCHAFT: ${s.target || '(nicht angegeben)'}${s.targetFn ? ` · FN ${s.targetFn}` : ''} · ${s.transaction === 'asset' ? 'Asset Deal' : 'Share Deal'}${s.stichtag ? ` · Stichtag ${s.stichtag}` : ''}${s.closing ? ` · Closing ${s.closing}` : ''}${s.sellers === 'partial' ? ' · nicht alle Gesellschafter verkaufen' : ' · alle Gesellschafter verkaufen'}`
  const sections = [
    ['Gesellschafter', factsOf(reg, 'gesellschafter')], ['Organe/Vertretung', factsOf(reg, 'organ')], ['Prokura', factsOf(reg, 'prokura')], ['Todesfälle/Erbgänge', factsOf(reg, 'todesfall')],
    ['Funktionsträger laut Bescheid', factsOf(reg, 'funktionstraeger')], ['Genehmigungen', factsOf(reg, 'genehmigung')], ['Standorte/Nutzungsrechte', factsOf(reg, 'standort')],
    ['Kennzahlen', Object.values(keyFigures(reg))], ['Verträge mit Kontrollwechsel', factsOf(reg, 'vertrag', (e) => e.flags.includes('kontrollwechsel'))],
    ['Zahlungen an Gesellschafter', factsOf(reg, 'zahlung_gesellschafter')], ['Rechte Dritter', factsOf(reg, 'recht_dritter')], ['Beschlüsse', factsOf(reg, 'beschluss')],
    ['Weitere Verträge', factsOf(reg, 'vertrag', (e) => !e.flags.includes('kontrollwechsel'))],
  ]
  const out = [head]
  let used = tok(head)
  const contra = (reg?.contradictions || []).map((c) => `- ${c.subject} ${c.attribute}: ${c.values.map((v) => `${v.value} (${v.docNo})`).join(' vs. ')} → ${c.resolved} (${c.reason})`)
  for (const [label, list] of sections) {
    if (!list.length) continue
    const head2 = `\n${label.toUpperCase()}:`
    if (used + tok(head2) > maxTokens - 150) break
    out.push(head2); used += tok(head2)
    for (const e of list) { const l = '- ' + line(e); if (used + tok(l) > maxTokens - (contra.length ? 300 : 50)) break; out.push(l); used += tok(l) }
  }
  if (contra.length) { out.push('\nWIDERSPRÜCHE:'); for (const l of contra) { if (used + tok(l) > maxTokens) break; out.push(l); used += tok(l) } }
  return out.join('\n')
}

/** Document list for the analysis prompt: number, type, role, date, title. */
export const documentList = (matter) => matter.documents.filter((d) => !d.container).map((d) => `${d.no || ''} | ${d.docType || '?'} | ${d.role || '?'}${d.duplicateOf ? ' (Duplikat)' : ''} | ${d.date || ''} | ${(d.title || d.name).slice(0, 90)}`).join('\n')
