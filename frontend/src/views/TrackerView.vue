<template>
<div class="page">
  <canvas ref="cvs" class="bg-canvas"></canvas>

  <!-- Intro overlays — sequential: logo first, then "Legal Monitoring" -->
  <div class="intro-overlay" id="intro-logo">
    <img src="/logo.svg" alt="AI:ssociate" class="logo" />
  </div>
  <div class="intro-overlay" id="intro-lm">
    <span class="intro-lm-text">Legal Monitoring</span>
  </div>

  <div class="scroll-driver" :style="{ height: totalHeight + 'px' }"></div>

  <!-- Form — appears after last intro slide -->
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

  <!-- Report finding card overlay -->
  <div class="report-card" id="report-card"
       :style="{ opacity: reportCard.opacity, transform: `translate(${reportCard.x}px, ${reportCard.y}px)` }">
    <div class="report-card-inner">
      <div class="report-card-num" v-if="reportCard.index >= 0">{{ String(reportCard.index + 1).padStart(2, '0') }}</div>
      <h3 class="report-card-title">{{ reportCard.title }}</h3>
      <p class="report-card-body">{{ reportCard.body }}</p>
    </div>
  </div>

  <!-- Download button at the end of report fly-through -->
  <div class="dl-wrap" id="dl-wrap" v-if="findings.length">
    <button class="btn-dl" @click="downloadHtml">Report als HTML herunterladen</button>
  </div>
</div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue'
import api from '../services/api'
import { KERN, parseFindings } from '../lib/journeyNodes.js'
import { createRenderer, INTRO_COUNT } from '../lib/canvasRenderer.js'

const cvs = ref(null)
let scrollY = 0, scrolling = false, scrollTimer = 0, renderer = null, raf = 0
let nodeProgress = 0
let renderLoop = () => {}
const reportCard = reactive({ x: 0, y: 0, opacity: 0, index: -1, title: '', body: '' })
const innerH = ref(typeof window !== 'undefined' ? window.innerHeight : 800)

// Total intro+fly node count determines scroll height
const introCount = INTRO_COUNT + KERN.length

const SLIDE_H = window.innerWidth < 640 ? 400 : 600
const totalHeight = ref(introCount * SLIDE_H + innerH.value)

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
  const totalNodes = renderer ? renderer.getNodeCount() : introCount
  nodeProgress = Math.min(totalNodes - 1, scrollY / SLIDE_H)
  if (!scrolling) { scrolling = true; renderLoop() }
  clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => { scrolling = false }, 150)
  updateUI()
}

function updateUI() {
  const pastIntro = nodeProgress >= introCount - 1

  // Logo: visible at progress 0, fades out by progress ~1
  const logoEl = document.getElementById('intro-logo')
  if (logoEl) {
    const a = Math.max(0, 1 - nodeProgress * 1.2)
    logoEl.style.opacity = a.toFixed(2)
  }

  // "Legal Monitoring": fades in around 0.5, fades out by ~2
  const lmEl = document.getElementById('intro-lm')
  if (lmEl) {
    const fadeIn = Math.min(1, Math.max(0, (nodeProgress - 0.5) * 2))
    const fadeOut = Math.max(0, 1 - Math.max(0, nodeProgress - 1.2) * 1.5)
    const a = fadeIn * fadeOut
    lmEl.style.opacity = a.toFixed(2)
  }

  // Show form after intro, hide during report
  const formEl = document.getElementById('form-wrap')
  if (formEl) {
    const showForm = pastIntro && !findings.value.length
    formEl.style.opacity = showForm ? '1' : '0'
    formEl.style.pointerEvents = showForm ? 'auto' : 'none'
  }

  // Show download button at end of report
  const dlEl = document.getElementById('dl-wrap')
  if (dlEl && findings.value.length) {
    const totalNodes = renderer ? renderer.getNodeCount() : introCount
    const atEnd = nodeProgress >= totalNodes - 1.5
    dlEl.style.opacity = atEnd ? '1' : '0'
    dlEl.style.pointerEvents = atEnd ? 'auto' : 'none'
  }
}

const slideLabels = KERN.map(k => k.label)

function updateReportCard(info) {
  if (info) {
    const mobile = window.innerWidth < 640
    const cardW = mobile ? 280 : 380
    reportCard.x = Math.round(Math.min(window.innerWidth - cardW - 16, Math.max(16, info.x - cardW / 2)))
    reportCard.y = Math.round(info.y + info.r + 16)
    reportCard.opacity = info.opacity
    reportCard.index = info.index
    reportCard.title = info.title
    reportCard.body = info.body
  } else {
    reportCard.opacity = 0
  }
}

function setupRenderer() {
  renderer = createRenderer(cvs.value, slideLabels)
  renderer.render(0, false, 0)
  renderLoop = function () {
    if (!scrolling || !renderer) return
    const info = renderer.render(scrollY, true, nodeProgress)
    updateReportCard(info)
    raf = requestAnimationFrame(renderLoop)
  }
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  setupRenderer()
  updateUI()
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
    // Merge continuation slides (empty title) into their parent finding
    // so each finding = one 3D node, not multiple empty ones
    const merged = []
    for (const slide of parsed) {
      const hasTitle = slide.title && slide.title.trim()
      const hasBody = slide.body && slide.body.trim()
      if (!hasTitle && !hasBody) continue
      if (hasTitle || !merged.length) {
        merged.push({ title: (slide.title || '').trim() || 'Ergebnis', body: (slide.body || '').trim() })
      } else {
        merged[merged.length - 1].body += '\n\n' + slide.body.trim()
      }
    }
    // Clean titles: remove BGBl citations, paragraph refs for clean teasers
    for (const f of merged) {
      f.title = f.title
        .replace(/\s*[-—–]\s*BGBl\.?.*$/i, '')
        .replace(/\s*\(BGBl\.?[^)]*\)/gi, '')
        .replace(/\s*BGBl\.?\s+[IV]+\s+Nr\.?\s*\d+\/\d+/gi, '')
        .replace(/\s*§+\s*\d+[a-z]?\s+(ff\.?\s+)?[A-ZÄÖÜ][A-Za-zÄÖÜäöüß]+/g, '')
        .replace(/\s*idF\s+.*$/i, '')
        .trim() || 'Ergebnis'
    }
    // Final filter: ensure every node has meaningful content
    findings.value = merged.filter(f => f.title.trim() || f.body.trim().length > 2)
    if (!findings.value.length) findings.value = [{ title: 'Analyse', body: r.data.report_markdown || 'Keine Zusammenfassung.' }]
    statusMsg.value = ''

    // Feed findings to the 3D renderer as new nodes
    if (renderer) {
      renderer.setReportFindings(findings.value)
      // Extend scroll height for report nodes
      const newTotal = renderer.getNodeCount()
      totalHeight.value = newTotal * SLIDE_H + innerH.value
    }

    // Hide form, scroll to first report node
    await nextTick()
    const formEl = document.getElementById('form-wrap')
    if (formEl) { formEl.style.opacity = '0'; formEl.style.pointerEvents = 'none' }
    setTimeout(() => {
      window.scrollTo({ top: introCount * SLIDE_H, behavior: 'smooth' })
    }, 300)
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
.scroll-driver{position:relative;z-index:1;pointer-events:none}

/* Intro overlays */
.intro-overlay{position:fixed;top:0;left:0;right:0;z-index:3;display:flex;align-items:center;justify-content:center;height:100vh;pointer-events:none}
.logo{height:52px;display:block}
.intro-lm-text{font-size:36px;font-weight:300;letter-spacing:6px;text-transform:uppercase;color:#1a3a4a;opacity:.8}

/* Form */
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

/* Report finding card */
.report-card{position:fixed;top:0;left:0;z-index:5;pointer-events:none;width:380px;will-change:transform,opacity;transition:opacity .15s ease-out}
.report-card-inner{background:rgba(255,255,255,.88);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(0,121,147,.1);border-radius:12px;padding:20px 24px;box-shadow:0 4px 24px rgba(0,40,60,.06),0 1px 4px rgba(0,40,60,.04)}
.report-card-num{font-size:10px;font-weight:600;letter-spacing:2px;color:rgba(0,121,147,.4);margin-bottom:6px;font-variant-numeric:tabular-nums}
.report-card-title{font-size:15px;font-weight:600;color:#0a5062;line-height:1.35;margin-bottom:8px;letter-spacing:-.2px}
.report-card-body{font-size:13px;font-weight:400;color:#4b5563;line-height:1.65;margin:0}

/* Download button */
.dl-wrap{position:fixed;bottom:40px;left:50%;transform:translateX(-50%);z-index:7;opacity:0;pointer-events:none;transition:opacity .4s}
.btn-dl{padding:10px 24px;border:1px solid rgba(10,80,98,.15);border-radius:8px;background:rgba(255,255,255,.8);color:#007993;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;transition:all .2s}
.btn-dl:hover{background:rgba(0,121,147,.08);border-color:rgba(0,121,147,.3)}

@media(max-width:640px){
  .logo{height:36px}
  .intro-lm-text{font-size:22px;letter-spacing:4px}
  .form-center{padding:0 16px}
  .chips{gap:5px}
  .chip{padding:6px 12px;font-size:11px}
  .form-line{flex-direction:column;width:100%;gap:8px}
  .sel,.btn-gen{width:100%;text-align:center;justify-content:center}
  .sel-date{width:100%}
  .report-card{width:280px}
  .report-card-inner{padding:16px 18px;border-radius:10px}
  .report-card-title{font-size:14px}
  .report-card-body{font-size:12px}
  .dl-wrap{bottom:24px}
  .btn-dl{font-size:11px;padding:8px 16px}
}
@media(max-width:380px){
  .chip{padding:5px 10px;font-size:10px}
}
@media(prefers-reduced-motion:reduce){.bg-canvas{display:none}.page{background:#fafbfc}}
</style>
