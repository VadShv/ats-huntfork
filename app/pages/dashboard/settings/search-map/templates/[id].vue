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

const loading = ref(false)
const saving = ref(false)

if (!isNew.value) {
  const { data, error } = await useFetch(`/api/search-map/templates/${templateId.value}`)
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

const sectionTypes = [
  { label: 'Тайтлы и синонимы', value: 'title_synonyms' },
  { label: 'Ключевые слова и навыки', value: 'keywords' },
  { label: 'География', value: 'geo' },
  { label: 'Исключения', value: 'exclusions' },
  { label: 'Заметки', value: 'notes' },
  { label: 'Своя секция', value: 'custom' },
]

function addSection() {
  form.sections.push({ sectionType: 'custom', title: 'Новая секция', guidance: '', isRequired: false })
}

function removeSection(idx: number) {
  form.sections.splice(idx, 1)
}

async function save() {
  saving.value = true
  try {
    if (isNew.value) {
      await $fetch('/api/search-map/templates', {
        method: 'POST',
        body: {
          name: form.name,
          code: form.code || undefined,
          generationGuidance: form.generationGuidance || undefined,
          sections: form.sections,
        },
      })
      toast.success('Шаблон создан')
    } else {
      await $fetch(`/api/search-map/templates/${templateId.value}`, {
        method: 'PATCH',
        body: {
          name: form.name,
          generationGuidance: form.generationGuidance || undefined,
        },
      })
      toast.success('Сохранено')
    }
    router.push('/dashboard/settings/search-map/templates')
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
      <UiBadge v-if="!isNew" :variant="form.status === 'published' ? 'success' : 'surface'">{{ form.status }}</UiBadge>
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
        <UiTextarea v-model="form.generationGuidance" rows="4" placeholder="Инструкция для ИИ по генерации карты из этого шаблона" :disabled="!canManage" />
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
        <UiTextarea v-model="s.guidance" rows="2" placeholder="Подсказка для рекрутера" :disabled="!canManage" />
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
