<script setup lang="ts">
/**
 * Watcher management panel — extracted from ApplicationCommentThread.
 * Compact: list + add-by-search.
 */
import { ref, computed } from 'vue'
import { X, Plus } from 'lucide-vue-next'
import type { useApplicationComments } from '~/composables/useApplicationComments'

type SearchMembers = typeof useApplicationComments extends (id: string) => infer R
  ? R extends { searchMembers: infer S } ? S : never
  : never

const props = defineProps<{
  watchers: { userId: string, name: string | null, email: string | null, image: string | null, source: string }[]
  searchMembers: SearchMembers
  addWatcher: (userId: string) => Promise<void>
  removeWatcher: (userId: string) => Promise<void>
  readOnly?: boolean
  compact?: boolean
}>()

const { t } = useI18n()

const searchQuery = ref('')
const searchResults = ref<Awaited<ReturnType<SearchMembers>>>([])

async function refreshSearch() {
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    return
  }
  searchResults.value = await props.searchMembers(searchQuery.value.trim())
}

async function onAdd(userId: string) {
  await props.addWatcher(userId)
  searchQuery.value = ''
  searchResults.value = []
}

const existingIds = computed(() => new Set(props.watchers.map(w => w.userId)))
const candidates = computed(() => searchResults.value.filter(m => !existingIds.value.has(m.userId)))
</script>

<template>
  <div
    class="border-t border-b border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950/40"
    :class="compact ? 'px-3 py-2.5' : 'px-4 py-3'"
  >
    <span class="mb-1.5 block text-xs font-medium text-surface-700 dark:text-surface-300">{{ t('watchers.subscribed') }}</span>
    <ul v-if="watchers.length > 0" class="mb-2 space-y-1">
      <li
        v-for="w in watchers"
        :key="w.userId"
        class="flex items-center justify-between gap-2 rounded-md bg-white dark:bg-surface-900 px-2 py-1"
      >
        <div class="flex items-center gap-2 min-w-0">
          <div class="grid size-6 place-items-center rounded-full bg-surface-200 dark:bg-surface-700 text-[10px] font-semibold text-surface-700 dark:text-surface-200">
            <img v-if="w.image" :src="w.image" :alt="w.name ?? ''" class="size-6 rounded-full">
            <span v-else>{{ (w.name ?? w.email ?? '?').slice(0, 1).toUpperCase() }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-xs text-surface-900 dark:text-surface-100">{{ w.name || w.email }}</div>
            <div class="truncate text-[10px] text-surface-500">{{ t(`watchers.source_${w.source}`) }}</div>
          </div>
        </div>
        <UiButton
          v-if="!readOnly"
          variant="ghost"
          size="xs"
          icon-only
          :icon-left="X"
          class="text-surface-400 hover:text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-900/20"
          :title="t('watchers.remove')"
          @click="removeWatcher(w.userId)"
        />
      </li>
    </ul>
    <p v-else class="mb-2 text-xs italic text-surface-400">{{ t('watchers.empty') }}</p>

    <div v-if="!readOnly" class="relative">
      <input
        v-model="searchQuery"
        type="text"
        :placeholder="t('watchers.add_placeholder')"
        class="w-full rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-2.5 py-1.5 text-xs text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        @input="refreshSearch"
      >
      <ul
        v-if="candidates.length > 0"
        class="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow"
      >
        <li
          v-for="m in candidates"
          :key="m.userId"
          class="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-brand-50 dark:hover:bg-surface-800"
          @mousedown.prevent="onAdd(m.userId)"
        >
          <Plus class="size-3 text-brand-600" />
          <span class="truncate">{{ m.name || m.email }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
