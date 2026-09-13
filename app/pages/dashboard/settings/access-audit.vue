<script setup lang="ts">
import { ScrollText, ShieldCheck, RefreshCw } from 'lucide-vue-next'

definePageMeta({})

interface AuditRow {
  id: string
  actorId: string | null
  actorName: string | null
  actorEmail: string | null
  action: string
  resourceType: string
  resourceId: string
  metadata: Record<string, unknown> | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  ip: string | null
  decision: string | null
  policyReason: string | null
  riskLevel: number
  fieldSet: string | null
  chained: boolean
  createdAt: string
}

const { allowed: canManage, isLoading: permLoading } = usePermission({ member: ['update'] })

const minRisk = ref<number | undefined>(undefined)
const decision = ref<'allow' | 'deny' | undefined>(undefined)
const page = ref(1)

const query = computed(() => ({
  page: page.value,
  limit: 50,
  ...(minRisk.value != null ? { minRisk: minRisk.value } : {}),
  ...(decision.value ? { decision: decision.value } : {}),
}))

const { data, pending, refresh, execute } = await useFetch<{ data: AuditRow[]; total: number; page: number; limit: number }>(
  '/api/access/audit',
  { key: 'access-audit', query, immediate: false },
)
watch(canManage, (ok) => { if (ok) execute() }, { immediate: true })

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.total ?? 0)

const ACTION_LABELS: Record<string, string> = {
  member_role_changed: 'Смена роли', member_scope_changed: 'Смена scope',
  member_override_set: 'Индивидуальные права', role_created: 'Создана роль',
  role_updated: 'Изменена роль', role_deleted: 'Удалена роль',
  view_as_started: 'Просмотр «как»', contacts_viewed: 'Просмотр контактов',
  resume_downloaded: 'Скачивание резюме', list_exported: 'Экспорт списка',
  bulk_action: 'Массовое действие', permission_denied: 'Отказ в доступе',
}
function actionLabel(a: string) { return ACTION_LABELS[a] ?? a }
function riskClass(r: number) {
  return r >= 2 ? 'bg-danger-100 text-danger-700 dark:bg-danger-950 dark:text-danger-300'
    : r === 1 ? 'bg-warning-100 text-warning-800 dark:bg-warning-950 dark:text-warning-200'
      : 'bg-surface-100 text-surface-500 dark:bg-surface-800'
}
function fmt(d: string) { return new Date(d).toLocaleString('ru') }
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <header class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="flex items-center gap-2 text-xl font-semibold text-surface-900 dark:text-surface-50">
          <ScrollText class="size-5 text-brand-600" />
          Журнал
        </h1>
        <p class="mt-1 text-sm text-surface-500">
          Неизменяемый аудит действий (hash-chain). Проверка целостности: <code class="text-xs">npm run audit:verify</code>.
        </p>
      </div>
      <UiButton v-if="canManage" variant="ghost" size="sm" :disabled="pending" @click="refresh">
        <RefreshCw class="size-4" :class="pending ? 'animate-spin' : ''" />Обновить
      </UiButton>
    </header>

    <AccessDeniedBanner
      v-if="!canManage && !permLoading"
      message="Журнал доступен только владельцу и администратору."
    />

    <template v-else>
      <!-- Filters -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <UiSegmented
          v-model="minRisk"
          :options="[{ value: undefined as unknown as number, label: 'Все' }, { value: 1, label: 'Чувствительные' }, { value: 2, label: 'Критические' }]"
          size="sm"
          aria-label="Уровень риска"
        />
        <UiSegmented
          v-model="decision"
          :options="[{ value: undefined as unknown as string, label: 'Любые' }, { value: 'deny', label: 'Отказы' }]"
          size="sm"
          aria-label="Решение"
        />
      </div>

      <div class="overflow-hidden rounded-lg border border-surface-200 dark:border-surface-800">
        <table class="w-full text-sm">
          <thead class="bg-surface-50 dark:bg-surface-800/50 text-left text-xs text-surface-500">
            <tr>
              <th class="px-3 py-2">Время</th>
              <th class="px-3 py-2">Кто</th>
              <th class="px-3 py-2">Действие</th>
              <th class="px-3 py-2">Объект</th>
              <th class="px-3 py-2">Риск</th>
              <th class="px-3 py-2" title="Запись в hash-chain">🔗</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-100 dark:divide-surface-800">
            <tr v-for="r in rows" :key="r.id" class="hover:bg-surface-50 dark:hover:bg-surface-800/40">
              <td class="whitespace-nowrap px-3 py-2 text-xs text-surface-500">{{ fmt(r.createdAt) }}</td>
              <td class="px-3 py-2">{{ r.actorName ?? r.actorEmail ?? 'Система' }}</td>
              <td class="px-3 py-2">
                {{ actionLabel(r.action) }}
                <span v-if="r.decision === 'deny'" class="ml-1 rounded bg-danger-100 px-1 text-xs text-danger-700 dark:bg-danger-950 dark:text-danger-300">deny</span>
              </td>
              <td class="px-3 py-2 text-xs text-surface-400">{{ r.resourceType }}</td>
              <td class="px-3 py-2"><span class="rounded-full px-2 py-0.5 text-xs" :class="riskClass(r.riskLevel)">{{ r.riskLevel }}</span></td>
              <td class="px-3 py-2 text-center"><ShieldCheck v-if="r.chained" class="size-3.5 text-success-600" /></td>
            </tr>
            <tr v-if="rows.length === 0 && !pending">
              <td colspan="6" class="px-3 py-8 text-center text-sm text-surface-400">Записей нет.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="mt-3 flex items-center justify-between text-sm text-surface-500">
        <span>Всего: {{ total }}</span>
        <div class="flex gap-2">
          <UiButton variant="ghost" size="sm" :disabled="page <= 1" @click="page--">Назад</UiButton>
          <UiButton variant="ghost" size="sm" :disabled="page * 50 >= total" @click="page++">Вперёд</UiButton>
        </div>
      </div>
    </template>
  </div>
</template>
