<script setup lang="ts">
import { ArrowLeft, Save, Plus, X, FlaskConical } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Новый промпт',
  robots: 'noindex, nofollow',
})

const route = useRoute()
const router = useRouter()

// Pre-fill from query params (copy from bank)
const form = ref({
  name: (route.query.name as string) || '',
  description: '',
  category: 'custom',
  systemPrompt: (route.query.systemPrompt as string) || '',
  userPromptTemplate: (route.query.userPromptTemplate as string) || '',
  variables: [] as Array<{ name: string, description: string, required: boolean, example?: string }>,
  aiConfigId: null as string | null,
  temperature: 0.3,
  isShared: false,
  tags: [] as string[],
})

const tagInput = ref('')
const saving = ref(false)
const error = ref<string | null>(null)

// Load AI configs for the dropdown
const { data: aiConfigsData } = useFetch('/api/ai-config', {
  key: 'ai-configs-for-sandbox',
  headers: useRequestHeaders(['cookie']),
})
const aiConfigs = computed(() => (aiConfigsData.value as any[]) ?? [])

function addVariable() {
  form.value.variables.push({ name: '', description: '', required: false })
}

function removeVariable(idx: number) {
  form.value.variables.splice(idx, 1)
}

function addTag() {
  const t = tagInput.value.trim()
  if (t && !form.value.tags.includes(t)) {
    form.value.tags.push(t)
  }
  tagInput.value = ''
}

function removeTag(idx: number) {
  form.value.tags.splice(idx, 1)
}

async function save() {
  if (!form.value.name.trim() || !form.value.systemPrompt.trim()) {
    error.value = 'Заполните название и system prompt'
    return
  }
  saving.value = true
  error.value = null
  try {
    const res = await $fetch('/api/prompts/sandbox', {
      method: 'POST',
      body: {
        name: form.value.name,
        description: form.value.description || null,
        category: form.value.category,
        systemPrompt: form.value.systemPrompt,
        userPromptTemplate: form.value.userPromptTemplate || null,
        variables: form.value.variables.length ? form.value.variables : null,
        aiConfigId: form.value.aiConfigId,
        temperature: form.value.temperature,
        isShared: form.value.isShared,
        tags: form.value.tags.length ? form.value.tags : null,
      },
    })
    router.push(`/dashboard/prompts/sandbox/${(res as any).prompt.id}`)
  } catch (e: any) {
    error.value = e?.statusMessage ?? 'Не удалось сохранить'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <div class="flex items-center gap-3 mb-8">
      <NuxtLink to="/dashboard/prompts/sandbox" class="rounded-lg p-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
        <ArrowLeft class="size-5" />
      </NuxtLink>
      <div>
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">Новый промпт</h1>
      </div>
    </div>

    <div class="space-y-5">
      <!-- Name + description -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1.5">Название *</label>
          <input v-model="form.name" type="text" placeholder="Мой промпт скрининга"
            class="w-full rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-3 py-2 text-sm text-surface-700 dark:text-surface-300 focus:ring-2 focus:ring-brand-500/40 outline-none">
        </div>
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1.5">Категория</label>
          <input v-model="form.category" type="text" placeholder="custom"
            class="w-full rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-3 py-2 text-sm text-surface-700 dark:text-surface-300 focus:ring-2 focus:ring-brand-500/40 outline-none">
        </div>
      </div>

      <div>
        <label class="block text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1.5">Описание</label>
        <input v-model="form.description" type="text" placeholder="Что делает этот промпт"
          class="w-full rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-3 py-2 text-sm text-surface-700 dark:text-surface-300 focus:ring-2 focus:ring-brand-500/40 outline-none">
      </div>

      <!-- AI config + temperature + shared -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1.5">AI-конфиг</label>
          <select v-model="form.aiConfigId"
            class="w-full rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-3 py-2 text-sm text-surface-700 dark:text-surface-300 focus:ring-2 focus:ring-brand-500/40 outline-none">
            <option :value="null">По умолчанию (analysis)</option>
            <option v-for="c in aiConfigs" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1.5">Температура</label>
          <input v-model.number="form.temperature" type="number" min="0" max="2" step="0.1"
            class="w-full rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-3 py-2 text-sm text-surface-700 dark:text-surface-300 focus:ring-2 focus:ring-brand-500/40 outline-none">
        </div>
        <div class="flex items-end">
          <label class="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300 cursor-pointer">
            <input v-model="form.isShared" type="checkbox" class="rounded border-surface-300 dark:border-surface-700 text-brand-500 focus:ring-brand-500/40">
            Shared с организацией
          </label>
        </div>
      </div>

      <!-- System prompt -->
      <div>
        <label class="block text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1.5">System prompt *</label>
        <textarea v-model="form.systemPrompt" rows="10" placeholder="Ты — эксперт по..."
          class="w-full rounded-lg bg-surface-50 dark:bg-surface-950/60 border border-surface-200 dark:border-surface-800 px-3 py-2 text-sm text-surface-700 dark:text-surface-300 focus:ring-2 focus:ring-brand-500/40 outline-none font-mono leading-relaxed resize-y"></textarea>
      </div>

      <!-- User prompt template -->
      <div>
        <label class="block text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1.5">User prompt (шаблон, опц.)</label>
        <textarea v-model="form.userPromptTemplate" rows="5" placeholder="Оцени кандидата: {{candidateName}}..."
          class="w-full rounded-lg bg-surface-50 dark:bg-surface-950/60 border border-surface-200 dark:border-surface-800 px-3 py-2 text-sm text-surface-700 dark:text-surface-300 focus:ring-2 focus:ring-brand-500/40 outline-none font-mono leading-relaxed resize-y"></textarea>
      </div>

      <!-- Variables -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">Переменные</label>
          <UiButton variant="link" size="xs" :icon-left="Plus" @click="addVariable">
            Добавить
          </UiButton>
        </div>
        <div v-if="form.variables.length" class="space-y-2">
          <div v-for="(v, idx) in form.variables" :key="idx" class="flex items-center gap-2">
            <input v-model="v.name" type="text" placeholder="varName" class="w-32 rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-2 py-1.5 text-xs font-mono text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40">
            <input v-model="v.description" type="text" placeholder="описание" class="flex-1 rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-2 py-1.5 text-xs text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40">
            <input v-model="v.example" type="text" placeholder="пример" class="w-32 rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-2 py-1.5 text-xs text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40">
            <label class="flex items-center gap-1 text-xs text-surface-500 cursor-pointer">
              <input v-model="v.required" type="checkbox" class="rounded border-surface-300 text-brand-500">
              req
            </label>
            <UiButton icon-only variant="ghost" size="xs" class="text-surface-400 hover:text-danger-600" @click="removeVariable(idx)">
              <X class="size-3.5" />
            </UiButton>
          </div>
        </div>
        <p v-else class="text-xs text-surface-400 dark:text-surface-500">Используйте <code class="text-brand-600">{{ '{' + '{varName}' + '}' }}</code> в промпте для подстановки значений при тесте.</p>
      </div>

      <!-- Tags -->
      <div>
        <label class="block text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-1.5">Теги</label>
        <div class="flex items-center gap-2 flex-wrap mb-2">
          <span v-for="(tag, idx) in form.tags" :key="idx" class="inline-flex items-center gap-1 rounded-full bg-surface-100 dark:bg-surface-800 px-2.5 py-1 text-xs text-surface-600 dark:text-surface-400">
            {{ tag }}
            <UiButton icon-only variant="ghost" size="xs" class="text-surface-400 hover:text-danger-500" @click="removeTag(idx)"><X class="size-3" /></UiButton>
          </span>
        </div>
        <input v-model="tagInput" type="text" placeholder="тег + Enter" class="w-full max-w-xs rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-3 py-1.5 text-sm text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40" @keydown.enter.prevent="addTag">
      </div>

      <!-- Error -->
      <div v-if="error" class="rounded-lg bg-danger-50 dark:bg-danger-950/60 text-danger-700 dark:text-danger-400 px-4 py-2.5 text-sm">
        {{ error }}
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-end gap-3 pt-2">
        <NuxtLink to="/dashboard/prompts/sandbox" class="rounded-lg px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
          Отмена
        </NuxtLink>
        <UiButton
          :loading="saving"
          :disabled="saving"
          :icon-left="Save"
          @click="save"
        >
          {{ saving ? 'Сохранение...' : 'Сохранить' }}
        </UiButton>
      </div>
    </div>
  </div>
</template>
