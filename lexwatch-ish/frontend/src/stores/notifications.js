import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../services/api'

export const useNotificationStore = defineStore('notifications', () => {
  const notifications = ref([])
  const unreadCount = ref(0)
  const loading = ref(false)

  async function fetchNotifications() {
    loading.value = true
    try {
      const { data } = await api.get('/law-changes/notifications/list')
      notifications.value = data.items
      unreadCount.value = data.unread_count
    } catch {
      // Ignore
    } finally {
      loading.value = false
    }
  }

  async function markRead(id) {
    await api.post(`/law-changes/notifications/${id}/read`)
    const n = notifications.value.find((n) => n.id === id)
    if (n && !n.is_read) {
      n.is_read = true
      unreadCount.value = Math.max(0, unreadCount.value - 1)
    }
  }

  async function markAllRead() {
    await api.post('/law-changes/notifications/read-all')
    notifications.value.forEach((n) => (n.is_read = true))
    unreadCount.value = 0
  }

  return { notifications, unreadCount, loading, fetchNotifications, markRead, markAllRead }
})
