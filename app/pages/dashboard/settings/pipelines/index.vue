<script setup lang="ts">
import {
  Plus, AlertTriangle, GitBranch,
  Pencil, Copy, Archive, Star,
} from 'lucide-vue-next'

definePageMeta({})

useSeoMeta({
  title: 'Воронки подбора',
  description: 'Управляйте воронками найма для вашей организации',
})

const { t } = useI18n()
const toast = useToast()
const localePath = useLocalePath()

// ── Permissions ──
const { allowed: canUpdatePipeline } = usePermission({ pipeline: ['update'] })
const { allowed: canDeletePipeline } = usePermission({ pipeline: ['delete'] })
const { allowed: canCreatePipeline } = usePermission({ pipeline: ['create'] })

// ── Toggle: show archived ──
const showArchived = ref(false)

// ── Data fetch ──
interface PipelineListItem {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  isDefault: boolean
  isArchived: boolean
  stagesCount: number
  jobsCount: number
  createdAt: string | Date
  updatedAt: string | Date
}

const fetchUrl = computed(() =>
  showArchived.value ? '/api/pipelines?includeArchived=true' : '/api/pipelines',
)

const { data: pipelinesRaw, status, refresh, error: fetchError } = useFetch<PipelineListItem[]>(
  fetchUrl,
  {
    watch: [fetchUrl],
    headers: useRequestHeaders(['cookie']),
    default: () => [],
  },
)

const pipelines = computed(() => pipelinesRaw.value ?? [])
const isLoading = computed(() => status.value === 'pending')

// ── B3: разделяем на основную (каноническую) и экспериментальные (песочница) ──
const mainPipelines = computed(() => pipelines.value.filter(p => p.isSystem || p.isDefault))
const sandboxPipelines = computed(() => pipelines.value.filter(p => !p.isSystem && !p.isDefault))

// ── Archive confirmation modal ──
const pipelineToArchive = ref<PipelineListItem | null>(null)
const isArchiving = ref(false)

function openArchiveModal(pipeline: PipelineListItem) {
  pipelineToArchive.value = pipeline
}

function closeArchiveModal() {
  pipelineToArchive.value = null
}

async function handleArchive() {
  if (!pipelineToArchive.value) return
  isArchiving.value = true
  try {
    await $fetch(`/api/pipelines/${pipelineToArchive.value.id}`, {
      method: 'DELETE',
      headers: useRequestHeaders(['cookie']),
    })
    toast.success(t('pipelines.toast.archived'))
    closeArchiveModal()
    await refresh()
  }
  catch (err: unknown) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? t('pipelines.toast.archived')
    toast.error(msg)
    closeArchiveModal()
  }
  finally {
    isArchiving.value = false
  }
}

// ── Clone ──
const cloningId = ref<string | null>(null)

async function handleClone(pipeline: PipelineListItem) {
  cloningId.value = pipeline.id
  try {
    await $fetch(`/api/pipelines/${pipeline.id}/clone`, {
      method: 'POST',
      body: {},
      headers: useRequestHeaders(['cookie']),
    })
    toast.success(t('pipelines.toast.cloned'))
    await refresh()
  }
  catch (err: unknown) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? 'Ошибка при клонировании'
    toast.error(msg)
  }
  finally {
    cloningId.value = null
  }
}

// ── Set default ──
const settingDefaultId = ref<string | null>(null)

async function handleSetDefault(pipeline: PipelineListItem) {
  settingDefaultId.value = pipeline.id
  try {
    await $fetch(`/api/pipelines/${pipeline.id}`, {
      method: 'PATCH',
      body: { isDefault: true },
      headers: useRequestHeaders(['cookie']),
    })
    toast.success(t('pipelines.toast.defaultSet'))
    await refresh()
  }
  catch (err: unknown) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? 'Ошибка при обновлении'
    toast.error(msg)
  }
  finally {
    settingDefaultId.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <!-- Page header -->
    <div class="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">
          {{ $t('pipelines.title') }}
        </h1>
        <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
          {{ $t('pipelines.description') }}
        </p>
      </div>

      <div class="flex items-center gap-3 flex-shrink-0">
        <!-- Show archived toggle -->
        <label class="inline-flex items-center gap-2 cursor-pointer select-none">
          <input
            v-model="showArchived"
            type="checkbox"
            class="size-4 rounded accent-brand-600 cursor-pointer"
          />
          <span class="text-sm text-surface-600 dark:text-surface-400">
            {{ $t('pipelines.showArchived') }}
          </span>
        </label>

        <!-- Create button -->
        <NuxtLink
          v-if="canCreatePipeline"
          :to="localePath('/dashboard/settings/pipelines/new')"
          class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors no-underline"
        >
          <Plus class="size-4" />
          {{ $t('pipelines.create') }}
        </NuxtLink>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="isLoading" class="space-y-3">
      <div
        v-for="i in 4"
        :key="i"
        class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 animate-pulse"
      >
        <div class="flex items-center justify-between">
          <div class="space-y-2 flex-1">
            <div class="h-4 w-40 rounded bg-surface-200 dark:bg-surface-800" />
            <div class="h-3 w-64 rounded bg-surface-200 dark:bg-surface-800" />
          </div>
          <div class="flex gap-2">
            <div class="h-7 w-16 rounded-lg bg-surface-200 dark:bg-surface-800" />
            <div class="h-7 w-16 rounded-lg bg-surface-200 dark:bg-surface-800" />
          </div>
        </div>
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="fetchError" class="rounded-xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/40 p-6 text-center">
      <AlertTriangle class="size-8 text-danger-400 mx-auto mb-2" />
      <p class="text-sm text-danger-700 dark:text-danger-400">
        Не удалось загрузить воронки.
      </p>
      <UiButton variant="link" size="sm" class="mt-2" @click="refresh">
        Повторить
      </UiButton>
    </div>

    <!-- Empty state (no pipelines at all) -->
    <div v-else-if="pipelines.length === 0" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-10 text-center">
      <GitBranch class="size-10 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
      <p class="text-sm text-surface-500 dark:text-surface-400">
        {{ $t('pipelines.emptyHint') }}
      </p>
      <NuxtLink
        v-if="canCreatePipeline"
        :to="localePath('/dashboard/settings/pipelines/new')"
        class="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors no-underline"
      >
        <Plus class="size-4" />
        {{ $t('pipelines.create') }}
      </NuxtLink>
    </div>

    <!-- Pipelines list -->
    <div v-else class="space-y-6">
      <!-- ── Основная (каноническая) воронка ── -->
      <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
      <div class="px-4 sm:px-6 py-3 border-b border-surface-100 dark:border-surface-800 bg-surface-50 dark:bg-surface-800/50">
        <p class="text-xs font-medium text-surface-600 dark:text-surface-300">Основная воронка</p>
        <p class="text-xs text-surface-400 dark:text-surface-500 mt-0.5">Каноническая воронка вакансий. Базовые этапы зафиксированы — можно добавлять подэтапы.</p>
      </div>

      <div class="divide-y divide-surface-100 dark:divide-surface-800">
        <div
          v-for="pipeline in mainPipelines"
          :key="pipeline.id"
          class="px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
          :class="pipeline.isArchived ? 'opacity-60' : ''"
        >
          <!-- Icon + Info -->
          <div class="flex items-start gap-3 flex-1 min-w-0">
            <div class="flex items-center justify-center size-9 shrink-0 rounded-lg bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 mt-0.5">
              <GitBranch class="size-4" />
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">
                  {{ pipeline.name }}
                </span>

                <!-- System badge -->
                <span
                  v-if="pipeline.isSystem"
                  class="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[10px] font-medium text-surface-500 dark:text-surface-400 border border-surface-200 dark:border-surface-700"
                >
                  {{ $t('pipelines.badges.system') }}
                </span>

                <!-- Default badge -->
                <span
                  v-if="pipeline.isDefault"
                  class="inline-flex items-center rounded-full bg-brand-50 dark:bg-brand-950/50 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800"
                >
                  {{ $t('pipelines.badges.default') }}
                </span>

                <!-- Archived badge -->
                <span
                  v-if="pipeline.isArchived"
                  class="inline-flex items-center rounded-full bg-warning-50 dark:bg-warning-950/40 px-2 py-0.5 text-[10px] font-medium text-warning-700 dark:text-warning-400 border border-warning-200 dark:border-warning-800"
                >
                  {{ $t('pipelines.badges.archived') }}
                </span>
              </div>

              <p v-if="pipeline.description" class="text-xs text-surface-500 dark:text-surface-400 mt-0.5 truncate">
                {{ pipeline.description }}
              </p>

              <div class="flex items-center gap-3 mt-1 text-xs text-surface-400 dark:text-surface-500">
                <span>{{ pipeline.stagesCount }} {{ $t('pipelines.list.stages').toLowerCase() }}</span>
                <span>{{ pipeline.jobsCount }} {{ $t('pipelines.list.jobs').toLowerCase() }}</span>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-1.5 flex-shrink-0 pl-12 sm:pl-0">
            <!-- Edit / Configure — B1/W1: каноническую (системную) воронку тоже
                 открываем в редакторе, чтобы ДОБАВЛЯТЬ подэтапы (базовые этапы там
                 read-only). Доступно только admin/owner (pipeline:update). -->
            <NuxtLink
              v-if="canUpdatePipeline"
              :to="localePath(`/dashboard/settings/pipelines/${pipeline.id}`)"
              class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors no-underline"
              :title="pipeline.isSystem ? 'Добавить подэтапы (базовые этапы зафиксированы)' : $t('pipelines.actions.edit')"
            >
              <Pencil class="size-3" />
              {{ pipeline.isSystem ? 'Настроить' : $t('pipelines.actions.edit') }}
            </NuxtLink>

            <!-- Clone -->
            <UiButton
              v-if="canCreatePipeline"
              variant="secondary"
              size="sm"
              :loading="cloningId === pipeline.id"
              :icon-left="Copy"
              :title="$t('pipelines.actions.clone')"
              @click="handleClone(pipeline)"
            >
              {{ $t('pipelines.actions.clone') }}
            </UiButton>

            <!-- Set as default — B3: только для канонической (системной) воронки -->
            <UiButton
              v-if="canUpdatePipeline && pipeline.isSystem && !pipeline.isDefault && !pipeline.isArchived"
              variant="secondary"
              size="sm"
              :loading="settingDefaultId === pipeline.id"
              :icon-left="Star"
              :title="$t('pipelines.actions.setDefault')"
              @click="handleSetDefault(pipeline)"
            >
              {{ $t('pipelines.actions.setDefault') }}
            </UiButton>

            <!-- Archive (non-system, non-archived only) -->
            <UiButton
              v-if="canDeletePipeline && !pipeline.isSystem && !pipeline.isArchived"
              variant="secondary"
              size="sm"
              :icon-left="Archive"
              class="border-danger-200 dark:border-danger-800 text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/40"
              :title="$t('pipelines.actions.archive')"
              @click="openArchiveModal(pipeline)"
            >
              {{ $t('pipelines.actions.archive') }}
            </UiButton>
          </div>
        </div>
      </div>
      </div>

      <!-- ── Экспериментальные воронки (песочница) ── -->
      <div v-if="sandboxPipelines.length > 0" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
        <div class="px-4 sm:px-6 py-3 border-b border-surface-100 dark:border-surface-800 bg-surface-50 dark:bg-surface-800/50">
          <p class="text-xs font-medium text-surface-600 dark:text-surface-300">Экспериментальные воронки</p>
          <p class="text-xs text-surface-400 dark:text-surface-500 mt-0.5">Песочница для экспериментов. Их нельзя назначить на вакансии или сделать основной.</p>
        </div>

        <div class="divide-y divide-surface-100 dark:divide-surface-800">
          <div
            v-for="pipeline in sandboxPipelines"
            :key="pipeline.id"
            class="px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
            :class="pipeline.isArchived ? 'opacity-60' : ''"
          >
            <div class="flex items-start gap-3 flex-1 min-w-0">
              <div class="flex items-center justify-center size-9 shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 mt-0.5">
                <GitBranch class="size-4" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{{ pipeline.name }}</span>
                  <span class="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[10px] font-medium text-surface-500 dark:text-surface-400 border border-surface-200 dark:border-surface-700">Эксперимент</span>
                  <span v-if="pipeline.isArchived" class="inline-flex items-center rounded-full bg-warning-50 dark:bg-warning-950/40 px-2 py-0.5 text-[10px] font-medium text-warning-700 dark:text-warning-400 border border-warning-200 dark:border-warning-800">{{ $t('pipelines.badges.archived') }}</span>
                </div>
                <p v-if="pipeline.description" class="text-xs text-surface-500 dark:text-surface-400 mt-0.5 truncate">{{ pipeline.description }}</p>
                <div class="flex items-center gap-3 mt-1 text-xs text-surface-400 dark:text-surface-500">
                  <span>{{ pipeline.stagesCount }} {{ $t('pipelines.list.stages').toLowerCase() }}</span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-1.5 flex-shrink-0 pl-12 sm:pl-0">
              <NuxtLink
                v-if="canUpdatePipeline"
                :to="localePath(`/dashboard/settings/pipelines/${pipeline.id}`)"
                class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors no-underline"
                :title="$t('pipelines.actions.edit')"
              >
                <Pencil class="size-3" />
                {{ $t('pipelines.actions.edit') }}
              </NuxtLink>
              <UiButton
                v-if="canDeletePipeline && !pipeline.isArchived"
                variant="secondary"
                size="sm"
                :icon-left="Archive"
                class="border-danger-200 dark:border-danger-800 text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/40"
                :title="$t('pipelines.actions.archive')"
                @click="openArchiveModal(pipeline)"
              >
                {{ $t('pipelines.actions.archive') }}
              </UiButton>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Archive confirmation modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-150"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="pipelineToArchive"
          class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          @click.self="closeArchiveModal"
        >
          <Transition
            enter-active-class="transition-all duration-200"
            leave-active-class="transition-all duration-150"
            enter-from-class="opacity-0 scale-95"
            leave-to-class="opacity-0 scale-95"
          >
            <div
              v-if="pipelineToArchive"
              class="w-full max-w-md bg-white dark:bg-surface-900 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-2xl p-6"
            >
              <div class="flex items-center gap-3 mb-4">
                <div class="flex items-center justify-center size-10 rounded-full bg-warning-100 dark:bg-warning-950 text-warning-600 dark:text-warning-400">
                  <Archive class="size-5" />
                </div>
                <div>
                  <h3 class="text-base font-semibold text-surface-900 dark:text-surface-100">
                    {{ $t('pipelines.actions.archive') }}
                  </h3>
                </div>
              </div>

              <p class="text-sm text-surface-600 dark:text-surface-400 mb-5">
                {{ $t('pipelines.confirmArchive', { name: pipelineToArchive.name }) }}
              </p>

              <div class="flex items-center gap-3 justify-end">
                <UiButton
                  variant="ghost"
                  @click="closeArchiveModal"
                >
                  {{ $t('common.cancel') }}
                </UiButton>
                <UiButton
                  :loading="isArchiving"
                  :icon-left="Archive"
                  class="bg-warning-600 border-warning-600 hover:bg-warning-700 text-white"
                  @click="handleArchive"
                >
                  {{ isArchiving ? 'Архивирование…' : $t('pipelines.actions.archive') }}
                </UiButton>
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
