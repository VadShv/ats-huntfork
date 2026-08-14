<script setup lang="ts">
definePageMeta({
  layout: 'public',
})

const route = useRoute()
const token = computed(() => {
  const t = route.query.token
  return typeof t === 'string' ? t : ''
})

const { data, error: fetchError, status: fetchStatus } = await useFetch('/api/public/interviews/respond', {
  query: { token },
  immediate: !!token.value,
})

const actionLabels: Record<string, string> = {
  accepted: 'Принять',
  declined: 'Отклонить',
  tentative: 'Предварительно подтвердить',
}

const actionColors: Record<string, string> = {
  accepted: 'bg-green-600 hover:bg-green-700',
  declined: 'bg-red-600 hover:bg-red-700',
  tentative: 'bg-yellow-600 hover:bg-yellow-700',
}

const responseLabels: Record<string, string> = {
  accepted: 'приняли',
  declined: 'отклонили',
  tentative: 'предварительно подтвердили',
  pending: 'Ожидает',
}

const interviewTypeLabels: Record<string, string> = {
  video: 'Видеозвонок',
  phone: 'Телефонный звонок',
  in_person: 'Личная встреча',
  technical: 'Техническое интервью',
  panel: 'Панельное интервью',
  take_home: 'Тестовое задание',
}

const confirming = ref(false)
const confirmed = ref(false)
const confirmError = ref('')

async function confirmResponse() {
  if (!token.value) return
  confirming.value = true
  confirmError.value = ''

  try {
    await $fetch('/api/public/interviews/respond', {
      method: 'POST',
      body: { token: token.value },
    })
    confirmed.value = true
  }
  catch (err: unknown) {
    const message = err && typeof err === 'object' && 'data' in err
      ? (err as { data?: { statusMessage?: string } }).data?.statusMessage
      : undefined
    confirmError.value = message || 'Не удалось подтвердить ответ. Попробуйте ещё раз.'
  }
  finally {
    confirming.value = false
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('ru-RU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  })
}

useHead({
  title: 'Ответ на приглашение на интервью',
})
</script>

<template>
  <div class="max-w-lg mx-auto py-12">
    <!-- No token -->
    <div v-if="!token" class="text-center">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
        <span class="text-2xl">⚠</span>
      </div>
      <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-100 mb-2">
        Недействительная ссылка      </h1>
      <p class="text-surface-500">
        В ссылке отсутствует необходимая информация. Используйте ссылку из письма с приглашением.      </p>
    </div>

    <!-- Loading -->
    <div v-else-if="fetchStatus === 'pending'" class="text-center py-12">
      <div class="animate-spin inline-block w-8 h-8 border-2 border-surface-300 border-t-blue-600 rounded-full mb-4" />
      <p class="text-surface-500">
        Загрузка данных интервью…      </p>
    </div>

    <!-- Error fetching -->
    <div v-else-if="fetchError" class="text-center">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
        <span class="text-2xl">⚠</span>
      </div>
      <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-100 mb-2">
        {{ fetchError.statusCode === 400 ? 'Срок действия ссылки истёк' : 'Не удалось загрузить данные' }}
      </h1>
      <p class="text-surface-500">
        {{ fetchError.statusCode === 400
          ? 'Срок действия ссылки истёк или она больше недействительна. Обратитесь к команде найма за новым приглашением.'
          : 'Не удалось загрузить данные интервью. Попробуйте ещё раз позже.'
        }}
      </p>
    </div>

    <!-- Confirmed successfully -->
    <div v-else-if="confirmed" class="text-center">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4"
           :class="data?.action === 'accepted' ? 'bg-green-100 dark:bg-green-900/30' : data?.action === 'declined' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-yellow-100 dark:bg-yellow-900/30'">
        <span class="text-2xl">
          {{ data?.action === 'accepted' ? '✓' : data?.action === 'declined' ? '✗' : '?' }}
        </span>
      </div>
      <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-100 mb-2">
        Ответ учтён      </h1>
      <p class="text-surface-500 mb-6">
        <template v-if="data?.action === 'accepted'">
          Вы приняли приглашение на интервью. Оно появится в вашем календаре, если вы приняли приглашение из письма.        </template>
        <template v-else-if="data?.action === 'declined'">
          Вы отклонили приглашение на интервью. Команда найма уведомлена.        </template>
        <template v-else>
          Вы отметили участие как предварительное. Команда найма уведомлена.        </template>
      </p>
    </div>

    <!-- Interview details + confirm action -->
    <div v-else-if="data">
      <!-- Already responded -->
      <div v-if="data.interview.candidateResponse !== 'pending'" class="text-center">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 mb-4">
          <span class="text-2xl">ℹ</span>
        </div>
        <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-100 mb-2">
          Ответ уже отправлен        </h1>
        <p class="text-surface-500">
          Ранее вы {{ responseLabels[data.interview.candidateResponse] ?? 'ответили на' }} приглашение на это интервью.
          Если нужно изменить ответ, свяжитесь с командой найма напрямую.        </p>
      </div>

      <!-- Interview is no longer scheduled -->
      <div v-else-if="data.interview.status !== 'scheduled'" class="text-center">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-surface-100 dark:bg-surface-800 mb-4">
          <span class="text-2xl">ℹ</span>
        </div>
        <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-100 mb-2">
          Интервью {{ data.interview.status === 'cancelled' ? 'отменено' : data.interview.status === 'completed' ? 'завершено' : 'недоступно' }}
        </h1>
        <p class="text-surface-500">
          Это интервью больше не принимает ответы. Если у вас есть вопросы, свяжитесь с командой найма.        </p>
      </div>

      <!-- Ready to respond -->
      <div v-else>
        <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-100 mb-6 text-center">
          Приглашение на интервью        </h1>

        <!-- Interview details card -->
        <div class="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl p-6 mb-6">
          <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">
            {{ data.interview.title }}
          </h2>

          <dl class="space-y-3 text-sm">
            <div v-if="data.organizationName" class="flex justify-between">
              <dt class="text-surface-500">
                Организация              </dt>
              <dd class="text-surface-900 dark:text-surface-100 font-medium">
                {{ data.organizationName }}
              </dd>
            </div>
            <div v-if="data.jobTitle" class="flex justify-between">
              <dt class="text-surface-500">
                Вакансия              </dt>
              <dd class="text-surface-900 dark:text-surface-100 font-medium">
                {{ data.jobTitle }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-surface-500">
                Дата              </dt>
              <dd class="text-surface-900 dark:text-surface-100 font-medium">
                {{ formatDate(data.interview.scheduledAt) }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-surface-500">
                Время              </dt>
              <dd class="text-surface-900 dark:text-surface-100 font-medium">
                {{ formatTime(data.interview.scheduledAt) }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-surface-500">
                Длительность              </dt>
              <dd class="text-surface-900 dark:text-surface-100 font-medium">
                {{ data.interview.duration }} мин.
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-surface-500">
                Тип              </dt>
              <dd class="text-surface-900 dark:text-surface-100 font-medium">
                {{ interviewTypeLabels[data.interview.type] ?? data.interview.type }}
              </dd>
            </div>
            <div v-if="data.interview.location" class="flex justify-between">
              <dt class="text-surface-500">
                Локация / Ссылка              </dt>
              <dd class="text-surface-900 dark:text-surface-100 font-medium break-all">
                {{ data.interview.location }}
              </dd>
            </div>
          </dl>
        </div>

        <!-- Confirm action -->
        <div class="text-center">
          <p class="text-sm text-surface-500 mb-4">
            Вы собираетесь <strong>{{ actionLabels[data.action]?.toLowerCase() }}</strong> приглашение на интервью.
          </p>

          <div v-if="confirmError" class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
            {{ confirmError }}
          </div>

          <button
            :disabled="confirming"
            :class="actionColors[data.action]"
            class="w-full text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            @click="confirmResponse"
          >
            <span v-if="confirming">Обработка…</span>
            <span v-else>{{ actionLabels[data.action] }} приглашение на интервью</span>
          </button>

          <p class="text-xs text-surface-400 mt-4">
            После нажатия ваш ответ будет сохранён, а команда найма получит уведомление.          </p>
        </div>
      </div>
    </div>
  </div>
</template>
