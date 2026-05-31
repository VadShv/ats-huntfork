<script setup lang="ts">
definePageMeta({
  layout: 'auth',
})

useSeoMeta({
  title: 'Заявка на рассмотрении',
  robots: 'noindex, nofollow',
})

const localePath = useLocalePath()

async function handleSignOut() {
  await authClient.signOut()
  await navigateTo(localePath('/auth/sign-in'))
}
</script>

<template>
  <div class="flex flex-col items-center text-center gap-5">
    <!-- Icon -->
    <div class="flex items-center justify-center size-16 rounded-full bg-warning-50 dark:bg-warning-950 text-warning-500 dark:text-warning-400">
      <svg xmlns="http://www.w3.org/2000/svg" class="size-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    </div>

    <!-- Title -->
    <div>
      <h2 class="text-xl font-semibold text-surface-900 dark:text-surface-100">
        {{ $t('auth.pendingApproval.title') }}
      </h2>
      <p class="mt-2 text-sm text-surface-500 dark:text-surface-400 max-w-sm">
        {{ $t('auth.pendingApproval.description') }}
      </p>
    </div>

    <button
      type="button"
      class="mt-2 px-4 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
      @click="handleSignOut"
    >
      {{ $t('auth.pendingApproval.signOut') }}
    </button>
  </div>
</template>
