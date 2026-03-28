<template>
  <div class="page">
    <div class="content">
      <!-- Hero -->
      <header class="hero">
        <img src="/logo.svg" alt="AI:ssociate" class="hero-logo" />
        <p class="hero-sub">Rechtsänderungen in Österreich</p>
      </header>

      <!-- Toggle -->
      <div class="toggle-row">
        <div class="toggle">
          <button :class="['toggle-btn', docType === 'gesetze' && 'active']" @click="docType = 'gesetze'">
            <v-icon size="15" class="mr-1">mdi-scale-balance</v-icon>Gesetze
          </button>
          <button :class="['toggle-btn', docType === 'gerichtsentscheidungen' && 'active']" @click="docType = 'gerichtsentscheidungen'">
            <v-icon size="15" class="mr-1">mdi-gavel</v-icon>Entscheidungen
          </button>
        </div>
      </div>

      <!-- Search bar -->
      <div class="search-bar">
        <div class="search-fields">
          <div class="search-field search-field-wide">
            <v-select
              v-model="selectedCategory"
              :items="groupedCategories"
              item-title="label"
              item-value="id"
              label="Rechtsgebiete"
              variant="outlined"
              density="comfortable"
              multiple
              chips
              closable-chips
              clearable
              hide-details
              placeholder="Rechtsgebiete wählen"
              color="#007993"
              base-color="#5f6d7e"
            />
          </div>
          <div class="search-field">
            <v-select
              v-model="selectedTimeframe"
              :items="timeframes"
              item-title="label"
              item-value="value"
              label="Zeitraum"
              variant="outlined"
              density="comfortable"
              hide-details
              color="#007993"
              base-color="#5f6d7e"
            />
          </div>
          <button class="btn-search" :disabled="loading" @click="searchFresh">
            <span v-if="loading" class="spinner"></span>
            <v-icon v-else size="18">mdi-magnify</v-icon>
            <span class="btn-label">Suchen</span>
          </button>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="alert alert-error">{{ error }}</div>

      <!-- Results -->
      <div v-if="searched && !loading" class="results">
        <!-- Results header -->
        <div class="results-head">
          <div class="results-count">
            <span class="count-num">{{ totalHits.toLocaleString('de-AT') }}</span>
            <span class="count-label">Ergebnis{{ totalHits !== 1 ? 'se' : '' }}</span>
          </div>
          <span class="results-meta">{{ categoryLabel }} · {{ timeframeLabel }}</span>
        </div>

        <!-- Empty -->
        <div v-if="results.length === 0" class="empty">
          <v-icon size="48" color="#c4c8cc">mdi-file-search-outline</v-icon>
          <p>Keine Ergebnisse gefunden.</p>
        </div>

        <!-- Gesetze cards -->
        <template v-if="docType === 'gesetze'">
          <div v-for="(item, idx) in results" :key="item.id" class="card" :style="`animation-delay:${idx * 0.03}s`">
            <div class="card-main">
              <div class="card-icon card-icon-teal"><v-icon color="#007993" size="18">mdi-scale-balance</v-icon></div>
              <div class="card-body">
                <a :href="item.url" target="_blank" rel="noopener" class="card-title">{{ item.title }}</a>
                <div class="card-chips">
                  <span v-if="isExpired(item)" class="chip chip-red">Außer Kraft {{ formatDate(item.ausserkraft) }}</span>
                  <span v-if="item.typ" class="chip chip-teal">{{ item.typ }}</span>
                  <span v-if="item.artikel" class="chip chip-orange">{{ item.artikel }}</span>
                  <span v-if="item.date" class="chip chip-ghost">{{ formatDate(item.date) }}</span>
                  <span v-if="item.bgbl" class="chip chip-ghost">{{ item.bgbl }}</span>
                </div>
                <!-- Diff button -->
                <button v-if="item.gesetzesnummer && item.artikel" class="btn-diff" @click.stop="toggleDiff(item)">
                  <span v-if="diffLoading[item.id]" class="spinner-sm"></span>
                  <v-icon v-else size="14">{{ diffOpen[item.id] ? 'mdi-chevron-up' : 'mdi-compare' }}</v-icon>
                  {{ diffLoading[item.id] ? 'Lädt...' : diffOpen[item.id] ? 'Schließen' : 'Änderungen' }}
                </button>
              </div>
              <a :href="item.url" target="_blank" rel="noopener" class="card-ext"><v-icon size="14" color="#c4c8cc">mdi-open-in-new</v-icon></a>
            </div>
            <!-- Diff panel -->
            <transition name="slide">
              <div v-if="diffOpen[item.id] && (diffData[item.id] || diffErrors[item.id])" class="diff-panel">
                <div v-if="diffData[item.id] && diffData[item.id].has_changes" class="diff-versions">
                  <span class="diff-v diff-v-old">{{ diffData[item.id].previous?.date }}</span>
                  <v-icon size="14" color="#9ca3af">mdi-arrow-right</v-icon>
                  <span class="diff-v diff-v-new">{{ diffData[item.id].current?.date }}</span>
                </div>
                <div v-if="diffData[item.id]" class="diff-body" v-html="diffData[item.id].diff_html"></div>
                <div v-if="diffErrors[item.id]" class="diff-error">{{ diffErrors[item.id] }}</div>
              </div>
            </transition>
          </div>
        </template>

        <!-- Entscheidungen cards -->
        <template v-if="docType === 'gerichtsentscheidungen'">
          <a v-for="(item, idx) in results" :key="item.id" :href="item.url" target="_blank" rel="noopener"
             class="card card-link" :style="`animation-delay:${idx * 0.03}s`">
            <div class="card-main">
              <div class="card-icon card-icon-orange"><v-icon color="#ef6007" size="18">mdi-gavel</v-icon></div>
              <div class="card-body">
                <div class="card-title">{{ item.title }}</div>
                <div v-if="item.rechtssatz" class="card-rs">{{ item.rechtssatz }}</div>
                <div class="card-chips">
                  <span class="chip chip-teal">{{ item.court }}</span>
                  <span v-if="item.case_number" class="chip chip-orange">{{ item.case_number }}</span>
                  <span v-if="item.date" class="chip chip-ghost">{{ formatDate(item.date) }}</span>
                </div>
              </div>
              <v-icon size="14" color="#c4c8cc" class="card-ext">mdi-open-in-new</v-icon>
            </div>
          </a>
        </template>

        <!-- Pagination -->
        <div v-if="totalHits > 20" class="pagination">
          <v-pagination v-model="page" :length="Math.ceil(totalHits / 20)" :total-visible="7"
            rounded="lg" active-color="#007993" @update:model-value="search" />
        </div>

        <!-- AI Section -->
        <div v-if="results.length > 0" class="ai-section">
          <div class="ai-header">
            <div class="ai-badge">AI</div>
            <span class="ai-title">Analyse & Report</span>
          </div>

          <div class="ai-grid">
            <!-- API Key -->
            <div class="ai-field">
              <v-text-field v-model="apiKey" :type="showApiKey ? 'text' : 'password'"
                label="OpenAI API-Key" variant="outlined" density="compact" hide-details
                placeholder="sk-..." prepend-inner-icon="mdi-key-variant" color="#007993">
                <template #append-inner>
                  <v-btn icon variant="text" size="x-small" @click="showApiKey = !showApiKey">
                    <v-icon size="16">{{ showApiKey ? 'mdi-eye-off' : 'mdi-eye' }}</v-icon>
                  </v-btn>
                </template>
              </v-text-field>
            </div>

            <!-- Buttons -->
            <div class="ai-actions">
              <button class="btn btn-teal" :disabled="!apiKey || summarising" @click="doSummarise">
                <span v-if="summarising" class="spinner-sm"></span>
                <v-icon v-else size="15">mdi-text-box-outline</v-icon>
                {{ summarising ? 'Erstellt...' : 'Zusammenfassung' }}
              </button>
              <button class="btn btn-navy" :disabled="generatingReport" @click="doReport">
                <span v-if="generatingReport" class="spinner-sm"></span>
                <v-icon v-else size="15">mdi-file-download-outline</v-icon>
                {{ generatingReport ? 'Erstellt...' : 'Report' }}
              </button>
            </div>

            <!-- Email -->
            <div class="ai-email">
              <v-text-field v-model="reportEmail" type="email" label="E-Mail" variant="outlined"
                density="compact" hide-details placeholder="name@kanzlei.at"
                prepend-inner-icon="mdi-email-outline" color="#007993" />
              <button class="btn btn-purple" :disabled="!reportEmail || sendingEmail" @click="doEmailReport">
                <span v-if="sendingEmail" class="spinner-sm"></span>
                <v-icon v-else size="15">mdi-send</v-icon>
                {{ sendingEmail ? 'Sendet...' : 'Senden' }}
              </button>
            </div>
          </div>

          <!-- Summary -->
          <div v-if="summaryText" class="summary-card">
            <div class="summary-head">
              <v-icon color="#007993" size="18">mdi-text-box-check-outline</v-icon>
              <span>Rechtliche Analyse</span>
              <button class="summary-close" @click="summaryText = ''">&times;</button>
            </div>
            <div class="summary-body" v-html="renderMarkdown(summaryText)"></div>
          </div>

          <div v-if="summaryError" class="alert alert-error" style="margin-top:12px">{{ summaryError }}</div>
        </div>
      </div>

      <!-- Footer -->
      <footer class="footer">Datenquelle: Rechtsinformationssystem des Bundes (RIS)</footer>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import api from '../services/api'

const hasLogo = ref(false)
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

watch(apiKey, (v) => {
  if (v) localStorage.setItem('ris_openai_key', v)
  else localStorage.removeItem('ris_openai_key')
})

onMounted(() => { loadFilters() })

watch(docType, () => {
  if (searched.value) { page.value = 1; search() }
})

const groupedCategories = computed(() => {
  return categories.value.map(c => ({ ...c }))
})

const categoryLabel = computed(() => {
  const cats = selectedCategory.value || []
  if (cats.length === 0) return 'Alle Rechtsgebiete'
  if (cats.length === 1) {
    const cat = categories.value.find(c => c.id === cats[0])
    return cat ? cat.label : ''
  }
  return `${cats.length} Rechtsgebiete`
})

const timeframeLabel = computed(() => {
  const tf = timeframes.value.find(t => t.value === selectedTimeframe.value)
  return tf ? tf.label : ''
})

function isExpired(item) {
  if (!item.ausserkraft) return false
  try {
    let d = item.ausserkraft
    if (d.includes('.')) { const [day, month, year] = d.split('.'); d = `${year}-${month}-${day}` }
    if (d.includes('T')) d = d.split('T')[0]
    if (d === '9999-12-31') return false
    return new Date(d) < new Date()
  } catch { return false }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    if (dateStr.includes('T')) dateStr = dateStr.split('T')[0]
    if (dateStr.includes('-')) { const [y, m, d] = dateStr.split('-'); return `${d}.${m}.${y}` }
    return dateStr
  } catch { return dateStr }
}

function renderMarkdown(md) {
  if (!md) return ''
  let h = md
  h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>')
  h = h.replace(/^## (.+)$/gm, '<h3>$1</h3>')
  h = h.replace(/^# (.+)$/gm, '<h2>$1</h2>')
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>')
  h = h.replace(/^[-•] (.+)$/gm, '<li>$1</li>')
  h = h.replace(/\n\n/g, '</p><p>')
  h = `<p>${h}</p>`
  h = h.replace(/((?:<li>.*?<\/li>\s*)+)/gs, '<ul>$1</ul>')
  return h
}

async function loadFilters() {
  try {
    const [catRes, tfRes] = await Promise.all([api.get('/categories'), api.get('/timeframes')])
    categories.value = catRes.data
    timeframes.value = tfRes.data
  } catch (e) { error.value = 'Filter konnten nicht geladen werden.' }
}

async function toggleDiff(item) {
  const id = item.id
  if (diffOpen.value[id]) { diffOpen.value[id] = false; return }
  if (diffData.value[id]) { diffOpen.value[id] = true; return }
  diffOpen.value[id] = true; diffLoading.value[id] = true; diffErrors.value[id] = ''
  try {
    const resp = await api.get('/diff', { params: {
      doc_id: item.id || '', gesetzesnummer: item.gesetzesnummer || '',
      artikel: item.artikel || '', inkrafttreten: item.date || '',
    } })
    diffData.value[id] = resp.data
  } catch (e) {
    const d = e.response?.data?.detail
    diffErrors.value[id] = typeof d === 'string' ? d : 'Fehler beim Laden.'
    diffOpen.value[id] = true
  } finally { diffLoading.value[id] = false }
}

async function searchFresh() {
  page.value = 1; summaryText.value = ''; summaryError.value = ''
  diffOpen.value = {}; diffData.value = {}; diffErrors.value = {}
  await search()
}

async function search() {
  loading.value = true; error.value = ''; searched.value = true
  const endpoint = docType.value === 'gesetze' ? '/search/gesetze' : '/search/gerichtsentscheidungen'
  const cats = selectedCategory.value || []
  try {
    let resp
    if (cats.length <= 1) {
      const params = { im_ris_seit: selectedTimeframe.value, page: page.value }
      if (cats.length === 1) params.category = cats[0]
      resp = await api.get(endpoint, { params })
    } else {
      const promises = cats.map(cat => api.get(endpoint, { params: { im_ris_seit: selectedTimeframe.value, page: 1, category: cat } }))
      const responses = await Promise.all(promises)
      const all = []; let hits = 0; const seen = new Set()
      for (const r of responses) {
        hits += r.data.total_hits || 0
        for (const item of (r.data.results || [])) { if (!seen.has(item.id)) { seen.add(item.id); all.push(item) } }
      }
      resp = { data: { results: all, total_hits: hits } }
    }
    results.value = resp.data.results || []; totalHits.value = resp.data.total_hits || 0
  } catch (e) { error.value = 'Fehler bei der Suche.'; results.value = []; totalHits.value = 0 }
  finally { loading.value = false }
}

async function doSummarise() {
  if (!apiKey.value || !results.value.length) return
  summarising.value = true; summaryText.value = ''; summaryError.value = ''
  try {
    const resp = await api.post('/summarise', { api_key: apiKey.value, results: results.value, doc_type: docType.value })
    summaryText.value = resp.data.summary
  } catch (e) { summaryError.value = e.response?.data?.detail || 'Fehler.' }
  finally { summarising.value = false }
}

async function doReport() {
  if (!results.value.length) return
  generatingReport.value = true; summaryError.value = ''
  try {
    const diffs = {}
    for (const [id, data] of Object.entries(diffData.value)) {
      if (data?.has_changes) diffs[id] = { diff_html: data.diff_html, current: data.current, previous: data.previous }
    }
    const resp = await api.post('/report', {
      api_key: apiKey.value || '', results: results.value, doc_type: docType.value,
      category_label: categoryLabel.value, timeframe_label: timeframeLabel.value,
      total_hits: totalHits.value, diffs,
    })
    const blob = new Blob([resp.data.report_html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `RIS_Report_${new Date().toISOString().split('T')[0]}.html`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  } catch (e) {
    const d = e.response?.data?.detail
    summaryError.value = typeof d === 'string' ? d : `Fehler: ${e.message || 'Unbekannt'}`
  } finally { generatingReport.value = false }
}

async function doEmailReport() {
  if (!reportEmail.value || !results.value.length) return
  sendingEmail.value = true; summaryError.value = ''
  localStorage.setItem('ris_report_email', reportEmail.value)
  try {
    const diffs = {}
    for (const [id, data] of Object.entries(diffData.value)) {
      if (data?.has_changes) diffs[id] = { diff_html: data.diff_html, current: data.current, previous: data.previous }
    }
    await api.post('/report/email', {
      email: reportEmail.value, api_key: apiKey.value || '', results: results.value, doc_type: docType.value,
      category_label: categoryLabel.value, timeframe_label: timeframeLabel.value,
      total_hits: totalHits.value, diffs,
    })
    alert(`Report wird an ${reportEmail.value} gesendet.`)
  } catch (e) {
    summaryError.value = e.response?.data?.detail || `E-Mail fehlgeschlagen: ${e.message}`
  } finally { sendingEmail.value = false }
}
</script>

<style scoped>
/* ── Page ── */
.page { min-height: 100vh; display: flex; justify-content: center; }
.content { width: 100%; max-width: 920px; padding: 40px 28px 60px; }

/* ── Hero ── */
.hero {
  text-align: center;
  margin-bottom: 36px;
  animation: fadeIn 0.6s ease-out;
}
.hero-logo { height: 48px; width: auto; }
.hero-sub { font-size: 14px; color: var(--text-secondary); margin-top: 8px; letter-spacing: 0.3px; }

/* ── Toggle ── */
.toggle-row { display: flex; justify-content: center; margin-bottom: 28px; animation: fadeIn 0.6s 0.1s ease-out both; }
.toggle {
  display: inline-flex; border-radius: 100px;
  background: var(--card); border: 1px solid var(--border);
  padding: 4px; gap: 2px;
  box-shadow: var(--shadow-sm);
}
.toggle-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 10px 24px; font-size: 13px; font-weight: 500;
  color: var(--text-secondary); background: transparent;
  border: none; border-radius: 100px; cursor: pointer;
  font-family: inherit; transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.toggle-btn.active {
  background: var(--orange); color: white;
  box-shadow: 0 2px 8px rgba(239,96,7,0.25);
  transform: scale(1.02);
}
.toggle-btn:not(.active):hover { color: var(--text); background: var(--teal-light); }

/* ── Search bar ── */
.search-bar {
  background: var(--card); border-radius: var(--radius);
  border: 1px solid var(--border); padding: 14px;
  margin-bottom: 28px; box-shadow: var(--shadow-sm);
  animation: fadeIn 0.6s 0.15s ease-out both;
  transition: box-shadow 0.3s;
}
.search-bar:focus-within { box-shadow: 0 0 0 3px rgba(0,121,147,0.1), var(--shadow-md); }
.search-fields { display: flex; gap: 12px; align-items: center; }
.search-field { flex: 1; min-width: 0; }
.search-field-wide { flex: 2; }

.btn-search {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 13px 28px; background: var(--orange); color: white;
  border: none; border-radius: 12px; font-size: 14px; font-weight: 600;
  font-family: inherit; cursor: pointer; white-space: nowrap;
  transition: all 0.2s; box-shadow: 0 2px 8px rgba(239,96,7,0.2);
}
.btn-search:hover { background: #d45506; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(239,96,7,0.3); }
.btn-search:active { transform: translateY(0); }
.btn-search:disabled { opacity: 0.6; cursor: wait; }
.btn-label { display: inline; }

/* ── Alerts ── */
.alert { padding: 12px 16px; border-radius: 10px; font-size: 14px; margin-bottom: 16px; animation: scaleIn 0.3s ease-out; }
.alert-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }

/* ── Results ── */
.results { animation: fadeIn 0.4s ease-out; }
.results-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; }
.results-count { display: flex; align-items: baseline; gap: 6px; }
.count-num { font-size: 24px; font-weight: 700; color: var(--teal); }
.count-label { font-size: 14px; color: var(--text-secondary); }
.results-meta { font-size: 13px; color: #9ca3af; }

/* ── Cards ── */
.card {
  background: var(--card); border-radius: var(--radius);
  border: 1px solid var(--border); margin-bottom: 8px;
  animation: fadeIn 0.35s ease-out both;
  transition: all 0.2s;
  overflow: hidden;
}
.card:hover { border-color: var(--teal); box-shadow: var(--shadow-md); transform: translateY(-1px); }
.card-link { text-decoration: none; color: inherit; display: block; }
.card-main { display: flex; align-items: flex-start; padding: 16px 20px; gap: 14px; }

.card-icon {
  width: 38px; height: 38px; min-width: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; margin-top: 2px;
}
.card-icon-teal { background: var(--teal-light); }
.card-icon-orange { background: var(--orange-light); }

.card-body { flex: 1; min-width: 0; }
.card-title { font-size: 14px; font-weight: 500; color: var(--text); line-height: 1.5; text-decoration: none; display: block; }
a.card-title:hover { color: var(--teal); }

.card-rs {
  font-size: 12px; color: #4b5563; font-style: italic;
  border-left: 2px solid var(--orange); padding-left: 8px;
  margin: 6px 0; line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

.card-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.chip {
  display: inline-flex; align-items: center; padding: 2px 8px;
  border-radius: 6px; font-size: 11px; font-weight: 500; white-space: nowrap;
}
.chip-teal { background: var(--teal-light); color: var(--teal); }
.chip-orange { background: var(--orange-light); color: var(--orange); }
.chip-ghost { background: #f3f4f6; color: #6b7280; }
.chip-red { background: #fef2f2; color: #dc2626; }

.card-ext { flex-shrink: 0; margin-top: 4px; text-decoration: none; }

/* ── Diff button ── */
.btn-diff {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 8px; padding: 4px 12px; font-size: 12px; font-weight: 500;
  color: var(--teal); background: var(--teal-light);
  border: 1px solid rgba(0,121,147,0.15); border-radius: 8px;
  cursor: pointer; font-family: inherit;
  transition: all 0.2s;
}
.btn-diff:hover { background: rgba(0,121,147,0.12); border-color: rgba(0,121,147,0.3); }

/* ── Diff panel ── */
.slide-enter-active, .slide-leave-active { transition: all 0.3s ease; }
.slide-enter-from, .slide-leave-to { opacity: 0; max-height: 0; }
.slide-enter-to, .slide-leave-from { opacity: 1; max-height: 600px; }

.diff-panel {
  padding: 16px 20px; background: #fafbfc;
  border-top: 1px solid var(--border); overflow: hidden;
}
.diff-versions { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 12px; }
.diff-v { padding: 3px 8px; border-radius: 6px; font-weight: 500; }
.diff-v-old { background: #fef2f2; color: #991b1b; }
.diff-v-new { background: #f0fdf4; color: #166534; }

.diff-body {
  font-size: 13px; line-height: 1.8; padding: 12px 16px;
  background: white; border: 1px solid var(--border); border-radius: 10px;
  max-height: 400px; overflow-y: auto;
}
.diff-body :deep(.diff-del) { background: #fecaca; color: #991b1b; text-decoration: line-through; padding: 1px 3px; border-radius: 3px; }
.diff-body :deep(.diff-ins) { background: #bbf7d0; color: #166534; padding: 1px 3px; border-radius: 3px; }
.diff-body :deep(.diff-info) { color: #6b7280; font-style: italic; margin-bottom: 8px; }
.diff-body :deep(.diff-sidebyside) { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.diff-body :deep(.diff-side) { padding: 10px; border-radius: 8px; font-size: 12px; line-height: 1.6; }
.diff-body :deep(.diff-side-old) { background: #fef2f2; border: 1px solid #fecaca; }
.diff-body :deep(.diff-side-new) { background: #f0fdf4; border: 1px solid #bbf7d0; }
.diff-body :deep(.diff-side-label) { font-weight: 600; font-size: 11px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
.diff-body :deep(.diff-side-old .diff-side-label) { color: #991b1b; }
.diff-body :deep(.diff-side-new .diff-side-label) { color: #166534; }
.diff-body :deep(.diff-side-text) { white-space: pre-wrap; }
.diff-error { color: #991b1b; font-size: 13px; padding: 8px; background: #fef2f2; border-radius: 8px; }

/* ── Pagination ── */
.pagination { display: flex; justify-content: center; margin-top: 28px; }

/* ── AI Section ── */
.ai-section {
  margin-top: 36px; padding: 24px;
  background: var(--card); border-radius: var(--radius);
  border: 1px solid var(--border); box-shadow: var(--shadow-sm);
  animation: fadeIn 0.5s 0.2s ease-out both;
}
.ai-header { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
.ai-badge {
  width: 28px; height: 28px; border-radius: 8px;
  background: linear-gradient(135deg, var(--teal) 0%, var(--teal-dark) 100%);
  color: white; font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.ai-title { font-size: 15px; font-weight: 600; color: var(--text); }

.ai-grid { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.ai-field { flex: 1; min-width: 200px; }
.ai-actions { display: flex; gap: 8px; }
.ai-email { display: flex; gap: 8px; align-items: center; flex: 1; min-width: 200px; }

.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 18px; border: none; border-radius: 10px;
  font-size: 13px; font-weight: 600; font-family: inherit;
  cursor: pointer; white-space: nowrap;
  transition: all 0.2s;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-teal { background: var(--teal); color: white; }
.btn-teal:hover:not(:disabled) { background: var(--teal-dark); }
.btn-navy { background: var(--navy); color: white; }
.btn-navy:hover:not(:disabled) { background: #031e20; }
.btn-purple { background: #7c3aed; color: white; }
.btn-purple:hover:not(:disabled) { background: #6d28d9; }

/* ── Summary card ── */
.summary-card {
  margin-top: 20px; border: 1px solid var(--border); border-radius: 12px;
  overflow: hidden; animation: scaleIn 0.3s ease-out;
}
.summary-head {
  display: flex; align-items: center; gap: 8px; padding: 12px 16px;
  background: var(--teal-light); border-bottom: 1px solid var(--border);
  font-size: 13px; font-weight: 600; color: var(--teal);
}
.summary-close { margin-left: auto; background: none; border: none; font-size: 20px; color: #9ca3af; cursor: pointer; }
.summary-body { padding: 16px 20px; font-size: 14px; line-height: 1.7; color: #374151; }
.summary-body :deep(h2) { font-size: 16px; color: var(--teal); margin: 16px 0 8px; }
.summary-body :deep(h3) { font-size: 15px; color: var(--navy); margin: 14px 0 6px; }
.summary-body :deep(strong) { color: var(--navy); }
.summary-body :deep(ul) { padding-left: 20px; margin: 8px 0; }
.summary-body :deep(li) { margin-bottom: 4px; }

/* ── Empty ── */
.empty { text-align: center; padding: 56px 16px; background: var(--card); border: 1px dashed var(--border); border-radius: var(--radius); }
.empty p { color: #9ca3af; font-size: 14px; margin-top: 12px; }

/* ── Footer ── */
.footer { text-align: center; margin-top: 48px; font-size: 12px; color: #c4c8cc; }

/* ── Spinners ── */
.spinner {
  width: 18px; height: 18px; border: 2.5px solid rgba(255,255,255,0.3);
  border-top-color: white; border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
.spinner-sm {
  width: 14px; height: 14px; border: 2px solid rgba(0,121,147,0.2);
  border-top-color: var(--teal); border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
.btn .spinner-sm { border-color: rgba(255,255,255,0.3); border-top-color: white; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Responsive ── */
@media (max-width: 768px) {
  .search-fields { flex-direction: column; }
  .btn-search { width: 100%; justify-content: center; }
  .btn-label { display: inline; }
  .ai-grid { flex-direction: column; }
  .ai-email { flex-direction: column; }
  .diff-body :deep(.diff-sidebyside) { grid-template-columns: 1fr; }
}
</style>
