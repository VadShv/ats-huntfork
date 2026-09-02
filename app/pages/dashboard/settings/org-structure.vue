<script setup lang="ts">
import {
  Landmark, Network, Plus, Pencil, Trash2, Archive, ArchiveRestore, Star,
  Loader2, X, Check, CornerDownRight, ChevronDown, ChevronRight,
} from 'lucide-vue-next'

definePageMeta({})

useSeoMeta({
  title: 'Оргструктура',
  description: 'Компании и подразделения: иерархия юрлиц и оргструктуры для привязки вакансий',
})

interface CompanyRow {
  id: string
  name: string
  legalName: string | null
  inn: string | null
  isDefault: boolean
  isArchived: boolean
  jobsCount: number
  departmentsCount: number
}

interface DepartmentRow {
  id: string
  name: string
  companyId: string | null
  parentId: string | null
  isArchived: boolean
  depth: number
  hasChildren: boolean
  jobsCount: number
}

const { allowed: canManage } = usePermission({ company: ['update'] })
const { success: toastSuccess, error: toastError } = useToast()
const { ask: confirmAsk } = useConfirm()
const { track } = useTrack()

const { data: companiesData, refresh: refreshCompanies, pending: companiesPending } = useFetch<CompanyRow[]>('/api/companies', {
  headers: useRequestHeaders(['cookie']),
})
const companies = computed(() => companiesData.value ?? [])
const activeCompanies = computed(() => companies.value.filter(c => !c.isArchived))
const archivedCompanies = computed(() => companies.value.filter(c => c.isArchived))

const { data: deptsData, refresh: refreshDepts, pending: deptsPending } = useFetch<DepartmentRow[]>('/api/departments', {
  headers: useRequestHeaders(['cookie']),
})
const allDepartments = computed(() => deptsData.value ?? [])

function deptsForCompany(companyId: string): DepartmentRow[] {
  return allDepartments.value.filter(d => d.companyId === companyId)
}
const commonDepartments = computed(() => allDepartments.value.filter(d => !d.companyId))

async function refresh() {
  await Promise.all([refreshCompanies(), refreshDepts()])
}
const pending = computed(() => companiesPending.value || deptsPending.value)

const expandedCompanies = ref<Set<string>>(new Set())
function toggleCompany(id: string) {
  const s = new Set(expandedCompanies.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expandedCompanies.value = s
}

// ── Создание компании ──
const showCreateCompany = ref(false)
const companyForm = ref({ name: '', legalName: '', inn: '' })
const isCreatingCompany = ref(false)

async function handleCreateCompany() {
  if (!companyForm.value.name.trim()) return
  isCreatingCompany.value = true
  try {
    const c = await $fetch<CompanyRow>('/api/companies', {
      method: 'POST',
      body: {
        name: companyForm.value.name.trim(),
        legalName: companyForm.value.legalName.trim() || null,
        inn: companyForm.value.inn.trim() || null,
      },
    })
    track('company_created')
    toastSuccess('Компания создана')
    expandedCompanies.value = new Set([...expandedCompanies.value, c.id])
    companyForm.value = { name: '', legalName: '', inn: '' }
    showCreateCompany.value = false
    await refresh()
  } catch (e: any) {
    toastError(e?.data?.statusMessage || 'Не удалось создать компанию')
  } finally {
    isCreatingCompany.value = false
  }
}

// ── Редактирование компании ──
const editingCompanyId = ref<string | null>(null)
const companyEditForm = ref({ name: '', legalName: '', inn: '' })

function startEditCompany(c: CompanyRow) {
  editingCompanyId.value = c.id
  companyEditForm.value = { name: c.name, legalName: c.legalName ?? '', inn: c.inn ?? '' }
}

async function handleSaveCompany() {
  if (!editingCompanyId.value || !companyEditForm.value.name.trim()) return
  try {
    await $fetch(`/api/companies/${editingCompanyId.value}`, {
      method: 'PATCH',
      body: {
        name: companyEditForm.value.name.trim(),
        legalName: companyEditForm.value.legalName.trim() || null,
        inn: companyEditForm.value.inn.trim() || null,
      },
    })
    toastSuccess('Компания обновлена')
    editingCompanyId.value = null
    await refresh()
  } catch (e: any) {
    toastError(e?.data?.statusMessage || 'Не удалось обновить компанию')
  }
}

// ── Создание подразделения ──
const showCreateDept = ref(false)
const deptForm = ref({ name: '', parentId: '', companyId: '' })
const isCreatingDept = ref(false)
const deptFormTitle = ref('Новое подразделение')

function startCreateDeptForCompany(companyId: string) {
  deptFormTitle.value = 'Подразделение под компанией'
  deptForm.value = { name: '', parentId: '', companyId }
  showCreateDept.value = true
}

function startCreateChildDept(d: DepartmentRow) {
  deptFormTitle.value = 'Дочернее подразделение'
  deptForm.value = { name: '', parentId: d.id, companyId: '' }
  showCreateDept.value = true
}

async function handleCreateDept() {
  if (!deptForm.value.name.trim()) return
  isCreatingDept.value = true
  try {
    await $fetch('/api/departments', {
      method: 'POST',
      body: {
        name: deptForm.value.name.trim(),
        parentId: deptForm.value.parentId || null,
        ...(deptForm.value.companyId
          ? { companyId: deptForm.value.companyId }
          : deptForm.value.parentId ? {} : { companyId: null }),
      },
    })
    track('department_created')
    toastSuccess('Подразделение создано')
    deptForm.value = { name: '', parentId: '', companyId: '' }
    showCreateDept.value = false
    await refresh()
  } catch (e: any) {
    toastError(e?.data?.statusMessage || 'Не удалось создать подразделение')
  } finally {
    isCreatingDept.value = false
  }
}

// ── Редактирование подразделения ──
const editingDeptId = ref<string | null>(null)
const deptEditForm = ref({ name: '', parentId: '', companyId: '' })

function startEditDept(d: DepartmentRow) {
  editingDeptId.value = d.id
  deptEditForm.value = { name: d.name, parentId: d.parentId ?? '', companyId: d.companyId ?? '' }
}

const parentOptions = computed(() =>
  allDepartments.value.filter(d => !d.isArchived).map(d => ({
    id: d.id,
    label: `${'\u00A0\u00A0\u00A0\u00A0'.repeat(d.depth)}${d.name}`,
  })),
)
const editParentOptions = computed(() => parentOptions.value.filter(o => o.id !== editingDeptId.value))

async function handleSaveDept() {
  if (!editingDeptId.value || !deptEditForm.value.name.trim()) return
  try {
    await $fetch(`/api/departments/${editingDeptId.value}`, {
      method: 'PATCH',
      body: {
        name: deptEditForm.value.name.trim(),
        parentId: deptEditForm.value.parentId || null,
        companyId: deptEditForm.value.companyId || null,
      },
    })
    toastSuccess('Подразделение обновлено')
    editingDeptId.value = null
    await refresh()
  } catch (e: any) {
    toastError(e?.data?.statusMessage || 'Не удалось обновить подразделение')
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

async function handleToggleArchiveCompany(c: CompanyRow) {
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

async function handleDeleteCompany(c: CompanyRow) {
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

async function handleToggleArchiveDept(d: DepartmentRow) {
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

async function handleDeleteDept(d: DepartmentRow) {
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

const inputCls = 'w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors'
const btnPrimary = 'inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-3 py-2 transition-colors'
const btnGhost = 'inline-flex items-center gap-1.5 rounded-lg text-sm font-medium px-3 py-2 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors'
const iconBtn = 'p-2 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors'
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">Оргструктура</h1>
        <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
          Компании (юрлица) и их подразделения. Вакансия привязывается к компании и подразделению.
        </p>
      </div>
      <button v-if="canManage" type="button" :class="btnPrimary" class="shrink-0" @click="showCreateCompany = !showCreateCompany">
        <Plus class="size-4" /> Компания
      </button>
    </div>

    <!-- Create company form -->
    <section v-if="showCreateCompany && canManage" class="mb-4 rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/40 dark:bg-brand-950/20 px-4 sm:px-6 py-5">
      <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">Новая компания</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="sm:col-span-2">
          <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Название <span class="text-danger-500">*</span></label>
          <input v-model="companyForm.name" type="text" placeholder="Астра" :class="inputCls" @keydown.enter.prevent="handleCreateCompany" />
        </div>
        <div>
          <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Юр. наименование</label>
          <input v-model="companyForm.legalName" type="text" placeholder="ООО «Группа Астра»" :class="inputCls" />
        </div>
        <div>
          <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">ИНН</label>
          <input v-model="companyForm.inn" type="text" placeholder="7700000000" maxlength="12" :class="inputCls" />
        </div>
      </div>
      <div class="mt-4 flex items-center gap-2">
        <button type="button" :disabled="isCreatingCompany || !companyForm.name.trim()" :class="btnPrimary" @click="handleCreateCompany">
          <Loader2 v-if="isCreatingCompany" class="size-4 animate-spin" /><Check v-else class="size-4" /> Создать
        </button>
        <button type="button" :class="btnGhost" @click="showCreateCompany = false"><X class="size-4" />Отмена</button>
      </div>
    </section>

    <!-- Create department form -->
    <section v-if="showCreateDept && canManage" class="mb-4 rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/40 dark:bg-brand-950/20 px-4 sm:px-6 py-5">
      <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">{{ deptFormTitle }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="sm:col-span-2">
          <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Название <span class="text-danger-500">*</span></label>
          <input v-model="deptForm.name" type="text" placeholder="Департамент разработки" :class="inputCls" @keydown.enter.prevent="handleCreateDept" />
        </div>
        <div>
          <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Родительское подразделение</label>
          <select v-model="deptForm.parentId" :class="inputCls">
            <option value="">— Корневой узел —</option>
            <option v-for="opt in parentOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Компания</label>
          <select v-model="deptForm.companyId" :class="inputCls">
            <option value="">{{ deptForm.parentId ? '— Как у родителя —' : '— Общее для организации —' }}</option>
            <option v-for="c in activeCompanies" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
      </div>
      <div class="mt-4 flex items-center gap-2">
        <button type="button" :disabled="isCreatingDept || !deptForm.name.trim()" :class="btnPrimary" @click="handleCreateDept">
          <Loader2 v-if="isCreatingDept" class="size-4 animate-spin" /><Check v-else class="size-4" /> Создать
        </button>
        <button type="button" :class="btnGhost" @click="showCreateDept = false"><X class="size-4" />Отмена</button>
      </div>
    </section>

    <!-- Loading -->
    <div v-if="pending" class="flex items-center justify-center py-12 text-surface-400">
      <Loader2 class="size-5 animate-spin" />
    </div>

    <!-- Empty -->
    <div v-else-if="!companies.length" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-6 py-12 text-center">
      <Landmark class="size-8 mx-auto text-surface-300 dark:text-surface-600 mb-3" />
      <p class="text-sm text-surface-500 dark:text-surface-400">Компаний пока нет — добавьте первое юрлицо.</p>
    </div>

    <!-- Tree -->
    <div v-else class="space-y-3">
      <section
        v-for="c in [...activeCompanies, ...archivedCompanies]"
        :key="c.id"
        class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden"
        :class="c.isArchived ? 'opacity-60' : ''"
      >
        <!-- Company header -->
        <div class="px-4 sm:px-6 py-4">
          <div v-if="editingCompanyId === c.id" class="space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input v-model="companyEditForm.name" type="text" placeholder="Название" :class="inputCls" @keydown.enter.prevent="handleSaveCompany" />
              <input v-model="companyEditForm.legalName" type="text" placeholder="Юр. наименование" :class="inputCls" />
              <input v-model="companyEditForm.inn" type="text" placeholder="ИНН" maxlength="12" :class="inputCls" />
            </div>
            <div class="flex items-center gap-2">
              <button type="button" :disabled="!companyEditForm.name.trim()" class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-medium px-2.5 py-1.5 transition-colors" @click="handleSaveCompany"><Check class="size-3.5" />Сохранить</button>
              <button type="button" class="inline-flex items-center gap-1.5 rounded-lg text-xs font-medium px-2.5 py-1.5 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors" @click="editingCompanyId = null"><X class="size-3.5" />Отмена</button>
            </div>
          </div>
          <div v-else class="flex items-center gap-3">
            <button v-if="deptsForCompany(c.id).length" type="button" class="p-1 rounded-lg text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors shrink-0" @click="toggleCompany(c.id)">
              <ChevronDown v-if="expandedCompanies.has(c.id)" class="size-4" /><ChevronRight v-else class="size-4" />
            </button>
            <div class="flex items-center justify-center size-9 shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400" :class="!deptsForCompany(c.id).length ? 'ml-5' : ''">
              <Landmark class="size-4" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{{ c.name }}</span>
                <span v-if="c.isDefault" class="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-950/40 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800"><Star class="size-3" />По умолчанию</span>
                <span v-if="c.isArchived" class="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[11px] font-medium text-surface-500 dark:text-surface-400">Архив</span>
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
              <button v-if="!c.isArchived" type="button" title="Добавить подразделение" :class="iconBtn" @click="startCreateDeptForCompany(c.id)"><Plus class="size-4" /></button>
              <button v-if="!c.isDefault && !c.isArchived" type="button" title="По умолчанию" :disabled="busyId === c.id" :class="iconBtn" class="hover:text-brand-600 dark:hover:text-brand-400" @click="handleSetDefault(c)"><Star class="size-4" /></button>
              <button v-if="!c.isArchived" type="button" title="Редактировать" :class="iconBtn" @click="startEditCompany(c)"><Pencil class="size-4" /></button>
              <button v-if="!c.isDefault" type="button" :title="c.isArchived ? 'Восстановить' : 'Архивировать'" :disabled="busyId === c.id" :class="iconBtn" @click="handleToggleArchiveCompany(c)"><ArchiveRestore v-if="c.isArchived" class="size-4" /><Archive v-else class="size-4" /></button>
              <button v-if="!c.isDefault && c.jobsCount === 0 && c.departmentsCount === 0" type="button" title="Удалить" :disabled="busyId === c.id" :class="iconBtn" class="hover:text-danger-600 dark:hover:text-danger-400" @click="handleDeleteCompany(c)"><Trash2 class="size-4" /></button>
            </div>
          </div>
        </div>

        <!-- Department tree under this company -->
        <div v-if="deptsForCompany(c.id).length && expandedCompanies.has(c.id)" class="border-t border-surface-100 dark:border-surface-800">
          <ul class="divide-y divide-surface-100 dark:divide-surface-800">
            <li v-for="d in deptsForCompany(c.id)" :key="d.id" class="px-4 sm:px-6 py-3" :class="d.isArchived ? 'opacity-60' : ''">
              <div v-if="editingDeptId === d.id" class="space-y-3">
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input v-model="deptEditForm.name" type="text" placeholder="Название" :class="inputCls" @keydown.enter.prevent="handleSaveDept" />
                  <select v-model="deptEditForm.parentId" :class="inputCls">
                    <option value="">— Корневой узел —</option>
                    <option v-for="opt in editParentOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
                  </select>
                  <select v-model="deptEditForm.companyId" :class="inputCls">
                    <option value="">— Общее —</option>
                    <option v-for="co in activeCompanies" :key="co.id" :value="co.id">{{ co.name }}</option>
                  </select>
                </div>
                <div class="flex items-center gap-2">
                  <button type="button" :disabled="!deptEditForm.name.trim()" class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-medium px-2.5 py-1.5 transition-colors" @click="handleSaveDept"><Check class="size-3.5" />Сохранить</button>
                  <button type="button" class="inline-flex items-center gap-1.5 rounded-lg text-xs font-medium px-2.5 py-1.5 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors" @click="editingDeptId = null"><X class="size-3.5" />Отмена</button>
                </div>
              </div>
              <div v-else class="flex items-center gap-2">
                <div class="flex items-center shrink-0" :style="{ paddingLeft: `${d.depth * 20}px` }">
                  <CornerDownRight v-if="d.depth > 0" class="size-3.5 text-surface-300 dark:text-surface-600 mr-1.5" />
                  <Network v-else class="size-3.5 text-surface-400 dark:text-surface-500 mr-1.5" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{{ d.name }}</span>
                    <span v-if="d.isArchived" class="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[11px] font-medium text-surface-500 dark:text-surface-400">Архив</span>
                    <span v-if="d.jobsCount > 0" class="text-[11px] text-surface-400 dark:text-surface-500">{{ d.jobsCount }} вак.</span>
                  </div>
                </div>
                <div v-if="canManage" class="flex items-center gap-0.5 shrink-0">
                  <button v-if="!d.isArchived" type="button" title="Дочернее подразделение" :class="iconBtn" @click="startCreateChildDept(d)"><Plus class="size-4" /></button>
                  <button v-if="!d.isArchived" type="button" title="Редактировать" :class="iconBtn" @click="startEditDept(d)"><Pencil class="size-4" /></button>
                  <button type="button" :title="d.isArchived ? 'Восстановить' : 'Архивировать'" :disabled="busyId === d.id" :class="iconBtn" @click="handleToggleArchiveDept(d)"><ArchiveRestore v-if="d.isArchived" class="size-4" /><Archive v-else class="size-4" /></button>
                  <button v-if="!d.hasChildren && d.jobsCount === 0" type="button" title="Удалить" :disabled="busyId === d.id" :class="iconBtn" class="hover:text-danger-600 dark:hover:text-danger-400" @click="handleDeleteDept(d)"><Trash2 class="size-4" /></button>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <!-- Common departments (without company) -->
      <section v-if="commonDepartments.length" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
        <div class="px-4 sm:px-6 py-3 border-b border-surface-100 dark:border-surface-800">
          <div class="flex items-center gap-2">
            <Network class="size-4 text-surface-400" />
            <span class="text-sm font-medium text-surface-700 dark:text-surface-300">Общие подразделения (без компании)</span>
          </div>
        </div>
        <ul class="divide-y divide-surface-100 dark:divide-surface-800">
          <li v-for="d in commonDepartments" :key="d.id" class="px-4 sm:px-6 py-3" :class="d.isArchived ? 'opacity-60' : ''">
            <div class="flex items-center gap-2">
              <div class="flex items-center shrink-0" :style="{ paddingLeft: `${d.depth * 20}px` }">
                <CornerDownRight v-if="d.depth > 0" class="size-3.5 text-surface-300 dark:text-surface-600 mr-1.5" />
                <Network v-else class="size-3.5 text-surface-400 dark:text-surface-500 mr-1.5" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{{ d.name }}</span>
                  <span v-if="d.isArchived" class="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[11px] font-medium text-surface-500 dark:text-surface-400">Архив</span>
                  <span v-if="d.jobsCount > 0" class="text-[11px] text-surface-400 dark:text-surface-500">{{ d.jobsCount }} вак.</span>
                </div>
              </div>
              <div v-if="canManage" class="flex items-center gap-0.5 shrink-0">
                <button v-if="!d.isArchived" type="button" title="Дочернее подразделение" :class="iconBtn" @click="startCreateChildDept(d)"><Plus class="size-4" /></button>
                <button v-if="!d.isArchived" type="button" title="Редактировать" :class="iconBtn" @click="startEditDept(d)"><Pencil class="size-4" /></button>
                <button type="button" :title="d.isArchived ? 'Восстановить' : 'Архивировать'" :disabled="busyId === d.id" :class="iconBtn" @click="handleToggleArchiveDept(d)"><ArchiveRestore v-if="d.isArchived" class="size-4" /><Archive v-else class="size-4" /></button>
                <button v-if="!d.hasChildren && d.jobsCount === 0" type="button" title="Удалить" :disabled="busyId === d.id" :class="iconBtn" class="hover:text-danger-600 dark:hover:text-danger-400" @click="handleDeleteDept(d)"><Trash2 class="size-4" /></button>
              </div>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <p class="mt-4 text-xs text-surface-400 dark:text-surface-500">
      Компания по умолчанию подставляется в новые вакансии. Подразделения вложены под свою компанию. Вложенность не ограничена.
    </p>
  </div>
</template>
