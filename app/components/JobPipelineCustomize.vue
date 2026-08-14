<script setup lang="ts">
/**
 * JobPipelineCustomize — per-vacancy кастомизация воронки.
 *
 * Открывается на странице настроек вакансии. Позволяет:
 * - скрыть/показать отдельные этапы (в т.ч. системные)
 * - добавить кастомные подстатусы (пока не в первой итерации UI, только в API)
 * - сбросить всю кастомизацию (вернуться к живой воронке)
 *
 * Отделено от глобальных настроек воронки — тюнинг работает только на этой вакансии.
 */

import { Lock, EyeOff, Eye, RotateCcw, Loader2, AlertTriangle } from 'lucide-vue-next'

const props = defineProps<{
  jobId: string
}>()

const toast = useToast()

interface StageDto {
  id: string
  name: string
  description: string | null
  type: string
  bucket: 'working' | 'rejected'
  color: string
  displayOrder: number
  isTerminal: boolean
  isSystemStage: boolean
  isHidden: boolean
  parentStageId: string | null
}

interface PipelineViewResponse {
  source: 'live' | 'snapshot' | 'none'
  pipeline: { id: string, name: string } | null
  stages: StageDto[]
}

const { data: view, refresh, status } = useFetch<PipelineViewResponse>(
  () => `/api/jobs/${props.jobId}/pipeline-view`,
  { headers: useRequestHeaders(['cookie']) },
)

const isLoading = computed(() => status.value === 'pending')

// Local editable copy of stages
const editStages = ref<StageDto[]>([])
const isDirty = ref(false)
const isSaving = ref(false)

watch(view, (v) => {
  if (v?.stages) {
    editStages.value = JSON.parse(JSON.stringify(v.stages))
    isDirty.value = false
  }
}, { immediate: true })

function toggleHide(stage: StageDto) {
  stage.isHidden = !stage.isHidden
  isDirty.value = true
}

// Группировка по bucket + иерархия
const grouped = computed(() => {
  const stages = editStages.value
  const topLevel = stages.filter((s) => !s.parentStageId)
  const substagesByParent = new Map<string, StageDto[]>()
  for (const s of stages.filter((s) => s.parentStageId)) {
    const arr = substagesByParent.get(s.parentStageId!) ?? []
    arr.push(s)
    substagesByParent.set(s.parentStageId!, arr)
  }

  const withSubs = (list: StageDto[]) =>
    list.sort((a, b) => a.displayOrder - b.displayOrder)
      .map((s) => ({
        ...s,
        substages: (substagesByParent.get(s.id) ?? []).sort((a, b) => a.displayOrder - b.displayOrder),
      }))

  return {
    working: withSubs(topLevel.filter((s) => s.bucket === 'working')),
    rejected: withSubs(topLevel.filter((s) => s.bucket === 'rejected')),
  }
})

async function saveSnapshot() {
  isSaving.value = true
  try {
    await $fetch(`/api/jobs/${props.jobId}/pipeline-snapshot`, {
      method: 'PUT',
      body: {
        stages: editStages.value.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description ?? null,
          type: s.type,
          bucket: s.bucket,
          color: s.color,
          displayOrder: s.displayOrder,
          isTerminal: s.isTerminal,
          isSystemStage: s.isSystemStage,
          isHidden: s.isHidden,
          parentStageId: s.parentStageId,
        })),
      },
    })
    toast.add({ title: 'Настройка воронки сохранена', color: 'success' })
    await refresh()
    isDirty.value = false
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }, message?: string }
    toast.add({
      title: 'Не удалось сохранить',
      description: err.data?.statusMessage ?? err.message,
      color: 'error',
    })
  } finally {
    isSaving.value = false
  }
}

async function resetToBase() {
  if (!confirm('Сбросить настройки воронки этой вакансии? Вакансия вернётся к базовой воронке.')) return
  isSaving.value = true
  try {
    await $fetch(`/api/jobs/${props.jobId}/pipeline-snapshot`, { method: 'DELETE' })
    toast.add({ title: 'Настройки сброшены', color: 'success' })
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }, message?: string }
    toast.add({
      title: 'Не удалось сбросить',
      description: err.data?.statusMessage ?? err.message,
      color: 'error',
    })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
    <div class="flex items-start justify-between mb-4">
      <div>
        <h3 class="text-base font-semibold text-gray-900 dark:text-white">Воронка вакансии</h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Скройте этапы, которые не нужны для этой вакансии. Настройки локальные и не влияют на другие вакансии.
        </p>
      </div>

      <div v-if="view?.source === 'snapshot'" class="text-xs px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 flex items-center gap-1">
        <AlertTriangle class="w-3 h-3" /> Кастомизировано
      </div>
    </div>

    <div v-if="isLoading" class="py-12 flex justify-center">
      <Loader2 class="w-6 h-6 text-gray-400 animate-spin" />
    </div>

    <div v-else-if="view?.source === 'none'" class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
      У вакансии не назначена воронка. Сначала выберите воронку в настройках вакансии.
    </div>

    <div v-else class="space-y-6">
      <!-- Working -->
      <div>
        <div class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">В работе</div>
        <div class="space-y-1">
          <template v-for="stage in grouped.working" :key="stage.id">
            <label
              class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
              :class="{ 'opacity-60': stage.isHidden }"
            >
              <input
                type="checkbox"
                :checked="!stage.isHidden"
                class="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
                @change="toggleHide(stage)"
              >
              <div class="w-2 h-2 rounded-full" :style="{ backgroundColor: stage.color }" />
              <span class="flex-1 text-sm text-gray-900 dark:text-white">{{ stage.name }}</span>
              <span v-if="stage.isSystemStage" class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 flex items-center gap-0.5">
                <Lock class="w-2.5 h-2.5" /> базовый
              </span>
            </label>

            <!-- Substages -->
            <div v-if="stage.substages.length" class="ml-7 space-y-1">
              <label
                v-for="sub in stage.substages"
                :key="sub.id"
                class="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                :class="{ 'opacity-60': sub.isHidden }"
              >
                <input
                  type="checkbox"
                  :checked="!sub.isHidden"
                  class="w-3.5 h-3.5 text-brand-600 rounded focus:ring-brand-500"
                  @change="toggleHide(sub)"
                >
                <div class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: sub.color }" />
                <span class="flex-1 text-xs text-gray-700 dark:text-gray-300">{{ sub.name }}</span>
              </label>
            </div>
          </template>
        </div>
      </div>

      <!-- Rejected -->
      <div>
        <div class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Отказы</div>
        <div class="space-y-1">
          <label
            v-for="stage in grouped.rejected"
            :key="stage.id"
            class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
            :class="{ 'opacity-60': stage.isHidden }"
          >
            <input
              type="checkbox"
              :checked="!stage.isHidden"
              class="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
              @change="toggleHide(stage)"
            >
            <div class="w-2 h-2 rounded-full" :style="{ backgroundColor: stage.color }" />
            <span class="flex-1 text-sm text-gray-900 dark:text-white">{{ stage.name }}</span>
            <span v-if="stage.isSystemStage" class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 flex items-center gap-0.5">
              <Lock class="w-2.5 h-2.5" /> базовый
            </span>
          </label>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          v-if="view?.source === 'snapshot'"
          type="button"
          :disabled="isSaving"
          class="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-40"
          @click="resetToBase"
        >
          <RotateCcw class="w-4 h-4" />
          Сбросить к базовой
        </button>
        <div v-else />

        <button
          type="button"
          :disabled="!isDirty || isSaving"
          class="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
          @click="saveSnapshot"
        >
          <Loader2 v-if="isSaving" class="w-4 h-4 animate-spin" />
          {{ isSaving ? 'Сохраняю…' : 'Сохранить' }}
        </button>
      </div>
    </div>
  </div>
</template>
