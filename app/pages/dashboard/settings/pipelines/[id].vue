<script setup lang="ts">
import {
  ArrowLeft, Loader2, Lock, EyeOff, Eye, Trash2, Plus,
  Briefcase, Users, GripVertical, ChevronDown, ChevronRight,
  AlertTriangle, Settings,
} from 'lucide-vue-next'

definePageMeta({})

const route = useRoute()
const toast = useToast()
const localePath = useLocalePath()

const pipelineId = computed(() => route.params.id as string)

interface StageDto {
  id: string
  name: string
  description: string | null
  type: string
  bucket: 'working' | 'rejected'
  color: string
  displayOrder: number
  isTerminal: boolean
  isArchived: boolean
  isSystemStage: boolean
  isHidden: boolean
  parentStageId: string | null
}

interface PipelineDetail {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  isDefault: boolean
  isArchived: boolean
  jobsCount: number
  activeApplicationsCount: number
  stages: StageDto[]
}

const { data: pipeline, status, refresh } = useFetch<PipelineDetail>(
  () => `/api/pipelines/${pipelineId.value}`,
  { headers: useRequestHeaders(['cookie']) },
)

useSeoMeta({
  title: computed(() => pipeline.value ? `${pipeline.value.name} — Воронка` : 'Воронка'),
})

const isLoading = computed(() => status.value === 'pending')

// ── Tab state ─────────────────────────────────────────────
type TabKey = 'working' | 'rejected'
const activeTab = ref<TabKey>('working')

// Активные (не архивные) этапы верхнего уровня, разделённые по bucket
const stagesByBucket = computed(() => {
  const stages = pipeline.value?.stages ?? []
  const topLevel = stages.filter((s) => !s.isArchived && !s.parentStageId)
  const substagesByParent = new Map<string, StageDto[]>()
  for (const s of stages.filter((s) => !s.isArchived && s.parentStageId)) {
    const arr = substagesByParent.get(s.parentStageId!) ?? []
    arr.push(s)
    substagesByParent.set(s.parentStageId!, arr)
  }

  const working = topLevel.filter((s) => s.bucket === 'working').sort((a, b) => a.displayOrder - b.displayOrder)
  const rejected = topLevel.filter((s) => s.bucket === 'rejected').sort((a, b) => a.displayOrder - b.displayOrder)

  return {
    working: working.map((s) => ({ ...s, substages: (substagesByParent.get(s.id) ?? []).sort((a, b) => a.displayOrder - b.displayOrder) })),
    rejected: rejected.map((s) => ({ ...s, substages: (substagesByParent.get(s.id) ?? []).sort((a, b) => a.displayOrder - b.displayOrder) })),
  }
})

const currentStages = computed(() => stagesByBucket.value[activeTab.value])

// ── Actions ───────────────────────────────────────────────
const busyStageId = ref<string | null>(null)

// ── Спринт 11.3: Drag-and-drop этапов ──────────────────────────
// Перетаскивать можно только пользовательские (не базовые) этапы
// верхнего уровня в пределах активного таба. Базовые — зафиксированы.
const draggingStageId = ref<string | null>(null)
const dragOverStageId = ref<string | null>(null)

function onStageDragStart(stage: StageDto, e: DragEvent) {
  if (stage.isSystemStage) {
    e.preventDefault()
    return
  }
  draggingStageId.value = stage.id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', stage.id)
  }
}

function onStageDragOver(stage: StageDto, e: DragEvent) {
  if (!draggingStageId.value || draggingStageId.value === stage.id) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverStageId.value = stage.id
}

function onStageDragLeave(stage: StageDto) {
  if (dragOverStageId.value === stage.id) dragOverStageId.value = null
}

function onStageDragEnd() {
  draggingStageId.value = null
  dragOverStageId.value = null
}

async function onStageDrop(target: StageDto, e: DragEvent) {
  e.preventDefault()
  const sourceId = draggingStageId.value
  draggingStageId.value = null
  dragOverStageId.value = null
  if (!sourceId || sourceId === target.id) return

  const source = currentStages.value.find((s) => s.id === sourceId)
  if (!source || source.isSystemStage) return

  busyStageId.value = sourceId
  try {
    await $fetch(`/api/pipelines/${pipelineId.value}/stages/${sourceId}`, {
      method: 'PATCH',
      body: { displayOrder: target.displayOrder },
    })
    toast.add({ title: 'Порядок этапов обновлён', color: 'success' })
    await refresh()
  } catch (e2: unknown) {
    const err = e2 as { data?: { statusMessage?: string }, message?: string }
    toast.add({
      title: 'Не удалось переместить этап',
      description: err.data?.statusMessage ?? err.message,
      color: 'error',
    })
  } finally {
    busyStageId.value = null
  }
}

async function toggleHide(stage: StageDto & { substages?: StageDto[] }) {
  busyStageId.value = stage.id
  try {
    await $fetch(`/api/pipelines/${pipelineId.value}/stages/${stage.id}`, {
      method: 'PATCH',
      body: { isHidden: !stage.isHidden },
    })
    toast.add({
      title: stage.isHidden ? 'Этап показан' : 'Этап скрыт',
      color: 'success',
    })
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }, message?: string }
    toast.add({
      title: 'Ошибка',
      description: err.data?.statusMessage ?? err.message ?? 'Не удалось изменить видимость',
      color: 'error',
    })
  } finally {
    busyStageId.value = null
  }
}

async function deleteStage(stage: StageDto) {
  if (stage.isSystemStage) return
  if (!confirm(`Удалить этап «${stage.name}»? Действие мягкое — этап архивируется.`)) return

  busyStageId.value = stage.id
  try {
    await $fetch(`/api/pipelines/${pipelineId.value}/stages/${stage.id}`, {
      method: 'DELETE',
    })
    toast.add({ title: 'Этап удалён', color: 'success' })
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }, message?: string }
    toast.add({
      title: 'Не удалось удалить',
      description: err.data?.statusMessage ?? err.message,
      color: 'error',
    })
  } finally {
    busyStageId.value = null
  }
}

// ── Add-substage modal ───────────────────────────────────
const showAddSubstage = ref(false)
const substageParentId = ref<string | null>(null)
const substageName = ref('')
const substageBusy = ref(false)

function openAddSubstage(parentId: string) {
  substageParentId.value = parentId
  substageName.value = ''
  showAddSubstage.value = true
}

async function submitSubstage() {
  if (!substageName.value.trim() || !substageParentId.value) return
  substageBusy.value = true
  try {
    await $fetch(`/api/pipelines/${pipelineId.value}/stages`, {
      method: 'POST',
      body: {
        name: substageName.value.trim(),
        type: 'custom',
        parentStageId: substageParentId.value,
      },
    })
    toast.add({ title: 'Подстатус добавлен', color: 'success' })
    showAddSubstage.value = false
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }, message?: string }
    toast.add({
      title: 'Не удалось добавить',
      description: err.data?.statusMessage ?? err.message,
      color: 'error',
    })
  } finally {
    substageBusy.value = false
  }
}

// ── Add-stage modal ──────────────────────────────────────
const showAddStage = ref(false)
const newStageName = ref('')
const newStageBusy = ref(false)

async function submitNewStage() {
  if (!newStageName.value.trim()) return
  newStageBusy.value = true
  try {
    await $fetch(`/api/pipelines/${pipelineId.value}/stages`, {
      method: 'POST',
      body: {
        name: newStageName.value.trim(),
        type: 'custom',
        bucket: activeTab.value,
        isTerminal: activeTab.value === 'rejected',
      },
    })
    toast.add({ title: 'Этап добавлен', color: 'success' })
    showAddStage.value = false
    newStageName.value = ''
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }, message?: string }
    toast.add({
      title: 'Не удалось добавить',
      description: err.data?.statusMessage ?? err.message,
      color: 'error',
    })
  } finally {
    newStageBusy.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <!-- Header -->
    <div class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
      <div class="max-w-6xl mx-auto flex items-center gap-4">
        <NuxtLink
          :to="localePath('/dashboard/settings/pipelines')"
          class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
        >
          <ArrowLeft class="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </NuxtLink>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-3">
            <h1 class="text-2xl font-semibold text-gray-900 dark:text-white truncate">
              {{ pipeline?.name ?? 'Загрузка…' }}
            </h1>
            <span
              v-if="pipeline?.isSystem"
              class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
            >
              <Lock class="w-3 h-3" /> Системная
            </span>
            <span
              v-if="pipeline?.isDefault"
              class="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
            >
              По умолчанию
            </span>
          </div>
          <p v-if="pipeline?.description" class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {{ pipeline.description }}
          </p>
        </div>

        <div class="flex items-center gap-6 text-sm">
          <div class="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
            <Briefcase class="w-4 h-4" />
            <span>{{ pipeline?.jobsCount ?? 0 }} вакансий</span>
          </div>
          <div class="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
            <Users class="w-4 h-4" />
            <span>{{ pipeline?.activeApplicationsCount ?? 0 }} активных</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div v-if="isLoading" class="max-w-6xl mx-auto py-24 flex justify-center">
      <Loader2 class="w-8 h-8 text-gray-400 animate-spin" />
    </div>

    <div v-else-if="pipeline" class="max-w-6xl mx-auto px-6 py-8">
      <!-- Tabs -->
      <div class="flex items-center gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          class="px-6 py-3 text-sm font-medium border-b-2 -mb-px transition-colors"
          :class="activeTab === 'working'
            ? 'border-brand-600 text-brand-600 dark:text-brand-400'
            : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'"
          @click="activeTab = 'working'"
        >
          В работе
          <span class="ml-2 text-xs opacity-70">({{ stagesByBucket.working.length }})</span>
        </button>
        <button
          type="button"
          class="px-6 py-3 text-sm font-medium border-b-2 -mb-px transition-colors"
          :class="activeTab === 'rejected'
            ? 'border-brand-600 text-brand-600 dark:text-brand-400'
            : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'"
          @click="activeTab = 'rejected'"
        >
          Отказы
          <span class="ml-2 text-xs opacity-70">({{ stagesByBucket.rejected.length }})</span>
        </button>
      </div>

      <!-- Stage list -->
      <div class="space-y-3">
        <div
          v-for="stage in currentStages"
          :key="stage.id"
          class="bg-white dark:bg-gray-800 rounded-xl border overflow-hidden transition-all"
          :class="[
            stage.isHidden ? 'opacity-60' : '',
            dragOverStageId === stage.id
              ? 'border-blue-500 ring-2 ring-blue-500/40'
              : 'border-gray-200 dark:border-gray-700',
            draggingStageId === stage.id ? 'opacity-40' : '',
          ]"
          :draggable="!stage.isSystemStage"
          @dragstart="onStageDragStart(stage, $event)"
          @dragover="onStageDragOver(stage, $event)"
          @dragleave="onStageDragLeave(stage)"
          @drop="onStageDrop(stage, $event)"
          @dragend="onStageDragEnd"
        >
          <!-- Parent stage row -->
          <div class="flex items-center gap-3 px-5 py-4">
            <Lock
              v-if="stage.isSystemStage"
              class="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0"
              title="Базовый этап зафиксирован — перемещение недоступно"
            />
            <GripVertical
              v-else
              class="w-4 h-4 text-gray-400 dark:text-gray-500 cursor-grab active:cursor-grabbing flex-shrink-0"
              title="Перетащите, чтобы изменить порядок"
            />

            <div
              class="w-2.5 h-2.5 rounded-full flex-shrink-0"
              :style="{ backgroundColor: stage.color }"
            />

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-gray-900 dark:text-white">{{ stage.name }}</span>
                <span
                  v-if="stage.isSystemStage"
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                  title="Базовый этап — переименовать/удалить нельзя"
                >
                  <Lock class="w-2.5 h-2.5" /> базовый
                </span>
                <span
                  v-if="stage.isHidden"
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                >
                  <EyeOff class="w-2.5 h-2.5" /> скрыт
                </span>
                <span
                  v-if="stage.isTerminal"
                  class="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                >
                  финал
                </span>
              </div>
              <p v-if="stage.description" class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {{ stage.description }}
              </p>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-1">
              <button
                type="button"
                :disabled="busyStageId === stage.id"
                class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-500 dark:text-gray-400 disabled:opacity-40"
                :title="stage.isHidden ? 'Показать' : 'Скрыть'"
                @click="toggleHide(stage)"
              >
                <component :is="stage.isHidden ? Eye : EyeOff" class="w-4 h-4" />
              </button>

              <button
                v-if="!stage.isSystemStage"
                type="button"
                :disabled="busyStageId === stage.id"
                class="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-red-500 disabled:opacity-40"
                title="Удалить"
                @click="deleteStage(stage)"
              >
                <Trash2 class="w-4 h-4" />
              </button>

              <button
                v-if="activeTab === 'working'"
                type="button"
                class="ml-2 flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors text-gray-700 dark:text-gray-300"
                @click="openAddSubstage(stage.id)"
              >
                <Plus class="w-3 h-3" /> Подстатус
              </button>
            </div>
          </div>

          <!-- Substages -->
          <div
            v-if="stage.substages?.length"
            class="border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30"
          >
            <div
              v-for="sub in stage.substages"
              :key="sub.id"
              class="flex items-center gap-3 pl-12 pr-5 py-2.5"
              :class="{ 'opacity-60': sub.isHidden }"
            >
              <ChevronRight class="w-3 h-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />

              <div
                class="w-2 h-2 rounded-full flex-shrink-0"
                :style="{ backgroundColor: sub.color }"
              />

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm text-gray-800 dark:text-gray-200">{{ sub.name }}</span>
                  <span
                    v-if="sub.isSystemStage"
                    class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                  >
                    базовый
                  </span>
                  <span
                    v-if="sub.isHidden"
                    class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                  >
                    скрыт
                  </span>
                </div>
              </div>

              <div class="flex items-center gap-1">
                <button
                  type="button"
                  :disabled="busyStageId === sub.id"
                  class="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors text-gray-500 dark:text-gray-400 disabled:opacity-40"
                  @click="toggleHide(sub)"
                >
                  <component :is="sub.isHidden ? Eye : EyeOff" class="w-3.5 h-3.5" />
                </button>
                <button
                  v-if="!sub.isSystemStage"
                  type="button"
                  :disabled="busyStageId === sub.id"
                  class="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors text-red-500 disabled:opacity-40"
                  @click="deleteStage(sub)"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Add stage button -->
        <button
          type="button"
          class="w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-gray-500 dark:text-gray-400 hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50/40 dark:hover:bg-brand-900/10 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
          @click="showAddStage = true"
        >
          <Plus class="w-4 h-4" />
          Добавить этап в раздел «{{ activeTab === 'working' ? 'В работе' : 'Отказы' }}»
        </button>
      </div>

      <!-- Info for system pipelines -->
      <div
        v-if="pipeline.isSystem"
        class="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl flex gap-3"
      >
        <AlertTriangle class="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
        <div class="text-sm text-blue-800 dark:text-blue-200">
          <p class="font-medium">Это системная воронка</p>
          <p class="mt-1 opacity-80">
            Базовые этапы (помечены значком «базовый») зафиксированы: их нельзя удалять, переименовывать или перемещать — только скрывать.
            Свои этапы и подстатусы можно добавлять и перетаскивать за ручку.
            Для полной переработки клонируйте воронку.
          </p>
        </div>
      </div>
    </div>

    <!-- Add substage modal -->
    <div
      v-if="showAddSubstage"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="showAddSubstage = false"
    >
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Новый подстатус</h3>
        <input
          v-model="substageName"
          type="text"
          placeholder="Название подстатуса"
          maxlength="50"
          class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          @keyup.enter="submitSubstage"
        >
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            @click="showAddSubstage = false"
          >
            Отмена
          </button>
          <button
            type="button"
            :disabled="!substageName.trim() || substageBusy"
            class="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:cursor-not-allowed"
            style="background-color: rgb(37 99 235); border: 1px solid rgb(37 99 235);"
            :style="{ opacity: (!substageName.trim() || substageBusy) ? 0.5 : 1 }"
            @click="submitSubstage"
          >
            {{ substageBusy ? 'Сохраняю…' : 'Добавить' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Add stage modal -->
    <div
      v-if="showAddStage"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="showAddStage = false"
    >
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">Новый этап</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Добавить в раздел «{{ activeTab === 'working' ? 'В работе' : 'Отказы' }}»
        </p>
        <input
          v-model="newStageName"
          type="text"
          placeholder="Название этапа"
          maxlength="50"
          class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          @keyup.enter="submitNewStage"
        >
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            @click="showAddStage = false"
          >
            Отмена
          </button>
          <button
            type="button"
            :disabled="!newStageName.trim() || newStageBusy"
            class="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:cursor-not-allowed"
            style="background-color: rgb(37 99 235); border: 1px solid rgb(37 99 235);"
            :style="{ opacity: (!newStageName.trim() || newStageBusy) ? 0.5 : 1 }"
            @click="submitNewStage"
          >
            {{ newStageBusy ? 'Сохраняю…' : 'Добавить' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
