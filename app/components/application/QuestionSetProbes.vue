<script setup lang="ts">
/** Probe-уточнения по CARE под основным вопросом опросника (Спринт 4). */
import type { CandidateQuestionItem } from '~/composables/useCandidateQuestions'

defineProps<{
  probes: CandidateQuestionItem[]
  careLabel: Record<string, string>
}>()
</script>

<template>
  <div class="mt-2 border-l-2 border-brand-200 dark:border-brand-800 pl-3 space-y-1.5">
    <div v-for="p in probes" :key="p.id" class="text-xs">
      <span v-if="p.careElement" class="font-medium text-brand-600 dark:text-brand-400">{{ careLabel[p.careElement] || p.careElement }}:</span>
      <span class="text-surface-700 dark:text-surface-300"> {{ p.text }}</span>
      <span v-if="p.listenFor" class="block text-surface-400 dark:text-surface-500">слушать: {{ p.listenFor }}</span>
    </div>
  </div>
</template>
