<script setup lang="ts">
import {
  Plus, Loader2, AlertTriangle, GitBranch,
  Pencil, Copy, Archive, Star, RefreshCw,
} from 'lucide-vue-next'

definePageMeta({})

useSeoMeta({
  title: 'Воронки подбора — Reqcore',
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

// ── Only-system empty hint ──
const onlySystem = computed(() =>
  pipelines.value.length > 0 && pipelines.value.every(p => p.isSystem),
)

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

    <!-- Loading state -->
    <div v-if="isLoading" class="flex items-center justify-center py-12 text-surface-400">
      <Loader2 class="size-6 animate-spin mr-2" />
      <span class="text-sm">Загрузка…</span>
    </div>

    <!-- Error state -->
    <div v-else-if="fetchError" class="rounded-xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/40 p-6 text-center">
      <AlertTriangle class="size-8 text-danger-400 mx-auto mb-2" />
      <p class="text-sm text-danger-700 dark:text-danger-400">
        Не удалось загрузить воронки.
      </p>
      <button
        class="mt-2 text-sm text-brand-600 hover:text-brand-700 underline"
        @click="refresh"
      >
        Повторить
      </button>
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
    <div v-else class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
      <!-- Only-system hint -->
      <div v-if="onlySystem" class="px-4 sm:px-6 py-3 border-b border-surface-100 dark:border-surface-800 bg-surface-50 dark:bg-surface-800/50">
        <p class="text-xs text-surface-500 dark:text-surface-400">
          {{ $t('pipelines.emptyHint') }}
        </p>
      </div>

      <div class="divide-y divide-surface-100 dark:divide-surface-800">
        <div
          v-for="pipeline in pipelines"
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
            <!-- Edit -->
            <template v-if="canUpdatePipeline">
              <NuxtLink
                v-if="!pipeline.isSystem"
                :to="localePath(`/dashboard/settings/pipelines/${pipeline.id}`)"
                class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors no-underline"
                :title="$t('pipelines.actions.edit')"
              >
                <Pencil class="size-3" />
                {{ $t('pipelines.actions.edit') }}
              </NuxtLink>
              <button
                v-else
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-400 dark:text-surface-500 cursor-not-allowed opacity-60"
                :title="$t('pipelines.systemEditTooltip')"
                disabled
              >
                <Pencil class="size-3" />
                {{ $t('pipelines.actions.edit') }}
              </button>
            </template>

            <!-- Clone -->
            <button
              v-if="canCreatePipeline"
              type="button"
              :disabled="cloningId === pipeline.id"
              class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              :title="$t('pipelines.actions.clone')"
              @click="handleClone(pipeline)"
            >
              <Loader2 v-if="cloningId === pipeline.id" class="size-3 animate-spin" />
              <Copy v-else class="size-3" />
              {{ $t('pipelines.actions.clone') }}
            </button>

            <!-- Set as default -->
            <button
              v-if="canUpdatePipeline && !pipeline.isDefault && !pipeline.isArchived"
              type="button"
              :disabled="settingDefaultId === pipeline.id"
              class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              :title="$t('pipelines.actions.setDefault')"
              @click="handleSetDefault(pipeline)"
            >
              <Loader2 v-if="settingDefaultId === pipeline.id" class="size-3 animate-spin" />
              <Star v-else class="size-3" />
              {{ $t('pipelines.actions.setDefault') }}
            </button>

            <!-- Archive (non-system, non-archived only) -->
            <button
              v-if="canDeletePipeline && !pipeline.isSystem && !pipeline.isArchived"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-danger-200 dark:border-danger-800 bg-white dark:bg-surface-800 px-3 py-1.5 text-xs font-medium text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/40 transition-colors"
              :title="$t('pipelines.actions.archive')"
              @click="openArchiveModal(pipeline)"
            >
              <Archive class="size-3" />
              {{ $t('pipelines.actions.archive') }}
            </button>
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
                <button
                  class="rounded-lg px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                  @click="closeArchiveModal"
                >
                  {{ $t('common.cancel') }}
                </button>
                <button
                  :disabled="isArchiving"
                  class="inline-flex items-center gap-2 rounded-lg bg-warning-600 px-4 py-2 text-sm font-medium text-white hover:bg-warning-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="handleArchive"
                >
                  <Loader2 v-if="isArchiving" class="size-4 animate-spin" />
                  <Archive v-else class="size-4" />
                  {{ isArchiving ? 'Архивирование…' : $t('pipelines.actions.archive') }}
                </button>
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
