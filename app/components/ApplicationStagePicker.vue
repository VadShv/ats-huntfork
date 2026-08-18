<script setup lang="ts">
import { ChevronDown, Check, Loader2 } from 'lucide-vue-next'

/**
 * ApplicationStagePicker
 * Dropdown for moving an application between pipeline stages.
 * Opens a popover with the full stage list + optional comment field.
 */

const props = defineProps<{
  applicationId: string
  currentStageId: string | null
}>()

const emit = defineEmits<{
  'stage-changed': [{ newStageId: string; newStageName: string; newStageColor: string }]
  // Аудит синхронизации (Н-4): выбран этап типа «интервью» — родитель может открыть календарь планирования
  'interview-selected': [{ applicationId: string }]
}>()

const { t } = useI18n()
const toast = useToast()

// ── Stage list ────────────────────────────────────────────────────────────────

type StageItem = {
  id: string
  name: string
  color: string
  type: string
  displayOrder: number
  isTerminal: boolean
  isArchived: boolean
  isCurrent: boolean
  bucket?: 'working' | 'rejected'
  parentStageId?: string | null
  isHidden?: boolean
}

const stages = ref<StageItem[]>([])
const stagesLoading = ref(false)
const stagesError = ref(false)

async function loadStages() {
  stagesLoading.value = true
  stagesError.value = false
  try {
    const data = await $fetch<StageItem[]>(`/api/applications/${props.applicationId}/stages`)
    stages.value = data
  } catch {
    stagesError.value = true
  } finally {
    stagesLoading.value = false
  }
}

// ── Current stage display ─────────────────────────────────────────────────────

const currentStage = computed(() =>
  stages.value.find((s) => s.id === props.currentStageId) ?? null,
)

const noPipeline = computed(() => !stagesLoading.value && !stagesError.value && stages.value.length === 0)

// ── Dropdown state ────────────────────────────────────────────────────────────

const isOpen = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)

async function openDropdown() {
  if (noPipeline.value && stages.value.length === 0) {
    // Already loaded and no pipeline
    isOpen.value = !isOpen.value
    return
  }
  if (stages.value.length === 0) {
    await loadStages()
  }
  isOpen.value = !isOpen.value
}

function closeDropdown() {
  isOpen.value = false
  selectedStageId.value = null
  comment.value = ''
}

// Close on outside click
function handleOutsideClick(e: MouseEvent) {
  const target = e.target as Node
  if (
    isOpen.value
    && triggerRef.value
    && dropdownRef.value
    && !triggerRef.value.contains(target)
    && !dropdownRef.value.contains(target)
  ) {
    closeDropdown()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleOutsideClick)
  // Pre-load stages so dropdown opens instantly
  loadStages()
})
onUnmounted(() => document.removeEventListener('mousedown', handleOutsideClick))

// Re-load if applicationId changes
watch(() => props.applicationId, () => {
  stages.value = []
  loadStages()
})

// ── Stage selection flow ──────────────────────────────────────────────────────

const selectedStageId = ref<string | null>(null)
const comment = ref('')
const isMoving = ref(false)

const selectedStage = computed(() =>
  stages.value.find((s) => s.id === selectedStageId.value) ?? null,
)

function selectStage(stageId: string) {
  if (stageId === props.currentStageId) return
  // Спринт 22 (G3): родитель с подэтапами-причинами в блоке отказов не выбирается напрямую
  if (rejectParentIds.value.has(stageId)) return
  selectedStageId.value = stageId
}

// ── Спринт 22: guard-логика на клиенте ─────────────────────────────

/** Корневые отказные этапы, у которых есть активные подэтапы (выбор — только причина) */
const rejectParentIds = computed(() => {
  const ids = new Set<string>()
  for (const s of stages.value) {
    if (s.parentStageId && !s.isArchived && !s.isHidden) {
      const parent = stages.value.find((p) => p.id === s.parentStageId)
      if (parent && parent.bucket === 'rejected') ids.add(parent.id)
    }
  }
  return ids
})

/** G1: возврат из терминального этапа в работу — обязательный комментарий */
const returnToWorkRequiresComment = computed(() =>
  Boolean(currentStage.value?.isTerminal && selectedStage.value && !selectedStage.value.isTerminal),
)

/** G2: перевод в «Нанят» — явное подтверждение */
const isHireMove = computed(() => selectedStage.value?.type === 'hired')

const moveBlocked = computed(() =>
  returnToWorkRequiresComment.value && !comment.value.trim(),
)

async function confirmMove() {
  if (!selectedStageId.value || !selectedStage.value) return
  if (moveBlocked.value) return
  isMoving.value = true
  try {
    const res = await $fetch<{ currentStageParentName?: string | null }>(
      `/api/applications/${props.applicationId}/stage`,
      {
        method: 'PATCH',
        body: {
          stageId: selectedStageId.value,
          ...(comment.value.trim() ? { comment: comment.value.trim() } : {}),
        },
      },
    )

    const name = res?.currentStageParentName
      ? `${res.currentStageParentName} / ${selectedStage.value.name}`
      : selectedStage.value.name
    const color = selectedStage.value.color
    const movedType = selectedStage.value.type
    const newStageId = selectedStageId.value

    emit('stage-changed', { newStageId, newStageName: selectedStage.value.name, newStageColor: color })
    if (movedType === 'interview') {
      emit('interview-selected', { applicationId: props.applicationId })
    }
    toast.success(t('applications.stage.movedToast', { name }))

    // Update local stages list so isCurrent refreshes
    stages.value = stages.value.map((s) => ({ ...s, isCurrent: s.id === newStageId }))
    closeDropdown()
  } catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }; data?: { statusCode?: number } }
    toast.error(t('applications.stage.move'), {
      message: (err as { data?: { statusMessage?: string } })?.data?.statusMessage,
    })
  } finally {
    isMoving.value = false
  }
}

// ── Visible (non-archived) stages for the dropdown ────────────────────────────
const visibleStages = computed(() => {
  const active = stages.value.filter((s) => !s.isArchived && !s.isHidden)
  const roots = active.filter((s) => !s.parentStageId).sort((a, b) => a.displayOrder - b.displayOrder)
  const result: Array<StageItem & { isSubstage: boolean }> = []
  for (const root of roots) {
    result.push({ ...root, isSubstage: false })
    const children = active
      .filter((s) => s.parentStageId === root.id)
      .sort((a, b) => a.displayOrder - b.displayOrder)
    for (const child of children) result.push({ ...child, isSubstage: true })
  }
  return result
})
</script>

<template>
  <div class="relative inline-block">
    <!-- Trigger button -->
    <button
      ref="triggerRef"
      type="button"
      class="inline-flex items-center gap-1.5 rounded-full border text-xs font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
      :class="noPipeline
        ? 'cursor-not-allowed border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-2.5 py-0.5 text-surface-400 dark:text-surface-500'
        : 'cursor-pointer border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2.5 py-0.5 text-surface-700 dark:text-surface-200 hover:border-surface-300 dark:hover:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800'"
      :title="noPipeline ? t('applications.stage.noPipeline') : t('applications.stage.moveTo')"
      :disabled="noPipeline"
      @click="openDropdown"
    >
      <!-- Loading spinner while stage list is fetching -->
      <Loader2 v-if="stagesLoading && !currentStage" class="size-3 animate-spin text-surface-400" />

      <!-- Current stage dot + name -->
      <template v-else>
        <span
          v-if="currentStage"
          class="size-1.5 rounded-full shrink-0"
          :style="{ backgroundColor: currentStage.color }"
        />
        <span v-else class="size-1.5 rounded-full bg-surface-300 dark:bg-surface-600 shrink-0" />
        <span class="truncate max-w-[140px]">
          {{ currentStage ? currentStage.name : t('applications.stage.label') }}
        </span>
      </template>

      <ChevronDown
        v-if="!noPipeline"
        class="size-3 text-surface-400 shrink-0 transition-transform duration-150"
        :class="isOpen ? 'rotate-180' : ''"
      />
    </button>

    <!-- Dropdown -->
    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="isOpen"
        ref="dropdownRef"
        class="absolute left-0 top-full mt-1.5 z-30 w-64 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl shadow-surface-900/5 dark:shadow-black/30 origin-top-left"
      >
        <!-- Header -->
        <div class="px-3 pt-3 pb-1.5 border-b border-surface-100 dark:border-surface-800">
          <p class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide">
            {{ t('applications.stage.moveTo') }}
          </p>
        </div>

        <!-- Stage list -->
        <div class="py-1.5 max-h-52 overflow-y-auto">
          <div v-if="stagesLoading" class="px-3 py-4 text-center text-xs text-surface-400">
            <Loader2 class="size-4 animate-spin mx-auto mb-1" />
          </div>
          <div v-else-if="stagesError" class="px-3 py-3 text-xs text-danger-600">
            Не удалось загрузить этапы
          </div>
          <div v-else-if="visibleStages.length === 0" class="px-3 py-3 text-xs text-surface-400">
            Нет доступных этапов
          </div>
          <button
            v-for="stage in visibleStages"
            :key="stage.id"
            type="button"
            class="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors"
            :class="[
              stage.isSubstage ? 'pl-7' : '',
              stage.isCurrent
                ? 'text-surface-400 dark:text-surface-500 cursor-default'
                : rejectParentIds.has(stage.id)
                  ? 'text-surface-400 dark:text-surface-500 cursor-default'
                  : selectedStageId === stage.id
                    ? 'bg-brand-50 dark:bg-brand-950/30 text-surface-900 dark:text-surface-100 cursor-pointer'
                    : 'text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800 cursor-pointer',
            ]"
            :disabled="stage.isCurrent || rejectParentIds.has(stage.id)"
            :title="rejectParentIds.has(stage.id) ? 'Выберите причину отказа ниже' : undefined"
            @click="selectStage(stage.id)"
          >
            <span
              class="size-2 rounded-full shrink-0"
              :style="{ backgroundColor: stage.color }"
            />
            <span class="flex-1 text-left truncate" :class="stage.isSubstage ? '' : 'font-medium'">{{ stage.name }}</span>
            <Check
              v-if="stage.isCurrent"
              class="size-3 text-surface-400 shrink-0"
            />
            <span
              v-else-if="selectedStageId === stage.id"
              class="size-3 rounded-full bg-brand-500 shrink-0"
            />
          </button>
        </div>

        <!-- Comment + confirm -->
        <div
          v-if="selectedStageId"
          class="border-t border-surface-100 dark:border-surface-800 p-3 space-y-2"
        >
          <p
            v-if="returnToWorkRequiresComment"
            class="text-[11px] leading-snug text-amber-600 dark:text-amber-400"
          >
            Возврат из отказа в работу — укажите причину в комментарии
          </p>
          <p
            v-else-if="isHireMove"
            class="text-[11px] leading-snug text-emerald-600 dark:text-emerald-400"
          >
            Кандидат будет отмечен как нанятый — это финальный этап
          </p>
          <textarea
            v-model="comment"
            rows="2"
            :placeholder="returnToWorkRequiresComment ? 'Причина возврата в работу (обязательно)' : t('applications.stage.commentPlaceholder')"
            class="w-full rounded-lg border bg-white dark:bg-surface-800 px-2.5 py-1.5 text-xs text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-none transition-colors"
            :class="returnToWorkRequiresComment && !comment.trim()
              ? 'border-amber-400 dark:border-amber-600'
              : 'border-surface-200 dark:border-surface-700'"
            :disabled="isMoving"
          />
          <button
            type="button"
            :disabled="isMoving || moveBlocked"
            class="w-full rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            :class="isHireMove ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-brand-600 hover:bg-brand-700'"
            @click="confirmMove"
          >
            <Loader2 v-if="isMoving" class="size-3 animate-spin mx-auto" />
            <span v-else>{{ isHireMove ? 'Подтвердить найм' : t('applications.stage.move') }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
