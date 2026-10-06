<script setup lang="ts">
/**
 * Встройка «ИИ по вакансии / кандидату: X ₽ · N вызовов» (docs/tz-ai-usage.md §8.3).
 * Показывается только при aiUsage:view_own+; суммы — при view_costs (сервер вырезает).
 */
import { Coins, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { formatMoney, formatTokens, type AiCurrency } from '~~/shared/aiUsage/cost'

const props = defineProps<{
  /** /api/jobs/:id/ai-usage или /api/candidates/:id/ai-usage */
  endpoint: string
  title: string
  /** Ссылка «подробнее» на дашборд с фильтром. */
  dashboardQuery?: Record<string, string>
}>()

const { allowed } = usePermission({ aiUsage: ['view_own'] })
const data = ref<any>(null)
const open = ref(false)

watch([allowed, () => props.endpoint], async ([ok]) => {
  data.value = null
  if (!ok) return
  try {
    data.value = await $fetch(props.endpoint)
  }
  catch {
    data.value = null
  }
}, { immediate: true })

const currency = computed<AiCurrency>(() => (data.value?.currency ?? 'RUB') as AiCurrency)
const hasCost = computed(() => data.value?.totals && 'cost' in data.value.totals)
const link = computed(() => ({ path: '/dashboard/ai-usage', query: { period: '90d', ...(props.dashboardQuery ?? {}) } }))
</script>

<template>
  <div v-if="allowed && data && data.totals.calls > 0" class="rounded-xl ring-1 ring-surface-200 dark:ring-surface-800 bg-white dark:bg-surface-900 text-sm">
    <button type="button" class="w-full flex items-center gap-2 px-3 py-2 text-left" @click="open = !open">
      <Coins class="size-4 text-brand-500 shrink-0" />
      <span class="font-medium">{{ title }}:</span>
      <span class="tabular-nums">
        <template v-if="hasCost">{{ formatMoney(data.totals.cost, currency) }} · </template>{{ data.totals.calls }} вызовов · {{ formatTokens(data.totals.inputTokens + data.totals.outputTokens) }} токенов
      </span>
      <span v-if="data.scope === 'own'" class="text-xs text-surface-400">(ваши)</span>
      <component :is="open ? ChevronDown : ChevronRight" class="ml-auto size-4 text-surface-400" />
    </button>
    <div v-if="open" class="border-t border-surface-100 dark:border-surface-800 px-3 py-2">
      <ul class="space-y-1">
        <li v-for="o in data.operations" :key="o.key" class="flex items-center gap-2 text-xs">
          <span class="flex-1 min-w-0 truncate">{{ o.label }}</span>
          <span class="tabular-nums text-surface-500">{{ o.calls }} выз.</span>
          <span v-if="hasCost" class="tabular-nums font-medium w-20 text-right">{{ formatMoney(o.cost, currency) }}</span>
        </li>
      </ul>
      <NuxtLink :to="link" class="mt-2 inline-block text-xs text-brand-600 hover:underline">Подробнее в «Расход ИИ»</NuxtLink>
    </div>
  </div>
</template>
