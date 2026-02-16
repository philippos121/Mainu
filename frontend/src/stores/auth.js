import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../services/api'
import router from '../router'
import { useNotificationStore } from './notifications'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('lexwatch_token') || '')
  const user = ref(JSON.parse(localStorage.getItem('lexwatch_user') || 'null'))
  const loading = ref(false)
  const error = ref('')

  const isAuthenticated = computed(() => !!token.value)

  async function register(email, password, fullName) {
    loading.value = true
    error.value = ''
    try {
      const { data } = await api.post('/auth/register', {
        email,
        password,
        full_name: fullName,
      })
      token.value = data.access_token
      user.value = data.user
      localStorage.setItem('lexwatch_token', data.access_token)
      localStorage.setItem('lexwatch_user', JSON.stringify(data.user))
      router.push('/dashboard')
    } catch (err) {
      error.value = err.response?.data?.detail || 'Registrierung fehlgeschlagen.'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function login(email, password) {
    loading.value = true
    error.value = ''
    try {
      const { data } = await api.post('/auth/login', { email, password })
      token.value = data.access_token
      user.value = data.user
      localStorage.setItem('lexwatch_token', data.access_token)
      localStorage.setItem('lexwatch_user', JSON.stringify(data.user))
      router.push('/dashboard')
    } catch (err) {
      error.value = err.response?.data?.detail || 'Anmeldung fehlgeschlagen.'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchProfile() {
    try {
      const { data } = await api.get('/users/me')
      user.value = data
      localStorage.setItem('lexwatch_user', JSON.stringify(data))
    } catch {
      // Ignore
    }
  }

  async function updateProfile(updates) {
    const { data } = await api.patch('/users/me', updates)
    user.value = data
    localStorage.setItem('lexwatch_user', JSON.stringify(data))
    return data
  }

  function logout() {
    token.value = ''
    user.value = null
    localStorage.removeItem('lexwatch_token')
    localStorage.removeItem('lexwatch_user')
    useNotificationStore().$reset()
    router.push('/login')
  }

  return { token, user, loading, error, isAuthenticated, register, login, fetchProfile, updateProfile, logout }
})
