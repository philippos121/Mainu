# AI:ssociate Playground

Legal AI assistant for Austrian law firms. Every legal question goes to the
**AI:ssociate knowledge base** (its own agentic research over Austrian statutes
and case law); **Sol** picks the legal area first and reviews the answer
afterwards, adding at most **three web searches** when something is missing.
Every cited § / Geschäftszahl is then **verified against the RIS**. Documents can
be uploaded, analysed and returned as Word/Excel/PDF — the code for that is a
single tool call executed in an **E2B sandbox** (never shown to the user).

## How a question is processed (≈ 5 steps)

```
question ──▶ Sol: mode + legal area (1 call) ──▶ legal    → AI:ssociate API (1 call, streamed)
                                                            → Sol review: sufficient | ≤ 3 web searches + supplement
                                               ├▶ document → short Sol tool loop (read_document, create_or_edit_file,
                                               │              ask_aissociate ×1, web_search ≤ 3)
                                               └▶ general  → Sol answers directly
                                                     │
                              RIS verification of §§ / GZ (deterministic) + 3 follow-ups (Luna)
```

* **Knowledge base:** `POST /api/public/v1/chat/ask` on app.aissociate.at
  (header `x-api-key`, SSE stream; legal areas civil / criminal / tax / public,
  optional Bundesland scope; `thread_id` keeps follow-ups in one thread).
* **Models:** `gpt-6-sol` for the legal-area decision, review, document tasks
  and final answers; `gpt-6-luna` only for follow-up suggestions; the code model
  defaults to Sol (set `OPENAI_MODEL_CODE` if you have another id).
* **Budgets:** hard caps per question — 1,000,000 input and 100,000 output
  tokens summed over all model calls (`MAX_INPUT_TOKENS`, `MAX_OUTPUT_TOKENS`);
  `MAX_WEB_SEARCHES` (3) and `DOC_MAX_STEPS` (8) bound the step count.
* **UI:** app.aissociate.at look (teal bar, centred logo, "Frage AI:ssociate."
  card with Pseudonymisierung toggle), no Rechtsgebiet selection. Workflows with
  forms (Rechtsrecherche, Vertrag prüfen, Versionen vergleichen, Entwurf,
  Zusammenfassen, Fristen), conversation history (browser-local), feature tour,
  agent steps without code, sources with "Volltext geprüft" status, RIS
  verification panel, Word/Markdown export, exact cost per answer.

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
