<template>
  <v-container fluid class="pa-6">
    <h1 class="text-h4 font-weight-bold mb-2">
      <v-icon icon="mdi-magnify" class="mr-2" />
      Alle Rechtsänderungen
    </h1>
    <p class="text-body-1 text-medium-emphasis mb-6">
      Durchsuchen und filtern Sie sämtliche erfassten Änderungen der österreichischen Gesetzgebung.
    </p>

    <!-- Filters -->
    <v-card elevation="0" class="card-glass mb-6 pa-4">
      <v-row dense>
        <v-col cols="12" md="4">
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
        <v-col cols="12" md="3">
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

const changes = ref([])
const loading = ref(true)
const page = ref(1)
const total = ref(0)
const pageSize = 12
const search = ref('')
const selectedCategory = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const categories = ref([])

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
  dateFrom.value = ''
  dateTo.value = ''
  page.value = 1
  fetchChanges()
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
