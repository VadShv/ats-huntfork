<script setup lang="ts">
import { ArrowLeftRight, ChevronRight, Loader2 } from 'lucide-vue-next'

const props = defineProps<{
  candidateId: string
  /** Можно ли сравнивать (нужны ≥2 версии резюме). */
  canGenerate: boolean
}>()

const emit = defineEmits<{
  /** Клик по «Подробнее» — родитель переключает панель резюме на «Сравнение». */
  (e: 'open-details'): void
}>()

const { t } = useI18n()
const { versions, total, canCompare, status } = useResumeComparison(() => props.candidateId)

const latest = computed(() => versions.value[0] ?? null)
const oldest = computed(() => versions.value[versions.value.length - 1] ?? null)

function fmtDate(s: string | null | undefined): string {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

const dateRange = computed(() => {
  if (!latest.value || !oldest.value) return ''
  const a = fmtDate(oldest.value.fetchedAt)
  const b = fmtDate(latest.value.fetchedAt)
  if (!a || !b) return ''
  return a === b ? a : `${a} → ${b}`
})
</script>

<template>
  <div class="rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900">
    <div class="mb-2 flex items-center justify-between gap-2">
      <h3 class="inline-flex items-center gap-1.5 text-sm font-semibold text-surface-800 dark:text-surface-100">
        <ArrowLeftRight class="size-4 text-blue-600" />
        {{ t('candidate.comparison.title') }}
      </h3>
    </div>

    <!-- Недостаточно версий -->
    <p v-if="!canCompare" class="text-xs text-surface-500 dark:text-surface-400">
      {{ t('candidate.comparison.notEnough') }}
    </p>

    <!-- Сводка -->
    <template v-else-if="latest">
      <div class="flex items-center gap-2">
        <span class="text-lg font-bold text-surface-800 dark:text-surface-100">{{ total }}</span>
        <span class="text-xs text-surface-500 dark:text-surface-400">{{ t('candidate.comparison.versions') }}</span>
        <span v-if="dateRange" class="ml-auto text-xs text-surface-400">{{ dateRange }}</span>
      </div>
      <p class="mt-1 text-xs text-surface-500 dark:text-surface-400">
        {{ t('candidate.comparison.latest') }}: {{ latest.deltaSummaryText || t('candidate.comparison.noDelta') }}
      </p>
      <UiButton
        variant="link"
        size="xs"
        class="mt-2"
        @click="emit('open-details')"
      >
        {{ t('candidate.comparison.details') }} <ChevronRight class="size-3" />
      </UiButton>
    </template>

    <!-- Загрузка -->
    <p v-else-if="status === 'pending'" class="inline-flex items-center gap-1.5 text-xs text-surface-400">
      <Loader2 class="size-3.5 animate-spin" /> {{ t('candidate.comparison.loading') }}
    </p>
  </div>
</template>
