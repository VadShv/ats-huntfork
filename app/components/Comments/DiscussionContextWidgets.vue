<script setup lang="ts">
/**
 * Collaboration Hub (Этап 2) — контекст-шапка обсуждения.
 *
 * Одна collapsible-секция «Контекст»: свёрнуто — compact chips
 * (балл скрининга + уровень риска + пробелы); развёрнуто — detail grid.
 * Auto-expand при high risk или низком скрининге (attention signal).
 *
 * Снимки проверок (snapshots) рендерятся инлайн в треде как compact collapsible
 * карточки (CommentSnapshotWidget) — здесь не дублируются.
 */
import { computed, onMounted, ref } from 'vue'
import { Bot, ShieldAlert, ChevronDown, ChevronUp, AlertTriangle, ExternalLink } from 'lucide-vue-next'
import { useResumeRisk } from '~/composables/useResumeRisk'
import { useScoreTone, useRiskMeta } from '~/composables/useDiscussionColors'

const props = defineProps<{
  applicationId: string
  candidateId: string
  compact?: boolean
}>()

const emit = defineEmits<{
  openScreening: []
  openRisk: []
}>()

const { t } = useI18n()

// ── AI-скрининг (per-application) ──
interface CriterionScore {
  criterionKey: string
  criterionName: string | null
  maxScore: number
  score: number
  confidence: number | null
  gaps: string | null
  strengths: string | null
}
interface ScoresResponse {
  compositeScore: number | null
  scores: CriterionScore[]
  latestRun: { status: string, model: string | null, createdAt: string } | null
}

const { data: scores } = useFetch<ScoresResponse>(
  () => `/api/applications/${props.applicationId}/scores`,
  {
    key: computed(() => `disc-scores-${props.applicationId}`),
    headers: useRequestHeaders(['cookie']),
    watch: [() => props.applicationId],
    default: () => ({ compositeScore: null, scores: [], latestRun: null }),
  },
)

const hasScreening = computed(() => scores.value?.compositeScore != null && (scores.value?.scores.length ?? 0) > 0)

/** Топ-2 самых слабых критерия (для «пробелов»). */
const topGaps = computed(() => {
  const list = scores.value?.scores ?? []
  return [...list]
    .filter(c => c.maxScore > 0)
    .sort((a, b) => (a.score / a.maxScore) - (b.score / b.maxScore))
    .slice(0, 2)
    .map(c => c.criterionName || c.criterionKey)
})

const scoreTone = useScoreTone()

// ── Риски (per-candidate) ──
const { profile: riskProfile } = useResumeRisk(() => props.candidateId)
const risk = computed(() => riskProfile.value?.risk ?? null)
const riskStale = computed(() => Boolean(riskProfile.value?.stale))
const hasRisk = computed(() => risk.value?.status === 'completed')
const findingsCount = computed(() => risk.value?.findingsJson?.findings?.length ?? 0)

const getRiskMeta = useRiskMeta()
const riskMeta = computed(() => getRiskMeta(risk.value?.overallRisk ?? 'low'))

const anyData = computed(() => hasScreening.value || hasRisk.value)

// ── Collapsible ──
const collapsed = ref(true)
const attentionSignal = computed(() =>
  (risk.value?.overallRisk === 'high') || (hasScreening.value && (scores.value?.compositeScore ?? 100) < 40),
)
onMounted(() => {
  // Auto-expand при attention signal
  if (attentionSignal.value) collapsed.value = false
})
</script>

<template>
  <div v-if="anyData" class="mb-3">
    <!-- Заголовок-переключатель -->
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-xs font-medium text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 cursor-pointer"
      @click="collapsed = !collapsed"
    >
      <span class="flex items-center gap-1.5">
        <Bot class="size-3.5" />
        {{ t('discussion_widgets.context_section') }}
        <!-- Compact chips (свёрнуто) -->
        <template v-if="collapsed">
          <span
            v-if="hasScreening"
            class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
            :class="scoreTone(scores!.compositeScore!) + ' bg-surface-100 dark:bg-surface-800'"
          >
            {{ scores!.compositeScore }}/100
          </span>
          <span
            v-if="hasRisk"
            class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            :class="riskMeta.chip"
          >
            {{ riskMeta.label }}
          </span>
          <span
            v-if="riskStale"
            class="rounded-full bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 text-[10px] text-surface-500"
          >
            {{ t('discussion_widgets.stale') }}
          </span>
        </template>
      </span>
      <component :is="collapsed ? ChevronDown : ChevronUp" class="size-3.5" />
    </button>

    <!-- Detail (развёрнуто) -->
    <div v-show="!collapsed" class="mt-1.5 grid gap-2" :class="compact ? 'grid-cols-1' : 'sm:grid-cols-2'">
      <!-- AI-скрининг -->
      <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50/60 dark:bg-surface-900/40 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-xs font-semibold text-surface-600 dark:text-surface-300">
            <Bot class="size-3.5 text-accent-500" />
            {{ t('discussion_widgets.screening') }}
          </span>
          <UiButton
            v-if="hasScreening"
            variant="link"
            size="xs"
            :icon-right="ExternalLink"
            @click="emit('openScreening')"
          >
            {{ t('discussion_widgets.details') }}
          </UiButton>
        </div>

        <div v-if="hasScreening" class="mt-1.5 flex items-baseline gap-2">
          <span class="text-2xl font-bold tabular-nums" :class="scoreTone(scores!.compositeScore!)">
            {{ scores!.compositeScore }}
          </span>
          <span class="text-[11px] text-surface-400">/ 100</span>
        </div>
        <div v-if="hasScreening && topGaps.length > 0" class="mt-1.5">
          <span class="text-[11px] text-surface-400">{{ t('discussion_widgets.gaps') }}:</span>
          <div class="mt-0.5 flex flex-wrap gap-1">
            <span
              v-for="g in topGaps"
              :key="g"
              class="rounded bg-danger-50 dark:bg-danger-900/20 px-1.5 py-0.5 text-[10px] text-danger-700 dark:text-danger-300"
            >
              {{ g }}
            </span>
          </div>
        </div>
        <p v-else-if="!hasScreening" class="mt-1.5 text-[11px] italic text-surface-400">
          {{ t('discussion_widgets.screening_empty') }}
        </p>
      </div>

      <!-- Оценка рисков -->
      <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50/60 dark:bg-surface-900/40 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-xs font-semibold text-surface-600 dark:text-surface-300">
            <ShieldAlert class="size-3.5 text-warning-500" />
            {{ t('discussion_widgets.risk') }}
          </span>
          <UiButton
            v-if="hasRisk"
            variant="link"
            size="xs"
            :icon-right="ExternalLink"
            @click="emit('openRisk')"
          >
            {{ t('discussion_widgets.details') }}
          </UiButton>
        </div>

        <div v-if="hasRisk" class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span class="rounded px-1.5 py-0.5 text-[11px] font-semibold" :class="riskMeta.cls">
            {{ riskMeta.label }}
          </span>
          <span
            v-if="findingsCount > 0"
            class="inline-flex items-center gap-0.5 text-[11px] text-surface-500 dark:text-surface-400"
          >
            <AlertTriangle class="size-3 text-warning-500" />
            {{ t('discussion_widgets.findings', { n: findingsCount }) }}
          </span>
          <span
            v-if="riskStale"
            class="rounded bg-surface-200 dark:bg-surface-700 px-1.5 py-0.5 text-[10px] text-surface-500 dark:text-surface-300"
            :title="t('discussion_widgets.stale_hint')"
          >
            {{ t('discussion_widgets.stale') }}
          </span>
        </div>
        <p v-if="hasRisk && risk?.summary" class="mt-1 line-clamp-2 text-[11px] text-surface-500 dark:text-surface-400">
          {{ risk.summary }}
        </p>
        <p v-else-if="!hasRisk" class="mt-1.5 text-[11px] italic text-surface-400">
          {{ t('discussion_widgets.risk_empty') }}
        </p>
      </div>
    </div>
  </div>
</template>
