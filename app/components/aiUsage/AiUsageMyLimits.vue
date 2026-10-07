<script setup lang="ts">
/**
 * Личный кабинет → «Мой ИИ» (docs/design-profile-and-token-limits.md §2.2):
 * заполнение дневного и месячного лимита, токены, топ операций, запрос на увеличение.
 * Суммы приходят только при праве aiUsage:view_costs — иначе проценты и токены.
 */
import { Sparkles, Send, ExternalLink } from 'lucide-vue-next'
import { formatMoney, formatTokens, type AiCurrency } from '~~/shared/aiUsage/cost'

const toast = useToast()
const localePath = useLocalePath()
const reqHeaders = useRequestHeaders(['cookie'])
const MY_LIMITS_URL: string = '/api/me/ai-limits'

interface MyPeriod {
  period: 'day' | 'month'
  enabled: boolean
  inherited: boolean
  onExceed: 'notify' | 'block_background' | 'block_all' | null
  blocked: boolean
  pct: number | null
  resetAt: string
  calls: number
  inputTokens: number
  outputTokens: number
  limit?: number | null
  spent?: number
}
interface MyLimits {
  currency: AiCurrency
  canViewCosts: boolean
  day: MyPeriod
  month: MyPeriod
  topOperations: Array<{ key: string; label: string; calls: number; tokens: number; cost?: number }>
}

const { data, refresh, status } = useAsyncData<MyLimits>('me-ai-limits', () => $fetch(MY_LIMITS_URL, { headers: reqHeaders }))

const blockedPeriod = computed(() => {
  const d = data.value
  if (!d) return null
  return d.day.blocked ? d.day : d.month.blocked ? d.month : null
})

function tone(pct: number | null): string {
  if (pct === null) return 'bg-surface-300 dark:bg-surface-600'
  if (pct >= 100) return 'bg-red-500'
  if (pct >= 80) return 'bg-amber-500'
  return 'bg-emerald-500'
}
function fmtReset(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) + ' МСК'
}
function headline(p: MyPeriod, cur: AiCurrency): string {
  if (!p.enabled) return 'без лимита'
  if (typeof p.limit === 'number' && typeof p.spent === 'number') return `${formatMoney(p.spent, cur)} из ${formatMoney(p.limit, cur)}`
  return `${Math.round(p.pct ?? 0)} % лимита`
}

const requesting = ref<'day' | 'month' | null>(null)
const requested = ref<Set<string>>(new Set())
async function requestIncrease(period: 'day' | 'month') {
  requesting.value = period
  try {
    const res: any = await $fetch('/api/me/ai-limits/request-increase', { method: 'POST', body: { period } })
    requested.value = new Set([...requested.value, period])
    toast.success(res.recipients ? `Запрос отправлен (${res.recipients} адресат${res.recipients === 1 ? '' : 'а'})` : 'Запрос отправлен')
  }
  catch (e: any) {
    toast.error(e?.data?.statusMessage || 'Не удалось отправить запрос')
  }
  finally {
    requesting.value = null
  }
}
defineExpose({ refresh })
</script>

<template>
  <section id="ai" class="mt-8 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
    <div class="px-4 sm:px-6 py-5 border-b border-surface-200 dark:border-surface-800">
      <div class="flex items-center gap-3">
        <div class="flex items-center justify-center size-10 shrink-0 rounded-lg bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400">
          <Sparkles class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Мой ИИ</h2>
          <p class="text-sm text-surface-500 dark:text-surface-400">Лимиты на ИИ-действия и сколько из них уже израсходовано. День и месяц — по Москве.</p>
        </div>
        <NuxtLink :to="localePath('/dashboard/ai-usage?period=month')" class="hidden sm:inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline shrink-0">
          Подробно <ExternalLink class="size-3" />
        </NuxtLink>
      </div>
    </div>

    <div class="px-4 sm:px-6 py-5 space-y-5">
      <p v-if="status === 'pending' && !data" class="text-sm text-surface-400">Загрузка…</p>
      <template v-else-if="data">
        <!-- Баннер блокировки -->
        <div v-if="blockedPeriod" class="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          <p class="font-medium">{{ blockedPeriod.period === 'day' ? 'Дневной' : 'Месячный' }} лимит исчерпан — ИИ-действия приостановлены</p>
          <p class="text-xs mt-0.5 text-red-700/80 dark:text-red-300/80">Сброс {{ fmtReset(blockedPeriod.resetAt) }}. Увеличить лимит может владелец или администратор организации.</p>
        </div>

        <!-- Два периода -->
        <div class="grid sm:grid-cols-2 gap-4">
          <div v-for="p in [data.day, data.month]" :key="p.period" class="rounded-lg bg-surface-50 dark:bg-surface-800/50 p-4">
            <div class="flex items-baseline justify-between gap-2 mb-2">
              <span class="text-sm font-medium text-surface-800 dark:text-surface-100">{{ p.period === 'day' ? 'Сегодня' : 'Этот месяц' }}</span>
              <span class="text-xs text-surface-500 truncate">{{ headline(p, data.currency) }}</span>
            </div>
            <div class="h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
              <div class="h-full rounded-full transition-all" :class="tone(p.enabled ? p.pct : null)" :style="{ width: `${p.enabled ? Math.min(100, p.pct ?? 0) : 0}%` }" />
            </div>
            <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-surface-500">
              <dt>Вызовов</dt><dd class="text-right text-surface-700 dark:text-surface-300">{{ p.calls }}</dd>
              <dt>Токенов</dt><dd class="text-right text-surface-700 dark:text-surface-300">{{ formatTokens(p.inputTokens + p.outputTokens) }}</dd>
              <template v-if="p.enabled">
                <dt>Сброс</dt><dd class="text-right text-surface-700 dark:text-surface-300">{{ fmtReset(p.resetAt) }}</dd>
                <dt>При 100 %</dt><dd class="text-right text-surface-700 dark:text-surface-300">{{ p.onExceed === 'notify' ? 'уведомление' : 'остановка' }}</dd>
              </template>
            </dl>
            <p v-if="p.enabled && p.inherited" class="mt-2 text-[11px] text-surface-400">Лимит по умолчанию для участников организации.</p>
            <UiButton
              v-if="p.enabled && (p.pct ?? 0) >= 80"
              class="mt-3"
              size="xs"
              variant="secondary"
              :icon-left="Send"
              :loading="requesting === p.period"
              :disabled="requested.has(p.period)"
              @click="requestIncrease(p.period)"
            >
              {{ requested.has(p.period) ? 'Запрос отправлен' : 'Запросить увеличение' }}
            </UiButton>
          </div>
        </div>

        <!-- На что уходит -->
        <div v-if="data.topOperations.length">
          <p class="text-xs font-semibold text-surface-700 dark:text-surface-200 mb-2">На что уходит в этом месяце</p>
          <ul class="divide-y divide-surface-100 dark:divide-surface-800 text-sm">
            <li v-for="op in data.topOperations" :key="op.key" class="py-1.5 flex items-center justify-between gap-3">
              <span class="truncate text-surface-700 dark:text-surface-300">{{ op.label }}</span>
              <span class="text-xs text-surface-500 shrink-0">
                {{ op.calls }} выз. · {{ formatTokens(op.tokens) }}<template v-if="data.canViewCosts && typeof op.cost === 'number'"> · {{ formatMoney(op.cost, data.currency) }}</template>
              </span>
            </li>
          </ul>
        </div>
        <p v-else class="text-xs text-surface-400">В этом месяце ИИ-действий ещё не было.</p>
      </template>
      <p v-else class="text-sm text-surface-400">Не удалось загрузить лимиты.</p>
    </div>
  </section>
</template>
