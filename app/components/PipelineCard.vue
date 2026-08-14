<script setup lang="ts">
import { User, Calendar } from 'lucide-vue-next'

const props = defineProps<{
  id: string
  candidateFirstName: string
  candidateLastName: string
  candidateEmail: string
  createdAt: string
  score: number | null
  allowedTransitions: string[]
  isTransitioning: boolean
}>()

const emit = defineEmits<{
  (e: 'transition', status: string): void
}>()

const { t } = useI18n()

const transitionLabels = computed<Record<string, string>>(() => ({
  new: t('dashboard.pipeline.transitions.reopen'),
  screening: t('dashboard.pipeline.transitions.toScreening'),
  interview: t('dashboard.pipeline.transitions.toInterview'),
  offer: t('dashboard.pipeline.transitions.toOffer'),
  hired: t('dashboard.pipeline.transitions.toHired'),
  rejected: t('dashboard.pipeline.transitions.reject'),
}))

// Единый визуальный язык: neutral текстовые кнопки + danger только для rejected + brand акцент для первого действия
const TRANSITION_BASE = 'rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const TRANSITION_PRIMARY = 'text-brand-700 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/40'
const TRANSITION_NEUTRAL = 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800'
const TRANSITION_DANGER = 'text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/40'

function transitionClass(status: string, index: number): string {
  if (status === 'rejected') return `${TRANSITION_BASE} ${TRANSITION_DANGER}`
  return `${TRANSITION_BASE} ${index === 0 ? TRANSITION_PRIMARY : TRANSITION_NEUTRAL}`
}

const { formatPersonName, formatDateTime } = useOrgSettings()
</script>

<template>
  <div class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-900 p-3 shadow-sm shadow-surface-900/[0.03] dark:shadow-none">
    <NuxtLink
      :to="$localePath(`/dashboard/applications/${id}`)"
      class="block mb-2 group"
    >
      <h4 class="text-sm font-semibold text-surface-900 dark:text-surface-100 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors truncate">
        {{ formatPersonName(candidateFirstName, candidateLastName) }}
      </h4>
      <div class="flex items-center gap-2 text-xs text-surface-400 mt-0.5">
        <a
          :href="`mailto:${candidateEmail}`"
          target="_blank"
          class="inline-flex items-center gap-1 truncate hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
          @click.stop
        >
          <User class="size-3 shrink-0" />
          {{ candidateEmail }}
        </a>
      </div>
    </NuxtLink>

    <div class="flex items-center justify-between text-xs text-surface-400">
      <span class="inline-flex items-center gap-1">
        <Calendar class="size-3" />
        {{ formatDateTime(createdAt) }}
      </span>
      <ScoreBadge v-if="score != null" :score="score" size="xs" />
    </div>

    <!-- Transition buttons -->
    <div v-if="allowedTransitions.length > 0" class="flex flex-wrap gap-1 mt-2 pt-2 border-t border-surface-100 dark:border-surface-800/60">
      <button
        v-for="(nextStatus, i) in allowedTransitions"
        :key="nextStatus"
        :disabled="isTransitioning"
        :class="transitionClass(nextStatus, i)"
        @click.prevent="emit('transition', nextStatus)"
      >
        {{ transitionLabels[nextStatus] ?? nextStatus }}
      </button>
    </div>
  </div>
</template>
