<script setup lang="ts">
import { ChevronDown, Check, History } from 'lucide-vue-next'

const props = defineProps<{
  candidateId: string
  /** Текущая выбранная версия (id). Если null — показываем «Текущая». */
  modelValue: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

interface VersionRow {
  id: string
  versionNumber: number
  source: string
  contentHash: string
  deltaSummary: Record<string, unknown>
  deltaSummaryText: string
  hhUpdatedAt: string | null
  fetchedAt: string
  isCurrent: boolean
  triggeredBy: string | null
  mergedFromCandidateId: string | null
  createdAt: string
}

const { data, status } = useLazyFetch<{ total: number; versions: VersionRow[] }>(
  () => `/api/candidates/${props.candidateId}/resume-versions`,
  {
    key: computed(() => `resume-versions-${props.candidateId}`),
    server: false,
  },
)

const versions = computed(() => data.value?.versions ?? [])
const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

const selectedVersion = computed(() => {
  if (!props.modelValue) return versions.value.find(v => v.isCurrent) ?? versions.value[0]
  return versions.value.find(v => v.id === props.modelValue) ?? versions.value.find(v => v.isCurrent)
})

function fmtDate(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'hh': return 'hh.ru'
    case 'manual_upload': return 'загружено вручную'
    case 'api_import': return 'импорт API'
    case 'merged_from': return 'из слияния'
    default: return source
  }
}

function selectVersion(v: VersionRow) {
  emit('update:modelValue', v.isCurrent ? null : v.id)
  isOpen.value = false
}

function onDocClick(e: MouseEvent) {
  if (!dropdownRef.value) return
  if (!dropdownRef.value.contains(e.target as Node)) isOpen.value = false
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div v-if="status === 'success' && versions.length > 1" ref="dropdownRef" class="relative inline-block text-left">
    <button
      type="button"
      class="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2.5 py-1 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
      @click.stop="isOpen = !isOpen"
    >
      <History class="size-3.5" />
      <span>
        Версия {{ selectedVersion?.versionNumber ?? '—' }}<span v-if="selectedVersion?.isCurrent"> · текущая</span>
      </span>
      <ChevronDown class="size-3.5 opacity-60" />
    </button>

    <div
      v-if="isOpen"
      class="absolute right-0 z-50 mt-1 w-80 rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg max-h-96 overflow-y-auto"
    >
      <button
        v-for="v in versions"
        :key="v.id"
        type="button"
        class="cursor-pointer w-full text-left px-3 py-2.5 hover:bg-surface-50 dark:hover:bg-surface-800 flex items-start gap-2 border-b border-surface-100 dark:border-surface-800 last:border-b-0"
        @click="selectVersion(v)"
      >
        <Check v-if="v.id === selectedVersion?.id" class="size-4 mt-0.5 text-brand-600 shrink-0" />
        <div v-else class="size-4 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-surface-900 dark:text-surface-100 flex items-center gap-1.5">
            <span>v{{ v.versionNumber }}</span>
            <span v-if="v.isCurrent" class="text-[10px] font-semibold uppercase text-brand-600">текущая</span>
          </div>
          <div class="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
            {{ fmtDate(v.fetchedAt) }} · {{ sourceLabel(v.source) }}
          </div>
          <div v-if="v.deltaSummaryText" class="text-xs text-surface-600 dark:text-surface-300 mt-1">
            Δ {{ v.deltaSummaryText }}
          </div>
        </div>
      </button>
    </div>
  </div>
</template>
