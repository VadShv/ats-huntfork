<script setup lang="ts">
import {
  BookOpen, FlaskConical, Search, Copy, ChevronDown, ChevronRight,
  Target, ShieldAlert, MessageCircleQuestion, FileText, Bot,
  Search as SearchIcon, MessageSquare, GitMerge, Chrome, Wrench,
  Code2, Thermometer, Hash, type LucideIcon,
} from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Банк промптов',
  robots: 'noindex, nofollow',
})

const { data: registryData, status: fetchStatus, error, refresh } = useFetch('/api/prompts/registry', {
  key: 'prompts-registry',
  headers: useRequestHeaders(['cookie']),
})

const prompts = computed(() => registryData.value?.prompts ?? [])
const categories = computed(() => registryData.value?.categories ?? [])

const activeCategory = ref<string>('all')
const expandedId = ref<string | null>(null)
const searchQuery = ref('')

const categoryIcons: Record<string, LucideIcon> = {
  scoring: Target,
  risk: ShieldAlert,
  interview: MessageCircleQuestion,
  parsing: FileText,
  chatbot: Bot,
  sourcing: SearchIcon,
  assistant: MessageSquare,
  dedup: GitMerge,
  extension: Chrome,
  summary: FileText,
  infra: Wrench,
}

const filteredPrompts = computed(() => {
  let result = prompts.value
  if (activeCategory.value !== 'all') {
    result = result.filter(p => p.category === activeCategory.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(p =>
      p.name.toLowerCase().includes(q)
      || p.module.toLowerCase().includes(q)
      || p.description.toLowerCase().includes(q),
    )
  }
  return result
})

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch { /* ignore */ }
}

function copyPromptToSandbox(prompt: any) {
  navigateTo({
    path: '/dashboard/prompts/sandbox/new',
    query: {
      from: prompt.id,
      name: prompt.name,
      systemPrompt: prompt.systemPrompt,
      userPromptTemplate: prompt.userPromptTemplate ?? '',
    },
  })
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">Банк промптов</h1>
        <p class="text-sm text-surface-400 dark:text-surface-500 mt-1">
          Реестр ИИ-промптов, работающих в проде. Только для чтения.
        </p>
      </div>
      <NuxtLink
        to="/dashboard/prompts/sandbox"
        class="inline-flex items-center gap-2 rounded-lg bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 px-3 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 transition-colors"
      >
        <FlaskConical class="size-4" />
        Песочница
      </NuxtLink>
    </div>

    <!-- Loading -->
    <div v-if="fetchStatus === 'pending'" class="space-y-3">
      <div v-for="i in 6" :key="i" class="h-20 bg-surface-100 dark:bg-surface-800 rounded-2xl animate-pulse" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="rounded-2xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/60 p-5 text-sm text-danger-700 dark:text-danger-400">
      Не удалось загрузить промпты.
      <button class="underline ml-2 font-medium cursor-pointer" @click="refresh()">Повторить</button>
    </div>

    <!-- Content -->
    <template v-else>
      <!-- Category filter + search -->
      <div class="flex flex-wrap items-center gap-2 mb-6">
        <button
          class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
          :class="activeCategory === 'all'
            ? 'bg-brand-500 text-white'
            : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'"
          @click="activeCategory = 'all'"
        >
          Все ({{ prompts.length }})
        </button>
        <button
          v-for="cat in categories"
          :key="cat.key"
          class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
          :class="activeCategory === cat.key
            ? 'bg-brand-500 text-white'
            : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'"
          @click="activeCategory = cat.key"
        >
          {{ cat.label }}
        </button>
        <div class="relative ml-auto">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-surface-400" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Поиск..."
            class="w-48 rounded-lg bg-surface-100 dark:bg-surface-800 border-0 pl-8 pr-3 py-1.5 text-sm text-surface-700 dark:text-surface-300 placeholder:text-surface-400 focus:ring-2 focus:ring-brand-500/40 outline-none"
          >
        </div>
      </div>

      <!-- Prompt cards -->
      <div class="space-y-3">
        <div
          v-for="prompt in filteredPrompts"
          :key="prompt.id"
          class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden transition-all"
        >
          <!-- Card header -->
          <div
            class="flex items-start gap-4 p-5 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800/40 transition-colors"
            @click="toggleExpand(prompt.id)"
          >
            <div class="flex items-center justify-center size-10 rounded-xl shrink-0"
              :class="`bg-${prompt.category}-50 dark:bg-${prompt.category}-950/40`"
            >
              <component :is="categoryIcons[prompt.category] ?? BookOpen" class="size-5 text-surface-600 dark:text-surface-400" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ prompt.name }}</h3>
                <span class="text-[10px] uppercase tracking-wider text-surface-400 dark:text-surface-500">{{ prompt.module }}</span>
                <span v-if="prompt.isDynamic" class="text-[10px] rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 font-medium">dynamic</span>
                <span v-if="prompt.subPrompts?.length" class="text-[10px] rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-400 px-1.5 py-0.5 font-medium">{{ prompt.subPrompts.length }} режимов</span>
              </div>
              <p class="text-xs text-surface-500 dark:text-surface-400 mt-1 line-clamp-2">{{ prompt.description }}</p>
              <div class="flex items-center gap-3 mt-2 text-[10px] text-surface-400 dark:text-surface-500">
                <span class="flex items-center gap-1"><Code2 class="size-3" />{{ prompt.sourceFile.split('/').pop() }}:{{ prompt.sourceLine }}</span>
                <span v-if="prompt.temperature !== undefined" class="flex items-center gap-1"><Thermometer class="size-3" />{{ prompt.temperature }}</span>
                <span v-if="prompt.schemaName" class="flex items-center gap-1"><Hash class="size-3" />{{ prompt.schemaName }}</span>
              </div>
            </div>
            <component :is="expandedId === prompt.id ? ChevronDown : ChevronRight" class="size-4 text-surface-400 shrink-0 mt-1" />
          </div>

          <!-- Expanded content -->
          <div v-if="expandedId === prompt.id" class="border-t border-surface-200 dark:border-surface-800 p-5 space-y-4">
            <!-- System prompt -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">System prompt</span>
                <button class="text-xs text-brand-500 hover:text-brand-600 flex items-center gap-1 cursor-pointer" @click="copyToClipboard(prompt.systemPrompt)">
                  <Copy class="size-3" /> Копировать
                </button>
              </div>
              <pre class="text-xs text-surface-700 dark:text-surface-300 bg-surface-50 dark:bg-surface-950/60 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap max-h-96 font-mono leading-relaxed">{{ prompt.systemPrompt }}</pre>
            </div>

            <!-- User prompt template -->
            <div v-if="prompt.userPromptTemplate">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">User prompt (шаблон)</span>
                <button class="text-xs text-brand-500 hover:text-brand-600 flex items-center gap-1 cursor-pointer" @click="copyToClipboard(prompt.userPromptTemplate)">
                  <Copy class="size-3" /> Копировать
                </button>
              </div>
              <pre class="text-xs text-surface-700 dark:text-surface-300 bg-surface-50 dark:bg-surface-950/60 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap max-h-64 font-mono leading-relaxed">{{ prompt.userPromptTemplate }}</pre>
            </div>

            <!-- Variables -->
            <div v-if="prompt.variables?.length">
              <span class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 block mb-2">Переменные</span>
              <div class="flex flex-wrap gap-2">
                <div
                  v-for="v in prompt.variables"
                  :key="v.name"
                  class="rounded-lg bg-surface-50 dark:bg-surface-950/60 px-3 py-1.5 text-xs"
                >
                  <code class="text-brand-600 dark:text-brand-400 font-mono">{{ '{' + '{' + v.name + '}' + '}' }}</code>
                  <span class="text-surface-500 dark:text-surface-400 ml-1.5">— {{ v.description }}</span>
                  <span v-if="v.required" class="text-danger-500 ml-1">*</span>
                </div>
              </div>
            </div>

            <!-- Sub-prompts (modes) -->
            <div v-if="prompt.subPrompts?.length">
              <span class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 block mb-2">Режимы</span>
              <div class="space-y-2">
                <details v-for="sub in prompt.subPrompts" :key="sub.id" class="rounded-lg bg-surface-50 dark:bg-surface-950/60">
                  <summary class="px-3 py-2 text-xs font-medium text-surface-700 dark:text-surface-300 cursor-pointer">{{ sub.name }}</summary>
                  <pre class="text-xs text-surface-600 dark:text-surface-400 px-3 pb-3 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">{{ sub.systemPrompt }}</pre>
                </details>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2 pt-2">
              <button
                class="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                @click="copyPromptToSandbox(prompt)"
              >
                <FlaskConical class="size-3.5" />
                Копировать в песочницу
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty -->
      <div v-if="filteredPrompts.length === 0" class="text-center py-16">
        <BookOpen class="size-10 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
        <p class="text-sm text-surface-500 dark:text-surface-400">Промпты не найдены</p>
      </div>
    </template>
  </div>
</template>
