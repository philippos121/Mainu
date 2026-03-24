<template>
  <div class="tracker-page">
    <div class="tracker-content">
      <!-- Header -->
      <div class="header">
        <div class="header-logo">
          <img v-if="hasLogo" src="/logo.svg" alt="Logo" style="height: 52px" />
          <template v-else>
            <span class="logo-ai">AI</span><span class="logo-colon">:</span><span class="logo-text">SSOCIATE</span>
          </template>
        </div>
        <p class="header-sub">Österreichische Rechtsänderungen durchsuchen</p>
      </div>

      <!-- Document Type Toggle -->
      <div class="toggle-row">
        <div class="toggle-wrap">
          <button
            :class="['toggle-btn', docType === 'gesetze' && 'toggle-active']"
            @click="docType = 'gesetze'"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px">
              <circle cx="12" cy="5" r="3"/><path d="M12 8v4m-5 4l5-4 5 4m-10 0v4h10v-4"/>
            </svg>
            Gesetze
          </button>
          <button
            :class="['toggle-btn', docType === 'gerichtsentscheidungen' && 'toggle-active']"
            @click="docType = 'gerichtsentscheidungen'"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
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
              :items="categories"
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
            />
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
            <svg v-if="!loading" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <span v-if="loading" class="spinner"></span>
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
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
          <p>Keine Ergebnisse für die gewählten Filter.</p>
        </div>

        <!-- Gesetze Results -->
        <template v-if="docType === 'gesetze'">
          <a
            v-for="item in results"
            :key="item.id"
            :href="item.url"
            target="_blank"
            rel="noopener"
            class="result-card"
          >
            <div class="result-icon result-icon-teal">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="3"/><path d="M12 8v4m-5 4l5-4 5 4m-10 0v4h10v-4"/></svg>
            </div>
            <div class="result-body">
              <div class="result-title">{{ item.title }}</div>
              <div class="result-meta">
                <span v-if="item.typ" class="chip chip-teal">{{ item.typ }}</span>
                <span v-if="item.artikel" class="chip chip-orange">{{ item.artikel }}</span>
                <span v-if="item.date" class="meta-text">{{ formatDate(item.date) }}</span>
                <span v-if="item.bgbl" class="meta-text">· {{ item.bgbl }}</span>
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="result-ext">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div class="result-body">
              <div class="result-title">{{ item.title }}</div>
              <div v-if="item.normen" class="result-subtitle">Normen: {{ item.normen }}</div>
              <div class="result-meta">
                <span class="chip chip-teal">{{ item.court }}</span>
                <span v-if="item.case_number" class="chip chip-orange">{{ item.case_number }}</span>
                <span v-if="item.date" class="meta-text">{{ formatDate(item.date) }}</span>
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="result-ext">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
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

const categoryLabel = computed(() => {
  if (!selectedCategory.value) return 'Alle Rechtsgebiete'
  const cat = categories.value.find(c => c.id === selectedCategory.value)
  return cat ? cat.label : ''
})

const timeframeLabel = computed(() => {
  const tf = timeframes.value.find(t => t.value === selectedTimeframe.value)
  return tf ? tf.label : ''
})

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

async function searchFresh() {
  page.value = 1
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
  align-items: baseline;
  justify-content: center;
  margin-bottom: 8px;
}

.logo-ai {
  font-size: 42px;
  font-weight: 800;
  font-style: italic;
  color: #007993;
  letter-spacing: -2px;
}

.logo-colon {
  font-size: 42px;
  font-weight: 300;
  color: #ef6007;
  margin: 0 1px;
}

.logo-text {
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

.search-btn:hover {
  background: #c64708;
}

.search-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

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

@keyframes spin {
  to { transform: rotate(360deg); }
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

.result-icon-teal {
  background: rgba(0, 121, 147, 0.07);
  color: #007993;
}

.result-icon-orange {
  background: rgba(239, 96, 7, 0.07);
  color: #ef6007;
}

.result-body {
  flex: 1;
  min-width: 0;
}

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

.chip-teal {
  background: rgba(0, 121, 147, 0.07);
  color: #007993;
}

.chip-orange {
  background: rgba(239, 96, 7, 0.07);
  color: #ef6007;
}

.meta-text {
  font-size: 12px;
  color: #9ca3af;
}

.result-ext {
  margin-left: 12px;
  margin-top: 2px;
  flex-shrink: 0;
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
  .filter-fields {
    flex-direction: column;
  }
  .search-btn {
    width: 100%;
  }
}
</style>
