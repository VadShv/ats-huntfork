<script setup lang="ts">
import { Search, UserRound, ChevronDown } from 'lucide-vue-next'

interface HhSimilarCandidate {
  candidateId: string
  firstName: string
  lastName: string
  matchPercent: number
  overlappingSkills: string[]
  hhResumeId: string | null
}

const props = defineProps<{ jobId: string }>()
const emit = defineEmits<{
  respond: [candidate: HhSimilarCandidate]
}>()

const { allowed: canRead } = usePermission({ hhSimilarVacancy: ['read'] })

const { data, status } = useFetch<{ items: HhSimilarCandidate[] }>(
  '/api/hh/similar-candidates',
  {
    method: 'POST',
    body: { jobId: props.jobId },
    key: 'hh-similar-cand',
    lazy: true,
  },
)

const items = computed(() => data.value?.items ?? [])
const isLoading = computed(() => status.value === 'pending')

const isExpanded = ref(false)

function matchColor(percent: number): string {
  if (percent >= 75) return 'bg-success-500'
  if (percent >= 40) return 'bg-warning-500'
  return 'bg-danger-500'
}

function matchBadgeClass(percent: number): string {
  if (percent >= 75) return 'bg-success-100 dark:bg-success-950/50 text-success-700 dark:text-success-300'
  if (percent >= 40) return 'bg-warning-100 dark:bg-warning-950/50 text-warning-700 dark:text-warning-300'
  return 'bg-danger-100 dark:bg-danger-950/50 text-danger-700 dark:text-danger-300'
}
</script>

<template>
  <div v-if="canRead" class="rounded-2xl border border-surface-200/80 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-xs dark:shadow-none">
    <button
      type="button"
      class="flex w-full items-center gap-2.5 px-5 py-4 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800/40 transition-colors"
      @click="isExpanded = !isExpanded"
    >
      <div class="flex items-center justify-center size-7 rounded-lg bg-surface-100 dark:bg-surface-800">
        <Search class="size-3.5 text-surface-500 dark:text-surface-400" />
      </div>
      <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">
        Похожие кандидаты
      </h2>
      <span
        v-if="items.length > 0"
        class="inline-flex min-w-[20px] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400"
      >
        {{ items.length }}
      </span>
      <ChevronDown class="ml-auto size-4 text-surface-400 transition-transform duration-150" :class="isExpanded ? 'rotate-180' : ''" />
    </button>

    <div v-if="isExpanded">
      <div v-if="isLoading" class="p-5 space-y-3">
        <div v-for="i in 3" :key="i" class="h-16 rounded-lg bg-surface-100 dark:bg-surface-800 animate-pulse" />
      </div>

      <div v-else-if="items.length > 0" class="p-4 space-y-3">
        <div
          v-for="cand in items"
          :key="cand.candidateId"
          class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 p-4 hover:border-surface-300 dark:hover:border-surface-700 transition-colors"
        >
          <div class="flex items-start justify-between gap-2">
            <NuxtLink
              :to="$localePath(`/dashboard/candidates/${cand.candidateId}`)"
              class="flex items-center gap-2 min-w-0 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
            >
              <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white text-xs font-semibold">
                {{ (cand.firstName?.[0] ?? '') + (cand.lastName?.[0] ?? '') }}
              </div>
              <span class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                {{ cand.firstName }} {{ cand.lastName }}
              </span>
            </NuxtLink>
            <span
              class="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
              :class="matchBadgeClass(cand.matchPercent)"
            >
              {{ cand.matchPercent }}%
            </span>
          </div>

          <div class="mt-2">
            <div class="h-1.5 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
              <div class="h-full rounded-full transition-all" :class="matchColor(cand.matchPercent)" :style="{ width: `${cand.matchPercent}%` }" />
            </div>
          </div>

          <div v-if="cand.overlappingSkills.length > 0" class="mt-3 flex flex-wrap gap-1">
            <UiBadge
              v-for="skill in cand.overlappingSkills.slice(0, 8)"
              :key="skill"
              tone="brand"
              size="sm"
            >
              {{ skill }}
            </UiBadge>
          </div>

          <div class="mt-3">
            <UiButton
              variant="secondary"
              size="xs"
              :icon-left="UserRound"
              @click="emit('respond', cand)"
            >
              Откликнуть
            </UiButton>
          </div>
        </div>
      </div>

      <div v-else class="px-5 py-10">
        <EmptyState title="Нет подходящих кандидатов" />
      </div>
    </div>
  </div>
</template>
