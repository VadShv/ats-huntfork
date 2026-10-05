<script setup lang="ts">
const props = defineProps<{
  segments: { segment: { id: string; name: string; donorLayer?: string | null; priority: string; hypothesisStatus: string; isArchived: boolean; queryUrl?: string | null }; channel?: { code?: string | null; name?: string | null } | null; hhSearchesCount: number }[]
  canEdit: boolean
}>()

const emit = defineEmits<{ click: [segmentId: string] }>()

const showArchived = ref(false)
const statusFilter = ref('')
const layerFilter = ref('')

const statusOptions = [
  { label: 'Все статусы', value: '' },
  { label: 'Не проверена', value: 'untested' },
  { label: 'В работе', value: 'in_progress' },
  { label: 'Работает', value: 'working' },
  { label: 'Отклонена', value: 'rejected' },
]
const layerOptions = [
  { label: 'Все слои', value: '' },
  { label: 'Ядро', value: 'core' }, { label: 'Смежный', value: 'adjacent' },
  { label: 'Школы', value: 'school' }, { label: 'Alumni', value: 'alumni' }, { label: 'Своё', value: 'custom' },
]

const visibleSegments = computed(() =>
  props.segments.filter(s => {
    if (!showArchived.value && s.segment.isArchived) return false
    if (statusFilter.value && s.segment.hypothesisStatus !== statusFilter.value) return false
    if (layerFilter.value && s.segment.donorLayer !== layerFilter.value) return false
    return true
  })
)
</script>

<template>
  <div>
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="flex gap-2">
        <UiSelect v-model="statusFilter" :options="statusOptions" class="w-36" />
        <UiSelect v-model="layerFilter" :options="layerOptions" class="w-32" />
      </div>
      <label class="flex items-center gap-2 text-xs text-surface-500">
        <input v-model="showArchived" type="checkbox" class="size-3" />
        Архив
      </label>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-surface-200 text-left text-xs text-surface-500 dark:border-surface-800">
            <th class="pb-2 pr-4 font-medium">Сегмент</th>
            <th class="pb-2 pr-4 font-medium">Слой</th>
            <th class="pb-2 pr-4 font-medium">Канал</th>
            <th class="pb-2 pr-4 font-medium">Приоритет</th>
            <th class="pb-2 pr-4 font-medium">Статус</th>
            <th class="pb-2 font-medium">hh</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in visibleSegments"
            :key="s.segment.id"
            class="cursor-pointer border-b border-surface-100 hover:bg-surface-50 dark:border-surface-900 dark:hover:bg-surface-800/50"
            @click="emit('click', s.segment.id)"
          >
            <td class="py-2 pr-4 font-medium text-surface-900 dark:text-surface-50">{{ s.segment.name }}</td>
            <td class="py-2 pr-4 text-surface-600 dark:text-surface-400">{{ s.segment.donorLayer ?? '—' }}</td>
            <td class="py-2 pr-4 text-surface-600 dark:text-surface-400">{{ s.channel?.name ?? '—' }}</td>
            <td class="py-2 pr-4">
              <UiBadge tone="neutral">{{ s.segment.priority }}</UiBadge>
            </td>
            <td class="py-2 pr-4">
              <HypothesisStatusBadge :status="s.segment.hypothesisStatus" />
            </td>
            <td class="py-2 text-surface-600 dark:text-surface-400">{{ s.hhSearchesCount }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="!visibleSegments.length" class="mt-4 rounded-lg border border-dashed border-surface-300 p-6 text-center text-sm text-surface-400 dark:border-surface-700">
      Сегментов пока нет
    </div>
  </div>
</template>
