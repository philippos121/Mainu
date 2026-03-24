<template>
  <v-app>
    <v-app-bar elevation="0" class="app-bar-glass">
      <v-toolbar-title class="d-flex align-center">
        <v-icon color="primary" class="mr-2">mdi-scale-balance</v-icon>
        <span class="text-h6 font-weight-bold">RIS Tracker</span>
        <v-chip size="x-small" color="accent" variant="flat" class="ml-2">AT</v-chip>
      </v-toolbar-title>

      <v-spacer />

      <v-btn icon @click="toggleTheme">
        <v-icon>{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup>
import { computed } from 'vue'
import { useTheme } from 'vuetify'

const theme = useTheme()
const isDark = computed(() => theme.global.current.value.dark)

function toggleTheme() {
  theme.global.name.value = isDark.value ? 'risLight' : 'risDark'
}
</script>

<style>
.app-bar-glass {
  background: rgba(18, 24, 41, 0.8) !important;
  backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

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
