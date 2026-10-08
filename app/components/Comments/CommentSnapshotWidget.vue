<script setup lang="ts">
/**
 * Collaboration Hub (Этап 3) — рендер прикреплённого снимка ИИ в ленте.
 * Compact collapsible: свёрнуто — одна строка (icon + сводка + chevron);
 * развёрнуто — detail (критерии/находки). Фиксированные данные на момент прикрепления.
 */
import { ref, computed } from 'vue'
import { Sparkles, ShieldAlert, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-vue-next'
import type { ThreadComment, ScreeningSnapshotPayload, RiskSnapshotPayload } from '~/composables/useApplicationComments'
import { useScoreTone, useRiskMeta } from '~/composables/useDiscussionColors'

const props = defineProps<{ comment: ThreadComment }>()

const { t, locale } = useI18n()

const isScreening = computed(() => props.comment.kind === 'ai_screening_snapshot')
const screening = computed(() => (isScreening.value ? props.comment.payloadJson as ScreeningSnapshotPayload : null))
const risk = computed(() => (!isScreening.value ? props.comment.payloadJson as RiskSnapshotPayload : null))

// Снимок скрининга раскрыт сразу: это главный аргумент в ленте; риск — свёрнут.
const collapsed = ref(!isScreening.value)

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

const scoreTone = useScoreTone()
/** Цвет полоски критерия — тот же порог, что у текста (успех / внимание / риск). */
function barColor(pct: number) {
  if (pct >= 75) return 'bg-success-500'
  if (pct >= 40) return 'bg-warning-500'
  return 'bg-danger-500'
}

const topCriteria = computed(() => {
  const list = screening.value?.criteria ?? []
  return [...list].filter(c => c.maxScore > 0).slice(0, 4)
})

const getRiskMeta = useRiskMeta()
const riskMeta = computed(() => getRiskMeta(risk.value?.overallRisk ?? 'low'))

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
  <div class="-mx-3 -my-2 px-3 py-2">
    <!-- Header row (всегда) -->
    <div class="flex items-center gap-1.5 text-xs font-semibold" :class="isScreening ? 'text-accent-800 dark:text-accent-200' : 'text-warning-800 dark:text-warning-200'">
      <Sparkles v-if="isScreening" class="size-3.5 text-accent-500" />
      <ShieldAlert v-else class="size-3.5 text-warning-500" />
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
        <div v-if="topCriteria.length > 0" class="mt-2 space-y-1.5">
          <div
            v-for="c in topCriteria"
            :key="c.name"
            class="grid grid-cols-[minmax(0,88px)_1fr_auto] items-center gap-2 text-[11px]"
          >
            <span class="truncate text-surface-600 dark:text-surface-300" :title="c.name">{{ c.name }}</span>
            <span class="h-1.5 overflow-hidden rounded-full bg-surface-200/80 dark:bg-surface-700">
              <span
                class="block h-full rounded-full"
                :class="barColor((c.score / c.maxScore) * 100)"
                :style="{ width: `${Math.max(4, Math.min(100, (c.score / c.maxScore) * 100))}%` }"
              />
            </span>
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
            <AlertTriangle class="size-3 text-warning-500" />
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
