<template>
  <v-app>
    <!-- AI:SSOCIATE sidebar -->
    <div class="sidebar">
      <div class="sidebar-inner">
        <router-link to="/" class="sidebar-logo">
          <svg width="32" height="32" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="120" height="120" rx="24" fill="#007993"/>
            <text x="16" y="82" font-family="'IBM Plex Sans',sans-serif" font-weight="800" font-size="64" font-style="italic" fill="white">AI</text>
          </svg>
        </router-link>
        <router-link to="/" class="sidebar-link sidebar-link-active">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span class="sidebar-tooltip">Suche</span>
        </router-link>
      </div>
    </div>

    <div class="app-main">
      <router-view />
    </div>
  </v-app>
</template>

<script setup>
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');

*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: 'IBM Plex Sans', -apple-system, sans-serif; }
.v-application { font-family: 'IBM Plex Sans', -apple-system, sans-serif !important; }

/* ── Sidebar ── */
.sidebar {
  position: fixed;
  left: 0; top: 0; bottom: 0;
  width: 56px;
  background: #0a2e36;
  z-index: 100;
}

.sidebar-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 0;
  gap: 8px;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
  text-decoration: none;
  transition: transform 0.2s;
}
.sidebar-logo:hover { transform: scale(1.05); }

.sidebar-link {
  width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 12px;
  color: rgba(255,255,255,0.35);
  text-decoration: none;
  transition: all 0.15s;
  position: relative;
}
.sidebar-link:hover {
  color: rgba(255,255,255,0.8);
  background: rgba(255,255,255,0.06);
}
.sidebar-link-active {
  color: #ef6007;
  background: rgba(239,96,7,0.12);
}
.sidebar-link-active:hover {
  color: #ef6007;
  background: rgba(239,96,7,0.18);
}

.sidebar-tooltip {
  display: none;
  position: absolute;
  left: 52px;
  background: #1a1a1a;
  color: white;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
}
.sidebar-link:hover .sidebar-tooltip { display: block; }

/* ── Main ── */
.app-main {
  margin-left: 56px;
  min-height: 100vh;
  background: #f7f8fa;
}

.v-main { padding: 0 !important; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #c4c8cc; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #a0a4a8; }
</style>
