<template>
<div class="page">
  <!-- Hero section -->
  <section class="hero">
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
          <v-select v-model="selectedTimeframe" :items="timeframes" item-title="label" item-value="value"
            variant="outlined" density="compact" hide-details color="#007993" bg-color="white" />
        </div>
        <div class="field field-half">
          <label>E-Mail</label>
          <input v-model="reportEmail" type="email" placeholder="name@kanzlei.at" class="inp" />
        </div>
      </div>

      <div class="field">
        <label>OpenAI API-Key <span class="opt">(optional — für KI-Analyse)</span></label>
        <input v-model="apiKey" type="password" placeholder="sk-..." class="inp" />
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
const apiKey = ref(localStorage.getItem('ris_openai_key') || '')
const reportEmail = ref(localStorage.getItem('ris_report_email') || '')
const sending = ref(false)
const generating = ref(false)
const statusMsg = ref('')
const statusOk = ref(false)

watch(apiKey, v => { if(v) localStorage.setItem('ris_openai_key',v); else localStorage.removeItem('ris_openai_key') })
watch(reportEmail, v => { if(v) localStorage.setItem('ris_report_email',v) })

onMounted(async () => {
  try {
    const [a,b] = await Promise.all([api.get('/categories'), api.get('/timeframes')])
    categories.value = a.data; timeframes.value = b.data
  } catch { statusMsg.value = 'Verbindung fehlgeschlagen.'; statusOk.value = false }
})

async function doSearch() {
  const cats = selectedCategory.value || []
  // Search both Gesetze + Entscheidungen and combine
  const endpoints = ['/search/gesetze', '/search/gerichtsentscheidungen']
  const allResults = []; let allHits = 0; const seen = new Set()
  for (const ep of endpoints) {
    if (cats.length <= 1) {
      const p = { im_ris_seit: selectedTimeframe.value, page: 1 }
      if (cats.length === 1) p.category = cats[0]
      try { const r = (await api.get(ep, { params: p })).data; allHits += r.total_hits || 0; for (const i of (r.results||[])) { if(!seen.has(i.id)){seen.add(i.id);allResults.push(i)} } } catch {}
    } else {
      const ps = cats.map(c => api.get(ep, { params: { im_ris_seit: selectedTimeframe.value, page: 1, category: c } }).catch(()=>({data:{results:[],total_hits:0}})))
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
function tfLabel() { const t=timeframes.value.find(x=>x.value===selectedTimeframe.value); return t?t.label:'' }

async function sendReport() {
  if (!reportEmail.value || !selectedCategory.value.length) return
  sending.value = true; statusMsg.value = 'Suche läuft…'; statusOk.value = true
  try {
    const data = await doSearch()
    if (!data.results?.length) { statusMsg.value = 'Keine Ergebnisse.'; statusOk.value = false; return }
    statusMsg.value = `${data.results.length} Ergebnisse. Report wird versendet…`
    await api.post('/report/email', { email: reportEmail.value, api_key: apiKey.value||'', results: data.results, doc_type: 'gesetze', category_label: catLabel(), timeframe_label: tfLabel(), total_hits: data.total_hits, diffs: {} })
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
    const r = await api.post('/report', { api_key: apiKey.value||'', results: data.results, doc_type: 'gesetze', category_label: catLabel(), timeframe_label: tfLabel(), total_hits: data.total_hits, diffs: {} })
    const b = new Blob([r.data.report_html],{type:'text/html;charset=utf-8'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=`Report_${new Date().toISOString().split('T')[0]}.html`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u)
    statusMsg.value = '✓ Report heruntergeladen.'; statusOk.value = true
  } catch(e) { statusMsg.value = e.response?.data?.detail || `Fehler: ${e.message}`; statusOk.value = false }
  finally { generating.value = false }
}
</script>

<style scoped>
.page { min-height: calc(100vh - 56px); }

/* ── Hero ── */
.hero {
  background: linear-gradient(135deg, #f1fbfb 0%, #e8f6f9 50%, #fff8ed 100%);
  padding: 64px 24px 48px; text-align: center;
}
.hero-inner { max-width: 600px; margin: 0 auto; }
.hero-h1 { font-size: 36px; font-weight: 800; color: #0a2e36; line-height: 1.2; margin-bottom: 16px; letter-spacing: -0.5px; }
.hero-accent { color: var(--teal); }
.hero-p { font-size: 16px; color: var(--muted); line-height: 1.7; }

.hero-brand { position: relative; display: inline-block; margin-bottom: 24px; }
.hero-logo { height: 40px; width: auto; }
.hero-badge {
  position: absolute; top: -6px; right: -70px;
  font-size: 10px; font-weight: 700; color: var(--orange);
  text-transform: uppercase; letter-spacing: 1.5px;
}
.hero-props { display: flex; justify-content: center; gap: 24px; margin-bottom: 28px; flex-wrap: wrap; }
.hp {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 500; color: #0a2e36;
}

/* ── Form ── */
.form-section { padding: 0 24px; margin-top: -24px; position: relative; z-index: 1; }
.form-card {
  max-width: 560px; margin: 0 auto;
  background: white; border-radius: 16px; border: 1px solid var(--border);
  padding: 32px; box-shadow: 0 4px 24px rgba(0,40,50,0.06);
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
  font-size: 14px; font-family: inherit; outline: none; transition: border-color 0.2s;
}
.inp:focus { border-color: var(--teal); }

.actions { display: flex; gap: 10px; margin-top: 24px; }
.btn-primary {
  flex: 1; padding: 14px; border: none; border-radius: 12px;
  background: var(--orange); color: white;
  font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer;
  box-shadow: 0 4px 12px rgba(255,151,51,0.3); transition: all 0.2s;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(255,151,51,0.45); }
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
