<script setup lang="ts">
import {
  FlaskConical, Plus, Search, Pencil, Trash2, Play,
  BookOpen, Share2, Clock, CheckCircle2,
} from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Песочница промптов',
  robots: 'noindex, nofollow',
})

const { data: sandboxData, status: fetchStatus, error, refresh } = useFetch('/api/prompts/sandbox', {
  key: 'prompts-sandbox',
  headers: useRequestHeaders(['cookie']),
})

const prompts = computed(() => sandboxData.value?.prompts ?? [])
const searchQuery = ref('')
const filterShared = ref(false)

const filteredPrompts = computed(() => {
  let result = prompts.value
  if (filterShared.value) {
    result = result.filter((p: any) => p.isShared)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter((p: any) =>
      p.name.toLowerCase().includes(q)
      || (p.description?.toLowerCase().includes(q) ?? false),
    )
  }
  return result
})

async function deletePrompt(id: string) {
  if (!confirm('Удалить промпт?')) return
  try {
    await $fetch(`/api/prompts/sandbox/${id}`, { method: 'DELETE' })
    await refresh()
  } catch (e: any) {
    alert(e?.statusMessage ?? 'Не удалось удалить')
  }
}

function timeAgo(ts: number | null): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`
  return `${Math.floor(diff / 86_400_000)} дн назад`
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">Песочница промптов</h1>
        <p class="text-sm text-surface-400 dark:text-surface-500 mt-1">
          Создавайте и тестируйте собственные промпты
        </p>
      </div>
      <div class="flex items-center gap-2">
        <NuxtLink
          to="/dashboard/prompts"
          class="inline-flex items-center gap-2 rounded-lg bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 px-3 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 transition-colors"
        >
          <BookOpen class="size-4" />
          Банк промптов
        </NuxtLink>
        <NuxtLink
          to="/dashboard/prompts/sandbox/new"
          class="inline-flex items-center gap-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white px-3 py-2 text-sm font-medium transition-colors"
        >
          <Plus class="size-4" />
          Новый промпт
        </NuxtLink>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="fetchStatus === 'pending'" class="space-y-3">
      <div v-for="i in 4" :key="i" class="h-20 bg-surface-100 dark:bg-surface-800 rounded-2xl animate-pulse" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="rounded-2xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/60 p-5 text-sm text-danger-700 dark:text-danger-400">
      Не удалось загрузить промпты.
      <button class="underline ml-2 font-medium cursor-pointer" @click="refresh()">Повторить</button>
    </div>

    <!-- Content -->
    <template v-else>
      <!-- Filters -->
      <div class="flex items-center gap-3 mb-6">
        <div class="relative flex-1 max-w-xs">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-surface-400" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Поиск..."
            class="w-full rounded-lg bg-surface-100 dark:bg-surface-800 border-0 pl-8 pr-3 py-1.5 text-sm text-surface-700 dark:text-surface-300 placeholder:text-surface-400 focus:ring-2 focus:ring-brand-500/40 outline-none"
          >
        </div>
        <button
          class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
          :class="filterShared
            ? 'bg-brand-500 text-white'
            : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'"
          @click="filterShared = !filterShared"
        >
          <Share2 class="size-3.5 inline -mt-0.5 mr-1" />
          Shared
        </button>
      </div>

      <!-- Prompt cards -->
      <div v-if="filteredPrompts.length > 0" class="space-y-3">
        <div
          v-for="prompt in filteredPrompts"
          :key="prompt.id"
          class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 hover:border-brand-300 dark:hover:border-brand-700 transition-colors"
        >
          <div class="flex items-start gap-4">
            <div class="flex items-center justify-center size-10 rounded-xl bg-brand-50 dark:bg-brand-950/40 shrink-0">
              <FlaskConical class="size-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ prompt.name }}</h3>
                <span v-if="prompt.isShared" class="text-[10px] rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-400 px-1.5 py-0.5 font-medium flex items-center gap-1">
                  <Share2 class="size-2.5" /> shared
                </span>
                <span class="text-[10px] rounded-full bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 px-1.5 py-0.5">{{ prompt.category }}</span>
              </div>
              <p v-if="prompt.description" class="text-xs text-surface-500 dark:text-surface-400 mt-1 line-clamp-1">{{ prompt.description }}</p>
              <div class="flex items-center gap-3 mt-2 text-[10px] text-surface-400 dark:text-surface-500">
                <span v-if="prompt.lastTestedAt" class="flex items-center gap-1">
                  <CheckCircle2 class="size-3 text-success-500" />
                  тест {{ timeAgo(prompt.lastTestedAt) }}
                </span>
                <span class="flex items-center gap-1">
                  <Clock class="size-3" />
                  {{ timeAgo(prompt.createdAt) }}
                </span>
                <span v-if="prompt.tags?.length" class="flex items-center gap-1">
                  {{ prompt.tags.join(', ') }}
                </span>
              </div>
            </div>
            <!-- Actions -->
            <div class="flex items-center gap-1 shrink-0">
              <NuxtLink
                :to="`/dashboard/prompts/sandbox/${prompt.id}`"
                class="rounded-lg p-2 text-surface-500 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40 transition-colors"
                title="Тест"
              >
                <Play class="size-4" />
              </NuxtLink>
              <NuxtLink
                v-if="prompt.isOwner"
                :to="`/dashboard/prompts/sandbox/${prompt.id}`"
                class="rounded-lg p-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                title="Редактировать"
              >
                <Pencil class="size-4" />
              </NuxtLink>
              <button
                v-if="prompt.isOwner"
                class="rounded-lg p-2 text-surface-500 hover:text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-950/40 transition-colors cursor-pointer"
                title="Удалить"
                @click="deletePrompt(prompt.id)"
              >
                <Trash2 class="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else class="flex flex-col items-center justify-center py-20">
        <div class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-10 text-center max-w-sm">
          <div class="mx-auto mb-6 flex items-center justify-center size-16 rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 shadow-lg shadow-brand-500/20">
            <FlaskConical class="size-8 text-white" />
          </div>
          <h2 class="text-lg font-bold text-surface-900 dark:text-surface-100 mb-2">Песочница пуста</h2>
          <p class="text-sm text-surface-500 dark:text-surface-400 mb-4">
            Создайте свой первый промпт или скопируйте промпт из банка.
          </p>
          <NuxtLink
            to="/dashboard/prompts/sandbox/new"
            class="inline-flex items-center gap-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white px-4 py-2 text-sm font-medium transition-colors"
          >
            <Plus class="size-4" />
            Создать промпт
          </NuxtLink>
        </div>
      </div>
    </template>
  </div>
</template>
