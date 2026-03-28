<template>
  <v-app>
    <!-- Top bar -->
    <header class="topbar">
      <router-link to="/" class="topbar-brand">
        <img src="/logo-white.svg" alt="AI:ssociate" class="topbar-logo" />
      </router-link>

      <!-- Logo marquee — only shows if logo files exist in /public/ -->
      <div v-if="partnerLogos.length" class="marquee">
        <div class="marquee-track">
          <template v-for="(_, copy) in 2" :key="copy">
            <img v-for="logo in partnerLogos" :key="copy+'-'+logo.alt"
              :src="logo.src" :alt="logo.alt" @error="$event.target.style.display='none'" />
          </template>
        </div>
      </div>
    </header>

    <main class="main">
      <router-view />
    </main>
  </v-app>
</template>

<script setup>
const partnerLogos = [
  { src: '/logo_act_legal.svg', alt: 'act.legal' },
  { src: '/logo_buwog_color.svg', alt: 'BUWOG' },
  { src: '/logo_facc.svg', alt: 'FACC' },
  { src: '/logo_flgoe.png', alt: 'FLGÖ' },
  { src: '/logo_gpk.svg', alt: 'GPK' },
  { src: '/logo_grawe_color.svg', alt: 'GRAWE' },
  { src: '/logo_gsv.svg', alt: 'GSV' },
  { src: '/logo_hba_color.svg', alt: 'HBA' },
  { src: '/logo_heissenberger.png', alt: 'Heissenberger' },
  { src: '/logo_holding_graz.svg', alt: 'Holding Graz' },
  { src: '/logo_oerak_color.svg', alt: 'ÖRAK' },
  { src: '/logo_treubilanz.svg', alt: 'Treubilanz' },
  { src: '/logo_vav.svg', alt: 'VAV' },
  { src: '/logo_wsw.svg', alt: 'WSW' },
]
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
  flex-shrink: 0;
}
.topbar-brand:hover { opacity: 0.85; }
.topbar-logo { height: 26px; width: auto; min-width: 150px; display: block; }
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
  gap: 64px;
  animation: scroll 40s linear infinite;
  width: max-content;
}

.marquee-track img {
  height: 24px;
  width: auto;
  max-width: 120px;
  object-fit: contain;
  opacity: 0.6;
  filter: brightness(0) invert(1);
  transition: opacity 0.3s;
  flex-shrink: 0;
}

.marquee:hover .marquee-track {
  animation-play-state: paused;
}

.marquee-track img:hover {
  opacity: 1;
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
