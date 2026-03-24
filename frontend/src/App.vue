<template>
  <v-app>
    <!-- Dark navy sidebar strip (aissociate-style) -->
    <v-navigation-drawer
      permanent
      rail
      class="sidebar-rail"
      style="background: #0f3d49"
    >
      <div class="d-flex flex-column align-center py-4" style="height: 100%">
        <!-- Logo area -->
        <div class="sidebar-logo mb-6">
          <img v-if="hasWhiteLogo" src="/logo-white.svg" alt="Logo" style="width: 28px; height: 28px" />
          <v-icon v-else color="#16a6c5" size="28">mdi-scale-balance</v-icon>
        </div>

        <!-- Nav icons -->
        <v-btn icon variant="text" size="small" class="mb-2 sidebar-icon" to="/">
          <v-icon color="white" size="20">mdi-magnify</v-icon>
          <v-tooltip activator="parent" location="end">Suche</v-tooltip>
        </v-btn>
        <v-btn icon variant="text" size="small" class="mb-2 sidebar-icon">
          <v-icon color="rgba(255,255,255,0.4)" size="20">mdi-file-document-outline</v-icon>
          <v-tooltip activator="parent" location="end">Gesetze</v-tooltip>
        </v-btn>
        <v-btn icon variant="text" size="small" class="mb-2 sidebar-icon">
          <v-icon color="rgba(255,255,255,0.4)" size="20">mdi-gavel</v-icon>
          <v-tooltip activator="parent" location="end">Entscheidungen</v-tooltip>
        </v-btn>

        <v-spacer />

        <v-btn icon variant="text" size="small" class="sidebar-icon">
          <v-icon color="rgba(255,255,255,0.4)" size="20">mdi-cog-outline</v-icon>
        </v-btn>
      </div>
    </v-navigation-drawer>

    <v-main class="main-content">
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const hasWhiteLogo = ref(false)

onMounted(() => {
  // Check if white logo exists
  const img = new Image()
  img.onload = () => { hasWhiteLogo.value = true }
  img.onerror = () => { hasWhiteLogo.value = false }
  img.src = '/logo-white.svg'
})
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');

/* Global font - IBM Plex Sans like aissociate */
body, .v-application {
  font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
}

.sidebar-rail {
  border-right: none !important;
}

.sidebar-logo {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sidebar-icon:hover {
  background: rgba(255, 255, 255, 0.08) !important;
}

.main-content {
  background: #F9FAFB !important;
}

/* Scrollbar matching aissociate */
::-webkit-scrollbar {
  width: 0.3rem;
}
::-webkit-scrollbar-track {
  background: #f1f1f1;
}
::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 0.3rem;
}
::-webkit-scrollbar-thumb:hover {
  background: #555;
}

/* Softer card borders */
.v-card--variant-outlined {
  border-color: rgba(0, 0, 0, 0.06) !important;
}
</style>
