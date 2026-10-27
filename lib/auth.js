// Accounts and sessions. Users live as JSON files on the data disk; passwords are
// hashed with scrypt; the session is an HMAC-signed cookie (user id, session
// version, expiry) – bumping the version (password change, logout everywhere,
// deactivation) invalidates all cookies of that user at once.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const SAFE_ID = /^usr_[\w-]{6,64}$/
export const PASSWORD_MIN = 10
export const SESSION_DAYS = 30

export class AuthStore {
  constructor(dir) {
    this.dir = path.join(dir, 'users')
    fs.mkdirSync(this.dir, { recursive: true })
    this.secretFile = path.join(dir, '.auth-secret')
    this.seq = 0
  }
  /** AUTH_SECRET, else a random key kept on the data disk (sessions survive restarts and deploys). */
  secret() {
    if (this._secret) return this._secret
    if (process.env.AUTH_SECRET) return (this._secret = crypto.createHash('sha256').update(process.env.AUTH_SECRET).digest())
    try { this._secret = Buffer.from(fs.readFileSync(this.secretFile, 'utf8').trim(), 'base64'); if (this._secret.length >= 32) return this._secret } catch {}
    this._secret = crypto.randomBytes(32)
    try { fs.writeFileSync(this.secretFile, this._secret.toString('base64'), { mode: 0o600 }) } catch (e) { console.warn('auth secret not persisted:', e?.message) }
    return this._secret
  }
  file(id) { if (!SAFE_ID.test(String(id))) throw new Error('Ungültige Benutzer-ID.'); return path.join(this.dir, `${id}.json`) }
  async list() {
    const out = []
    for (const f of await fsp.readdir(this.dir)) { if (!f.endsWith('.json')) continue; const u = await this.get(f.slice(0, -5)).catch(() => null); if (u) out.push(u) }
    return out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  }
  async count() { return (await fsp.readdir(this.dir)).filter((f) => f.endsWith('.json')).length }
  async get(id) { try { return JSON.parse(await fsp.readFile(this.file(id), 'utf8')) } catch { return null } }
  async byEmail(email) { const e = normEmail(email); return (await this.list()).find((u) => u.email === e) || null }
  async save(u) { u.updatedAt = Date.now(); const p = this.file(u.id), tmp = `${p}.${process.pid}.${++this.seq}.tmp`; await fsp.writeFile(tmp, JSON.stringify(u), { encoding: 'utf8', mode: 0o600 }); await fsp.rename(tmp, p); return u }
  async remove(id) { await fsp.rm(this.file(id), { force: true }) }
  async create({ email, name, password, role = 'user' }) {
    const e = normEmail(email)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('Bitte eine gültige E-Mail-Adresse angeben.')
    checkPassword(password)
    if (await this.byEmail(e)) throw new Error('Für diese E-Mail-Adresse gibt es bereits ein Konto.')
    const u = { id: `usr_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('base64url')}`, email: e, name: String(name || '').trim().slice(0, 80) || e.split('@')[0], role: role === 'admin' ? 'admin' : 'user', pass: hashPassword(password), sv: 1, disabled: false, createdAt: Date.now(), lastLoginAt: null }
    return this.save(u)
  }
}

export const normEmail = (e) => String(e || '').trim().toLowerCase().slice(0, 200)
export function checkPassword(pw) { if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) throw new Error(`Das Passwort muss mindestens ${PASSWORD_MIN} Zeichen haben.`); if (pw.length > 200) throw new Error('Das Passwort ist zu lang.') }
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}
export function verifyPassword(pw, stored) {
  const [alg, s, k] = String(stored || '').split('$')
  if (alg !== 'scrypt' || !s || !k) return false
  const want = Buffer.from(k, 'base64')
  const got = crypto.scryptSync(String(pw ?? ''), Buffer.from(s, 'base64'), want.length, { N: 16384, r: 8, p: 1 })
  return got.length === want.length && crypto.timingSafeEqual(got, want)
}
export function signSession(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`
}
export function verifySession(token, secret) {
  const [body, mac] = String(token || '').split('.')
  if (!body || !mac) return null
  const want = crypto.createHmac('sha256', secret).update(body).digest()
  const got = Buffer.from(mac, 'base64url')
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return p && p.exp > Date.now() ? p : null } catch { return null }
}
export const userView = (u) => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, disabled: Boolean(u.disabled), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null })

/** Failed logins per IP and e-mail: at most `max` within `windowMs`. */
export class Throttle {
  constructor(max = 8, windowMs = 15 * 60_000) { this.max = max; this.windowMs = windowMs; this.map = new Map() }
  blocked(key) { const e = this.map.get(key); if (!e) return false; if (Date.now() - e.t > this.windowMs) { this.map.delete(key); return false } return e.n >= this.max }
  fail(key) { const e = this.map.get(key); if (!e || Date.now() - e.t > this.windowMs) this.map.set(key, { n: 1, t: Date.now() }); else e.n++; if (this.map.size > 5000) this.map.delete(this.map.keys().next().value) }
  reset(key) { this.map.delete(key) }
}
