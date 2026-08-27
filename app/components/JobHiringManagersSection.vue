<script setup lang="ts">
/**
 * JobHiringManagersSection — секция «Нанимающие менеджеры» на странице
 * настроек вакансии.
 *
 * Sprint 20.5: приглашения новых НМ теперь только через
 *   Настройки → Участники → «Создать ссылку-приглашение» с ролью «Нанимающий менеджер».
 * Здесь остаётся только НАЗНАЧЕНИЕ уже существующего активного НМ на текущую
 * вакансию (или снятие с неё). Ссылка «Пригласить нового» ведёт в раздел
 * участников.
 */
import { Users, UserPlus, Trash2, Loader2 } from 'lucide-vue-next'

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
  userName: string | null
  userEmail: string
}

// `job:update` — кто ведёт вакансию (owner/admin и рекрутеры role=member).
const { allowed: canManage } = usePermission({ job: ['update'] })
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

// ─── Все активные НМ в организации ───
const orgHms = ref<HmMember[]>([])
const isLoadingOrgHms = ref(false)

async function fetchOrgHms() {
  isLoadingOrgHms.value = true
  try {
    const res = await $fetch<{ hiringManagers: HmMember[] }>('/api/hiring-managers')
    orgHms.value = res.hiringManagers ?? []
  }
  catch {
    // тихо — секция «добавить существующего» просто не покажет опций
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
 
const selectPlaceholder = computed(() => {
  if (availableToAdd.value.length === 0) {
    return orgHms.value.length > 0 ? 'Все НМ уже назначены' : 'Нет НМ в организации'
  }
  return '— выберите НМ —'
})

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
      <NuxtLink
        v-if="canManage"
        to="/dashboard/settings/members"
        class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-sm font-medium text-surface-700 hover:bg-surface-50 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700"
      >
        <UserPlus class="size-4" />
        Пригласить нового
      </NuxtLink>
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
            {{ m.userName || m.userEmail }}
          </div>
          <div class="mt-0.5 truncate text-xs text-surface-500 dark:text-surface-400">
            {{ m.userEmail }}
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

    <!-- Add existing HM — панель видна всегда (всем, кто видит настройки вакансии);
         меняется только внутреннее состояние (есть опции / нет свободных / нет НМ вообще).
         Сервер всё равно проверит права на job:update при POST /api/jobs/[id]/members. -->
    <div class="mt-4">
      <label class="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">
        Добавить существующего НМ
      </label>

      <div v-if="isLoadingOrgHms" class="flex items-center gap-2 text-sm text-surface-500">
        <Loader2 class="size-4 animate-spin" /> Загружаем список…
      </div>

      <!-- Форма добавления видна всегда: при отсутствии свободных НМ селект/кнопка блокируются,
           а состояние поясняется helper-текстом ниже. Плашка не исчезает после добавления. -->
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

      <!-- Helper: пояснение состояния, когда добавить некого -->
      <p
        v-if="!isLoadingOrgHms && availableToAdd.length === 0"
        class="mt-2 text-xs text-surface-500 dark:text-surface-400"
      >
        <template v-if="orgHms.length > 0">
          Все активные НМ организации уже назначены на эту вакансию.
        </template>
        <template v-else>
          В организации пока нет нанимающих менеджеров.
          <NuxtLink
            to="/dashboard/settings/members"
            class="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 underline underline-offset-2"
          >
            Создайте ссылку-приглашение
          </NuxtLink>
          с ролью «Нанимающий менеджер».
        </template>
      </p>
    </div>
  </section>
</template>
