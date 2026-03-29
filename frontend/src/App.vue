<template>
  <v-app>
    <router-view />
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
  --orange: #ff9733;
  --orange-50: #fff8ed;
  --navy: #0a5062;
  --bg: #f4f6f8;
  --card: #ffffff;
  --text: #111827;
  --muted: #6b7280;
  --border: #e5e7eb;
  --radius: 12px;
}

*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  height: auto !important; min-height: 100vh;
  overflow-x: hidden; overflow-y: auto !important;
  -webkit-overflow-scrolling: touch;
  font-family: 'Inter', -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
  background: #070e12;
  color: var(--text);
}
.v-application { font-family: 'Inter', -apple-system, sans-serif !important; background: none !important; }
.v-application--wrap { min-height: 0 !important; }
.v-main { padding: 0 !important; min-height: 0 !important; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 3px; }

@keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
@keyframes fadeIn { from{opacity:0} to{opacity:1} }
</style>
