<script setup lang="ts">
/**
 * AI-резюме (TL;DR) обсуждения — карточка сверху треда.
 * Collapsible: свёрнуто — заголовок + дата; развёрнуто — полный текст.
 */
import { ref, computed } from 'vue'
import { Bot, ChevronDown, ChevronUp, RefreshCw } from 'lucide-vue-next'
import type { ThreadComment } from '~/composables/useApplicationComments'

const props = defineProps<{
  comment: ThreadComment
  canRefresh?: boolean
}>()

const emit = defineEmits<{
  refresh: []
}>()

const { t, locale } = useI18n()
const expanded = ref(true)

const meta = computed(() => props.comment.payloadJson as { model?: string, summarizedCount?: number, generatedAt?: string } | null)

function fmtDate(d: string | undefined) {
  if (!d) return ''
  return new Date(d).toLocaleString(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <div class="rounded-xl border border-accent-200 dark:border-accent-800/60 bg-accent-50/60 dark:bg-accent-900/10 overflow-hidden">
    <div class="flex items-center gap-2 px-3 py-2">
      <Bot class="size-4 text-accent-500 flex-shrink-0" />
      <span class="text-xs font-semibold text-accent-800 dark:text-accent-200">{{ t('comments.summarize') }}</span>
      <span v-if="meta?.summarizedCount" class="text-[10px] text-surface-400">
        · {{ meta.summarizedCount }} {{ t('comments.summarize_count_suffix') }}
      </span>
      <span v-if="meta?.generatedAt" class="text-[10px] text-surface-400 font-mono ml-auto">
        {{ fmtDate(meta.generatedAt) }}
      </span>
      <button
        v-if="canRefresh"
        type="button"
        class="rounded p-1 text-surface-400 hover:text-accent-600 hover:bg-accent-100 dark:hover:bg-accent-900/30 cursor-pointer"
        :title="t('comments.summarize_refresh')"
        @click="emit('refresh')"
      >
        <RefreshCw class="size-3" />
      </button>
      <button
        type="button"
        class="rounded p-1 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer"
        @click="expanded = !expanded"
      >
        <component :is="expanded ? ChevronUp : ChevronDown" class="size-3.5" />
      </button>
    </div>
    <div
      v-show="expanded"
      class="px-3 pb-3 prose prose-sm dark:prose-invert max-w-none text-sm text-surface-700 dark:text-surface-200"
      v-html="comment.bodyHtml || comment.body"
    />
  </div>
</template>
