<script setup lang="ts">
/**
 * CreateHhSearchModal — создание hh-поиска из сегмента карты.
 * Предзаполнение из сегмента → POST /api/jobs/[id]/sourcing-searches (mode: manual).
 */
const props = defineProps<{
  modelValue: boolean
  jobId: string
  segment: any
  queryString: string
  segmentId?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [v: boolean]; created: [] }>()

const toast = useToast()
const creating = ref(false)

const form = reactive({
  name: '',
  text: '',
  area: '1',
  maxCandidates: 100,
})

watch(() => props.segment, (s) => {
  if (s) {
    form.name = s.segment.name ?? 'Поиск из сегмента'
    form.text = props.queryString ?? ''
  }
}, { immediate: true })

async function create() {
  creating.value = true
  try {
    await $fetch(`/api/jobs/${props.jobId}/sourcing-searches`, {
      method: 'POST',
      body: {
        mode: 'manual',
        name: form.name,
        query: {
          text: form.text,
          area: [form.area],
        },
        maxCandidates: form.maxCandidates,
        searchMapSegmentId: props.segmentId,
      },
    })
    toast.success('hh-поиск создан')
    emit('created')
    emit('update:modelValue', false)
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка создания поиска')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <UiModal :model-value="modelValue" title="Создать поиск hh.ru" size="md" @update:model-value="emit('update:modelValue', $event)">
    <div class="space-y-3">
      <div>
        <label class="mb-1 block text-sm font-medium">Название поиска</label>
        <UiInput v-model="form.name" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium">Текст запроса</label>
        <UiTextarea v-model="form.text" :rows="3" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="mb-1 block text-sm font-medium">Регион (код hh)</label>
          <UiInput v-model="form.area" placeholder="1 = Москва" />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium">Макс. кандидатов</label>
          <UiInput v-model.number="form.maxCandidates" type="number" />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UiButton variant="ghost" @click="emit('update:modelValue', false)">Отмена</UiButton>
        <UiButton :loading="creating" @click="create">Создать</UiButton>
      </div>
    </template>
  </UiModal>
</template>
