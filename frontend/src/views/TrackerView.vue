<template>
<div class="page">
  <!-- Full-page animated background (covers everything, no boxes) -->
  <div class="bg-layer">
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>
    <div class="orb orb-4"></div>
    <div class="orb orb-5"></div>
    <div class="orb orb-6"></div>
    <div class="aurora"></div>
    <div class="wave wave-1"></div>
    <div class="wave wave-2"></div>
    <div class="particles">
      <div class="pt pt-1"></div><div class="pt pt-2"></div><div class="pt pt-3"></div>
      <div class="pt pt-4"></div><div class="pt pt-5"></div><div class="pt pt-6"></div>
      <div class="pt pt-7"></div><div class="pt pt-8"></div><div class="pt pt-9"></div>
      <div class="pt pt-10"></div><div class="pt pt-11"></div><div class="pt pt-12"></div>
    </div>
  </div>

  <!-- Hero section (no background of its own, transparent) -->
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
  min-height: 100vh; position: relative; overflow-x: hidden;
}

/* ── Full-page animated background (one continuous surface) ── */
.bg-layer {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background: linear-gradient(170deg, #f0f8f9 0%, #f6f7fa 35%, #faf8f4 65%, #f2f9fa 100%);
  background-size: 400% 400%;
  animation: bgBreath 20s ease-in-out infinite;
}
@keyframes bgBreath {
  0%,100% { background-position: 0% 30%; }
  25% { background-position: 100% 0%; }
  50% { background-position: 60% 100%; }
  75% { background-position: 0% 60%; }
}

/* Orbs — scattered across the full page, always drifting */
.orb { position: absolute; border-radius: 50%; will-change: transform; }
.orb-1 {
  width: 600px; height: 600px; top: -10%; left: -10%;
  background: radial-gradient(circle, rgba(0,121,147,0.13) 0%, transparent 70%);
  filter: blur(80px); animation: drift1 18s ease-in-out infinite;
}
.orb-2 {
  width: 500px; height: 500px; top: 50%; right: -8%;
  background: radial-gradient(circle, rgba(255,151,51,0.10) 0%, transparent 70%);
  filter: blur(80px); animation: drift2 22s ease-in-out infinite;
}
.orb-3 {
  width: 400px; height: 400px; top: 25%; left: 50%;
  background: radial-gradient(circle, rgba(10,80,98,0.08) 0%, transparent 70%);
  filter: blur(60px); animation: drift3 15s ease-in-out infinite;
}
.orb-4 {
  width: 350px; height: 350px; bottom: 10%; left: 5%;
  background: radial-gradient(circle, rgba(0,121,147,0.07) 0%, transparent 70%);
  filter: blur(70px); animation: drift4 25s ease-in-out infinite;
}
.orb-5 {
  width: 250px; height: 250px; top: 5%; right: 25%;
  background: radial-gradient(circle, rgba(255,151,51,0.06) 0%, transparent 70%);
  filter: blur(50px); animation: drift5 20s ease-in-out infinite;
}
.orb-6 {
  width: 300px; height: 300px; bottom: -5%; right: 30%;
  background: radial-gradient(circle, rgba(10,80,98,0.06) 0%, transparent 70%);
  filter: blur(60px); animation: drift6 28s ease-in-out infinite;
}
@keyframes drift1 { 0%,100%{transform:translate(0,0) scale(1)} 25%{transform:translate(100px,60px) scale(1.1)} 50%{transform:translate(50px,-40px) scale(0.9)} 75%{transform:translate(-40px,80px) scale(1.05)} }
@keyframes drift2 { 0%,100%{transform:translate(0,0)} 30%{transform:translate(-90px,-60px) scale(1.12)} 60%{transform:translate(40px,40px) scale(0.88)} 80%{transform:translate(-50px,-20px)} }
@keyframes drift3 { 0%,100%{transform:translate(0,0) rotate(0deg)} 33%{transform:translate(60px,-60px) rotate(6deg)} 66%{transform:translate(-50px,50px) rotate(-4deg)} }
@keyframes drift4 { 0%,100%{transform:translate(0,0)} 40%{transform:translate(80px,-40px)} 70%{transform:translate(-30px,60px)} }
@keyframes drift5 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-50px,40px) scale(1.3)} }
@keyframes drift6 { 0%,100%{transform:translate(0,0)} 35%{transform:translate(50px,-70px)} 65%{transform:translate(-60px,30px)} }

/* Aurora — color band sweeping across the full page */
.aurora {
  position: absolute; inset: 0;
  background: linear-gradient(110deg,
    transparent 15%,
    rgba(0,121,147,0.05) 28%,
    rgba(255,151,51,0.04) 42%,
    rgba(10,80,98,0.05) 58%,
    transparent 75%
  );
  background-size: 200% 200%;
  animation: auroraShift 10s ease-in-out infinite;
}
@keyframes auroraShift {
  0%,100% { background-position: 0% 0%; }
  50% { background-position: 100% 100%; }
}

/* Soft waves — organic flowing shapes */
.wave {
  position: absolute; width: 200%; height: 300px;
  left: -50%; border-radius: 45%;
  opacity: 0.03; will-change: transform;
}
.wave-1 {
  top: 30%; background: rgba(0,121,147,0.6);
  animation: waveFlow 20s ease-in-out infinite;
}
.wave-2 {
  top: 60%; background: rgba(255,151,51,0.5);
  animation: waveFlow 25s ease-in-out infinite reverse;
}
@keyframes waveFlow {
  0%,100% { transform: rotate(0deg) translateY(0); border-radius: 45%; }
  25% { transform: rotate(3deg) translateY(-20px); border-radius: 42% 48% 44% 46%; }
  50% { transform: rotate(-2deg) translateY(15px); border-radius: 48% 42% 46% 44%; }
  75% { transform: rotate(1deg) translateY(-10px); border-radius: 44% 46% 42% 48%; }
}

/* Particles — float across the entire viewport */
.particles { position: absolute; inset: 0; width: 100%; height: 100vh; }
.pt {
  position: absolute; border-radius: 50%;
  background: rgba(0,121,147,0.25); will-change: transform;
}
.pt-1  { width:3px; height:3px; top:10%; left:8%;  animation: float 14s ease-in-out infinite 0s; }
.pt-2  { width:2px; height:2px; top:20%; left:22%; animation: float 18s ease-in-out infinite 2s; }
.pt-3  { width:4px; height:4px; top:35%; left:42%; animation: float 12s ease-in-out infinite 1s; background:rgba(255,151,51,0.2); }
.pt-4  { width:2px; height:2px; top:48%; left:62%; animation: float 16s ease-in-out infinite 3s; }
.pt-5  { width:3px; height:3px; top:58%; left:78%; animation: float 13s ease-in-out infinite 5s; background:rgba(255,151,51,0.18); }
.pt-6  { width:2px; height:2px; top:68%; left:32%; animation: float 19s ease-in-out infinite 4s; }
.pt-7  { width:3px; height:3px; top:18%; left:52%; animation: float 15s ease-in-out infinite 6s; }
.pt-8  { width:2px; height:2px; top:42%; left:88%; animation: float 20s ease-in-out infinite 1s; background:rgba(10,80,98,0.25); }
.pt-9  { width:4px; height:4px; top:78%; left:12%; animation: float 11s ease-in-out infinite 3s; background:rgba(0,121,147,0.18); }
.pt-10 { width:2px; height:2px; top:8%;  left:72%; animation: float 17s ease-in-out infinite 7s; }
.pt-11 { width:3px; height:3px; top:52%; left:4%;  animation: float 14s ease-in-out infinite 2s; background:rgba(255,151,51,0.12); }
.pt-12 { width:2px; height:2px; top:38%; left:48%; animation: float 21s ease-in-out infinite 8s; }
@keyframes float {
  0%,100% { transform: translate(0, 0) scale(1); opacity: 0.3; }
  25% { transform: translate(15px, -25px) scale(1.2); opacity: 0.8; }
  50% { transform: translate(-10px, -50px) scale(0.8); opacity: 0.5; }
  75% { transform: translate(20px, -15px) scale(1.1); opacity: 0.9; }
}

/* ── Hero ── */
.hero {
  padding: 64px 24px 56px; text-align: center;
  position: relative; z-index: 1;
}
.hero-inner { max-width: 600px; margin: 0 auto; position: relative; z-index: 2; }

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
.form-section { padding: 0 24px; margin-top: -24px; position: relative; z-index: 2; padding-bottom: 60px; }
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
