// Skills: reusable, named instruction packages ("so machen wir das in unserer Kanzlei"),
// like playbooks / custom workflows in other legal AI tools. A skill carries
// instructions, optional input fields, reference documents (templates, playbooks,
// house style) and routing preferences (result format, knowledge base, legal area).
// It is applied to one message – picked by the user, or chosen by the planner when
// the request clearly matches the skill's description ("auto").
//
// Standard skills ship with the app (read-only, can be copied and adapted); the
// workspace's own skills live in the store, bound to the workspace key.

export const SKILL_OUTPUTS = { auto: 'Automatisch', answer: 'Antwort im Chat', docx: 'Word-Datei', xlsx: 'Excel-Datei' }
export const SKILL_KB = { auto: 'nach Schwierigkeit', always: 'immer (eine Anfrage)', never: 'nie' }
export const SKILL_AREAS = { auto: 'automatisch', civil: 'Zivilrecht', criminal: 'Strafrecht', tax: 'Steuerrecht', public: 'Öffentliches Recht' }
const FIELD_TYPES = ['text', 'textarea', 'select']
export const SKILL_LIMITS = { name: 80, description: 400, instructions: 20_000, fields: 12, files: 8, fileBytes: 15 * 1024 * 1024, refChars: 40_000 }

const std = (id, o) => ({ id: `std_${id}`, builtin: true, auto: true, kb: 'auto', legalArea: 'auto', output: 'auto', fields: [], files: [], ...o })

/**
 * The result format of one run: a select field "format" (Word / Excel) lets the user choose
 * per run; otherwise the skill's own setting applies.
 */
export function skillOutput(skill, params = {}) {
  const f = (skill.fields || []).find((x) => x.k === 'format')
  const v = f ? String(params?.format || f.opts?.[0] || '') : ''
  return /excel/i.test(v) ? 'xlsx' : /word/i.test(v) ? 'docx' : skill.output || 'auto'
}

export const BUILTIN_SKILLS = [
  std('zusammenfassung', {
    name: 'Zusammenfassen', icon: 'summary',
    description: 'Hochgeladene Dokumente zusammenfassen – als juristisches Memo, Kurzfassung oder mandantentauglich.',
    fields: [{ k: 'style', label: 'Stil', type: 'select', opts: ['Juristisches Memo', 'Kurzfassung (10 Sätze)', 'Für Mandanten verständlich'] }, { k: 'focus', label: 'Schwerpunkt (optional)', type: 'text', ph: 'z. B. Haftungsfragen, Zahlungsmodalitäten' }],
    instructions: `Fasse die vorliegenden Dokumente zusammen.
- Zuerst vollständig lesen; je Dokument Art, Parteien, Datum und Gegenstand nennen.
- Stil "Juristisches Memo": Sachverhalt, rechtliche Würdigung, Fazit. "Kurzfassung": höchstens 10 Sätze. "Für Mandanten verständlich": einfache Sprache, Fachbegriffe kurz erklären.
- Konkrete Fakten, Daten, Beträge, Fristen und Parteien wiedergeben (mit Dokument und Fundstelle); keine Floskeln.
- Fristen nur wiedergeben, nicht selbst berechnen.
- Die Wissensdatenbank nur befragen, wenn eine rechtliche Würdigung verlangt ist.`,
  }),
  std('tabelle', {
    name: 'Tabellarische Übersicht', icon: 'table', output: 'xlsx', kb: 'never',
    description: 'Mehrere Dokumente in einer Tabelle gegenüberstellen – je Dokument eine Zeile mit den wichtigsten Angaben, als Excel oder Word.',
    fields: [{ k: 'format', label: 'Format', type: 'select', opts: ['Excel', 'Word'] }, { k: 'columns', label: 'Spalten (optional)', type: 'text', ph: 'z. B. Vertragspartner, Laufzeit, Kündigungsfrist, Haftungsgrenze' }],
    instructions: `Erstelle eine tabellarische Übersicht über die vorliegenden Dokumente.
- Je Dokument eine Zeile; erste Spalte Dokument (Dateiname), dann die vorgegebenen Spalten. Ohne Vorgabe passende Spalten wählen, z. B. Art, Datum, Parteien, Gegenstand, Laufzeit/Kündigung, Entgelt/Beträge, Haftung/Gewährleistung, Besonderheiten.
- Nur belegte Angaben, knapp und wörtlich nah; fehlt etwas, "nicht geregelt" eintragen. Fundstelle (Punkt/§/Seite) in Klammern.
- Excel: Kopfzeile fett und fixiert, Filter, sinnvolle Spaltenbreiten, Zeilenumbruch. Word: Querformat, Tabelle mit Kopfzeile, die auf jeder Seite wiederholt wird.
- In der Antwort die auffälligsten Unterschiede und Lücken in 3–6 Punkten.`,
  }),
  std('vergleich', {
    name: 'Versionen vergleichen', icon: 'compare', output: 'docx', kb: 'auto',
    description: 'Zwei Fassungen eines Dokuments vergleichen: Änderungsansicht (Zusätze grün, Streichungen rot) als Word und HTML plus juristische Bewertung der Änderungen.',
    fields: [{ k: 'notes', label: 'Worauf achten? (optional)', type: 'textarea', ph: 'z. B. Haftung, Zahlungsbedingungen, Kündigung' }],
    instructions: `Vergleiche die zwei vorliegenden Fassungen eines Dokuments.
- Beide vollständig lesen; ältere und neuere Fassung aus Dateinamen, Datum oder Inhalt bestimmen (im Zweifel die Reihenfolge der Dokumente).
- Mit create_or_edit_file (1) delta.docx erzeugen: Zusätze grün unterstrichen, Streichungen rot durchgestrichen, unveränderter Text normal; (2) delta.html mit derselben Hervorhebung.
- Antwort: die wesentlichen Änderungen als Liste (Fundstelle, alt → neu, materielle Bedeutung, Risiko für welche Seite), rein redaktionelle Änderungen nur zusammengefasst.
- Liegen nicht genau zwei Fassungen vor, kurz nachfragen, welche verglichen werden sollen.`,
  }),
  std('mandantenbrief', {
    name: 'Mandantenbrief', icon: 'mail', output: 'docx',
    description: 'Ergebnisse, Dokumente oder die Rechtslage für Mandantinnen und Mandanten verständlich erklären – als Brief im Kanzleistil.',
    fields: [{ k: 'recipient', label: 'Empfänger', type: 'text', ph: 'z. B. Frau Mag. Huber, Huber GmbH' }, { k: 'tone', label: 'Ton', type: 'select', opts: ['sachlich', 'persönlich', 'sehr knapp'] }],
    instructions: `Verfasse einen Brief an die Mandantschaft.
- Aufbau: Betreff, Anrede, Anlass in einem Satz, Ergebnis vorab (2–4 Sätze), Erläuterung in einfacher Sprache (juristische Fachbegriffe beim ersten Vorkommen kurz erklären), Risiken und Optionen mit Empfehlung, nächste Schritte (wer macht was), Grußformel, Unterschriftsblock als Platzhalter.
- Normen nur nennen, wo sie für das Verständnis helfen; keine Fußnoten, keine Zitatketten.
- Unsicherheiten offen benennen, keine Erfolgsgarantien.
- Termine und Fristen nur übernehmen, wenn sie vorgegeben sind; nicht selbst berechnen.
- Als Word-Datei ausgeben, Briefformat mit Datum und Platzhaltern für Kanzleidaten.`,
  }),
  std('aktenvermerk', {
    name: 'Aktenvermerk', icon: 'final',
    description: 'Aus Notizen, Gesprächsprotokollen oder Transkripten einen strukturierten Aktenvermerk erstellen.',
    fields: [{ k: 'kind', label: 'Anlass', type: 'select', opts: ['Besprechung', 'Telefonat', 'Verhandlung', 'Recherche', 'Sonstiges'] }, { k: 'participants', label: 'Teilnehmer', type: 'text' }],
    instructions: `Erstelle einen Aktenvermerk.
- Kopf: Akt/Causa (falls bekannt), Datum, Anlass, Teilnehmer, Verfasser (Platzhalter).
- Inhalt: Gegenstand; Ergebnisse und Aussagen nach Themen gegliedert, Aussagen der Beteiligten klar zugeordnet ("Mandantin gibt an …"); Vereinbarungen; offene Fragen.
- To-dos als Tabelle: Was | Wer | bis wann (nur vorgegebene Termine übernehmen, nichts berechnen).
- Nüchterner Protokollstil, keine Wertungen außer unter "Anmerkung".`,
  }),
  std('chronologie', {
    name: 'Sachverhaltschronologie', icon: 'table', output: 'xlsx', kb: 'never',
    description: 'Aus Dokumenten, Korrespondenz oder einem Akt eine Chronologie der Ereignisse mit Quellen erstellen.',
    instructions: `Erstelle eine Chronologie des Sachverhalts aus den vorliegenden Unterlagen.
- Jede Zeile: Datum (TT.MM.JJJJ; ungefähre Daten kennzeichnen) | Ereignis (ein Satz) | Beteiligte | Quelle (Dokument und Fundstelle) | Bedeutung für den Fall (kurz).
- Nur belegte Ereignisse; widersprüchliche Angaben in zwei Zeilen mit Hinweis "Widerspruch".
- Excel-Datei mit dieser Tabelle (Kopfzeile fixiert, Datumsspalte sortiert) und in der Antwort die 5–10 wichtigsten Ereignisse sowie Lücken im Sachverhalt.`,
  }),
  std('gutachten', {
    name: 'Rechtsgutachten', icon: 'read', output: 'docx', kb: 'always',
    description: 'Eine Rechtsfrage ausführlich als Gutachten bzw. Memo nach österreichischem Recht beantworten – die Frage steht in der Nachricht.',
    instructions: `Erstelle ein Rechtsgutachten (Memo) zur Frage aus der Nachricht.
- Gliederung: I. Sachverhalt (nur relevante Fakten, Annahmen kennzeichnen), II. Fragestellung, III. Kurzantwort, IV. Rechtliche Beurteilung (je Frage: Rechtsgrundlagen, Judikatur des OGH bzw. VwGH/VfGH mit Geschäftszahl, herrschende Lehre soweit bekannt, Subsumtion, Gegenansichten), V. Ergebnis, VI. Empfehlung und offene Punkte.
- Fundstellen nur aus der Wissensdatenbank bzw. aus belegten Quellen; nichts erfinden.
- Als Word-Datei mit nummerierten Überschriften ausgeben.`,
  }),
  std('playbook', {
    name: 'Playbook-Abgleich', icon: 'contract', output: 'xlsx', auto: false,
    description: 'Einen Vertrag gegen das Playbook der Kanzlei bzw. der Mandantin prüfen (Playbook als Referenzdokument hinterlegen).',
    instructions: `Prüfe den vorliegenden Vertrag gegen das Playbook (Referenzdokument des Skills).
- Für jede Position des Playbooks: Fundstelle im Vertrag, wörtliches Zitat, Einordnung "Standardposition", "Rückfallposition", "nicht akzeptabel" oder "fehlt", Abweichung in einem Satz, Formulierungsvorschlag aus dem Playbook.
- Vertragsklauseln ohne Entsprechung im Playbook gesondert auflisten.
- Excel-Datei mit dieser Tabelle; in der Antwort die nicht akzeptablen und fehlenden Punkte.
- Ist kein Playbook als Referenzdokument hinterlegt, darauf hinweisen und mit marktüblichen Standards nach österreichischem Recht arbeiten.`,
  }),
  std('gegenseite', {
    name: 'Gegenargumente', icon: 'question', kb: 'auto',
    description: 'Eine eigene Position, einen Schriftsatz oder Entwurf aus Sicht der Gegenseite bzw. des Gerichts angreifen.',
    instructions: `Prüfe die vorliegende Position bzw. das Dokument aus Sicht der Gegenseite und des Gerichts.
- Die stärksten Gegenargumente (rechtlich und tatsächlich), geordnet nach Gewicht.
- Prozessuale Angriffspunkte: Zuständigkeit, Schlüssigkeit, Bestimmtheit, Beweislast, Verjährung, Präklusion, Formmängel.
- Je Punkt: Gewicht (hoch/mittel/niedrig), Begründung, Gegenmaßnahme bzw. Ergänzungsvorschlag (konkreter Textbaustein).
- Abschließend die drei wichtigsten Verbesserungen.`,
  }),
  std('uebersetzung', {
    name: 'Übersetzung Rechtsenglisch', icon: 'web', output: 'docx', kb: 'never',
    description: 'Verträge oder Schreiben zwischen Deutsch und Englisch übersetzen – mit österreichischer Terminologie und Übersetzerhinweisen.',
    fields: [{ k: 'direction', label: 'Richtung', type: 'select', opts: ['Deutsch → Englisch', 'Englisch → Deutsch'] }],
    instructions: `Übersetze das Dokument vollständig.
- Struktur, Nummerierung und Definitionen erhalten; Begriffe konsistent übersetzen.
- Österreichische Rechtsbegriffe nicht durch angloamerikanische Institute ersetzen; beim ersten Vorkommen den Originalbegriff in Klammern ergänzen. Beispiele: Gewährleistung = statutory warranty (nicht "guarantee"), Garantie = guarantee, Geschäftsführer = managing director, Firmenbuch = commercial register (Firmenbuch), Prokura = Prokura (statutory general commercial power of attorney), Notariatsakt = notarial deed (Notariatsakt), Bescheid = administrative decision (Bescheid).
- Mehrdeutige Stellen als Übersetzerhinweis (Fußnote) kennzeichnen.
- Als Word-Datei ausgeben; in der Antwort ein Glossar der wichtigsten Begriffe.`,
  }),
  std('bescheid', {
    name: 'Bescheidanalyse', icon: 'verify', legalArea: 'public',
    description: 'Einen Bescheid (Verwaltung oder Finanzamt) auswerten: Spruch, Begründung, Rechtsmittel, Angriffspunkte.',
    instructions: `Analysiere den vorliegenden Bescheid.
- Behörde, Datum, Geschäftszahl, Adressat, Verfahrensart.
- Spruch (wörtlich bzw. Kernaussage), Rechtsgrundlagen, wesentliche Begründung.
- Rechtsmittelbelehrung: Art des Rechtsmittels, Frist und Einbringungsstelle laut Belehrung (nicht selbst berechnen; Fristbeginn mit Zustellung als Prüfpunkt nennen).
- Angriffspunkte: Verfahrensmängel (Parteiengehör, Begründungsmangel, Zuständigkeit), inhaltliche Rechtswidrigkeit, Ermessensfehler; je Punkt Erfolgsaussicht grob einschätzen.
- Nächste Schritte und benötigte Unterlagen.
- Bei Abgabenbescheiden das Steuerrecht (BAO) zugrunde legen.`,
  }),
  std('steuer', {
    name: 'Steuerliche Erstbeurteilung', icon: 'summary', legalArea: 'tax', kb: 'always',
    description: 'Einen Sachverhalt steuerlich einordnen (Ertragsteuern, Umsatzsteuer, Verkehrsteuern) – für Steuerberatung und Transaktionen.',
    instructions: `Erstelle eine steuerliche Erstbeurteilung nach österreichischem Recht.
- Sachverhalt in Stichworten, Annahmen kennzeichnen.
- Betroffene Abgaben prüfen: Einkommen- bzw. Körperschaftsteuer (EStG, KStG), Umsatzsteuer (UStG), Grunderwerbsteuer (GrEStG), Gebühren (GebG), Kommunalsteuer, Lohnabgaben – nur die einschlägigen ausführen.
- Je Abgabe: Tatbestand, Rechtsfolge, Risiko, Gestaltungshinweise; Verfahrensrecht (BAO), wo relevant.
- Ergebnis-Tabelle: Abgabe | Ergebnis | Risiko | Empfehlung; offene Punkte für die Mandantin.`,
  }),
  std('korrespondenz', {
    name: 'Schreiben an die Gegenseite', icon: 'final', output: 'docx',
    description: 'Ein sachliches Anwaltsschreiben an die Gegenseite entwerfen (Standpunkt, Forderung, Frist, Vorbehalt).',
    fields: [{ k: 'goal', label: 'Ziel des Schreibens', type: 'text', required: true, ph: 'z. B. Zahlung von 12.400 EUR, Mängelbehebung, Vergleichsangebot' }, { k: 'deadline', label: 'Frist (Datum)', type: 'text', ph: 'z. B. 15.11.2026' }],
    instructions: `Entwirf ein Schreiben an die Gegenseite.
- Aufbau: Bekanntgabe der Vertretung (Berufung auf die erteilte Vollmacht), Sachverhalt aus Sicht der Mandantschaft (knapp), Rechtsstandpunkt mit den tragenden Normen, konkrete Forderung, Frist (nur das vorgegebene Datum verwenden), Ankündigung der nächsten Schritte, Vorbehalt weiterer Ansprüche.
- Bestimmter, höflicher Ton; keine internen Risikoeinschätzungen, keine Zugeständnisse ohne Vorgabe.
- Als Word-Datei mit Platzhaltern für Kanzleidaten ausgeben.`,
  }),
  std('summary', {
    name: 'Executive Summary', icon: 'summary',
    description: 'Ein Dokument, einen Akt oder ein Ergebnis auf einer Seite für Partnerin oder Geschäftsführung zusammenfassen.',
    instructions: `Fasse auf höchstens einer Seite zusammen.
- Ergebnis in 3 Sätzen, dann: wesentliche Risiken (max. 5, nach Gewicht), Empfehlung, Entscheidungsbedarf, offene Punkte.
- Konkrete Zahlen, Daten und Fundstellen statt allgemeiner Aussagen.
- Keine Wiederholungen, keine Einleitung.`,
  }),
]

const clip = (v, n) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n)

/** Validates user input into a skill (own skills only; builtin ones are read-only). */
export function normalizeSkill(input, prev = {}) {
  const b = input && typeof input === 'object' ? input : {}
  const pick = (k, allowed, d) => (Object.hasOwn(allowed, b[k]) ? b[k] : prev[k] ?? d)
  const fields = Array.isArray(b.fields) ? b.fields : prev.fields || []
  const out = {
    name: clip(b.name ?? prev.name, SKILL_LIMITS.name),
    description: clip(b.description ?? prev.description, SKILL_LIMITS.description),
    instructions: clip(b.instructions ?? prev.instructions, SKILL_LIMITS.instructions),
    output: pick('output', SKILL_OUTPUTS, 'auto'),
    kb: pick('kb', SKILL_KB, 'auto'),
    legalArea: pick('legalArea', SKILL_AREAS, 'auto'),
    auto: typeof b.auto === 'boolean' ? b.auto : prev.auto ?? true,
    icon: clip(b.icon ?? prev.icon ?? 'tool', 20).replace(/[^\w]/g, '') || 'tool',
    fields: fields.slice(0, SKILL_LIMITS.fields).map((f, i) => {
      const type = FIELD_TYPES.includes(f?.type) ? f.type : 'text'
      const label = clip(f?.label, 80)
      const k = clip(f?.k, 40).replace(/[^\w]/g, '') || `f${i + 1}`
      return { k, label: label || `Feld ${i + 1}`, type, required: Boolean(f?.required), ph: clip(f?.ph, 160), ...(type === 'select' ? { opts: (Array.isArray(f?.opts) ? f.opts : String(f?.opts || '').split(',')).map((o) => clip(o, 80)).filter(Boolean).slice(0, 20) } : {}) }
    }).filter((f, i, a) => a.findIndex((x) => x.k === f.k) === i),
  }
  if (!out.name) throw new Error('Bitte einen Namen angeben.')
  if (!out.instructions) throw new Error('Bitte Anweisungen angeben.')
  return out
}

/** The block that goes into the request: binding instructions, inputs, reference documents. */
export function skillBlock(skill, params = {}, refs = []) {
  const inputs = (skill.fields || []).map((f) => [f.label, clip(params?.[f.k], 4000)]).filter(([, v]) => v)
  const result = { docx: 'Word-Datei (.docx) mit create_or_edit_file erzeugen', xlsx: 'Excel-Datei (.xlsx) mit create_or_edit_file erzeugen', answer: 'Antwort im Chat (keine Datei)', auto: 'nach der Aufgabe' }[skillOutput(skill, params)] || 'nach der Aufgabe'
  let left = SKILL_LIMITS.refChars
  const refText = refs.map((r) => { const t = String(r.text || '').slice(0, Math.max(0, left)); left -= t.length; return t ? `=== ${r.name}${t.length < String(r.text || '').length ? ' (gekürzt)' : ''} ===\n${t}` : '' }).filter(Boolean).join('\n\n')
  return `SKILL „${skill.name}“ – verbindliche Arbeitsanweisung der Kanzlei (geht allgemeinen Vorgaben vor, soweit Fakten oder zwingendes Recht nicht entgegenstehen):
${skill.instructions}
${inputs.length ? `\nEINGABEN:\n${inputs.map(([l, v]) => `- ${l}: ${v}`).join('\n')}\n` : ''}ERGEBNIS: ${result}.${refText ? `\n\nREFERENZDOKUMENTE DES SKILLS (Muster, Playbook, Vorgaben – Aufbau und Formulierungen übernehmen, wo passend):\n${refText}` : ''}`
}

/** Public view (no owner key). */
export const skillView = (s) => ({ id: s.id, builtin: Boolean(s.builtin), name: s.name, description: s.description, instructions: s.instructions, output: s.output, kb: s.kb, legalArea: s.legalArea, auto: s.auto !== false, icon: s.icon || 'tool', fields: s.fields || [], files: (s.files || []).map(({ id, name, size, chars }) => ({ id, name, size, chars })), uses: s.uses || 0, createdAt: s.createdAt || null, updatedAt: s.updatedAt || null, copiedFrom: s.copiedFrom || null })
