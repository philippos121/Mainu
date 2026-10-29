// Local stand-in for the E2B sandbox – ONLY for development, tests and the explainer
// video (SANDBOX=local). It runs the generated Python on this machine in a temporary
// directory that plays the role of /home/user: there is no isolation, so never enable
// it on a server that processes real client data.
//
// Implements the part of the E2B API the server uses: Sandbox.create, files.write/
// list/read, runCode (stdout/stderr/error like the code interpreter), setTimeout, kill.
import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const WORKDIR = '/home/user'

export class LocalSandbox {
  static async create() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aiss-sandbox-'))
    return new LocalSandbox(dir)
  }

  constructor(dir) {
    this.dir = dir
    this.local = true
    const map = (p) => {
      const rel = String(p).startsWith(WORKDIR) ? String(p).slice(WORKDIR.length) : String(p)
      const full = path.resolve(dir, '.' + path.sep + rel.replace(/^\/+/, ''))
      if (!full.startsWith(dir)) throw new Error('Pfad außerhalb der Sandbox')
      return full
    }
    this.files = {
      write: async (p, data) => { const f = map(p); await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data)) },
      list: async (p) => {
        const d = map(p)
        const out = []
        for (const e of await fsp.readdir(d, { withFileTypes: true })) {
          const st = await fsp.stat(path.join(d, e.name))
          out.push({ name: e.name, path: `${WORKDIR}/${e.name}`, type: e.isDirectory() ? 'dir' : 'file', size: st.size })
        }
        return out
      },
      read: async (p) => new Uint8Array(await fsp.readFile(map(p))),
    }
  }

  async runCode(code, { timeoutMs = 180_000 } = {}) {
    // The code expects the E2B working directory; inside this stand-in /home/user is the temp dir.
    const src = String(code).split(WORKDIR).join(this.dir)
    const python = process.env.LOCAL_SANDBOX_PYTHON || 'python3'
    return new Promise((resolve) => {
      const child = spawn(python, ['-c', src], { cwd: this.dir, env: { ...process.env, HOME: this.dir, MPLBACKEND: 'Agg' } })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
      child.stdout.on('data', (d) => { stdout += d })
      child.stderr.on('data', (d) => { stderr += d })
      child.on('close', (codeExit) => {
        clearTimeout(timer)
        const last = stderr.trim().split('\n').pop() || ''
        const m = last.match(/^(\w+(?:Error|Exception)?):\s*(.*)$/)
        resolve({
          logs: { stdout: stdout ? [stdout] : [], stderr: stderr ? [stderr] : [] },
          results: [],
          error: codeExit === 0 ? null : { name: m ? m[1] : 'Error', value: m ? m[2] : (last || `exit ${codeExit}`), traceback: stderr },
        })
      })
    })
  }

  async setTimeout() {}
  async kill() { await fsp.rm(this.dir, { recursive: true, force: true }).catch(() => {}) }
}
