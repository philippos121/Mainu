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

// Parse GPT markdown into findings
export function parseFindings(md) {
  if (!md) return []
  const parts = md.split(/(?=^#{2,3}\s)/m).filter(s => s.trim())
  return parts.map(s => {
    const lines = s.split('\n')
    const title = lines[0].replace(/^#+\s*/, '').trim()
    const body = lines.slice(1).join('\n').trim()
    return { title, body }
  }).filter(f => f.title && f.body)
}
