<template>
<div class="page">
  <canvas ref="cvs" class="bg-canvas"></canvas>

  <div class="scroll-wrap">

    <!-- S1: Logo -->
    <section class="s s-full" :class="{ on: true }">
      <div class="sc">
        <img src="/logo.svg" alt="AI:ssociate" class="logo" />
        <div class="scroll-arrow">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
        </div>
      </div>
    </section>

    <!-- S2: Legal Monitoring -->
    <section class="s s-full" :class="{ on: sy > 200 }">
      <div class="sc">
        <h2 class="title-legal">Legal</h2>
        <h2 class="title-monitoring">Monitoring</h2>
      </div>
    </section>

    <!-- S3: Tagline -->
    <section class="s s-full" :class="{ on: sy > 600 }">
      <div class="sc">
        <p class="tagline">Rechtsänderungen erkennen,<br/><em>bevor sie relevant werden.</em></p>
      </div>
    </section>

    <!-- S4: What it does — cinematic text blocks -->
    <section class="s s-full" :class="{ on: sy > 1100 }">
      <div class="sc">
        <div class="cinema-block" v-for="(t, i) in cinemaTexts" :key="i"
          :style="{ opacity: sy > 1150+i*100 ? 1 : 0, transform: `translateY(${sy > 1150+i*100 ? 0 : 30}px)`, transitionDelay: i*0.08+'s' }">
          <span class="cinema-num">0{{ i+1 }}</span>
          <div>
            <strong>{{ t.title }}</strong>
            <p>{{ t.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- S5: Sources — floating words -->
    <section class="s s-half" :class="{ on: sy > 1700 }">
      <div class="sc">
        <div class="source-cloud">
          <span v-for="(s, i) in srcWords" :key="i" class="sw"
            :style="{ fontSize: s.size+'px', opacity: sy > 1750+i*20 ? s.op : 0, transform: `translate(${s.x}px,${s.y}px) scale(${sy > 1750+i*20 ? 1 : 0.7})`, transitionDelay: i*0.04+'s' }">{{ s.text }}</span>
        </div>
      </div>
    </section>

    <!-- S6: Category selection -->
    <section class="s s-cats" :class="{ on: sy > 2000 }">
      <div class="sc sc-wide">
        <p class="sec-over">Ihre Rechtsgebiete</p>
        <div class="cat-groups" v-if="catGroups.length">
          <div class="cat-group" v-for="(g, gi) in catGroups" :key="gi"
            :style="{ opacity: sy > 2050+gi*25 ? 1 : 0, transform: `translateY(${sy > 2050+gi*25 ? 0 : 15}px)`, transitionDelay: gi*0.04+'s' }">
            <p class="cg-label">{{ g.group }}</p>
            <div class="cg-tags">
              <button v-for="c in g.items" :key="c.id" class="tag"
                :class="{ active: selectedCategory.includes(c.id) }"
                @click="toggleCat(c.id)">{{ c.label }}</button>
            </div>
          </div>
        </div>
        <p v-if="selectedCategory.length" class="cat-count">
          {{ selectedCategory.length }} Rechtsgebiet{{ selectedCategory.length > 1 ? 'e' : '' }}
          <a @click.prevent="selectedCategory=[]">zurücksetzen</a>
        </p>
      </div>
    </section>

    <!-- S7: Form — sticky bottom -->
    <section class="s s-form">
      <div class="form-dock" :class="{ on: sy > 2400 || selectedCategory.length }">
        <div class="form-inner">
          <div class="form-row">
            <div class="ff">
              <v-select v-model="selectedTimeframe" :items="timeframeOptions" item-title="label" item-value="value"
                variant="outlined" density="compact" hide-details color="#22c9e8" label="Zeitraum" />
            </div>
            <div class="ff">
              <input v-model="reportEmail" type="email" placeholder="E-Mail für Report" class="inp" />
            </div>
          </div>
          <div v-if="selectedTimeframe==='custom'" class="form-row">
            <div class="ff"><input v-model="datumVon" type="date" class="inp" placeholder="Von" /></div>
            <div class="ff"><input v-model="datumBis" type="date" class="inp" placeholder="Bis" /></div>
          </div>
          <div class="form-row form-actions">
            <button class="btn-send" :disabled="!reportEmail||!selectedCategory.length||sending" @click="sendReport">
              <span v-if="sending" class="spin"></span><template v-else>Report senden →</template>
            </button>
            <button class="btn-dl" :disabled="!selectedCategory.length||generating" @click="downloadReport">
              <span v-if="generating" class="spin spin-c"></span><template v-else>↓ Download</template>
            </button>
          </div>
          <p v-if="statusMsg" :class="['msg', statusOk?'msg-ok':'msg-err']">{{ statusMsg }}</p>
        </div>
      </div>
    </section>

  </div>
</div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import api from '../services/api'

const cvs = ref(null)
const sy = ref(0)
let raf = 0

function onScroll() {
  sy.value = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
}

// ── Lightweight 3D network — deferred init ──
function startCanvas() {
  const c = cvs.value; if (!c) return
  const gl = c.getContext('2d', { alpha: false })
  let W, H
  const N = 65
  const DSQ = 160 * 160
  // Typed arrays
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

  function frame(){
    const s=sy.value,t=performance.now()
    const ry=s*.0002+t*.00004,rx=s*.0003
    const cy=Math.cos(ry),siny=Math.sin(ry),cx=Math.cos(rx),sinx=Math.sin(rx)
    const hw=W/2,hh=H/2
    for(let i=0;i<N;i++){
      let x=ax[i]+=dx[i],y=ay[i]+=dy[i],z=az[i]+=dz[i]
      if(x>1.3||x<-1.3)dx[i]*=-1;if(y>1.3||y<-1.3)dy[i]*=-1;if(z>1.3||z<-1.3)dz[i]*=-1
      const a=x*cy-z*siny,b=x*siny+z*cy,d=y*cx-b*sinx,e=y*sinx+b*cx
      const sc=2.5/(4+e);ox[i]=hw+a*W*.38*sc;oy[i]=hh+d*H*.32*sc;os[i]=sc
    }
    gl.fillStyle='#070e12';gl.fillRect(0,0,W,H)
    // Lines — single batch
    gl.beginPath();gl.strokeStyle='rgba(34,201,232,0.07)';gl.lineWidth=.5
    for(let i=0;i<N;i++)for(let j=i+1;j<N;j++){
      const a=ox[i]-ox[j],b=oy[i]-oy[j];if(a*a+b*b<DSQ){gl.moveTo(ox[i],oy[i]);gl.lineTo(ox[j],oy[j])}
    }
    gl.stroke()
    // Nodes with glow halos
    for(let i=0;i<N;i++){
      const r=sr[i]*os[i],a=.25+os[i]*.5
      // Glow
      gl.beginPath();gl.arc(ox[i],oy[i],r*3,0,6.28)
      gl.fillStyle=sh[i]?`rgba(255,151,51,${a*.06})`:`rgba(34,201,232,${a*.05})`
      gl.fill()
      // Core
      gl.beginPath();gl.arc(ox[i],oy[i],r,0,6.28)
      gl.fillStyle=sh[i]?`rgba(255,151,51,${a*.8})`:`rgba(34,201,232,${a*.6})`
      gl.fill()
    }
    raf=requestAnimationFrame(frame)
  }
  raf=requestAnimationFrame(frame)
  return()=>{cancelAnimationFrame(raf);window.removeEventListener('resize',resize)}
}

let stop=null
onMounted(()=>{
  window.addEventListener('scroll',onScroll,{passive:true})
  document.addEventListener('scroll',onScroll,{passive:true,capture:true})
  stop=startCanvas()
})
onUnmounted(()=>{
  window.removeEventListener('scroll',onScroll)
  document.removeEventListener('scroll',onScroll,{capture:true})
  if(stop)stop()
})

const cinemaTexts = [
  { title: 'Alle Novellen erfassen', desc: 'Gesetze, Verordnungen, Entscheidungen, BMF-Richtlinien — lückenlos.' },
  { title: 'Änderungen vergleichen', desc: 'Jeder Paragraph: neue Fassung vs. Vortag. Wort für Wort.' },
  { title: 'Materialien verstehen', desc: 'Erläuterungen direkt aus dem Parlament — was der Gesetzgeber wollte.' },
  { title: 'KI-Analyse erhalten', desc: 'Sachlich-juristisch zusammengefasst, mit klickbaren Quellenangaben.' },
]

const srcWords = [
  { text:'RIS', size:28, op:0.9, x:-80, y:-20 },
  { text:'Bundesrecht', size:14, op:0.4, x:60, y:-30 },
  { text:'Findok', size:24, op:0.8, x:40, y:15 },
  { text:'BMF', size:13, op:0.35, x:-100, y:25 },
  { text:'EUR-Lex', size:22, op:0.75, x:-30, y:40 },
  { text:'Verordnungen', size:12, op:0.3, x:90, y:35 },
  { text:'parlament.gv.at', size:20, op:0.7, x:-60, y:-45 },
  { text:'Judikatur', size:13, op:0.35, x:70, y:-10 },
  { text:'Richtlinien', size:14, op:0.4, x:-40, y:50 },
  { text:'BFG', size:12, op:0.3, x:100, y:-40 },
  { text:'Erläuterungen', size:13, op:0.35, x:10, y:55 },
  { text:'Materialien', size:15, op:0.45, x:-90, y:0 },
]

const categories = ref([])
const timeframes = ref([])
const selectedCategory = ref([])
const selectedTimeframe = ref('EinemMonat')
const datumVon = ref('')
const datumBis = ref('')
const reportEmail = ref(localStorage.getItem('ris_report_email')||'')
const timeframeOptions = ref([])
const sending = ref(false)
const generating = ref(false)
const statusMsg = ref('')
const statusOk = ref(false)
const catGroups = computed(()=>{const g={};for(const c of categories.value){const k=c.group||'Sonstige';(g[k]=g[k]||[]).push(c)};return Object.entries(g).map(([group,items])=>({group,items}))})
function toggleCat(id){const i=selectedCategory.value.indexOf(id);if(i>=0)selectedCategory.value.splice(i,1);else selectedCategory.value.push(id)}

watch(reportEmail,v=>{if(v)localStorage.setItem('ris_report_email',v)})
// Load categories in background — never block mount/render
function loadData(){Promise.all([api.get('/categories'),api.get('/timeframes')]).then(([a,b])=>{categories.value=a.data;timeframes.value=b.data;timeframeOptions.value=[...b.data,{value:'custom',label:'Benutzerdefiniert…'}]}).catch(()=>{statusMsg.value='Verbindung fehlgeschlagen.';statusOk.value=false})}
onMounted(loadData)

async function doSearch(){const cats=selectedCategory.value||[];const isC=selectedTimeframe.value==='custom';const tf=isC?'EinemJahr':selectedTimeframe.value;const ep=isC&&datumVon.value&&datumBis.value?{datum_von:datumVon.value,datum_bis:datumBis.value}:{};const ends=['/search/gesetze','/search/gerichtsentscheidungen'];const all=[];let hits=0;const seen=new Set();for(const e of ends){if(cats.length<=1){const p={im_ris_seit:tf,page:1,...ep};if(cats.length===1)p.category=cats[0];try{const r=(await api.get(e,{params:p})).data;hits+=r.total_hits||0;for(const i of(r.results||[]))if(!seen.has(i.id)){seen.add(i.id);all.push(i)}}catch{}}else{const ps=cats.map(c=>api.get(e,{params:{im_ris_seit:tf,page:1,category:c,...ep}}).catch(()=>({data:{results:[],total_hits:0}})));const rs=await Promise.all(ps);for(const r of rs){hits+=r.data.total_hits||0;for(const i of(r.data.results||[]))if(!seen.has(i.id)){seen.add(i.id);all.push(i)}}}}return{results:all,total_hits:hits}}
function catLabel(){const c=selectedCategory.value||[];if(!c.length)return'Alle';if(c.length===1){const f=categories.value.find(x=>x.id===c[0]);return f?f.label:''}return`${c.length} Rechtsgebiete`}
function tfLabel(){if(selectedTimeframe.value==='custom'&&datumVon.value&&datumBis.value)return`${datumVon.value} bis ${datumBis.value}`;const t=timeframes.value.find(x=>x.value===selectedTimeframe.value);return t?t.label:''}

async function sendReport(){if(!reportEmail.value||!selectedCategory.value.length)return;sending.value=true;statusMsg.value='Suche läuft…';statusOk.value=true;try{const d=await doSearch();if(!d.results?.length){statusMsg.value='Keine Ergebnisse.';statusOk.value=false;return};statusMsg.value=`${d.results.length} Ergebnisse — Report wird erstellt…`;await api.post('/report/email',{email:reportEmail.value,results:d.results,doc_type:'gesetze',category_label:catLabel(),timeframe_label:tfLabel(),total_hits:d.total_hits,diffs:{}});statusMsg.value=`Report an ${reportEmail.value} gesendet.`;statusOk.value=true}catch(e){statusMsg.value=e.response?.data?.detail||`Fehler: ${e.message}`;statusOk.value=false}finally{sending.value=false}}
async function downloadReport(){if(!selectedCategory.value.length)return;generating.value=true;statusMsg.value='Suche läuft…';statusOk.value=true;try{const d=await doSearch();if(!d.results?.length){statusMsg.value='Keine Ergebnisse.';statusOk.value=false;return};statusMsg.value=`${d.results.length} Ergebnisse — Report wird erstellt…`;const r=await api.post('/report',{results:d.results,doc_type:'gesetze',category_label:catLabel(),timeframe_label:tfLabel(),total_hits:d.total_hits,diffs:{}});const bl=new Blob([r.data.report_html],{type:'text/html;charset=utf-8'});const u=URL.createObjectURL(bl);const a=document.createElement('a');a.href=u;a.download=`Report_${new Date().toISOString().split('T')[0]}.html`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u);statusMsg.value='Report heruntergeladen.';statusOk.value=true}catch(e){statusMsg.value=e.response?.data?.detail||`Fehler: ${e.message}`;statusOk.value=false}finally{generating.value=false}}
</script>

<style scoped>
.page{min-height:100vh;background:#070e12;color:#e4f0f2;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch}
.bg-canvas{position:fixed;inset:0;z-index:0;width:100%;height:100%;pointer-events:none;touch-action:none}
.scroll-wrap{position:relative;z-index:2}

/* ── Sections ── */
.s{display:flex;align-items:center;justify-content:center;padding:24px}
.s-full{min-height:100vh}
.s-half{min-height:60vh}
.sc{text-align:center;max-width:680px;width:100%;opacity:0;transform:translateY(50px);transition:opacity 1s cubic-bezier(.16,1,.3,1),transform 1s cubic-bezier(.16,1,.3,1)}
.s.on .sc{opacity:1;transform:translateY(0)}
.sc-wide{max-width:860px;text-align:left}

/* Logo */
.logo{height:60px;filter:brightness(10)}
.scroll-arrow{margin-top:56px;animation:bob 2.5s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0);opacity:.2}50%{transform:translateY(10px);opacity:.5}}

/* Legal Monitoring */
.title-legal{font-size:24px;font-weight:300;letter-spacing:12px;text-transform:uppercase;color:rgba(255,255,255,.4);margin:0 0 8px}
.title-monitoring{
  font-size:64px;font-weight:800;letter-spacing:4px;text-transform:uppercase;margin:0;
  background:linear-gradient(135deg,#ff9733 0%,#ffbe6d 40%,#ff9733 80%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  filter:drop-shadow(0 4px 30px rgba(255,151,51,.25));
}

/* Tagline */
.tagline{font-size:32px;font-weight:300;line-height:1.5;color:rgba(255,255,255,.7);letter-spacing:-.5px;margin:0}
.tagline em{font-style:normal;color:#22c9e8;font-weight:600}

/* Cinema blocks */
.cinema-block{
  display:flex;gap:20px;align-items:flex-start;text-align:left;
  padding:20px 0;border-bottom:1px solid rgba(255,255,255,.04);
  transition:opacity .7s ease,transform .7s ease;
}
.cinema-block:last-child{border:none}
.cinema-num{font-size:11px;font-weight:700;color:rgba(34,201,232,.4);font-variant-numeric:tabular-nums;padding-top:4px;flex-shrink:0;width:24px}
.cinema-block strong{font-size:18px;font-weight:700;letter-spacing:-.3px;display:block;margin-bottom:4px}
.cinema-block p{font-size:14px;color:rgba(255,255,255,.4);margin:0;line-height:1.6}

/* Source word cloud */
.source-cloud{position:relative;height:160px;display:flex;align-items:center;justify-content:center}
.sw{
  position:absolute;font-weight:700;color:rgba(255,255,255,.6);
  transition:opacity .6s ease,transform .6s ease;
  white-space:nowrap;
}

/* Categories */
.s-cats{min-height:auto;padding:80px 24px}
.sec-over{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:4px;color:rgba(34,201,232,.45);margin:0 0 32px}
.cat-group{margin-bottom:24px;transition:opacity .5s ease,transform .5s ease}
.cg-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,.2);margin:0 0 10px}
.cg-tags{display:flex;flex-wrap:wrap;gap:8px}
.tag{
  padding:8px 18px;border-radius:99px;
  border:1px solid rgba(255,255,255,.06);background:transparent;
  color:rgba(255,255,255,.5);font-size:13px;font-weight:500;font-family:inherit;
  cursor:pointer;transition:all .25s;
}
.tag:hover{color:rgba(255,255,255,.8);border-color:rgba(34,201,232,.25);background:rgba(34,201,232,.04)}
.tag.active{color:#22c9e8;border-color:rgba(34,201,232,.4);background:rgba(34,201,232,.1);font-weight:600}
.cat-count{font-size:13px;color:rgba(255,255,255,.35);margin-top:20px}
.cat-count a{color:#22c9e8;cursor:pointer;text-decoration:none;margin-left:6px}
.cat-count a:hover{text-decoration:underline}

/* Form dock — sticky */
.s-form{min-height:auto;position:sticky;bottom:0;padding:0 24px}
.form-dock{
  max-width:640px;margin:0 auto;
  opacity:0;transform:translateY(20px);transition:opacity .5s ease,transform .5s ease;
}
.form-dock.on{opacity:1;transform:translateY(0)}
.form-inner{
  background:rgba(8,20,28,.92);backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px);
  border-radius:18px 18px 0 0;border:1px solid rgba(255,255,255,.06);border-bottom:none;
  padding:24px 28px 28px;
  box-shadow:0 -10px 50px rgba(0,0,0,.5);
}
.form-row{display:flex;gap:12px;margin-bottom:12px}
.form-row:last-child{margin-bottom:0}
.ff{flex:1;min-width:0}
.ff label{font-size:12px;color:rgba(255,255,255,.4);margin-bottom:4px;display:block}
.inp{
  width:100%;padding:11px 14px;border:1px solid rgba(255,255,255,.07);border-radius:10px;
  font-size:14px;font-family:inherit;outline:none;
  background:rgba(255,255,255,.03);color:#e4f0f2;transition:border-color .2s;
}
.inp:focus{border-color:rgba(34,201,232,.35)}
.inp::placeholder{color:rgba(255,255,255,.18)}
.form-actions{gap:10px;margin-top:4px}
.btn-send{
  flex:1;padding:13px;border:none;border-radius:12px;
  background:linear-gradient(135deg,#ff9733,#e8870a);color:#fff;
  font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;
  box-shadow:0 4px 20px rgba(255,151,51,.2);transition:all .2s;
  display:flex;align-items:center;justify-content:center;gap:6px;
}
.btn-send:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 28px rgba(255,151,51,.35)}
.btn-send:disabled{opacity:.3;cursor:not-allowed}
.btn-dl{
  padding:13px 20px;border:1px solid rgba(255,255,255,.08);border-radius:12px;
  background:transparent;color:rgba(255,255,255,.6);font-size:14px;font-weight:600;
  font-family:inherit;cursor:pointer;transition:all .2s;white-space:nowrap;
}
.btn-dl:hover:not(:disabled){border-color:rgba(34,201,232,.25);color:#22c9e8}
.btn-dl:disabled{opacity:.3;cursor:not-allowed}
.msg{margin-top:12px;padding:10px 14px;border-radius:10px;font-size:13px}
.msg-ok{background:rgba(16,185,129,.08);color:#34d399;border:1px solid rgba(16,185,129,.12)}
.msg-err{background:rgba(239,68,68,.08);color:#f87171;border:1px solid rgba(239,68,68,.12)}

.spin{width:18px;height:18px;border:2.5px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:sp .6s linear infinite;display:inline-block}
.spin-c{border-color:rgba(255,255,255,.1);border-top-color:#22c9e8}
@keyframes sp{to{transform:rotate(360deg)}}

/* Vuetify */
:deep(.v-field){background:rgba(255,255,255,.03)!important;border-color:rgba(255,255,255,.07)!important;color:#e4f0f2!important;border-radius:10px!important}
:deep(.v-field__input){color:#e4f0f2!important}
:deep(.v-field--focused){border-color:rgba(34,201,232,.35)!important}
:deep(.v-chip){background:rgba(34,201,232,.1)!important;color:#22c9e8!important}
:deep(.v-select__selection-text){color:#e4f0f2!important}
:deep(.v-field__append-inner .v-icon){color:rgba(255,255,255,.25)!important}
:deep(.v-list){background:#0b1922!important;border:1px solid rgba(255,255,255,.05)!important;border-radius:10px!important}
:deep(.v-list-item){color:#e4f0f2!important}
:deep(.v-list-item:hover){background:rgba(34,201,232,.05)!important}
:deep(.v-list-item--active){background:rgba(34,201,232,.08)!important;color:#22c9e8!important}

@media(max-width:640px){
  .title-monitoring{font-size:40px;letter-spacing:2px}
  .title-legal{font-size:18px;letter-spacing:8px}
  .tagline{font-size:24px}
  .cinema-block strong{font-size:16px}
  .form-row{flex-direction:column;gap:8px}
  .form-actions{flex-direction:column}
  .form-inner{padding:20px}
  .s{padding:20px 16px}
  .sc-wide{max-width:100%}
}
@media(prefers-reduced-motion:reduce){
  .sc{opacity:1;transform:none;transition:none}
  .cinema-block,.sw,.cat-group{opacity:1!important;transform:none!important}
  .bg-canvas{display:none}.page{background:#0c2230}
}
</style>
