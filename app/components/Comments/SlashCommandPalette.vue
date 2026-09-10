<script lang="ts">
export interface SlashCommand {
  name: string
  description: string
  icon: any
  /** 'action' — выполнить сразу; 'insert' — вставить текст в input; 'ai' — вставить @ai */
  mode: 'action' | 'insert' | 'ai'
  insertText?: string
}
</script>

<script setup lang="ts">
/**
 * Slash-command palette для composer'а обсуждения.
 * Показывается когда input начинается с '/'.
 * Keyboard: ArrowUp/Down/Enter/Esc.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { Bot, ShieldAlert, Lock, Sparkles, ArrowRightCircle, Vote } from 'lucide-vue-next'

const props = defineProps<{
  query: string
}>()

const emit = defineEmits<{
  select: [command: SlashCommand]
  close: []
}>()

const { t } = useI18n()

const COMMANDS: SlashCommand[] = [
  { name: 'score', description: t('slash.score_desc'), icon: Bot, mode: 'action' },
  { name: 'risk', description: t('slash.risk_desc'), icon: ShieldAlert, mode: 'action' },
  { name: 'summarize', description: t('slash.summarize_desc'), icon: Sparkles, mode: 'action' },
  { name: 'poll', description: t('slash.poll_desc'), icon: Vote, mode: 'action' },
  { name: 'ai', description: t('slash.ai_desc'), icon: Bot, mode: 'ai', insertText: '@ai ' },
  { name: 'advance', description: t('slash.advance_desc'), icon: ArrowRightCircle, mode: 'insert', insertText: '' },
  { name: 'internal', description: t('slash.internal_desc'), icon: Lock, mode: 'action' },
]

const activeIdx = ref(0)

const filtered = computed(() => {
  const q = props.query.replace(/^\//, '').toLowerCase()
  if (!q) return COMMANDS
  return COMMANDS.filter(c => c.name.startsWith(q) || c.name.includes(q))
})

watch(filtered, () => { activeIdx.value = 0 })

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    activeIdx.value = Math.min(activeIdx.value + 1, filtered.value.length - 1)
    e.preventDefault()
  } else if (e.key === 'ArrowUp') {
    activeIdx.value = Math.max(activeIdx.value - 1, 0)
    e.preventDefault()
  } else if (e.key === 'Enter') {
    const cmd = filtered.value[activeIdx.value]
    if (cmd) { emit('select', cmd); e.preventDefault() }
  } else if (e.key === 'Escape') {
    emit('close'); e.preventDefault()
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div class="absolute bottom-[calc(100%+4px)] left-0 z-30 w-64 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg overflow-hidden">
    <div class="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-surface-400 border-b border-surface-100 dark:border-surface-800">
      {{ t('slash.title') }}
    </div>
    <ul class="py-1 max-h-56 overflow-y-auto">
      <li
        v-for="(cmd, i) in filtered"
        :key="cmd.name"
        class="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer text-xs"
        :class="i === activeIdx ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300' : 'text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800'"
        @mouseenter="activeIdx = i"
        @click="emit('select', cmd)"
      >
        <component :is="cmd.icon" class="size-3.5 flex-shrink-0 opacity-70" />
        <span class="font-mono font-medium">/{{ cmd.name }}</span>
        <span class="truncate text-surface-400 ml-auto">{{ cmd.description }}</span>
      </li>
    </ul>
  </div>
</template>
