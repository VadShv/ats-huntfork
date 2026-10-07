<script setup lang="ts">
/**
 * Настройки → ИИ → «Бюджет и валюта» (docs/tz-ai-usage.md §4.3, §7, §8.5):
 * валюта отчётов и курс USD→RUB, срок хранения журнала, бюджеты с порогами,
 * пересчёт истории по текущим ценам (только владелец).
 */
import { Plus, Pencil, Trash2, Save, RefreshCw, Wallet } from 'lucide-vue-next'
import { AI_FEATURES, AI_FEATURE_LABELS, AI_OPERATIONS } from '~~/shared/aiUsage/catalog'
import { formatMoney, type AiCurrency } from '~~/shared/aiUsage/cost'

const toast = useToast()
const { ask } = useConfirm()

// ── Валюта и курс ────────────────────────────────────────────────
const SETTINGS_URL: string = '/api/ai-usage/settings'
const BUDGETS_URL: string = '/api/ai-usage/budgets'
const reqHeaders = useRequestHeaders(['cookie'])
const { data: settings, refresh: refreshSettings } = useAsyncData<any>('ai-usage-settings', () => $fetch(SETTINGS_URL, { headers: reqHeaders }))
const form = ref({ baseCurrency: 'RUB' as AiCurrency, usdRubRate: null as number | null, retentionDays: 365 })
watch(settings, (s) => {
  if (!s) return
  form.value = { baseCurrency: s.baseCurrency, usdRubRate: s.rateIsDefault ? null : s.usdRubRate, retentionDays: s.retentionDays }
}, { immediate: true })
const saving = ref(false)
async function saveSettings() {
  saving.value = true
  try {
    const res: any = await $fetch('/api/ai-usage/settings', {
      method: 'PUT',
      body: {
        baseCurrency: form.value.baseCurrency,
        usdRubRate: typeof form.value.usdRubRate === 'number' && form.value.usdRubRate > 0 ? form.value.usdRubRate : null,
        retentionDays: form.value.retentionDays,
      },
    })
    toast.success(res.recalculated ? `Сохранено, пересчитано вызовов: ${res.recalculated}` : 'Сохранено')
    await Promise.all([refreshSettings(), refreshBudgets()])
  }
  catch (e: any) {
    toast.error(e?.data?.statusMessage || 'Не удалось сохранить')
  }
  finally {
    saving.value = false
  }
}

// ── Бюджеты ──────────────────────────────────────────────────────
const { data: budgets, refresh: refreshBudgets, status: budgetsStatus } = useAsyncData<any>('ai-usage-budgets', () => $fetch(BUDGETS_URL, { headers: reqHeaders }))
const { data: members } = useFetch<Array<{ userId: string; name: string; email: string }>>('/api/access/members-lite', {
  key: 'ai-usage-budget-members', headers: useRequestHeaders(['cookie']), default: () => [],
})

interface BudgetForm {
  id?: string
  scope: 'org' | 'feature' | 'operation' | 'user'
  scopeKey: string
  period: 'month' | 'day'
  limitAmount: number | null
  currency: AiCurrency
  thresholds: string
  onExceed: 'notify' | 'block_background'
  isActive: boolean
}
const editing = ref<BudgetForm | null>(null)
function newBudget() {
  editing.value = {
    scope: 'org', scopeKey: '', period: 'month', limitAmount: null,
    currency: (settings.value?.baseCurrency ?? 'RUB') as AiCurrency, thresholds: '50, 80, 100', onExceed: 'notify', isActive: true,
  }
}
function editBudget(b: any) {
  editing.value = {
    id: b.id, scope: b.scope, scopeKey: b.scopeKey ?? '', period: b.period, limitAmount: b.limitAmount,
    currency: b.currency, thresholds: (b.thresholds ?? []).join(', '), onExceed: b.onExceed, isActive: b.isActive,
  }
}
const scopeKeyOptions = computed(() => {
  const e = editing.value
  if (!e) return []
  if (e.scope === 'feature') return AI_FEATURES.filter(f => f !== 'unattributed').map(f => ({ value: f, label: AI_FEATURE_LABELS[f] }))
  if (e.scope === 'operation') return AI_OPERATIONS.map(o => ({ value: o.key, label: `${AI_FEATURE_LABELS[o.feature]} · ${o.label}` }))
  if (e.scope === 'user') return (members.value ?? []).map(m => ({ value: m.userId, label: m.name || m.email }))
  return []
})
const savingBudget = ref(false)
async function saveBudget() {
  const e = editing.value
  if (!e) return
  const thresholds = e.thresholds.split(/[,;\s]+/).map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= 200)
  if (!e.limitAmount || e.limitAmount <= 0) { toast.error('Укажите лимит'); return }
  if (e.scope !== 'org' && !e.scopeKey) { toast.error('Выберите, на что действует бюджет'); return }
  if (!thresholds.length) { toast.error('Укажите пороги, например 50, 80, 100'); return }
  savingBudget.value = true
  try {
    const body = {
      scope: e.scope, scopeKey: e.scope === 'org' ? null : e.scopeKey, period: e.period, limitAmount: e.limitAmount,
      currency: e.currency, thresholds, onExceed: e.onExceed, isActive: e.isActive,
    }
    if (e.id) await $fetch(`/api/ai-usage/budgets/${e.id}`, { method: 'PATCH', body })
    else await $fetch('/api/ai-usage/budgets', { method: 'POST', body })
    editing.value = null
    toast.success('Бюджет сохранён')
    await refreshBudgets()
  }
  catch (err: any) {
    toast.error(err?.data?.data?.issues?.[0]?.message || err?.data?.statusMessage || 'Не удалось сохранить бюджет')
  }
  finally {
    savingBudget.value = false
  }
}
async function deleteBudget(b: any) {
  const ok = await ask({ title: 'Удалить бюджет?', message: `«${b.label}» — история срабатываний порогов тоже удалится.`, confirmLabel: 'Удалить', variant: 'danger' })
  if (!ok) return
  try {
    await $fetch(`/api/ai-usage/budgets/${b.id}`, { method: 'DELETE' })
    await refreshBudgets()
  }
  catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Не удалось удалить')
  }
}

// ── Пересчёт истории ─────────────────────────────────────────────
const recalc = ref({ from: '', to: '' })
const recalculating = ref(false)
async function runRecalc() {
  if (!recalc.value.from || !recalc.value.to) { toast.error('Укажите период'); return }
  const ok = await ask({
    title: 'Пересчитать историю?',
    message: 'Стоимость вызовов за период будет пересчитана по ТЕКУЩИМ ценам конфигураций. Действие попадёт в журнал активности.',
    confirmLabel: 'Пересчитать',
  })
  if (!ok) return
  recalculating.value = true
  try {
    const from = new Date(`${recalc.value.from}T00:00:00+03:00`).toISOString()
    const to = new Date(new Date(`${recalc.value.to}T00:00:00+03:00`).getTime() + 86_400_000).toISOString()
    const res: any = await $fetch('/api/ai-usage/recalculate', { method: 'POST', body: { from, to } })
    toast.success(`Пересчитано вызовов: ${res.updated}`)
    await refreshBudgets()
  }
  catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Не удалось пересчитать')
  }
  finally {
    recalculating.value = false
  }
}

const inputCls = 'w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'
</script>

<template>
  <div class="space-y-6">
    <!-- Валюта -->
    <section class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
      <h2 class="text-sm font-semibold mb-1">Валюта отчётов</h2>
      <p class="text-xs text-surface-500 mb-4">Все суммы на странице «Учёт токенов» и в бюджетах приводятся к этой валюте. Цены конфигураций могут быть в $ или ₽.</p>
      <div class="grid sm:grid-cols-3 gap-4">
        <div>
          <label class="block text-[11px] font-medium text-surface-500 mb-1">Базовая валюта</label>
          <UiSegmented v-model="form.baseCurrency" size="sm" aria-label="Базовая валюта" :options="[{ value: 'RUB', label: '₽ Рубли' }, { value: 'USD', label: '$ Доллары' }]" />
        </div>
        <div>
          <label class="block text-[11px] font-medium text-surface-500 mb-1">Курс USD → RUB</label>
          <input v-model.number="form.usdRubRate" type="number" min="0" step="0.01" :placeholder="`по умолчанию ${settings?.usdRubRate ?? 90}`" :class="inputCls">
          <p class="mt-1 text-[11px] text-surface-400">
            <template v-if="settings?.rateUpdatedAt">обновлён {{ new Date(settings.rateUpdatedAt).toLocaleDateString('ru-RU') }}</template>
            <template v-else>задаётся вручную; при смене пересчитается история в базовой валюте</template>
          </p>
        </div>
        <div>
          <label class="block text-[11px] font-medium text-surface-500 mb-1">Хранить журнал, дней</label>
          <input v-model.number="form.retentionDays" type="number" min="30" max="3650" :class="inputCls">
        </div>
      </div>
      <div class="mt-4 flex justify-end">
        <UiButton size="sm" :icon-left="Save" :loading="saving" @click="saveSettings">Сохранить</UiButton>
      </div>
    </section>

    <!-- Бюджеты -->
    <section class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-sm font-semibold flex items-center gap-1.5"><Wallet class="size-4" /> Бюджеты</h2>
          <p class="text-xs text-surface-500">При достижении порогов владельцы и администраторы получают уведомление. Интерактивные действия не блокируются никогда.</p>
        </div>
        <UiButton size="sm" variant="secondary" :icon-left="Plus" @click="newBudget">Добавить</UiButton>
      </div>

      <div v-if="editing" class="mb-4 rounded-xl bg-surface-50 dark:bg-surface-800/50 p-4 space-y-3">
        <div class="grid sm:grid-cols-3 gap-3">
          <div>
            <label class="block text-[11px] font-medium text-surface-500 mb-1">На что</label>
            <select v-model="editing.scope" :class="inputCls" @change="editing && (editing.scopeKey = '')">
              <option value="org">Вся организация</option>
              <option value="feature">Фича</option>
              <option value="operation">Операция</option>
              <option value="user">Сотрудник</option>
            </select>
          </div>
          <div v-if="editing.scope !== 'org'" class="sm:col-span-2">
            <label class="block text-[11px] font-medium text-surface-500 mb-1">Выберите</label>
            <select v-model="editing.scopeKey" :class="inputCls">
              <option value="" disabled>—</option>
              <option v-for="o in scopeKeyOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
        </div>
        <div class="grid sm:grid-cols-4 gap-3">
          <div>
            <label class="block text-[11px] font-medium text-surface-500 mb-1">Период</label>
            <select v-model="editing.period" :class="inputCls">
              <option value="month">Месяц</option>
              <option value="day">День</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-medium text-surface-500 mb-1">Лимит</label>
            <input v-model.number="editing.limitAmount" type="number" min="1" step="1" :class="inputCls">
          </div>
          <div>
            <label class="block text-[11px] font-medium text-surface-500 mb-1">Валюта</label>
            <select v-model="editing.currency" :class="inputCls">
              <option value="RUB">₽</option>
              <option value="USD">$</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-medium text-surface-500 mb-1">Пороги, %</label>
            <input v-model="editing.thresholds" type="text" placeholder="50, 80, 100" :class="inputCls">
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-4 text-sm">
          <label class="inline-flex items-center gap-2">
            <input v-model="editing.onExceed" type="radio" value="notify"> Только уведомить
          </label>
          <label class="inline-flex items-center gap-2">
            <input v-model="editing.onExceed" type="radio" value="block_background"> Приостанавливать фоновые задачи при 100 %
          </label>
          <label class="inline-flex items-center gap-2 ml-auto">
            <input v-model="editing.isActive" type="checkbox"> Активен
          </label>
        </div>
        <p v-if="editing.onExceed === 'block_background'" class="text-[11px] text-surface-500">
          Фоновые: автоскоринг, анализ рисков, отчёты по интервью, ИИ-ответы в ветках и автопилот коммуникаций. Действия, запущенные человеком, продолжают работать.
        </p>
        <div class="flex justify-end gap-2">
          <UiButton size="sm" variant="secondary" @click="editing = null">Отмена</UiButton>
          <UiButton size="sm" :icon-left="Save" :loading="savingBudget" @click="saveBudget">Сохранить</UiButton>
        </div>
      </div>

      <div v-if="budgetsStatus === 'pending' && !budgets" class="text-sm text-surface-500">Загрузка…</div>
      <div v-else-if="!budgets?.items?.length && !editing" class="text-sm text-surface-500">Бюджетов пока нет.</div>
      <ul v-else class="space-y-3">
        <li v-for="b in budgets?.items ?? []" :key="b.id" class="rounded-xl ring-1 ring-surface-200 dark:ring-surface-800 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="text-sm font-medium">
              {{ b.label }}
              <span class="ml-1 text-xs font-normal text-surface-500">· {{ b.period === 'day' ? 'в день' : 'в месяц' }}<template v-if="b.onExceed === 'block_background'"> · блокирует фон</template><template v-if="!b.isActive"> · выключен</template></span>
            </div>
            <div class="flex items-center gap-1">
              <UiButton size="xs" variant="secondary" icon-only :icon-left="Pencil" aria-label="Изменить" @click="editBudget(b)" />
              <UiButton size="xs" variant="secondary" icon-only :icon-left="Trash2" aria-label="Удалить" @click="deleteBudget(b)" />
            </div>
          </div>
          <div class="mt-2 h-2 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
            <div class="h-full rounded-full" :class="b.pct >= 100 ? 'bg-red-500' : b.pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'" :style="{ width: `${Math.min(100, b.pct)}%` }" />
          </div>
          <div class="mt-1 flex flex-wrap justify-between gap-2 text-xs text-surface-500 tabular-nums">
            <span>{{ formatMoney(b.spent, b.currency) }} из {{ formatMoney(b.limitAmount, b.currency) }} ({{ Math.round(b.pct) }} %)</span>
            <span v-if="b.forecast !== null && b.period === 'month'">прогноз {{ formatMoney(b.forecast, b.currency) }}</span>
            <span>пороги {{ (b.thresholds ?? []).join(' / ') }} %</span>
          </div>
        </li>
      </ul>
    </section>

    <!-- Пересчёт -->
    <section v-if="settings?.canRecalculate" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
      <h2 class="text-sm font-semibold mb-1">Пересчёт истории</h2>
      <p class="text-xs text-surface-500 mb-3">Если цены были указаны неверно: пересчитает стоимость вызовов за период по текущим ценам конфигураций. Доступно только владельцу.</p>
      <div class="flex flex-wrap items-end gap-3">
        <div><label class="block text-[11px] font-medium text-surface-500 mb-1">С</label><input v-model="recalc.from" type="date" :class="inputCls"></div>
        <div><label class="block text-[11px] font-medium text-surface-500 mb-1">По</label><input v-model="recalc.to" type="date" :class="inputCls"></div>
        <UiButton size="sm" variant="secondary" :icon-left="RefreshCw" :loading="recalculating" @click="runRecalc">Пересчитать</UiButton>
      </div>
    </section>
  </div>
</template>
