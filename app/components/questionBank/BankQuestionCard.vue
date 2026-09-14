<script setup lang="ts">
/**
 * BankQuestionCard — карточка вопроса банка с бейджами.
 * Автоимя: <QuestionBankBankQuestionCard>.
 *
 * Бейджи: статус, тип, тема, careReady. Кнопки правки/публикации/архива —
 * по правам (canEdit/canPublish/canArchive). (§1.8)
 */
import { CheckCircle2, Pencil, Send, Archive, GitBranch } from 'lucide-vue-next'
import type { BankQuestion } from '~/composables/useBankQuestions'
import { useQuestionBankLabels } from '~/composables/useQuestionBankLabels'

const props = defineProps<{
  question: BankQuestion
  canEdit?: boolean
  canPublish?: boolean
  canArchive?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  edit: [q: BankQuestion]
  publish: [q: BankQuestion]
  archive: [q: BankQuestion]
}>()

const { QUESTION_TYPE_LABELS, STAGE_LABELS, questionStatusTone, QUESTION_STATUS_LABELS } = useQuestionBankLabels()

const statusTone = computed(() => questionStatusTone(props.question.status))
const statusLabel = computed(() => QUESTION_STATUS_LABELS[props.question.status])
const typeLabel = computed(() => QUESTION_TYPE_LABELS[props.question.type])
const stageLabel = computed(() =>
  props.question.recommendedStage ? STAGE_LABELS[props.question.recommendedStage] : null,
)
</script>

<template>
  <UiCard variant="default" padding="md" radius="md">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-1.5 mb-2">
          <UiBadge :tone="statusTone" size="sm">{{ statusLabel }}</UiBadge>
          <UiBadge tone="info" variant="soft" size="sm">{{ typeLabel }}</UiBadge>
          <UiBadge v-if="question.primaryTopic" tone="brand" variant="outline" size="sm">
            {{ question.primaryTopic.name }}
          </UiBadge>
          <UiBadge v-if="question.careReady" tone="success" variant="soft" size="sm" :icon="CheckCircle2">
            CARE
          </UiBadge>
          <UiBadge v-if="question.version > 1" tone="neutral" variant="outline" size="sm" :icon="GitBranch">
            v{{ question.version }}
          </UiBadge>
          <span v-if="question.code" class="text-xs text-surface-400 dark:text-surface-500 tabular-nums">
            {{ question.code }}
          </span>
        </div>

        <p class="text-sm text-surface-900 dark:text-surface-100 leading-snug">
          {{ question.text }}
        </p>

        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-surface-500 dark:text-surface-400">
          <span v-if="stageLabel">Этап: {{ stageLabel }}</span>
          <span v-if="question.durationMin">{{ question.durationMin }} мин</span>
          <span v-if="question.goal" class="truncate max-w-xs">Цель: {{ question.goal }}</span>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <UiButton
          v-if="canEdit"
          variant="ghost"
          size="sm"
          icon-only
          :disabled="busy"
          aria-label="Редактировать"
          @click="emit('edit', question)"
        >
          <Pencil class="size-4" />
        </UiButton>
        <UiButton
          v-if="canPublish && question.status === 'draft'"
          variant="ghost"
          size="sm"
          icon-only
          :disabled="busy"
          aria-label="Опубликовать"
          @click="emit('publish', question)"
        >
          <Send class="size-4" />
        </UiButton>
        <UiButton
          v-if="canArchive && question.status !== 'archived'"
          variant="ghost"
          size="sm"
          icon-only
          :disabled="busy"
          aria-label="Архивировать"
          @click="emit('archive', question)"
        >
          <Archive class="size-4" />
        </UiButton>
      </div>
    </div>
  </UiCard>
</template>
