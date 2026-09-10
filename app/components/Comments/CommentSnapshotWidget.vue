<script setup lang="ts">
/**
 * Collaboration Hub (Этап 3) — рендер прикреплённого снимка ИИ в ленте.
 * Compact collapsible: свёрнуто — одна строка (icon + сводка + chevron);
 * развёрнуто — detail (критерии/находки). Фиксированные данные на момент прикрепления.
 */
import { ref, computed } from 'vue'
import { Bot, ShieldAlert, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-vue-next'
import type { ThreadComment, ScreeningSnapshotPayload, RiskSnapshotPayload } from '~/composables/useApplicationComments'

const props = defineProps<{ comment: ThreadComment }>()

const { t, locale } = useI18n()

const isScreening = computed(() => props.comment.kind === 'ai_screening_snapshot')
const screening = computed(() => (isScreening.value ? props.comment.payloadJson as ScreeningSnapshotPayload : null))
const risk = computed(() => (!isScreening.value ? props.comment.payloadJson as RiskSnapshotPayload : null))

const collapsed = ref(true)

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function scoreTone(v: number): string {
  if (v >= 75) return 'text-success-600 dark:text-success-400'
  if (v >= 40) return 'text-warning-600 dark:text-warning-400'
  return 'text-danger-600 dark:text-danger-400'
}

const topCriteria = computed(() => {
  const list = screening.value?.criteria ?? []
  return [...list].filter(c => c.maxScore > 0).slice(0, 4)
})

const riskMeta = computed(() => {
  const level = risk.value?.overallRisk ?? 'low'
  const map = {
    low: { label: t('discussion_widgets.risk_low'), cls: 'bg-success-100 text-success-800 dark:bg-success-900/40 dark:text-success-200' },
    medium: { label: t('discussion_widgets.risk_medium'), cls: 'bg-warning-100 text-warning-800 dark:bg-warning-900/40 dark:text-warning-200' },
    high: { label: t('discussion_widgets.risk_high'), cls: 'bg-danger-100 text-danger-800 dark:bg-danger-900/40 dark:text-danger-200' },
  } as const
  return map[level as keyof typeof map] ?? map.low
})

/** Compact summary для свёрнутого состояния. */
const summary = computed(() => {
  if (isScreening.value && screening.value) {
    return `${screening.value.compositeScore ?? 0}/100`
  }
  if (risk.value) return riskMeta.value.label
  return ''
})
</script>

<template>
  <div
    class="rounded-lg border p-2.5"
    :class="isScreening
      ? 'border-brand-200 dark:border-brand-800/60 bg-brand-50/50 dark:bg-brand-900/10'
      : 'border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-900/10'"
  >
    <!-- Header row (всегда) -->
    <div class="flex items-center gap-1.5 text-xs font-semibold text-surface-600 dark:text-surface-300">
      <Bot v-if="isScreening" class="size-3.5 text-brand-500" />
      <ShieldAlert v-else class="size-3.5 text-amber-500" />
      <span>{{ isScreening ? t('discussion_widgets.screening') : t('discussion_widgets.risk') }}</span>
      <span class="text-[11px] font-normal text-surface-500 dark:text-surface-400">{{ summary }}</span>
      <span class="ml-auto text-[10px] font-normal text-surface-400">{{ t('comment_snapshot.pinned') }}</span>
      <button
        type="button"
        class="rounded p-0.5 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer"
        @click="collapsed = !collapsed"
      >
        <component :is="collapsed ? ChevronDown : ChevronUp" class="size-3.5" />
      </button>
    </div>

    <!-- Detail (развёрнуто) -->
    <div v-show="!collapsed" class="mt-2">
      <!-- Скрининг -->
      <template v-if="isScreening && screening">
        <div class="flex items-baseline gap-2">
          <span class="text-2xl font-bold tabular-nums" :class="scoreTone(screening.compositeScore)">
            {{ screening.compositeScore }}
          </span>
          <span class="text-[11px] text-surface-400">/ 100</span>
        </div>
        <div v-if="topCriteria.length > 0" class="mt-2 space-y-1">
          <div
            v-for="c in topCriteria"
            :key="c.name"
            class="flex items-center gap-2 text-[11px]"
          >
            <span class="min-w-0 flex-1 truncate text-surface-600 dark:text-surface-300">{{ c.name }}</span>
            <span class="tabular-nums font-medium" :class="scoreTone((c.score / c.maxScore) * 100)">
              {{ c.score }}/{{ c.maxScore }}
            </span>
          </div>
        </div>
      </template>

      <!-- Риск -->
      <template v-else-if="risk">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="rounded px-1.5 py-0.5 text-[11px] font-semibold" :class="riskMeta.cls">
            {{ riskMeta.label }}
          </span>
          <span
            v-if="risk.findingsCount > 0"
            class="inline-flex items-center gap-0.5 text-[11px] text-surface-500 dark:text-surface-400"
          >
            <AlertTriangle class="size-3 text-amber-500" />
            {{ t('discussion_widgets.findings', { n: risk.findingsCount }) }}
          </span>
          <span
            v-if="risk.stale"
            class="rounded bg-surface-200 dark:bg-surface-700 px-1.5 py-0.5 text-[10px] text-surface-500 dark:text-surface-300"
          >
            {{ t('discussion_widgets.stale') }}
          </span>
        </div>
        <p v-if="risk.summary" class="mt-1 text-[11px] text-surface-500 dark:text-surface-400">
          {{ risk.summary }}
        </p>
      </template>

      <p
        v-if="(screening?.assessedAt) || (risk?.assessedAt)"
        class="mt-2 text-[10px] text-surface-400"
      >
        {{ t('comment_snapshot.assessed_at', { date: fmtDate(screening?.assessedAt ?? risk?.assessedAt) }) }}
      </p>
    </div>
  </div>
</template>
