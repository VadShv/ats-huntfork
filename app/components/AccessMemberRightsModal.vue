<script setup lang="ts">
import { X, Save, Search } from 'lucide-vue-next'
import { categoryLabelRu, categoryOrder } from '~~/shared/access/categories'

/**
 * Per-user permission overrides editor (RBAC v2, Sprint 5 #4).
 * Effective access = role ⊕ overrides (deny wins). This edits the override layer
 * on top of the member's role. Server validates keys and bumps permissions_version.
 */
interface AccessMemberLite {
  memberId: string
  name: string | null
  email: string | null
  role: { key: string | null; name: string | null }
}
interface PermissionRow {
  key: string
  resource: string
  action: string
  fieldSet: string | null
  riskLevel: number
  category: string
  labelRu: string
}
interface OverrideRow { permission: string; effect: 'allow' | 'deny'; reason?: string | null; expiresAt?: string | null }

const props = defineProps<{ member: AccessMemberLite }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const toast = useToast()

const { data: catalog } = await useFetch<PermissionRow[]>('/api/access/permissions', { key: 'access-perm-catalog' })
const { data: existing } = await useFetch<OverrideRow[]>(`/api/access/members/${props.member.memberId}/overrides`, {
  key: `access-overrides-${props.member.memberId}`,
})

// permission key → 'allow' | 'deny' | '' (inherit from role)
const state = ref<Record<string, '' | 'allow' | 'deny'>>({})
watchEffect(() => {
  const s: Record<string, '' | 'allow' | 'deny'> = {}
  for (const o of existing.value ?? []) s[o.permission] = o.effect
  state.value = s
})

const filterText = ref('')

// Group by category, apply optional text filter, and order sections meaningfully.
const sections = computed(() => {
  const q = filterText.value.trim().toLowerCase()
  const by: Record<string, PermissionRow[]> = {}
  for (const p of catalog.value ?? []) {
    if (q && !(p.labelRu.toLowerCase().includes(q) || p.key.toLowerCase().includes(q))) continue
    ;(by[p.category] ??= []).push(p)
  }
  return Object.entries(by)
    .map(([key, perms]) => ({ key, labelRu: categoryLabelRu(key), order: categoryOrder(key), perms }))
    .filter((s) => s.perms.length > 0)
    .sort((a, b) => a.order - b.order)
})

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    const overrides = Object.entries(state.value)
      .filter(([, v]) => v === 'allow' || v === 'deny')
      .map(([permission, effect]) => ({ permission, effect: effect as 'allow' | 'deny' }))
    await $fetch(`/api/access/members/${props.member.memberId}/overrides`, {
      method: 'PUT',
      body: { overrides },
    })
    toast.success('Индивидуальные права сохранены')
    emit('saved')
    emit('close')
  }
  catch (err: unknown) {
    toast.error('Не удалось сохранить', { message: (err as { data?: { statusMessage?: string } })?.data?.statusMessage })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
      <div class="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl dark:bg-surface-900">
        <header class="flex items-center justify-between border-b border-surface-200 px-5 py-4 dark:border-surface-800">
          <div>
            <h2 class="text-base font-semibold text-surface-900 dark:text-surface-50">Индивидуальные права</h2>
            <p class="text-xs text-surface-500">
              {{ member.name ?? member.email }} · роль: {{ member.role.name ?? member.role.key }}. Deny сильнее роли.
            </p>
          </div>
          <UiButton variant="ghost" size="sm" icon-only aria-label="Закрыть" @click="emit('close')">
            <X class="size-4" />
          </UiButton>
        </header>

        <!-- filter -->
        <div class="border-b border-surface-200 px-5 py-3 dark:border-surface-800">
          <div class="relative">
            <Search class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-surface-400" />
            <input
              v-model="filterText"
              type="text"
              placeholder="Поиск по названию права…"
              class="w-full rounded-md border border-surface-300 bg-white py-1.5 pl-8 pr-3 text-sm dark:border-surface-700 dark:bg-surface-900"
            >
          </div>
        </div>

        <div class="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p v-if="sections.length === 0" class="py-6 text-center text-sm text-surface-500">
            Ничего не найдено.
          </p>
          <section
            v-for="s in sections"
            :key="s.key"
            class="overflow-hidden rounded-lg border border-surface-200 dark:border-surface-800"
          >
            <h3 class="border-b border-surface-200 bg-surface-50 px-3 py-2 text-sm font-semibold text-surface-800 dark:border-surface-800 dark:bg-surface-800/50 dark:text-surface-100">
              {{ s.labelRu }}
            </h3>
            <ul class="divide-y divide-surface-100 dark:divide-surface-800/60">
              <li
                v-for="p in s.perms"
                :key="p.key"
                class="flex items-center justify-between gap-3 px-3 py-2 hover:bg-surface-50 dark:hover:bg-surface-800/40"
              >
                <div class="min-w-0" :title="p.key">
                  <span class="text-sm text-surface-800 dark:text-surface-200">{{ p.labelRu }}</span>
                  <span v-if="p.riskLevel >= 2" class="ml-2 rounded bg-danger-100 px-1.5 py-0.5 text-xs text-danger-700 dark:bg-danger-950 dark:text-danger-300">чувствительное</span>
                </div>
                <select
                  v-model="state[p.key]"
                  class="shrink-0 rounded-md border border-surface-300 bg-white px-2 py-1 text-xs dark:border-surface-700 dark:bg-surface-900"
                >
                  <option value="">по роли</option>
                  <option value="allow">разрешить</option>
                  <option value="deny">запретить</option>
                </select>
              </li>
            </ul>
          </section>
        </div>

        <footer class="flex items-center justify-end gap-2 border-t border-surface-200 px-5 py-3 dark:border-surface-800">
          <UiButton variant="secondary" size="sm" @click="emit('close')">Отмена</UiButton>
          <UiButton variant="primary" size="sm" :disabled="saving" @click="save">
            <Save class="size-4" />
            Сохранить
          </UiButton>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
