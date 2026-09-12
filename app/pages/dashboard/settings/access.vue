<script setup lang="ts">
import { Shield, Eye, SlidersHorizontal, RefreshCw, Users } from 'lucide-vue-next'

definePageMeta({})

interface AccessRole { id: string | null; key: string | null; name: string }
interface AccessMember {
  memberId: string
  userId: string
  name: string | null
  email: string | null
  image: string | null
  status: string
  role: { id: string | null; key: string | null; name: string | null }
  scope: { type: string; departmentIds: string[]; jobIds: string[] }
  access: { visibleJobs: number; totalJobs: number; unrestricted: boolean; canViewContacts: boolean }
}

const toast = useToast()
const { data: session } = await authClient.useSession(useFetch)

const { data: rolesData } = await useFetch<AccessRole[]>('/api/access/roles', { key: 'access-roles' })
const roles = computed(() => rolesData.value ?? [])

const { data: membersData, pending, refresh } = await useFetch<AccessMember[]>('/api/access/members', { key: 'access-members' })
const members = computed(() => membersData.value ?? [])

const SCOPE_LABELS: Record<string, string> = {
  org: 'Вся организация',
  departments: 'Отделы (с вложенными)',
  jobs: 'Выбранные вакансии',
  assigned: 'Назначенные вакансии',
  own: 'Только свои',
}

const busyMemberId = ref<string | null>(null)

async function changeRole(m: AccessMember, roleKey: string) {
  if (!roleKey || roleKey === m.role.key) return
  busyMemberId.value = m.memberId
  try {
    await $fetch(`/api/access/members/${m.memberId}/role`, { method: 'POST', body: { roleKey } })
    toast.success('Роль обновлена', `${m.name ?? m.email}: ${roleKey}`)
    await refresh()
  }
  catch (err: unknown) {
    toast.error('Не удалось изменить роль', { message: (err as { data?: { statusMessage?: string } })?.data?.statusMessage })
  }
  finally {
    busyMemberId.value = null
  }
}

async function viewAs(m: AccessMember) {
  busyMemberId.value = m.memberId
  try {
    await $fetch('/api/access/view-as/start', { method: 'POST', body: { memberId: m.memberId } })
    if (import.meta.client) window.location.href = '/dashboard'
  }
  catch (err: unknown) {
    toast.error('Не удалось войти в просмотр', { message: (err as { data?: { statusMessage?: string } })?.data?.statusMessage })
    busyMemberId.value = null
  }
}

// ── Per-user rights modal ──
const rightsModalMember = ref<AccessMember | null>(null)
function openRights(m: AccessMember) { rightsModalMember.value = m }
function closeRights() { rightsModalMember.value = null }

function isSelf(m: AccessMember) {
  return m.userId === session.value?.user?.id
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <header class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="flex items-center gap-2 text-xl font-semibold text-surface-900 dark:text-surface-50">
          <Shield class="size-5 text-brand-600" />
          Команда и доступы
        </h1>
        <p class="mt-1 text-sm text-surface-500">
          Роли, границы данных (scope) и индивидуальные права участников.
        </p>
      </div>
      <UiButton variant="ghost" size="sm" :disabled="pending" @click="refresh">
        <RefreshCw class="size-4" :class="pending ? 'animate-spin' : ''" />
        Обновить
      </UiButton>
    </header>

    <div v-if="members.length === 0 && !pending" class="rounded-lg border border-surface-200 dark:border-surface-800 p-8 text-center text-sm text-surface-500">
      <Users class="mx-auto mb-2 size-6 opacity-50" />
      Участники не найдены.
    </div>

    <ul v-else class="space-y-2">
      <li
        v-for="m in members"
        :key="m.memberId"
        class="flex flex-col gap-3 rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <!-- identity -->
        <div class="flex min-w-0 items-center gap-3">
          <img v-if="m.image" :src="m.image" :alt="m.name ?? ''" class="size-9 rounded-full">
          <div v-else class="flex size-9 items-center justify-center rounded-full bg-brand-100 text-sm font-medium text-brand-700 dark:bg-brand-900 dark:text-brand-200">
            {{ (m.name ?? m.email ?? '?').slice(0, 1).toUpperCase() }}
          </div>
          <div class="min-w-0">
            <div class="truncate text-sm font-medium text-surface-900 dark:text-surface-50">
              {{ m.name ?? '—' }}
              <span v-if="isSelf(m)" class="text-surface-400">(вы)</span>
              <span v-if="m.status !== 'active'" class="ml-1 rounded bg-warning-100 px-1.5 py-0.5 text-xs text-warning-800 dark:bg-warning-950 dark:text-warning-200">{{ m.status }}</span>
            </div>
            <div class="truncate text-xs text-surface-500">{{ m.email }}</div>
          </div>
        </div>

        <!-- access summary "Доступ к" -->
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="rounded-full bg-surface-100 px-2 py-1 text-surface-600 dark:bg-surface-800 dark:text-surface-300">
            {{ SCOPE_LABELS[m.scope.type] ?? m.scope.type }}
          </span>
          <span class="rounded-full bg-surface-100 px-2 py-1 text-surface-600 dark:bg-surface-800 dark:text-surface-300">
            {{ m.access.unrestricted ? `все ${m.access.totalJobs} вакансий` : `${m.access.visibleJobs} из ${m.access.totalJobs} вакансий` }}
          </span>
          <span
            class="rounded-full px-2 py-1"
            :class="m.access.canViewContacts ? 'bg-info-100 text-info-700 dark:bg-info-950 dark:text-info-300' : 'bg-surface-100 text-surface-500 dark:bg-surface-800'"
          >
            {{ m.access.canViewContacts ? 'контакты видны' : 'PII скрыт' }}
          </span>
        </div>

        <!-- controls -->
        <div class="flex items-center gap-2">
          <select
            class="rounded-md border border-surface-300 bg-white px-2 py-1.5 text-sm dark:border-surface-700 dark:bg-surface-900"
            :value="m.role.key ?? ''"
            :disabled="busyMemberId === m.memberId || m.role.key === 'owner'"
            @change="changeRole(m, ($event.target as HTMLSelectElement).value)"
          >
            <option v-if="m.role.key === 'owner'" value="owner">Владелец</option>
            <option v-for="r in roles" :key="r.id ?? r.key ?? ''" :value="r.key ?? ''">{{ r.name }}</option>
          </select>

          <UiButton variant="ghost" size="sm" icon-only aria-label="Настроить права" :disabled="busyMemberId === m.memberId" @click="openRights(m)">
            <SlidersHorizontal class="size-4" />
          </UiButton>

          <UiButton
            v-if="!isSelf(m)"
            variant="secondary"
            size="sm"
            :disabled="busyMemberId === m.memberId"
            @click="viewAs(m)"
          >
            <Eye class="size-4" />
            Посмотреть как
          </UiButton>
        </div>
      </li>
    </ul>

    <AccessMemberRightsModal
      v-if="rightsModalMember"
      :member="rightsModalMember"
      @close="closeRights"
      @saved="refresh"
    />
  </div>
</template>
