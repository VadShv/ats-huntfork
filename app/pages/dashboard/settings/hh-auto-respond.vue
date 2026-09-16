<script setup lang="ts">
import { Zap, Plus, Pencil, Trash2 } from 'lucide-vue-next'
import { HH_COLLECTION_LABELS } from '~~/shared/hh-collections'

definePageMeta({
  layout: 'settings',
  middleware: ['auth', 'require-org'],
})

interface AutoRespondRule {
  id: string
  organizationId: string
  createdByUserId: string | null
  name: string
  triggerCollection: string
  triggerDelayMinutes: number
  condition: {
    areaIds?: string[]
    profAreaIds?: string[]
    salaryMin?: number
    resumeKeywords?: string[]
  } | null
  messageTemplate: string
  isActive: boolean
  priority: number
  createdAt: string
  updatedAt: string
}

const toast = useToast()
const { ask } = useConfirm()

const { allowed, isLoading: permLoading } = usePermission({ hhAutoRespond: ['read'] })
const { allowed: canCreate } = usePermission({ hhAutoRespond: ['create'] })
const { allowed: canDelete } = usePermission({ hhAutoRespond: ['delete'] })

const { data: rules, pending: rulesPending, error: rulesError } = await useFetch<AutoRespondRule[]>(
  '/api/hh/auto-respond/rules',
  { key: 'hh-ar-rules', default: () => [] },
)

const { data: logData, refresh: refreshLog } = await useFetch<{ items: any[], total: number }>(
  '/api/hh/auto-respond/log',
  { query: { limit: 50 }, key: 'hh-ar-log', default: () => ({ items: [], total: 0 }) },
)

const editorShow = ref(false)
const editorRule = ref<AutoRespondRule | null>(null)

function collectionLabel(c: string): string {
  return HH_COLLECTION_LABELS[c] ?? c
}

function openCreate() {
  editorRule.value = null
  editorShow.value = true
}

function openEdit(rule: AutoRespondRule) {
  editorRule.value = rule
  editorShow.value = true
}

const togglingId = ref<string | null>(null)
async function toggleActive(rule: AutoRespondRule) {
  togglingId.value = rule.id
  try {
    await $fetch(`/api/hh/auto-respond/rules/${rule.id}`, {
      method: 'PUT',
      body: { isActive: !rule.isActive },
    })
    await refreshNuxtData('hh-ar-rules')
  }
  catch (err: any) {
    toast.error('Не удалось изменить статус', {
      message: err?.data?.statusMessage ?? err?.message,
    })
  }
  finally {
    togglingId.value = null
  }
}

async function deleteRule(rule: AutoRespondRule) {
  const confirmed = await ask({
    title: 'Удалить правило?',
    message: `Правило «${rule.name}» будет удалено. Действие нельзя отменить.`,
    variant: 'danger',
    confirmLabel: 'Удалить',
  })
  if (!confirmed) return
  try {
    await $fetch(`/api/hh/auto-respond/rules/${rule.id}`, { method: 'DELETE' })
    toast.success('Правило удалено')
    await refreshNuxtData('hh-ar-rules')
  }
  catch (err: any) {
    toast.error('Не удалось удалить правило', {
      message: err?.data?.statusMessage ?? err?.message,
    })
  }
}

async function onRetried() {
  await refreshLog()
}
</script>

<template>
  <div>
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-100">
          Авто-ответы hh.ru
        </h1>
        <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">
          Автоматические сообщения кандидатам при поступлении новых откликов
        </p>
      </div>
      <UiButton v-if="canCreate" :icon-left="Plus" @click="openCreate">
        Создать правило
      </UiButton>
    </div>

    <AccessDeniedBanner
      v-if="!permLoading && !allowed"
      title="Нет доступа"
      message="У вас нет прав на просмотр авто-ответов"
    />

    <div v-else-if="permLoading || rulesPending" class="flex items-center justify-center py-20">
      <div class="size-8 animate-spin rounded-full border-2 border-surface-200 dark:border-surface-700 border-t-brand-600" />
    </div>

    <div v-else-if="rulesError" class="rounded-lg bg-danger-50 dark:bg-danger-950/30 border border-danger-200 dark:border-danger-800 p-4">
      <p class="text-sm text-danger-700 dark:text-danger-300">
        Не удалось загрузить правила
      </p>
    </div>

    <template v-else>
      <!-- Rules -->
      <EmptyState
        v-if="rules && rules.length === 0"
        :icon="Zap"
        title="Правил пока нет"
        description="Создайте правило, чтобы автоматически отправлять сообщения кандидатам"
        :action-button="canCreate ? { label: 'Создать правило', onClick: openCreate } : undefined"
      />

      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <UiCard
          v-for="rule in rules"
          :key="rule.id"
        >
          <template #header>
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">
                  {{ rule.name }}
                </h3>
                <div class="mt-1 flex items-center gap-1.5">
                  <UiBadge variant="soft" tone="brand" pill>
                    {{ collectionLabel(rule.triggerCollection) }}
                  </UiBadge>
                  <UiBadge variant="outline" tone="neutral" pill>
                    Приоритет: {{ rule.priority }}
                  </UiBadge>
                </div>
              </div>
              <label class="flex items-center gap-1.5 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  :checked="rule.isActive"
                  :disabled="togglingId === rule.id"
                  class="size-4 rounded border-surface-300 dark:border-surface-700 text-brand-600 focus:ring-brand-500"
                  @change="toggleActive(rule)"
                >
                <span class="text-xs text-surface-500 dark:text-surface-400">
                  {{ rule.isActive ? 'Вкл' : 'Выкл' }}
                </span>
              </label>
            </div>
          </template>

          <div class="space-y-2">
            <p class="text-sm text-surface-600 dark:text-surface-400 line-clamp-3 whitespace-pre-wrap">
              {{ rule.messageTemplate }}
            </p>
            <div v-if="rule.condition?.resumeKeywords?.length" class="flex flex-wrap gap-1">
              <span
                v-for="kw in rule.condition.resumeKeywords"
                :key="kw"
                class="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 px-2 py-0.5 text-[11px]"
              >
                {{ kw }}
              </span>
            </div>
          </div>

          <template #footer>
            <div class="flex items-center gap-2">
              <UiButton
                v-if="canCreate"
                variant="ghost"
                size="sm"
                :icon-left="Pencil"
                @click="openEdit(rule)"
              >
                Изменить
              </UiButton>
              <UiButton
                v-if="canDelete"
                variant="ghost"
                size="sm"
                class="ml-auto text-danger-600 hover:text-danger-700 dark:text-danger-400"
                :icon-left="Trash2"
                @click="deleteRule(rule)"
              />
            </div>
          </template>
        </UiCard>
      </div>

      <!-- Log section -->
      <div class="mt-8">
        <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100 mb-3">
          Журнал отправки
        </h2>
        <UiCard>
          <HhAutoRespondLog
            :items="logData?.items ?? []"
            :total="logData?.total ?? 0"
            @retried="onRetried"
          />
        </UiCard>
      </div>
    </template>

    <!-- Editor modal -->
    <HhAutoRespondRuleEditor
      v-model:show="editorShow"
      :rule="editorRule"
      @saved="refreshLog()"
    />
  </div>
</template>
