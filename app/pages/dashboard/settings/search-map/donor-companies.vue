<script setup lang="ts">
/**
 * Реестр компаний-доноров — таблица с поиском/фильтрами/пагинацией.
 * docs/tz-search-map.md §11.1
 */
definePageMeta({ layout: 'dashboard', middleware: ['auth', 'require-org'] })

const { allowed: canAddDonor } = usePermission({ searchMap: ['add_donor'] })
const { allowed: canManage } = usePermission({ searchMap: ['manage_registry'] })

const toast = useToast()
const search = ref('')
const page = ref(0)
const limit = 50
const showImport = ref(false)
const showAdd = ref(false)
const importText = ref('')
const importing = ref(false)
const addForm = reactive({ name: '', industry: '' })
const adding = ref(false)

async function addCompany() {
  if (!addForm.name.trim()) return
  adding.value = true
  try {
    await $fetch('/api/search-map/donor-companies', {
      method: 'POST',
      body: { name: addForm.name.trim(), industry: addForm.industry.trim() || undefined },
    })
    toast.success('Компания добавлена')
    showAdd.value = false
    addForm.name = ''
    addForm.industry = ''
    await refresh()
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  } finally {
    adding.value = false
  }
}

const { data, refresh } = await useFetch('/api/search-map/donor-companies', {
  query: computed(() => ({
    search: search.value || undefined,
    limit,
    offset: page.value * limit,
  })),
})

const total = computed(() => data.value?.total ?? 0)
const totalPages = computed(() => Math.ceil(total.value / limit))

async function doImport() {
  if (!importText.value.trim()) return
  importing.value = true
  try {
    const lines = importText.value.trim().split('\n').filter(Boolean)
    const companies = lines.map(line => {
      const [name, industry] = line.split(',').map(s => s.trim())
      return { name, industry: industry || undefined }
    }).filter(c => c.name)
    const result = await $fetch('/api/search-map/donor-companies/import', {
      method: 'POST',
      body: { companies },
    })
    toast.success(`Импорт: ${result.created} создано, ${result.skipped} пропущено`)
    importText.value = ''
    showImport.value = false
    await refresh()
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка импорта')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-4">
      <UiInput
        v-model="search"
        placeholder="Поиск по названию…"
        class="flex-1"
      />
      <UiButton v-if="canAddDonor" size="sm" variant="ghost" @click="showImport = !showImport">Импорт CSV</UiButton>
      <UiButton v-if="canAddDonor" size="sm" @click="showAdd = !showAdd">Добавить компанию</UiButton>
    </div>

    <!-- Add company form -->
    <div v-if="showAdd && canAddDonor" class="mb-4 rounded-lg border border-surface-200 p-4 dark:border-surface-800">
      <div class="grid grid-cols-2 gap-3">
        <UiInput v-model="addForm.name" placeholder="Название компании" />
        <UiInput v-model="addForm.industry" placeholder="Индустрия (необязательно)" />
      </div>
      <UiButton class="mt-2" size="sm" :loading="adding" @click="addCompany">Добавить</UiButton>
    </div>

    <!-- CSV import -->
    <div v-if="showImport && canAddDonor" class="mb-4 rounded-lg border border-surface-200 p-4 dark:border-surface-800">
      <p class="mb-2 text-sm text-surface-500">Одна компания на строку: <code>Название, Индустрия</code></p>
      <UiTextarea v-model="importText" rows="5" placeholder="Яндекс, IT&#10;Сбер, Финтех" />
      <UiButton class="mt-2" size="sm" :loading="importing" @click="doImport">Импортировать</UiButton>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-surface-200 text-left text-xs text-surface-500 dark:border-surface-800">
            <th class="pb-2 pr-4 font-medium">Название</th>
            <th class="pb-2 pr-4 font-medium">Индустрия</th>
            <th class="pb-2 pr-4 font-medium">Стадия</th>
            <th class="pb-2 pr-4 font-medium">Статус</th>
            <th class="pb-2 font-medium">В картах</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="donor in data?.items"
            :key="donor.id"
            class="border-b border-surface-100 dark:border-surface-900"
          >
            <td class="py-2 pr-4 font-medium text-surface-900 dark:text-surface-50">{{ donor.canonicalName }}</td>
            <td class="py-2 pr-4 text-surface-600 dark:text-surface-400">{{ donor.industry ?? '—' }}</td>
            <td class="py-2 pr-4 text-surface-600 dark:text-surface-400">{{ donor.stage ?? '—' }}</td>
            <td class="py-2 pr-4">
              <UiBadge :variant="donor.status === 'active' ? 'success' : donor.status === 'merged' ? 'surface' : 'danger'">
                {{ donor.status }}
              </UiBadge>
            </td>
            <td class="py-2 text-surface-600 dark:text-surface-400">{{ donor.usedInMaps }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="totalPages > 1" class="mt-4 flex items-center justify-between">
      <p class="text-xs text-surface-500">Всего: {{ total }}</p>
      <div class="flex gap-2">
        <UiButton size="sm" variant="ghost" :disabled="page === 0" @click="page--">Назад</UiButton>
        <UiButton size="sm" variant="ghost" :disabled="page >= totalPages - 1" @click="page++">Вперёд</UiButton>
      </div>
    </div>

    <div v-if="!data?.items?.length" class="mt-4 rounded-lg border border-dashed border-surface-300 p-8 text-center dark:border-surface-700">
      <p class="text-sm text-surface-500">Компаний-доноров пока нет.</p>
    </div>
  </div>
</template>
