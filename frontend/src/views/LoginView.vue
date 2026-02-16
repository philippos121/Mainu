<template>
  <v-container fluid class="fill-height auth-bg">
    <v-row justify="center" align="center">
      <v-col cols="12" sm="8" md="5" lg="4" xl="3">
        <!-- Logo -->
        <div class="text-center mb-8">
          <img :src="logoUrl" alt="LexWatch" class="login-logo" />
          <h1 class="text-h3 font-weight-bold mt-4">LexWatch</h1>
          <p class="text-body-1 text-medium-emphasis mt-2">
            Österreichischer Rechtsänderungs-Tracker
          </p>
        </div>

        <v-card class="pa-6 card-glass" elevation="0">
          <v-card-title class="text-h5 text-center pb-4">Anmelden</v-card-title>

          <v-alert v-if="authStore.error" type="error" variant="tonal" class="mb-4" closable>
            {{ authStore.error }}
          </v-alert>

          <v-form @submit.prevent="handleLogin" ref="formRef">
            <v-text-field
              v-model="email"
              label="E-Mail"
              type="email"
              prepend-inner-icon="mdi-email-outline"
              variant="outlined"
              :rules="[rules.required, rules.email]"
              class="mb-2"
            />
            <v-text-field
              v-model="password"
              label="Passwort"
              :type="showPassword ? 'text' : 'password'"
              prepend-inner-icon="mdi-lock-outline"
              :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
              @click:append-inner="showPassword = !showPassword"
              variant="outlined"
              :rules="[rules.required]"
              class="mb-4"
            />

            <v-btn
              type="submit"
              color="primary"
              block
              size="large"
              :loading="authStore.loading"
              class="mb-4"
            >
              Anmelden
            </v-btn>
          </v-form>

          <div class="text-center">
            <span class="text-medium-emphasis">Noch kein Konto?</span>
            <router-link to="/register" class="text-primary ml-1">Registrieren</router-link>
          </div>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import logoUrl from '../assets/logo.svg'

const authStore = useAuthStore()
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const formRef = ref(null)

const rules = {
  required: (v) => !!v || 'Pflichtfeld',
  email: (v) => /.+@.+\..+/.test(v) || 'Ungültige E-Mail-Adresse',
}

async function handleLogin() {
  const { valid } = await formRef.value.validate()
  if (!valid) return
  try {
    await authStore.login(email.value, password.value)
  } catch {
    // Error is handled by store
  }
}
</script>

<style scoped>
.auth-bg {
  background: radial-gradient(ellipse at 20% 50%, rgba(26, 35, 126, 0.3) 0%, transparent 60%),
    radial-gradient(ellipse at 80% 20%, rgba(13, 71, 161, 0.2) 0%, transparent 50%);
  min-height: 100vh;
}

.login-logo {
  height: 80px;
  width: 80px;
  filter: drop-shadow(0 4px 24px rgba(92, 107, 192, 0.4));
}

.card-glass {
  background: rgba(18, 24, 41, 0.6) !important;
  backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
</style>
