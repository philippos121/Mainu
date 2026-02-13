<template>
  <v-container fluid class="pa-6">
    <v-btn variant="text" prepend-icon="mdi-arrow-left" class="mb-4" @click="$router.back()">
      Zurück
    </v-btn>

    <v-progress-linear v-if="loading" indeterminate color="primary" />

    <template v-if="change">
      <v-row>
        <v-col cols="12" lg="8">
          <!-- Main content -->
          <v-card elevation="0" class="card-glass pa-6">
            <div class="d-flex align-center mb-4">
              <v-avatar :color="change.law_type === 'Judikatur' ? 'warning' : 'primary'" variant="tonal" size="48" class="mr-4">
                <v-icon size="24">{{ change.law_type === 'Judikatur' ? 'mdi-gavel' : 'mdi-file-document' }}</v-icon>
              </v-avatar>
              <div>
                <div class="d-flex align-center ga-2 mb-1">
                  <v-chip :color="lawTypeColor" size="small" variant="flat">
                    {{ change.law_type }}
                  </v-chip>
                  <v-chip v-if="change.court_name" size="small" variant="tonal" color="warning">
                    {{ change.court_name }}
                  </v-chip>
                </div>
                <h1 class="text-h5 font-weight-bold">{{ change.short_title || change.title }}</h1>
              </div>
            </div>

            <v-divider class="mb-4" />

            <!-- AI Summary -->
            <div v-if="change.ai_summary" class="mb-6">
              <div class="d-flex align-center mb-2">
                <v-icon icon="mdi-robot" color="accent" class="mr-2" />
                <span class="text-subtitle-1 font-weight-bold">KI-Zusammenfassung</span>
                <v-chip size="x-small" color="accent" variant="tonal" class="ml-2">GPT</v-chip>
              </div>
              <v-card variant="tonal" color="accent" class="pa-4" elevation="0">
                <div class="text-body-1" style="white-space: pre-wrap;">{{ change.ai_summary }}</div>
              </v-card>
              <div v-if="change.ai_summary_generated_at" class="text-caption text-medium-emphasis mt-1">
                Generiert am {{ formatDateTime(change.ai_summary_generated_at) }}
              </div>
            </div>

            <!-- Full title -->
            <div v-if="change.title !== change.short_title" class="mb-4">
              <div class="text-subtitle-2 text-medium-emphasis mb-1">Vollständiger Titel</div>
              <div class="text-body-1">{{ change.title }}</div>
            </div>

            <!-- Content snippet -->
            <div v-if="change.content_snippet" class="mb-4">
              <div class="text-subtitle-2 text-medium-emphasis mb-1">Schlagworte / Inhalt</div>
              <div class="text-body-1">{{ change.content_snippet }}</div>
            </div>

            <!-- RIS Link -->
            <v-btn
              v-if="change.document_url"
              :href="change.document_url"
              target="_blank"
              color="primary"
              variant="tonal"
              prepend-icon="mdi-open-in-new"
              class="mt-2"
            >
              Im RIS anzeigen
            </v-btn>
          </v-card>
        </v-col>

        <!-- Sidebar metadata -->
        <v-col cols="12" lg="4">
          <v-card elevation="0" class="card-glass pa-4 mb-4">
            <v-card-title class="px-0 text-subtitle-1">Details</v-card-title>
            <v-list density="compact" class="bg-transparent">
              <v-list-item>
                <template v-slot:prepend>
                  <v-icon icon="mdi-identifier" size="20" class="mr-3" />
                </template>
                <v-list-item-title class="text-caption text-medium-emphasis">RIS Dokumentnummer</v-list-item-title>
                <v-list-item-subtitle>{{ change.ris_doc_id }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item v-if="change.court_name">
                <template v-slot:prepend>
                  <v-icon icon="mdi-bank" size="20" class="mr-3" />
                </template>
                <v-list-item-title class="text-caption text-medium-emphasis">Gericht</v-list-item-title>
                <v-list-item-subtitle>{{ change.court_name }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item v-if="change.case_number">
                <template v-slot:prepend>
                  <v-icon icon="mdi-file-sign" size="20" class="mr-3" />
                </template>
                <v-list-item-title class="text-caption text-medium-emphasis">Geschäftszahl</v-list-item-title>
                <v-list-item-subtitle>{{ change.case_number }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item v-if="change.bgbl_number && change.law_type !== 'Judikatur'">
                <template v-slot:prepend>
                  <v-icon icon="mdi-newspaper" size="20" class="mr-3" />
                </template>
                <v-list-item-title class="text-caption text-medium-emphasis">
                  {{ change.law_type === 'Landesrecht' ? 'LGBl-Nummer' : 'BGBl-Nummer' }}
                </v-list-item-title>
                <v-list-item-subtitle>{{ change.bgbl_number }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item v-if="change.change_date">
                <template v-slot:prepend>
                  <v-icon icon="mdi-calendar-edit" size="20" class="mr-3" />
                </template>
                <v-list-item-title class="text-caption text-medium-emphasis">
                  {{ change.law_type === 'Judikatur' ? 'Entscheidungsdatum' : 'Änderungsdatum' }}
                </v-list-item-title>
                <v-list-item-subtitle>{{ formatDate(change.change_date) }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item v-if="change.publication_date && change.law_type !== 'Judikatur'">
                <template v-slot:prepend>
                  <v-icon icon="mdi-calendar-check" size="20" class="mr-3" />
                </template>
                <v-list-item-title class="text-caption text-medium-emphasis">Veröffentlichungsdatum</v-list-item-title>
                <v-list-item-subtitle>{{ formatDate(change.publication_date) }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item>
                <template v-slot:prepend>
                  <v-icon icon="mdi-clock-outline" size="20" class="mr-3" />
                </template>
                <v-list-item-title class="text-caption text-medium-emphasis">Erfasst am</v-list-item-title>
                <v-list-item-subtitle>{{ formatDateTime(change.created_at) }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card>

          <!-- Categories -->
          <v-card v-if="change.categories?.length || change.index_numbers?.length" elevation="0" class="card-glass pa-4">
            <v-card-title class="px-0 text-subtitle-1">Kategorien & Index</v-card-title>
            <div>
              <v-chip
                v-for="cat in change.categories"
                :key="cat"
                color="primary"
                variant="tonal"
                size="small"
                class="ma-1"
              >
                {{ cat }}
              </v-chip>
              <v-chip
                v-for="idx in change.index_numbers"
                :key="idx"
                color="secondary"
                variant="tonal"
                size="small"
                class="ma-1"
              >
                Index: {{ idx }}
              </v-chip>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '../services/api'

const route = useRoute()
const change = ref(null)
const loading = ref(true)

const lawTypeColor = computed(() => {
  switch (change.value?.law_type) {
    case 'Bundesrecht': return 'primary'
    case 'Landesrecht': return 'secondary'
    case 'Judikatur': return 'warning'
    default: return 'info'
  }
})

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('de-AT', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

onMounted(async () => {
  try {
    const { data } = await api.get(`/law-changes/${route.params.id}`)
    change.value = data
  } catch {
    // Ignore
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.card-glass {
  background: rgba(18, 24, 41, 0.6) !important;
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
</style>
