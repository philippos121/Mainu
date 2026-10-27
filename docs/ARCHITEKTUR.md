# Architektur und Abwägung: explizit programmiert vs. Code-Generierung

Stand: Oktober 2026 · Zielgruppe: Rechtsanwältinnen, Rechtsanwälte und
Steuerberater in Österreich · App: AI:ssociate Playground (Express, Node 20,
eine Seite `public/index.html`, Render).

## 1. Was die Anwendung heute kann

| Bereich | Funktion | Umsetzung |
|---|---|---|
| Assistent | Startseite im Look von app.aissociate.at (Wissensdatenbank-Liste: Automatisch / Zivil / Straf / Steuer / Öffentliches Recht mit Bundesland – eine Wahl fixiert das Rechtsgebiet). Das schnelle Modell wählt in einem Aufruf Modus, Rechtsgebiet, Schwierigkeit und 0–3 kompakte Fragen. Leichte Rechtsfrage → schnelles Modell mit ≤ 3 Websuchen; schwere Rechtsfrage → AI:ssociate in genau einer Anfrage (mehrere Fragen nummeriert darin), Antwort wird direkt angezeigt; leichte Dokument-/sonstige Aufgabe → schnelles Modell; schwere → bei Rechtsfragen zuerst AI:ssociate (eine Anfrage), dann das Hauptmodell für das Deliverable (Dokumenttext bis 80k Zeichen inline, Code-Generierung in der Sandbox). RIS-Verifikation aller §§/GZ → Links im Text. Nachprüfung mit Websuche nur optional (`REVIEW_ANSWERS=on`) | explizit |
| Workflows | Rechtsrecherche, Vertrag prüfen (Kommentare im Word), Versionen vergleichen (Redline), Entwurf, Zusammenfassen, Fristen | explizit gesteuert, Deliverable per Code-Generierung in der Sandbox |
| Akten | Dokumente je Causa (Upload, OneDrive/SharePoint-Import inkl. ganzer Ordner), Volltexte, Fragen im Kontext der Akte | explizit |
| Due Diligence | Feste Prüfbereiche mit Red-Flag-Katalog und Regel-IDs (GES-001 …), je Dokument strukturierte Analyse mit Zitat + Fundstelle + Schweregrad + Deal-Impact + Normen, **Evidenzbindung** (jedes Zitat wird im Dokumenttext gesucht: belegt / teilweise / unbelegt), **Routing je Dokument wie beim Assistenten**: Triage auf dem schnellen Modell (Typ, Bereich, Schwierigkeit), Analyse leicht → schnelles Modell, schwer → Hauptmodell; 0–3 kompakte Rechtsfragen je Dokument, leicht → schnelles Modell mit Websuche, schwer → **AI:ssociate in genau einer Anfrage je Dokument** (Fragen nummeriert, kurze Antworten); Dokumente parallel (2/4/6 Worker nach Anzahl), Synthese je Bereich aus den Dokumentantworten, Executive Summary, RIS-Prüfung, **Review-Status je Befund** (Freigabe, Grad, Vermerk, manuelle Befunde), Request List, Red-Flag-Report (Word) und Workbook (Excel) mit stabilen IDs; Budget je DD 10 Mio. Eingabe- / 1 Mio. Ausgabe-Tokens inkl. geschätzter AI:ssociate-Tokens, Kostenschätzung vor jedem Lauf | explizit |
| Vertragsprüfung, Vertrag entwerfen, Schriftsatz entwerfen | Fachagenten mit österreichischem Arbeitsablauf als versionierte Konfiguration (`lib/agents.js`): Prüfraster mit 16 Punkten, 17 Vertragstypen mit zwingendem Recht, Form und Gebühren, 14 Schriftsatzarten nach ZPO, EO, VwGVG, VwGG, StPO. Ablauf in Phasen (Prüfung → Redline; Gliederung → Entwurf → Selbstprüfung; Prüfung und Gliederung → Schriftsatz → Gegenargumente), Folgeschritt per Button, nur die erste Phase fragt die Wissensdatenbank, Entwürfe auf dem Hauptmodell | explizit, Deliverable per Code-Generierung |
| Lokaler Ordner / Akt als Quelle | Ordner auf dem Rechner (File System Access API) wird agentisch durchsucht: Werkzeuge laufen im Browser, Text wird lokal extrahiert (pdf.js, Word/Excel entpackt), übertragen wird nur Gelesenes; alternativ einzelne Dateien anhängen oder den Ordner in einen Akt hochladen, dessen Dokumente der Agent serverseitig mit denselben Werkzeugen durchsucht | explizit |
| Review-Tabellen | Gleiche Spalten über viele Dokumente (Vertragsübersicht, Dienstverträge, Mietverträge, Fristen, Steuerbescheide, eigene Spalten); jede Zelle mit Beleg und Fundstelle; Excel-Export | explizit |
| Microsoft 365 | OAuth/PKCE, Browser für OneDrive/SharePoint, Anhängen, Import in Akten, Rückschreiben von Ergebnissen und Berichten (nie überschreiben) | explizit |
| Lange Vorgänge | Server-Jobs mit Ereignisprotokoll, Wiederanbindung nach Verbindungsabbruch, Pausieren/Fortsetzen, Budget je Akte | explizit |

## 2. Die Abwägung

Die Frage „alles per Code-Generierung in der Sandbox oder feste Pipelines?“ ist
für juristische Arbeit keine Geschmacksfrage. Entscheidend sind drei Dinge:
**Reproduzierbarkeit** (derselbe Datenraum muss morgen dieselben Befunde
liefern), **Belegbarkeit** (jeder Befund braucht Zitat und Fundstelle, sonst ist
er für Anwälte wertlos) und **Kosten-/Laufzeitkontrolle** (200 Dokumente dürfen
nicht in einem freien Agentenlauf mit unbekannt vielen Schritten enden).

### 2.1 Explizit programmiert (Regelfall für alles, was wiederkehrt)

* **Due Diligence**: Prüfbereiche, typische Dokumente, Red-Flag-Kataloge und
  Standard-Nachfragen stehen versioniert in `lib/ddconfig.js`. Die Pipeline in
  `lib/dd.js` hat sechs feste Stufen (Text → Analyse → Bereiche → Summary →
  RIS → Bericht); jede Stufe schreibt ihren Zustand in den Store, Pausieren und
  Fortsetzen sind damit trivial, neue Dokumente werden ergänzt statt alles neu
  zu rechnen. Das Modell antwortet nur in **strikten JSON-Schemata**
  (`DOC_ANALYSIS_SCHEMA`, `AREA_SYNTHESIS_SCHEMA`, `EXEC_SUMMARY_SCHEMA`);
  Schweregrade, Bereiche und Dokumenttypen sind Enums. Lange Dokumente werden
  in Teilen mit Überlappung analysiert und zusammengeführt.
* **Berichte**: Word und Excel entstehen aus festen Vorlagen (`lib/report.js`,
  docx + exceljs), nicht aus generiertem Code. Vorteil: Ein Mandant bekommt
  immer dieselbe Struktur (Executive Summary, Red Flags, Befunde je Bereich,
  Dokumentenindex, Request List, Methodik), Normen sind als RIS-Links
  hinterlegt, und das Layout ist ohne Modellaufruf reproduzierbar.
* **Review-Tabellen**: Spalten kommen vom Nutzer, die Extraktion pro Dokument
  läuft gegen ein Schema mit Pflichtfeldern `value / quote / location`.
* **Verifikation**: Normzitate und Geschäftszahlen werden deterministisch
  gegen die RIS-API geprüft (BrKons mit Abschnitt + Fassung, Judikatur mit
  Geschäftszahl). Das ist bewusst kein Modell-Urteil.
* **Rechtsfragen**: ein Planungsaufruf, höchstens eine Wissensdatenbank-Anfrage
  (mit bis zu drei nummerierten Fragen), keine offenen Agentenschleifen; das
  Hauptmodell nur bei schweren, nicht-rechtlichen Aufgaben.

### 2.2 Code-Generierung in der Sandbox (Ausnahme für das Unvorhersehbare)

Die E2B-Sandbox mit dem Code-Modell bleibt für Deliverables, die sich nicht
sinnvoll als Vorlage vorhalten lassen: Kommentare an bestimmten Absätzen einer
fremden Word-Datei, Redlines zweier Versionen, Tabellen mit vom Nutzer frei
gewünschtem Aufbau, Konvertierungen, OCR, exotische Formate. Dort ist „alles
möglich“, aber um den Preis von Nichtdeterminismus, bis zu vier
Korrekturversuchen und schwerer Prüfbarkeit. Deshalb bekommt der Code immer
die fertige juristische Substanz wörtlich übergeben (welche Klausel, welcher
Kommentar) und erzeugt nur das Artefakt.

### 2.3 Hybrid: Fragen zur Akte

Fragen im Kontext einer Akte bekommen die gespeicherte Analyse (Befunde mit
Zitaten, Bereichszusammenfassungen) als Kontext plus ausgewählte Dokumente als
Anhang. Die Antwort läuft durch dieselbe Rechtsfragen-Pipeline (Wissensdatenbank,
Prüfung, RIS). So bleiben die teuren Analyseergebnisse wiederverwendbar.

## 3. Kritische Punkte der Architektur und was daraus folgt

1. **Persistenz.** Akten (im UI „der Akt“) liegen als JSON + Dateien in `DATA_DIR`
   (`lib/store.js`). Auf Render ohne Persistent Disk verschwinden sie beim
   nächsten Deploy. Für den Produktivbetrieb: Render Disk (oder Volume) an
   `/data` mounten und `DATA_DIR=/data` setzen; mittelfristig Postgres für
   Metadaten/Befunde und Blob-Storage (oder SharePoint selbst) für Dateien. Das
   Datenmodell ist bereits so geschnitten, dass der Store ohne Änderung der
   Routen austauschbar ist.
2. **Mandantentrennung.** Heute trennt ein vom Browser erzeugter
   Arbeitsbereich-Schlüssel (`X-Owner-Key`) die Akten. Das ist Isolation, keine
   Authentifizierung. Vor Mehrbenutzerbetrieb: Schlüssel an die Microsoft-
   Identität (Entra ID) binden oder SSO einführen; Akten dann an
   Tenant/Benutzer statt an einen Schlüssel.
3. **Ein Prozess, eine Instanz.** Jobs laufen im Prozess (max.
   `DD_MAX_CONCURRENT` gleichzeitig). Bei mehreren Instanzen braucht es eine
   Job-Queue (z. B. Postgres-basiert) und eine Instanz, die die Arbeit
   abholt. Der Ereigniskanal (`/api/jobs/:id/stream`) ist bereits
   instanzunabhängig gedacht (Replay nach `seq`), müsste aber aus einer
   gemeinsamen Quelle lesen.
4. **Gescannte PDFs.** Ohne Textlayer wird ein Dokument als Fehler markiert.
   OCR (ocrmypdf/tesseract) gehört in einen Vorverarbeitungsschritt, der
   explizit im Pipeline-Stadium „Text“ läuft, nicht in die Sandbox.
5. **Kosten.** Eine DD über 200 Dokumente à 40.000 Zeichen kostet in der
   Größenordnung von 2–4 Mio. Eingabe-Tokens für die Dokumentanalyse plus
   Synthese; dazu kommen die Rechtsfragen je Dokument (Websuche oder eine
   AI:ssociate-Anfrage). Das Budget je DD (`budgetTokens` 10 Mio. Eingabe,
   `budgetOutTokens` 1 Mio. Ausgabe, inkl. geschätzter AI:ssociate-Tokens)
   stoppt den Lauf sauber („pausiert“) und zeigt Verbrauch und Schätzung an.
   Weil leichte Dokumente auf dem schnellen Modell laufen und nur schwere auf
   dem Hauptmodell, bleibt der Großteil der Analyse günstig.
6. **Qualität der Befunde.** Die größte Gefahr ist nicht Halluzination der
   Normen (die prüft das RIS), sondern **Überinterpretation** von Klauseln.
   Deshalb: Befund nur mit wörtlichem Zitat, Wesentlichkeitsschwelle,
   Empfehlung immer als konkrete Transaktionsmaßnahme (Garantie, Freistellung,
   CP, Kaufpreis), und alle Berichte als „Entwurf, anwaltlich zu prüfen“.
7. **AI:ssociate-API.** Sie sieht unsere Dokumente nicht. Fragen mit
   Dokumentbezug tragen deshalb den Wortlaut mit: kurze Dokumente ganz, längere
   als wörtliche Passagen, die das schnelle Modell auswählt und der Server gegen
   den Text prüft; Dokumente eines Gesprächs bleiben für Folgefragen verfügbar.
   (Die API bietet zusätzlich einen Datei-Upload mit `file_context`; er ist nicht
   angebunden, weil die Verarbeitung asynchron ist und das Format der Referenzen
   nicht dokumentiert ist.) Sie ist die maßgebliche Rechtsquelle für schwere
   Rechtsfragen und wird in der DD **je Dokument höchstens einmal** befragt
   (mehrere nummerierte Fragen in einer Anfrage); leichte Rechtsfragen eines
   Dokuments beantwortet das schnelle Modell mit Websuche. Bei vielen Dokumenten
   laufen die Anfragen parallel zu den Analysen. Die Antwort wird am Dokument
   gespeichert, fließt in die Bereichssynthese und den Bericht ein und wird nur
   bei erneuter Analyse des Dokuments neu geholt.

## 4. Was die großen Anbieter bieten und wie es hier abgebildet ist

| Funktion bei Harvey / Legora / Noxtua u. a. | Hier |
|---|---|
| Assistant mit Quellen und Zitaten | Assistent mit Wissensdatenbank, RIS-Verifikation, verlinkten Fundstellen |
| Vault / Projekte mit vielen Dokumenten | Akten mit bis zu 300 Dokumenten, Import aus SharePoint-Ordnern |
| Tabular Review (Fragen × Dokumente) | Review-Tabellen mit Beleg je Zelle, Excel-Export |
| Workflows (Contract Review, Redline, Drafting) | Formulargeführte Workflows, Ergebnisse als Word/Excel/PDF |
| Due Diligence / Red Flag Reports | Feste DD-Pipeline, Red-Flag-Report Word + Excel, Request List |
| Word-/Teams-Integration | Microsoft Graph: Lesen, Importieren, Rückschreiben |
| Knowledge / Firmenwissen | noch nicht: Kanzleivorlagen und Musterklauseln als Wissensbasis wären der nächste Schritt |
| Zitatnavigation ins Dokument | Zitat + Fundstelle je Befund, Dokumenttext im Dialog; Seitenverknüpfung in PDFs fehlt noch |

## 4a. Ergebnis der Recherche zu Anbietern und Use Cases (Oktober 2026)

Die Recherche (Harvey, Legora, CoCounsel, Lexis+ Protégé, Luminance, Kira,
Noxtua u. a.; Use Cases österreichischer Rechtsanwälte und Steuerberater)
bestätigt die Architekturentscheidung: alles Wiederkehrende ist explizit
programmiert, Modellaufrufe sind schemagebundene Datenlieferanten,
Code-Generierung bleibt die Ausnahme für Einzelstücke. Aus dem priorisierten
Spezifikationsvorschlag wurden in dieser Iteration umgesetzt: App-Shell im
Look von app.aissociate.at (Wissensdatenbank-Wahl, Vorlagen), Akt-Workspace, Evidenzbindung, Review-Status mit manuellen
Befunden, Deal-Impact, Regel-IDs im Katalog, Schwierigkeits-Routing und
AI:ssociate je Dokument (eine Anfrage), Budget 10 Mio./1 Mio. Tokens je DD,
Kostenschätzung vor dem Lauf, Retries und parallele Dokumentanalyse,
stabile IDs in UI/Word/Excel. Noch offen (Reihenfolge nach Abhängigkeit):

1. Identität und Mandantentrennung (Entra-ID-Login verpflichtend, Akten an
   Benutzer/Kanzlei gebunden, Audit-Log) und dauerhafte Speicherung
   (Persistent Disk, dann SQLite/Postgres) – Voraussetzung für Mehrbenutzer.
2. Ingest in Skala (Multipart-Upload, SharePoint-Delta-Sync, ZIP, Dedupe) und
   Extraktion mit Seitenindex + OCR für gescannte Datenräume.
3. Worker-Prozess mit Chunk-Checkpoints, EUR-Budget und Nutzungs-Ledger.
4. Regeltabelle in Code (Trigger auf typisierten Feldern, Materialität,
   Kanzlei-Overrides), Faktenregister, Abdeckungsmatrix, Widerspruchsprüfung.
5. Dokument-Viewer an der Fundstelle (PDF-Seitenanker), Request-Liste mit
   Runden/Antworten, Berichtsversionen Executive/Full, Kanzlei-.dotx.
6. Workflows ohne Sandbox: Playbook-Vertragsprüfung mit Word-Kommentaren,
   deterministische Redline, Fristen-Engine (ZPO/AVG/VwGVG/BAO) mit
   Feiertagen und ICS-Export.
7. Kanzleiwissen (Vorlagen, Klauselbibliothek), Word-/Outlook-Add-in,
   EU-Datenresidenz und Aufbewahrung als Konfiguration.

## 5. Nächste Schritte (empfohlen)

1. Persistent Disk + `DATA_DIR` auf Render; danach Postgres-Store.
2. Owner-Key an Entra-Identität binden.
3. OCR-Stufe für gescannte PDFs.
4. Gebündelte Wissensdatenbank-Frage je Prüfbereich in der DD.
5. Kanzleiwissen (Vorlagen, Klauselbibliothek) als eigener Bereich.
6. PDF-Seitenanker für Zitate (Fundstelle → Seite öffnen).
