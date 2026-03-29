<template>
<div class="page">
  <!-- Hero section -->
  <section class="hero">
    <!-- Animated background -->
    <div class="hero-bg">
      <div class="orb orb-1"></div>
      <div class="orb orb-2"></div>
      <div class="orb orb-3"></div>
      <div class="mesh"></div>
      <div class="grid-lines">
        <div class="gl gl-h gl-1"></div>
        <div class="gl gl-h gl-2"></div>
        <div class="gl gl-h gl-3"></div>
        <div class="gl gl-v gl-4"></div>
        <div class="gl gl-v gl-5"></div>
      </div>
    </div>
    <div class="hero-inner">
      <div class="hero-brand">
        <img src="/logo.svg" alt="AI:ssociate" class="hero-logo" />
        <span class="hero-badge">Monitoring</span>
      </div>
      <div class="hero-props">
        <div class="hp">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          <span>86 Rechtsgebiete</span>
        </div>
        <div class="hp">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.5"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>
          <span>Versionsvergleich</span>
        </div>
        <div class="hp">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          <span>Gesetzesmaterialien</span>
        </div>
        <div class="hp">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          <span>KI-Analyse</span>
        </div>
      </div>
      <h1 class="hero-h1">Rechtsänderungen.<br/><span class="hero-accent">Automatisch. Analysiert.</span></h1>
      <div class="hero-sources">
        <span class="hs">RIS</span>
        <span class="hs-dot"></span>
        <span class="hs">Findok</span>
        <span class="hs-dot"></span>
        <span class="hs">EUR-Lex</span>
        <span class="hs-dot"></span>
        <span class="hs">parlament.gv.at</span>
      </div>
    </div>
  </section>

  <!-- Report form -->
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

  <footer class="foot">
    <p>Datenquelle: Rechtsinformationssystem des Bundes (RIS) · data.bka.gv.at</p>
  </footer>
</div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import api from '../services/api'

const categories = ref([])
const timeframes = ref([])
const selectedCategory = ref([])
const selectedTimeframe = ref('EinemMonat')
const datumVon = ref('')
const datumBis = ref('')
const reportEmail = ref(localStorage.getItem('ris_report_email') || '')

// Timeframe options: server list + custom date option
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
  // Search both Gesetze + Entscheidungen and combine
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
  if (selectedTimeframe.value === 'custom' && datumVon.value && datumBis.value) {
    return `${datumVon.value} bis ${datumBis.value}`
  }
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
    statusMsg.value = `✓ Report an ${reportEmail.value} gesendet.`; statusOk.value = true
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
    statusMsg.value = '✓ Report heruntergeladen.'; statusOk.value = true
  } catch(e) { statusMsg.value = e.response?.data?.detail || `Fehler: ${e.message}`; statusOk.value = false }
  finally { generating.value = false }
}
</script>

<style scoped>
.page {
  min-height: calc(100vh - 56px);
  background:
    radial-gradient(ellipse at 10% 90%, rgba(0,121,147,0.03) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 10%, rgba(255,151,51,0.02) 0%, transparent 50%),
    #fafbfc;
}

/* ── Hero ── */
.hero {
  background: linear-gradient(135deg, #f1fbfb 0%, #e8f6f9 50%, #fff8ed 100%);
  padding: 64px 24px 48px; text-align: center;
  position: relative; overflow: hidden;
}
.hero-inner { max-width: 600px; margin: 0 auto; position: relative; z-index: 2; }

/* ── Animated background ── */
.hero-bg { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }

/* Floating orbs — slow drifting blurred circles */
.orb {
  position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.35;
  will-change: transform;
}
.orb-1 {
  width: 400px; height: 400px; top: -120px; left: -80px;
  background: radial-gradient(circle, rgba(0,121,147,0.4) 0%, transparent 70%);
  animation: drift1 20s ease-in-out infinite;
}
.orb-2 {
  width: 350px; height: 350px; bottom: -100px; right: -60px;
  background: radial-gradient(circle, rgba(255,151,51,0.3) 0%, transparent 70%);
  animation: drift2 25s ease-in-out infinite;
}
.orb-3 {
  width: 250px; height: 250px; top: 50%; left: 55%;
  background: radial-gradient(circle, rgba(10,80,98,0.2) 0%, transparent 70%);
  animation: drift3 18s ease-in-out infinite;
}
@keyframes drift1 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  25% { transform: translate(60px, 30px) scale(1.05); }
  50% { transform: translate(30px, -20px) scale(0.95); }
  75% { transform: translate(-20px, 40px) scale(1.02); }
}
@keyframes drift2 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  30% { transform: translate(-50px, -30px) scale(1.08); }
  60% { transform: translate(20px, 20px) scale(0.92); }
  80% { transform: translate(-30px, -10px) scale(1.03); }
}
@keyframes drift3 {
  0%, 100% { transform: translate(0, 0) scale(1) rotate(0deg); }
  33% { transform: translate(40px, -40px) scale(1.1) rotate(5deg); }
  66% { transform: translate(-30px, 30px) scale(0.9) rotate(-3deg); }
}

/* Mesh noise overlay — animated gradient that subtly shifts */
.mesh {
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 20% 50%, rgba(0,121,147,0.06) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 20%, rgba(255,151,51,0.05) 0%, transparent 50%),
    radial-gradient(ellipse at 50% 80%, rgba(10,80,98,0.04) 0%, transparent 50%);
  animation: meshShift 30s ease-in-out infinite;
}
@keyframes meshShift {
  0%, 100% { opacity: 1; transform: scale(1) rotate(0deg); }
  50% { opacity: 0.7; transform: scale(1.05) rotate(1deg); }
}

/* Grid lines — subtle moving lines like a data visualization */
.grid-lines { position: absolute; inset: 0; }
.gl {
  position: absolute; background: rgba(0,121,147,0.04);
}
.gl-h { height: 1px; width: 100%; }
.gl-v { width: 1px; height: 100%; }
.gl-1 { top: 25%; animation: glideH 12s linear infinite; }
.gl-2 { top: 55%; animation: glideH 16s linear infinite reverse; }
.gl-3 { top: 80%; animation: glideH 20s linear infinite; }
.gl-4 { left: 30%; animation: glideV 14s linear infinite; }
.gl-5 { left: 70%; animation: glideV 18s linear infinite reverse; }
@keyframes glideH {
  0% { transform: translateX(-5%) scaleX(0.8); opacity: 0; }
  10% { opacity: 0.6; }
  50% { transform: translateX(0) scaleX(1); opacity: 0.3; }
  90% { opacity: 0.6; }
  100% { transform: translateX(5%) scaleX(0.8); opacity: 0; }
}
@keyframes glideV {
  0% { transform: translateY(-5%) scaleY(0.8); opacity: 0; }
  10% { opacity: 0.5; }
  50% { transform: translateY(0) scaleY(1); opacity: 0.25; }
  90% { opacity: 0.5; }
  100% { transform: translateY(5%) scaleY(0.8); opacity: 0; }
}
.hero-h1 {
  font-size: 36px; font-weight: 800; color: #0a2e36; line-height: 1.2;
  margin-bottom: 16px; letter-spacing: -0.5px;
  animation: fadeUp 0.8s ease-out;
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
.hero-accent { color: var(--teal); }
.hero-p { font-size: 16px; color: var(--muted); line-height: 1.7; }

.hero-brand { position: relative; display: inline-block; margin-bottom: 24px; animation: fadeUp 0.6s ease-out; }
.hero-logo { height: 40px; width: auto; }
.hero-badge {
  position: absolute; top: -6px; right: -70px;
  font-size: 10px; font-weight: 700; color: var(--orange);
  text-transform: uppercase; letter-spacing: 1.5px;
}
.hero-props { display: flex; justify-content: center; gap: 24px; margin-bottom: 28px; flex-wrap: wrap; animation: fadeUp 1s ease-out; }
.hp {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 500; color: #0a2e36;
}
.hero-sources {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  margin-top: 4px; flex-wrap: wrap; animation: fadeUp 1.2s ease-out;
}
.hs {
  font-size: 12px; font-weight: 600; color: var(--navy);
  padding: 3px 10px; border-radius: 6px;
  background: rgba(10,80,98,0.06); letter-spacing: 0.3px;
  transition: all 0.3s ease;
}
.hs:hover { background: rgba(0,121,147,0.12); transform: translateY(-1px); }
.hs-dot {
  width: 3px; height: 3px; border-radius: 50%;
  background: var(--muted); flex-shrink: 0;
}

/* ── Form ── */
.form-section { padding: 0 24px; margin-top: -24px; position: relative; z-index: 1; }
.form-card {
  max-width: 560px; margin: 0 auto;
  background: rgba(255,255,255,0.85); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border-radius: 16px; border: 1px solid rgba(255,255,255,0.6);
  padding: 32px; box-shadow: 0 4px 24px rgba(0,40,50,0.06), 0 1px 0 rgba(255,255,255,0.8) inset;
  animation: cardIn 0.7s ease-out 0.3s both;
}
@keyframes cardIn {
  from { opacity: 0; transform: translateY(30px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.fc-head { margin-bottom: 24px; }
.fc-head h2 { font-size: 20px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
.fc-head p { font-size: 14px; color: var(--muted); }

.field { margin-bottom: 18px; }
.field label { display: block; font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
.field-row { display: flex; gap: 14px; }
.field-half { flex: 1; min-width: 0; }
.opt { font-size: 11px; font-weight: 400; color: var(--muted); margin-left: 4px; }

.inp {
  width: 100%; padding: 10px 14px; border: 1px solid var(--border); border-radius: 10px;
  font-size: 14px; font-family: inherit; outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  background: rgba(255,255,255,0.8);
}
.inp:focus { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(0,121,147,0.08); }

.actions { display: flex; gap: 10px; margin-top: 24px; }
.btn-primary {
  flex: 1; padding: 14px; border: none; border-radius: 12px;
  background: linear-gradient(135deg, var(--orange) 0%, #f59e0b 100%);
  color: white; position: relative; overflow: hidden;
  font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer;
  box-shadow: 0 4px 12px rgba(255,151,51,0.3); transition: all 0.3s;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.btn-primary::before {
  content: ''; position: absolute; top: 0; left: -100%; width: 100%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
  animation: btnShimmer 3s ease-in-out infinite;
}
@keyframes btnShimmer {
  0%, 100% { left: -100%; }
  50% { left: 100%; }
}
.btn-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(255,151,51,0.5); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-ghost {
  padding: 14px 20px; border: 1px solid var(--border); border-radius: 12px;
  background: white; color: var(--text); font-size: 14px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.btn-ghost:hover:not(:disabled) { border-color: var(--teal); color: var(--teal); }
.btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }

.status { margin-top: 16px; padding: 12px 16px; border-radius: 10px; font-size: 13px; line-height: 1.5; }
.status-ok { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
.status-err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

.foot { text-align: center; padding: 24px; }
.foot p { font-size: 12px; color: #c4c8cc; }

.spin { width: 18px; height: 18px; border: 2.5px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: sp .6s linear infinite; display: inline-block; }
.spin-dark { border-color: rgba(0,0,0,0.1); border-top-color: var(--teal); }
@keyframes sp { to { transform: rotate(360deg) } }

@media (max-width: 600px) {
  .hero-h1 { font-size: 28px; }
  .field-row { flex-direction: column; gap: 0; }
  .actions { flex-direction: column; }
  .props-inner { grid-template-columns: 1fr; gap: 24px; }
}
</style>
