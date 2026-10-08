<script setup lang="ts">
/**
 * SearchMapSegmentTable — таблица гипотез поиска в режиме «Редактор».
 * В UI слово «сегмент» заменено на «гипотеза» (ТЗ v2 §3.4); в БД/API сущность по-прежнему segment.
 * Строка кликабельна → SegmentDrawer. Сортировка — как в документе (приоритет → статус → порядок).
 */
import { Copy, ExternalLink } from 'lucide-vue-next'
import { sortHypotheses, hypothesisSubtitle } from '~~/shared/searchMap/documentModel'
import { layerLabel, priorityLabel } from '~~/shared/searchMap/labels'
import HypothesisStatusBadge from './HypothesisStatusBadge.vue'

const props = defineProps<{
  segments: {
    segment: {
      id: string; name: string; donorLayer?: string | null; priority: string; hypothesisStatus: string; isArchived: boolean
      queryString?: string | null; queryUrl?: string | null; titles?: string[] | null; geo?: string[] | null
      poolEstimate?: number | null; responseLikelihood?: number | null; accessDifficulty?: number | null
      origin?: string; displayOrder?: number
    }
    channel?: { code?: string | null; name?: string | null } | null
    hhSearchesCount: number
  }[]
  canEdit: boolean
}>()

const emit = defineEmits<{ click: [segmentId: string] }>()

const toast = useToast()
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

const PRIORITY_TONE: Record<string, 'danger' | 'warning' | 'neutral'> = { high: 'danger', medium: 'warning', low: 'neutral' }

const visibleSegments = computed(() => {
  const filtered = props.segments.filter(s => {
    if (!showArchived.value && s.segment.isArchived) return false
    if (statusFilter.value && s.segment.hypothesisStatus !== statusFilter.value) return false
    if (layerFilter.value && s.segment.donorLayer !== layerFilter.value) return false
    return true
  })
  return sortHypotheses(filtered.map(s => ({ ...s, priority: s.segment.priority, hypothesisStatus: s.segment.hypothesisStatus, displayOrder: s.segment.displayOrder })))
})

function dots(v: number | null | undefined): string {
  if (!v) return '···'
  return '●'.repeat(Math.min(3, v)) + '○'.repeat(Math.max(0, 3 - v))
}

async function copyQuery(q: string) {
  try {
    await navigator.clipboard.writeText(q)
    toast.success('Запрос скопирован')
  } catch {
    toast.error('Не удалось скопировать')
  }
}
function openUrl(url: string) { window.open(url, '_blank', 'noopener') }
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
            <th class="pb-2 pr-4 font-medium">Гипотеза</th>
            <th class="pb-2 pr-4 font-medium">Канал</th>
            <th class="pb-2 pr-4 font-medium">Приоритет</th>
            <th class="pb-2 pr-4 font-medium" title="Пул · Отклик · Доступ (1–3)">Оценка</th>
            <th class="pb-2 pr-4 font-medium">Статус</th>
            <th class="pb-2 pr-2 font-medium">hh</th>
            <th class="pb-2 font-medium text-right"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in visibleSegments"
            :key="s.segment.id"
            class="cursor-pointer border-b border-surface-100 hover:bg-surface-50 dark:border-surface-900 dark:hover:bg-surface-800/50"
            :class="s.segment.isArchived ? 'opacity-50' : ''"
            @click="emit('click', s.segment.id)"
          >
            <td class="py-2 pr-4 align-top">
              <div class="flex items-center gap-1.5 font-medium text-surface-900 dark:text-surface-50">
                {{ s.segment.name }}
                <UiBadge v-if="s.segment.origin === 'ai'" tone="brand" size="sm">ИИ</UiBadge>
              </div>
              <div class="text-xs text-surface-500 dark:text-surface-400">
                {{ layerLabel(s.segment.donorLayer) }}<template v-if="hypothesisSubtitle(s.segment)"> · {{ hypothesisSubtitle(s.segment) }}</template>
              </div>
            </td>
            <td class="py-2 pr-4 align-top text-surface-600 dark:text-surface-400">{{ s.channel?.name ?? '—' }}</td>
            <td class="py-2 pr-4 align-top">
              <UiBadge :tone="PRIORITY_TONE[s.segment.priority] ?? 'neutral'" size="sm">{{ priorityLabel(s.segment.priority) }}</UiBadge>
            </td>
            <td class="py-2 pr-4 align-top font-mono text-[10px] leading-4 tracking-widest text-surface-500">
              <div>{{ dots(s.segment.poolEstimate) }}</div>
              <div>{{ dots(s.segment.responseLikelihood) }}</div>
              <div>{{ dots(s.segment.accessDifficulty) }}</div>
            </td>
            <td class="py-2 pr-4 align-top">
              <HypothesisStatusBadge :status="s.segment.hypothesisStatus" />
            </td>
            <td class="py-2 pr-2 align-top text-surface-600 dark:text-surface-400">{{ s.hhSearchesCount }}</td>
            <td class="py-2 text-right align-top" @click.stop>
              <div class="inline-flex gap-0.5">
                <UiButton v-if="s.segment.queryString" size="xs" variant="ghost" icon-only title="Скопировать запрос" @click="copyQuery(s.segment.queryString)">
                  <Copy class="size-3.5" />
                </UiButton>
                <UiButton v-if="s.segment.queryUrl" size="xs" variant="ghost" icon-only title="Открыть в канале" @click="openUrl(s.segment.queryUrl)">
                  <ExternalLink class="size-3.5" />
                </UiButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="!visibleSegments.length" class="mt-4 rounded-lg border border-dashed border-surface-300 p-6 text-center text-sm text-surface-400 dark:border-surface-700">
      Гипотез пока нет
    </div>
  </div>
</template>
