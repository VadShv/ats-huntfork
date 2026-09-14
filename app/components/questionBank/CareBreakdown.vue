<script setup lang="ts">
/** Отображение CARE-разложения вопроса (Спринт 2). */
interface CareEl {
  element: 'context' | 'action' | 'result' | 'evaluate'
  probes: string[]
  sufficientSignal: string
  evasionSignal: string
}
interface Breakdown {
  isOpenSingle?: boolean
  revisedQuestion?: string
  elements?: CareEl[]
  expectedEvidence?: string[]
  greenFlags?: string[]
  redFlags?: string[]
}

const props = defineProps<{ breakdown: unknown }>()

const bd = computed(() => (props.breakdown ?? {}) as Breakdown)
const elementLabels: Record<string, string> = {
  context: 'Context — Ситуация',
  action: 'Action — Действия',
  result: 'Result — Результат',
  evaluate: 'Evaluate — Выводы',
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="bd.revisedQuestion" class="text-xs rounded bg-info-50 dark:bg-info-950/40 text-info-700 dark:text-info-300 px-2 py-1.5">
      Рекомендуемая формулировка: {{ bd.revisedQuestion }}
    </div>

    <div v-for="el in (bd.elements || [])" :key="el.element" class="rounded-lg border border-surface-200 dark:border-surface-800 p-2.5">
      <p class="text-xs font-semibold text-surface-700 dark:text-surface-300 mb-1">{{ elementLabels[el.element] || el.element }}</p>
      <ul v-if="el.probes?.length" class="space-y-0.5 mb-1.5">
        <li v-for="(p, i) in el.probes" :key="i" class="text-xs text-surface-600 dark:text-surface-400 flex gap-1.5">
          <span aria-hidden="true">•</span><span>{{ p }}</span>
        </li>
      </ul>
      <p v-if="el.sufficientSignal" class="text-[11px] text-success-600 dark:text-success-400">✓ {{ el.sufficientSignal }}</p>
      <p v-if="el.evasionSignal" class="text-[11px] text-warning-600 dark:text-warning-400">⚠ {{ el.evasionSignal }}</p>
    </div>

    <div v-if="bd.greenFlags?.length || bd.redFlags?.length" class="grid grid-cols-2 gap-2">
      <div v-if="bd.greenFlags?.length">
        <p class="text-[11px] font-semibold text-success-600 dark:text-success-400 mb-1">Зелёные флаги</p>
        <ul class="space-y-0.5">
          <li v-for="(f, i) in bd.greenFlags" :key="i" class="text-[11px] text-surface-600 dark:text-surface-400">{{ f }}</li>
        </ul>
      </div>
      <div v-if="bd.redFlags?.length">
        <p class="text-[11px] font-semibold text-danger-600 dark:text-danger-400 mb-1">Красные флаги</p>
        <ul class="space-y-0.5">
          <li v-for="(f, i) in bd.redFlags" :key="i" class="text-[11px] text-surface-600 dark:text-surface-400">{{ f }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>
