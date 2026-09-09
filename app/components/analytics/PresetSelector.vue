<script setup lang="ts">
/**
 * Центр аналитики: селектор сохранённых пресетов фильтров.
 * Список пресетов + сохранение текущих фильтров + удаление.
 */
import { Bookmark, Plus, Trash2, Check } from 'lucide-vue-next'
import { useAnalyticsFilters } from '~/composables/useAnalyticsFilters'

const { serialize, applyPreset } = useAnalyticsFilters()

const { data, refresh } = useFetch('/api/analytics/views', {
  key: 'analytics-views',
  headers: useRequestHeaders(['cookie']),
})
const views = computed<any[]>(() => (data.value as any)?.views ?? [])

const open = ref(false)
const saving = ref(false)
const newName = ref('')

async function save() {
  if (!newName.value.trim()) return
  saving.value = true
  try {
    await $fetch('/api/analytics/views', {
      method: 'POST',
      body: { name: newName.value.trim(), filters: serialize() },
    })
    newName.value = ''
    await refresh()
  } finally {
    saving.value = false
  }
}

async function remove(id: string) {
  await $fetch(`/api/analytics/views/${id}`, { method: 'DELETE' })
  await refresh()
}

function apply(view: any) {
  applyPreset(view.filters)
  open.value = false
}
</script>

<template>
  <div class="relative">
    <button
      class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800"
      @click="open = !open"
    >
      <Bookmark class="w-3.5 h-3.5" /> Пресеты
    </button>

    <div v-if="open" class="absolute right-0 mt-1 w-64 z-20 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg p-2">
      <ul v-if="views.length" class="space-y-0.5 mb-2 max-h-56 overflow-y-auto">
        <li v-for="v in views" :key="v.id" class="flex items-center gap-1 group">
          <button class="flex-1 text-left text-xs text-surface-700 dark:text-surface-300 px-2 py-1.5 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 truncate" @click="apply(v)">
            {{ v.name }}
          </button>
          <button class="text-surface-300 hover:text-danger-500 p-1 opacity-0 group-hover:opacity-100" @click="remove(v.id)">
            <Trash2 class="w-3.5 h-3.5" />
          </button>
        </li>
      </ul>
      <p v-else class="text-xs text-surface-400 px-2 py-2 text-center">Нет сохранённых пресетов</p>

      <div class="flex items-center gap-1 border-t border-surface-100 dark:border-surface-800 pt-2">
        <input
          v-model="newName"
          placeholder="Название пресета"
          class="flex-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-1.5 text-xs text-surface-700 dark:text-surface-300"
          @keydown.enter="save"
        >
        <button
          class="inline-flex items-center justify-center rounded-lg bg-primary-600 text-white p-1.5 disabled:opacity-40 hover:bg-primary-700"
          :disabled="saving || !newName.trim()"
          @click="save"
        >
          <Check v-if="saving" class="w-3.5 h-3.5" />
          <Plus v-else class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
