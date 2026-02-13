<template>
  <v-card
    elevation="0"
    class="law-card pa-4 h-100 d-flex flex-column"
    :to="`/law-change/${change.id}`"
  >
    <div class="d-flex align-center mb-2">
      <v-chip :color="lawTypeColor" size="x-small" variant="flat">
        {{ change.law_type }}
      </v-chip>
      <v-chip v-if="change.court_name" size="x-small" variant="tonal" color="warning" class="ml-1">
        {{ change.court_name }}
      </v-chip>
      <v-spacer />
      <span class="text-caption text-medium-emphasis">
        {{ formatDate(change.change_date) }}
      </span>
    </div>

    <h3 class="text-subtitle-1 font-weight-bold mb-2 card-title">
      {{ change.short_title || change.title }}
    </h3>

    <p v-if="change.ai_summary" class="text-body-2 text-medium-emphasis mb-3 card-summary flex-grow-1">
      {{ change.ai_summary.substring(0, 180) }}{{ change.ai_summary.length > 180 ? '...' : '' }}
    </p>
    <p v-else-if="change.content_snippet" class="text-body-2 text-medium-emphasis mb-3 card-summary flex-grow-1">
      {{ change.content_snippet.substring(0, 180) }}{{ change.content_snippet.length > 180 ? '...' : '' }}
    </p>
    <div v-else class="flex-grow-1" />

    <div>
      <v-chip
        v-for="cat in change.categories?.slice(0, 3)"
        :key="cat"
        size="x-small"
        color="primary"
        variant="tonal"
        class="mr-1 mb-1"
      >
        {{ cat }}
      </v-chip>
      <v-chip
        v-if="change.categories?.length > 3"
        size="x-small"
        variant="tonal"
        class="mr-1 mb-1"
      >
        +{{ change.categories.length - 3 }}
      </v-chip>
    </div>

    <div class="d-flex align-center mt-3 pt-2" style="border-top: 1px solid rgba(255,255,255,0.06)">
      <v-icon v-if="change.ai_summary" icon="mdi-robot" size="16" color="accent" class="mr-1" />
      <span v-if="change.ai_summary" class="text-caption text-accent">KI-Zusammenfassung</span>
      <v-spacer />
      <v-icon
        :icon="change.law_type === 'Judikatur' ? 'mdi-gavel' : 'mdi-file-document'"
        size="16"
        class="text-medium-emphasis mr-1"
      />
      <v-icon icon="mdi-arrow-right" size="16" class="text-medium-emphasis" />
    </div>
  </v-card>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  change: { type: Object, required: true },
})

const lawTypeColor = computed(() => {
  switch (props.change.law_type) {
    case 'Bundesrecht': return 'primary'
    case 'Judikatur': return 'warning'
    case 'Landesrecht': return 'secondary'
    default: return 'info'
  }
})

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}
</script>

<style scoped>
.law-card {
  background: rgba(18, 24, 41, 0.6) !important;
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px !important;
  transition: all 0.25s ease;
  cursor: pointer;
}

.law-card:hover {
  transform: translateY(-4px);
  border-color: rgba(92, 107, 192, 0.3);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.card-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-summary {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
