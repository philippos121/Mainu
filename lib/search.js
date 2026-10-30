// Per-Akt search index: full text (BM25 over passages) and, when an embedding model is
// configured (DD_EMBED_MODEL), vectors as a second signal. Used by the "Nachweis-Abgleich"
// (is what a finding calls missing somewhere else in the Akt?), by hypotheses from
// secondary sources and by questions about the Akt.
const PASSAGE = 1200
const OVERLAP = 200
const STOP = new Set('der die das und oder ein eine einer eines einem einen den dem des zu zur zum im in am an auf aus bei mit nach von vor für über unter durch ist sind wird werden wurde wurden hat haben als auch nicht kein keine sich dass da wie so nur noch bis gemäß laut sowie bzw oder etc wenn ob es er sie wir ihr ihm ihn diese dieser dieses jene alle allen aller'.split(' '))
// Light stemming: the same word in its German inflections gives the same term.
export const terms = (s) => String(s || '').toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => (w.length > 6 ? w.slice(0, 6 + Math.min(2, w.length - 6)).replace(/(en|er|es|e|n|s)$/, '') : w))

export class SearchIndex {
  constructor() { this.passages = []; this.df = new Map(); this.avgLen = 1; this.docs = new Set(); this.vectors = null }
  /** Adds the passages of one document (page numbers from "--- Seite N ---" markers where present). */
  add(doc, text) {
    if (this.docs.has(doc.id)) return
    this.docs.add(doc.id)
    const t = String(text || '')
    const pageAt = []
    for (const m of t.matchAll(/---\s*Seite\s*(\d+)\s*---/gi)) pageAt.push([m.index, Number(m[1])])
    for (let i = 0; i < t.length; i += PASSAGE - OVERLAP) {
      const body = t.slice(i, i + PASSAGE)
      if (body.replace(/\s+/g, '').length < 40) continue
      const tf = new Map()
      const ts = terms(body)
      for (const w of ts) tf.set(w, (tf.get(w) || 0) + 1)
      for (const w of tf.keys()) this.df.set(w, (this.df.get(w) || 0) + 1)
      const page = pageAt.filter(([o]) => o <= i).pop()?.[1] || null
      this.passages.push({ docId: doc.id, docNo: doc.no || '', docName: doc.name, role: doc.role || '', offset: i, page, text: body, tf, len: ts.length })
      if (i + PASSAGE >= t.length) break
    }
    this.avgLen = this.passages.reduce((n, p) => n + p.len, 0) / Math.max(1, this.passages.length)
  }
  /** Vectors for every passage (optional second signal): embed(texts) → number[][]. */
  async embedAll(embed, batch = 64) {
    const v = []
    for (let i = 0; i < this.passages.length; i += batch) v.push(...(await embed(this.passages.slice(i, i + batch).map((p) => p.text))))
    if (v.length === this.passages.length) { this.vectors = v; this.vecCount = v.length }
  }
  /** Top passages for a query; options exclude documents or restrict to a role. */
  search(query, { k = 5, excludeDocIds = [], role = null, qvec = null } = {}) {
    const q = [...new Set(terms(query))]
    if (!q.length && !qvec) return []
    const vec = qvec && this.vectors && this.vecCount === this.passages.length ? this.vectors : null
    const N = this.passages.length, k1 = 1.4, b = 0.75
    const out = []
    this.passages.forEach((p, idx) => {
      if (excludeDocIds.includes(p.docId) || (role && p.role && p.role !== role)) return
      let s = 0, hit = 0
      for (const w of q) {
        const f = p.tf.get(w); if (!f) continue
        hit++
        const idf = Math.log(1 + (N - this.df.get(w) + 0.5) / (this.df.get(w) + 0.5))
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * p.len / this.avgLen))
      }
      s = q.length ? s * (hit / q.length) : 0
      if (vec) s += 4 * cosine(qvec, vec[idx])
      if (s > 0) out.push({ ...p, score: s, coverage: q.length ? hit / q.length : 0 })
    })
    out.sort((a, b2) => b2.score - a.score)
    // At most two passages per document, so one long document does not crowd out the rest.
    const per = new Map(), res = []
    for (const p of out) { const n = per.get(p.docId) || 0; if (n >= 2) continue; per.set(p.docId, n + 1); res.push(p); if (res.length >= k) break }
    return res.map(({ tf, ...p }) => p)
  }
}

function cosine(a, b) { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i] } return x && y ? d / Math.sqrt(x * y) : 0 }
