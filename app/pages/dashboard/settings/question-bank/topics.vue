<script setup lang="ts">
import { Plus, Archive } from 'lucide-vue-next'
import { useAssessmentTopics, type AssessmentTopic } from '~/composables/useAssessmentTopics'

definePageMeta({})
useSeoMeta({ title: 'Банк вопросов — Темы' })

const { allowed: canManage } = usePermission({ questionBank: ['manage_topics'] })

const { topics, isLoading, createTopic, updateTopic, archiveTopic, refresh } = useAssessmentTopics(() => ({ limit: 100 }))

const drawerOpen = ref(false)
const editing = ref<Partial<AssessmentTopic>>({})
const editingId = ref<string | null>(null)
const saving = ref(false)

function openCreate() {
  editingId.value = null
  editing.value = { type: 'custom', name: '', positiveIndicators: [], negativeIndicators: [] }
  drawerOpen.value = true
}
function openEdit(t: AssessmentTopic) {
  editingId.value = t.id
  editing.value = { ...t }
  drawerOpen.value = true
}
async function save() {
  if (!editing.value.name?.trim()) return
  saving.value = true
  try {
    if (editingId.value) await updateTopic(editingId.value, editing.value)
    else {
      const created = await createTopic(editing.value as Partial<AssessmentTopic> & { name: string })
      editingId.value = created?.id ?? null
    }
  }
  finally { saving.value = false }
}

const currentScales = computed(() => topics.value.find(t => t.id === editingId.value)?.scales ?? [])

function coverage(t: AssessmentTopic) {
  const hasAnchors = (t.scales ?? []).some(s => (s.anchors ?? []).length > 0)
  return hasAnchors
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-end">
      <UiButton v-if="canManage" variant="primary" size="sm" :icon-left="Plus" @click="openCreate">Тема</UiButton>
    </div>

    <div v-if="isLoading" class="py-12 text-center text-sm text-surface-400">Загрузка…</div>
    <div v-else-if="!topics.length" class="py-12 text-center">
      <p class="text-sm text-surface-500 dark:text-surface-400 mb-3">Пока нет тем оценки.</p>
      <UiButton v-if="canManage" variant="primary" size="sm" :icon-left="Plus" @click="openCreate">Создать первую тему</UiButton>
    </div>
    <div v-else class="space-y-2">
      <UiCard v-for="t in topics" :key="t.id" interactive @click="openEdit(t)">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ t.name }}</span>
              <UiBadge v-if="t.status === 'archived'" tone="neutral">Архив</UiBadge>
              <UiBadge v-if="!coverage(t)" tone="warning">Нет якорей</UiBadge>
            </div>
            <p v-if="t.goal" class="text-xs text-surface-500 dark:text-surface-400 mt-1 line-clamp-1">{{ t.goal }}</p>
          </div>
          <UiBadge tone="neutral" variant="outline">{{ (t.scales ?? []).length }} шкал</UiBadge>
        </div>
      </UiCard>
    </div>

    <UiDrawer v-model="drawerOpen" width="lg">
      <template #header>
        <h2 class="text-base font-semibold">{{ editingId ? 'Тема оценки' : 'Новая тема' }}</h2>
      </template>

      <div class="space-y-6">
        <QuestionBankTopicForm v-model="editing" />

        <div v-if="editingId">
          <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Шкалы и BARS-якоря</h3>
          <QuestionBankScaleEditor :topic-id="editingId" :scales="currentScales" @changed="refresh" />
        </div>
        <p v-else class="text-xs text-surface-400">Шкалы и якоря можно добавить после создания темы.</p>
      </div>

      <template #footer>
        <div class="flex items-center justify-between gap-2">
          <UiButton
            v-if="editingId && canManage && editing.status !== 'archived'"
            variant="ghost" size="sm" :icon-left="Archive"
            @click="editingId && archiveTopic(editingId)"
          >Архивировать</UiButton>
          <span v-else />
          <div class="flex items-center gap-2">
            <UiButton variant="ghost" size="sm" @click="drawerOpen = false">Закрыть</UiButton>
            <UiButton variant="primary" size="sm" :loading="saving" :disabled="!editing.name?.trim()" @click="save">Сохранить</UiButton>
          </div>
        </div>
      </template>
    </UiDrawer>
  </div>
</template>
