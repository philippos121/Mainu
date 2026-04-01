// 3D neural network — fly-through effect on scroll
export function createRenderer(canvas) {
  const gl = canvas.getContext('2d', { alpha: false })
  let W = 0, H = 0
  const isMobile = window.innerWidth < 640
  const N = isMobile ? 50 : 90
  const DSQ = 190 * 190
  const ax=new Float32Array(N),ay=new Float32Array(N),az=new Float32Array(N)
  const dx=new Float32Array(N),dy=new Float32Array(N),dz=new Float32Array(N)
  const sr=new Float32Array(N)
  const ox=new Float32Array(N),oy=new Float32Array(N),os=new Float32Array(N)

  // Spread nodes in a deep tunnel along Z (-3 to +3)
  for(let i=0;i<N;i++){
    ax[i]=Math.random()*3.2-1.6
    ay[i]=Math.random()*3.2-1.6
    az[i]=Math.random()*6-3  // deep Z range for fly-through
    const speed = isMobile ? 3 : 1
    dx[i]=(Math.random()-.5)*.001*speed
    dy[i]=(Math.random()-.5)*.001*speed
    dz[i]=(Math.random()-.5)*.0008*speed
    sr[i]=1.2+Math.random()*1.8
  }

  let lastScrollY = 0, initialized = false

  function resize(){
    W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight
    if(initialized) render(lastScrollY, false)
  }
  resize();window.addEventListener('resize',resize)

  // How much to fade an element based on distance to center
  function centerFade(x, y) {
    const mobile = W < 640
    const zw = mobile ? .65 : .35
    const zh = mobile ? .45 : .3
    const ddx = (x - W/2) / (W * zw)
    const ddy = (y - H/2) / (H * zh)
    const d = ddx*ddx + ddy*ddy
    return Math.min(1, Math.max(0, d - .35) / .65)
  }

  function render(scrollY, moving){
    initialized = true
    lastScrollY = scrollY
    const mobile = W < 640
    const hw=W/2,hh=H/2

    // Scroll drives camera forward through the Z axis
    const flySpeed = mobile ? 0.004 : 0.002
    const camZ = scrollY * flySpeed

    // Gentle rotation for extra 3D feel
    const rotSpeed = mobile ? 2.5 : 1
    const ry=scrollY*.00012*rotSpeed
    const cy=Math.cos(ry),sn=Math.sin(ry)

    if(moving){for(let i=0;i<N;i++){
      ax[i]+=dx[i];ay[i]+=dy[i];az[i]+=dz[i]
      if(ax[i]>1.6||ax[i]<-1.6)dx[i]*=-1
      if(ay[i]>1.6||ay[i]<-1.6)dy[i]*=-1
      if(az[i]>3||az[i]<-3)dz[i]*=-1
    }}

    // Project nodes with fly-through Z offset
    const spreadX = mobile ? .55 : .36
    const spreadY = mobile ? .45 : .3
    for(let i=0;i<N;i++){
      const x=ax[i],y=ay[i],z=az[i]
      // Apply Y-axis rotation
      const rx=x*cy-z*sn, rz=x*sn+z*cy
      // Shift Z by camera position, wrap around for infinite tunnel
      let tz = ((rz - camZ) % 6 + 9) % 6 - 3  // wrap to -3..+3
      // Perspective projection — nodes closer = bigger & spread out
      const depth = 4 + tz
      if(depth < 0.5) { ox[i]=-999; continue }  // behind camera
      const s = 2.5 / depth
      ox[i]=hw+rx*W*spreadX*s
      oy[i]=hh+y*H*spreadY*s
      os[i]=s
    }

    gl.fillStyle='#fafbfc'
    gl.fillRect(0,0,W,H)

    // Draw connections
    const lineAlphaBase = mobile ? 0.015 : 0.04
    const lineAlphaMax = mobile ? 0.08 : 0.18
    const connDist = mobile ? 300*300 : DSQ
    gl.lineWidth = mobile ? 0.8 : 1.2
    for(let i=0;i<N;i++){for(let j=i+1;j<N;j++){
      if(ox[i]<-900||ox[j]<-900) continue
      const a=ox[i]-ox[j],b=oy[i]-oy[j]
      if(a*a+b*b<connDist){
        const mx=(ox[i]+ox[j])/2,my=(oy[i]+oy[j])/2
        const f=centerFade(mx,my)
        // Depth-based alpha: closer nodes have stronger lines
        const depthAlpha = Math.min(1, (os[i]+os[j]) * 0.7)
        const alpha=(lineAlphaBase+lineAlphaMax*f)*depthAlpha
        gl.beginPath()
        gl.strokeStyle=`rgba(0,0,0,${alpha.toFixed(3)})`
        gl.moveTo(ox[i],oy[i]);gl.lineTo(ox[j],oy[j])
        gl.stroke()
      }
    }}

    // Orange nodes — size scales with perspective
    const glowMul = mobile ? 0.4 : 1
    const coreMul = mobile ? 0.5 : 1
    for(let i=0;i<N;i++){
      if(ox[i]<-900) continue
      const r=sr[i]*os[i],a=.2+os[i]*.45
      const f=centerFade(ox[i],oy[i])
      gl.beginPath();gl.arc(ox[i],oy[i],r*3,0,6.28)
      gl.fillStyle=`rgba(255,151,51,${(a*(.02+.1*f)*glowMul).toFixed(3)})`
      gl.fill()
      gl.beginPath();gl.arc(ox[i],oy[i],r,0,6.28)
      gl.fillStyle=`rgba(255,130,30,${(a*(.1+.7*f)*coreMul).toFixed(3)})`
      gl.fill()
    }
  }

  function destroy(){window.removeEventListener('resize',resize)}
  return {render,resize,destroy}
}
