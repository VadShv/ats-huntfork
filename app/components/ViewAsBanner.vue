<script setup lang="ts">
import { Eye, X } from 'lucide-vue-next'

/**
 * Global "View as" banner (RBAC v2, Sprint 5). Shows when the current session is
 * impersonating another member in read-only mode. Server enforces read-only
 * (can() denies writes when isViewAs); this banner makes it visible and offers
 * a one-click exit.
 */
const { snapshot, refresh } = useAccessSnapshot()
const isViewAs = computed(() => snapshot.value.flags.isViewAs === true)
const viewAsName = computed(() => snapshot.value.flags.viewAsName ?? null)

const exiting = ref(false)
async function exit() {
  if (exiting.value) return
  exiting.value = true
  try {
    await $fetch('/api/access/view-as/stop', { method: 'POST' })
    await refresh()
    // Full reload so all SSR-rendered, scope-dependent views reset to the real user.
    if (import.meta.client) window.location.reload()
  }
  finally {
    exiting.value = false
  }
}
</script>

<template>
  <div
    v-if="isViewAs"
    class="flex items-center gap-3 border-b border-warning-300 bg-warning-100 px-4 py-2 text-sm text-warning-900 dark:border-warning-800 dark:bg-warning-950/50 dark:text-warning-200"
  >
    <Eye class="size-4 shrink-0" />
    <span class="flex-1">
      <strong>Просмотр от лица{{ viewAsName ? `: ${viewAsName}` : '' }}</strong>
      — режим «только чтение». Любые изменения заблокированы на сервере.
    </span>
    <UiButton size="sm" variant="secondary" :disabled="exiting" @click="exit">
      <X class="size-4" />
      Выйти из просмотра
    </UiButton>
  </div>
</template>
