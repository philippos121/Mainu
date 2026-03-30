// 3D neural network — rotates on scroll, transitions dark→light
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

  // Interpolate between two RGB colors
  function lerp(a,b,t){return Math.round(a+(b-a)*t)}

  // progress: 0=dark start, 1=light end
  function render(scrollY, moving, progress){
    const p=Math.max(0,Math.min(1,progress||0))
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

    // Background: dark (#070e12) → light (#f0f4f5)
    const br=lerp(7,240,p),bg=lerp(14,244,p),bb=lerp(18,245,p)
    gl.fillStyle=`rgb(${br},${bg},${bb})`
    gl.fillRect(0,0,W,H)

    // Lines: teal on dark → subtle gray on light
    const lr=lerp(34,180,p),lgr=lerp(201,200,p),lb=lerp(232,210,p)
    const la=(.06*(1-p*.4)).toFixed(3)
    gl.beginPath();gl.strokeStyle=`rgba(${lr},${lgr},${lb},${la})`;gl.lineWidth=.5
    for(let i=0;i<N;i++)for(let j=i+1;j<N;j++){
      const a=ox[i]-ox[j],b=oy[i]-oy[j];if(a*a+b*b<DSQ){gl.moveTo(ox[i],oy[i]);gl.lineTo(ox[j],oy[j])}
    }
    gl.stroke()

    // Nodes: teal on dark → warm gray/teal on light
    const nr=lerp(34,100,p),ng=lerp(201,180,p),nb=lerp(232,190,p)
    for(let i=0;i<N;i++){
      const r=sr[i]*os[i],a=.2+os[i]*.4
      gl.beginPath();gl.arc(ox[i],oy[i],r*3,0,6.28)
      gl.fillStyle=`rgba(${nr},${ng},${nb},${(a*.05).toFixed(3)})`
      gl.fill()
      gl.beginPath();gl.arc(ox[i],oy[i],r,0,6.28)
      gl.fillStyle=`rgba(${nr},${ng},${nb},${(a*(.5-p*.2)).toFixed(3)})`
      gl.fill()
    }
  }

  function destroy(){window.removeEventListener('resize',resize)}
  return {render,resize,destroy}
}
