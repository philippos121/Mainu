<template>
<div class="shell">
  <!-- Left: Filters -->
  <aside class="sidebar">
    <div class="sb-section">
      <label class="sb-label">Dokumenttyp</label>
      <div class="seg">
        <button :class="['seg-btn', docType==='gesetze'&&'seg-active']" @click="docType='gesetze'">Gesetze</button>
        <button :class="['seg-btn', docType==='gerichtsentscheidungen'&&'seg-active']" @click="docType='gerichtsentscheidungen'">Entscheidungen</button>
      </div>
    </div>

    <div class="sb-section">
      <label class="sb-label">Rechtsgebiete</label>
      <v-select v-model="selectedCategory" :items="categories" item-title="label" item-value="id"
        variant="outlined" density="compact" multiple chips closable-chips clearable hide-details
        placeholder="Wählen…" color="#007993" bg-color="white" class="sb-select" />
    </div>

    <div class="sb-section">
      <label class="sb-label">Zeitraum</label>
      <v-select v-model="selectedTimeframe" :items="timeframes" item-title="label" item-value="value"
        variant="outlined" density="compact" hide-details color="#007993" bg-color="white" class="sb-select" />
    </div>

    <button class="btn-go" :disabled="loading" @click="searchFresh">
      <span v-if="loading" class="spin"></span>
      <template v-else>Suchen</template>
    </button>

    <!-- AI tools -->
    <div v-if="searched && results.length" class="sb-section sb-ai">
      <label class="sb-label">AI-Analyse</label>
      <input v-model="apiKey" :type="showApiKey?'text':'password'" placeholder="OpenAI Key" class="sb-input" />
      <div class="sb-row">
        <button class="btn-sm btn-teal" :disabled="!apiKey||summarising" @click="doSummarise">
          {{ summarising ? '…' : 'Zusammenfassung' }}
        </button>
        <button class="btn-sm btn-dark" :disabled="generatingReport" @click="doReport">
          {{ generatingReport ? '…' : 'Report ↓' }}
        </button>
      </div>
      <div class="sb-row">
        <input v-model="reportEmail" type="email" placeholder="E-Mail" class="sb-input sb-input-sm" />
        <button class="btn-sm btn-purple" :disabled="!reportEmail||sendingEmail" @click="doEmailReport">✉</button>
      </div>
    </div>
  </aside>

  <!-- Right: Results -->
  <section class="main-col">
    <!-- Empty state -->
    <div v-if="!searched" class="welcome">
      <div class="welcome-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </div>
      <h2>Rechtsänderungen durchsuchen</h2>
      <p>Wählen Sie Rechtsgebiete und einen Zeitraum, dann klicken Sie auf „Suchen".</p>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-state">
      <div class="loading-bar"></div>
    </div>

    <!-- Error -->
    <div v-if="error" class="toast toast-error">{{ error }}</div>

    <!-- Results header -->
    <div v-if="searched && !loading" class="results-bar">
      <div class="rb-left">
        <span class="rb-count">{{ totalHits.toLocaleString('de-AT') }}</span>
        <span class="rb-label">{{ docType === 'gesetze' ? 'Bestimmungen' : 'Entscheidungen' }}</span>
      </div>
      <span class="rb-meta">{{ categoryLabel }} · {{ timeframeLabel }}</span>
    </div>

    <!-- Summary -->
    <div v-if="summaryText" class="summary-card">
      <div class="sc-head">
        <span class="sc-badge">AI</span> Rechtliche Analyse
        <button class="sc-close" @click="summaryText=''">&times;</button>
      </div>
      <div class="sc-body" v-html="renderMarkdown(summaryText)"></div>
    </div>
    <div v-if="summaryError" class="toast toast-error">{{ summaryError }}</div>

    <!-- Gesetze -->
    <template v-if="searched && !loading && docType === 'gesetze'">
      <div v-for="(item, i) in results" :key="item.id" class="card" :style="`--d:${i*30}ms`">
        <div class="c-row">
          <div class="c-dot c-dot-teal"></div>
          <div class="c-body">
            <a :href="item.url" target="_blank" class="c-title">{{ item.title }}
              <span v-if="item.artikel" class="c-art">{{ item.artikel }}</span>
            </a>
            <div class="c-meta">
              <span v-if="isExpired(item)" class="tag tag-red">außer Kraft</span>
              <span v-if="item.typ" class="tag">{{ item.typ }}</span>
              <span v-if="item.date" class="tag tag-ghost">{{ formatDate(item.date) }}</span>
              <span v-if="item.bgbl" class="c-bgbl">{{ item.bgbl }}</span>
            </div>
            <button v-if="item.gesetzesnummer && item.artikel" class="btn-diff"
              :class="{open: diffOpen[item.id]}" @click="toggleDiff(item)">
              <span v-if="diffLoading[item.id]" class="spin-xs"></span>
              <template v-else>{{ diffOpen[item.id] ? '▲ Schließen' : '▼ Änderungen' }}</template>
            </button>
          </div>
          <a :href="item.url" target="_blank" class="c-ext">↗</a>
        </div>
        <!-- Diff -->
        <transition name="expand">
          <div v-if="diffOpen[item.id] && (diffData[item.id]||diffErrors[item.id])" class="diff">
            <div v-if="diffData[item.id]?.has_changes" class="diff-vers">
              <span class="dv dv-old">{{ diffData[item.id].previous?.date }}</span>
              <span class="dv-arr">→</span>
              <span class="dv dv-new">{{ diffData[item.id].current?.date }}</span>
            </div>
            <div v-if="diffData[item.id]" class="diff-html" v-html="diffData[item.id].diff_html"></div>
            <div v-if="diffErrors[item.id]" class="diff-err">{{ diffErrors[item.id] }}</div>
          </div>
        </transition>
      </div>
    </template>

    <!-- Entscheidungen -->
    <template v-if="searched && !loading && docType === 'gerichtsentscheidungen'">
      <a v-for="(item, i) in results" :key="item.id" :href="item.url" target="_blank"
         class="card card-link" :style="`--d:${i*30}ms`">
        <div class="c-row">
          <div class="c-dot c-dot-orange"></div>
          <div class="c-body">
            <div class="c-title">{{ item.title }}</div>
            <div v-if="item.rechtssatz" class="c-rs">{{ item.rechtssatz }}</div>
            <div class="c-meta">
              <span class="tag tag-teal">{{ item.court }}</span>
              <span v-if="item.case_number" class="tag tag-orange">{{ item.case_number }}</span>
              <span v-if="item.date" class="tag tag-ghost">{{ formatDate(item.date) }}</span>
            </div>
          </div>
          <span class="c-ext">↗</span>
        </div>
      </a>
    </template>

    <!-- Pagination -->
    <div v-if="searched && !loading && totalHits > 20" class="pager">
      <v-pagination v-model="page" :length="Math.ceil(totalHits/20)" :total-visible="7"
        rounded="lg" active-color="#007993" @update:model-value="search" />
    </div>
  </section>
</div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import api from '../services/api'

const docType = ref('gesetze')
const categories = ref([])
const timeframes = ref([])
const selectedCategory = ref([])
const selectedTimeframe = ref('EinemMonat')
const loading = ref(false)
const searched = ref(false)
const error = ref('')
const results = ref([])
const totalHits = ref(0)
const page = ref(1)

const diffOpen = ref({})
const diffData = ref({})
const diffLoading = ref({})
const diffErrors = ref({})

const apiKey = ref(localStorage.getItem('ris_openai_key') || '')
const showApiKey = ref(false)
const summarising = ref(false)
const summaryText = ref('')
const summaryError = ref('')
const generatingReport = ref(false)
const reportEmail = ref(localStorage.getItem('ris_report_email') || '')
const sendingEmail = ref(false)

watch(apiKey, v => { if(v) localStorage.setItem('ris_openai_key',v); else localStorage.removeItem('ris_openai_key') })
onMounted(() => { loadFilters() })
watch(docType, () => { if(searched.value){page.value=1;search()} })

const categoryLabel = computed(() => {
  const c = selectedCategory.value||[]
  if(!c.length) return 'Alle'
  if(c.length===1){ const f=categories.value.find(x=>x.id===c[0]); return f?f.label:'' }
  return `${c.length} Gebiete`
})
const timeframeLabel = computed(() => { const t=timeframes.value.find(x=>x.value===selectedTimeframe.value); return t?t.label:'' })

function isExpired(item) {
  if(!item.ausserkraft) return false
  try { let d=item.ausserkraft; if(d.includes('.')){const[a,b,c]=d.split('.');d=`${c}-${b}-${a}`}
    if(d.includes('T'))d=d.split('T')[0]; if(d==='9999-12-31')return false; return new Date(d)<new Date()
  } catch{return false}
}
function formatDate(s) {
  if(!s)return''; try{if(s.includes('T'))s=s.split('T')[0]; if(s.includes('-')){const[y,m,d]=s.split('-');return`${d}.${m}.${y}`} return s}catch{return s}
}
function renderMarkdown(md) {
  if(!md)return''
  let h=md; h=h.replace(/^### (.+)$/gm,'<h4>$1</h4>'); h=h.replace(/^## (.+)$/gm,'<h3>$1</h3>')
  h=h.replace(/^# (.+)$/gm,'<h2>$1</h2>'); h=h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
  h=h.replace(/\*(.+?)\*/g,'<em>$1</em>'); h=h.replace(/^[-•] (.+)$/gm,'<li>$1</li>')
  h=h.replace(/\n\n/g,'</p><p>'); h=`<p>${h}</p>`; h=h.replace(/((?:<li>.*?<\/li>\s*)+)/gs,'<ul>$1</ul>')
  return h
}

async function loadFilters() {
  try { const [a,b]=await Promise.all([api.get('/categories'),api.get('/timeframes')]); categories.value=a.data; timeframes.value=b.data }
  catch{ error.value='Filter konnten nicht geladen werden.' }
}
async function toggleDiff(item) {
  const id=item.id; if(diffOpen.value[id]){diffOpen.value[id]=false;return}
  if(diffData.value[id]){diffOpen.value[id]=true;return}
  diffOpen.value[id]=true; diffLoading.value[id]=true; diffErrors.value[id]=''
  try { const r=await api.get('/diff',{params:{doc_id:item.id||'',gesetzesnummer:item.gesetzesnummer||'',artikel:item.artikel||'',inkrafttreten:item.date||''}}); diffData.value[id]=r.data }
  catch(e){ diffErrors.value[id]=e.response?.data?.detail||'Fehler'; diffOpen.value[id]=true }
  finally{ diffLoading.value[id]=false }
}
async function searchFresh() { page.value=1;summaryText.value='';summaryError.value='';diffOpen.value={};diffData.value={};diffErrors.value={};await search() }
async function search() {
  loading.value=true;error.value='';searched.value=true
  const ep=docType.value==='gesetze'?'/search/gesetze':'/search/gerichtsentscheidungen'
  const cats=selectedCategory.value||[]
  try {
    let r; if(cats.length<=1){const p={im_ris_seit:selectedTimeframe.value,page:page.value};if(cats.length===1)p.category=cats[0];r=await api.get(ep,{params:p})}
    else{const ps=cats.map(c=>api.get(ep,{params:{im_ris_seit:selectedTimeframe.value,page:1,category:c}}));const rs=await Promise.all(ps);const all=[];let h=0;const s=new Set();for(const x of rs){h+=x.data.total_hits||0;for(const i of(x.data.results||[])){if(!s.has(i.id)){s.add(i.id);all.push(i)}}} r={data:{results:all,total_hits:h}}}
    results.value=r.data.results||[];totalHits.value=r.data.total_hits||0
  }catch{error.value='Fehler bei der Suche.';results.value=[];totalHits.value=0}finally{loading.value=false}
}
async function doSummarise() {
  if(!apiKey.value||!results.value.length)return; summarising.value=true;summaryText.value='';summaryError.value=''
  try{const r=await api.post('/summarise',{api_key:apiKey.value,results:results.value,doc_type:docType.value});summaryText.value=r.data.summary}
  catch(e){summaryError.value=e.response?.data?.detail||'Fehler'}finally{summarising.value=false}
}
async function doReport() {
  if(!results.value.length)return; generatingReport.value=true;summaryError.value=''
  try{const d={};for(const[id,x]of Object.entries(diffData.value)){if(x?.has_changes)d[id]={diff_html:x.diff_html,current:x.current,previous:x.previous}}
    const r=await api.post('/report',{api_key:apiKey.value||'',results:results.value,doc_type:docType.value,category_label:categoryLabel.value,timeframe_label:timeframeLabel.value,total_hits:totalHits.value,diffs:d})
    const b=new Blob([r.data.report_html],{type:'text/html;charset=utf-8'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=`RIS_Report_${new Date().toISOString().split('T')[0]}.html`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u)
  }catch(e){summaryError.value=e.response?.data?.detail||`Fehler: ${e.message}`}finally{generatingReport.value=false}
}
async function doEmailReport() {
  if(!reportEmail.value||!results.value.length)return; sendingEmail.value=true;summaryError.value='';localStorage.setItem('ris_report_email',reportEmail.value)
  try{const d={};for(const[id,x]of Object.entries(diffData.value)){if(x?.has_changes)d[id]={diff_html:x.diff_html,current:x.current,previous:x.previous}}
    await api.post('/report/email',{email:reportEmail.value,api_key:apiKey.value||'',results:results.value,doc_type:docType.value,category_label:categoryLabel.value,timeframe_label:timeframeLabel.value,total_hits:totalHits.value,diffs:d})
    alert(`Report → ${reportEmail.value}`)
  }catch(e){summaryError.value=e.response?.data?.detail||`E-Mail fehlgeschlagen`}finally{sendingEmail.value=false}
}
</script>

<style scoped>
/* ── Layout: sidebar + content ── */
.shell { display: flex; min-height: calc(100vh - 64px); }

.sidebar {
  width: 300px; min-width: 300px;
  background: white;
  border-right: 1px solid var(--border);
  padding: 24px 20px;
  position: sticky; top: 64px;
  height: calc(100vh - 64px);
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 4px;
}

.main-col {
  flex: 1;
  padding: 28px 32px 60px;
  max-width: 820px;
}

/* ── Sidebar elements ── */
.sb-section { margin-bottom: 20px; }
.sb-label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 8px; }
.sb-select { font-size: 13px; }

.seg { display: flex; gap: 0; background: #f3f4f6; border-radius: 10px; padding: 3px; }
.seg-btn {
  flex: 1; padding: 9px 0; font-size: 12px; font-weight: 600;
  border: none; border-radius: 8px; cursor: pointer;
  background: transparent; color: var(--muted);
  font-family: inherit; transition: all 0.2s;
}
.seg-active { background: var(--teal); color: white; box-shadow: 0 2px 6px rgba(0,121,147,0.25); }

.btn-go {
  width: 100%; padding: 12px; border: none; border-radius: 10px;
  background: var(--orange); color: white;
  font-size: 14px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: all 0.15s;
  box-shadow: 0 4px 12px rgba(255,151,51,0.35);
  margin-bottom: 16px;
}
.btn-go:hover { background: #ef8a1a; transform: translateY(-1px); box-shadow: 0 6px 16px rgba(255,151,51,0.5); }
.btn-go:disabled { opacity: 0.6; cursor: wait; }

.sb-ai { border-top: 1px solid var(--border); padding-top: 20px; margin-top: 8px; }

.sb-input {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px;
  font-size: 13px; font-family: inherit; margin-bottom: 8px;
  outline: none; transition: border-color 0.2s;
}
.sb-input:focus { border-color: var(--teal); }
.sb-input-sm { margin-bottom: 0; }

.sb-row { display: flex; gap: 6px; margin-bottom: 8px; }

.btn-sm {
  flex: 1; padding: 8px 6px; border: none; border-radius: 8px;
  font-size: 11px; font-weight: 600; font-family: inherit;
  cursor: pointer; color: white; transition: opacity 0.2s;
}
.btn-sm:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-teal { background: var(--teal); }
.btn-dark { background: var(--navy); }
.btn-purple { background: #7c3aed; min-width: 36px; }

/* ── Welcome ── */
.welcome {
  text-align: center; padding: 80px 20px;
  animation: fadeUp 0.5s ease-out;
}
.welcome-icon { margin-bottom: 20px; opacity: 0.6; }
.welcome h2 { font-size: 20px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
.welcome p { font-size: 14px; color: var(--muted); max-width: 360px; margin: 0 auto; line-height: 1.6; }

/* ── Loading ── */
.loading-state { padding: 40px 0; }
.loading-bar {
  height: 3px; background: linear-gradient(90deg, transparent, var(--teal), transparent);
  border-radius: 2px; animation: shimmer 1.5s infinite;
}
@keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }

/* ── Toast ── */
.toast { padding: 10px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; animation: fadeUp 0.3s; }
.toast-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

/* ── Results bar ── */
.results-bar {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 20px; animation: fadeUp 0.4s;
}
.rb-count { font-size: 28px; font-weight: 700; color: var(--teal); margin-right: 8px; }
.rb-label { font-size: 14px; color: var(--muted); }
.rb-meta { font-size: 12px; color: #9ca3af; }

/* ── Cards ── */
.card {
  background: white; border-radius: var(--radius);
  border: 1px solid var(--border);
  margin-bottom: 6px; overflow: hidden;
  animation: fadeUp 0.35s ease-out both;
  animation-delay: var(--d, 0ms);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.card:hover { border-color: var(--teal); box-shadow: 0 2px 12px rgba(0,121,147,0.08); }
.card-link { display: block; text-decoration: none; color: inherit; }
.c-row { display: flex; align-items: flex-start; padding: 14px 16px; gap: 12px; }

.c-dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
.c-dot-teal { background: var(--teal); }
.c-dot-orange { background: var(--orange); }

.c-body { flex: 1; min-width: 0; }
.c-title { font-size: 14px; font-weight: 500; color: var(--text); line-height: 1.5; text-decoration: none; }
a.c-title:hover { color: var(--teal); }
.c-art { font-size: 12px; color: var(--orange); font-weight: 600; margin-left: 6px; }

.c-rs {
  font-size: 12px; color: #4b5563; font-style: italic;
  border-left: 2px solid var(--orange); padding-left: 8px;
  margin: 6px 0; line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

.c-meta { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.tag { padding: 2px 7px; border-radius: 5px; font-size: 11px; font-weight: 500; background: var(--teal-50); color: var(--teal); }
.tag-teal { background: var(--teal-50); color: var(--teal); }
.tag-orange { background: var(--orange-50); color: var(--orange); }
.tag-ghost { background: #f3f4f6; color: #6b7280; }
.tag-red { background: #fef2f2; color: #dc2626; }
.c-bgbl { font-size: 11px; color: #9ca3af; margin-left: 4px; align-self: center; }

.c-ext {
  flex-shrink: 0; font-size: 13px; color: #c4c8cc;
  text-decoration: none; margin-top: 2px;
  transition: color 0.15s;
}
.card:hover .c-ext { color: var(--teal); }

/* ── Diff button ── */
.btn-diff {
  display: inline-block; margin-top: 6px; padding: 3px 10px;
  font-size: 11px; font-weight: 600; color: var(--teal);
  background: var(--teal-50); border: 1px solid rgba(0,121,147,0.12);
  border-radius: 6px; cursor: pointer; font-family: inherit;
  transition: all 0.15s;
}
.btn-diff:hover { background: rgba(0,121,147,0.1); }
.btn-diff.open { background: rgba(0,121,147,0.12); }

/* ── Diff panel ── */
.expand-enter-active,.expand-leave-active { transition: all 0.25s ease; overflow: hidden; }
.expand-enter-from,.expand-leave-to { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }
.expand-enter-to,.expand-leave-from { opacity: 1; max-height: 600px; }

.diff { padding: 14px 16px; background: #fafbfc; border-top: 1px solid var(--border); }
.diff-vers { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 10px; }
.dv { padding: 2px 8px; border-radius: 5px; font-weight: 500; }
.dv-old { background: #fef2f2; color: #991b1b; }
.dv-new { background: #f0fdf4; color: #166534; }
.dv-arr { color: #9ca3af; }

.diff-html {
  font-size: 13px; line-height: 1.8; padding: 12px; background: white;
  border: 1px solid var(--border); border-radius: 10px;
  max-height: 380px; overflow-y: auto;
}
.diff-html :deep(.diff-del) { background:#fecaca;color:#991b1b;text-decoration:line-through;padding:1px 3px;border-radius:3px; }
.diff-html :deep(.diff-ins) { background:#bbf7d0;color:#166534;padding:1px 3px;border-radius:3px; }
.diff-html :deep(.diff-info) { color:#6b7280;font-style:italic;margin-bottom:8px; }
.diff-html :deep(.diff-sidebyside) { display:grid;grid-template-columns:1fr 1fr;gap:10px; }
.diff-html :deep(.diff-side) { padding:10px;border-radius:8px;font-size:12px;line-height:1.6; }
.diff-html :deep(.diff-side-old) { background:#fef2f2;border:1px solid #fecaca; }
.diff-html :deep(.diff-side-new) { background:#f0fdf4;border:1px solid #bbf7d0; }
.diff-html :deep(.diff-side-label) { font-weight:600;font-size:11px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px; }
.diff-html :deep(.diff-side-old .diff-side-label) { color:#991b1b; }
.diff-html :deep(.diff-side-new .diff-side-label) { color:#166534; }
.diff-html :deep(.diff-side-text) { white-space:pre-wrap; }
.diff-err { font-size: 13px; color: #991b1b; padding: 8px; background: #fef2f2; border-radius: 8px; }

/* ── Summary ── */
.summary-card { background: white; border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 20px; overflow: hidden; animation: fadeUp 0.3s; }
.sc-head { display:flex;align-items:center;gap:8px;padding:12px 16px;background:var(--teal-50);border-bottom:1px solid var(--border);font-size:13px;font-weight:600;color:var(--teal); }
.sc-badge { width:24px;height:24px;border-radius:6px;background:var(--teal);color:white;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center; }
.sc-close { margin-left:auto;background:none;border:none;font-size:18px;color:#9ca3af;cursor:pointer; }
.sc-body { padding:16px 20px;font-size:14px;line-height:1.7;color:#374151; }
.sc-body :deep(h2){font-size:16px;color:var(--teal);margin:16px 0 8px}
.sc-body :deep(h3){font-size:15px;color:var(--navy);margin:14px 0 6px}
.sc-body :deep(strong){color:var(--navy)}
.sc-body :deep(ul){padding-left:20px;margin:8px 0}
.sc-body :deep(li){margin-bottom:4px}

/* ── Pager ── */
.pager { display: flex; justify-content: center; margin-top: 28px; }

/* ── Spinners ── */
.spin { width:18px;height:18px;border:2.5px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:sp .6s linear infinite;display:inline-block; }
.spin-xs { width:12px;height:12px;border:2px solid rgba(0,121,147,0.2);border-top-color:var(--teal);border-radius:50%;animation:sp .6s linear infinite;display:inline-block; }
@keyframes sp { to{transform:rotate(360deg)} }

/* ── Responsive ── */
@media(max-width:900px) {
  .shell { flex-direction: column; }
  .sidebar { width: 100%; min-width: 0; position: relative; top: 0; height: auto; border-right: none; border-bottom: 1px solid var(--border); }
  .main-col { padding: 20px 16px 40px; }
  .diff-html :deep(.diff-sidebyside) { grid-template-columns: 1fr; }
}
</style>
