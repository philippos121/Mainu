<template>
<div class="page" ref="pageRef">
  <!-- 3D Library scene — fixed background -->
  <div class="scene">
    <div class="scene-depth" :style="{ transform: `perspective(1400px) rotateX(${2 + scrollY * 0.008}deg)` }">
      <!-- Floor -->
      <div class="floor" :style="{ transform: `translateZ(-200px) translateY(${scrollY * 0.05}px)` }"></div>
      <!-- Bookshelves — left wall -->
      <div class="shelf-wall shelf-left" :style="{ transform: `translateX(-48vw) rotateY(88deg) translateY(${scrollY * -0.12}px)` }">
        <div class="shelf-unit" v-for="n in 6" :key="'l'+n" :style="{ top: (n-1)*16+'%' }">
          <div class="shelf-plank"></div>
          <div class="books">
            <div class="book" v-for="b in 12" :key="b" :style="{ height: 20+Math.sin(b*n)*18+'px', background: bookColor(b,n) }"></div>
          </div>
        </div>
      </div>
      <!-- Bookshelves — right wall -->
      <div class="shelf-wall shelf-right" :style="{ transform: `translateX(48vw) rotateY(-88deg) translateY(${scrollY * -0.12}px)` }">
        <div class="shelf-unit" v-for="n in 6" :key="'r'+n" :style="{ top: (n-1)*16+'%' }">
          <div class="shelf-plank"></div>
          <div class="books">
            <div class="book" v-for="b in 12" :key="b" :style="{ height: 18+Math.cos(b*n)*16+'px', background: bookColor(b+3,n+1) }"></div>
          </div>
        </div>
      </div>
      <!-- Ceiling beams -->
      <div class="beam beam-1" :style="{ transform: `translateY(${scrollY * -0.06}px)` }"></div>
      <div class="beam beam-2" :style="{ transform: `translateY(${scrollY * -0.06}px)` }"></div>
      <!-- Ambient light -->
      <div class="light" :style="{ opacity: Math.max(0.3, 1 - scrollY * 0.001) }"></div>
    </div>
  </div>

  <!-- Scroll sections with reveal -->
  <div class="content" :style="{ '--sy': scrollY }">

    <!-- Section 1: Brand reveal -->
    <section class="sec sec-brand" :class="{ visible: scrollY < 200 }">
      <div class="sec-inner">
        <img src="/logo.svg" alt="AI:ssociate" class="brand-logo" />
        <span class="brand-badge">Monitoring</span>
      </div>
    </section>

    <!-- Section 2: Headline -->
    <section class="sec sec-headline" :class="{ visible: scrollY > 80 }">
      <h1 class="main-h1">Rechtsänderungen.</h1>
      <h1 class="main-h1 accent">Automatisch. Analysiert.</h1>
    </section>

    <!-- Section 3: Features -->
    <section class="sec sec-features" :class="{ visible: scrollY > 280 }">
      <div class="feat" v-for="(f, i) in features" :key="i" :class="{ visible: scrollY > 300 + i * 80 }">
        <div class="feat-icon" v-html="f.icon"></div>
        <div class="feat-text">
          <strong>{{ f.title }}</strong>
          <span>{{ f.desc }}</span>
        </div>
      </div>
    </section>

    <!-- Section 4: Sources -->
    <section class="sec sec-sources" :class="{ visible: scrollY > 550 }">
      <p class="sources-label">Datenquellen</p>
      <div class="source-row">
        <span class="src" v-for="(s, i) in ['RIS', 'Findok', 'EUR-Lex', 'parlament.gv.at']" :key="i" :class="{ visible: scrollY > 580 + i * 60 }">{{ s }}</span>
      </div>
    </section>

    <!-- Section 5: Form -->
    <section class="sec sec-form" :class="{ visible: scrollY > 750 }">
      <div class="form-card">
        <div class="fc-head">
          <h2>Report erstellen</h2>
          <p>Wählen Sie Ihre Rechtsgebiete und erhalten Sie den Report per E-Mail.</p>
        </div>

        <div class="field">
          <label>Rechtsgebiete</label>
          <v-select v-model="selectedCategory" :items="categories" item-title="label" item-value="id"
            variant="outlined" density="compact" multiple chips closable-chips clearable hide-details
            placeholder="Rechtsgebiete wählen…" color="#22c9e8" />
        </div>

        <div class="field-row">
          <div class="field field-half">
            <label>Zeitraum</label>
            <v-select v-model="selectedTimeframe" :items="timeframeOptions" item-title="label" item-value="value"
              variant="outlined" density="compact" hide-details color="#22c9e8" />
          </div>
          <div class="field field-half">
            <label>E-Mail</label>
            <input v-model="reportEmail" type="email" placeholder="name@kanzlei.at" class="inp" />
          </div>
        </div>

        <div v-if="selectedTimeframe === 'custom'" class="field-row">
          <div class="field field-half"><label>Von</label><input v-model="datumVon" type="date" class="inp" /></div>
          <div class="field field-half"><label>Bis</label><input v-model="datumBis" type="date" class="inp" /></div>
        </div>

        <div class="actions">
          <button class="btn-primary" :disabled="!reportEmail || !selectedCategory.length || sending" @click="sendReport">
            <span v-if="sending" class="spin"></span>
            <template v-else>Report senden →</template>
          </button>
          <button class="btn-ghost" :disabled="!selectedCategory.length || generating" @click="downloadReport">
            <span v-if="generating" class="spin spin-dark"></span>
            <template v-else>↓ Herunterladen</template>
          </button>
        </div>

        <div v-if="statusMsg" :class="['status', statusOk ? 'status-ok' : 'status-err']">{{ statusMsg }}</div>
      </div>
    </section>

    <!-- Spacer to enable enough scroll -->
    <div style="height: 100px"></div>
  </div>
</div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import api from '../services/api'

const pageRef = ref(null)
const scrollY = ref(0)
function onScroll() { scrollY.value = window.scrollY }
onMounted(() => { window.addEventListener('scroll', onScroll, { passive: true }) })
onUnmounted(() => { window.removeEventListener('scroll', onScroll) })

const features = [
  { title: '86 Rechtsgebiete', desc: 'Vollständige RIS-Dezimalklassifikation', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c9e8" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>' },
  { title: 'Versionsvergleich', desc: 'Inkrafttreten vs. Vorfassung — Wort für Wort', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c9e8" stroke-width="1.5"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>' },
  { title: 'Gesetzesmaterialien', desc: 'Erläuterungen direkt von parlament.gv.at', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c9e8" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>' },
  { title: 'KI-Analyse', desc: 'GPT-Zusammenfassung mit Quellenangaben', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff9733" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>' },
]

function bookColor(b, n) {
  const colors = [
    'linear-gradient(180deg, rgba(0,121,147,0.3), rgba(0,121,147,0.15))',
    'linear-gradient(180deg, rgba(255,151,51,0.2), rgba(255,151,51,0.08))',
    'linear-gradient(180deg, rgba(10,80,98,0.25), rgba(10,80,98,0.1))',
    'linear-gradient(180deg, rgba(34,201,232,0.15), rgba(34,201,232,0.06))',
    'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
  ]
  return colors[(b + n) % colors.length]
}

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

function catLabel() {
  const c = selectedCategory.value || []
  if (!c.length) return 'Alle'
  if (c.length===1) { const f=categories.value.find(x=>x.id===c[0]); return f?f.label:'' }
  return `${c.length} Rechtsgebiete`
}
function tfLabel() {
  if (selectedTimeframe.value === 'custom' && datumVon.value && datumBis.value) return `${datumVon.value} bis ${datumBis.value}`
  const t=timeframes.value.find(x=>x.value===selectedTimeframe.value); return t?t.label:''
}

async function sendReport() {
  if (!reportEmail.value || !selectedCategory.value.length) return
  sending.value = true; statusMsg.value = 'Suche läuft…'; statusOk.value = true
  try {
    const data = await doSearch()
    if (!data.results?.length) { statusMsg.value = 'Keine Ergebnisse.'; statusOk.value = false; return }
    statusMsg.value = `${data.results.length} Ergebnisse. Report wird versendet…`
    await api.post('/report/email', { email: reportEmail.value, results: data.results, doc_type: 'gesetze', category_label: catLabel(), timeframe_label: tfLabel(), total_hits: data.total_hits, diffs: {} })
    statusMsg.value = `Report an ${reportEmail.value} gesendet.`; statusOk.value = true
  } catch(e) { statusMsg.value = e.response?.data?.detail || `Fehler: ${e.message}`; statusOk.value = false }
  finally { sending.value = false }
}

async function downloadReport() {
  if (!selectedCategory.value.length) return
  generating.value = true; statusMsg.value = 'Suche läuft…'; statusOk.value = true
  try {
    const data = await doSearch()
    if (!data.results?.length) { statusMsg.value = 'Keine Ergebnisse.'; statusOk.value = false; return }
    statusMsg.value = `${data.results.length} Ergebnisse. Report wird erstellt…`
    const r = await api.post('/report', { results: data.results, doc_type: 'gesetze', category_label: catLabel(), timeframe_label: tfLabel(), total_hits: data.total_hits, diffs: {} })
    const b = new Blob([r.data.report_html],{type:'text/html;charset=utf-8'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=`Report_${new Date().toISOString().split('T')[0]}.html`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u)
    statusMsg.value = 'Report heruntergeladen.'; statusOk.value = true
  } catch(e) { statusMsg.value = e.response?.data?.detail || `Fehler: ${e.message}`; statusOk.value = false }
  finally { generating.value = false }
}
</script>

<style scoped>
.page { min-height: 300vh; position: relative; overflow-x: hidden; background: #080f13; }

/* ── 3D Library Scene ── */
.scene {
  position: fixed; inset: 0; z-index: 0; overflow: hidden;
  background: linear-gradient(180deg, #060d12 0%, #0a1a22 25%, #0d2530 50%, #0a1a22 75%, #060d12 100%);
}
.scene-depth {
  position: absolute; inset: 0;
  transform-style: preserve-3d;
  transform-origin: 50% 60%;
}

/* Floor — receding into distance */
.floor {
  position: absolute; bottom: -10%; left: -20%; width: 140%; height: 50%;
  background: linear-gradient(180deg, transparent 0%, rgba(0,121,147,0.03) 40%, rgba(10,80,98,0.06) 100%);
  border-top: 1px solid rgba(0,121,147,0.06);
}

/* Bookshelf walls */
.shelf-wall {
  position: absolute; top: 0; width: 40vw; height: 100%;
  transform-style: preserve-3d;
  transform-origin: right center;
}
.shelf-right { transform-origin: left center; }

.shelf-unit {
  position: absolute; left: 0; width: 100%; height: 14%;
}
.shelf-plank {
  position: absolute; bottom: 0; left: 0; right: 0; height: 3px;
  background: linear-gradient(90deg, rgba(139,90,43,0.15), rgba(139,90,43,0.25), rgba(139,90,43,0.15));
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
}
.books {
  position: absolute; bottom: 3px; left: 4px; right: 4px;
  display: flex; align-items: flex-end; gap: 2px;
}
.book {
  width: 8px; min-width: 6px; flex-shrink: 0;
  border-radius: 1px 1px 0 0;
  border: 1px solid rgba(255,255,255,0.03);
  border-bottom: none;
}

/* Ceiling beams */
.beam {
  position: absolute; top: 8%; height: 4px; border-radius: 2px;
  background: linear-gradient(90deg, transparent, rgba(139,90,43,0.12), transparent);
}
.beam-1 { left: 10%; right: 10%; }
.beam-2 { left: 20%; right: 20%; top: 12%; }

/* Warm overhead light */
.light {
  position: absolute; top: -10%; left: 30%; width: 40%; height: 60%;
  background: radial-gradient(ellipse, rgba(255,200,100,0.06) 0%, transparent 70%);
  pointer-events: none;
}

/* ── Content layer ── */
.content {
  position: relative; z-index: 2;
  display: flex; flex-direction: column; align-items: center;
}

/* Sections — scroll reveal */
.sec {
  width: 100%; max-width: 640px; padding: 0 24px;
  opacity: 0; transform: translateY(40px);
  transition: opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1);
}
.sec.visible { opacity: 1; transform: translateY(0); }

/* Brand */
.sec-brand { padding-top: 100px; padding-bottom: 20px; text-align: center; }
.brand-logo { height: 48px; filter: brightness(10); }
.brand-badge {
  display: inline-block; margin-left: 12px; vertical-align: top;
  font-size: 10px; font-weight: 700; color: var(--orange);
  text-transform: uppercase; letter-spacing: 2px; margin-top: 4px;
}

/* Headline */
.sec-headline { text-align: center; padding-bottom: 40px; }
.main-h1 {
  font-size: 48px; font-weight: 800; color: #e8f4f6; line-height: 1.1;
  letter-spacing: -1px; margin: 0;
  text-shadow: 0 2px 30px rgba(0,0,0,0.4);
}
.main-h1.accent { color: #22c9e8; }

/* Features */
.sec-features { padding-bottom: 40px; }
.feat {
  display: flex; align-items: center; gap: 16px;
  padding: 16px 20px; margin-bottom: 8px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.05);
  border-radius: 14px;
  opacity: 0; transform: translateX(-30px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.feat.visible { opacity: 1; transform: translateX(0); }
.feat-icon { flex-shrink: 0; width: 24px; height: 24px; }
.feat-text { display: flex; flex-direction: column; }
.feat-text strong { font-size: 14px; font-weight: 600; color: #e8f4f6; }
.feat-text span { font-size: 12px; color: rgba(255,255,255,0.45); margin-top: 2px; }

/* Sources */
.sec-sources { text-align: center; padding-bottom: 50px; }
.sources-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px;
  color: rgba(255,255,255,0.3); margin-bottom: 16px;
}
.source-row { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
.src {
  font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.7);
  padding: 6px 16px; border-radius: 8px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
  opacity: 0; transform: translateY(20px) scale(0.9);
  transition: opacity 0.5s ease, transform 0.5s ease;
}
.src.visible { opacity: 1; transform: translateY(0) scale(1); }

/* ── Form ── */
.sec-form { padding-bottom: 0; max-width: 600px; }
.form-card {
  background: rgba(255,255,255,0.05); backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
  border-radius: 20px; border: 1px solid rgba(255,255,255,0.08);
  padding: 36px;
  box-shadow: 0 16px 60px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.04) inset;
}

.fc-head { margin-bottom: 24px; }
.fc-head h2 { font-size: 20px; font-weight: 700; color: #e8f4f6; margin-bottom: 4px; }
.fc-head p { font-size: 14px; color: rgba(255,255,255,0.45); }

.field { margin-bottom: 18px; }
.field label { display: block; font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.6); margin-bottom: 6px; }
.field-row { display: flex; gap: 14px; }
.field-half { flex: 1; min-width: 0; }

.inp {
  width: 100%; padding: 12px 16px;
  border: 1px solid rgba(255,255,255,0.08); border-radius: 12px;
  font-size: 14px; font-family: inherit; outline: none;
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
  background: rgba(255,255,255,0.04); color: #e8f4f6;
}
.inp:focus {
  border-color: rgba(34,201,232,0.4);
  box-shadow: 0 0 0 3px rgba(34,201,232,0.08);
  background: rgba(255,255,255,0.07);
}
.inp::placeholder { color: rgba(255,255,255,0.2); }

.actions { display: flex; gap: 10px; margin-top: 28px; }

.btn-primary {
  flex: 1; padding: 15px; border: none; border-radius: 14px;
  background: linear-gradient(135deg, #ff9733, #e8870a);
  color: white; font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer;
  box-shadow: 0 4px 24px rgba(255,151,51,0.25); transition: all 0.2s;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 32px rgba(255,151,51,0.4); }
.btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

.btn-ghost {
  padding: 15px 22px; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px;
  background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.7); font-size: 14px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.btn-ghost:hover:not(:disabled) { border-color: rgba(34,201,232,0.3); color: #22c9e8; background: rgba(34,201,232,0.05); }
.btn-ghost:disabled { opacity: 0.35; cursor: not-allowed; }

.status { margin-top: 16px; padding: 12px 16px; border-radius: 12px; font-size: 13px; line-height: 1.5; }
.status-ok { background: rgba(16,185,129,0.12); color: #34d399; border: 1px solid rgba(16,185,129,0.15); }
.status-err { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.15); }

.spin { width: 18px; height: 18px; border: 2.5px solid rgba(255,255,255,0.2); border-top-color: white; border-radius: 50%; animation: sp .6s linear infinite; display: inline-block; }
.spin-dark { border-color: rgba(255,255,255,0.1); border-top-color: #22c9e8; }
@keyframes sp { to { transform: rotate(360deg) } }

/* Vuetify dark overrides */
:deep(.v-field) { background: rgba(255,255,255,0.04) !important; border-color: rgba(255,255,255,0.08) !important; color: #e8f4f6 !important; border-radius: 12px !important; }
:deep(.v-field__input) { color: #e8f4f6 !important; }
:deep(.v-field--focused) { border-color: rgba(34,201,232,0.4) !important; }
:deep(.v-chip) { background: rgba(34,201,232,0.12) !important; color: #22c9e8 !important; }
:deep(.v-field__input::placeholder) { color: rgba(255,255,255,0.2) !important; }
:deep(.v-select__selection-text) { color: #e8f4f6 !important; }
:deep(.v-field__append-inner .v-icon) { color: rgba(255,255,255,0.35) !important; }
:deep(.v-list) { background: #0d1f28 !important; }
:deep(.v-list-item) { color: #e8f4f6 !important; }
:deep(.v-list-item:hover) { background: rgba(34,201,232,0.08) !important; }
:deep(.v-list-item--active) { background: rgba(34,201,232,0.12) !important; color: #22c9e8 !important; }
:deep(.v-overlay__content) { border: 1px solid rgba(255,255,255,0.08) !important; border-radius: 12px !important; }

@media (max-width: 600px) {
  .main-h1 { font-size: 32px; }
  .field-row { flex-direction: column; gap: 0; }
  .actions { flex-direction: column; }
  .form-card { padding: 24px; border-radius: 16px; }
  .shelf-wall { display: none; }
  .sec-brand { padding-top: 60px; }
  .page { min-height: 250vh; }
}

@media (prefers-reduced-motion: reduce) {
  .sec { opacity: 1; transform: none; transition: none; }
  .feat, .src { opacity: 1; transform: none; transition: none; }
  .scene { display: none; }
  .page { background: #0d2530; }
}
</style>
