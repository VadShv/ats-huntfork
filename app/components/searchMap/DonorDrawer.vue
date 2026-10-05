<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean
  donor: {
    donor: { id: string; layer: string; priority: string; hypothesisStatus: string; rationale?: string | null; resultNote?: string | null }
    company: { id: string; canonicalName: string; industry?: string | null }
  } | null
  jobId: string
}>()

const emit = defineEmits<{ 'update:modelValue': [v: boolean]; updated: [] }>()

const toast = useToast()
const saving = ref(false)

const form = reactive({
  layer: '',
  priority: '',
  hypothesisStatus: '',
  rationale: '',
  resultNote: '',
})

watch(() => props.donor, (d) => {
  if (d) {
    form.layer = d.donor.layer
    form.priority = d.donor.priority
    form.hypothesisStatus = d.donor.hypothesisStatus
    form.rationale = d.donor.rationale ?? ''
    form.resultNote = d.donor.resultNote ?? ''
  }
}, { immediate: true })

async function save() {
  if (!props.donor) return
  saving.value = true
  try {
    await $fetch(`/api/jobs/${props.jobId}/search-map/donors/${props.donor.donor.id}`, {
      method: 'PATCH',
      body: { ...form },
    })
    toast.success('Сохранено')
    emit('updated')
    emit('update:modelValue', false)
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!props.donor) return
  if (!confirm('Удалить донора из карты?')) return
  try {
    await $fetch(`/api/jobs/${props.jobId}/search-map/donors/${props.donor.donor.id}`, { method: 'DELETE' })
    toast.success('Удалено')
    emit('updated')
    emit('update:modelValue', false)
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  }
}

const layerOptions = [
  { label: 'Ядро', value: 'core' },
  { label: 'Смежный', value: 'adjacent' },
  { label: 'Школы', value: 'school' },
  { label: 'Alumni', value: 'alumni' },
  { label: 'Своё', value: 'custom' },
]
const priorityOptions = [
  { label: 'Высокий', value: 'high' },
  { label: 'Средний', value: 'medium' },
  { label: 'Низкий', value: 'low' },
]
const statusOptions = [
  { label: 'Не проверена', value: 'untested' },
  { label: 'В работе', value: 'in_progress' },
  { label: 'Работает', value: 'working' },
  { label: 'Отклонена', value: 'rejected' },
]
</script>

<template>
  <UiDrawer :model-value="modelValue" width="md" @update:model-value="emit('update:modelValue', $event)">
    <template #header>
      <h3 class="text-lg font-semibold">{{ donor?.company.canonicalName }}</h3>
      <p v-if="donor?.company.industry" class="text-sm text-surface-500">{{ donor.company.industry }}</p>
    </template>

    <div v-if="donor" class="space-y-4">
      <div>
        <label class="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">Слой</label>
        <UiSelect v-model="form.layer" :options="layerOptions" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">Приоритет</label>
        <UiSelect v-model="form.priority" :options="priorityOptions" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">Статус гипотезы</label>
        <UiSelect v-model="form.hypothesisStatus" :options="statusOptions" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">Причина</label>
        <UiTextarea v-model="form.rationale" :rows="3" placeholder="Почему ищем здесь?" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">Результат</label>
        <UiTextarea v-model="form.resultNote" :rows="2" placeholder="Что получилось?" />
      </div>
    </div>

    <template #footer>
      <div class="flex justify-between">
        <UiButton variant="ghost" class="text-danger-600" @click="remove">Удалить из карты</UiButton>
        <UiButton :loading="saving" @click="save">Сохранить</UiButton>
      </div>
    </template>
  </UiDrawer>
</template>
