# Architektur und Abwägung: explizit programmiert vs. Code-Generierung

Stand: Oktober 2026 · Zielgruppe: Rechtsanwältinnen, Rechtsanwälte und
Steuerberater in Österreich · App: AI:ssociate Playground (Express, Node 20,
eine Seite `public/index.html`, Render).

## 1. Was die Anwendung heute kann

| Bereich | Funktion | Umsetzung |
|---|---|---|
| Assistent | Rechtsfrage → Sol wählt Rechtsgebiet → AI:ssociate-Wissensdatenbank (agentisch) → Sol prüft, ergänzt ausnahmsweise mit ≤ 3 Websuchen → RIS-Verifikation aller §§/GZ → Links im Text | explizit |
| Workflows | Rechtsrecherche, Vertrag prüfen (Kommentare im Word), Versionen vergleichen (Redline), Entwurf, Zusammenfassen, Fristen | explizit gesteuert, Deliverable per Code-Generierung in der Sandbox |
| Akten | Dokumente je Causa (Upload, OneDrive/SharePoint-Import inkl. ganzer Ordner), Volltexte, Fragen im Kontext der Akte | explizit |
| Due Diligence | Feste Prüfbereiche (Gesellschaft, Verträge, Arbeit, Immobilien, IP/IT/Datenschutz, Compliance, Verfahren, Finanzierung, Steuern), je Dokument strukturierte Analyse mit Zitat + Fundstelle + Schweregrad + Normen, Synthese je Bereich, Executive Summary, RIS-Prüfung, Request List, Red-Flag-Report (Word) und Workbook (Excel) | explizit |
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
* **Rechtsfragen**: genau ein Aufruf der Wissensdatenbank, höchstens drei
  Websuchen, keine offenen Agentenschleifen.

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

1. **Persistenz.** Akten liegen als JSON + Dateien in `DATA_DIR`
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
   Synthese; das Budget je Akte (`budgetTokens`) stoppt den Lauf sauber
   („pausiert“) und zeigt Verbrauch und Schätzung an. Ein günstigeres
   Extraktionsmodell (`OPENAI_MODEL_EXTRACT`) ist dafür vorgesehen.
6. **Qualität der Befunde.** Die größte Gefahr ist nicht Halluzination der
   Normen (die prüft das RIS), sondern **Überinterpretation** von Klauseln.
   Deshalb: Befund nur mit wörtlichem Zitat, Wesentlichkeitsschwelle,
   Empfehlung immer als konkrete Transaktionsmaßnahme (Garantie, Freistellung,
   CP, Kaufpreis), und alle Berichte als „Entwurf, anwaltlich zu prüfen“.
7. **AI:ssociate-API.** Sie ist die maßgebliche Rechtsquelle für Fragen; die
   DD-Analyse nutzt sie heute nicht pro Dokument (zu teuer, zu langsam). Sinnvolle
   Ergänzung: je Prüfbereich eine gebündelte Rechtsfrage an die Wissensdatenbank
   mit den gefundenen Klauseln, deren Antwort in die Bereichssynthese einfließt.

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

## 5. Nächste Schritte (empfohlen)

1. Persistent Disk + `DATA_DIR` auf Render; danach Postgres-Store.
2. Owner-Key an Entra-Identität binden.
3. OCR-Stufe für gescannte PDFs.
4. Gebündelte Wissensdatenbank-Frage je Prüfbereich in der DD.
5. Kanzleiwissen (Vorlagen, Klauselbibliothek) als eigener Bereich.
6. PDF-Seitenanker für Zitate (Fundstelle → Seite öffnen).
