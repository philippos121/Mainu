<template>
  <v-app>
    <!-- Top bar -->
    <header class="topbar">
      <router-link to="/" class="topbar-logo">
        <img src="/logo-white.svg" alt="AI:ssociate" />
      </router-link>
    </header>

    <main class="main">
      <router-view />
    </main>
  </v-app>
</template>

<script setup>
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

:root {
  --teal: #007993;
  --teal-dark: #005f73;
  --teal-50: #e8f6f9;
  --orange: #ef6007;
  --orange-50: #fff4ed;
  --navy: #0a5062;
  --bg: #f4f6f8;
  --card: #ffffff;
  --text: #111827;
  --muted: #6b7280;
  --border: #e5e7eb;
  --radius: 12px;
}

*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  font-family: 'Inter', -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
  background: var(--bg);
  color: var(--text);
}
.v-application { font-family: 'Inter', -apple-system, sans-serif !important; background: var(--bg) !important; }

/* ── Top bar ── */
.topbar {
  position: sticky; top: 0; z-index: 50;
  height: 64px;
  background: var(--navy);
  display: flex;
  align-items: center;
  padding: 0 32px;
  gap: 24px;
  box-shadow: 0 1px 0 rgba(0,121,147,0.2);
}
.topbar-logo {
  display: flex; align-items: center;
  text-decoration: none;
  transition: opacity 0.2s;
}
.topbar-logo:hover { opacity: 0.85; }
.topbar-logo img { height: 28px; width: auto; filter: brightness(0) invert(1); }
.topbar-tagline {
  font-size: 13px; font-weight: 500;
  color: rgba(255,255,255,0.45);
  letter-spacing: 0.5px;
}

/* ── Main ── */
.main {
  min-height: calc(100vh - 64px);
}
.v-main { padding: 0 !important; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 3px; }

/* ── Keyframes ── */
@keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
@keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
</style>
