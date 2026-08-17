<script setup lang="ts">
import { Lock, ShieldCheck } from 'lucide-vue-next'

definePageMeta({
  layout: 'hm',
  middleware: ['auth', 'require-org', 'require-hm'],
})

useSeoMeta({
  title: 'Смена пароля — Huntfork',
})

const { changePassword } = useHmApi()
const toast = useToast()
const localePath = useLocalePath()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const isSaving = ref(false)
const formError = ref('')

const canSubmit = computed(() =>
  currentPassword.value.length > 0
  && newPassword.value.length >= 8
  && newPassword.value === confirmPassword.value
  && !isSaving.value,
)

async function submit() {
  formError.value = ''
  if (newPassword.value !== confirmPassword.value) {
    formError.value = 'Новый пароль и подтверждение не совпадают'
    return
  }
  if (newPassword.value.length < 8) {
    formError.value = 'Новый пароль должен быть не короче 8 символов'
    return
  }
  isSaving.value = true
  try {
    await changePassword({
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    })
    toast.success('Пароль обновлён', 'Теперь можно продолжить работу')
    // Обновляем membership-кеш, чтобы флаг mustChangePassword сбросился
    await refreshNuxtData()
    await navigateTo(localePath('/hm/dashboard'))
  }
  catch (err: any) {
    const msg = err?.data?.statusMessage ?? err?.statusMessage ?? err?.message ?? 'Не удалось сменить пароль'
    formError.value = String(msg)
  }
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-md py-8">
    <UiCard>
      <div class="mb-4 flex items-center gap-3">
        <div class="flex size-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
          <ShieldCheck class="size-5" />
        </div>
        <div>
          <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-100">
            Смена пароля
          </h1>
          <p class="text-sm text-surface-500 dark:text-surface-400">
            Установите постоянный пароль вместо временного
          </p>
        </div>
      </div>

      <form class="space-y-4" @submit.prevent="submit">
        <div>
          <label class="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">
            Текущий (временный) пароль
          </label>
          <UiInput
            v-model="currentPassword"
            type="password"
            autocomplete="current-password"
            placeholder="Пароль из письма от рекрутёра"
            required
          />
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">
            Новый пароль
          </label>
          <UiInput
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            placeholder="Не менее 8 символов"
            minlength="8"
            required
          />
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">
            Повторите новый пароль
          </label>
          <UiInput
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            required
          />
        </div>

        <div
          v-if="formError"
          class="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-900 dark:bg-danger-950/40 dark:text-danger-300"
        >
          {{ formError }}
        </div>

        <UiButton
          type="submit"
          full-width
          :loading="isSaving"
          :disabled="!canSubmit"
        >
          <Lock class="size-4" />
          <span class="ml-1.5">Сохранить пароль</span>
        </UiButton>
      </form>
    </UiCard>
  </div>
</template>
