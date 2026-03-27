<template>
  <v-app>
    <!-- AI:SSOCIATE sidebar -->
    <div class="sidebar">
      <div class="sidebar-inner">
        <router-link to="/" class="sidebar-logo">
          <svg width="28" height="28" viewBox="0 0 172 126" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M171.168 53.9816H164.377V80.093H171.168V53.9816Z" fill="rgba(255,255,255,0.5)"/>
            <path d="M171.168 98.8412H164.377V124.953H171.168V98.8412Z" fill="rgba(255,255,255,0.5)"/>
            <path d="M120.076 0H136.233V124.953H120.076V0Z" fill="rgba(255,255,255,0.5)"/>
            <path d="M50.7057 0H69.8031L120.075 124.953H101.366L50.7057 0Z" fill="rgba(255,255,255,0.5)"/>
            <path d="M18.7097 124.953H0L43.2988 17.4076L52.802 40.8597L18.7097 124.953Z" fill="white"/>
            <path d="M89.4919 90.9724H47.0362L53.6905 74.5096H89.4919V90.9724Z" fill="rgba(255,255,255,0.5)"/>
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
