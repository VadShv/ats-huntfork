<script setup lang="ts">
import { Plus, Trash2, Send, Archive, Star } from 'lucide-vue-next'
import { useQuestionPresets, type QuestionPreset, type PresetStatus } from '~/composables/useQuestionPresets'
import { useAssessmentTopics } from '~/composables/useAssessmentTopics'
import { useBankQuestions } from '~/composables/useBankQuestions'
import { useQuestionBankLabels } from '~/composables/useQuestionBankLabels'

definePageMeta({})
useSeoMeta({ title: 'Банк вопросов — Пресеты' })

const { allowed: canCreate } = usePermission({ questionBank: ['create_draft'] })
const { allowed: canPublish } = usePermission({ questionBank: ['publish'] })

const statusFilter = ref<PresetStatus | ''>('')
const { presets, isLoading, createPreset, updatePreset, publishPreset, archivePreset, addSection, deleteSection, setSectionQuestions }
  = useQuestionPresets(() => ({ status: statusFilter.value }))
const { topics } = useAssessmentTopics(() => ({ status: 'active', limit: 100 }))
const { questions: bankQuestions } = useBankQuestions(() => ({ status: 'published', limit: 200 }))
const { STAGE_LABELS, questionStatusTone } = useQuestionBankLabels()

const statusOptions = [
  { label: 'Все', value: '' },
  { label: 'Черновики', value: 'draft' },
  { label: 'Опубликованные', value: 'published' },
  { label: 'Архив', value: 'archived' },
]

// Drawer пресета.
const drawerOpen = ref(false)
const editing = ref<QuestionPreset | null>(null)
const creating = ref(false)
const newName = ref('')

function openPreset(p: QuestionPreset) { editing.value = p; drawerOpen.value = true }
watch(presets, () => {
  if (editing.value) editing.value = presets.value.find(p => p.id === editing.value!.id) ?? editing.value
})

async function doCreate() {
  if (!newName.value.trim()) return
  creating.value = true
  try {
    const p = await createPreset({ name: newName.value.trim() })
    newName.value = ''
    if (p) openPreset(p)
  }
  finally { creating.value = false }
}

// Добавление раздела.
const newSectionTopic = ref('')
async function addNewSection() {
  if (!editing.value || !newSectionTopic.value) return
  const topic = topics.value.find(t => t.id === newSectionTopic.value)
  await addSection(editing.value.id, { topicId: newSectionTopic.value, title: topic?.name ?? 'Раздел' })
  newSectionTopic.value = ''
}

const topicOptions = computed(() => topics.value.map(t => ({ label: t.name, value: t.id })))
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-2">
      <UiSelect v-model="statusFilter" :options="statusOptions" size="sm" class="w-44" />
      <div v-if="canCreate" class="flex items-center gap-2">
        <UiInput v-model="newName" placeholder="Название нового пресета" size="sm" @keydown.enter.prevent="doCreate" />
        <UiButton variant="primary" size="sm" :icon-left="Plus" :loading="creating" @click="doCreate">Пресет</UiButton>
      </div>
    </div>

    <div v-if="isLoading" class="py-12 text-center text-sm text-surface-400">Загрузка…</div>
    <div v-else-if="!presets.length" class="py-12 text-center text-sm text-surface-500 dark:text-surface-400">
      Пресетов нет. Создайте первый — набор разделов из тем и вопросов банка.
    </div>
    <div v-else class="space-y-2">
      <UiCard v-for="p in presets" :key="p.id" interactive @click="openPreset(p)">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{{ p.name }}</span>
              <UiBadge v-if="p.isDefault" tone="brand" :icon="Star">По умолчанию</UiBadge>
              <UiBadge :tone="questionStatusTone(p.status as never)">{{ p.status === 'published' ? 'Опубликован' : p.status === 'archived' ? 'Архив' : 'Черновик' }}</UiBadge>
            </div>
            <p class="text-xs text-surface-500 mt-1">{{ STAGE_LABELS[p.interviewType] }} · {{ (p.sections || []).length }} разделов</p>
          </div>
          <UiBadge v-if="p.code" tone="neutral" variant="outline">{{ p.code }}</UiBadge>
        </div>
      </UiCard>
    </div>

    <!-- Drawer: редактор пресета -->
    <UiDrawer v-model="drawerOpen" width="lg">
      <template #header>
        <h2 class="text-base font-semibold">{{ editing?.name }}</h2>
      </template>

      <div v-if="editing" class="space-y-4">
        <div class="flex items-center gap-2 text-xs text-surface-500">
          <UiBadge :tone="questionStatusTone(editing.status as never)">{{ editing.status }}</UiBadge>
          <span v-if="editing.code">{{ editing.code }}</span>
        </div>

        <div v-if="editing.status !== 'published'">
          <p class="text-sm font-medium mb-2">Разделы</p>
          <div v-for="s in (editing.sections || [])" :key="s.id" class="rounded-lg border border-surface-200 dark:border-surface-800 p-3 mb-2">
            <div class="flex items-center justify-between">
              <div>
                <span class="text-sm font-medium">{{ s.title }}</span>
                <span v-if="s.topic" class="text-xs text-surface-400 ml-2">{{ s.topic.name }}</span>
              </div>
              <UiButton type="button" variant="ghost" size="sm" :icon-left="Trash2" icon-only aria-label="Удалить раздел" @click="deleteSection(editing.id, s.id)" />
            </div>
            <p class="text-xs text-surface-400 mt-1">{{ (s.questions || []).length }} вопросов</p>
          </div>
          <div class="flex gap-2 mt-2">
            <UiSelect v-model="newSectionTopic" :options="topicOptions" size="sm" placeholder="Тема раздела" />
            <UiButton type="button" variant="secondary" size="sm" :icon-left="Plus" @click="addNewSection">Раздел</UiButton>
          </div>
        </div>
        <div v-else class="text-sm text-surface-500">
          Опубликованный пресет доступен только для чтения и импорта в вакансии.
        </div>
      </div>

      <template #footer>
        <div v-if="editing" class="flex items-center justify-between gap-2">
          <UiButton
            v-if="canPublish && editing.status === 'published'"
            variant="ghost" size="sm" :icon-left="Archive"
            @click="archivePreset(editing.id)"
          >Архивировать</UiButton>
          <span v-else />
          <div class="flex items-center gap-2">
            <UiButton variant="ghost" size="sm" @click="drawerOpen = false">Закрыть</UiButton>
            <UiButton
              v-if="canPublish && editing.status === 'draft'"
              variant="success" size="sm" :icon-left="Send"
              @click="publishPreset(editing.id)"
            >Опубликовать</UiButton>
          </div>
        </div>
      </template>
    </UiDrawer>
  </div>
</template>
