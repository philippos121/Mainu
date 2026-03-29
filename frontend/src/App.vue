<template>
  <v-app>
    <header class="topbar">
      <router-link to="/" class="topbar-brand">
        <svg class="topbar-logo" viewBox="0 0 770 126" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M171.168 53.98H164.377V80.09H171.168Z" fill="white"/>
          <path d="M171.168 98.84H164.377V124.95H171.168Z" fill="white"/>
          <path d="M120.076 0H136.233V124.953H120.076Z" fill="white"/>
          <path d="M50.706 0H69.803L120.075 124.953H101.366Z" fill="white"/>
          <path d="M18.71 124.953H0L43.299 17.408L52.802 40.86Z" fill="white"/>
          <path d="M89.492 90.972H47.036L53.69 74.51H89.492Z" fill="white"/>
          <path d="M247.6 46.24V56.75C241.86 52.71 234.09 50.4 227.39 50.4C218.18 50.4 210.89 54.77 210.89 62.4C210.89 69.54 217.11 73.02 228.35 77.63C240.79 82.82 252.02 87.79 252.02 101.52C252.02 115.26 239.95 124.95 223.31 124.95C213.85 124.95 205.12 121.96 199.38 117.92V106.49C205.49 111.68 214.44 115.61 222.94 115.61C232.74 115.61 240.77 110.31 240.77 101.87C240.77 94.27 233.95 90.8 221.87 85.72C210.64 80.99 199.97 76.03 199.97 62.99C199.97 49.96 211.35 40.95 227.14 40.95C234.91 40.95 242.34 43.15 247.6 46.24Z" fill="white"/>
          <path d="M318.18 46.24V56.75C312.44 52.71 304.67 50.4 297.97 50.4C288.76 50.4 281.47 54.77 281.47 62.4C281.47 69.54 287.69 73.02 298.92 77.63C311.37 82.82 322.6 87.79 322.6 101.52C322.6 115.26 310.52 124.95 293.89 124.95C284.43 124.95 275.7 121.96 269.96 117.92V106.49C276.07 111.68 285.02 115.61 293.52 115.61C303.32 115.61 311.34 110.31 311.34 101.87C311.34 94.27 304.53 90.8 292.45 85.72C281.22 80.99 270.55 76.03 270.55 62.99C270.55 49.96 281.92 40.95 297.72 40.95C305.49 40.95 312.92 43.15 318.18 46.24Z" fill="white"/>
          <path d="M425.97 82.93C425.97 106.93 406.94 125.04 382.67 125.04C358.4 125.04 339.37 106.93 339.37 82.93C339.37 58.93 358.4 40.93 382.67 40.93C406.94 40.93 425.97 59.04 425.97 82.93ZM349.99 82.93C349.99 101.39 364.71 115.24 382.65 115.24C400.58 115.24 415.31 101.39 415.31 82.93C415.31 64.47 400.72 50.73 382.65 50.73C364.58 50.73 349.99 64.58 349.99 82.93Z" fill="white"/>
          <path d="M510.17 118.23C504.8 122.38 495.59 125.04 486.25 125.04C461.95 125.04 443.18 106.93 443.18 82.93C443.18 58.93 462.07 40.93 485.52 40.93C494.25 40.93 501.79 42.77 508.6 46.46V57.08C501.79 53.04 494.13 50.73 486.48 50.73C467.81 50.73 453.82 64.69 453.82 82.93C453.82 103 469.25 115.24 487.43 115.24C495.45 115.24 503.45 112.47 510.15 107.5V118.23H510.17Z" fill="white"/>
          <path d="M532.16 42.31H542.44V123.66H532.16Z" fill="white"/>
          <path d="M593.17 42.31H604.07L637.09 123.66H626.33L616.87 100.23H580.39L570.93 123.66H560.29L593.2 42.31H593.17ZM613.5 90.88L598.66 53.28L583.72 90.88Z" fill="white"/>
          <path d="M661.59 51.43H635.63V42.31H697.71V51.43H671.86V123.66H661.59Z" fill="white"/>
          <path d="M716.73 42.31H768.42V51.43H727.04V78.09H761.38V87.21H727.04V114.56H769.85V123.68H716.73Z" fill="white"/>
        </svg>
        <span class="topbar-title">Monitoring</span>
      </router-link>

      <!-- Logo marquee -->
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
  height: 56px;
  background: var(--navy);
  display: flex;
  align-items: center;
  padding: 0 24px;
  gap: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.topbar-brand {
  display: flex; align-items: center; gap: 10px;
  text-decoration: none;
  flex-shrink: 0;
  transition: opacity 0.2s;
}
.topbar-brand:hover { opacity: 0.85; }
.topbar-logo { height: 22px; width: 135px; display: block; }
.topbar-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--orange);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  margin-top: -12px;
  align-self: flex-start;
  padding-top: 6px;
  white-space: nowrap;
}

/* ── Marquee ── */
.marquee {
  flex: 1; overflow: hidden;
  mask-image: linear-gradient(90deg, transparent, white 10%, white 90%, transparent);
  -webkit-mask-image: linear-gradient(90deg, transparent, white 10%, white 90%, transparent);
}
.marquee-track {
  display: flex; align-items: center; gap: 64px;
  animation: scroll 40s linear infinite; width: max-content;
}
.marquee-track img {
  height: 24px; width: auto; max-width: 120px; object-fit: contain;
  opacity: 0.6; filter: brightness(0) invert(1);
  transition: opacity 0.3s; flex-shrink: 0;
}
.marquee:hover .marquee-track { animation-play-state: paused; }
.marquee-track img:hover { opacity: 1; }
@keyframes scroll { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }

/* ── Main ── */
.main { min-height: calc(100vh - 56px); }
.v-main { padding: 0 !important; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 3px; }

@keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
@keyframes fadeIn { from{opacity:0} to{opacity:1} }
</style>
