<script setup lang="ts">
const props = defineProps<{
  donor: {
    donor: { id: string; layer: string; priority: string; hypothesisStatus: string; rationale?: string | null }
    company: { id: string; canonicalName: string; industry?: string | null; tags?: string[] | null }
  }
}>()

const emit = defineEmits<{ click: [donorId: string] }>()

const layerLabels: Record<string, string> = {
  core: 'Ядро', adjacent: 'Смежный', school: 'Школы', alumni: 'Alumni', custom: 'Своё',
}
</script>

<template>
  <div
    class="cursor-pointer rounded-lg border border-surface-200 p-3 transition hover:border-brand-400 dark:border-surface-800 dark:hover:border-brand-600"
    @click="emit('click', props.donor.donor.id)"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-surface-900 dark:text-surface-50">
          {{ donor.company.canonicalName }}
        </p>
        <p v-if="donor.company.industry" class="truncate text-xs text-surface-500">
          {{ donor.company.industry }}
        </p>
      </div>
      <HypothesisStatusBadge :status="donor.donor.hypothesisStatus" />
    </div>
    <div class="mt-2 flex items-center gap-2">
      <UiBadge variant="surface" class="text-xs">{{ layerLabels[donor.donor.layer] ?? donor.donor.layer }}</UiBadge>
      <UiBadge variant="surface" class="text-xs">{{ donor.donor.priority }}</UiBadge>
    </div>
    <p v-if="donor.donor.rationale" class="mt-1.5 line-clamp-2 text-xs text-surface-500">
      {{ donor.donor.rationale }}
    </p>
  </div>
</template>
