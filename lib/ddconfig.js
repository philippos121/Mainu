// Due-diligence configuration for Austrian legal and tax due diligence.
// Explicit, versioned knowledge: review areas, typical documents, red-flag
// rules and request-list prompts. Everything here is deterministic and shared
// by every DD run, so it is code, not a prompt the model may vary.

export const DD_AREAS = [
  {
    key: 'gesellschaft', label: 'Gesellschaftsrecht & Firmenbuch', profession: 'legal',
    documents: 'Gesellschaftsvertrag/Satzung, Firmenbuchauszug, Gesellschafterliste, Generalversammlungs-/Hauptversammlungsbeschlüsse, Geschäftsordnungen, Syndikatsverträge, Umgründungsverträge, WiEReG-Meldung',
    redFlags: 'Vinkulierungen und Aufgriffsrechte, Zustimmungsvorbehalte bei Anteilsübertragung, Syndikatsverträge mit Vetorechten, nicht eingetragene oder widersprüchliche Firmenbuchdaten, ausstehende Einlagen, Nachschusspflichten, verdeckte Sacheinlagen, fehlende Beschlüsse für wesentliche Geschäfte, Umgründungen mit Haftungsfolgen (§ 38 UGB, § 14 BAO, § 1409 ABGB)',
    questions: 'Vollständige Kette der Anteilsübertragungen mit Notariatsakten; aktuelle Gesellschafterliste; alle Beschlüsse der letzten 3 Jahre',
  },
  {
    key: 'vertraege', label: 'Wesentliche Verträge', profession: 'legal',
    documents: 'Kunden- und Lieferantenverträge, Rahmenverträge, Vertriebs- und Handelsvertreterverträge, Kooperations- und Joint-Venture-Verträge, AGB, Wartungs- und Serviceverträge',
    redFlags: 'Change-of-Control-Klauseln, Kündigungsrechte bei Gesellschafterwechsel, Exklusivitäten und Wettbewerbsverbote, Abtretungsverbote, Haftungsbegrenzungen zugunsten der Gegenseite, Vertragsstrafen, automatische Verlängerungen, Umsatzkonzentration auf wenige Kunden, unübliche Zahlungsziele, Garantien, Most-Favoured-Customer, Mindestabnahmen',
    questions: 'Liste der Top-10-Kunden und -Lieferanten mit Vertragsstatus; alle Verträge mit CoC- oder Exklusivitätsklauseln; laufende Nachverhandlungen',
  },
  {
    key: 'arbeit', label: 'Arbeitsrecht', profession: 'legal',
    documents: 'Dienstverträge (Geschäftsführung, Schlüsselkräfte), Musterdienstverträge, Betriebsvereinbarungen, anwendbarer Kollektivvertrag, Bonus-/Beteiligungsprogramme, Pensionszusagen, freie Dienstverträge und Werkverträge, Betriebsratsunterlagen',
    redFlags: 'Change-of-Control- und Abfindungsklauseln, Konkurrenzklauseln (§ 36 AngG), Scheinselbständigkeit und Werkvertragsrisiken, Kollektivvertragsunterschreitung, offene Überstunden/Zeitguthaben, Pensionszusagen ohne Deckung, Betriebsübergang (AVRAG) bei Asset Deal, fehlende Einvernehmlichkeit bei Versetzungen, All-in-Vereinbarungen ohne Deckungsprüfung, Altersteilzeit',
    questions: 'Mitarbeiterliste mit Eintritt, Entgelt, Kündigungsfristen; Liste aller freien Dienstnehmer/Werkvertragsnehmer; laufende arbeitsgerichtliche Verfahren',
  },
  {
    key: 'immobilien', label: 'Immobilien & Miete', profession: 'legal',
    documents: 'Grundbuchsauszüge, Kaufverträge, Miet- und Pachtverträge, Baurechtsverträge, Bescheide (Bau, Betriebsanlage), Dienstbarkeiten, Hypotheken',
    redFlags: 'Befristungen und Kündigungsverzichte, MRG-Voll-/Teilanwendung und Mietzinsbeschränkungen, Weitergaberechte und Untermietverbote, Change-of-Control in Mietverträgen, Betriebsanlagengenehmigungen fehlen, Altlasten/Kontaminationsverdacht, nicht verbücherte Rechte, Vorkaufsrechte, Lastenblatt mit offenen Pfandrechten',
    questions: 'Aktuelle Grundbuchsauszüge aller Liegenschaften; Mieterliste mit Laufzeiten; Betriebsanlagenbescheide',
  },
  {
    key: 'ip_it', label: 'IP, IT & Datenschutz', profession: 'legal',
    documents: 'Marken-, Patent- und Designregisterauszüge, Lizenzverträge, Softwareentwicklungs- und SaaS-Verträge, Domainlisten, Open-Source-Nutzung, Verarbeitungsverzeichnis (Art 30 DSGVO), Auftragsverarbeitungsverträge, TOM, Datenschutz-Folgenabschätzungen, Vorfälle',
    redFlags: 'IP nicht auf die Gesellschaft registriert (Gründer, Mitarbeiter, Dienstleister), fehlende Rechteübertragung von Entwicklern, Open-Source-Copyleft in Kernprodukten, Lizenzverträge mit CoC-Kündigung, fehlendes Verarbeitungsverzeichnis, Datentransfers in Drittländer ohne Grundlage, gemeldete Datenschutzvorfälle, DSB-Verfahren',
    questions: 'IP-Register-Liste mit Inhabern; Liste aller Softwarekomponenten und Lizenzen; Datenschutzvorfälle der letzten 3 Jahre',
  },
  {
    key: 'compliance', label: 'Compliance & Regulatorik', profession: 'legal',
    documents: 'Gewerbeberechtigungen, Konzessionen, Förderverträge und -bescheide, Geldwäsche- und Sanktionsrichtlinien, WiEReG-Meldungen, Kartellrechtliche Unterlagen, Exportkontrolle, Umweltgenehmigungen',
    redFlags: 'Fehlende oder nicht übertragbare Gewerbeberechtigungen, Förderungen mit Rückzahlungsklauseln bei Eigentümerwechsel, kartellrechtlich bedenkliche Vereinbarungen, Sanktionsbezüge, fehlende WiEReG-Meldung, Umweltauflagen nicht erfüllt, Verbandsverantwortlichkeit (VbVG)',
    questions: 'Liste aller behördlichen Genehmigungen; Förderübersicht mit Bindungsfristen; Compliance-Richtlinien und Schulungsnachweise',
  },
  {
    key: 'streit', label: 'Rechtsstreitigkeiten & Verfahren', profession: 'legal',
    documents: 'Klagen, Urteile, Vergleiche, Mahnverfahren, Behördenverfahren, Strafverfahren, Anwaltsbestätigungen, Rückstellungsspiegel',
    redFlags: 'Anhängige Verfahren mit hohem Streitwert, Serien von Kundenbeschwerden/Produkthaftung, drohende Verfahren laut Korrespondenz, nicht gebildete Rückstellungen, Verfahren gegen Organe, Verwaltungsstrafen',
    questions: 'Verfahrensliste mit Streitwert, Stand und Risikoeinschätzung; Anwaltsbestätigung der Berater',
  },
  {
    key: 'finanzierung', label: 'Finanzierung, Sicherheiten & Versicherung', profession: 'legal',
    documents: 'Kreditverträge, Anleihen, Sicherheitenverträge (Pfand, Bürgschaft, Garantie), Gesellschafterdarlehen, Leasingverträge, Factoring, Versicherungspolizzen und Schadensakte',
    redFlags: 'Change-of-Control- und Cross-Default-Klauseln, Financial Covenants verletzt oder knapp, persönliche Haftungen der Verkäufer, Eigenkapitalersatz (EKEG), Negative Pledges, Versicherungslücken (D&O, Betriebshaftpflicht, Cyber), Kündigungsrechte der Bank',
    questions: 'Finanzierungsübersicht mit Covenants; Sicherheitenspiegel; Polizzenliste mit Deckungssummen',
  },
  {
    key: 'steuern', label: 'Steuern & Abgaben (Tax DD)', profession: 'tax',
    documents: 'Steuerbescheide (KöSt, USt, Lohnabgaben) der letzten 5–7 Jahre, Außenprüfungsberichte, Steuererklärungen, Gruppenbesteuerungsverträge, Umgründungsverträge und Einbringungsbilanzen, Verrechnungspreisdokumentation, Rulings (§ 118 BAO), Rechtsmittel, Lohnabgabenprüfungen (GPLA/PLAB), Kommunalsteuer, Forschungsprämie, DAC6-Meldungen',
    redFlags: 'Offene Außenprüfungen oder Rechtsmittel, Verlustvorträge mit Mantelkauf-Risiko (§ 8 Abs 4 Z 2 KStG), Gruppenbesteuerung mit Nachversteuerung, Umgründungen mit Sperrfristen und Haftung (§ 14 BAO), Verrechnungspreise ohne Dokumentation, verdeckte Ausschüttungen, USt-Risiken (Reverse Charge, ig Lieferungen, Vorsteuer), Lohnabgaben bei Scheinselbständigkeit, Grunderwerbsteuer bei Anteilsvereinigung (§ 1 Abs 3 GrEStG), Immobilienertragsteuer, Quellensteuern, Haftung des Erwerbers (§ 14 BAO, § 1409 ABGB), DAC6-Meldepflichten, fehlende Rulings',
    questions: 'Übersicht aller Steuerverfahren und Bescheide; Verlustvortragsnachweis; Gruppen- und Umgründungsverträge; Verrechnungspreisdokumentation; Lohnabgabenprüfberichte',
  },
]

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
          norms: { type: 'array', items: { type: 'string' }, description: 'Einschlägige Normen, z. B. "§ 38 UGB", "§ 14 BAO"' },
        },
        required: ['severity', 'area', 'title', 'description', 'quote', 'location', 'recommendation', 'norms'],
      },
    },
    missing_or_unclear: { type: 'array', items: { type: 'string' }, description: 'Fehlende Anlagen, unleserliche Stellen, Verweise auf nicht vorliegende Dokumente' },
    questions: { type: 'array', items: { type: 'string' }, description: 'Konkrete Nachfragen an den Datenraum' },
  },
  required: ['doc_type', 'area', 'title', 'summary', 'parties', 'dates', 'key_terms', 'findings', 'missing_or_unclear', 'questions'],
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
