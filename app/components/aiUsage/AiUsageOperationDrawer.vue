<script setup lang="ts">
/**
 * Карточка ИИ-операции (docs/tz-ai-usage.md §8.2): описание из Банка промптов,
 * динамика, распределение стоимости вызова, версии промпта, модели, последние вызовы.
 */
import { BookOpen } from 'lucide-vue-next'
import { AI_STATUS_LABELS, type AiUsageStatus } from '~~/shared/aiUsage/catalog'
import { AI_STATUS_TONE, compactQuery, formatDateTimeRu, formatDuration, formatPct, type AiUsageFilters } from '~/composables/useAiUsage'

const props = defineProps<{
  operationKey: string | null
  filters: AiUsageFilters
  money: (v: number | null | undefined) => string
  tokens: (v: number | null | undefined) => string
  canViewCosts: boolean
}>()
const emit = defineEmits<{ close: []; openTrace: [id: string] }>()

const open = computed({
  get: () => !!props.operationKey,
  set: (v) => { if (!v) emit('close') },
})

const op = ref<any>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)

watch(() => [props.operationKey, JSON.stringify(props.filters)] as const, async ([key]) => {
  op.value = null
  loadError.value = null
  if (!key) return
  loading.value = true
  try {
    const { operation: _o, ...rest } = props.filters
    op.value = await $fetch(`/api/ai-usage/operations/${encodeURIComponent(key)}`, { query: compactQuery(rest) })
  }
  catch (e: any) {
    loadError.value = e?.data?.statusMessage || e?.message || 'Не удалось загрузить операцию'
  }
  finally {
    loading.value = false
  }
}, { immediate: true })

const maxDaily = computed(() => {
  const d = op.value?.daily ?? []
  return Math.max(1, ...d.map((x: any) => (props.canViewCosts ? x.cost : x.tokens)))
})
</script>

<template>
  <UiDrawer v-model="open" :title="op?.label ?? 'Операция'" :description="op ? `${op.featureLabel} · ${op.key}` : ''" width="lg">
    <div v-if="loading" class="py-10 text-center text-sm text-surface-500">Загрузка…</div>
    <div v-else-if="loadError" class="py-10 text-center text-sm text-red-600">{{ loadError }}</div>
    <div v-else-if="op" class="space-y-6">
      <div v-if="op.prompt" class="rounded-xl bg-surface-50 dark:bg-surface-800/60 p-3 text-sm">
        <div class="flex items-center gap-2 font-medium"><BookOpen class="size-4" /> {{ op.prompt.name }}</div>
        <p class="mt-1 text-surface-600 dark:text-surface-400">{{ op.prompt.description }}</p>
        <div class="mt-2 flex flex-wrap gap-3 text-xs text-surface-500">
          <code class="font-mono">{{ op.prompt.sourceFile }}</code>
          <NuxtLink :to="`/dashboard/prompts?prompt=${encodeURIComponent(op.prompt.id)}`" class="text-brand-600 hover:underline">Открыть в Банке промптов</NuxtLink>
        </div>
      </div>
      <p v-if="op.costNote" class="text-xs text-surface-500">{{ op.costNote }}</p>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="rounded-xl ring-1 ring-surface-200 dark:ring-surface-800 p-3">
          <div class="text-[11px] uppercase tracking-wide text-surface-500">Вызовов</div>
          <div class="text-lg font-semibold tabular-nums">{{ op.totals.calls }}</div>
          <div class="text-xs text-surface-500">действий {{ op.totals.traces }}</div>
        </div>
        <div class="rounded-xl ring-1 ring-surface-200 dark:ring-surface-800 p-3">
          <div class="text-[11px] uppercase tracking-wide text-surface-500">Токены</div>
          <div class="text-lg font-semibold tabular-nums">{{ tokens(op.totals.inputTokens + op.totals.outputTokens) }}</div>
          <div class="text-xs text-surface-500">вход {{ tokens(op.totals.inputTokens) }} · выход {{ tokens(op.totals.outputTokens) }}</div>
        </div>
        <div v-if="canViewCosts" class="rounded-xl ring-1 ring-surface-200 dark:ring-surface-800 p-3">
          <div class="text-[11px] uppercase tracking-wide text-surface-500">Расход</div>
          <div class="text-lg font-semibold tabular-nums">{{ money(op.totals.cost) }}</div>
          <div class="text-xs text-surface-500">за действие {{ money(op.totals.traces ? op.totals.cost / op.totals.traces : null) }}</div>
        </div>
        <div class="rounded-xl ring-1 ring-surface-200 dark:ring-surface-800 p-3">
          <div class="text-[11px] uppercase tracking-wide text-surface-500">Ошибки</div>
          <div class="text-lg font-semibold tabular-nums">{{ formatPct(op.totals.calls ? op.totals.errors / op.totals.calls : 0, 1) }}</div>
          <div class="text-xs text-surface-500">ср. время {{ formatDuration(op.totals.avgDurationMs) }}</div>
        </div>
      </div>

      <section>
        <h3 class="text-sm font-semibold mb-2">По дням</h3>
        <div v-if="!op.daily.length" class="text-sm text-surface-500">Нет вызовов за период</div>
        <div v-else class="flex items-end gap-0.5 h-24">
          <div
            v-for="d in op.daily" :key="d.date"
            class="flex-1 rounded-t bg-brand-500/80 hover:bg-brand-600 min-h-[2px]"
            :style="{ height: `${((canViewCosts ? d.cost : d.tokens) / maxDaily) * 100}%` }"
            :title="`${d.date}: ${d.calls} выз. · ${canViewCosts ? money(d.cost) : tokens(d.tokens)}`"
          />
        </div>
      </section>

      <section v-if="canViewCosts && op.costDistribution">
        <h3 class="text-sm font-semibold mb-2">Стоимость одного вызова</h3>
        <div class="flex gap-6 text-sm tabular-nums">
          <span>медиана <b>{{ money(op.costDistribution.p50) }}</b></span>
          <span>90 % вызовов дешевле <b>{{ money(op.costDistribution.p90) }}</b></span>
          <span>максимум <b>{{ money(op.costDistribution.max) }}</b></span>
        </div>
      </section>
      <section v-else-if="op.tokenDistribution">
        <h3 class="text-sm font-semibold mb-2">Токенов на вызов</h3>
        <div class="flex gap-6 text-sm tabular-nums">
          <span>медиана <b>{{ tokens(op.tokenDistribution.p50) }}</b></span>
          <span>p90 <b>{{ tokens(op.tokenDistribution.p90) }}</b></span>
          <span>максимум <b>{{ tokens(op.tokenDistribution.max) }}</b></span>
        </div>
      </section>

      <section>
        <h3 class="text-sm font-semibold mb-2">Версии промпта</h3>
        <p class="text-xs text-surface-500 mb-2">Версия определяется по хэшу системного промпта: изменили промпт — появится новая строка.</p>
        <table class="w-full text-sm">
          <thead class="text-xs text-surface-500">
            <tr><th class="text-left py-1">Хэш</th><th class="text-left">Период</th><th class="text-right">Вызовов</th><th class="text-right">Ср. вход / выход</th><th v-if="canViewCosts" class="text-right">Ср. стоимость</th></tr>
          </thead>
          <tbody>
            <tr v-for="v in op.versions" :key="v.hash ?? 'none'" class="border-t border-surface-100 dark:border-surface-800">
              <td class="py-1.5"><code class="font-mono text-xs">{{ v.hash ? v.hash.slice(0, 10) : '—' }}</code></td>
              <td class="text-xs text-surface-500">{{ formatDateTimeRu(v.firstAt) }} — {{ formatDateTimeRu(v.lastAt) }}</td>
              <td class="text-right tabular-nums">{{ v.calls }}</td>
              <td class="text-right tabular-nums">{{ tokens(v.avgInputTokens) }} / {{ tokens(v.avgOutputTokens) }}</td>
              <td v-if="canViewCosts" class="text-right tabular-nums">{{ money(v.avgCost) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3 class="text-sm font-semibold mb-2">Модели</h3>
        <table class="w-full text-sm">
          <tbody>
            <tr v-for="m in op.models" :key="`${m.provider}:${m.model}`" class="border-t border-surface-100 dark:border-surface-800">
              <td class="py-1.5"><code class="font-mono text-xs">{{ m.model }}</code> <span class="text-xs text-surface-500">{{ m.provider }}</span></td>
              <td class="text-right tabular-nums">{{ m.calls }} выз.</td>
              <td class="text-right tabular-nums text-surface-500">{{ formatDuration(m.avgDurationMs) }}</td>
              <td v-if="canViewCosts" class="text-right tabular-nums">{{ money(m.cost) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3 class="text-sm font-semibold mb-2">Последние вызовы</h3>
        <ul class="divide-y divide-surface-100 dark:divide-surface-800 text-sm">
          <li v-for="r in op.recent" :key="r.id" class="py-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span class="text-xs text-surface-500 w-28 tabular-nums">{{ formatDateTimeRu(r.createdAt) }}</span>
            <span class="flex-1 min-w-0 truncate">{{ r.userName ?? 'Система' }}<template v-if="r.jobTitle"> · {{ r.jobTitle }}</template></span>
            <span class="tabular-nums text-xs">{{ tokens(r.inputTokens + r.outputTokens) }}</span>
            <span v-if="canViewCosts" class="tabular-nums text-xs font-medium">{{ money(r.cost) }}</span>
            <span class="text-xs" :class="AI_STATUS_TONE[r.status]">{{ AI_STATUS_LABELS[r.status as AiUsageStatus] ?? r.status }}</span>
            <button type="button" class="text-xs text-brand-600 hover:underline" @click="emit('openTrace', r.traceId)">трейс</button>
          </li>
        </ul>
      </section>
    </div>
  </UiDrawer>
</template>
