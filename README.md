# AI:ssociate Playground

Legal AI assistant for Austrian law firms. Users ask questions or run guided
workflows; an agent researches **iteratively in the RIS (ris.bka.gv.at)**,
reads the actual documents, answers with `[Qn]` source markers, and every cited
§ / Geschäftszahl is **verified against the RIS** afterwards. Documents can be
uploaded, analysed and returned as Word/Excel/PDF — the code for that is a
single tool call executed in an **E2B sandbox** (never shown to the user).

## How a question is processed

```
question ──▶ triage (Luna) ──▶ simple    → Luna answers (≤ 4 steps)
                            ├▶ research  → Luna research loop (RIS/EU) → Sol writes the answer
                            └▶ complex   → Sol agent loop (uploads, files, drafting)
                                     │
                     verification (deterministic RIS checks of §§ and GZ) + follow-ups (Luna)
```

* **Tools of the agent:** `ris_search` (Bundesrecht, Landesrecht, Judikatur,
  BGBl via the OGD API v2.6), `ris_read` (full text), `fetch_page` (EUR-Lex etc.),
  `read_document` (uploaded files, extracted server-side), `create_or_edit_file`
  (code model writes Python, runs in E2B, retries on errors), hosted `web_search`.
* **Model routing:** `gpt-6-luna` for triage, simple tasks, research loop and
  follow-ups; `gpt-6-sol` for complex tasks and the final answer; the code model
  defaults to Sol (set `OPENAI_MODEL_CODE` if you have another id).
* **Budgets:** hard caps per question — 1,000,000 input and 100,000 output
  tokens summed over all model calls (`MAX_INPUT_TOKENS`, `MAX_OUTPUT_TOKENS`).
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

The service builds from the `Dockerfile`. Set `OPENAI_API_KEY` and
`E2B_API_KEY` in the Render dashboard; everything else has defaults
(see `.env.example`). `GET /api/health` reports the configured models.

## Endpoints

| Route | Purpose |
|---|---|
| `POST /api/chat` | SSE stream: `step`, `step_update`, `route`, `final`, `error` |
| `POST /api/verify` | Re-run the RIS verification for a text |
| `GET /api/ris/search` | Direct RIS search (same parameters as the tool) |
| `POST /api/export/docx` | Markdown → Word export of an answer |

## Security note

The E2B key has a hardcoded **test-only** fallback in `server.js`; set
`E2B_API_KEY` in production and rotate any key that was ever pasted into a chat.
