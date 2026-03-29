<template>
<div class="page">
  <!-- 3D Library background -->
  <div class="library">
    <!-- Shelves rendered as rows of books visible from front -->
    <div class="lib-inner" :style="{ transform: `translateY(${scrollY * -0.25}px)` }">
      <div class="shelf-row" v-for="row in 8" :key="row" :style="{ opacity: Math.max(0, 1 - Math.abs(scrollY - row * 120) * 0.002) }">
        <div class="shelf-books">
          <div class="bk" v-for="b in 30" :key="b"
            :style="{
              width: (10 + ((b * row * 7) % 14)) + 'px',
              height: (40 + ((b * row * 13) % 35)) + 'px',
              background: bookGrad(b, row),
              opacity: 0.15 + ((b + row) % 5) * 0.06,
              transform: `translateZ(${((b + row) % 3) * 4}px)`
            }"></div>
        </div>
        <div class="shelf-board"></div>
      </div>
    </div>
    <!-- Ambient glow -->
    <div class="lib-glow" :style="{ opacity: Math.max(0.15, 0.6 - scrollY * 0.0004) }"></div>
  </div>

  <!-- Scroll content — each section = 1 viewport height, text centered -->
  <div class="scroll-content">

    <!-- S1: Logo -->
    <section class="panel" :class="{ vis: true }">
      <div class="panel-c">
        <img src="/logo.svg" alt="AI:ssociate" class="logo" />
        <span class="badge">Monitoring</span>
        <p class="scroll-hint">↓ Scrollen</p>
      </div>
    </section>

    <!-- S2: Headline -->
    <section class="panel" :class="{ vis: scrollY > 200 }">
      <div class="panel-c">
        <h1 class="h-main">Rechtsänderungen.</h1>
        <h1 class="h-main h-accent">Automatisch. Analysiert.</h1>
      </div>
    </section>

    <!-- S3: Features -->
    <section class="panel panel-features" :class="{ vis: scrollY > 600 }">
      <div class="panel-c">
        <div class="feat" v-for="(f, i) in features" :key="i"
          :style="{ transitionDelay: i * 0.12 + 's', opacity: scrollY > 650 + i * 60 ? 1 : 0, transform: scrollY > 650 + i * 60 ? 'translateX(0)' : 'translateX(-30px)' }">
          <div class="feat-ico" v-html="f.icon"></div>
          <div><strong>{{ f.title }}</strong><br/><span class="feat-sub">{{ f.desc }}</span></div>
        </div>
      </div>
    </section>

    <!-- S4: Sources -->
    <section class="panel" :class="{ vis: scrollY > 1000 }">
      <div class="panel-c">
        <p class="src-label">Datenquellen</p>
        <div class="src-row">
          <span class="src" v-for="(s, i) in ['RIS', 'Findok', 'EUR-Lex', 'parlament.gv.at']" :key="i"
            :style="{ transitionDelay: i * 0.1 + 's', opacity: scrollY > 1050 + i * 40 ? 1 : 0, transform: scrollY > 1050 + i * 40 ? 'scale(1)' : 'scale(0.8)' }">{{ s }}</span>
        </div>
      </div>
    </section>

    <!-- S5: Form — sticky at bottom -->
    <section class="panel panel-form">
      <div class="form-sticky" :class="{ vis: scrollY > 1300 }">
        <div class="form-card">
          <h2>Report erstellen</h2>
          <p class="form-sub">Rechtsgebiete wählen, Report per E-Mail erhalten.</p>

          <div class="field">
            <label>Rechtsgebiete</label>
            <v-select v-model="selectedCategory" :items="categories" item-title="label" item-value="id"
              variant="outlined" density="compact" multiple chips closable-chips clearable hide-details
              placeholder="Rechtsgebiete wählen…" color="#22c9e8" />
          </div>

          <div class="field-row">
            <div class="field fh">
              <label>Zeitraum</label>
              <v-select v-model="selectedTimeframe" :items="timeframeOptions" item-title="label" item-value="value"
                variant="outlined" density="compact" hide-details color="#22c9e8" />
            </div>
            <div class="field fh">
              <label>E-Mail</label>
              <input v-model="reportEmail" type="email" placeholder="name@kanzlei.at" class="inp" />
            </div>
          </div>

          <div v-if="selectedTimeframe === 'custom'" class="field-row">
            <div class="field fh"><label>Von</label><input v-model="datumVon" type="date" class="inp" /></div>
            <div class="field fh"><label>Bis</label><input v-model="datumBis" type="date" class="inp" /></div>
          </div>

          <div class="actions">
            <button class="btn-p" :disabled="!reportEmail || !selectedCategory.length || sending" @click="sendReport">
              <span v-if="sending" class="spin"></span>
              <template v-else>Report senden →</template>
            </button>
            <button class="btn-g" :disabled="!selectedCategory.length || generating" @click="downloadReport">
              <span v-if="generating" class="spin spin-d"></span>
              <template v-else>↓ Download</template>
            </button>
          </div>

          <div v-if="statusMsg" :class="['sts', statusOk ? 'sts-ok' : 'sts-err']">{{ statusMsg }}</div>
        </div>
      </div>
    </section>

  </div>
</div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import api from '../services/api'

const scrollY = ref(0)
function onScroll() { scrollY.value = window.scrollY }
onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
onUnmounted(() => window.removeEventListener('scroll', onScroll))

const features = [
  { title: '86 Rechtsgebiete', desc: 'Vollständige RIS-Dezimalklassifikation', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c9e8" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>' },
  { title: 'Versionsvergleich', desc: 'Inkrafttreten vs. Vorfassung', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c9e8" stroke-width="1.5"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>' },
  { title: 'Gesetzesmaterialien', desc: 'Erläuterungen von parlament.gv.at', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c9e8" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>' },
  { title: 'KI-Analyse', desc: 'GPT-Report mit Quellenangaben', icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff9733" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>' },
]

function bookGrad(b, row) {
  const c = [
    ['rgba(0,121,147,', 'rgba(0,90,110,'],
    ['rgba(255,151,51,', 'rgba(200,110,30,'],
    ['rgba(10,80,98,', 'rgba(8,60,75,'],
    ['rgba(34,160,200,', 'rgba(20,120,150,'],
    ['rgba(100,70,50,', 'rgba(70,45,30,'],
  ]
  const p = c[(b + row) % c.length]
  return `linear-gradient(180deg, ${p[0]}0.35), ${p[1]}0.5))`
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
function catLabel() { const c=selectedCategory.value||[]; if(!c.length) return 'Alle'; if(c.length===1){const f=categories.value.find(x=>x.id===c[0]);return f?f.label:''} return `${c.length} Rechtsgebiete` }
function tfLabel() { if(selectedTimeframe.value==='custom'&&datumVon.value&&datumBis.value) return `${datumVon.value} bis ${datumBis.value}`; const t=timeframes.value.find(x=>x.value===selectedTimeframe.value); return t?t.label:'' }

async function sendReport() {
  if(!reportEmail.value||!selectedCategory.value.length) return
  sending.value=true; statusMsg.value='Suche läuft…'; statusOk.value=true
  try { const data=await doSearch(); if(!data.results?.length){statusMsg.value='Keine Ergebnisse.';statusOk.value=false;return}; statusMsg.value=`${data.results.length} Ergebnisse. Report wird versendet…`; await api.post('/report/email',{email:reportEmail.value,results:data.results,doc_type:'gesetze',category_label:catLabel(),timeframe_label:tfLabel(),total_hits:data.total_hits,diffs:{}}); statusMsg.value=`Report an ${reportEmail.value} gesendet.`;statusOk.value=true }
  catch(e){statusMsg.value=e.response?.data?.detail||`Fehler: ${e.message}`;statusOk.value=false} finally{sending.value=false}
}
async function downloadReport() {
  if(!selectedCategory.value.length) return
  generating.value=true; statusMsg.value='Suche läuft…'; statusOk.value=true
  try { const data=await doSearch(); if(!data.results?.length){statusMsg.value='Keine Ergebnisse.';statusOk.value=false;return}; statusMsg.value=`${data.results.length} Ergebnisse. Report wird erstellt…`; const r=await api.post('/report',{results:data.results,doc_type:'gesetze',category_label:catLabel(),timeframe_label:tfLabel(),total_hits:data.total_hits,diffs:{}}); const bl=new Blob([r.data.report_html],{type:'text/html;charset=utf-8'});const u=URL.createObjectURL(bl);const a=document.createElement('a');a.href=u;a.download=`Report_${new Date().toISOString().split('T')[0]}.html`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u); statusMsg.value='Report heruntergeladen.';statusOk.value=true }
  catch(e){statusMsg.value=e.response?.data?.detail||`Fehler: ${e.message}`;statusOk.value=false} finally{generating.value=false}
}
</script>

<style scoped>
.page { min-height: 100vh; background: #070e12; color: #e8f4f6; overflow-x: hidden; }

/* ── Library background ── */
.library {
  position: fixed; inset: 0; z-index: 0; overflow: hidden;
  background: linear-gradient(180deg, #060c10 0%, #091920 40%, #0c2230 70%, #060c10 100%);
}
.lib-inner {
  position: absolute; left: 5%; right: 5%; top: 5%; bottom: 0;
  will-change: transform;
}
.shelf-row {
  position: relative; height: 100px; margin-bottom: 20px;
  transition: opacity 0.3s;
}
.shelf-books {
  display: flex; align-items: flex-end; gap: 3px;
  height: 80px; padding: 0 8px;
}
.bk {
  flex-shrink: 0; border-radius: 2px 2px 0 0;
  border-top: 1px solid rgba(255,255,255,0.04);
  box-shadow: 1px 0 2px rgba(0,0,0,0.3), -1px 0 2px rgba(0,0,0,0.2);
}
.shelf-board {
  height: 6px; border-radius: 1px;
  background: linear-gradient(180deg, rgba(120,80,45,0.4) 0%, rgba(80,50,25,0.5) 100%);
  box-shadow: 0 2px 6px rgba(0,0,0,0.5), 0 -1px 0 rgba(255,255,255,0.03);
}
.lib-glow {
  position: absolute; top: 0; left: 20%; width: 60%; height: 50%;
  background: radial-gradient(ellipse at 50% 0%, rgba(255,200,100,0.08) 0%, transparent 70%);
  pointer-events: none;
}

/* ── Scroll content ── */
.scroll-content { position: relative; z-index: 2; }

/* Each panel = full viewport height, centered content */
.panel {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.panel-c { text-align: center; max-width: 600px; width: 100%; }

/* Reveal */
.panel .panel-c, .panel .form-sticky {
  opacity: 0; transform: translateY(50px);
  transition: opacity 1s cubic-bezier(0.16,1,0.3,1), transform 1s cubic-bezier(0.16,1,0.3,1);
}
.panel.vis .panel-c, .panel .form-sticky.vis {
  opacity: 1; transform: translateY(0);
}

/* S1: Logo */
.logo { height: 52px; filter: brightness(10); }
.badge {
  display: inline-block; margin-left: 14px; vertical-align: top; margin-top: 6px;
  font-size: 10px; font-weight: 700; color: #ff9733;
  text-transform: uppercase; letter-spacing: 2px;
}
.scroll-hint {
  margin-top: 48px; font-size: 13px; color: rgba(255,255,255,0.2);
  letter-spacing: 3px; text-transform: uppercase;
  animation: hintPulse 2s ease-in-out infinite;
}
@keyframes hintPulse { 0%,100%{opacity:0.2;transform:translateY(0)} 50%{opacity:0.5;transform:translateY(6px)} }

/* S2: Headline */
.h-main {
  font-size: 52px; font-weight: 800; line-height: 1.08; margin: 0;
  letter-spacing: -1.5px;
  text-shadow: 0 4px 40px rgba(0,0,0,0.5);
}
.h-accent { color: #22c9e8; }

/* S3: Features */
.panel-features .panel-c { text-align: left; }
.feat {
  display: flex; align-items: center; gap: 16px;
  padding: 18px 22px; margin-bottom: 10px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05);
  border-radius: 14px;
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.feat-ico { flex-shrink: 0; }
.feat strong { font-size: 15px; color: #e8f4f6; }
.feat-sub { font-size: 12px; color: rgba(255,255,255,0.4); }

/* S4: Sources */
.src-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 3px; color: rgba(255,255,255,0.25); margin-bottom: 20px; }
.src-row { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
.src {
  font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.65);
  padding: 8px 20px; border-radius: 10px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
  transition: opacity 0.5s ease, transform 0.5s ease;
}

/* S5: Form — sticky so it stays on screen */
.panel-form {
  min-height: auto; align-items: flex-start;
  position: sticky; bottom: 0;
  padding: 40px 24px 40px;
}
.form-sticky {
  max-width: 560px; margin: 0 auto; width: 100%;
  opacity: 0; transform: translateY(30px);
  transition: opacity 0.8s ease, transform 0.8s ease;
}
.form-sticky.vis { opacity: 1; transform: translateY(0); }

.form-card {
  background: rgba(10,25,33,0.85); backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
  border-radius: 20px; border: 1px solid rgba(255,255,255,0.08);
  padding: 32px;
  box-shadow: 0 -8px 40px rgba(0,0,0,0.4);
}
.form-card h2 { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
.form-sub { font-size: 13px; color: rgba(255,255,255,0.4); margin: 0 0 24px; }

.field { margin-bottom: 16px; }
.field label { display: block; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.55); margin-bottom: 5px; }
.field-row { display: flex; gap: 12px; }
.fh { flex: 1; min-width: 0; }

.inp {
  width: 100%; padding: 11px 14px;
  border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
  font-size: 14px; font-family: inherit; outline: none;
  background: rgba(255,255,255,0.04); color: #e8f4f6;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.inp:focus { border-color: rgba(34,201,232,0.4); box-shadow: 0 0 0 3px rgba(34,201,232,0.08); }
.inp::placeholder { color: rgba(255,255,255,0.18); }

.actions { display: flex; gap: 10px; margin-top: 24px; }
.btn-p {
  flex: 1; padding: 14px; border: none; border-radius: 12px;
  background: linear-gradient(135deg, #ff9733, #e8870a); color: white;
  font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer;
  box-shadow: 0 4px 20px rgba(255,151,51,0.25); transition: all 0.2s;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.btn-p:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 28px rgba(255,151,51,0.4); }
.btn-p:disabled { opacity: 0.35; cursor: not-allowed; }
.btn-g {
  padding: 14px 20px; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
  background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.7); font-size: 14px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.btn-g:hover:not(:disabled) { border-color: rgba(34,201,232,0.3); color: #22c9e8; }
.btn-g:disabled { opacity: 0.35; cursor: not-allowed; }

.sts { margin-top: 14px; padding: 10px 14px; border-radius: 10px; font-size: 13px; }
.sts-ok { background: rgba(16,185,129,0.1); color: #34d399; border: 1px solid rgba(16,185,129,0.15); }
.sts-err { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.15); }

.spin { width: 18px; height: 18px; border: 2.5px solid rgba(255,255,255,0.2); border-top-color: white; border-radius: 50%; animation: sp .6s linear infinite; display: inline-block; }
.spin-d { border-color: rgba(255,255,255,0.1); border-top-color: #22c9e8; }
@keyframes sp { to { transform: rotate(360deg) } }

/* Vuetify dark */
:deep(.v-field) { background: rgba(255,255,255,0.04) !important; border-color: rgba(255,255,255,0.08) !important; color: #e8f4f6 !important; border-radius: 10px !important; }
:deep(.v-field__input) { color: #e8f4f6 !important; }
:deep(.v-field--focused) { border-color: rgba(34,201,232,0.4) !important; }
:deep(.v-chip) { background: rgba(34,201,232,0.12) !important; color: #22c9e8 !important; }
:deep(.v-field__input::placeholder) { color: rgba(255,255,255,0.18) !important; }
:deep(.v-select__selection-text) { color: #e8f4f6 !important; }
:deep(.v-field__append-inner .v-icon) { color: rgba(255,255,255,0.3) !important; }
:deep(.v-list) { background: #0c1c25 !important; border: 1px solid rgba(255,255,255,0.06) !important; border-radius: 10px !important; }
:deep(.v-list-item) { color: #e8f4f6 !important; }
:deep(.v-list-item:hover) { background: rgba(34,201,232,0.06) !important; }
:deep(.v-list-item--active) { background: rgba(34,201,232,0.1) !important; color: #22c9e8 !important; }

@media (max-width: 640px) {
  .h-main { font-size: 34px; }
  .field-row { flex-direction: column; gap: 0; }
  .actions { flex-direction: column; }
  .form-card { padding: 22px; }
  .panel { padding: 20px 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .panel .panel-c, .form-sticky { opacity: 1; transform: none; transition: none; }
  .feat, .src { opacity: 1 !important; transform: none !important; }
  .library { display: none; }
  .page { background: #0c2230; }
}
</style>
