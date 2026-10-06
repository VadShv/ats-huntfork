<script setup lang="ts">
/**
 * DonorCompanyPicker — добавить компанию-донора в карту вакансии.
 *
 * Поведение:
 *  - ввод → поиск по реестру (debounce 300ms) → список совпадений;
 *  - клик по совпадению → привязать к карте;
 *  - кнопка «Создать и добавить» видна ВСЕГДА при непустом вводе (не только внутри
 *    выпадашки): раньше она жила в dropdown, который закрывался по blur инпута
 *    через 200ms, и клик по ней часто «не регистрировался»;
 *  - элементы dropdown используют @mousedown.prevent, чтобы инпут не терял фокус
 *    до события click.
 */
import { Plus, Check } from 'lucide-vue-next'

const props = defineProps<{
  jobId: string
  /** Названия компаний, уже привязанных к карте — чтобы подсветить их в списке */
  existingNames?: string[]
}>()

const emit = defineEmits<{ added: [] }>()

const toast = useToast()
const search = ref('')
const results = ref<any[]>([])
const loading = ref(false)
const submitting = ref(false)
const showDropdown = ref(false)
const selectedLayer = ref('core')
const selectedPriority = ref('medium')

const layerOptions = [
  { label: 'Ядро — прямые аналоги', value: 'core' },
  { label: 'Смежный круг', value: 'adjacent' },
  { label: 'Школа компетенций', value: 'school' },
  { label: 'Alumni', value: 'alumni' },
  { label: 'Своё', value: 'custom' },
]
const priorityOptions = [
  { label: 'Высокий', value: 'high' },
  { label: 'Средний', value: 'medium' },
  { label: 'Низкий', value: 'low' },
]

const query = computed(() => search.value.trim())
const existingSet = computed(() => new Set((props.existingNames ?? []).map(n => n.toLowerCase().trim())))
const exactMatch = computed(() =>
  results.value.find(r => r.canonicalName?.toLowerCase().trim() === query.value.toLowerCase()),
)

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
        query: { search: val.trim(), limit: 10 },
      })
      results.value = data.items ?? []
    } catch {
      results.value = []
    } finally {
      loading.value = false
      showDropdown.value = true
    }
  }, 300)
})

function describeError(e: any, fallback: string): string {
  const code = e?.statusCode ?? e?.status
  if (code === 403) return 'Нет права добавлять доноров (searchMap:add_donor)'
  if (code === 409) return 'Эта компания уже есть в карте'
  if (code === 400) return `Данные не прошли проверку: ${e?.data?.message ?? e?.data?.statusMessage ?? e?.statusMessage ?? ''}`.trim()
  return e?.data?.statusMessage ?? e?.statusMessage ?? fallback
}

async function postDonor(donor: Record<string, unknown>, successText: string) {
  if (submitting.value) return
  submitting.value = true
  try {
    await $fetch(`/api/jobs/${props.jobId}/search-map/donors`, {
      method: 'POST',
      body: { donors: [{ ...donor, layer: selectedLayer.value, priority: selectedPriority.value }] },
    })
    toast.success(successText)
    search.value = ''
    results.value = []
    showDropdown.value = false
    emit('added')
  } catch (e: any) {
    toast.error(describeError(e, 'Не удалось добавить компанию'))
  } finally {
    submitting.value = false
  }
}

function addExisting(companyId: string, name: string) {
  return postDonor({ donorCompanyId: companyId }, `«${name}» добавлена в карту`)
}

function addNew() {
  const name = query.value
  if (!name) return
  // Если в реестре уже есть точно такая компания — привязываем её, а не создаём дубль
  if (exactMatch.value) return addExisting(exactMatch.value.id, exactMatch.value.canonicalName)
  return postDonor({ name }, `«${name}» создана в реестре и добавлена в карту`)
}

function onBlur() {
  // Небольшая задержка только для случая клика мимо; элементы списка
  // перехватывают mousedown и фокус не теряют.
  setTimeout(() => { showDropdown.value = false }, 150)
}
</script>

<template>
  <div class="space-y-2 rounded-lg border border-surface-200 p-3 dark:border-surface-800">
    <div class="grid grid-cols-2 gap-2">
      <div>
        <label class="mb-1 block text-xs font-medium text-surface-500">Слой</label>
        <UiSelect v-model="selectedLayer" :options="layerOptions" />
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-surface-500">Приоритет</label>
        <UiSelect v-model="selectedPriority" :options="priorityOptions" />
      </div>
    </div>

    <label class="mb-1 block text-xs font-medium text-surface-500">Компания</label>
    <div class="flex gap-2">
      <div class="relative flex-1">
        <UiInput
          v-model="search"
          placeholder="Название компании — поиск по реестру…"
          @focus="query && (showDropdown = true)"
          @blur="onBlur"
          @keydown.enter.prevent="addNew"
        />
        <div
          v-if="showDropdown && query"
          class="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-surface-200 bg-white shadow-lg dark:border-surface-800 dark:bg-surface-900"
        >
          <div v-if="loading" class="p-2 text-center text-sm text-surface-400">Поиск в реестре…</div>
          <div v-else-if="!results.length" class="p-2 text-sm text-surface-500">
            В реестре нет «{{ query }}» — нажмите «Создать и добавить».
          </div>
          <template v-else>
            <button
              v-for="r in results"
              :key="r.id"
              type="button"
              class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-100 disabled:opacity-50 dark:hover:bg-surface-800"
              :disabled="existingSet.has(r.canonicalName?.toLowerCase().trim())"
              @mousedown.prevent
              @click="addExisting(r.id, r.canonicalName)"
            >
              <span class="text-surface-900 dark:text-surface-50">{{ r.canonicalName }}</span>
              <span class="flex items-center gap-2 text-xs text-surface-400">
                <span v-if="r.industry">{{ r.industry }}</span>
                <Check v-if="existingSet.has(r.canonicalName?.toLowerCase().trim())" class="size-3.5" />
              </span>
            </button>
          </template>
        </div>
      </div>
      <UiButton
        size="sm"
        :disabled="!query || submitting"
        :loading="submitting"
        @mousedown.prevent
        @click="addNew"
      >
        <Plus class="mr-1 size-4" />
        {{ exactMatch ? 'Добавить в карту' : 'Создать и добавить' }}
      </UiButton>
    </div>
    <p class="text-xs text-surface-400">
      Новая компания попадёт в общий реестр доноров организации и будет доступна для других вакансий.
    </p>
  </div>
</template>
