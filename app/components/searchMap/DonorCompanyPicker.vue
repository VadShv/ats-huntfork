<script setup lang="ts">
/**
 * DonorCompanyPicker — поиск по реестру компаний-доноров с автодополнением.
 * При отсутствии — «Создать "…" в реестре». Выбор слоя. Множественное добавление.
 */
const props = defineProps<{
  jobId: string
}>()

const emit = defineEmits<{ added: [] }>()

const toast = useToast()
const search = ref('')
const results = ref<any[]>([])
const loading = ref(false)
const showDropdown = ref(false)
const selectedLayer = ref('core')
const selectedPriority = ref('medium')

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

let searchTimer: ReturnType<typeof setTimeout> | null = null

watch(search, (val) => {
  if (searchTimer) clearTimeout(searchTimer)
  if (!val.trim()) {
    results.value = []
    showDropdown.value = false
    return
  }
  searchTimer = setTimeout(async () => {
    loading.value = true
    try {
      const data = await $fetch<{ items: any[] }>('/api/search-map/donor-companies', {
        query: { search: val, limit: 10 },
      })
      results.value = data.items ?? []
      showDropdown.value = true
    } catch {
      results.value = []
    } finally {
      loading.value = false
    }
  }, 300)
})

async function addExisting(companyId: string, name: string) {
  try {
    await $fetch(`/api/jobs/${props.jobId}/search-map/donors`, {
      method: 'POST',
      body: {
        donors: [{
          donorCompanyId: companyId,
          layer: selectedLayer.value,
          priority: selectedPriority.value,
        }],
      },
    })
    toast.success(`«${name}» добавлена`)
    search.value = ''
    showDropdown.value = false
    emit('added')
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  }
}

async function addNew() {
  if (!search.value.trim()) return
  try {
    await $fetch(`/api/jobs/${props.jobId}/search-map/donors`, {
      method: 'POST',
      body: {
        donors: [{
          name: search.value.trim(),
          layer: selectedLayer.value,
          priority: selectedPriority.value,
        }],
      },
    })
    toast.success(`«${search.value.trim()}» создана и добавлена`)
    search.value = ''
    showDropdown.value = false
    emit('added')
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  }
}

function closeDropdown() {
  setTimeout(() => { showDropdown.value = false }, 200)
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex gap-2">
      <UiSelect v-model="selectedLayer" :options="layerOptions" class="w-32" />
      <UiSelect v-model="selectedPriority" :options="priorityOptions" class="w-24" />
    </div>
    <div class="relative">
      <UiInput
        v-model="search"
        placeholder="Поиск компании в реестре…"
        @blur="closeDropdown"
      />
      <div
        v-if="showDropdown"
        class="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-surface-200 bg-white shadow-lg dark:border-surface-800 dark:bg-surface-900"
      >
        <div v-if="loading" class="p-2 text-center text-sm text-surface-400">Поиск…</div>
        <div v-else-if="!results.length" class="p-2 text-center text-sm text-surface-400">
          Не найдено. <button class="text-brand-600 underline" @click="addNew">Создать «{{ search }}»</button>
        </div>
        <div v-else>
          <button
            v-for="r in results"
            :key="r.id"
            class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-100 dark:hover:bg-surface-800"
            @click="addExisting(r.id, r.canonicalName)"
          >
            <span class="text-surface-900 dark:text-surface-50">{{ r.canonicalName }}</span>
            <span v-if="r.industry" class="text-xs text-surface-400">{{ r.industry }}</span>
          </button>
          <button
            class="flex w-full items-center px-3 py-2 text-left text-sm text-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800"
            @click="addNew"
          >
            + Создать «{{ search }}»
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
