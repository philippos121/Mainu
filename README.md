# AI:ssociate Playground

Legal AI assistant for Austrian law firms. Every legal question goes to the
**AI:ssociate knowledge base** (its own agentic research over Austrian statutes
and case law); **Sol** picks the legal area first and reviews the answer
afterwards, adding at most **three web searches** when something is missing.
Every cited § / Geschäftszahl is then **verified against the RIS**. Documents can
be uploaded, analysed and returned as Word/Excel/PDF — the code for that is a
single tool call executed in an **E2B sandbox** (never shown to the user).

## How a question is processed

```
question ──▶ fast model: mode, legal area, difficulty, 0–3 compact questions (1 call)
               ├▶ legal easy  → fast model + ≤ 3 web searches
               ├▶ legal hard  → AI:ssociate, ONE streamed request (questions numbered), shown as is
               ├▶ document    → easy: fast model; hard: AI:ssociate (one request) → main model builds the file
               └▶ general     → easy: fast model; hard: main model
                     │
   RIS verification of §§ / GZ (deterministic) → citations in the answer linked to RIS
```

* **Knowledge base:** `POST /api/public/v1/chat/ask` on app.aissociate.at
  (header `x-api-key`, SSE stream; legal areas civil / criminal / tax / public,
  optional Bundesland scope; `thread_id` keeps follow-ups in one thread). The
  documents it consults are shown live as research steps.
* **Azure OpenAI (EU):** with `AZURE_OPENAI_API_KEY` every model call goes to the
  Azure resource (`AZURE_OPENAI_ENDPOINT`, v1 API `/openai/v1/responses`) and one
  deployment does everything (`AZURE_OPENAI_DEPLOYMENT`, default `gpt-6.1-terra`).
  The routing by difficulty stays (knowledge base for hard legal questions, higher
  reasoning effort for hard tasks). If the deployment rejects the hosted web
  search, the call is repeated without it and web search stays off for the
  process. Outside Azure: web search (if used), the E2B sandbox for file
  generation and the Render region decide where else data is processed.
* **Models (OpenAI):** `gpt-6-luna` (`OPENAI_MODEL_FAST`) for everything easy, planning,
  question formulation and the per-document due-diligence analysis;
  `gpt-6-sol` (`OPENAI_MODEL_MAIN`) only for hard tasks and the DD synthesis; the
  code model follows the task's difficulty unless `OPENAI_MODEL_CODE` is set.
* **Verification:** each cited § / Art is looked up in RIS BrKons via
  `Abschnitt.Typ/Von/Bis` + `Fassung.FassungVom=today`, each Geschäftszahl via
  the Judikatur endpoint; confirmed citations become links in the answer.
* **Budgets:** hard caps per question — 1,000,000 input and 100,000 output
  tokens summed over all model calls (`MAX_INPUT_TOKENS`, `MAX_OUTPUT_TOKENS`);
  `MAX_WEB_SEARCHES` (3) and `DOC_MAX_STEPS` (8) bound the step count.
* **UI:** app.aissociate.at look – teal app bar (hamburger and history icon on
  mobile, wordmark on desktop), centred logo, "Wählen Sie eine Wissensdatenbank"
  list (Automatisch / Zivilrecht / Strafrecht / Steuerrecht / Öffentliches Recht
  with Bundesland; the choice pins the legal area, "Automatisch" lets the planner
  detect it), template chips (Rechtsrecherche as a form; Vertragsprüfung,
  Vertrag entwerfen, Schriftsatz entwerfen open their agents; Skills), the "Frage AI:ssociate." composer with the chosen
  knowledge base as a chip, one "Hinzufügen" button and Skills, disclaimer.
  Conversation
  history (browser-local), feature tour, agent steps without code, sources with
  "Volltext geprüft" status, RIS verification panel, Word/Markdown export, exact
  cost per answer. No model names anywhere in the UI.

## Documents and the knowledge base

AI:ssociate never sees our documents on its own. Every request about a document
carries its wording: short documents go in whole, longer ones as verbatim
passages that the fast model picks and the server checks against the text
(invented passages are dropped). The planner decides per question whether the
wording is needed (`needs_document_context`). Documents of a conversation stay
available as text for follow-up questions ("Ist die Klausel wirksam?" in the next
turn still reaches the knowledge base with the clause). In the due diligence the
per-document request carries the full text (short documents) or the quotes of
the red/amber findings.

## Dictation

A microphone button in the composer (and on every multi-line form field of the
templates, skills and agents) dictates via the browser's Web Speech API
(Chrome, Edge, Safari; hidden in Firefox). Interim text appears live, final text
is appended; recognition restarts by itself after pauses until stopped (button,
Ctrl/Cmd + M, or sending with Enter). Spoken commands: "Punkt", "Komma",
"Fragezeichen", "Ausrufezeichen", "Doppelpunkt", "Strichpunkt", "Klammer auf/zu",
"neue Zeile", "neuer Absatz"; "Paragraf 1489 Absatz 2" becomes "§ 1489 Abs 2"
("Punkt 7" stays a contract clause). Before the first use a notice explains
where the audio is processed: by default in the browser vendor's cloud (Google,
Microsoft, Apple). Settings → Diktat → "Nur auf dem Gerät erkennen" switches to
on-device recognition where the browser offers it (language pack download on
demand). Some Chromium builds crash the tab on the on-device API; a marker in
localStorage detects that on the next load and falls back to the cloud mode.
Language: Deutsch (Österreich) by default, Deutsch (Deutschland) or English.

## Feature tour and explainer video

The feature tour and the explainer video are always reachable: two tiles below
the composer on the home page ("Neu hier?" badge until the tour was seen), the
"?" menu in the top bar on every page, and Settings → Daten & Hilfe. The tour has 18 steps in
chapters: knowledge base, templates, asking, "Hinzufügen" (the menu opens during
the steps), "Ergebnisse →", Skills, answers with RIS checks, specialist agents,
due diligence, Akten, projects, skill library, history and "Quellen & Speichern". It visits
the pages it explains, puts a spotlight on the element, places its card next to
it and is driven with Weiter/Zurück or the arrow keys (Esc ends it).

The explainer video (`public/media/erklaervideo.mp4`, 5:03 min, 1920×1080, no
sound: each scene opens with a short text on a white slide; chapter buttons) also
opens from the tour's first and last step. It shows, among others, dictating a
question, that the assistant edits a Word document and produces Excel files by
generating code in a sandbox, that results land in the connected local folder or
in the SharePoint folder of the source file, starting a new question (app bar,
"Allgemeiner Agent"), the skills in the menu and a one-click "Tabellarische
Übersicht" (Excel) on two project documents. `tools/video/` rebuilds it from the
real UI (see its README).

## Projects (shared workspaces)

A project bundles standing instructions, documents and conversations, and can be
shared with other registered users. Sidebar → Projekte lists own and shared
projects; the project page has a box for a new question, the shared
conversations (with who started and who last continued them), the instructions
(applied to every request in the project, like a standing brief), the documents
(stored in an internal Akt, searched by the assistant with the Akt tools) and the
members. The documents card sits under the question box: tick documents (none =
all) and apply a skill with one click – Tabellarische Übersicht (Excel or Word),
Zusammenfassen, Versionen vergleichen (exactly two), Sachverhaltschronologie or
any other skill via "Weitere Skills …" – or ask a question about the ticked ones.
Up to five ticked documents go in as attachments (text extracted on first use),
otherwise the agent searches all project documents itself. "Teilen" (owner) offers a dropdown of all registered, active accounts
(`GET /api/users/directory`, name and e-mail only) and a role: *Kann bearbeiten*
(ask, upload, edit instructions) or *Kann lesen* (read conversations and
documents; the composer is read-only). Members can leave; only the owner shares,
deletes or removes members. Conversations of a project are stored with the
project (`/api/projects/:id/convos`), not in the personal history; the project
page refreshes every 15 s while open. Deleting an account deletes its projects
and ends its memberships. Sharing needs accounts (AUTH on).

Routes: `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`,
`POST /api/projects/:id/members`, `PATCH/DELETE /api/projects/:id/members/:userId`,
`GET /api/projects/:id/convos`, `GET/PUT/DELETE /api/projects/:id/convos/:cid`;
the chat request takes `projectId`.

## Adding documents: attach or connect

One "Hinzufügen" button (composer and agent pages) opens a menu with two groups:
**Dateien anhängen** – from this computer or from OneDrive / SharePoint, sent with
the question – and **Quelle verbinden** – a local folder or a project, which the
assistant searches itself. A project as source (`matterId` of the project's
internal Akt) brings its documents and its instructions into the conversation,
which stays in the personal history; inside a project conversation the entry is
hidden. Akten have no menu entry any more (questions about a due diligence start
from its page). Recently used folders (directory handles kept in IndexedDB,
permission asked again on click) and projects are offered for one click.
Above the input, a context bar groups the chips into "Durchsucht" (folder, project)
and "Angehängt" (files with their origin; three or more are folded into one
chip). Below the input, "Ergebnisse →" names where generated files go: by
default back to the source (folder next to the source file, SharePoint folder of
the source file), else download; per conversation it can be set to the local
folder, a SharePoint / OneDrive folder or download only. Settings → "Quellen &
Speichern" holds the defaults.

Documents of a due diligence (or Akt) come from files, a whole local folder with
all subfolders ("Lokaler Ordner (mit Unterordnern)": File System Access API, else a
folder input), folders dragged onto the drop zone (read recursively), the folder
connected in the assistant ("… übernehmen") or OneDrive / SharePoint. Each document
keeps its subfolder (`folder`, e.g. `Datenraum/02 Verträge/Kunden`), so equal file
names in different folders stay apart; uploads run one request after the other in
batches of up to 10 files / 20 MB (parallel requests would overwrite the Akt).

## Local folders and Akten as searchable sources

"Lokaler Ordner" in the "Hinzufügen" menu connects a local folder (File System Access API;
Safari/Firefox: folder or file selection). Nothing is uploaded up front: the agent
calls file tools (`files_search`, `files_list`, `files_read`, `files_attach`) that
the server forwards to the browser (`client_tool` event, answer via
`POST /api/jobs/:id/tool-result`). The browser extracts text locally (PDF with
pdf.js served from `/vendor/pdfjs`, Word and Excel by unzipping, text formats) and
sends only what the agent reads; `files_attach` hands single originals to the
sandbox when a file must be edited. Alternatives in the folder dialog: attach up
to five files to the message, or upload the whole folder into an Akt. Generated files
(Word, Excel, PDF) are saved back into the folder in Chrome and Edge: next to the
source file (attached, picked or read by the agent), otherwise in the subfolder
`AIssociate`; existing files are never overwritten (`Name (2).docx`). Write access
is requested once right after picking the folder; automatic saving can be
switched off in the settings ("Quellen & Speichern" → Lokaler Ordner) or per
conversation ("Ergebnisse →" → Nur herunterladen), then a button
"Im Ordner speichern" appears under the files. Browsers without the API (Safari,
Firefox, mobile) keep the download. A question
in the context of an Akt without picked documents lets the agent search all of
its documents on the server with the same tools (text extracted lazily). Hard
legal questions in these flows go to AI:ssociate once, after reading, with the
wording in `context`.

## Specialist agents

Next to the due diligence: **Vertragsprüfung**, **Vertrag entwerfen** and
**Schriftsatz entwerfen** (`lib/agents.js`, versioned like the DD catalogue). Each
has a guided page (`#/agent/<key>`) with the typical Austrian workflow, a form,
documents (upload, folder, Microsoft 365, Akt) and its reference material: the
review grid of 16 points (parties and representation, Gewährleistung, Haftung,
§ 879 ABGB / § 6 KSchG, Pönale § 1336 ABGB, Laufzeit, § 1396a ABGB, DSGVO, KartG,
Form and Gebühren nach § 33 GebG, Rechtswahl and Gerichtsstand), 17 contract types
with their mandatory law, form and fee notes, and 13 kinds of pleadings (Klage
§ 226 ZPO, Einspruch, Klagebeantwortung, Berufung, Rekurs, Revision,
einstweilige Verfügung, Exekutionsantrag, Bescheidbeschwerde § 9 VwGVG, Revision
an den VwGH, Privatbeteiligung). A run has phases (review → redline; outline →
draft → self-check; legal analysis and outline → draft → counter-arguments); the
answer shows the next step as a button, and the next phase builds on the
conversation. Later phases do not ask the knowledge base again, drafting phases
run on the main model.

**Schriftsatz entwerfen** takes form, structure and procedure from the model's
knowledge of Austrian practice (current figures such as Wertgrenzen or fees via
web search); the knowledge base is not asked up front – the model may ask
AI:ssociate once (`ask_aissociate`) only for a concrete legal question raised by
the facts. There is no Mahnklage type: a Klage that seeks only payment of up to
75.000 EUR is a Mahnklage (§ 244 ZPO) – the form shows a hint and the agent,
instead of drafting, points to filing it directly in the ERV (structured form, not
a full-text Klage), lists the form data and checks the exceptions of § 244 Abs 2
ZPO. Every Schriftsatz and every newly drafted contract – from the agents, the
general assistant, a skill or a project conversation – is laid out by
`lib/doc_layout.py` (copied into every sandbox as `.aiss/doc_layout.py`; the code
model uses it whenever the task carries the markers). Briefs: page 1 holds only the
Rubrum with the title (e.g. KLAGE, Beilagen), the text starts on page 2; a Klage
opens with the Vollmachtsbekanntgabe (§ 30 Abs 2 ZPO). The agent adds the Rubrum of
each type (e.g. Berufung: lodged with the Erstgericht, roles in brackets,
Berufungsinteresse; EV: gefährdete Partei / Gegner der gefährdeten Partei;
Exekution: betreibende / verpflichtete Partei; Bescheidbeschwerde: to the belangte
Behörde „zur Vorlage an das Verwaltungsgericht“; Anzeige: to the
Staatsanwaltschaft). Markers: `[ADRESSAT]`, `[AZ]`, `[PARTEI] Klagende Partei: | …`,
`[WEGEN]`, `[STREITWERT]`, `[RUBRUM] Label: | …`, `[TITEL]`, `[UNTERTITEL]`,
`[BEILAGEN]`, `[H]`, `[P]`, `[BEWEIS]`, `[ANTRAG]`, `[SCHLUSS]`. Contracts: page 1
holds the title and the parties („abgeschlossen zwischen“, „im Folgenden …“), the
clauses start on page 2, then signature block and annexes (`[VERTRAG]`,
`[UNTERTITEL]`, `[PARTEI] Name; Anschrift | Kurzbezeichnung`, `[H]`, `[P]`,
`[UNTERSCHRIFT] Ort, am Datum | Partei`, `[ANLAGE]`). Both use Arial 11, numbered
paragraphs, page numbers and yellow placeholders.

Contracts (review and drafting) work the same way as briefs: Austrian contract law,
clause standards, form and fees from the model's knowledge, current figures and
case law via web search; AI:ssociate only in exceptional cases, once, for a
concrete difficult question of the contract (`ask_aissociate` with the clause
wording). The planner leaves its knowledge-base questions empty for contract and
brief drafting unless such a question is at stake. `GET /api/agents` serves the configuration;
`POST /api/chat` takes `task: { type: 'agent', agent, phase, params }`.

## Skills

Reusable instruction packages like playbooks or custom workflows in other legal AI
tools (`lib/skills.js`, library under `#/skills`). A skill has a name, a
description ("wann einsetzen"), instructions, optional input fields, reference
documents (templates, playbooks, house style; a Word/Excel reference doubles as
the template when the skill produces that format) and routing preferences:
result (answer, Word, Excel), knowledge base (by difficulty, always, never) and
legal area. It applies to one message: picked with the "Skills" button or by
typing "/" in the composer (with a form for its inputs), or chosen by the
planner when a request clearly matches a skill marked "automatisch" (shown as
"Skill: … · automatisch" on the answer). All skills are also listed in the
sidebar under "Skills" (folded by default; one click applies a skill) and on the
project documents. A select field `format` (Excel / Word) lets the user pick the
result format per run. Fourteen standard skills ship with the app (Zusammenfassen,
Tabellarische Übersicht, Versionen vergleichen – formerly forms –, Mandantenbrief, Aktenvermerk, Sachverhaltschronologie, Rechtsgutachten,
Playbook-Abgleich, Gegenargumente, Übersetzung Rechtsenglisch, Bescheidanalyse,
Steuerliche Erstbeurteilung, Schreiben an die Gegenseite, Executive Summary);
they are read-only and can be adapted as a copy. Own skills belong to the
workspace key, can be exported as JSON (with their reference documents) and
imported elsewhere. Routes: `GET/POST /api/skills`, `PATCH/DELETE /api/skills/:id`,
`POST /api/skills/:id/duplicate`, `POST/DELETE /api/skills/:id/files[/:fid]`,
`GET /api/skills/:id/export`, `POST /api/skills/import`; `POST /api/chat` takes
`skill: { id, params }`.

## Microsoft 365 (OneDrive / SharePoint)

Users sign in with their Microsoft account (OAuth 2.0 + PKCE against Entra ID,
delegated permissions). "Aus OneDrive / SharePoint" in the "Hinzufügen" menu opens a picker for
OneDrive and SharePoint document libraries; picked files are downloaded
server-side via Microsoft Graph and processed like uploads. After a task, the
generated files and (optionally) the answer as a Word memo are written back to
the folder of the source file or to a target folder chosen under "Ergebnisse →"; existing files are
never overwritten (Graph `conflictBehavior=rename`). The refresh token lives in
an encrypted, HttpOnly cookie; the server keeps no account data.

Configure `MS_CLIENT_ID`, `MS_CLIENT_SECRET` and optionally `MS_TENANT` /
`MS_REDIRECT_URI` / `MS_ALLOWED_TENANTS` (see `.env.example`); the
`MICROSOFT_*` names of other deployments are accepted as aliases. `GET
/api/health` shows the redirect URI to register in Entra. Routes: `GET
/api/ms/login`, `GET /api/ms/callback` (also
`/api/integrations/microsoft/callback`), `GET /api/ms/me`, `POST /api/ms/logout`,
`GET /api/ms/browse`, `GET /api/ms/sites`, `GET /api/ms/site-drives`; the chat
request takes `msFiles` and `msSync`.

## Assistant and Due Diligence

The **assistant** (home page) can ultimately do everything and routes by
difficulty, decided by the fast model in one call together with the mode, the
legal area and up to three compact questions. A knowledge base picked on the
home page (`legalArea` / `scope` in the chat request) pins the legal area; the
planner still decides whether the request is a legal question, a document task
or something general:

| | easy | hard |
|---|---|---|
| legal question | fast model answers directly, ≤ 3 web searches for references | **AI:ssociate** knowledge base, **one** request (several numbered questions inside if needed), answer shown as is |
| document / other task | fast model (document text inline, file generation in the sandbox) | AI:ssociate first (one request) when legal questions are involved, then the main model builds the deliverable |

The knowledge base covers Austrian law only: questions on **German** (or other
foreign) law – the research workflow with "Deutschland", or a free question the
planner tags `jurisdiction: DE|other` – go to the main model with web search
(primary sources such as gesetze-im-internet.de, dejure.org, BGH), never to
AI:ssociate, and the RIS check is skipped for them.

Every cited § / Geschäftszahl is verified against the RIS. The optional
review of knowledge-base answers is off by default (`REVIEW_ANSWERS=on`).
**Due Diligence** (menu) runs the fixed pipeline below; review tables live
inside the Akt (tabs), the form-driven templates above the composer
("Vorlagen"). The specialist agents are described above. Each matter is "der Akt". Model names are not shown in the UI.

## App shell, Akten, Due Diligence, Review-Tabellen

The UI is an app shell: teal app bar plus a sidebar (drawer behind the
hamburger on mobile) with Allgemeiner Agent (each click starts a new question;
there is no separate "Neue Frage" button in the menu – an open conversation, also
one reopened from the Verlauf, shows "Neue Frage" in the app bar, which in a
project conversation leads back to the project), Spezialagenten (Due Diligence,
Vertragsprüfung, Vertrag entwerfen, Schriftsatz entwerfen), Skills (foldable),
Projekte, Verlauf and Einstellungen. Akten have no menu entry of their own: the
Due Diligence page lists the due diligences and, below, any other Akten
(`#/matters` redirects there); hash routes such as `#/matter/<id>/findings`. Matters ("Akten") hold documents (upload or import of
files and whole folders from OneDrive/SharePoint), their extracted text, the
analysis results, review tables and reports. Everything long-running is a
server job with a resumable event stream (`GET /api/jobs/:id/stream?after=seq`),
can be paused, and survives closed browser tabs.

**Due diligence** (`lib/ddconfig.js`, `lib/dd.js`, `lib/report.js`) is an
explicit pipeline, not an agent: Text → per-document triage on the fast model
(type, area, difficulty) → per-document analysis (easy: fast model, hard: main
model; strict JSON schema: type, area, parties, key terms, findings with quote +
location + severity + recommendation + norms, questions, and 0–3 compact legal
questions with their difficulty) → per document the same legal routing as the
assistant: easy legal questions → fast model with web search, hard ones →
AI:ssociate in **one** request per document (questions numbered inside) →
synthesis per review area (the per-document legal answers are combined) →
executive summary → RIS verification of every cited norm → Word Red-Flag-Report
+ Excel workbook from fixed templates. Documents are analysed in parallel (2 / 4 /
6 workers for up to 5 / 20 / more documents, cap `DD_CONCURRENCY`); the budget
per due diligence is 10,000,000 input and 1,000,000 output tokens by default
(selectable per matter), counted over all model calls plus an estimate for the
knowledge-base requests. Every finding has a stable id (F-001),
a document id (D-001), a deal-impact instrument, an evidence status (the quote
is located in the document text: belegt / teilweise / unbelegt) and a review
state (offen / freigegeben / geändert / verworfen, grade override, note,
manual findings). Rejected findings leave the report; the cover carries
"Entwurf" until every red/amber finding is reviewed. A cost/time estimate is
shown before every run; documents are analysed a few at a time with retries. Review areas, typical documents, red-flag
catalogues and standard requests are versioned code. A token budget per matter
stops the run cleanly ("pausiert"); new documents are added incrementally.

**Review tables**: user-defined columns (presets: Vertragsübersicht,
Dienstverträge, Mietverträge, Fristen, Steuerbescheide) extracted per document
with `value / quote / location` per cell; Excel export.

**Questions about a matter**: the stored analysis is passed as context (and
selected documents as attachments) to the normal legal pipeline.

**Accounts** (`lib/auth.js`, on by default): every `/api` route except health,
the sign-in routes and the Microsoft callback needs a signed-in user. The first
account is created on the setup screen and becomes administrator; it creates the
other accounts in the settings ("Benutzer": role, deactivate, reset password,
delete with all data). Self-registration only for `AUTH_ALLOWED_DOMAINS` or with
`AUTH_SIGNUP=open`. Passwords are hashed with scrypt, the session is an
HMAC-signed HttpOnly cookie (30 days; password change, deactivation and "auf
allen Geräten abmelden" end all sessions), failed logins are throttled. Each
user sees only their own Akten, Skills, conversations and jobs; the
conversation history is stored on the server (`/api/convos`) and available on
every device. Data of a browser from before the accounts (workspace key, local
history) moves to the first account that signs in there. `AUTH=off` restores
the old workspace-key mode for local development. Routes: `GET /api/auth/me`,
`POST /api/auth/setup|signup|login|logout|password|claim`,
`GET/POST /api/auth/users`, `PATCH/DELETE /api/auth/users/:id`.

**Data disk:** accounts, Akten, Skills and conversations live in `DATA_DIR`. A
disk mounted at `/data` is used automatically; `GET /api/health` shows
`dataDir` and `persistentDisk`. See `docs/ARCHITEKTUR.md` for the critical
review, the explicit-code-vs-code-generation trade-off and the roadmap
(persistent disk/Postgres, Entra-bound identities, OCR, job queue).

Matter routes: `GET/POST /api/matters`, `GET/PATCH/DELETE /api/matters/:id`,
`POST /api/matters/:id/documents`, `POST /api/matters/:id/import-ms`,
`POST /api/matters/:id/dd/run|pause`, `POST /api/matters/:id/report`,
`GET /api/matters/:id/reports/:file`, `POST /api/matters/:id/tables`,
`GET /api/matters/:id/tables/:tid/xlsx`, `POST /api/matters/:id/sync`,
`PATCH/POST/DELETE /api/matters/:id/findings[/:fid]`, `GET /api/matters/:id/dd/estimate`,
`GET /api/dd/config`; `POST /api/chat` accepts `matterId` + `matterDocIds`.

## Run locally

```bash
cp .env.example .env   # fill in OPENAI_API_KEY (and E2B_API_KEY)
npm install
npm run dev            # http://localhost:3000
```

## Deploy on Render

The service builds from the `Dockerfile`. Set `AZURE_OPENAI_API_KEY` (or `OPENAI_API_KEY`),
`AISSOCIATE_API_KEY` and `E2B_API_KEY` in the Render dashboard; everything else
has defaults (see `.env.example`). `GET /api/health` reports the configuration.
Data is stored in `DATA_DIR` (`/data` in `render.yaml`, which also declares the
disk and a generated `AUTH_SECRET`): attach a persistent disk at `/data` (paid
instance), otherwise accounts and data are lost on every deploy.

## Endpoints

| Route | Purpose |
|---|---|
| `POST /api/chat` | SSE stream: `job`, `step`, `step_update`, `route`, `delta`, `final`, `error` (every event carries a `seq`) |
| `GET /api/chat/stream/:jobId?after=seq` | Resume a running or finished job after a dropped connection (replays events with `seq` > `after`) |
| `POST /api/verify` | Re-run the RIS verification for a text |
| `POST /api/export/docx` | Markdown → Word export of an answer |

## Security note

The E2B and AI:ssociate keys have hardcoded **test-only** fallbacks in
`server.js`; set the env vars in production and rotate any key that was ever
pasted into a chat.
