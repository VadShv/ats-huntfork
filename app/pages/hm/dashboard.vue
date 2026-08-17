<script setup lang="ts">
import { Briefcase, Clock, ArrowRight, Inbox, MapPin } from 'lucide-vue-next'

definePageMeta({
  layout: 'hm',
  middleware: ['auth', 'require-org', 'require-hm'],
})

useSeoMeta({
  title: 'Мои кандидаты — Huntfork',
})

const { fetchDashboard } = useHmApi()
const localePath = useLocalePath()

const { data, pending, error, refresh } = await useAsyncData(
  'hm-dashboard',
  () => fetchDashboard(),
  { server: false },
)

const notices = computed(() => data.value?.notices ?? [])
const jobs = computed(() => data.value?.jobs ?? [])
const queue = computed(() => data.value?.queue ?? [])

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
    <div class="flex items-end justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-surface-900 dark:text-surface-100">
          Мои кандидаты
        </h1>
        <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">
          Кандидаты, ждущие вашего решения
        </p>
      </div>
      <UiButton variant="ghost" size="sm" :loading="pending" @click="refresh()">
        Обновить
      </UiButton>
    </div>

    <!-- Notices -->
    <div
      v-for="n in notices"
      :key="n.code"
      class="rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800 dark:border-warning-900 dark:bg-warning-950/40 dark:text-warning-200"
    >
      {{ n.message }}
    </div>

    <!-- Ошибка -->
    <div
      v-if="error"
      class="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-900 dark:bg-danger-950/40 dark:text-danger-300"
    >
      Не удалось загрузить данные: {{ error.message || 'неизвестная ошибка' }}
    </div>

    <!-- Пусто -->
    <UiCard v-if="!pending && jobs.length === 0" variant="dashed">
      <div class="flex flex-col items-center gap-3 py-8 text-center">
        <div class="flex size-12 items-center justify-center rounded-full bg-surface-100 dark:bg-surface-800">
          <Inbox class="size-5 text-surface-400" />
        </div>
        <div>
          <div class="text-base font-medium text-surface-900 dark:text-surface-100">
            Вы пока не назначены ни на одну вакансию
          </div>
          <div class="mt-1 text-sm text-surface-500 dark:text-surface-400">
            Рекрутёр добавит вас в вакансии — они появятся здесь
          </div>
        </div>
      </div>
    </UiCard>

    <!-- Вакансии -->
    <section v-if="jobs.length > 0" class="space-y-3">
      <h2 class="text-sm font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">
        Мои вакансии
      </h2>
      <div class="grid gap-3 md:grid-cols-2">
        <NuxtLink
          v-for="j in jobs"
          :key="j.id"
          :to="localePath(`/hm/jobs/${j.id}`)"
          class="group rounded-xl border border-surface-200 bg-white p-4 no-underline transition-colors hover:border-brand-300 hover:shadow-sm dark:border-surface-800 dark:bg-surface-900 dark:hover:border-brand-700"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <Briefcase class="size-4 text-surface-400" />
                <span class="truncate text-base font-medium text-surface-900 dark:text-surface-100">
                  {{ j.title }}
                </span>
              </div>
              <div v-if="j.location" class="mt-1 flex items-center gap-1 text-xs text-surface-500 dark:text-surface-400">
                <MapPin class="size-3" />
                {{ j.location }}
              </div>
            </div>
            <ArrowRight class="size-4 shrink-0 text-surface-400 transition-transform group-hover:translate-x-0.5" />
          </div>
          <div class="mt-3 flex items-center gap-2">
            <span
              v-if="j.pendingCount > 0"
              class="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
            >
              {{ j.pendingCount }} ждёт решения
            </span>
            <span
              v-else
              class="text-xs text-surface-500 dark:text-surface-400"
            >
              Нет новых кандидатов
            </span>
          </div>
        </NuxtLink>
      </div>
    </section>

    <!-- Общая очередь -->
    <section v-if="queue.length > 0" class="space-y-3">
      <h2 class="text-sm font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">
        Ждут решения ({{ queue.length }})
      </h2>
      <UiCard>
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
                <div class="mt-0.5 flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
                  <span class="truncate">{{ item.job.title }}</span>
                  <span v-if="item.city">·</span>
                  <span v-if="item.city">{{ item.city }}</span>
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
  </div>
</template>
