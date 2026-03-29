<template>
<div class="page">
  <canvas ref="cvs" class="bg-canvas"></canvas>

  <div class="scroll-wrap">
    <section class="s s-full reveal"><div class="sc">
      <img src="/logo.svg" alt="AI:ssociate" class="logo" />
      <div class="scroll-arrow"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg></div>
    </div></section>

    <section class="s s-full reveal"><div class="sc">
      <h2 class="title-legal">Legal</h2>
      <h2 class="title-monitoring">Monitoring</h2>
    </div></section>

    <section class="s s-full reveal"><div class="sc">
      <p class="tagline">Rechtsänderungen erkennen,<br/><em>bevor sie relevant werden.</em></p>
    </div></section>

    <section class="s s-full reveal"><div class="sc">
      <div class="cinema-block reveal-child" v-for="(t,i) in cinemaTexts" :key="i">
        <span class="cinema-num">0{{i+1}}</span>
        <div><strong>{{t.title}}</strong><p>{{t.desc}}</p></div>
      </div>
    </div></section>

    <section class="s s-half reveal"><div class="sc">
      <div class="source-cloud">
        <span v-for="(s,i) in srcWords" :key="i" class="sw reveal-child"
          :style="{fontSize:s.size+'px','--op':s.op,'--tx':s.x+'px','--ty':s.y+'px'}">{{s.text}}</span>
      </div>
    </div></section>

    <section class="s s-cats reveal"><div class="sc sc-wide">
      <p class="sec-over">Ihre Rechtsgebiete</p>
      <div class="cat-groups" v-if="catGroups.length">
        <div class="cat-group reveal-child" v-for="(g,gi) in catGroups" :key="gi">
          <p class="cg-label">{{g.group}}</p>
          <div class="cg-tags">
            <button v-for="c in g.items" :key="c.id" class="tag"
              :class="{active:selectedCategory.includes(c.id)}"
              @click="toggleCat(c.id)">{{c.label}}</button>
          </div>
        </div>
      </div>
      <p v-if="selectedCategory.length" class="cat-count">
        {{selectedCategory.length}} Rechtsgebiet{{selectedCategory.length>1?'e':''}}
        <a @click.prevent="selectedCategory=[]">zurücksetzen</a>
      </p>
    </div></section>

    <section class="s s-form"><div class="form-dock reveal" id="form-dock"><div class="form-inner">
      <div class="form-row">
        <div class="ff"><label>Zeitraum</label>
          <select v-model="selectedTimeframe" class="inp">
            <option v-for="t in timeframeOptions" :key="t.value" :value="t.value">{{t.label}}</option>
          </select>
        </div>
        <div class="ff"><label>E-Mail</label>
          <input v-model="reportEmail" type="email" placeholder="name@kanzlei.at" class="inp" />
        </div>
      </div>
      <div v-if="selectedTimeframe==='custom'" class="form-row">
        <div class="ff"><input v-model="datumVon" type="date" class="inp" /></div>
        <div class="ff"><input v-model="datumBis" type="date" class="inp" /></div>
      </div>
      <div class="form-row form-actions">
        <button class="btn-send" :disabled="!reportEmail||!selectedCategory.length||sending" @click="sendReport">
          <span v-if="sending" class="spin"></span><template v-else>Report senden →</template>
        </button>
        <button class="btn-dl" :disabled="!selectedCategory.length||generating" @click="downloadReport">
          <span v-if="generating" class="spin spin-c"></span><template v-else>↓ Download</template>
        </button>
      </div>
      <p v-if="statusMsg" :class="['msg',statusOk?'msg-ok':'msg-err']">{{statusMsg}}</p>
    </div></div></section>
  </div>
</div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import api from '../services/api'

const cvs = ref(null)
let scrollY = 0
let prevScrollY = -1
let raf = 0
let scrolling = false
let scrollTimer = 0
let renderLoop = () => {}

// ── IntersectionObserver for reveals (no scroll listener needed) ──
let observer = null
function setupObserver() {
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('on')
        // Stagger children
        const children = e.target.querySelectorAll('.reveal-child')
        children.forEach((c, i) => {
          setTimeout(() => c.classList.add('on'), i * 80)
        })
      }
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' })

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el))
}

// ── Canvas — reads raw scrollY, no Vue reactivity ──
function onScroll() {
  scrollY = window.scrollY || document.documentElement.scrollTop || 0
  if (!scrolling) { scrolling = true; renderLoop() }
  clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => { scrolling = false }, 150)
}

function startCanvas() {
  const c = cvs.value; if (!c) return
  const gl = c.getContext('2d', { alpha: false })
  let W, H
  const N = 65, DSQ = 160 * 160
  const ax=new Float32Array(N),ay=new Float32Array(N),az=new Float32Array(N)
  const dx=new Float32Array(N),dy=new Float32Array(N),dz=new Float32Array(N)
  const sr=new Float32Array(N),sh=new Uint8Array(N)
  const ox=new Float32Array(N),oy=new Float32Array(N),os=new Float32Array(N)
  for(let i=0;i<N;i++){
    ax[i]=Math.random()*2-1;ay[i]=Math.random()*2-1;az[i]=Math.random()*2-1
    dx[i]=(Math.random()-.5)*.001;dy[i]=(Math.random()-.5)*.001;dz[i]=(Math.random()-.5)*.0008
    sr[i]=1.5+Math.random()*2;sh[i]=Math.random()>.75?1:0
  }
  function resize(){W=c.width=window.innerWidth;H=c.height=window.innerHeight}
  resize(); window.addEventListener('resize',resize)

  function render(){
    const s=scrollY
    const ry=s*.0003,rx=s*.0002
    const cy=Math.cos(ry),sn=Math.sin(ry),cx=Math.cos(rx),sx=Math.sin(rx)
    const hw=W/2,hh=H/2
    for(let i=0;i<N;i++){
      // Only move nodes when scrolling
      if(scrolling){ax[i]+=dx[i];ay[i]+=dy[i];az[i]+=dz[i]}
      let x=ax[i],y=ay[i],z=az[i]
      if(x>1.3||x<-1.3)dx[i]*=-1;if(y>1.3||y<-1.3)dy[i]*=-1;if(z>1.3||z<-1.3)dz[i]*=-1
      const a=x*cy-z*sn,b=x*sn+z*cy,d=y*cx-b*sx,e=y*sx+b*cx
      const sc=2.5/(4+e);ox[i]=hw+a*W*.38*sc;oy[i]=hh+d*H*.32*sc;os[i]=sc
    }
    gl.fillStyle='#070e12';gl.fillRect(0,0,W,H)
    gl.beginPath();gl.strokeStyle='rgba(34,201,232,0.07)';gl.lineWidth=.5
    for(let i=0;i<N;i++)for(let j=i+1;j<N;j++){
      const a=ox[i]-ox[j],b=oy[i]-oy[j];if(a*a+b*b<DSQ){gl.moveTo(ox[i],oy[i]);gl.lineTo(ox[j],oy[j])}
    }
    gl.stroke()
    for(let i=0;i<N;i++){
      const r=sr[i]*os[i],a=.25+os[i]*.5
      gl.beginPath();gl.arc(ox[i],oy[i],r*3,0,6.28)
      gl.fillStyle=sh[i]?`rgba(255,151,51,${a*.06})`:`rgba(34,201,232,${a*.05})`
      gl.fill()
      gl.beginPath();gl.arc(ox[i],oy[i],r,0,6.28)
      gl.fillStyle=sh[i]?`rgba(255,151,51,${a*.8})`:`rgba(34,201,232,${a*.6})`
      gl.fill()
    }
  }

  // Render loop only runs while scrolling
  renderLoop = function(){
    if(!scrolling){return}
    if(scrollY!==prevScrollY){render();prevScrollY=scrollY}
    raf=requestAnimationFrame(renderLoop)
  }

  // Single initial render then stop
  render()

  return()=>{cancelAnimationFrame(raf);window.removeEventListener('resize',resize)}
}

let stopCanvas=null
onMounted(()=>{
  window.addEventListener('scroll',onScroll,{passive:true})
  stopCanvas=startCanvas()
  // Observer after next frame so DOM is ready
  requestAnimationFrame(()=>setupObserver())
})
onUnmounted(()=>{
  window.removeEventListener('scroll',onScroll)
  if(stopCanvas)stopCanvas()
  if(observer)observer.disconnect()
})

const cinemaTexts = [
  {title:'Alle Novellen erfassen',desc:'Gesetze, Verordnungen, Entscheidungen, BMF-Richtlinien — lückenlos.'},
  {title:'Änderungen vergleichen',desc:'Jeder Paragraph: neue Fassung vs. Vortag. Wort für Wort.'},
  {title:'Materialien verstehen',desc:'Erläuterungen direkt aus dem Parlament — was der Gesetzgeber wollte.'},
  {title:'KI-Analyse erhalten',desc:'Sachlich-juristisch zusammengefasst, mit klickbaren Quellenangaben.'},
]
const srcWords = [
  {text:'RIS',size:28,op:.9,x:-80,y:-20},{text:'Bundesrecht',size:14,op:.4,x:60,y:-30},
  {text:'Findok',size:24,op:.8,x:40,y:15},{text:'BMF',size:13,op:.35,x:-100,y:25},
  {text:'EUR-Lex',size:22,op:.75,x:-30,y:40},{text:'Verordnungen',size:12,op:.3,x:90,y:35},
  {text:'parlament.gv.at',size:20,op:.7,x:-60,y:-45},{text:'Judikatur',size:13,op:.35,x:70,y:-10},
  {text:'Richtlinien',size:14,op:.4,x:-40,y:50},{text:'BFG',size:12,op:.3,x:100,y:-40},
  {text:'Erläuterungen',size:13,op:.35,x:10,y:55},{text:'Materialien',size:15,op:.45,x:-90,y:0},
]

const categories=ref([]),timeframes=ref([]),selectedCategory=ref([]),selectedTimeframe=ref('EinemMonat')
const datumVon=ref(''),datumBis=ref(''),reportEmail=ref(localStorage.getItem('ris_report_email')||'')
const timeframeOptions=ref([]),sending=ref(false),generating=ref(false),statusMsg=ref(''),statusOk=ref(false)
const catGroups=computed(()=>{const g={};for(const c of categories.value){const k=c.group||'Sonstige';(g[k]=g[k]||[]).push(c)};return Object.entries(g).map(([group,items])=>({group,items}))})
function toggleCat(id){const i=selectedCategory.value.indexOf(id);if(i>=0)selectedCategory.value.splice(i,1);else selectedCategory.value.push(id);document.getElementById('form-dock')?.classList.add('on')}
watch(reportEmail,v=>{if(v)localStorage.setItem('ris_report_email',v)})
function loadData(){Promise.all([api.get('/categories'),api.get('/timeframes')]).then(([a,b])=>{categories.value=a.data;timeframes.value=b.data;timeframeOptions.value=[...b.data,{value:'custom',label:'Benutzerdefiniert…'}];requestAnimationFrame(()=>setupObserver())}).catch(()=>{statusMsg.value='Verbindung fehlgeschlagen.';statusOk.value=false})}
onMounted(loadData)

async function doSearch(){const cats=selectedCategory.value||[];const isC=selectedTimeframe.value==='custom';const tf=isC?'EinemJahr':selectedTimeframe.value;const ep=isC&&datumVon.value&&datumBis.value?{datum_von:datumVon.value,datum_bis:datumBis.value}:{};const ends=['/search/gesetze','/search/gerichtsentscheidungen'];const all=[];let hits=0;const seen=new Set();for(const e of ends){if(cats.length<=1){const p={im_ris_seit:tf,page:1,...ep};if(cats.length===1)p.category=cats[0];try{const r=(await api.get(e,{params:p})).data;hits+=r.total_hits||0;for(const i of(r.results||[]))if(!seen.has(i.id)){seen.add(i.id);all.push(i)}}catch{}}else{const ps=cats.map(c=>api.get(e,{params:{im_ris_seit:tf,page:1,category:c,...ep}}).catch(()=>({data:{results:[],total_hits:0}})));const rs=await Promise.all(ps);for(const r of rs){hits+=r.data.total_hits||0;for(const i of(r.data.results||[]))if(!seen.has(i.id)){seen.add(i.id);all.push(i)}}}}return{results:all,total_hits:hits}}
function catLabel(){const c=selectedCategory.value||[];if(!c.length)return'Alle';if(c.length===1){const f=categories.value.find(x=>x.id===c[0]);return f?f.label:''}return`${c.length} Rechtsgebiete`}
function tfLabel(){if(selectedTimeframe.value==='custom'&&datumVon.value&&datumBis.value)return`${datumVon.value} bis ${datumBis.value}`;const t=timeframes.value.find(x=>x.value===selectedTimeframe.value);return t?t.label:''}
async function sendReport(){if(!reportEmail.value||!selectedCategory.value.length)return;sending.value=true;statusMsg.value='Suche läuft…';statusOk.value=true;try{const d=await doSearch();if(!d.results?.length){statusMsg.value='Keine Ergebnisse.';statusOk.value=false;return};statusMsg.value=`${d.results.length} Ergebnisse — Report wird erstellt…`;await api.post('/report/email',{email:reportEmail.value,results:d.results,doc_type:'gesetze',category_label:catLabel(),timeframe_label:tfLabel(),total_hits:d.total_hits,diffs:{}});statusMsg.value=`Report an ${reportEmail.value} gesendet.`;statusOk.value=true}catch(e){statusMsg.value=e.response?.data?.detail||`Fehler: ${e.message}`;statusOk.value=false}finally{sending.value=false}}
async function downloadReport(){if(!selectedCategory.value.length)return;generating.value=true;statusMsg.value='Suche läuft…';statusOk.value=true;try{const d=await doSearch();if(!d.results?.length){statusMsg.value='Keine Ergebnisse.';statusOk.value=false;return};statusMsg.value=`${d.results.length} Ergebnisse — Report wird erstellt…`;const r=await api.post('/report',{results:d.results,doc_type:'gesetze',category_label:catLabel(),timeframe_label:tfLabel(),total_hits:d.total_hits,diffs:{}});const bl=new Blob([r.data.report_html],{type:'text/html;charset=utf-8'});const u=URL.createObjectURL(bl);const a=document.createElement('a');a.href=u;a.download=`Report_${new Date().toISOString().split('T')[0]}.html`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u);statusMsg.value='Report heruntergeladen.';statusOk.value=true}catch(e){statusMsg.value=e.response?.data?.detail||`Fehler: ${e.message}`;statusOk.value=false}finally{generating.value=false}}
</script>

<style scoped>
.page{min-height:100vh;background:#070e12;color:#e4f0f2}
.bg-canvas{position:fixed;inset:0;z-index:0;width:100%;height:100%;pointer-events:none;touch-action:none;contain:strict}
.scroll-wrap{position:relative;z-index:2;will-change:transform;transform:translateZ(0)}

.s{display:flex;align-items:center;justify-content:center;padding:24px}
.s-full{min-height:100vh}
.s-half{min-height:60vh}
.sc{text-align:center;max-width:680px;width:100%}
.sc-wide{max-width:860px;text-align:left}

/* ── Reveal via IntersectionObserver — pure CSS transitions ── */
.reveal>.sc,.reveal.form-dock>.form-inner{opacity:0;transform:translateY(50px);transition:opacity .9s cubic-bezier(.16,1,.3,1),transform .9s cubic-bezier(.16,1,.3,1)}
.reveal.on>.sc,.reveal.on.form-dock>.form-inner{opacity:1;transform:none}

.reveal-child{opacity:0;transform:translateX(-25px);transition:opacity .6s ease,transform .6s ease}
.reveal-child.on{opacity:1;transform:none}

/* Source words use CSS vars for position */
.sw{transition:opacity .6s ease,transform .6s ease}
.sw.on{opacity:var(--op)!important;transform:translate(var(--tx),var(--ty)) scale(1)!important}

.logo{height:60px;filter:brightness(10)}
.scroll-arrow{margin-top:56px;animation:bob 2.5s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0);opacity:.2}50%{transform:translateY(10px);opacity:.5}}

.title-legal{font-size:24px;font-weight:300;letter-spacing:12px;text-transform:uppercase;color:rgba(255,255,255,.4);margin:0 0 8px}
.title-monitoring{font-size:64px;font-weight:800;letter-spacing:4px;text-transform:uppercase;margin:0;background:linear-gradient(135deg,#ff9733,#ffbe6d 40%,#ff9733 80%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-shadow:none}

.tagline{font-size:32px;font-weight:300;line-height:1.5;color:rgba(255,255,255,.7);letter-spacing:-.5px;margin:0}
.tagline em{font-style:normal;color:#22c9e8;font-weight:600}

.cinema-block{display:flex;gap:20px;align-items:flex-start;text-align:left;padding:20px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.cinema-block:last-child{border:none}
.cinema-num{font-size:11px;font-weight:700;color:rgba(34,201,232,.4);padding-top:4px;flex-shrink:0;width:24px}
.cinema-block strong{font-size:18px;font-weight:700;letter-spacing:-.3px;display:block;margin-bottom:4px}
.cinema-block p{font-size:14px;color:rgba(255,255,255,.4);margin:0;line-height:1.6}

.source-cloud{position:relative;height:160px;display:flex;align-items:center;justify-content:center}
.sw{position:absolute;font-weight:700;color:rgba(255,255,255,.6);white-space:nowrap;opacity:0;transform:translate(var(--tx),var(--ty)) scale(.7)}

.s-cats{min-height:auto;padding:80px 24px}
.sec-over{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:4px;color:rgba(34,201,232,.45);margin:0 0 32px}
.cat-group{margin-bottom:24px}
.cg-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,.2);margin:0 0 10px}
.cg-tags{display:flex;flex-wrap:wrap;gap:8px}
.tag{padding:8px 18px;border-radius:99px;border:1px solid rgba(255,255,255,.06);background:transparent;color:rgba(255,255,255,.5);font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;transition:all .25s}
.tag:hover{color:rgba(255,255,255,.8);border-color:rgba(34,201,232,.25);background:rgba(34,201,232,.04)}
.tag.active{color:#22c9e8;border-color:rgba(34,201,232,.4);background:rgba(34,201,232,.1);font-weight:600}
.cat-count{font-size:13px;color:rgba(255,255,255,.35);margin-top:20px}
.cat-count a{color:#22c9e8;cursor:pointer;text-decoration:none;margin-left:6px}
.cat-count a:hover{text-decoration:underline}

.s-form{min-height:auto;position:sticky;bottom:0;padding:0 24px}
.form-dock{max-width:640px;margin:0 auto;opacity:0;transform:translateY(20px);transition:opacity .5s ease,transform .5s ease}
.form-dock.on{opacity:1;transform:none}
.form-inner{background:#0a1820;border-radius:18px 18px 0 0;border:1px solid rgba(255,255,255,.06);border-bottom:none;padding:24px 28px 28px;box-shadow:0 -10px 50px rgba(0,0,0,.5)}
.form-row{display:flex;gap:12px;margin-bottom:12px}.form-row:last-child{margin-bottom:0}
.ff{flex:1;min-width:0}
.ff label{display:block;font-size:12px;font-weight:600;color:rgba(255,255,255,.4);margin-bottom:5px}
.inp{width:100%;padding:11px 14px;border:1px solid rgba(255,255,255,.07);border-radius:10px;font-size:14px;font-family:inherit;outline:none;background:rgba(255,255,255,.03);color:#e4f0f2;transition:border-color .2s}
.inp:focus{border-color:rgba(34,201,232,.35)}
.inp::placeholder{color:rgba(255,255,255,.18)}
select.inp{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px}
select.inp option{background:#0b1922;color:#e4f0f2}
.form-actions{gap:10px;margin-top:4px}
.btn-send{flex:1;padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,#ff9733,#e8870a);color:#fff;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;box-shadow:0 4px 20px rgba(255,151,51,.2);transition:all .2s;display:flex;align-items:center;justify-content:center;gap:6px}
.btn-send:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 28px rgba(255,151,51,.35)}
.btn-send:disabled{opacity:.3;cursor:not-allowed}
.btn-dl{padding:13px 20px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:transparent;color:rgba(255,255,255,.6);font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;transition:all .2s;white-space:nowrap}
.btn-dl:hover:not(:disabled){border-color:rgba(34,201,232,.25);color:#22c9e8}
.btn-dl:disabled{opacity:.3;cursor:not-allowed}
.msg{margin-top:12px;padding:10px 14px;border-radius:10px;font-size:13px}
.msg-ok{background:rgba(16,185,129,.08);color:#34d399;border:1px solid rgba(16,185,129,.12)}
.msg-err{background:rgba(239,68,68,.08);color:#f87171;border:1px solid rgba(239,68,68,.12)}
.spin{width:18px;height:18px;border:2.5px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:sp .6s linear infinite;display:inline-block}
.spin-c{border-color:rgba(255,255,255,.1);border-top-color:#22c9e8}
@keyframes sp{to{transform:rotate(360deg)}}

@media(max-width:640px){.title-monitoring{font-size:40px;letter-spacing:2px}.title-legal{font-size:18px;letter-spacing:8px}.tagline{font-size:24px}.cinema-block strong{font-size:16px}.form-row{flex-direction:column;gap:8px}.form-actions{flex-direction:column}.form-inner{padding:20px}.s{padding:20px 16px}.sc-wide{max-width:100%}}
@media(prefers-reduced-motion:reduce){.reveal>.sc,.reveal-child,.sw,.form-dock{opacity:1!important;transform:none!important;transition:none!important}.bg-canvas{display:none}.page{background:#0c2230}}
</style>
