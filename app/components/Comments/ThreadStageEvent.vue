<script setup lang="ts">
/**
 * Событие смены этапа на рельсе времени (визуальная версия 1, §3.3).
 * Точка в цвет этапа стоит на рельсе, строка короткая: «Кто перевёл на ● Этап · время».
 */
import { computed } from 'vue'
import type { StageEvent } from '~/composables/useApplicationComments'

const props = defineProps<{ event: StageEvent }>()

const { t, locale } = useI18n()

function fullName(name: string | null, parent: string | null): string {
  if (!name) return '—'
  return parent ? `${parent} / ${name}` : name
}

const toLabel = computed(() => fullName(props.event.toStageName, props.event.toStageParentName))
const fromLabel = computed(() => fullName(props.event.fromStageName, props.event.fromStageParentName))
const hasFrom = computed(() => Boolean(props.event.fromStageName))
const actor = computed(() => props.event.movedByUserName || t('thread_events.system'))
const color = computed(() => props.event.toStageColor ?? '#94a3b8')

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString(locale.value === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="relative z-[1] my-2.5 flex items-center gap-2.5 disc-rise" :title="hasFrom ? `${fromLabel} → ${toLabel}` : toLabel">
    <!-- Точка на рельсе -->
    <div class="flex w-7 flex-shrink-0 justify-center">
      <span
        class="block size-2.5 rounded-full ring-[3px] ring-white dark:ring-surface-900"
        :style="{ backgroundColor: color }"
      />
    </div>
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-surface-600 dark:text-surface-300">
      <span class="font-semibold text-surface-800 dark:text-surface-100">{{ actor }}</span>
      <span>{{ t('thread_events.moved_stage') }}</span>
      <span
        class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold"
        :style="{ backgroundColor: color + '22', color }"
      >
        <span class="size-1.5 rounded-full" :style="{ backgroundColor: color }" />
        {{ toLabel }}
      </span>
      <span v-if="hasFrom" class="text-[11px] text-surface-400">({{ t('comments.from_stage') }} {{ fromLabel }})</span>
      <span v-if="event.comment" class="basis-full text-[12px] text-surface-500 dark:text-surface-400">— {{ event.comment }}</span>
      <span class="ml-auto whitespace-nowrap text-[11px] tabular-nums text-surface-400">{{ formatTime(event.movedAt) }}</span>
    </div>
  </div>
</template>
