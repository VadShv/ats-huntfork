<script setup lang="ts">
import { Check, SkipForward, Trash2, ChevronDown, ChevronUp } from 'lucide-vue-next'
import type { CandidateQuestionItem } from '~/composables/useCandidateQuestions'

const props = defineProps<{
  item: CandidateQuestionItem
  canEdit: boolean
}>()

const emit = defineEmits<{
  (e: 'asked'): void
  (e: 'skipped'): void
  (e: 'note', value: string): void
  (e: 'delete'): void
}>()

const { t } = useI18n()
const noteOpen = ref(false)
const note = ref(props.item.answerNote ?? '')
watch(() => props.item.answerNote, v => { note.value = v ?? '' })
</script>

<template>
  <div>
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <p
          class="text-sm text-surface-800 dark:text-surface-100"
          :class="{ 'line-through opacity-60': item.askStatus === 'skipped' }"
        >
          {{ item.text }}
        </p>
        <p v-if="item.rationale" class="mt-0.5 text-xs text-surface-400">{{ item.rationale }}</p>
        <p v-if="item.listenFor" class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
          <span class="font-medium">{{ t('application.questions.listenFor') }}:</span> {{ item.listenFor }}
        </p>
      </div>
      <div v-if="canEdit" class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="rounded p-1 hover:bg-surface-100 dark:hover:bg-surface-800"
          :class="item.askStatus === 'asked' ? 'text-success-600' : 'text-surface-400'"
          :title="t('application.questions.markAsked')"
          @click="emit('asked')"
        ><Check class="size-3.5" /></button>
        <button
          type="button"
          class="rounded p-1 hover:bg-surface-100 dark:hover:bg-surface-800"
          :class="item.askStatus === 'skipped' ? 'text-warning-600' : 'text-surface-400'"
          :title="t('application.questions.markSkipped')"
          @click="emit('skipped')"
        ><SkipForward class="size-3.5" /></button>
        <button
          type="button"
          class="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800"
          :title="t('application.questions.note')"
          @click="noteOpen = !noteOpen"
        >
          <ChevronUp v-if="noteOpen" class="size-3.5" />
          <ChevronDown v-else class="size-3.5" />
        </button>
        <button
          type="button"
          class="rounded p-1 text-surface-400 hover:text-danger-600"
          @click="emit('delete')"
        ><Trash2 class="size-3.5" /></button>
      </div>
    </div>

    <div v-if="noteOpen || (item.answerNote && item.answerNote.trim())" class="mt-2">
      <textarea
        v-model="note"
        :disabled="!canEdit"
        rows="2"
        :placeholder="t('application.questions.notePlaceholder')"
        class="w-full rounded-md border border-surface-200 bg-white px-2 py-1 text-xs disabled:opacity-70 dark:border-surface-700 dark:bg-surface-800"
        @blur="emit('note', note)"
      />
    </div>
  </div>
</template>
