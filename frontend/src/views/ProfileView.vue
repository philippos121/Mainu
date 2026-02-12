<template>
  <v-container fluid class="pa-6">
    <h1 class="text-h4 font-weight-bold mb-2">
      <v-icon icon="mdi-account-cog" class="mr-2" />
      Profil & Interessen
    </h1>
    <p class="text-body-1 text-medium-emphasis mb-6">
      Passen Sie Ihr Profil an und wählen Sie Ihre Rechtsgebiete, um einen personalisierten Feed zu erhalten.
    </p>

    <v-row>
      <!-- Profile info -->
      <v-col cols="12" md="5">
        <v-card elevation="0" class="card-glass pa-6">
          <v-card-title class="px-0">
            <v-icon icon="mdi-account" class="mr-2" />
            Persönliche Daten
          </v-card-title>

          <v-alert v-if="saveSuccess" type="success" variant="tonal" class="mb-4" closable @click:close="saveSuccess = false">
            Profil erfolgreich gespeichert!
          </v-alert>

          <v-form @submit.prevent="saveProfile">
            <v-text-field
              v-model="profile.full_name"
              label="Vollständiger Name"
              prepend-inner-icon="mdi-account-outline"
              variant="outlined"
              class="mb-3"
            />

            <v-text-field
              :model-value="authStore.user?.email"
              label="E-Mail"
              prepend-inner-icon="mdi-email-outline"
              variant="outlined"
              disabled
              class="mb-3"
            />

            <v-switch
              v-model="profile.email_notifications"
              label="E-Mail-Benachrichtigungen"
              color="primary"
              inset
              class="mb-3"
            />

            <v-btn type="submit" color="primary" block :loading="saving">
              Profil speichern
            </v-btn>
          </v-form>
        </v-card>

        <!-- Keywords -->
        <v-card elevation="0" class="card-glass pa-6 mt-4">
          <v-card-title class="px-0">
            <v-icon icon="mdi-text-search" class="mr-2" />
            Suchbegriffe
          </v-card-title>
          <p class="text-body-2 text-medium-emphasis mb-3">
            Erhalten Sie Benachrichtigungen für Änderungen, die diese Begriffe enthalten.
          </p>

          <div class="d-flex mb-3">
            <v-text-field
              v-model="newKeyword"
              label="Neuer Begriff"
              variant="outlined"
              density="compact"
              hide-details
              @keyup.enter="addKeyword"
              class="mr-2"
            />
            <v-btn color="accent" variant="tonal" @click="addKeyword" :disabled="!newKeyword.trim()">
              <v-icon>mdi-plus</v-icon>
            </v-btn>
          </div>

          <div>
            <v-chip
              v-for="(kw, i) in profile.keywords"
              :key="kw"
              color="accent"
              variant="tonal"
              closable
              class="ma-1"
              @click:close="removeKeyword(i)"
            >
              {{ kw }}
            </v-chip>
            <span v-if="profile.keywords.length === 0" class="text-medium-emphasis text-body-2">
              Keine Suchbegriffe definiert.
            </span>
          </div>
        </v-card>
      </v-col>

      <!-- Interest selection -->
      <v-col cols="12" md="7">
        <v-card elevation="0" class="card-glass pa-6">
          <v-card-title class="px-0 d-flex align-center">
            <v-icon icon="mdi-tag-multiple" class="mr-2" />
            Rechtsgebiete auswählen
            <v-spacer />
            <v-chip size="small" color="primary" variant="tonal">
              {{ profile.interests.length }} ausgewählt
            </v-chip>
          </v-card-title>
          <p class="text-body-2 text-medium-emphasis mb-4">
            Wählen Sie die Rechtsgebiete aus, die für Sie relevant sind. Sie erhalten
            tägliche Zusammenfassungen der Änderungen in diesen Bereichen.
          </p>

          <v-row dense>
            <v-col v-for="cat in categories" :key="cat.slug" cols="12" sm="6">
              <v-card
                :class="[
                  'interest-card pa-3 d-flex align-center',
                  isSelected(cat.slug) ? 'interest-selected' : '',
                ]"
                elevation="0"
                @click="toggleInterest(cat.slug)"
                style="cursor: pointer"
              >
                <v-checkbox-btn
                  :model-value="isSelected(cat.slug)"
                  color="primary"
                  hide-details
                  density="compact"
                  class="mr-2"
                />
                <div>
                  <div class="text-body-1 font-weight-medium">{{ cat.label }}</div>
                  <div class="text-caption text-medium-emphasis">Index: {{ cat.index }}</div>
                </div>
              </v-card>
            </v-col>
          </v-row>

          <v-btn
            color="primary"
            block
            class="mt-4"
            :loading="saving"
            @click="saveProfile"
          >
            Interessen speichern
          </v-btn>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import api from '../services/api'

const authStore = useAuthStore()

const categories = ref([])
const saving = ref(false)
const saveSuccess = ref(false)
const newKeyword = ref('')

const profile = reactive({
  full_name: authStore.user?.full_name || '',
  interests: [...(authStore.user?.interests || [])],
  keywords: [...(authStore.user?.keywords || [])],
  email_notifications: authStore.user?.email_notifications ?? true,
})

function isSelected(slug) {
  return profile.interests.includes(slug)
}

function toggleInterest(slug) {
  const idx = profile.interests.indexOf(slug)
  if (idx >= 0) {
    profile.interests.splice(idx, 1)
  } else {
    profile.interests.push(slug)
  }
}

function addKeyword() {
  const kw = newKeyword.value.trim()
  if (kw && !profile.keywords.includes(kw)) {
    profile.keywords.push(kw)
  }
  newKeyword.value = ''
}

function removeKeyword(index) {
  profile.keywords.splice(index, 1)
}

async function saveProfile() {
  saving.value = true
  saveSuccess.value = false
  try {
    await authStore.updateProfile({
      full_name: profile.full_name,
      interests: profile.interests,
      keywords: profile.keywords,
      email_notifications: profile.email_notifications,
    })
    saveSuccess.value = true
  } catch {
    // Ignore
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  try {
    const { data } = await api.get('/law-changes/categories')
    categories.value = data
  } catch {
    // Ignore
  }
})
</script>

<style scoped>
.card-glass {
  background: rgba(18, 24, 41, 0.6) !important;
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.interest-card {
  background: rgba(255, 255, 255, 0.03) !important;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  transition: all 0.2s;
}

.interest-card:hover {
  background: rgba(255, 255, 255, 0.06) !important;
  border-color: rgba(255, 255, 255, 0.12);
}

.interest-selected {
  background: rgba(92, 107, 192, 0.15) !important;
  border-color: rgba(92, 107, 192, 0.4) !important;
}
</style>
