<template>
  <div class="tracker-page">
    <div class="tracker-content">
      <!-- Header -->
      <div class="header">
        <div class="header-logo">
          <img src="/logo.svg" alt="AI:SSOCIATE" class="header-logo-img" />
        </div>
        <p class="header-sub">Rechtsänderungen in Österreich</p>
      </div>

      <!-- Document Type Toggle -->
      <div class="toggle-row">
        <div class="toggle-wrap">
          <button
            :class="['toggle-btn', docType === 'gesetze' && 'toggle-active']"
            @click="docType = 'gesetze'"
          >
            Gesetze
          </button>
          <button
            :class="['toggle-btn', docType === 'gerichtsentscheidungen' && 'toggle-active']"
            @click="docType = 'gerichtsentscheidungen'"
          >
            Entscheidungen
          </button>
        </div>
      </div>

      <!-- Filter bar -->
      <div class="filter-bar">
        <div class="filter-fields">
          <div class="filter-field">
            <v-select
              v-model="selectedCategory"
              :items="groupedCategories"
              item-title="label"
              item-value="id"
              label="Rechtsgebiet"
              variant="outlined"
              density="comfortable"
              clearable
              hide-details
              prepend-inner-icon="mdi-book-open-variant"
              placeholder="Alle Rechtsgebiete"
              color="#007993"
              base-color="#9ca3af"
            >
              <template #item="{ item, props }">
                <v-list-subheader
                  v-if="item.raw.isGroupHeader"
                  class="category-group-header"
                >
                  {{ item.raw.label }}
                </v-list-subheader>
                <v-list-item
                  v-else
                  v-bind="props"
                  class="category-item"
                />
              </template>
            </v-select>
          </div>
          <div class="filter-field">
            <v-select
              v-model="selectedTimeframe"
              :items="timeframes"
              item-title="label"
              item-value="value"
              label="Zeitraum"
              variant="outlined"
              density="comfortable"
              hide-details
              prepend-inner-icon="mdi-calendar-range"
              color="#007993"
              base-color="#9ca3af"
            />
          </div>
          <button class="search-btn" :disabled="loading" @click="searchFresh">
            <span v-if="loading" class="spinner"></span>
            <v-icon v-else size="18" class="mr-2">mdi-magnify</v-icon>
            Suchen
          </button>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="error-banner">{{ error }}</div>

      <!-- Results -->
      <div v-if="searched && !loading" class="results-section">
        <div class="results-header">
          <span class="results-count">
            {{ totalHits.toLocaleString('de-AT') }} Ergebnis{{ totalHits !== 1 ? 'se' : '' }}
          </span>
          <span class="results-filter">
            {{ categoryLabel }} · {{ timeframeLabel }}
          </span>
        </div>

        <!-- Empty state -->
        <div v-if="results.length === 0" class="empty-state">
          <v-icon size="48" color="#d1d5db">mdi-file-search-outline</v-icon>
          <p>Keine Ergebnisse für die gewählten Filter.</p>
        </div>

        <!-- Info banner -->
        <div v-if="results.length > 0" class="info-banner">
          <v-icon size="16" color="#007993" class="mr-2">mdi-information-outline</v-icon>
          <span>
            Gefiltert nach Bestimmungen mit Inkrafttreten im gewählten Zeitraum.
            Klicken Sie „Änderungen anzeigen" für einen Vergleich mit der Vorversion.
          </span>
        </div>

        <!-- Gesetze Results -->
        <template v-if="docType === 'gesetze'">
          <div v-for="item in results" :key="item.id" class="result-wrapper">
            <div class="result-card">
              <div class="result-icon result-icon-teal">
                <v-icon color="#007993" size="18">mdi-scale-balance</v-icon>
              </div>
              <div class="result-body">
                <a :href="item.url" target="_blank" rel="noopener" class="result-title-link">
                  {{ item.title }}
                </a>
                <div class="result-meta">
                  <span v-if="isExpired(item)" class="chip chip-expired">
                    <v-icon size="10" class="mr-1">mdi-close-circle</v-icon>Außer Kraft seit {{ formatDate(item.ausserkraft) }}
                  </span>
                  <span v-if="item.typ" class="chip chip-teal">{{ item.typ }}</span>
                  <span v-if="item.artikel" class="chip chip-orange">{{ item.artikel }}</span>
                  <span v-if="item.date" class="meta-text">
                    <v-icon size="12" class="mr-1">mdi-gavel</v-icon>In Kraft: {{ formatDate(item.date) }}
                  </span>
                  <span v-if="item.bgbl" class="meta-text">· {{ item.bgbl }}</span>
                  <span v-if="item.ris_updated" class="meta-text meta-text-dim">
                    · <v-icon size="12" class="mr-1">mdi-database-refresh-outline</v-icon>RIS: {{ formatDate(item.ris_updated) }}
                  </span>
                </div>
                <!-- Diff toggle button (when we have Gesetzesnummer + Artikel) -->
                <button
                  v-if="item.gesetzesnummer && item.artikel"
                  class="diff-toggle-btn"
                  :class="{ 'diff-toggle-active': diffOpen[item.id] }"
                  @click.stop="toggleDiff(item)"
                >
                  <span v-if="diffLoading[item.id]" class="spinner spinner-sm"></span>
                  <v-icon v-else size="14" class="mr-1">
                    {{ diffOpen[item.id] ? 'mdi-chevron-up' : 'mdi-compare' }}
                  </v-icon>
                  {{ diffLoading[item.id] ? 'Lade Versionen...' :
                     diffOpen[item.id] ? 'Vergleich schließen' : 'Änderungen anzeigen' }}
                </button>
              </div>
              <a :href="item.url" target="_blank" rel="noopener" class="result-ext-link">
                <v-icon size="14" color="#d1d5db">mdi-open-in-new</v-icon>
              </a>
            </div>
            <!-- Inline diff display -->
            <div v-if="diffOpen[item.id] && diffData[item.id]" class="diff-panel">
              <div v-if="diffData[item.id].has_changes" class="diff-versions">
                <div class="diff-version-info">
                  <span class="diff-label diff-label-old">Vorversion</span>
                  <span v-if="diffData[item.id].previous" class="diff-date">
                    In Kraft: {{ formatDate(diffData[item.id].previous.date) }}
                    <span v-if="diffData[item.id].previous.info"> · {{ diffData[item.id].previous.info }}</span>
                  </span>
                </div>
                <div class="diff-version-info">
                  <span class="diff-label diff-label-new">Aktuelle Fassung</span>
                  <span v-if="diffData[item.id].current" class="diff-date">
                    In Kraft: {{ formatDate(diffData[item.id].current.date) }}
                    <span v-if="diffData[item.id].current.info"> · {{ diffData[item.id].current.info }}</span>
                  </span>
                </div>
              </div>
              <div class="diff-legend" v-if="diffData[item.id].has_changes">
                <span class="diff-legend-item"><span class="diff-del-sample">&nbsp;</span> Entfernt</span>
                <span class="diff-legend-item"><span class="diff-ins-sample">&nbsp;</span> Hinzugefügt</span>
              </div>
              <div class="diff-content" v-html="diffData[item.id].diff_html"></div>
            </div>
            <!-- Diff error -->
            <div v-if="diffOpen[item.id] && diffErrors[item.id]" class="diff-error">
              {{ diffErrors[item.id] }}
            </div>
          </div>
        </template>

        <!-- Gerichtsentscheidungen Results -->
        <template v-if="docType === 'gerichtsentscheidungen'">
          <a
            v-for="item in results"
            :key="item.id"
            :href="item.url"
            target="_blank"
            rel="noopener"
            class="result-card"
          >
            <div class="result-icon result-icon-orange">
              <v-icon color="#ef6007" size="18">mdi-gavel</v-icon>
            </div>
            <div class="result-body">
              <div class="result-title">{{ item.title }}</div>
              <div v-if="item.rechtssatz" class="result-subtitle result-rechtssatz">
                {{ item.rechtssatz }}
              </div>
              <div v-else-if="item.normen" class="result-subtitle">
                Normen: {{ item.normen }}
              </div>
              <div class="result-meta">
                <span class="chip chip-teal">{{ item.court }}</span>
                <span v-if="item.case_number" class="chip chip-orange">{{ item.case_number }}</span>
                <span v-if="item.doc_typ" class="chip" style="background: rgba(99,102,241,0.08); color: #6366f1">
                  {{ item.doc_typ }}
                </span>
                <span v-if="item.date" class="meta-text">
                  <v-icon size="12" class="mr-1">mdi-calendar</v-icon>{{ formatDate(item.date) }}
                </span>
              </div>
            </div>
            <v-icon size="14" color="#d1d5db" class="result-ext">mdi-open-in-new</v-icon>
          </a>
        </template>

        <!-- Pagination -->
        <div v-if="totalHits > 20" class="pagination-row">
          <v-pagination
            v-model="page"
            :length="Math.ceil(totalHits / 20)"
            :total-visible="7"
            rounded="lg"
            active-color="#007993"
            @update:model-value="search"
          />
        </div>

        <!-- ── AI Actions bar ── -->
        <div v-if="results.length > 0" class="ai-actions-bar">
          <div class="ai-actions-header">
            <v-icon color="#007993" size="20" class="mr-2">mdi-brain</v-icon>
            <span class="ai-actions-title">AI-Analyse</span>
          </div>

          <!-- API Key Input -->
          <div class="api-key-row">
            <v-text-field
              v-model="apiKey"
              :type="showApiKey ? 'text' : 'password'"
              label="OpenAI API-Key"
              variant="outlined"
              density="compact"
              hide-details
              placeholder="sk-..."
              prepend-inner-icon="mdi-key-variant"
              color="#007993"
              base-color="#9ca3af"
              class="api-key-input"
            >
              <template #append-inner>
                <v-btn
                  icon
                  variant="text"
                  size="x-small"
                  @click="showApiKey = !showApiKey"
                >
                  <v-icon size="18">{{ showApiKey ? 'mdi-eye-off' : 'mdi-eye' }}</v-icon>
                </v-btn>
              </template>
            </v-text-field>
          </div>

          <!-- Action Buttons -->
          <div class="ai-buttons">
            <button
              class="ai-btn ai-btn-summary"
              :disabled="!apiKey || summarising"
              @click="doSummarise"
            >
              <span v-if="summarising" class="spinner spinner-sm"></span>
              <v-icon v-else size="16" class="mr-1">mdi-text-box-outline</v-icon>
              {{ summarising ? 'Zusammenfassung wird erstellt...' : 'Zusammenfassung erstellen' }}
            </button>
            <button
              class="ai-btn ai-btn-report"
              :disabled="generatingReport"
              @click="doReport"
            >
              <span v-if="generatingReport" class="spinner spinner-sm"></span>
              <v-icon v-else size="16" class="mr-1">mdi-file-download-outline</v-icon>
              {{ generatingReport ? 'Report wird erstellt...' : 'Interaktiven Report herunterladen' }}
            </button>
          </div>

          <!-- Email delivery -->
          <div class="email-row">
            <v-text-field
              v-model="reportEmail"
              type="email"
              label="E-Mail für Report-Versand"
              variant="outlined"
              density="compact"
              hide-details
              placeholder="name@kanzlei.at"
              prepend-inner-icon="mdi-email-outline"
              color="#007993"
              base-color="#9ca3af"
              class="email-input"
            />
            <button
              class="ai-btn ai-btn-email"
              :disabled="!reportEmail || sendingEmail"
              @click="doEmailReport"
            >
              <span v-if="sendingEmail" class="spinner spinner-sm"></span>
              <v-icon v-else size="16" class="mr-1">mdi-send</v-icon>
              {{ sendingEmail ? 'Wird gesendet...' : 'Per E-Mail senden' }}
            </button>
          </div>

          <!-- Summary display -->
          <div v-if="summaryText" class="summary-box">
            <div class="summary-box-header">
              <v-icon color="#007993" size="18" class="mr-2">mdi-text-box-check-outline</v-icon>
              <span class="summary-box-title">GPT-Zusammenfassung</span>
              <v-spacer />
              <button class="summary-close" @click="summaryText = ''">&times;</button>
            </div>
            <div class="summary-box-content" v-html="renderMarkdown(summaryText)"></div>
          </div>

          <!-- Summary error -->
          <div v-if="summaryError" class="error-banner mt-3">
            {{ summaryError }}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="footer">
        Daten aus dem Rechtsinformationssystem des Bundes (RIS)
      </div>
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
const selectedCategory = ref(null)
const selectedTimeframe = ref('EinemMonat')
const loading = ref(false)
const searched = ref(false)
const error = ref('')
const results = ref([])
const totalHits = ref(0)
const page = ref(1)

// Diff / version comparison
const diffOpen = ref({})     // { [docId]: true/false }
const diffData = ref({})     // { [docId]: { current, previous, diff_html, has_changes } }
const diffLoading = ref({})  // { [docId]: true/false }
const diffErrors = ref({})   // { [docId]: "error message" }

// AI features
const apiKey = ref(localStorage.getItem('ris_openai_key') || '')
const showApiKey = ref(false)
const summarising = ref(false)
const summaryText = ref('')
const summaryError = ref('')
const generatingReport = ref(false)
const reportEmail = ref(localStorage.getItem('ris_report_email') || '')
const sendingEmail = ref(false)

// Persist API key
watch(apiKey, (v) => {
  if (v) localStorage.setItem('ris_openai_key', v)
  else localStorage.removeItem('ris_openai_key')
})

onMounted(() => {
  loadFilters()
  const img = new Image()
  img.onload = () => { hasLogo.value = true }
  img.onerror = () => { hasLogo.value = false }
  img.src = '/logo.svg'
})

watch(docType, () => {
  if (searched.value) {
    page.value = 1
    search()
  }
})

// Build grouped categories for the dropdown
const groupedCategories = computed(() => {
  const items = []
  let lastGroup = null
  for (const cat of categories.value) {
    if (cat.group && cat.group !== lastGroup) {
      items.push({ label: cat.group, isGroupHeader: true, id: `__group_${cat.group}` })
      lastGroup = cat.group
    }
    items.push({ ...cat, isGroupHeader: false })
  }
  return items.filter(i => !i.isGroupHeader)
})

const categoryLabel = computed(() => {
  if (!selectedCategory.value) return 'Alle Rechtsgebiete'
  const cat = categories.value.find(c => c.id === selectedCategory.value)
  return cat ? cat.label : ''
})

const timeframeLabel = computed(() => {
  const tf = timeframes.value.find(t => t.value === selectedTimeframe.value)
  return tf ? tf.label : ''
})

function isExpired(item) {
  if (!item.ausserkraft) return false
  try {
    let d = item.ausserkraft
    if (d.includes('.')) {
      const [day, month, year] = d.split('.')
      d = `${year}-${month}-${day}`
    }
    if (d.includes('T')) d = d.split('T')[0]
    if (d === '9999-12-31') return false // Standard "no expiry"
    return new Date(d) < new Date()
  } catch { return false }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    if (dateStr.includes('T')) dateStr = dateStr.split('T')[0]
    if (dateStr.includes('-')) {
      const [y, m, d] = dateStr.split('-')
      return `${d}.${m}.${y}`
    }
    return dateStr
  } catch { return dateStr }
}

function renderMarkdown(md) {
  if (!md) return ''
  let html = md
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/^[-•] (.+)$/gm, '<li>$1</li>')
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
  html = html.replace(/\n\n/g, '</p><p>')
  html = `<p>${html}</p>`
  html = html.replace(/((?:<li>.*?<\/li>\s*)+)/gs, '<ul>$1</ul>')
  return html
}

async function loadFilters() {
  try {
    const [catRes, tfRes] = await Promise.all([
      api.get('/categories'),
      api.get('/timeframes'),
    ])
    categories.value = catRes.data
    timeframes.value = tfRes.data
  } catch (e) {
    error.value = 'Filter konnten nicht geladen werden.'
  }
}

async function toggleDiff(item) {
  const id = item.id
  if (diffOpen.value[id]) {
    diffOpen.value[id] = false
    return
  }
  // Already loaded?
  if (diffData.value[id]) {
    diffOpen.value[id] = true
    return
  }
  // Fetch diff
  diffOpen.value[id] = true
  diffLoading.value[id] = true
  diffErrors.value[id] = ''
  try {
    const resp = await api.get('/diff', { params: {
      doc_id: item.id || '',
      gesetzesnummer: item.gesetzesnummer || '',
      artikel: item.artikel || '',
      inkrafttreten: item.date || '',
    } })
    diffData.value[id] = resp.data
  } catch (e) {
    const detail = e.response?.data?.detail
    diffErrors.value[id] = typeof detail === 'string'
      ? detail
      : Array.isArray(detail) ? detail.map(d => d.msg).join(', ')
      : 'Fehler beim Laden der Versionen.'
    diffOpen.value[id] = true // keep open to show error
  } finally {
    diffLoading.value[id] = false
  }
}

async function searchFresh() {
  page.value = 1
  summaryText.value = ''
  summaryError.value = ''
  // Reset diff state
  diffOpen.value = {}
  diffData.value = {}
  diffErrors.value = {}
  await search()
}

async function search() {
  loading.value = true
  error.value = ''
  searched.value = true

  const endpoint = docType.value === 'gesetze'
    ? '/search/gesetze'
    : '/search/gerichtsentscheidungen'

  const params = {
    im_ris_seit: selectedTimeframe.value,
    page: page.value,
  }
  if (selectedCategory.value) {
    params.category = selectedCategory.value
  }

  try {
    const resp = await api.get(endpoint, { params })
    results.value = resp.data.results || []
    totalHits.value = resp.data.total_hits || 0
  } catch (e) {
    error.value = 'Fehler bei der Suche. Bitte versuchen Sie es erneut.'
    results.value = []
    totalHits.value = 0
  } finally {
    loading.value = false
  }
}

async function doSummarise() {
  if (!apiKey.value || !results.value.length) return
  summarising.value = true
  summaryText.value = ''
  summaryError.value = ''

  try {
    const resp = await api.post('/summarise', {
      api_key: apiKey.value,
      results: results.value,
      doc_type: docType.value,
    })
    summaryText.value = resp.data.summary
  } catch (e) {
    summaryError.value = e.response?.data?.detail || 'Fehler bei der Zusammenfassung.'
  } finally {
    summarising.value = false
  }
}

async function doReport() {
  if (!apiKey.value || !results.value.length) return
  generatingReport.value = true
  summaryError.value = ''

  try {
    // Collect any loaded diffs
    const diffs = {}
    for (const [id, data] of Object.entries(diffData.value)) {
      if (data && data.has_changes) {
        diffs[id] = {
          diff_html: data.diff_html,
          current: data.current,
          previous: data.previous,
        }
      }
    }

    const resp = await api.post('/report', {
      api_key: apiKey.value || '',
      results: results.value,
      doc_type: docType.value,
      category_label: categoryLabel.value,
      timeframe_label: timeframeLabel.value,
      total_hits: totalHits.value,
      diffs: diffs,
    })

    // Download as HTML file
    const blob = new Blob([resp.data.report_html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const dateStr = new Date().toISOString().split('T')[0]
    a.download = `RIS_Report_${dateStr}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error('Report error:', e.response?.data || e.message || e)
    const detail = e.response?.data?.detail
    summaryError.value = typeof detail === 'string'
      ? detail
      : Array.isArray(detail) ? detail.map(d => `${d.loc?.join('.')}: ${d.msg}`).join('; ')
      : `Fehler: ${e.response?.status || ''} ${e.message || 'Unbekannt'}`
  } finally {
    generatingReport.value = false
  }
}

async function doEmailReport() {
  if (!reportEmail.value || !results.value.length) return
  sendingEmail.value = true
  summaryError.value = ''
  localStorage.setItem('ris_report_email', reportEmail.value)

  try {
    // Collect diffs
    const diffsPayload = {}
    for (const [id, data] of Object.entries(diffData.value)) {
      if (data && data.has_changes) {
        diffsPayload[id] = { diff_html: data.diff_html, current: data.current, previous: data.previous }
      }
    }

    await api.post('/report/email', {
      email: reportEmail.value,
      api_key: apiKey.value || '',
      results: results.value,
      doc_type: docType.value,
      category_label: categoryLabel.value,
      timeframe_label: timeframeLabel.value,
      total_hits: totalHits.value,
      diffs: diffsPayload,
    })
    summaryError.value = ''
    alert(`Report wird an ${reportEmail.value} gesendet.`)
  } catch (e) {
    console.error('Email error:', e.response?.data || e)
    const detail = e.response?.data?.detail
    summaryError.value = typeof detail === 'string' ? detail
      : `E-Mail-Versand fehlgeschlagen: ${e.message || 'Unbekannt'}`
  } finally {
    sendingEmail.value = false
  }
}
</script>

<style scoped>
.tracker-page {
  min-height: 100vh;
  background: #f9fafb;
  display: flex;
  justify-content: center;
}

.tracker-content {
  width: 100%;
  max-width: 960px;
  padding: 40px 24px;
}

/* ── Header ── */
.header {
  text-align: center;
  margin-bottom: 32px;
}

.header-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.header-logo-img {
  height: 44px;
  width: auto;
}

.unused-placeholder {
  font-size: 36px;
  font-weight: 300;
  color: #0f3d49;
  letter-spacing: 4px;
}

.header-sub {
  font-size: 14px;
  color: #9ca3af;
  margin: 0;
}

/* ── Toggle ── */
.toggle-row {
  display: flex;
  justify-content: center;
  margin-bottom: 28px;
}

.toggle-wrap {
  display: inline-flex;
  border-radius: 999px;
  border: 1px solid #e5e7eb;
  background: white;
  padding: 3px;
  gap: 2px;
}

.toggle-btn {
  display: inline-flex;
  align-items: center;
  padding: 9px 22px;
  font-size: 13px;
  font-weight: 500;
  color: #6b7280;
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  white-space: nowrap;
}

.toggle-active {
  background: #ef6007;
  color: white;
  box-shadow: 0 1px 3px rgba(239, 96, 7, 0.3);
}

.toggle-btn:not(.toggle-active):hover {
  color: #374151;
  background: #f3f4f6;
}

/* ── Filter bar ── */
.filter-bar {
  background: white;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  padding: 12px;
  margin-bottom: 28px;
}

.filter-fields {
  display: flex;
  gap: 12px;
  align-items: center;
}

.filter-field {
  flex: 1;
  min-width: 0;
}

.search-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 28px;
  background: #ef6007;
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
  min-height: 48px;
}

.search-btn:hover { background: #c64708; }
.search-btn:disabled { opacity: 0.7; cursor: wait; }

.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  margin-right: 8px;
}

.spinner-sm {
  width: 14px;
  height: 14px;
  border-width: 2px;
  margin-right: 6px;
}

.diff-toggle-btn .spinner-sm {
  border-color: rgba(0, 121, 147, 0.2);
  border-top-color: #007993;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Category group headers ── */
.category-group-header {
  font-size: 11px !important;
  font-weight: 700 !important;
  color: #007993 !important;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 12px 16px 4px !important;
  min-height: auto !important;
}

.category-item {
  font-size: 13px;
}

/* ── Info banner ── */
.info-banner {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: rgba(0, 121, 147, 0.04);
  border: 1px solid rgba(0, 121, 147, 0.12);
  border-radius: 10px;
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 12px;
}

/* ── Error ── */
.error-banner {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  padding: 12px 16px;
  border-radius: 10px;
  font-size: 14px;
  margin-bottom: 20px;
}

/* ── Results ── */
.results-section {
  margin-top: 4px;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.results-count {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}

.results-filter {
  font-size: 13px;
  color: #9ca3af;
}

/* ── Result cards ── */
.result-card {
  display: flex;
  align-items: flex-start;
  padding: 16px 20px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  margin-bottom: 8px;
  text-decoration: none;
  color: inherit;
  transition: all 0.15s;
  cursor: pointer;
}

.result-card:hover {
  border-color: #007993;
  box-shadow: 0 2px 8px rgba(0, 121, 147, 0.08);
}

.result-icon {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 14px;
  margin-top: 1px;
}

.result-icon-teal { background: rgba(0, 121, 147, 0.07); }
.result-icon-orange { background: rgba(239, 96, 7, 0.07); }

.result-body { flex: 1; min-width: 0; }

.result-title {
  font-size: 14px;
  font-weight: 500;
  color: #111827;
  line-height: 1.5;
}

.result-subtitle {
  font-size: 13px;
  color: #6b7280;
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.result-rechtssatz {
  -webkit-line-clamp: 3;
  font-style: italic;
  color: #4b5563;
  border-left: 2px solid #ef6007;
  padding-left: 8px;
  margin-top: 6px;
}

.result-meta {
  margin-top: 8px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.chip-teal { background: rgba(0, 121, 147, 0.07); color: #007993; }
.chip-orange { background: rgba(239, 96, 7, 0.07); color: #ef6007; }
.chip-expired { background: #fef2f2; color: #991b1b; display: inline-flex; align-items: center; }

.meta-text { font-size: 12px; color: #9ca3af; display: inline-flex; align-items: center; }
.meta-text-dim { color: #d1d5db; font-size: 11px; }

.result-ext {
  margin-left: 12px;
  margin-top: 2px;
  flex-shrink: 0;
}

.result-ext-link {
  margin-left: 12px;
  margin-top: 2px;
  flex-shrink: 0;
  text-decoration: none;
}

.result-title-link {
  font-size: 14px;
  font-weight: 500;
  color: #111827;
  line-height: 1.5;
  text-decoration: none;
}
.result-title-link:hover {
  color: #007993;
}

.result-wrapper {
  margin-bottom: 8px;
}

/* ── Diff toggle button ── */
.diff-toggle-btn {
  display: inline-flex;
  align-items: center;
  margin-top: 8px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
  color: #007993;
  background: rgba(0, 121, 147, 0.06);
  border: 1px solid rgba(0, 121, 147, 0.15);
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}
.diff-toggle-btn:hover {
  background: rgba(0, 121, 147, 0.12);
  border-color: rgba(0, 121, 147, 0.25);
}
.diff-toggle-active {
  background: rgba(0, 121, 147, 0.1);
  border-color: rgba(0, 121, 147, 0.3);
}

/* ── Diff panel ── */
.diff-panel {
  background: white;
  border: 1px solid #e5e7eb;
  border-top: none;
  border-radius: 0 0 12px 12px;
  padding: 16px 20px;
  margin-top: -1px;
}

.diff-versions {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.diff-version-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.diff-label {
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
  font-size: 11px;
}

.diff-label-old {
  background: #fef2f2;
  color: #991b1b;
}

.diff-label-new {
  background: #f0fdf4;
  color: #166534;
}

.diff-date {
  color: #9ca3af;
  font-size: 12px;
}

.diff-legend {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 12px;
  color: #6b7280;
}

.diff-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.diff-del-sample {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: #fecaca;
}

.diff-ins-sample {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: #bbf7d0;
}

.diff-content {
  font-size: 13px;
  line-height: 1.8;
  color: #374151;
  padding: 12px 16px;
  background: #fafafa;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  max-height: 500px;
  overflow-y: auto;
}

.diff-content :deep(.diff-del) {
  background: #fecaca;
  color: #991b1b;
  text-decoration: line-through;
  padding: 1px 3px;
  border-radius: 3px;
}

.diff-content :deep(.diff-ins) {
  background: #bbf7d0;
  color: #166534;
  padding: 1px 3px;
  border-radius: 3px;
}

.diff-content :deep(.diff-info) {
  color: #6b7280;
  font-style: italic;
  margin-bottom: 12px;
}

.diff-content :deep(.diff-current) {
  color: #374151;
}

.diff-content :deep(.diff-sidebyside) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 12px;
}

.diff-content :deep(.diff-side) {
  padding: 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.7;
}

.diff-content :deep(.diff-side-old) {
  background: #fef2f2;
  border: 1px solid #fecaca;
}

.diff-content :deep(.diff-side-new) {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
}

.diff-content :deep(.diff-side-label) {
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.diff-content :deep(.diff-side-old .diff-side-label) { color: #991b1b; }
.diff-content :deep(.diff-side-new .diff-side-label) { color: #166534; }

.diff-content :deep(.diff-side-text) {
  white-space: pre-wrap;
}

@media (max-width: 768px) {
  .diff-content :deep(.diff-sidebyside) {
    grid-template-columns: 1fr;
  }
}

.diff-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-top: none;
  border-radius: 0 0 12px 12px;
  color: #991b1b;
  padding: 12px 20px;
  font-size: 13px;
  margin-top: -1px;
}

/* ── AI Actions Bar ── */
.ai-actions-bar {
  margin-top: 32px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 20px;
}

.ai-actions-header {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
}

.ai-actions-title {
  font-size: 15px;
  font-weight: 600;
  color: #0f3d49;
}

.api-key-row {
  margin-bottom: 16px;
}

.api-key-input {
  max-width: 480px;
}

.ai-buttons {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.ai-btn {
  display: inline-flex;
  align-items: center;
  padding: 10px 20px;
  border: none;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.ai-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-btn-summary {
  background: #007993;
  color: white;
}
.ai-btn-summary:hover:not(:disabled) {
  background: #006577;
}

.ai-btn-report {
  background: #0f3d49;
  color: white;
}
.ai-btn-report:hover:not(:disabled) {
  background: #0a2e37;
}

.ai-btn-email {
  background: #6366f1;
  color: white;
}
.ai-btn-email:hover:not(:disabled) {
  background: #4f46e5;
}

/* ── Email Row ── */
.email-row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
}

.email-input {
  max-width: 320px;
}

/* ── Summary Box ── */
.summary-box {
  margin-top: 20px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
}

.summary-box-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: rgba(0, 121, 147, 0.04);
  border-bottom: 1px solid #e5e7eb;
}

.summary-box-title {
  font-size: 13px;
  font-weight: 600;
  color: #007993;
}

.summary-close {
  background: none;
  border: none;
  font-size: 20px;
  color: #9ca3af;
  cursor: pointer;
  line-height: 1;
  padding: 0 4px;
}
.summary-close:hover { color: #374151; }

.summary-box-content {
  padding: 16px 20px;
  font-size: 14px;
  line-height: 1.7;
  color: #374151;
}

.summary-box-content :deep(h2) {
  font-size: 16px;
  color: #007993;
  margin: 16px 0 8px;
}

.summary-box-content :deep(h3) {
  font-size: 15px;
  color: #0f3d49;
  margin: 14px 0 6px;
}

.summary-box-content :deep(h4) {
  font-size: 14px;
  color: #374151;
  margin: 12px 0 4px;
}

.summary-box-content :deep(strong) {
  color: #0f3d49;
}

.summary-box-content :deep(ul) {
  padding-left: 20px;
  margin: 8px 0;
}

.summary-box-content :deep(li) {
  margin-bottom: 4px;
}

/* ── Empty ── */
.empty-state {
  text-align: center;
  padding: 56px 16px;
  background: white;
  border: 1px dashed #e5e7eb;
  border-radius: 12px;
}

.empty-state p {
  color: #9ca3af;
  font-size: 14px;
  margin-top: 16px;
}

/* ── Pagination ── */
.pagination-row {
  display: flex;
  justify-content: center;
  margin-top: 28px;
}

/* ── Footer ── */
.footer {
  text-align: center;
  margin-top: 40px;
  padding-bottom: 20px;
  font-size: 12px;
  color: #d1d5db;
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .filter-fields { flex-direction: column; }
  .search-btn { width: 100%; }
  .ai-buttons { flex-direction: column; }
  .ai-btn { width: 100%; justify-content: center; }
  .api-key-input { max-width: 100%; }
}
</style>
