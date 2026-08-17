<script setup lang="ts">
import { ArrowLeft, ArrowRight, Briefcase, Clock, Inbox, MapPin } from 'lucide-vue-next'

definePageMeta({
  layout: 'hm',
  middleware: ['auth', 'require-org', 'require-hm'],
})

const route = useRoute()
const jobId = computed(() => String(route.params.id))
const localePath = useLocalePath()
const { fetchDashboard } = useHmApi()

useSeoMeta({
  title: 'Вакансия — Huntfork',
})

const { data, pending, error, refresh } = await useAsyncData(
  () => `hm-job-${jobId.value}`,
  () => fetchDashboard(),
  { server: false, watch: [jobId] },
)

const job = computed(() => data.value?.jobs.find(j => j.id === jobId.value) ?? null)
const queue = computed(() =>
  (data.value?.queue ?? []).filter(q => q.job.id === jobId.value),
)

function timeAgo(input: string | Date | null): string {
  if (!input) return ''
  const d = typeof input === 'string' ? new Date(input) : input
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'только что'
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
  return `${Math.floor(diff / 86400)} дн назад`
}
</script>

<template>
  <div class="space-y-6">
    <NuxtLink
      :to="localePath('/hm/dashboard')"
      class="inline-flex items-center gap-1.5 text-sm text-surface-500 no-underline hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100"
    >
      <ArrowLeft class="size-4" />
      К моим вакансиям
    </NuxtLink>

    <div v-if="pending" class="text-sm text-surface-500">
      Загружаем…
    </div>

    <div
      v-else-if="error || !job"
      class="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-900 dark:bg-danger-950/40 dark:text-danger-300"
    >
      {{ error ? `Не удалось загрузить: ${error.message}` : 'Вакансия не найдена или вы не назначены на неё' }}
    </div>

    <template v-else>
      <div>
        <div class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400">
          <Briefcase class="size-4" />
          Вакансия
        </div>
        <h1 class="mt-1 text-2xl font-semibold tracking-tight text-surface-900 dark:text-surface-100">
          {{ job.title }}
        </h1>
        <div v-if="job.location" class="mt-1 flex items-center gap-1 text-sm text-surface-500 dark:text-surface-400">
          <MapPin class="size-3.5" />
          {{ job.location }}
        </div>
      </div>

      <section class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">
            Ждут решения ({{ queue.length }})
          </h2>
          <UiButton variant="ghost" size="sm" :loading="pending" @click="refresh()">
            Обновить
          </UiButton>
        </div>

        <UiCard v-if="queue.length === 0" variant="dashed">
          <div class="flex flex-col items-center gap-2 py-6 text-center">
            <Inbox class="size-5 text-surface-400" />
            <div class="text-sm text-surface-500 dark:text-surface-400">
              По этой вакансии пока нет кандидатов, ждущих вашего решения
            </div>
          </div>
        </UiCard>

        <UiCard v-else>
          <ul class="divide-y divide-surface-100 dark:divide-surface-800">
            <li v-for="item in queue" :key="item.applicationId" class="py-3 first:pt-0 last:pb-0">
              <NuxtLink
                :to="localePath(`/hm/applications/${item.applicationId}`)"
                class="flex items-center justify-between gap-4 no-underline"
              >
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium text-surface-900 dark:text-surface-100">
                    {{ item.fullName }}
                  </div>
                  <div v-if="item.city" class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
                    {{ item.city }}
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-3">
                  <span class="hidden items-center gap-1 text-xs text-surface-400 sm:inline-flex">
                    <Clock class="size-3" />
                    {{ timeAgo(item.createdAt) }}
                  </span>
                  <ArrowRight class="size-4 text-surface-400" />
                </div>
              </NuxtLink>
            </li>
          </ul>
        </UiCard>
      </section>
    </template>
  </div>
</template>
