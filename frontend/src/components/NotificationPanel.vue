<template>
  <div class="pa-4">
    <div class="d-flex align-center mb-4">
      <h2 class="text-h6">Benachrichtigungen</h2>
      <v-spacer />
      <v-btn
        v-if="store.unreadCount > 0"
        variant="text"
        size="small"
        @click="store.markAllRead()"
      >
        Alle gelesen
      </v-btn>
      <v-btn icon variant="text" size="small" @click="$emit('close')">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </div>

    <v-progress-linear v-if="store.loading" indeterminate color="primary" class="mb-4" />

    <div v-if="store.notifications.length === 0" class="text-center py-8">
      <v-icon icon="mdi-bell-check-outline" size="64" color="grey" />
      <p class="text-body-1 text-medium-emphasis mt-4">Keine Benachrichtigungen</p>
    </div>

    <v-list lines="three" class="bg-transparent">
      <v-list-item
        v-for="notif in store.notifications"
        :key="notif.id"
        :class="{ 'notification-unread': !notif.is_read }"
        class="rounded-lg mb-2"
        @click="handleClick(notif)"
      >
        <template v-slot:prepend>
          <v-avatar :color="notif.is_read ? 'grey' : 'primary'" variant="tonal" size="36">
            <v-icon size="18">{{ notif.is_read ? 'mdi-check' : 'mdi-gavel' }}</v-icon>
          </v-avatar>
        </template>

        <v-list-item-title class="text-body-2 font-weight-medium">
          {{ notif.title }}
        </v-list-item-title>
        <v-list-item-subtitle class="text-caption mt-1">
          {{ notif.summary?.substring(0, 120) }}{{ notif.summary?.length > 120 ? '...' : '' }}
        </v-list-item-subtitle>
        <v-list-item-subtitle class="text-caption text-medium-emphasis mt-1">
          {{ formatTimeAgo(notif.created_at) }}
        </v-list-item-subtitle>
      </v-list-item>
    </v-list>
  </div>
</template>

<script setup>
import { useNotificationStore } from '../stores/notifications'
import { useRouter } from 'vue-router'

const store = useNotificationStore()
const router = useRouter()

defineEmits(['close'])

function handleClick(notif) {
  if (!notif.is_read) {
    store.markRead(notif.id)
  }
  router.push(`/law-change/${notif.law_change_id}`)
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `vor ${minutes} Min.`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `vor ${hours} Std.`
  const days = Math.floor(hours / 24)
  return `vor ${days} Tag${days > 1 ? 'en' : ''}`
}
</script>

<style scoped>
.notification-unread {
  background: rgba(92, 107, 192, 0.08);
  border-left: 3px solid rgb(92, 107, 192);
}
</style>
