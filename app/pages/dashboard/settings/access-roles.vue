<script setup lang="ts">
import { ShieldCheck, Plus, Copy, Trash2, Lock } from 'lucide-vue-next'

definePageMeta({})

interface RoleRow {
  id: string; key: string | null; name: string; description: string | null
  isSystem: boolean; defaultScope: string; memberCount: number; editable: boolean
}

const toast = useToast()
const confirm = useConfirm()

// §6 gate: owner/admin only.
const { allowed: canManage, isLoading: permLoading } = usePermission({ member: ['update'] })

const { data: rolesData, refresh, execute: loadRoles } = await useFetch<RoleRow[]>('/api/access/roles/catalog', {
  key: 'access-roles-catalog', immediate: false,
})
const roles = computed(() => rolesData.value ?? [])
watch(canManage, (ok) => { if (ok) loadRoles() }, { immediate: true })

const selectedId = ref<string | null>(null)
watch(roles, (list) => {
  if (!selectedId.value && list.length) selectedId.value = list[0].id
})
const selected = computed(() => roles.value.find((r) => r.id === selectedId.value) ?? null)

// ── Clone ──
const cloning = ref(false)
async function clone(source: RoleRow) {
  const name = window.prompt(`Название новой роли (клон «${source.name}»):`, `${source.name} (копия)`)
  if (!name) return
  cloning.value = true
  try {
    const res = await $fetch<{ id: string }>('/api/access/roles', {
      method: 'POST',
      body: { name, cloneFromKey: source.key ?? undefined },
    })
    toast.success('Роль создана')
    await refresh()
    selectedId.value = res.id
  }
  catch (err: unknown) {
    toast.error('Не удалось клонировать', { message: (err as { data?: { statusMessage?: string } })?.data?.statusMessage })
  }
  finally { cloning.value = false }
}

async function removeRole(r: RoleRow) {
  const ok = await confirm.ask({ title: 'Удалить роль?', message: `Роль «${r.name}» будет удалена.`, confirmLabel: 'Удалить', variant: 'danger' })
  if (!ok) return
  try {
    await $fetch(`/api/access/roles/${r.id}`, { method: 'DELETE' })
    toast.success('Роль удалена')
    if (selectedId.value === r.id) selectedId.value = null
    await refresh()
  }
  catch (err: unknown) {
    toast.error('Не удалось удалить', { message: (err as { data?: { statusMessage?: string } })?.data?.statusMessage })
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <header class="mb-6">
      <h1 class="flex items-center gap-2 text-xl font-semibold text-surface-900 dark:text-surface-50">
        <ShieldCheck class="size-5 text-brand-600" />
        Роли и права
      </h1>
      <p class="mt-1 text-sm text-surface-500">
        Настройка прав ролей матрицей. Системные пресеты — только просмотр; клонируйте, чтобы настроить.
      </p>
    </header>

    <AccessDeniedBanner
      v-if="!canManage && !permLoading"
      message="Управление ролями доступно только владельцу и администратору."
    />

    <div v-else class="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <!-- Role list -->
      <aside class="space-y-1">
        <button
          v-for="r in roles"
          :key="r.id"
          class="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
          :class="selectedId === r.id
            ? 'border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/40'
            : 'border-surface-200 hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800/50'"
          @click="selectedId = r.id"
        >
          <span class="min-w-0">
            <span class="block truncate font-medium text-surface-800 dark:text-surface-100">{{ r.name }}</span>
            <span class="block text-xs text-surface-400">{{ r.memberCount }} участн.{{ r.isSystem ? ' · системная' : '' }}</span>
          </span>
          <Lock v-if="!r.editable" class="size-3.5 shrink-0 text-surface-400" />
        </button>
      </aside>

      <!-- Editor -->
      <section v-if="selected">
        <div class="mb-4 flex items-center justify-between gap-2">
          <div>
            <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-50">{{ selected.name }}</h2>
            <p v-if="selected.description" class="text-sm text-surface-500">{{ selected.description }}</p>
          </div>
          <div class="flex items-center gap-2">
            <UiButton variant="secondary" size="sm" :disabled="cloning" @click="clone(selected)">
              <Copy class="size-4" />Клонировать
            </UiButton>
            <UiButton v-if="selected.editable" variant="ghost" size="sm" @click="removeRole(selected)">
              <Trash2 class="size-4" />
            </UiButton>
          </div>
        </div>

        <RoleMatrixEditor :key="selected.id" :role-id="selected.id" @saved="refresh" />
      </section>
    </div>
  </div>
</template>
