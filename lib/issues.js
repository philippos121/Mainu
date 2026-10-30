// Stage 4 of the due diligence: the issues (Sachverhalte) of the Akt – each one exactly once.
//
// Sources, all keyed by a stable key so the same matter never appears twice:
//   - the Akt rules of the catalogue (AKT_RULES in lib/ddconfig.js, each with its legal basis
//     and scope), evaluated on the Akt model; requirements for functionaries come from the base
//     catalogue and the industry modules selected for the due diligence;
//   - clauses of the documents, bundled per kind and counterparty (the same clause in five
//     documents is one issue with five pieces of evidence);
//   - one model pass over the whole Akt model for further questions (kept on the matter);
//   - reviewer operations: merged issues, clauses moved or removed, issues created by hand.
// Conclusions are drawn only at this level; the documents deliver facts and clauses.
import { CLAUSE_KINDS, FACT_TYPES, AKT_RULES, CAPITAL_COMPANIES, requirementsFor, legalFormOf } from './ddconfig.js'
import { factsOf, sameName, nameTokens, entityOf } from './aktmodel.js'
import { terms } from './search.js'

const iso = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : /^\d{4}$/.test(String(s || '')) ? `${s}-12-31` : '')
const today = () => new Date().toISOString().slice(0, 10)
const tokens = (s) => [...terms(s), ...(String(s || '').toLowerCase().match(/\b\d+[a-z]?\b/g) || [])]
export const keyPart = (s) => [...new Set(tokens(s))].sort().join(' ')
const fnKey = (a) => keyPart(String(a || '').replace(/für.*$/i, ''))
const docIdsOf = (facts) => [...new Set(facts.flatMap((f) => (f.evidence || []).map((x) => x.docId)).filter(Boolean))]
const RULE = Object.fromEntries(AKT_RULES.map((r) => [r.id, r]))
const KEY_FUNCTIONS = ['gesellschafter', 'organ', 'funktionstraeger']

function seed(map, key, x) {
  const s = map.get(key) || { key, source: x.source, rule: x.rule || '', basis: x.basis || '', title: x.title, question: x.question || '', area: x.area || 'none', entityKeys: new Set(), factIds: new Set(), docIds: new Set(), findingIds: [], hints: [] }
  for (const k of x.entityKeys || []) s.entityKeys.add(k)
  for (const k of x.factIds || []) s.factIds.add(k)
  for (const k of x.docIds || []) s.docIds.add(k)
  for (const k of x.findingIds || []) if (!s.findingIds.includes(k)) s.findingIds.push(k)
  if (x.hint) s.hints.push(x.hint)
  map.set(key, s)
  return s
}
const ruleSeed = (map, key, id, x) => seed(map, key, { source: 'regel', rule: id, ...x, area: x.area || RULE[id].area, basis: x.basis || RULE[id].basis, question: `${x.question} (Regel ${id}: ${RULE[id].label}; Rechtsgrundlage: ${x.basis || RULE[id].basis})` })

/** Issues from the Akt rules of the catalogue. */
export function ruleIssues(matter, model, map = new Map()) {
  const s = matter.settings
  const form = legalFormOf(s)
  const ref = iso(s.closing) || iso(s.stichtag) || today()
  const facts = model.entries || []
  const byId = new Map(facts.map((f) => [f.id, f]))
  const ent = (k) => entityOf(model, k)
  // Available: alive, not departed, and assigned to one person (a mention without identifier among
  // several namesakes is "unclear"). Whether namesakes are in truth one person is not decided by a
  // rule – AKT-003 makes it an issue of its own, and the review decides with the documents.
  const holder = (f) => (f.subjectKey ? [f.subjectKey] : [])
  const available = (keys) => (keys || []).some((k) => { const p = ent(k); return p && !p.deceased && !p.left.length && !p.unclear })
  const goneText = (keys) => [...new Set((keys || []).map(ent).filter(Boolean).map((p) => (p.deceased ? `${p.name} verstorben ${p.deceased.date || ''}`.trim() : p.left.length ? `${p.name} ausgeschieden` : p.unclear ? `${p.name} – Zuordnung unklar` : '')).filter(Boolean))].join('; ')
  const goneFacts = (keys) => (keys || []).map(ent).filter(Boolean).flatMap((p) => [p.deceased?.factId, ...p.left.map((l) => l.factId)]).filter(Boolean)
  const sameDoc = (a, b) => (a.evidence || []).some((x) => (b.evidence || []).some((y) => y.docId === x.docId))
  // Two significant terms in common (one word such as a place or an activity is not enough).
  const overlap = (a, b) => { const x = new Set(tokens(a).filter((w) => w.length > 3)); return new Set(tokens(b).filter((w) => w.length > 3 && x.has(w))).size >= 2 }
  const covered = new Map() // fact id of a functionary → key of the issue that already covers it

  // AKT-001 a permit needs a person in a function: is someone available and validly appointed?
  for (const req of requirementsFor(s)) {
    if (req.legalPerson && form === 'e.U.') continue
    const permitRx = new RegExp(req.permit, 'i'), fnRx = new RegExp(req.fn, 'i')
    const fnFacts = facts.filter((f) => ['funktionstraeger', 'organ'].includes(f.type) && fnRx.test(f.attribute || ''))
    const permits = factsOf(model, 'genehmigung', (g) => permitRx.test(`${g.subject} ${g.attribute}`) && !g.flags.includes('erloschen') && !(g.validTo && g.validTo < ref) && !(g.counterparty && s.target && !sameName(g.counterparty, s.target)))
    for (const g of permits) {
      const linked = fnFacts.filter((f) => sameDoc(f, g) || overlap(`${f.value} ${f.counterparty}`, g.subject))
      const cands = linked.length ? linked : fnFacts
      const current = cands.filter((f) => available(holder(f)) && !(f.validTo && f.validTo < ref) && !f.flags.includes('ausgeschieden'))
      if (current.length) continue
      const key = `BERECHTIGUNG|${req.id}|${keyPart(g.subject)}`
      for (const f of cands) covered.set(f.id, key)
      const why = cands.length ? goneText(cands.flatMap(holder)) || 'nicht mehr bestellt' : `kein ${req.label} im Akt`
      ruleSeed(map, key, 'AKT-001', { area: 'compliance', basis: req.basis, title: `${g.subject}: ${req.label} – ${why}`, question: `Ist für die Berechtigung „${g.subject}“ ein ${req.label} wirksam bestellt und verfügbar? Wer war bestellt, was ist mit dieser Person, gibt es eine Nachfolge oder Anzeige? Frist nur als Prüfpunkt, keine Fristberechnung.`, entityKeys: cands.flatMap((f) => f.entityKeys || []), factIds: [g.id, ...cands.map((f) => f.id), ...goneFacts(cands.flatMap(holder))], docIds: docIdsOf([g, ...cands]) })
    }
  }

  // AKT-002 organs and functionaries who died or left, without a successor (where not covered by AKT-001)
  for (const e of model.entities || []) {
    if (!e.deceased && !e.left.length) continue
    const at = e.deceased?.date || e.left[0]?.date || ''
    const open = e.functions.filter((f) => ['funktionstraeger', 'organ'].includes(f.type) && !covered.has(f.factId)).filter((f) => !facts.some((x) => ['funktionstraeger', 'organ'].includes(x.type) && fnKey(x.attribute) === fnKey(f.attribute) && !holder(x).includes(e.key) && available(holder(x)) && ((x.docDate && at && x.docDate > at) || (x.validFrom && at && x.validFrom > at))))
    if (!open.length) continue
    const attrs = [...new Set(open.map((f) => f.attribute))]
    const key = `FUNKTION|${e.key}`
    for (const f of open) covered.set(f.factId, key)
    ruleSeed(map, key, 'AKT-002', { area: open.some((f) => f.type === 'funktionstraeger') ? 'compliance' : 'gesellschaft', title: `${attrs.join(', ')}: ${e.name} ${e.deceased ? `verstorben ${e.deceased.date || ''}`.trim() : 'ausgeschieden'}`, question: `Ist für jede Funktion (${attrs.join('; ')}) eine wirksame Nachfolge belegt, und was folgt daraus für die Zielgesellschaft?`, entityKeys: [e.key], factIds: [...open.map((f) => f.factId), ...goneFacts([e.key])], docIds: docIdsOf(open.map((f) => byId.get(f.factId)).filter(Boolean)) })
  }

  // AKT-003 namesakes in a key role (shareholder, organ, functionary) – only where it matters:
  // a mention cannot be assigned, two of them hold key roles, or one of them has died.
  for (const a of model.ambiguities || []) {
    const ents = a.entities.map(ent).filter(Boolean)
    const relevant = ents.filter((e) => e.functions.some((f) => KEY_FUNCTIONS.includes(f.type)))
    if (!relevant.length || !(relevant.some((e) => e.unclear) || relevant.length >= 2 || ents.some((e) => e.deceased))) continue
    const keyFacts = relevant.flatMap((e) => e.functions.filter((f) => KEY_FUNCTIONS.includes(f.type)).map((f) => f.factId))
    const hint = `Namensgleiche Personen: ${a.note}`
    // Already part of an issue about the same functions: the identity question goes there.
    const into = [...new Set(keyFacts.map((id) => covered.get(id)).filter(Boolean))]
    if (into.length && keyFacts.every((id) => covered.has(id))) { for (const k of into) seed(map, k, { source: 'regel', title: '', entityKeys: a.entities, hint }); continue }
    const fs = keyFacts.map((id) => byId.get(id)).filter(Boolean)
    ruleSeed(map, `IDENT|${nameTokens(a.name).sort().join(' ')}`, 'AKT-003', { title: `Identität „${a.name}“ unklar: namensgleiche Personen in Schlüsselrollen`, question: 'Welche Person ist in welcher Rolle bzw. in welchem Dokument gemeint (Geburtsdaten), und sind die Schlüsselrollen von einer lebenden, wirksam bestellten Person besetzt?', entityKeys: a.entities, factIds: fs.map((f) => f.id), docIds: docIdsOf(fs), hint })
  }

  // AKT-004 change of control meets a share deal: one issue per counterparty (same key as the clauses).
  if (s.transaction !== 'asset') for (const f of factsOf(model, 'vertrag', (x) => x.flags.includes('kontrollwechsel'))) {
    const cp = (f.entityKeys || [])[0] || keyPart(f.counterparty || f.subject)
    ruleSeed(map, `KL|kontrollwechsel|${cp}`, 'AKT-004', { area: /kredit|darlehen|finanzier|leasing|bank|sparkasse|raiffeisen|bürgschaft|garantie/i.test(`${f.subject} ${f.counterparty}`) ? 'finanzierung' : 'vertraege', title: `Kontrollwechselklausel ${f.counterparty || f.subject}`, question: 'Löst der geplante Share Deal die Klausel aus, mit welcher Folge, und ist eine Zustimmung bzw. ein Verzicht belegt?', entityKeys: f.entityKeys, factIds: [f.id], docIds: docIdsOf([f]) })
  }

  // AKT-005 expiry before the reference date without a renewal in the Akt.
  for (const f of [...factsOf(model, 'genehmigung'), ...factsOf(model, 'vertrag'), ...factsOf(model, 'standort')]) {
    const end = iso(f.validTo)
    if (!end || end >= ref || f.flags.includes('gekuendigt') || f.flags.includes('erloschen')) continue
    const renewed = facts.some((x) => x !== f && x.type === f.type && (keyPart(x.subject) === keyPart(f.subject) || (x.site && x.site === f.site && x.attribute === f.attribute)) && ((x.validTo && x.validTo >= ref) || (!x.validTo && x.validFrom && x.validFrom >= end)))
    if (renewed) continue
    ruleSeed(map, `FRIST|${f.type}|${keyPart(f.subject)}`, 'AKT-005', { area: f.type === 'genehmigung' ? 'compliance' : f.type === 'standort' ? 'immobilien' : 'vertraege', title: `${FACT_TYPES[f.type]} befristet bis ${end}: ${f.subject}`, question: `Endet ${f.subject} vor ${s.closing ? 'dem Closing' : 'dem Stichtag'} (${ref}), und ist eine Verlängerung oder Nachfolge belegt?`, entityKeys: f.entityKeys, factIds: [f.id], docIds: docIdsOf([f]) })
  }

  // AKT-006 payments to shareholders (capital companies only).
  if (!form || CAPITAL_COMPANIES.includes(form)) {
    const contracts = factsOf(model, 'vertrag')
    const basis = form === 'AG' ? '§ 52 AktG; § 8 Abs 2 KStG' : '§ 82 GmbHG; § 8 Abs 2 KStG'
    for (const p of factsOf(model, 'zahlung_gesellschafter')) {
      if (/aussch[üu]ttung|dividende|gewinnanteil|gewinnverteilung/i.test(`${p.attribute} ${p.value} ${p.subject}`)) continue
      const who = p.counterparty || p.subject
      const c = contracts.filter((v) => sameName(v.counterparty, who) || sameName(v.subject, who))
      const cap = c.reduce((m, v) => Math.max(m, v.amount || 0), 0)
      if (c.length && !(p.amount && cap && p.amount > cap * 1.05)) continue
      ruleSeed(map, `ZAHLUNG|${(p.entityKeys || [])[0] || keyPart(who)}`, 'AKT-006', { basis, title: c.length ? `Zahlungen an ${who} über dem Vertragswert` : `Zahlungen an ${who} ohne Vertrag im Akt`, question: 'Gibt es eine fremdübliche Vertragsgrundlage, oder liegt eine verbotene Einlagenrückgewähr bzw. verdeckte Ausschüttung vor?', entityKeys: p.entityKeys, factIds: [p.id, ...c.map((v) => v.id)], docIds: docIdsOf([p, ...c]) })
    }
  }

  // AKT-007 written resolutions (Umlaufbeschluss) need the consent of all shareholders (GmbH, FlexKapG).
  if (!form || form === 'GmbH' || form === 'FlexKapG') {
    const sh = factsOf(model, 'gesellschafter')
    const shPrimary = sh.some((e) => e.primary) ? sh.filter((e) => e.primary) : sh
    for (const b of factsOf(model, 'beschluss', (x) => /umlauf|schriftlich|§\s*34/i.test(`${x.attribute} ${x.subject}`))) {
      const at = iso(b.validFrom) || ref
      const members = shPrimary.filter((e) => (!e.validFrom || e.validFrom <= at) && (!e.validTo || e.validTo >= at))
      const voters = String(b.value || '').split(/[,;/]|\s+und\s+/i).map((x) => x.trim()).filter((x) => nameTokens(x).length)
      if (!members.length || !voters.length) continue
      const missing = members.filter((m) => !voters.some((v) => sameName(v, m.subject)))
      if (!missing.length) continue
      ruleSeed(map, `BESCHLUSS|${keyPart(b.subject)}|${at}`, 'AKT-007', { title: `Umlaufbeschluss ohne alle Gesellschafter: ${b.subject}`, question: `Haben alle zum ${at} eingetragenen Gesellschafter schriftlich zugestimmt (fehlend laut Akt: ${missing.map((m) => m.subject).join(', ')}), und ist der Beschluss wirksam?`, entityKeys: [...(b.entityKeys || []), ...missing.flatMap((m) => m.entityKeys || [])], factIds: [b.id, ...missing.map((m) => m.id)], docIds: docIdsOf([b, ...missing]) })
    }
  }

  // AKT-008 contradictions about key facts.
  for (const c of model.contradictions || []) {
    if (!['gesellschafter', 'organ', 'funktionstraeger', 'genehmigung', 'prokura'].includes(c.type)) continue
    const fs = c.factIds.map((id) => byId.get(id)).filter(Boolean)
    ruleSeed(map, `WID|${c.type}|${keyPart(c.subject)}`, 'AKT-008', { area: c.type === 'genehmigung' || c.type === 'funktionstraeger' ? 'compliance' : 'gesellschaft', title: `Widerspruch: ${c.subject} – ${c.attribute}`, question: `Welche Angabe stimmt (${c.values.map((v) => `${v.value} laut ${v.docNo}`).join(' / ')})?`, entityKeys: fs.flatMap((f) => f.entityKeys || []), factIds: c.factIds, docIds: c.values.map((v) => v.docId) })
  }
  return map
}

/** How each source of issues fared: created, confirmed, refuted, excluded, reviewer decisions. */
export function ruleStats(matter) {
  const out = {}
  for (const t of [...(matter.themes || []), ...(matter.orphanThemes || [])]) {
    const k = t.source === 'regel' ? t.rule : t.source === 'klausel' ? 'Klauseln' : t.source === 'akt' ? 'Akt-Durchgang' : t.source === 'hypothese' ? 'Hypothesen' : 'manuell'
    const r = (out[k] ||= { source: k, label: RULE[k]?.label || k, issues: 0, confirmed: 0, unclear: 0, refuted: 0, excluded: 0, notApplicable: 0, accepted: 0, rejected: 0, modified: 0, open: 0 })
    r.issues++
    if (t.status === 'bestaetigt') r.confirmed++
    if (t.status === 'ungeklaert') r.unclear++
    if (t.discarded?.by === 'Prüfung') r.refuted++
    if (t.discarded?.by === 'Ausschlusskatalog') r.excluded++
    if (t.discarded?.by === 'Rechtsprüfung') r.notApplicable++
    r[{ accepted: 'accepted', rejected: 'rejected', modified: 'modified' }[t.review?.status] || 'open']++
  }
  // Share of issues that did not hold up (refuted, excluded, not applicable, rejected): a high value marks a rule that fires too often.
  for (const r of Object.values(out)) r.falseRate = r.issues ? Math.round((100 * (r.refuted + r.excluded + r.notApplicable + r.rejected)) / r.issues) : 0
  return Object.values(out).sort((a, b) => a.source.localeCompare(b.source))
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
