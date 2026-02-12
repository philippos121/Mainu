<template>
  <v-container fluid class="pa-6">
    <div class="d-flex align-center mb-6">
      <div>
        <h1 class="text-h4 font-weight-bold">
          <v-icon icon="mdi-star" color="accent" class="mr-2" />
          Mein Feed
        </h1>
        <p class="text-body-1 text-medium-emphasis mt-1">
          Rechtsänderungen basierend auf Ihren Interessen und Suchbegriffen.
        </p>
      </div>
      <v-spacer />
      <v-btn color="primary" variant="tonal" prepend-icon="mdi-cog" to="/profile">
        Interessen anpassen
      </v-btn>
    </div>

    <!-- Interest chips -->
    <div v-if="(authStore.user?.interests || []).length > 0 || (authStore.user?.keywords || []).length > 0" class="mb-4">
      <v-chip
        v-for="interest in authStore.user?.interests || []"
        :key="interest"
        color="primary"
        variant="tonal"
        size="small"
        class="ma-1"
        prepend-icon="mdi-tag"
      >
        {{ getCategoryLabel(interest) }}
      </v-chip>
      <v-chip
        v-for="kw in authStore.user?.keywords || []"
        :key="kw"
        color="accent"
        variant="tonal"
        size="small"
        class="ma-1"
        prepend-icon="mdi-text-search"
      >
        {{ kw }}
      </v-chip>
    </div>

    <v-alert
      v-if="!loading && !authStore.user?.interests?.length && !authStore.user?.keywords?.length"
      type="info"
      variant="tonal"
      class="mb-4"
    >
      Sie haben noch keine Interessen eingerichtet.
      <router-link to="/profile" class="text-primary font-weight-medium">Jetzt Interessen auswählen</router-link>,
      um Ihren personalisierten Feed zu aktivieren.
    </v-alert>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <!-- Feed items -->
    <v-row>
      <v-col v-for="change in changes" :key="change.id" cols="12" md="6" lg="4">
        <LawChangeCard :change="change" />
      </v-col>
    </v-row>

    <v-alert v-if="!loading && changes.length === 0 && (authStore.user?.interests?.length || authStore.user?.keywords?.length)" type="info" variant="tonal">
      Keine relevanten Änderungen gefunden. Neue Änderungen werden täglich importiert.
    </v-alert>

    <!-- Pagination -->
    <div v-if="totalPages > 1" class="d-flex justify-center mt-6">
      <v-pagination v-model="page" :length="totalPages" rounded="lg" />
    </div>
  </v-container>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import api from '../services/api'
import LawChangeCard from '../components/LawChangeCard.vue'

const authStore = useAuthStore()

const changes = ref([])
const loading = ref(true)
const page = ref(1)
const total = ref(0)
const pageSize = 12
const categories = ref([])

const totalPages = computed(() => Math.ceil(total.value / pageSize))

function getCategoryLabel(slug) {
  const cat = categories.value.find((c) => c.slug === slug)
  return cat?.label || slug
}

async function fetchFeed() {
  loading.value = true
  try {
    const { data } = await api.get('/law-changes/my-feed', {
      params: { page: page.value, page_size: pageSize },
    })
    changes.value = data.items
    total.value = data.total
  } catch {
    // Ignore
  } finally {
    loading.value = false
  }
}

watch(page, fetchFeed)

onMounted(async () => {
  const [_, catRes] = await Promise.all([fetchFeed(), api.get('/law-changes/categories')])
  categories.value = catRes.data
})
</script>
