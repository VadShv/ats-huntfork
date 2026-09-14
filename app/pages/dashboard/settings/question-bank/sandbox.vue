<script setup lang="ts">
import { useBankQuestions } from '~/composables/useBankQuestions'

definePageMeta({})
useSeoMeta({ title: 'Банк вопросов — Песочница' })

const { questions, isLoading } = useBankQuestions(() => ({ status: 'draft', limit: 100 }))
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">Песочница</h1>
      <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">Черновики вопросов до публикации.</p>
    </div>

    <QuestionBankSubNav />

    <div v-if="isLoading" class="py-12 text-center text-sm text-surface-400 mt-6">Загрузка…</div>
    <div v-else-if="!questions.length" class="py-12 text-center text-sm text-surface-500 dark:text-surface-400 mt-6">
      Черновиков нет. Создайте вопрос на вкладке «Вопросы» или сгенерируйте по теме.
    </div>
    <div v-else class="space-y-2 mt-6">
      <NuxtLink
        v-for="q in questions" :key="q.id"
        :to="`/dashboard/settings/question-bank/questions`"
      >
        <UiCard interactive>
          <p class="text-sm text-surface-900 dark:text-surface-100">{{ q.text }}</p>
          <div class="flex flex-wrap items-center gap-1.5 mt-2">
            <UiBadge v-if="q.primaryTopic" tone="info">{{ q.primaryTopic.name }}</UiBadge>
            <UiBadge tone="warning">Черновик</UiBadge>
            <UiBadge v-if="q.source === 'ai_generated'" tone="accent">ИИ</UiBadge>
            <UiBadge v-if="q.code" tone="neutral" variant="outline">{{ q.code }}</UiBadge>
          </div>
        </UiCard>
      </NuxtLink>
    </div>
  </div>
</template>
