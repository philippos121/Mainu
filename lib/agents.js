// Specialist agents next to the due diligence: contract review, contract drafting and
// drafting of pleadings (Schriftsätze), each with the typical workflow of an Austrian
// law firm. Like the DD catalogue this is explicit, versioned configuration: the
// workflow steps, the review grid and the type-specific notes are code, the model
// fills them with the facts of the case.
//
// A run has phases (e.g. outline → draft). Each phase is one chat turn; the answer of
// the previous phase is in the conversation history, so the next phase builds on it.
// Phase options:
//   difficulty: 'hard' | 'easy' | null  → overrides the planner (null = planner decides)
//   kb: false                            → no knowledge-base request in this phase
//                                         (the legal questions were answered before)
//   mode: 'document' | 'legal'           → forced pipeline mode
//   next: [{ phase, label }]             → follow-up buttons under the answer

export const AGENTS_VERSION = '2026-10-27'

const PERSPECTIVES = ['neutral', 'Auftraggeber / Kunde', 'Auftragnehmer / Lieferant', 'Käufer', 'Verkäufer', 'Vermieter', 'Mieter', 'Arbeitgeber', 'Arbeitnehmer', 'Lizenzgeber', 'Lizenznehmer', 'Darlehensgeber', 'Darlehensnehmer', 'Gesellschaft', 'Gesellschafter']
const CONSUMER = ['Unternehmergeschäft (B2B)', 'Verbrauchergeschäft (B2C, KSchG)', 'unklar']

// ---- Prüfraster Vertragsprüfung (österreichisches Recht) ----
export const REVIEW_GRID = [
  { key: 'parteien', label: 'Parteien und Vertretung', text: 'richtige Firma und Firmenbuchnummer, Zeichnungs- bzw. Vertretungsbefugnis (Firmenbuch, Prokura § 48 UGB, Vollmacht), Verbraucher oder Unternehmer (§ 1 KSchG, § 1 UGB)' },
  { key: 'gegenstand', label: 'Vertragsgegenstand und Leistung', text: 'Bestimmtheit der Leistung, Leistungsänderungen, Mitwirkungspflichten, Termine, Abnahme (Werkvertrag §§ 1165 ff ABGB), Vertragstyp richtig erfasst' },
  { key: 'entgelt', label: 'Entgelt, Zahlung, Wertsicherung', text: 'Preis, Fälligkeit, Verzugszinsen (§ 1333 ABGB; zwischen Unternehmern § 456 UGB), Aufrechnungsverbote, Wertsicherung (Index, Bezugsgröße, Schwellenwert; bei Verbrauchern § 6 Abs 2 Z 4 KSchG; aktuelle OGH-Judikatur zu Wertsicherungsklauseln beachten), Umsatzsteuer' },
  { key: 'gewaehrleistung', label: 'Gewährleistung', text: '§§ 922 ff ABGB, Fristen § 933 ABGB, Vermutung § 924 ABGB, Verbrauchergeschäfte VGG und § 9 KSchG (nicht abdingbar), Rügeobliegenheit § 377 UGB zwischen Unternehmern, Ausschlüsse und ihre Grenzen (§ 879 ABGB)' },
  { key: 'haftung', label: 'Schadenersatz und Haftungsbeschränkungen', text: 'Haftungshöchstbeträge, Ausschluss von Folgeschäden und entgangenem Gewinn, keine Freizeichnung für Vorsatz und krasse grobe Fahrlässigkeit (§ 879 ABGB), Personenschäden; bei Verbrauchern § 6 Abs 1 Z 9 KSchG; Freistellungen' },
  { key: 'pönale', label: 'Vertragsstrafe', text: 'Pönale und Verhältnis zum Schadenersatz, richterliches Mäßigungsrecht § 1336 Abs 2 ABGB, Verschuldensabhängigkeit, Deckelung' },
  { key: 'agb', label: 'AGB-Kontrolle', text: 'Geltungskontrolle § 864a ABGB (ungewöhnliche, nachteilige Klauseln), Inhaltskontrolle § 879 Abs 3 ABGB (gröbliche Benachteiligung), bei Verbrauchern Klauselkatalog § 6 KSchG und Transparenzgebot § 6 Abs 3 KSchG' },
  { key: 'laesio', label: 'Verkürzung über die Hälfte', text: '§ 934 ABGB; Ausschluss nur zwischen Unternehmern möglich (§ 351 UGB), nicht gegenüber Verbrauchern' },
  { key: 'laufzeit', label: 'Laufzeit und Beendigung', text: 'Befristung, ordentliche Kündigung, Kündigung aus wichtigem Grund (nicht abdingbar), Change of Control, Rechtsfolgen der Beendigung; bei Verbrauchern § 15 KSchG; im Mietrecht §§ 29, 30 MRG' },
  { key: 'abtretung', label: 'Abtretung, Vertragsübernahme', text: 'Abtretungsverbote (§ 1396a ABGB für Geldforderungen zwischen Unternehmern), Zustimmungsvorbehalte, Konzernklauseln' },
  { key: 'ip', label: 'Geistiges Eigentum und Know-how', text: 'Werknutzungsrecht oder Werknutzungsbewilligung (§§ 24 ff UrhG), Umfang und Dauer der Rechte, Open Source, Geschäftsgeheimnisse (§§ 26a ff UWG)' },
  { key: 'datenschutz', label: 'Datenschutz', text: 'Rollen nach DSGVO, Auftragsverarbeitung (Art 28 DSGVO, Mindestinhalt), TOM, Subauftragsverarbeiter, Drittlandtransfer (Art 44 ff DSGVO)' },
  { key: 'wettbewerb', label: 'Wettbewerbsverbote und Kartellrecht', text: '§ 1 KartG und Art 101 AEUV, Vertikal-GVO (Dauer, Marktanteile); im Arbeitsrecht Konkurrenzklausel § 2c AVRAG (Entgeltgrenze, Dauer, Konventionalstrafe)' },
  { key: 'form', label: 'Form und Gebühren', text: 'Schriftformklauseln, Notariatsaktpflicht (z. B. § 76 Abs 2 GmbHG), Schriftform der Bürgschaft (§ 1346 Abs 2 ABGB), Rechtsgeschäftsgebühren nach § 33 GebG (z. B. Bestandvertrag über Geschäftsräume, Bürgschaft, Zession) und gebührenschonende Gestaltung' },
  { key: 'streit', label: 'Rechtswahl, Gerichtsstand, Schiedsklausel', text: 'Rom I-VO, EuGVVO (Brüssel Ia), Gerichtsstandsvereinbarung § 104 JN, Schiedsvereinbarung § 583 ZPO (Schriftform), bei Verbrauchern § 14 KSchG und § 617 ZPO' },
  { key: 'fehlt', label: 'Fehlende oder unübliche Regelungen', text: 'was für diesen Vertragstyp üblicherweise geregelt ist und fehlt (z. B. Höhere Gewalt, Versicherung, Sicherheiten, Audit, Exit-Management), überraschende Abweichungen vom dispositiven Recht' },
]

// ---- Vertragstypen für den Entwurf: zwingendes Recht, Form, Gebühren ----
export const CONTRACT_TYPES = [
  { key: 'kauf', label: 'Kaufvertrag (bewegliche Sachen)', notes: 'Gefahrenübergang, Eigentumsvorbehalt, Gewährleistung §§ 922 ff ABGB (B2C: VGG, § 9 KSchG), Rügeobliegenheit § 377 UGB, Incoterms bei grenzüberschreitender Lieferung, UN-Kaufrecht (CISG) ausschließen oder bewusst wählen' },
  { key: 'liegenschaft', label: 'Liegenschaftskaufvertrag', notes: 'Aufsandungserklärung (§ 32 GBG), beglaubigte Unterschriften, Treuhandabwicklung über Rechtsanwalt oder Notar, Lastenfreistellung, Rangordnung, Grunderwerbsteuer und Eintragungsgebühr, Immobilienertragsteuer, Grundverkehrsgesetz des Landes, Energieausweis (EAVG)' },
  { key: 'werk', label: 'Werkvertrag', notes: 'Werkbeschreibung, Abnahme, Werklohn (Pauschal- oder Einheitspreis), Kostenvoranschlag (§ 1170a ABGB), Warnpflicht (§ 1168a ABGB), Gewährleistung und Haftung, Bauvertrag: Bezugnahme auf ÖNORM B 2110' },
  { key: 'dienstleistung', label: 'Dienstleistungs- oder Rahmenvertrag', notes: 'Leistungsbeschreibung und Service Levels, Abrufe, Change Requests, Vergütung, Haftungsbegrenzung, Laufzeit und Kündigung, Datenschutz (AVV), Subunternehmer, Exit-Management' },
  { key: 'miete_wohnung', label: 'Mietvertrag Wohnung', notes: 'Anwendungsbereich MRG (Voll-, Teil- oder Ausnahmebereich, § 1 MRG), Mietzinsbegrenzung (Richtwert, Kategorie, angemessen), Befristung § 29 MRG (mindestens drei Jahre, schriftlich), Erhaltungspflichten, Kaution, Betriebskosten, Wertsicherung (aktuelle Judikatur), Bestellerprinzip für Maklerprovision, Wohnungsmietverträge gebührenfrei' },
  { key: 'miete_geschaeft', label: 'Mietvertrag Geschäftsraum', notes: 'MRG-Anwendbarkeit, Verwendungszweck, Betriebspflicht, Weitergabe bei Unternehmensveräußerung (§ 12a MRG), Investitionen und Rückbau, Wertsicherung, Rechtsgeschäftsgebühr nach § 33 TP 5 GebG, Kündigungsverzicht' },
  { key: 'arbeit', label: 'Arbeitsvertrag (Angestellte)', notes: 'Kollektivvertrag und Einstufung, Dienstzettel-Mindestinhalt § 2 AVRAG, Arbeitszeit (AZG), All-in-Vereinbarung mit Grundgehalt (§ 2g AVRAG), Probemonat und Kündigungsfristen (AngG), Konkurrenzklausel § 2c AVRAG, Ausbildungskostenrückersatz § 2d AVRAG, Verfallsfristen' },
  { key: 'freier_dienst', label: 'Freier Dienstvertrag', notes: 'Abgrenzung zum echten Arbeitsvertrag (persönliche Abhängigkeit, Weisungsfreiheit, Vertretungsrecht), Sozialversicherung nach ASVG (freier Dienstnehmer) bzw. GSVG, Haftung, Konkurrenzverbot nur eingeschränkt' },
  { key: 'darlehen', label: 'Darlehensvertrag', notes: 'Zuzählung, Zinsen, Rückzahlung und Kündigung, Sicherheiten, bei Verbrauchern VKrG (Informationspflichten, Rücktrittsrecht), Kredit- und Darlehensverträge gebührenfrei, Gesellschafterdarlehen und EKEG' },
  { key: 'nda', label: 'Geheimhaltungsvereinbarung (NDA)', notes: 'Definition vertraulicher Informationen, Ausnahmen, Zweckbindung, Dauer, Rückgabe und Löschung, Vertragsstrafe (Mäßigung § 1336 ABGB), Schutz von Geschäftsgeheimnissen §§ 26a ff UWG, Rechtswahl und Gerichtsstand' },
  { key: 'avv', label: 'Auftragsverarbeitungsvertrag (DSGVO)', notes: 'Mindestinhalt Art 28 Abs 3 DSGVO, TOM als Anlage, Subauftragsverarbeiter, Unterstützung bei Betroffenenrechten, Meldung von Datenschutzverletzungen, Löschung und Rückgabe, Drittlandtransfer' },
  { key: 'lizenz', label: 'Lizenz- oder Softwarevertrag', notes: 'Rechteumfang (Werknutzungsrecht oder -bewilligung, §§ 24 ff UrhG), Territorium, Dauer, Sublizenzen, Quellcode-Hinterlegung, SaaS: Verfügbarkeit, Support, Daten, Quellensteuer bei Lizenzzahlungen ins Ausland (§ 99 EStG)' },
  { key: 'gmbh', label: 'Gesellschaftsvertrag GmbH', notes: 'Notariatsakt (§ 4 Abs 3 GmbHG), Mindestinhalt § 4 Abs 1 GmbHG (Firma, Sitz, Gegenstand, Stammkapital, Stammeinlagen), Mindeststammkapital nach aktueller Rechtslage, Vinkulierung und Aufgriffsrechte, Geschäftsführung und Zustimmungskatalog, Gewinnverteilung, Firmenbuchanmeldung' },
  { key: 'abtretung_gmbh', label: 'Abtretung von GmbH-Geschäftsanteilen', notes: 'Notariatsakt (§ 76 Abs 2 GmbHG), Vinkulierung und Zustimmungen laut Gesellschaftsvertrag, Garantien, Kaufpreis und Stichtag, Firmenbuchmeldung, Grunderwerbsteuer bei Anteilsvereinigung, Haftung nach § 78 GmbHG' },
  { key: 'vergleich', label: 'Vergleich', notes: '§ 1380 ABGB, Bereinigungswirkung (Generalklausel), Kostenregelung, Ruhen oder Rückziehung des Verfahrens, Vergleichsgebühr nach § 33 TP 20 GebG, prätorischer oder gerichtlicher Vergleich als Exekutionstitel' },
  { key: 'vollmacht', label: 'Vollmacht', notes: 'Umfang (Spezial-, Gattungs-, Generalvollmacht, § 1008 ABGB für bestimmte Geschäfte), Beglaubigung für Grundbuch und Firmenbuch, Vorsorgevollmacht (§§ 260 ff ABGB, Registrierung im ÖZVV)' },
  { key: 'sonstig', label: 'Sonstiger Vertrag', notes: 'Vertragstyp und anwendbares zwingendes Recht bestimmen, Formerfordernisse und Gebühren prüfen' },
]

// ---- Schriftsatzarten (Zivilverfahren, Exekution, Verwaltungs- und Strafverfahren) ----
export const BRIEF_TYPES = [
  { key: 'klage', label: 'Klage (Zivilprozess)', notes: 'Inhalt § 226 ZPO (bestimmtes Begehren, Tatsachenvorbringen, Beweisanbote), sachliche und örtliche Zuständigkeit (JN, aktuelle Wertgrenze § 49 JN prüfen), Streitwert und Bewertung (§§ 54 ff JN), Anwaltspflicht (§ 27 ZPO), Pauschalgebühr nach GGG, Kostenverzeichnis' },
  { key: 'mahnklage', label: 'Mahnklage (Mahnverfahren)', notes: 'Mahnverfahren §§ 244 ff ZPO für Geldforderungen bis 75.000 EUR, Einbringung im ERV (Formular), Zinsen und Nebenforderungen bestimmt angeben' },
  { key: 'einspruch', label: 'Einspruch gegen Zahlungsbefehl', notes: 'Frist § 248 ZPO prüfen, im Gerichtshofverfahren Inhalt einer Klagebeantwortung, Bestreitung und eigenes Vorbringen, Beweisanbote, Gegenforderungen' },
  { key: 'klagebeantwortung', label: 'Klagebeantwortung', notes: 'Inhalt § 239 ZPO (Begehren auf Klagsabweisung, Tatsachen, Beweismittel, Einreden), Frist laut Auftrag (§ 230 ZPO), Prozesseinreden (Unzuständigkeit, Streitanhängigkeit, Verjährung), Gegenforderung zur Aufrechnung' },
  { key: 'schriftsatz', label: 'Vorbereitender Schriftsatz', notes: 'Vorbringen zum Prozessprogramm, Replik auf das gegnerische Vorbringen, ergänzende Beweisanbote, Präklusion und Prozessförderungspflicht beachten (§ 178 ZPO)' },
  { key: 'berufung', label: 'Berufung', notes: 'Frist § 464 ZPO prüfen, Berufungsgründe (Nichtigkeit, Mangelhaftigkeit des Verfahrens, unrichtige Tatsachenfeststellung und Beweiswürdigung, unrichtige rechtliche Beurteilung), Neuerungsverbot (§ 482 ZPO), Bagatellverfahren § 501 ZPO, Anfechtungserklärung und Berufungsantrag' },
  { key: 'rekurs', label: 'Rekurs', notes: 'Frist § 521 ZPO prüfen, Zulässigkeit (§§ 514 ff ZPO), Rekursantrag' },
  { key: 'revision', label: 'Revision (OGH)', notes: 'erhebliche Rechtsfrage (§ 502 ZPO), ordentliche oder außerordentliche Revision, Frist § 505 ZPO prüfen, Zulassungsvorstellung (§ 508 ZPO)' },
  { key: 'ev', label: 'Antrag auf einstweilige Verfügung', notes: '§§ 378 ff EO: Sicherung von Geldforderungen (§ 379 EO) oder anderen Ansprüchen (§ 381 EO), Bescheinigung von Anspruch und Gefährdung, Sicherungsmittel konkret bezeichnen, Sicherheitsleistung, Rechtfertigungsfrist' },
  { key: 'exekution', label: 'Exekutionsantrag', notes: 'Exekutionstitel und Vollstreckbarkeitsbestätigung, Exekutionsmittel bzw. Exekutionspaket (EO idF GREx), Antrag im ERV, Kosten' },
  { key: 'bescheidbeschwerde', label: 'Bescheidbeschwerde an das Verwaltungsgericht', notes: 'Art 130 Abs 1 Z 1 B-VG, Inhalt § 9 VwGVG (Bescheid, Behörde, Gründe, Begehren, Angaben zur Rechtzeitigkeit), Frist § 7 Abs 4 VwGVG prüfen, Einbringung bei der belangten Behörde, Antrag auf mündliche Verhandlung, aufschiebende Wirkung' },
  { key: 'revision_vwgh', label: 'Revision an den VwGH', notes: 'Art 133 B-VG, Inhalt § 28 VwGG mit gesonderter Zulässigkeitsbegründung (§ 28 Abs 3 VwGG), Frist § 26 VwGG prüfen, Anwaltspflicht, Antrag auf aufschiebende Wirkung (§ 30 VwGG)' },
  { key: 'privatbeteiligung', label: 'Strafanzeige / Privatbeteiligtenanschluss', notes: 'Anzeige § 80 StPO an Staatsanwaltschaft oder Kriminalpolizei, Sachverhalt und Beweismittel, Privatbeteiligtenanschluss § 67 StPO mit beziffertem Anspruch, Opferrechte' },
  { key: 'sonstig', label: 'Sonstiger Schriftsatz', notes: 'Verfahrensart, Zuständigkeit, Form- und Inhaltserfordernisse bestimmen' },
]

const labelOf = (list, key) => list.find((x) => x.key === key) || list[list.length - 1]
const s = (v, max = 4000) => String(v ?? '').trim().slice(0, max)

export const AGENTS = {
  contract_review: {
    key: 'contract_review',
    title: 'Vertragsprüfung',
    icon: 'contract',
    short: 'Klauselweise Prüfung nach österreichischem Recht mit Ampel, Formulierungsvorschlägen und Kommentaren im Word-Dokument.',
    needsDocuments: true,
    steps: [
      { title: 'Erfassen', text: 'Vertragstyp, Parteien und Vertretungsbefugnis, Rolle der Mandantin, Unternehmer- oder Verbrauchergeschäft.' },
      { title: 'Prüfraster anwenden', text: 'Klausel für Klausel nach dem österreichischen Prüfraster: Leistung, Entgelt, Gewährleistung, Haftung, AGB-Kontrolle, Laufzeit, Form und Gebühren, Streitbeilegung.' },
      { title: 'Rechtsfragen klären', text: 'Schwierige Fragen gehen in einer einzigen Anfrage an AI:ssociate, gemeinsam mit dem Wortlaut der betroffenen Klauseln.' },
      { title: 'Bewerten', text: 'Ampel je Klausel, Risiko für die Mandantin, konkreter Formulierungsvorschlag.' },
      { title: 'Ergebnis', text: 'Kommentare im Word-Dokument, Issues-Liste und Prüfmemo.' },
      { title: 'Verhandeln', text: 'Optional im Anschluss: Redline mit Änderungsvorschlägen und Begleitschreiben an die Gegenseite.' },
    ],
    grid: REVIEW_GRID,
    fields: [
      { k: 'contract_type', label: 'Vertragstyp', type: 'select', opts: ['automatisch erkennen', ...CONTRACT_TYPES.filter((t) => t.key !== 'sonstig').map((t) => t.label), 'AGB', 'Sonstiger'] },
      { k: 'perspective', label: 'Wir vertreten', type: 'select', opts: PERSPECTIVES },
      { k: 'consumer', label: 'Geschäftsart', type: 'select', opts: CONSUMER },
      { k: 'goal', label: 'Prüftiefe', type: 'select', opts: ['nur kritische Punkte (rot/gelb)', 'vollständige Prüfung aller Klauseln', 'maximal mandantenfreundliche Gegenposition'] },
      { k: 'output', label: 'Ergebnis', type: 'select', opts: ['Kommentare im Word-Dokument + Issues-Liste', 'Prüfmemo (Word)', 'Issues-Liste (Excel)', 'nur Antwort im Chat'] },
      { k: 'focus', label: 'Schwerpunkt (optional)', type: 'text', ph: 'z. B. Haftung, Wertsicherung, Change of Control' },
      { k: 'notes', label: 'Hinweise zum Mandat (optional)', type: 'textarea', ph: 'Verhandlungsstand, Ziele, rote Linien der Mandantin …' },
    ],
    phases: {
      review: {
        label: 'Vertrag prüfen', mode: 'document', difficulty: 'hard',
        next: [{ phase: 'redline', label: 'Redline und Begleitschreiben erstellen' }],
        build: (p) => {
          const out = s(p.output) || 'Kommentare im Word-Dokument + Issues-Liste'
          const word = /word|kommentar/i.test(out) && !/memo/i.test(out)
          const excel = /excel|issues/i.test(out)
          const memo = /memo/i.test(out)
          return {
            text: `Vertragsprüfung${p.contract_type && !/automatisch/.test(p.contract_type) ? ` (${s(p.contract_type, 80)})` : ''} – wir vertreten: ${s(p.perspective, 60) || 'neutral'}${p.focus ? ` – Schwerpunkt: ${s(p.focus, 200)}` : ''}`,
            extra: `AGENT VERTRAGSPRÜFUNG (österreichisches Recht)
Mandantin / Perspektive: ${s(p.perspective, 80) || 'neutral'}. Geschäftsart: ${s(p.consumer, 80) || 'unklar'}. Vertragstyp: ${s(p.contract_type, 120) || 'automatisch erkennen'}. Prüftiefe: ${s(p.goal, 120) || 'nur kritische Punkte'}.${p.focus ? ` Schwerpunkt: ${s(p.focus, 300)}.` : ''}${p.notes ? `\nHinweise zum Mandat: ${s(p.notes, 2000)}` : ''}

ARBEITSABLAUF
1. Erfassen: Vertragstyp, Parteien, Vertretung, Rolle der Mandantin, B2B oder B2C (bei Verbrauchern KSchG zwingend).
2. Prüfraster Klausel für Klausel anwenden (nur Punkte mit Befund ausführen, aber das ganze Raster prüfen):
${REVIEW_GRID.map((g, i) => `   ${i + 1}. ${g.label}: ${g.text}`).join('\n')}
3. Bewertung je Befund: Klausel (Nummer + kurzes wörtliches Zitat), Ampel (rot = nicht akzeptabel / unwirksam / hohes Risiko, gelb = nachverhandeln, grün = marktüblich), Risiko für die Mandantin, Rechtsgrundlage, konkreter Formulierungsvorschlag.
4. Fehlende Regelungen, die für diesen Vertragstyp üblich sind, gesondert auflisten.

ERGEBNIS
${word ? '- Mit create_or_edit_file: echte Word-Kommentare (Autor „AI:ssociate“) an genau den betroffenen Absätzen der hochgeladenen .docx (Mapping Absatztext → Kommentartext wörtlich übergeben); bei PDF stattdessen ein Prüfmemo als .docx.\n' : ''}${excel ? '- Mit create_or_edit_file: Issues-Liste als .xlsx (Spalten: Nr., Klausel, Zitat, Ampel, Problem, Rechtsgrundlage, Vorschlag, Verhandlungsposition).\n' : ''}${memo ? '- Mit create_or_edit_file: Prüfmemo als .docx (Sachverhalt, Ergebnis in Kürze, Befunde nach Ampel, fehlende Regelungen, Empfehlung).\n' : ''}- Antwort im Chat: Ergebnis in drei Sätzen, Tabelle der roten und gelben Punkte (Klausel | Ampel | Problem | Vorschlag), fehlende Regelungen, offene Fragen an die Mandantin.`,
          }
        },
      },
      redline: {
        label: 'Redline und Begleitschreiben', mode: 'document', difficulty: 'hard', kb: false,
        next: [],
        build: (p) => ({
          text: 'Redline mit Änderungsvorschlägen und Begleitschreiben zur Vertragsprüfung',
          extra: `AGENT VERTRAGSPRÜFUNG – PHASE REDLINE
Grundlage ist die Prüfung in der vorigen Antwort (im Verlauf) und der Vertrag aus dieser Unterhaltung. Wir vertreten: ${s(p.perspective, 80) || 'neutral'}.
1. Mit create_or_edit_file eine Redline des Vertrags als .docx erzeugen: für jeden roten und gelben Punkt die konkrete Neuformulierung (Streichungen rot durchgestrichen, Ergänzungen grün), Formatierung des Originals erhalten; wenn das Original kein Word-Dokument ist, eine Gegenüberstellung (Klausel alt | Klausel neu | Begründung) als .docx.
2. Ein kurzes Begleitschreiben an die Gegenseite als .docx (sachlich, mit den wichtigsten Änderungswünschen und ihrer Begründung, ohne interne Risikobewertung).
3. Antwort: Liste der Änderungen (Klausel | neu | Begründung) und Hinweise für die Verhandlung.`,
        }),
      },
    },
  },

  contract_draft: {
    key: 'contract_draft',
    title: 'Vertrag entwerfen',
    icon: 'draft',
    short: 'Vom Term Sheet über die geprüfte Gliederung zum fertigen Vertragsentwurf in Word, mit Formerfordernissen und Gebühren nach österreichischem Recht.',
    steps: [
      { title: 'Eckdaten', text: 'Vertragstyp, Parteien, Rolle der Mandantin, Leistung, Entgelt, Laufzeit, besondere Wünsche (Term Sheet).' },
      { title: 'Rahmen klären', text: 'Zwingendes Recht, Formerfordernisse (Notariatsakt, Schriftform, Beglaubigung), Gebühren und Steuern, Genehmigungen – schwierige Fragen in einer AI:ssociate-Anfrage.' },
      { title: 'Gliederung', text: 'Klauselstruktur mit Kernregelungen und offenen Punkten zur Freigabe.' },
      { title: 'Ausformulieren', text: 'Vollständiger Entwurf als Word-Datei mit Platzhaltern [ … ] für fehlende Angaben und Varianten, wo eine Entscheidung nötig ist.' },
      { title: 'Selbstprüfung', text: 'Entwurf gegen das Prüfraster der Vertragsprüfung: Wirksamkeit, Ausgewogenheit, Lücken.' },
      { title: 'Übergabe', text: 'Word-Entwurf und Begleitnotiz mit Annahmen, offenen Punkten, Form- und Gebührenhinweisen.' },
    ],
    types: CONTRACT_TYPES,
    fields: [
      { k: 'contract_type', label: 'Vertragstyp', type: 'select', opts: CONTRACT_TYPES.map((t) => t.label), required: true },
      { k: 'perspective', label: 'Wir vertreten', type: 'select', opts: PERSPECTIVES },
      { k: 'consumer', label: 'Geschäftsart', type: 'select', opts: CONSUMER },
      { k: 'parties', label: 'Parteien', type: 'text', ph: 'z. B. Muster GmbH (FN 123456a), Wien / Max Beispiel, Graz' },
      { k: 'terms', label: 'Eckdaten (Term Sheet)', type: 'textarea', required: true, ph: 'Leistung, Entgelt, Laufzeit, Termine, Sicherheiten, besondere Vereinbarungen …' },
      { k: 'style', label: 'Ausrichtung', type: 'select', opts: ['ausgewogen', 'mandantenfreundlich', 'streng mandantenfreundlich (Erstentwurf für die Verhandlung)'] },
      { k: 'language', label: 'Sprache', type: 'select', opts: ['Deutsch', 'Englisch', 'zweisprachig Deutsch/Englisch'] },
      { k: 'notes', label: 'Weitere Vorgaben (optional)', type: 'textarea', ph: 'Hausmuster (als Anhang), Rechtswahl, Gerichtsstand, Schiedsgericht …' },
    ],
    phases: {
      outline: {
        label: 'Gliederung erstellen', mode: 'document', difficulty: null,
        next: [{ phase: 'draft', label: 'Entwurf ausformulieren (Word)' }],
        build: (p) => {
          const t = CONTRACT_TYPES.find((x) => x.label === p.contract_type) || labelOf(CONTRACT_TYPES, 'sonstig')
          return {
            text: `Vertragsentwurf ${t.label}: Gliederung${p.parties ? ` – Parteien: ${s(p.parties, 200)}` : ''}`,
            extra: `AGENT VERTRAG ENTWERFEN – PHASE 1 (RAHMEN UND GLIEDERUNG), österreichisches Recht
Vertragstyp: ${t.label}. Wir vertreten: ${s(p.perspective, 80) || 'neutral'}. Geschäftsart: ${s(p.consumer, 80) || 'unklar'}. Ausrichtung: ${s(p.style, 80) || 'ausgewogen'}. Sprache: ${s(p.language, 60) || 'Deutsch'}.
Parteien: ${s(p.parties, 600) || '[noch offen]'}
Eckdaten: ${s(p.terms, 6000) || '[keine]'}${p.notes ? `\nWeitere Vorgaben: ${s(p.notes, 2000)}` : ''}

TYPISCHE PRÜFPUNKTE FÜR DIESEN VERTRAGSTYP: ${t.notes}

AUFGABE (noch KEIN ausformulierter Vertrag, KEINE Datei):
1. Rahmen: zwingendes Recht, Formerfordernisse (Notariatsakt, Schriftform, Beglaubigung), Gebühren und Steuern, Genehmigungen und Registrierungen – jeweils mit Rechtsgrundlage.
2. Gliederung: nummerierte Klauselstruktur; zu jeder Klausel 1–2 Sätze zum vorgesehenen Inhalt und zur Position der Mandantin.
3. Offene Punkte: Angaben, die noch fehlen, und Entscheidungen, die die Mandantin treffen muss (mit Empfehlung).
Antworte in Markdown mit den Überschriften **Rahmen**, **Gliederung**, **Offene Punkte**.`,
          }
        },
      },
      draft: {
        label: 'Entwurf ausformulieren', mode: 'document', difficulty: 'hard', kb: false,
        next: [{ phase: 'check', label: 'Entwurf prüfen (Prüfraster)' }],
        build: (p) => {
          const t = CONTRACT_TYPES.find((x) => x.label === p.contract_type) || labelOf(CONTRACT_TYPES, 'sonstig')
          return {
            text: `Vertragsentwurf ${t.label}: ausformulieren`,
            extra: `AGENT VERTRAG ENTWERFEN – PHASE 2 (AUSFORMULIEREN)
Grundlage: Rahmen und Gliederung aus der vorigen Antwort (im Verlauf), Eckdaten: ${s(p.terms, 6000) || '[siehe Verlauf]'}${p.notes ? `\nWeitere Vorgaben: ${s(p.notes, 2000)}` : ''}
Vertragstyp: ${t.label}. Wir vertreten: ${s(p.perspective, 80) || 'neutral'}. Ausrichtung: ${s(p.style, 80) || 'ausgewogen'}. Sprache: ${s(p.language, 60) || 'Deutsch'}. Parteien: ${s(p.parties, 600) || '[Platzhalter]'}.
Typische Prüfpunkte: ${t.notes}

AUFGABE: Den vollständigen Vertragstext ausformulieren (Rubrum mit Parteien, Präambel falls sinnvoll, nummerierte Klauseln, Schlussbestimmungen, Unterschriftsblock, Anlagenverzeichnis). Fehlende Angaben als Platzhalter in eckigen Klammern, Varianten als „[Variante A: … / Variante B: …]“. Kanzleistil, präzise, ohne Floskeln. Ist ein Hausmuster angehängt, dessen Aufbau und Formulierungen übernehmen.
Mit create_or_edit_file als sauber formatierte .docx ausgeben (Überschriften, Nummerierung, Seitenzahlen, Schriftart einheitlich). Den gesamten Vertragstext wörtlich in task übergeben.
Antwort: Aufbau in Stichworten, getroffene Annahmen, offene Punkte, Form- und Gebührenhinweise (z. B. Notariatsakt, Vergebührung).`,
          }
        },
      },
      check: {
        label: 'Entwurf prüfen', mode: 'document', difficulty: 'hard', kb: false,
        next: [],
        build: (p) => ({
          text: 'Selbstprüfung des Vertragsentwurfs gegen das Prüfraster',
          extra: `AGENT VERTRAG ENTWERFEN – PHASE 3 (SELBSTPRÜFUNG)
Prüfe den Entwurf aus der vorigen Antwort (im Verlauf; die .docx liegt in /home/user) aus Sicht ${s(p.perspective, 80) || 'der Mandantin'} gegen das Prüfraster:
${REVIEW_GRID.map((g, i) => `${i + 1}. ${g.label}: ${g.text}`).join('\n')}
Antwort: Tabelle der gefundenen Schwächen (Klausel | Problem | Korrekturvorschlag), dann die Liste der offenen Punkte für die Mandantin. Keine neue Datei, außer eine Korrektur ist zwingend – dann die korrigierte .docx mit create_or_edit_file.`,
        }),
      },
    },
  },

  brief_draft: {
    key: 'brief_draft',
    title: 'Schriftsatz entwerfen',
    icon: 'brief',
    short: 'Klage, Klagebeantwortung, Rechtsmittel, einstweilige Verfügung oder Bescheidbeschwerde im österreichischen Schriftsatzaufbau, mit Beweisanboten und Begehren.',
    steps: [
      { title: 'Verfahren', text: 'Schriftsatzart, Gericht oder Behörde, sachliche und örtliche Zuständigkeit, Verfahrensart, Anwaltspflicht, Fristen prüfen.' },
      { title: 'Sachverhalt und Beweise', text: 'Tatsachenvorbringen geordnet, zu jeder Behauptung das Beweisanbot (Urkunden ./A ff, Parteienvernehmung, Zeugen, Sachverständige).' },
      { title: 'Rechtliche Begründung', text: 'Anspruchsgrundlagen, Einwendungen, Judikatur – in einer AI:ssociate-Anfrage mit dem Sachverhalt.' },
      { title: 'Gliederung', text: 'Aufbau des Schriftsatzes und Begehren zur Freigabe.' },
      { title: 'Ausformulieren', text: 'Kopf (Gericht, Parteien, Vertreter, Streitwert, „wegen“), Vorbringen, Beweisanbote, rechtliche Ausführungen, Begehren bzw. Anträge, Kostenhinweis – als Word-Datei.' },
      { title: 'Übergabe', text: 'Word-Entwurf und Prüfliste: Frist, Gebühren, Beilagen, Vollmacht, Einbringung im ERV.' },
    ],
    types: BRIEF_TYPES,
    fields: [
      { k: 'brief_type', label: 'Schriftsatz', type: 'select', opts: BRIEF_TYPES.map((t) => t.label), required: true },
      { k: 'court', label: 'Gericht / Behörde', type: 'text', ph: 'z. B. Bezirksgericht Innere Stadt Wien, LG für ZRS Graz, LVwG Salzburg' },
      { k: 'parties', label: 'Parteien und Vertreter', type: 'textarea', ph: 'Klägerin: … vertreten durch …; Beklagter: …' },
      { k: 'amount', label: 'Streitwert / Begehren', type: 'text', ph: 'z. B. 18.400 EUR samt 4 % Zinsen seit 1.3.2026' },
      { k: 'facts', label: 'Sachverhalt', type: 'textarea', required: true, ph: 'Was ist passiert? Daten, Beträge, Korrespondenz …' },
      { k: 'evidence', label: 'Beweismittel', type: 'textarea', ph: 'Urkunden, Zeugen, Sachverständige …' },
      { k: 'opponent', label: 'Vorbringen der Gegenseite / angefochtene Entscheidung (optional)', type: 'textarea', ph: 'Bei Klagebeantwortung, Rechtsmittel, Beschwerde: Kernaussagen des Gegners bzw. der Entscheidung' },
      { k: 'notes', label: 'Weitere Vorgaben (optional)', type: 'textarea', ph: 'Strategie, Ton, Schwerpunkte …' },
    ],
    phases: {
      outline: {
        label: 'Rechtliche Prüfung und Gliederung', mode: 'document', difficulty: 'hard',
        next: [{ phase: 'draft', label: 'Schriftsatz ausformulieren (Word)' }],
        build: (p) => {
          const t = BRIEF_TYPES.find((x) => x.label === p.brief_type) || labelOf(BRIEF_TYPES, 'sonstig')
          return {
            text: `${t.label}${p.court ? ` an ${s(p.court, 120)}` : ''}: rechtliche Prüfung und Gliederung`,
            extra: `AGENT SCHRIFTSATZ ENTWERFEN – PHASE 1 (PRÜFUNG UND GLIEDERUNG), österreichisches Verfahrensrecht
Schriftsatz: ${t.label}. Gericht/Behörde: ${s(p.court, 200) || '[zu bestimmen]'}. Streitwert/Begehren: ${s(p.amount, 300) || '[offen]'}.
Parteien: ${s(p.parties, 1200) || '[offen]'}
Sachverhalt: ${s(p.facts, 8000) || '[siehe Unterlagen]'}
Beweismittel: ${s(p.evidence, 3000) || '[siehe Unterlagen]'}${p.opponent ? `\nVorbringen der Gegenseite / angefochtene Entscheidung: ${s(p.opponent, 6000)}` : ''}${p.notes ? `\nWeitere Vorgaben: ${s(p.notes, 2000)}` : ''}

TYPISCHE ERFORDERNISSE: ${t.notes}

AUFGABE (noch KEIN ausformulierter Schriftsatz, KEINE Datei):
1. Verfahren: Zuständigkeit (sachlich, örtlich), Verfahrensart, Anwaltspflicht, Form- und Inhaltserfordernisse; Fristen nur als Prüfpunkt mit Rechtsgrundlage nennen (keine Fristberechnung).
2. Rechtliche Begründung: Anspruchsgrundlagen bzw. Anfechtungsgründe, zu erwartende Einwendungen, einschlägige Judikatur.
3. Beweisthemen: jede wesentliche Tatsachenbehauptung mit dem passenden Beweismittel; Beweislücken.
4. Gliederung des Schriftsatzes und Formulierung des Begehrens bzw. der Anträge.
5. Offene Punkte und Risiken.
Antworte in Markdown mit den Überschriften **Verfahren**, **Rechtliche Begründung**, **Beweisthemen**, **Gliederung und Begehren**, **Offene Punkte**.`,
          }
        },
      },
      draft: {
        label: 'Schriftsatz ausformulieren', mode: 'document', difficulty: 'hard', kb: false,
        next: [{ phase: 'counter', label: 'Gegenargumente durchspielen' }],
        build: (p) => {
          const t = BRIEF_TYPES.find((x) => x.label === p.brief_type) || labelOf(BRIEF_TYPES, 'sonstig')
          return {
            text: `${t.label}: ausformulieren`,
            extra: `AGENT SCHRIFTSATZ ENTWERFEN – PHASE 2 (AUSFORMULIEREN)
Grundlage: Prüfung und Gliederung aus der vorigen Antwort (im Verlauf). Schriftsatz: ${t.label}. Gericht/Behörde: ${s(p.court, 200) || '[Gericht]'}. Streitwert/Begehren: ${s(p.amount, 300) || '[Streitwert]'}.
Parteien: ${s(p.parties, 1200) || '[Parteien]'}
Sachverhalt: ${s(p.facts, 8000) || '[siehe Verlauf]'}
Beweismittel: ${s(p.evidence, 3000) || '[siehe Verlauf]'}
Typische Erfordernisse: ${t.notes}

AUFBAU (österreichische Praxis):
- Kopf: Gericht bzw. Behörde, Aktenzeichen falls vorhanden, Parteien mit Anschrift und Vertretern (Vertreter mit Vollmachtsberufung nach § 30 Abs 2 ZPO, wo passend), Streitwert, „wegen …“, Bezeichnung des Schriftsatzes, ggf. Hinweis auf Beilagen.
- Text: gegliedertes Tatsachenvorbringen in nummerierten Punkten, nach jeder Tatsachenbehauptung „Beweis:“ mit Urkunden (./A, ./B …), PV, Zeugen (Name, ladungsfähige Anschrift als Platzhalter), SV.
- Rechtliche Ausführungen mit Normen und Judikatur (nur belegte Fundstellen aus dem Verlauf).
- Begehren bzw. Anträge in vollstreckbarer, bestimmter Fassung; Kostenersatzantrag; bei Rechtsmitteln Anfechtungserklärung und Rechtsmittelantrag.
- Unterschrifts- bzw. Vertreterblock, Beilagenverzeichnis.
Fehlende Angaben als Platzhalter in eckigen Klammern. Mit create_or_edit_file als sauber formatierte .docx ausgeben (gesamten Text wörtlich in task).
Antwort: Aufbau in Stichworten, Prüfliste vor Einbringung (Frist, Gebühren nach GGG, Beilagen, Vollmacht, ERV), offene Punkte.`,
          }
        },
      },
      counter: {
        label: 'Gegenargumente', mode: 'document', difficulty: 'hard', kb: false,
        next: [],
        build: () => ({
          text: 'Gegenargumente zum Schriftsatz durchspielen',
          extra: `AGENT SCHRIFTSATZ ENTWERFEN – PHASE 3 (GEGENPRÜFUNG)
Lies den Schriftsatz aus der vorigen Antwort (im Verlauf; die .docx liegt in /home/user) aus Sicht der Gegenseite bzw. des Gerichts: die stärksten Gegenargumente und prozessualen Angriffspunkte (Zuständigkeit, Schlüssigkeit, Bestimmtheit des Begehrens, Beweislast, Verjährung, Präklusion). Antwort: Tabelle (Angriffspunkt | Gewicht | Gegenmaßnahme im Schriftsatz), dann konkrete Ergänzungsvorschläge als Textbausteine.`,
        }),
      },
    },
  },
}

export const AGENT_KEYS = Object.keys(AGENTS)

/** Public view for the UI (no prompt builders). */
export function agentsForClient() {
  return AGENT_KEYS.map((k) => {
    const a = AGENTS[k]
    return {
      key: a.key, title: a.title, icon: a.icon, short: a.short, needsDocuments: Boolean(a.needsDocuments), steps: a.steps, fields: a.fields,
      grid: a.grid ? a.grid.map((g) => ({ label: g.label, text: g.text })) : null,
      types: a.types ? a.types.map((t) => ({ label: t.label, notes: t.notes })) : null,
      phases: Object.fromEntries(Object.entries(a.phases).map(([pk, ph]) => [pk, { label: ph.label, next: ph.next }])),
      firstPhase: Object.keys(a.phases)[0],
      version: AGENTS_VERSION,
    }
  })
}

/** Resolve a chat task of type 'agent' into prompt text, extra instructions and routing overrides. */
export function buildAgentTask(task) {
  const a = AGENTS[task?.agent]
  if (!a) return null
  const phaseKey = a.phases[task.phase] ? task.phase : Object.keys(a.phases)[0]
  const ph = a.phases[phaseKey]
  const params = task.params && typeof task.params === 'object' ? task.params : {}
  const clean = Object.fromEntries(Object.entries(params).filter(([k, v]) => a.fields.some((f) => f.k === k) && (typeof v === 'string' || typeof v === 'number')).map(([k, v]) => [k, String(v)]))
  const r = ph.build(clean)
  return { agent: a.key, title: a.title, phase: phaseKey, phaseLabel: ph.label, text: r.text, extra: r.extra, forceMode: ph.mode || null, difficulty: ph.difficulty || null, kb: ph.kb !== false, next: ph.next || [] }
}
