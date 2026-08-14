<script setup lang="ts">
/**
 * Настройки AI-ассистента переписки (Спринт 18.5).
 *
 * Персона, тон, база знаний, правила и отдельный AI-конфиг (провайдер/модель) —
 * независимо от скринингового контура. Режим MVP — «суфлёр»: ассистент готовит
 * черновики ответов в чате, отправляет всегда рекрутёр.
 */
import { Bot, Save, Sparkles, TriangleAlert } from 'lucide-vue-next'

definePageMeta({
  layout: 'settings',
  middleware: ['auth', 'require-org'],
})

interface AssistantProfile {
  enabled: boolean
  personaName: string | null
  personaRole: string | null
  tone: string
  language: string
  knowledgeBase: string | null
  rules: string | null
  signatureEnabled: boolean
  aiConfigId: string | null
}

interface AiConfigOption {
  id: string
  name: string
  provider: string
  model: string
}

const { data, pending, refresh } = await useFetch<{ profile: AssistantProfile | null, configs: AiConfigOption[] }>(
  '/api/assistant/profile',
)

const form = reactive<AssistantProfile>({
  enabled: false,
  personaName: null,
  personaRole: null,
  tone: 'neutral',
  language: 'ru',
  knowledgeBase: null,
  rules: null,
  signatureEnabled: true,
  aiConfigId: null,
})

watch(data, (v) => {
  if (v?.profile) Object.assign(form, v.profile)
}, { immediate: true })

const configs = computed(() => data.value?.configs ?? [])
const saving = ref(false)
const saveError = ref<string | null>(null)
const saveSuccess = ref(false)

async function save() {
  saving.value = true
  saveError.value = null
  saveSuccess.value = false
  try {
    await $fetch('/api/assistant/profile', { method: 'PUT', body: { ...form } })
    saveSuccess.value = true
    setTimeout(() => { saveSuccess.value = false }, 3000)
    refresh()
  }
  catch (err: any) {
    saveError.value = err?.data?.statusMessage ?? 'Не удалось сохранить настройки'
  }
  finally {
    saving.value = false
  }
}

useHead({ title: 'Суфлёр переписки — Huntfork' })
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 sm:px-6 py-8">
    <div class="flex items-center gap-3 mb-1">
      <div class="flex size-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-950/40">
        <Bot class="size-5 text-brand-600 dark:text-brand-400" />
      </div>
      <div>
        <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">Суфлёр переписки с кандидатами</h1>
        <p class="text-xs text-surface-400 dark:text-surface-500">Суфлёр готовит черновики ответов кандидатам — отправляет всегда рекрутёр</p>
      </div>
    </div>

    <div v-if="pending" class="text-center py-12 text-surface-400">
      <div class="size-6 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin mx-auto" />
    </div>

    <form v-else class="mt-6 space-y-6" @submit.prevent="save">
      <!-- Включение -->
      <div class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-4 flex items-center justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-surface-800 dark:text-surface-100">Ассистент включён</p>
          <p class="text-xs text-surface-400 dark:text-surface-500 mt-0.5">Кнопка «Предложить ответ» появится в панелях чата</p>
        </div>
        <button
          type="button"
          class="cursor-pointer relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
          :class="form.enabled ? 'bg-brand-600' : 'bg-surface-300 dark:bg-surface-700'"
          @click="form.enabled = !form.enabled"
        >
          <span class="inline-block size-4 transform rounded-full bg-white transition-transform" :class="form.enabled ? 'translate-x-6' : 'translate-x-1'" />
        </button>
      </div>

      <!-- AI-конфиг -->
      <div class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-4 space-y-3">
        <div class="flex items-center gap-2">
          <Sparkles class="size-4 text-brand-600 dark:text-brand-400" />
          <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-100">Модель ассистента</h2>
        </div>
        <p class="text-xs text-surface-400 dark:text-surface-500">
          Отдельный конфиг от скрининга — создать новый можно в разделе
          <NuxtLink to="/dashboard/settings/ai" class="text-brand-600 dark:text-brand-400 hover:underline">Настройки ИИ</NuxtLink>.
        </p>
        <select
          v-model="form.aiConfigId"
          class="w-full rounded-lg border border-surface-200/80 dark:border-surface-700/60 bg-surface-50 dark:bg-surface-900 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        >
          <option :value="null">— не выбран —</option>
          <option v-for="c in configs" :key="c.id" :value="c.id">{{ c.name }} · {{ c.provider }} / {{ c.model }}</option>
        </select>
        <div v-if="form.enabled && !form.aiConfigId" class="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <TriangleAlert class="size-3.5" />
          Для работы ассистента выберите AI-конфиг
        </div>
      </div>

      <!-- Персона -->
      <div class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-4 space-y-3">
        <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-100">Персона</h2>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">Имя</label>
            <input
              v-model="form.personaName"
              type="text"
              placeholder="Варвара"
              class="w-full rounded-lg border border-surface-200/80 dark:border-surface-700/60 bg-surface-50 dark:bg-surface-900 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
          </div>
          <div>
            <label class="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">Роль</label>
            <input
              v-model="form.personaRole"
              type="text"
              placeholder="Суфлёр команды подбора"
              class="w-full rounded-lg border border-surface-200/80 dark:border-surface-700/60 bg-surface-50 dark:bg-surface-900 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
          </div>
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">Тон</label>
            <select
              v-model="form.tone"
              class="w-full rounded-lg border border-surface-200/80 dark:border-surface-700/60 bg-surface-50 dark:bg-surface-900 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              <option value="formal">Формальный</option>
              <option value="neutral">Нейтральный</option>
              <option value="friendly">Дружелюбный</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">Язык ответов</label>
            <select
              v-model="form.language"
              class="w-full rounded-lg border border-surface-200/80 dark:border-surface-700/60 bg-surface-50 dark:bg-surface-900 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              <option value="ru">Русский</option>
              <option value="en">Английский</option>
            </select>
          </div>
        </div>
      </div>

      <!-- База знаний и правила -->
      <div class="rounded-xl border border-surface-200/80 dark:border-surface-800/60 bg-white dark:bg-surface-950 p-4 space-y-3">
        <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-100">База знаний</h2>
        <p class="text-xs text-surface-400 dark:text-surface-500">Условия работы, бенефиты, FAQ — всё, чем ассистент может оперировать в ответах. Поля вакансии подставляются автоматически.</p>
        <textarea
          v-model="form.knowledgeBase"
          rows="6"
          placeholder="Например: офис в Москве (м. Аэропорт), гибрид 3/2, ДМС со стоматологией…"
          class="w-full resize-y rounded-lg border border-surface-200/80 dark:border-surface-700/60 bg-surface-50 dark:bg-surface-900 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-100 pt-1">Правила и границы</h2>
        <p class="text-xs text-surface-400 dark:text-surface-500">Чего ассистент НЕ делает: не обещает оффер, не называет зарплату выше вилки, не даёт контакты. «Не знаешь — скажи, что уточнишь».</p>
        <textarea
          v-model="form.rules"
          rows="4"
          placeholder="Например: не обсуждать зарплату до интервью; не обещать сроки ответа меньше 3 дней…"
          class="w-full resize-y rounded-lg border border-surface-200/80 dark:border-surface-700/60 bg-surface-50 dark:bg-surface-900 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
      </div>

      <!-- Сохранение -->
      <div class="flex items-center gap-3">
        <button
          type="submit"
          class="cursor-pointer inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          :disabled="saving"
        >
          <Save class="size-4" />
          {{ saving ? 'Сохраняем…' : 'Сохранить' }}
        </button>
        <span v-if="saveSuccess" class="text-sm text-success-600 dark:text-success-400">Сохранено</span>
        <span v-if="saveError" class="text-sm text-danger-600 dark:text-danger-400">{{ saveError }}</span>
      </div>
    </form>
  </div>
</template>
