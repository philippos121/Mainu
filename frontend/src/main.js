import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

import App from './App.vue'
import router from './router'

// Exact aissociate.at color palette
const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'aissociate',
    themes: {
      aissociate: {
        dark: false,
        colors: {
          primary: '#007993',         // navy-600
          secondary: '#0a5062',       // navy-800
          accent: '#ef6007',          // apricot-600
          background: '#F9FAFB',      // gray-50
          surface: '#FFFFFF',
          'surface-variant': '#f1fbfb', // navy-50
          error: '#d6313f',           // crimson-500
          success: '#008e4a',         // emerald-600
          warning: '#ef6007',         // apricot-600
          info: '#007993',            // navy-600
          'on-primary': '#FFFFFF',
          'on-secondary': '#FFFFFF',
          'on-accent': '#FFFFFF',
        },
      },
    },
  },
  defaults: {
    VBtn: { rounded: 'lg' },
    VCard: { rounded: 'lg' },
    VSelect: { rounded: 'lg' },
    VChip: { rounded: 'lg' },
  },
})

const app = createApp(App)
app.use(router)
app.use(vuetify)
app.mount('#app')
