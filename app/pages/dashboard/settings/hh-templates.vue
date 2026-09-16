<script setup lang="ts">
import { FileText, Plus, Pencil, Trash2, Send, Clock, Share2, Lock } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const { t } = useI18n()
const toast = useToast()
const { ask } = useConfirm()

const { allowed, isLoading: permLoading } = usePermission({ hhTemplate: ['read'] })
const { allowed: canCreate } = usePermission({ hhTemplate: ['create'] })
const { allowed: canDelete } = usePermission({ hhTemplate: ['delete'] })
const { allowed: canUseJobs } = usePermission({ job: ['create'] })

interface TemplateRow {
  id: string
  name: string
  description: string | null
  vacancyData: Record<string, unknown>
  hhAreaId: string | null
  hhProfArea: string[] | null
  isShared: boolean
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
  organizationId: string
  createdByUserId: string | null
}

const { data: templates, pending, error, refresh } = await useFetch<TemplateRow[]>('/api/hh/templates', {
  key: 'hh-templates',
  default: () => [],
})

const editorShow = ref(false)
const editorTemplate = ref<TemplateRow | null>(null)
const useModalShow = ref(false)
const useModalTemplate = ref<TemplateRow | null>(null)

function openCreate() {
  editorTemplate.value = null
  editorShow.value = true
}

function openEdit(template: TemplateRow) {
  editorTemplate.value = template
  editorShow.value = true
}

function openUse(template: TemplateRow) {
  useModalTemplate.value = template
  useModalShow.value = true
}

async function deleteTemplate(template: TemplateRow) {
  const confirmed = await ask({
    title: t('dashboard.settings.hhTemplates.deleteConfirmTitle'),
    message: t('dashboard.settings.hhTemplates.deleteConfirmMessage', { name: template.name }),
    variant: 'danger',
    confirmLabel: t('dashboard.settings.hhTemplates.deleteConfirmAction'),
  })
  if (!confirmed) return
  try {
    await $fetch(`/api/hh/templates/${template.id}`, { method: 'DELETE' })
    toast.success(t('dashboard.settings.hhTemplates.deleteSuccess'))
    await refresh()
  }
  catch (err: any) {
    toast.error(t('dashboard.settings.hhTemplates.deleteError'), {
      message: err?.data?.statusMessage ?? err?.message,
    })
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function getVacancyName(vd: Record<string, unknown>): string {
  return (vd?.name as string) ?? '—'
}
</script>

<template>
  <div>
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-100">
          {{ t('dashboard.settings.hhTemplates.pageTitle') }}
        </h1>
        <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">
          {{ t('dashboard.settings.hhTemplates.pageSubtitle') }}
        </p>
      </div>
      <UiButton v-if="canCreate" :icon-left="Plus" @click="openCreate">
        {{ t('dashboard.settings.hhTemplates.createButton') }}
      </UiButton>
    </div>

    <AccessDeniedBanner
      v-if="!permLoading && !allowed"
      :title="t('dashboard.settings.hhTemplates.accessDeniedTitle')"
      :message="t('dashboard.settings.hhTemplates.accessDeniedMessage')"
    />

    <div v-else-if="permLoading || pending" class="flex items-center justify-center py-20">
      <div class="size-8 animate-spin rounded-full border-2 border-surface-200 dark:border-surface-700 border-t-brand-600" />
    </div>

    <div v-else-if="error" class="rounded-lg bg-danger-50 dark:bg-danger-950/30 border border-danger-200 dark:border-danger-800 p-4">
      <p class="text-sm text-danger-700 dark:text-danger-300">
        {{ t('dashboard.settings.hhTemplates.loadError') }}
      </p>
    </div>

    <!-- Empty state -->
    <EmptyState
      v-else-if="templates && templates.length === 0"
      :icon="FileText"
      :title="t('dashboard.settings.hhTemplates.emptyTitle')"
      :description="t('dashboard.settings.hhTemplates.emptyDescription')"
      :action-button="canCreate ? { label: t('dashboard.settings.hhTemplates.createButton'), onClick: openCreate } : undefined"
    />

    <!-- Template grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <UiCard
        v-for="template in templates"
        :key="template.id"
      >
        <template #header>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">
                {{ template.name }}
              </h3>
              <p class="mt-0.5 text-xs text-surface-500 dark:text-surface-400 truncate">
                {{ getVacancyName(template.vacancyData) }}
              </p>
            </div>
            <UiBadge
              :variant="template.isShared ? 'soft' : 'outline'"
              :tone="template.isShared ? 'brand' : 'neutral'"
              pill
            >
              <component
                :is="template.isShared ? Share2 : Lock"
                class="size-3 mr-1"
              />
              {{ template.isShared
                ? t('dashboard.settings.hhTemplates.shared')
                : t('dashboard.settings.hhTemplates.private')
              }}
            </UiBadge>
          </div>
        </template>

        <div class="space-y-2">
          <p v-if="template.description" class="text-sm text-surface-600 dark:text-surface-400 line-clamp-2">
            {{ template.description }}
          </p>
          <div class="flex items-center gap-1.5 text-xs text-surface-400 dark:text-surface-500">
            <Clock class="size-3.5" />
            <span>{{ t('dashboard.settings.hhTemplates.lastUsed') }}: {{ formatDate(template.lastUsedAt) }}</span>
          </div>
        </div>

        <template #footer>
          <div class="flex items-center gap-2">
            <UiButton
              v-if="canUseJobs"
              variant="secondary"
              size="sm"
              :icon-left="Send"
              @click="openUse(template)"
            >
              {{ t('dashboard.settings.hhTemplates.useButton') }}
            </UiButton>
            <UiButton
              v-if="canCreate"
              variant="ghost"
              size="sm"
              :icon-left="Pencil"
              @click="openEdit(template)"
            >
              {{ t('dashboard.settings.hhTemplates.editButton') }}
            </UiButton>
            <UiButton
              v-if="canDelete"
              variant="ghost"
              size="sm"
              class="ml-auto text-danger-600 hover:text-danger-700 dark:text-danger-400"
              :icon-left="Trash2"
              @click="deleteTemplate(template)"
            />
          </div>
        </template>
      </UiCard>
    </div>

    <!-- Editor modal -->
    <HhTemplateEditor
      v-model:show="editorShow"
      :template="editorTemplate"
      @saved="refresh()"
    />

    <!-- Use / publish modal -->
    <HhTemplateUseModal
      v-model:show="useModalShow"
      :template="useModalTemplate"
      @used="refresh()"
    />
  </div>
</template>
