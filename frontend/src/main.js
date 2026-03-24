import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

import App from './App.vue'
import router from './router'

const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'aissociate',
    themes: {
      aissociate: {
        dark: false,
        colors: {
          primary: '#0C7C7C',
          secondary: '#1E2A3A',
          accent: '#E8742A',
          background: '#F5F6F8',
          surface: '#FFFFFF',
          'surface-variant': '#F0F1F3',
          error: '#C62828',
          success: '#2E7D32',
          warning: '#E8742A',
          info: '#0C7C7C',
          'on-primary': '#FFFFFF',
          'on-secondary': '#FFFFFF',
          'on-accent': '#FFFFFF',
        },
      },
    },
  },
  defaults: {
    VBtn: {
      rounded: 'lg',
    },
    VCard: {
      rounded: 'lg',
    },
    VSelect: {
      rounded: 'lg',
    },
    VChip: {
      rounded: 'lg',
    },
  },
})

const app = createApp(App)
app.use(router)
app.use(vuetify)
app.mount('#app')
