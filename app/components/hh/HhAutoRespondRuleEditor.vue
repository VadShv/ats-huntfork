<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'
import { HH_COLLECTION_OPTIONS } from '~~/shared/hh-collections'

export interface HhAutoRespondRuleRow {
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

const props = withDefaults(defineProps<{
  show: boolean
  rule?: HhAutoRespondRuleRow | null
}>(), {
  rule: null,
})

const emit = defineEmits<{
  'update:show': [value: boolean]
  'saved': []
}>()

const toast = useToast()

const isEdit = computed(() => !!props.rule)

const form = ref({
  name: '',
  triggerCollection: 'response',
  triggerDelayMinutes: 0,
  resumeKeywords: [] as string[],
  messageTemplate: '',
  isActive: true,
  priority: 100,
})

const newKeyword = ref('')
const nameError = ref('')
const templateError = ref('')
const saving = ref(false)

function initForm() {
  nameError.value = ''
  templateError.value = ''
  if (props.rule) {
    form.value = {
      name: props.rule.name,
      triggerCollection: props.rule.triggerCollection,
      triggerDelayMinutes: props.rule.triggerDelayMinutes,
      resumeKeywords: props.rule.condition?.resumeKeywords ?? [],
      messageTemplate: props.rule.messageTemplate,
      isActive: props.rule.isActive,
      priority: props.rule.priority,
    }
  }
  else {
    form.value = {
      name: '',
      triggerCollection: 'response',
      triggerDelayMinutes: 0,
      resumeKeywords: [],
      messageTemplate: 'Здравствуйте, {{candidateName}}! Спасибо за отклик на вакансию {{vacancyName}}. Мы рассмотрим вашу кандидатуру и свяжемся с вами.',
      isActive: true,
      priority: 100,
    }
  }
}

watch(() => props.show, (open) => {
  if (open) initForm()
}, { immediate: true })

function addKeyword() {
  const kw = newKeyword.value.trim()
  if (!kw || form.value.resumeKeywords.includes(kw)) {
    newKeyword.value = ''
    return
  }
  form.value.resumeKeywords.push(kw)
  newKeyword.value = ''
}

function removeKeyword(index: number) {
  form.value.resumeKeywords.splice(index, 1)
}

function close() {
  emit('update:show', false)
}

async function save() {
  nameError.value = ''
  templateError.value = ''
  if (!form.value.name.trim()) {
    nameError.value = 'Укажите название правила'
    return
  }
  if (!form.value.messageTemplate.trim()) {
    templateError.value = 'Укажите текст сообщения'
    return
  }
  saving.value = true
  try {
    const condition = form.value.resumeKeywords.length
      ? { resumeKeywords: form.value.resumeKeywords }
      : null
    const body = {
      name: form.value.name.trim(),
      triggerCollection: form.value.triggerCollection,
      triggerDelayMinutes: form.value.triggerDelayMinutes,
      condition,
      messageTemplate: form.value.messageTemplate.trim(),
      isActive: form.value.isActive,
      priority: form.value.priority,
    }
    if (props.rule) {
      await $fetch(`/api/hh/auto-respond/rules/${props.rule.id}`, { method: 'PUT', body })
      toast.success('Правило обновлено')
    }
    else {
      await $fetch('/api/hh/auto-respond/rules', { method: 'POST', body })
      toast.success('Правило создано')
    }
    await refreshNuxtData('hh-ar-rules')
    emit('saved')
    close()
  }
  catch (err: any) {
    toast.error('Не удалось сохранить правило', {
      message: err?.data?.statusMessage ?? err?.message,
    })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :model-value="show" size="lg" @update:model-value="emit('update:show', $event)">
    <template #header>
      <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">
        {{ isEdit ? 'Изменить правило' : 'Новое правило авто-ответа' }}
      </h2>
    </template>

    <div class="space-y-5">
      <div class="space-y-4">
        <UiInput
          v-model="form.name"
          label="Название правила"
          placeholder="Например: Ответ на новый отклик"
          :error-message="nameError"
          required
        />

        <div class="grid grid-cols-2 gap-3">
          <UiSelect
            v-model="form.triggerCollection"
            :options="HH_COLLECTION_OPTIONS"
            label="Триггер (коллекция)"
          />
          <UiInput
            v-model="form.triggerDelayMinutes"
            type="number"
            label="Задержка (мин)"
          />
        </div>
      </div>

      <!-- Resume keywords tag input -->
      <div class="pt-2 border-t border-surface-100 dark:border-surface-800">
        <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5 pt-2">
          Ключевые слова в резюме
        </label>
        <p class="text-xs text-surface-400 dark:text-surface-500 mb-2">
          Правило сработает только если резюме содержит хотя бы одно из слов. Оставьте пустым для срабатывания по всем.
        </p>
        <div class="flex flex-wrap gap-1.5 mb-2">
          <span
            v-for="(kw, i) in form.resumeKeywords"
            :key="i"
            class="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 px-2.5 py-1 text-xs font-medium"
          >
            {{ kw }}
            <button
              type="button"
              class="text-brand-400 hover:text-brand-700 dark:hover:text-brand-200 cursor-pointer"
              @click="removeKeyword(i)"
            >
              <X class="size-3" />
            </button>
          </span>
        </div>
        <div class="flex gap-2">
          <UiInput
            v-model="newKeyword"
            placeholder="Добавить ключевое слово…"
            @keydown.enter.prevent="addKeyword"
          />
          <UiButton variant="secondary" size="sm" :icon-left="Plus" @click="addKeyword">
            Добавить
          </UiButton>
        </div>
      </div>

      <!-- Message template -->
      <div>
        <UiTextarea
          v-model="form.messageTemplate"
          label="Текст сообщения"
          :rows="5"
          :error-message="templateError"
          required
        />
        <p class="mt-1.5 text-xs text-surface-400 dark:text-surface-500">
          Доступные переменные: <code class="text-brand-600 dark:text-brand-400">{{ '{{candidateName}}' }}</code>,
          <code class="text-brand-600 dark:text-brand-400">{{ '{{vacancyName}}' }}</code>,
          <code class="text-brand-600 dark:text-brand-400">{{ '{{recruiterName}}' }}</code>
        </p>
      </div>

      <div class="grid grid-cols-2 gap-3 pt-2 border-t border-surface-100 dark:border-surface-800">
        <UiInput
          v-model="form.priority"
          type="number"
          label="Приоритет (ниже = выше)"
        />
        <label class="flex items-center gap-2.5 cursor-pointer pt-6">
          <input
            v-model="form.isActive"
            type="checkbox"
            class="size-4 rounded border-surface-300 dark:border-surface-700 text-brand-600 focus:ring-brand-500"
          >
          <span class="text-sm text-surface-700 dark:text-surface-300">
            Активно
          </span>
        </label>
      </div>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="close">
        Отмена
      </UiButton>
      <UiButton :loading="saving" @click="save">
        Сохранить
      </UiButton>
    </template>
  </UiModal>
</template>
