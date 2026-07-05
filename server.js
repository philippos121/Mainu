import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { Sandbox } from '@e2b/code-interpreter'

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

// Created lazily so the server still boots (and /api/health can report the
// problem) when a key is missing, instead of crashing at startup.
let _openai
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: OPENAI_API_KEY })
  return _openai
}

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

    const { prompt, history = [], files: rawUploads = [], browser = false } = req.body ?? {}
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing "prompt" string in request body.' })
    }
    const browserMode = browser === true

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
    const completion = await getOpenAI().chat.completions.create({
      model: OPENAI_MODEL,
      messages,
    })
    const reply = completion.choices[0]?.message?.content ?? ''
    const code = extractCode(reply)
    const explanation = reply.replace(/```[\s\S]*?```/g, '').trim()

    // Nothing to run — return the assistant's text as-is.
    if (!code) {
      return res.json({ explanation: reply, code: null, execution: null })
    }

    // 2) Run the generated code in a fresh, disposable E2B sandbox.
    const sandbox = await Sandbox.create({
      apiKey: E2B_API_KEY,
      timeoutMs: SANDBOX_LIFETIME_MS,
    })
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
      await sandbox.kill()
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

const AGENT_MAX_STEPS = 14
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

function agentSystemPrompt(secretNames) {
  const secrets = secretNames.length ? secretNames.join(', ') : '(none provided)'
  return `You are a web-automation agent driving a headless Chromium browser ONE step at a time.
Each turn you get the current page (URL, TITLE, a numbered list of visible INTERACTIVE ELEMENTS) and the recent actions.
Choose EXACTLY ONE next action to progress on the TASK. Reply with ONLY a JSON object — no prose, no code fences.

Action formats:
{"thought":"...","action":"goto","url":"https://..."}
{"thought":"...","action":"click","ref":<number>}
{"thought":"...","action":"fill","ref":<number>,"text":"value"}
{"thought":"...","action":"press","key":"Enter","ref":<optional number>}
{"thought":"...","action":"scroll","amount":800}
{"thought":"...","action":"wait","seconds":3}
{"thought":"...","action":"extract"}
{"thought":"...","action":"done","answer":"the result/answer for the user"}
{"thought":"...","action":"fail","answer":"why it is impossible"}

Rules:
- Refer to elements ONLY by their ref number from the ELEMENTS list.
- To log in: reach the login form (you may first need to click a "Login"/"Einloggen" link), fill email and password, then click submit.
- SECRETS available: ${secrets}. NEVER guess them. Use them ONLY as placeholders in "text", written EXACTLY as {{NAME}} (e.g. {{PASSWORD}}). You will never see the real values; they are substituted at execution time.
- After any action that changes the page, the next turn shows the new page — re-check before continuing.
- Use "extract" when you need the page's text (e.g. to read an answer). When the TASK is achieved, use "done" with the answer. If truly stuck, use "fail".`
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
    case 'click': return `click [${d.ref}]`
    case 'fill': return `fill [${d.ref}] ${d.text || ''}` // text keeps the {{placeholder}}
    case 'press': return `press ${d.key || 'Enter'}${Number.isInteger(d.ref) ? ` [${d.ref}]` : ''}`
    case 'scroll': return `scroll ${d.amount || 800}`
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

async function agentDecide({ task, obs, recent, secretNames }) {
  const elems = obs.elements
    .map(
      (e) =>
        `[${e.ref}] <${e.tag}${e.type ? ` type=${e.type}` : ''}${e.name ? ` name=${e.name}` : ''}> ${JSON.stringify(e.label)}`,
    )
    .join('\n')
    .slice(0, 6000)
  const recentStr = recent.slice(-8).map((a, i) => `${i + 1}. ${a}`).join('\n') || '(none yet)'
  const user = `TASK: ${task}

CURRENT PAGE
URL: ${obs.url}
TITLE: ${obs.title}

INTERACTIVE ELEMENTS:
${elems || '(none)'}

RECENT ACTIONS:
${recentStr}

Respond with ONLY the next action as a JSON object.`
  const completion = await getOpenAI().chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: agentSystemPrompt(secretNames) },
      { role: 'user', content: user },
    ],
  })
  const raw = completion.choices[0]?.message?.content ?? ''
  return parseJsonObject(raw) || { action: 'fail', answer: 'Could not parse the model output.', thought: '' }
}

app.post('/api/agent', async (req, res) => {
  // Server-Sent-Events style stream so long runs keep the connection alive.
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  const send = (event, data) => res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`)

  if (!OPENAI_API_KEY || !E2B_API_KEY) {
    send('error', { message: 'Server is missing OPENAI_API_KEY or E2B_API_KEY.' })
    return res.end()
  }

  const { task, secrets: rawSecrets = {}, maxSteps } = req.body ?? {}
  if (!task || typeof task !== 'string') {
    send('error', { message: 'Missing "task" in request body.' })
    return res.end()
  }
  const secrets = {}
  for (const [k, v] of Object.entries(rawSecrets || {})) {
    if (/^\w+$/.test(k) && typeof v === 'string' && v.length) secrets[k] = v
  }
  const secretNames = Object.keys(secrets)
  const steps = Math.min(Math.max(Number(maxSteps) || AGENT_MAX_STEPS, 1), AGENT_MAX_STEPS)

  let sandbox
  try {
    send('status', { message: 'Starting sandbox…' })
    sandbox = await Sandbox.create({ apiKey: E2B_API_KEY, timeoutMs: AGENT_SANDBOX_MS })

    send('status', { message: 'Installing Chromium (first run, ~1 min)…' })
    const inst = await sandbox.runCode(AGENT_INSTALL_CODE, { timeoutMs: BROWSER_SETUP_TIMEOUT_MS })
    if (inst.error) {
      send('error', { message: `Browser install failed: ${inst.error.value}` })
      return
    }

    send('status', { message: 'Launching browser…' })
    const start = await sandbox.runCode(AGENT_START_CODE, { timeoutMs: 60_000 })
    if (start.error) {
      send('error', { message: `Browser launch failed: ${start.error.value}` })
      return
    }
    if (secretNames.length) send('status', { message: `Secrets loaded: ${secretNames.join(', ')}` })

    const recent = []
    let answer = null
    for (let step = 1; step <= steps; step++) {
      const obs = await agentObserve(sandbox)
      send('observation', { step, url: obs.url, title: obs.title, screenshot: obs.screenshot })

      const d = await agentDecide({ task, obs, recent, secretNames })
      const summary = describeAction(d)
      send('action', { step, thought: d.thought || '', summary })

      if (d.action === 'done') {
        answer = d.answer || 'Task complete.'
        break
      }
      if (d.action === 'fail') {
        answer = '⚠ ' + (d.answer || 'Agent could not complete the task.')
        break
      }

      const r = await agentExecute(sandbox, d, secrets)
      recent.push(
        summary +
          (r.error ? ` -> ERROR ${r.error}` : '') +
          (r.text ? ` -> ${r.text.replace(/\s+/g, ' ').slice(0, 400)}` : ''),
      )
      if (r.error) send('status', { message: `Step ${step}: ${summary} — ${r.error}` })
    }

    if (answer == null) answer = 'Reached the step limit before finishing the task.'
    const finalObs = await agentObserve(sandbox)
    send('final', { answer, url: finalObs.url, screenshot: finalObs.screenshot })
  } catch (err) {
    console.error('agent error:', err)
    send('error', { message: err?.message ?? 'Unknown agent error.' })
  } finally {
    if (sandbox) {
      try {
        await sandbox.runCode(AGENT_CLEANUP_CODE, { timeoutMs: 20_000 })
      } catch {}
      try {
        await sandbox.kill()
      } catch {}
    }
    res.end()
  }
})

app.listen(PORT, () => {
  console.log(`e2b-code-chat listening on http://localhost:${PORT}`)
})
