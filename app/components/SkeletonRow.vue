<script setup lang="ts">
withDefaults(defineProps<{
  avatar?: boolean
  columns?: number
}>(), {
  avatar: false,
  columns: 4,
})
</script>

<template>
  <tr class="animate-pulse bg-white dark:bg-surface-900">
    <!-- Avatar + first column -->
    <td class="px-4 py-3">
      <div class="flex items-center gap-3">
        <div
          v-if="avatar"
          class="size-8 rounded-full bg-surface-200 dark:bg-surface-800 shrink-0"
        />
        <div class="h-4 w-32 rounded bg-surface-200 dark:bg-surface-800" />
      </div>
    </td>
    <!-- Extra columns -->
    <td
      v-for="i in Math.max(0, columns - 1)"
      :key="i"
      class="px-4 py-3"
    >
      <div
        class="h-4 rounded bg-surface-200 dark:bg-surface-800"
        :style="{ width: `${60 + (i * 17) % 40}%` }"
      />
    </td>
  </tr>
</template>
