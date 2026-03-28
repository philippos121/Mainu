<template>
  <v-app>
    <!-- Minimal sidebar with logo only -->
    <div class="sidebar">
      <router-link to="/" class="sidebar-logo">
        <img src="/logo-white.svg" alt="AI:ssociate" class="sidebar-logo-img" />
      </router-link>
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

*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: 'Inter', -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
.v-application { font-family: 'Inter', -apple-system, sans-serif !important; }

.sidebar {
  position: fixed; left: 0; top: 0; bottom: 0;
  width: 56px;
  background: linear-gradient(180deg, #052e31 0%, #0a3d42 100%);
  z-index: 100;
  display: flex; flex-direction: column; align-items: center;
  padding: 16px 0;
  border-right: 1px solid rgba(0,121,147,0.15);
}

.sidebar-logo {
  display: block; text-decoration: none;
  transition: transform 0.2s, opacity 0.2s;
  opacity: 0.85;
}
.sidebar-logo:hover { transform: scale(1.08); opacity: 1; }
.sidebar-logo-img { width: 36px; height: auto; }

.app-main {
  margin-left: 56px;
  min-height: 100vh;
  background: linear-gradient(135deg, #f8fafa 0%, #f0f4f5 100%);
}

.v-main { padding: 0 !important; }

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0,121,147,0.2); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(0,121,147,0.4); }
</style>
