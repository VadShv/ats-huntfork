<script setup lang="ts">
/**
 * Трейс действия: все шаги одного действия на временной шкале
 * (docs/tz-ai-usage.md §8.1, блок 6) — части карты поиска, шаги агента и т.п.
 */
import { AlertTriangle } from 'lucide-vue-next'
import { AI_STATUS_LABELS, type AiUsageStatus } from '~~/shared/aiUsage/catalog'
import { AI_STATUS_TONE, formatDateTimeRu, formatDuration } from '~/composables/useAiUsage'

const props = defineProps<{
  traceId: string | null
  money: (v: number | null | undefined) => string
  tokens: (v: number | null | undefined) => string
  canViewCosts: boolean
}>()
const emit = defineEmits<{ close: []; openOperation: [key: string] }>()

const open = computed({
  get: () => !!props.traceId,
  set: (v) => { if (!v) emit('close') },
})

const trace = ref<any>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
watch(() => props.traceId, async (id) => {
  trace.value = null
  loadError.value = null
  if (!id) return
  loading.value = true
  try {
    trace.value = await $fetch(`/api/ai-usage/traces/${id}`)
  }
  catch (e: any) {
    loadError.value = e?.data?.statusMessage || e?.message || 'Не удалось загрузить трейс'
  }
  finally {
    loading.value = false
  }
}, { immediate: true })

const wall = computed(() => Math.max(1, Number(trace.value?.totals?.wallMs ?? 1)))
</script>

<template>
  <UiDrawer v-model="open" title="Действие целиком" :description="traceId ? `Трейс ${traceId.slice(0, 8)}…` : ''" width="lg">
    <div v-if="loading" class="py-10 text-center text-sm text-surface-500">Загрузка…</div>
    <div v-else-if="loadError" class="py-10 text-center text-sm text-red-600">{{ loadError }}</div>
    <div v-else-if="trace" class="space-y-6">
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="rounded-xl bg-surface-50 dark:bg-surface-800/60 p-3">
          <div class="text-[11px] uppercase tracking-wide text-surface-500">Вызовов</div>
          <div class="text-lg font-semibold tabular-nums">{{ trace.totals.calls }}</div>
        </div>
        <div class="rounded-xl bg-surface-50 dark:bg-surface-800/60 p-3">
          <div class="text-[11px] uppercase tracking-wide text-surface-500">Токены</div>
          <div class="text-lg font-semibold tabular-nums">{{ tokens(trace.totals.inputTokens + trace.totals.outputTokens) }}</div>
        </div>
        <div v-if="canViewCosts" class="rounded-xl bg-surface-50 dark:bg-surface-800/60 p-3">
          <div class="text-[11px] uppercase tracking-wide text-surface-500">Стоимость</div>
          <div class="text-lg font-semibold tabular-nums">{{ money(trace.totals.cost) }}</div>
        </div>
        <div class="rounded-xl bg-surface-50 dark:bg-surface-800/60 p-3">
          <div class="text-[11px] uppercase tracking-wide text-surface-500">Время</div>
          <div class="text-lg font-semibold tabular-nums">{{ formatDuration(trace.totals.wallMs) }}</div>
        </div>
      </div>

      <div v-if="trace.totals.errors" class="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
        <AlertTriangle class="size-4 shrink-0" /> Ошибок в действии: {{ trace.totals.errors }} — токены по ним оплачены, результат не получен.
      </div>

      <ol class="space-y-3">
        <li v-for="s in trace.steps" :key="s.id" class="rounded-xl ring-1 ring-surface-200 dark:ring-surface-800 p-3">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <button type="button" class="text-sm font-medium text-left hover:text-brand-600" @click="emit('openOperation', s.operation)">
              {{ s.stepNo }}. {{ s.label }}
            </button>
            <span class="text-xs tabular-nums text-surface-500">{{ formatDateTimeRu(s.createdAt) }}</span>
          </div>
          <!-- Полоса на шкале действия -->
          <div class="mt-2 h-2 rounded bg-surface-100 dark:bg-surface-800 relative overflow-hidden">
            <div
              class="absolute inset-y-0 rounded"
              :class="s.status === 'ok' ? 'bg-brand-500' : s.status === 'repaired' ? 'bg-amber-500' : 'bg-red-500'"
              :style="{ left: `${(s.offsetMs / wall) * 100}%`, width: `${Math.max(1, (s.spanMs / wall) * 100)}%` }"
            />
          </div>
          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-surface-600 dark:text-surface-400">
            <span><code class="font-mono">{{ s.model }}</code></span>
            <span>вход {{ tokens(s.inputTokens) }}<template v-if="s.cachedInputTokens"> (кэш {{ tokens(s.cachedInputTokens) }})</template></span>
            <span>выход {{ tokens(s.outputTokens) }}<template v-if="s.reasoningTokens"> (размышл. {{ tokens(s.reasoningTokens) }})</template></span>
            <span>{{ formatDuration(s.durationMs) }}</span>
            <span v-if="canViewCosts" class="font-medium">{{ money(s.cost) }}</span>
            <span :class="AI_STATUS_TONE[s.status]">{{ AI_STATUS_LABELS[s.status as AiUsageStatus] ?? s.status }}</span>
            <span v-if="s.finishReason === 'length'" class="text-amber-600">упёрся в лимит токенов</span>
            <span v-if="s.tokensEstimated" class="text-surface-400">токены оценены</span>
          </div>
          <p v-if="s.errorMessage" class="mt-1 text-xs text-red-600 break-words">{{ s.errorMessage }}</p>
        </li>
      </ol>
    </div>
  </UiDrawer>
</template>
