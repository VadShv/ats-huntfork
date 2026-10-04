<script setup lang="ts">
const props = defineProps<{
  donors: { donor: { id: string; layer: string; priority: string; hypothesisStatus: string }; company: { id: string; canonicalName: string; industry?: string | null; tags?: string[] | null } }[]
  canEdit: boolean
}>()

const emit = defineEmits<{ click: [donorId: string] }>()

const layers = [
  { key: 'core', label: 'Ядро' },
  { key: 'adjacent', label: 'Смежный круг' },
  { key: 'school', label: 'Школы компетенций' },
  { key: 'alumni', label: 'Alumni' },
  { key: 'custom', label: 'Своё' },
]

const donorsByLayer = computed(() => {
  const map: Record<string, typeof props.donors> = {}
  for (const d of props.donors) {
    const layer = d.donor.layer
    if (!map[layer]) map[layer] = []
    map[layer].push(d)
  }
  return map
})
</script>

<template>
  <div class="space-y-3">
    <div v-for="layer in layers" :key="layer.key">
      <div class="mb-1 flex items-center gap-2">
        <span class="text-xs font-medium text-surface-600 dark:text-surface-400">{{ layer.label }}</span>
        <span class="text-xs text-surface-400">({{ donorsByLayer[layer.key]?.length ?? 0 }})</span>
      </div>
      <div class="flex flex-wrap gap-2">
        <DonorCard
          v-for="d in donorsByLayer[layer.key]"
          :key="d.donor.id"
          :donor="d"
          @click="emit('click', $event)"
        />
      </div>
    </div>
    <div v-if="!donors.length" class="rounded-lg border border-dashed border-surface-300 p-6 text-center text-sm text-surface-400 dark:border-surface-700">
      Доноров пока нет
    </div>
  </div>
</template>
