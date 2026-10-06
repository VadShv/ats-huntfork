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

// Пять типов секций — это фиксированный словарь карты (enum search_map_section_type).
// Шаблон отвечает на вопрос «какие из них включить, как назвать и что подсказать рекрутеру»,
// поэтому UI — чек-лист из пяти карточек, а не произвольный список «выпадашка + поле».
const SECTION_CATALOG: { type: string; label: string; hint: string; defaultGuidance: string; defaultRequired: boolean }[] = [
  { type: 'title_synonyms', label: 'Тайтлы и синонимы', hint: 'Как называют позицию в разных компаниях; англоязычные варианты', defaultGuidance: 'Как позицию называют в разных компаниях и сегментах рынка; добавьте англоязычные варианты', defaultRequired: true },
  { type: 'keywords', label: 'Ключевые слова и навыки', hint: 'Технологии, инструменты, домены — то, что встречается в резюме', defaultGuidance: 'Технологии, инструменты, методологии, домены; то, что есть в резюме, а не в вакансии', defaultRequired: true },
  { type: 'geo', label: 'География', hint: 'Города, регионы, часовые пояса, релокация, формат', defaultGuidance: 'Города, регионы, часовые пояса, релокация', defaultRequired: false },
  { type: 'exclusions', label: 'Исключения', hint: 'Компании non-poach, ложные тайтлы, стоп-факторы', defaultGuidance: 'Компании, которые не трогаем (клиенты, партнёры, non-poach), тайтлы-ложные срабатывания', defaultRequired: false },
  { type: 'notes', label: 'Заметки и договорённости', hint: 'Калибровка с HM, ограничения, уровень и домен', defaultGuidance: 'Калибровка с HM, что обсуждали, ограничения', defaultRequired: false },
]

const form = reactive({
  name: '',
  code: '',
  generationGuidance: '',
  status: 'draft' as string,
  sections: [] as { sectionType: string; title: string; guidance: string; isRequired: boolean }[],
})

const saving = ref(false)

if (isNew.value) {
  // Новый шаблон: все пять секций включены — сервер требует хотя бы одну (sections.min(1))
  form.sections = SECTION_CATALOG.map(c => ({ sectionType: c.type, title: c.label, guidance: c.defaultGuidance, isRequired: c.defaultRequired }))
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

function sectionOf(type: string) {
  return form.sections.find(s => s.sectionType === type)
}
function isEnabled(type: string) {
  return !!sectionOf(type)
}
function toggleSection(type: string, on: boolean) {
  if (!canManage.value) return
  if (on && !sectionOf(type)) {
    const def = SECTION_CATALOG.find(c => c.type === type)!
    form.sections.push({ sectionType: type, title: def.label, guidance: def.defaultGuidance, isRequired: def.defaultRequired })
  } else if (!on) {
    const idx = form.sections.findIndex(s => s.sectionType === type)
    if (idx >= 0) form.sections.splice(idx, 1)
  }
}
const enabledCount = computed(() => form.sections.length)

function sectionsPayload() {
  // Порядок — как в каталоге, чтобы карта у рекрутера всегда читалась одинаково
  return SECTION_CATALOG
    .map(c => sectionOf(c.type))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s, i) => ({
      sectionType: s.sectionType,
      title: s.title.trim() || SECTION_CATALOG.find(c => c.type === s.sectionType)?.label || 'Секция',
      guidance: s.guidance?.trim() || null,
      isRequired: s.isRequired,
      displayOrder: i,
    }))
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
        <div>
          <h2 class="text-sm font-semibold">Секции карты</h2>
          <p class="text-xs text-surface-500">
            Отметьте, какие блоки появятся в карте каждой вакансии, созданной по этому шаблону. Включено: {{ enabledCount }} из {{ SECTION_CATALOG.length }}.
          </p>
        </div>
      </div>

      <div
        v-for="c in SECTION_CATALOG"
        :key="c.type"
        class="rounded-lg border p-3 transition-colors"
        :class="isEnabled(c.type) ? 'border-surface-200 dark:border-surface-800' : 'border-dashed border-surface-200 bg-surface-50/50 dark:border-surface-800 dark:bg-surface-900/30'"
      >
        <label class="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            class="mt-1 size-4"
            :checked="isEnabled(c.type)"
            :disabled="!canManage"
            @change="toggleSection(c.type, ($event.target as HTMLInputElement).checked)"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium text-surface-900 dark:text-surface-50">{{ c.label }}</span>
              <code class="rounded bg-surface-100 px-1.5 py-0.5 text-[11px] text-surface-500 dark:bg-surface-800">{{ c.type }}</code>
              <UiBadge v-if="sectionOf(c.type)?.isRequired" tone="brand">обязательная</UiBadge>
            </div>
            <p class="text-xs text-surface-500">{{ c.hint }}</p>
          </div>
        </label>

        <div v-if="isEnabled(c.type)" class="mt-3 grid gap-2 pl-7 sm:grid-cols-[1fr_auto]">
          <div class="space-y-2">
            <div>
              <label class="mb-1 block text-xs font-medium text-surface-500">Как секция называется в карте</label>
              <UiInput v-model="sectionOf(c.type)!.title" :placeholder="c.label" :disabled="!canManage" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-surface-500">Подсказка рекрутеру (видна в пустой секции и уходит ИИ при генерации)</label>
              <UiTextarea v-model="sectionOf(c.type)!.guidance" :rows="2" :placeholder="c.defaultGuidance" :disabled="!canManage" />
            </div>
          </div>
          <label class="flex items-start gap-2 pt-6 text-xs text-surface-600 dark:text-surface-300">
            <input v-model="sectionOf(c.type)!.isRequired" type="checkbox" class="mt-0.5 size-3.5" :disabled="!canManage" />
            <span>Обязательная<br><span class="text-surface-400">карта считается неполной, пока секция пуста</span></span>
          </label>
        </div>
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
