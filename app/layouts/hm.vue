<script setup lang="ts">
/**
 * Layout для роли «Нанимающий менеджер».
 * Минималистичный: логотип + имя + выход. Никакой навигации по вакансиям /
 * настройкам / автоматизациям — НМ работает только со своей очередью.
 */
import { LogOut, Sun, Moon } from 'lucide-vue-next'

const { data: session } = await authClient.useSession(useFetch)
const localePath = useLocalePath()
const { isDark, toggle: toggleColorMode } = useColorMode()

const isSigningOut = ref(false)

const userName = computed(() => session.value?.user?.name ?? 'Нанимающий менеджер')
const userEmail = computed(() => session.value?.user?.email ?? '')
const userInitials = computed(() => {
  const parts = userName.value.split(' ').filter(Boolean)
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
  }
  return userName.value.slice(0, 2).toUpperCase()
})

async function handleSignOut() {
  isSigningOut.value = true
  await authClient.signOut()
  clearNuxtData()
  await navigateTo(localePath('/auth/sign-in'))
}
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-surface-50 dark:bg-surface-950">
    <!-- Мини-топбар -->
    <header
      class="flex-shrink-0 border-b border-surface-200 dark:border-surface-800 bg-white/80 dark:bg-surface-900/80 backdrop-blur"
    >
      <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <NuxtLink
          :to="localePath('/hm/dashboard')"
          class="flex items-center gap-2.5 rounded-lg px-2 py-1.5 no-underline transition-colors hover:bg-surface-100/60 dark:hover:bg-surface-800/60"
        >
          <img
            src="/brand/falcon-emblem.jpg"
            alt="Huntfork"
            class="size-7 shrink-0 rounded-full object-contain"
          >
          <span class="hidden text-[15px] font-bold tracking-tight text-surface-900 dark:text-surface-100 sm:block">
            Huntfork
          </span>
          <span
            class="ml-1 hidden rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-900/50 dark:text-brand-300 sm:inline-block"
          >
            Нанимающий менеджер
          </span>
        </NuxtLink>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg p-2 text-surface-600 transition-colors hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
            :aria-label="isDark ? 'Светлая тема' : 'Тёмная тема'"
            @click="toggleColorMode"
          >
            <Sun v-if="isDark" class="size-4" />
            <Moon v-else class="size-4" />
          </button>

          <div class="hidden text-right sm:block">
            <div class="text-sm font-medium text-surface-900 dark:text-surface-100">
              {{ userName }}
            </div>
            <div class="text-xs text-surface-500 dark:text-surface-400">
              {{ userEmail }}
            </div>
          </div>
          <div
            class="flex size-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900/50 dark:text-brand-300"
          >
            {{ userInitials }}
          </div>

          <UiButton
            variant="ghost"
            size="sm"
            :loading="isSigningOut"
            aria-label="Выйти"
            @click="handleSignOut"
          >
            <LogOut class="size-4" />
            <span class="ml-1.5 hidden sm:inline">Выйти</span>
          </UiButton>
        </div>
      </div>
    </header>

    <AppToasts />
    <main class="relative min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <div class="mx-auto max-w-6xl">
        <slot />
      </div>
    </main>
  </div>
</template>
