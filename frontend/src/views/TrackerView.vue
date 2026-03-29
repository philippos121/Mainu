<template>
<div class="page">
  <canvas ref="cvs" class="bg-canvas"></canvas>

  <div id="node-label" class="node-label">
    <span class="nl-title"></span>
    <span class="nl-sub"></span>
  </div>

  <div class="scroll-wrap">
    <!-- Phase 1: Intro -->
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

    <!-- Phase 2: Journey through Kernrechtsgebiete -->
    <section class="s-journey" id="journey"></section>

    <!-- Phase 3: Config + Download -->
    <section class="s s-form">
      <div class="form-dock" id="form-dock">
        <div class="form-inner">
          <p class="form-title">Report generieren</p>
          <div class="kern-chips">
            <button v-for="k in kernList" :key="k.id" class="kc"
              :class="{ active: selectedCategory.includes(k.id) }"
              @click="toggleCat(k.id)">{{ k.label }}</button>
          </div>
          <div class="form-row">
            <div class="ff"><label>Zeitraum</label>
              <select v-model="selectedTimeframe" class="inp">
                <option v-for="t in timeframeOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </div>
          </div>
          <button class="btn-go" :disabled="!selectedCategory.length||generating" @click="generateReport">
            <span v-if="generating" class="spin"></span>
            <template v-else>Report erstellen ↓</template>
          </button>
          <p v-if="statusMsg" :class="['msg',statusOk?'msg-ok':'msg-err']">{{ statusMsg }}</p>
        </div>
      </div>
    </section>
  </div>
</div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import api from '../services/api'
import { KERN, activeNode } from '../lib/journeyNodes.js'
import { createRenderer } from '../lib/canvasRenderer.js'

const cvs = ref(null)
let scrollY = 0, scrolling = false, scrollTimer = 0, renderer = null, observer = null, raf = 0
let journeyDone = false, renderLoop = () => {}
const P2_START = 2000, P2_END = 6000

const kernList = KERN
const selectedCategory = ref([])
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
  updateJourney()
}

function updateJourney() {
  const label = document.getElementById('node-label')
  if (!label) return
  const { index, frac, t } = activeNode(scrollY, P2_START, P2_END)
  if (scrollY < P2_START - 200 || scrollY > P2_END + 200) { label.style.opacity = '0'; return }
  const node = KERN[index]
  if (!node) return
  label.style.opacity = String(Math.min(1, frac * 1.5))
  label.querySelector('.nl-title').textContent = node.label
  label.querySelector('.nl-sub').textContent = node.sub
  if (t > 0.95 && !journeyDone) {
    journeyDone = true
    selectedCategory.value = KERN.map(k => k.id)
    document.getElementById('form-dock')?.classList.add('on')
  }
}

function setupRenderer() {
  renderer = createRenderer(cvs.value)
  renderer.render(0, false, 0, 0, 0)
  renderLoop = function () {
    if (!scrolling || !renderer) return
    const an = activeNode(scrollY, P2_START, P2_END)
    const jt = Math.max(0, Math.min(1, (scrollY - P2_START) / (P2_END - P2_START)))
    renderer.render(scrollY, true, jt, an.index, an.frac)
    raf = requestAnimationFrame(renderLoop)
  }
}

function setupObserver() {
  if (observer) observer.disconnect()
  observer = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) e.target.classList.add('on')
  }, { threshold: 0.15 })
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
  const tf = selectedTimeframe.value === 'custom' ? 'EinemJahr' : selectedTimeframe.value
  const ends = ['/search/gesetze', '/search/gerichtsentscheidungen']
  const all = []; let hits = 0; const seen = new Set()
  for (const e of ends) {
    if (cats.length <= 1) {
      const p = { im_ris_seit: tf, page: 1 }; if (cats.length === 1) p.category = cats[0]
      try { const r = (await api.get(e, { params: p })).data; hits += r.total_hits || 0; for (const i of (r.results || [])) if (!seen.has(i.id)) { seen.add(i.id); all.push(i) } } catch {}
    } else {
      const ps = cats.map(c => api.get(e, { params: { im_ris_seit: tf, page: 1, category: c } }).catch(() => ({ data: { results: [], total_hits: 0 } })))
      const rs = await Promise.all(ps)
      for (const r of rs) { hits += r.data.total_hits || 0; for (const i of (r.data.results || [])) if (!seen.has(i.id)) { seen.add(i.id); all.push(i) } }
    }
  }
  return { results: all, total_hits: hits }
}

function catLabel() {
  const c = selectedCategory.value
  if (!c.length) return 'Alle'
  if (c.length === 1) { const f = KERN.find(x => x.id === c[0]); return f ? f.label : '' }
  return `${c.length} Rechtsgebiete`
}
function tfLabel() {
  const t = timeframeOptions.value.find(x => x.value === selectedTimeframe.value)
  return t ? t.label : ''
}

async function generateReport() {
  if (!selectedCategory.value.length) return
  generating.value = true; statusMsg.value = 'Suche läuft…'; statusOk.value = true
  try {
    const d = await doSearch()
    if (!d.results?.length) { statusMsg.value = 'Keine Ergebnisse.'; statusOk.value = false; return }
    statusMsg.value = `${d.results.length} Ergebnisse — KI-Analyse läuft…`
    const r = await api.post('/report', {
      results: d.results, doc_type: 'gesetze',
      category_label: catLabel(), timeframe_label: tfLabel(),
      total_hits: d.total_hits, diffs: {}
    })
    // Download HTML
    const b = new Blob([r.data.report_html], { type: 'text/html;charset=utf-8' })
    const u = URL.createObjectURL(b)
    const a = document.createElement('a')
    a.href = u; a.download = `AI-ssociate_Report_${new Date().toISOString().split('T')[0]}.html`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u)
    statusMsg.value = 'Report heruntergeladen.'
    statusOk.value = true
  } catch (e) {
    statusMsg.value = e.response?.data?.detail || `Fehler: ${e.message}`
    statusOk.value = false
  } finally { generating.value = false }
}
</script>

<style scoped>
.page{min-height:100vh;background:#070e12;color:#e4f0f2}
.bg-canvas{position:fixed;inset:0;z-index:0;width:100%;height:100%;pointer-events:none;touch-action:none;contain:strict}
.scroll-wrap{position:relative;z-index:2;will-change:transform;transform:translateZ(0)}
.s{display:flex;align-items:center;justify-content:center;padding:24px}
.s-full{min-height:100vh}
.sc{text-align:center;max-width:680px;width:100%}
.reveal>.sc{opacity:0;transform:translateY(50px);transition:opacity .9s cubic-bezier(.16,1,.3,1),transform .9s cubic-bezier(.16,1,.3,1)}
.reveal.on>.sc{opacity:1;transform:none}
.s-journey{height:4000px;position:relative}

.node-label{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:3;text-align:center;pointer-events:none;opacity:0;transition:opacity .25s;display:flex;flex-direction:column;align-items:center;gap:6px;padding:20px 40px;background:rgba(7,14,18,.6);border-radius:16px}
.nl-title{font-size:42px;font-weight:800;letter-spacing:-1px;color:#fff;display:block}
.nl-sub{font-size:14px;font-weight:400;color:rgba(255,255,255,.35);letter-spacing:1px;display:block}

.logo{height:60px;filter:brightness(10)}
.scroll-arrow{margin-top:56px;animation:bob 2.5s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0);opacity:.2}50%{transform:translateY(10px);opacity:.5}}
.title-legal{font-size:24px;font-weight:300;letter-spacing:12px;text-transform:uppercase;color:rgba(255,255,255,.4);margin:0 0 8px}
.title-monitoring{font-size:64px;font-weight:800;letter-spacing:4px;text-transform:uppercase;margin:0;background:linear-gradient(135deg,#ff9733,#ffbe6d 40%,#ff9733 80%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.tagline{font-size:32px;font-weight:300;line-height:1.5;color:rgba(255,255,255,.7);letter-spacing:-.5px;margin:0}
.tagline em{font-style:normal;color:#22c9e8;font-weight:600}

.s-form{min-height:auto;position:sticky;bottom:0;padding:0 24px}
.form-dock{max-width:640px;margin:0 auto;opacity:0;transform:translateY(20px);transition:opacity .5s,transform .5s}
.form-dock.on{opacity:1;transform:none}
.form-inner{background:#0a1820;border-radius:18px 18px 0 0;border:1px solid rgba(255,255,255,.06);border-bottom:none;padding:24px 28px 28px;box-shadow:0 -10px 50px rgba(0,0,0,.5)}
.form-title{font-size:16px;font-weight:700;margin:0 0 16px;color:rgba(255,255,255,.7)}
.kern-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}
.kc{padding:6px 14px;border-radius:99px;border:1px solid rgba(255,255,255,.08);background:transparent;color:rgba(255,255,255,.45);font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;transition:all .2s}
.kc:hover{color:rgba(255,255,255,.7);border-color:rgba(34,201,232,.2)}
.kc.active{color:#22c9e8;border-color:rgba(34,201,232,.4);background:rgba(34,201,232,.08)}
.form-row{display:flex;gap:12px;margin-bottom:14px}
.ff{flex:1;min-width:0}
.ff label{display:block;font-size:12px;font-weight:600;color:rgba(255,255,255,.4);margin-bottom:5px}
.inp{width:100%;padding:10px 14px;border:1px solid rgba(255,255,255,.07);border-radius:10px;font-size:14px;font-family:inherit;outline:none;background:rgba(255,255,255,.03);color:#e4f0f2;transition:border-color .2s}
.inp:focus{border-color:rgba(34,201,232,.35)}
select.inp{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px}
select.inp option{background:#0b1922;color:#e4f0f2}
.btn-go{width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#ff9733,#e8870a);color:#fff;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;box-shadow:0 4px 20px rgba(255,151,51,.2);transition:all .2s;display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px}
.btn-go:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 28px rgba(255,151,51,.35)}
.btn-go:disabled{opacity:.3;cursor:not-allowed}
.msg{margin-top:12px;padding:10px 14px;border-radius:10px;font-size:13px}
.msg-ok{background:rgba(16,185,129,.08);color:#34d399;border:1px solid rgba(16,185,129,.12)}
.msg-err{background:rgba(239,68,68,.08);color:#f87171;border:1px solid rgba(239,68,68,.12)}
.spin{width:18px;height:18px;border:2.5px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:sp .6s linear infinite;display:inline-block}
@keyframes sp{to{transform:rotate(360deg)}}

@media(max-width:640px){.title-monitoring{font-size:40px;letter-spacing:2px}.title-legal{font-size:18px;letter-spacing:8px}.tagline{font-size:24px}.nl-title{font-size:28px}.form-row{flex-direction:column;gap:8px}.form-inner{padding:20px}.s{padding:20px 16px}}
@media(prefers-reduced-motion:reduce){.reveal>.sc{opacity:1;transform:none;transition:none}.bg-canvas{display:none}.page{background:#0c2230}}
</style>
