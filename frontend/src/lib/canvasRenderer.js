// 3D neural network — white bg, dark nodes, clear center zone for text
export function createRenderer(canvas) {
  const gl = canvas.getContext('2d', { alpha: false })
  let W = 0, H = 0
  const N = 55, DSQ = 170 * 170
  const ax=new Float32Array(N),ay=new Float32Array(N),az=new Float32Array(N)
  const dx=new Float32Array(N),dy=new Float32Array(N),dz=new Float32Array(N)
  const sr=new Float32Array(N)
  const ox=new Float32Array(N),oy=new Float32Array(N),os=new Float32Array(N)

  for(let i=0;i<N;i++){
    ax[i]=Math.random()*2.6-1.3;ay[i]=Math.random()*2.6-1.3;az[i]=Math.random()*2.6-1.3
    dx[i]=(Math.random()-.5)*.001;dy[i]=(Math.random()-.5)*.001;dz[i]=(Math.random()-.5)*.0008
    sr[i]=1.2+Math.random()*1.8
  }

  function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight}
  resize();window.addEventListener('resize',resize)

  // How much to fade an element based on distance to center
  // On mobile (narrow screens), make the clear zone wider relative to screen
  function centerFade(x, y) {
    const mobile = W < 640
    const zw = mobile ? .5 : .35 // wider clear zone on mobile
    const zh = mobile ? .35 : .3
    const ddx = (x - W/2) / (W * zw)
    const ddy = (y - H/2) / (H * zh)
    const d = ddx*ddx + ddy*ddy
    return Math.min(1, Math.max(0, d - .25) / .75)
  }

  function render(scrollY, moving){
    const ry=scrollY*.00025,rx=scrollY*.00015
    const cy=Math.cos(ry),sn=Math.sin(ry),cx=Math.cos(rx),sx=Math.sin(rx)
    const hw=W/2,hh=H/2

    if(moving){for(let i=0;i<N;i++){
      ax[i]+=dx[i];ay[i]+=dy[i];az[i]+=dz[i]
      if(ax[i]>1.3||ax[i]<-1.3)dx[i]*=-1;if(ay[i]>1.3||ay[i]<-1.3)dy[i]*=-1;if(az[i]>1.3||az[i]<-1.3)dz[i]*=-1
    }}

    for(let i=0;i<N;i++){
      const x=ax[i],y=ay[i],z=az[i],a=x*cy-z*sn,b=x*sn+z*cy
      const d=y*cx-b*sx,e=y*sx+b*cx,s=2.5/(4+e)
      ox[i]=hw+a*W*.36*s;oy[i]=hh+d*H*.3*s;os[i]=s
    }

    gl.fillStyle='#fafbfc'
    gl.fillRect(0,0,W,H)

    // Connections — strong outside, faint in center
    gl.lineWidth=.7
    for(let i=0;i<N;i++){for(let j=i+1;j<N;j++){
      const a=ox[i]-ox[j],b=oy[i]-oy[j]
      if(a*a+b*b<DSQ){
        const mx=(ox[i]+ox[j])/2,my=(oy[i]+oy[j])/2
        const f=centerFade(mx,my)
        // Outside: 0.14, center: 0.02 (faint but visible)
        const alpha=0.02+0.12*f
        gl.beginPath()
        gl.strokeStyle=`rgba(8,30,42,${alpha.toFixed(3)})`
        gl.moveTo(ox[i],oy[i]);gl.lineTo(ox[j],oy[j])
        gl.stroke()
      }
    }}

    // Nodes — strong outside, faint in center
    for(let i=0;i<N;i++){
      const r=sr[i]*os[i],a=.2+os[i]*.45
      const f=centerFade(ox[i],oy[i])
      // Glow: outside 0.1, center 0.015
      gl.beginPath();gl.arc(ox[i],oy[i],r*3,0,6.28)
      gl.fillStyle=`rgba(6,28,40,${(a*(.015+.085*f)).toFixed(3)})`
      gl.fill()
      // Core: outside 0.7, center 0.08
      gl.beginPath();gl.arc(ox[i],oy[i],r,0,6.28)
      gl.fillStyle=`rgba(6,28,40,${(a*(.08+.62*f)).toFixed(3)})`
      gl.fill()
    }
  }

  function destroy(){window.removeEventListener('resize',resize)}
  return {render,resize,destroy}
}
