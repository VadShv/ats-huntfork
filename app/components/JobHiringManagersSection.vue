<script setup lang="ts">
/**
 * JobHiringManagersSection — секция «Нанимающие менеджеры» на странице
 * настроек вакансии. Показывает список назначенных НМ, позволяет добавить
 * существующего НМ и пригласить нового.
 */
import {
  Users, UserPlus, Trash2, Copy, Check, Loader2, Mail,
} from 'lucide-vue-next'

interface Props {
  jobId: string
}
const props = defineProps<Props>()

interface HmMember {
  userId: string
  name: string | null
  email: string
  status: string
  canViewSalary: boolean
  createdAt: string | Date
}

interface JobMember {
  id: string
  userId: string
  memberRole: string
  addedAt: string | Date
  addedByUserId: string | null
  user: { id: string; name: string | null; email: string }
}

const { allowed: canManage } = usePermission({ member: ['create'] })
const toast = useToast()

// ─── Список назначенных на вакансию НМ ───
const assigned = ref<JobMember[]>([])
const isLoadingAssigned = ref(false)
const assignedError = ref('')

async function fetchAssigned() {
  isLoadingAssigned.value = true
  assignedError.value = ''
  try {
    const res = await $fetch<{ members: JobMember[] }>(`/api/jobs/${props.jobId}/members`)
    assigned.value = (res.members ?? []).filter(m => m.memberRole === 'hiring_manager')
  }
  catch (err: any) {
    assignedError.value = err?.data?.statusMessage ?? err?.message ?? 'Не удалось загрузить'
  }
  finally {
    isLoadingAssigned.value = false
  }
}

// ─── Все НМ в организации ───
const orgHms = ref<HmMember[]>([])
const isLoadingOrgHms = ref(false)

async function fetchOrgHms() {
  isLoadingOrgHms.value = true
  try {
    const res = await $fetch<{ hiringManagers: HmMember[] }>('/api/hiring-managers')
    orgHms.value = res.hiringManagers ?? []
  }
  catch {
    // тихо
  }
  finally {
    isLoadingOrgHms.value = false
  }
}

const availableToAdd = computed(() => {
  const assignedIds = new Set(assigned.value.map(a => a.userId))
  return orgHms.value.filter(h => h.status === 'active' && !assignedIds.has(h.userId))
})

const availableToAddOptions = computed(() =>
  availableToAdd.value.map(h => ({
    label: h.name ? `${h.name} (${h.email})` : h.email,
    value: h.userId,
  })),
)

// ─── Добавить существующего НМ ───
const selectedUserId = ref('')
const isAdding = ref(false)

async function addExisting() {
  if (!selectedUserId.value) return
  isAdding.value = true
  try {
    await $fetch(`/api/jobs/${props.jobId}/members`, {
      method: 'POST',
      body: { userId: selectedUserId.value, memberRole: 'hiring_manager' },
    })
    toast.success('НМ добавлен на вакансию')
    selectedUserId.value = ''
    await fetchAssigned()
  }
  catch (err: any) {
    const msg = err?.data?.statusMessage ?? err?.message ?? 'Не удалось добавить'
    toast.error('Ошибка', { message: String(msg) })
  }
  finally {
    isAdding.value = false
  }
}

// ─── Убрать НМ с вакансии ───
async function removeMember(userId: string) {
  try {
    await $fetch(`/api/jobs/${props.jobId}/members/${userId}`, { method: 'DELETE' })
    toast.success('НМ убран с вакансии')
    await fetchAssigned()
  }
  catch (err: any) {
    const msg = err?.data?.statusMessage ?? err?.message ?? 'Не удалось убрать'
    toast.error('Ошибка', { message: String(msg) })
  }
}

// ─── Пригласить нового НМ (модалка) ───
const showInvite = ref(false)
const inviteForm = ref({
  name: '',
  email: '',
  canViewSalary: false,
})
const isInviting = ref(false)
const createdCredentials = ref<null | { email: string; temporaryPassword: string }>(null)
const copied = ref(false)

async function invite() {
  isInviting.value = true
  try {
    // 1) Создаём нМ
    const res = await $fetch<{
      success: true
      user: { id: string; email: string; name: string }
      memberId: string
      temporaryPassword: string
    }>('/api/hiring-managers', {
      method: 'POST',
      body: {
        name: inviteForm.value.name.trim(),
        email: inviteForm.value.email.trim().toLowerCase(),
        canViewSalary: inviteForm.value.canViewSalary,
      },
    })

    // 2) Сразу назначаем на текущую вакансию
    try {
      await $fetch(`/api/jobs/${props.jobId}/members`, {
        method: 'POST',
        body: { userId: res.user.id, memberRole: 'hiring_manager' },
      })
    }
    catch {
      // не критично: если падает assign — покажем toast, но учётка уже есть
      toast.warning('НМ создан, но не удалось назначить на вакансию', 'Добавьте вручную через селект «Добавить существующего НМ»')
    }

    createdCredentials.value = {
      email: res.user.email,
      temporaryPassword: res.temporaryPassword,
    }
    inviteForm.value = { name: '', email: '', canViewSalary: false }
    await Promise.all([fetchOrgHms(), fetchAssigned()])
  }
  catch (err: any) {
    const msg = err?.data?.statusMessage ?? err?.message ?? 'Не удалось создать НМ'
    toast.error('Ошибка', { message: String(msg) })
  }
  finally {
    isInviting.value = false
  }
}

function copyCredentials() {
  if (!createdCredentials.value) return
  const text = `Логин: ${createdCredentials.value.email}\nВременный пароль: ${createdCredentials.value.temporaryPassword}`
  navigator.clipboard.writeText(text).then(() => {
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  })
}

function closeInvite() {
  showInvite.value = false
  createdCredentials.value = null
  copied.value = false
  inviteForm.value = { name: '', email: '', canViewSalary: false }
}

onMounted(() => {
  fetchAssigned()
  fetchOrgHms()
})
</script>

<template>
  <section class="rounded-xl border border-surface-200 bg-white p-6 dark:border-surface-800 dark:bg-surface-900">
    <div class="mb-5 flex items-start justify-between gap-3">
      <div>
        <h2 class="flex items-center gap-2 text-base font-semibold text-surface-900 dark:text-surface-100">
          <Users class="size-4 text-surface-500" />
          Нанимающие менеджеры
        </h2>
        <p class="mt-1 text-xs text-surface-500 dark:text-surface-400">
          Люди, которые видят кандидатов этой вакансии в разделе «Мои кандидаты» и выносят решения об интервью.
          Может быть несколько НМ на одной вакансии.
        </p>
      </div>
      <UiButton
        v-if="canManage"
        size="sm"
        variant="secondary"
        @click="showInvite = true"
      >
        <UserPlus class="size-4" />
        <span class="ml-1.5">Пригласить</span>
      </UiButton>
    </div>

    <!-- Assigned list -->
    <div v-if="isLoadingAssigned" class="flex items-center gap-2 text-sm text-surface-500">
      <Loader2 class="size-4 animate-spin" /> Загружаем…
    </div>
    <div
      v-else-if="assignedError"
      class="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700"
    >
      {{ assignedError }}
    </div>
    <ul v-else-if="assigned.length > 0" class="divide-y divide-surface-100 dark:divide-surface-800">
      <li v-for="m in assigned" :key="m.userId" class="flex items-center justify-between py-3">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-surface-900 dark:text-surface-100">
            {{ m.user.name || m.user.email }}
          </div>
          <div class="mt-0.5 truncate text-xs text-surface-500 dark:text-surface-400">
            {{ m.user.email }}
          </div>
        </div>
        <UiButton
          v-if="canManage"
          size="sm"
          variant="ghost"
          icon-only
          aria-label="Убрать с вакансии"
          @click="removeMember(m.userId)"
        >
          <Trash2 class="size-4 text-surface-500" />
        </UiButton>
      </li>
    </ul>
    <div v-else class="rounded-lg border border-dashed border-surface-200 px-3 py-4 text-center text-sm text-surface-500 dark:border-surface-800">
      Ни один НМ пока не назначен
    </div>

    <!-- Add existing HM -->
    <div v-if="canManage && availableToAdd.length > 0" class="mt-4 flex items-end gap-2">
      <div class="flex-1">
        <UiSelect
          v-model="selectedUserId"
          label="Добавить существующего НМ"
          placeholder="— выберите —"
          :options="availableToAddOptions"
        />
      </div>
      <UiButton
        :disabled="!selectedUserId || isAdding"
        :loading="isAdding"
        @click="addExisting"
      >
        Добавить
      </UiButton>
    </div>

    <!-- Invite modal -->
    <UiModal
      :model-value="showInvite"
      title="Пригласить нового НМ"
      size="md"
      @update:model-value="(v: boolean) => { if (!v) closeInvite() }"
    >

      <div v-if="!createdCredentials" class="space-y-4">
        <div>
          <label class="mb-1.5 block text-sm font-medium">ФИО</label>
          <UiInput v-model="inviteForm.name" placeholder="Иван Иванов" required />
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-medium">Email (логин)</label>
          <UiInput v-model="inviteForm.email" type="email" placeholder="ivan@example.com" required />
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="inviteForm.canViewSalary" type="checkbox" class="rounded">
          Разрешить видеть зарплатные ожидания кандидатов
        </label>
        <UiButton
          full-width
          :loading="isInviting"
          :disabled="!inviteForm.name || !inviteForm.email"
          @click="invite"
        >
          <Mail class="size-4" />
          <span class="ml-1.5">Создать и получить пароль</span>
        </UiButton>
      </div>

      <div v-else class="space-y-4">
        <div class="rounded-lg border border-success-200 bg-success-50 px-3 py-2 text-sm text-success-800 dark:border-success-900 dark:bg-success-950/40 dark:text-success-200">
          НМ создан и добавлен на эту вакансию. Передайте временный пароль лично.
          После первого входа он попросит установить постоянный пароль.
        </div>
        <div class="rounded-lg bg-surface-50 p-3 font-mono text-xs dark:bg-surface-800">
          <div>Логин: <strong>{{ createdCredentials.email }}</strong></div>
          <div class="mt-1">
            Временный пароль: <strong>{{ createdCredentials.temporaryPassword }}</strong>
          </div>
        </div>
        <div class="flex gap-2">
          <UiButton variant="secondary" @click="copyCredentials">
            <Check v-if="copied" class="size-4 text-success-600" />
            <Copy v-else class="size-4" />
            <span class="ml-1.5">{{ copied ? 'Скопировано' : 'Скопировать' }}</span>
          </UiButton>
          <UiButton variant="ghost" @click="closeInvite">
            Закрыть
          </UiButton>
        </div>
      </div>
    </UiModal>
  </section>
</template>
