// Stage 4 of the due diligence: the issues (Sachverhalte) of the Akt – each one exactly once.
//
// Sources, all keyed by a stable key so the same matter never appears twice:
//   - rules over the Akt model (functionary died or left without a successor, namesakes in a
//     function, change of control in a share deal, expiry before Stichtag/closing, payments to
//     shareholders without a contract, resolution without all shareholders, contradictions);
//   - clauses of the documents, bundled per kind and counterparty (the same clause in five
//     documents is one issue with five pieces of evidence);
//   - one model pass over the whole Akt model for further questions (kept on the matter);
//   - reviewer operations: merged issues, clauses moved or removed, issues created by hand.
// Conclusions are drawn only at this level; the documents deliver facts and clauses.
import { CLAUSE_KINDS, FACT_TYPES } from './ddconfig.js'
import { factsOf, sameName, nameTokens, entityOf } from './aktmodel.js'
import { terms } from './search.js'

const iso = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : /^\d{4}$/.test(String(s || '')) ? `${s}-12-31` : '')
const today = () => new Date().toISOString().slice(0, 10)
const tokens = (s) => [...terms(s), ...(String(s || '').toLowerCase().match(/\b\d+[a-z]?\b/g) || [])]
export const keyPart = (s) => [...new Set(tokens(s))].sort().join(' ')
const fnKey = (a) => keyPart(String(a || '').replace(/für.*$/i, ''))
const docIdsOf = (facts) => [...new Set(facts.flatMap((f) => (f.evidence || []).map((x) => x.docId)).filter(Boolean))]

function seed(map, key, x) {
  const s = map.get(key) || { key, source: x.source, rule: x.rule || '', title: x.title, question: x.question || '', area: x.area || 'none', entityKeys: new Set(), factIds: new Set(), docIds: new Set(), findingIds: [], hints: [] }
  for (const k of x.entityKeys || []) s.entityKeys.add(k)
  for (const k of x.factIds || []) s.factIds.add(k)
  for (const k of x.docIds || []) s.docIds.add(k)
  for (const k of x.findingIds || []) if (!s.findingIds.includes(k)) s.findingIds.push(k)
  if (x.hint) s.hints.push(x.hint)
  map.set(key, s)
  return s
}

/** Issues from rules over the Akt model. */
export function ruleIssues(matter, model, map = new Map()) {
  const s = matter.settings
  const ref = iso(s.closing) || iso(s.stichtag) || today()
  const facts = model.entries || []
  const byId = new Map(facts.map((f) => [f.id, f]))
  // Functionaries and organs who died or left: one issue per person with all functions they held.
  for (const e of model.entities || []) {
    if (!e.functions.length || (!e.deceased && !e.left.length)) continue
    const gone = e.deceased ? `verstorben ${e.deceased.date || ''}`.trim() : 'ausgeschieden'
    const at = e.deceased?.date || e.left[0]?.date || ''
    const fns = e.functions.filter((f) => f.type !== 'gesellschafter')
    if (!fns.length) continue
    // A function counts as succeeded when a different, living person holds it in a later document.
    const open = fns.filter((f) => !facts.some((x) => ['funktionstraeger', 'organ', 'prokura'].includes(x.type) && fnKey(x.attribute) === fnKey(f.attribute) && !(x.entityKeys || []).includes(e.key) && (x.entityKeys || []).some((k) => { const p = entityOf(model, k); return p && !p.deceased && !p.left.length }) && ((x.docDate && at && x.docDate > at) || (x.validFrom && at && x.validFrom > at))))
    if (!open.length) continue
    const attrs = [...new Set(open.map((f) => f.attribute))]
    seed(map, `FUNKTION|${e.key}`, { source: 'regel', rule: 'AKT-001', area: open.some((f) => f.type === 'funktionstraeger') ? 'compliance' : 'gesellschaft', title: `${attrs.join(', ')}: ${e.name} ${gone}`, question: `Ist für jede Funktion (${attrs.join('; ')}) eine wirksame Nachfolge belegt, und hängt eine Berechtigung der Zielgesellschaft daran? Frist nach dem Materiengesetz nur als Prüfpunkt, keine Fristberechnung.`, entityKeys: [e.key], factIds: [...open.map((f) => f.factId), e.deceased?.factId, ...e.left.map((l) => l.factId)].filter(Boolean), docIds: docIdsOf([...open.map((f) => byId.get(f.factId)), byId.get(e.deceased?.factId)].filter(Boolean)) })
  }
  // Namesakes in a function or as shareholder: who is meant has to be clarified once.
  for (const a of model.ambiguities || []) {
    const ents = a.entities.map((k) => entityOf(model, k)).filter(Boolean)
    if (!ents.some((x) => x.functions.length)) continue
    const fs = facts.filter((f) => (f.entityKeys || []).some((k) => a.entities.includes(k)))
    seed(map, `IDENT|${nameTokens(a.name).sort().join(' ')}`, { source: 'regel', rule: 'AKT-006', area: 'gesellschaft', title: `Identität „${a.name}“ unklar: namensgleiche Personen in Funktionen`, question: 'Welche Person ist in welcher Funktion bzw. in welchem Bescheid gemeint (Geburtsdaten), und ist jede Funktion von einer lebenden, wirksam bestellten Person besetzt?', entityKeys: a.entities, factIds: fs.map((f) => f.id), docIds: docIdsOf(fs) })
  }
  // Change of control meets a share deal: one issue per counterparty (same key as the clauses).
  if (s.transaction !== 'asset') for (const f of factsOf(model, 'vertrag', (x) => x.flags.includes('kontrollwechsel'))) {
    const cp = (f.entityKeys || [])[0] || keyPart(f.counterparty || f.subject)
    seed(map, `KL|kontrollwechsel|${cp}`, { source: 'regel', rule: 'AKT-002', area: /kredit|darlehen|finanzier|leasing|bank|sparkasse|raiffeisen|bürgschaft|garantie/i.test(`${f.subject} ${f.counterparty}`) ? 'finanzierung' : 'vertraege', title: `Kontrollwechselklausel ${f.counterparty || f.subject}`, question: 'Löst der geplante Share Deal die Klausel aus, mit welcher Folge, und ist eine Zustimmung bzw. ein Verzicht belegt?', entityKeys: f.entityKeys, factIds: [f.id], docIds: docIdsOf([f]) })
  }
  // Expiry before the reference date without a renewal in the Akt.
  for (const f of [...factsOf(model, 'genehmigung'), ...factsOf(model, 'vertrag'), ...factsOf(model, 'standort')]) {
    const end = iso(f.validTo)
    if (!end || end >= ref || f.flags.includes('gekuendigt') || f.flags.includes('erloschen')) continue
    const renewed = facts.some((x) => x !== f && x.type === f.type && (keyPart(x.subject) === keyPart(f.subject) || (x.site && x.site === f.site && x.attribute === f.attribute)) && ((x.validTo && x.validTo >= ref) || (!x.validTo && x.validFrom && x.validFrom >= end)))
    if (renewed) continue
    seed(map, `FRIST|${f.type}|${keyPart(f.subject)}`, { source: 'regel', rule: 'AKT-003', area: f.type === 'genehmigung' ? 'compliance' : f.type === 'standort' ? 'immobilien' : 'vertraege', title: `${FACT_TYPES[f.type]} befristet bis ${end}: ${f.subject}`, question: `Endet ${f.subject} vor ${s.closing ? 'dem Closing' : 'dem Stichtag'} (${ref}), und ist eine Verlängerung oder Nachfolge belegt?`, entityKeys: f.entityKeys, factIds: [f.id], docIds: docIdsOf([f]) })
  }
  // Payments to shareholders without a contract in the Akt or above it.
  const contracts = factsOf(model, 'vertrag')
  for (const p of factsOf(model, 'zahlung_gesellschafter')) {
    if (/aussch[üu]ttung|dividende|gewinnanteil|gewinnverteilung/i.test(`${p.attribute} ${p.value} ${p.subject}`)) continue
    const who = p.counterparty || p.subject
    const c = contracts.filter((v) => sameName(v.counterparty, who) || sameName(v.subject, who))
    const cap = c.reduce((m, v) => Math.max(m, v.amount || 0), 0)
    if (c.length && !(p.amount && cap && p.amount > cap * 1.05)) continue
    seed(map, `ZAHLUNG|${(p.entityKeys || [])[0] || keyPart(who)}`, { source: 'regel', rule: 'AKT-004', area: 'gesellschaft', title: c.length ? `Zahlungen an ${who} über dem Vertragswert` : `Zahlungen an ${who} ohne Vertrag im Akt`, question: 'Gibt es eine fremdübliche Vertragsgrundlage, oder liegt eine verbotene Einlagenrückgewähr bzw. verdeckte Ausschüttung vor?', entityKeys: p.entityKeys, factIds: [p.id, ...c.map((v) => v.id)], docIds: docIdsOf([p, ...c]) })
  }
  // Resolutions without all shareholders registered at that time.
  const sh = factsOf(model, 'gesellschafter')
  const shPrimary = sh.some((e) => e.primary) ? sh.filter((e) => e.primary) : sh
  for (const b of factsOf(model, 'beschluss')) {
    const at = iso(b.validFrom) || ref
    const members = shPrimary.filter((e) => (!e.validFrom || e.validFrom <= at) && (!e.validTo || e.validTo >= at))
    const voters = String(b.value || '').split(/[,;/]|\s+und\s+/i).map((x) => x.trim()).filter((x) => nameTokens(x).length)
    if (!members.length || !voters.length) continue
    const missing = members.filter((m) => !voters.some((v) => sameName(v, m.subject)))
    if (!missing.length) continue
    seed(map, `BESCHLUSS|${keyPart(b.subject)}|${at}`, { source: 'regel', rule: 'AKT-005', area: 'gesellschaft', title: `Beschluss ohne alle Gesellschafter: ${b.subject}`, question: `Haben alle zum ${at} eingetragenen Gesellschafter mitgewirkt (fehlend laut Akt: ${missing.map((m) => m.subject).join(', ')}), und ist der Beschluss wirksam?`, entityKeys: [...(b.entityKeys || []), ...missing.flatMap((m) => m.entityKeys || [])], factIds: [b.id, ...missing.map((m) => m.id)], docIds: docIdsOf([b, ...missing]) })
  }
  // Contradictions about shares, organs, functionaries and permits.
  for (const c of model.contradictions || []) {
    if (!['gesellschafter', 'organ', 'funktionstraeger', 'genehmigung', 'prokura'].includes(c.type)) continue
    const fs = c.factIds.map((id) => byId.get(id)).filter(Boolean)
    seed(map, `WID|${c.type}|${keyPart(c.subject)}`, { source: 'regel', rule: 'AKT-007', area: c.type === 'genehmigung' || c.type === 'funktionstraeger' ? 'compliance' : 'gesellschaft', title: `Widerspruch: ${c.subject} – ${c.attribute}`, question: `Welche Angabe stimmt (${c.values.map((v) => `${v.value} laut ${v.docNo}`).join(' / ')})?`, entityKeys: fs.flatMap((f) => f.entityKeys || []), factIds: c.factIds, docIds: c.values.map((v) => v.docId) })
  }
  return map
}

/** Key of a clause: kind and counterparty (as entity where resolved), else kind and subject. */
export function clauseKey(f, model) {
  const cp = f.gegenpartei || f.counterparty || ''
  const ent = cp ? (model.entities || []).find((e) => e.aliases.some((a) => sameName(a, cp))) : null
  const who = ent?.key || keyPart(cp)
  const prefix = f.quelle === 'hypothese' ? 'HYP' : 'KL'
  return ['kontrollwechsel', 'haftung', 'kuendigung_laufzeit', 'exklusivitaet_wettbewerb', 'abtretung_zustimmung', 'vertragsstrafe', 'finanzierung_sicherheiten'].includes(f.kind) && who ? `${prefix}|${f.kind}|${who}` : `${prefix}|${f.kind}|${keyPart(f.gegenstand || f.title)}`
}

/** All issues of the Akt: rules, clauses, the model's Akt pass and the reviewer's operations. */
export function collectIssues(matter, model) {
  const map = ruleIssues(matter, model)
  const ops = (matter.themeOps ||= { assign: {}, merges: {}, manual: [] })
  for (const f of matter.findings || []) {
    if (f.excluded) continue
    const assigned = ops.assign[f.key]
    if (assigned === 'removed') continue
    const k = assigned || clauseKey(f, model)
    const kind = CLAUSE_KINDS[f.kind] || CLAUSE_KINDS.sonstiges
    seed(map, k, { source: f.quelle === 'hypothese' ? 'hypothese' : 'klausel', rule: f.rule, area: f.area || kind.area, title: f.title, question: f.quelle === 'hypothese' ? `Eine Sekundärquelle behauptet: ${f.title}. Ist das durch Originalunterlagen belegt?` : `Welches Risiko ergibt sich aus ${kind.label.toLowerCase()} (${f.gegenpartei || f.gegenstand}) für die Transaktion?`, findingIds: [f.id], docIds: [f.docId] })
  }
  for (const a of matter.aktIssues || []) seed(map, a.key, { source: 'akt', area: a.area, title: a.title, question: a.question, entityKeys: a.entityKeys, docIds: a.docIds })
  for (const m of ops.manual || []) seed(map, m.key, { source: 'manuell', area: m.area, title: m.title, question: m.description || '' })
  // Merges by the reviewer: the evidence of the merged issue moves to the target.
  const resolve = (k) => { let x = k, n = 0; while (ops.merges[x] && n++ < 20) x = ops.merges[x]; return x }
  for (const [from] of Object.entries(ops.merges)) {
    const to = resolve(from)
    const s = map.get(from), t = map.get(to)
    if (!s || !t || s === t) continue
    for (const k of s.entityKeys) t.entityKeys.add(k)
    for (const k of s.factIds) t.factIds.add(k)
    for (const k of s.docIds) t.docIds.add(k)
    for (const k of s.findingIds) if (!t.findingIds.includes(k)) t.findingIds.push(k)
    t.hints.push(`Zusammengeführt mit: ${s.title}`)
    map.delete(from)
  }
  return [...map.values()].map((s) => ({ ...s, entityKeys: [...s.entityKeys], factIds: [...s.factIds], docIds: [...s.docIds] }))
}
