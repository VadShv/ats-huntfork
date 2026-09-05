<script setup lang="ts">
/**
 * JobRecruitersSection — секция «Рекрутеры» на странице настроек вакансии.
 *
 * Назначение рекрутеров (org-роли owner/admin/member) на вакансию через
 * job_member (member_role='recruiter'). Создатель вакансии назначается
 * автоматически при создании (см. POST /api/jobs).
 */
import { BriefcaseBusiness, Trash2, Loader2, Star } from 'lucide-vue-next'

interface Props {
  jobId: string
}
const props = defineProps<Props>()

interface OrgRecruiter {
  userId: string
  name: string | null
  email: string
  role: string
  status: string
  createdAt: string | Date
}

interface JobMember {
  id: string
  userId: string
  memberRole: string
  isPrimary: boolean
  addedAt: string | Date
  addedByUserId: string | null
  userName: string | null
  userEmail: string
}

// `job:update` — кто ведёт вакансию (owner/admin и рекрутеры role=member).
const { allowed: canManage } = usePermission({ job: ['update'] })
const toast = useToast()

const ROLE_LABELS: Record<string, string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  member: 'Рекрутер',
}

// ─── Назначенные на вакансию рекрутеры ───
const assigned = ref<JobMember[]>([])
const isLoadingAssigned = ref(false)
const assignedError = ref('')

async function fetchAssigned() {
  isLoadingAssigned.value = true
  assignedError.value = ''
  try {
    const res = await $fetch<{ members: JobMember[] }>(`/api/jobs/${props.jobId}/members`)
    assigned.value = (res.members ?? [])
      .filter(m => m.memberRole === 'recruiter')
      // Основной рекрутер — первым в списке.
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
  }
  catch (err: any) {
    assignedError.value = err?.data?.statusMessage ?? err?.message ?? 'Не удалось загрузить'
  }
  finally {
    isLoadingAssigned.value = false
  }
}

// ─── Все потенциальные рекрутеры организации (owner/admin/member) ───
const orgRecruiters = ref<OrgRecruiter[]>([])
const isLoadingOrg = ref(false)

async function fetchOrgRecruiters() {
  isLoadingOrg.value = true
  try {
    const res = await $fetch<{ recruiters: OrgRecruiter[] }>('/api/recruiters')
    orgRecruiters.value = res.recruiters ?? []
  }
  catch {
    // тихо — селект просто не покажет опций
  }
  finally {
    isLoadingOrg.value = false
  }
}

const availableToAdd = computed(() => {
  const assignedIds = new Set(assigned.value.map(a => a.userId))
  return orgRecruiters.value.filter(r => r.status === 'active' && !assignedIds.has(r.userId))
})

const availableToAddOptions = computed(() =>
  availableToAdd.value.map((r) => {
    const base = r.name ? `${r.name} (${r.email})` : r.email
    const roleLabel = ROLE_LABELS[r.role] ?? r.role
    return { label: `${base} — ${roleLabel}`, value: r.userId }
  }),
)

const selectPlaceholder = computed(() => {
  if (availableToAdd.value.length === 0) {
    return orgRecruiters.value.length > 0 ? 'Все рекрутеры уже назначены' : 'Нет рекрутеров в организации'
  }
  return '— выберите рекрутера —'
})

// ─── Добавить рекрутера ───
const selectedUserId = ref('')
const isAdding = ref(false)

async function addExisting() {
  if (!selectedUserId.value) return
  isAdding.value = true
  try {
    await $fetch(`/api/jobs/${props.jobId}/members`, {
      method: 'POST',
      body: { userId: selectedUserId.value, memberRole: 'recruiter' },
    })
    toast.success('Рекрутер назначен на вакансию')
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

// ─── Сделать рекрутера основным ───
async function makePrimary(userId: string) {
  try {
    await $fetch(`/api/jobs/${props.jobId}/members/${userId}/primary`, { method: 'PATCH' })
    toast.success('Назначен основной рекрутер')
    await fetchAssigned()
  }
  catch (err: any) {
    const msg = err?.data?.statusMessage ?? err?.message ?? 'Не удалось назначить'
    toast.error('Ошибка', { message: String(msg) })
  }
}

// ─── Убрать рекрутера с вакансии ───
async function removeMember(userId: string) {
  try {
    await $fetch(`/api/jobs/${props.jobId}/members/${userId}?memberRole=recruiter`, { method: 'DELETE' })
    toast.success('Рекрутер убран с вакансии')
    await fetchAssigned()
  }
  catch (err: any) {
    const msg = err?.data?.statusMessage ?? err?.message ?? 'Не удалось убрать'
    toast.error('Ошибка', { message: String(msg) })
  }
}

onMounted(() => {
  fetchAssigned()
  fetchOrgRecruiters()
})
</script>

<template>
  <section class="rounded-xl border border-surface-200 bg-white p-6 dark:border-surface-800 dark:bg-surface-900">
    <div class="mb-5">
      <h2 class="flex items-center gap-2 text-base font-semibold text-surface-900 dark:text-surface-100">
        <BriefcaseBusiness class="size-4 text-surface-500" />
        Рекрутеры
      </h2>
      <p class="mt-1 text-xs text-surface-500 dark:text-surface-400">
        Кто ведёт эту вакансию: работа с кандидатами, этапами воронки и коммуникациями.
        Создатель вакансии назначается автоматически. Может быть несколько рекрутеров —
        один основной (по нему считается статистика «вакансий в работе») и дополнительные.
      </p>
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
      <li v-for="m in assigned" :key="m.userId" class="flex items-center justify-between gap-2 py-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm font-medium text-surface-900 dark:text-surface-100">
              {{ m.userName || m.userEmail }}
            </span>
            <span
              v-if="m.isPrimary"
              class="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
            >
              <Star class="size-3 fill-current" /> Основной
            </span>
          </div>
          <div class="mt-0.5 truncate text-xs text-surface-500 dark:text-surface-400">
            {{ m.userEmail }}
          </div>
        </div>
        <button
          v-if="canManage && !m.isPrimary"
          type="button"
          class="inline-flex items-center gap-1 rounded-lg border border-surface-200 px-2 py-1 text-xs text-surface-600 hover:border-brand-400 hover:text-brand-600 dark:border-surface-700 dark:text-surface-300"
          @click="makePrimary(m.userId)"
        >
          <Star class="size-3" /> Сделать основным
        </button>
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
      Ни один рекрутер пока не назначен
    </div>

    <!-- Add recruiter — панель видна всегда; сервер проверит права job:update при POST. -->
    <div class="mt-4">
      <label class="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">
        Назначить рекрутера
      </label>

      <div v-if="isLoadingOrg" class="flex items-center gap-2 text-sm text-surface-500">
        <Loader2 class="size-4 animate-spin" /> Загружаем список…
      </div>

      <div v-else class="flex items-end gap-2">
        <div class="flex-1">
          <UiSelect
            v-model="selectedUserId"
            :placeholder="selectPlaceholder"
            :options="availableToAddOptions"
            :disabled="availableToAdd.length === 0"
          />
        </div>
        <UiButton
          :disabled="!selectedUserId || isAdding || availableToAdd.length === 0"
          :loading="isAdding"
          @click="addExisting"
        >
          Добавить
        </UiButton>
      </div>

      <p
        v-if="!isLoadingOrg && availableToAdd.length === 0"
        class="mt-2 text-xs text-surface-500 dark:text-surface-400"
      >
        <template v-if="orgRecruiters.length > 0">
          Все активные рекрутеры организации уже назначены на эту вакансию.
        </template>
        <template v-else>
          В организации пока нет участников с ролью рекрутера.
          <NuxtLink
            to="/dashboard/settings/members"
            class="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 underline underline-offset-2"
          >
            Пригласите участников
          </NuxtLink>
          в разделе «Участники».
        </template>
      </p>
    </div>
  </section>
</template>
