<template>
  <v-app>
    <!-- Dark navy sidebar strip -->
    <v-navigation-drawer
      permanent
      rail
      color="secondary"
      class="sidebar-rail"
    >
      <div class="d-flex flex-column align-center py-4" style="height: 100%">
        <!-- Logo -->
        <div class="sidebar-logo mb-6">
          <span class="text-h5 font-weight-black" style="color: #0C7C7C">R</span>
        </div>

        <!-- Nav icons -->
        <v-btn icon variant="text" size="small" class="mb-2 sidebar-icon" to="/">
          <v-icon color="white" size="20">mdi-scale-balance</v-icon>
        </v-btn>
        <v-btn icon variant="text" size="small" class="mb-2 sidebar-icon">
          <v-icon color="rgba(255,255,255,0.5)" size="20">mdi-file-document-outline</v-icon>
        </v-btn>
        <v-btn icon variant="text" size="small" class="mb-2 sidebar-icon">
          <v-icon color="rgba(255,255,255,0.5)" size="20">mdi-gavel</v-icon>
        </v-btn>

        <v-spacer />

        <v-btn icon variant="text" size="small" class="sidebar-icon">
          <v-icon color="rgba(255,255,255,0.5)" size="20">mdi-cog-outline</v-icon>
        </v-btn>
      </div>
    </v-navigation-drawer>

    <v-main class="main-content">
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup>
</script>

<style>
/* Global styles matching aissociate.at aesthetic */
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
  background: #F5F6F8 !important;
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
}

/* Override Vuetify card borders to be softer */
.v-card--variant-outlined {
  border-color: rgba(0, 0, 0, 0.08) !important;
}
</style>
