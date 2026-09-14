<script setup lang="ts">
/** Редактор списка строк (индикаторы, примеры). Спринт 1. */
import { Plus, X } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: string[]
  label?: string
  placeholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const draft = ref('')

function add() {
  const v = draft.value.trim()
  if (!v) return
  emit('update:modelValue', [...props.modelValue, v])
  draft.value = ''
}
function removeAt(i: number) {
  emit('update:modelValue', props.modelValue.filter((_, idx) => idx !== i))
}
</script>

<template>
  <div>
    <label v-if="label" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">{{ label }}</label>
    <div class="flex flex-wrap gap-1.5 mb-2">
      <UiBadge v-for="(item, i) in modelValue" :key="i" tone="brand" removable @remove="removeAt(i)">
        {{ item }}
      </UiBadge>
      <span v-if="!modelValue.length" class="text-xs text-surface-400">Пусто</span>
    </div>
    <div class="flex gap-2">
      <UiInput v-model="draft" :placeholder="placeholder || 'Добавить…'" size="sm" @keydown.enter.prevent="add" />
      <UiButton type="button" variant="secondary" size="sm" :icon-left="Plus" icon-only aria-label="Добавить" @click="add" />
    </div>
  </div>
</template>
