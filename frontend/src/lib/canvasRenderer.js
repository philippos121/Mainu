// 3D neural network — fly through node-to-node, report findings as 3D nodes
import { KERN } from './journeyNodes.js'

export function createRenderer(canvas, slideLabels) {
  const gl = canvas.getContext('2d', { alpha: false })
  let W = 0, H = 0
  const isMobile = window.innerWidth < 640
  const N = isMobile ? 50 : 90
  const DSQ = isMobile ? 320*320 : 220*220

  const ax=new Float32Array(N),ay=new Float32Array(N),az=new Float32Array(N)
  const dx=new Float32Array(N),dy=new Float32Array(N),dz=new Float32Array(N)
  const sr=new Float32Array(N)
  const ox=new Float32Array(N),oy=new Float32Array(N),os=new Float32Array(N)

  const TUNNEL_DEPTH = 1.8
  let allNodes = []
  let totalNodes = 0
  // Pre-wrapped text cache: key = nodeIndex, value = {lines, wrapWidth, font}
  const wrapCache = new Map()

  // Load logo image
  const logoImg = new Image()
  logoImg.src = '/logo.svg'
  let logoLoaded = false
  logoImg.onload = () => { logoLoaded = true }

  function buildIntroNodes() {
    const nodes = []
    const count = 2 + KERN.length
    for(let i=0;i<count;i++){
      const t = i / (count - 1)
      const a = t * Math.PI * 2.5
      nodes.push({
        x: 0.7 * Math.sin(a),
        y: 0.25 * Math.cos(a * 1.3),
        z: i * TUNNEL_DEPTH,
        label: slideLabels ? slideLabels[i] || '' : '',
        isLogo: i === 0,
        isReport: false
      })
    }
    return nodes
  }

  function rebuildNodes(reportFindings) {
    wrapCache.clear()
    const intro = buildIntroNodes()
    const lastZ = intro.length ? intro[intro.length-1].z + TUNNEL_DEPTH : 0
    const findings = (reportFindings || []).filter(f => f.title || f.body)
    const report = findings.map((r, i) => {
      const a = (i / Math.max(1, findings.length - 1)) * Math.PI * 2
      return {
        x: 0.5 * Math.sin(a + 1),
        y: 0.2 * Math.cos(a * 0.8),
        z: lastZ + (i + 1) * TUNNEL_DEPTH,
        label: r.title || 'Ergebnis',
        body: r.body || '',
        isLogo: false,
        isReport: true
      }
    })
    allNodes = [...intro, ...report]
    totalNodes = allNodes.length
    redistributeParticles()
  }

  function redistributeParticles() {
    const maxZ = totalNodes * TUNNEL_DEPTH + 4
    for(let i=0;i<N;i++){
      ax[i]=Math.random()*4-2
      ay[i]=Math.random()*4-2
      az[i]=Math.random()*(maxZ+4) - 2
      const speed = isMobile ? 2.5 : 1
      dx[i]=(Math.random()-.5)*.001*speed
      dy[i]=(Math.random()-.5)*.001*speed
      dz[i]=(Math.random()-.5)*.0008*speed
      sr[i]=1.2+Math.random()*1.8
    }
  }

  rebuildNodes([])

  let lastScrollY = 0, lastProgress = 0, initialized = false

  function resize(){
    W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight
    wrapCache.clear()  // re-wrap on resize
    if(initialized) render(lastScrollY, false, lastProgress)
  }
  resize();window.addEventListener('resize',resize)

  // Wrap text once and cache it at a fixed width (not dependent on zoom)
  function getCachedWrap(nodeIdx, text, fixedWidth) {
    const key = nodeIdx + ':' + fixedWidth
    if(wrapCache.has(key)) return wrapCache.get(key)
    // Measure at a fixed reference font size
    gl.font = '300 13px -apple-system, "Segoe UI", sans-serif'
    const words = text.split(' ')
    const lines = []
    let line = ''
    for(const w of words) {
      const test = line ? line + ' ' + w : w
      if(gl.measureText(test).width > fixedWidth && line) {
        lines.push(line)
        line = w
      } else { line = test }
    }
    if(line) lines.push(line)
    wrapCache.set(key, lines)
    return lines
  }

  function render(scrollY, moving, progress){
    initialized = true
    lastScrollY = scrollY
    if(progress !== undefined) lastProgress = progress
    const mobile = W < 640
    const hw=W/2,hh=H/2
    if(!totalNodes) return

    const sp = Math.max(0, Math.min(totalNodes - 1, progress || 0))
    const idx0 = Math.min(Math.floor(sp), totalNodes - 1)
    const idx1 = Math.min(idx0 + 1, totalNodes - 1)
    const frac = sp - idx0
    const n0 = allNodes[idx0], n1 = allNodes[idx1]
    const camX = n0.x + (n1.x - n0.x) * frac
    const camY = n0.y + (n1.y - n0.y) * frac
    const camZ = (n0.z + (n1.z - n0.z) * frac) - 0.5

    const maxZ = totalNodes * TUNNEL_DEPTH + 4
    if(moving){for(let i=0;i<N;i++){
      ax[i]+=dx[i];ay[i]+=dy[i];az[i]+=dz[i]
      if(ax[i]>2||ax[i]<-2)dx[i]*=-1
      if(ay[i]>2||ay[i]<-2)dy[i]*=-1
      if(az[i]>maxZ||az[i]<-2)dz[i]*=-1
    }}

    const nodeScreenY = H * (mobile ? 0.38 : 0.40)
    const spreadX = mobile ? .55 : .42
    const spreadY = mobile ? .45 : .35

    function project(px, py, pz) {
      const rx = px - camX, ry = py - camY, rz = pz - camZ
      const depth = 1.5 + rz
      if(depth < 0.15) return null
      const s = 2.5 / depth
      return { x: hw + rx * W * spreadX * s, y: nodeScreenY + ry * H * spreadY * s, s, depth }
    }

    const fadeX = hw, fadeY = H * 0.52
    const fadeR = mobile ? W * 0.42 : W * 0.2
    function textFade(sx, sy) {
      const ddx = (sx - fadeX) / fadeR, ddy = (sy - fadeY) / (fadeR * 1.3)
      const d = ddx*ddx + ddy*ddy
      return Math.min(1, Math.max(0, d - 0.15) / 0.85)
    }

    gl.fillStyle='#fafbfc'
    gl.fillRect(0,0,W,H)

    // Project particles
    for(let i=0;i<N;i++){
      const p = project(ax[i], ay[i], az[i])
      if(!p) { ox[i]=-999; continue }
      ox[i]=p.x; oy[i]=p.y; os[i]=p.s
    }

    // Background connections
    const lineBase = mobile ? 0.025 : 0.05
    const lineMax = mobile ? 0.12 : 0.2
    gl.lineWidth = mobile ? 0.9 : 1.2
    for(let i=0;i<N;i++){for(let j=i+1;j<N;j++){
      if(ox[i]<-900||ox[j]<-900) continue
      const a=ox[i]-ox[j],b=oy[i]-oy[j]
      if(a*a+b*b<DSQ){
        const mx=(ox[i]+ox[j])/2,my=(oy[i]+oy[j])/2
        const f=textFade(mx,my)
        const depthA = Math.min(1, (os[i]+os[j]) * 0.65)
        const alpha=(lineBase+lineMax*f)*depthA
        if(alpha < 0.004) continue
        gl.beginPath()
        gl.strokeStyle=`rgba(0,0,0,${alpha.toFixed(3)})`
        gl.moveTo(ox[i],oy[i]);gl.lineTo(ox[j],oy[j])
        gl.stroke()
      }
    }}

    // Draw nodes with labels
    for(let i=0;i<totalNodes;i++){
      const nd = allNodes[i]
      const p = project(nd.x, nd.y, nd.z)
      if(!p) continue

      const dist = Math.abs(i - sp)
      const isActive = dist < 0.5
      const nearness = 1 - Math.min(1, dist / 3)

      // Connection to previous
      if(i > 0) {
        const pp = project(allNodes[i-1].x, allNodes[i-1].y, allNodes[i-1].z)
        if(pp) {
          const la = 0.06 + 0.12 * nearness
          gl.beginPath()
          gl.strokeStyle = `rgba(0,121,147,${la.toFixed(3)})`
          gl.lineWidth = mobile ? 1.5 : 2
          gl.moveTo(pp.x, pp.y); gl.lineTo(p.x, p.y)
          gl.stroke()
        }
      }

      // Node dot
      const baseR = (mobile ? 5 : 7) * p.s
      const r = isActive ? baseR * 2 : baseR * (0.5 + nearness * 0.5)
      const nodeA = isActive ? 0.9 : 0.12 + nearness * 0.35

      if(isActive) {
        gl.beginPath();gl.arc(p.x, p.y, r*3.5, 0, 6.28)
        gl.fillStyle=`rgba(0,121,147,${(0.05 * p.s).toFixed(3)})`
        gl.fill()
      }
      gl.beginPath();gl.arc(p.x, p.y, r*2, 0, 6.28)
      gl.fillStyle=`rgba(255,151,51,${(nodeA*0.1).toFixed(3)})`
      gl.fill()
      gl.beginPath();gl.arc(p.x, p.y, r, 0, 6.28)
      gl.fillStyle = isActive
        ? `rgba(0,121,147,${nodeA.toFixed(3)})`
        : `rgba(255,130,30,${nodeA.toFixed(3)})`
      gl.fill()

      // Logo at first node
      if(nd.isLogo && logoLoaded) {
        const lh = Math.max(16, 48 * p.s)
        const lw = lh * (logoImg.width / logoImg.height || 3)
        const la = isActive ? 0.95 : Math.min(0.6, nearness * 0.7)
        if(la > 0.05) {
          gl.globalAlpha = la
          gl.drawImage(logoImg, p.x - lw/2, p.y + r + 4, lw, lh)
          gl.globalAlpha = 1
        }
        continue  // no text label for logo
      }

      // Label text — always light weight, fixed font size steps to prevent jitter
      const label = nd.label || ''
      if(!label || p.s < 0.12) continue
      // Snap font size to integer to prevent sub-pixel jitter
      const rawSize = (mobile ? 16 : 20) * p.s
      const fontSize = Math.round(Math.max(7, Math.min(mobile ? 26 : 32, rawSize)))
      const textA = isActive ? 0.9 : Math.min(0.6, nearness * 0.7)
      if(textA < 0.02) continue

      const textY = p.y + r + fontSize * 0.6
      gl.font = `300 ${fontSize}px -apple-system, "Segoe UI", sans-serif`
      gl.textAlign = 'center'
      gl.textBaseline = 'top'
      gl.fillStyle = `rgba(20,50,65,${textA.toFixed(2)})`
      gl.fillText(label, p.x, textY)

      // Report body preview — fixed wrap width, cached lines
      if(nd.isReport && nd.body && isActive) {
        const bodySize = Math.round(Math.max(9, fontSize * 0.52))
        const bodyPreview = nd.body.length > 220 ? nd.body.slice(0, 220) + '…' : nd.body
        // Fixed wrap width based on screen, NOT zoom — prevents line reflow
        const fixedWrapPx = mobile ? W * 0.85 : W * 0.4
        const lines = getCachedWrap(i, bodyPreview, fixedWrapPx)
        gl.font = `300 ${bodySize}px -apple-system, "Segoe UI", sans-serif`
        gl.fillStyle = `rgba(30,60,80,0.6)`
        let ly = textY + fontSize * 1.1
        for(let li=0; li<Math.min(lines.length, 6); li++) {
          gl.fillText(lines[li], p.x, ly)
          ly += bodySize * 1.4
        }
      }

      // Number badge for KERN nodes
      if(!nd.isReport && i >= 2) {
        const ns = Math.round(Math.max(6, fontSize * 0.35))
        gl.font = `500 ${ns}px -apple-system, "Segoe UI", sans-serif`
        gl.fillStyle = `rgba(0,121,147,${(textA * 0.45).toFixed(2)})`
        gl.fillText(String(i - 1).padStart(2, '0'), p.x, p.y - r - ns * 1.2)
      }
    }

    // Background particle dots
    const glowMul = mobile ? 0.5 : 0.9
    const coreMul = mobile ? 0.6 : 0.9
    for(let i=0;i<N;i++){
      if(ox[i]<-900) continue
      const r=sr[i]*os[i]*0.8, a=.2+os[i]*.35
      const f=textFade(ox[i],oy[i])
      const fa = a * Math.max(0.15, f)
      gl.beginPath();gl.arc(ox[i],oy[i],r*2.5,0,6.28)
      gl.fillStyle=`rgba(255,151,51,${(fa*0.06*glowMul).toFixed(3)})`
      gl.fill()
      gl.beginPath();gl.arc(ox[i],oy[i],r,0,6.28)
      gl.fillStyle=`rgba(255,130,30,${(fa*0.5*coreMul).toFixed(3)})`
      gl.fill()
    }
  }

  function setReportFindings(findings) {
    rebuildNodes(findings)
  }
  function getNodeCount() { return totalNodes }
  function destroy(){window.removeEventListener('resize',resize)}
  return { render, resize, destroy, setReportFindings, getNodeCount }
}
