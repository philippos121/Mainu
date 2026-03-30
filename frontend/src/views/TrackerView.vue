<template>
<div class="page">
  <canvas ref="cvs" class="bg-canvas"></canvas>

  <div class="stage">
    <div class="stage-text" id="stage-text">
      <img src="/logo.svg" alt="AI:ssociate" class="logo" id="stage-logo" />
      <span class="st-num" id="st-num"></span>
      <h2 class="st-title" id="st-title"></h2>
      <p class="st-sub" id="st-sub"></p>
    </div>
  </div>

  <div class="scroll-driver" :style="{ height: totalHeight + 'px' }"></div>

  <!-- Form — blends into the light background at end -->
  <div class="form-wrap" id="form-wrap">
    <div class="form-center">
      <div class="chips">
        <button v-for="k in kernList" :key="k.id" class="chip"
          :class="{ on: selectedCategory.includes(k.id) }"
          @click="toggleCat(k.id)">{{ k.label }}</button>
      </div>
      <div class="form-line">
        <select v-model="selectedTimeframe" class="sel">
          <option v-for="t in timeframeOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
        <button class="btn-gen" :disabled="!selectedCategory.length || generating" @click="generateReport">
          <span v-if="generating" class="spin"></span>
          <template v-else>Report erstellen</template>
        </button>
      </div>
      <p v-if="statusMsg" :class="['msg', statusOk ? 'msg-ok' : 'msg-err']">{{ statusMsg }}</p>
    </div>
  </div>
</div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import api from '../services/api'
import { KERN } from '../lib/journeyNodes.js'
import { createRenderer } from '../lib/canvasRenderer.js'

const cvs = ref(null)
let scrollY = 0, scrolling = false, scrollTimer = 0, renderer = null, raf = 0
let renderLoop = () => {}, prevSlide = -1

const slides = [
  { type: 'logo' },
  { type: 'text', title: 'Legal Monitoring', sub: '' },
  { type: 'text', title: 'Rechtsänderungen erkennen,', sub: 'bevor sie relevant werden.' },
  ...KERN.map((k, i) => ({ type: 'rg', num: String(i + 1).padStart(2, '0'), title: k.label })),
]

const SLIDE_H = 600
const totalHeight = ref(slides.length * SLIDE_H + window.innerHeight)
const maxScroll = slides.length * SLIDE_H

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
  updateColors()
}

function updateColors() {
  // Progress 0→1 as we scroll through all slides
  const progress = Math.min(1, scrollY / maxScroll)

  // Update CSS custom properties for text color transition
  const stage = document.getElementById('stage-text')
  if (stage) {
    // Text: white on dark → dark on light
    const textAlpha = progress < 0.5 ? 0.85 : 0.85 - (progress - 0.5) * 0.7
    stage.style.setProperty('--text-color', progress > 0.7
      ? `rgba(20,30,40,${0.15 + (progress - 0.7) * 2.8})`
      : `rgba(255,255,255,${textAlpha})`)
    stage.style.setProperty('--sub-color', progress > 0.7
      ? `rgba(0,121,147,${0.3 + (progress - 0.7) * 2})`
      : `rgba(34,201,232,1)`)
    stage.style.setProperty('--num-color', progress > 0.7
      ? `rgba(0,121,147,${0.2 + (progress - 0.7) * 1.5})`
      : `rgba(34,201,232,0.4)`)
  }

  // Form visibility
  const formEl = document.getElementById('form-wrap')
  const slideIdx = Math.floor(scrollY / SLIDE_H)
  if (formEl) {
    const show = slideIdx >= slides.length - 1
    formEl.style.opacity = show ? '1' : '0'
    formEl.style.pointerEvents = show ? 'auto' : 'none'
  }
}

function updateStage() {
  const slideIdx = Math.min(slides.length - 1, Math.floor(scrollY / SLIDE_H))
  if (slideIdx === prevSlide) return
  prevSlide = slideIdx

  const slide = slides[slideIdx]
  const logo = document.getElementById('stage-logo')
  const num = document.getElementById('st-num')
  const title = document.getElementById('st-title')
  const sub = document.getElementById('st-sub')
  const text = document.getElementById('stage-text')
  if (!title) return

  text.style.opacity = '0'
  text.style.transform = 'translateY(16px)'

  setTimeout(() => {
    logo.style.display = slide.type === 'logo' ? 'block' : 'none'
    num.textContent = slide.num || ''
    num.style.display = slide.num ? 'block' : 'none'
    title.textContent = slide.type === 'logo' ? '' : slide.title || ''
    title.className = slide.type === 'rg' ? 'st-title st-rg' :
      slide.type === 'text' && !slide.sub ? 'st-title st-hero' : 'st-title'
    sub.textContent = slide.sub || ''
    sub.style.display = slide.sub ? 'block' : 'none'
    text.style.opacity = '1'
    text.style.transform = 'translateY(0)'
  }, 150)
}

function setupRenderer() {
  renderer = createRenderer(cvs.value)
  renderer.render(0, false, 0)
  renderLoop = function () {
    if (!scrolling || !renderer) return
    const progress = Math.min(1, scrollY / maxScroll)
    renderer.render(scrollY, true, progress)
    raf = requestAnimationFrame(renderLoop)
  }
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  setupRenderer()
  updateStage()
  updateColors()
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

.stage{position:fixed;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;pointer-events:none}
.stage-text{text-align:center;transition:opacity .3s ease,transform .3s ease;will-change:opacity,transform;
  --text-color:rgba(255,255,255,.85);--sub-color:rgba(34,201,232,1);--num-color:rgba(34,201,232,.4)}

.logo{height:52px;filter:brightness(10);display:block;margin:0 auto}

.st-num{font-size:12px;font-weight:700;color:var(--num-color);letter-spacing:3px;display:none;margin-bottom:10px}
.st-title{font-size:36px;font-weight:700;color:var(--text-color);letter-spacing:-.5px;margin:0;line-height:1.2;transition:color .5s}
.st-hero{font-size:44px;font-weight:800;letter-spacing:1px;text-transform:uppercase;background:linear-gradient(135deg,#ff9733,#ffbe6d 40%,#ff9733 80%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.st-rg{font-size:36px}
.st-sub{font-size:22px;font-weight:300;color:var(--sub-color);margin-top:10px;display:none;transition:color .5s}

.scroll-driver{position:relative;z-index:1;pointer-events:none}

/* Form — transparent, blends into light bg, centered inline */
.form-wrap{position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .5s ease}
.form-center{text-align:center;max-width:480px;width:100%;padding:0 24px}

.chips{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-bottom:20px}
.chip{
  padding:5px 14px;border-radius:99px;
  border:1px solid rgba(0,80,100,.12);background:transparent;
  color:rgba(30,50,60,.45);font-size:11px;font-weight:500;font-family:inherit;cursor:pointer;transition:all .2s;
}
.chip:hover{color:rgba(0,80,100,.7);border-color:rgba(0,121,147,.25)}
.chip.on{color:#007993;border-color:rgba(0,121,147,.4);background:rgba(0,121,147,.06);font-weight:600}

.form-line{display:inline-flex;align-items:center;gap:10px}

.sel{
  padding:8px 28px 8px 12px;border:1px solid rgba(0,80,100,.1);border-radius:8px;
  font-size:13px;font-family:inherit;outline:none;
  background:rgba(255,255,255,.5);color:rgba(20,40,50,.7);cursor:pointer;
  appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='rgba(0,80,100,0.35)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 10px center;
}
.sel:focus{border-color:rgba(0,121,147,.3)}
.sel option{background:#fff;color:#1a2a3a}

.btn-gen{
  padding:8px 20px;border:none;border-radius:8px;
  background:rgba(0,121,147,.12);color:#007993;
  font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;
  transition:all .2s;display:inline-flex;align-items:center;gap:5px;
}
.btn-gen:hover:not(:disabled){background:rgba(0,121,147,.18)}
.btn-gen:disabled{opacity:.3;cursor:not-allowed}

.msg{margin-top:12px;padding:8px 14px;border-radius:8px;font-size:12px;display:inline-block}
.msg-ok{background:rgba(16,185,129,.08);color:#059669;border:1px solid rgba(16,185,129,.15)}
.msg-err{background:rgba(239,68,68,.08);color:#dc2626;border:1px solid rgba(239,68,68,.15)}
.spin{width:14px;height:14px;border:2px solid rgba(0,121,147,.2);border-top-color:#007993;border-radius:50%;animation:sp .6s linear infinite;display:inline-block}
@keyframes sp{to{transform:rotate(360deg)}}

@media(max-width:640px){.st-hero{font-size:30px}.st-title{font-size:26px}.st-sub{font-size:18px}.form-center{padding:0 16px}.form-line{flex-direction:column;width:100%}.sel,.btn-gen{width:100%}}
@media(prefers-reduced-motion:reduce){.stage-text{transition:none}.bg-canvas{display:none}.page{background:#f0f4f5}}
</style>
