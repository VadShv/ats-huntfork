<script setup lang="ts">
import { Plus, Star, Power } from 'lucide-vue-next'
import { useReportTemplates, type ReportTemplate, type ReportTemplateKind } from '~/composables/useReportTemplates'

definePageMeta({})
useSeoMeta({ title: 'Банк вопросов — Шаблоны отчётов' })

const { allowed: canManage } = usePermission({ questionBank: ['manage_reports'] })
const { templates, isLoading, create, update, setDefault, toggleActive } = useReportTemplates()

const kindOptions: { label: string, value: ReportTemplateKind }[] = [
  { label: 'Стандартный', value: 'standard' },
  { label: 'Для руководителей', value: 'executive' },
  { label: 'Скрининг', value: 'screening' },
  { label: 'Технический', value: 'technical' },
  { label: 'Произвольный', value: 'custom' },
]

const drawerOpen = ref(false)
const editing = ref<Partial<ReportTemplate>>({})
const editingId = ref<string | null>(null)
const saving = ref(false)

function openCreate() {
  editingId.value = null
  editing.value = { name: '', kind: 'standard', promptText: '', description: '' }
  drawerOpen.value = true
}
function openEdit(t: ReportTemplate) {
  editingId.value = t.id
  editing.value = { ...t }
  drawerOpen.value = true
}
async function save() {
  if (!editing.value.name?.trim() || !editing.value.promptText?.trim()) return
  saving.value = true
  try {
    if (editingId.value) await update(editingId.value, editing.value)
    else { const c = await create(editing.value as { name: string, promptText: string }); editingId.value = c?.id ?? null }
    drawerOpen.value = false
  }
  finally { saving.value = false }
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between">
      <p class="text-sm text-surface-500">Библиотека промптов для генерации отчёта по интервью нашим ассистентом.</p>
      <UiButton v-if="canManage" variant="primary" size="sm" :icon-left="Plus" @click="openCreate">Шаблон</UiButton>
    </div>

    <div v-if="isLoading" class="py-12 text-center text-sm text-surface-400">Загрузка…</div>
    <div v-else-if="!templates.length" class="py-12 text-center text-sm text-surface-500 dark:text-surface-400">
      Шаблонов нет.
    </div>
    <div v-else class="space-y-2">
      <UiCard v-for="t in templates" :key="t.id" interactive @click="openEdit(t)">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{{ t.name }}</span>
              <UiBadge v-if="t.isDefault" tone="brand" :icon="Star">По умолчанию</UiBadge>
              <UiBadge v-if="!t.isActive" tone="neutral">Выключен</UiBadge>
            </div>
            <p v-if="t.description" class="text-xs text-surface-500 mt-1">{{ t.description }}</p>
          </div>
          <div v-if="canManage" class="flex items-center gap-1.5" @click.stop>
            <UiButton v-if="!t.isDefault && t.isActive" variant="ghost" size="sm" @click="setDefault(t.id)">По умолчанию</UiButton>
            <UiButton variant="ghost" size="sm" :icon-left="Power" icon-only :aria-label="t.isActive ? 'Выключить' : 'Включить'" @click="toggleActive(t.id, !t.isActive)" />
          </div>
        </div>
      </UiCard>
    </div>

    <UiDrawer v-model="drawerOpen" width="lg">
      <template #header><h2 class="text-base font-semibold">{{ editingId ? 'Шаблон отчёта' : 'Новый шаблон' }}</h2></template>
      <div class="space-y-4">
        <UiInput :model-value="editing.name ?? ''" label="Название" required @update:model-value="v => editing.name = String(v)" />
        <UiInput :model-value="editing.description ?? ''" label="Описание" placeholder="когда применять" @update:model-value="v => editing.description = String(v)" />
        <UiSelect :model-value="editing.kind ?? 'standard'" label="Вид" :options="kindOptions" @update:model-value="v => editing.kind = v as ReportTemplateKind" />
        <UiTextarea
          :model-value="editing.promptText ?? ''"
          label="Промпт генерации отчёта"
          :rows="16" autosize :max-height="600"
          hint="Данные (транскрипт, опросник, BARS) подставляются автоматически."
          @update:model-value="v => editing.promptText = v"
        />
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" size="sm" @click="drawerOpen = false">Закрыть</UiButton>
          <UiButton v-if="canManage" variant="primary" size="sm" :loading="saving" :disabled="!editing.name?.trim() || !editing.promptText?.trim()" @click="save">Сохранить</UiButton>
        </div>
      </template>
    </UiDrawer>
  </div>
</template>
