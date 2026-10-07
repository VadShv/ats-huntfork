<script setup lang="ts">
/**
 * Настройки → ИИ → «Бюджет и валюта» → «Лимиты участников»
 * (docs/design-profile-and-token-limits.md §3.4): лимит по умолчанию для всех,
 * личные лимиты по участникам, заполнение за день и месяц, резервная цена для вызовов без цены.
 */
import { Users, Save, RotateCcw, Pencil, ShieldCheck } from 'lucide-vue-next'
import { formatMoney, formatTokens, type AiCurrency } from '~~/shared/aiUsage/cost'

const props = defineProps<{ currency: AiCurrency }>()

const toast = useToast()
const { ask } = useConfirm()
const localePath = useLocalePath()
const reqHeaders = useRequestHeaders(['cookie'])
const LIMITS_URL: string = '/api/ai-usage/member-limits'

interface LimitStatus {
  period: 'day' | 'month'
  budgetId: string | null
  inherited: boolean
  limit: number | null
  spent: number
  pct: number | null
  onExceed: 'notify' | 'block_background' | 'block_all' | null
  blocked: boolean
  resetAt: string
  calls: number
  inputTokens: number
  outputTokens: number
  noPriceCalls: number
}
interface MemberLimits {
  userId: string; name: string; email: string; image: string | null; role: string; privileged: boolean
  day: LimitStatus; month: LimitStatus
}
interface LimitsResponse {
  currency: AiCurrency
  fallbackPricePer1m: number | null
  canManage: boolean
  defaults: { day: { limitAmount: number; onExceed: string } | null; month: { limitAmount: number; onExceed: string } | null }
  members: MemberLimits[]
}

const { data, refresh, status } = useAsyncData<LimitsResponse>('ai-usage-member-limits', () => $fetch(LIMITS_URL, { headers: reqHeaders }))

// ── Лимит по умолчанию ───────────────────────────────────────────
const defaults = ref({ dayLimit: null as number | null, monthLimit: null as number | null, onExceed: 'block_all' as 'notify' | 'block_all', fallbackPricePer1m: null as number | null })
watch(data, (d) => {
  if (!d) return
  defaults.value = {
    dayLimit: d.defaults.day?.limitAmount ?? null,
    monthLimit: d.defaults.month?.limitAmount ?? null,
    onExceed: (d.defaults.month?.onExceed ?? d.defaults.day?.onExceed) === 'notify' ? 'notify' : 'block_all',
    fallbackPricePer1m: d.fallbackPricePer1m,
  }
}, { immediate: true })

const savingDefaults = ref(false)
async function saveDefaults() {
  savingDefaults.value = true
  try {
    await $fetch('/api/ai-usage/member-limits/default', {
      method: 'PUT',
      body: { dayLimit: num(defaults.value.dayLimit), monthLimit: num(defaults.value.monthLimit), onExceed: defaults.value.onExceed },
    })
    if ((data.value?.fallbackPricePer1m ?? null) !== num(defaults.value.fallbackPricePer1m)) {
      await $fetch('/api/ai-usage/settings', { method: 'PUT', body: { fallbackPricePer1m: num(defaults.value.fallbackPricePer1m), recalcHistory: false } })
    }
    toast.success('Лимиты по умолчанию сохранены')
    await refresh()
  }
  catch (e: any) {
    toast.error(e?.data?.data?.issues?.[0]?.message || e?.data?.statusMessage || 'Не удалось сохранить')
  }
  finally {
    savingDefaults.value = false
  }
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

// ── Личные лимиты ────────────────────────────────────────────────
const onlyExceeded = ref(false)
const rows = computed(() => {
  const list = data.value?.members ?? []
  return onlyExceeded.value ? list.filter(m => (m.day.pct ?? 0) >= 80 || (m.month.pct ?? 0) >= 80) : list
})

const editing = ref<{ userId: string; name: string; dayLimit: number | null; monthLimit: number | null; onExceed: 'notify' | 'block_all' } | null>(null)
function edit(m: MemberLimits) {
  editing.value = {
    userId: m.userId, name: m.name,
    dayLimit: m.day.inherited ? null : m.day.limit,
    monthLimit: m.month.inherited ? null : m.month.limit,
    onExceed: (m.month.onExceed ?? m.day.onExceed) === 'notify' ? 'notify' : 'block_all',
  }
}
const savingMember = ref(false)
async function saveMember() {
  const e = editing.value
  if (!e) return
  savingMember.value = true
  try {
    await $fetch(`/api/ai-usage/member-limits/${e.userId}`, {
      method: 'PUT',
      body: { dayLimit: num(e.dayLimit), monthLimit: num(e.monthLimit), onExceed: e.onExceed },
    })
    toast.success(`Лимит для ${e.name} сохранён`)
    editing.value = null
    await refresh()
  }
  catch (err: any) {
    toast.error(err?.data?.data?.issues?.[0]?.message || err?.data?.statusMessage || 'Не удалось сохранить лимит')
  }
  finally {
    savingMember.value = false
  }
}
async function resetMember(m: MemberLimits) {
  const ok = await ask({ title: 'Сбросить личный лимит?', message: `${m.name} вернётся к лимиту по умолчанию для всех участников.`, confirmLabel: 'Сбросить' })
  if (!ok) return
  try {
    await $fetch(`/api/ai-usage/member-limits/${m.userId}`, { method: 'PUT', body: { dayLimit: null, monthLimit: null, onExceed: 'block_all' } })
    await refresh()
  }
  catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Не удалось сбросить')
  }
}

// ── Представление ────────────────────────────────────────────────
function pctTone(pct: number | null): string {
  if (pct === null) return 'bg-surface-300 dark:bg-surface-600'
  if (pct >= 100) return 'bg-red-500'
  if (pct >= 80) return 'bg-amber-500'
  return 'bg-emerald-500'
}
function limitLabel(s: LimitStatus): string {
  if (s.limit === null) return 'без лимита'
  return `${formatMoney(s.spent, props.currency)} из ${formatMoney(s.limit, props.currency)}${s.inherited ? ' · по умолчанию' : ''}`
}
function roleLabel(role: string): string {
  const r = role.split(',').map(x => x.trim())
  if (r.includes('owner')) return 'Владелец'
  if (r.includes('admin')) return 'Администратор'
  return 'Участник'
}
const inputCls = 'w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'
</script>

<template>
  <section class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
    <div class="mb-4">
      <h2 class="text-sm font-semibold flex items-center gap-1.5"><Users class="size-4" /> Лимиты участников</h2>
      <p class="text-xs text-surface-500">
        Защита от того, что один человек потратит много. Лимит в {{ currency === 'USD' ? 'долларах' : 'рублях' }} на каждого участника, день и месяц считаются по Москве.
        Личный лимит имеет приоритет над лимитом по умолчанию. Владельцы и администраторы под лимит по умолчанию не попадают.
      </p>
    </div>

    <!-- По умолчанию -->
    <div class="rounded-xl bg-surface-50 dark:bg-surface-800/50 p-4 mb-5">
      <p class="text-xs font-semibold text-surface-700 dark:text-surface-200 mb-3">По умолчанию для всех участников</p>
      <div class="grid sm:grid-cols-4 gap-3">
        <div>
          <label class="block text-[11px] font-medium text-surface-500 mb-1">В день, {{ currency === 'USD' ? '$' : '₽' }}</label>
          <input v-model.number="defaults.dayLimit" type="number" min="0" step="1" placeholder="без лимита" :class="inputCls">
        </div>
        <div>
          <label class="block text-[11px] font-medium text-surface-500 mb-1">В месяц, {{ currency === 'USD' ? '$' : '₽' }}</label>
          <input v-model.number="defaults.monthLimit" type="number" min="0" step="1" placeholder="без лимита" :class="inputCls">
        </div>
        <div>
          <label class="block text-[11px] font-medium text-surface-500 mb-1">При 100 %</label>
          <select v-model="defaults.onExceed" :class="inputCls">
            <option value="block_all">Останавливать ИИ-действия</option>
            <option value="notify">Только уведомлять</option>
          </select>
        </div>
        <div>
          <label class="block text-[11px] font-medium text-surface-500 mb-1" title="Для вызовов через конфигурацию без цен — чтобы они тоже учитывались в лимите">Резервная цена за 1 млн токенов</label>
          <input v-model.number="defaults.fallbackPricePer1m" type="number" min="0" step="1" placeholder="авто: максимальная из конфигураций" :class="inputCls">
        </div>
      </div>
      <div class="mt-3 flex items-center justify-between gap-3">
        <p class="text-[11px] text-surface-500">Пороги уведомлений: 50 и 80 % — участнику, 100 % — участнику и администраторам.</p>
        <UiButton size="sm" :icon-left="Save" :loading="savingDefaults" @click="saveDefaults">Сохранить</UiButton>
      </div>
    </div>

    <!-- Редактор личного лимита -->
    <div v-if="editing" class="rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/40 dark:bg-brand-950/20 p-4 mb-4 space-y-3">
      <p class="text-xs font-semibold">Личный лимит — {{ editing.name }}</p>
      <div class="grid sm:grid-cols-3 gap-3">
        <div>
          <label class="block text-[11px] font-medium text-surface-500 mb-1">В день</label>
          <input v-model.number="editing.dayLimit" type="number" min="0" step="1" placeholder="как по умолчанию" :class="inputCls">
        </div>
        <div>
          <label class="block text-[11px] font-medium text-surface-500 mb-1">В месяц</label>
          <input v-model.number="editing.monthLimit" type="number" min="0" step="1" placeholder="как по умолчанию" :class="inputCls">
        </div>
        <div>
          <label class="block text-[11px] font-medium text-surface-500 mb-1">При 100 %</label>
          <select v-model="editing.onExceed" :class="inputCls">
            <option value="block_all">Останавливать ИИ-действия</option>
            <option value="notify">Только уведомлять</option>
          </select>
        </div>
      </div>
      <p class="text-[11px] text-surface-500">Пустое поле — по этому периоду действует лимит по умолчанию (для владельцев и администраторов — без лимита).</p>
      <div class="flex justify-end gap-2">
        <UiButton size="sm" variant="secondary" @click="editing = null">Отмена</UiButton>
        <UiButton size="sm" :icon-left="Save" :loading="savingMember" @click="saveMember">Сохранить</UiButton>
      </div>
    </div>

    <!-- Таблица -->
    <div class="flex items-center justify-between mb-2">
      <p class="text-xs font-semibold text-surface-700 dark:text-surface-200">Участники</p>
      <label class="inline-flex items-center gap-1.5 text-xs text-surface-500 cursor-pointer">
        <input v-model="onlyExceeded" type="checkbox"> только от 80 %
      </label>
    </div>
    <p v-if="status === 'pending' && !data" class="text-xs text-surface-400 py-4">Загрузка…</p>
    <p v-else-if="!rows.length" class="text-xs text-surface-400 py-4">{{ onlyExceeded ? 'Никто не приблизился к лимиту.' : 'Нет активных участников.' }}</p>
    <ul v-else class="divide-y divide-surface-100 dark:divide-surface-800">
      <li v-for="m in rows" :key="m.userId" class="py-3 grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center">
        <div class="min-w-0 flex items-center gap-2.5">
          <div class="size-8 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden flex items-center justify-center text-xs font-semibold text-surface-500 shrink-0">
            <img v-if="m.image" :src="m.image" :alt="m.name" class="size-full object-cover">
            <span v-else>{{ m.name.slice(0, 1).toUpperCase() }}</span>
          </div>
          <div class="min-w-0">
            <NuxtLink :to="localePath(`/dashboard/people/${m.userId}`)" class="text-sm font-medium truncate block hover:underline">{{ m.name }}</NuxtLink>
            <p class="text-[11px] text-surface-400 flex items-center gap-1">
              <ShieldCheck v-if="m.privileged" class="size-3" /> {{ roleLabel(m.role) }}
              <span v-if="m.month.blocked || m.day.blocked" class="text-red-600 dark:text-red-400 font-medium">· остановлен</span>
            </p>
          </div>
        </div>
        <div v-for="s in [m.day, m.month]" :key="s.period" class="min-w-0">
          <div class="flex items-center justify-between text-[11px] mb-1">
            <span class="text-surface-500">{{ s.period === 'day' ? 'Сегодня' : 'Месяц' }}</span>
            <span class="text-surface-600 dark:text-surface-300 truncate ml-2" :title="`${formatTokens(s.inputTokens + s.outputTokens)} токенов · ${s.calls} вызовов${s.noPriceCalls ? ` · без цены: ${s.noPriceCalls}` : ''}`">{{ limitLabel(s) }}</span>
          </div>
          <div class="h-1.5 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
            <div class="h-full rounded-full transition-all" :class="pctTone(s.pct)" :style="{ width: `${Math.min(100, s.pct ?? (s.limit === null ? 0 : 0))}%` }" />
          </div>
        </div>
        <div class="flex items-center gap-1 justify-end">
          <UiButton size="xs" variant="secondary" icon-only :icon-left="Pencil" aria-label="Изменить лимит" @click="edit(m)" />
          <UiButton v-if="!m.day.inherited && m.day.limit !== null || !m.month.inherited && m.month.limit !== null" size="xs" variant="ghost" icon-only :icon-left="RotateCcw" aria-label="Сбросить к умолчанию" @click="resetMember(m)" />
        </div>
      </li>
    </ul>
  </section>
</template>
