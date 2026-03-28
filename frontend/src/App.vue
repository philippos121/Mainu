<template>
  <v-app>
    <!-- Top bar -->
    <header class="topbar">
      <router-link to="/" class="topbar-brand">
        <img src="/logo-white.svg" alt="AI:ssociate" class="topbar-logo" />
        <span class="topbar-badge">Law Monitoring</span>
      </router-link>

      <!-- Logo marquee — replace SVGs with real PNGs in /public/logos/ -->
      <div class="marquee">
        <div class="marquee-track">
          <img src="/logos/bpp.svg" alt="bpp.law" />
          <img src="/logos/logo2.svg" alt="Partner" />
          <img src="/logos/fink.svg" alt="Fink+Partner" />
          <img src="/logos/flgoe.svg" alt="FLGÖ" />
          <img src="/logos/logo5.svg" alt="Partner" />
          <img src="/logos/bpp.svg" alt="bpp.law" />
          <img src="/logos/logo2.svg" alt="Partner" />
          <img src="/logos/fink.svg" alt="Fink+Partner" />
          <img src="/logos/flgoe.svg" alt="FLGÖ" />
          <img src="/logos/logo5.svg" alt="Partner" />
        </div>
      </div>
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
.topbar-brand {
  display: flex; align-items: center; gap: 12px;
  text-decoration: none;
  transition: opacity 0.2s;
}
.topbar-brand:hover { opacity: 0.85; }
.topbar-logo { height: 26px; width: auto; display: block; }
.topbar-badge {
  font-size: 11px; font-weight: 600;
  color: var(--orange);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin-top: -8px;
  align-self: flex-start;
  padding-top: 4px;
}

/* ── Logo Marquee ── */
.marquee {
  flex: 1;
  overflow: hidden;
  margin: 0 32px;
  mask-image: linear-gradient(90deg, transparent, white 10%, white 90%, transparent);
  -webkit-mask-image: linear-gradient(90deg, transparent, white 10%, white 90%, transparent);
}

.marquee-track {
  display: flex;
  align-items: center;
  gap: 48px;
  animation: scroll 25s linear infinite;
  width: max-content;
}

.marquee-track img {
  height: 28px;
  width: auto;
  opacity: 0.55;
  filter: brightness(0) invert(1);
  transition: opacity 0.3s;
  flex-shrink: 0;
}

.marquee-track img:hover {
  opacity: 0.9;
}

@keyframes scroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
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
