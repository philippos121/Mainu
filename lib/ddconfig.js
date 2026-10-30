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

/** JSON schema for the per-document analysis (strict mode: every property required, nulls allowed). */
export const DOC_ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    doc_type: { type: 'string', enum: DOC_TYPES },
    area: { type: 'string', enum: [...DD_AREA_KEYS, 'none'] },
    title: { type: 'string', description: 'Kurzer, aussagekräftiger Dokumenttitel' },
    summary: { type: 'string', description: '3–6 Sätze: Gegenstand, Parteien, Kernregelungen, Besonderheiten' },
    parties: { type: 'array', items: { type: 'string' } },
    dates: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { label: { type: 'string' }, date: { type: 'string' } }, required: ['label', 'date'] } },
    key_terms: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { term: { type: 'string' }, value: { type: 'string' } }, required: ['term', 'value'] }, description: 'z. B. Laufzeit, Kündigung, Haftung, Rechtswahl, Gerichtsstand, Entgelt, Change of Control, Exklusivität, Abtretung' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: SEVERITIES },
          area: { type: 'string', enum: [...DD_AREA_KEYS, 'none'] },
          title: { type: 'string', description: 'Konkret, z. B. "Change-of-Control-Kündigungsrecht des Kunden"' },
          description: { type: 'string', description: 'Sachverhalt, rechtliche Einordnung nach österreichischem Recht, Risiko' },
          quote: { type: 'string', description: 'Wörtliches Zitat der maßgeblichen Stelle (max. 300 Zeichen)' },
          location: { type: 'string', description: 'Fundstelle: Punkt/§/Seite/Absatz' },
          recommendation: { type: 'string', description: 'Empfehlung: Garantie, Freistellung, Kaufpreisanpassung, Condition Precedent, Nachfrage im Datenraum' },
          deal_impact: { type: 'string', enum: DEAL_IMPACTS, description: 'Instrument in der Transaktionsdokumentation, das der Befund erfordert' },
          rule: { type: 'string', description: 'Regel-ID aus dem Red-Flag-Katalog (z. B. "VERT-001"), sonst leer' },
          norms: { type: 'array', items: { type: 'string' }, description: 'Einschlägige Normen, z. B. "§ 38 UGB", "§ 14 BAO"' },
        },
        required: ['severity', 'area', 'title', 'description', 'quote', 'location', 'recommendation', 'deal_impact', 'rule', 'norms'],
      },
    },
    missing_or_unclear: { type: 'array', items: { type: 'string' }, description: 'Fehlende Anlagen, unleserliche Stellen, Verweise auf nicht vorliegende Dokumente' },
    questions: { type: 'array', items: { type: 'string' }, description: 'Konkrete Nachfragen an den Datenraum' },
    legal_questions: { type: 'array', items: { type: 'string' }, description: '0–3 KONKRETE, KOMPAKTE Rechtsfragen (je höchstens 2 Sätze plus nötige Fakten), die sich aus den roten/gelben Befunden dieses Dokuments ergeben und rechtlich zu klären sind; leer, wenn keine' },
    legal_difficulty: { type: 'string', enum: ['none', 'easy', 'hard', 'very_hard'], description: 'none = keine Rechtsfrage; easy = mit gesichertem Grundwissen beantwortbar; hard = Recherche in Normen und Judikatur nötig (Websuche im RIS reicht); very_hard = außergewöhnlich schwierige, ungeklärte Frage (strittige oder fehlende Judikatur, Spezialmaterie), bei der eine Websuche im RIS nicht reicht – sehr selten' },
  },
  required: ['doc_type', 'area', 'title', 'summary', 'parties', 'dates', 'key_terms', 'findings', 'missing_or_unclear', 'questions', 'legal_questions', 'legal_difficulty'],
}

/** Cheap first look at a document: type, area and how demanding the full analysis will be. */
export const DOC_TRIAGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    doc_type: { type: 'string', enum: DOC_TYPES },
    area: { type: 'string', enum: [...DD_AREA_KEYS, 'none'] },
    difficulty: { type: 'string', enum: ['easy', 'hard'], description: 'hard = umfangreicher oder komplexer Vertrag (viele Klauseln, Querverweise, Finanzierung, Gesellschafts- oder Umgründungsvertrag, Steuer-/Prüfberichte mit Zahlenwerk); easy = Standarddokument, kurz, Liste, Bescheid, Auszug' },
  },
  required: ['doc_type', 'area', 'difficulty'],
}

export const AREA_SYNTHESIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'Gesamtbild des Bereichs in 4–10 Sätzen' },
    key_risks: { type: 'array', items: { type: 'string' } },
    cross_document_issues: { type: 'array', items: { type: 'string' }, description: 'Widersprüche oder Muster über mehrere Dokumente' },
    missing_documents: { type: 'array', items: { type: 'string' } },
    requests: { type: 'array', items: { type: 'string' }, description: 'Nachfragen an den Verkäufer/Datenraum' },
    deal_recommendations: { type: 'array', items: { type: 'string' }, description: 'Garantien, Freistellungen, CPs, Kaufpreismechanismen' },
  },
  required: ['summary', 'key_risks', 'cross_document_issues', 'missing_documents', 'requests', 'deal_recommendations'],
}

export const EXEC_SUMMARY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    executive_summary: { type: 'string', description: 'Management Summary für Mandanten, 8–15 Sätze, Markdown-Absätze erlaubt' },
    top_red_flags: { type: 'array', items: { type: 'string' } },
    overall_assessment: { type: 'string', enum: ['unkritisch', 'mit Auflagen vertretbar', 'wesentliche Risiken', 'Deal-Breaker möglich'] },
    next_steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['executive_summary', 'top_red_flags', 'overall_assessment', 'next_steps'],
}

export const REVIEW_TABLE_PRESETS = [
  { key: 'vertraege', label: 'Vertragsübersicht', columns: ['Vertragspartner', 'Vertragsgegenstand', 'Laufzeit / Ende', 'Kündigungsfrist', 'Change-of-Control-Klausel', 'Exklusivität / Wettbewerbsverbot', 'Haftungsbegrenzung', 'Rechtswahl / Gerichtsstand'] },
  { key: 'dienst', label: 'Dienstverträge', columns: ['Dienstnehmer', 'Funktion', 'Eintritt', 'Entgelt (brutto, Basis)', 'Kündigungsfrist', 'Konkurrenzklausel', 'Bonus / Beteiligung', 'Besonderheiten'] },
  { key: 'miete', label: 'Mietverträge', columns: ['Objekt', 'Vermieter', 'Mietzins', 'Befristung / Laufzeit', 'Kündigungsverzicht', 'Indexierung', 'Weitergabe / Untermiete', 'MRG-Anwendungsbereich'] },
  { key: 'fristen', label: 'Chronologie / Fristen', columns: ['Datum', 'Ereignis', 'Beteiligte', 'Frist / Rechtsfolge', 'Quelle (Dokument, Stelle)'] },
  { key: 'steuern', label: 'Steuerbescheide & Prüfungen', columns: ['Abgabe / Jahr', 'Bescheiddatum', 'Betrag', 'Rechtsmittel / Status', 'Außenprüfung', 'Feststellungen', 'Risiko'] },
]
