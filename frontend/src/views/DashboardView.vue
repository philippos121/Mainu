<template>
  <v-container fluid class="pa-6">
    <!-- Welcome header -->
    <div class="mb-6">
      <h1 class="text-h4 font-weight-bold">
        Guten {{ greeting }}, {{ authStore.user?.full_name?.split(' ')[0] || 'Benutzer' }}
      </h1>
      <p class="text-body-1 text-medium-emphasis mt-1">
        Hier ist Ihre Übersicht der aktuellen Rechtsänderungen und Urteile in Österreich.
      </p>
    </div>

    <!-- Stats cards -->
    <v-row class="mb-6">
      <v-col cols="12" sm="6" md="3">
        <v-card class="stat-card pa-4" elevation="0">
          <div class="d-flex align-center">
            <v-avatar color="primary" variant="tonal" size="48" class="mr-4">
              <v-icon>mdi-file-document-multiple</v-icon>
            </v-avatar>
            <div>
              <div class="text-h5 font-weight-bold">{{ stats.totalChanges }}</div>
              <div class="text-caption text-medium-emphasis">Einträge gesamt</div>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-card class="stat-card pa-4" elevation="0">
          <div class="d-flex align-center">
            <v-avatar color="accent" variant="tonal" size="48" class="mr-4">
              <v-icon>mdi-star</v-icon>
            </v-avatar>
            <div>
              <div class="text-h5 font-weight-bold">{{ stats.relevantChanges }}</div>
              <div class="text-caption text-medium-emphasis">Für Sie relevant</div>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-card class="stat-card pa-4" elevation="0">
          <div class="d-flex align-center">
            <v-avatar color="info" variant="tonal" size="48" class="mr-4">
              <v-icon>mdi-bell</v-icon>
            </v-avatar>
            <div>
              <div class="text-h5 font-weight-bold">{{ notificationStore.unreadCount }}</div>
              <div class="text-caption text-medium-emphasis">Ungelesen</div>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <v-card class="stat-card pa-4" elevation="0">
          <div class="d-flex align-center">
            <v-avatar color="success" variant="tonal" size="48" class="mr-4">
              <v-icon>mdi-bookmark-check</v-icon>
            </v-avatar>
            <div>
              <div class="text-h5 font-weight-bold">{{ (authStore.user?.interests || []).length }}</div>
              <div class="text-caption text-medium-emphasis">Interessen</div>
            </div>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <v-row>
      <!-- Recent changes -->
      <v-col cols="12" md="8">
        <v-card elevation="0" class="card-glass">
          <v-card-title class="d-flex align-center">
            <v-icon icon="mdi-clock-outline" class="mr-2" />
            Neueste Einträge
            <v-spacer />
            <v-btn variant="text" size="small" to="/browse" append-icon="mdi-arrow-right">
              Alle anzeigen
            </v-btn>
          </v-card-title>
          <v-card-text>
            <v-alert v-if="!loading && recentChanges.length === 0" type="info" variant="tonal">
              Noch keine Einträge vorhanden. Starten Sie einen Scan oder warten Sie auf den täglichen Import.
            </v-alert>

            <v-list v-else lines="three" class="bg-transparent">
              <template v-for="(change, i) in recentChanges" :key="change.id">
                <v-list-item
                  :to="`/law-change/${change.id}`"
                  class="rounded-lg mb-2 change-item"
                >
                  <template v-slot:prepend>
                    <v-avatar :color="change.law_type === 'Judikatur' ? 'warning' : 'primary'" variant="tonal" size="40">
                      <v-icon size="20">{{ change.law_type === 'Judikatur' ? 'mdi-gavel' : 'mdi-file-document' }}</v-icon>
                    </v-avatar>
                  </template>
                  <v-list-item-title class="font-weight-medium">
                    {{ change.short_title || change.title }}
                  </v-list-item-title>
                  <v-list-item-subtitle class="mt-1">
                    {{ change.ai_summary ? change.ai_summary.substring(0, 150) + '...' : change.content_snippet?.substring(0, 150) }}
                  </v-list-item-subtitle>
                  <template v-slot:append>
                    <div class="text-right">
                      <v-chip size="x-small" :color="change.law_type === 'Judikatur' ? 'warning' : 'primary'" variant="tonal" class="mb-1">
                        {{ change.law_type }}
                      </v-chip>
                      <div v-if="change.court_name" class="text-caption text-warning">
                        {{ change.court_name }}
                      </div>
                      <div class="text-caption text-medium-emphasis">
                        {{ formatDate(change.change_date) }}
                      </div>
                    </div>
                  </template>
                </v-list-item>
              </template>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Quick actions & interests -->
      <v-col cols="12" md="4">
        <v-card elevation="0" class="card-glass mb-4">
          <v-card-title>
            <v-icon icon="mdi-lightning-bolt" class="mr-2" />
            Schnellaktionen
          </v-card-title>
          <v-card-text>
            <v-btn
              color="primary"
              block
              variant="tonal"
              prepend-icon="mdi-magnify"
              class="mb-3"
              to="/browse"
            >
              Änderungen durchsuchen
            </v-btn>
            <v-btn
              color="accent"
              block
              variant="tonal"
              prepend-icon="mdi-star"
              class="mb-3"
              to="/feed"
            >
              Persönlicher Feed
            </v-btn>
            <v-btn
              color="info"
              block
              variant="tonal"
              prepend-icon="mdi-cog"
              to="/profile"
            >
              Interessen anpassen
            </v-btn>
          </v-card-text>
        </v-card>

        <v-card elevation="0" class="card-glass">
          <v-card-title>
            <v-icon icon="mdi-tag-multiple" class="mr-2" />
            Ihre Interessen
          </v-card-title>
          <v-card-text>
            <div v-if="(authStore.user?.interests || []).length === 0" class="text-medium-emphasis text-body-2">
              Sie haben noch keine Interessen ausgewählt.
              <router-link to="/profile" class="text-primary">Jetzt einrichten</router-link>
            </div>
            <div v-else>
              <v-chip
                v-for="interest in authStore.user.interests"
                :key="interest"
                color="primary"
                variant="tonal"
                size="small"
                class="ma-1"
              >
                {{ getCategoryLabel(interest) }}
              </v-chip>
            </div>

            <div v-if="(authStore.user?.keywords || []).length > 0" class="mt-3">
              <div class="text-caption text-medium-emphasis mb-1">Suchbegriffe:</div>
              <v-chip
                v-for="kw in authStore.user.keywords"
                :key="kw"
                color="accent"
                variant="tonal"
                size="small"
                class="ma-1"
              >
                {{ kw }}
              </v-chip>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useNotificationStore } from '../stores/notifications'
import api from '../services/api'

const authStore = useAuthStore()
const notificationStore = useNotificationStore()

const recentChanges = ref([])
const loading = ref(true)
const stats = ref({ totalChanges: 0, relevantChanges: 0 })
const categories = ref([])

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 12) return 'Morgen'
  if (h < 18) return 'Tag'
  return 'Abend'
})

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('de-AT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function getCategoryLabel(slug) {
  const cat = categories.value.find((c) => c.slug === slug)
  return cat?.label || slug
}

onMounted(async () => {
  try {
    const [changesRes, feedRes, catRes] = await Promise.all([
      api.get('/law-changes', { params: { page_size: 5 } }),
      api.get('/law-changes/my-feed', { params: { page_size: 5 } }),
      api.get('/law-changes/categories'),
    ])
    recentChanges.value = changesRes.data.items
    stats.value.totalChanges = changesRes.data.total
    stats.value.relevantChanges = feedRes.data.total
    categories.value = catRes.data
  } catch {
    // Ignore
  } finally {
    loading.value = false
  }
  notificationStore.fetchNotifications()
})
</script>

<style scoped>
.stat-card {
  background: rgba(18, 24, 41, 0.6) !important;
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: transform 0.2s, border-color 0.2s;
}
.stat-card:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.12);
}

.card-glass {
  background: rgba(18, 24, 41, 0.6) !important;
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.change-item {
  transition: background 0.2s;
}
.change-item:hover {
  background: rgba(255, 255, 255, 0.04);
}
</style>
