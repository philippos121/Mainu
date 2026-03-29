<template>
<div class="page">
  <div class="content">
    <!-- Hero -->
    <div class="hero">
      <div class="hero-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.2" stroke-linecap="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="9" y1="15" x2="15" y2="15" stroke="var(--orange)" stroke-width="2"/>
          <line x1="9" y1="11" x2="13" y2="11" opacity=".4"/>
          <line x1="9" y1="19" x2="12" y2="19" opacity=".4"/>
        </svg>
      </div>
      <h1>Rechtsänderungs-Report</h1>
      <p class="hero-sub">Wählen Sie Rechtsgebiete und Zeitraum — erhalten Sie einen Report mit allen Gesetzesänderungen, Versionsvergleichen und KI-Analyse direkt per E-Mail.</p>
    </div>

    <!-- Form -->
    <div class="form-card">
      <!-- Step 1: Rechtsgebiete -->
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-body">
          <label class="step-label">Rechtsgebiete</label>
          <v-select v-model="selectedCategory" :items="categories" item-title="label" item-value="id"
            variant="outlined" density="compact" multiple chips closable-chips clearable hide-details
            placeholder="Rechtsgebiete wählen…" color="#007993" bg-color="white" />
        </div>
      </div>

      <!-- Step 2: Zeitraum -->
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-body">
          <label class="step-label">Zeitraum</label>
          <v-select v-model="selectedTimeframe" :items="timeframes" item-title="label" item-value="value"
            variant="outlined" density="compact" hide-details color="#007993" bg-color="white" />
        </div>
      </div>

      <!-- Step 3: Dokumenttyp -->
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-body">
          <label class="step-label">Dokumenttyp</label>
          <div class="seg">
            <button :class="['seg-btn', docType==='gesetze'&&'seg-active']" @click="docType='gesetze'">Gesetze</button>
            <button :class="['seg-btn', docType==='gerichtsentscheidungen'&&'seg-active']" @click="docType='gerichtsentscheidungen'">Entscheidungen</button>
          </div>
        </div>
      </div>

      <!-- Step 4: E-Mail -->
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-body">
          <label class="step-label">E-Mail-Adresse</label>
          <input v-model="reportEmail" type="email" placeholder="name@kanzlei.at" class="email-input" />
        </div>
      </div>

      <!-- Step 5: OpenAI Key (optional) -->
      <div class="step step-optional">
        <div class="step-num step-num-opt">+</div>
        <div class="step-body">
          <label class="step-label">OpenAI API-Key <span class="opt-tag">optional</span></label>
          <input v-model="apiKey" type="password" placeholder="sk-… (für KI-Zusammenfassung)" class="email-input" />
        </div>
      </div>

      <!-- Action -->
      <div class="actions">
        <button class="btn-send" :disabled="!reportEmail || !selectedCategory.length || sending" @click="sendReport">
          <span v-if="sending" class="spin"></span>
          <template v-else>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Report per E-Mail senden
          </template>
        </button>
        <button class="btn-dl" :disabled="!selectedCategory.length || generating" @click="downloadReport">
          <span v-if="generating" class="spin spin-dark"></span>
          <template v-else>↓ Report herunterladen</template>
        </button>
      </div>

      <!-- Status -->
      <div v-if="statusMsg" :class="['status', statusOk ? 'status-ok' : 'status-err']">{{ statusMsg }}</div>
    </div>

    <!-- Features -->
    <div class="features">
      <div class="feat">
        <div class="feat-icon">⚖️</div>
        <strong>86 Rechtsgebiete</strong>
        <span>Vollständige Abdeckung nach offizieller RIS-Klassifikation</span>
      </div>
      <div class="feat">
        <div class="feat-icon">📊</div>
        <strong>Versionsvergleich</strong>
        <span>Automatischer Diff zwischen aktueller und vorheriger Fassung</span>
      </div>
      <div class="feat">
        <div class="feat-icon">🏛️</div>
        <strong>Gesetzesmaterialien</strong>
        <span>Erläuterungen und Regierungsvorlagen aus dem Parlament</span>
      </div>
      <div class="feat">
        <div class="feat-icon">🤖</div>
        <strong>KI-Analyse</strong>
        <span>Juristische Zusammenfassung wie von einem österreichischen Anwalt</span>
      </div>
    </div>

    <p class="footer-text">Datenquelle: Rechtsinformationssystem des Bundes (RIS) · data.bka.gv.at</p>
  </div>
</div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import api from '../services/api'

const docType = ref('gesetze')
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
    categories.value = a.data
    timeframes.value = b.data
  } catch { statusMsg.value = 'Filter konnten nicht geladen werden.'; statusOk.value = false }
})

async function doSearch() {
  const ep = docType.value === 'gesetze' ? '/search/gesetze' : '/search/gerichtsentscheidungen'
  const cats = selectedCategory.value || []
  if (cats.length <= 1) {
    const p = { im_ris_seit: selectedTimeframe.value, page: 1 }
    if (cats.length === 1) p.category = cats[0]
    return (await api.get(ep, { params: p })).data
  }
  const ps = cats.map(c => api.get(ep, { params: { im_ris_seit: selectedTimeframe.value, page: 1, category: c } }))
  const rs = await Promise.all(ps)
  const all = []; let h = 0; const s = new Set()
  for (const r of rs) { h += r.data.total_hits || 0; for (const i of (r.data.results || [])) { if (!s.has(i.id)) { s.add(i.id); all.push(i) } } }
  return { results: all, total_hits: h }
}

function catLabel() {
  const c = selectedCategory.value || []
  if (!c.length) return 'Alle'
  if (c.length === 1) { const f = categories.value.find(x => x.id === c[0]); return f ? f.label : '' }
  return `${c.length} Rechtsgebiete`
}

function tfLabel() { const t = timeframes.value.find(x => x.value === selectedTimeframe.value); return t ? t.label : '' }

async function sendReport() {
  if (!reportEmail.value || !selectedCategory.value.length) return
  sending.value = true; statusMsg.value = ''
  try {
    statusMsg.value = 'Suche läuft…'; statusOk.value = true
    const data = await doSearch()
    if (!data.results?.length) { statusMsg.value = 'Keine Ergebnisse gefunden.'; statusOk.value = false; return }

    statusMsg.value = `${data.results.length} Ergebnisse gefunden. Report wird erstellt und versendet…`
    await api.post('/report/email', {
      email: reportEmail.value, api_key: apiKey.value || '', results: data.results,
      doc_type: docType.value, category_label: catLabel(), timeframe_label: tfLabel(),
      total_hits: data.total_hits, diffs: {},
    })
    statusMsg.value = `✓ Report wurde an ${reportEmail.value} gesendet.`; statusOk.value = true
  } catch (e) {
    statusMsg.value = e.response?.data?.detail || `Fehler: ${e.message}`; statusOk.value = false
  } finally { sending.value = false }
}

async function downloadReport() {
  if (!selectedCategory.value.length) return
  generating.value = true; statusMsg.value = ''
  try {
    statusMsg.value = 'Suche läuft…'; statusOk.value = true
    const data = await doSearch()
    if (!data.results?.length) { statusMsg.value = 'Keine Ergebnisse gefunden.'; statusOk.value = false; return }

    statusMsg.value = `${data.results.length} Ergebnisse. Report wird erstellt…`
    const r = await api.post('/report', {
      api_key: apiKey.value || '', results: data.results, doc_type: docType.value,
      category_label: catLabel(), timeframe_label: tfLabel(), total_hits: data.total_hits, diffs: {},
    })
    const b = new Blob([r.data.report_html], { type: 'text/html;charset=utf-8' })
    const u = URL.createObjectURL(b); const a = document.createElement('a')
    a.href = u; a.download = `Report_${new Date().toISOString().split('T')[0]}.html`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u)
    statusMsg.value = '✓ Report heruntergeladen.'; statusOk.value = true
  } catch (e) {
    statusMsg.value = e.response?.data?.detail || `Fehler: ${e.message}`; statusOk.value = false
  } finally { generating.value = false }
}
</script>

<style scoped>
.page { min-height: calc(100vh - 56px); display: flex; justify-content: center; padding: 40px 24px 60px; }
.content { width: 100%; max-width: 640px; }

/* ── Hero ── */
.hero { text-align: center; margin-bottom: 32px; animation: fadeUp 0.5s ease-out; }
.hero-icon {
  width: 80px; height: 80px; border-radius: 20px;
  background: var(--teal-50); display: flex; align-items: center; justify-content: center;
  margin: 0 auto 16px;
}
.hero h1 { font-size: 26px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
.hero-sub { font-size: 15px; color: var(--muted); line-height: 1.7; max-width: 500px; margin: 0 auto; }

/* ── Form ── */
.form-card {
  background: white; border-radius: 16px; border: 1px solid var(--border);
  padding: 28px; box-shadow: 0 2px 12px rgba(0,0,0,0.04);
  margin-bottom: 40px; animation: fadeUp 0.5s 0.1s ease-out both;
}

.step { display: flex; gap: 14px; margin-bottom: 20px; }
.step-num {
  width: 28px; height: 28px; min-width: 28px; border-radius: 8px;
  background: var(--teal); color: white; font-size: 13px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; margin-top: 2px;
}
.step-num-opt { background: var(--muted); font-size: 16px; }
.step-body { flex: 1; min-width: 0; }
.step-label { display: block; font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
.step-optional { opacity: 0.7; }
.opt-tag { font-size: 10px; font-weight: 500; color: var(--muted); background: #f3f4f6; padding: 2px 6px; border-radius: 4px; margin-left: 4px; }

.seg { display: flex; background: #f3f4f6; border-radius: 10px; padding: 3px; }
.seg-btn {
  flex: 1; padding: 8px 0; font-size: 13px; font-weight: 600;
  border: none; border-radius: 8px; cursor: pointer;
  background: transparent; color: var(--muted); font-family: inherit; transition: all 0.2s;
}
.seg-active { background: var(--teal); color: white; box-shadow: 0 2px 6px rgba(0,121,147,0.25); }

.email-input {
  width: 100%; padding: 10px 14px; border: 1px solid var(--border); border-radius: 10px;
  font-size: 14px; font-family: inherit; outline: none; transition: border-color 0.2s;
}
.email-input:focus { border-color: var(--teal); }

/* ── Actions ── */
.actions { display: flex; gap: 10px; margin-top: 24px; }
.btn-send {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 14px; border: none; border-radius: 12px;
  background: var(--orange); color: white;
  font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer;
  box-shadow: 0 4px 12px rgba(255,151,51,0.35); transition: all 0.2s;
}
.btn-send:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(255,151,51,0.5); }
.btn-send:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-dl {
  padding: 14px 20px; border: 1px solid var(--border); border-radius: 12px;
  background: white; color: var(--text); font-size: 14px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.btn-dl:hover:not(:disabled) { border-color: var(--teal); color: var(--teal); }
.btn-dl:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Status ── */
.status { margin-top: 16px; padding: 10px 14px; border-radius: 10px; font-size: 13px; animation: fadeUp 0.3s; }
.status-ok { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
.status-err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

/* ── Features ── */
.features {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  margin-bottom: 32px; animation: fadeUp 0.5s 0.2s ease-out both;
}
.feat {
  padding: 16px; background: white; border-radius: var(--radius);
  border: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px;
}
.feat-icon { font-size: 20px; margin-bottom: 4px; }
.feat strong { font-size: 13px; color: var(--text); }
.feat span { font-size: 12px; color: var(--muted); line-height: 1.5; }

.footer-text { text-align: center; font-size: 12px; color: #c4c8cc; }

.spin { width: 18px; height: 18px; border: 2.5px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: sp .6s linear infinite; display: inline-block; }
.spin-dark { border-color: rgba(0,0,0,0.1); border-top-color: var(--teal); }
@keyframes sp { to { transform: rotate(360deg) } }

@media (max-width: 600px) {
  .features { grid-template-columns: 1fr; }
  .actions { flex-direction: column; }
}
</style>
