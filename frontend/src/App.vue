<template>
  <v-app>
    <!-- Thin sidebar with logo -->
    <div class="sidebar">
      <router-link to="/" class="sidebar-logo">
        <img src="/logo-white.svg" alt="AI:ssociate" />
      </router-link>
      <div class="sidebar-glow"></div>
    </div>

    <div class="app-main">
      <router-view />
    </div>
  </v-app>
</template>

<script setup>
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

:root {
  --teal: #007993;
  --teal-dark: #005f73;
  --teal-light: #e0f4f8;
  --orange: #ef6007;
  --orange-light: #fff3ec;
  --navy: #052e31;
  --navy-mid: #0a3d42;
  --bg: #f6f8fa;
  --card: #ffffff;
  --text: #1a2332;
  --text-secondary: #5f6d7e;
  --border: #e3e8ef;
  --radius: 14px;
  --shadow-sm: 0 1px 3px rgba(0,40,50,0.04);
  --shadow-md: 0 4px 16px rgba(0,40,50,0.06);
  --shadow-lg: 0 8px 32px rgba(0,40,50,0.08);
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: var(--bg);
  color: var(--text);
}

.v-application {
  font-family: 'Inter', -apple-system, sans-serif !important;
}

/* ── Sidebar ── */
.sidebar {
  position: fixed;
  left: 0; top: 0; bottom: 0;
  width: 60px;
  background: linear-gradient(180deg, var(--navy) 0%, var(--navy-mid) 100%);
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0;
  overflow: hidden;
}

.sidebar::after {
  content: '';
  position: absolute;
  right: 0; top: 0; bottom: 0;
  width: 1px;
  background: linear-gradient(180deg, rgba(0,121,147,0.3) 0%, rgba(0,121,147,0.05) 100%);
}

.sidebar-glow {
  position: absolute;
  top: 20px; left: 50%;
  transform: translateX(-50%);
  width: 80px; height: 80px;
  background: radial-gradient(circle, rgba(0,121,147,0.15) 0%, transparent 70%);
  pointer-events: none;
  animation: pulse 4s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; transform: translateX(-50%) scale(1); }
  50% { opacity: 1; transform: translateX(-50%) scale(1.2); }
}

.sidebar-logo {
  position: relative;
  z-index: 1;
  display: block;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.sidebar-logo:hover { transform: scale(1.1); }
.sidebar-logo img { width: 40px; height: auto; }

/* ── Main ── */
.app-main {
  margin-left: 60px;
  min-height: 100vh;
  background: var(--bg);
}

.v-main { padding: 0 !important; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0,121,147,0.15); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(0,121,147,0.3); }

/* ── Global animations ── */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideIn {
  from { opacity: 0; transform: translateX(-8px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
</style>
