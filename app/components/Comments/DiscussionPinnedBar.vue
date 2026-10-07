<script setup lang="ts">
/**
 * Новая оболочка «Обсуждения» — полоса закреплённого над лентой (как в Телеграме).
 *
 * Элементы полосы:
 *   - закреплённые сообщения (is_pinned), по убыванию pinned_at;
 *   - один элемент «Контекст ИИ» (балл скрининга + уровень риска + «устарело»),
 *     если по отклику/кандидату есть данные.
 *
 * Клик по полосе — переход к закреплённому сообщению (emit goto) и переключение
 * на следующий элемент. «Контекст ▾» раскрывает детали скрининга и риска
 * (перенесено из DiscussionContextWidgets). Авто-раскрытие при высоком риске
 * или низком балле сохранено.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Bot, ShieldAlert, ChevronDown, ChevronUp, AlertTriangle, ExternalLink, Pin } from 'lucide-vue-next'
import type { ThreadComment } from '~/composables/useApplicationComments'
import { useResumeRisk } from '~/composables/useResumeRisk'
import { useScoreTone, useRiskMeta } from '~/composables/useDiscussionColors'

const props = defineProps<{
  applicationId: string
  candidateId: string
  /** Закреплённые для всех (is_pinned), по убыванию pinned_at. */
  pinnedComments: ThreadComment[]
  /** Закреплённые только для меня (comment_pin_personal). */
  personalPinnedComments?: ThreadComment[]
  compact?: boolean
}>()

const emit = defineEmits<{
  goto: [commentId: string]
  openScreening: []
  openRisk: []
}>()

const { t } = useI18n()

// ── ИИ-скрининг (per-application) ──
interface CriterionScore {
  criterionKey: string
  criterionName: string | null
  maxScore: number
  score: number
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
const hasContext = computed(() => hasScreening.value || hasRisk.value)

// ── Элементы полосы ──
type BarItem =
  | { kind: 'pin', comment: ThreadComment, personal: boolean }
  | { kind: 'context' }

const items = computed<BarItem[]>(() => {
  const list: BarItem[] = props.pinnedComments.map(c => ({ kind: 'pin' as const, comment: c, personal: false }))
  const seen = new Set(props.pinnedComments.map(c => c.id))
  for (const c of props.personalPinnedComments ?? []) {
    if (!seen.has(c.id)) list.push({ kind: 'pin', comment: c, personal: true })
  }
  if (hasContext.value) list.push({ kind: 'context' })
  return list
})
const idx = ref(0)
watch(items, (list) => { if (idx.value >= list.length) idx.value = 0 })
const current = computed<BarItem | null>(() => items.value[idx.value] ?? null)

function pinPreview(c: ThreadComment): string {
  const text = c.body.replace(/\s+/g, ' ').trim()
  return text.length > 140 ? `${text.slice(0, 140)}…` : text
}
function pinAuthor(c: ThreadComment): string {
  if (c.hhDirection === 'incoming' && c.hhAuthorName) return c.hhAuthorName
  return c.author.name || c.author.email || '—'
}

function onBarClick() {
  const cur = current.value
  if (!cur) return
  if (cur.kind === 'pin') emit('goto', cur.comment.id)
  if (items.value.length > 1) idx.value = (idx.value + 1) % items.value.length
}

// ── Детали контекста ──
const detailsOpen = ref(false)
const attentionSignal = computed(() =>
  (risk.value?.overallRisk === 'high') || (hasScreening.value && (scores.value?.compositeScore ?? 100) < 40),
)
onMounted(() => {
  if (attentionSignal.value) detailsOpen.value = true
})
</script>

<template>
  <div v-if="items.length > 0" class="border-b border-surface-100 dark:border-surface-800">
    <!-- Полоса -->
    <div
      class="flex items-center gap-2.5 bg-surface-50/70 dark:bg-surface-950/40"
      :class="compact ? 'px-3 py-1.5' : 'px-4 py-2'"
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-2.5 text-left cursor-pointer"
        :title="current?.kind === 'pin' ? t('comments.pinned_goto') : t('comments.context_hint')"
        @click="onBarClick"
      >
        <span class="w-0.5 self-stretch rounded-full flex-shrink-0" :class="current?.kind === 'pin' ? (current.personal ? 'bg-surface-400' : 'bg-brand-500') : 'bg-accent-500'" />
        <span class="min-w-0 flex-1">
          <!-- Закреплённое сообщение -->
          <template v-if="current?.kind === 'pin'">
            <span class="block truncate text-xs text-surface-600 dark:text-surface-300">
              <span class="font-semibold text-surface-700 dark:text-surface-200">{{ pinAuthor(current.comment) }}:</span>
              {{ pinPreview(current.comment) }}
            </span>
          </template>
          <!-- Контекст ИИ -->
          <span v-else class="flex flex-wrap items-center gap-1.5">
            <span
              v-if="hasScreening"
              class="inline-flex items-center gap-1 rounded-full bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 px-2 py-0.5 text-[11px] font-semibold tabular-nums"
              :class="scoreTone(scores!.compositeScore!)"
            >
              <Bot class="size-3" /> {{ t('discussion_widgets.screening') }} {{ scores!.compositeScore }}
            </span>
            <span
              v-if="hasRisk"
              class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              :class="riskMeta.chip"
            >
              <ShieldAlert class="size-3" /> {{ t('discussion_widgets.risk') }}: {{ riskMeta.label }}
            </span>
            <span
              v-if="riskStale"
              class="rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[10px] text-surface-500"
              :title="t('discussion_widgets.stale_hint')"
            >
              {{ t('discussion_widgets.stale') }}
            </span>
          </span>
        </span>
        <span class="hidden sm:inline-flex items-center gap-1 text-[10px] text-surface-400 flex-shrink-0">
          <Pin v-if="current?.kind === 'pin'" class="size-2.5" />
          {{ current?.kind === 'pin' ? (current.personal ? t('comments.pinned_for_me_badge') : t('comments.pinned_for_all')) : t('comments.context_label') }}
          <span v-if="items.length > 1" class="tabular-nums">· {{ idx + 1 }}/{{ items.length }}</span>
        </span>
      </button>

      <button
        v-if="hasContext"
        type="button"
        class="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-0.5 text-[11px] text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer transition-colors"
        @click="detailsOpen = !detailsOpen"
      >
        {{ t('comments.context_label') }}
        <component :is="detailsOpen ? ChevronUp : ChevronDown" class="size-3" />
      </button>
    </div>

    <!-- Детали контекста (развёрнуто) -->
    <div
      v-if="detailsOpen && hasContext"
      class="grid gap-2 bg-surface-50/70 dark:bg-surface-950/40"
      :class="compact ? 'grid-cols-1 px-3 pb-2.5' : 'sm:grid-cols-2 px-4 pb-3'"
    >
      <!-- ИИ-скрининг -->
      <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-xs font-semibold text-surface-600 dark:text-surface-300">
            <Bot class="size-3.5 text-accent-500" />
            {{ t('discussion_widgets.screening') }}
          </span>
          <UiButton v-if="hasScreening" variant="link" size="xs" :icon-right="ExternalLink" @click="emit('openScreening')">
            {{ t('discussion_widgets.details') }}
          </UiButton>
        </div>
        <div v-if="hasScreening" class="mt-1.5 flex items-baseline gap-2">
          <span class="text-2xl font-bold tabular-nums" :class="scoreTone(scores!.compositeScore!)">{{ scores!.compositeScore }}</span>
          <span class="text-[11px] text-surface-400">/ 100</span>
        </div>
        <div v-if="hasScreening && topGaps.length > 0" class="mt-1.5">
          <span class="text-[11px] text-surface-400">{{ t('discussion_widgets.gaps') }}:</span>
          <div class="mt-0.5 flex flex-wrap gap-1">
            <span v-for="g in topGaps" :key="g" class="rounded bg-danger-50 dark:bg-danger-900/20 px-1.5 py-0.5 text-[10px] text-danger-700 dark:text-danger-300">{{ g }}</span>
          </div>
        </div>
        <p v-else-if="!hasScreening" class="mt-1.5 text-[11px] italic text-surface-400">{{ t('discussion_widgets.screening_empty') }}</p>
      </div>

      <!-- Оценка рисков -->
      <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-xs font-semibold text-surface-600 dark:text-surface-300">
            <ShieldAlert class="size-3.5 text-warning-500" />
            {{ t('discussion_widgets.risk') }}
          </span>
          <UiButton v-if="hasRisk" variant="link" size="xs" :icon-right="ExternalLink" @click="emit('openRisk')">
            {{ t('discussion_widgets.details') }}
          </UiButton>
        </div>
        <div v-if="hasRisk" class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span class="rounded px-1.5 py-0.5 text-[11px] font-semibold" :class="riskMeta.cls">{{ riskMeta.label }}</span>
          <span v-if="findingsCount > 0" class="inline-flex items-center gap-0.5 text-[11px] text-surface-500 dark:text-surface-400">
            <AlertTriangle class="size-3 text-warning-500" />
            {{ t('discussion_widgets.findings', { n: findingsCount }) }}
          </span>
          <span v-if="riskStale" class="rounded bg-surface-200 dark:bg-surface-700 px-1.5 py-0.5 text-[10px] text-surface-500 dark:text-surface-300" :title="t('discussion_widgets.stale_hint')">
            {{ t('discussion_widgets.stale') }}
          </span>
        </div>
        <p v-if="hasRisk && risk?.summary" class="mt-1 line-clamp-2 text-[11px] text-surface-500 dark:text-surface-400">{{ risk.summary }}</p>
        <p v-else-if="!hasRisk" class="mt-1.5 text-[11px] italic text-surface-400">{{ t('discussion_widgets.risk_empty') }}</p>
      </div>
    </div>
  </div>
</template>
