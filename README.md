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
question ──▶ Luna: mode, legal area, 1–3 compact questions (1 call)
               ├▶ legal    → AI:ssociate (one streamed call, or parallel calls, short answers) → shown as is
               ├▶ document → AI:ssociate answers Luna's questions → Sol builds the deliverable
               │              (document text inline, create_or_edit_file in the sandbox) or answers
               └▶ general  → Luna answers directly
                     │
   RIS verification of §§ / GZ (deterministic) → citations in the answer linked to RIS
```

* **Knowledge base:** `POST /api/public/v1/chat/ask` on app.aissociate.at
  (header `x-api-key`, SSE stream; legal areas civil / criminal / tax / public,
  optional Bundesland scope; `thread_id` keeps follow-ups in one thread). The
  documents it consults are shown live as research steps.
* **Models:** `gpt-6-luna` (`OPENAI_MODEL_FAST`) for planning, question
  formulation, general tasks and the per-document due-diligence analysis;
  `gpt-6-sol` (`OPENAI_MODEL_MAIN`) for deliverables and the DD synthesis; the
  code model defaults to Sol.
* **Verification:** each cited § / Art is looked up in RIS BrKons via
  `Abschnitt.Typ/Von/Bis` + `Fassung.FassungVom=today`, each Geschäftszahl via
  the Judikatur endpoint; confirmed citations become links in the answer.
* **Budgets:** hard caps per question — 1,000,000 input and 100,000 output
  tokens summed over all model calls (`MAX_INPUT_TOKENS`, `MAX_OUTPUT_TOKENS`);
  `MAX_WEB_SEARCHES` (3) and `DOC_MAX_STEPS` (8) bound the step count.
* **UI:** app.aissociate.at look (teal bar, centred logo, "Frage AI:ssociate."
  card), no Rechtsgebiet selection. Workflows with
  forms (Rechtsrecherche, Vertrag prüfen, Versionen vergleichen, Entwurf,
  Zusammenfassen, Fristen), conversation history (browser-local), feature tour,
  agent steps without code, sources with "Volltext geprüft" status, RIS
  verification panel, Word/Markdown export, exact cost per answer.

## Microsoft 365 (OneDrive / SharePoint)

Users sign in with their Microsoft account (OAuth 2.0 + PKCE against Entra ID,
delegated permissions). The composer's "Microsoft 365" button opens a picker for
OneDrive and SharePoint document libraries; picked files are downloaded
server-side via Microsoft Graph and processed like uploads. After a task, the
generated files and (optionally) the answer as a Word memo are written back to
the folder of the source file or to a chosen target folder; existing files are
never overwritten (Graph `conflictBehavior=rename`). The refresh token lives in
an encrypted, HttpOnly cookie; the server keeps no account data.

Configure `MS_CLIENT_ID`, `MS_CLIENT_SECRET` and optionally `MS_TENANT` /
`MS_REDIRECT_URI` (see `.env.example`). Routes: `GET /api/ms/login`,
`GET /api/ms/callback`, `GET /api/ms/me`, `POST /api/ms/logout`,
`GET /api/ms/browse`, `GET /api/ms/sites`, `GET /api/ms/site-drives`; the chat
request takes `msFiles` and `msSync`.

## Agents

Two agents, one sidebar. The **general agent** (Assistent) can ultimately do
everything: **Luna** (fast, cheap) decides the mode and the legal area and
formulates one to three *compact* questions, the **AI:ssociate knowledge base**
answers each briefly with references (several questions run in parallel), and
only at the end does **Sol** act when a deliverable is needed: it builds Word,
Excel, PDF or a redline from the document and the answers (code generation in
the sandbox), otherwise the knowledge-base answer is shown as is. Every cited
§ / Geschäftszahl is verified against the RIS. The optional Sol review with web
searches is off by default (`REVIEW_ANSWERS=on` re-enables it). The
**specialist agent** Due Diligence runs the fixed pipeline below; review tables
and the form-driven workflows live inside it (tabs of the Akt) and under the
composer ("Vorlagen"). Each matter is "der Akt".

## App shell, Akten, Due Diligence, Review-Tabellen

The UI is an app shell (sidebar: Assistent, Workflows, Alle Akten, Due
Diligence, Review-Tabellen, Verlauf, Einstellungen; hash routes such as
`#/matter/<id>/findings`). Matters ("Akten") hold documents (upload or import of
files and whole folders from OneDrive/SharePoint), their extracted text, the
analysis results, review tables and reports. Everything long-running is a
server job with a resumable event stream (`GET /api/jobs/:id/stream?after=seq`),
can be paused, and survives closed browser tabs.

**Due diligence** (`lib/ddconfig.js`, `lib/dd.js`, `lib/report.js`) is an
explicit pipeline, not an agent: Text → per-document analysis (strict JSON
schema: type, area, parties, key terms, findings with quote + location +
severity + recommendation + norms, questions) → synthesis per review area →
per review area Luna formulates 1–3 compact questions from the red/amber findings,
AI:ssociate answers each briefly (fed into the synthesis and the report) →
executive summary → RIS verification of every cited norm → Word Red-Flag-Report
+ Excel workbook from fixed templates. Every finding has a stable id (F-001),
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

Workspaces are separated by a browser-generated key sent as `X-Owner-Key`
(shown in the settings so a workspace can be opened on another device). This is
isolation, not authentication — see `docs/ARCHITEKTUR.md` for the critical
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

The service builds from the `Dockerfile`. Set `OPENAI_API_KEY`,
`AISSOCIATE_API_KEY` and `E2B_API_KEY` in the Render dashboard; everything else
has defaults (see `.env.example`). `GET /api/health` reports the configuration.
Matters are stored in `DATA_DIR` (`/data` in `render.yaml`): attach a persistent
disk there, otherwise they are lost on every deploy.

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
