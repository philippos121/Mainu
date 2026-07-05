import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { Sandbox } from '@e2b/code-interpreter'
import { Sandbox as DesktopSandbox } from '@e2b/desktop'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const {
  OPENAI_API_KEY,
  // Override via the OPENAI_MODEL env var if your account exposes the model
  // under a different id (e.g. a dated variant).
  OPENAI_MODEL = 'gpt-5.5',
  PORT = 3000,
} = process.env

// TEST ONLY: hardcoded E2B key so the app runs without configuring env vars.
// The E2B_API_KEY env var overrides this. Delete the fallback and rotate the
// key before any real or public deployment.
const E2B_API_KEY =
  process.env.E2B_API_KEY || 'e2b_bd1a9240aeb8ea21578a5fc7ab87befd408f074e'

// Where the sandbox's Python kernel writes files by default, and limits on
// how many/how large the files we return to the browser can be.
const WORKDIR = '/home/user'
const MAX_FILES = 10
const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15 MB per file (download)
const MAX_UPLOADS = 5
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024 // 15 MB per uploaded file

// Execution timeouts. Browser tasks need longer (install + navigation).
const RUN_TIMEOUT_MS = 60_000
const BROWSER_RUN_TIMEOUT_MS = 180_000
const BROWSER_SETUP_TIMEOUT_MS = 260_000
const SANDBOX_LIFETIME_MS = 300_000

// Optional custom E2B desktop template (e.g. one with LibreOffice pre-baked).
const DESKTOP_TEMPLATE = process.env.E2B_DESKTOP_TEMPLATE || ''

// Cost estimation. Defaults are the real OpenAI GPT-5.5 API rates (USD per 1M
// tokens): $5 input, $0.50 cached input, $30 output. Override via env. Token
// counts are exact (from the OpenAI usage field), including cached tokens.
const PRICE_IN = Number(process.env.OPENAI_PRICE_IN || 5) // USD / 1M input tokens
const PRICE_CACHED = Number(process.env.OPENAI_PRICE_CACHED || 0.5) // USD / 1M cached input tokens
const PRICE_OUT = Number(process.env.OPENAI_PRICE_OUT || 30) // USD / 1M output tokens
const E2B_PRICE_PER_SEC = Number(process.env.E2B_PRICE_PER_SEC || 0.00014) // USD / sandbox-second

function computeCost(inTok, outTok, seconds, cachedTok = 0) {
  const nonCached = Math.max(0, inTok - (cachedTok || 0))
  const openaiUsd =
    (nonCached / 1e6) * PRICE_IN +
    ((cachedTok || 0) / 1e6) * PRICE_CACHED +
    (outTok / 1e6) * PRICE_OUT
  const e2bUsd = (seconds || 0) * E2B_PRICE_PER_SEC
  return {
    inTok,
    outTok,
    cachedTok: cachedTok || 0,
    seconds: Math.round(seconds || 0),
    openaiUsd: +openaiUsd.toFixed(4),
    e2bUsd: +e2bUsd.toFixed(4),
    totalUsd: +(openaiUsd + e2bUsd).toFixed(4),
  }
}

function addUsage(acc, usage) {
  if (usage) {
    acc.inTok += usage.prompt_tokens || 0
    acc.outTok += usage.completion_tokens || 0
    acc.cachedTok += usage.prompt_tokens_details?.cached_tokens || 0
  }
}

// Created lazily so the server still boots (and /api/health can report the
// problem) when a key is missing, instead of crashing at startup.
let _openai
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: OPENAI_API_KEY })
  return _openai
}

// Persistent per-session sandboxes for the chat, so follow-up questions can
// build on earlier files and variables (the Python kernel keeps its state).
const CHAT_SESSION_TTL_MS = 15 * 60 * 1000
const chatSessions = new Map() // sessionId -> { sandbox, lastUsed }

async function getChatSandbox(sessionId) {
  const existing = sessionId && chatSessions.get(sessionId)
  if (existing) {
    try {
      await existing.sandbox.setTimeout(SANDBOX_LIFETIME_MS) // keep it alive
      existing.lastUsed = Date.now()
      return existing.sandbox
    } catch {
      try { await existing.sandbox.kill() } catch {}
      chatSessions.delete(sessionId)
    }
  }
  const sandbox = await Sandbox.create({ apiKey: E2B_API_KEY, timeoutMs: SANDBOX_LIFETIME_MS })
  if (sessionId) chatSessions.set(sessionId, { sandbox, lastUsed: Date.now() })
  return sandbox
}

// Reap idle session sandboxes.
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of chatSessions) {
    if (now - s.lastUsed > CHAT_SESSION_TTL_MS) {
      s.sandbox.kill().catch(() => {})
      chatSessions.delete(id)
    }
  }
}, 60_000).unref?.()

const SYSTEM_PROMPT = `You are a coding assistant whose code is executed in a secure E2B Python sandbox
(a Jupyter-like environment with internet access).

When the user asks for something, respond with:
1. A short (1-2 sentence) explanation of your approach.
2. Exactly ONE fenced Python code block (\`\`\`python ... \`\`\`) that fully solves the request.

Rules:
- The sandbox has numpy, pandas, matplotlib and requests pre-installed. Install anything else with
  "!pip install <package>" on the first lines of the code.
- Always produce visible output: print() results, or render charts/tables. Matplotlib figures are
  captured automatically, so just call plt.show().
- Keep the code self-contained and runnable top-to-bottom. Do not ask follow-up questions.
- If the user uploaded files, they are already saved in the current working directory. Read them by
  their exact filename. Save any modified or generated file to the working directory (a new filename
  is fine) so it can be returned to the user for download.`

// Extra guidance appended when the user turns on Browser mode.
// IMPORTANT: the sandbox runs inside a Jupyter kernel with a RUNNING asyncio
// loop, so Playwright's sync API fails. The async API with top-level await works.
const BROWSER_PROMPT = `
BROWSER AUTOMATION IS ENABLED. Playwright and headless Chromium are already installed in the sandbox.
Use them to drive a real browser (navigate, click, fill forms, scrape JavaScript-rendered pages).

CRITICAL: the code runs inside a Jupyter kernel that already has a running asyncio event loop.
- You MUST use Playwright's ASYNC API: "from playwright.async_api import async_playwright".
- Do NOT use the sync API (sync_playwright) — it raises "using Sync API inside the asyncio loop".
- Do NOT call asyncio.run() or asyncio.get_event_loop().run_until_complete() — a loop is already running.
- Use top-level "await" directly (it is supported here), or define "async def main(): ..." and end the
  code with "await main()".
- Launch headless: browser = await p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"]).
- Always save a screenshot: await page.screenshot(path="screenshot.png", full_page=True).
- print() the key information you extracted, and await browser.close() at the end.

Template to follow:
\`\`\`python
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = await browser.new_page()
        await page.goto("https://example.com", wait_until="load")
        print("Title:", await page.title())
        await page.screenshot(path="screenshot.png", full_page=True)
        await browser.close()

await main()
\`\`\``

/** Pull the first fenced python block out of the model's reply. */
function extractCode(text) {
  const match = text.match(/```(?:python|py)?\s*\n([\s\S]*?)```/i)
  return match ? match[1].trim() : null
}

const app = express()
app.use(express.json({ limit: '30mb' })) // room for base64-encoded uploads
app.use(express.static(path.join(__dirname, 'public')))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    openai: Boolean(OPENAI_API_KEY),
    e2b: Boolean(E2B_API_KEY),
    model: OPENAI_MODEL,
  })
})

app.post('/api/chat', async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not set on the server.' })
    }
    if (!E2B_API_KEY) {
      return res.status(500).json({ error: 'E2B_API_KEY is not set on the server.' })
    }

    const { prompt, history = [], files: rawUploads = [], browser = false, sessionId } = req.body ?? {}
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing "prompt" string in request body.' })
    }
    const browserMode = browser === true
    const persistent = typeof sessionId === 'string' && sessionId.length > 0

    // Validate & normalize uploaded files: strip any path, cap count/size.
    const uploads = []
    for (const u of Array.isArray(rawUploads) ? rawUploads : []) {
      if (!u || typeof u.name !== 'string' || typeof u.base64 !== 'string') continue
      const name = path.basename(u.name).replace(/[^\w.\- ]/g, '_')
      const buf = Buffer.from(u.base64, 'base64')
      if (!name || buf.length === 0) continue
      if (buf.length > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: `Uploaded file "${name}" exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.` })
      }
      uploads.push({ name, buf })
      if (uploads.length >= MAX_UPLOADS) break
    }

    // 1) Ask OpenAI to write the code.
    const uploadNote = uploads.length
      ? {
          role: 'system',
          content: `The user uploaded these files, already saved in the working directory: ${uploads
            .map((u) => u.name)
            .join(', ')}. Read them by these exact filenames.`,
        }
      : null
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + (browserMode ? '\n' + BROWSER_PROMPT : '') },
      ...(uploadNote ? [uploadNote] : []),
      ...history
        .filter((m) => m && m.role && typeof m.content === 'string')
        .slice(-10),
      { role: 'user', content: prompt },
    ]
    // Note: no custom `temperature` — several newer models only accept the
    // default, and code generation is fine at the default sampling.
    const usage = { inTok: 0, outTok: 0, cachedTok: 0 }
    const completion = await getOpenAI().chat.completions.create({
      model: OPENAI_MODEL,
      messages,
    })
    addUsage(usage, completion.usage)
    const reply = completion.choices[0]?.message?.content ?? ''
    const code = extractCode(reply)
    const explanation = reply.replace(/```[\s\S]*?```/g, '').trim()

    // Nothing to run — return the assistant's text as-is.
    if (!code) {
      return res.json({ explanation: reply, code: null, execution: null, cost: computeCost(usage.inTok, usage.outTok, 0, usage.cachedTok) })
    }

    // 2) Run the generated code. With a sessionId we reuse a persistent
    // sandbox so follow-up questions build on earlier files/variables;
    // otherwise a fresh, disposable one.
    const sandboxStart = Date.now()
    const sandbox = persistent
      ? await getChatSandbox(sessionId)
      : await Sandbox.create({ apiKey: E2B_API_KEY, timeoutMs: SANDBOX_LIFETIME_MS })
    let execution
    let files = []
    let setupNote = null
    try {
      // Push any uploaded files into the sandbox so the code can use them.
      for (const u of uploads) {
        const ab = u.buf.buffer.slice(u.buf.byteOffset, u.buf.byteOffset + u.buf.byteLength)
        await sandbox.files.write(`${WORKDIR}/${u.name}`, ab)
      }

      // Browser mode: install Playwright + headless Chromium up front so the
      // generated code can assume they're ready. This MUST run inside the same
      // kernel (via runCode) that later launches the browser, so Chromium lands
      // in the cache path that kernel uses (running commands.run separately put
      // it under a different user's cache and launch couldn't find it).
      if (browserMode) {
        const setupCode = [
          'import subprocess, sys',
          'subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "playwright"], check=True)',
          'subprocess.run([sys.executable, "-m", "playwright", "install", "--with-deps", "chromium"], check=True)',
          'print("BROWSER_SETUP_DONE")',
        ].join('\n')
        const setup = await sandbox.runCode(setupCode, { timeoutMs: BROWSER_SETUP_TIMEOUT_MS })
        if (setup.error) {
          setupNote = `Browser setup failed: ${setup.error.name}: ${setup.error.value}`
          console.error('browser setup failed:', setup.error.value)
        }
      }

      // Snapshot the working dir (uploads included) so we can detect files the
      // code creates or modifies afterwards.
      const before = new Map()
      try {
        for (const e of await sandbox.files.list(WORKDIR)) {
          if (e.type === 'file') before.set(e.path, e.size)
        }
      } catch {
        /* dir may not be listable; ignore */
      }

      execution = await sandbox.runCode(code, {
        timeoutMs: browserMode ? BROWSER_RUN_TIMEOUT_MS : RUN_TIMEOUT_MS,
      })

      // Capture new or changed files (e.g. .docx, .csv, .xlsx, .zip) and
      // hand them back to the browser as downloads.
      try {
        const after = await sandbox.files.list(WORKDIR)
        const changed = after.filter(
          (e) => e.type === 'file' && before.get(e.path) !== e.size,
        )
        for (const e of changed.slice(0, MAX_FILES)) {
          if (e.size > MAX_FILE_BYTES) {
            files.push({ name: e.name, size: e.size, tooLarge: true })
            continue
          }
          const bytes = await sandbox.files.read(e.path, { format: 'bytes' })
          files.push({
            name: e.name,
            size: e.size,
            base64: Buffer.from(bytes).toString('base64'),
          })
        }
      } catch (e) {
        console.error('file capture failed:', e?.message)
      }
    } finally {
      // Keep persistent session sandboxes alive for follow-ups; the idle
      // reaper cleans them up later. Only kill throwaway ones.
      if (!persistent) {
        try { await sandbox.kill() } catch {}
      }
    }

    const results = execution.results ?? []
    const images = results
      .filter((r) => r.png)
      .map((r) => `data:image/png;base64,${r.png}`)
    const textResults = results.map((r) => r.text).filter(Boolean)

    res.json({
      explanation,
      code,
      execution: {
        stdout: (execution.logs?.stdout ?? []).join(''),
        stderr: (execution.logs?.stderr ?? []).join(''),
        error: execution.error
          ? `${execution.error.name}: ${execution.error.value}\n${execution.error.traceback ?? ''}`
          : null,
        text: textResults,
        images,
        files,
        note: setupNote,
      },
      cost: computeCost(usage.inTok, usage.outTok, (Date.now() - sandboxStart) / 1000, usage.cachedTok),
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err?.message ?? 'Unknown server error.' })
  }
})

// ---------------------------------------------------------------------------
// Agentic browser mode: an observe -> decide -> act loop. The model sees the
// page's interactive elements each step and picks ONE action. Secrets stay on
// the server and are substituted into actions at execution time, so the model
// only ever sees placeholder names like {{PASSWORD}}.
// ---------------------------------------------------------------------------

const AGENT_MAX_STEPS = 30
const AGENT_SANDBOX_MS = 600_000

// Installs Playwright + Chromium inside the run kernel (same cache the launch uses).
const AGENT_INSTALL_CODE = [
  'import subprocess, sys',
  'subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "playwright"], check=True)',
  'subprocess.run([sys.executable, "-m", "playwright", "install", "--with-deps", "chromium"], check=True)',
  'print("BROWSER_SETUP_DONE")',
].join('\n')

// Starts a persistent browser kept alive across runCode calls (no context manager).
const AGENT_START_CODE = [
  'from playwright.async_api import async_playwright',
  'pw = await async_playwright().start()',
  'browser = await pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])',
  'page = await browser.new_page(viewport={"width": 1280, "height": 900})',
  'print("BROWSER_STARTED")',
].join('\n')

const AGENT_CLEANUP_CODE = [
  'try:',
  '    await browser.close()',
  'except Exception:',
  '    pass',
  'try:',
  '    await pw.stop()',
  'except Exception:',
  '    pass',
  'print("CLEANED")',
].join('\n')

// Tags each visible interactive element with a data-agent-ref and returns a
// compact descriptor list. No backslashes / ${} so it is safe in a template.
const OBSERVE_JS = `() => {
  const items = [];
  const els = document.querySelectorAll('a,button,input,textarea,select,[role=button],[role=link],[role=textbox],[contenteditable=true]');
  let i = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width <= 0 || r.height <= 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    el.setAttribute('data-agent-ref', String(i));
    const label = (el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || '');
    items.push({ ref: i, tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', name: el.getAttribute('name') || '', label: String(label).slice(0, 100) });
    i++;
  }
  return items;
}`

const BROWSER_ACTIONS = new Set(['goto', 'click', 'fill', 'press', 'scroll', 'extract'])

function agentSystemPrompt(secretNames) {
  const secrets = secretNames.length ? secretNames.join(', ') : '(keine)'
  return `You are a general computer-use agent working inside a Linux sandbox, ONE step at a time.
You have a shell, a filesystem, Python, an HTTP client, and a headless Chromium browser.
Each turn you get the current state (browser page if active, plus the output of your last tool) and the recent actions.
Choose EXACTLY ONE next action to progress on the TASK. Reply with ONLY a JSON object — no prose, no code fences.

Browser actions (a browser is launched automatically the first time you use one):
{"thought":"...","action":"goto","url":"https://..."}
{"thought":"...","action":"click","ref":<number>}
{"thought":"...","action":"fill","ref":<number>,"text":"value"}
{"thought":"...","action":"press","key":"Enter","ref":<optional number>}
{"thought":"...","action":"scroll","amount":800}
{"thought":"...","action":"extract"}

Computer actions (no browser needed):
{"thought":"...","action":"python","code":"import pandas as pd; df=pd.read_csv('/home/user/x.csv'); print(df.head())"}
{"thought":"...","action":"shell","command":"ls -la"}
{"thought":"...","action":"read_file","path":"/home/user/x.csv"}
{"thought":"...","action":"write_file","path":"/home/user/out.txt","text":"content"}
{"thought":"...","action":"http","method":"GET","url":"https://graph.microsoft.com/v1.0/me/drive/root/children","headers":{"Authorization":"Bearer {{TOKEN}}"}}

Control:
{"thought":"...","action":"wait","seconds":3}
{"thought":"...","action":"done","answer":"the result/answer for the user"}
{"thought":"...","action":"fail","answer":"why it is impossible"}

Rules:
- For browser clicks/fills refer to elements ONLY by their ref number from the ELEMENTS list.
- Prefer APIs over browser clicking when available (e.g. Microsoft Graph for SharePoint/OneDrive).
- SECRETS available: ${secrets}. NEVER guess them. Use them ONLY as placeholders like {{NAME}} inside text/headers/url. You never see the real values; they are substituted at execution time.
- The working directory is /home/user. Files you create there are returned to the user at the end.
- Prefer "python" for editing files or data (pandas, python-docx, openpyxl, PyPDF2, Pillow). The Python kernel is PERSISTENT — variables and imports carry over between python steps. Always print() what you want to see.
- MAKE RESULTS VIEWABLE: the UI previews .html, .pdf and image files inline. When COMPARING documents, extract the text of each and produce a visual red/green diff as an .html file (e.g. difflib.HtmlDiff().make_file(...), or custom HTML with green for additions and red for deletions). ALSO always save the diff as a Word file delta.docx using python-docx, with additions in green and deletions in red strikethrough (run.font.color.rgb = RGBColor(0,128,0) for additions; run.font.color.rgb = RGBColor(200,0,0) and run.font.strike = True for deletions). For other document results, also save a viewable .html or .pdf version in addition to the .docx/.xlsx.
- To read text from uploaded documents: .docx via python-docx (docx.Document), .pdf via PyPDF2/pdfplumber, .txt/.csv directly.
- Use "extract" for page text; "shell"/"read_file" for local data; "http" for APIs. When the TASK is achieved use "done"; if truly stuck use "fail".`
}

function desktopSystemPrompt(secretNames, size) {
  const secrets = secretNames.length ? secretNames.join(', ') : '(keine)'
  return `You are a computer-use agent controlling a real Linux DESKTOP (graphical) ONE step at a time.
Each turn you receive a SCREENSHOT of the current ${size.width}x${size.height} screen. Coordinates are in pixels, origin top-left.
Choose EXACTLY ONE next action to progress on the TASK. Reply with ONLY a JSON object — no prose, no code fences.

Actions:
{"thought":"...","action":"click","x":<int>,"y":<int>}
{"thought":"...","action":"double_click","x":<int>,"y":<int>}
{"thought":"...","action":"right_click","x":<int>,"y":<int>}
{"thought":"...","action":"move","x":<int>,"y":<int>}
{"thought":"...","action":"type","text":"text to type"}
{"thought":"...","action":"key","keys":"ctrl+s"}
{"thought":"...","action":"scroll","direction":"down","amount":3}
{"thought":"...","action":"launch","app":"libreoffice --writer"}
{"thought":"...","action":"open","target":"/home/user/file.docx"}
{"thought":"...","action":"shell","command":"ls ~"}
{"thought":"...","action":"wait","seconds":2}
{"thought":"...","action":"done","answer":"result"}
{"thought":"...","action":"fail","answer":"why"}

Rules:
- Look at the screenshot carefully and click precise pixel coordinates of the target.
- To edit an uploaded document, prefer {"action":"open","target":"/home/user/<file>"} — it opens the file in its default app (LibreOffice). Then use {"action":"wait","seconds":5} and check the next screenshot before interacting; apps can take several seconds to appear.
- You can also start apps with {"action":"launch","app":"libreoffice --writer"}.
- After opening or clicking, the next screenshot shows the result — verify before continuing; use "wait" if an app is still loading.
- SECRETS available: ${secrets}. Use ONLY as placeholders {{NAME}} in "type"; they are substituted at execution time and never shown to you.
- When the TASK is achieved use "done"; if stuck use "fail".`
}

// A forced function/tool so the model MUST return a schema-valid action
// (far more reliable than hoping for clean JSON in the text).
function makeActionTool(actionEnum) {
  return {
    type: 'function',
    function: {
      name: 'perform_action',
      description: 'Perform exactly one next action to progress on the task.',
      parameters: {
        type: 'object',
        properties: {
          thought: { type: 'string', description: 'Brief reasoning.' },
          action: { type: 'string', enum: actionEnum },
          url: { type: 'string' },
          ref: { type: 'integer' },
          x: { type: 'integer' },
          y: { type: 'integer' },
          text: { type: 'string' },
          key: { type: 'string' },
          keys: { type: 'string', description: 'Key or combo, e.g. ctrl+s' },
          amount: { type: 'integer' },
          direction: { type: 'string', enum: ['up', 'down'] },
          code: { type: 'string', description: 'Python source for the python action.' },
          command: { type: 'string' },
          path: { type: 'string' },
          method: { type: 'string' },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          body: { type: 'string' },
          seconds: { type: 'integer' },
          app: { type: 'string' },
          target: { type: 'string' },
          answer: { type: 'string' },
        },
        required: ['action'],
      },
    },
  }
}
const WEB_ACTION_TOOL = makeActionTool([
  'goto', 'click', 'fill', 'press', 'scroll', 'extract',
  'python', 'shell', 'read_file', 'write_file', 'http', 'wait', 'done', 'fail',
])
const DESKTOP_ACTION_TOOL = makeActionTool([
  'click', 'double_click', 'right_click', 'move', 'type', 'key', 'scroll',
  'launch', 'open', 'shell', 'wait', 'done', 'fail',
])

// Pulls the action object out of a completion: prefer the forced tool call,
// fall back to parsing the message text.
function extractDecision(completion) {
  const msg = completion.choices?.[0]?.message
  const tc = msg?.tool_calls?.[0]
  if (tc?.function?.arguments) {
    try {
      return JSON.parse(tc.function.arguments)
    } catch {}
  }
  return parseJsonObject(msg?.content ?? '')
}

function parseJsonObject(s) {
  if (typeof s !== 'string') return null
  try {
    return JSON.parse(s)
  } catch {}
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(s.slice(a, b + 1))
    } catch {}
  }
  return null
}

function substituteSecrets(text, secrets) {
  return String(text).replace(/\{\{(\w+)\}\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(secrets, name) ? secrets[name] : m,
  )
}

function describeAction(d) {
  switch (d.action) {
    case 'goto': return `goto ${d.url || ''}`
    case 'click': return Number.isInteger(d.ref) ? `click [${d.ref}]` : `click ${d.x},${d.y}`
    case 'double_click': return `double_click ${d.x},${d.y}`
    case 'right_click': return `right_click ${d.x},${d.y}`
    case 'move': return `move ${d.x},${d.y}`
    case 'fill': return `fill [${d.ref}] ${d.text || ''}` // text keeps the {{placeholder}}
    case 'type': return `type "${d.text || ''}"`
    case 'key': return `key ${Array.isArray(d.keys) ? d.keys.join('+') : d.keys || d.key || ''}`
    case 'press': return `press ${d.key || 'Enter'}${Number.isInteger(d.ref) ? ` [${d.ref}]` : ''}`
    case 'scroll': return `scroll ${d.direction || ''} ${d.amount || 800}`.trim()
    case 'python': return `python: ${String(d.code || '').split('\n')[0].slice(0, 70)}`
    case 'shell': return `shell: ${d.command || ''}`
    case 'read_file': return `read_file ${d.path || ''}`
    case 'write_file': return `write_file ${d.path || ''}`
    case 'http': return `http ${(d.method || 'GET').toUpperCase()} ${d.url || ''}`
    case 'launch': return `launch ${d.app || d.application || ''}`
    case 'open': return `open ${d.target || d.url || ''}`
    case 'wait': return `wait ${d.seconds || 2}s`
    case 'extract': return 'extract page text'
    case 'done': return `done: ${d.answer || ''}`
    case 'fail': return `fail: ${d.answer || ''}`
    default: return `unknown (${d.action})`
  }
}

function buildActionPy(d, secrets) {
  const J = JSON.stringify
  const hasRef = Number.isInteger(d.ref)
  const sel = hasRef ? `[data-agent-ref="${d.ref}"]` : null
  const wrap = (body) =>
    'try:\n' +
    body.split('\n').map((l) => '    ' + l).join('\n') +
    '\nexcept Exception as e:\n    print("<<<ERR>>>"+repr(e))'
  const waitLoad =
    'try:\n    await page.wait_for_load_state("networkidle", timeout=8000)\nexcept Exception:\n    pass'

  switch (d.action) {
    case 'goto':
      return wrap(`await page.goto(${J(String(d.url || ''))}, wait_until="domcontentloaded", timeout=45000)\nprint("OK")`)
    case 'click':
      if (!sel) return null
      return wrap(`await page.click(${J(sel)}, timeout=15000)\n${waitLoad}\nprint("OK")`)
    case 'fill': {
      if (!sel) return null
      const val = substituteSecrets(d.text || '', secrets)
      return wrap(`await page.fill(${J(sel)}, ${J(val)}, timeout=15000)\nprint("OK")`)
    }
    case 'press': {
      const key = J(String(d.key || 'Enter'))
      const press = sel
        ? `await page.press(${J(sel)}, ${key}, timeout=15000)`
        : `await page.keyboard.press(${key})`
      return wrap(`${press}\n${waitLoad}\nprint("OK")`)
    }
    case 'scroll':
      return wrap(`await page.mouse.wheel(0, ${Number(d.amount) || 800})\nprint("OK")`)
    case 'wait':
      return wrap(`await page.wait_for_timeout(${Math.min(Math.max(Number(d.seconds) || 2, 1), 10) * 1000})\nprint("OK")`)
    case 'extract':
      return wrap('_t = await page.inner_text("body")\nprint("<<<TEXT>>>"+_t[:4000])')
    case 'python': {
      const codeStr = substituteSecrets(String(d.code || ''), secrets)
      return wrap(
        'import io, contextlib\n' +
        '_buf = io.StringIO()\n' +
        `_src = ${J(codeStr)}\n` +
        'with contextlib.redirect_stdout(_buf):\n    exec(_src, globals())\n' +
        'print("<<<TEXT>>>"+(_buf.getvalue() or "(kein Output)")[:4000])',
      )
    }
    case 'shell': {
      const cmd = substituteSecrets(String(d.command || ''), secrets)
      return wrap(
        'import subprocess\n' +
        `_r = subprocess.run(${J(cmd)}, shell=True, capture_output=True, text=True, timeout=120)\n` +
        'print("<<<TEXT>>>"+((_r.stdout or "")+(_r.stderr or ""))[:4000])',
      )
    }
    case 'read_file': {
      const p = String(d.path || '')
      return wrap(`with open(${J(p)}, "r", errors="replace") as _f:\n    print("<<<TEXT>>>"+_f.read()[:4000])`)
    }
    case 'write_file': {
      const p = String(d.path || '')
      const content = substituteSecrets(String(d.text ?? d.content ?? ''), secrets)
      return wrap(`with open(${J(p)}, "w") as _f:\n    _f.write(${J(content)})\nprint("OK")`)
    }
    case 'http': {
      const url = substituteSecrets(String(d.url || ''), secrets)
      const method = String(d.method || 'GET').toUpperCase()
      const headersJson = substituteSecrets(JSON.stringify(d.headers || {}), secrets)
      const hasBody = d.body != null
      const body = hasBody
        ? substituteSecrets(typeof d.body === 'string' ? d.body : JSON.stringify(d.body), secrets)
        : null
      return wrap(
        'import requests, json\n' +
        `_h = json.loads(${J(headersJson)})\n` +
        `_data = ${hasBody ? J(body) : 'None'}\n` +
        `_r = requests.request(${J(method)}, ${J(url)}, headers=_h, data=_data, timeout=60)\n` +
        'print("<<<TEXT>>>"+"HTTP "+str(_r.status_code)+"\\n"+_r.text[:4000])',
      )
    }
    default:
      return null
  }
}

async function agentObserve(sandbox) {
  const code =
    'import json\n' +
    `_els = await page.evaluate(${JSON.stringify(OBSERVE_JS)})\n` +
    'await page.screenshot(path="__step.png")\n' +
    'print("<<<OBS>>>"+json.dumps({"url": page.url, "title": (await page.title()), "elements": _els}))'
  const ex = await sandbox.runCode(code, { timeoutMs: 30_000 })
  const out = (ex.logs?.stdout ?? []).join('')
  let info = { url: '', title: '', elements: [] }
  const i = out.indexOf('<<<OBS>>>')
  if (i >= 0) {
    try {
      info = JSON.parse(out.slice(i + 9))
    } catch {}
  }
  info.elements = (info.elements || []).map((e) => ({
    ...e,
    label: String(e.label || '').replace(/\s+/g, ' ').trim(),
  }))
  let screenshot = null
  try {
    const b = await sandbox.files.read(`${WORKDIR}/__step.png`, { format: 'bytes' })
    screenshot = Buffer.from(b).toString('base64')
  } catch {}
  return { ...info, screenshot }
}

async function agentExecute(sandbox, d, secrets) {
  const code = buildActionPy(d, secrets)
  if (!code) return { error: 'unknown or malformed action' }
  const ex = await sandbox.runCode(code, { timeoutMs: 60_000 })
  const out = (ex.logs?.stdout ?? []).join('')
  if (ex.error) return { error: `${ex.error.name}: ${ex.error.value}` }
  const ei = out.indexOf('<<<ERR>>>')
  if (ei >= 0) return { error: out.slice(ei + 9).trim().slice(0, 300) }
  const ti = out.indexOf('<<<TEXT>>>')
  if (ti >= 0) return { text: out.slice(ti + 10) }
  return { ok: true }
}

async function agentDecide({ task, obs, recent, secretNames, lastTool, browserReady, cost, uploadNames }) {
  const pageBlock = browserReady
    ? `CURRENT PAGE
URL: ${obs.url}
TITLE: ${obs.title}

INTERACTIVE ELEMENTS:
${
  obs.elements
    .map(
      (e) =>
        `[${e.ref}] <${e.tag}${e.type ? ` type=${e.type}` : ''}${e.name ? ` name=${e.name}` : ''}> ${JSON.stringify(e.label)}`,
    )
    .join('\n')
    .slice(0, 6000) || '(none)'
}`
    : 'BROWSER: not started yet (a browser action will start it automatically).'
  const recentStr = recent.slice(-8).map((a, i) => `${i + 1}. ${a}`).join('\n') || '(none yet)'
  const uploadsLine = uploadNames?.length
    ? `\nUPLOADED FILES (already in /home/user): ${uploadNames.join(', ')}\n`
    : ''
  const user = `TASK: ${task}
${uploadsLine}
${pageBlock}

LAST TOOL OUTPUT:
${lastTool ? String(lastTool).slice(0, 3000) : '(none)'}

RECENT ACTIONS:
${recentStr}

Respond with ONLY the next action as a JSON object.`
  const completion = await getOpenAI().chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: agentSystemPrompt(secretNames) },
      { role: 'user', content: user },
    ],
    tools: [WEB_ACTION_TOOL],
    tool_choice: { type: 'function', function: { name: 'perform_action' } },
  })
  addUsage(cost, completion.usage)
  return extractDecision(completion) || { action: 'fail', answer: 'Modellantwort nicht lesbar.', thought: '' }
}

async function writeUploads(sandbox, uploads, send) {
  for (const u of uploads) {
    const ab = u.buf.buffer.slice(u.buf.byteOffset, u.buf.byteOffset + u.buf.byteLength)
    try {
      await sandbox.files.write(`${WORKDIR}/${u.name}`, ab)
    } catch (e) {
      send?.('status', { message: `Upload „${u.name}" fehlgeschlagen: ${e?.message}` })
    }
  }
  if (uploads.length) send?.('status', { message: `${uploads.length} Datei(en) nach ${WORKDIR} hochgeladen: ${uploads.map((u) => u.name).join(', ')}` })
}

async function snapshotFiles(sandbox) {
  const m = new Map()
  try {
    for (const e of await sandbox.files.list(WORKDIR)) {
      if (e.type === 'file') m.set(e.path, e.size)
    }
  } catch {}
  return m
}

async function captureNewFiles(sandbox, before) {
  const files = []
  try {
    const after = await sandbox.files.list(WORKDIR)
    const changed = after.filter(
      (e) => e.type === 'file' && !e.name.startsWith('__') && before.get(e.path) !== e.size,
    )
    for (const e of changed.slice(0, MAX_FILES)) {
      if (e.size > MAX_FILE_BYTES) {
        files.push({ name: e.name, size: e.size, tooLarge: true })
        continue
      }
      const b = await sandbox.files.read(e.path, { format: 'bytes' })
      files.push({ name: e.name, size: e.size, base64: Buffer.from(b).toString('base64') })
    }
  } catch {}
  return files
}

// ---- Web / computer agent (code-interpreter sandbox) ----
async function runWebAgent(sandbox, { task, secrets, secretNames, steps, send, cost, startedAt, uploadNames }) {
  const before = await snapshotFiles(sandbox)
  let browserReady = false
  let lastTool = null
  const recent = []
  let answer = null

  for (let step = 1; step <= steps; step++) {
    let obs = { url: '', title: '', elements: [] }
    if (browserReady) {
      obs = await agentObserve(sandbox)
      send('observation', { step, url: obs.url, title: obs.title, screenshot: obs.screenshot })
    } else {
      send('observation', { step, url: '', title: '(kein Browser aktiv)' })
    }

    const d = await agentDecide({ task, obs, recent, secretNames, lastTool, browserReady, cost, uploadNames })
    const summary = describeAction(d)
    send('action', { step, thought: d.thought || '', summary })

    if (d.action === 'done') { answer = d.answer || 'Fertig.'; break }
    if (d.action === 'fail') { answer = '⚠ ' + (d.answer || 'Nicht möglich.'); break }

    // Lazily start the browser the first time a browser action is used.
    if (BROWSER_ACTIONS.has(d.action) && !browserReady) {
      send('status', { message: 'Chromium wird installiert & gestartet (~1 Min)…' })
      const inst = await sandbox.runCode(AGENT_INSTALL_CODE, { timeoutMs: BROWSER_SETUP_TIMEOUT_MS })
      if (inst.error) send('status', { message: 'Browser-Installation meldete einen Fehler.' })
      const st = await sandbox.runCode(AGENT_START_CODE, { timeoutMs: 60_000 })
      browserReady = !st.error
      if (!browserReady) {
        recent.push(`${summary} -> ERROR Browser konnte nicht starten`)
        lastTool = 'Browser konnte nicht gestartet werden.'
        continue
      }
    }

    const r = await agentExecute(sandbox, d, secrets)
    lastTool = r.text || (r.error ? 'ERROR ' + r.error : null)
    send('result', { step, text: r.text ? r.text.slice(0, 1500) : null, error: r.error || null })
    recent.push(
      summary +
        (r.error ? ` -> ERROR ${r.error}` : '') +
        (r.text ? ` -> ${r.text.replace(/\s+/g, ' ').slice(0, 400)}` : ''),
    )
  }

  if (answer == null) answer = 'Schrittlimit erreicht.'
  const files = await captureNewFiles(sandbox, before)
  let screenshot = null
  if (browserReady) {
    try { screenshot = (await agentObserve(sandbox)).screenshot } catch {}
  }
  send('final', { answer, files, screenshot, cost: computeCost(cost.inTok, cost.outTok, (Date.now() - startedAt) / 1000, cost.cachedTok) })
}

// ---- Desktop / GUI agent (E2B desktop sandbox, vision-driven) ----
function normalizeKeys(d) {
  const raw = Array.isArray(d.keys) ? d.keys : String(d.keys || d.key || '').split('+')
  const map = { enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: 'space', del: 'Delete', delete: 'Delete', backspace: 'BackSpace', up: 'Up', down: 'Down', left: 'Left', right: 'Right' }
  const keys = raw.map((k) => String(k).trim()).filter(Boolean).map((k) => map[k.toLowerCase()] || k)
  return keys.length > 1 ? keys : keys[0] || 'Return'
}

async function desktopDecide({ task, b64, size, recent, secretNames, cost, uploadNames }) {
  const recentStr = recent.slice(-8).map((a, i) => `${i + 1}. ${a}`).join('\n') || '(none yet)'
  const uploadsLine = uploadNames?.length ? `\nUPLOADED FILES (in /home/user): ${uploadNames.join(', ')}\n` : ''
  const userText = `TASK: ${task}
${uploadsLine}
The screenshot shows the current ${size.width}x${size.height} desktop.

RECENT ACTIONS:
${recentStr}

Respond with ONLY the next action as a JSON object.`
  const completion = await getOpenAI().chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: desktopSystemPrompt(secretNames, size) },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
    tools: [DESKTOP_ACTION_TOOL],
    tool_choice: { type: 'function', function: { name: 'perform_action' } },
  })
  addUsage(cost, completion.usage)
  return extractDecision(completion) || { action: 'fail', answer: 'Modellantwort nicht lesbar.', thought: '' }
}

async function desktopExecute(desktop, d, secrets) {
  switch (d.action) {
    case 'click': await desktop.leftClick(d.x, d.y); break
    case 'double_click': await desktop.doubleClick(d.x, d.y); break
    case 'right_click': await desktop.rightClick(d.x, d.y); break
    case 'move': await desktop.moveMouse(d.x, d.y); break
    case 'type': await desktop.write(substituteSecrets(String(d.text || ''), secrets)); break
    case 'key': await desktop.press(normalizeKeys(d)); break
    case 'scroll': await desktop.scroll(d.direction === 'up' ? 'up' : 'down', Math.min(Number(d.amount) || 3, 10)); break
    case 'launch': await desktop.launch(String(d.app || d.application || '')); break
    case 'open': await desktop.open(String(d.target || d.url || '')); break
    case 'wait': await desktop.wait(Math.min(Math.max(Number(d.seconds) || 1, 1), 10) * 1000); break
    case 'shell': {
      const out = await desktop.commands.run(substituteSecrets(String(d.command || ''), secrets), { timeoutMs: 120_000 })
      return { text: ((out.stdout || '') + (out.stderr || '')).slice(0, 3000) }
    }
    default: throw new Error('unbekannte Aktion: ' + d.action)
  }
  return {}
}

async function runDesktopAgent(desktop, { task, secrets, secretNames, steps, send, cost, startedAt, uploadNames }) {
  const size = await desktop.getScreenSize()

  // Live view: start the VNC stream and hand a view-only URL to the browser.
  try {
    await desktop.stream.start({ requireAuth: true })
    const url = desktop.stream.getUrl({
      authKey: desktop.stream.getAuthKey(),
      viewOnly: true,
      autoConnect: true,
      resize: 'scale',
    })
    send('stream', { url })
  } catch (e) {
    send('status', { message: 'Live-Ansicht konnte nicht gestartet werden: ' + (e?.message || e) })
  }

  // Ensure LibreOffice is available (the default desktop image ships without
  // it). If missing, install it once — slow, but then "open <doc>" works.
  try {
    const chk = await desktop.commands.run('which soffice libreoffice 2>/dev/null || true', { timeoutMs: 15_000 })
    if (!((chk.stdout || '').trim())) {
      send('status', { message: 'LibreOffice fehlt im Image — wird installiert (einmalig, 1–3 Min)…' })
      const inst = await desktop.commands.run(
        'sudo apt-get update -y && sudo apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc',
        { timeoutMs: 300_000 },
      )
      const ok = (await desktop.commands.run('which soffice libreoffice 2>/dev/null || true', { timeoutMs: 15_000 })).stdout?.trim()
      if (ok) send('status', { message: 'LibreOffice installiert.' })
      else send('status', { message: 'LibreOffice-Installation fehlgeschlagen: ' + ((inst.stderr || inst.stdout || '').slice(-300) || 'unbekannt') + '. Für sofortigen Start ein eigenes Desktop-Template mit LibreOffice nutzen (E2B_DESKTOP_TEMPLATE).' })
    }
  } catch (e) {
    send('status', { message: 'LibreOffice-Prüfung fehlgeschlagen: ' + (e?.message || e) })
  }

  const recent = []
  let lastTool = null
  let answer = null

  for (let step = 1; step <= steps; step++) {
    const shot = Buffer.from(await desktop.screenshot()).toString('base64')
    send('observation', { step, url: `Desktop ${size.width}×${size.height}`, screenshot: shot })

    const d = await desktopDecide({ task, b64: shot, size, recent, secretNames, cost, uploadNames })
    const summary = describeAction(d)
    send('action', { step, thought: d.thought || '', summary })

    if (d.action === 'done') { answer = d.answer || 'Fertig.'; break }
    if (d.action === 'fail') { answer = '⚠ ' + (d.answer || 'Nicht möglich.'); break }

    let err = null
    try {
      const r = await desktopExecute(desktop, d, secrets)
      lastTool = r?.text || null
    } catch (e) {
      err = e?.message || String(e)
    }
    if (lastTool || err) send('result', { step, text: lastTool ? lastTool.slice(0, 1500) : null, error: err })
    recent.push(summary + (err ? ` -> ERROR ${err}` : '') + (lastTool ? ` -> ${lastTool.replace(/\s+/g, ' ').slice(0, 200)}` : ''))
    // Give launched apps time to appear before the next screenshot.
    await desktop.wait(d.action === 'launch' || d.action === 'open' ? 4000 : 800)
  }

  if (answer == null) answer = 'Schrittlimit erreicht.'
  let screenshot = null
  try { screenshot = Buffer.from(await desktop.screenshot()).toString('base64') } catch {}
  send('final', { answer, screenshot, files: [], cost: computeCost(cost.inTok, cost.outTok, (Date.now() - startedAt) / 1000, cost.cachedTok) })
}

app.post('/api/agent', async (req, res) => {
  // Server-Sent-Events style stream so long runs keep the connection alive.
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  const send = (event, data) => res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`)
  // Keep the connection alive during long steps (e.g. LibreOffice install).
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, 15_000)
  heartbeat.unref?.()
  res.on('close', () => clearInterval(heartbeat))

  if (!OPENAI_API_KEY || !E2B_API_KEY) {
    send('error', { message: 'Server: OPENAI_API_KEY oder E2B_API_KEY fehlt.' })
    return res.end()
  }

  const { task, secrets: rawSecrets = {}, files: rawUploads = [], maxSteps, mode = 'web' } = req.body ?? {}
  if (!task || typeof task !== 'string') {
    send('error', { message: 'Feld "task" fehlt.' })
    return res.end()
  }
  const secrets = {}
  for (const [k, v] of Object.entries(rawSecrets || {})) {
    if (/^\w+$/.test(k) && typeof v === 'string' && v.length) secrets[k] = v
  }
  const secretNames = Object.keys(secrets)
  const steps = Math.min(Math.max(Number(maxSteps) || AGENT_MAX_STEPS, 1), AGENT_MAX_STEPS)

  // Uploaded files -> written into the sandbox working dir before the run.
  const uploads = []
  for (const u of Array.isArray(rawUploads) ? rawUploads : []) {
    if (!u || typeof u.name !== 'string' || typeof u.base64 !== 'string') continue
    const name = path.basename(u.name).replace(/[^\w.\- ]/g, '_')
    const buf = Buffer.from(u.base64, 'base64')
    if (!name || buf.length === 0 || buf.length > MAX_UPLOAD_BYTES) continue
    uploads.push({ name, buf })
    if (uploads.length >= MAX_UPLOADS) break
  }
  const uploadNames = uploads.map((u) => u.name)

  const cost = { inTok: 0, outTok: 0, cachedTok: 0 }
  const startedAt = Date.now()

  if (mode === 'desktop') {
    let desktop
    try {
      send('status', { message: 'Desktop wird gestartet…' })
      desktop = DESKTOP_TEMPLATE
        ? await DesktopSandbox.create(DESKTOP_TEMPLATE, { apiKey: E2B_API_KEY, timeoutMs: AGENT_SANDBOX_MS })
        : await DesktopSandbox.create({ apiKey: E2B_API_KEY, timeoutMs: AGENT_SANDBOX_MS })
      if (secretNames.length) send('status', { message: `Secrets geladen: ${secretNames.join(', ')}` })
      await writeUploads(desktop, uploads, send)
      await runDesktopAgent(desktop, { task, secrets, secretNames, steps, send, cost, startedAt, uploadNames })
    } catch (err) {
      console.error('desktop agent error:', err)
      send('error', { message: err?.message ?? 'Unbekannter Desktop-Fehler.' })
    } finally {
      if (desktop) { try { await desktop.kill() } catch {} }
      res.end()
    }
    return
  }

  let sandbox
  try {
    send('status', { message: 'Sandbox wird gestartet…' })
    sandbox = await Sandbox.create({ apiKey: E2B_API_KEY, timeoutMs: AGENT_SANDBOX_MS })
    if (secretNames.length) send('status', { message: `Secrets geladen: ${secretNames.join(', ')}` })
    await writeUploads(sandbox, uploads, send)
    await runWebAgent(sandbox, { task, secrets, secretNames, steps, send, cost, startedAt, uploadNames })
  } catch (err) {
    console.error('agent error:', err)
    send('error', { message: err?.message ?? 'Unbekannter Agent-Fehler.' })
  } finally {
    if (sandbox) {
      try { await sandbox.runCode(AGENT_CLEANUP_CODE, { timeoutMs: 20_000 }) } catch {}
      try { await sandbox.kill() } catch {}
    }
    res.end()
  }
})

app.listen(PORT, () => {
  console.log(`e2b-code-chat listening on http://localhost:${PORT}`)
})
