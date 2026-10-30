// Due-diligence configuration for Austrian legal and tax due diligence.
// Explicit, versioned knowledge: review areas, typical documents, red-flag
// rules and request-list prompts. Everything here is deterministic and shared
// by every DD run, so it is code, not a prompt the model may vary.

// Rule hints (GES-001 …) name the typical red flag and its baseline severity so
// the model can reference them; the reviewer can override every grade.
export const DD_AREAS = [
  {
    key: 'gesellschaft', label: 'Gesellschaftsrecht & Firmenbuch', profession: 'legal', code: 'GES',
    documents: 'Gesellschaftsvertrag/Satzung mit allen Änderungen, aktueller Firmenbuchauszug mit Urkundensammlung, Gesellschafterliste, Anteilsübertragungen (Notariatsakte § 76 GmbHG), General-/Hauptversammlungsbeschlüsse der letzten 3 Jahre, Geschäftsordnungen, Syndikats-/Gesellschaftervereinbarungen, Umgründungsverträge, WiEReG-Meldung, Jahresabschlüsse und Offenlegungsnachweise',
    redFlags: 'GES-001 Vinkulierung/Aufgriffs-/Vorkaufsrechte und Zustimmungsvorbehalte (gelb, rot wenn sie den Deal blockieren); GES-002 Vetorechte in Syndikatsverträgen; GES-003 Kette der Anteilsübertragungen lückenhaft oder ohne Notariatsakt (rot); GES-004 ausstehende Einlagen/Nachschusspflichten; verdeckte Sacheinlagen; GES-005 Firmenbuchstand ≠ Gesellschafterliste (rot); fehlende Beschlüsse für zustimmungspflichtige Geschäfte; GES-006 Offenlegung > 9 Monate überfällig (§§ 277/283 UGB, gelb); GES-007 WiEReG-Meldung fehlt/veraltet; Umgründungen mit Haftungsfolgen (§ 38 UGB, § 14 BAO, § 1409 ABGB); FlexKapG-Unternehmenswertanteile; Mindeststammkapital seit 1.1.2024',
    questions: 'Vollständige Kette der Anteilsübertragungen mit Notariatsakten; aktuelle Gesellschafterliste; alle Beschlüsse der letzten 3 Jahre; WiEReG-Auszug',
  },
  {
    key: 'vertraege', label: 'Wesentliche Verträge', profession: 'legal', code: 'VERT',
    documents: 'Top-Kunden- und Lieferantenverträge, Rahmenverträge, Vertriebs- und Handelsvertreterverträge (HVertrG, Ausgleichsanspruch), Kooperations- und Joint-Venture-Verträge, AGB, Wartungs- und Serviceverträge, Konzern-/Intercompany-Verträge',
    redFlags: 'VERT-001 Change of Control / Kündigungsrecht bei Gesellschafterwechsel (rot bei wesentlichen Vertragspartnern oder ≥ Wesentlichkeitsschwelle, sonst gelb); VERT-002 Exklusivität/Wettbewerbsverbot; VERT-003 Abtretungsverbot (beim Asset Deal relevant); einseitige Haftungsbegrenzung; Vertragsstrafen ohne Mäßigung (§ 1336 ABGB); automatische Verlängerung/lange Bindung; Mindestabnahme; Most-Favoured-Customer; Umsatzkonzentration; unübliche Zahlungsziele; VERT-004 Rechtswahl/Gerichtsstand außerhalb AT/EU; VERT-005 fehlende Unterschrift/Datum (Hinweis); VERT-006 Laufzeitende < 6 Monate nach Closing (gelb); AGB-Kontrolle (§ 864a, § 879 Abs 3 ABGB) bei Konsumenten',
    questions: 'Liste der Top-10-Kunden und -Lieferanten mit Vertragsstatus; alle Verträge mit CoC- oder Exklusivitätsklauseln; laufende Nachverhandlungen; unterschriebene Fassungen',
  },
  {
    key: 'arbeit', label: 'Arbeitsrecht', profession: 'legal', code: 'ARB',
    documents: 'Dienstverträge Geschäftsführung und Schlüsselkräfte, Musterdienstverträge/Dienstzettel (§ 2 AVRAG), Kollektivvertrag und Einstufung, Betriebsvereinbarungen, Betriebsrat, Bonus-/Beteiligungsprogramme (§ 67a EStG), Pensionszusagen/Abfertigung alt, freie Dienst- und Werkverträge, Mitarbeiterliste (Eintritt, Entgelt, Kündigungsfristen, Urlaubs-/Zeitguthaben), arbeitsgerichtliche Verfahren, Entsendungen (LSD-BG)',
    redFlags: 'ARB-001 CoC-/Abfindungsklauseln; ARB-002 Konkurrenzklausel ohne Entgeltgrenze oder über 1 Jahr (§§ 36/37 AngG, gelb); ARB-003 Scheinselbständigkeit/Werkvertragsrisiko (rot bei Häufung); KV-Unterschreitung; All-in ohne Deckungsprüfung; offene Überstunden/Zeitguthaben ohne Rückstellung; ARB-004 Pensionszusagen ohne Deckung (rot); ARB-005 Betriebsübergang § 3 AVRAG beim Asset Deal (gelb); Kündigungsschutzfälle; Altersteilzeit; Frühwarnsystem § 45a AMFG bei geplantem Abbau',
    questions: 'Mitarbeiterliste mit Eintritt, Entgelt, Kündigungsfristen und Zeitguthaben; Liste aller freien Dienstnehmer/Werkvertragsnehmer; laufende arbeitsgerichtliche Verfahren; Pensions- und Abfertigungsverpflichtungen',
  },
  {
    key: 'immobilien', label: 'Immobilien & Miete', profession: 'legal', code: 'IMMO',
    documents: 'Grundbuchsauszüge (A/B/C-Blatt), Kaufverträge, Miet-/Pachtverträge mit Nachträgen, Baurechtsverträge, Bau- und Betriebsanlagenbescheide (§§ 74 ff GewO), Dienstbarkeiten, Pfandrechte, Energieausweise, Altlastenatlas, Grundverkehrsgenehmigungen, Mieterliste',
    redFlags: 'IMMO-001 Befristung/Kündigungsverzicht; IMMO-002 MRG-Voll-/Teilanwendung mit Mietzinsbeschränkung und Wertsicherung; IMMO-003 CoC/Weitergaberecht/Untermietverbot in Mietverträgen; IMMO-004 Betriebsanlagengenehmigung fehlt oder Auflagen offen (rot); IMMO-005 Lastenblatt mit offenen Pfandrechten, Vorkaufsrechten, Belastungs- und Veräußerungsverboten; nicht verbücherte Rechte; Altlasten-/Kontaminationsverdacht; Grundverkehrsgenehmigung fehlt; Vorsteuerberichtigung § 12 Abs 10 UStG bei Nutzungsänderung; Gebührenpflicht Geschäftsraummiete (GebG)',
    questions: 'Aktuelle Grundbuchsauszüge aller Liegenschaften; Mieterliste mit Laufzeiten und Mietzinsen; Betriebsanlagenbescheide samt Auflagen; Energieausweise',
  },
  {
    key: 'ip_it', label: 'IP, IT & Datenschutz', profession: 'legal', code: 'IP',
    documents: 'Marken-/Patent-/Designregisterauszüge (Patentamt, EUIPO), Lizenz-, SaaS- und Entwicklungsverträge, Domainliste, Open-Source-Inventar, Verarbeitungsverzeichnis (Art 30 DSGVO), Auftragsverarbeitungsverträge (Art 28), TOM, DSFA, Vorfälle/Meldungen (Art 33), DSB-Verfahren, KI-Systeme (KI-VO)',
    redFlags: 'IP-001 IP nicht auf die Gesellschaft registriert (rot); IP-002 fehlende Rechteübertragung von Entwicklern/Gründern; IP-003 Copyleft im Kernprodukt; IP-004 Lizenz mit CoC-Kündigung; IP-005 Verarbeitungsverzeichnis fehlt; Drittlandtransfer ohne Grundlage; gemeldete Vorfälle; DSB-Verfahren; KI-Systeme ohne Transparenz-/Kompetenznachweis (Art 4/50 KI-VO)',
    questions: 'IP-Register-Liste mit Inhabern; Liste aller Softwarekomponenten und Lizenzen; Datenschutzvorfälle der letzten 3 Jahre; Verzeichnis eingesetzter KI-Systeme',
  },
  {
    key: 'compliance', label: 'Compliance & Regulatorik', profession: 'legal', code: 'COMP',
    documents: 'Gewerbeberechtigungen/Konzessionen (Übertragbarkeit beim Asset Deal), Förderverträge/-bescheide (aws, FFG, Land) mit Bindungsfristen, Geldwäsche-/Sanktionsrichtlinien, WiEReG, Kartellrecht (Schwellen KartG/BWB), FDI-Screening (InvKG), Exportkontrolle, Umweltgenehmigungen, VbVG-Vorfälle, Hinweisgebersystem (HSchG)',
    redFlags: 'COMP-001 fehlende/nicht übertragbare Berechtigungen (rot); COMP-002 Förderung mit Rückforderung bei Eigentümerwechsel; COMP-003 Sanktionsbezug (rot); kartellrechtlich bedenkliche Vereinbarungen; COMP-004 Zusammenschlussanmeldung erforderlich (Condition Precedent); COMP-005 InvKG-Genehmigung bei ausländischem Erwerber in sensiblen Sektoren (CP); Umweltauflagen offen; fehlende HSchG-Meldestelle ab 50 Mitarbeitern',
    questions: 'Liste aller behördlichen Genehmigungen; Förderübersicht mit Bindungsfristen; Compliance-Richtlinien und Schulungsnachweise; Umsatzzahlen für Kartell-/InvKG-Schwellen',
  },
  {
    key: 'streit', label: 'Rechtsstreitigkeiten & Verfahren', profession: 'legal', code: 'LIT',
    documents: 'Klagen, Urteile, Vergleiche, Mahn-/Exekutionsverfahren, Verwaltungs(straf)verfahren, Strafverfahren, Anwaltsbestätigungen, Rückstellungsspiegel, Ediktsdatei-Abfrage',
    redFlags: 'LIT-001 anhängiges Verfahren mit Streitwert ≥ Wesentlichkeitsschwelle (rot); Serienbeschwerden/Produkthaftung; drohende Verfahren laut Korrespondenz; LIT-002 Rückstellung fehlt; Verfahren gegen Organe; Verbandsklage-/Abhilfeklage-Exposition; Insolvenznähe (§ 69 IO)',
    questions: 'Verfahrensliste mit Streitwert, Stand und Risikoeinschätzung; Anwaltsbestätigung der Berater; Rückstellungsspiegel',
  },
  {
    key: 'finanzierung', label: 'Finanzierung, Sicherheiten & Versicherung', profession: 'legal', code: 'FIN',
    documents: 'Kreditverträge, Anleihen, Sicherheiten (Pfand, Bürgschaft, Garantie, Zession), Gesellschafterdarlehen (EKEG), Leasing, Factoring, Polizzen (D&O, Betriebshaftpflicht, Cyber, Sach), Schadensakte',
    redFlags: 'FIN-001 CoC/Cross-Default (rot); FIN-002 Covenants verletzt oder knapp; FIN-003 persönliche Haftungen der Verkäufer (CP Enthaftung); FIN-004 Eigenkapitalersatz; Negative Pledge; Kündigungsrechte der Bank; FIN-005 Deckungslücken/Unterversicherung; Sicherheiten nicht verbüchert/registriert',
    questions: 'Finanzierungsübersicht mit Covenants und Stichtagsberechnung; Sicherheitenspiegel; Polizzenliste mit Deckungssummen; Schadenshistorie',
  },
  {
    key: 'steuern', label: 'Steuern & Abgaben (Tax DD)', profession: 'tax', code: 'TAX',
    documents: 'Bescheide KöSt/ESt/USt/KommSt/Lohnabgaben der letzten 5–7 Jahre, Erklärungen und Beilagen, Außenprüfungsberichte und Niederschriften, GPLB-Berichte, Steuerkonto und Rückstände, Rechtsmittel (Beschwerden, BFG-Erkenntnisse), Rulings (§ 118 BAO), Gruppenbesteuerung (Gruppenantrag, Steuerumlagevereinbarung), Umgründungsverträge/Einbringungsbilanzen, Verrechnungspreisdokumentation (VPDG), Pillar-2-Unterlagen, DAC6-/EU-MPfG-Meldungen, Forschungsprämie/IFB-Nachweise, Verlustvortragsnachweis',
    redFlags: 'TAX-001 offene Außenprüfung oder Rechtsmittel (rot ab Wesentlichkeitsschwelle); TAX-002 Verlustvorträge mit Mantelkauf-Risiko (§ 8 Abs 4 Z 2 KStG, rot); TAX-003 Gruppenbesteuerung mit Nachversteuerung oder Mindestdauer nicht erreicht; TAX-004 Umgründungen mit Sperrfristen und § 14 BAO-Haftung; TAX-005 Verrechnungspreise ohne Dokumentation; verdeckte Ausschüttungen; TAX-006 USt-Risiken (Reverse Charge, ig Lieferung ohne UID/ZM, Vorsteuer ohne § 11-Rechnung, Vorsteuerberichtigung Immobilien); TAX-007 Lohnabgaben bei Scheinselbständigkeit/Sachbezügen; TAX-008 Grunderwerbsteuer bei Anteilsvereinigung/-übertragung ≥ 75 % (§ 1 Abs 3 GrEStG, rot); ImmoESt; Quellensteuern/DBA; TAX-009 Haftung des Erwerbers (§ 14 BAO, § 1409 ABGB) beim Asset Deal; TAX-010 DAC6-Meldepflicht nicht erfüllt; Festsetzungsverjährung (§§ 207–209 BAO); Steuerkonto-Rückstände; fehlende Rulings bei aggressiven Strukturen; Forschungsprämie/IFB-Behaltefristen; Selbstanzeige-Historie',
    questions: 'Übersicht aller Steuerverfahren und Bescheide; Steuerkontoauszug; Verlustvortragsnachweis; Gruppen- und Umgründungsverträge; Verrechnungspreisdokumentation; Lohnabgabenprüfberichte; DAC6-Meldungen',
  },
]

/** Cross-area notes that depend on the transaction structure (evaluated once per matter). */
export const TRANSACTION_NOTES = {
  share: 'Share Deal: Grunderwerbsteuer-Anteilsregel (§ 1 Abs 3 GrEStG), Mantelkauf (§ 8 Abs 4 Z 2 KStG), Haftungen bleiben in der Gesellschaft, Change-of-Control-Klauseln entscheidend, WiEReG-Neumeldung binnen 4 Wochen, Kartell-/InvKG-Anmeldung prüfen.',
  asset: 'Asset Deal: Übernehmerhaftung § 38 UGB / § 1409 ABGB / § 14 BAO, Betriebsübergang § 3 AVRAG, Übertragbarkeit von Verträgen, Berechtigungen und Förderungen (Abtretungsverbote, Zustimmungen), USt-Geschäftsveräußerung, Grunderwerbsteuer auf Liegenschaften, Kartell-/InvKG-Anmeldung prüfen.',
}

/** What a finding means for the transaction documents (separate from severity). */
export const DEAL_IMPACTS = ['CP', 'Garantie', 'Freistellung', 'Kaufpreis', 'Abbruch', 'Nachfrage', 'keine']
export const DEAL_IMPACT_LABEL = { CP: 'Condition Precedent', Garantie: 'Garantie', Freistellung: 'Freistellung', Kaufpreis: 'Kaufpreis / Escrow', Abbruch: 'Abbruchempfehlung', Nachfrage: 'Nachfrage im Datenraum', keine: 'keine' }
export const REVIEW_STATUS = ['open', 'accepted', 'modified', 'rejected']
export const REVIEW_LABEL = { open: 'offen', accepted: 'freigegeben', modified: 'geändert', rejected: 'verworfen' }

export const DD_AREA_KEYS = DD_AREAS.map((a) => a.key)
export const DOC_TYPES = ['Vertrag', 'Gesellschaftsdokument', 'Firmenbuch-/Registerauszug', 'Dienstvertrag', 'Mietvertrag', 'Bescheid', 'Urteil/Beschluss', 'Steuererklärung/Bescheid', 'Prüfbericht', 'Jahresabschluss', 'Versicherungspolizze', 'Kreditvertrag', 'Korrespondenz', 'Liste/Tabelle', 'Sonstiges']
export const SEVERITIES = ['red', 'amber', 'green', 'info']
export const SEVERITY_LABEL = { red: 'Rot – Deal-relevant', amber: 'Gelb – wesentlich, lösbar', green: 'Grün – unkritisch', info: 'Hinweis' }

export const AREA_SYNTHESIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'Gesamtbild des Bereichs in 4–10 Sätzen' },
    key_risks: { type: 'array', items: { type: 'string' } },
    cross_document_issues: { type: 'array', items: { type: 'string' }, description: 'Widersprüche oder Muster über mehrere Dokumente' },
    missing_documents: { type: 'array', items: { type: 'string' } },
    requests: { type: 'array', items: { type: 'string' }, description: 'Höchstens 6 priorisierte, gebündelte Nachfragen an den Verkäufer' },
    deal_recommendations: { type: 'array', items: { type: 'string' }, description: 'Garantien, Freistellungen, CPs, Kaufpreismechanismen' },
  },
  required: ['summary', 'key_risks', 'cross_document_issues', 'missing_documents', 'requests', 'deal_recommendations'],
}

export const EXEC_SUMMARY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    executive_summary: { type: 'string', description: 'Management Summary für Mandanten, 8–15 Sätze, Markdown-Absätze erlaubt' },
    top_red_flags: { type: 'array', items: { type: 'string' } },
    next_steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['executive_summary', 'top_red_flags', 'next_steps'],
}
/** Overall assessment – set by rules from the themes (lib/severity.js), never by the model. */
export const OVERALL = ['Abbruch erwägen', 'unter Bedingungen fortführen', 'fortführen mit Garantien und Freistellungen']

export const REVIEW_TABLE_PRESETS = [
  { key: 'vertraege', label: 'Vertragsübersicht', columns: ['Vertragspartner', 'Vertragsgegenstand', 'Laufzeit / Ende', 'Kündigungsfrist', 'Change-of-Control-Klausel', 'Exklusivität / Wettbewerbsverbot', 'Haftungsbegrenzung', 'Rechtswahl / Gerichtsstand'] },
  { key: 'dienst', label: 'Dienstverträge', columns: ['Dienstnehmer', 'Funktion', 'Eintritt', 'Entgelt (brutto, Basis)', 'Kündigungsfrist', 'Konkurrenzklausel', 'Bonus / Beteiligung', 'Besonderheiten'] },
  { key: 'miete', label: 'Mietverträge', columns: ['Objekt', 'Vermieter', 'Mietzins', 'Befristung / Laufzeit', 'Kündigungsverzicht', 'Indexierung', 'Weitergabe / Untermiete', 'MRG-Anwendungsbereich'] },
  { key: 'fristen', label: 'Chronologie / Fristen', columns: ['Datum', 'Ereignis', 'Beteiligte', 'Frist / Rechtsfolge', 'Quelle (Dokument, Stelle)'] },
  { key: 'steuern', label: 'Steuerbescheide & Prüfungen', columns: ['Abgabe / Jahr', 'Bescheiddatum', 'Betrag', 'Rechtsmittel / Status', 'Außenprüfung', 'Feststellungen', 'Risiko'] },
]

// ---------------------------------------------------------------------------
// v2: documents, facts register, findings with features, themes
// ---------------------------------------------------------------------------
/** Bump when a prompt, schema or catalogue changes: cached model results of older versions are not reused. */
export const PIPELINE_VERSION = { inventory: 'inv-1', read: 'read-1', issues: 'iss-1', review: 'rev-1', legal: 'leg-2' }

export const DOC_ROLES = ['Originalunterlage', 'Sekundärquelle', 'Entwurf', 'Plan/Zeichnung', 'Datenblatt']
export const LEGAL_SUBJECTS = ['Zielgesellschaft', 'Gesellschafter', 'Vorbetreiber', 'Dritter']
export const REPORT_TYPES = { redflag: 'Red-Flag-Bericht', full: 'Vollbericht' }
/** Why a document is not analysed (status "skipped"); every skipped document stays in the inventory. */
export const SKIP_REASONS = { duplicate: 'Duplikat', limit: 'über der Grenze', secondary: 'Sekundärquelle', role: 'kein Prüfgegenstand (Plan/Datenblatt)', unreadable: 'kein Text lesbar', unsupported: 'Dateityp nicht lesbar', failed: 'Verarbeitung fehlgeschlagen', budget: 'Token-Grenze erreicht' }

/**
 * Core prerequisites of the business: a gap or defect here is red even without an amount
 * (severity rules 4 and 5). Given to the model so it can set the feature "kernvoraussetzung".
 */
export const CORE_PREREQUISITES = [
  'Eigentum an den verkauften Anteilen bzw. Wirtschaftsgütern (lückenlose Übertragungskette, Formgebote)',
  'Bestellung und Vertretungsbefugnis der Organe (Geschäftsführung, Vorstand, Prokura) laut Firmenbuch',
  'Berechtigungen für die Kerntätigkeit (Gewerbeberechtigung, Konzession, Zulassung, Lizenz) – je nach Branche',
  'Anlagen- und Materiengenehmigungen, ohne die der Betrieb nicht geführt werden darf (z. B. Betriebsanlage, Umwelt-, Wasser-, Bau-, Abfall-, Verkehrs-, Gesundheits- oder Energierecht)',
  'Funktionsträger, an deren Person eine Berechtigung hängt (z. B. gewerberechtlicher Geschäftsführer, fachkundige oder verantwortliche Person, Verkehrsleiter)',
  'Nutzungsrecht an den Betriebsstandorten (Eigentum, Miete, Pacht, Baurecht, Dienstbarkeit)',
  'Bestand der wesentlichen Kunden-, Liefer- und Finanzierungsverträge nach dem Kontrollwechsel',
  'Steuerliche Positionen mit unmittelbarer Kaufpreiswirkung (Grunderwerbsteuer, Verlustvorträge, offene Prüfungen)',
  'Kern-IP, Software und Daten, auf denen das Geschäftsmodell beruht',
]

/**
 * Exclusion catalogue: constellations that are no finding at all (severity rule 1).
 * The tests are in lib/severity.js (they read the finding text and the facts register).
 */
export const EXCLUSIONS = [
  { id: 'AUS-1', label: 'Reverse Charge bei Bauleistungen (§ 19 Abs 1a UStG) ohne Hinweis auf fehlerhafte Anwendung' },
  { id: 'AUS-2', label: 'Vinkulierung, Aufgriffs- und Vorkaufsrechte, wenn alle Gesellschafter verkaufen' },
  { id: 'AUS-3', label: 'Ausschüttung mit dokumentierter Auszahlung vor dem Stichtag (Thema Kaufpreis)' },
  { id: 'AUS-4', label: 'Laut Faktenregister erloschene Rechte (z. B. Fruchtgenuss oder Stimmbindung zugunsten einer verstorbenen Person)' },
  { id: 'AUS-5', label: 'Übliche Standardklauseln der Banken ohne Auswirkung auf die Transaktion' },
]

/** Rules whose findings may be red although they concern someone other than the target (severity rule 2). */
export const RULES_ALLOW_NON_TARGET = ['GES-003', 'FIN-003', 'TAX-008', 'AKT-005']

/** Facts register: what is extracted from every original document (stage 2). */
export const FACT_TYPES = {
  gesellschafter: 'Gesellschafter / Anteile',
  organ: 'Organe / Vertretung',
  prokura: 'Prokura',
  todesfall: 'Todesfälle / Erbgänge',
  funktionstraeger: 'Funktionsträger laut Bescheid',
  genehmigung: 'Genehmigungen',
  standort: 'Standorte / Nutzungsrechte',
  vertrag: 'Verträge',
  zahlung_gesellschafter: 'Zahlungen an Gesellschafter',
  kennzahl: 'Kennzahlen (Jahresabschluss)',
  beschluss: 'Beschlüsse',
  recht_dritter: 'Rechte Dritter (Fruchtgenuss, Stimmbindung, Pfand)',
}
export const FACT_FLAGS = ['kontrollwechsel', 'befristet', 'verstorben', 'ausgeschieden', 'unterschrieben', 'nicht_unterschrieben', 'entwurf', 'gekuendigt', 'erloschen']
export const KEY_FIGURES = ['Umsatz', 'Jahresergebnis', 'Eigenkapital', 'Eigenkapitalquote', 'Bilanzsumme', 'Liquide Mittel', 'Bankverbindlichkeiten', 'Verbindlichkeiten gegenüber Gesellschaftern']

const FACT_ITEM = {
  type: 'object', additionalProperties: false,
  properties: {
    type: { type: 'string', enum: Object.keys(FACT_TYPES) },
    subject: { type: 'string', description: 'Wen oder was die Tatsache betrifft: Person, Gesellschaft, Genehmigung, Vertrag, Beschlussgegenstand' },
    ident: { type: 'string', description: 'Kennung des subject, wenn im Text genannt: Geburtsdatum JJJJ-MM-TT bei Personen, Firmenbuchnummer bei Gesellschaften; sonst leer' },
    attribute: { type: 'string', description: 'Merkmal, z. B. "Geschäftsanteil", "Geschäftsführer", "gewerberechtlicher Geschäftsführer", "Gegenstand", "Laufzeit", "Kaufpreis", "Eigenkapitalquote", "Teilnehmer"' },
    value: { type: 'string', description: 'Wert, wörtlich oder knapp: Prozentsatz, Name, Gegenstand; bei Beschlüssen die Namen der abstimmenden Gesellschafter, mit Komma getrennt' },
    amount: { type: ['number', 'null'], description: 'Betrag in EUR (bei Kennzahlen: Zahl bzw. Prozent als Zahl), sonst null' },
    counterparty: { type: 'string', description: 'Gegenpartei, Inhaber oder Behörde; sonst leer' },
    site: { type: 'string', description: 'Standort/Liegenschaft, falls genannt; sonst leer' },
    valid_from: { type: 'string', description: 'Beginn/Datum JJJJ-MM-TT, sonst leer' },
    valid_to: { type: 'string', description: 'Ende/Befristung/Todestag JJJJ-MM-TT, sonst leer' },
    flags: { type: 'array', items: { type: 'string', enum: FACT_FLAGS } },
    quote: { type: 'string', description: 'Wörtlicher Beleg (max. 200 Zeichen, exakt aus dem Text)' },
    location: { type: 'string', description: 'Fundstelle (Seite/Punkt/§)' },
  },
  required: ['type', 'subject', 'ident', 'attribute', 'value', 'amount', 'counterparty', 'site', 'valid_from', 'valid_to', 'flags', 'quote', 'location'],
}

/** Stage 0: role and legal subject of a document whose role the rules could not tell (first 3,000 characters). */
export const INVENTORY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    role: { type: 'string', enum: DOC_ROLES, description: 'Originalunterlage = Vertrag, Bescheid, Auszug, Beschluss, Abschluss, Korrespondenz, Rechnung; Sekundärquelle = Prüf- oder DD-Bericht, Memo, Gutachten oder Stellungnahme Dritter über andere Unterlagen; Entwurf = nicht unterfertigte/als Entwurf gekennzeichnete Fassung' },
    subject: { type: 'string', enum: LEGAL_SUBJECTS, description: 'Wessen Rechtsverhältnis das Dokument betrifft' },
    doc_type: { type: 'string', enum: DOC_TYPES },
  },
  required: ['role', 'subject', 'doc_type'],
}

/** Kinds of clause risk a single document can show by itself (bundled per kind and counterparty). */
export const CLAUSE_KINDS = {
  kontrollwechsel: { label: 'Kontrollwechsel', area: 'vertraege' },
  kuendigung_laufzeit: { label: 'Kündigung / Laufzeit / Befristung', area: 'vertraege' },
  haftung: { label: 'Haftung / Haftungsbegrenzung', area: 'vertraege' },
  exklusivitaet_wettbewerb: { label: 'Exklusivität / Wettbewerbsverbot', area: 'vertraege' },
  abtretung_zustimmung: { label: 'Abtretung / Zustimmungsvorbehalt', area: 'vertraege' },
  vertragsstrafe: { label: 'Vertragsstrafe / Pönale', area: 'vertraege' },
  finanzierung_sicherheiten: { label: 'Finanzierung / Sicherheiten / Covenants', area: 'finanzierung' },
  gesellschaftsrecht: { label: 'Gesellschaftsrecht (Anteile, Organe, Beschlüsse)', area: 'gesellschaft' },
  arbeitsrecht: { label: 'Arbeitsrecht', area: 'arbeit' },
  immobilien_miete: { label: 'Immobilien / Miete', area: 'immobilien' },
  genehmigung_auflage: { label: 'Genehmigung / Auflage / Berechtigung', area: 'compliance' },
  ip_it_datenschutz: { label: 'IP / IT / Datenschutz', area: 'ip_it' },
  steuern: { label: 'Steuern / Abgaben', area: 'steuern' },
  verfahren: { label: 'Verfahren / Streit', area: 'streit' },
  sonstiges: { label: 'Sonstiges', area: 'none' },
}
export const FINDING_KINDS = { mangel: 'festgestellter Mangel', luecke: 'Lücke / ungeklärt', hinweis: 'Hinweis' }
export const ISSUE_STATUS = { bestaetigt: 'bestätigt', ungeklaert: 'ungeklärt', widerlegt: 'widerlegt' }
export const DIFFICULTY = { leicht: 'leicht – internes Wissen', schwer: 'schwer – Websuche (RIS)', sehr_schwer: 'sehr schwer – AI:ssociate' }

/** Stage 2: reading one document – facts and the clauses that are risky by themselves. No conclusions about other documents. */
export const READ_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    doc_type: { type: 'string', enum: DOC_TYPES },
    area: { type: 'string', enum: [...DD_AREA_KEYS, 'none'] },
    title: { type: 'string', description: 'Kurzer, aussagekräftiger Dokumenttitel' },
    date: { type: 'string', description: 'Datum des Dokuments JJJJ-MM-TT, sonst leer' },
    summary: { type: 'string', description: '2–4 Sätze: Gegenstand, Parteien, Kernregelungen' },
    parties: { type: 'array', items: { type: 'string' } },
    subject: { type: 'string', enum: LEGAL_SUBJECTS, description: 'Wessen Rechtsverhältnis das Dokument betrifft' },
    key_terms: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { term: { type: 'string' }, value: { type: 'string' } }, required: ['term', 'value'] } },
    facts: { type: 'array', items: FACT_ITEM },
    clauses: {
      type: 'array',
      description: 'Klauseln/Stellen, die aus DIESEM Dokument heraus ein Risiko für die Transaktion bergen. Keine Aussagen über andere Dokumente oder darüber, was im Akt fehlt.',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: Object.keys(CLAUSE_KINDS) },
          rule: { type: 'string', description: 'Regel-ID aus dem Katalog (z. B. "VERT-001"), sonst leer' },
          title: { type: 'string', description: 'Konkret, z. B. "Kündigungsrecht der Hausbank bei Kontrollwechsel"' },
          counterparty: { type: 'string', description: 'Vertragspartner/Behörde, sonst leer' },
          subject: { type: 'string', description: 'Gegenstand in 2–6 Wörtern (z. B. "Betriebsmittelkredit")' },
          description: { type: 'string', description: 'Was die Klausel regelt und warum sie relevant ist (höchstens 60 Wörter)' },
          amount: { type: ['number', 'null'], description: 'Betroffener Betrag in EUR, sonst null' },
          quote: { type: 'string', description: 'Wörtliches Zitat (max. 300 Zeichen, exakt aus dem Text)' },
          location: { type: 'string', description: 'Fundstelle: Punkt/§/Seite' },
        },
        required: ['kind', 'rule', 'title', 'counterparty', 'subject', 'description', 'amount', 'quote', 'location'],
      },
    },
  },
  required: ['doc_type', 'area', 'title', 'date', 'summary', 'parties', 'subject', 'key_terms', 'facts', 'clauses'],
}

/** Stage 4: one pass over the Akt model – further questions that only the whole Akt shows. */
export const AKT_ISSUES_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'Sachverhalt in einer Zeile' },
          question: { type: 'string', description: 'Was konkret zu prüfen ist (ein Satz)' },
          area: { type: 'string', enum: [...DD_AREA_KEYS, 'none'] },
          entities: { type: 'array', items: { type: 'string' }, description: 'IDs der beteiligten Entitäten (E-…)' },
          documents: { type: 'array', items: { type: 'string' }, description: 'Nummern der einschlägigen Dokumente (D-…)' },
        },
        required: ['title', 'question', 'area', 'entities', 'documents'],
      },
    },
  },
  required: ['issues'],
}

/** Stage 5: one review per issue with the Akt-model slice and the relevant document passages. */
export const ISSUE_REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { type: 'string', enum: Object.keys(ISSUE_STATUS), description: 'bestaetigt = Risiko liegt nach dem Akt vor; ungeklaert = der Akt lässt es offen (Erforderliches nicht belegt, Identität unklar); widerlegt = der Akt zeigt, dass kein Risiko besteht' },
    title: { type: 'string', description: 'Titel des Sachverhalts für den Bericht' },
    area: { type: 'string', enum: [...DD_AREA_KEYS, 'none'] },
    description: { type: 'string', description: 'Sachverhalt aus dem ganzen Akt und rechtliche Einordnung nach österreichischem Recht (höchstens 150 Wörter)' },
    evidence: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { doc: { type: 'string', description: 'Dokumentnummer D-…' }, quote: { type: 'string', description: 'Wörtlich aus dem Auszug (max. 250 Zeichen)' }, location: { type: 'string' } }, required: ['doc', 'quote', 'location'] } },
    art: { type: 'string', enum: Object.keys(FINDING_KINDS) },
    betrag: { type: ['number', 'null'] },
    betroffen: { type: 'string', enum: LEGAL_SUBJECTS },
    heilbar: { type: 'boolean' },
    kernvoraussetzung: { type: 'boolean' },
    instrument: { type: 'string', enum: DEAL_IMPACTS },
    recommendation: { type: 'string', description: 'Umsetzung in der Transaktionsdokumentation (ein bis zwei Sätze)' },
    legal_question: { type: 'string', description: 'Die konkrete Rechtsfrage (ein Satz), leer wenn keine' },
    difficulty: { type: 'string', enum: Object.keys(DIFFICULTY), description: 'leicht = mit gesichertem Grundwissen beantwortbar; schwer = Normen/Judikatur nachzusehen (Websuche); sehr_schwer = ungeklärte oder spezielle Rechtsfrage' },
    requests: { type: 'array', items: { type: 'string' }, description: 'Höchstens 2 Nachfragen an den Verkäufer' },
    norms: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'title', 'area', 'description', 'evidence', 'art', 'betrag', 'betroffen', 'heilbar', 'kernvoraussetzung', 'instrument', 'recommendation', 'legal_question', 'difficulty', 'requests', 'norms'],
}

/** Stage 6, easy legal questions: answered from internal knowledge. */
export const LEGAL_EASY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['zutreffend', 'teilweise zutreffend', 'nicht zutreffend'] },
    answer: { type: 'string', description: 'Kurze Begründung mit Rechtsgrundlage (höchstens 120 Wörter)' },
    norms: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'answer', 'norms'],
}
