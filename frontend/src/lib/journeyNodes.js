// Kernrechtsgebiete mapped to a 3D helix path
export const KERN = [
  { id: 'einkommensteuer', label: 'Steuerrecht' },
  { id: 'zivilrecht', label: 'Bürgerliches Recht' },
  { id: 'handelsrecht', label: 'Unternehmensrecht' },
  { id: 'gmbh_recht', label: 'Gesellschaftsrecht' },
  { id: 'bankrecht', label: 'Kapitalmarktrecht' },
  { id: 'wertpapierrecht', label: 'Wertpapierrecht' },
  { id: 'zivilprozess', label: 'Zivilverfahren' },
  { id: 'verfassungsrecht', label: 'Verfassungsrecht' },
  { id: 'verwaltungsverfahren', label: 'Verwaltungsrecht' },
]

// Position on helix: t in [0,1] → {x,y,z} in [-1,1]
export function helix(t) {
  const a = t * Math.PI * 2
  return { x: 0.55 * Math.cos(a), y: -1 + t * 2, z: 0.55 * Math.sin(a) }
}

// Which node is active given scroll position
export function activeNode(scrollY, start, end) {
  const t = Math.max(0, Math.min(1, (scrollY - start) / (end - start)))
  const continuous = t * (KERN.length - 1)
  const index = Math.round(continuous)
  const frac = 1 - Math.min(Math.abs(continuous - index), 0.5) * 2 // 0..1 peak at center
  return { t, index, frac, continuous }
}

// Parse GPT markdown into slides — each finding split into title + paragraph chunks
export function parseFindings(md) {
  if (!md) return []
  const parts = md.split(/(?=^#{2,3}\s)/m).filter(s => s.trim())
  const slides = []
  for (const s of parts) {
    const lines = s.split('\n')
    const title = lines[0].replace(/^#+\s*/, '').trim()
    const body = lines.slice(1).join('\n').trim()
    if (!title || !body) continue
    // Split body into paragraphs (by double newline or bullet groups)
    const paras = body.split(/\n\n+/).filter(p => p.trim())
    if (paras.length <= 1) {
      // Single paragraph — split into ~250 char chunks at sentence boundaries
      const chunks = splitSentences(body, 250)
      for (let i = 0; i < chunks.length; i++) {
        slides.push({ title: i === 0 ? title : '', body: chunks[i] })
      }
    } else {
      // Multiple paragraphs — one slide per paragraph
      for (let i = 0; i < paras.length; i++) {
        slides.push({ title: i === 0 ? title : '', body: paras[i].trim() })
      }
    }
  }
  return slides.length ? slides : [{ title: 'Analyse', body: md.slice(0, 300) }]
}

function splitSentences(text, maxLen) {
  const sentences = text.split(/(?<=[.!?])\s+/)
  const chunks = []
  let current = ''
  for (const s of sentences) {
    if (current && (current + ' ' + s).length > maxLen) {
      chunks.push(current.trim())
      current = s
    } else {
      current = current ? current + ' ' + s : s
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.length ? chunks : [text.slice(0, maxLen)]
}
