// Stage 5 of the due diligence: checks across the whole Akt.
//
// 1. Akt rules – deterministic checks on the facts register that no single document shows:
//    AKT-001 functionary named in a permit has died or left → check the deadline of the
//            governing law (checkpoint with its legal basis, no deadline calculation);
//    AKT-002 change-of-control clause meets a share deal;
//    AKT-003 permit or contract expires before the reference date or closing;
//    AKT-004 payments to shareholders without a contract or above the contract value;
//    AKT-005 resolution without all shareholders registered in the Firmenbuch.
// 2. Nachweis-Abgleich – a finding "not documented" (Lücke) is searched in the whole Akt;
//    found → the finding is discarded with the place where the proof is.
// 3. Hypotheses from secondary sources – confirmed in an original document → finding with
//    the original location; not confirmed → at most yellow, "unbestätigt".
import { factsOf, deceased, sameName, nameTokens } from './facts.js'

const iso = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : /^\d{4}$/.test(String(s || '')) ? `${s}-12-31` : '')
const today = () => new Date().toISOString().slice(0, 10)
const ev = (e) => e.evidence?.[0] || {}
const splitNames = (s) => String(s || '').split(/[,;/]|\s+und\s+|\s+sowie\s+/i).map((x) => x.trim()).filter((x) => nameTokens(x).length)

/** A finding produced by a rule (same shape as a model finding of stage 4). */
function ruleFinding(aktRule, e, f) {
  const x = ev(e)
  return {
    quelle: 'akt_regel', aktRule, docId: x.docId, quote: x.quote || '', location: x.location || '', betroffen: 'Zielgesellschaft', heilbar: true, kernvoraussetzung: false, betrag: null, art: 'mangel', instrument: 'Nachfrage', norms: [], nachweis: '', gegenpartei: '', recommendation: '',
    facts: [e.id], ...f,
  }
}

/** Runs the five Akt rules on the register; returns new findings (not yet graded). */
export function aktRules(matter, reg) {
  const s = matter.settings
  const ref = iso(s.closing) || iso(s.stichtag) || today()
  const out = []
  const dead = deceased(reg)
  const gone = (name, at = ref) => {
    const d = dead.find((p) => sameName(p.name, name))
    if (d) return { why: 'verstorben', date: d.date, fact: d.fact }
    const left = (reg.entries || []).find((e) => ['organ', 'funktionstraeger', 'prokura'].includes(e.type) && sameName(e.subject, name) && (e.flags.includes('ausgeschieden') || (e.validTo && e.validTo < at)))
    return left ? { why: 'ausgeschieden', date: left.validTo || '', fact: left } : null
  }

  // AKT-001 functionaries named in a permit
  for (const e of factsOf(reg, 'funktionstraeger')) {
    const person = e.subject
    const g = gone(person)
    if (!g) continue
    const fn = e.attribute || e.subject || 'Funktionsträger'
    out.push(ruleFinding('AKT-001', e, {
      area: 'compliance', rule: 'AKT-001', title: `${fn} ${person} laut Bescheid ${g.why}`, gegenstand: `${fn}${e.counterparty ? ' ' + e.counterparty : ''}`, gegenpartei: e.counterparty || '',
      kernvoraussetzung: true, instrument: 'CP', facts: [e.id, g.fact.id],
      description: `Laut ${ev(e).docNo || 'Bescheid'} ist ${person} als ${fn} bestellt; laut ${ev(g.fact).docNo || 'Faktenregister'} ist ${person} ${g.why}${g.date ? ` (${g.date})` : ''}. Ohne Nachbestellung droht der Wegfall der Berechtigung. Prüfpunkt: Frist für die Nachbestellung bzw. Anzeige nach dem jeweiligen Materiengesetz (z. B. § 9 Abs 2 GewO für den gewerberechtlichen Geschäftsführer) – keine Fristberechnung.`,
      recommendation: 'Nachweis der Neubestellung und Anzeige an die Behörde als Closing-Bedingung.', norms: /gewerb/i.test(fn) ? ['§ 9 GewO'] : [],
    }))
  }

  // AKT-002 change of control in a share deal
  if (s.transaction !== 'asset') {
    for (const e of factsOf(reg, 'vertrag', (x) => x.flags.includes('kontrollwechsel'))) {
      const fin = /kredit|darlehen|finanzier|leasing|factoring|bank|sparkasse|raiffeisen|bürgschaft|garantie/i.test(`${e.subject} ${e.attribute} ${e.counterparty}`)
      out.push(ruleFinding('AKT-002', e, {
        area: fin ? 'finanzierung' : 'vertraege', rule: fin ? 'FIN-001' : 'VERT-001', title: `Kontrollwechselklausel ${e.counterparty || e.subject}`, gegenstand: e.subject || 'Vertrag', gegenpartei: e.counterparty || '',
        art: 'mangel', betrag: e.amount ?? null, kernvoraussetzung: fin, instrument: 'CP',
        description: `Der Vertrag ${e.subject || ''}${e.counterparty ? ` mit ${e.counterparty}` : ''} enthält eine Kontrollwechselklausel; der geplante Share Deal löst sie aus. Ohne Zustimmung/Verzicht der Gegenpartei drohen Kündigung oder Fälligstellung.`,
        recommendation: 'Zustimmung bzw. Waiver der Gegenpartei vor Closing einholen (Closing-Bedingung).',
      }))
    }
  }

  // AKT-003 expiry before the reference date (closing, else the Stichtag)
  for (const e of [...factsOf(reg, 'genehmigung'), ...factsOf(reg, 'vertrag'), ...factsOf(reg, 'standort')]) {
    const end = iso(e.validTo)
    if (!end || end >= ref || e.flags.includes('gekuendigt') || e.flags.includes('erloschen')) continue
    // A renewal elsewhere in the Akt (same subject, later end or open-ended and started later) clears it.
    const renewed = (reg.entries || []).some((x) => x !== e && x.type === e.type && (sameName(x.subject, e.subject) || (x.site && x.site === e.site && x.attribute === e.attribute)) && ((x.validTo && x.validTo >= ref) || (!x.validTo && x.validFrom && x.validFrom >= end)))
    if (renewed) continue
    const permit = e.type === 'genehmigung' || e.type === 'standort'
    out.push(ruleFinding('AKT-003', e, {
      area: e.type === 'genehmigung' ? 'compliance' : e.type === 'standort' ? 'immobilien' : 'vertraege', rule: 'AKT-003', title: `${permit ? 'Befristung abgelaufen' : 'Vertrag endet'} vor ${s.closing ? 'Closing' : 'Stichtag'}: ${e.subject}`, gegenstand: e.subject, gegenpartei: e.counterparty || '',
      kernvoraussetzung: permit, betrag: e.amount ?? null, instrument: permit ? 'CP' : 'Nachfrage',
      description: `${e.subject}${e.site ? ` (${e.site})` : ''} ist laut ${ev(e).docNo || 'Akt'} bis ${end} befristet; das liegt vor dem ${s.closing ? 'Closing' : 'Stichtag'} (${ref}). Eine Verlängerung ist im Akt nicht dokumentiert.`,
      recommendation: permit ? 'Verlängerungsbescheid bzw. neuen Bescheid anfordern; Bestand als Closing-Bedingung.' : 'Verlängerung oder Nachfolgevertrag anfordern.',
    }))
  }

  // AKT-004 payments to shareholders
  const contracts = factsOf(reg, 'vertrag')
  for (const p of factsOf(reg, 'zahlung_gesellschafter')) {
    if (/aussch[üu]ttung|dividende|gewinnanteil|gewinnverteilung/i.test(`${p.attribute} ${p.value}`)) continue // distributions: exclusion catalogue / purchase price
    const who = p.counterparty || p.subject
    const c = contracts.filter((v) => sameName(v.counterparty, who) || sameName(v.subject, who))
    const cap = c.reduce((m, v) => Math.max(m, v.amount || 0), 0)
    if (c.length && !(p.amount && cap && p.amount > cap * 1.05)) continue
    out.push(ruleFinding('AKT-004', p, {
      area: 'gesellschaft', rule: 'AKT-004', title: c.length ? `Zahlungen an ${who} über dem Vertragswert` : `Zahlungen an ${who} ohne Vertrag im Akt`, gegenstand: `Zahlungen an Gesellschafter ${who}`, gegenpartei: who,
      art: c.length ? 'mangel' : 'luecke', betrag: c.length && cap ? Math.round(p.amount - cap) : p.amount ?? null, nachweis: `Vertrag ${who} Vereinbarung Entgelt`, facts: [p.id, ...c.map((v) => v.id)],
      description: c.length ? `Laut ${ev(p).docNo} wurden an ${who} ${p.amount?.toLocaleString('de-DE')} EUR gezahlt; der zugehörige Vertrag (${c.map((v) => ev(v).docNo).join(', ')}) sieht höchstens ${cap.toLocaleString('de-DE')} EUR vor. Risiko verbotener Einlagenrückgewähr bzw. verdeckter Ausschüttung.` : `Laut ${ev(p).docNo} erhielt ${who} Zahlungen${p.amount ? ` von ${p.amount.toLocaleString('de-DE')} EUR` : ''}; ein zugrunde liegender Vertrag liegt im Akt nicht vor. Risiko verbotener Einlagenrückgewähr bzw. verdeckter Ausschüttung.`,
      recommendation: 'Vertragsgrundlage und Fremdüblichkeit nachweisen lassen; spezifische Freistellung.', instrument: 'Freistellung', norms: ['§ 82 GmbHG', '§ 8 Abs 2 KStG'],
    }))
  }

  // AKT-005 resolutions without all registered shareholders
  const sh = factsOf(reg, 'gesellschafter')
  const shPrimary = sh.some((e) => e.primary) ? sh.filter((e) => e.primary) : sh
  for (const b of factsOf(reg, 'beschluss')) {
    const at = iso(b.validFrom) || ref
    const members = shPrimary.filter((e) => (!e.validFrom || e.validFrom <= at) && (!e.validTo || e.validTo >= at)).map((e) => (nameTokens(e.subject).length ? e.subject : e.value))
    const voters = splitNames(b.value)
    if (!members.length || !voters.length) continue
    const missing = members.filter((m) => !voters.some((v) => sameName(v, m)))
    if (!missing.length) continue
    const heirs = missing.filter((m) => dead.some((d) => sameName(d.name, m) && d.date && d.date <= at))
    out.push(ruleFinding('AKT-005', b, {
      area: 'gesellschaft', rule: 'AKT-005', title: `Beschluss ohne alle Gesellschafter: ${b.subject}`, gegenstand: `Beschluss ${b.subject}`, gegenpartei: '', facts: [b.id, ...shPrimary.map((e) => e.id).slice(0, 6)],
      description: `Der Beschluss ${b.subject}${b.validFrom ? ` vom ${b.validFrom}` : ''} (${ev(b).docNo}) wurde von ${voters.join(', ')} gefasst; laut Firmenbuch waren auch ${missing.join(', ')} Gesellschafter${heirs.length ? ` (${heirs.join(', ')} bereits verstorben – Verlassenschaft bzw. Erben hätten mitwirken müssen)` : ''}. Ein Umlaufbeschluss braucht die Zustimmung aller Gesellschafter; sonst Anfechtbarkeit bzw. Nichtigkeit.`,
      recommendation: 'Bestätigungsbeschluss aller Gesellschafter vor Closing.', instrument: 'CP', norms: ['§ 34 GmbHG', '§ 41 GmbHG'],
    }))
  }
  return out
}

/**
 * Searches the Akt for what a finding says is missing (art "luecke") or for the original behind
 * a hypothesis from a secondary source. prove(finding, passages) is the model check (PROOF_SCHEMA).
 * Returns { found, passage, quote, note } or null when nothing relevant is in the Akt.
 */
export async function findProof(f, index, prove, { minCoverage = 0.5 } = {}) {
  const query = [f.nachweis, f.gegenstand, f.gegenpartei, f.quelle === 'hypothese' ? f.title : ''].filter(Boolean).join(' ')
  const hits = index.search(query, { k: 4, excludeDocIds: f.quelle === 'hypothese' ? [] : [f.docId], role: 'Originalunterlage' }).filter((p) => p.coverage >= minCoverage && p.docId !== f.docId)
  if (!hits.length) return null
  const r = await prove(f, hits)
  if (!r?.found || !r.passage || !hits[r.passage - 1]) return { found: false, note: r?.note || '' }
  const p = hits[r.passage - 1]
  return { found: true, docId: p.docId, docNo: p.docNo, docName: p.docName, location: p.page ? `S. ${p.page}` : '', quote: r.quote || '', note: r.note || '' }
}
