<script setup lang="ts">
import {
  ChevronUp, ChevronDown, Trash2, RotateCcw, GripVertical,
} from 'lucide-vue-next'

export interface PipelineStage {
  id?: string
  name: string
  description?: string
  type: 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'custom'
  isTerminal: boolean
  isArchived?: boolean
}

const props = withDefaults(defineProps<{
  modelValue: PipelineStage[]
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [stages: PipelineStage[]]
}>()

const { t } = useI18n()

// ── Stage type color map ──
const typeColors: Record<PipelineStage['type'], string> = {
  applied: '#94a3b8',
  screening: '#3b82f6',
  interview: '#a855f7',
  offer: '#eab308',
  hired: '#10b981',
  rejected: '#ef4444',
  custom: '#06b6d4',
}

// ── Stage type name suggestions (when name is empty after type change) ──
const typeSuggestions: Record<PipelineStage['type'], string> = {
  applied: t('pipelines.stageType.applied'),
  screening: t('pipelines.stageType.screening'),
  interview: t('pipelines.stageType.interview'),
  offer: t('pipelines.stageType.offer'),
  hired: t('pipelines.stageType.hired'),
  rejected: t('pipelines.stageType.rejected'),
  custom: '',
}

// ── Auto-terminal types (locked on) ──
const autoTerminalTypes: PipelineStage['type'][] = ['hired', 'rejected']

// ── Type select options ──
const typeOptions = [
  { value: 'applied', label: t('pipelines.stageType.applied') },
  { value: 'screening', label: t('pipelines.stageType.screening') },
  { value: 'interview', label: t('pipelines.stageType.interview') },
  { value: 'offer', label: t('pipelines.stageType.offer') },
  { value: 'hired', label: t('pipelines.stageType.hired') },
  { value: 'rejected', label: t('pipelines.stageType.rejected') },
  { value: 'custom', label: t('pipelines.stageType.custom') },
] as const

// ── Active stages for validation ──
const activeStages = computed(() => props.modelValue.filter(s => !s.isArchived))

// ── Validation ──
const hasSuccessTerminal = computed(() =>
  activeStages.value.some(s => s.type === 'hired' && s.isTerminal),
)

const hasRejectTerminal = computed(() =>
  activeStages.value.some(s => s.type === 'rejected' && s.isTerminal),
)

const hasMinStages = computed(() => activeStages.value.length >= 2)

const hasDuplicateNames = computed(() => {
  const names = activeStages.value.map(s => s.name.trim().toLowerCase()).filter(Boolean)
  return names.length !== new Set(names).size
})

// Expose validation state for parent
const isValid = computed(() =>
  hasSuccessTerminal.value
  && hasRejectTerminal.value
  && hasMinStages.value
  && !hasDuplicateNames.value,
)

defineExpose({ isValid })

// ── Helpers ──
function update(newStages: PipelineStage[]) {
  emit('update:modelValue', newStages)
}

function onNameChange(index: number, value: string) {
  const stages = [...props.modelValue]
  stages[index] = { ...stages[index]!, name: value }
  update(stages)
}

function onTypeChange(index: number, newType: PipelineStage['type']) {
  const stages = [...props.modelValue]
  const stage = { ...stages[index]! }
  const wasNameEmpty = stage.name.trim() === '' || stage.name === typeSuggestions[stage.type]
  stage.type = newType
  // Auto-terminal
  if (autoTerminalTypes.includes(newType)) {
    stage.isTerminal = true
  }
  // Suggest name if empty or was a suggestion
  if (wasNameEmpty && typeSuggestions[newType]) {
    stage.name = typeSuggestions[newType]
  }
  stages[index] = stage
  update(stages)
}

function onTerminalChange(index: number, value: boolean) {
  const stages = [...props.modelValue]
  stages[index] = { ...stages[index]!, isTerminal: value }
  update(stages)
}

function moveUp(index: number) {
  if (index === 0) return
  const stages = [...props.modelValue]
  ;[stages[index - 1], stages[index]] = [stages[index]!, stages[index - 1]!]
  update(stages)
}

function moveDown(index: number) {
  if (index === props.modelValue.length - 1) return
  const stages = [...props.modelValue]
  ;[stages[index + 1], stages[index]] = [stages[index]!, stages[index + 1]!]
  update(stages)
}

function archiveStage(index: number) {
  const stage = props.modelValue[index]!
  if (!stage.id) {
    // Brand-new unsaved stage — just remove
    const stages = props.modelValue.filter((_, i) => i !== index)
    update(stages)
  } else {
    // Saved — soft archive
    const stages = [...props.modelValue]
    stages[index] = { ...stage, isArchived: true }
    update(stages)
  }
}

function restoreStage(index: number) {
  const stages = [...props.modelValue]
  stages[index] = { ...stages[index]!, isArchived: false }
  update(stages)
}

function addStage() {
  const stages = [...props.modelValue]
  stages.push({
    name: '',
    type: 'custom',
    isTerminal: false,
    isArchived: false,
  })
  update(stages)
}
</script>

<template>
  <div class="space-y-2">
    <!-- Stage rows -->
    <div
      v-for="(stage, index) in modelValue"
      :key="stage.id ?? `new-${index}`"
      class="rounded-lg border transition-colors"
      :class="stage.isArchived
        ? 'border-surface-100 dark:border-surface-800 bg-surface-50 dark:bg-surface-800/30 opacity-60'
        : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900'"
    >
      <div class="flex items-center gap-2 px-3 py-2.5">
        <!-- Grip handle (visual only) -->
        <GripVertical class="size-4 text-surface-300 dark:text-surface-600 shrink-0" />

        <!-- Color dot -->
        <div
          class="size-2.5 rounded-full shrink-0 ring-1 ring-white dark:ring-surface-900"
          :style="{ backgroundColor: typeColors[stage.type] }"
        />

        <!-- Name input -->
        <input
          class="flex-1 min-w-0 bg-transparent text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none disabled:cursor-not-allowed"
          :class="stage.isArchived ? 'line-through text-surface-400' : ''"
          :value="stage.name"
          :placeholder="$t('pipelines.stage.nameLabel')"
          :disabled="disabled || stage.isArchived"
          :aria-label="$t('pipelines.stage.nameLabel')"
          @input="onNameChange(index, ($event.target as HTMLInputElement).value)"
        />

        <!-- Archived badge -->
        <span
          v-if="stage.isArchived"
          class="shrink-0 inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[10px] font-medium text-surface-500 dark:text-surface-400"
        >
          {{ $t('pipelines.badges.archived') }}
        </span>

        <!-- Type select (hidden when archived) -->
        <div v-if="!stage.isArchived" class="shrink-0">
          <select
            class="appearance-none rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2 py-1 text-xs text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            :value="stage.type"
            :disabled="disabled"
            :aria-label="$t('pipelines.stage.typeLabel')"
            @change="onTypeChange(index, ($event.target as HTMLSelectElement).value as PipelineStage['type'])"
          >
            <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- Terminal checkbox (hidden when archived) -->
        <label v-if="!stage.isArchived" class="shrink-0 flex items-center gap-1 cursor-pointer select-none" :class="disabled || autoTerminalTypes.includes(stage.type) ? 'opacity-60 cursor-not-allowed' : ''">
          <input
            type="checkbox"
            class="size-3.5 rounded accent-brand-600 cursor-pointer disabled:cursor-not-allowed"
            :checked="stage.isTerminal"
            :disabled="disabled || autoTerminalTypes.includes(stage.type)"
            :title="$t('pipelines.stage.terminal')"
            @change="onTerminalChange(index, ($event.target as HTMLInputElement).checked)"
          />
          <span class="text-[11px] text-surface-500 dark:text-surface-400 whitespace-nowrap">
            {{ $t('pipelines.stage.terminal') }}
          </span>
        </label>

        <!-- Move up/down (hidden when archived) -->
        <template v-if="!stage.isArchived">
          <button
            type="button"
            class="shrink-0 p-1 rounded text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            :disabled="disabled || index === 0"
            :title="$t('pipelines.stage.moveUp')"
            @click="moveUp(index)"
          >
            <ChevronUp class="size-3.5" />
          </button>
          <button
            type="button"
            class="shrink-0 p-1 rounded text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            :disabled="disabled || index === modelValue.length - 1"
            :title="$t('pipelines.stage.moveDown')"
            @click="moveDown(index)"
          >
            <ChevronDown class="size-3.5" />
          </button>
        </template>

        <!-- Archive / Restore button -->
        <button
          v-if="!stage.isArchived"
          type="button"
          class="shrink-0 p-1 rounded text-surface-400 hover:text-danger-500 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          :disabled="disabled"
          :title="$t('pipelines.stage.archive')"
          @click="archiveStage(index)"
        >
          <Trash2 class="size-3.5" />
        </button>
        <button
          v-else
          type="button"
          class="shrink-0 inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed border border-brand-200 dark:border-brand-800"
          :disabled="disabled"
          :title="$t('pipelines.stage.restore')"
          @click="restoreStage(index)"
        >
          <RotateCcw class="size-3" />
          {{ $t('pipelines.stage.restore') }}
        </button>
      </div>
    </div>

    <!-- Add stage button -->
    <button
      v-if="!disabled"
      type="button"
      class="w-full rounded-lg border border-dashed border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-500 dark:text-surface-400 hover:border-brand-400 dark:hover:border-brand-600 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50/30 dark:hover:bg-brand-950/20 transition-colors text-left"
      @click="addStage"
    >
      {{ $t('pipelines.form.addStage') }}
    </button>

    <!-- Validation hints -->
    <div v-if="!disabled" class="space-y-1 mt-1">
      <p v-if="!hasSuccessTerminal" class="text-xs text-danger-600 dark:text-danger-400">
        {{ $t('pipelines.validation.needSuccessTerminal') }}
      </p>
      <p v-if="!hasRejectTerminal" class="text-xs text-danger-600 dark:text-danger-400">
        {{ $t('pipelines.validation.needRejectTerminal') }}
      </p>
      <p v-if="!hasMinStages" class="text-xs text-danger-600 dark:text-danger-400">
        {{ $t('pipelines.validation.minTwoStages') }}
      </p>
      <p v-if="hasDuplicateNames" class="text-xs text-danger-600 dark:text-danger-400">
        {{ $t('pipelines.validation.duplicateName') }}
      </p>
    </div>
  </div>
</template>
