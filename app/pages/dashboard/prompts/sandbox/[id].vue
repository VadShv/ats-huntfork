<script setup lang="ts">
import {
  ArrowLeft, Save, Play, Plus, X, Trash2, Square,
  FlaskConical, CheckCircle2, AlertCircle,
} from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Редактор промпта',
  robots: 'noindex, nofollow',
})

const route = useRoute()
const router = useRouter()
const promptId = computed(() => route.params.id as string)

const { data: promptData, status: fetchStatus, error, refresh } = useFetch(`/api/prompts/sandbox/${promptId.value}`, {
  key: `sandbox-prompt-${promptId.value}`,
  headers: useRequestHeaders(['cookie']),
})

const prompt = computed(() => (promptData.value as any)?.prompt)

const form = ref({
  name: '',
  description: '',
  category: 'custom',
  systemPrompt: '',
  userPromptTemplate: '',
  variables: [] as Array<{ name: string, description: string, required: boolean, example?: string }>,
  aiConfigId: null as string | null,
  temperature: 0.3,
  isShared: false,
  tags: [] as string[],
})

watch(prompt, (p) => {
  if (p) {
    form.value = {
      name: p.name,
      description: p.description ?? '',
      category: p.category,
      systemPrompt: p.systemPrompt,
      userPromptTemplate: p.userPromptTemplate ?? '',
      variables: p.variables ?? [],
      aiConfigId: p.aiConfigId,
      temperature: p.temperature ?? 0.3,
      isShared: p.isShared,
      tags: p.tags ?? [],
    }
    // Initialize test variable values from examples
    for (const v of form.value.variables) {
      if (v.example && !(v.name in testVars.value)) {
        testVars.value[v.name] = v.example
      }
    }
  }
}, { immediate: true })

// AI configs
const { data: aiConfigsData } = useFetch('/api/ai-config', {
  key: 'ai-configs-for-sandbox-edit',
  headers: useRequestHeaders(['cookie']),
})
const aiConfigs = computed(() => (aiConfigsData.value as any[]) ?? [])

// Test panel state
const testVars = ref<Record<string, string>>({})
const testResult = ref('')
const testStatus = ref<'idle' | 'streaming' | 'done' | 'error'>('idle')
const testError = ref<string | null>(null)
let abortController: AbortController | null = null

const tagInput = ref('')
const saving = ref(false)
const saveError = ref<string | null>(null)

function addVariable() {
  form.value.variables.push({ name: '', description: '', required: false })
}
function removeVariable(idx: number) {
  form.value.variables.splice(idx, 1)
}
function addTag() {
  const t = tagInput.value.trim()
  if (t && !form.value.tags.includes(t)) form.value.tags.push(t)
  tagInput.value = ''
}
function removeTag(idx: number) {
  form.value.tags.splice(idx, 1)
}

async function save() {
  saving.value = true
  saveError.value = null
  try {
    await $fetch(`/api/prompts/sandbox/${promptId.value}`, {
      method: 'PATCH',
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
    await refresh()
  } catch (e: any) {
    saveError.value = e?.statusMessage ?? 'Не удалось сохранить'
  } finally {
    saving.value = false
  }
}

async function runTest() {
  testStatus.value = 'streaming'
  testResult.value = ''
  testError.value = null
  abortController = new AbortController()

  try {
    const res = await fetch(`/api/prompts/sandbox/${promptId.value}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: testVars.value }),
      signal: abortController.signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.statusMessage ?? `HTTP ${res.status}`)
    }

    const reader = res.body?.getReader()
    const decoder = new TextDecoder()
    if (!reader) throw new Error('No response body')

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          const evt = JSON.parse(line.slice(6))
          if (evt.delta) testResult.value += evt.delta
          if (evt.done) testStatus.value = 'done'
          if (evt.error) { testError.value = evt.error; testStatus.value = 'error' }
        } catch { /* skip */ }
      }
    }
    if (testStatus.value === 'streaming') testStatus.value = 'done'
  } catch (e: any) {
    if (e.name === 'AbortError') {
      testStatus.value = 'idle'
    } else {
      testError.value = e.message ?? 'Неизвестная ошибка'
      testStatus.value = 'error'
    }
  }
}

function stopTest() {
  abortController?.abort()
  testStatus.value = 'idle'
}

async function deletePrompt() {
  if (!confirm('Удалить промпт?')) return
  try {
    await $fetch(`/api/prompts/sandbox/${promptId.value}`, { method: 'DELETE' })
    router.push('/dashboard/prompts/sandbox')
  } catch (e: any) {
    alert(e?.statusMessage ?? 'Не удалось удалить')
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-8">
      <NuxtLink to="/dashboard/prompts/sandbox" class="rounded-lg p-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
        <ArrowLeft class="size-5" />
      </NuxtLink>
      <div class="flex-1">
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">
          {{ prompt?.name ?? 'Промпт' }}
        </h1>
      </div>
      <button
        v-if="prompt?.isOwner"
        class="inline-flex items-center gap-2 rounded-lg text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-950/40 px-3 py-2 text-sm font-medium transition-colors cursor-pointer"
        @click="deletePrompt"
      >
        <Trash2 class="size-4" />
        Удалить
      </button>
    </div>

    <!-- Loading -->
    <div v-if="fetchStatus === 'pending'" class="space-y-4">
      <div v-for="i in 5" :key="i" class="h-16 bg-surface-100 dark:bg-surface-800 rounded-2xl animate-pulse" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="rounded-2xl border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/60 p-5 text-sm text-danger-700 dark:text-danger-400">
      Промпт не найден или нет доступа.
    </div>

    <!-- Content -->
    <template v-else-if="prompt">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Left: Editor -->
        <div class="space-y-4">
          <div class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 space-y-4">
            <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">Параметры</h2>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-surface-400 dark:text-surface-500 mb-1">Название</label>
                <input v-model="form.name" :disabled="!prompt.isOwner" type="text"
                  class="w-full rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-2.5 py-1.5 text-sm text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60">
              </div>
              <div>
                <label class="block text-xs font-medium text-surface-400 dark:text-surface-500 mb-1">Категория</label>
                <input v-model="form.category" :disabled="!prompt.isOwner" type="text"
                  class="w-full rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-2.5 py-1.5 text-sm text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60">
              </div>
            </div>

            <div>
              <label class="block text-xs font-medium text-surface-400 dark:text-surface-500 mb-1">Описание</label>
              <input v-model="form.description" :disabled="!prompt.isOwner" type="text"
                class="w-full rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-2.5 py-1.5 text-sm text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60">
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-surface-400 dark:text-surface-500 mb-1">AI-конфиг</label>
                <select v-model="form.aiConfigId" :disabled="!prompt.isOwner"
                  class="w-full rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-2.5 py-1.5 text-sm text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60">
                  <option :value="null">По умолчанию</option>
                  <option v-for="c in aiConfigs" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-surface-400 dark:text-surface-500 mb-1">Температура</label>
                <input v-model.number="form.temperature" :disabled="!prompt.isOwner" type="number" min="0" max="2" step="0.1"
                  class="w-full rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-2.5 py-1.5 text-sm text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60">
              </div>
            </div>

            <label v-if="prompt.isOwner" class="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300 cursor-pointer">
              <input v-model="form.isShared" type="checkbox" class="rounded border-surface-300 dark:border-surface-700 text-brand-500 focus:ring-brand-500/40">
              Shared с организацией
            </label>
          </div>

          <!-- System prompt -->
          <div class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
            <label class="block text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-2">System prompt</label>
            <textarea v-model="form.systemPrompt" :disabled="!prompt.isOwner" rows="12"
              class="w-full rounded-lg bg-surface-50 dark:bg-surface-950/60 border border-surface-200 dark:border-surface-800 px-3 py-2 text-sm text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40 font-mono leading-relaxed resize-y disabled:opacity-60"></textarea>
          </div>

          <!-- User prompt template -->
          <div class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
            <label class="block text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-2">User prompt (шаблон)</label>
            <textarea v-model="form.userPromptTemplate" :disabled="!prompt.isOwner" rows="6"
              class="w-full rounded-lg bg-surface-50 dark:bg-surface-950/60 border border-surface-200 dark:border-surface-800 px-3 py-2 text-sm text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40 font-mono leading-relaxed resize-y disabled:opacity-60"></textarea>
          </div>

          <!-- Variables -->
          <div v-if="prompt.isOwner" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
            <div class="flex items-center justify-between mb-2">
              <label class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">Переменные</label>
              <button class="text-xs text-brand-500 hover:text-brand-600 flex items-center gap-1 cursor-pointer" @click="addVariable">
                <Plus class="size-3.5" /> Добавить
              </button>
            </div>
            <div class="space-y-2">
              <div v-for="(v, idx) in form.variables" :key="idx" class="flex items-center gap-2">
                <input v-model="v.name" type="text" placeholder="name" class="w-28 rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-2 py-1.5 text-xs font-mono text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40">
                <input v-model="v.description" type="text" placeholder="описание" class="flex-1 rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-2 py-1.5 text-xs text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40">
                <input v-model="v.example" type="text" placeholder="пример" class="w-28 rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 px-2 py-1.5 text-xs text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40">
                <button class="rounded-lg p-1.5 text-surface-400 hover:text-danger-600 cursor-pointer" @click="removeVariable(idx)">
                  <X class="size-3.5" />
                </button>
              </div>
            </div>
          </div>

          <!-- Save -->
          <div v-if="prompt.isOwner" class="flex items-center justify-end gap-3">
            <div v-if="saveError" class="text-sm text-danger-600 dark:text-danger-400">{{ saveError }}</div>
            <button
              :disabled="saving"
              class="inline-flex items-center gap-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white px-4 py-2 text-sm font-medium transition-colors cursor-pointer"
              @click="save"
            >
              <Save class="size-4" />
              {{ saving ? 'Сохранение...' : 'Сохранить' }}
            </button>
          </div>
        </div>

        <!-- Right: Test panel -->
        <div class="space-y-4">
          <div class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 sticky top-4">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                <FlaskConical class="size-4 text-brand-500" />
                Тест промпта
              </h2>
              <button
                v-if="testStatus === 'streaming'"
                class="inline-flex items-center gap-1.5 rounded-lg bg-danger-50 dark:bg-danger-950/40 text-danger-600 dark:text-danger-400 px-2.5 py-1.5 text-xs font-medium cursor-pointer"
                @click="stopTest"
              >
                <Square class="size-3" /> Стоп
              </button>
              <button
                v-else
                :disabled="testStatus === 'streaming'"
                class="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                @click="runTest"
              >
                <Play class="size-3" /> Запустить
              </button>
            </div>

            <!-- Variable inputs -->
            <div v-if="form.variables.length" class="space-y-2 mb-4">
              <label class="block text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">Переменные</label>
              <div v-for="v in form.variables" :key="v.name">
                <label class="block text-xs text-surface-500 dark:text-surface-400 mb-0.5">
                  <code class="font-mono text-brand-600 dark:text-brand-400">{{ '{{' + v.name + '}}' }}</code>
                  <span v-if="v.required" class="text-danger-500">*</span>
                  — {{ v.description }}
                </label>
                <input
                  v-model="testVars[v.name]"
                  type="text"
                  :placeholder="v.example ?? ''"
                  class="w-full rounded-lg bg-surface-50 dark:bg-surface-950/60 border border-surface-200 dark:border-surface-800 px-2.5 py-1.5 text-xs text-surface-700 dark:text-surface-300 outline-none focus:ring-2 focus:ring-brand-500/40"
                >
              </div>
            </div>

            <!-- Result -->
            <div>
              <label class="block text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-2">Результат</label>
              <div v-if="testStatus === 'idle'" class="text-xs text-surface-400 dark:text-surface-500 py-8 text-center">
                Нажмите «Запустить» для теста
              </div>
              <div v-else-if="testStatus === 'error'" class="flex items-start gap-2 rounded-lg bg-danger-50 dark:bg-danger-950/40 p-3 text-xs text-danger-700 dark:text-danger-400">
                <AlertCircle class="size-4 shrink-0 mt-0.5" />
                {{ testError }}
              </div>
              <div v-else class="rounded-lg bg-surface-50 dark:bg-surface-950/60 p-3 text-xs text-surface-700 dark:text-surface-300 max-h-96 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {{ testResult }}
                <span v-if="testStatus === 'streaming'" class="inline-block w-1.5 h-3 bg-brand-500 animate-pulse ml-0.5 align-middle" />
                <div v-if="testStatus === 'done'" class="flex items-center gap-1 text-success-600 dark:text-success-400 mt-2 pt-2 border-t border-surface-200 dark:border-surface-800">
                  <CheckCircle2 class="size-3" /> Готово
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
