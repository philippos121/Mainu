// Stage 3 of the due diligence: the Akt model – the overall context, kept in full and queryable.
//
// Built without model calls from the facts every document delivered in stage 2:
//   - facts merged across the Akt (Firmenbuch and annual accounts take precedence; deviating
//     values become contradictions of their own; reviewer corrections win over everything);
//   - entities: persons and companies resolved across documents by name, date of birth and
//     Firmenbuch number. Namesakes with different identifiers stay separate; a mention that
//     could be several of them is kept as "unklar" instead of being guessed;
//   - per entity: functions held (with documents and dates), death or departure;
//   - the text of the model (whole or a slice for one issue) that the model passes read.
import crypto from 'node:crypto'
import { FACT_TYPES, KEY_FIGURES } from './ddconfig.js'

const PRIMARY_TYPES = ['Firmenbuch-/Registerauszug', 'Jahresabschluss']
const TITLES = /\b(dr|mag|ing|di|dipl|kommr|komm|rat|mba|bsc|msc|ll\.?m|prof|univ|med|jur|rer|pol|nat|techn|ba|ma|frau|herr|hr|fr|geb|geboren)\b\.?/gi
const SUFFIX = /\b(sen|senior|jun|junior|jr|sr)\b\.?/gi
// Ids derived from the content, so a new document does not renumber what the issue reviews see (cache).
const stableId = (prefix, x) => `${prefix}-${crypto.createHash('sha256').update(String(x)).digest('hex').slice(0, 5)}`
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
export const nameTokens = (s) => norm(String(s || '').replace(TITLES, ' ').replace(SUFFIX, ' ').replace(/\d+/g, ' ')).split(' ').filter((w) => w.length >= 2)
const suffixOf = (s) => { const m = String(s || '').match(/\b(sen|senior|sr|jun|junior|jr)\b/i); return m ? (/^s/i.test(m[1]) ? 'sen' : 'jun') : '' }
/** Two spellings of one person or company (titles, order and middle names do not matter). */
export function sameName(a, b) {
  const x = nameTokens(a), y = nameTokens(b)
  if (!x.length || !y.length) return false
  const [small, big] = x.length <= y.length ? [x, y] : [y, x]
  const hit = small.filter((w) => big.includes(w)).length
  return hit === small.length && (hit >= 2 || (small.length === 1 && big.length <= 2))
}
const COMPANY = /\b(gmbh|gesmbh|ag|kg|og|kgaa|se|e\s?u|flexkapg|gesellschaft|bank|sparkasse|raiffeisen|versicherung|stiftung|verein|genossenschaft|gemeinde|stadt|land|republik|bezirkshauptmannschaft|bh|magistrat|amt|ministerium|beh[öo]rde|finanzamt|ltd|inc|llc|s\.?a\.?r\.?l|b\.?v\.?)\b/i
/** Date of birth (JJJJ-MM-TT, also TT.MM.JJJJ) or Firmenbuch number, normalised. */
function normIdent(s) {
  const t = String(s || '').trim()
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return { kind: 'date', value: t }
  m = t.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/); if (m) return { kind: 'date', value: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }
  m = t.replace(/^fn\s*/i, '').match(/^(\d{1,7})\s?([a-z])$/i); if (m) return { kind: 'fn', value: `FN ${m[1]}${m[2].toLowerCase()}` }
  return null
}
const isoDate = (s) => { const n = normIdent(s); return n?.kind === 'date' ? n.value : /^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(s || '')) ? String(s) : '' }
const valueNorm = (f) => (f.amount != null ? String(Math.round(f.amount * 100) / 100) : norm(f.value))
const PERSONISH = ['gesellschafter', 'organ', 'prokura', 'todesfall', 'funktionstraeger']
const keyOf = (f) => [f.type, PERSONISH.includes(f.type) ? nameTokens(f.subject).sort().join(' ') + '|' + (f.ident || '') : norm(f.subject), norm(f.attribute), f.type === 'kennzahl' ? String(f.validFrom || '').slice(0, 4) : '', norm(f.counterparty), norm(f.site)].join('|')
const overlaps = (a, b) => { const s1 = a.validFrom || '', e1 = a.validTo || '9999', s2 = b.validFrom || '', e2 = b.validTo || '9999'; return (!s1 && !s2) || (s1 <= e2 && s2 <= e1) }
const splitNames = (s) => String(s || '').split(/[,;/]|\s+und\s+|\s+sowie\s+/i).map((x) => x.trim()).filter((x) => nameTokens(x).length)

/** Builds the Akt model from the documents' facts and the reviewer corrections. */
export function buildAktModel(matter) {
  const entries = new Map(), contradictions = []
  const docs = matter.documents.filter((d) => Array.isArray(d.facts) && !d.duplicateOf && d.role !== 'Sekundärquelle' && !(d.status === 'skipped' && d.skipReason !== 'role'))
  docs.sort((a, b) => (PRIMARY_TYPES.includes(b.docType) - PRIMARY_TYPES.includes(a.docType)) || String(a.date || '').localeCompare(String(b.date || '')))
  for (const d of docs) {
    d.facts.forEach((f, i) => {
      if (!FACT_TYPES[f.type]) return
      const ident = normIdent(f.ident)
      const e = { id: `${d.no || d.id}#${i + 1}`, type: f.type, subject: f.subject, ident: ident?.value || '', attribute: f.attribute, value: f.value, amount: f.amount ?? null, counterparty: f.counterparty || '', site: f.site || '', validFrom: isoDate(f.valid_from), validTo: isoDate(f.valid_to), flags: f.flags || [], primary: PRIMARY_TYPES.includes(d.docType), docDate: d.date || '', evidence: [{ docId: d.id, docNo: d.no || '', docName: d.name, location: f.location || '', quote: f.quote || '', status: f.evidence || '' }] }
      const k = keyOf(e)
      const prev = entries.get(k)
      if (!prev) { entries.set(k, e); return }
      if (valueNorm(prev) === valueNorm(e)) { prev.evidence.push(...e.evidence); for (const fl of e.flags) if (!prev.flags.includes(fl)) prev.flags.push(fl); prev.validTo ||= e.validTo; return }
      if (!overlaps(prev, e)) { entries.set(k + '|' + (e.validFrom || e.id), e); return }
      const keep = prev.primary && !e.primary ? prev : e, drop = keep === prev ? e : prev
      contradictions.push({ id: stableId('W', [keep.id, drop.id].sort().join('|')), type: e.type, subject: e.subject, attribute: e.attribute, values: [keep, drop].map((x) => ({ value: x.value, amount: x.amount, docNo: x.evidence[0].docNo, docId: x.evidence[0].docId, location: x.evidence[0].location })), resolved: keep.value, reason: keep.primary && !drop.primary ? 'Firmenbuch/Jahresabschluss hat Vorrang' : 'jüngeres Dokument', factIds: [keep.id, drop.id] })
      entries.set(k, keep)
    })
  }
  const list = [...entries.values()]
  for (const c of matter.factCorrections || []) {
    if (c.action === 'add') { list.push({ id: c.id, type: c.type, subject: c.subject || '', ident: normIdent(c.ident)?.value || '', attribute: c.attribute || '', value: c.value || '', amount: c.amount ?? null, counterparty: c.counterparty || '', site: c.site || '', validFrom: isoDate(c.validFrom), validTo: isoDate(c.validTo), flags: c.flags || [], primary: true, corrected: true, note: c.note || '', evidence: [] }); continue }
    const e = list.find((x) => x.id === c.factId)
    if (!e) continue
    if (c.action === 'delete') { e.deleted = true; e.note = c.note || ''; continue }
    for (const k of ['value', 'amount', 'validFrom', 'validTo', 'flags', 'subject', 'counterparty', 'ident']) if (k in c && c[k] !== undefined) e[k] = c[k]
    e.corrected = true; e.note = c.note || ''
  }
  const facts = list.filter((e) => !e.deleted)
  const { entities, ambiguities } = resolveEntities(facts)
  return { entries: facts, entities, ambiguities, contradictions, deleted: list.length - facts.length, builtAt: Date.now(), documents: docs.length }
}

/** Persons and companies across the Akt; every fact gets the keys of the entities it names. */
function resolveEntities(facts) {
  const mentions = []
  for (const f of facts) {
    f.entityKeys = []
    if (PERSONISH.includes(f.type) || f.type === 'kennzahl') mentions.push({ name: f.subject, ident: f.ident, f, role: 'subject' })
    if (f.counterparty && ['vertrag', 'zahlung_gesellschafter', 'genehmigung', 'standort', 'recht_dritter', 'funktionstraeger'].includes(f.type)) mentions.push({ name: f.counterparty, ident: '', f, role: f.type === 'funktionstraeger' ? 'authority' : 'counterparty' })
    if (f.type === 'beschluss') for (const n of splitNames(f.value)) mentions.push({ name: n, ident: '', f, role: 'voter' })
  }
  // Mentions with an identifier first: they define the entities; the others are attached afterwards.
  mentions.sort((a, b) => Boolean(b.ident) - Boolean(a.ident))
  const entities = []
  for (const m of mentions) {
    if (!nameTokens(m.name).length) continue
    const id = normIdent(m.ident)
    const kind = id?.kind === 'fn' || COMPANY.test(m.name) ? 'company' : id?.kind === 'date' ? 'person' : PERSONISH.includes(m.f.type) && m.role === 'subject' && m.f.type !== 'kennzahl' ? 'person' : 'company'
    const suf = suffixOf(m.name)
    const cands = entities.filter((e) => e.kind === kind && !e.unclear && sameName(e.name, m.name) && (!suf || !e.suffix || e.suffix === suf))
    let ent = null
    if (id) ent = cands.find((e) => e.ident === id.value) || null
    else {
      const withId = cands.filter((e) => e.ident)
      if (withId.length === 1 || (withId.length === 0 && cands.length)) ent = withId[0] || cands[0]
      else if (withId.length > 1) {
        // Several namesakes with different identifiers: the mention is not assigned to one of them.
        ent = entities.find((e) => e.unclear && sameName(e.name, m.name))
        if (!ent) { ent = newEntity(entities, kind, m.name, '', suf); ent.key += ':unklar'; ent.id = stableId('E', ent.key); ent.unclear = true; ent.candidates = withId.map((e) => e.key) }
      }
    }
    if (!ent) ent = newEntity(entities, kind, m.name, id?.value || '', suf)
    ent.mentions.push({ factId: m.f.id, role: m.role, name: m.name })
    if (!ent.aliases.includes(m.name)) ent.aliases.push(m.name)
    for (const ev of m.f.evidence || []) if (ev.docNo && !ent.docNos.includes(ev.docNo)) ent.docNos.push(ev.docNo)
    if (!m.f.entityKeys.includes(ent.key)) m.f.entityKeys.push(ent.key)
    if (m.role === 'subject') m.f.subjectKey = ent.key // the person or company the fact is about (not the authority)
  }
  // Functions, death, departure per entity.
  for (const e of entities) {
    for (const mn of e.mentions) {
      const f = facts.find((x) => x.id === mn.factId)
      if (!f || mn.role !== 'subject') continue
      if (['organ', 'prokura', 'funktionstraeger', 'gesellschafter'].includes(f.type)) e.functions.push({ type: f.type, attribute: f.attribute || FACT_TYPES[f.type], counterparty: f.counterparty, value: f.value, validFrom: f.validFrom, validTo: f.validTo, docDate: f.docDate, factId: f.id, docNo: f.evidence?.[0]?.docNo || '' })
      if (f.type === 'todesfall') e.deceased = { date: f.validTo || f.validFrom || '', factId: f.id, docNo: f.evidence?.[0]?.docNo || '' }
      else if (f.flags.includes('verstorben') && !e.deceased) e.deceased = { date: f.validTo || '', factId: f.id, docNo: f.evidence?.[0]?.docNo || '' }
      if (f.flags.includes('ausgeschieden')) e.left.push({ date: f.validTo || '', factId: f.id, attribute: f.attribute })
    }
  }
  // Namesakes: persons with the same name but different identifiers, and unassigned mentions.
  const ambiguities = []
  const persons = entities.filter((e) => e.kind === 'person')
  const seen = new Set()
  for (const e of persons) {
    if (seen.has(e.key)) continue
    const group = persons.filter((x) => sameName(x.name, e.name))
    if (group.length < 2 || (group.filter((x) => x.ident).length < 2 && !group.some((x) => x.unclear))) continue
    group.forEach((x) => seen.add(x.key))
    ambiguities.push({ id: stableId('N', group.map((x) => x.key).sort().join('|')), name: e.name, entities: group.map((x) => x.key), note: `${group.length} Personen dieses Namens: ${group.map((x) => `${x.id}${x.ident ? ' geb. ' + x.ident : x.unclear ? ' (Zuordnung unklar)' : ' (ohne Geburtsdatum)'}${x.deceased ? ', verstorben ' + (x.deceased.date || '') : ''}`).join('; ')}` })
  }
  return { entities, ambiguities }
}
function newEntity(entities, kind, name, ident, suffix) {
  const key = `${kind}:${nameTokens(name).sort().join(' ')}${suffix ? ':' + suffix : ''}:${ident || (kind === 'person' ? '?' : '')}`
  const e = { id: stableId('E', key), key, kind, name: String(name).trim(), ident, suffix, aliases: [], mentions: [], docNos: [], functions: [], deceased: null, left: [], unclear: false, candidates: [] }
  entities.push(e)
  return e
}

/** Facts of one type (optionally filtered). */
export const factsOf = (model, type, pred = () => true) => (model?.entries || []).filter((e) => e.type === type && pred(e))
export const entityOf = (model, key) => (model?.entities || []).find((e) => e.key === key)
/** Persons who died (with date and source). */
export const deceased = (model) => (model?.entities || []).filter((e) => e.deceased).map((e) => ({ name: e.name, date: e.deceased.date, entity: e }))
/** Latest key figures (one per attribute). */
export function keyFigures(model) {
  const out = {}
  for (const e of factsOf(model, 'kennzahl')) {
    const k = [...KEY_FIGURES].sort((a, b) => b.length - a.length).find((x) => norm(e.attribute).includes(norm(x))) || e.attribute
    if (!out[k] || String(e.validFrom) > String(out[k].validFrom)) out[k] = e
  }
  return out
}

const factLine = (e, model) => `[${e.id}] ${FACT_TYPES[e.type] || e.type}: ${e.subject}${e.ident ? ` (${e.ident})` : ''}${e.attribute ? ` – ${e.attribute}` : ''}: ${e.value}${e.amount != null && !String(e.value).includes(String(e.amount)) ? ` (${e.amount.toLocaleString('de-DE')})` : ''}${e.counterparty ? ` · ${e.counterparty}` : ''}${e.site ? ` · Standort ${e.site}` : ''}${e.validFrom || e.validTo ? ` · ${e.validFrom || '…'}–${e.validTo || '…'}` : ''}${e.flags.length ? ` [${e.flags.join(', ')}]` : ''}${e.entityKeys?.length ? ` {${e.entityKeys.map((k) => entityOf(model, k)?.id).filter(Boolean).join(', ')}}` : ''} (${e.evidence.map((x) => x.docNo + (x.location ? ' ' + x.location : '')).filter(Boolean).slice(0, 4).join('; ') || 'Korrektur'})`
const entityLine = (e) => `${e.id} ${e.kind === 'person' ? 'Person' : 'Gesellschaft/Stelle'} ${e.name}${e.ident ? ` (${e.kind === 'person' ? 'geb. ' : ''}${e.ident})` : ''}${e.unclear ? ' – ZUORDNUNG UNKLAR (namensgleiche Personen)' : ''}${e.deceased ? ` – verstorben ${e.deceased.date || '(Datum offen)'} [${e.deceased.docNo}]` : ''}${e.left.length ? ' – ausgeschieden' : ''}${e.functions.length ? ` – ${e.functions.map((f) => `${f.attribute}${f.counterparty ? ' (' + f.counterparty + ')' : ''} ${f.docNo}${f.docDate ? ' ' + f.docDate : ''}`).slice(0, 12).join('; ')}` : ''} · Dokumente: ${e.docNos.slice(0, 15).join(', ')}`

/**
 * Text of the Akt model for the model passes. Without a filter the whole model (stage 4);
 * with { entityKeys, factIds } the slice one issue needs (stage 5).
 */
export function aktText(matter, model, { entityKeys = null, factIds = null, types = null, maxChars = 400_000 } = {}) {
  const s = matter.settings
  const head = `ZIELGESELLSCHAFT: ${s.target || '(nicht angegeben)'}${s.targetFn ? ` · FN ${s.targetFn}` : ''} · ${s.transaction === 'asset' ? 'Asset Deal' : 'Share Deal'}${s.stichtag ? ` · Stichtag ${s.stichtag}` : ''}${s.closing ? ` · Closing ${s.closing}` : ''} · ${s.sellers === 'partial' ? 'nicht alle Gesellschafter verkaufen' : 'alle Gesellschafter verkaufen'}`
  const ek = entityKeys ? new Set(entityKeys) : null
  const fk = factIds ? new Set(factIds) : null
  const inSlice = (f) => !ek && !fk ? true : (fk?.has(f.id) || (ek && (f.entityKeys || []).some((k) => ek.has(k))))
  const ents = (model.entities || []).filter((e) => (!ek || ek.has(e.key) || e.candidates.some((c) => ek.has(c))) && (!types || e.functions.length || e.deceased))
  const out = [head, '\nENTITÄTEN:', ...ents.map(entityLine)]
  const amb = (model.ambiguities || []).filter((a) => !ek || a.entities.some((k) => ek.has(k)))
  if (amb.length) out.push('\nNAMENSGLEICHE PERSONEN:', ...amb.map((a) => `${a.id} ${a.note}`))
  for (const type of Object.keys(FACT_TYPES)) {
    if (types && !types.includes(type)) continue
    const fs = factsOf(model, type, inSlice)
    if (fs.length) out.push(`\n${FACT_TYPES[type].toUpperCase()}:`, ...fs.map((e) => factLine(e, model)))
  }
  const contra = (model.contradictions || []).filter((c) => !ek && !fk ? true : c.factIds.some((id) => fk?.has(id) || (model.entries.find((x) => x.id === id)?.entityKeys || []).some((k) => ek?.has(k))))
  if (contra.length) out.push('\nWIDERSPRÜCHE:', ...contra.map((c) => `${c.id} ${c.subject} ${c.attribute}: ${c.values.map((v) => `${v.value} (${v.docNo})`).join(' vs. ')} → ${c.resolved} (${c.reason})`))
  return out.join('\n').slice(0, maxChars)
}

/** Document list: number, type, role, date, title. */
export const documentList = (matter) => matter.documents.filter((d) => !d.container).map((d) => `${d.no || ''} | ${d.docType || '?'} | ${d.role || '?'}${d.duplicateOf ? ' (Duplikat)' : ''} | ${d.date || ''} | ${(d.title || d.name).slice(0, 90)}`).join('\n')
