<template>
  <v-app>
    <!-- Navigation -->
    <v-app-bar v-if="authStore.isAuthenticated" elevation="0" class="app-bar-glass">
      <v-app-bar-nav-icon @click="drawer = !drawer" class="d-lg-none" />

      <v-toolbar-title class="d-flex align-center">
        <img :src="logoUrl" alt="LexWatch" class="app-logo mr-2" />
        <span class="text-h6 font-weight-bold">LexWatch</span>
        <v-chip size="x-small" color="accent" variant="flat" class="ml-2">AT</v-chip>
      </v-toolbar-title>

      <v-spacer />

      <!-- Notifications -->
      <v-btn icon @click="showNotifications = true" class="mr-1">
        <v-badge
          :content="notificationStore.unreadCount"
          :model-value="notificationStore.unreadCount > 0"
          color="error"
        >
          <v-icon>mdi-bell-outline</v-icon>
        </v-badge>
      </v-btn>

      <!-- Theme toggle -->
      <v-btn icon @click="toggleTheme">
        <v-icon>{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>

      <!-- User menu -->
      <v-menu>
        <template v-slot:activator="{ props }">
          <v-btn icon v-bind="props">
            <v-avatar color="primary" size="32">
              <span class="text-body-2">{{ userInitials }}</span>
            </v-avatar>
          </v-btn>
        </template>
        <v-list density="compact" min-width="200">
          <v-list-item prepend-icon="mdi-account" :title="authStore.user?.full_name || authStore.user?.email" />
          <v-divider />
          <v-list-item prepend-icon="mdi-cog" title="Profil & Interessen" @click="$router.push('/profile')" />
          <v-list-item prepend-icon="mdi-logout" title="Abmelden" @click="logout" />
        </v-list>
      </v-menu>
    </v-app-bar>

    <!-- Side navigation -->
    <v-navigation-drawer
      v-if="authStore.isAuthenticated"
      v-model="drawer"
      :rail="!mobile"
      :expand-on-hover="!mobile"
      :permanent="!mobile"
      class="nav-drawer-glass"
    >
      <v-list density="compact" nav>
        <v-list-item
          prepend-icon="mdi-view-dashboard"
          title="Dashboard"
          value="dashboard"
          to="/dashboard"
        />
        <v-list-item
          prepend-icon="mdi-star"
          title="Mein Feed"
          value="feed"
          to="/feed"
        />
        <v-list-item
          prepend-icon="mdi-magnify"
          title="Alle Änderungen"
          value="browse"
          to="/browse"
        />
        <v-list-item
          prepend-icon="mdi-account-cog"
          title="Profil & Interessen"
          value="profile"
          to="/profile"
        />
      </v-list>
    </v-navigation-drawer>

    <!-- Notification Drawer -->
    <v-navigation-drawer
      v-model="showNotifications"
      location="right"
      temporary
      width="420"
    >
      <NotificationPanel @close="showNotifications = false" />
    </v-navigation-drawer>

    <!-- Main Content -->
    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useDisplay, useTheme } from 'vuetify'
import { useAuthStore } from './stores/auth'
import { useNotificationStore } from './stores/notifications'
import NotificationPanel from './components/NotificationPanel.vue'
import logoUrl from './assets/logo.svg'

const authStore = useAuthStore()
const notificationStore = useNotificationStore()
const { mobile } = useDisplay()
const theme = useTheme()

const drawer = ref(true)
const showNotifications = ref(false)

const isDark = computed(() => theme.global.current.value.dark)

const userInitials = computed(() => {
  const name = authStore.user?.full_name || authStore.user?.email || ''
  return name.split(/[\s@]/).map(p => p[0]?.toUpperCase()).filter(Boolean).slice(0, 2).join('')
})

function toggleTheme() {
  theme.global.name.value = isDark.value ? 'lexwatchLight' : 'lexwatchDark'
}

function logout() {
  authStore.logout()
}

onMounted(() => {
  if (authStore.isAuthenticated) {
    notificationStore.fetchNotifications()
  }
})
</script>

<style>
.app-bar-glass {
  background: rgba(18, 24, 41, 0.8) !important;
  backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.nav-drawer-glass {
  background: rgba(18, 24, 41, 0.95) !important;
  border-right: 1px solid rgba(255, 255, 255, 0.06) !important;
}

.app-logo {
  height: 32px;
  width: 32px;
  flex-shrink: 0;
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}
</style>
