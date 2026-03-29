<template>
<div class="page">
  <canvas ref="cvs" class="bg-canvas"></canvas>

  <!-- Fixed center stage — text swaps here, page doesn't visually move -->
  <div class="stage">
    <div class="stage-text" id="stage-text">
      <img src="/logo.svg" alt="AI:ssociate" class="logo" id="stage-logo" />
      <span class="st-num" id="st-num"></span>
      <h2 class="st-title" id="st-title"></h2>
      <p class="st-sub" id="st-sub"></p>
    </div>
  </div>

  <!-- Invisible scroll spacer — drives the text changes -->
  <div class="scroll-driver" :style="{ height: totalHeight + 'px' }"></div>

  <!-- Form — appears at the bottom after scrolling through all -->
  <div class="form-wrap" id="form-wrap">
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
</div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import api from '../services/api'
import { KERN } from '../lib/journeyNodes.js'
import { createRenderer } from '../lib/canvasRenderer.js'

const cvs = ref(null)
let scrollY = 0, scrolling = false, scrollTimer = 0, renderer = null, raf = 0
let renderLoop = () => {}, prevSlide = -1

// Slides: logo → Legal Monitoring → tagline → 9 Rechtsgebiete = 12 slides
const slides = [
  { type: 'logo' },
  { type: 'text', title: 'Legal Monitoring', sub: '' },
  { type: 'text', title: 'Rechtsänderungen erkennen,', sub: 'bevor sie relevant werden.' },
  ...KERN.map((k, i) => ({ type: 'rg', num: String(i + 1).padStart(2, '0'), title: k.label })),
]

const SLIDE_H = 600 // px of scroll per slide
const totalHeight = ref(slides.length * SLIDE_H + window.innerHeight)

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
  updateStage()
}

function updateStage() {
  const slideIdx = Math.min(slides.length - 1, Math.floor(scrollY / SLIDE_H))
  const progress = (scrollY % SLIDE_H) / SLIDE_H // 0..1 within slide

  // Show form when past last slide
  const formEl = document.getElementById('form-wrap')
  if (formEl) {
    formEl.style.opacity = slideIdx >= slides.length - 1 ? '1' : '0'
    formEl.style.pointerEvents = slideIdx >= slides.length - 1 ? 'auto' : 'none'
  }

  if (slideIdx === prevSlide) return
  prevSlide = slideIdx

  const slide = slides[slideIdx]
  const logo = document.getElementById('stage-logo')
  const num = document.getElementById('st-num')
  const title = document.getElementById('st-title')
  const sub = document.getElementById('st-sub')
  const text = document.getElementById('stage-text')
  if (!title) return

  // Fade out then in
  text.style.opacity = '0'
  text.style.transform = 'translateY(20px)'

  setTimeout(() => {
    logo.style.display = slide.type === 'logo' ? 'block' : 'none'
    num.textContent = slide.num || ''
    num.style.display = slide.num ? 'block' : 'none'
    title.textContent = slide.type === 'logo' ? '' : slide.title || ''
    title.className = slide.type === 'rg' ? 'st-title st-rg' : slide.type === 'text' && !slide.sub ? 'st-title st-hero' : 'st-title'
    sub.textContent = slide.sub || ''
    sub.style.display = slide.sub ? 'block' : 'none'

    text.style.opacity = '1'
    text.style.transform = 'translateY(0)'
  }, 150)
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

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  setupRenderer()
  updateStage()
  Promise.all([api.get('/categories'), api.get('/timeframes')]).then(([, b]) => {
    timeframeOptions.value = [...b.data, { value: 'custom', label: 'Benutzerdefiniert…' }]
  }).catch(() => { statusMsg.value = 'Verbindung fehlgeschlagen.'; statusOk.value = false })
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  cancelAnimationFrame(raf)
  if (renderer) renderer.destroy()
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
function catLabel() { const c = selectedCategory.value; if (c.length === KERN.length) return 'Alle Kernrechtsgebiete'; if (c.length === 1) { const f = KERN.find(x => x.id === c[0]); return f ? f.label : '' } return `${c.length} Rechtsgebiete` }
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

/* Stage — fixed center, text swaps in place */
.stage{position:fixed;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;pointer-events:none}
.stage-text{text-align:center;transition:opacity .3s ease,transform .3s ease;will-change:opacity,transform}

.logo{height:52px;filter:brightness(10);display:block;margin:0 auto}

.st-num{font-size:12px;font-weight:700;color:rgba(34,201,232,.4);letter-spacing:3px;display:none;margin-bottom:10px}
.st-title{font-size:36px;font-weight:700;color:rgba(255,255,255,.85);letter-spacing:-.5px;margin:0;line-height:1.2}
.st-hero{font-size:48px;font-weight:800;letter-spacing:2px;text-transform:uppercase;background:linear-gradient(135deg,#ff9733,#ffbe6d 40%,#ff9733 80%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.st-rg{font-size:36px}
.st-sub{font-size:22px;font-weight:300;color:#22c9e8;margin-top:10px;display:none}

/* Scroll driver — invisible tall div that creates scroll room */
.scroll-driver{position:relative;z-index:1;pointer-events:none}

/* Form — fades in at the end, over the stage */
.form-wrap{position:fixed;bottom:0;left:0;right:0;z-index:10;padding:0 24px;opacity:0;pointer-events:none;transition:opacity .4s ease}
.form-inner{max-width:560px;margin:0 auto;background:#0a1820;border-radius:16px 16px 0 0;border:1px solid rgba(255,255,255,.06);border-bottom:none;padding:22px 24px 24px;box-shadow:0 -8px 40px rgba(0,0,0,.5)}
.form-title{font-size:14px;font-weight:700;margin:0 0 12px;color:rgba(255,255,255,.55)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.chip{padding:5px 12px;border-radius:99px;border:1px solid rgba(255,255,255,.06);background:transparent;color:rgba(255,255,255,.35);font-size:11px;font-weight:500;font-family:inherit;cursor:pointer;transition:all .2s}
.chip:hover{color:rgba(255,255,255,.6);border-color:rgba(34,201,232,.2)}
.chip.on{color:#22c9e8;border-color:rgba(34,201,232,.3);background:rgba(34,201,232,.06)}
.form-row{margin-bottom:10px}
.ff label{display:block;font-size:11px;font-weight:600;color:rgba(255,255,255,.3);margin-bottom:4px}
.inp{width:100%;padding:9px 12px;border:1px solid rgba(255,255,255,.06);border-radius:8px;font-size:13px;font-family:inherit;outline:none;background:rgba(255,255,255,.03);color:#e4f0f2}
.inp:focus{border-color:rgba(34,201,232,.3)}
select.inp{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:28px}
select.inp option{background:#0b1922;color:#e4f0f2}
.btn-go{width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#ff9733,#e8870a);color:#fff;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;box-shadow:0 4px 16px rgba(255,151,51,.2);transition:all .2s;display:flex;align-items:center;justify-content:center;gap:6px;margin-top:6px}
.btn-go:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 24px rgba(255,151,51,.3)}
.btn-go:disabled{opacity:.3;cursor:not-allowed}
.msg{margin-top:8px;padding:8px 12px;border-radius:8px;font-size:12px}
.msg-ok{background:rgba(16,185,129,.06);color:#34d399;border:1px solid rgba(16,185,129,.1)}
.msg-err{background:rgba(239,68,68,.06);color:#f87171;border:1px solid rgba(239,68,68,.1)}
.spin{width:16px;height:16px;border:2px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:sp .6s linear infinite;display:inline-block}
@keyframes sp{to{transform:rotate(360deg)}}

@media(max-width:640px){.st-hero{font-size:32px}.st-title{font-size:28px}.st-sub{font-size:18px}.form-inner{padding:18px}}
@media(prefers-reduced-motion:reduce){.stage-text{transition:none}.bg-canvas{display:none}.page{background:#0c2230}}
</style>
