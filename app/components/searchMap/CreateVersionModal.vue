<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean
  jobId: string
}>()

const emit = defineEmits<{ 'update:modelValue': [v: boolean]; created: [] }>()

const toast = useToast()
const creating = ref(false)

const form = reactive({
  label: '',
  trigger: 'manual' as string,
  comment: '',
})

const presets = [
  'Черновик',
  'После калибровки с HM',
  'Пересборка по брифу',
  'Перед запуском сорсинга',
]

const triggerOptions = [
  { label: 'Вручную', value: 'manual' },
  { label: 'Источники изменились', value: 'sources_changed' },
  { label: 'AI-генерация', value: 'ai_generated' },
  { label: 'Калибровка', value: 'calibration' },
]

function selectPreset(p: string) {
  form.label = p
}

async function create() {
  creating.value = true
  try {
    await $fetch(`/api/jobs/${props.jobId}/search-map/versions`, {
      method: 'POST',
      body: { label: form.label || undefined, comment: form.comment || undefined },
    })
    toast.success('Версия создана')
    emit('created')
    emit('update:modelValue', false)
    form.label = ''
    form.comment = ''
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <UiModal :model-value="modelValue" title="Создать версию" size="md" @update:model-value="emit('update:modelValue', $event)">
    <div class="space-y-3">
      <div>
        <label class="mb-1 block text-sm font-medium">Название</label>
        <UiInput v-model="form.label" placeholder="Напр. После калибровки с HM" />
        <div class="mt-1 flex flex-wrap gap-1">
          <button
            v-for="p in presets"
            :key="p"
            class="rounded bg-surface-100 px-2 py-0.5 text-xs text-surface-600 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-400"
            @click="selectPreset(p)"
          >{{ p }}</button>
        </div>
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium">Комментарий</label>
        <UiTextarea v-model="form.comment" rows="2" placeholder="Что изменилось?" />
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UiButton variant="ghost" @click="emit('update:modelValue', false)">Отмена</UiButton>
        <UiButton :loading="creating" @click="create">Создать версию</UiButton>
      </div>
    </template>
  </UiModal>
</template>
