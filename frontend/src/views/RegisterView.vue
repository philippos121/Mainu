<template>
  <v-container fluid class="fill-height auth-bg">
    <v-row justify="center" align="center">
      <v-col cols="12" sm="8" md="5" lg="4" xl="3">
        <div class="text-center mb-8">
          <img :src="logoUrl" alt="ASSOCIATE" class="register-logo" />
          <p class="text-body-1 text-medium-emphasis mt-4">
            Konto erstellen
          </p>
        </div>

        <v-card class="pa-6 card-glass" elevation="0">
          <v-card-title class="text-h5 text-center pb-4">Registrieren</v-card-title>

          <v-alert v-if="authStore.error" type="error" variant="tonal" class="mb-4" closable>
            {{ authStore.error }}
          </v-alert>

          <v-form @submit.prevent="handleRegister" ref="formRef">
            <v-text-field
              v-model="fullName"
              label="Vollständiger Name"
              prepend-inner-icon="mdi-account-outline"
              variant="outlined"
              :rules="[rules.required]"
              class="mb-2"
            />
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
              :rules="[rules.required, rules.minLength]"
              class="mb-2"
            />
            <v-text-field
              v-model="passwordConfirm"
              label="Passwort bestätigen"
              :type="showPassword ? 'text' : 'password'"
              prepend-inner-icon="mdi-lock-check-outline"
              variant="outlined"
              :rules="[rules.required, rules.passwordMatch]"
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
              Registrieren
            </v-btn>
          </v-form>

          <div class="text-center">
            <span class="text-medium-emphasis">Bereits ein Konto?</span>
            <router-link to="/login" class="text-primary ml-1">Anmelden</router-link>
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
const fullName = ref('')
const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const showPassword = ref(false)
const formRef = ref(null)

const rules = {
  required: (v) => !!v || 'Pflichtfeld',
  email: (v) => /.+@.+\..+/.test(v) || 'Ungültige E-Mail-Adresse',
  minLength: (v) => v.length >= 8 || 'Mindestens 8 Zeichen',
  passwordMatch: (v) => v === password.value || 'Passwörter stimmen nicht überein',
}

async function handleRegister() {
  const { valid } = await formRef.value.validate()
  if (!valid) return
  try {
    await authStore.register(email.value, password.value, fullName.value)
  } catch {
    // Error handled by store
  }
}
</script>

<style scoped>
.auth-bg {
  background: radial-gradient(ellipse at 20% 50%, rgba(26, 35, 126, 0.3) 0%, transparent 60%),
    radial-gradient(ellipse at 80% 20%, rgba(13, 71, 161, 0.2) 0%, transparent 50%);
  min-height: 100vh;
}

.register-logo {
  height: auto;
  width: min(280px, 80%);
  filter: drop-shadow(0 4px 24px rgba(0, 121, 147, 0.3));
}

.card-glass {
  background: rgba(18, 24, 41, 0.6) !important;
  backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
</style>
