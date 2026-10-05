<script setup lang="ts">
/**
 * Шаблон карты поиска — просмотр/правка/создание.
 */
import { ArrowLeft } from 'lucide-vue-next'

definePageMeta({ layout: 'dashboard', middleware: ['auth', 'require-org'] })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { allowed: canManage } = usePermission({ searchMap: ['manage_registry'] })

const templateId = computed(() => route.params.id as string)
const isNew = computed(() => templateId.value === 'new')

const form = reactive({
  name: '',
  code: '',
  generationGuidance: '',
  status: 'draft' as string,
  sections: [] as { sectionType: string; title: string; guidance: string; isRequired: boolean }[],
})

const saving = ref(false)

// Стартовый набор секций для нового шаблона — сервер требует sections.min(1)
// (templateInputSchema), пустой шаблон получал 400 при создании.
const DEFAULT_SECTIONS = [
  { sectionType: 'title_synonyms', title: 'Тайтлы и синонимы', guidance: 'Как позицию называют в разных компаниях; добавьте англоязычные варианты', isRequired: true },
  { sectionType: 'keywords', title: 'Ключевые слова и навыки', guidance: 'Технологии, инструменты, домены — то, что есть в резюме', isRequired: true },
  { sectionType: 'geo', title: 'География', guidance: 'Города, регионы, часовые пояса, релокация', isRequired: false },
  { sectionType: 'exclusions', title: 'Исключения', guidance: 'Компании, которые не трогаем; тайтлы-ложные срабатывания', isRequired: false },
  { sectionType: 'notes', title: 'Заметки и договорённости', guidance: 'Калибровка с HM, ограничения', isRequired: false },
]

if (isNew.value) {
  form.sections = DEFAULT_SECTIONS.map(s => ({ ...s }))
} else {
  const { data, error } = await useFetch(`/api/search-map/templates/${templateId.value}`, {
    headers: useRequestHeaders(['cookie']),
  })
  if (error.value) {
    toast.error('Шаблон не найден')
  }
  watch(data, (d) => {
    if (d) {
      form.name = d.name ?? ''
      form.code = d.code ?? ''
      form.generationGuidance = d.generationGuidance ?? ''
      form.status = d.status ?? 'draft'
      form.sections = (d.sections ?? []).map((s: any) => ({
        sectionType: s.sectionType,
        title: s.title,
        guidance: s.guidance ?? '',
        isRequired: s.isRequired ?? false,
      }))
    }
  }, { immediate: true })
}

// Строго значения enum search_map_section_type — 'custom' в БД нет, сервер отвечал 400.
const sectionTypes = [
  { label: 'Тайтлы и синонимы', value: 'title_synonyms' },
  { label: 'Ключевые слова и навыки', value: 'keywords' },
  { label: 'География', value: 'geo' },
  { label: 'Исключения', value: 'exclusions' },
  { label: 'Заметки', value: 'notes' },
]

function addSection() {
  // Один тип = одна секция (unique(templateId, sectionType)) — предлагаем первый свободный тип.
  const used = new Set(form.sections.map(s => s.sectionType))
  const free = sectionTypes.find(t => !used.has(t.value))
  if (!free) {
    toast.error('Все типы секций уже добавлены')
    return
  }
  form.sections.push({ sectionType: free.value, title: free.label, guidance: '', isRequired: false })
}

function sectionsPayload() {
  return form.sections.map((s, i) => ({
    sectionType: s.sectionType,
    title: s.title.trim() || sectionTypes.find(t => t.value === s.sectionType)?.label || 'Секция',
    guidance: s.guidance?.trim() || null,
    isRequired: s.isRequired,
    displayOrder: i,
  }))
}

function removeSection(idx: number) {
  form.sections.splice(idx, 1)
}

async function save() {
  if (!form.name.trim()) {
    toast.error('Укажите название шаблона')
    return
  }
  if (!form.sections.length) {
    toast.error('Добавьте хотя бы одну секцию')
    return
  }
  const types = form.sections.map(s => s.sectionType)
  if (new Set(types).size !== types.length) {
    toast.error('Типы секций не должны повторяться')
    return
  }
  saving.value = true
  try {
    if (isNew.value) {
      await $fetch('/api/search-map/templates', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          code: form.code.trim() || undefined,
          generationGuidance: form.generationGuidance.trim() || undefined,
          sections: sectionsPayload(),
        },
      })
      toast.success('Шаблон создан')
    } else {
      // PATCH принимает полную замену sections — раньше правки секций молча терялись.
      await $fetch(`/api/search-map/templates/${templateId.value}`, {
        method: 'PATCH',
        body: {
          name: form.name.trim(),
          generationGuidance: form.generationGuidance.trim() || null,
          sections: sectionsPayload(),
        },
      })
      toast.success('Сохранено')
    }
    await router.push('/dashboard/settings/search-map/templates')
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  } finally {
    saving.value = false
  }
}

async function publish() {
  try {
    await $fetch(`/api/search-map/templates/${templateId.value}/publish`, { method: 'POST' })
    toast.success('Опубликован')
    form.status = 'published'
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  }
}

async function setDefault() {
  try {
    await $fetch(`/api/search-map/templates/${templateId.value}/set-default`, { method: 'POST' })
    toast.success('Установлен по умолчанию')
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4">
    <div class="flex items-center gap-3">
      <UiButton size="sm" variant="ghost" @click="router.push('/dashboard/settings/search-map/templates')">
        <ArrowLeft class="size-4" />
      </UiButton>
      <h1 class="text-lg font-semibold">{{ isNew ? 'Новый шаблон' : form.name }}</h1>
      <UiBadge v-if="!isNew" :tone="form.status === 'published' ? 'success' : 'neutral'">{{ form.status }}</UiBadge>
    </div>

    <div class="space-y-3 rounded-lg border border-surface-200 p-4 dark:border-surface-800">
      <div>
        <label class="mb-1 block text-sm font-medium">Название</label>
        <UiInput v-model="form.name" placeholder="Напр. Карта для IT-вакансий" :disabled="!canManage" />
      </div>
      <div v-if="isNew">
        <label class="mb-1 block text-sm font-medium">Код (необязательно)</label>
        <UiInput v-model="form.code" placeholder="SM-IT" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium">Методичка для ИИ</label>
        <UiTextarea v-model="form.generationGuidance" :rows="4" placeholder="Инструкция для ИИ по генерации карты из этого шаблона" :disabled="!canManage" />
      </div>
    </div>

    <!-- Sections -->
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">Секции</h2>
        <UiButton v-if="canManage" size="sm" variant="ghost" @click="addSection">+ Секция</UiButton>
      </div>
      <div v-for="(s, i) in form.sections" :key="i" class="space-y-2 rounded-lg border border-surface-200 p-3 dark:border-surface-800">
        <div class="flex items-center gap-2">
          <UiSelect v-model="s.sectionType" :options="sectionTypes" class="flex-1" :disabled="!canManage" />
          <UiInput v-model="s.title" placeholder="Название секции" class="flex-1" :disabled="!canManage" />
          <button v-if="canManage" class="text-danger-600" @click="removeSection(i)">✕</button>
        </div>
        <UiTextarea v-model="s.guidance" :rows="2" placeholder="Подсказка для рекрутера" :disabled="!canManage" />
        <label class="flex items-center gap-2 text-xs text-surface-500">
          <input v-model="s.isRequired" type="checkbox" class="size-3" :disabled="!canManage" />
          Обязательная
        </label>
      </div>
    </div>

    <!-- Actions -->
    <div v-if="canManage" class="flex gap-2">
      <UiButton :loading="saving" @click="save">{{ isNew ? 'Создать' : 'Сохранить' }}</UiButton>
      <UiButton v-if="!isNew && form.status !== 'published'" variant="ghost" @click="publish">Опубликовать</UiButton>
      <UiButton v-if="!isNew" variant="ghost" @click="setDefault">По умолчанию</UiButton>
    </div>
  </div>
</template>
