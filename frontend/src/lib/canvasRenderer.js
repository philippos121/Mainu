// 3D neural network — fly through node-to-node on scroll
import { KERN, helix } from './journeyNodes.js'

export function createRenderer(canvas) {
  const gl = canvas.getContext('2d', { alpha: false })
  let W = 0, H = 0
  const isMobile = window.innerWidth < 640
  const N = isMobile ? 40 : 80
  const DSQ = 190 * 190

  // Background particles
  const ax=new Float32Array(N),ay=new Float32Array(N),az=new Float32Array(N)
  const dx=new Float32Array(N),dy=new Float32Array(N),dz=new Float32Array(N)
  const sr=new Float32Array(N)
  const ox=new Float32Array(N),oy=new Float32Array(N),os=new Float32Array(N)

  for(let i=0;i<N;i++){
    ax[i]=Math.random()*3.2-1.6
    ay[i]=Math.random()*3.2-1.6
    az[i]=Math.random()*3.2-1.6
    const speed = isMobile ? 2.5 : 1
    dx[i]=(Math.random()-.5)*.001*speed
    dy[i]=(Math.random()-.5)*.001*speed
    dz[i]=(Math.random()-.5)*.0008*speed
    sr[i]=1.2+Math.random()*1.8
  }

  // Pre-compute slide node positions on helix
  const totalSlides = 2 + KERN.length  // logo + title + KERN nodes
  const slidePos = []
  for(let i=0;i<totalSlides;i++){
    const t = i / (totalSlides - 1)
    const h = helix(t)
    slidePos.push({ x: h.x, y: h.y, z: h.z })
  }

  let lastScrollY = 0, lastSlide = 0, initialized = false

  function resize(){
    W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight
    if(initialized) render(lastScrollY, false, lastSlide)
  }
  resize();window.addEventListener('resize',resize)

  function render(scrollY, moving, slideProgress){
    initialized = true
    lastScrollY = scrollY
    if(slideProgress !== undefined) lastSlide = slideProgress
    const mobile = W < 640
    const hw=W/2,hh=H/2

    // Smooth interpolation of active node position
    const sp = slideProgress || 0
    const idx0 = Math.min(Math.floor(sp), totalSlides - 1)
    const idx1 = Math.min(idx0 + 1, totalSlides - 1)
    const frac = sp - idx0
    // Lerp between current and next node position
    const targetX = slidePos[idx0].x + (slidePos[idx1].x - slidePos[idx0].x) * frac
    const targetY = slidePos[idx0].y + (slidePos[idx1].y - slidePos[idx0].y) * frac
    const targetZ = slidePos[idx0].z + (slidePos[idx1].z - slidePos[idx0].z) * frac

    // Camera sits directly behind the active node on Z axis
    // This guarantees the active node projects to screen center
    const camX = targetX
    const camY = targetY
    const camZ = targetZ - 0.8

    if(moving){for(let i=0;i<N;i++){
      ax[i]+=dx[i];ay[i]+=dy[i];az[i]+=dz[i]
      if(ax[i]>1.6||ax[i]<-1.6)dx[i]*=-1
      if(ay[i]>1.6||ay[i]<-1.6)dy[i]*=-1
      if(az[i]>1.6||az[i]<-1.6)dz[i]*=-1
    }}

    // Project a 3D point to screen — active node always at center
    const spreadX = mobile ? .55 : .4
    const spreadY = mobile ? .45 : .35
    function project(px, py, pz) {
      const rx = px - camX, ry = py - camY, rz = pz - camZ
      const depth = 3 + rz
      if(depth < 0.3) return null
      const s = 2.5 / depth
      return {
        x: hw + rx * W * spreadX * s,
        y: hh + ry * H * spreadY * s,
        s: s,
        depth: depth
      }
    }

    // Text fade zone is always centered on screen (where active node is)
    const activeIdx = Math.round(sp)
    const activeScreenX = hw
    const activeScreenY = hh
    const activeRadius = mobile ? W * 0.45 : W * 0.22

    // Fade based on distance to active node's screen position
    function textFade(sx, sy) {
      const ddx = (sx - activeScreenX) / activeRadius
      const ddy = (sy - activeScreenY) / activeRadius
      const d = ddx*ddx + ddy*ddy
      return Math.min(1, Math.max(0, d - 0.3) / 0.7)
    }

    gl.fillStyle='#fafbfc'
    gl.fillRect(0,0,W,H)

    // Project background particles
    for(let i=0;i<N;i++){
      const p = project(ax[i], ay[i], az[i])
      if(!p) { ox[i]=-999; continue }
      ox[i]=p.x; oy[i]=p.y; os[i]=p.s
    }

    // Draw background connections
    const lineAlphaBase = mobile ? 0.01 : 0.03
    const lineAlphaMax = mobile ? 0.06 : 0.15
    const connDist = mobile ? 300*300 : DSQ
    gl.lineWidth = mobile ? 0.7 : 1
    for(let i=0;i<N;i++){for(let j=i+1;j<N;j++){
      if(ox[i]<-900||ox[j]<-900) continue
      const a=ox[i]-ox[j],b=oy[i]-oy[j]
      if(a*a+b*b<connDist){
        const mx=(ox[i]+ox[j])/2,my=(oy[i]+oy[j])/2
        const f=textFade(mx,my)
        const depthAlpha = Math.min(1, (os[i]+os[j]) * 0.6)
        const alpha=(lineAlphaBase+lineAlphaMax*f)*depthAlpha
        if(alpha < 0.003) continue
        gl.beginPath()
        gl.strokeStyle=`rgba(0,0,0,${alpha.toFixed(3)})`
        gl.moveTo(ox[i],oy[i]);gl.lineTo(ox[j],oy[j])
        gl.stroke()
      }
    }}

    // Draw slide nodes on the helix path
    for(let i=0;i<slidePos.length;i++){
      const sp = slidePos[i]
      const p = project(sp.x, sp.y, sp.z)
      if(!p) continue

      const isActive = Math.abs(i - (slideProgress || 0)) < 0.5
      const nearness = 1 - Math.min(1, Math.abs(i - (slideProgress || 0)) / 2)

      // Draw connections between consecutive slide nodes
      if(i > 0) {
        const prevP = project(slidePos[i-1].x, slidePos[i-1].y, slidePos[i-1].z)
        if(prevP) {
          const lineF = textFade((p.x+prevP.x)/2, (p.y+prevP.y)/2)
          const la = (0.04 + 0.12 * lineF) * nearness
          if(la > 0.003) {
            gl.beginPath()
            gl.strokeStyle=`rgba(0,121,147,${la.toFixed(3)})`
            gl.lineWidth = mobile ? 1.5 : 2
            gl.moveTo(prevP.x, prevP.y)
            gl.lineTo(p.x, p.y)
            gl.stroke()
          }
        }
      }

      // Node circle — bigger & brighter when active
      const baseR = (mobile ? 5 : 7) * p.s
      const r = isActive ? baseR * 2.2 : baseR * (0.6 + nearness * 0.6)
      const nodeAlpha = isActive ? 0.9 : 0.15 + nearness * 0.3

      // Glow ring for active node
      if(isActive) {
        gl.beginPath();gl.arc(p.x, p.y, r*3.5, 0, 6.28)
        gl.fillStyle=`rgba(0,121,147,${(0.04 * p.s).toFixed(3)})`
        gl.fill()
      }

      // Outer glow
      gl.beginPath();gl.arc(p.x, p.y, r*2, 0, 6.28)
      gl.fillStyle=`rgba(255,151,51,${(nodeAlpha*0.12).toFixed(3)})`
      gl.fill()

      // Core
      gl.beginPath();gl.arc(p.x, p.y, r, 0, 6.28)
      const coreColor = isActive ? `rgba(0,121,147,${nodeAlpha.toFixed(3)})` :
        `rgba(255,130,30,${nodeAlpha.toFixed(3)})`
      gl.fillStyle=coreColor
      gl.fill()
    }

    // Draw background particles (nodes)
    const glowMul = mobile ? 0.3 : 0.8
    const coreMul = mobile ? 0.4 : 0.8
    for(let i=0;i<N;i++){
      if(ox[i]<-900) continue
      const r=sr[i]*os[i]*0.8, a=.2+os[i]*.35
      const f=textFade(ox[i],oy[i])
      const fa = a * f  // fade out near text
      if(fa < 0.005) continue
      gl.beginPath();gl.arc(ox[i],oy[i],r*2.5,0,6.28)
      gl.fillStyle=`rgba(255,151,51,${(fa*0.06*glowMul).toFixed(3)})`
      gl.fill()
      gl.beginPath();gl.arc(ox[i],oy[i],r,0,6.28)
      gl.fillStyle=`rgba(255,130,30,${(fa*0.5*coreMul).toFixed(3)})`
      gl.fill()
    }
  }

  function destroy(){window.removeEventListener('resize',resize)}
  return {render,resize,destroy}
}
