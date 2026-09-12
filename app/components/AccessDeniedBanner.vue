<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'

/**
 * Reusable "insufficient permissions" banner (RBAC v2, §6). Shown in place of a
 * protected section's content when the user lacks access. Client gating is
 * cosmetic — the server still enforces on every request.
 */
withDefaults(defineProps<{
  title?: string
  message?: string
}>(), {
  title: 'Недостаточно прав',
  message: 'У вас недостаточно прав доступа к этому разделу. Обратитесь к владельцу или администратору организации.',
})
</script>

<template>
  <div
    class="flex items-start gap-3 rounded-xl border border-warning-200 bg-warning-50 p-5 text-sm text-warning-700 dark:border-warning-800 dark:bg-warning-950 dark:text-warning-400"
  >
    <AlertTriangle class="mt-0.5 size-5 shrink-0" />
    <div>
      <p class="mb-1 font-semibold">{{ title }}</p>
      <p>{{ message }}</p>
    </div>
  </div>
</template>
