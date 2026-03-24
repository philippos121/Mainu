<template>
  <v-app>
    <!-- Dark navy sidebar (aissociate-style icon strip) -->
    <div class="sidebar-strip">
      <div class="sidebar-inner">
        <!-- Logo -->
        <div class="sidebar-logo">
          <img v-if="hasWhiteLogo" src="/logo-white.svg" alt="Logo" class="sidebar-logo-img" />
          <span v-else class="sidebar-logo-text">AI</span>
        </div>

        <!-- Nav icons -->
        <div class="sidebar-nav">
          <router-link to="/" class="sidebar-btn sidebar-btn-active">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </router-link>
          <a class="sidebar-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
          </a>
          <a class="sidebar-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </a>
          <a class="sidebar-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
          </a>
          <a class="sidebar-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
            </svg>
          </a>
        </div>

        <div class="sidebar-spacer"></div>

        <!-- Bottom icons -->
        <div class="sidebar-nav">
          <a class="sidebar-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </a>
          <a class="sidebar-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 12 18.469c-.519 0-1.025.182-1.425.536l-.038.035a5.043 5.043 0 0 1-.874.56z"/>
            </svg>
          </a>
        </div>
      </div>
    </div>

    <div class="app-main">
      <router-view />
    </div>
  </v-app>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const hasWhiteLogo = ref(false)

onMounted(() => {
  const img = new Image()
  img.onload = () => { hasWhiteLogo.value = true }
  img.onerror = () => { hasWhiteLogo.value = false }
  img.src = '/logo-white.svg'
})
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');

*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.v-application {
  font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
}

/* ── Sidebar ── */
.sidebar-strip {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: 56px;
  background: #0f3d49;
  z-index: 100;
  display: flex;
  flex-direction: column;
}

.sidebar-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  padding: 16px 0;
}

.sidebar-logo {
  margin-bottom: 24px;
}

.sidebar-logo-img {
  width: 28px;
  height: 28px;
}

.sidebar-logo-text {
  font-size: 22px;
  font-weight: 800;
  color: #16a6c5;
  font-style: italic;
  letter-spacing: -1px;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.sidebar-spacer {
  flex: 1;
}

.sidebar-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.35);
  cursor: pointer;
  transition: all 0.15s;
  text-decoration: none;
}

.sidebar-btn:hover {
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.06);
}

.sidebar-btn-active {
  color: #ff9733;
  background: rgba(255, 151, 51, 0.1);
}

.sidebar-btn-active:hover {
  color: #ff9733;
  background: rgba(255, 151, 51, 0.15);
}

/* ── Main content area ── */
.app-main {
  margin-left: 56px;
  min-height: 100vh;
  background: #f9fafb;
}

/* Override Vuetify's main padding */
.v-main {
  padding: 0 !important;
}

/* ── Scrollbar ── */
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
</style>
