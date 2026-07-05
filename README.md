# E2B Code Chat

A minimal chat interface where you type a coding prompt, **OpenAI** turns it into Python,
the code runs in a disposable **[E2B](https://e2b.dev) sandbox**, and the output
(text, tables, charts, files) is streamed back into the chat. Built to deploy on **Render**.

You can also **attach files** (📎): they are uploaded into the sandbox, the generated code
reads/modifies them, and any resulting files come back as downloads.

```
You ──prompt──▶ Express server ──▶ OpenAI (writes Python)
                                 └▶ E2B sandbox (runs it) ──▶ results ──▶ You
```

## Stack

- **Backend:** Node.js + Express (`server.js`)
- **Frontend:** single static page, no build step (`public/index.html`)
- **AI:** OpenAI Chat Completions
- **Execution:** `@e2b/code-interpreter` (secure, throwaway Python sandbox)

## Run locally

```bash
cd e2b-code-chat
cp .env.example .env      # then fill in your keys
npm install
npm run dev               # http://localhost:3000
```

You need two keys in `.env`:

| Variable         | Where to get it                                             |
|------------------|------------------------------------------------------------|
| `OPENAI_API_KEY` | The same key you use in your other repos.                   |
| `E2B_API_KEY`    | https://e2b.dev/dashboard                                   |
| `OPENAI_MODEL`   | Optional, defaults to `gpt-5.5`.                            |

## Deploy on Render (connected to GitHub)

1. Push this folder to a GitHub repo (see options below).
2. In Render: **New → Web Service** and connect that repo.
3. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Root directory:** `e2b-code-chat` *(only if it lives in a subfolder)*
4. Add the environment variables `OPENAI_API_KEY` and `E2B_API_KEY`
   (and optionally `OPENAI_MODEL`) under **Environment**.
5. Deploy. Render auto-redeploys on every push to the connected branch.

A `render.yaml` Blueprint is included, so you can also do **New → Blueprint**
and point it at the repo instead of configuring by hand.

## Security

- **Never commit real keys.** `.env` is git-ignored; only `.env.example` is tracked.
- Rotate any key you have shared in plain text (chat, screenshots, tickets).
- Each request spins up a fresh sandbox and kills it afterwards, so runs are isolated.
