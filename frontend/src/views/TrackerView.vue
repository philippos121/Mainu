<template>
<div class="page">
  <canvas ref="cvs" class="bg-canvas"></canvas>

  <div class="scroll-wrap">
    <!-- Intro -->
    <section class="s s-full reveal"><div class="sc">
      <img src="/logo.svg" alt="AI:ssociate" class="logo" />
      <div class="arrow"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg></div>
    </div></section>

    <section class="s s-full reveal"><div class="sc">
      <h2 class="t-legal">Legal</h2>
      <h2 class="t-monitoring">Monitoring</h2>
    </div></section>

    <section class="s s-full reveal"><div class="sc">
      <p class="tagline">Rechtsänderungen erkennen,<br/><em>bevor sie relevant werden.</em></p>
    </div></section>

    <!-- Rechtsgebiete — each appears as you scroll -->
    <section class="s s-rg reveal" v-for="(k, i) in kernList" :key="k.id">
      <div class="sc">
        <span class="rg-num">0{{ i + 1 }}</span>
        <h2 class="rg-name">{{ k.label }}</h2>
      </div>
    </section>

    <!-- Form -->
    <section class="s s-form">
      <div class="form-dock reveal" id="form-dock">
        <div class="form-inner">
          <p class="form-title">Report generieren</p>
          <div class="chips">
            <button v-for="k in kernList" :key="k.id" class="chip"
              :class="{ on: selectedCategory.includes(k.id) }"
              @click="toggleCat(k.id)">{{ k.label }}</button>
          </div>
          <div class="form-row">
            <div class="ff"><label>Zeitraum</label>
              <select v-model="selectedTimeframe" class="inp">
                <option v-for="t in timeframeOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </div>
          </div>
          <button class="btn-go" :disabled="!selectedCategory.length || generating" @click="generateReport">
            <span v-if="generating" class="spin"></span>
            <template v-else>Report erstellen ↓</template>
          </button>
          <p v-if="statusMsg" :class="['msg', statusOk ? 'msg-ok' : 'msg-err']">{{ statusMsg }}</p>
        </div>
      </div>
    </section>
  </div>
</div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import api from '../services/api'
import { KERN } from '../lib/journeyNodes.js'
import { createRenderer } from '../lib/canvasRenderer.js'

const cvs = ref(null)
let scrollY = 0, scrolling = false, scrollTimer = 0, renderer = null, observer = null, raf = 0
let renderLoop = () => {}

const kernList = KERN
const selectedCategory = ref(KERN.map(k => k.id))
const selectedTimeframe = ref('EinemMonat')
const timeframeOptions = ref([])
const generating = ref(false), statusMsg = ref(''), statusOk = ref(false)

function toggleCat(id) {
  const i = selectedCategory.value.indexOf(id)
  if (i >= 0) selectedCategory.value.splice(i, 1)
  else selectedCategory.value.push(id)
}

function onScroll() {
  scrollY = window.scrollY || document.documentElement.scrollTop || 0
  if (!scrolling) { scrolling = true; renderLoop() }
  clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => { scrolling = false }, 150)
}

function setupRenderer() {
  renderer = createRenderer(cvs.value)
  renderer.render(0, false)
  renderLoop = function () {
    if (!scrolling || !renderer) return
    renderer.render(scrollY, true)
    raf = requestAnimationFrame(renderLoop)
  }
}

function setupObserver() {
  if (observer) observer.disconnect()
  observer = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) e.target.classList.add('on')
  }, { threshold: 0.2 })
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el))
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  setupRenderer()
  requestAnimationFrame(setupObserver)
  Promise.all([api.get('/categories'), api.get('/timeframes')]).then(([, b]) => {
    timeframeOptions.value = [...b.data, { value: 'custom', label: 'Benutzerdefiniert…' }]
  }).catch(() => { statusMsg.value = 'Verbindung fehlgeschlagen.'; statusOk.value = false })
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  cancelAnimationFrame(raf)
  if (renderer) renderer.destroy()
  if (observer) observer.disconnect()
})

async function doSearch() {
  const cats = selectedCategory.value || []
  const tf = selectedTimeframe.value
  const ends = ['/search/gesetze', '/search/gerichtsentscheidungen']
  const all = []; let hits = 0; const seen = new Set()
  for (const e of ends) {
    const ps = cats.map(c => api.get(e, { params: { im_ris_seit: tf, page: 1, category: c } }).catch(() => ({ data: { results: [], total_hits: 0 } })))
    const rs = await Promise.all(ps)
    for (const r of rs) { hits += r.data.total_hits || 0; for (const i of (r.data.results || [])) if (!seen.has(i.id)) { seen.add(i.id); all.push(i) } }
  }
  return { results: all, total_hits: hits }
}

function catLabel() {
  const c = selectedCategory.value
  if (c.length === KERN.length) return 'Alle Kernrechtsgebiete'
  if (c.length === 1) { const f = KERN.find(x => x.id === c[0]); return f ? f.label : '' }
  return `${c.length} Rechtsgebiete`
}
function tfLabel() { const t = timeframeOptions.value.find(x => x.value === selectedTimeframe.value); return t ? t.label : '' }

async function generateReport() {
  if (!selectedCategory.value.length) return
  generating.value = true; statusMsg.value = 'Suche läuft…'; statusOk.value = true
  try {
    const d = await doSearch()
    if (!d.results?.length) { statusMsg.value = 'Keine Ergebnisse.'; statusOk.value = false; return }
    statusMsg.value = `${d.results.length} Ergebnisse — KI-Analyse läuft…`
    const r = await api.post('/report', { results: d.results, doc_type: 'gesetze', category_label: catLabel(), timeframe_label: tfLabel(), total_hits: d.total_hits, diffs: {} })
    const b = new Blob([r.data.report_html], { type: 'text/html;charset=utf-8' })
    const u = URL.createObjectURL(b); const a = document.createElement('a')
    a.href = u; a.download = `AI-ssociate_Report_${new Date().toISOString().split('T')[0]}.html`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u)
    statusMsg.value = 'Report heruntergeladen.'; statusOk.value = true
  } catch (e) { statusMsg.value = e.response?.data?.detail || `Fehler: ${e.message}`; statusOk.value = false }
  finally { generating.value = false }
}
</script>

<style scoped>
.page{min-height:100vh;background:#070e12;color:#e4f0f2}
.bg-canvas{position:fixed;inset:0;z-index:0;width:100%;height:100%;pointer-events:none;touch-action:none;contain:strict}
.scroll-wrap{position:relative;z-index:2;will-change:transform;transform:translateZ(0)}

.s{display:flex;align-items:center;justify-content:center;padding:24px}
.s-full{min-height:100vh}
.sc{text-align:center;max-width:680px;width:100%}

/* Reveal */
.reveal>.sc,.reveal>.form-inner{opacity:0;transform:translateY(40px);transition:opacity .8s cubic-bezier(.16,1,.3,1),transform .8s cubic-bezier(.16,1,.3,1)}
.reveal.on>.sc,.reveal.on>.form-inner{opacity:1;transform:none}

/* Logo */
.logo{height:60px;filter:brightness(10)}
.arrow{margin-top:48px;animation:bob 2.5s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0);opacity:.15}50%{transform:translateY(8px);opacity:.35}}

/* Titles */
.t-legal{font-size:22px;font-weight:300;letter-spacing:12px;text-transform:uppercase;color:rgba(255,255,255,.35);margin:0 0 8px}
.t-monitoring{font-size:60px;font-weight:800;letter-spacing:3px;text-transform:uppercase;margin:0;background:linear-gradient(135deg,#ff9733,#ffbe6d 40%,#ff9733 80%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.tagline{font-size:30px;font-weight:300;line-height:1.5;color:rgba(255,255,255,.6);margin:0}
.tagline em{font-style:normal;color:#22c9e8;font-weight:500}

/* Rechtsgebiete sections */
.s-rg{min-height:70vh}
.rg-num{font-size:12px;font-weight:700;color:rgba(34,201,232,.35);letter-spacing:3px;display:block;margin-bottom:8px}
.rg-name{font-size:36px;font-weight:700;color:rgba(255,255,255,.85);letter-spacing:-.5px;margin:0}

/* Form */
.s-form{min-height:auto;position:sticky;bottom:0;padding:0 24px}
.form-dock{max-width:600px;margin:0 auto}
.form-inner{background:#0a1820;border-radius:16px 16px 0 0;border:1px solid rgba(255,255,255,.06);border-bottom:none;padding:22px 26px 26px;box-shadow:0 -8px 40px rgba(0,0,0,.5)}
.form-title{font-size:15px;font-weight:700;margin:0 0 14px;color:rgba(255,255,255,.6)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}
.chip{padding:5px 12px;border-radius:99px;border:1px solid rgba(255,255,255,.07);background:transparent;color:rgba(255,255,255,.4);font-size:11px;font-weight:500;font-family:inherit;cursor:pointer;transition:all .2s}
.chip:hover{color:rgba(255,255,255,.65);border-color:rgba(34,201,232,.2)}
.chip.on{color:#22c9e8;border-color:rgba(34,201,232,.35);background:rgba(34,201,232,.07)}
.form-row{margin-bottom:12px}
.ff{flex:1;min-width:0}
.ff label{display:block;font-size:11px;font-weight:600;color:rgba(255,255,255,.35);margin-bottom:4px}
.inp{width:100%;padding:9px 12px;border:1px solid rgba(255,255,255,.06);border-radius:8px;font-size:13px;font-family:inherit;outline:none;background:rgba(255,255,255,.03);color:#e4f0f2}
.inp:focus{border-color:rgba(34,201,232,.3)}
select.inp{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:28px}
select.inp option{background:#0b1922;color:#e4f0f2}
.btn-go{width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#ff9733,#e8870a);color:#fff;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;box-shadow:0 4px 16px rgba(255,151,51,.2);transition:all .2s;display:flex;align-items:center;justify-content:center;gap:6px;margin-top:6px}
.btn-go:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 24px rgba(255,151,51,.3)}
.btn-go:disabled{opacity:.3;cursor:not-allowed}
.msg{margin-top:10px;padding:8px 12px;border-radius:8px;font-size:12px}
.msg-ok{background:rgba(16,185,129,.08);color:#34d399;border:1px solid rgba(16,185,129,.1)}
.msg-err{background:rgba(239,68,68,.08);color:#f87171;border:1px solid rgba(239,68,68,.1)}
.spin{width:16px;height:16px;border:2px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:sp .6s linear infinite;display:inline-block}
@keyframes sp{to{transform:rotate(360deg)}}

@media(max-width:640px){.t-monitoring{font-size:38px;letter-spacing:2px}.t-legal{font-size:16px;letter-spacing:8px}.tagline{font-size:22px}.rg-name{font-size:28px}.form-inner{padding:18px}.s{padding:20px 16px}}
@media(prefers-reduced-motion:reduce){.reveal>.sc,.reveal>.form-inner{opacity:1;transform:none;transition:none}.bg-canvas{display:none}.page{background:#0c2230}}
</style>
