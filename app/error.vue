<script setup lang="ts">
import { AlertTriangle, Home, RefreshCw } from 'lucide-vue-next'
import type { PostHog } from 'posthog-js'

const props = defineProps<{
  error: {
    statusCode?: number
    message?: string
    stack?: string
    [key: string]: unknown
  }
}>()

const config = useRuntimeConfig()
const isDev = config.public.env === 'development' || import.meta.dev

function getPostHog(): PostHog | undefined {
  try {
    const $ph = (useNuxtApp() as Record<string, unknown>).$posthog as (() => PostHog) | undefined
    return $ph?.()
  } catch {
    return undefined
  }
}

onMounted(() => {
  const ph = getPostHog()
  if (ph?.has_opted_in_capturing()) {
    ph.capture('app_error_page', {
      status_code: props.error.statusCode,
      message: props.error.message,
    })
  }
})

function handleReload() {
  clearError()
  window.location.reload()
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-surface-50 dark:bg-surface-950 px-4">
    <div class="w-full max-w-md text-center">
      <!-- Icon -->
      <div class="mx-auto mb-6 flex size-20 items-center justify-center rounded-2xl bg-danger-50 dark:bg-danger-950">
        <AlertTriangle class="size-10 text-danger-500" />
      </div>

      <!-- Title -->
      <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-2">
        Что-то пошло не так
      </h1>

      <!-- Error info -->
      <p class="text-sm text-surface-500 dark:text-surface-400 mb-2">
        <span v-if="error.statusCode" class="font-mono font-medium text-surface-700 dark:text-surface-300">
          {{ error.statusCode }}
        </span>
        <span v-if="error.statusCode && (isDev && error.message)"> · </span>
        <span v-if="isDev && error.message">{{ error.message }}</span>
        <span v-else-if="!isDev && error.statusCode === 404">Страница не найдена.</span>
        <span v-else-if="!isDev">Произошла непредвиденная ошибка. Попробуйте перезагрузить страницу или вернитесь на главную.</span>
      </p>

      <!-- Dev stack trace -->
      <pre
        v-if="isDev && error.stack"
        class="mt-4 rounded-xl bg-surface-100 dark:bg-surface-900 border border-surface-200 dark:border-surface-800 p-4 text-[11px] font-mono text-left text-surface-700 dark:text-surface-300 leading-relaxed overflow-x-auto max-h-48 text-wrap break-all"
      >{{ error.stack }}</pre>

      <!-- Actions -->
      <div class="flex items-center justify-center gap-3 mt-8">
        <NuxtLink
          to="/dashboard"
          class="inline-flex items-center gap-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors no-underline"
        >
          <Home class="size-4" />
          На главную
        </NuxtLink>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
          @click="handleReload"
        >
          <RefreshCw class="size-4" />
          Перезагрузить
        </button>
      </div>
    </div>
  </div>
</template>
