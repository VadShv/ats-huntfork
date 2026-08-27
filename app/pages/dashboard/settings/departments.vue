<script setup lang="ts">
import { Network, Plus, Pencil, Trash2, Archive, ArchiveRestore, Loader2, X, Check, CornerDownRight } from 'lucide-vue-next'

definePageMeta({})

useSeoMeta({
  title: 'Подразделения',
  description: 'Оргструктура: дирекции, департаменты, отделы и секторы с произвольной вложенностью',
})

interface DepartmentRow {
  id: string
  name: string
  companyId: string | null
  parentId: string | null
  sortOrder: number
  isArchived: boolean
  depth: number
  hasChildren: boolean
  jobsCount: number
}

interface CompanyRow {
  id: string
  name: string
  isDefault: boolean
  isArchived: boolean
}

const { allowed: canManage } = usePermission({ department: ['update'] })
const { success: toastSuccess, error: toastError } = useToast()
const { ask: confirmAsk } = useConfirm()
const { track } = useTrack()

const { data, refresh, pending } = useFetch<DepartmentRow[]>('/api/departments', {
  headers: useRequestHeaders(['cookie']),
})
const departments = computed(() => data.value ?? [])

const { data: companiesData } = useFetch<CompanyRow[]>('/api/companies', {
  headers: useRequestHeaders(['cookie']),
})
const companies = computed(() => (companiesData.value ?? []).filter(c => !c.isArchived))

// Фильтр по компании: all | none | <companyId>
const companyFilter = ref<string>('all')
const filteredDepartments = computed(() => {
  if (companyFilter.value === 'all') return departments.value
  if (companyFilter.value === 'none') return departments.value.filter(d => !d.companyId)
  return departments.value.filter(d => d.companyId === companyFilter.value)
})

const companyNameMap = computed(() => new Map(companies.value.map(c => [c.id, c.name])))

/** Варианты родителя: любые неархивные узлы (с отступами по depth) */
const parentOptions = computed(() =>
  departments.value.filter(d => !d.isArchived).map(d => ({
    id: d.id,
    label: `${'\u00A0\u00A0\u00A0\u00A0'.repeat(d.depth)}${d.name}`,
  })),
)

// ── Создание ──
const showCreate = ref(false)
const createForm = ref({ name: '', parentId: '', companyId: '' })
const isCreating = ref(false)

async function handleCreate() {
  if (!createForm.value.name.trim()) return
  isCreating.value = true
  try {
    await $fetch('/api/departments', {
      method: 'POST',
      body: {
        name: createForm.value.name.trim(),
        parentId: createForm.value.parentId || null,
        // Не выбрано + есть родитель → companyId наследуется на сервере от родителя
        ...(createForm.value.companyId
          ? { companyId: createForm.value.companyId }
          : createForm.value.parentId ? {} : { companyId: null }),
      },
    })
    track('department_created')
    toastSuccess('Подразделение создано')
    createForm.value = { name: '', parentId: '', companyId: '' }
    showCreate.value = false
    await refresh()
  } catch (e: any) {
    toastError(e?.data?.statusMessage || 'Не удалось создать подразделение')
  } finally {
    isCreating.value = false
  }
}

/** Быстрое добавление дочернего узла: открывает форму с предзаполненным родителем */
function startCreateChild(d: DepartmentRow) {
  showCreate.value = true
  createForm.value = { name: '', parentId: d.id, companyId: '' }
}

// ── Редактирование ──
const editingId = ref<string | null>(null)
const editForm = ref({ name: '', parentId: '', companyId: '' })
const isSavingEdit = ref(false)

function startEdit(d: DepartmentRow) {
  editingId.value = d.id
  editForm.value = { name: d.name, parentId: d.parentId ?? '', companyId: d.companyId ?? '' }
}

/** Родитель для редактируемого узла: без самого узла (циклы дополнительно проверяет сервер) */
const editParentOptions = computed(() =>
  parentOptions.value.filter(o => o.id !== editingId.value),
)

async function handleSaveEdit() {
  if (!editingId.value || !editForm.value.name.trim()) return
  isSavingEdit.value = true
  try {
    await $fetch(`/api/departments/${editingId.value}`, {
      method: 'PATCH',
      body: {
        name: editForm.value.name.trim(),
        parentId: editForm.value.parentId || null,
        companyId: editForm.value.companyId || null,
      },
    })
    toastSuccess('Подразделение обновлено')
    editingId.value = null
    await refresh()
  } catch (e: any) {
    toastError(e?.data?.statusMessage || 'Не удалось обновить подразделение')
  } finally {
    isSavingEdit.value = false
  }
}

// ── Действия ──
const busyId = ref<string | null>(null)

async function handleToggleArchive(d: DepartmentRow) {
  busyId.value = d.id
  try {
    await $fetch(`/api/departments/${d.id}`, { method: 'PATCH', body: { isArchived: !d.isArchived } })
    toastSuccess(d.isArchived ? 'Подразделение восстановлено' : 'Подразделение архивировано')
    await refresh()
  } catch (e: any) {
    toastError(e?.data?.statusMessage || 'Не удалось изменить статус подразделения')
  } finally {
    busyId.value = null
  }
}

async function handleDelete(d: DepartmentRow) {
  const confirmed = await confirmAsk({
    title: `Удалить подразделение «${d.name}»?`,
    message: 'Действие необратимо. Удаление возможно только для узлов без дочерних подразделений и вакансий.',
    variant: 'danger',
    confirmLabel: 'Удалить',
  })
  if (!confirmed) return
  busyId.value = d.id
  try {
    await $fetch(`/api/departments/${d.id}`, { method: 'DELETE' })
    toastSuccess('Подразделение удалено')
    await refresh()
  } catch (e: any) {
    toastError(e?.data?.statusMessage || 'Не удалось удалить подразделение')
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <!-- Page title -->
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">
          Подразделения
        </h1>
        <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
          Оргструктура с произвольной вложенностью: дирекция → департамент → отдел → сектор.
        </p>
      </div>
      <button
        v-if="canManage"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3 py-2 transition-colors shrink-0"
        @click="showCreate = !showCreate"
      >
        <Plus class="size-4" />
        Добавить
      </button>
    </div>

    <!-- Create form -->
    <section
      v-if="showCreate && canManage"
      class="mb-4 rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/40 dark:bg-brand-950/20 px-4 sm:px-6 py-5"
    >
      <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">Новое подразделение</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="sm:col-span-2">
          <label for="deptName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Название <span class="text-danger-500">*</span></label>
          <input
            id="deptName"
            v-model="createForm.name"
            type="text"
            placeholder="Департамент разработки"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            @keydown.enter.prevent="handleCreate"
          />
        </div>
        <div>
          <label for="deptParent" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Родительское подразделение</label>
          <select
            id="deptParent"
            v-model="createForm.parentId"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          >
            <option value="">— Корневой узел —</option>
            <option v-for="opt in parentOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
          </select>
        </div>
        <div>
          <label for="deptCompany" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Компания (юрлицо)</label>
          <select
            id="deptCompany"
            v-model="createForm.companyId"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          >
            <option value="">{{ createForm.parentId ? '— Как у родителя —' : '— Общее для организации —' }}</option>
            <option v-for="c in companies" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
      </div>
      <div class="mt-4 flex items-center gap-2">
        <button
          type="button"
          :disabled="isCreating || !createForm.name.trim()"
          class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-3 py-2 transition-colors"
          @click="handleCreate"
        >
          <Loader2 v-if="isCreating" class="size-4 animate-spin" />
          <Check v-else class="size-4" />
          Создать
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium px-3 py-2 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          @click="showCreate = false"
        >
          Отмена
        </button>
      </div>
    </section>

    <!-- Company filter -->
    <div v-if="companies.length > 1" class="mb-4">
      <select
        v-model="companyFilter"
        class="rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
      >
        <option value="all">Все компании</option>
        <option v-for="c in companies" :key="c.id" :value="c.id">{{ c.name }}</option>
        <option value="none">Без компании</option>
      </select>
    </div>

    <!-- Tree list -->
    <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
      <div v-if="pending" class="flex items-center justify-center py-12 text-surface-400">
        <Loader2 class="size-5 animate-spin" />
      </div>

      <div v-else-if="!filteredDepartments.length" class="px-6 py-12 text-center">
        <Network class="size-8 mx-auto text-surface-300 dark:text-surface-600 mb-3" />
        <p class="text-sm text-surface-500 dark:text-surface-400">Подразделений пока нет — создайте первый узел оргструктуры.</p>
      </div>

      <ul v-else class="divide-y divide-surface-100 dark:divide-surface-800">
        <li v-for="d in filteredDepartments" :key="d.id" class="px-4 sm:px-6 py-3" :class="d.isArchived ? 'opacity-60' : ''">
          <!-- Edit mode -->
          <div v-if="editingId === d.id" class="space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                v-model="editForm.name"
                type="text"
                placeholder="Название"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
                @keydown.enter.prevent="handleSaveEdit"
              />
              <select
                v-model="editForm.parentId"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
              >
                <option value="">— Корневой узел —</option>
                <option v-for="opt in editParentOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
              </select>
              <select
                v-model="editForm.companyId"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
              >
                <option value="">— Общее для организации —</option>
                <option v-for="c in companies" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                :disabled="isSavingEdit || !editForm.name.trim()"
                class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-medium px-2.5 py-1.5 transition-colors"
                @click="handleSaveEdit"
              >
                <Loader2 v-if="isSavingEdit" class="size-3.5 animate-spin" />
                <Check v-else class="size-3.5" />
                Сохранить
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg text-xs font-medium px-2.5 py-1.5 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                @click="editingId = null"
              >
                <X class="size-3.5" />
                Отмена
              </button>
            </div>
          </div>

          <!-- View mode -->
          <div v-else class="flex items-center gap-2">
            <div class="flex items-center shrink-0" :style="{ paddingLeft: `${d.depth * 20}px` }">
              <CornerDownRight v-if="d.depth > 0" class="size-3.5 text-surface-300 dark:text-surface-600 mr-1.5" />
              <Network v-else class="size-3.5 text-surface-400 dark:text-surface-500 mr-1.5" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{{ d.name }}</span>
                <span
                  v-if="d.companyId && companyNameMap.get(d.companyId)"
                  class="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[11px] font-medium text-surface-500 dark:text-surface-400"
                >
                  {{ companyNameMap.get(d.companyId) }}
                </span>
                <span
                  v-if="d.isArchived"
                  class="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[11px] font-medium text-surface-500 dark:text-surface-400"
                >
                  Архив
                </span>
                <span v-if="d.jobsCount > 0" class="text-[11px] text-surface-400 dark:text-surface-500">
                  {{ d.jobsCount }} вак.
                </span>
              </div>
            </div>
            <div v-if="canManage" class="flex items-center gap-0.5 shrink-0">
              <button
                v-if="!d.isArchived"
                type="button"
                title="Добавить дочернее подразделение"
                class="p-2 rounded-lg text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                @click="startCreateChild(d)"
              >
                <Plus class="size-4" />
              </button>
              <button
                v-if="!d.isArchived"
                type="button"
                title="Редактировать"
                class="p-2 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                @click="startEdit(d)"
              >
                <Pencil class="size-4" />
              </button>
              <button
                type="button"
                :title="d.isArchived ? 'Восстановить' : 'Архивировать'"
                :disabled="busyId === d.id"
                class="p-2 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                @click="handleToggleArchive(d)"
              >
                <ArchiveRestore v-if="d.isArchived" class="size-4" />
                <Archive v-else class="size-4" />
              </button>
              <button
                v-if="!d.hasChildren && d.jobsCount === 0"
                type="button"
                title="Удалить"
                :disabled="busyId === d.id"
                class="p-2 rounded-lg text-surface-400 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors"
                @click="handleDelete(d)"
              >
                <Trash2 class="size-4" />
              </button>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <p class="mt-4 text-xs text-surface-400 dark:text-surface-500">
      Вложенность не ограничена. Узлы с дочерними подразделениями или вакансиями удалить нельзя — только архивировать.
    </p>
  </div>
</template>
