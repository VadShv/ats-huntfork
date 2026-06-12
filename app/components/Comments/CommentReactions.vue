<script setup lang="ts">
/**
 * Reactions bar + picker — used inline within ApplicationCommentItem.
 * Server is pure add/remove; client mantains optimistic counts via toggleReaction.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { SmilePlus } from 'lucide-vue-next'
import type { CommentReaction } from '~/composables/useApplicationComments'

const props = defineProps<{
  commentId: string
  reactions: CommentReaction[]
  currentUserId: string
}>()

const emit = defineEmits<{
  toggle: [commentId: string, emoji: string]
}>()

const { t } = useI18n()

// Curated emoji set — must match server allow-list in reactions/index.post.ts
const EMOJI_SET = ['👍', '❤️', '🎉', '👀', '🚀', '✅', '😄', '🤔'] as const

const pickerOpen = ref(false)
const pickerRoot = ref<HTMLElement | null>(null)

function handleDocClick(e: MouseEvent) {
  if (!pickerOpen.value) return
  if (pickerRoot.value && !pickerRoot.value.contains(e.target as Node)) {
    pickerOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', handleDocClick))
onBeforeUnmount(() => document.removeEventListener('click', handleDocClick))

function onEmojiClick(emoji: string) {
  emit('toggle', props.commentId, emoji)
  pickerOpen.value = false
}

function buildTitle(r: CommentReaction): string {
  // Show emoji + count + (you if reacted)
  if (r.reactedByMe) {
    return `${r.emoji} ${r.count} · ${t('reactions.you')}`
  }
  return `${r.emoji} ${r.count}`
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5 mt-2">
    <button
      v-for="r in reactions"
      :key="r.emoji"
      type="button"
      :title="buildTitle(r)"
      class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors cursor-pointer"
      :class="r.reactedByMe
        ? 'bg-brand-100 dark:bg-brand-900/40 border-brand-300 dark:border-brand-700 text-brand-800 dark:text-brand-200'
        : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700'"
      @click="emit('toggle', commentId, r.emoji)"
    >
      <span>{{ r.emoji }}</span>
      <span class="font-medium tabular-nums">{{ r.count }}</span>
    </button>

    <!-- Add reaction button -->
    <div ref="pickerRoot" class="relative">
      <button
        type="button"
        class="inline-flex items-center justify-center rounded-full border border-dashed border-surface-300 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:border-surface-400 dark:hover:border-surface-600 size-6 cursor-pointer bg-transparent transition-colors"
        :title="t('reactions.add')"
        :aria-label="t('reactions.add')"
        @click="pickerOpen = !pickerOpen"
      >
        <SmilePlus class="size-3.5" />
      </button>

      <Transition
        enter-active-class="transition duration-100 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-75 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="pickerOpen"
          class="absolute bottom-[calc(100%+4px)] left-0 z-30 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg px-1.5 py-1 flex items-center gap-0.5"
        >
          <button
            v-for="emoji in EMOJI_SET"
            :key="emoji"
            type="button"
            class="inline-flex items-center justify-center size-7 rounded-md text-base hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer transition-colors border-0 bg-transparent"
            :title="emoji"
            @click="onEmojiClick(emoji)"
          >
            {{ emoji }}
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>
