<template>
  <v-container fluid class="pa-6">
    <div class="d-flex align-center mb-2">
      <h1 class="text-h4 font-weight-bold">
        <v-icon icon="mdi-bell-outline" class="mr-2" />
        Tägliche Updates
      </h1>
      <v-spacer />
      <v-btn
        v-if="store.unreadCount > 0"
        variant="tonal"
        color="primary"
        size="small"
        prepend-icon="mdi-check-all"
        @click="markAllRead"
      >
        Alle gelesen
      </v-btn>
    </div>
    <p class="text-body-1 text-medium-emphasis mb-6">
      Neue Rechtsänderungen und Urteile passend zu Ihren Interessen — chronologisch gruppiert.
    </p>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <v-alert v-if="!loading && notifications.length === 0" type="info" variant="tonal" class="mb-4">
      Keine Updates vorhanden. Richten Sie Ihre
      <router-link to="/profile" class="text-primary">Interessen</router-link>
      ein und starten Sie einen Scan, um benachrichtigt zu werden.
    </v-alert>

    <!-- Grouped by date -->
    <div v-for="group in groupedByDate" :key="group.date" class="mb-6">
      <div class="text-subtitle-1 font-weight-bold text-medium-emphasis mb-3">
        {{ formatDateHeader(group.date) }}
        <v-chip size="x-small" color="primary" variant="tonal" class="ml-2">
          {{ group.items.length }}
        </v-chip>
      </div>

      <v-card elevation="0" class="card-glass">
        <v-list lines="three" class="bg-transparent">
          <template v-for="(notif, i) in group.items" :key="notif.id">
            <v-divider v-if="i > 0" />
            <v-list-item
              :class="{ 'notification-unread': !notif.is_read }"
              class="rounded-lg"
              @click="handleClick(notif)"
            >
              <template v-slot:prepend>
                <v-avatar :color="notif.is_read ? 'grey' : 'primary'" variant="tonal" size="40">
                  <v-icon size="20">{{ notif.is_read ? 'mdi-check' : 'mdi-gavel' }}</v-icon>
                </v-avatar>
              </template>

              <v-list-item-title class="text-body-2 font-weight-medium">
                {{ notif.title }}
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption mt-1" style="white-space: normal;">
                {{ notif.summary?.substring(0, 200) }}{{ notif.summary?.length > 200 ? '...' : '' }}
              </v-list-item-subtitle>
              <v-list-item-subtitle class="text-caption text-medium-emphasis mt-1">
                {{ formatTime(notif.created_at) }}
              </v-list-item-subtitle>
            </v-list-item>
          </template>
        </v-list>
      </v-card>
    </div>

    <!-- Load more -->
    <div v-if="hasMore" class="d-flex justify-center mt-4">
      <v-btn variant="tonal" color="primary" :loading="loadingMore" @click="loadMore">
        Ältere Updates laden
      </v-btn>
    </div>

    <div class="text-center text-medium-emphasis text-caption mt-4">
      {{ notifications.length }} von {{ total }} Updates geladen
    </div>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useNotificationStore } from '../stores/notifications'
import api from '../services/api'

const store = useNotificationStore()
const router = useRouter()

const notifications = ref([])
const loading = ref(true)
const loadingMore = ref(false)
const page = ref(1)
const total = ref(0)
const pageSize = 50

const hasMore = computed(() => notifications.value.length < total.value)

const groupedByDate = computed(() => {
  const groups = {}
  for (const notif of notifications.value) {
    const d = new Date(notif.created_at).toISOString().slice(0, 10)
    if (!groups[d]) groups[d] = { date: d, items: [] }
    groups[d].items.push(notif)
  }
  // Sort by date descending
  return Object.values(groups).sort((a, b) => b.date.localeCompare(a.date))
})

async function fetchNotifications(pageNum = 1) {
  try {
    const { data } = await api.get('/law-changes/notifications/list', {
      params: { page: pageNum, page_size: pageSize },
    })
    if (pageNum === 1) {
      notifications.value = data.items
    } else {
      notifications.value.push(...data.items)
    }
    total.value = data.total
  } catch {
    // Ignore
  }
}

async function loadMore() {
  loadingMore.value = true
  page.value += 1
  await fetchNotifications(page.value)
  loadingMore.value = false
}

async function markAllRead() {
  await store.markAllRead()
  notifications.value.forEach((n) => (n.is_read = true))
}

function handleClick(notif) {
  if (!notif.is_read) {
    store.markRead(notif.id)
    notif.is_read = true
  }
  router.push(`/law-change/${notif.law_change_id}`)
}

function formatDateHeader(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  if (dateStr === today) return 'Heute'
  if (dateStr === yesterday) return 'Gestern'
  return d.toLocaleDateString('de-AT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
}

function formatTime(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
}

onMounted(async () => {
  await fetchNotifications(1)
  loading.value = false
  // Also refresh the store for the badge count
  store.fetchNotifications()
})
</script>

<style scoped>
.card-glass {
  background: rgba(18, 24, 41, 0.6) !important;
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.notification-unread {
  background: rgba(92, 107, 192, 0.08);
  border-left: 3px solid rgb(92, 107, 192);
}
</style>
