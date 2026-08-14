<script setup lang="ts">
import {
  Calendar, Check, X, AlertTriangle, ExternalLink, Loader2,
  RefreshCw, Unplug, Shield, Clock, Briefcase, Bot,
} from 'lucide-vue-next'

definePageMeta({})

useSeoMeta({
  title: 'Интеграции',
  description: 'Подключайте календарь и другие сервисы',
})

const route = useRoute()
const { calendarStatus, isConnected, isAvailable, connect, disconnect, refresh, status } = useCalendarIntegration()

const isDisconnecting = ref(false)
const showDisconnectConfirm = ref(false)

// ── hh.ru integration ─────────────────────────────────────────────
interface HhStatusResponse {
  configured: boolean
  connected: boolean
  account?: {
    hhUserId: string
    hhEmployerId: string | null
    hhEmail: string | null
    hhFirstName: string | null
    hhLastName: string | null
    connectedAt: string
    lastRefreshedAt: string | null
    accessTokenExpiresAt: string
    lastError: string | null
    webhookEnabled?: boolean
    webhookLastEventAt?: string | null
  }
}

const { data: hhStatus, refresh: refreshHh, status: hhStatusReq } = await useFetch<HhStatusResponse>('/api/hh/status', {
  default: () => ({ configured: false, connected: false }),
})
const hhConnected = computed(() => Boolean(hhStatus.value?.connected))
const hhAvailable = computed(() => Boolean(hhStatus.value?.configured))
const hhIsDisconnecting = ref(false)
const hhShowDisconnectConfirm = ref(false)

function connectHh() {
  window.location.href = '/api/hh/connect'
}
async function disconnectHh() {
  hhIsDisconnecting.value = true
  try {
    await $fetch('/api/hh/disconnect', { method: 'POST' })
    hhShowDisconnectConfirm.value = false
    successMessage.value = 'hh.ru отключён.'
    await refreshHh()
  }
  catch {
    errorMessage.value = 'Не удалось отключить hh.ru. Попробуйте ещё раз.'
  }
  finally {
    hhIsDisconnecting.value = false
  }
}

// ── Спринт 18.1 — вебхуки hh.ru ──
const hhWebhookEnabled = computed(() => Boolean(hhStatus.value?.account?.webhookEnabled))
const hhWebhookBusy = ref(false)
async function toggleHhWebhooks() {
  if (hhWebhookBusy.value) return
  hhWebhookBusy.value = true
  const turningOff = hhWebhookEnabled.value
  try {
    if (turningOff) {
      await $fetch('/api/hh/webhooks', { method: 'DELETE' })
      successMessage.value = 'Вебхуки hh.ru выключены.'
    }
    else {
      await $fetch('/api/hh/webhooks', { method: 'POST' })
      successMessage.value = 'Вебхуки hh.ru включены — новые сообщения, отклики и статусы будут приходить мгновенно.'
    }
    await refreshHh()
  }
  catch {
    errorMessage.value = turningOff
      ? 'Не удалось выключить вебхуки hh.ru. Попробуйте ещё раз.'
      : 'Не удалось включить вебхуки hh.ru. Попробуйте ещё раз.'
  }
  finally {
    hhWebhookBusy.value = false
  }
}

// Handle OAuth callback query params
const successMessage = ref('')
const errorMessage = ref('')

onMounted(() => {
  const success = route.query.success as string | undefined
  const error = route.query.error as string | undefined
  const hhSuccess = route.query.hh_success as string | undefined
  const hhError = route.query.hh_error as string | undefined

  if (success === 'connected') {
    successMessage.value = 'Google Calendar успешно подключён. Интервью будут синхронизироваться автоматически.'
    refresh()
  }
  else if (error === 'consent_denied') {
    errorMessage.value = 'Подключение календаря отменено. Попробуйте ещё раз в любое время.'
  }
  else if (error === 'oauth_failed') {
    errorMessage.value = 'Не удалось подключить Google Calendar. Попробуйте ещё раз.'
  }

  if (hhSuccess === 'connected') {
    successMessage.value = 'hh.ru подключён. Теперь можно загружать вакансии и отклики.'
    refreshHh()
  }
  else if (hhError === 'consent_denied') {
    errorMessage.value = 'Подключение к hh.ru отменено.'
  }
  else if (hhError === 'oauth_failed') {
    errorMessage.value = 'Не удалось подключить hh.ru. Попробуйте ещё раз.'
  }

  // Clear query params after reading
  if (success || error || hhSuccess || hhError) {
    const newQuery = { ...route.query }
    delete newQuery.success
    delete newQuery.error
    delete newQuery.hh_success
    delete newQuery.hh_error
    navigateTo({ query: newQuery }, { replace: true })
  }
})

// ── Спринт 19 — Telegram-бот организации ──
interface TgBotStatus {
  connected: boolean
  enabled?: boolean
  botUsername?: string
  welcomeMessage?: string | null
  webhookLastEventAt?: string | null
  /** Спринт 19.5: подключённые личные аккаунты (Telegram Business). */
  businessConnections?: {
    id: string
    tgUsername: string | null
    displayName: string | null
    enabled: boolean
    canReply: boolean
    connectedAt: string | null
  }[]
}

const { data: tgStatus, refresh: refreshTg, status: tgStatusReq } = await useFetch<TgBotStatus>('/api/comms/telegram-bot', {
  default: () => ({ connected: false }),
})
const tgToken = ref('')
const tgWelcome = ref('')
const tgBusy = ref(false)
const tgShowDisconnectConfirm = ref(false)

watch(tgStatus, (s) => { tgWelcome.value = s?.welcomeMessage ?? '' }, { immediate: true })

async function connectTg() {
  const token = tgToken.value.trim()
  if (!token || tgBusy.value) return
  tgBusy.value = true
  try {
    const res = await $fetch<{ ok: boolean, botUsername: string }>('/api/comms/telegram-bot', {
      method: 'PUT',
      body: { botToken: token },
    })
    tgToken.value = ''
    successMessage.value = `Telegram-бот @${res.botUsername} подключён. Теперь можно приглашать кандидатов в чат.`
    await refreshTg()
  }
  catch (err: any) {
    errorMessage.value = err?.data?.statusMessage ?? 'Не удалось подключить Telegram-бота. Проверьте токен.'
  }
  finally {
    tgBusy.value = false
  }
}

async function saveTgWelcome() {
  if (tgBusy.value) return
  tgBusy.value = true
  try {
    await $fetch('/api/comms/telegram-bot', {
      method: 'PUT',
      body: { welcomeMessage: tgWelcome.value.trim() || null },
    })
    successMessage.value = 'Приветствие бота сохранено.'
    await refreshTg()
  }
  catch {
    errorMessage.value = 'Не удалось сохранить настройки Telegram-бота.'
  }
  finally {
    tgBusy.value = false
  }
}

async function toggleTgEnabled() {
  if (tgBusy.value || !tgStatus.value?.connected) return
  tgBusy.value = true
  const next = !tgStatus.value.enabled
  try {
    await $fetch('/api/comms/telegram-bot', { method: 'PUT', body: { enabled: next } })
    successMessage.value = next ? 'Telegram-бот включён.' : 'Telegram-бот приостановлен.'
    await refreshTg()
  }
  catch {
    errorMessage.value = 'Не удалось изменить состояние Telegram-бота.'
  }
  finally {
    tgBusy.value = false
  }
}

async function disconnectTg() {
  tgBusy.value = true
  try {
    await $fetch('/api/comms/telegram-bot', { method: 'DELETE' })
    tgShowDisconnectConfirm.value = false
    successMessage.value = 'Telegram-бот отключён. История переписок сохранена.'
    await refreshTg()
  }
  catch {
    errorMessage.value = 'Не удалось отключить Telegram-бота. Попробуйте ещё раз.'
  }
  finally {
    tgBusy.value = false
  }
}

function formatTgDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function handleDisconnect() {
  isDisconnecting.value = true
  try {
    await disconnect()
    showDisconnectConfirm.value = false
    successMessage.value = 'Google Calendar отключён.'
  }
  catch {
    errorMessage.value = 'Не удалось отключить интеграцию. Попробуйте ещё раз.'
  }
  finally {
    isDisconnecting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-100">
        Интеграции
      </h1>
      <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">
        Подключайте внешние сервисы для эффективной работы с подбором.
      </p>
    </div>

    <!-- Success/Error Messages -->
    <Transition name="fade">
      <div
        v-if="successMessage"
        class="mb-4 flex items-center gap-3 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3"
      >
        <Check class="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <p class="text-sm text-emerald-700 dark:text-emerald-300 flex-1">
          {{ successMessage }}
        </p>
        <button
          class="text-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-200"
          @click="successMessage = ''"
        >
          <X class="size-4" />
        </button>
      </div>
    </Transition>

    <Transition name="fade">
      <div
        v-if="errorMessage"
        class="mb-4 flex items-center gap-3 rounded-lg border border-danger-200 dark:border-danger-900 bg-danger-50 dark:bg-danger-950/30 px-4 py-3"
      >
        <AlertTriangle class="size-4 text-danger-500 shrink-0" />
        <p class="text-sm text-danger-700 dark:text-danger-300 flex-1">
          {{ errorMessage }}
        </p>
        <button
          class="text-danger-400 hover:text-danger-600 dark:hover:text-danger-200"
          @click="errorMessage = ''"
        >
          <X class="size-4" />
        </button>
      </div>
    </Transition>

    <!-- Google Calendar Integration Card -->
    <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
      <!-- Header -->
      <div class="flex items-center gap-4 px-4 sm:px-6 py-5 border-b border-surface-100 dark:border-surface-800">
        <div class="flex items-center justify-center size-10 rounded-lg bg-brand-50 dark:bg-brand-950/40">
          <Calendar class="size-5 text-brand-600 dark:text-brand-400" />
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">
            Google Calendar
          </h2>
          <p class="text-sm text-surface-500 dark:text-surface-400">
            Двусторонняя синхронизация для планирования интервью
          </p>
        </div>

        <!-- Status Badge -->
        <div
          v-if="isConnected"
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
        >
          <span class="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Подключено
        </div>
        <div
          v-else-if="!isAvailable"
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400"
        >
          Не настроено
        </div>
      </div>

      <!-- Body -->
      <div class="px-4 sm:px-6 py-5">
        <!-- Loading state -->
        <div v-if="status === 'pending'" class="flex items-center justify-center py-4">
          <Loader2 class="size-5 text-surface-400 animate-spin" />
        </div>

        <!-- Not configured (admin needs to set env vars) -->
        <div v-else-if="!isAvailable" class="space-y-3">
          <p class="text-sm text-surface-600 dark:text-surface-400">
            Интеграция с Google Calendar требует настройки сервера. Администратор сервера должен задать переменные окружения
            <code class="text-xs bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 rounded font-mono">GOOGLE_CLIENT_ID</code>
            и
            <code class="text-xs bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 rounded font-mono">GOOGLE_CLIENT_SECRET</code>
            до того, как пользователи смогут подключиться.
          </p>
          <div class="flex items-center gap-4">
            <a
              :href="`${useRuntimeConfig().public.marketingUrl}/docs/features/google-calendar`"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 text-sm text-brand-600 dark:text-brand-400 hover:underline"
            >
              Руководство по настройке
              <ExternalLink class="size-3.5" />
            </a>
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 text-sm text-surface-500 dark:text-surface-400 hover:underline"
            >
              Google Cloud Console
              <ExternalLink class="size-3.5" />
            </a>
          </div>
        </div>

        <!-- Connected state -->
        <div v-else-if="isConnected" class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-1">
              <div class="text-xs font-medium text-surface-400 dark:text-surface-500 uppercase tracking-wider">
                Аккаунт
              </div>
              <div class="text-sm text-surface-900 dark:text-surface-100">
                {{ calendarStatus.accountEmail || 'Неизвестно' }}
              </div>
            </div>
            <div class="space-y-1">
              <div class="text-xs font-medium text-surface-400 dark:text-surface-500 uppercase tracking-wider">
                Календарь
              </div>
              <div class="text-sm text-surface-900 dark:text-surface-100">
                {{ calendarStatus.calendarId === 'primary' ? 'Основной календарь' : calendarStatus.calendarId }}
              </div>
            </div>
          </div>

          <!-- Sync status -->
          <div class="flex items-center gap-2 text-sm">
            <RefreshCw class="size-3.5 text-surface-400" />
            <span class="text-surface-600 dark:text-surface-400">
              Двусторонняя синхронизация:
              <span
                :class="calendarStatus.webhookActive
                  ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                  : 'text-amber-600 dark:text-amber-400'"
              >
                {{ calendarStatus.webhookActive ? 'Активна' : 'Ожидает настройки' }}
              </span>
            </span>
          </div>

          <!-- Features list -->
          <div class="rounded-lg bg-surface-50 dark:bg-surface-800/50 p-4 space-y-2">
            <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <Check class="size-4 text-emerald-500 shrink-0" />
              Интервью автоматически появляются в Google Calendar
            </div>
            <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <Check class="size-4 text-emerald-500 shrink-0" />
              Кандидаты получают приглашения в календарь как участники
            </div>
            <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <Check class="size-4 text-emerald-500 shrink-0" />
              Ответы RSVP синхронизируются автоматически
            </div>
            <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <Clock class="size-4 text-emerald-500 shrink-0" />
              Планирование с учётом часового пояса
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-between pt-2">
            <div class="flex items-center gap-1.5 text-xs text-surface-400 dark:text-surface-500">
              <Shield class="size-3.5" />
              Токены зашифрованы при хранении
            </div>

            <div class="flex items-center gap-2">
              <button
                v-if="!showDisconnectConfirm"
                class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors"
                @click="showDisconnectConfirm = true"
              >
                <Unplug class="size-3.5" />
                Отключить
              </button>

              <template v-else>
                <span class="text-sm text-surface-500 dark:text-surface-400">Вы уверены?</span>
                <button
                  :disabled="isDisconnecting"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-danger-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50 transition-colors"
                  @click="handleDisconnect"
                >
                  <Loader2 v-if="isDisconnecting" class="size-3.5 animate-spin" />
                  Да, отключить
                </button>
                <button
                  class="rounded-lg px-3 py-1.5 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                  @click="showDisconnectConfirm = false"
                >
                  Отмена
                </button>
              </template>
            </div>
          </div>
        </div>

        <!-- Disconnected / Ready to connect -->
        <div v-else class="space-y-4">
          <div class="space-y-3">
            <p class="text-sm text-surface-600 dark:text-surface-400">
              Подключите Google Calendar, чтобы автоматически синхронизировать расписание интервью.
              Вы и кандидат увидите событие в своих календарях, а ответы RSVP будут отслеживаться в обе стороны.
            </p>

            <!-- Features preview -->
            <div class="rounded-lg bg-surface-50 dark:bg-surface-800/50 p-4 space-y-2">
              <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
                <Calendar class="size-4 text-brand-500 shrink-0" />
                Автоматически создавать события в календаре для запланированных интервью
              </div>
              <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
                <RefreshCw class="size-4 text-brand-500 shrink-0" />
                Двусторонняя синхронизация — изменения в обеих системах сохраняются
              </div>
              <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
                <Clock class="size-4 text-brand-500 shrink-0" />
                Корректная работа с часовыми поясами — без путаницы в расписании
              </div>
              <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
                <Shield class="size-4 text-brand-500 shrink-0" />
                Токены OAuth зашифрованы при хранении — доступ можно отозвать в любое время
              </div>
            </div>
          </div>

          <button
            class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
            @click="connect"
          >
            <Calendar class="size-4" />
            Подключить Google Calendar
          </button>
        </div>
      </div>
    </div>

    <!-- hh.ru Integration Card -->
    <div class="mt-6 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
      <!-- Header -->
      <div class="flex items-center gap-4 px-4 sm:px-6 py-5 border-b border-surface-100 dark:border-surface-800">
        <div class="flex items-center justify-center size-10 rounded-lg bg-brand-50 dark:bg-brand-950/40">
          <Briefcase class="size-5 text-brand-600 dark:text-brand-400" />
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">
            hh.ru
          </h2>
          <p class="text-sm text-surface-500 dark:text-surface-400">
            Импорт вакансий, автоматическая загрузка откликов
          </p>
        </div>
        <div
          v-if="hhConnected"
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
        >
          <span class="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Подключено
        </div>
        <div
          v-else-if="!hhAvailable"
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400"
        >
          Не настроено
        </div>
      </div>

      <!-- Body -->
      <div class="px-4 sm:px-6 py-5">
        <div v-if="hhStatusReq === 'pending'" class="flex items-center justify-center py-4">
          <Loader2 class="size-5 text-surface-400 animate-spin" />
        </div>

        <div v-else-if="!hhAvailable" class="space-y-3">
          <p class="text-sm text-surface-600 dark:text-surface-400">
            Интеграция с hh.ru требует настройки на стороне сервера. Администратор должен задать
            <code class="text-xs bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 rounded font-mono">HH_CLIENT_ID</code>,
            <code class="text-xs bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 rounded font-mono">HH_CLIENT_SECRET</code>
            и
            <code class="text-xs bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 rounded font-mono">HH_REDIRECT_URI</code>.
          </p>
        </div>

        <div v-else-if="hhConnected" class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-1">
              <div class="text-xs font-medium text-surface-400 dark:text-surface-500 uppercase tracking-wider">
                Аккаунт hh.ru
              </div>
              <div class="text-sm text-surface-900 dark:text-surface-100">
                {{ hhStatus?.account?.hhEmail || hhStatus?.account?.hhFirstName || hhStatus?.account?.hhUserId }}
              </div>
            </div>
            <div class="space-y-1">
              <div class="text-xs font-medium text-surface-400 dark:text-surface-500 uppercase tracking-wider">
                ID работодателя
              </div>
              <div class="text-sm text-surface-900 dark:text-surface-100 font-mono">
                {{ hhStatus?.account?.hhEmployerId || '—' }}
              </div>
            </div>
          </div>

          <div
            v-if="hhStatus?.account?.lastError"
            class="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
          >
            <AlertTriangle class="size-4 mt-0.5 shrink-0" />
            <div>
              <div class="font-medium">
                Ошибка последнего обновления токена
              </div>
              <div class="text-xs opacity-80 mt-0.5">
                {{ hhStatus?.account?.lastError }}
              </div>
            </div>
          </div>

          <div class="flex items-start justify-between gap-4 rounded-lg border border-surface-200 dark:border-surface-700 px-4 py-3">
            <div class="space-y-0.5">
              <div class="text-sm font-medium text-surface-900 dark:text-surface-100">
                Вебхуки hh.ru
              </div>
              <div class="text-xs text-surface-500 dark:text-surface-400">
                Мгновенные обновления чатов, откликов и статусов — без опроса API. Опрос остаётся резервным каналом.
              </div>
              <div v-if="hhWebhookEnabled && hhStatus?.account?.webhookLastEventAt" class="text-xs text-surface-400 dark:text-surface-500">
                Последнее событие: {{ new Date(hhStatus.account.webhookLastEventAt).toLocaleString('ru-RU') }}
              </div>
            </div>
            <button
              :disabled="hhWebhookBusy"
              class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
              :class="hhWebhookEnabled ? 'bg-brand-600' : 'bg-surface-300 dark:bg-surface-600'"
              role="switch"
              :aria-checked="hhWebhookEnabled"
              @click="toggleHhWebhooks"
            >
              <span
                class="inline-block size-4 rounded-full bg-white shadow transform transition-transform"
                :class="hhWebhookEnabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>

          <div class="flex items-center justify-between pt-2">
            <div class="flex items-center gap-1.5 text-xs text-surface-400 dark:text-surface-500">
              <Shield class="size-3.5" />
              Токены зашифрованы на диске
            </div>
            <div class="flex items-center gap-2">
              <button
                v-if="!hhShowDisconnectConfirm"
                class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors"
                @click="hhShowDisconnectConfirm = true"
              >
                <Unplug class="size-3.5" />
                Отключить
              </button>
              <template v-else>
                <span class="text-sm text-surface-500 dark:text-surface-400">Уверены?</span>
                <button
                  :disabled="hhIsDisconnecting"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-danger-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50 transition-colors"
                  @click="disconnectHh"
                >
                  <Loader2 v-if="hhIsDisconnecting" class="size-3.5 animate-spin" />
                  Да, отключить
                </button>
                <button
                  class="rounded-lg px-3 py-1.5 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                  @click="hhShowDisconnectConfirm = false"
                >
                  Отмена
                </button>
              </template>
            </div>
          </div>
        </div>

        <div v-else class="space-y-4">
          <p class="text-sm text-surface-600 dark:text-surface-400">
            Подключите свой аккаунт hh.ru — появится возможность создавать вакансию в Huntfork из ссылки hh.ru
            и автоматически загружать отклики для последующего скоринга.
          </p>
          <div class="rounded-lg bg-surface-50 dark:bg-surface-800/50 p-4 space-y-2">
            <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <Briefcase class="size-4 text-brand-500 shrink-0" />
              Создание вакансии по ссылке hh.ru с автозаполнением полей
            </div>
            <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <RefreshCw class="size-4 text-brand-500 shrink-0" />
              Автоматическая загрузка новых откликов
            </div>
            <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <Shield class="size-4 text-brand-500 shrink-0" />
              Токены зашифрованы, отключить можно в любой момент
            </div>
          </div>
          <button
            class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
            @click="connectHh"
          >
            <Briefcase class="size-4" />
            Подключить hh.ru
          </button>
        </div>
      </div>
    </div>

    <!-- Спринт 19: Telegram-бот организации -->
    <div class="mt-6 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
      <div class="flex items-center gap-4 px-4 sm:px-6 py-5 border-b border-surface-100 dark:border-surface-800">
        <div class="flex items-center justify-center size-10 rounded-lg bg-sky-50 dark:bg-sky-950/40">
          <Bot class="size-5 text-sky-600 dark:text-sky-400" />
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">
            Telegram-бот
          </h2>
          <p class="text-sm text-surface-500 dark:text-surface-400">
            Переписка с кандидатами в Telegram — прямо из Huntfork
          </p>
        </div>
        <div
          v-if="tgStatus?.connected && tgStatus.enabled"
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
        >
          <span class="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Подключено
        </div>
        <div
          v-else-if="tgStatus?.connected"
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
        >
          Приостановлен
        </div>
      </div>

      <div class="px-4 sm:px-6 py-5">
        <div v-if="tgStatusReq === 'pending'" class="flex items-center justify-center py-4">
          <Loader2 class="size-5 text-surface-400 animate-spin" />
        </div>

        <!-- Подключено -->
        <div v-else-if="tgStatus?.connected" class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-1">
              <div class="text-xs font-medium text-surface-400 dark:text-surface-500 uppercase tracking-wider">
                Бот
              </div>
              <a
                :href="`https://t.me/${tgStatus.botUsername}`"
                target="_blank"
                rel="noopener noreferrer"
                class="text-sm text-brand-600 dark:text-brand-400 hover:underline"
              >
                @{{ tgStatus.botUsername }}
              </a>
            </div>
            <div class="space-y-1">
              <div class="text-xs font-medium text-surface-400 dark:text-surface-500 uppercase tracking-wider">
                Последнее событие вебхука
              </div>
              <div class="text-sm text-surface-900 dark:text-surface-100 inline-flex items-center gap-1.5">
                <Clock class="size-3.5 text-surface-400" />
                {{ formatTgDate(tgStatus.webhookLastEventAt) }}
              </div>
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-medium text-surface-400 dark:text-surface-500 uppercase tracking-wider">
              Приветствие после /start
            </label>
            <textarea
              v-model="tgWelcome"
              rows="2"
              placeholder="Здравствуйте, {name}! Вы откликнулись на вакансию «{job}»…"
              class="w-full resize-none rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
            <p class="text-[11px] text-surface-400 dark:text-surface-500">
              Плейсхолдеры: <code class="bg-surface-100 dark:bg-surface-800 px-1 rounded">{name}</code> — имя кандидата, <code class="bg-surface-100 dark:bg-surface-800 px-1 rounded">{job}</code> — название вакансии. Пусто — стандартное приветствие.
            </p>
          </div>

          <!-- Спринт 19.5: личные аккаунты через Telegram Business -->
          <div class="space-y-1.5">
            <div class="text-xs font-medium text-surface-400 dark:text-surface-500 uppercase tracking-wider">
              Личные аккаунты (Telegram Business)
            </div>
            <template v-if="tgStatus.businessConnections?.length">
              <div
                v-for="bc in tgStatus.businessConnections"
                :key="bc.id"
                class="flex items-center justify-between rounded-lg border border-surface-200/80 dark:border-surface-700/60 px-3 py-2"
              >
                <div>
                  <p class="text-sm text-surface-800 dark:text-surface-100">
                    {{ bc.displayName || (bc.tgUsername ? '@' + bc.tgUsername : '—') }}
                    <span v-if="bc.displayName && bc.tgUsername" class="text-surface-400"> · @{{ bc.tgUsername }}</span>
                  </p>
                  <p class="text-[11px] text-surface-400 dark:text-surface-500">Подключён {{ formatTgDate(bc.connectedAt) }}</p>
                </div>
                <span
                  class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border"
                  :class="bc.enabled && bc.canReply
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'"
                >
                  {{ !bc.enabled ? 'Отключён' : (bc.canReply ? 'Активен' : 'Без права ответа') }}
                </span>
              </div>
            </template>
            <p v-else class="text-sm text-surface-500 dark:text-surface-400">
              Не подключены. В личном Telegram: Настройки → Telegram Business → Чат-боты → добавьте <span class="font-medium">@{{ tgStatus.botUsername }}</span>. После этого переписка вашего личного аккаунта с кандидатами появится в Huntfork.
            </p>
          </div>

          <div class="rounded-lg bg-surface-50 dark:bg-surface-800/50 p-4 space-y-2">
            <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <Check class="size-4 text-emerald-500 shrink-0" />
              Персональные ссылки-приглашения из карточки отклика
            </div>
            <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <Check class="size-4 text-emerald-500 shrink-0" />
              Сообщения и файлы кандидата попадают в единую ленту
            </div>
            <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <Shield class="size-4 text-brand-500 shrink-0" />
              Токен бота хранится в зашифрованном виде
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <button
              class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
              :disabled="tgBusy"
              @click="saveTgWelcome"
            >
              Сохранить приветствие
            </button>
            <button
              class="inline-flex items-center gap-2 rounded-lg border border-surface-200 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/60 disabled:opacity-50 transition-colors"
              :disabled="tgBusy"
              @click="toggleTgEnabled"
            >
              {{ tgStatus.enabled ? 'Приостановить' : 'Включить' }}
            </button>
            <button
              v-if="!tgShowDisconnectConfirm"
              class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/30 disabled:opacity-50 transition-colors"
              :disabled="tgBusy"
              @click="tgShowDisconnectConfirm = true"
            >
              <Unplug class="size-4" />
              Отключить
            </button>
            <template v-else>
              <span class="text-sm text-surface-500 dark:text-surface-400">Точно отключить?</span>
              <button
                class="inline-flex items-center gap-2 rounded-lg bg-danger-600 px-3 py-2 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50 transition-colors"
                :disabled="tgBusy"
                @click="disconnectTg"
              >
                Да, отключить
              </button>
              <button
                class="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors"
                @click="tgShowDisconnectConfirm = false"
              >
                Отмена
              </button>
            </template>
          </div>
        </div>

        <!-- Не подключено -->
        <div v-else class="space-y-4">
          <p class="text-sm text-surface-600 dark:text-surface-400">
            Создайте бота у <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" class="text-brand-600 dark:text-brand-400 hover:underline">@BotFather</a> (команда /newbot), скопируйте токен и вставьте сюда. Кандидаты будут писать вашему боту, а переписка появится в Huntfork.
          </p>
          <div class="flex flex-col sm:flex-row gap-2">
            <input
              v-model="tgToken"
              type="password"
              autocomplete="off"
              placeholder="123456789:AAE…токен бота"
              class="flex-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40 font-mono"
              @keydown.enter="connectTg"
            >
            <button
              class="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              :disabled="tgBusy || !tgToken.trim()"
              @click="connectTg"
            >
              <Loader2 v-if="tgBusy" class="size-4 animate-spin" />
              <Bot v-else class="size-4" />
              Подключить бота
            </button>
          </div>
          <div class="rounded-lg bg-surface-50 dark:bg-surface-800/50 p-4 space-y-2">
            <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <Check class="size-4 text-emerald-500 shrink-0" />
              Единая лента: hh.ru и Telegram в одном чате отклика
            </div>
            <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <Check class="size-4 text-emerald-500 shrink-0" />
              ИИ-ассистент работает в любом канале
            </div>
            <div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <Shield class="size-4 text-brand-500 shrink-0" />
              Токен шифруется, отключить можно в любой момент
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
