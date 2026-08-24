<script setup lang="ts">
/**
 * Settings → AI
 *
 * Lists every saved AI configuration as a card. Adding/editing now happens on
 * dedicated pages (`./new` and `./[id]`) for a calmer, less dense experience.
 */
import {
  Brain, Plus, Loader2, AlertTriangle, Sparkles, BarChart3, Star, PanelRight,
  Pencil, Trash2, Zap, Check, KeyRound, Server,
} from 'lucide-vue-next'

definePageMeta({})

useSeoMeta({
  title: 'Настройки ИИ',
  description: 'Настройте провайдеров и модели ИИ для чата и анализа кандидатов.',
})

interface AiConfigRow {
  id: string
  name: string
  provider: string
  model: string
  baseUrl: string | null
  maxTokens: number
  inputPricePer1m: number | null
  outputPricePer1m: number | null
  isDefaultChatbot: boolean
  isDefaultAnalysis: boolean
  isDefaultInteractive: boolean
  hasApiKey: boolean
  createdAt?: string | Date
  updatedAt?: string | Date
}

interface ProviderInfo {
  name: string
  tagline: string
  modelsUrl: string
  apiKeyUrl: string
  signupUrl?: string
  supportsBaseUrl: boolean
  defaultModel: string
  models: { id: string, label: string, description: string, inputPricePer1m?: number, outputPricePer1m?: number, badge?: 'recommended' | 'fast' | 'powerful' | 'cheap' }[]
}

const { allowed: canManageAi, isLoading: isPermissionLoading } = usePermission({ scoring: ['create'] })
const toast = useToast()
const { ask } = useConfirm()

const { data: configsData, refresh: refreshConfigs, status: configsStatus } = useFetch<AiConfigRow[]>('/api/ai-config', {
  key: 'ai-configs',
  headers: useRequestHeaders(['cookie']),
  default: () => [],
})

const { data: providers } = useFetch<Record<string, ProviderInfo>>('/api/ai-config/providers', {
  key: 'ai-providers',
  headers: useRequestHeaders(['cookie']),
})

const configs = computed(() => configsData.value ?? [])
const isLoading = computed(() => configsStatus.value === 'pending' && configs.value.length === 0)

// ── Per-row actions ──
const togglingDefaultId = ref<string | null>(null)
const togglingPurpose = ref<'chatbot' | 'analysis' | 'interactive' | null>(null)
const PURPOSE_TOAST: Record<string, string> = {
  chatbot: 'чата',
  analysis: 'анализа',
  interactive: 'панели Sidekick',
}
async function setDefault(c: AiConfigRow, purpose: 'chatbot' | 'analysis' | 'interactive') {
  togglingDefaultId.value = c.id
  togglingPurpose.value = purpose
  try {
    await $fetch(`/api/ai-config/${c.id}/set-default`, {
      method: 'POST',
      body: { purposes: [purpose] },
      headers: useRequestHeaders(['cookie']),
    })
    toast.success(`Назначено по умолчанию для ${PURPOSE_TOAST[purpose]}`, `Теперь используется «${c.name}».`)
    await refreshConfigs()
  } catch (err: any) {
    const message = err?.data?.statusMessage ?? 'Не удалось назначить конфигурацию по умолчанию.'
    toast.error('Не удалось изменить конфигурацию по умолчанию', { message })
  } finally {
    togglingDefaultId.value = null
    togglingPurpose.value = null
  }
}

const testingId = ref<string | null>(null)
const testResults = ref<Record<string, { success: boolean, message?: string }>>({})
async function testConnection(c: AiConfigRow) {
  testingId.value = c.id
  delete testResults.value[c.id]
  try {
    await $fetch(`/api/ai-config/${c.id}/test-connection`, {
      method: 'POST',
      headers: useRequestHeaders(['cookie']),
    })
    testResults.value = { ...testResults.value, [c.id]: { success: true } }
    toast.success('Подключение работает', `«${c.name}» ответила корректно.`)
  } catch (err: any) {
    const message = err?.data?.statusMessage ?? 'Проверка подключения не пройдена.'
    testResults.value = { ...testResults.value, [c.id]: { success: false, message } }
    toast.error('Проверка не пройдена', { message })
  } finally {
    testingId.value = null
  }
}

const deletingId = ref<string | null>(null)
async function deleteConfig(c: AiConfigRow) {
  const ok = await ask({
    title: 'Удалить конфигурацию?',
    message: `Конфигурация "${c.name}" будет удалена. Беседы, использующие её, переключатся на дефолтную.`,
    variant: 'danger',
    confirmLabel: 'Удалить',
  })
  if (!ok) return
  deletingId.value = c.id
  try {
    await $fetch(`/api/ai-config/${c.id}`, {
      method: 'DELETE',
      headers: useRequestHeaders(['cookie']),
    })
    toast.success('Конфигурация удалена', `«${c.name}» удалена.`)
    await refreshConfigs()
  } catch (err: any) {
    const message = err?.data?.statusMessage ?? 'Не удалось удалить конфигурацию.'
    toast.error('Не удалось удалить', { message })
  } finally {
    deletingId.value = null
  }
}

function providerLabel(key: string): string {
  return providers.value?.[key]?.name ?? key
}
function formatPrice(p: number | null): string {
  if (p == null) return '—'
  return `$${p.toFixed(2)}`
}
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <!-- Page header -->
    <div class="mb-6 flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">Настройки ИИ</h1>
        <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
          Добавляйте нужное количество провайдеров и моделей. Выберите модель для чата и модель для оценки кандидатов.
        </p>
      </div>
      <NuxtLink
        v-if="canManageAi"
        to="/dashboard/settings/ai/new"
        class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
      >
        <Plus class="size-4" />
        Добавить модель
      </NuxtLink>
    </div>

    <!-- Permission guard -->
    <div v-if="isPermissionLoading" class="flex items-center justify-center py-12">
      <Loader2 class="size-6 animate-spin text-surface-400" />
    </div>

    <div
      v-else-if="!canManageAi"
      class="rounded-xl border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-950 p-5 text-sm text-warning-700 dark:text-warning-400 flex items-start gap-3"
    >
      <AlertTriangle class="size-5 shrink-0 mt-0.5" />
      <div>
        <p class="font-semibold mb-1">Недостаточно прав</p>
        <p>У вас недостаточно прав для управления настройками ИИ. Обратитесь к владельцу или администратору организации.</p>
      </div>
    </div>

    <!-- Loading -->
    <div v-else-if="isLoading" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-8 text-center text-sm text-surface-500">
      <Loader2 class="size-5 animate-spin mx-auto mb-2 text-surface-400" />
      Загрузка конфигураций…
    </div>

    <!-- Empty state -->
    <div
      v-else-if="configs.length === 0"
      class="rounded-2xl border border-dashed border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 p-10 text-center"
    >
      <div class="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400 mb-3">
        <Brain class="size-6" />
      </div>
      <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Пока нет настроенных моделей ИИ</h2>
      <p class="mt-1 mb-4 text-sm text-surface-500 dark:text-surface-400">
        Добавьте первую модель, чтобы включить чат и анализ кандидатов. Выберите популярного провайдера или укажите собственную совместимую с OpenAI конечную точку.
      </p>
      <NuxtLink
        to="/dashboard/settings/ai/new"
        class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
      >
        <Plus class="size-4" />
        Добавить первую модель
      </NuxtLink>
    </div>

    <!-- Config cards -->
    <ul v-else class="space-y-3">
      <li
        v-for="c in configs"
        :key="c.id"
        class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden"
      >
        <div class="px-5 py-4 flex flex-col sm:flex-row sm:items-start gap-4">
          <!-- Identity -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-base font-semibold text-surface-900 dark:text-surface-100 truncate">{{ c.name }}</h3>
              <span class="inline-flex items-center gap-1 rounded-full border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-2 py-0.5 text-[11px] font-medium text-surface-700 dark:text-surface-300">
                {{ providerLabel(c.provider) }}
              </span>
              <span
                v-if="c.isDefaultChatbot"
                class="inline-flex items-center gap-1 rounded-full border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/50 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-300"
                title="По умолчанию для чата"
              >
                <Sparkles class="size-3" /> По умолчанию для чата
              </span>
              <span
                v-if="c.isDefaultAnalysis"
                class="inline-flex items-center gap-1 rounded-full border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-950/50 px-2 py-0.5 text-[11px] font-medium text-warning-700 dark:text-warning-300"
                title="По умолчанию для анализа кандидатов"
              >
                <Star class="size-3" /> По умолчанию для анализа
              </span>
              <span
                v-if="c.isDefaultInteractive"
                class="inline-flex items-center gap-1 rounded-full border border-success-200 dark:border-success-800 bg-success-50 dark:bg-success-950/50 px-2 py-0.5 text-[11px] font-medium text-success-700 dark:text-success-300"
                title="По умолчанию для быстрых задач панели Sidekick (саммари, чат, верификация). Если не назначено — используется конфиг анализа"
              >
                <PanelRight class="size-3" /> По умолчанию для панели
              </span>
              <span
                v-if="!c.hasApiKey"
                class="inline-flex items-center gap-1 rounded-full border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950/50 px-2 py-0.5 text-[11px] font-medium text-danger-700 dark:text-danger-300"
              >
                <AlertTriangle class="size-3" /> Нет ключа API
              </span>
            </div>
            <div class="mt-1 flex items-center gap-2 flex-wrap text-xs text-surface-500">
              <span class="font-mono">{{ c.model }}</span>
              <span v-if="c.baseUrl" class="inline-flex items-center gap-1">
                <Server class="size-3" />
                <span class="font-mono truncate max-w-[260px]" :title="c.baseUrl">{{ c.baseUrl }}</span>
              </span>
              <span class="inline-flex items-center gap-1" title="Стоимость за 1 млн токенов">
                <BarChart3 class="size-3" />
                {{ formatPrice(c.inputPricePer1m) }} входящие / {{ formatPrice(c.outputPricePer1m) }} исходящие
              </span>
            </div>

            <div v-if="testResults[c.id]" class="mt-2">
              <span
                v-if="testResults[c.id]?.success"
                class="inline-flex items-center gap-1 text-[11px] text-success-600 dark:text-success-400"
              >
                <Check class="size-3" /> Подключение проверено.
              </span>
              <span
                v-else
                class="inline-flex items-start gap-1 text-[11px] text-danger-600 dark:text-danger-400"
              >
                <AlertTriangle class="size-3 mt-px" /> {{ testResults[c.id]?.message }}
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              v-if="!c.isDefaultChatbot"
              :disabled="!c.hasApiKey || (togglingDefaultId === c.id && togglingPurpose === 'chatbot')"
              class="inline-flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:border-brand-300 dark:hover:border-brand-700 hover:text-brand-700 dark:hover:text-brand-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              :title="c.hasApiKey ? 'Использовать эту модель для чата' : 'Сначала добавьте ключ API'"
              @click="setDefault(c, 'chatbot')"
            >
              <Loader2 v-if="togglingDefaultId === c.id && togglingPurpose === 'chatbot'" class="size-3.5 animate-spin" />
              <Sparkles v-else class="size-3.5" />
              Использовать для чата
            </button>

            <button
              v-if="!c.isDefaultAnalysis"
              :disabled="!c.hasApiKey || (togglingDefaultId === c.id && togglingPurpose === 'analysis')"
              class="inline-flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:border-warning-300 dark:hover:border-warning-700 hover:text-warning-700 dark:hover:text-warning-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              :title="c.hasApiKey ? 'Использовать эту модель для анализа кандидатов' : 'Сначала добавьте ключ API'"
              @click="setDefault(c, 'analysis')"
            >
              <Loader2 v-if="togglingDefaultId === c.id && togglingPurpose === 'analysis'" class="size-3.5 animate-spin" />
              <Star v-else class="size-3.5" />
              Использовать для анализа
            </button>

            <button
              v-if="!c.isDefaultInteractive"
              :disabled="!c.hasApiKey || (togglingDefaultId === c.id && togglingPurpose === 'interactive')"
              class="inline-flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:border-success-300 dark:hover:border-success-700 hover:text-success-700 dark:hover:text-success-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              :title="c.hasApiKey ? 'Использовать эту модель для быстрых задач панели Sidekick (саммари, чат, верификация)' : 'Сначала добавьте ключ API'"
              @click="setDefault(c, 'interactive')"
            >
              <Loader2 v-if="togglingDefaultId === c.id && togglingPurpose === 'interactive'" class="size-3.5 animate-spin" />
              <PanelRight v-else class="size-3.5" />
              Использовать для панели
            </button>

            <button
              :disabled="testingId === c.id || !c.hasApiKey"
              class="inline-flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              @click="testConnection(c)"
            >
              <Loader2 v-if="testingId === c.id" class="size-3.5 animate-spin" />
              <Zap v-else class="size-3.5" />
              Проверить
            </button>

            <NuxtLink
              :to="`/dashboard/settings/ai/${c.id}`"
              class="inline-flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
            >
              <Pencil class="size-3.5" />
              Изменить
            </NuxtLink>

            <button
              :disabled="deletingId === c.id"
              :aria-label="`Удалить конфигурацию ${c.name}`"
              class="inline-flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-xs font-medium text-danger-600 dark:text-danger-400 hover:border-danger-300 dark:hover:border-danger-700 hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              @click="deleteConfig(c)"
            >
              <Loader2 v-if="deletingId === c.id" class="size-3.5 animate-spin" />
              <Trash2 v-else class="size-3.5" />
            </button>
          </div>
        </div>
      </li>
    </ul>

    <!-- Footer hint -->
    <p v-if="canManageAi && configs.length > 0" class="mt-4 text-xs text-surface-500 dark:text-surface-400 flex items-start gap-1.5">
      <KeyRound class="size-3.5 mt-0.5 shrink-0" />
      <span>Ключи API зашифрованы при хранении с помощью AES-256-GCM и никогда не возвращаются в браузер. Нужен бесплатный ключ? OpenAI, Anthropic и Google предлагают пробные кредиты.</span>
    </p>
  </div>
</template>
