<script setup lang="ts">
definePageMeta({
  layout: 'auth',
})

useSeoMeta({
  title: 'Доступ отклонён',
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
    <div class="flex items-center justify-center size-16 rounded-full bg-danger-50 dark:bg-danger-950 text-danger-500 dark:text-danger-400">
      <svg xmlns="http://www.w3.org/2000/svg" class="size-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    </div>

    <!-- Title -->
    <div>
      <h2 class="text-xl font-semibold text-surface-900 dark:text-surface-100">
        {{ $t('auth.accessDenied.title') }}
      </h2>
      <p class="mt-2 text-sm text-surface-500 dark:text-surface-400 max-w-sm">
        {{ $t('auth.accessDenied.description') }}
      </p>
    </div>

    <UiButton
      type="button"
      variant="secondary"
      class="mt-2"
      @click="handleSignOut"
    >
      {{ $t('auth.accessDenied.signOut') }}
    </UiButton>
  </div>
</template>
