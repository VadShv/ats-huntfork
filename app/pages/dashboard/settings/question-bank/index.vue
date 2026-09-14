<script setup lang="ts">
import { ListChecks, FileQuestion, Layers, FlaskConical } from 'lucide-vue-next'
import { useBankQuestions } from '~/composables/useBankQuestions'
import { useAssessmentTopics } from '~/composables/useAssessmentTopics'

definePageMeta({})
useSeoMeta({ title: 'Банк вопросов', description: 'Корпоративный банк вопросов для интервью' })

const { topics } = useAssessmentTopics(() => ({ limit: 100 }))
const { questions: published } = useBankQuestions(() => ({ status: 'published', limit: 100 }))
const { questions: drafts } = useBankQuestions(() => ({ status: 'draft', limit: 100 }))

const topicsWithoutAnchors = computed(() =>
  topics.value.filter(t => !(t.scales ?? []).some(s => (s.anchors ?? []).length > 0)).length,
)

const stats = computed(() => [
  { label: 'Темы оценки', value: topics.value.length, icon: Layers, to: '/dashboard/settings/question-bank/topics' },
  { label: 'Опубликованные вопросы', value: published.value.length, icon: ListChecks, to: '/dashboard/settings/question-bank/questions' },
  { label: 'Черновики', value: drafts.value.length, icon: FileQuestion, to: '/dashboard/settings/question-bank/sandbox' },
  { label: 'Темы без якорей', value: topicsWithoutAnchors.value, icon: FlaskConical, to: '/dashboard/settings/question-bank/topics' },
])
</script>

<template>
  <div>
    <div class="grid grid-cols-2 gap-3">
      <NuxtLink v-for="s in stats" :key="s.label" :to="s.to">
        <UiCard interactive class="h-full">
          <div class="flex items-center gap-3">
            <component :is="s.icon" :size="22" class="text-brand-500 shrink-0" />
            <div>
              <div class="text-2xl font-semibold text-surface-900 dark:text-surface-50">{{ s.value }}</div>
              <div class="text-xs text-surface-500 dark:text-surface-400">{{ s.label }}</div>
            </div>
          </div>
        </UiCard>
      </NuxtLink>
    </div>
  </div>
</template>
