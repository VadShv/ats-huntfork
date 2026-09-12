<script setup lang="ts">
import { X, Plus, Trash2 } from 'lucide-vue-next'

const props = defineProps<{
  /** If provided, we're editing an existing question */
  question?: {
    id: string
    label: string
    type: string
    description?: string | null
    required: boolean
    options?: string[] | null
  }
}>()

const emit = defineEmits<{
  (e: 'save', data: {
    label: string
    type: string
    description?: string
    required: boolean
    options?: string[]
  }): void
  (e: 'cancel'): void
}>()

const questionTypes = [
  { value: 'short_text', label: 'Короткий текст' },
  { value: 'long_text', label: 'Длинный текст' },
  { value: 'single_select', label: 'Один вариант' },
  { value: 'multi_select', label: 'Несколько вариантов' },
  { value: 'number', label: 'Число' },
  { value: 'date', label: 'Дата' },
  { value: 'url', label: 'URL' },
  { value: 'checkbox', label: 'Флажок (да/нет)' },
  { value: 'file_upload', label: 'Загрузка файла' },
]

const form = ref({
  label: props.question?.label ?? '',
  type: props.question?.type ?? 'short_text',
  description: props.question?.description ?? '',
  required: props.question?.required ?? false,
  options: props.question?.options ?? [''],
})

const errors = ref<Record<string, string>>({})

const isSelectType = computed(() =>
  form.value.type === 'single_select' || form.value.type === 'multi_select',
)

function addOption() {
  form.value.options.push('')
}

function removeOption(index: number) {
  if (form.value.options.length > 1) {
    form.value.options.splice(index, 1)
  }
}

function validate(): boolean {
  errors.value = {}

  if (!form.value.label.trim()) {
    errors.value.label = 'Укажите вопрос'
  }

  if (isSelectType.value) {
    const nonEmpty = form.value.options.filter((o) => o.trim())
    if (nonEmpty.length === 0) {
      errors.value.options = 'Добавьте хотя бы один вариант ответа'
    }
  }

  return Object.keys(errors.value).length === 0
}

function handleSubmit() {
  if (!validate()) return

  const data: {
    label: string
    type: string
    description?: string
    required: boolean
    options?: string[]
  } = {
    label: form.value.label.trim(),
    type: form.value.type,
    required: form.value.required,
  }

  if (form.value.description.trim()) {
    data.description = form.value.description.trim()
  }

  if (isSelectType.value) {
    data.options = form.value.options
      .map((o) => o.trim())
      .filter((o) => o.length > 0)
  }

  emit('save', data)
}

const isEditing = computed(() => !!props.question)
</script>

<template>
  <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 p-4">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-300">
        {{ isEditing ? 'Изменить вопрос' : 'Добавить вопрос' }}
      </h3>
      <UiButton
        variant="ghost"
        icon-only
        size="sm"
        class="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200"
        @click="emit('cancel')"
      >
        <X class="size-4" />
      </UiButton>
    </div>

    <form class="space-y-4" @submit.prevent="handleSubmit">
      <!-- Label -->
      <div>
        <label for="q-label" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Вопрос <span class="text-danger-500">*</span>
        </label>
        <input
          id="q-label"
          v-model="form.label"
          type="text"
          placeholder="Например, сколько лет у вас опыта?"
          class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
          :class="errors.label ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
        />
        <p v-if="errors.label" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.label }}</p>
      </div>

      <!-- Type -->
      <div>
        <label for="q-type" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Тип поля        </label>
        <select
          id="q-type"
          v-model="form.type"
          class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors bg-white dark:bg-surface-800"
        >
          <option v-for="qt in questionTypes" :key="qt.value" :value="qt.value">
            {{ qt.label }}
          </option>
        </select>
      </div>

      <!-- Description / help text -->
      <div>
        <label for="q-desc" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Подсказка <span class="text-surface-400 font-normal">(необязательно)</span>
        </label>
        <input
          id="q-desc"
          v-model="form.description"
          type="text"
          placeholder="Дополнительная информация под полем"
          class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
        />
      </div>

      <!-- Options (for select types) -->
      <div v-if="isSelectType">
        <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Варианты ответа <span class="text-danger-500">*</span>
        </label>
        <div class="space-y-2">
          <div v-for="(_, index) in form.options" :key="index" class="flex items-center gap-2">
            <input
              v-model="form.options[index]"
              type="text"
              :placeholder="`Вариант ${index + 1}`"
              class="flex-1 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
            />
            <UiButton
              variant="ghost"
              icon-only
              size="xs"
              class="text-surface-400 hover:text-danger-600"
              :disabled="form.options.length <= 1"
              @click="removeOption(index)"
            >
              <Trash2 class="size-4" />
            </UiButton>
          </div>
        </div>
        <UiButton
          variant="link"
          size="sm"
          class="mt-2"
          :icon-left="Plus"
          @click="addOption"
        >
          Добавить вариант
        </UiButton>
        <p v-if="errors.options" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.options }}</p>
      </div>

      <!-- Required -->
      <label class="flex items-center gap-2 cursor-pointer">
        <input
          v-model="form.required"
          type="checkbox"
          class="size-4 rounded border-surface-300 dark:border-surface-700 text-brand-600 focus:ring-brand-500"
        />
        <span class="text-sm text-surface-700 dark:text-surface-300">Обязательное</span>
      </label>

      <!-- Actions -->
      <div class="flex items-center gap-2 pt-1">
        <UiButton
          type="submit"
          size="sm"
        >
          {{ isEditing ? 'Сохранить' : 'Добавить вопрос' }}
        </UiButton>
        <UiButton
          variant="secondary"
          size="sm"
          @click="emit('cancel')"
        >
          Отмена
        </UiButton>
      </div>
    </form>
  </div>
</template>
