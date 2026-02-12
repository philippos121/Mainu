import { createApp } from 'vue'
import { createPinia } from 'pinia'
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
    defaultTheme: 'lexwatchDark',
    themes: {
      lexwatchLight: {
        dark: false,
        colors: {
          primary: '#1a237e',
          secondary: '#0d47a1',
          accent: '#ff6f00',
          background: '#f5f5f5',
          surface: '#ffffff',
          error: '#c62828',
          success: '#2e7d32',
          warning: '#f57f17',
          info: '#0277bd',
        },
      },
      lexwatchDark: {
        dark: true,
        colors: {
          primary: '#5c6bc0',
          secondary: '#42a5f5',
          accent: '#ffab00',
          background: '#0a0e1a',
          surface: '#121829',
          'surface-variant': '#1a2035',
          error: '#ef5350',
          success: '#66bb6a',
          warning: '#ffa726',
          info: '#29b6f6',
        },
      },
    },
  },
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(vuetify)
app.mount('#app')
