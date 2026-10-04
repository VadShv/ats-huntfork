<script setup lang="ts">
const props = defineProps<{
  section: { id: string; title: string; guidance?: string | null; items: { id: string; value: string; note?: string | null; origin: string }[] }
  jobId: string
  canEdit: boolean
}>()

const newValue = ref('')
const toast = useToast()

async function addItem() {
  if (!newValue.value.trim()) return
  try {
    await $fetch(`/api/jobs/${props.jobId}/search-map/sections/${props.section.id}/items`, {
      method: 'POST',
      body: { items: [{ value: newValue.value.trim() }] },
    })
    newValue.value = ''
    await refreshNuxtData(`search-map-${props.jobId}`)
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  }
}

async function deleteItem(itemId: string) {
  try {
    await $fetch(`/api/jobs/${props.jobId}/search-map/items/${itemId}`, { method: 'DELETE' })
    await refreshNuxtData(`search-map-${props.jobId}`)
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  }
}
</script>

<template>
  <div class="rounded-lg border border-surface-200 p-4 dark:border-surface-800">
    <h3 class="mb-2 text-sm font-medium text-surface-900 dark:text-surface-50">{{ section.title }}</h3>

    <div v-if="!section.items.length && section.guidance" class="mb-2 text-xs text-surface-400">
      {{ section.guidance }}
    </div>

    <div class="space-y-1">
      <div
        v-for="item in section.items"
        :key="item.id"
        class="group flex items-center gap-2 text-sm"
      >
        <span class="flex-1 text-surface-700 dark:text-surface-300">{{ item.value }}</span>
        <UiBadge v-if="item.origin === 'ai'" variant="brand" class="text-xs">AI</UiBadge>
        <button
          v-if="canEdit"
          class="opacity-0 group-hover:opacity-100 text-surface-400 hover:text-danger-600"
          @click="deleteItem(item.id)"
        >
          ✕
        </button>
      </div>
    </div>

    <div v-if="canEdit" class="mt-2 flex gap-2">
      <UiInput
        v-model="newValue"
        placeholder="Добавить…"
        class="flex-1"
        @keyup.enter="addItem"
      />
      <UiButton size="sm" @click="addItem">+</UiButton>
    </div>
  </div>
</template>
