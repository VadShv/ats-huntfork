<script setup lang="ts">
/**
 * Collaboration Hub (Этап 4) — системное событие смены этапа в единой ленте.
 * Компактная строка, визуально отличная от человеческих комментариев.
 */
import { computed } from 'vue'
import { GitBranch, ArrowRight } from 'lucide-vue-next'
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

function formatDate(d: string) {
  return new Date(d).toLocaleString(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <div class="flex items-center gap-2 px-3 py-1.5 text-xs text-surface-500 dark:text-surface-400">
    <div class="flex size-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-100 dark:bg-surface-800">
      <GitBranch class="size-3 text-surface-400" />
    </div>
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <span class="font-medium text-surface-600 dark:text-surface-300">{{ actor }}</span>
      <span>{{ t('thread_events.moved_stage') }}</span>
      <template v-if="hasFrom">
        <span
          class="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
          :style="event.fromStageColor ? { backgroundColor: event.fromStageColor + '22', color: event.fromStageColor } : {}"
        >
          {{ fromLabel }}
        </span>
        <ArrowRight class="size-3 text-surface-400" />
      </template>
      <span
        class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium"
        :style="event.toStageColor ? { backgroundColor: event.toStageColor + '22', color: event.toStageColor } : {}"
      >
        {{ toLabel }}
      </span>
      <span v-if="event.comment" class="text-surface-400 italic">— {{ event.comment }}</span>
      <span class="ml-auto whitespace-nowrap text-[11px] text-surface-400">{{ formatDate(event.movedAt) }}</span>
    </div>
  </div>
</template>
