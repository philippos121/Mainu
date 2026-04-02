// 3D neural network — cinematic intro rotation + dark fly-through
import { KERN } from './journeyNodes.js'

const INTRO_COUNT = 2  // logo + "Legal Monitoring" before fly-through starts

export { INTRO_COUNT }

export function createRenderer(canvas, slideLabels) {
  const gl = canvas.getContext('2d', { alpha: false })
  let W = 0, H = 0
  const isMobile = window.innerWidth < 640
  const N = isMobile ? 35 : 65
  const DSQ = isMobile ? 260*260 : 180*180

  // Particles in world space
  const ax=new Float32Array(N),ay=new Float32Array(N),az=new Float32Array(N)
  const dx=new Float32Array(N),dy=new Float32Array(N),dz=new Float32Array(N)
  const sr=new Float32Array(N)
  const ox=new Float32Array(N),oy=new Float32Array(N),os=new Float32Array(N)

  // Speed streaks (small fast particles during fly)
  const SN = isMobile ? 12 : 25
  const sx=new Float32Array(SN),sy=new Float32Array(SN),sz=new Float32Array(SN)

  const TUNNEL_DEPTH = 1.8
  let allNodes = []
  let totalNodes = 0
  let frameCount = 0

  const FONT = '-apple-system,"Segoe UI",sans-serif'

  // Color palette
  const BG_LIGHT = [250, 251, 252]  // #fafbfc
  const BG_DARK  = [8, 18, 36]      // #081224
  const TEAL     = [0, 200, 170]     // #00c8aa — connections
  const GOLD     = [255, 170, 40]    // #ffaa28 — particles
  const CYAN     = [0, 220, 200]     // #00dcc8 — active glow
  const NODE_HI  = [0, 200, 220]     // #00c8dc — active node
  const NODE_LO  = [255, 140, 50]    // #ff8c32 — inactive node

  function lerp(a, b, t) { return a + (b - a) * t }
  function lerpColor(c1, c2, t) {
    return [lerp(c1[0],c2[0],t)|0, lerp(c1[1],c2[1],t)|0, lerp(c1[2],c2[2],t)|0]
  }

  function initParticles() {
    for(let i=0;i<N;i++){
      ax[i]=Math.random()*3.2-1.6
      ay[i]=Math.random()*3.2-1.6
      az[i]=Math.random()*6-3
      const speed = isMobile ? 2.5 : 1
      dx[i]=(Math.random()-.5)*.001*speed
      dy[i]=(Math.random()-.5)*.001*speed
      dz[i]=(Math.random()-.5)*.0008*speed
      sr[i]=1.2+Math.random()*1.8
    }
    for(let i=0;i<SN;i++){
      sx[i]=(Math.random()-.5)*3
      sy[i]=(Math.random()-.5)*3
      sz[i]=Math.random()*8
    }
  }

  function buildFlyNodes() {
    const nodes = []
    for(let i=0;i<KERN.length;i++){
      const t = i / (KERN.length - 1)
      const a = t * Math.PI * 2.5
      const sway = i === 0 ? 0 : 1
      nodes.push({
        x: 0.7 * Math.sin(a) * sway,
        y: 0.25 * Math.cos(a * 1.3) * sway,
        z: i * TUNNEL_DEPTH,
        label: slideLabels ? slideLabels[i] || '' : '',
        isReport: false
      })
    }
    return nodes
  }

  function rebuildNodes(reportFindings) {
    const fly = buildFlyNodes()
    const lastZ = fly.length ? fly[fly.length-1].z + TUNNEL_DEPTH : 0
    const findings = (reportFindings || []).filter(f => {
      const t = (f.title || '').trim()
      const b = (f.body || '').trim()
      return t.length > 0 || b.length > 2
    })
    const report = findings.map((r, i) => {
      const a = (i / Math.max(1, findings.length - 1)) * Math.PI * 2
      return {
        x: 0.5 * Math.sin(a + 1),
        y: 0.2 * Math.cos(a * 0.8),
        z: lastZ + (i + 1) * TUNNEL_DEPTH,
        label: (r.title || '').trim() || 'Ergebnis',
        body: (r.body || '').trim(),
        isReport: true
      }
    })
    allNodes = [...fly, ...report]
    totalNodes = allNodes.length
  }

  initParticles()
  rebuildNodes([])

  let lastScrollY = 0, lastProgress = 0, initialized = false

  function resize(){
    W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight
    if(initialized) render(lastScrollY, false, lastProgress)
  }
  resize();window.addEventListener('resize',resize)

  function render(scrollY, moving, progress){
    initialized = true
    lastScrollY = scrollY
    if(progress !== undefined) lastProgress = progress
    frameCount++
    const mobile = W < 640
    const hw=W/2, hh=H/2
    let activeReport = null

    const flyProgress = Math.max(0, progress - INTRO_COUNT)
    const blend = Math.min(1, flyProgress / 1.5)

    // Background: light → dark transition
    const bg = lerpColor(BG_LIGHT, BG_DARK, blend)
    gl.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`
    gl.fillRect(0,0,W,H)

    // Subtle radial vignette during fly
    if(blend > 0.01) {
      const vg = gl.createRadialGradient(hw, hh, 0, hw, hh, Math.max(W,H)*0.7)
      vg.addColorStop(0, `rgba(${bg[0]},${bg[1]},${bg[2]},0)`)
      vg.addColorStop(1, `rgba(0,0,0,${(0.3*blend).toFixed(2)})`)
      gl.fillStyle = vg
      gl.fillRect(0,0,W,H)
    }

    // --- Camera position ---
    let camX = 0, camY = 0, camZ = 0
    if(flyProgress > 0 && totalNodes > 0) {
      const sp = Math.min(totalNodes - 1, flyProgress)
      const idx0 = Math.min(Math.floor(sp), totalNodes - 1)
      const idx1 = Math.min(idx0 + 1, totalNodes - 1)
      const frac = sp - idx0
      const n0 = allNodes[idx0], n1 = allNodes[idx1]
      camX = (n0.x + (n1.x - n0.x) * frac) * blend
      camY = (n0.y + (n1.y - n0.y) * frac) * blend
      camZ = (n0.z + (n1.z - n0.z) * frac) * blend
    }

    // --- Particle movement + recycling ---
    const WRAP_BEHIND = 3, WRAP_AHEAD = 6
    if(moving){
      for(let i=0;i<N;i++){
        ax[i]+=dx[i];ay[i]+=dy[i];az[i]+=dz[i]
        if(ax[i]>1.6||ax[i]<-1.6)dx[i]*=-1
        if(ay[i]>1.6||ay[i]<-1.6)dy[i]*=-1
        if(blend > 0.01) {
          if(az[i] < camZ - WRAP_BEHIND) {
            az[i] = camZ + WRAP_BEHIND + Math.random() * WRAP_AHEAD
            ax[i] = (Math.random() * 3.2 - 1.6)
            ay[i] = (Math.random() * 3.2 - 1.6)
          } else if(az[i] > camZ + WRAP_BEHIND + WRAP_AHEAD) {
            az[i] = camZ - WRAP_BEHIND + Math.random() * 0.5
            ax[i] = (Math.random() * 3.2 - 1.6)
            ay[i] = (Math.random() * 3.2 - 1.6)
          }
        } else {
          if(az[i]>3||az[i]<-3)dz[i]*=-1
        }
      }
    }

    // --- Intro rotation (fades out as fly begins) ---
    const rotSpeed = mobile ? 2.5 : 1
    const rot = scrollY * 0.00015 * rotSpeed * (1 - blend)
    const cy = Math.cos(rot), sn = Math.sin(rot)

    // Screen center shifts slightly during fly
    const flyTargetY = mobile ? 0.42 : 0.44
    const screenCY = H * (0.5 + (flyTargetY - 0.5) * blend)

    // --- Particle projection ---
    const pSpreadX = mobile ? .55 : .36
    const pSpreadY = mobile ? .45 : .30
    const fadeX = hw, fadeY = hh
    const fadeR = mobile ? W * 0.45 : W * 0.22
    const fadeRY = fadeR * 1.3

    for(let i=0;i<N;i++){
      const x=ax[i],y=ay[i],z=az[i]
      const rx=x*cy-z*sn, rz=x*sn+z*cy
      const depth = 4 + rz - camZ * blend
      if(depth < 0.5) { ox[i]=-999; continue }
      const s = 2.5 / depth
      const projX = (rx - camX * blend) * W * pSpreadX * s
      const projY = (y - camY * blend) * H * pSpreadY * s
      ox[i]=Math.round(hw + projX)
      oy[i]=Math.round(screenCY + projY - (screenCY - hh) * (1 - blend))
      os[i]=s
    }

    // --- Connections (teal glow during fly) ---
    const connColor = lerpColor([0,0,0], TEAL, blend)
    const lineBase = mobile ? 0.02 : 0.04
    const lineMax = mobile ? 0.08 : 0.16
    gl.lineWidth = mobile ? 0.8 : 1.2
    for(let i=0;i<N;i++){for(let j=i+1;j<N;j++){
      if(ox[i]<-900||ox[j]<-900) continue
      const a=ox[i]-ox[j],b=oy[i]-oy[j]
      if(a*a+b*b<DSQ){
        const mx=(ox[i]+ox[j])/2,my=(oy[i]+oy[j])/2
        const ddx=(mx-fadeX)/fadeR, ddy=(my-fadeY)/fadeRY
        const d=ddx*ddx+ddy*ddy
        const f=Math.min(1, Math.max(0, d-0.2)/0.8)
        const depthA=Math.min(1,(os[i]+os[j])*0.7)
        const alpha=(lineBase+lineMax*f)*depthA
        if(alpha<0.004) continue
        gl.beginPath()
        gl.strokeStyle=`rgba(${connColor[0]},${connColor[1]},${connColor[2]},${alpha.toFixed(3)})`
        gl.moveTo(ox[i],oy[i]);gl.lineTo(ox[j],oy[j])
        gl.stroke()
      }
    }}

    // --- Draw tunnel nodes (fly phase) ---
    if(flyProgress > 0) {
      const sp = Math.min(totalNodes - 1, flyProgress)
      const kernCount = KERN.length

      function projectNode(px, py, pz) {
        const ddx = px - camX, ddy = py - camY, ddz = pz - camZ
        const depth = 1.5 + ddz
        if(depth < 0.15) return null
        const s = 2.5 / depth
        return {
          x: Math.round(hw + ddx * W * (mobile?.55:.42) * s),
          y: Math.round(screenCY + ddy * H * (mobile?.45:.35) * s),
          s, depth
        }
      }

      for(let i=0;i<totalNodes;i++){
        const nd = allNodes[i]
        const p = projectNode(nd.x, nd.y, nd.z)
        if(!p) continue

        const dist = Math.abs(i - sp)
        const isActive = dist < 0.5
        const nearness = 1 - Math.min(1, dist / 3)

        const isLastKern = (i === kernCount - 1) && !nd.isReport
        const lastKernFade = isLastKern ? Math.max(0, 1 - Math.max(0, sp - (kernCount - 2.5)) * 2) : 1
        if(lastKernFade < 0.02) continue

        // Connection line to previous node
        if(i > 0) {
          const pp = projectNode(allNodes[i-1].x, allNodes[i-1].y, allNodes[i-1].z)
          if(pp) {
            gl.beginPath()
            gl.strokeStyle=`rgba(${TEAL[0]},${TEAL[1]},${TEAL[2]},${(0.08+0.15*nearness).toFixed(3)})`
            gl.lineWidth = mobile ? 1.5 : 2
            gl.moveTo(pp.x,pp.y); gl.lineTo(p.x,p.y)
            gl.stroke()
          }
        }

        // Node glow + dot
        const baseR = (mobile ? 5 : 7) * p.s
        const r = Math.round(isActive ? baseR*2.2 : baseR*(0.5+nearness*0.5))
        const nodeA = (isActive ? 0.95 : 0.15+nearness*0.4) * blend * lastKernFade

        // Pulsing glow for active nodes
        if(isActive && lastKernFade > 0.1) {
          const pulse = 0.7 + 0.3 * Math.sin(frameCount * 0.04)
          const glowR = r * (3.5 + pulse * 1.5)
          const grd = gl.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR)
          grd.addColorStop(0, `rgba(${CYAN[0]},${CYAN[1]},${CYAN[2]},${(0.12*pulse*blend*lastKernFade).toFixed(3)})`)
          grd.addColorStop(1, `rgba(${CYAN[0]},${CYAN[1]},${CYAN[2]},0)`)
          gl.fillStyle = grd
          gl.fillRect(p.x-glowR, p.y-glowR, glowR*2, glowR*2)
        }

        // Outer glow ring
        gl.beginPath();gl.arc(p.x,p.y,r*2,0,6.28)
        gl.fillStyle=`rgba(${GOLD[0]},${GOLD[1]},${GOLD[2]},${(nodeA*0.08).toFixed(3)})`
        gl.fill()

        // Core dot
        const nc = isActive ? NODE_HI : NODE_LO
        gl.beginPath();gl.arc(p.x,p.y,r,0,6.28)
        gl.fillStyle=`rgba(${nc[0]},${nc[1]},${nc[2]},${nodeA.toFixed(3)})`
        gl.fill()

        // Bright center highlight
        if(isActive) {
          gl.beginPath();gl.arc(p.x,p.y,r*0.4,0,6.28)
          gl.fillStyle=`rgba(255,255,255,${(nodeA*0.6).toFixed(3)})`
          gl.fill()
        }

        // Label (KERN nodes only — report nodes use HTML overlay)
        if(nd.isReport) {
          if(isActive && lastKernFade > 0.1) {
            activeReport = {
              x: p.x, y: p.y, r,
              index: i - kernCount,
              opacity: blend * lastKernFade,
              title: nd.label,
              body: nd.body || ''
            }
          }
          continue
        }

        const label = nd.label
        if(!label || p.s < 0.12) continue
        const fontSize = Math.round(Math.max(8, Math.min(mobile?26:32, (mobile?16:20)*p.s)))
        const textA = (isActive ? 0.95 : Math.min(0.55, nearness*0.65)) * blend * lastKernFade
        if(textA < 0.03) continue

        const textY = Math.round(p.y + r + fontSize*0.6)
        gl.font = `300 ${fontSize}px ${FONT}`
        gl.textAlign = 'center'
        gl.textBaseline = 'top'
        // Text color: dark on light bg, light on dark bg
        const tc = lerpColor([20,50,65], [200,230,240], blend)
        gl.fillStyle = `rgba(${tc[0]},${tc[1]},${tc[2]},${textA.toFixed(2)})`
        gl.fillText(label, p.x, textY)

        // Number badge
        if(!nd.isReport && i < KERN.length) {
          const ns = Math.round(Math.max(7, fontSize*0.35))
          gl.font = `500 ${ns}px ${FONT}`
          gl.fillStyle = `rgba(${TEAL[0]},${TEAL[1]},${TEAL[2]},${(textA*0.5).toFixed(2)})`
          gl.fillText(String(i+1).padStart(2,'0'), p.x, p.y-r-ns*1.2)
        }
      }
    }

    // --- Speed streaks during fly ---
    if(blend > 0.1) {
      const streakA = Math.min(0.15, blend * 0.15)
      for(let i=0;i<SN;i++){
        sz[i] -= 0.12 * blend
        if(sz[i] < -1) {
          sz[i] = 4 + Math.random() * 6
          sx[i] = (Math.random() - 0.5) * 3.5
          sy[i] = (Math.random() - 0.5) * 3.5
        }
        const depth = 1 + sz[i]
        if(depth < 0.3) continue
        const s = 2 / depth
        const px = hw + sx[i] * W * 0.3 * s
        const py = hh + sy[i] * H * 0.25 * s
        const len = Math.min(30, 4 + 20 * blend / depth)
        const a = streakA * Math.min(1, sz[i] / 3)
        gl.beginPath()
        gl.strokeStyle = `rgba(${TEAL[0]},${TEAL[1]},${TEAL[2]},${a.toFixed(3)})`
        gl.lineWidth = mobile ? 0.5 : 0.8
        gl.moveTo(px, py)
        gl.lineTo(px, py + len)
        gl.stroke()
      }
    }

    // --- Particle dots (glow effect) ---
    for(let i=0;i<N;i++){
      if(ox[i]<-900) continue
      const r=sr[i]*os[i],a=.2+os[i]*.45
      const ddx=(ox[i]-fadeX)/fadeR, ddy=(oy[i]-fadeY)/fadeRY
      const d=ddx*ddx+ddy*ddy
      const f=Math.min(1,Math.max(0,d-0.2)/0.8)
      const fa=a*Math.max(0.15,f)

      // Outer glow (radial gradient during fly, flat otherwise)
      if(blend > 0.3 && r > 1.5) {
        const gr = r * 3.5
        const grd = gl.createRadialGradient(ox[i],oy[i],0,ox[i],oy[i],gr)
        grd.addColorStop(0, `rgba(${GOLD[0]},${GOLD[1]},${GOLD[2]},${(fa*0.06).toFixed(3)})`)
        grd.addColorStop(1, `rgba(${GOLD[0]},${GOLD[1]},${GOLD[2]},0)`)
        gl.fillStyle = grd
        gl.fillRect(ox[i]-gr, oy[i]-gr, gr*2, gr*2)
      } else {
        gl.beginPath();gl.arc(ox[i],oy[i],r*3,0,6.28)
        gl.fillStyle=`rgba(${GOLD[0]},${GOLD[1]},${GOLD[2]},${(fa*0.02).toFixed(3)})`
        gl.fill()
      }

      // Core particle
      gl.beginPath();gl.arc(ox[i],oy[i],r,0,6.28)
      const pc = lerpColor(NODE_LO, GOLD, blend)
      gl.fillStyle=`rgba(${pc[0]},${pc[1]},${pc[2]},${(fa*0.5).toFixed(3)})`
      gl.fill()

      // Bright center
      if(r > 1.2) {
        gl.beginPath();gl.arc(ox[i],oy[i],r*0.35,0,6.28)
        gl.fillStyle=`rgba(255,255,255,${(fa*0.2*blend).toFixed(3)})`
        gl.fill()
      }
    }

    return activeReport
  }

  function setReportFindings(findings) { rebuildNodes(findings) }
  function getNodeCount() { return totalNodes + INTRO_COUNT }
  function destroy(){window.removeEventListener('resize',resize)}
  return { render, resize, destroy, setReportFindings, getNodeCount }
}
