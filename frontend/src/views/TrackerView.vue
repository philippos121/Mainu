<template>
<div class="page">
  <!-- Ambient page background particles -->
  <div class="page-bg">
    <div class="pb pb-1"></div>
    <div class="pb pb-2"></div>
    <div class="pb pb-3"></div>
    <div class="pb pb-4"></div>
  </div>

  <!-- Hero section -->
  <section class="hero">
    <!-- Animated background layers -->
    <div class="hero-bg">
      <div class="orb orb-1"></div>
      <div class="orb orb-2"></div>
      <div class="orb orb-3"></div>
      <div class="orb orb-4"></div>
      <div class="orb orb-5"></div>
      <div class="aurora"></div>
      <div class="scan-line"></div>
      <div class="particles">
        <div class="pt pt-1"></div><div class="pt pt-2"></div><div class="pt pt-3"></div>
        <div class="pt pt-4"></div><div class="pt pt-5"></div><div class="pt pt-6"></div>
        <div class="pt pt-7"></div><div class="pt pt-8"></div><div class="pt pt-9"></div>
        <div class="pt pt-10"></div><div class="pt pt-11"></div><div class="pt pt-12"></div>
      </div>
      <div class="grid-overlay"></div>
    </div>
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

  <!-- Report form -->
  <section class="form-section">
    <div class="form-card">
      <div class="form-glow"></div>
      <div class="fc-head">
        <h2>Report erstellen</h2>
        <p>Wählen Sie Ihre Rechtsgebiete und erhalten Sie den Report direkt per E-Mail.</p>
      </div>

      <div class="field">
        <label>Rechtsgebiete</label>
        <div class="input-wrap">
          <v-select v-model="selectedCategory" :items="categories" item-title="label" item-value="id"
            variant="outlined" density="compact" multiple chips closable-chips clearable hide-details
            placeholder="Rechtsgebiete wählen…" color="#007993" bg-color="white" />
          <div class="input-border-anim"></div>
        </div>
      </div>

      <div class="field-row">
        <div class="field field-half">
          <label>Zeitraum</label>
          <div class="input-wrap">
            <v-select v-model="selectedTimeframe" :items="timeframeOptions" item-title="label" item-value="value"
              variant="outlined" density="compact" hide-details color="#007993" bg-color="white" />
            <div class="input-border-anim"></div>
          </div>
        </div>
        <div class="field field-half">
          <label>E-Mail</label>
          <div class="input-wrap">
            <input v-model="reportEmail" type="email" placeholder="name@kanzlei.at" class="inp" />
            <div class="input-border-anim"></div>
          </div>
        </div>
      </div>

      <div v-if="selectedTimeframe === 'custom'" class="field-row">
        <div class="field field-half">
          <label>Von</label>
          <div class="input-wrap"><input v-model="datumVon" type="date" class="inp" /><div class="input-border-anim"></div></div>
        </div>
        <div class="field field-half">
          <label>Bis</label>
          <div class="input-wrap"><input v-model="datumBis" type="date" class="inp" /><div class="input-border-anim"></div></div>
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
import { ref, watch, onMounted } from 'vue'
import api from '../services/api'

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
.page {
  min-height: 100vh; position: relative; overflow: hidden;
  background: linear-gradient(170deg, #f4fafb 0%, #f8f9fb 40%, #fdf8f3 100%);
}

/* ── Page ambient background ── */
.page-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
.pb {
  position: absolute; border-radius: 50%; filter: blur(120px); opacity: 0.15;
  will-change: transform;
}
.pb-1 { width: 600px; height: 600px; top: -200px; right: -100px; background: rgba(0,121,147,0.4); animation: ambFloat1 40s ease-in-out infinite; }
.pb-2 { width: 500px; height: 500px; bottom: -150px; left: -100px; background: rgba(255,151,51,0.3); animation: ambFloat2 35s ease-in-out infinite; }
.pb-3 { width: 400px; height: 400px; top: 40%; left: 60%; background: rgba(10,80,98,0.2); animation: ambFloat3 45s ease-in-out infinite; }
.pb-4 { width: 300px; height: 300px; top: 20%; left: 10%; background: rgba(0,121,147,0.15); animation: ambFloat4 50s ease-in-out infinite; }
@keyframes ambFloat1 { 0%,100%{transform:translate(0,0)} 25%{transform:translate(-80px,60px)} 50%{transform:translate(40px,120px)} 75%{transform:translate(60px,-40px)} }
@keyframes ambFloat2 { 0%,100%{transform:translate(0,0)} 30%{transform:translate(100px,-80px)} 60%{transform:translate(-40px,-40px)} 80%{transform:translate(60px,60px)} }
@keyframes ambFloat3 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(-60px,-80px) scale(1.2)} 66%{transform:translate(80px,40px) scale(0.8)} }
@keyframes ambFloat4 { 0%,100%{transform:translate(0,0) rotate(0deg)} 50%{transform:translate(100px,80px) rotate(10deg)} }

/* ── Hero ── */
.hero {
  padding: 64px 24px 56px; text-align: center;
  position: relative; overflow: hidden;
}
.hero-inner { max-width: 600px; margin: 0 auto; position: relative; z-index: 2; }

/* Hero animated layers */
.hero-bg { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }

.orb {
  position: absolute; border-radius: 50%; will-change: transform;
}
.orb-1 {
  width: 500px; height: 500px; top: -180px; left: -120px;
  background: radial-gradient(circle, rgba(0,121,147,0.15) 0%, transparent 70%);
  filter: blur(60px); animation: drift1 16s ease-in-out infinite;
}
.orb-2 {
  width: 400px; height: 400px; bottom: -120px; right: -80px;
  background: radial-gradient(circle, rgba(255,151,51,0.12) 0%, transparent 70%);
  filter: blur(60px); animation: drift2 20s ease-in-out infinite;
}
.orb-3 {
  width: 300px; height: 300px; top: 30%; left: 60%;
  background: radial-gradient(circle, rgba(10,80,98,0.1) 0%, transparent 70%);
  filter: blur(50px); animation: drift3 14s ease-in-out infinite;
}
.orb-4 {
  width: 200px; height: 200px; top: 60%; left: 15%;
  background: radial-gradient(circle, rgba(0,121,147,0.08) 0%, transparent 70%);
  filter: blur(40px); animation: drift4 22s ease-in-out infinite;
}
.orb-5 {
  width: 150px; height: 150px; top: 10%; right: 20%;
  background: radial-gradient(circle, rgba(255,151,51,0.06) 0%, transparent 70%);
  filter: blur(35px); animation: drift5 18s ease-in-out infinite;
}
@keyframes drift1 { 0%,100%{transform:translate(0,0) scale(1)} 25%{transform:translate(80px,40px) scale(1.1)} 50%{transform:translate(40px,-30px) scale(0.9)} 75%{transform:translate(-30px,60px) scale(1.05)} }
@keyframes drift2 { 0%,100%{transform:translate(0,0)} 30%{transform:translate(-70px,-40px) scale(1.15)} 60%{transform:translate(30px,30px) scale(0.85)} 80%{transform:translate(-40px,-15px)} }
@keyframes drift3 { 0%,100%{transform:translate(0,0) rotate(0deg)} 33%{transform:translate(50px,-50px) rotate(8deg)} 66%{transform:translate(-40px,40px) rotate(-5deg)} }
@keyframes drift4 { 0%,100%{transform:translate(0,0)} 40%{transform:translate(60px,-30px)} 70%{transform:translate(-20px,50px)} }
@keyframes drift5 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-40px,30px) scale(1.3)} }

/* Aurora — animated color band */
.aurora {
  position: absolute; inset: 0;
  background: linear-gradient(110deg,
    transparent 20%,
    rgba(0,121,147,0.04) 30%,
    rgba(255,151,51,0.03) 45%,
    rgba(10,80,98,0.04) 55%,
    transparent 70%
  );
  background-size: 200% 100%;
  animation: auroraShift 8s ease-in-out infinite;
}
@keyframes auroraShift {
  0%,100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

/* Horizontal scan line */
.scan-line {
  position: absolute; left: 0; width: 100%;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, rgba(0,121,147,0.15) 20%, rgba(0,121,147,0.25) 50%, rgba(0,121,147,0.15) 80%, transparent 100%);
  animation: scanDown 6s linear infinite;
  opacity: 0.5;
}
@keyframes scanDown {
  0% { top: -2px; opacity: 0; }
  5% { opacity: 0.6; }
  95% { opacity: 0.6; }
  100% { top: 100%; opacity: 0; }
}

/* Floating particles */
.particles { position: absolute; inset: 0; }
.pt {
  position: absolute; border-radius: 50%;
  background: rgba(0,121,147,0.3); will-change: transform;
}
.pt-1  { width:3px; height:3px; top:15%; left:10%; animation: rise 12s linear infinite 0s; }
.pt-2  { width:2px; height:2px; top:25%; left:25%; animation: rise 15s linear infinite 2s; }
.pt-3  { width:4px; height:4px; top:35%; left:45%; animation: rise 10s linear infinite 1s; background:rgba(255,151,51,0.25); }
.pt-4  { width:2px; height:2px; top:50%; left:65%; animation: rise 14s linear infinite 3s; }
.pt-5  { width:3px; height:3px; top:60%; left:80%; animation: rise 11s linear infinite 5s; background:rgba(255,151,51,0.2); }
.pt-6  { width:2px; height:2px; top:70%; left:35%; animation: rise 16s linear infinite 4s; }
.pt-7  { width:3px; height:3px; top:20%; left:55%; animation: rise 13s linear infinite 6s; }
.pt-8  { width:2px; height:2px; top:45%; left:90%; animation: rise 17s linear infinite 1s; background:rgba(10,80,98,0.3); }
.pt-9  { width:4px; height:4px; top:80%; left:15%; animation: rise 9s linear infinite 3s; background:rgba(0,121,147,0.2); }
.pt-10 { width:2px; height:2px; top:10%; left:75%; animation: rise 14s linear infinite 7s; }
.pt-11 { width:3px; height:3px; top:55%; left:5%;  animation: rise 12s linear infinite 2s; background:rgba(255,151,51,0.15); }
.pt-12 { width:2px; height:2px; top:40%; left:50%; animation: rise 18s linear infinite 8s; }
@keyframes rise {
  0% { transform: translateY(0) translateX(0) scale(1); opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { transform: translateY(-120px) translateX(20px) scale(0.5); opacity: 0; }
}

/* Grid overlay — faint animated perspective grid */
.grid-overlay {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(0,121,147,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,121,147,0.03) 1px, transparent 1px);
  background-size: 60px 60px;
  animation: gridPulse 4s ease-in-out infinite;
}
@keyframes gridPulse {
  0%,100% { opacity: 0.3; }
  50% { opacity: 0.6; }
}

/* Hero text */
.hero-h1 {
  font-size: 36px; font-weight: 800; color: #0a2e36; line-height: 1.2;
  margin-bottom: 16px; letter-spacing: -0.5px;
  animation: fadeUp 0.8s ease-out;
}
.hero-accent { color: var(--teal); }

.hero-brand { position: relative; display: inline-block; margin-bottom: 24px; animation: fadeUp 0.6s ease-out; }
.hero-logo { height: 40px; width: auto; }
.hero-badge {
  position: absolute; top: -6px; right: -70px;
  font-size: 10px; font-weight: 700; color: var(--orange);
  text-transform: uppercase; letter-spacing: 1.5px;
  animation: badgePulse 3s ease-in-out infinite;
}
@keyframes badgePulse { 0%,100%{opacity:1} 50%{opacity:0.6} }

.hero-props { display: flex; justify-content: center; gap: 24px; margin-bottom: 28px; flex-wrap: wrap; animation: fadeUp 1s ease-out; }
.hp { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: #0a2e36; }

.hero-sources {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  margin-top: 4px; flex-wrap: wrap; animation: fadeUp 1.2s ease-out;
}
.hs {
  font-size: 12px; font-weight: 600; color: var(--navy);
  padding: 3px 10px; border-radius: 6px;
  background: rgba(10,80,98,0.06); letter-spacing: 0.3px;
  transition: all 0.3s ease; animation: sourceFlicker 6s ease-in-out infinite;
}
.hs:nth-child(3) { animation-delay: 1.5s; }
.hs:nth-child(5) { animation-delay: 3s; }
.hs:nth-child(7) { animation-delay: 4.5s; }
@keyframes sourceFlicker {
  0%,100% { background: rgba(10,80,98,0.06); }
  50% { background: rgba(0,121,147,0.14); }
}
.hs-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--muted); flex-shrink: 0; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Form ── */
.form-section { padding: 0 24px; margin-top: -24px; position: relative; z-index: 3; }
.form-card {
  max-width: 560px; margin: 0 auto; position: relative;
  background: rgba(255,255,255,0.75); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border-radius: 20px; border: 1px solid rgba(255,255,255,0.5);
  padding: 36px; overflow: hidden;
  box-shadow: 0 8px 40px rgba(0,40,50,0.08), 0 1px 0 rgba(255,255,255,0.9) inset;
  animation: cardIn 0.7s ease-out 0.3s both;
}
/* Animated border glow */
.form-glow {
  position: absolute; top: -1px; left: -1px; right: -1px; bottom: -1px;
  border-radius: 21px; z-index: -1;
  background: conic-gradient(from 0deg, rgba(0,121,147,0.15), rgba(255,151,51,0.1), rgba(10,80,98,0.12), rgba(0,121,147,0.15));
  animation: glowSpin 8s linear infinite;
  filter: blur(2px);
}
@keyframes glowSpin {
  to { background: conic-gradient(from 360deg, rgba(0,121,147,0.15), rgba(255,151,51,0.1), rgba(10,80,98,0.12), rgba(0,121,147,0.15)); }
  /* CSS can't animate conic-gradient directly, use rotate trick */
}
@keyframes cardIn {
  from { opacity: 0; transform: translateY(30px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.fc-head { margin-bottom: 24px; }
.fc-head h2 { font-size: 20px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
.fc-head p { font-size: 14px; color: var(--muted); }

.field { margin-bottom: 18px; }
.field label { display: block; font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
.field-row { display: flex; gap: 14px; }
.field-half { flex: 1; min-width: 0; }

/* ── Animated input wrapper ── */
.input-wrap {
  position: relative; border-radius: 12px; overflow: hidden;
}
.input-border-anim {
  position: absolute; inset: 0; border-radius: 12px; pointer-events: none; z-index: 1;
  border: 2px solid transparent;
  background: conic-gradient(from var(--border-angle, 0deg), transparent 60%, rgba(0,121,147,0.3) 75%, rgba(255,151,51,0.2) 85%, transparent 95%) border-box;
  -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0; transition: opacity 0.4s;
  animation: borderRotate 4s linear infinite;
}
.input-wrap:focus-within .input-border-anim { opacity: 1; }
@keyframes borderRotate {
  to { --border-angle: 360deg; }
}
/* Fallback for browsers without @property */
@supports not (background: conic-gradient(from 0deg, red, blue)) {
  .input-border-anim { display: none; }
}

.inp {
  width: 100%; padding: 12px 16px;
  border: 1.5px solid rgba(0,0,0,0.08); border-radius: 12px;
  font-size: 14px; font-family: inherit; outline: none;
  transition: border-color 0.3s, box-shadow 0.3s, background 0.3s;
  background: rgba(255,255,255,0.6);
}
.inp:focus {
  border-color: var(--teal); background: rgba(255,255,255,0.95);
  box-shadow: 0 0 0 4px rgba(0,121,147,0.06), 0 2px 8px rgba(0,121,147,0.08);
}
.inp::placeholder { color: #b0b8c0; }

.actions { display: flex; gap: 10px; margin-top: 28px; }

/* Primary button with sweep + shimmer */
.btn-primary {
  flex: 1; padding: 15px; border: none; border-radius: 14px;
  background: linear-gradient(135deg, var(--orange) 0%, #e8870a 50%, var(--orange) 100%);
  background-size: 200% 200%;
  color: white; position: relative; overflow: hidden;
  font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer;
  box-shadow: 0 4px 16px rgba(255,151,51,0.3); transition: all 0.3s;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  animation: bgShift 3s ease-in-out infinite;
}
@keyframes bgShift {
  0%,100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}
.btn-primary::before {
  content: ''; position: absolute; top: 0; left: -100%; width: 60%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent);
  animation: btnShimmer 2.5s ease-in-out infinite;
}
@keyframes btnShimmer { 0%,100%{left:-100%} 50%{left:120%} }
.btn-primary:hover:not(:disabled) { transform: translateY(-2px) scale(1.01); box-shadow: 0 8px 28px rgba(255,151,51,0.5); }
.btn-primary:active:not(:disabled) { transform: translateY(0) scale(0.99); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; animation: none; }
.btn-primary:disabled::before { animation: none; }

.btn-ghost {
  padding: 15px 22px; border: 1.5px solid rgba(0,0,0,0.08); border-radius: 14px;
  background: rgba(255,255,255,0.6); color: var(--text); font-size: 14px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.3s; white-space: nowrap;
  backdrop-filter: blur(8px);
}
.btn-ghost:hover:not(:disabled) { border-color: var(--teal); color: var(--teal); background: rgba(0,121,147,0.04); transform: translateY(-1px); }
.btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }

.status { margin-top: 16px; padding: 12px 16px; border-radius: 12px; font-size: 13px; line-height: 1.5; animation: fadeUp 0.3s ease-out; }
.status-ok { background: rgba(240,253,244,0.9); color: #166534; border: 1px solid #bbf7d0; }
.status-err { background: rgba(254,242,242,0.9); color: #991b1b; border: 1px solid #fecaca; }

.spin { width: 18px; height: 18px; border: 2.5px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: sp .6s linear infinite; display: inline-block; }
.spin-dark { border-color: rgba(0,0,0,0.1); border-top-color: var(--teal); }
@keyframes sp { to { transform: rotate(360deg) } }

/* ── Register CSS custom property for conic-gradient animation ── */
@property --border-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

@media (max-width: 600px) {
  .hero-h1 { font-size: 28px; }
  .hero-props { gap: 16px; }
  .field-row { flex-direction: column; gap: 0; }
  .actions { flex-direction: column; }
  .hero { padding: 48px 16px 40px; }
  .form-card { padding: 24px; }
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
</style>
