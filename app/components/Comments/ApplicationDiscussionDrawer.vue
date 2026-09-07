<script setup lang="ts">
/**
 * Collaboration Hub (Этап 0) — режим фокуса: обсуждение во весь экран (drawer справа).
 * Переиспользует CandidateDiscussionTabs с флагом expanded (заполняет всю высоту).
 */
import { X } from 'lucide-vue-next'
import CandidateDiscussionTabs from '~/components/Comments/CandidateDiscussionTabs.vue'

defineProps<{
  currentApplicationId: string
  candidateId: string
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

// Escape через общий LIFO-стек (как в остальных drawer'ах проекта)
useEscapeStack(true, () => emit('close'))

onMounted(() => { document.body.style.overflow = 'hidden' })
onUnmounted(() => { document.body.style.overflow = '' })
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div class="fixed inset-0 z-[55] bg-surface-900/40" @click="emit('close')" />
    </Transition>

    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      leave-active-class="transition-transform duration-200 ease-in"
      enter-from-class="translate-x-full"
      leave-to-class="translate-x-full"
    >
      <aside
        class="fixed inset-y-0 right-0 z-[60] flex w-full max-w-2xl flex-col bg-white dark:bg-surface-900 shadow-2xl border-l border-surface-200 dark:border-surface-800"
        role="dialog"
        aria-modal="true"
        :aria-label="t('comments.thread_title')"
      >
        <header class="flex flex-none items-center justify-between gap-3 border-b border-surface-200 dark:border-surface-800 px-5 py-3.5">
          <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-100">
            {{ t('comments.thread_title') }}
          </h2>
          <button
            type="button"
            class="rounded-md p-1.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer"
            :aria-label="t('thread_ui.collapse')"
            @click="emit('close')"
          >
            <X class="size-4" />
          </button>
        </header>

        <div class="min-h-0 flex-1 p-4">
          <CandidateDiscussionTabs
            :current-application-id="currentApplicationId"
            :candidate-id="candidateId"
            expanded
          />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>
