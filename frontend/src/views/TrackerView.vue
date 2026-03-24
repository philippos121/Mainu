<template>
  <v-container fluid class="pa-6 pa-md-10" style="max-width: 1100px">
    <!-- Header -->
    <div class="text-center mb-8">
      <div class="d-flex align-center justify-center mb-2">
        <span class="text-h4 font-weight-black" style="color: #0C7C7C">RIS</span>
        <span class="text-h4 font-weight-light text-grey-darken-2 ml-1">Tracker</span>
      </div>
      <p class="text-body-2 text-grey">
        Österreichische Rechtsänderungen durchsuchen
      </p>
    </div>

    <!-- Document Type Toggle -->
    <div class="d-flex justify-center mb-8">
      <v-btn-toggle
        v-model="docType"
        mandatory
        rounded="pill"
        density="comfortable"
        class="doc-type-toggle"
      >
        <v-btn value="gesetze" variant="text" class="px-6">
          <v-icon start size="18">mdi-scale-balance</v-icon>
          Gesetze
        </v-btn>
        <v-btn value="gerichtsentscheidungen" variant="text" class="px-6">
          <v-icon start size="18">mdi-gavel</v-icon>
          Entscheidungen
        </v-btn>
      </v-btn-toggle>
    </div>

    <!-- Filters -->
    <v-card variant="flat" class="mb-8 filter-card">
      <v-card-text class="pa-5">
        <v-row align="center">
          <v-col cols="12" md="5">
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
              color="primary"
              base-color="grey"
            />
          </v-col>
          <v-col cols="12" md="4">
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
              color="primary"
              base-color="grey"
            />
          </v-col>
          <v-col cols="12" md="3">
            <v-btn
              color="accent"
              size="large"
              block
              :loading="loading"
              @click="searchFresh"
              elevation="0"
              class="text-none font-weight-medium"
            >
              <v-icon start>mdi-magnify</v-icon>
              Suchen
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Error -->
    <v-alert v-if="error" type="error" variant="tonal" class="mb-6" rounded="lg">
      {{ error }}
    </v-alert>

    <!-- Results -->
    <div v-if="searched && !loading">
      <div class="d-flex align-center justify-space-between mb-4 px-1">
        <span class="text-body-2 text-grey-darken-1 font-weight-medium">
          {{ totalHits.toLocaleString('de-AT') }} Ergebnis{{ totalHits !== 1 ? 'se' : '' }}
        </span>
        <span class="text-body-2 text-grey">
          {{ categoryLabel }} · {{ timeframeLabel }}
        </span>
      </div>

      <!-- Empty state -->
      <v-card v-if="results.length === 0" variant="flat" class="pa-10 text-center empty-card">
        <v-icon size="56" color="grey-lighten-1" class="mb-4">mdi-file-search-outline</v-icon>
        <p class="text-body-1 text-grey">
          Keine Ergebnisse für die gewählten Filter.
        </p>
      </v-card>

      <!-- Gesetze Results -->
      <template v-if="docType === 'gesetze'">
        <v-card
          v-for="item in results"
          :key="item.id"
          :href="item.url"
          target="_blank"
          rel="noopener"
          variant="flat"
          class="result-card mb-3"
        >
          <v-card-text class="pa-4">
            <div class="d-flex align-start">
              <div class="result-icon mr-3 mt-1">
                <v-icon color="primary" size="20">mdi-scale-balance</v-icon>
              </div>
              <div class="flex-grow-1" style="min-width: 0">
                <div class="text-body-1 font-weight-medium text-grey-darken-4 result-title">
                  {{ item.title }}
                </div>
                <div
                  v-if="item.long_title && item.long_title !== item.title"
                  class="text-body-2 text-grey mt-1 result-subtitle"
                >
                  {{ item.long_title }}
                </div>
                <div class="mt-2 d-flex align-center flex-wrap ga-2">
                  <v-chip v-if="item.typ" size="x-small" color="primary" variant="tonal">
                    {{ item.typ }}
                  </v-chip>
                  <v-chip v-if="item.artikel" size="x-small" color="accent" variant="tonal">
                    {{ item.artikel }}
                  </v-chip>
                  <span v-if="item.date" class="text-caption text-grey">
                    {{ formatDate(item.date) }}
                  </span>
                  <span v-if="item.bgbl" class="text-caption text-grey">
                    · {{ item.bgbl }}
                  </span>
                </div>
              </div>
              <v-icon size="16" color="grey-lighten-1" class="ml-2 mt-1">mdi-open-in-new</v-icon>
            </div>
          </v-card-text>
        </v-card>
      </template>

      <!-- Gerichtsentscheidungen Results -->
      <template v-if="docType === 'gerichtsentscheidungen'">
        <v-card
          v-for="item in results"
          :key="item.id"
          :href="item.url"
          target="_blank"
          rel="noopener"
          variant="flat"
          class="result-card mb-3"
        >
          <v-card-text class="pa-4">
            <div class="d-flex align-start">
              <div class="result-icon mr-3 mt-1">
                <v-icon color="accent" size="20">mdi-gavel</v-icon>
              </div>
              <div class="flex-grow-1" style="min-width: 0">
                <div class="text-body-1 font-weight-medium text-grey-darken-4 result-title">
                  {{ item.title }}
                </div>
                <div v-if="item.normen" class="text-body-2 text-grey mt-1 result-subtitle">
                  Normen: {{ item.normen }}
                </div>
                <div class="mt-2 d-flex align-center flex-wrap ga-2">
                  <v-chip size="x-small" color="primary" variant="tonal">
                    {{ item.court }}
                  </v-chip>
                  <v-chip v-if="item.case_number" size="x-small" color="accent" variant="tonal">
                    {{ item.case_number }}
                  </v-chip>
                  <span v-if="item.date" class="text-caption text-grey">
                    {{ formatDate(item.date) }}
                  </span>
                </div>
              </div>
              <v-icon size="16" color="grey-lighten-1" class="ml-2 mt-1">mdi-open-in-new</v-icon>
            </div>
          </v-card-text>
        </v-card>
      </template>

      <!-- Pagination -->
      <div v-if="totalHits > 20" class="d-flex justify-center mt-8">
        <v-pagination
          v-model="page"
          :length="Math.ceil(totalHits / 20)"
          :total-visible="7"
          rounded="lg"
          active-color="primary"
          @update:model-value="search"
        />
      </div>
    </div>

    <!-- Footer disclaimer -->
    <div class="text-center mt-10 mb-4">
      <p class="text-caption text-grey-lighten-1">
        Daten aus dem Rechtsinformationssystem des Bundes (RIS)
      </p>
    </div>
  </v-container>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import api from '../services/api'

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
    if (dateStr.includes('T')) {
      dateStr = dateStr.split('T')[0]
    }
    if (dateStr.includes('-')) {
      const [y, m, d] = dateStr.split('-')
      return `${d}.${m}.${y}`
    }
    return dateStr
  } catch {
    return dateStr
  }
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

onMounted(() => {
  loadFilters()
})
</script>

<style scoped>
.doc-type-toggle {
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: white;
}

.doc-type-toggle .v-btn--active {
  background: #0C7C7C !important;
  color: white !important;
}

.filter-card {
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.result-card {
  border: 1px solid rgba(0, 0, 0, 0.06);
  transition: all 0.2s ease;
  cursor: pointer;
}

.result-card:hover {
  border-color: #0C7C7C;
  box-shadow: 0 2px 8px rgba(12, 124, 124, 0.1);
}

.result-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(12, 124, 124, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.result-title {
  line-height: 1.4;
}

.result-subtitle {
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.empty-card {
  border: 1px dashed rgba(0, 0, 0, 0.12);
}
</style>
