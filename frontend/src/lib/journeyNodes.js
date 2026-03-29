// Kernrechtsgebiete mapped to a 3D helix path
export const KERN = [
  { id: 'einkommensteuer', label: 'Steuerrecht', sub: 'EStG · KStG · UStG · BAO' },
  { id: 'zivilrecht', label: 'Bürgerliches Recht', sub: 'ABGB · MRG · WEG' },
  { id: 'handelsrecht', label: 'Unternehmensrecht', sub: 'UGB · GewO · UWG' },
  { id: 'gmbh_recht', label: 'Gesellschaftsrecht', sub: 'GmbHG · AktG · GenG' },
  { id: 'bankrecht', label: 'Kapitalmarktrecht', sub: 'BWG · WAG · BaSAG' },
  { id: 'wertpapierrecht', label: 'Wertpapierrecht', sub: 'BörseG · DepotG' },
  { id: 'zivilprozess', label: 'Zivilverfahren', sub: 'ZPO · JN · EO' },
  { id: 'vergaberecht', label: 'Vergaberecht', sub: 'BVergG' },
  { id: 'verwaltungsverfahren', label: 'Verwaltungsrecht', sub: 'AVG · VwGVG · VStG' },
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
