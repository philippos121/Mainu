// Stage 0 of the due diligence: the inventory of the data room.
//
// - SHA-256 of every file across the whole Akt plus a hash of the normalised text, so
//   duplicates (also re-scans and Word/PDF twins) are recognised and not analysed twice;
// - archives (.zip, .7z) and e-mails (.eml, .msg) are unpacked: every part becomes a
//   document of its own with a reference to its parent;
// - role (original, secondary source, draft, plan, data sheet) and legal subject by rules
//   (file name, folder, first page); only what the rules cannot tell goes to the model;
// - reconciliation: in source / taken in / analysed / skipped.
import crypto from 'node:crypto'
import JSZip from 'jszip'
import MsgReaderMod from '@kenjiuno/msgreader'
import SevenZip from '7z-wasm'

const MsgReader = MsgReaderMod.default || MsgReaderMod

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
/** Text normalised for duplicate detection: case, whitespace, punctuation and page markers do not count. */
export const normText = (t) => String(t || '').toLowerCase().replace(/---\s*seite\s*\d+\s*---/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
/** Hash of the normalised text; short texts (cover sheets, empty scans) get none – they would match too easily. */
export function textHash(text) {
  const n = normText(text)
  return n.length >= 400 ? crypto.createHash('sha256').update(n).digest('hex') : ''
}

export const ARCHIVE_RE = /\.(zip|7z)$/i
export const MAIL_RE = /\.(eml|msg)$/i
const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|(^|\/)~\$|(^|\/)\._/i

// ---- archives ----
/** Parts of a .zip or .7z archive: [{ name, folder, buf | null, size, tooLarge }]. */
export async function unpackArchive(name, buf, { maxFileBytes, maxTotalBytes = 1024 * 1048576, maxFiles = 2000 } = {}) {
  return /\.7z$/i.test(name) ? unpack7z(buf, { maxFileBytes, maxTotalBytes, maxFiles }) : unpackZip(buf, { maxFileBytes, maxTotalBytes, maxFiles })
}
async function unpackZip(buf, { maxFileBytes, maxTotalBytes, maxFiles }) {
  const zip = await JSZip.loadAsync(buf)
  const out = []
  let total = 0
  for (const f of Object.values(zip.files)) {
    if (f.dir || JUNK.test(f.name)) continue
    if (out.length >= maxFiles) break
    const parts = f.name.replace(/\\/g, '/').split('/')
    const base = parts.pop()
    const size = f._data?.uncompressedSize ?? 0
    // Size is checked before inflating (protects against zip bombs).
    if ((maxFileBytes && size > maxFileBytes) || total + size > maxTotalBytes) { out.push({ name: base, folder: parts.join('/'), buf: null, size, tooLarge: true }); continue }
    const data = await f.async('nodebuffer')
    total += data.length
    out.push({ name: base, folder: parts.join('/'), buf: data, size: data.length })
  }
  return out
}
async function unpack7z(buf, { maxFileBytes, maxTotalBytes, maxFiles }) {
  const sz = await SevenZip({ print: () => {}, printErr: () => {} })
  sz.FS.mkdir('/in'); sz.FS.mkdir('/out')
  const s = sz.FS.open('/in/a.7z', 'w+'); sz.FS.write(s, new Uint8Array(buf), 0, buf.length); sz.FS.close(s)
  sz.callMain(['x', '/in/a.7z', '-o/out', '-y', '-bd'])
  const out = []
  let total = 0
  const walk = (dir, rel) => {
    for (const n of sz.FS.readdir(dir)) {
      if (n === '.' || n === '..' || out.length >= maxFiles) continue
      const p = `${dir}/${n}`, r = rel ? `${rel}/${n}` : n
      if (JUNK.test(r)) continue
      const st = sz.FS.stat(p)
      if (sz.FS.isDir(st.mode)) { walk(p, r); continue }
      if ((maxFileBytes && st.size > maxFileBytes) || total + st.size > maxTotalBytes) { out.push({ name: n, folder: rel, buf: null, size: st.size, tooLarge: true }); continue }
      const data = Buffer.from(sz.FS.readFile(p))
      total += data.length
      out.push({ name: n, folder: rel, buf: data, size: data.length })
    }
  }
  walk('/out', '')
  return out
}

// ---- e-mails ----
const decodeWords = (s) => String(s || '').replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
  try {
    const bytes = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64') : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'binary')
    return new TextDecoder(/utf-?8/i.test(cs) ? 'utf-8' : /1252|latin|8859/i.test(cs) ? 'windows-1252' : cs).decode(bytes)
  } catch { return txt }
}).replace(/\?=\s+=\?/g, '')
const qp = (s) => Buffer.from(s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary')
function parseHeaders(block) {
  const h = {}
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim() }
  return h
}
const param = (v, key) => { const m = String(v || '').match(new RegExp(`${key}\\*?=(?:"([^"]*)"|([^;]*))`, 'i')); const x = m ? (m[1] ?? m[2] ?? '').trim() : ''; return /^utf-8''/i.test(x) ? decodeURIComponent(x.replace(/^utf-8''/i, '')) : decodeWords(x) }
function decodeBody(raw, h) {
  const enc = String(h['content-transfer-encoding'] || '').toLowerCase()
  const bin = enc === 'base64' ? Buffer.from(raw.replace(/\s+/g, ''), 'base64') : enc === 'quoted-printable' ? qp(raw) : Buffer.from(raw, 'binary')
  return bin
}
const htmlText = (s) => String(s).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim()
const charsetText = (buf, ct) => { const cs = param(ct, 'charset') || 'utf-8'; try { return new TextDecoder(/utf-?8/i.test(cs) ? 'utf-8' : /1252|latin|8859/i.test(cs) ? 'windows-1252' : cs).decode(buf) } catch { return buf.toString('utf8') } }

/** An .eml file: { text (headers + body), attachments: [{ name, buf }] }. */
export function parseEml(buf) {
  const raw = buf.toString('binary')
  const attachments = []
  let plain = '', html = ''
  const walk = (part, depth) => {
    const sep = part.search(/\r?\n\r?\n/)
    const h = parseHeaders(sep >= 0 ? part.slice(0, sep) : part)
    const body = sep >= 0 ? part.slice(sep).replace(/^\r?\n\r?\n/, '') : ''
    const ct = h['content-type'] || 'text/plain'
    if (/^multipart\//i.test(ct) && depth < 8) {
      const b = param(ct, 'boundary'); if (!b) return h
      for (const p of body.split('--' + b).slice(1)) { if (p.startsWith('--')) break; walk(p.replace(/^\r?\n/, ''), depth + 1) }
      return h
    }
    const name = param(h['content-disposition'], 'filename') || param(ct, 'name')
    const data = decodeBody(body, h)
    if (name || /^attachment/i.test(h['content-disposition'] || '')) attachments.push({ name: name || 'anhang.bin', buf: data })
    else if (/^text\/plain/i.test(ct) && !plain) plain = charsetText(data, ct)
    else if (/^text\/html/i.test(ct) && !html) html = htmlText(charsetText(data, ct))
    else if (/^message\/rfc822/i.test(ct)) attachments.push({ name: 'weitergeleitete_Nachricht.eml', buf: data })
    return h
  }
  const h = walk(raw, 0)
  const text = mailText({ from: decodeWords(h.from), to: decodeWords(h.to), cc: decodeWords(h.cc), date: h.date, subject: decodeWords(h.subject), body: plain || html, attachments: attachments.map((a) => a.name) })
  return { text, attachments }
}
/** An Outlook .msg file: { text, attachments }. */
export function parseMsg(buf) {
  const r = new MsgReader(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const d = r.getFileData()
  const attachments = []
  for (const a of d.attachments || []) {
    if (a.innerMsgContent) continue
    try { const x = r.getAttachment(a); if (x?.content?.length) attachments.push({ name: x.fileName || a.fileName || 'anhang.bin', buf: Buffer.from(x.content) }) } catch {}
  }
  const to = (d.recipients || []).map((x) => x.name || x.email).filter(Boolean).join(', ')
  const text = mailText({ from: [d.senderName, d.senderEmail ? `<${d.senderEmail}>` : ''].filter(Boolean).join(' '), to, cc: '', date: d.messageDeliveryTime || d.clientSubmitTime || '', subject: d.subject || '', body: d.body || (d.bodyHtml ? htmlText(d.bodyHtml) : ''), attachments: attachments.map((a) => a.name) })
  return { text, attachments }
}
const mailText = ({ from, to, cc, date, subject, body, attachments }) => [`Von: ${from || ''}`, `An: ${to || ''}`, cc ? `Cc: ${cc}` : '', `Datum: ${date || ''}`, `Betreff: ${subject || ''}`, attachments.length ? `Anhänge: ${attachments.join(', ')}` : '', '', String(body || '').trim()].filter((l, i) => l || i > 5).join('\n')

// ---- role and legal subject by rules ----
const RX = {
  // Third-party reports about other documents: at most hypotheses (authority audit reports are originals).
  secondary: /(pr[üu]f(ungs)?bericht|due[\s_-]*diligence|\bdd[\s_-]*(bericht|report)|red[\s_-]*flag|\bvdd\b|legal[\s_-]*opinion|memo(randum)?\b|gutachten|stellungnahme|aktenvermerk|management[\s_-]*letter|factbook|info(rmation)?[\s_-]*memorandum|\bteaser\b)/i,
  authority: /(au(ss|ß)enpr[üu]fung|betriebspr[üu]fung|gplb|niederschrift|bescheid|finanzamt|bfg|erkenntnis)/i,
  draft: /(entwurf|draft|\bv\d+[\s_-]*(draft|entwurf)|zur[\s_-]*abstimmung|mark[\s_-]*up|redline)/i,
  plan: /(\bplan\b|lageplan|grundriss|zeichnung|schnitt|ansicht|einreichplan|bauplan|\.dwg$|\.dxf$|planstand)/i,
  datasheet: /(datenblatt|data[\s_-]*sheet|produktblatt|technische[\s_-]*daten|sicherheitsdatenblatt|katalog|prospekt|brosch[üu]re)/i,
  original: /(vertrag|vereinbarung|bescheid|firmenbuch|grundbuch|beschluss|protokoll|notariatsakt|jahresabschluss|bilanz|gewinn.*verlust|rechnung|polizze|urteil|klage|vollmacht|satzung|erkl[äa]rung|bestellung|genehmigung|bewilligung|konzession|gewerbe|auszug|mietvertrag|dienstvertrag|kreditvertrag|bestätigung|korrespondenz|schreiben|e-?mail|\.eml$|\.msg$)/i,
}
/** Role by rules from file name, folder and the first page; null if the rules cannot tell. */
export function roleByRule({ name, folder = '', head = '' }) {
  const n = `${folder}/${name}`
  const top = String(head || '').slice(0, 600)
  if (RX.secondary.test(n) && !RX.authority.test(n)) return 'Sekundärquelle'
  if (/^\s*(due[\s-]*diligence[\s-]*(bericht|report)|red[\s-]*flag[\s-]*report|legal[\s-]*due|memorandum\b|gutachten\b)/i.test(top)) return 'Sekundärquelle'
  if (RX.draft.test(name) || /\bENTWURF\b|\bDRAFT\b/.test(top)) return 'Entwurf'
  if (RX.plan.test(name)) return 'Plan/Zeichnung'
  if (RX.datasheet.test(name)) return 'Datenblatt'
  if (RX.original.test(n) || /^(von|from):/im.test(top.slice(0, 200))) return 'Originalunterlage'
  return null
}
const nameTokens = (s) => String(s || '').toLowerCase().replace(/\b(gmbh|ag|kg|og|gesmbh|e\.?u\.?|co|und|&|ges\.?m\.?b\.?h\.?|flexkapg|se)\b/g, ' ').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)
/** Legal subject by rules: the target named on the first page → target; otherwise null (the model decides). */
export function subjectByRule({ head = '', target = '' }) {
  const t = nameTokens(target)
  if (!t.length) return null
  const h = String(head || '').slice(0, 3000).toLowerCase()
  return t.every((w) => h.includes(w)) ? 'Zielgesellschaft' : null
}
/** Pages with handwriting (from the OCR markers "--- Seite N ---" and "[handschriftlich: …]"). */
export function handwritingPages(text) {
  const out = []
  const parts = String(text || '').split(/---\s*Seite\s*(\d+)\s*---/i)
  for (let i = 1; i < parts.length; i += 2) if (/\[handschriftlich/i.test(parts[i + 1] || '')) out.push(Number(parts[i]))
  return out
}

/** The four numbers of the document index; "alle analysiert" only when nothing was skipped. */
export function reconcile(matter) {
  const docs = (matter.documents || []).filter((d) => !d.container)
  const skipped = docs.filter((d) => d.status === 'skipped' || d.status === 'error')
  return {
    source: docs.length,
    taken: docs.filter((d) => d.file).length,
    analysed: docs.filter((d) => d.status === 'analysed').length,
    skipped: skipped.length,
    duplicates: docs.filter((d) => d.duplicateOf).length,
    secondary: docs.filter((d) => d.role === 'Sekundärquelle').length,
    containers: (matter.documents || []).filter((d) => d.container).length,
    byReason: skipped.reduce((o, d) => { const k = d.skipReason || 'failed'; o[k] = (o[k] || 0) + 1; return o }, {}),
    complete: docs.length > 0 && skipped.length === 0 && docs.every((d) => d.status === 'analysed'),
  }
}
