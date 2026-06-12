<script setup lang="ts">
/**
 * Mention autocomplete popup.
 * Parent passes:
 *   - members: filtered candidates
 *   - activeIndex: currently-highlighted row
 *   - onPick(member): callback
 * Parent handles keyboard via watching textarea events.
 */
import type { OrgMember } from '~/composables/useApplicationComments'

defineProps<{
  members: OrgMember[]
  activeIndex: number
}>()

const emit = defineEmits<{
  pick: [member: OrgMember]
}>()
</script>

<template>
  <div
    v-if="members.length > 0"
    class="absolute z-50 mt-1 w-64 max-h-64 overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg"
  >
    <button
      v-for="(m, idx) in members"
      :key="m.userId"
      type="button"
      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50 dark:hover:bg-surface-800 transition-colors"
      :class="{ 'bg-brand-50 dark:bg-surface-800': idx === activeIndex }"
      @mousedown.prevent="emit('pick', m)"
    >
      <div class="flex h-7 w-7 items-center justify-center rounded-full bg-surface-200 dark:bg-surface-700 text-xs font-semibold text-surface-700 dark:text-surface-200">
        <img v-if="m.image" :src="m.image" class="h-7 w-7 rounded-full" :alt="m.name ?? m.email ?? ''">
        <span v-else>{{ (m.name ?? m.email ?? '?').slice(0, 1).toUpperCase() }}</span>
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate text-surface-900 dark:text-surface-100">{{ m.name || m.email }}</div>
        <div class="truncate text-xs text-surface-500">{{ m.email }}</div>
      </div>
    </button>
  </div>
</template>
