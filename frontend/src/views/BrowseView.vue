<template>
  <v-container fluid class="pa-6">
    <h1 class="text-h4 font-weight-bold mb-2">
      <v-icon icon="mdi-magnify" class="mr-2" />
      Alle Rechtsänderungen & Urteile
    </h1>
    <p class="text-body-1 text-medium-emphasis mb-6">
      Durchsuchen und filtern Sie sämtliche erfassten Änderungen der österreichischen Gesetzgebung und Judikatur.
    </p>

    <!-- Filters -->
    <v-card elevation="0" class="card-glass mb-6 pa-4">
      <v-row dense>
        <v-col cols="12" md="3">
          <v-text-field
            v-model="search"
            label="Suche"
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            density="compact"
            clearable
            hide-details
            @update:model-value="debouncedFetch"
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-select
            v-model="selectedSourceType"
            :items="sourceTypes"
            item-title="label"
            item-value="value"
            label="Quellentyp"
            variant="outlined"
            density="compact"
            clearable
            hide-details
            @update:model-value="fetchChanges"
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-select
            v-model="selectedCategory"
            :items="categories"
            item-title="label"
            item-value="slug"
            label="Kategorie"
            variant="outlined"
            density="compact"
            clearable
            hide-details
            @update:model-value="fetchChanges"
          />
        </v-col>
        <v-col cols="6" md="2">
          <v-text-field
            v-model="dateFrom"
            label="Von"
            type="date"
            variant="outlined"
            density="compact"
            hide-details
            @update:model-value="fetchChanges"
          />
        </v-col>
        <v-col cols="6" md="2">
          <v-text-field
            v-model="dateTo"
            label="Bis"
            type="date"
            variant="outlined"
            density="compact"
            hide-details
            @update:model-value="fetchChanges"
          />
        </v-col>
        <v-col cols="12" md="1" class="d-flex align-center">
          <v-btn icon variant="tonal" @click="resetFilters">
            <v-icon>mdi-filter-remove</v-icon>
          </v-btn>
        </v-col>
      </v-row>
    </v-card>

    <!-- Historical Scan -->
    <v-card elevation="0" class="card-glass mb-6 pa-4">
      <div class="d-flex align-center mb-3">
        <v-icon icon="mdi-history" class="mr-2" />
        <span class="text-subtitle-1 font-weight-bold">Vergangene Daten scannen</span>
      </div>
      <v-row dense align="center">
        <v-col cols="12" md="2">
          <v-text-field
            v-model="scanDateFrom"
            label="Scan von"
            type="date"
            variant="outlined"
            density="compact"
            hide-details
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-text-field
            v-model="scanDateTo"
            label="Scan bis"
            type="date"
            variant="outlined"
            density="compact"
            hide-details
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-select
            v-model="scanSourceType"
            :items="scanSourceTypes"
            item-title="label"
            item-value="value"
            label="Was scannen"
            variant="outlined"
            density="compact"
            hide-details
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-select
            v-model="scanCategories"
            :items="rechtsgebiete"
            item-title="label"
            item-value="slug"
            label="Rechtsgebiete"
            variant="outlined"
            density="compact"
            multiple
            chips
            closable-chips
            clearable
            hide-details
            :disabled="scanSourceType === 'rulings'"
            :placeholder="scanCategories.length === 0 ? 'Alle Gebiete' : ''"
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-text-field
            v-model="scanKeywords"
            label="Suchbegriffe"
            variant="outlined"
            density="compact"
            hide-details
          />
        </v-col>
        <v-col cols="12" md="1">
          <v-btn
            color="primary"
            block
            :loading="scanning"
            :disabled="!scanDateFrom || !scanDateTo"
            prepend-icon="mdi-radar"
            @click="triggerScan"
          >
            Scan
          </v-btn>
        </v-col>
      </v-row>
      <div class="text-caption text-medium-emphasis mt-2">
        Hinweis: Rechtsgebiete-Filter gilt nur für Gesetze (Bundes-/Landesrecht).
        Für Gerichtsurteile wird immer alles im Zeitraum gescannt.
      </div>
      <v-alert v-if="scanResult" :type="scanResult.type" variant="tonal" class="mt-3" closable @click:close="scanResult = null">
        {{ scanResult.message }}
      </v-alert>
    </v-card>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <!-- Results -->
    <v-row>
      <v-col v-for="change in changes" :key="change.id" cols="12" md="6" lg="4">
        <LawChangeCard :change="change" />
      </v-col>
    </v-row>

    <v-alert v-if="!loading && changes.length === 0" type="info" variant="tonal" class="mt-4">
      Keine Ergebnisse gefunden. Versuchen Sie andere Suchbegriffe oder Filter.
    </v-alert>

    <!-- Pagination -->
    <div v-if="totalPages > 1" class="d-flex justify-center mt-6">
      <v-pagination v-model="page" :length="totalPages" rounded="lg" />
    </div>

    <div class="text-center text-medium-emphasis text-caption mt-4">
      {{ total }} Ergebnisse insgesamt
    </div>
  </v-container>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import api from '../services/api'
import LawChangeCard from '../components/LawChangeCard.vue'

// Default date range: last 30 days
function defaultDateFrom() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

const changes = ref([])
const loading = ref(true)
const page = ref(1)
const total = ref(0)
const pageSize = 12
const search = ref('')
const selectedCategory = ref('')
const selectedSourceType = ref('')
const dateFrom = ref(defaultDateFrom())
const dateTo = ref(todayStr())
const categories = ref([])

// Source type filter options
const sourceTypes = [
  { label: 'Bundesrecht', value: 'Bundesrecht' },
  { label: 'Landesrecht', value: 'Landesrecht' },
  { label: 'Judikatur', value: 'Judikatur' },
]

// Historical scan
const scanning = ref(false)
const scanDateFrom = ref('')
const scanDateTo = ref('')
const scanSourceType = ref('all')
const scanCategories = ref([])
const scanKeywords = ref('')
const scanResult = ref(null)

const scanSourceTypes = [
  { label: 'Alles', value: 'all' },
  { label: 'Nur Gesetze', value: 'laws' },
  { label: 'Nur Urteile', value: 'rulings' },
]

// Static Rechtsgebiete for scan filter (matches backend LEGAL_CATEGORIES)
const rechtsgebiete = [
  { slug: 'verfassungsrecht', label: 'Verfassungsrecht' },
  { slug: 'verwaltungsrecht_allgemein', label: 'Verwaltungsrecht – Allg. Teil' },
  { slug: 'aeusseres', label: 'Äußeres' },
  { slug: 'finanzrecht', label: 'Finanzrecht' },
  { slug: 'gesundheit', label: 'Gesundheit' },
  { slug: 'justiz', label: 'Justiz' },
  { slug: 'landesverteidigung', label: 'Landesverteidigung' },
  { slug: 'land_forstwirtschaft', label: 'Land- und Forstwirtschaft' },
  { slug: 'soziales', label: 'Soziales' },
  { slug: 'unterricht_kunst_kultur', label: 'Unterricht, Kunst und Kultur' },
  { slug: 'verkehr', label: 'Verkehr' },
  { slug: 'wirtschaft', label: 'Wirtschaft' },
  { slug: 'wissenschaft_forschung', label: 'Wissenschaft und Forschung' },
  { slug: 'arbeit', label: 'Arbeit' },
  { slug: 'umwelt', label: 'Umwelt' },
  { slug: 'sport', label: 'Sport' },
  { slug: 'buergerrecht', label: 'Bürgerrecht' },
  { slug: 'medien', label: 'Medien' },
  { slug: 'bauten', label: 'Bauten' },
  { slug: 'mietrecht', label: 'Mietrecht' },
  { slug: 'strafrecht', label: 'Strafrecht' },
  { slug: 'zivilrecht', label: 'Zivilrecht' },
  { slug: 'datenschutz', label: 'Datenschutz' },
  { slug: 'eu_recht', label: 'EU-Recht' },
]

const totalPages = computed(() => Math.ceil(total.value / pageSize))

let debounceTimer = null
function debouncedFetch() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(fetchChanges, 400)
}

async function fetchChanges() {
  loading.value = true
  try {
    const params = { page: page.value, page_size: pageSize }
    if (search.value) params.search = search.value
    if (selectedCategory.value) params.category = selectedCategory.value
    if (selectedSourceType.value) params.source_type = selectedSourceType.value
    if (dateFrom.value) params.date_from = dateFrom.value
    if (dateTo.value) params.date_to = dateTo.value

    const { data } = await api.get('/law-changes', { params })
    changes.value = data.items
    total.value = data.total
  } catch {
    // Ignore
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  search.value = ''
  selectedCategory.value = ''
  selectedSourceType.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  page.value = 1
  fetchChanges()
}

async function triggerScan() {
  scanning.value = true
  scanResult.value = null
  try {
    const params = {
      date_from: scanDateFrom.value,
      date_to: scanDateTo.value,
      source_type: scanSourceType.value,
    }
    if (scanCategories.value.length > 0) params.categories = scanCategories.value.join(',')
    if (scanKeywords.value) params.keywords = scanKeywords.value

    const { data } = await api.post('/law-changes/scan', null, { params, timeout: 300000 })
    scanResult.value = { type: data.errors?.length ? 'warning' : 'success', message: data.message }
    // Apply scan parameters as browse filters so only relevant results show
    search.value = scanKeywords.value || ''
    dateFrom.value = scanDateFrom.value
    dateTo.value = scanDateTo.value
    // Map scan source type to browse source type filter
    if (scanSourceType.value === 'laws') {
      selectedSourceType.value = 'Bundesrecht'
      // Only apply category filter for law scans (Rechtsgebiete doesn't apply to rulings)
      selectedCategory.value = scanCategories.value.length === 1 ? scanCategories.value[0] : ''
    } else if (scanSourceType.value === 'rulings') {
      selectedSourceType.value = 'Judikatur'
      selectedCategory.value = ''
    } else {
      selectedSourceType.value = ''
      selectedCategory.value = ''
    }
    page.value = 1
    await fetchChanges()
  } catch (e) {
    scanResult.value = { type: 'error', message: 'Scan fehlgeschlagen: ' + (e.response?.data?.detail || e.message) }
  } finally {
    scanning.value = false
  }
}

watch(page, fetchChanges)

onMounted(async () => {
  const [_, catRes] = await Promise.all([fetchChanges(), api.get('/law-changes/categories')])
  categories.value = catRes.data
})
</script>

<style scoped>
.card-glass {
  background: rgba(18, 24, 41, 0.6) !important;
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
</style>
