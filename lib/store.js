// File-backed JSON store for matters (Akten), their documents, texts and reports.
//
// Why files and not a database: the app runs on Render without Postgres today.
// One JSON file per matter plus a text/binary file per document keeps every
// write atomic and the data model identical to what a later Postgres/SharePoint
// backed store would hold. Set DATA_DIR to a persistent disk on Render; without
// one the data lives only until the next deploy (documented limitation).
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const SAFE_ID = /^[\w-]{6,64}$/

export class JsonStore {
  constructor(dir) {
    this.dir = dir
    this.cache = new Map() // matterId -> matter
    this.saving = new Map() // matterId -> pending save
    this.seq = 0
    for (const sub of ['matters', 'texts', 'files', 'reports', 'skills', 'projects', 'project-convos']) fs.mkdirSync(path.join(dir, sub), { recursive: true })
  }

  // Skills of a workspace: one JSON file each; reference documents reuse texts/ and files/ under the skill id.
  skillPath(id) { return path.join(this.dir, 'skills', `${id}.json`) }
  async listSkills(ownerKey) {
    const out = []
    for (const f of await fsp.readdir(path.join(this.dir, 'skills'))) {
      if (!f.endsWith('.json')) continue
      const s = await this.getSkill(f.slice(0, -5))
      if (s && s.ownerKey === ownerKey) out.push(s)
    }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }
  async getSkill(id) {
    this.assertId(id)
    try { return JSON.parse(await fsp.readFile(this.skillPath(id), 'utf8')) } catch { return null }
  }
  async saveSkill(s) {
    this.assertId(s.id)
    s.updatedAt = Date.now()
    const p = this.skillPath(s.id), tmp = `${p}.${process.pid}.${++this.seq}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(s), 'utf8'); await fsp.rename(tmp, p)
    return s
  }
  async deleteSkill(id) {
    this.assertId(id)
    await fsp.rm(this.skillPath(id), { force: true })
    for (const sub of ['texts', 'files']) await fsp.rm(path.join(this.dir, sub, id), { recursive: true, force: true })
  }
  // Projects: one JSON file each (members, instructions, the id of the matter holding its
  // documents); their conversations are shared by all members, one JSON file per conversation.
  projectPath(id) { return path.join(this.dir, 'projects', `${id}.json`) }
  projectConvoDir(id) { this.assertId(id); return path.join(this.dir, 'project-convos', id) }
  async listProjects(filter = () => true) {
    const out = []
    for (const f of await fsp.readdir(path.join(this.dir, 'projects'))) {
      if (!f.endsWith('.json')) continue
      const p = await this.getProject(f.slice(0, -5))
      if (p && filter(p)) out.push(p)
    }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }
  async getProject(id) {
    this.assertId(id)
    try { return JSON.parse(await fsp.readFile(this.projectPath(id), 'utf8')) } catch { return null }
  }
  async saveProject(p, { touch = true } = {}) {
    this.assertId(p.id)
    if (touch) p.updatedAt = Date.now()
    const file = this.projectPath(p.id), tmp = `${file}.${process.pid}.${++this.seq}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(p), 'utf8'); await fsp.rename(tmp, file)
    return p
  }
  async deleteProject(id) {
    this.assertId(id)
    await fsp.rm(this.projectPath(id), { force: true })
    await fsp.rm(this.projectConvoDir(id), { recursive: true, force: true })
  }
  async listProjectConvos(id) {
    const dir = this.projectConvoDir(id), out = []
    let files = []
    try { files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json')) } catch {}
    for (const f of files) { try { out.push(JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'))) } catch {} }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }
  async saveProjectConvo(id, c) {
    this.assertId(c.id)
    const dir = this.projectConvoDir(id); await fsp.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${c.id}.json`), tmp = `${file}.${process.pid}.${++this.seq}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(c), 'utf8'); await fsp.rename(tmp, file)
  }
  async getProjectConvo(id, convoId) {
    this.assertId(convoId)
    try { return JSON.parse(await fsp.readFile(path.join(this.projectConvoDir(id), `${convoId}.json`), 'utf8')) } catch { return null }
  }
  async deleteProjectConvo(id, convoId) { this.assertId(convoId); await fsp.rm(path.join(this.projectConvoDir(id), `${convoId}.json`), { force: true }) }

  static newId(prefix = 'm') { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('base64url')}` }
  matterPath(id) { return path.join(this.dir, 'matters', `${id}.json`) }
  assertId(id) { if (!SAFE_ID.test(String(id))) throw new Error('Ungültige ID.') }

  async listMatters(ownerKey) {
    const out = []
    for (const f of await fsp.readdir(path.join(this.dir, 'matters'))) {
      if (!f.endsWith('.json')) continue
      const m = await this.getMatter(f.slice(0, -5))
      if (m && (ownerKey === undefined || m.ownerKey === ownerKey)) out.push(m)
    }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }
  /** After a restart no job can still be running: mark interrupted runs as paused so they can be resumed. */
  async reconcileInterrupted() {
    let n = 0
    for (const m of await this.listMatters(undefined)) {
      let changed = false
      if (m.job?.status === 'running') { m.job.status = 'paused'; m.job.error = 'Durch einen Neustart des Servers unterbrochen – „Analyse fortsetzen“ macht dort weiter.'; m.job.pauseRequested = false; m.job.jobId = null; changed = true }
      for (const t of m.tables || []) if (t.status === 'running') { t.status = 'paused'; changed = true }
      if (changed) { await this.saveMatter(m); n++ }
    }
    return n
  }
  async getMatter(id) {
    this.assertId(id)
    if (this.cache.has(id)) return this.cache.get(id)
    try {
      const m = JSON.parse(await fsp.readFile(this.matterPath(id), 'utf8'))
      this.cache.set(id, m)
      return m
    } catch { return null }
  }
  async saveMatter(m) {
    this.assertId(m.id)
    m.updatedAt = Date.now()
    this.cache.set(m.id, m)
    // Saves of one matter are serialised (parallel document analysis saves often)
    // and each write uses its own temp file, so concurrent saves never race on rename.
    const prev = this.saving.get(m.id) || Promise.resolve()
    const run = prev.catch(() => {}).then(async () => {
      const p = this.matterPath(m.id)
      const tmp = `${p}.${process.pid}.${++this.seq}.tmp`
      await fsp.writeFile(tmp, JSON.stringify(m), 'utf8')
      await fsp.rename(tmp, p)
    })
    this.saving.set(m.id, run)
    try { await run } finally { if (this.saving.get(m.id) === run) this.saving.delete(m.id) }
    return m
  }
  async deleteMatter(id) {
    this.assertId(id)
    this.cache.delete(id)
    await fsp.rm(this.matterPath(id), { force: true })
    for (const sub of ['texts', 'files', 'reports']) await fsp.rm(path.join(this.dir, sub, id), { recursive: true, force: true })
  }

  // Document text (extracted) and binaries live next to the matter.
  async putText(matterId, docId, text) { this.assertId(matterId); this.assertId(docId); const d = path.join(this.dir, 'texts', matterId); await fsp.mkdir(d, { recursive: true }); await fsp.writeFile(path.join(d, `${docId}.txt`), text, 'utf8') }
  async getText(matterId, docId) { this.assertId(matterId); this.assertId(docId); try { return await fsp.readFile(path.join(this.dir, 'texts', matterId, `${docId}.txt`), 'utf8') } catch { return '' } }
  async putFile(matterId, docId, ext, buf) { this.assertId(matterId); this.assertId(docId); const d = path.join(this.dir, 'files', matterId); await fsp.mkdir(d, { recursive: true }); const name = `${docId}.${String(ext || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'}`; await fsp.writeFile(path.join(d, name), buf); return name }
  async getFile(matterId, fileName) { this.assertId(matterId); if (!/^[\w-]+\.[a-z0-9]{1,8}$/i.test(fileName)) throw new Error('Ungültiger Dateiname.'); try { return await fsp.readFile(path.join(this.dir, 'files', matterId, fileName)) } catch { return null } }
  async deleteDocument(matterId, docId, fileName) {
    this.assertId(matterId); this.assertId(docId)
    await fsp.rm(path.join(this.dir, 'texts', matterId, `${docId}.txt`), { force: true })
    if (fileName && /^[\w-]+\.[a-z0-9]{1,8}$/i.test(fileName)) await fsp.rm(path.join(this.dir, 'files', matterId, fileName), { force: true })
  }
  async putReport(matterId, fileName, buf) { this.assertId(matterId); const d = path.join(this.dir, 'reports', matterId); await fsp.mkdir(d, { recursive: true }); const safe = fileName.replace(/[^\w.\-äöüÄÖÜß ]/g, '_'); await fsp.writeFile(path.join(d, safe), buf); return safe }
  async getReport(matterId, fileName) { this.assertId(matterId); const safe = String(fileName).replace(/[^\w.\-äöüÄÖÜß ]/g, '_'); try { return await fsp.readFile(path.join(this.dir, 'reports', matterId, safe)) } catch { return null } }
  async stats() {
    let matters = 0
    try { matters = (await fsp.readdir(path.join(this.dir, 'matters'))).filter((f) => f.endsWith('.json')).length } catch {}
    return { dir: this.dir, matters }
  }
}
