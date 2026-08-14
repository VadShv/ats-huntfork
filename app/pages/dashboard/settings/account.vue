<script setup lang="ts">
import {
  User, Lock, Save, Loader2, Eye, EyeOff, Check,
  KeyRound, Mail, Calendar,
} from 'lucide-vue-next'

definePageMeta({})

useSeoMeta({
  title: 'Настройки аккаунта',
  description: 'Управляйте настройками аккаунта',
})

const { data: session } = await authClient.useSession(useFetch)

// ─────────────────────────────────────────────
// Profile editing
// ─────────────────────────────────────────────
const profileName = ref('')
const isSavingProfile = ref(false)
const profileSuccess = ref(false)
const profileError = ref('')

watch(() => session.value?.user, (user) => {
  if (user) {
    profileName.value = user.name ?? ''
  }
}, { immediate: true })

async function handleSaveProfile() {
  isSavingProfile.value = true
  profileError.value = ''
  profileSuccess.value = false

  try {
    const result = await authClient.updateUser({
      name: profileName.value.trim(),
    })
    if (result.error) throw new Error(String(result.error.message ?? 'Не удалось обновить профиль'))
    profileSuccess.value = true
    setTimeout(() => { profileSuccess.value = false }, 3000)
  }
  catch (err: unknown) {
    profileError.value = err instanceof Error ? err.message : 'Не удалось обновить профиль'
  }
  finally {
    isSavingProfile.value = false
  }
}

// ─────────────────────────────────────────────
// Password change
// ─────────────────────────────────────────────
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showCurrentPassword = ref(false)
const showNewPassword = ref(false)
const isChangingPassword = ref(false)
const passwordSuccess = ref(false)
const passwordError = ref('')

const passwordsMatch = computed(() =>
  newPassword.value === confirmPassword.value && newPassword.value.length > 0,
)

const passwordStrength = computed(() => {
  const pw = newPassword.value
  if (pw.length === 0) return { label: '', bgColor: '', textColor: '', width: '0%' }
  if (pw.length < 8) return { label: 'Слишком короткий', bgColor: 'bg-danger-500', textColor: 'text-danger-500', width: '20%' }

  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++

  if (score <= 2) return { label: 'Слабый', bgColor: 'bg-danger-500', textColor: 'text-danger-500', width: '40%' }
  if (score <= 3) return { label: 'Средний', bgColor: 'bg-warning-500', textColor: 'text-warning-500', width: '60%' }
  if (score <= 4) return { label: 'Хороший', bgColor: 'bg-brand-500', textColor: 'text-brand-500', width: '80%' }
  return { label: 'Надёжный', bgColor: 'bg-success-500', textColor: 'text-success-500', width: '100%' }
})

async function handleChangePassword() {
  if (!passwordsMatch.value || !currentPassword.value) return
  isChangingPassword.value = true
  passwordError.value = ''
  passwordSuccess.value = false

  try {
    const result = await authClient.changePassword({
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    })
    if (result.error) throw new Error(String(result.error.message ?? 'Не удалось изменить пароль'))
    passwordSuccess.value = true
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    setTimeout(() => { passwordSuccess.value = false }, 3000)
  }
  catch (err: unknown) {
    passwordError.value = err instanceof Error ? err.message : 'Не удалось изменить пароль'
  }
  finally {
    isChangingPassword.value = false
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function getInitials(name: string | undefined): string {
  if (!name) return '?'
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <!-- Page title -->
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">
        Аккаунт
      </h1>
      <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
        Управляйте личным профилем и настройками безопасности.
      </p>
    </div>

    <!-- Profile section -->
    <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-surface-200 dark:border-surface-800">
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center size-10 shrink-0 rounded-lg bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400">
            <User class="size-5" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Профиль</h2>
            <p class="text-sm text-surface-500 dark:text-surface-400">Ваши личные данные.</p>
          </div>
        </div>
      </div>

      <div class="px-4 sm:px-6 py-5 space-y-5">
        <!-- Avatar row -->
        <div class="flex items-center gap-4">
          <div v-if="session?.user?.image" class="size-16 rounded-full overflow-hidden ring-2 ring-surface-200 dark:ring-surface-700">
            <img :src="session.user.image" :alt="session.user.name" class="size-full object-cover" />
          </div>
          <div
            v-else
            class="size-16 rounded-full bg-brand-100 dark:bg-brand-900 flex items-center justify-center text-lg font-bold text-brand-700 dark:text-brand-300 ring-2 ring-surface-200 dark:ring-surface-700"
          >
            {{ getInitials(session?.user?.name) }}
          </div>
          <div>
            <p class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ session?.user?.name }}</p>
            <a
              :href="session?.user?.email ? `mailto:${session.user.email}` : undefined"
              target="_blank"
              class="text-sm text-surface-500 dark:text-surface-400 flex items-center gap-1.5 hover:text-brand-600 dark:hover:text-brand-400 hover:underline cursor-pointer transition-colors"
            >
              <Mail class="size-3.5" />
              {{ session?.user?.email }}
            </a>
          </div>
        </div>

        <!-- Name field -->
        <div>
          <label for="profile-name" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
            Отображаемое имя
          </label>
          <input
            id="profile-name"
            v-model="profileName"
            type="text"
            class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            placeholder="Ваше имя"
          />
        </div>

        <!-- Email (read-only) -->
        <div>
          <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
            Email
          </label>
          <div class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 px-3 py-2 text-sm text-surface-500 dark:text-surface-400">
            {{ session?.user?.email }}
          </div>
          <p class="mt-1.5 text-xs text-surface-400 dark:text-surface-500">
            Сейчас изменить Email нельзя.
          </p>
        </div>

        <!-- Save button -->
        <div class="flex items-center gap-3 pt-2">
          <button
            :disabled="isSavingProfile"
            class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            @click="handleSaveProfile"
          >
            <Loader2 v-if="isSavingProfile" class="size-4 animate-spin" />
            <Save v-else class="size-4" />
            {{ isSavingProfile ? 'Сохранение…' : 'Сохранить профиль' }}
          </button>

          <Transition
            enter-active-class="transition-opacity duration-300"
            leave-active-class="transition-opacity duration-300"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
          >
            <span v-if="profileSuccess" class="text-sm text-success-600 dark:text-success-400 font-medium flex items-center gap-1.5">
              <Check class="size-4" />
              Профиль обновлён
            </span>
          </Transition>
        </div>

        <div v-if="profileError" class="rounded-lg bg-danger-50 dark:bg-danger-950/40 border border-danger-200 dark:border-danger-900 px-4 py-3 text-sm text-danger-700 dark:text-danger-400">
          {{ profileError }}
        </div>
      </div>
    </section>

    <!-- Password section -->
    <section class="mt-8 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-surface-200 dark:border-surface-800">
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center size-10 shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400">
            <KeyRound class="size-5" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Пароль</h2>
            <p class="text-sm text-surface-500 dark:text-surface-400">Измените пароль аккаунта.</p>
          </div>
        </div>
      </div>

      <div class="px-4 sm:px-6 py-5 space-y-5">
        <!-- Current password -->
        <div>
          <label for="current-password" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
            Текущий пароль
          </label>
          <div class="relative">
            <input
              id="current-password"
              v-model="currentPassword"
              :type="showCurrentPassword ? 'text' : 'password'"
              autocomplete="current-password"
              class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 pr-10 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              placeholder="Введите текущий пароль"
            />
            <button
              type="button"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
              @click="showCurrentPassword = !showCurrentPassword"
            >
              <EyeOff v-if="showCurrentPassword" class="size-4" />
              <Eye v-else class="size-4" />
            </button>
          </div>
        </div>

        <!-- New password -->
        <div>
          <label for="new-password" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
            Новый пароль
          </label>
          <div class="relative">
            <input
              id="new-password"
              v-model="newPassword"
              :type="showNewPassword ? 'text' : 'password'"
              autocomplete="new-password"
              class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 pr-10 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
              placeholder="Введите новый пароль"
            />
            <button
              type="button"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
              @click="showNewPassword = !showNewPassword"
            >
              <EyeOff v-if="showNewPassword" class="size-4" />
              <Eye v-else class="size-4" />
            </button>
          </div>

          <!-- Password strength meter -->
          <div v-if="newPassword" class="mt-2">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs text-surface-500 dark:text-surface-400">Надёжность пароля</span>
              <span class="text-xs font-medium" :class="passwordStrength.textColor">
                {{ passwordStrength.label }}
              </span>
            </div>
            <div class="h-1.5 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="passwordStrength.bgColor"
                :style="{ width: passwordStrength.width }"
              />
            </div>
          </div>
        </div>

        <!-- Confirm password -->
        <div>
          <label for="confirm-password" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
            Подтвердите новый пароль
          </label>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            placeholder="Подтвердите новый пароль"
          />
          <p
            v-if="confirmPassword && !passwordsMatch"
            class="mt-1.5 text-xs text-danger-500"
          >
            Пароли не совпадают.
          </p>
          <p
            v-if="confirmPassword && passwordsMatch"
            class="mt-1.5 text-xs text-success-500 flex items-center gap-1"
          >
            <Check class="size-3" />
            Пароли совпадают
          </p>
        </div>

        <!-- Save button -->
        <div class="flex items-center gap-3 pt-2">
          <button
            :disabled="isChangingPassword || !passwordsMatch || !currentPassword"
            class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            @click="handleChangePassword"
          >
            <Loader2 v-if="isChangingPassword" class="size-4 animate-spin" />
            <Lock v-else class="size-4" />
            {{ isChangingPassword ? 'Изменение…' : 'Изменить пароль' }}
          </button>

          <Transition
            enter-active-class="transition-opacity duration-300"
            leave-active-class="transition-opacity duration-300"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
          >
            <span v-if="passwordSuccess" class="text-sm text-success-600 dark:text-success-400 font-medium flex items-center gap-1.5">
              <Check class="size-4" />
              Пароль изменён
            </span>
          </Transition>
        </div>

        <div v-if="passwordError" class="rounded-lg bg-danger-50 dark:bg-danger-950/40 border border-danger-200 dark:border-danger-900 px-4 py-3 text-sm text-danger-700 dark:text-danger-400">
          {{ passwordError }}
        </div>
      </div>
    </section>

    <!-- Session info -->
    <section class="mt-8 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-surface-200 dark:border-surface-800">
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center size-10 shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400">
            <Calendar class="size-5" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Сеанс</h2>
            <p class="text-sm text-surface-500 dark:text-surface-400">Сведения о текущем сеансе входа.</p>
          </div>
        </div>
      </div>

      <div class="px-4 sm:px-6 py-5">
        <dl class="space-y-3">
          <div class="flex items-center justify-between">
            <dt class="text-sm text-surface-500 dark:text-surface-400">ID сеанса</dt>
            <dd class="text-sm font-mono text-surface-700 dark:text-surface-300">
              {{ session?.session?.id ? `${session.session.id.slice(0, 8)}…` : '—' }}
            </dd>
          </div>
          <div class="flex items-center justify-between">
            <dt class="text-sm text-surface-500 dark:text-surface-400">Создано</dt>
            <dd class="text-sm text-surface-700 dark:text-surface-300">
              {{ session?.session?.createdAt ? new Date(session.session.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—' }}
            </dd>
          </div>
          <div class="flex items-center justify-between">
            <dt class="text-sm text-surface-500 dark:text-surface-400">Истекает</dt>
            <dd class="text-sm text-surface-700 dark:text-surface-300">
              {{ session?.session?.expiresAt ? new Date(session.session.expiresAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—' }}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  </div>
</template>
