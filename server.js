import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { Sandbox } from '@e2b/code-interpreter'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const {
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-4o-mini',
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

    const { prompt, history = [], files: rawUploads = [] } = req.body ?? {}
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing "prompt" string in request body.' })
    }

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
      { role: 'system', content: SYSTEM_PROMPT },
      ...(uploadNote ? [uploadNote] : []),
      ...history
        .filter((m) => m && m.role && typeof m.content === 'string')
        .slice(-10),
      { role: 'user', content: prompt },
    ]
    const completion = await getOpenAI().chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.2,
    })
    const reply = completion.choices[0]?.message?.content ?? ''
    const code = extractCode(reply)
    const explanation = reply.replace(/```[\s\S]*?```/g, '').trim()

    // Nothing to run — return the assistant's text as-is.
    if (!code) {
      return res.json({ explanation: reply, code: null, execution: null })
    }

    // 2) Run the generated code in a fresh, disposable E2B sandbox.
    const sandbox = await Sandbox.create({ apiKey: E2B_API_KEY })
    let execution
    let files = []
    try {
      // Push any uploaded files into the sandbox so the code can use them.
      for (const u of uploads) {
        const ab = u.buf.buffer.slice(u.buf.byteOffset, u.buf.byteOffset + u.buf.byteLength)
        await sandbox.files.write(`${WORKDIR}/${u.name}`, ab)
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

      execution = await sandbox.runCode(code, { timeoutMs: 60_000 })

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
      },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err?.message ?? 'Unknown server error.' })
  }
})

app.listen(PORT, () => {
  console.log(`e2b-code-chat listening on http://localhost:${PORT}`)
})
