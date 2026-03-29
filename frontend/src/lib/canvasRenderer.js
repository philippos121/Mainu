import { KERN, helix } from './journeyNodes.js'

// Create a canvas renderer that only draws when called
export function createRenderer(canvas) {
  const gl = canvas.getContext('2d', { alpha: false })
  let W = 0, H = 0

  // Ambient particles — large network
  const N = 90
  const DSQ = 180 * 180
  const ax = new Float32Array(N), ay = new Float32Array(N), az = new Float32Array(N)
  const dx = new Float32Array(N), dy = new Float32Array(N), dz = new Float32Array(N)
  const sr = new Float32Array(N), sh = new Uint8Array(N)
  const ox = new Float32Array(N), oy = new Float32Array(N), os = new Float32Array(N)

  for (let i = 0; i < N; i++) {
    ax[i] = Math.random() * 3.2 - 1.6
    ay[i] = Math.random() * 3.2 - 1.6
    az[i] = Math.random() * 3.2 - 1.6
    dx[i] = (Math.random() - .5) * .0008
    dy[i] = (Math.random() - .5) * .0008
    dz[i] = (Math.random() - .5) * .0006
    sr[i] = 1 + Math.random() * 1.5
    sh[i] = Math.random() > .8 ? 1 : 0
  }

  // Named node positions (Kern or findings)
  let namedNodes = KERN.map((k, i) => {
    const p = helix(i / (KERN.length - 1))
    return { ...k, x: p.x, y: p.y, z: p.z }
  })

  function resize() {
    W = canvas.width = window.innerWidth
    H = canvas.height = window.innerHeight
  }
  resize()
  window.addEventListener('resize', resize)

  // Project 3D → 2D with camera offset
  function proj(x, y, z, camX, camY, camZ, rotY, rotX) {
    // Translate relative to camera
    let rx = x - camX, ry = y - camY, rz = z - camZ
    // Rotate Y
    const cy = Math.cos(rotY), siny = Math.sin(rotY)
    const rx2 = rx * cy - rz * siny
    rz = rx * siny + rz * cy
    rx = rx2
    // Rotate X
    const cx = Math.cos(rotX), sinx = Math.sin(rotX)
    const ry2 = ry * cx - rz * sinx
    rz = ry * sinx + rz * cx
    ry = ry2
    // Perspective
    const s = 3 / (3 + rz + 2)
    return { sx: W / 2 + rx * W * .35 * s, sy: H / 2 + ry * H * .3 * s, s, z: rz }
  }

  function render(scrollY, moving, journeyT, activeIdx, activeFrac) {
    // Camera position: follows helix during journey
    let camX = 0, camY = 0, camZ = -2
    let rotY = scrollY * .00015, rotX = scrollY * .0001

    if (journeyT > 0 && journeyT <= 1) {
      // Flying through the helix
      const cp = helix(journeyT)
      camX = cp.x * .3
      camY = cp.y * .3
      camZ = cp.z * .3 - 1.5
      rotY = journeyT * Math.PI * .5
      rotX = journeyT * .2
    }

    // Move ambient particles only when scrolling
    if (moving) {
      for (let i = 0; i < N; i++) {
        ax[i] += dx[i]; ay[i] += dy[i]; az[i] += dz[i]
        if (ax[i] > 1.3 || ax[i] < -1.3) dx[i] *= -1
        if (ay[i] > 1.3 || ay[i] < -1.3) dy[i] *= -1
        if (az[i] > 1.3 || az[i] < -1.3) dz[i] *= -1
      }
    }

    // Project ambient
    for (let i = 0; i < N; i++) {
      const p = proj(ax[i], ay[i], az[i], camX, camY, camZ, rotY, rotX)
      ox[i] = p.sx; oy[i] = p.sy; os[i] = p.s
    }

    // Clear
    gl.fillStyle = '#070e12'
    gl.fillRect(0, 0, W, H)

    // Connections (ambient only)
    gl.beginPath()
    gl.strokeStyle = 'rgba(34,201,232,0.06)'
    gl.lineWidth = .5
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = ox[i] - ox[j], b = oy[i] - oy[j]
        if (a * a + b * b < DSQ) { gl.moveTo(ox[i], oy[i]); gl.lineTo(ox[j], oy[j]) }
      }
    }
    gl.stroke()

    // Ambient nodes
    for (let i = 0; i < N; i++) {
      const r = sr[i] * os[i], a = .2 + os[i] * .4
      gl.beginPath(); gl.arc(ox[i], oy[i], r, 0, 6.28)
      gl.fillStyle = sh[i] ? `rgba(255,151,51,${a * .5})` : `rgba(34,201,232,${a * .35})`
      gl.fill()
    }

    // Named nodes (Kernrechtsgebiete or findings)
    const projected = []
    for (let i = 0; i < namedNodes.length; i++) {
      const n = namedNodes[i]
      const p = proj(n.x, n.y, n.z, camX, camY, camZ, rotY, rotX)
      projected.push({ ...p, i })
    }
    projected.sort((a, b) => a.z - b.z)

    for (const p of projected) {
      const isActive = p.i === activeIdx
      const nearActive = Math.abs(p.i - activeIdx) <= 1
      const baseR = isActive ? 6 : nearActive ? 4 : 2.5
      const r = baseR * p.s
      const a = isActive ? 1 : nearActive ? .6 : .25

      // Glow
      gl.beginPath(); gl.arc(p.sx, p.sy, r * 4, 0, 6.28)
      gl.fillStyle = isActive
        ? `rgba(255,151,51,${a * .12})`
        : `rgba(34,201,232,${a * .06})`
      gl.fill()

      // Core
      gl.beginPath(); gl.arc(p.sx, p.sy, r, 0, 6.28)
      gl.fillStyle = isActive
        ? `rgba(255,151,51,${a * .9})`
        : `rgba(34,201,232,${a * .6})`
      gl.fill()

      // Connection lines from active to neighbors
      if (isActive && journeyT > 0) {
        for (const q of projected) {
          if (q.i !== p.i && Math.abs(q.i - p.i) <= 2) {
            gl.beginPath()
            gl.moveTo(p.sx, p.sy); gl.lineTo(q.sx, q.sy)
            gl.strokeStyle = `rgba(255,151,51,${.08 * activeFrac})`
            gl.lineWidth = 1
            gl.stroke()
          }
        }
      }
    }

    // Return active node screen position for label placement
    const an = projected.find(p => p.i === activeIdx)
    return an ? { x: an.sx, y: an.sy } : null
  }

  function setNodes(nodes) {
    namedNodes = nodes
  }

  function destroy() {
    window.removeEventListener('resize', resize)
  }

  return { render, resize, destroy, setNodes }
}
