<script setup lang="ts">
import { Radar } from 'lucide-vue-next'

const props = defineProps<{
  templates: { id: string; name: string; isDefault?: boolean }[]
}>()

const emit = defineEmits<{ create: [templateId?: string] }>()

const selectedTemplate = ref<string | undefined>(undefined)

onMounted(() => {
  const def = props.templates.find(t => t.isDefault)
  if (def) selectedTemplate.value = def.id
})

function create() {
  emit('create', selectedTemplate.value)
}
</script>

<template>
  <div class="rounded-lg border border-dashed border-surface-300 p-12 text-center dark:border-surface-700">
    <Radar class="mx-auto mb-4 size-10 text-surface-400" />
    <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-50">Карта поиска не создана</h2>
    <p class="mt-1 text-sm text-surface-500">Создайте карту, чтобы структурировать стратегию поиска по вакансии.</p>

    <div v-if="templates.length" class="mx-auto mt-6 max-w-xs">
      <label class="mb-1 block text-left text-sm font-medium text-surface-700 dark:text-surface-300">Шаблон</label>
      <UiSelect v-model="selectedTemplate" :options="templates.map(t => ({ label: t.name, value: t.id }))" />
    </div>

    <div class="mt-6">
      <UiButton @click="create">Создать карту</UiButton>
    </div>
  </div>
</template>
