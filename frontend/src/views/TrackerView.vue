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

    <!-- S2: "Monitoring" text reveal -->
    <section class="panel panel-short" :class="{ vis: scrollY > 150 }">
      <div class="panel-c">
        <span class="monitoring-text">Monitoring</span>
      </div>
    </section>

    <!-- S3: Headline -->
    <section class="panel" :class="{ vis: scrollY > 400 }">
      <div class="panel-c">
        <h1 class="h-main">Rechtsänderungen.</h1>
        <h1 class="h-main h-accent">Automatisch. Analysiert.</h1>
      </div>
    </section>

    <!-- S4: Features -->
    <section class="panel" :class="{ vis: scrollY > 900 }">
      <div class="panel-c panel-left">
        <div class="feat" v-for="(f, i) in features" :key="i"
          :style="{ transitionDelay: i*0.1+'s', opacity: scrollY > 950+i*70 ? 1 : 0, transform: scrollY > 950+i*70 ? 'none' : 'translateX(-20px)' }">
          <div class="feat-ico" v-html="f.icon"></div>
          <div><strong>{{ f.title }}</strong><br/><span class="feat-sub">{{ f.desc }}</span></div>
        </div>
      </div>
    </section>

    <!-- S5: Sources -->
    <section class="panel panel-short" :class="{ vis: scrollY > 1400 }">
      <div class="panel-c">
        <p class="src-label">Datenquellen</p>
        <div class="src-row">
          <span class="src" v-for="(s, i) in ['RIS','Findok','EUR-Lex','parlament.gv.at']" :key="i"
            :style="{ transitionDelay: i*0.08+'s', opacity: scrollY > 1450+i*30 ? 1 : 0, transform: scrollY > 1450+i*30 ? 'scale(1)' : 'scale(0.85)' }">{{ s }}</span>
        </div>
      </div>
    </section>

    <!-- S6: Category selection — tag cloud -->
    <section class="panel panel-cats" :class="{ vis: scrollY > 1700 }">
      <div class="panel-c">
        <h2 class="cat-title">Rechtsgebiete wählen</h2>
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

// 3D neural network renderer
function init3D() {
  const cvs = canvas3d.value; if (!cvs) return
  const ctx = cvs.getContext('2d')
  let W, H
  const nodes = []
  const NODE_COUNT = 80
  const CONNECT_DIST = 180

  function resize() {
    W = cvs.width = window.innerWidth
    H = cvs.height = window.innerHeight
  }
  resize()
  window.addEventListener('resize', resize)

  // Create nodes in 3D space
  for (let i = 0; i < NODE_COUNT; i++) {
    nodes.push({
      x: Math.random() * 2 - 1, // -1 to 1
      y: Math.random() * 2 - 1,
      z: Math.random() * 2 - 1,
      vx: (Math.random() - 0.5) * 0.002,
      vy: (Math.random() - 0.5) * 0.002,
      vz: (Math.random() - 0.5) * 0.001,
      r: 1.5 + Math.random() * 2,
      hue: Math.random() > 0.7 ? 30 : 185, // orange or teal
    })
  }

  function project(x, y, z, sY) {
    // Rotate based on scroll
    const rotX = sY * 0.0003
    const rotY = sY * 0.0002 + performance.now() * 0.00003
    // Rotate Y
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY)
    let rx = x * cosY - z * sinY
    let rz = x * sinY + z * cosY
    // Rotate X
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX)
    let ry = y * cosX - rz * sinX
    rz = y * sinX + rz * cosX
    // Perspective
    const fov = 2.5
    const scale = fov / (fov + rz + 1.5)
    return {
      sx: W / 2 + rx * W * 0.4 * scale,
      sy: H / 2 + ry * H * 0.35 * scale,
      scale,
      z: rz
    }
  }

  function draw() {
    const sY = scrollY.value
    ctx.clearRect(0, 0, W, H)

    // Update positions
    for (const n of nodes) {
      n.x += n.vx; n.y += n.vy; n.z += n.vz
      if (n.x > 1.2 || n.x < -1.2) n.vx *= -1
      if (n.y > 1.2 || n.y < -1.2) n.vy *= -1
      if (n.z > 1.2 || n.z < -1.2) n.vz *= -1
    }

    // Project all nodes
    const projected = nodes.map(n => ({ ...n, ...project(n.x, n.y, n.z, sY) }))
    projected.sort((a, b) => a.z - b.z) // painter's order

    // Draw connections
    for (let i = 0; i < projected.length; i++) {
      for (let j = i + 1; j < projected.length; j++) {
        const a = projected[i], b = projected[j]
        const dx = a.sx - b.sx, dy = a.sy - b.sy
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < CONNECT_DIST) {
          const alpha = (1 - dist / CONNECT_DIST) * 0.15 * Math.min(a.scale, b.scale)
          ctx.beginPath()
          ctx.moveTo(a.sx, a.sy)
          ctx.lineTo(b.sx, b.sy)
          ctx.strokeStyle = `rgba(34,201,232,${alpha})`
          ctx.lineWidth = 0.5
          ctx.stroke()
        }
      }
    }

    // Draw nodes
    for (const p of projected) {
      const r = p.r * p.scale
      const alpha = 0.3 + p.scale * 0.5
      ctx.beginPath()
      ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2)
      if (p.hue === 30) {
        ctx.fillStyle = `rgba(255,151,51,${alpha * 0.8})`
      } else {
        ctx.fillStyle = `rgba(34,201,232,${alpha * 0.6})`
      }
      ctx.fill()
      // Glow
      ctx.beginPath()
      ctx.arc(p.sx, p.sy, r * 3, 0, Math.PI * 2)
      const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r * 3)
      g.addColorStop(0, p.hue === 30 ? `rgba(255,151,51,${alpha * 0.15})` : `rgba(34,201,232,${alpha * 0.1})`)
      g.addColorStop(1, 'transparent')
      ctx.fillStyle = g
      ctx.fill()
    }

    animId = requestAnimationFrame(draw)
  }

  draw()
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
  { title: 'KI-Analyse', desc: 'GPT-Report mit Quellenangaben', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff9733" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>' },
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
.scroll-hint { margin-top: 40px; font-size: 20px; color: rgba(255,255,255,0.15); animation: hintBob 2s ease-in-out infinite; }
@keyframes hintBob { 0%,100%{transform:translateY(0);opacity:0.15} 50%{transform:translateY(8px);opacity:0.35} }

/* S2: Monitoring text */
.monitoring-text {
  font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 6px;
  color: #ff9733;
}

/* S3: Headline */
.h-main { font-size: 52px; font-weight: 800; line-height: 1.08; margin: 0; letter-spacing: -1.5px; text-shadow: 0 4px 40px rgba(0,0,0,0.5); }
.h-accent { color: #22c9e8; }

/* S4: Features */
.feat {
  display: flex; align-items: center; gap: 16px;
  padding: 18px 22px; margin-bottom: 10px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 14px;
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.feat-ico { flex-shrink: 0; }
.feat strong { font-size: 15px; }
.feat-sub { font-size: 12px; color: rgba(255,255,255,0.4); }

/* S5: Sources */
.src-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 3px; color: rgba(255,255,255,0.25); margin-bottom: 20px; }
.src-row { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
.src { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.65); padding: 8px 20px; border-radius: 10px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); transition: all 0.5s ease; }

/* S6: Category tag cloud */
.panel-cats { min-height: auto; padding-top: 60px; padding-bottom: 60px; }
.panel-cats .panel-c { max-width: 800px; text-align: left; }
.cat-title { font-size: 22px; font-weight: 700; margin: 0 0 28px; text-align: center; }

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
