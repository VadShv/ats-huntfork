<script setup lang="ts">
/**
 * ─────────────────────────────────────────────
 * RolePermissionsMatrix — «Роли и права» (Sprint 20.2, этап A)
 * ─────────────────────────────────────────────
 * Read-only матрица прав, построенная напрямую из shared/permissions.ts —
 * единого источника истины для клиента и сервера. Если права меняются
 * в коде, матрица обновляется автоматически.
 *
 * Этап B (переопределение прав per-org в UI) — см. docs/role-model-and-permissions.md
 */
import { ChevronDown, ShieldCheck } from 'lucide-vue-next'
import { owner, admin, member, hiringManager } from '~~/shared/permissions'

const expanded = ref(false)

type RoleStatements = { statements: Record<string, readonly string[]> }

const roles = [
  { key: 'owner', label: 'Владелец', statements: (owner as unknown as RoleStatements).statements },
  { key: 'admin', label: 'Администратор', statements: (admin as unknown as RoleStatements).statements },
  { key: 'member', label: 'Рекрутер', statements: (member as unknown as RoleStatements).statements },
  { key: 'hiring_manager', label: 'Нанимающий менеджер', statements: (hiringManager as unknown as RoleStatements).statements },
] as const

const resources = [
  { key: 'job', label: 'Вакансии' },
  { key: 'candidate', label: 'Кандидаты' },
  { key: 'application', label: 'Отклики' },
  { key: 'interview', label: 'Интервью' },
  { key: 'comment', label: 'Комментарии' },
  { key: 'document', label: 'Документы' },
  { key: 'emailTemplate', label: 'Шаблоны писем' },
  { key: 'scoring', label: 'ИИ-скоринг' },
  { key: 'pipeline', label: 'Воронки найма' },
  { key: 'sourceTracking', label: 'Источники (UTM)' },
  { key: 'activityLog', label: 'Журнал действий' },
  { key: 'organization', label: 'Организация' },
] as const

const actionOrder = ['create', 'read', 'update', 'delete'] as const
const actionLabels: Record<string, { short: string, title: string }> = {
  create: { short: 'С', title: 'Создание' },
  read: { short: 'Ч', title: 'Чтение' },
  update: { short: 'И', title: 'Изменение' },
  delete: { short: 'У', title: 'Удаление' },
}

function actionsFor(roleStatements: Record<string, readonly string[]>, resource: string): string[] {
  const list = roleStatements[resource] ?? []
  return actionOrder.filter(a => list.includes(a))
}
</script>

<template>
  <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
    <button
      class="w-full px-4 sm:px-6 py-5 flex items-center justify-between gap-3 text-left hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
      @click="expanded = !expanded"
    >
      <div class="flex items-center gap-3">
        <div class="flex items-center justify-center size-10 shrink-0 rounded-lg bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400">
          <ShieldCheck class="size-5" />
        </div>
        <div>
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Роли и права</h2>
          <p class="text-sm text-surface-500 dark:text-surface-400">
            Что может каждая роль в системе
          </p>
        </div>
      </div>
      <ChevronDown
        class="size-5 text-surface-400 transition-transform duration-200"
        :class="expanded ? 'rotate-180' : ''"
      />
    </button>

    <div v-if="expanded" class="border-t border-surface-200 dark:border-surface-800">
      <!-- Legend -->
      <div class="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-surface-500 dark:text-surface-400 bg-surface-50 dark:bg-surface-800/50">
        <span v-for="a in actionOrder" :key="a" class="inline-flex items-center gap-1.5">
          <span class="inline-flex items-center justify-center size-5 rounded bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-400 font-semibold">
            {{ actionLabels[a]!.short }}
          </span>
          {{ actionLabels[a]!.title }}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="inline-flex items-center justify-center size-5 rounded text-surface-300 dark:text-surface-600 font-semibold">—</span>
          Нет доступа
        </span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-200 dark:border-surface-800">
              <th class="px-4 sm:px-6 py-3 text-left text-xs font-medium text-surface-400 dark:text-surface-500 uppercase tracking-wider">
                Раздел
              </th>
              <th
                v-for="r in roles"
                :key="r.key"
                class="px-3 py-3 text-center text-xs font-medium text-surface-400 dark:text-surface-500 uppercase tracking-wider whitespace-nowrap"
              >
                {{ r.label }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-100 dark:divide-surface-800">
            <tr v-for="res in resources" :key="res.key" class="hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
              <td class="px-4 sm:px-6 py-2.5 font-medium text-surface-700 dark:text-surface-300 whitespace-nowrap">
                {{ res.label }}
              </td>
              <td v-for="r in roles" :key="r.key" class="px-3 py-2.5 text-center">
                <span v-if="actionsFor(r.statements, res.key).length === 0" class="text-surface-300 dark:text-surface-600">—</span>
                <span v-else class="inline-flex items-center gap-1">
                  <span
                    v-for="a in actionsFor(r.statements, res.key)"
                    :key="a"
                    :title="actionLabels[a]!.title"
                    class="inline-flex items-center justify-center size-5 rounded bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-400 text-xs font-semibold"
                  >
                    {{ actionLabels[a]!.short }}
                  </span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="px-4 sm:px-6 py-3 border-t border-surface-100 dark:border-surface-800 space-y-1 text-xs text-surface-500 dark:text-surface-400">
        <p>• Рекрутер по умолчанию видит на дашбордах только вакансии, на которые назначен. Владелец и администратор видят все вакансии в разбивке по рекрутерам.</p>
        <p>• Нанимающий менеджер работает в отдельном упрощённом интерфейсе: смотрит назначенных кандидатов и согласовывает этапы — все изменения проводятся системой от его имени.</p>
        <p>• Права заданы в коде системы (единый источник для сервера и интерфейса). Настройка прав по ролям прямо здесь появится в следующем этапе.</p>
      </div>
    </div>
  </section>
</template>
