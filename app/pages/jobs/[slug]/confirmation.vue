<script setup lang="ts">
import { CheckCircle } from 'lucide-vue-next'

const { t } = useI18n()

definePageMeta({
  layout: 'public',
})

const route = useRoute()
const jobSlug = route.params.slug as string
const { track } = useTrack()

onMounted(() => track('application_confirmed', { slug: jobSlug }))

// Optionally fetch job title for a nicer confirmation
const { data: job } = useFetch(`/api/public/jobs/${jobSlug}`, {
  key: `public-job-confirm-${jobSlug}`,
})

useSeoMeta({
  title: 'Application Submitted — Reqcore',
  robots: 'noindex, nofollow',
})
</script>

<template>
  <div class="text-center py-12">
    <div class="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-success-100 dark:bg-success-900">
      <CheckCircle class="size-8 text-success-600" />
    </div>

    <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-2">
      {{ $t('publicConfirmation.title') }}
    </h1>

    <p class="text-surface-600 dark:text-surface-400 max-w-md mx-auto mb-2">
      {{ $t('publicConfirmation.thankYou') }}
      <template v-if="job">
        {{ $t('publicConfirmation.forPosition') }} <strong>{{ job.title }}</strong>
      </template>.
    </p>

    <p class="text-sm text-surface-400 max-w-md mx-auto mb-8">
      {{ $t('publicConfirmation.received') }}
    </p>

    <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
      <NuxtLink
        :to="$localePath('/jobs')"
        class="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
      >
        {{ $t('publicConfirmation.browseMore') }}
      </NuxtLink>
      <a
        :href="useRuntimeConfig().public.marketingUrl"
        class="inline-flex items-center rounded-lg border border-surface-300 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
      >
        {{ $t('publicConfirmation.backToHome') }}
      </a>
    </div>
  </div>
</template>
