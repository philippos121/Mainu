<template>
<div class="page" ref="pageRef">
  <!-- 3D parallax scene — fixed behind everything -->
  <div class="scene">
    <div class="scene-inner" :style="{ transform: `translateY(${scrollY * 0.15}px)` }">
      <!-- Far layer — large soft shapes -->
      <div class="layer layer-far" :style="{ transform: `translateY(${scrollY * -0.08}px) scale(${1 + scrollY * 0.0002})` }">
        <div class="shape sh-1"></div>
        <div class="shape sh-2"></div>
        <div class="shape sh-3"></div>
      </div>
      <!-- Mid layer — geometric elements -->
      <div class="layer layer-mid" :style="{ transform: `translateY(${scrollY * -0.2}px) rotateX(${scrollY * 0.01}deg)` }">
        <div class="geo geo-1"></div>
        <div class="geo geo-2"></div>
        <div class="geo geo-3"></div>
        <div class="geo geo-4"></div>
        <div class="geo geo-5"></div>
      </div>
      <!-- Near layer — floating book spines / columns -->
      <div class="layer layer-near" :style="{ transform: `translateY(${scrollY * -0.35}px)` }">
        <div class="col col-1"></div>
        <div class="col col-2"></div>
        <div class="col col-3"></div>
        <div class="col col-4"></div>
        <div class="col col-5"></div>
        <div class="col col-6"></div>
        <div class="col col-7"></div>
      </div>
    </div>
  </div>

  <!-- Hero content -->
  <section class="hero">
    <div class="hero-inner">
      <div class="hero-brand">
        <img src="/logo.svg" alt="AI:ssociate" class="hero-logo" />
        <span class="hero-badge">Monitoring</span>
      </div>
      <div class="hero-props">
        <div class="hp"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg><span>86 Rechtsgebiete</span></div>
        <div class="hp"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.5"><path d="M12 20V10M18 20V4M6 20v-4"/></svg><span>Versionsvergleich</span></div>
        <div class="hp"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg><span>Gesetzesmaterialien</span></div>
        <div class="hp"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg><span>KI-Analyse</span></div>
      </div>
      <h1 class="hero-h1">Rechtsänderungen.<br/><span class="hero-accent">Automatisch. Analysiert.</span></h1>
      <div class="hero-sources">
        <span class="hs">RIS</span><span class="hs-dot"></span>
        <span class="hs">Findok</span><span class="hs-dot"></span>
        <span class="hs">EUR-Lex</span><span class="hs-dot"></span>
        <span class="hs">parlament.gv.at</span>
      </div>
    </div>
  </section>

  <!-- Form -->
  <section class="form-section">
    <div class="form-card">
      <div class="fc-head">
        <h2>Report erstellen</h2>
        <p>Wählen Sie Ihre Rechtsgebiete und erhalten Sie den Report direkt per E-Mail.</p>
      </div>

      <div class="field">
        <label>Rechtsgebiete</label>
        <v-select v-model="selectedCategory" :items="categories" item-title="label" item-value="id"
          variant="outlined" density="compact" multiple chips closable-chips clearable hide-details
          placeholder="Rechtsgebiete wählen…" color="#007993" bg-color="white" />
      </div>

      <div class="field-row">
        <div class="field field-half">
          <label>Zeitraum</label>
          <v-select v-model="selectedTimeframe" :items="timeframeOptions" item-title="label" item-value="value"
            variant="outlined" density="compact" hide-details color="#007993" bg-color="white" />
        </div>
        <div class="field field-half">
          <label>E-Mail</label>
          <input v-model="reportEmail" type="email" placeholder="name@kanzlei.at" class="inp" />
        </div>
      </div>

      <div v-if="selectedTimeframe === 'custom'" class="field-row">
        <div class="field field-half">
          <label>Von</label>
          <input v-model="datumVon" type="date" class="inp" />
        </div>
        <div class="field field-half">
          <label>Bis</label>
          <input v-model="datumBis" type="date" class="inp" />
        </div>
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
</div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import api from '../services/api'

const pageRef = ref(null)
const scrollY = ref(0)

function onScroll() { scrollY.value = window.scrollY }
onMounted(() => { window.addEventListener('scroll', onScroll, { passive: true }) })
onUnmounted(() => { window.removeEventListener('scroll', onScroll) })

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
  const extraParams = isCustom && datumVon.value && datumBis.value
    ? { datum_von: datumVon.value, datum_bis: datumBis.value } : {}
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
.page { min-height: 100vh; position: relative; overflow-x: hidden; background: #0b1a20; }

/* ── 3D Parallax scene ── */
.scene {
  position: fixed; inset: 0; z-index: 0;
  perspective: 1200px;
  overflow: hidden;
  background: linear-gradient(180deg, #0b1a20 0%, #0d2832 30%, #0f3640 55%, #112a34 80%, #0b1a20 100%);
}
.scene-inner {
  position: absolute; inset: -20%; width: 140%; height: 140%;
  transform-style: preserve-3d;
}

/* Far layer — large soft ambient shapes */
.layer { position: absolute; inset: 0; will-change: transform; }
.layer-far { opacity: 0.6; }
.shape {
  position: absolute; border-radius: 50%;
  filter: blur(100px);
}
.sh-1 {
  width: 700px; height: 700px; top: -15%; left: -10%;
  background: radial-gradient(circle, rgba(0,121,147,0.25) 0%, transparent 70%);
}
.sh-2 {
  width: 500px; height: 500px; bottom: 5%; right: -5%;
  background: radial-gradient(circle, rgba(255,151,51,0.15) 0%, transparent 70%);
}
.sh-3 {
  width: 400px; height: 400px; top: 40%; left: 45%;
  background: radial-gradient(circle, rgba(10,80,98,0.2) 0%, transparent 70%);
}

/* Mid layer — geometric abstract elements (floating planes) */
.layer-mid { transform-style: preserve-3d; }
.geo {
  position: absolute;
  border: 1px solid rgba(0,121,147,0.12);
  border-radius: 4px;
  background: linear-gradient(135deg, rgba(0,121,147,0.04) 0%, rgba(255,255,255,0.02) 100%);
  backdrop-filter: blur(1px);
}
.geo-1 { width: 180px; height: 120px; top: 12%; left: 8%; transform: rotateY(-12deg) rotateX(5deg); }
.geo-2 { width: 140px; height: 200px; top: 25%; right: 12%; transform: rotateY(8deg) rotateX(-3deg); }
.geo-3 { width: 220px; height: 80px;  top: 55%; left: 20%; transform: rotateY(-5deg) rotateX(8deg); }
.geo-4 { width: 100px; height: 160px; top: 60%; right: 25%; transform: rotateY(15deg) rotateX(-6deg); }
.geo-5 { width: 160px; height: 100px; top: 78%; left: 50%; transform: rotateY(-10deg) rotateX(4deg); }

/* Near layer — vertical columns like book spines in a library */
.layer-near { transform-style: preserve-3d; }
.col {
  position: absolute; bottom: 0;
  border-radius: 3px 3px 0 0;
  background: linear-gradient(180deg, rgba(0,121,147,0.08) 0%, rgba(10,80,98,0.15) 100%);
  border: 1px solid rgba(0,121,147,0.06);
  border-bottom: none;
}
.col-1 { width: 28px; height: 55%; left: 5%;  background: linear-gradient(180deg, rgba(0,121,147,0.06) 0%, rgba(0,121,147,0.12) 100%); }
.col-2 { width: 22px; height: 70%; left: 12%; background: linear-gradient(180deg, rgba(255,151,51,0.04) 0%, rgba(255,151,51,0.08) 100%); }
.col-3 { width: 32px; height: 48%; left: 22%; }
.col-4 { width: 26px; height: 62%; left: 55%; background: linear-gradient(180deg, rgba(10,80,98,0.05) 0%, rgba(10,80,98,0.12) 100%); }
.col-5 { width: 20px; height: 75%; left: 68%; background: linear-gradient(180deg, rgba(0,121,147,0.04) 0%, rgba(0,121,147,0.1) 100%); }
.col-6 { width: 30px; height: 52%; left: 80%; }
.col-7 { width: 24px; height: 65%; left: 92%; background: linear-gradient(180deg, rgba(255,151,51,0.03) 0%, rgba(255,151,51,0.07) 100%); }

/* ── Content sections ── */
.hero {
  position: relative; z-index: 2;
  padding: 72px 24px 64px; text-align: center;
}
.hero-inner { max-width: 600px; margin: 0 auto; }

.hero-h1 {
  font-size: 38px; font-weight: 800; color: #e8f4f6; line-height: 1.15;
  margin-bottom: 16px; letter-spacing: -0.5px;
  text-shadow: 0 2px 20px rgba(0,0,0,0.3);
}
.hero-accent { color: #22c9e8; }

.hero-brand { position: relative; display: inline-block; margin-bottom: 24px; }
.hero-logo { height: 40px; width: auto; filter: brightness(10); }
.hero-badge {
  position: absolute; top: -6px; right: -70px;
  font-size: 10px; font-weight: 700; color: var(--orange);
  text-transform: uppercase; letter-spacing: 1.5px;
}

.hero-props { display: flex; justify-content: center; gap: 24px; margin-bottom: 28px; flex-wrap: wrap; }
.hp {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.7);
}
.hp svg { stroke: #22c9e8; }

.hero-sources {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  margin-top: 4px; flex-wrap: wrap;
}
.hs {
  font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.8);
  padding: 3px 10px; border-radius: 6px;
  background: rgba(255,255,255,0.06); letter-spacing: 0.3px;
  border: 1px solid rgba(255,255,255,0.08);
}
.hs-dot { width: 3px; height: 3px; border-radius: 50%; background: rgba(255,255,255,0.2); flex-shrink: 0; }

/* ── Form ── */
.form-section { position: relative; z-index: 2; padding: 0 24px 80px; }
.form-card {
  max-width: 560px; margin: 0 auto;
  background: rgba(255,255,255,0.07); backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
  border-radius: 20px; border: 1px solid rgba(255,255,255,0.1);
  padding: 36px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.05) inset;
}

.fc-head { margin-bottom: 24px; }
.fc-head h2 { font-size: 20px; font-weight: 700; color: #e8f4f6; margin-bottom: 4px; }
.fc-head p { font-size: 14px; color: rgba(255,255,255,0.5); }

.field { margin-bottom: 18px; }
.field label { display: block; font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.7); margin-bottom: 6px; }
.field-row { display: flex; gap: 14px; }
.field-half { flex: 1; min-width: 0; }

.inp {
  width: 100%; padding: 12px 16px;
  border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
  font-size: 14px; font-family: inherit; outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  background: rgba(255,255,255,0.05); color: #e8f4f6;
}
.inp:focus {
  border-color: rgba(34,201,232,0.5);
  box-shadow: 0 0 0 3px rgba(34,201,232,0.1);
  background: rgba(255,255,255,0.08);
}
.inp::placeholder { color: rgba(255,255,255,0.25); }

.actions { display: flex; gap: 10px; margin-top: 28px; }

.btn-primary {
  flex: 1; padding: 15px; border: none; border-radius: 14px;
  background: linear-gradient(135deg, var(--orange), #e8870a);
  color: white;
  font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer;
  box-shadow: 0 4px 20px rgba(255,151,51,0.3); transition: all 0.2s;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 28px rgba(255,151,51,0.5); }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-ghost {
  padding: 15px 22px; border: 1px solid rgba(255,255,255,0.12); border-radius: 14px;
  background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.8); font-size: 14px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.btn-ghost:hover:not(:disabled) { border-color: rgba(34,201,232,0.4); color: #22c9e8; background: rgba(34,201,232,0.06); }
.btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }

.status { margin-top: 16px; padding: 12px 16px; border-radius: 12px; font-size: 13px; line-height: 1.5; }
.status-ok { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.2); }
.status-err { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }

.spin { width: 18px; height: 18px; border: 2.5px solid rgba(255,255,255,0.2); border-top-color: white; border-radius: 50%; animation: sp .6s linear infinite; display: inline-block; }
.spin-dark { border-color: rgba(255,255,255,0.1); border-top-color: #22c9e8; }
@keyframes sp { to { transform: rotate(360deg) } }

/* Vuetify overrides for dark theme */
:deep(.v-field) { background: rgba(255,255,255,0.05) !important; border-color: rgba(255,255,255,0.1) !important; color: #e8f4f6 !important; }
:deep(.v-field__input) { color: #e8f4f6 !important; }
:deep(.v-field--focused) { border-color: rgba(34,201,232,0.5) !important; }
:deep(.v-chip) { background: rgba(34,201,232,0.15) !important; color: #22c9e8 !important; }
:deep(.v-field__input::placeholder) { color: rgba(255,255,255,0.25) !important; }
:deep(.v-select__selection-text) { color: #e8f4f6 !important; }
:deep(.v-field__append-inner .v-icon) { color: rgba(255,255,255,0.4) !important; }

@media (max-width: 600px) {
  .hero-h1 { font-size: 28px; }
  .hero-props { gap: 16px; }
  .field-row { flex-direction: column; gap: 0; }
  .actions { flex-direction: column; }
  .hero { padding: 48px 16px 40px; }
  .form-card { padding: 24px; border-radius: 16px; }
  .geo { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .scene { display: none; }
  .page { background: #0d2832; }
}
</style>
