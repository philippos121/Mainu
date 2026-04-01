// 3D neural network — intro rotation, then fly through nodes
import { KERN } from './journeyNodes.js'

const INTRO_COUNT = 2  // logo + "Legal Monitoring" before fly-through starts

export { INTRO_COUNT }

export function createRenderer(canvas, slideLabels) {
  const gl = canvas.getContext('2d', { alpha: false })
  let W = 0, H = 0
  const isMobile = window.innerWidth < 640
  const N = isMobile ? 30 : 55
  const DSQ = isMobile ? 280*280 : 200*200

  const ax=new Float32Array(N),ay=new Float32Array(N),az=new Float32Array(N)
  const dx=new Float32Array(N),dy=new Float32Array(N),dz=new Float32Array(N)
  const sr=new Float32Array(N)
  const ox=new Float32Array(N),oy=new Float32Array(N),os=new Float32Array(N)

  const TUNNEL_DEPTH = 1.8
  let allNodes = []  // only KERN + report nodes (no intro placeholders)
  let totalNodes = 0

  const FONT = '-apple-system,"Segoe UI",sans-serif'

  // Intro particles — spread in a sphere, no tunnel
  function initIntroParticles() {
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
  }

  function buildFlyNodes() {
    const nodes = []
    for(let i=0;i<KERN.length;i++){
      const t = i / (KERN.length - 1)
      const a = t * Math.PI * 2.5
      nodes.push({
        x: 0.7 * Math.sin(a),
        y: 0.25 * Math.cos(a * 1.3),
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
        isReport: true
      }
    })
    allNodes = [...fly, ...report]
    totalNodes = allNodes.length
  }

  initIntroParticles()
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
    const mobile = W < 640
    const hw=W/2, hh=H/2

    const isIntro = progress < INTRO_COUNT
    const flyProgress = Math.max(0, progress - INTRO_COUNT)

    gl.fillStyle='#fafbfc'
    gl.fillRect(0,0,W,H)

    // --- Particle movement ---
    if(moving){
      if(isIntro) {
        for(let i=0;i<N;i++){
          ax[i]+=dx[i];ay[i]+=dy[i];az[i]+=dz[i]
          if(ax[i]>1.6||ax[i]<-1.6)dx[i]*=-1
          if(ay[i]>1.6||ay[i]<-1.6)dy[i]*=-1
          if(az[i]>3||az[i]<-3)dz[i]*=-1
        }
      } else {
        const maxZ = totalNodes * TUNNEL_DEPTH + 4
        for(let i=0;i<N;i++){
          ax[i]+=dx[i];ay[i]+=dy[i];az[i]+=dz[i]
          if(ax[i]>2||ax[i]<-2)dx[i]*=-1
          if(ay[i]>2||ay[i]<-2)dy[i]*=-1
          if(az[i]>maxZ||az[i]<-2)dz[i]*=-1
        }
      }
    }

    // --- INTRO PHASE: rotating net, camera at center ---
    if(isIntro) {
      const rotSpeed = mobile ? 2.5 : 1
      const ry = scrollY * 0.00015 * rotSpeed
      const cy = Math.cos(ry), sn = Math.sin(ry)

      const spreadX = mobile ? .55 : .36
      const spreadY = mobile ? .45 : .3
      const fadeX = hw, fadeY = hh
      const fadeR = mobile ? W * 0.45 : W * 0.22

      for(let i=0;i<N;i++){
        const x=ax[i],y=ay[i],z=az[i]
        const rx=x*cy-z*sn, rz=x*sn+z*cy
        const depth = 4 + rz
        if(depth < 0.5) { ox[i]=-999; continue }
        const s = 2.5 / depth
        ox[i]=Math.round(hw+rx*W*spreadX*s)
        oy[i]=Math.round(hh+y*H*spreadY*s)
        os[i]=s
      }

      // Connections
      const lineBase = mobile ? 0.02 : 0.04
      const lineMax = mobile ? 0.08 : 0.16
      gl.lineWidth = mobile ? 0.8 : 1.2
      for(let i=0;i<N;i++){for(let j=i+1;j<N;j++){
        if(ox[i]<-900||ox[j]<-900) continue
        const a=ox[i]-ox[j],b=oy[i]-oy[j]
        if(a*a+b*b<DSQ){
          const mx=(ox[i]+ox[j])/2,my=(oy[i]+oy[j])/2
          const ddx=(mx-fadeX)/fadeR, ddy=(my-fadeY)/(fadeR*1.3)
          const d=ddx*ddx+ddy*ddy
          const f=Math.min(1, Math.max(0, d-0.2)/0.8)
          const depthA=Math.min(1,(os[i]+os[j])*0.7)
          const alpha=(lineBase+lineMax*f)*depthA
          if(alpha<0.004) continue
          gl.beginPath()
          gl.strokeStyle=`rgba(0,0,0,${alpha.toFixed(3)})`
          gl.moveTo(ox[i],oy[i]);gl.lineTo(ox[j],oy[j])
          gl.stroke()
        }
      }}

      // Particles
      const glowMul=mobile?0.4:0.9, coreMul=mobile?0.5:0.9
      for(let i=0;i<N;i++){
        if(ox[i]<-900) continue
        const r=sr[i]*os[i],a=.2+os[i]*.45
        const ddx=(ox[i]-fadeX)/fadeR, ddy=(oy[i]-fadeY)/(fadeR*1.3)
        const d=ddx*ddx+ddy*ddy
        const f=Math.min(1,Math.max(0,d-0.2)/0.8)
        const fa=a*Math.max(0.15,f)
        gl.beginPath();gl.arc(ox[i],oy[i],r*3,0,6.28)
        gl.fillStyle=`rgba(255,151,51,${(fa*0.02*glowMul).toFixed(3)})`
        gl.fill()
        gl.beginPath();gl.arc(ox[i],oy[i],r,0,6.28)
        gl.fillStyle=`rgba(255,130,30,${(fa*0.5*coreMul).toFixed(3)})`
        gl.fill()
      }
      return
    }

    // --- FLY PHASE: camera follows tunnel nodes ---
    // Transition: redistribute particles into tunnel on first fly frame
    if(flyProgress < 0.05 && !render._transitioned) {
      render._transitioned = true
      const maxZ = totalNodes * TUNNEL_DEPTH + 4
      for(let i=0;i<N;i++){
        ax[i]=Math.random()*4-2
        ay[i]=Math.random()*4-2
        az[i]=Math.random()*(maxZ+4)-2
      }
    }

    const sp = Math.min(totalNodes - 1, flyProgress)
    const idx0 = Math.min(Math.floor(sp), totalNodes - 1)
    const idx1 = Math.min(idx0 + 1, totalNodes - 1)
    const frac = sp - idx0
    const n0 = allNodes[idx0], n1 = allNodes[idx1]
    const camX = n0.x + (n1.x - n0.x) * frac
    const camY = n0.y + (n1.y - n0.y) * frac
    const camZ = (n0.z + (n1.z - n0.z) * frac) - 0.5

    const nodeScreenY = H * (mobile ? 0.38 : 0.40)
    const spreadX = mobile ? .55 : .42
    const spreadY = mobile ? .45 : .35

    function project(px, py, pz) {
      const rx = px - camX, ry = py - camY, rz = pz - camZ
      const depth = 1.5 + rz
      if(depth < 0.15) return null
      const s = 2.5 / depth
      return {
        x: Math.round(hw + rx * W * spreadX * s),
        y: Math.round(nodeScreenY + ry * H * spreadY * s),
        s, depth
      }
    }

    // Text fade zone
    const fadeX = hw, fadeY = H * 0.52
    const fadeR = mobile ? W * 0.42 : W * 0.2
    const fadeRY = fadeR * 1.3

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
        const ddx=(mx-fadeX)/fadeR, ddy=(my-fadeY)/fadeRY
        const d=ddx*ddx+ddy*ddy
        const f=Math.min(1, Math.max(0, d-0.15)/0.85)
        const depthA=Math.min(1,(os[i]+os[j])*0.65)
        const alpha=(lineBase+lineMax*f)*depthA
        if(alpha<0.004) continue
        gl.beginPath()
        gl.strokeStyle=`rgba(0,0,0,${alpha.toFixed(3)})`
        gl.moveTo(ox[i],oy[i]);gl.lineTo(ox[j],oy[j])
        gl.stroke()
      }
    }}

    // Draw nodes
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
          gl.beginPath()
          gl.strokeStyle=`rgba(0,121,147,${(0.06+0.12*nearness).toFixed(3)})`
          gl.lineWidth = mobile ? 1.5 : 2
          gl.moveTo(pp.x,pp.y); gl.lineTo(p.x,p.y)
          gl.stroke()
        }
      }

      // Node dot
      const baseR = (mobile ? 5 : 7) * p.s
      const r = Math.round(isActive ? baseR*2 : baseR*(0.5+nearness*0.5))
      const nodeA = isActive ? 0.9 : 0.12+nearness*0.35

      if(isActive) {
        gl.beginPath();gl.arc(p.x,p.y,r*3.5,0,6.28)
        gl.fillStyle=`rgba(0,121,147,${(0.05*p.s).toFixed(3)})`
        gl.fill()
      }
      gl.beginPath();gl.arc(p.x,p.y,r*2,0,6.28)
      gl.fillStyle=`rgba(255,151,51,${(nodeA*0.1).toFixed(3)})`
      gl.fill()
      gl.beginPath();gl.arc(p.x,p.y,r,0,6.28)
      gl.fillStyle=isActive?`rgba(0,121,147,${nodeA.toFixed(3)})`:`rgba(255,130,30,${nodeA.toFixed(3)})`
      gl.fill()

      // Label
      const label = nd.label
      if(!label || p.s < 0.12) continue
      const fontSize = Math.round(Math.max(8, Math.min(mobile?26:32, (mobile?16:20)*p.s)))
      const textA = isActive ? 0.9 : Math.min(0.55, nearness*0.65)
      if(textA < 0.03) continue

      const textY = Math.round(p.y + r + fontSize*0.6)
      gl.font = `300 ${fontSize}px ${FONT}`
      gl.textAlign = 'center'
      gl.textBaseline = 'top'
      gl.fillStyle = `rgba(20,50,65,${textA.toFixed(2)})`
      gl.fillText(label, p.x, textY)

      // Number badge
      if(!nd.isReport && i < KERN.length) {
        const ns = Math.round(Math.max(7, fontSize*0.35))
        gl.font = `500 ${ns}px ${FONT}`
        gl.fillStyle = `rgba(0,121,147,${(textA*0.45).toFixed(2)})`
        gl.fillText(String(i+1).padStart(2,'0'), p.x, p.y-r-ns*1.2)
      }
    }

    // Background particles
    const glowMul=mobile?0.5:0.9, coreMul=mobile?0.6:0.9
    for(let i=0;i<N;i++){
      if(ox[i]<-900) continue
      const r=sr[i]*os[i]*0.8, a=.2+os[i]*.35
      const ddx=(ox[i]-fadeX)/fadeR, ddy=(oy[i]-fadeY)/fadeRY
      const d=ddx*ddx+ddy*ddy
      const f=Math.min(1,Math.max(0,d-0.15)/0.85)
      const fa=a*Math.max(0.15,f)
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
    render._transitioned = false  // allow re-transition if needed
  }
  function getNodeCount() { return totalNodes + INTRO_COUNT }
  function destroy(){window.removeEventListener('resize',resize)}
  return { render, resize, destroy, setReportFindings, getNodeCount }
}
