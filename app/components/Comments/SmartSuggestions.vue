<script setup lang="ts">
/**
 * Smart composer suggestions — context-aware quick-reply chips.
 * Self-contained: fetches screening score from the API.
 */
import { computed, ref, onMounted } from 'vue'
import { Sparkles, X } from 'lucide-vue-next'
import { useSmartSuggestions, type SmartSuggestion } from '~/composables/useSmartSuggestions'
import { useLocalStorageState } from '~/composables/useLocalStorageState'

const props = defineProps<{
  applicationId: string
}>()

const emit = defineEmits<{
  insert: [text: string]
}>()

const { t } = useI18n()
const { getSuggestions } = useSmartSuggestions()

const score = ref<number | null>(null)
const hasScore = ref(false)

onMounted(async () => {
  try {
    const res = await $fetch<{ compositeScore: number | null, scores: unknown[] }>(
      `/api/applications/${props.applicationId}/scores`,
      { headers: useRequestHeaders(['cookie']) },
    )
    score.value = res.compositeScore
    hasScore.value = res.compositeScore != null && (res.scores?.length ?? 0) > 0
  } catch {
    // no score data — will suggest running screening
  }
})

const dismissed = useLocalStorageState<Record<string, number>>(`smart-suggestions-dismissed:${props.applicationId}`, {})

const suggestions = computed<SmartSuggestion[]>(() => {
  const all = getSuggestions({ score: score.value, risk: null, hasScore: hasScore.value })
  const now = Date.now()
  const WEEK = 7 * 24 * 60 * 60 * 1000
  return all.filter(s => !dismissed.value[s.id] || now - dismissed.value[s.id] > WEEK)
})

function onPick(s: SmartSuggestion) {
  emit('insert', s.insertText)
}

function onDismiss(s: SmartSuggestion) {
  dismissed.value = { ...dismissed.value, [s.id]: Date.now() }
}

const kindClass = (kind: SmartSuggestion['kind']) => ({
  info: 'border-info-200 dark:border-info-800/60 bg-info-50/50 dark:bg-info-900/10 text-info-700 dark:text-info-300 hover:bg-info-100 dark:hover:bg-info-900/30',
  warning: 'border-warning-200 dark:border-warning-800/60 bg-warning-50/50 dark:bg-warning-900/10 text-warning-700 dark:text-warning-300 hover:bg-warning-100 dark:hover:bg-warning-900/30',
  success: 'border-success-200 dark:border-success-800/60 bg-success-50/50 dark:bg-success-900/10 text-success-700 dark:text-success-300 hover:bg-success-100 dark:hover:bg-success-900/30',
  danger: 'border-danger-200 dark:border-danger-800/60 bg-danger-50/50 dark:bg-danger-900/10 text-danger-700 dark:text-danger-300 hover:bg-danger-100 dark:hover:bg-danger-900/30',
}[kind])
</script>

<template>
  <div v-if="suggestions.length > 0" class="mb-2 flex flex-wrap items-center gap-1.5">
    <Sparkles class="size-3 text-accent-500 flex-shrink-0" />
    <button
      v-for="s in suggestions"
      :key="s.id"
      type="button"
      class="group inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer"
      :class="kindClass(s.kind)"
      @click="onPick(s)"
    >
      {{ s.label }}
      <span
        class="ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        @click.stop="onDismiss(s)"
      >
        <X class="size-2.5" />
      </span>
    </button>
  </div>
</template>
