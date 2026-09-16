<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'

export interface HhTemplateRow {
  id: string
  name: string
  description: string | null
  vacancyData: Record<string, unknown>
  hhAreaId: string | null
  hhProfArea: string[] | null
  isShared: boolean
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
  organizationId: string
  createdByUserId: string | null
}

interface Prefill {
  name?: string
  vacancyName?: string
  salaryFrom?: number | null
  salaryTo?: number | null
  currency?: string
  area?: string
  employmentType?: string
  vacancyDescription?: string
  keySkills?: string[]
}

const props = withDefaults(defineProps<{
  show: boolean
  template?: HhTemplateRow | null
  prefill?: Prefill | null
}>(), {
  template: null,
  prefill: null,
})

const emit = defineEmits<{
  'update:show': [value: boolean]
  'saved': []
}>()

const { t } = useI18n()
const toast = useToast()

const isEdit = computed(() => !!props.template)

const form = ref({
  name: '',
  description: '',
  vacancyName: '',
  salaryFrom: null as number | null,
  salaryTo: null as number | null,
  currency: 'RUR',
  area: '',
  employmentType: 'full',
  vacancyDescription: '',
  keySkills: [] as string[],
  isShared: true,
})

const newSkill = ref('')
const nameError = ref('')
const saving = ref(false)

const employmentOptions = [
  { value: 'full', label: 'Полная занятость' },
  { value: 'part', label: 'Частичная занятость' },
  { value: 'project', label: 'Проектная работа' },
  { value: 'volunteer', label: 'Волонтёрство' },
  { value: 'probation', label: 'Стажировка' },
]

const currencyOptions = [
  { value: 'RUR', label: 'RUB' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'KZT', label: 'KZT' },
]

function initForm() {
  nameError.value = ''
  if (props.template) {
    const vd = (props.template.vacancyData ?? {}) as Record<string, any>
    const salary = vd.salary ?? {}
    form.value = {
      name: props.template.name,
      description: props.template.description ?? '',
      vacancyName: vd.name ?? '',
      salaryFrom: salary.from ?? null,
      salaryTo: salary.to ?? null,
      currency: salary.currency ?? 'RUR',
      area: vd.area_id ?? props.template.hhAreaId ?? '',
      employmentType: vd.employment_type ?? 'full',
      vacancyDescription: vd.description ?? '',
      keySkills: Array.isArray(vd.key_skills)
        ? vd.key_skills.map((s: any) => (typeof s === 'string' ? s : s?.name)).filter(Boolean)
        : [],
      isShared: props.template.isShared,
    }
  }
  else if (props.prefill) {
    const p = props.prefill
    form.value = {
      name: p.name ?? '',
      description: '',
      vacancyName: p.vacancyName ?? '',
      salaryFrom: p.salaryFrom ?? null,
      salaryTo: p.salaryTo ?? null,
      currency: p.currency ?? 'RUR',
      area: p.area ?? '',
      employmentType: p.employmentType ?? 'full',
      vacancyDescription: p.vacancyDescription ?? '',
      keySkills: p.keySkills ?? [],
      isShared: true,
    }
  }
  else {
    form.value = {
      name: '',
      description: '',
      vacancyName: '',
      salaryFrom: null,
      salaryTo: null,
      currency: 'RUR',
      area: '',
      employmentType: 'full',
      vacancyDescription: '',
      keySkills: [],
      isShared: true,
    }
  }
}

watch(() => props.show, (open) => {
  if (open) initForm()
}, { immediate: true })

function addSkill() {
  const skill = newSkill.value.trim()
  if (!skill || form.value.keySkills.includes(skill)) {
    newSkill.value = ''
    return
  }
  form.value.keySkills.push(skill)
  newSkill.value = ''
}

function removeSkill(index: number) {
  form.value.keySkills.splice(index, 1)
}

function buildVacancyData(): Record<string, unknown> {
  const vd: Record<string, unknown> = {
    name: form.value.vacancyName,
    type: 'open',
  }
  if (form.value.employmentType) vd.employment_type = form.value.employmentType
  if (form.value.vacancyDescription) vd.description = form.value.vacancyDescription
  if (form.value.area) vd.area_id = form.value.area
  if (form.value.salaryFrom != null || form.value.salaryTo != null) {
    const salary: Record<string, unknown> = { currency: form.value.currency }
    if (form.value.salaryFrom != null) salary.from = form.value.salaryFrom
    if (form.value.salaryTo != null) salary.to = form.value.salaryTo
    vd.salary = salary
  }
  if (form.value.keySkills.length) {
    vd.key_skills = form.value.keySkills.map(name => ({ name }))
  }
  return vd
}

function close() {
  emit('update:show', false)
}

async function save() {
  nameError.value = ''
  if (!form.value.name.trim()) {
    nameError.value = t('dashboard.settings.hhTemplates.editor.nameRequired')
    return
  }
  saving.value = true
  try {
    const body = {
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
      vacancyData: buildVacancyData(),
      isShared: form.value.isShared,
      hhAreaId: form.value.area.trim() || null,
    }
    if (props.template) {
      await $fetch(`/api/hh/templates/${props.template.id}`, { method: 'PUT', body })
      toast.success(t('dashboard.settings.hhTemplates.editor.saveSuccessUpdate'))
    }
    else {
      await $fetch('/api/hh/templates', { method: 'POST', body })
      toast.success(t('dashboard.settings.hhTemplates.editor.saveSuccessCreate'))
    }
    await refreshNuxtData('hh-templates')
    emit('saved')
    close()
  }
  catch (err: any) {
    toast.error(t('dashboard.settings.hhTemplates.editor.saveError'), {
      message: err?.data?.statusMessage ?? err?.message,
    })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :model-value="show" size="lg" @update:model-value="emit('update:show', $event)">
    <template #header>
      <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">
        {{ isEdit
          ? t('dashboard.settings.hhTemplates.editor.titleEdit')
          : t('dashboard.settings.hhTemplates.editor.titleNew') }}
      </h2>
    </template>

    <div class="space-y-5">
      <!-- Template meta -->
      <div class="space-y-4">
        <UiInput
          v-model="form.name"
          :label="t('dashboard.settings.hhTemplates.editor.name')"
          :placeholder="t('dashboard.settings.hhTemplates.editor.namePlaceholder')"
          :error-message="nameError"
          required
        />
        <UiTextarea
          v-model="form.description"
          :label="t('dashboard.settings.hhTemplates.editor.description')"
          :placeholder="t('dashboard.settings.hhTemplates.editor.descriptionPlaceholder')"
          :rows="2"
        />
      </div>

      <!-- Vacancy data section -->
      <div class="space-y-4 pt-2 border-t border-surface-100 dark:border-surface-800">
        <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-300 pt-2">
          {{ t('dashboard.settings.hhTemplates.editor.vacancySection') }}
        </h3>

        <UiInput
          v-model="form.vacancyName"
          :label="t('dashboard.settings.hhTemplates.editor.vacancyName')"
          :placeholder="t('dashboard.settings.hhTemplates.editor.vacancyNamePlaceholder')"
        />

        <!-- Salary row -->
        <div>
          <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
            {{ t('dashboard.settings.hhTemplates.editor.salary') }}
          </label>
          <div class="grid grid-cols-3 gap-3">
            <UiInput
              v-model="form.salaryFrom"
              type="number"
              :placeholder="t('dashboard.settings.hhTemplates.editor.salaryFrom')"
            />
            <UiInput
              v-model="form.salaryTo"
              type="number"
              :placeholder="t('dashboard.settings.hhTemplates.editor.salaryTo')"
            />
            <UiSelect
              v-model="form.currency"
              :options="currencyOptions"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <UiInput
            v-model="form.area"
            :label="t('dashboard.settings.hhTemplates.editor.area')"
            :placeholder="t('dashboard.settings.hhTemplates.editor.areaPlaceholder')"
          />
          <UiSelect
            v-model="form.employmentType"
            :options="employmentOptions"
            :label="t('dashboard.settings.hhTemplates.editor.employmentType')"
          />
        </div>

        <UiTextarea
          v-model="form.vacancyDescription"
          :label="t('dashboard.settings.hhTemplates.editor.vacancyDescription')"
          :rows="6"
        />

        <!-- Key skills tag input -->
        <div>
          <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
            {{ t('dashboard.settings.hhTemplates.editor.keySkills') }}
          </label>
          <div class="flex flex-wrap gap-1.5 mb-2">
            <span
              v-for="(skill, i) in form.keySkills"
              :key="i"
              class="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 px-2.5 py-1 text-xs font-medium"
            >
              {{ skill }}
              <button
                type="button"
                class="text-brand-400 hover:text-brand-700 dark:hover:text-brand-200 cursor-pointer"
                @click="removeSkill(i)"
              >
                <X class="size-3" />
              </button>
            </span>
          </div>
          <div class="flex gap-2">
            <UiInput
              v-model="newSkill"
              :placeholder="t('dashboard.settings.hhTemplates.editor.keySkillPlaceholder')"
              @keydown.enter.prevent="addSkill"
            />
            <UiButton variant="secondary" size="sm" :icon-left="Plus" @click="addSkill">
              {{ t('dashboard.settings.hhTemplates.editor.keySkills') }}
            </UiButton>
          </div>
        </div>
      </div>

      <!-- Shared toggle -->
      <label class="flex items-center gap-2.5 cursor-pointer pt-2">
        <input
          v-model="form.isShared"
          type="checkbox"
          class="size-4 rounded border-surface-300 dark:border-surface-700 text-brand-600 focus:ring-brand-500"
        >
        <span class="text-sm text-surface-700 dark:text-surface-300">
          {{ t('dashboard.settings.hhTemplates.editor.isShared') }}
        </span>
      </label>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="close">
        {{ t('dashboard.settings.hhTemplates.editor.cancel') }}
      </UiButton>
      <UiButton :loading="saving" @click="save">
        {{ t('dashboard.settings.hhTemplates.editor.save') }}
      </UiButton>
    </template>
  </UiModal>
</template>
