<template>
<div class="page">
  <canvas ref="cvs" class="bg-canvas"></canvas>

  <div class="stage" id="stage">
    <div class="stage-text" id="stage-text">
      <img src="/logo.svg" alt="AI:ssociate" class="logo" id="stage-logo" />
      <span class="st-num" id="st-num"></span>
      <h2 class="st-title" id="st-title"></h2>
      <p class="st-sub" id="st-sub"></p>
    </div>
  </div>

  <div class="scroll-driver" :style="{ height: totalHeight + 'px' }"></div>

  <!-- Form — same style, no box, appears centered after last slide -->
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
        <template v-if="selectedTimeframe === 'custom'">
          <input v-model="datumVon" type="date" class="sel sel-date" />
          <input v-model="datumBis" type="date" class="sel sel-date" />
        </template>
        <button class="btn-gen" :disabled="!selectedCategory.length || generating" @click="generateReport">
          <span v-if="generating" class="spin"></span>
          <template v-else>Report erstellen</template>
        </button>
      </div>
      <p v-if="statusMsg" :class="['msg', statusOk ? 'msg-ok' : 'msg-err']">{{ statusMsg }}</p>
    </div>
  </div>

  <!-- Inline results after generation — scroll through findings -->
  <div class="results-wrap" id="results-wrap" v-if="findings.length">
    <div class="results-driver" :style="{ height: findings.length * 400 + innerH + 'px' }"></div>
    <div class="result-stage" id="result-stage">
      <span class="rs-num" id="rs-num"></span>
      <h3 class="rs-title" id="rs-title"></h3>
      <p class="rs-body" id="rs-body"></p>
    </div>
    <div class="dl-wrap" id="dl-wrap">
      <button class="btn-dl" @click="downloadHtml">Report als HTML herunterladen</button>
    </div>
  </div>
</div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import api from '../services/api'
import { KERN, parseFindings } from '../lib/journeyNodes.js'
import { createRenderer } from '../lib/canvasRenderer.js'

const cvs = ref(null)
let scrollY = 0, scrolling = false, scrollTimer = 0, renderer = null, raf = 0
let renderLoop = () => {}, prevSlide = -1, prevResult = -1
const innerH = ref(typeof window !== 'undefined' ? window.innerHeight : 800)

const slides = [
  { type: 'logo' },
  { type: 'text', title: 'Legal Monitoring', sub: '' },
  ...KERN.map((k, i) => ({ type: 'rg', num: String(i + 1).padStart(2, '0'), title: k.label })),
]

const SLIDE_H = window.innerWidth < 640 ? 400 : 600
const totalHeight = ref(slides.length * SLIDE_H + window.innerHeight)
const maxScroll = slides.length * SLIDE_H

const kernList = KERN
const selectedCategory = ref([])
const selectedTimeframe = ref('EinemMonat')
const datumVon = ref(''), datumBis = ref('')
const timeframeOptions = ref([])
const generating = ref(false), statusMsg = ref(''), statusOk = ref(false)
const findings = ref([])
let reportHtml = ''

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
  updateResults()
}

function updateStage() {
  const slideIdx = Math.min(slides.length - 1, Math.floor(scrollY / SLIDE_H))

  const stageEl = document.getElementById('stage')
  const formEl = document.getElementById('form-wrap')
  const pastSlides = slideIdx >= slides.length - 1
  // Stage visible only during slides, hidden when form or results show
  if (stageEl) stageEl.style.opacity = pastSlides ? '0' : '1'
  if (stageEl) stageEl.style.pointerEvents = pastSlides ? 'none' : 'none'
  if (formEl) {
    const showForm = pastSlides && !findings.value.length
    formEl.style.opacity = showForm ? '1' : '0'
    formEl.style.pointerEvents = showForm ? 'auto' : 'none'
  }

  // Also hide result stage when scrolling back to intro
  const rs = document.getElementById('result-stage')
  if (rs && !pastSlides) rs.style.opacity = '0'

  // Always update slide content (handles scrolling back)
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

function updateResults() {
  if (!findings.value.length) return
  const wrap = document.getElementById('results-wrap')
  if (!wrap) return
  const rStart = wrap.offsetTop
  const rScroll = scrollY - rStart
  if (rScroll < 0) return

  const idx = Math.min(findings.value.length - 1, Math.floor(rScroll / 400))
  const dlEl = document.getElementById('dl-wrap')
  if (dlEl) {
    const pastAll = idx >= findings.value.length - 1 && rScroll > (findings.value.length - 1) * 400 + 250
    dlEl.style.opacity = pastAll ? '1' : '0'
    dlEl.style.pointerEvents = pastAll ? 'auto' : 'none'
  }

  if (idx === prevResult) return
  prevResult = idx

  const f = findings.value[idx]
  if (!f) return
  const rs = document.getElementById('result-stage')
  if (!rs) return
  rs.style.opacity = '0'
  setTimeout(() => {
    document.getElementById('rs-num').textContent = f.title ? String(idx + 1).padStart(2, '0') : ''
    document.getElementById('rs-title').textContent = f.title || ''
    document.getElementById('rs-title').style.display = f.title ? 'block' : 'none'
    document.getElementById('rs-body').textContent = f.body
    rs.style.opacity = '1'
  }, 120)
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
  const tf = selectedTimeframe.value === 'custom' ? 'EinemJahr' : selectedTimeframe.value
  const ep = selectedTimeframe.value === 'custom' && datumVon.value && datumBis.value
    ? { datum_von: datumVon.value, datum_bis: datumBis.value } : {}
  const ends = ['/search/gesetze', '/search/gerichtsentscheidungen']
  const all = []; let hits = 0; const seen = new Set()
  for (const e of ends) {
    const ps = cats.map(c => api.get(e, { params: { im_ris_seit: tf, page: 1, category: c, ...ep } }).catch(() => ({ data: { results: [], total_hits: 0 } })))
    const rs = await Promise.all(ps)
    for (const r of rs) { hits += r.data.total_hits || 0; for (const i of (r.data.results || [])) if (!seen.has(i.id)) { seen.add(i.id); all.push(i) } }
  }
  return { results: all, total_hits: hits }
}
function catLabel() { const c = selectedCategory.value; if (c.length === KERN.length) return 'Alle Kernrechtsgebiete'; if (c.length === 1) { const f = KERN.find(x => x.id === c[0]); return f ? f.label : '' } return `${c.length} Rechtsgebiete` }
function tfLabel() { if (selectedTimeframe.value === 'custom' && datumVon.value && datumBis.value) return `${datumVon.value} bis ${datumBis.value}`; const t = timeframeOptions.value.find(x => x.value === selectedTimeframe.value); return t ? t.label : '' }

async function generateReport() {
  if (!selectedCategory.value.length) return
  generating.value = true; statusMsg.value = 'Suche läuft…'; statusOk.value = true
  try {
    const d = await doSearch()
    if (!d.results?.length) { statusMsg.value = 'Keine Ergebnisse.'; statusOk.value = false; return }
    statusMsg.value = `${d.results.length} Ergebnisse — KI-Analyse läuft…`
    const r = await api.post('/report', { results: d.results, doc_type: 'gesetze', category_label: catLabel(), timeframe_label: tfLabel(), total_hits: d.total_hits, diffs: {} })
    reportHtml = r.data.report_html
    const parsed = parseFindings(r.data.report_markdown)
    findings.value = parsed.length ? parsed : [{ title: 'Analyse', body: r.data.report_markdown || 'Keine Zusammenfassung.' }]
    statusMsg.value = ''
    // Hide form, show results
    await nextTick()
    const formEl = document.getElementById('form-wrap')
    if (formEl) { formEl.style.opacity = '0'; formEl.style.pointerEvents = 'none' }
    const rWrap = document.getElementById('results-wrap')
    if (rWrap) setTimeout(() => window.scrollTo({ top: rWrap.offsetTop, behavior: 'smooth' }), 200)
  } catch (e) { statusMsg.value = e.response?.data?.detail || `Fehler: ${e.message}`; statusOk.value = false }
  finally { generating.value = false }
}

function downloadHtml() {
  if (!reportHtml) return
  const b = new Blob([reportHtml], { type: 'text/html;charset=utf-8' })
  const u = URL.createObjectURL(b); const a = document.createElement('a')
  a.href = u; a.download = `AI-ssociate_Report_${new Date().toISOString().split('T')[0]}.html`
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u)
}
</script>

<style scoped>
.page{min-height:100vh;background:#fafbfc;color:#1a2a3a}
.bg-canvas{position:fixed;inset:0;z-index:0;width:100%;height:100%;pointer-events:none;touch-action:none;contain:strict}

/* Stage */
.stage{position:fixed;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;pointer-events:none;transition:opacity .3s}
.stage-text{text-align:center;transition:opacity .3s ease,transform .3s ease;will-change:opacity,transform}
.logo{height:48px;display:block;margin:0 auto}
.st-num{font-size:11px;font-weight:700;color:rgba(0,121,147,.4);letter-spacing:3px;display:none;margin-bottom:8px}
.st-title{font-size:34px;font-weight:700;color:#1a2a3a;letter-spacing:-.5px;margin:0;line-height:1.2}
.st-hero{font-size:36px;font-weight:300;letter-spacing:6px;text-transform:uppercase;color:#1a3a4a}
.st-rg{font-size:30px;font-weight:300;letter-spacing:2px;color:#2a3a4a}
.st-sub{font-size:20px;font-weight:300;color:#007993;margin-top:8px;display:none}

.scroll-driver{position:relative;z-index:1;pointer-events:none}

/* Form — transparent, blends in */
.form-wrap{position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .4s}
.form-center{text-align:center;max-width:520px;width:100%;padding:0 24px}
.chips{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-bottom:18px}
.chip{padding:7px 16px;border-radius:99px;border:1px solid rgba(10,80,98,.2);background:rgba(255,255,255,.7);color:#1a3a4a;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;transition:all .2s}
.chip:hover{color:#0a5062;border-color:rgba(0,121,147,.35);background:rgba(255,255,255,.9)}
.chip.on{color:#fff;border-color:#007993;background:#007993;font-weight:600}
.form-line{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center}
.sel{padding:7px 14px;border:1px solid rgba(10,80,98,.1);border-radius:8px;font-size:12px;font-family:inherit;outline:none;background:rgba(255,255,255,.6);color:#1a2a3a;cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='rgba(10,80,98,0.3)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;padding-right:24px}
.sel:focus{border-color:rgba(0,121,147,.3)}
.sel option{background:#fff;color:#1a2a3a}
.sel-date{background-image:none;padding-right:10px;width:130px}
.btn-gen{padding:7px 18px;border:none;border-radius:8px;background:rgba(0,121,147,.1);color:#007993;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:5px}
.btn-gen:hover:not(:disabled){background:rgba(0,121,147,.16)}
.btn-gen:disabled{opacity:.3;cursor:not-allowed}
.msg{margin-top:12px;padding:6px 12px;border-radius:6px;font-size:11px;display:inline-block}
.msg-ok{background:rgba(16,185,129,.06);color:#059669;border:1px solid rgba(16,185,129,.12)}
.msg-err{background:rgba(239,68,68,.06);color:#dc2626;border:1px solid rgba(239,68,68,.12)}
.spin{width:13px;height:13px;border:2px solid rgba(0,121,147,.15);border-top-color:#007993;border-radius:50%;animation:sp .6s linear infinite;display:inline-block}
@keyframes sp{to{transform:rotate(360deg)}}

/* Inline results */
.results-wrap{position:relative;z-index:5}
.results-driver{pointer-events:none}
.result-stage{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:6;text-align:center;max-width:560px;width:100%;padding:0 24px;pointer-events:none;transition:opacity .25s}
.rs-num{font-size:11px;font-weight:700;color:rgba(0,121,147,.35);letter-spacing:3px;display:block;margin-bottom:8px}
.rs-title{font-size:24px;font-weight:700;color:#0a5062;margin:0 0 12px;letter-spacing:-.3px}
.rs-body{font-size:14px;color:rgba(30,50,60,.55);line-height:1.7;margin:0;text-align:left}
.dl-wrap{position:fixed;bottom:40px;left:50%;transform:translateX(-50%);z-index:7;opacity:0;pointer-events:none;transition:opacity .4s}
.btn-dl{padding:8px 20px;border:1px solid rgba(10,80,98,.12);border-radius:8px;background:rgba(255,255,255,.7);color:#007993;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;transition:all .2s}
.btn-dl:hover{background:rgba(0,121,147,.06);border-color:rgba(0,121,147,.25)}

@media(max-width:640px){
  .stage-text{padding:0 20px}
  .logo{height:36px}
  .st-hero{font-size:22px;letter-spacing:4px}
  .st-title{font-size:22px}
  .st-rg{font-size:20px;letter-spacing:1px}
  .st-sub{font-size:16px}
  .st-num{font-size:10px}
  .form-center{padding:0 16px}
  .chips{gap:5px}
  .chip{padding:6px 12px;font-size:11px}
  .form-line{flex-direction:column;width:100%;gap:8px}
  .sel,.btn-gen{width:100%;text-align:center;justify-content:center}
  .sel-date{width:100%}
  .result-stage{padding:0 20px}
  .rs-title{font-size:18px}
  .rs-body{font-size:13px}
  .dl-wrap{bottom:24px}
  .btn-dl{font-size:11px;padding:8px 16px}
}
@media(max-width:380px){
  .st-hero{font-size:18px;letter-spacing:3px}
  .st-title{font-size:19px}.st-rg{font-size:17px;letter-spacing:1px}
  .chip{padding:5px 10px;font-size:10px}
}
@media(prefers-reduced-motion:reduce){.stage-text,.result-stage{transition:none}.bg-canvas{display:none}.page{background:#fafbfc}}
</style>
