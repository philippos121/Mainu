<template>
  <v-container fluid class="pa-6 pa-md-10" style="max-width: 1100px">
    <!-- Header with logo -->
    <div class="text-center mb-8">
      <div class="d-flex align-center justify-center mb-3">
        <img v-if="hasLogo" src="/logo.svg" alt="Logo" style="height: 48px" />
        <template v-else>
          <span class="text-h4 font-weight-bold" style="color: #007993">RIS</span>
          <span class="text-h4 font-weight-light ml-1" style="color: #0f3d49">Tracker</span>
        </template>
      </div>
      <p class="text-body-2" style="color: #6a7282">
        Österreichische Rechtsänderungen durchsuchen
      </p>
    </div>

    <!-- Document Type Toggle (aissociate "Quellen/Verlauf" style) -->
    <div class="d-flex justify-center mb-8">
      <div class="doc-toggle-wrap">
        <button
          :class="['doc-toggle-btn', docType === 'gesetze' && 'doc-toggle-active']"
          @click="docType = 'gesetze'"
        >
          <v-icon start size="16">mdi-scale-balance</v-icon>
          Gesetze
        </button>
        <button
          :class="['doc-toggle-btn', docType === 'gerichtsentscheidungen' && 'doc-toggle-active']"
          @click="docType = 'gerichtsentscheidungen'"
        >
          <v-icon start size="16">mdi-gavel</v-icon>
          Entscheidungen
        </button>
      </div>
    </div>

    <!-- Filters (aissociate card style) -->
    <div class="filter-card mb-8">
      <v-row align="center" no-gutters>
        <v-col cols="12" md="5" class="pa-3">
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
        </v-col>
        <v-col cols="12" md="4" class="pa-3">
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
        </v-col>
        <v-col cols="12" md="3" class="pa-3">
          <v-btn
            size="large"
            block
            :loading="loading"
            @click="searchFresh"
            elevation="0"
            class="text-none font-weight-medium search-btn"
          >
            <v-icon start>mdi-magnify</v-icon>
            Suchen
          </v-btn>
        </v-col>
      </v-row>
    </div>

    <!-- Error -->
    <v-alert v-if="error" type="error" variant="tonal" class="mb-6" rounded="lg">
      {{ error }}
    </v-alert>

    <!-- Results -->
    <div v-if="searched && !loading">
      <div class="d-flex align-center justify-space-between mb-4 px-1">
        <span class="text-body-2 font-weight-medium" style="color: #374151">
          {{ totalHits.toLocaleString('de-AT') }} Ergebnis{{ totalHits !== 1 ? 'se' : '' }}
        </span>
        <span class="text-body-2" style="color: #9ca3af">
          {{ categoryLabel }} · {{ timeframeLabel }}
        </span>
      </div>

      <!-- Empty state -->
      <div v-if="results.length === 0" class="empty-state">
        <v-icon size="56" color="#d1d5db" class="mb-4">mdi-file-search-outline</v-icon>
        <p class="text-body-1" style="color: #9ca3af">
          Keine Ergebnisse für die gewählten Filter.
        </p>
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
          <div class="result-icon" style="background: rgba(0,121,147,0.08)">
            <v-icon color="#007993" size="18">mdi-scale-balance</v-icon>
          </div>
          <div class="result-body">
            <div class="result-title">{{ item.title }}</div>
            <div
              v-if="item.long_title && item.long_title !== item.title"
              class="result-subtitle"
            >
              {{ item.long_title }}
            </div>
            <div class="result-meta">
              <span v-if="item.typ" class="meta-chip meta-chip-primary">{{ item.typ }}</span>
              <span v-if="item.artikel" class="meta-chip meta-chip-accent">{{ item.artikel }}</span>
              <span v-if="item.date" class="meta-text">{{ formatDate(item.date) }}</span>
              <span v-if="item.bgbl" class="meta-text">· {{ item.bgbl }}</span>
            </div>
          </div>
          <v-icon size="14" color="#d1d5db" class="ml-2 mt-1 flex-shrink-0">mdi-open-in-new</v-icon>
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
          <div class="result-icon" style="background: rgba(239,96,7,0.08)">
            <v-icon color="#ef6007" size="18">mdi-gavel</v-icon>
          </div>
          <div class="result-body">
            <div class="result-title">{{ item.title }}</div>
            <div v-if="item.normen" class="result-subtitle">
              Normen: {{ item.normen }}
            </div>
            <div class="result-meta">
              <span class="meta-chip meta-chip-primary">{{ item.court }}</span>
              <span v-if="item.case_number" class="meta-chip meta-chip-accent">{{ item.case_number }}</span>
              <span v-if="item.date" class="meta-text">{{ formatDate(item.date) }}</span>
            </div>
          </div>
          <v-icon size="14" color="#d1d5db" class="ml-2 mt-1 flex-shrink-0">mdi-open-in-new</v-icon>
        </a>
      </template>

      <!-- Pagination -->
      <div v-if="totalHits > 20" class="d-flex justify-center mt-8">
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

    <!-- Footer disclaimer (aissociate style) -->
    <div class="text-center mt-10 mb-4">
      <p class="text-caption" style="color: #d1d5db">
        Daten aus dem Rechtsinformationssystem des Bundes (RIS)
      </p>
    </div>
  </v-container>
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
  // Check if logo exists
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
/* Document type toggle - aissociate "Quellen/Verlauf" style */
.doc-toggle-wrap {
  display: inline-flex;
  border-radius: 999px;
  border: 1px solid #e5e7eb;
  background: white;
  overflow: hidden;
}

.doc-toggle-btn {
  display: inline-flex;
  align-items: center;
  padding: 8px 24px;
  font-size: 14px;
  font-weight: 500;
  color: #6b7280;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}

.doc-toggle-active {
  background: #ef6007;
  color: white;
  border-radius: 999px;
}

.doc-toggle-btn:not(.doc-toggle-active):hover {
  color: #374151;
  background: #f3f4f6;
}

/* Filter card */
.filter-card {
  background: white;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.03);
}

/* Search button - apricot style */
.search-btn {
  background: #ef6007 !important;
  color: white !important;
}
.search-btn:hover {
  background: #c64708 !important;
}

/* Result cards - clean aissociate style */
.result-card {
  display: flex;
  align-items: flex-start;
  padding: 16px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  margin-bottom: 10px;
  text-decoration: none;
  color: inherit;
  transition: all 0.15s ease;
  cursor: pointer;
}

.result-card:hover {
  border-color: #007993;
  box-shadow: 0 4px 6px -1px rgba(0, 121, 147, 0.08);
}

.result-icon {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  margin-top: 2px;
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
  line-height: 1.4;
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

.meta-chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
}

.meta-chip-primary {
  background: rgba(0, 121, 147, 0.08);
  color: #007993;
}

.meta-chip-accent {
  background: rgba(239, 96, 7, 0.08);
  color: #ef6007;
}

.meta-text {
  font-size: 12px;
  color: #9ca3af;
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 48px 16px;
  background: white;
  border: 1px dashed #e5e7eb;
  border-radius: 12px;
}
</style>
