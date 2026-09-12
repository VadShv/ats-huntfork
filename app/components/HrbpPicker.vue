<script setup lang="ts">
import { UserCog, Check, Loader2 } from 'lucide-vue-next'

/**
 * HRBP assignment picker for a company/department card (RBAC v2 §1).
 * Multi-select of org members; save replaces the HRBP set for this target and
 * the server bumps affected members' permissions_version. Owner/admin only
 * (the parent org-structure page already gates on company:update).
 */
interface LiteMember { memberId: string; userId: string; name: string; email: string; role: string }
interface Hrbp { memberId: string; userId: string; name: string }

const props = defineProps<{
  targetType: 'company' | 'department'
  targetId: string
  current: Hrbp[]
}>()
const emit = defineEmits<{ saved: [] }>()

const toast = useToast()
const open = ref(false)

// Lite member list (loaded lazily when opened).
const { data: membersData, execute: loadMembers, status } = await useFetch<LiteMember[]>('/api/access/members-lite', {
  key: 'access-members-lite',
  immediate: false,
})
const members = computed(() => membersData.value ?? [])

const selected = ref<Set<string>>(new Set(props.current.map((h) => h.memberId)))
watch(() => props.current, (c) => { selected.value = new Set(c.map((h) => h.memberId)) })

async function toggleOpen() {
  open.value = !open.value
  if (open.value && members.value.length === 0) await loadMembers()
}

function toggle(memberId: string) {
  if (selected.value.has(memberId)) selected.value.delete(memberId)
  else selected.value.add(memberId)
  selected.value = new Set(selected.value)
}

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch('/api/access/hrbp', {
      method: 'PUT',
      body: { targetType: props.targetType, targetId: props.targetId, memberIds: [...selected.value] },
    })
    toast.success('HRBP обновлены')
    open.value = false
    emit('saved')
  }
  catch (err: unknown) {
    toast.error('Не удалось сохранить HRBP', { message: (err as { data?: { statusMessage?: string } })?.data?.statusMessage })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="relative inline-block text-left">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md border border-surface-200 bg-white px-2 py-1 text-xs text-surface-600 hover:bg-surface-50 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300 dark:hover:bg-surface-800"
      @click="toggleOpen"
    >
      <UserCog class="size-3.5" />
      HRBP{{ current.length ? `: ${current.length}` : '' }}
    </button>

    <div
      v-if="open"
      class="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-surface-200 bg-white p-2 shadow-lg dark:border-surface-800 dark:bg-surface-900"
    >
      <p class="px-1 pb-1 text-xs font-medium text-surface-500">Назначить HRBP</p>
      <div v-if="status === 'pending'" class="flex items-center justify-center py-4 text-surface-400">
        <Loader2 class="size-4 animate-spin" />
      </div>
      <ul v-else class="max-h-56 overflow-y-auto">
        <li v-for="m in members" :key="m.memberId">
          <button
            type="button"
            class="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-50 dark:hover:bg-surface-800"
            @click="toggle(m.memberId)"
          >
            <span class="min-w-0 truncate">{{ m.name }}<span class="ml-1 text-xs text-surface-400">{{ m.role }}</span></span>
            <Check v-if="selected.has(m.memberId)" class="size-4 shrink-0 text-brand-600" />
          </button>
        </li>
        <li v-if="members.length === 0" class="px-2 py-3 text-center text-xs text-surface-400">Нет участников</li>
      </ul>
      <div class="mt-2 flex justify-end gap-2 border-t border-surface-100 pt-2 dark:border-surface-800">
        <UiButton variant="ghost" size="xs" @click="open = false">Отмена</UiButton>
        <UiButton variant="primary" size="xs" :disabled="saving" @click="save">Сохранить</UiButton>
      </div>
    </div>
  </div>
</template>
