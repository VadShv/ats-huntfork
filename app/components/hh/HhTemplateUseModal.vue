<script setup lang="ts">
import { ExternalLink, CheckCircle2, AlertCircle } from 'lucide-vue-next'

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

const props = withDefaults(defineProps<{
  show: boolean
  template?: HhTemplateRow | null
}>(), {
  template: null,
})

const emit = defineEmits<{
  'update:show': [value: boolean]
  'used': []
}>()

const { t } = useI18n()
const toast = useToast()

const overrides = ref({
  name: '',
  salaryFrom: null as number | null,
  salaryTo: null as number | null,
  currency: 'RUR',
  area: '',
  employmentType: 'full',
  description: '',
  keySkills: [] as string[],
})

const publishing = ref(false)
const resultUrl = ref<string | null>(null)
const resultVacancyId = ref<string | null>(null)
const hasError = ref(false)

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

function initFromTemplate() {
  resultUrl.value = null
  resultVacancyId.value = null
  hasError.value = false
  if (!props.template) return
  const vd = (props.template.vacancyData ?? {}) as Record<string, any>
  const salary = vd.salary ?? {}
  overrides.value = {
    name: vd.name ?? '',
    salaryFrom: salary.from ?? null,
    salaryTo: salary.to ?? null,
    currency: salary.currency ?? 'RUR',
    area: vd.area_id ?? props.template.hhAreaId ?? '',
    employmentType: vd.employment_type ?? 'full',
    description: vd.description ?? '',
    keySkills: Array.isArray(vd.key_skills)
      ? vd.key_skills.map((s: any) => (typeof s === 'string' ? s : s?.name)).filter(Boolean)
      : [],
  }
}

watch(() => props.show, (open) => {
  if (open) initFromTemplate()
}, { immediate: true })

function buildOverrides(): Record<string, unknown> {
  const o: Record<string, unknown> = { name: overrides.value.name }
  if (overrides.value.employmentType) o.employment_type = overrides.value.employmentType
  if (overrides.value.description) o.description = overrides.value.description
  if (overrides.value.area) o.area_id = overrides.value.area
  if (overrides.value.salaryFrom != null || overrides.value.salaryTo != null) {
    const salary: Record<string, unknown> = { currency: overrides.value.currency }
    if (overrides.value.salaryFrom != null) salary.from = overrides.value.salaryFrom
    if (overrides.value.salaryTo != null) salary.to = overrides.value.salaryTo
    o.salary = salary
  }
  if (overrides.value.keySkills.length) {
    o.key_skills = overrides.value.keySkills.map(name => ({ name }))
  }
  return o
}

function close() {
  emit('update:show', false)
}

function openUrl() {
  if (resultUrl.value) window.open(resultUrl.value, '_blank')
}

async function publish() {
  if (!props.template) return
  publishing.value = true
  hasError.value = false
  try {
    const res = await $fetch<{ hhVacancyId: string | null; url: string | null }>(
      `/api/hh/templates/${props.template.id}/use`,
      { method: 'POST', body: { overrides: buildOverrides() } },
    )
    resultVacancyId.value = res.hhVacancyId
    resultUrl.value = res.url
    if (res.url) {
      toast.success(t('dashboard.settings.hhTemplates.useModal.publishSuccess'))
    }
    else {
      hasError.value = true
      toast.error(t('dashboard.settings.hhTemplates.useModal.publishNoUrl'))
    }
    await refreshNuxtData('hh-templates')
    emit('used')
  }
  catch (err: any) {
    hasError.value = true
    toast.error(t('dashboard.settings.hhTemplates.useModal.publishError'), {
      message: err?.data?.statusMessage ?? err?.message,
    })
  }
  finally {
    publishing.value = false
  }
}
</script>

<template>
  <UiModal :model-value="show" size="lg" @update:model-value="emit('update:show', $event)">
    <template #header>
      <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">
        {{ t('dashboard.settings.hhTemplates.useModal.title') }}
        <span v-if="template" class="text-surface-500 dark:text-surface-400 font-normal">— {{ template.name }}</span>
      </h2>
    </template>

    <!-- Success state -->
    <div v-if="resultUrl" class="space-y-4 py-4">
      <div class="flex items-start gap-3 p-4 rounded-lg bg-success-50 dark:bg-success-950/30 border border-success-200 dark:border-success-800">
        <CheckCircle2 class="size-5 text-success-600 dark:text-success-400 shrink-0 mt-0.5" />
        <div class="space-y-1">
          <p class="text-sm font-medium text-success-800 dark:text-success-200">
            {{ t('dashboard.settings.hhTemplates.useModal.publishSuccess') }}
          </p>
          <p v-if="resultVacancyId" class="text-xs text-success-600 dark:text-success-400">
            ID: {{ resultVacancyId }}
          </p>
        </div>
      </div>
      <div class="flex justify-center">
        <UiButton
          variant="primary"
          :icon-left="ExternalLink"
          @click="openUrl"
        >
          {{ t('dashboard.settings.hhTemplates.useModal.openOnHh') }}
        </UiButton>
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="hasError" class="space-y-4 py-4">
      <div class="flex items-start gap-3 p-4 rounded-lg bg-danger-50 dark:bg-danger-950/30 border border-danger-200 dark:border-danger-800">
        <AlertCircle class="size-5 text-danger-600 dark:text-danger-400 shrink-0 mt-0.5" />
        <div class="space-y-1">
          <p class="text-sm font-medium text-danger-800 dark:text-danger-200">
            {{ t('dashboard.settings.hhTemplates.useModal.publishError') }}
          </p>
        </div>
      </div>
      <div class="flex justify-center gap-3">
        <UiButton variant="ghost" @click="close">
          {{ t('dashboard.settings.hhTemplates.useModal.close') }}
        </UiButton>
        <UiButton variant="secondary" @click="hasError = false">
          {{ t('dashboard.settings.hhTemplates.useModal.tryAgain') }}
        </UiButton>
      </div>
    </div>

    <!-- Edit / publish form -->
    <div v-else class="space-y-5">
      <p class="text-sm text-surface-500 dark:text-surface-400">
        {{ t('dashboard.settings.hhTemplates.useModal.subtitle') }}
      </p>

      <UiInput
        v-model="overrides.name"
        :label="t('dashboard.settings.hhTemplates.useModal.vacancyName')"
      />

      <div>
        <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
          {{ t('dashboard.settings.hhTemplates.useModal.salary') }}
        </label>
        <div class="grid grid-cols-3 gap-3">
          <UiInput
            v-model="overrides.salaryFrom"
            type="number"
            :placeholder="t('dashboard.settings.hhTemplates.useModal.salaryFrom')"
          />
          <UiInput
            v-model="overrides.salaryTo"
            type="number"
            :placeholder="t('dashboard.settings.hhTemplates.useModal.salaryTo')"
          />
          <UiSelect
            v-model="overrides.currency"
            :options="currencyOptions"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <UiInput
          v-model="overrides.area"
          :label="t('dashboard.settings.hhTemplates.useModal.area')"
        />
        <UiSelect
          v-model="overrides.employmentType"
          :options="employmentOptions"
          :label="t('dashboard.settings.hhTemplates.useModal.employmentType')"
        />
      </div>

      <UiTextarea
        v-model="overrides.description"
        :label="t('dashboard.settings.hhTemplates.useModal.description')"
        :rows="6"
      />
    </div>

    <template #footer>
      <template v-if="resultUrl">
        <UiButton variant="ghost" @click="close">
          {{ t('dashboard.settings.hhTemplates.useModal.close') }}
        </UiButton>
      </template>
      <template v-else-if="hasError">
        <!-- buttons rendered in body -->
      </template>
      <template v-else>
        <UiButton variant="ghost" @click="close">
          {{ t('dashboard.settings.hhTemplates.useModal.cancel') }}
        </UiButton>
        <UiButton :loading="publishing" @click="publish">
          {{ t('dashboard.settings.hhTemplates.useModal.publish') }}
        </UiButton>
      </template>
    </template>
  </UiModal>
</template>
