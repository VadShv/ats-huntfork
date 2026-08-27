<script setup lang="ts">
import { Landmark, Plus, Pencil, Trash2, Archive, ArchiveRestore, Star, Loader2, X, Check } from 'lucide-vue-next'

definePageMeta({})

useSeoMeta({
  title: 'Компании',
  description: 'Справочник юрлиц холдинга: вакансии ведутся от имени выбранной компании',
})

interface CompanyRow {
  id: string
  name: string
  legalName: string | null
  inn: string | null
  logoUrl: string | null
  isDefault: boolean
  isArchived: boolean
  sortOrder: number
  jobsCount: number
  departmentsCount: number
}

const { allowed: canManage } = usePermission({ company: ['update'] })
const { success: toastSuccess, error: toastError } = useToast()
const { ask: confirmAsk } = useConfirm()
const { track } = useTrack()

const { data, refresh, pending } = useFetch<CompanyRow[]>('/api/companies', {
  headers: useRequestHeaders(['cookie']),
})
const companies = computed(() => data.value ?? [])
const activeCompanies = computed(() => companies.value.filter(c => !c.isArchived))
const archivedCompanies = computed(() => companies.value.filter(c => c.isArchived))

// ── Создание ──
const showCreate = ref(false)
const createForm = ref({ name: '', legalName: '', inn: '' })
const isCreating = ref(false)

async function handleCreate() {
  if (!createForm.value.name.trim()) return
  isCreating.value = true
  try {
    await $fetch('/api/companies', {
      method: 'POST',
      body: {
        name: createForm.value.name.trim(),
        legalName: createForm.value.legalName.trim() || null,
        inn: createForm.value.inn.trim() || null,
      },
    })
    track('company_created')
    toastSuccess('Компания создана')
    createForm.value = { name: '', legalName: '', inn: '' }
    showCreate.value = false
    await refresh()
  } catch (e: any) {
    toastError(e?.data?.statusMessage || 'Не удалось создать компанию')
  } finally {
    isCreating.value = false
  }
}

// ── Редактирование ──
const editingId = ref<string | null>(null)
const editForm = ref({ name: '', legalName: '', inn: '' })
const isSavingEdit = ref(false)

function startEdit(c: CompanyRow) {
  editingId.value = c.id
  editForm.value = { name: c.name, legalName: c.legalName ?? '', inn: c.inn ?? '' }
}

async function handleSaveEdit() {
  if (!editingId.value || !editForm.value.name.trim()) return
  isSavingEdit.value = true
  try {
    await $fetch(`/api/companies/${editingId.value}`, {
      method: 'PATCH',
      body: {
        name: editForm.value.name.trim(),
        legalName: editForm.value.legalName.trim() || null,
        inn: editForm.value.inn.trim() || null,
      },
    })
    toastSuccess('Компания обновлена')
    editingId.value = null
    await refresh()
  } catch (e: any) {
    toastError(e?.data?.statusMessage || 'Не удалось обновить компанию')
  } finally {
    isSavingEdit.value = false
  }
}

// ── Действия ──
const busyId = ref<string | null>(null)

async function handleSetDefault(c: CompanyRow) {
  busyId.value = c.id
  try {
    await $fetch(`/api/companies/${c.id}`, { method: 'PATCH', body: { isDefault: true } })
    toastSuccess(`«${c.name}» — теперь компания по умолчанию`)
    await refresh()
  } catch (e: any) {
    toastError(e?.data?.statusMessage || 'Не удалось изменить компанию по умолчанию')
  } finally {
    busyId.value = null
  }
}

async function handleToggleArchive(c: CompanyRow) {
  busyId.value = c.id
  try {
    await $fetch(`/api/companies/${c.id}`, { method: 'PATCH', body: { isArchived: !c.isArchived } })
    toastSuccess(c.isArchived ? 'Компания восстановлена' : 'Компания архивирована')
    await refresh()
  } catch (e: any) {
    toastError(e?.data?.statusMessage || 'Не удалось изменить статус компании')
  } finally {
    busyId.value = null
  }
}

async function handleDelete(c: CompanyRow) {
  const confirmed = await confirmAsk({
    title: `Удалить компанию «${c.name}»?`,
    message: 'Действие необратимо. Удаление возможно только для компаний без вакансий и подразделений.',
    variant: 'danger',
    confirmLabel: 'Удалить',
  })
  if (!confirmed) return
  busyId.value = c.id
  try {
    await $fetch(`/api/companies/${c.id}`, { method: 'DELETE' })
    toastSuccess('Компания удалена')
    await refresh()
  } catch (e: any) {
    toastError(e?.data?.statusMessage || 'Не удалось удалить компанию')
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
          Компании
        </h1>
        <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
          Юрлица холдинга: вакансия ведётся от имени выбранной компании, кандидаты остаются в общей базе.
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
      <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">Новая компания</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="sm:col-span-2">
          <label for="companyName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Название <span class="text-danger-500">*</span></label>
          <input
            id="companyName"
            v-model="createForm.name"
            type="text"
            placeholder="Астра"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            @keydown.enter.prevent="handleCreate"
          />
        </div>
        <div>
          <label for="companyLegalName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Юридическое наименование</label>
          <input
            id="companyLegalName"
            v-model="createForm.legalName"
            type="text"
            placeholder="ООО «Группа Астра»"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          />
        </div>
        <div>
          <label for="companyInn" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">ИНН</label>
          <input
            id="companyInn"
            v-model="createForm.inn"
            type="text"
            placeholder="7700000000"
            maxlength="12"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          />
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

    <!-- List -->
    <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
      <div v-if="pending" class="flex items-center justify-center py-12 text-surface-400">
        <Loader2 class="size-5 animate-spin" />
      </div>

      <div v-else-if="!companies.length" class="px-6 py-12 text-center">
        <Landmark class="size-8 mx-auto text-surface-300 dark:text-surface-600 mb-3" />
        <p class="text-sm text-surface-500 dark:text-surface-400">Компаний пока нет — добавьте первое юрлицо.</p>
      </div>

      <ul v-else class="divide-y divide-surface-100 dark:divide-surface-800">
        <li v-for="c in [...activeCompanies, ...archivedCompanies]" :key="c.id" class="px-4 sm:px-6 py-4" :class="c.isArchived ? 'opacity-60' : ''">
          <!-- Edit mode -->
          <div v-if="editingId === c.id" class="space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                v-model="editForm.name"
                type="text"
                placeholder="Название"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
                @keydown.enter.prevent="handleSaveEdit"
              />
              <input
                v-model="editForm.legalName"
                type="text"
                placeholder="Юр. наименование"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
              />
              <input
                v-model="editForm.inn"
                type="text"
                placeholder="ИНН"
                maxlength="12"
                class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
              />
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
          <div v-else class="flex items-center gap-3">
            <div class="flex items-center justify-center size-9 shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400">
              <Landmark class="size-4" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{{ c.name }}</span>
                <span
                  v-if="c.isDefault"
                  class="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-950/40 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800"
                >
                  <Star class="size-3" />
                  По умолчанию
                </span>
                <span
                  v-if="c.isArchived"
                  class="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[11px] font-medium text-surface-500 dark:text-surface-400"
                >
                  Архив
                </span>
              </div>
              <p class="text-xs text-surface-400 dark:text-surface-500 mt-0.5 truncate">
                <template v-if="c.legalName">{{ c.legalName }}</template>
                <template v-if="c.legalName && c.inn"> · </template>
                <template v-if="c.inn">ИНН {{ c.inn }}</template>
                <template v-if="c.legalName || c.inn"> · </template>
                {{ c.jobsCount }} вак. · {{ c.departmentsCount }} подразд.
              </p>
            </div>
            <div v-if="canManage" class="flex items-center gap-0.5 shrink-0">
              <button
                v-if="!c.isDefault && !c.isArchived"
                type="button"
                title="Сделать компанией по умолчанию"
                :disabled="busyId === c.id"
                class="p-2 rounded-lg text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                @click="handleSetDefault(c)"
              >
                <Star class="size-4" />
              </button>
              <button
                v-if="!c.isArchived"
                type="button"
                title="Редактировать"
                class="p-2 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                @click="startEdit(c)"
              >
                <Pencil class="size-4" />
              </button>
              <button
                v-if="!c.isDefault"
                type="button"
                :title="c.isArchived ? 'Восстановить' : 'Архивировать'"
                :disabled="busyId === c.id"
                class="p-2 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                @click="handleToggleArchive(c)"
              >
                <ArchiveRestore v-if="c.isArchived" class="size-4" />
                <Archive v-else class="size-4" />
              </button>
              <button
                v-if="!c.isDefault && c.jobsCount === 0 && c.departmentsCount === 0"
                type="button"
                title="Удалить"
                :disabled="busyId === c.id"
                class="p-2 rounded-lg text-surface-400 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors"
                @click="handleDelete(c)"
              >
                <Trash2 class="size-4" />
              </button>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <p class="mt-4 text-xs text-surface-400 dark:text-surface-500">
      Компания по умолчанию подставляется в новые вакансии автоматически. Используемые компании удалить нельзя — только архивировать.
    </p>
  </div>
</template>
