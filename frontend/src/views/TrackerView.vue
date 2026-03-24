<template>
  <v-container fluid class="pa-4 pa-md-8" style="max-width: 1200px">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-h4 font-weight-bold mb-1">RIS Tracker</h1>
      <p class="text-body-2 text-medium-emphasis">
        Österreichische Rechtsänderungen durchsuchen
      </p>
    </div>

    <!-- Document Type Tabs -->
    <v-tabs v-model="docType" color="primary" class="mb-6">
      <v-tab value="gesetze">
        <v-icon start>mdi-scale-balance</v-icon>
        Gesetze &amp; Verordnungen
      </v-tab>
      <v-tab value="gerichtsentscheidungen">
        <v-icon start>mdi-gavel</v-icon>
        Gerichtsentscheidungen
      </v-tab>
    </v-tabs>

    <!-- Filters -->
    <v-card variant="outlined" class="mb-6">
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <v-select
              v-model="selectedCategory"
              :items="categories"
              item-title="label"
              item-value="index"
              label="Rechtsgebiet"
              variant="outlined"
              density="comfortable"
              clearable
              prepend-inner-icon="mdi-book-open-variant"
              placeholder="Alle Rechtsgebiete"
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
              prepend-inner-icon="mdi-calendar-range"
            />
          </v-col>
          <v-col cols="12" md="2" class="d-flex align-center">
            <v-btn
              color="primary"
              size="large"
              block
              :loading="loading"
              @click="search"
            >
              <v-icon start>mdi-magnify</v-icon>
              Suchen
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Results -->
    <div v-if="error" class="mb-4">
      <v-alert type="error" variant="tonal">{{ error }}</v-alert>
    </div>

    <div v-if="searched && !loading">
      <div class="d-flex align-center justify-space-between mb-4">
        <span class="text-body-2 text-medium-emphasis">
          {{ totalHits }} Ergebnis{{ totalHits !== 1 ? 'se' : '' }} gefunden
        </span>
        <span v-if="categoryLabel" class="text-body-2 text-medium-emphasis">
          {{ categoryLabel }} · {{ timeframeLabel }}
        </span>
      </div>

      <v-card v-if="results.length === 0" variant="outlined" class="pa-8 text-center">
        <v-icon size="48" color="medium-emphasis" class="mb-4">mdi-file-search-outline</v-icon>
        <p class="text-body-1 text-medium-emphasis">
          Keine Ergebnisse für die gewählten Filter.
        </p>
      </v-card>

      <!-- Gesetze Results -->
      <template v-if="docType === 'gesetze'">
        <v-list lines="three" class="bg-transparent">
          <v-list-item
            v-for="item in results"
            :key="item.id"
            :href="item.url"
            target="_blank"
            rel="noopener"
            class="result-item mb-2 rounded-lg"
          >
            <template v-slot:prepend>
              <v-icon color="primary" class="mt-1">mdi-scale-balance</v-icon>
            </template>
            <v-list-item-title class="font-weight-medium text-wrap">
              {{ item.title }}
            </v-list-item-title>
            <v-list-item-subtitle class="text-wrap mt-1">
              <span v-if="item.long_title && item.long_title !== item.title">
                {{ item.long_title }}
              </span>
            </v-list-item-subtitle>
            <v-list-item-subtitle class="mt-1">
              <v-chip v-if="item.typ" size="x-small" variant="tonal" class="mr-2">
                {{ item.typ }}
              </v-chip>
              <v-chip v-if="item.artikel" size="x-small" variant="tonal" color="secondary" class="mr-2">
                {{ item.artikel }}
              </v-chip>
              <span v-if="item.date" class="text-caption text-medium-emphasis">
                {{ formatDate(item.date) }}
              </span>
              <span v-if="item.bgbl" class="text-caption text-medium-emphasis ml-2">
                · {{ item.bgbl }}
              </span>
            </v-list-item-subtitle>
            <template v-slot:append>
              <v-icon size="small" color="medium-emphasis">mdi-open-in-new</v-icon>
            </template>
          </v-list-item>
        </v-list>
      </template>

      <!-- Gerichtsentscheidungen Results -->
      <template v-if="docType === 'gerichtsentscheidungen'">
        <v-list lines="three" class="bg-transparent">
          <v-list-item
            v-for="item in results"
            :key="item.id"
            :href="item.url"
            target="_blank"
            rel="noopener"
            class="result-item mb-2 rounded-lg"
          >
            <template v-slot:prepend>
              <v-icon color="secondary" class="mt-1">mdi-gavel</v-icon>
            </template>
            <v-list-item-title class="font-weight-medium text-wrap">
              {{ item.title }}
            </v-list-item-title>
            <v-list-item-subtitle class="text-wrap mt-1" v-if="item.normen">
              Normen: {{ item.normen }}
            </v-list-item-subtitle>
            <v-list-item-subtitle class="mt-1">
              <v-chip size="x-small" variant="tonal" color="secondary" class="mr-2">
                {{ item.court }}
              </v-chip>
              <v-chip v-if="item.case_number" size="x-small" variant="tonal" class="mr-2">
                {{ item.case_number }}
              </v-chip>
              <span v-if="item.date" class="text-caption text-medium-emphasis">
                {{ formatDate(item.date) }}
              </span>
            </v-list-item-subtitle>
            <template v-slot:append>
              <v-icon size="small" color="medium-emphasis">mdi-open-in-new</v-icon>
            </template>
          </v-list-item>
        </v-list>
      </template>

      <!-- Pagination -->
      <div v-if="totalHits > 20" class="d-flex justify-center mt-6">
        <v-pagination
          v-model="page"
          :length="Math.ceil(totalHits / 20)"
          :total-visible="7"
          rounded
          @update:model-value="search"
        />
      </div>
    </div>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
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

const categoryLabel = computed(() => {
  if (!selectedCategory.value) return 'Alle Rechtsgebiete'
  const cat = categories.value.find(c => c.index === selectedCategory.value)
  return cat ? cat.label : ''
})

const timeframeLabel = computed(() => {
  const tf = timeframes.value.find(t => t.value === selectedTimeframe.value)
  return tf ? tf.label : ''
})

function formatDate(dateStr) {
  if (!dateStr) return ''
  // Handle various formats: YYYY-MM-DD, YYYY-MM-DDTHH:MM:SS, DD.MM.YYYY
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
    params.index = selectedCategory.value
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
.result-item {
  border: 1px solid rgba(var(--v-border-color), 0.12);
  transition: background-color 0.15s;
}
.result-item:hover {
  background-color: rgba(var(--v-theme-primary), 0.05);
}
</style>
