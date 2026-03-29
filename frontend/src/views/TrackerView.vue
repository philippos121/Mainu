<template>
<div class="page">
  <!-- 3D Neural network canvas -->
  <canvas ref="canvas3d" class="bg-canvas"></canvas>

  <!-- Scroll content -->
  <div class="scroll-content">

    <!-- S1: Logo -->
    <section class="panel" :class="{ vis: true }">
      <div class="panel-c">
        <img src="/logo.svg" alt="AI:ssociate" class="logo" />
        <p class="scroll-hint">↓</p>
      </div>
    </section>

    <!-- S2: "Monitoring" reveal -->
    <section class="panel panel-short" :class="{ vis: scrollY > 150 }">
      <div class="panel-c">
        <h2 class="monitoring-text">Monitoring</h2>
        <p class="monitoring-sub">Ihr Rechtsradar für Österreich und die EU</p>
      </div>
    </section>

    <!-- S3: Headline -->
    <section class="panel" :class="{ vis: scrollY > 400 }">
      <div class="panel-c">
        <h1 class="h-main">Rechtsänderungen.</h1>
        <h1 class="h-main h-accent">Automatisch.<br/>Analysiert.</h1>
        <p class="h-sub">Gesetze, Verordnungen, Entscheidungen und BMF-Richtlinien —<br/>alle Novellen im Blick, KI-gestützt zusammengefasst.</p>
      </div>
    </section>

    <!-- S4: Features -->
    <section class="panel" :class="{ vis: scrollY > 900 }">
      <div class="panel-c panel-left">
        <p class="sec-label">Was wir liefern</p>
        <div class="feat" v-for="(f, i) in features" :key="i"
          :style="{ transitionDelay: i*0.1+'s', opacity: scrollY > 950+i*70 ? 1 : 0, transform: scrollY > 950+i*70 ? 'none' : 'translateX(-30px)' }">
          <div class="feat-ico" v-html="f.icon"></div>
          <div><strong>{{ f.title }}</strong><br/><span class="feat-sub">{{ f.desc }}</span></div>
        </div>
      </div>
    </section>

    <!-- S5: Sources -->
    <section class="panel panel-short" :class="{ vis: scrollY > 1400 }">
      <div class="panel-c">
        <p class="sec-label">Datenquellen — live angebunden</p>
        <div class="src-row">
          <span class="src" v-for="(s, i) in sources" :key="i"
            :style="{ transitionDelay: i*0.08+'s', opacity: scrollY > 1450+i*30 ? 1 : 0, transform: scrollY > 1450+i*30 ? 'scale(1)' : 'scale(0.85)' }">
            <strong>{{ s.name }}</strong>
            <span>{{ s.desc }}</span>
          </span>
        </div>
      </div>
    </section>

    <!-- S6: Category selection -->
    <section class="panel panel-cats" :class="{ vis: scrollY > 1700 }">
      <div class="panel-c">
        <h2 class="cat-title">Wählen Sie Ihre Rechtsgebiete</h2>
        <p class="cat-sub">Klicken Sie auf die relevanten Bereiche — der Report deckt alles ab.</p>
        <div class="cat-groups" v-if="catGroups.length">
          <div class="cat-group" v-for="(g, gi) in catGroups" :key="gi"
            :style="{ transitionDelay: gi*0.06+'s', opacity: scrollY > 1750+gi*30 ? 1 : 0, transform: scrollY > 1750+gi*30 ? 'none' : 'translateY(12px)' }">
            <p class="cg-label">{{ g.group }}</p>
            <div class="cg-tags">
              <button v-for="c in g.items" :key="c.id"
                class="tag" :class="{ active: selectedCategory.includes(c.id) }"
                @click="toggleCat(c.id)">{{ c.label }}</button>
            </div>
          </div>
        </div>
        <div v-if="selectedCategory.length" class="cat-selected">
          {{ selectedCategory.length }} ausgewählt
          <button class="cat-clear" @click="selectedCategory = []">Alle abwählen</button>
        </div>
      </div>
    </section>

    <!-- S7: Form — sticky -->
    <section class="panel panel-form">
      <div class="form-sticky" :class="{ vis: scrollY > 2200 || selectedCategory.length > 0 }">
        <div class="form-card">
          <div class="field-row">
            <div class="field fh">
              <label>Zeitraum</label>
              <v-select v-model="selectedTimeframe" :items="timeframeOptions" item-title="label" item-value="value"
                variant="outlined" density="compact" hide-details color="#22c9e8" />
            </div>
            <div class="field fh">
              <label>E-Mail</label>
              <input v-model="reportEmail" type="email" placeholder="name@kanzlei.at" class="inp" />
            </div>
          </div>
          <div v-if="selectedTimeframe === 'custom'" class="field-row">
            <div class="field fh"><label>Von</label><input v-model="datumVon" type="date" class="inp" /></div>
            <div class="field fh"><label>Bis</label><input v-model="datumBis" type="date" class="inp" /></div>
          </div>
          <div class="actions">
            <button class="btn-p" :disabled="!reportEmail || !selectedCategory.length || sending" @click="sendReport">
              <span v-if="sending" class="spin"></span>
              <template v-else>Report senden →</template>
            </button>
            <button class="btn-g" :disabled="!selectedCategory.length || generating" @click="downloadReport">
              <span v-if="generating" class="spin spin-d"></span>
              <template v-else>↓ Download</template>
            </button>
          </div>
          <div v-if="statusMsg" :class="['sts', statusOk ? 'sts-ok' : 'sts-err']">{{ statusMsg }}</div>
        </div>
      </div>
    </section>

  </div>
</div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import api from '../services/api'

const canvas3d = ref(null)
const scrollY = ref(0)
let animId = 0

function onScroll() { scrollY.value = window.scrollY }

// 3D neural network renderer — optimized for instant scroll
function init3D() {
  const cvs = canvas3d.value; if (!cvs) return
  const ctx = cvs.getContext('2d', { alpha: false })
  let W = 0, H = 0
  const N = 55 // fewer nodes = faster
  const DIST_SQ = 160 * 160 // squared distance, skip sqrt
  const PI2 = Math.PI * 2

  // Pre-allocated arrays (no GC pressure)
  const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N)
  const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N)
  const nr = new Float32Array(N), nh = new Uint8Array(N) // radius, hue flag
  const sx = new Float32Array(N), sy = new Float32Array(N), sc = new Float32Array(N)

  for (let i = 0; i < N; i++) {
    px[i] = Math.random() * 2 - 1
    py[i] = Math.random() * 2 - 1
    pz[i] = Math.random() * 2 - 1
    vx[i] = (Math.random() - 0.5) * 0.0015
    vy[i] = (Math.random() - 0.5) * 0.0015
    vz[i] = (Math.random() - 0.5) * 0.001
    nr[i] = 1.5 + Math.random() * 2
    nh[i] = Math.random() > 0.7 ? 1 : 0
  }

  function resize() {
    W = cvs.width = window.innerWidth
    H = cvs.height = window.innerHeight
  }
  resize()
  window.addEventListener('resize', resize)

  function draw() {
    const sY = scrollY.value
    const now = performance.now()

    // Trig for rotation (compute once per frame)
    const rotY = sY * 0.0002 + now * 0.00003
    const rotX = sY * 0.0003
    const cosRY = Math.cos(rotY), sinRY = Math.sin(rotY)
    const cosRX = Math.cos(rotX), sinRX = Math.sin(rotX)
    const hw = W * 0.5, hh = H * 0.5, sw = W * 0.4, sh = H * 0.35

    // Update + project
    for (let i = 0; i < N; i++) {
      let x = px[i] += vx[i], y = py[i] += vy[i], z = pz[i] += vz[i]
      if (x > 1.2 || x < -1.2) vx[i] *= -1
      if (y > 1.2 || y < -1.2) vy[i] *= -1
      if (z > 1.2 || z < -1.2) vz[i] *= -1
      // Rotate Y then X
      const rx = x * cosRY - z * sinRY
      let rz = x * sinRY + z * cosRY
      const ry = y * cosRX - rz * sinRX
      rz = y * sinRX + rz * cosRX
      const s = 2.5 / (2.5 + rz + 1.5)
      sx[i] = hw + rx * sw * s
      sy[i] = hh + ry * sh * s
      sc[i] = s
    }

    // Clear with bg color (faster than clearRect + fillRect)
    ctx.fillStyle = '#070e12'
    ctx.fillRect(0, 0, W, H)

    // Batch all connections in one path per alpha band (3 bands)
    ctx.lineWidth = 0.6
    for (let band = 0; band < 3; band++) {
      ctx.beginPath()
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = sx[i] - sx[j], dy = sy[i] - sy[j]
          const dSq = dx * dx + dy * dy
          if (dSq < DIST_SQ) {
            const a = (1 - dSq / DIST_SQ) * 0.18 * Math.min(sc[i], sc[j])
            const b3 = (a * 3) | 0 // 0,1,2
            if (b3 === band) {
              ctx.moveTo(sx[i], sy[i])
              ctx.lineTo(sx[j], sy[j])
            }
          }
        }
      }
      ctx.strokeStyle = `rgba(34,201,232,${0.04 + band * 0.05})`
      ctx.stroke()
    }

    // Draw nodes (no glow gradients — just solid circles + larger faded circle)
    for (let i = 0; i < N; i++) {
      const r = nr[i] * sc[i]
      const a = 0.3 + sc[i] * 0.5
      // Outer glow (simple filled circle, no gradient)
      ctx.beginPath()
      ctx.arc(sx[i], sy[i], r * 2.5, 0, PI2)
      ctx.fillStyle = nh[i] ? `rgba(255,151,51,${a * 0.08})` : `rgba(34,201,232,${a * 0.06})`
      ctx.fill()
      // Core
      ctx.beginPath()
      ctx.arc(sx[i], sy[i], r, 0, PI2)
      ctx.fillStyle = nh[i] ? `rgba(255,151,51,${a * 0.8})` : `rgba(34,201,232,${a * 0.6})`
      ctx.fill()
    }

    animId = requestAnimationFrame(draw)
  }

  // Delay first frame slightly to not block initial paint
  animId = requestAnimationFrame(() => { animId = requestAnimationFrame(draw) })

  return () => {
    cancelAnimationFrame(animId)
    window.removeEventListener('resize', resize)
  }
}

let cleanup3d = null
onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  cleanup3d = init3D()
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  if (cleanup3d) cleanup3d()
})

const features = [
  { title: '86 Rechtsgebiete', desc: 'Vollständige RIS-Dezimalklassifikation', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c9e8" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>' },
  { title: 'Versionsvergleich', desc: 'Inkrafttreten vs. Vorfassung', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c9e8" stroke-width="1.5"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>' },
  { title: 'Gesetzesmaterialien', desc: 'Erläuterungen von parlament.gv.at', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c9e8" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>' },
  { title: 'KI-Analyse', desc: 'GPT-Report mit Quellenangaben — sachlich, juristisch, klickbar', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff9733" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>' },
]

const sources = [
  { name: 'RIS', desc: 'Bundesrecht & Judikatur' },
  { name: 'Findok', desc: 'BMF-Richtlinien & BFG' },
  { name: 'EUR-Lex', desc: 'EU-Verordnungen & Richtlinien' },
  { name: 'parlament.gv.at', desc: 'Materialien & Erläuterungen' },
]

const categories = ref([])
const timeframes = ref([])
const selectedCategory = ref([])
const selectedTimeframe = ref('EinemMonat')
const datumVon = ref('')
const datumBis = ref('')
const reportEmail = ref(localStorage.getItem('ris_report_email') || '')
const timeframeOptions = ref([])
const sending = ref(false)
const generating = ref(false)
const statusMsg = ref('')
const statusOk = ref(false)

const catGroups = computed(() => {
  const groups = {}
  for (const c of categories.value) {
    const g = c.group || 'Sonstige'
    if (!groups[g]) groups[g] = []
    groups[g].push(c)
  }
  return Object.entries(groups).map(([group, items]) => ({ group, items }))
})

function toggleCat(id) {
  const idx = selectedCategory.value.indexOf(id)
  if (idx >= 0) selectedCategory.value.splice(idx, 1)
  else selectedCategory.value.push(id)
}

watch(reportEmail, v => { if(v) localStorage.setItem('ris_report_email',v) })

onMounted(async () => {
  try {
    const [a,b] = await Promise.all([api.get('/categories'), api.get('/timeframes')])
    categories.value = a.data; timeframes.value = b.data
    timeframeOptions.value = [...b.data, { value: 'custom', label: 'Benutzerdefiniert…' }]
  } catch { statusMsg.value = 'Verbindung fehlgeschlagen.'; statusOk.value = false }
})

async function doSearch() {
  const cats = selectedCategory.value || []
  const isCustom = selectedTimeframe.value === 'custom'
  const tf = isCustom ? 'EinemJahr' : selectedTimeframe.value
  const extraParams = isCustom && datumVon.value && datumBis.value ? { datum_von: datumVon.value, datum_bis: datumBis.value } : {}
  const endpoints = ['/search/gesetze', '/search/gerichtsentscheidungen']
  const allResults = []; let allHits = 0; const seen = new Set()
  for (const ep of endpoints) {
    if (cats.length <= 1) {
      const p = { im_ris_seit: tf, page: 1, ...extraParams }
      if (cats.length === 1) p.category = cats[0]
      try { const r = (await api.get(ep, { params: p })).data; allHits += r.total_hits || 0; for (const i of (r.results||[])) { if(!seen.has(i.id)){seen.add(i.id);allResults.push(i)} } } catch {}
    } else {
      const ps = cats.map(c => api.get(ep, { params: { im_ris_seit: tf, page: 1, category: c, ...extraParams } }).catch(()=>({data:{results:[],total_hits:0}})))
      const rs = await Promise.all(ps)
      for (const r of rs) { allHits += r.data.total_hits || 0; for (const i of (r.data.results||[])) { if(!seen.has(i.id)){seen.add(i.id);allResults.push(i)} } }
    }
  }
  return { results: allResults, total_hits: allHits }
}
function catLabel() { const c=selectedCategory.value||[]; if(!c.length) return 'Alle'; if(c.length===1){const f=categories.value.find(x=>x.id===c[0]);return f?f.label:''} return `${c.length} Rechtsgebiete` }
function tfLabel() { if(selectedTimeframe.value==='custom'&&datumVon.value&&datumBis.value) return `${datumVon.value} bis ${datumBis.value}`; const t=timeframes.value.find(x=>x.value===selectedTimeframe.value); return t?t.label:'' }

async function sendReport() {
  if(!reportEmail.value||!selectedCategory.value.length) return
  sending.value=true; statusMsg.value='Suche läuft…'; statusOk.value=true
  try { const data=await doSearch(); if(!data.results?.length){statusMsg.value='Keine Ergebnisse.';statusOk.value=false;return}; statusMsg.value=`${data.results.length} Ergebnisse. Report wird versendet…`; await api.post('/report/email',{email:reportEmail.value,results:data.results,doc_type:'gesetze',category_label:catLabel(),timeframe_label:tfLabel(),total_hits:data.total_hits,diffs:{}}); statusMsg.value=`Report an ${reportEmail.value} gesendet.`;statusOk.value=true }
  catch(e){statusMsg.value=e.response?.data?.detail||`Fehler: ${e.message}`;statusOk.value=false} finally{sending.value=false}
}
async function downloadReport() {
  if(!selectedCategory.value.length) return
  generating.value=true; statusMsg.value='Suche läuft…'; statusOk.value=true
  try { const data=await doSearch(); if(!data.results?.length){statusMsg.value='Keine Ergebnisse.';statusOk.value=false;return}; statusMsg.value=`${data.results.length} Ergebnisse. Report wird erstellt…`; const r=await api.post('/report',{results:data.results,doc_type:'gesetze',category_label:catLabel(),timeframe_label:tfLabel(),total_hits:data.total_hits,diffs:{}}); const bl=new Blob([r.data.report_html],{type:'text/html;charset=utf-8'});const u=URL.createObjectURL(bl);const a=document.createElement('a');a.href=u;a.download=`Report_${new Date().toISOString().split('T')[0]}.html`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u); statusMsg.value='Report heruntergeladen.';statusOk.value=true }
  catch(e){statusMsg.value=e.response?.data?.detail||`Fehler: ${e.message}`;statusOk.value=false} finally{generating.value=false}
}
</script>

<style scoped>
.page { min-height: 100vh; background: #070e12; color: #e8f4f6; overflow-x: hidden; }

/* ── 3D Canvas ── */
.bg-canvas { position: fixed; inset: 0; z-index: 0; width: 100%; height: 100%; }

/* ── Scroll content ── */
.scroll-content { position: relative; z-index: 2; }

.panel { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.panel-short { min-height: 60vh; }
.panel-c { text-align: center; max-width: 640px; width: 100%; opacity: 0; transform: translateY(40px); transition: opacity 0.9s cubic-bezier(0.16,1,0.3,1), transform 0.9s cubic-bezier(0.16,1,0.3,1); }
.panel.vis .panel-c { opacity: 1; transform: translateY(0); }
.panel-left { text-align: left; }

/* S1: Logo */
.logo { height: 56px; filter: brightness(10); }
.scroll-hint { margin-top: 48px; font-size: 18px; color: rgba(255,255,255,0.12); animation: hintBob 2.5s ease-in-out infinite; }
@keyframes hintBob { 0%,100%{transform:translateY(0);opacity:0.12} 50%{transform:translateY(10px);opacity:0.3} }

/* S2: Monitoring */
.monitoring-text {
  font-size: 42px; font-weight: 800; letter-spacing: 8px; text-transform: uppercase;
  margin: 0;
  background: linear-gradient(135deg, #ff9733, #ffb347, #ff9733);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 2px 20px rgba(255,151,51,0.3));
}
.monitoring-sub {
  font-size: 15px; color: rgba(255,255,255,0.35); margin-top: 12px;
  letter-spacing: 1px; font-weight: 400;
}

/* S3: Headline */
.h-main {
  font-size: 56px; font-weight: 800; line-height: 1.05; margin: 0;
  letter-spacing: -2px;
  text-shadow: 0 4px 40px rgba(0,0,0,0.5);
}
.h-accent { color: #22c9e8; }
.h-sub {
  font-size: 16px; color: rgba(255,255,255,0.4); margin-top: 24px;
  line-height: 1.7; font-weight: 400; letter-spacing: 0.2px;
}

/* Section labels */
.sec-label {
  font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px;
  color: rgba(34,201,232,0.5); margin-bottom: 24px;
}

/* S4: Features */
.feat {
  display: flex; align-items: flex-start; gap: 18px;
  padding: 22px 24px; margin-bottom: 12px;
  background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.05);
  border-radius: 16px; transition: opacity 0.6s ease, transform 0.6s ease;
}
.feat:hover { background: rgba(255,255,255,0.04); border-color: rgba(34,201,232,0.15); }
.feat-ico { flex-shrink: 0; margin-top: 2px; }
.feat strong { font-size: 16px; font-weight: 700; letter-spacing: -0.3px; }
.feat-sub { font-size: 13px; color: rgba(255,255,255,0.4); line-height: 1.5; margin-top: 2px; display: inline-block; }

/* S5: Sources */
.src-row { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; }
.src {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 14px 24px; border-radius: 14px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
  transition: all 0.5s ease; min-width: 130px;
}
.src strong { font-size: 15px; font-weight: 700; color: rgba(255,255,255,0.8); }
.src span { font-size: 11px; color: rgba(255,255,255,0.35); text-align: center; }

/* S6: Categories */
.panel-cats { min-height: auto; padding-top: 80px; padding-bottom: 80px; }
.panel-cats .panel-c { max-width: 800px; text-align: left; }
.cat-title {
  font-size: 28px; font-weight: 800; margin: 0 0 8px; text-align: center;
  letter-spacing: -0.5px;
}
.cat-sub {
  font-size: 14px; color: rgba(255,255,255,0.35); text-align: center;
  margin: 0 0 36px;
}

.cat-group { margin-bottom: 20px; transition: opacity 0.5s ease, transform 0.5s ease; }
.cg-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px; color: rgba(255,255,255,0.3); margin: 0 0 10px; }
.cg-tags { display: flex; flex-wrap: wrap; gap: 8px; }

.tag {
  padding: 7px 16px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.6);
  font-size: 13px; font-weight: 500; font-family: inherit; cursor: pointer;
  transition: all 0.2s;
}
.tag:hover { border-color: rgba(34,201,232,0.3); color: rgba(255,255,255,0.85); background: rgba(34,201,232,0.06); }
.tag.active {
  background: rgba(34,201,232,0.15); border-color: rgba(34,201,232,0.4);
  color: #22c9e8; font-weight: 600;
}

.cat-selected {
  text-align: center; margin-top: 20px; font-size: 13px; color: rgba(255,255,255,0.5);
}
.cat-clear {
  background: none; border: none; color: #22c9e8; font-size: 13px; font-family: inherit;
  cursor: pointer; text-decoration: underline; margin-left: 8px;
}

/* S7: Form sticky */
.panel-form { min-height: auto; position: sticky; bottom: 0; padding: 0 24px 0; align-items: flex-end; }
.form-sticky {
  max-width: 600px; margin: 0 auto; width: 100%;
  opacity: 0; transform: translateY(20px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.form-sticky.vis { opacity: 1; transform: translateY(0); }

.form-card {
  background: rgba(10,25,33,0.9); backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
  border-radius: 20px 20px 0 0; border: 1px solid rgba(255,255,255,0.08); border-bottom: none;
  padding: 28px 32px 32px;
  box-shadow: 0 -8px 40px rgba(0,0,0,0.5);
}

.field { margin-bottom: 14px; }
.field label { display: block; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.5); margin-bottom: 5px; }
.field-row { display: flex; gap: 12px; }
.fh { flex: 1; min-width: 0; }

.inp {
  width: 100%; padding: 11px 14px; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
  font-size: 14px; font-family: inherit; outline: none;
  background: rgba(255,255,255,0.04); color: #e8f4f6; transition: border-color 0.2s, box-shadow 0.2s;
}
.inp:focus { border-color: rgba(34,201,232,0.4); box-shadow: 0 0 0 3px rgba(34,201,232,0.08); }
.inp::placeholder { color: rgba(255,255,255,0.18); }

.actions { display: flex; gap: 10px; margin-top: 20px; }
.btn-p {
  flex: 1; padding: 14px; border: none; border-radius: 12px;
  background: linear-gradient(135deg, #ff9733, #e8870a); color: white;
  font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer;
  box-shadow: 0 4px 20px rgba(255,151,51,0.25); transition: all 0.2s;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.btn-p:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 28px rgba(255,151,51,0.4); }
.btn-p:disabled { opacity: 0.35; cursor: not-allowed; }
.btn-g {
  padding: 14px 20px; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
  background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.7); font-size: 14px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.btn-g:hover:not(:disabled) { border-color: rgba(34,201,232,0.3); color: #22c9e8; }
.btn-g:disabled { opacity: 0.35; cursor: not-allowed; }

.sts { margin-top: 14px; padding: 10px 14px; border-radius: 10px; font-size: 13px; }
.sts-ok { background: rgba(16,185,129,0.1); color: #34d399; border: 1px solid rgba(16,185,129,0.15); }
.sts-err { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.15); }

.spin { width: 18px; height: 18px; border: 2.5px solid rgba(255,255,255,0.2); border-top-color: white; border-radius: 50%; animation: sp .6s linear infinite; display: inline-block; }
.spin-d { border-color: rgba(255,255,255,0.1); border-top-color: #22c9e8; }
@keyframes sp { to { transform: rotate(360deg) } }

/* Vuetify dark */
:deep(.v-field) { background: rgba(255,255,255,0.04) !important; border-color: rgba(255,255,255,0.08) !important; color: #e8f4f6 !important; border-radius: 10px !important; }
:deep(.v-field__input) { color: #e8f4f6 !important; }
:deep(.v-field--focused) { border-color: rgba(34,201,232,0.4) !important; }
:deep(.v-chip) { background: rgba(34,201,232,0.12) !important; color: #22c9e8 !important; }
:deep(.v-select__selection-text) { color: #e8f4f6 !important; }
:deep(.v-field__append-inner .v-icon) { color: rgba(255,255,255,0.3) !important; }
:deep(.v-list) { background: #0c1c25 !important; border: 1px solid rgba(255,255,255,0.06) !important; border-radius: 10px !important; }
:deep(.v-list-item) { color: #e8f4f6 !important; }
:deep(.v-list-item:hover) { background: rgba(34,201,232,0.06) !important; }
:deep(.v-list-item--active) { background: rgba(34,201,232,0.1) !important; color: #22c9e8 !important; }

@media (max-width: 640px) {
  .h-main { font-size: 34px; }
  .field-row { flex-direction: column; gap: 0; }
  .actions { flex-direction: column; }
  .form-card { padding: 20px; }
  .panel { padding: 20px 16px; }
  .panel-cats .panel-c { max-width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .panel-c { opacity: 1; transform: none; transition: none; }
  .feat, .src, .cat-group { opacity: 1 !important; transform: none !important; }
  .bg-canvas { display: none; }
  .page { background: #0c2230; }
}
</style>
