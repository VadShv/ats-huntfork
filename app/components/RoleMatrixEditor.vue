<script setup lang="ts">
import { Save, RotateCcw, AlertTriangle, ShieldCheck, Lock } from 'lucide-vue-next'
import {
  buildMatrixRows, keysForLevel, levelFromGrants, isExactLevel,
  MATRIX_LEVELS, type MatrixLevel, type ResourceRow,
} from '~~/shared/access/matrix'
import { buildPermissionCatalog } from '~~/shared/access/catalog'

/**
 * Role matrix editor (RBAC v2 §8.3-8.4). Resource × level grid + fine-tuning +
 * sensitive-ops + live capability preview + diff-before-save. System presets are
 * read-only (clone to edit). Server re-validates and versions every change.
 */
const props = defineProps<{ roleId: string }>()
const emit = defineEmits<{ saved: [] }>()

const toast = useToast()
const catalog = buildPermissionCatalog()
const rows = buildMatrixRows(catalog)
const catalogByKey = new Map(catalog.map((c) => [c.key, c]))

// Load the role + its current grants.
const { data: roleData, refresh } = await useFetch<{
  id: string; name: string; isSystem: boolean; editable: boolean; permissions: string[]
}>(() => `/api/access/roles/${props.roleId}`, { key: () => `role-${props.roleId}` })

const editable = computed(() => roleData.value?.editable === true)

// Working set of granted permission keys (mutable copy).
const granted = ref<Set<string>>(new Set())
const initial = ref<Set<string>>(new Set())
watch(roleData, (r) => {
  granted.value = new Set(r?.permissions ?? [])
  initial.value = new Set(r?.permissions ?? [])
}, { immediate: true })

// ── Matrix cell state ──
function currentLevel(row: ResourceRow): MatrixLevel {
  return levelFromGrants(row, granted.value)
}
function isCustom(row: ResourceRow): boolean {
  return !isExactLevel(row, granted.value)
}
function setLevel(row: ResourceRow, level: MatrixLevel) {
  if (!editable.value) return
  // Remove all of this resource's keys, then add the cumulative set for the level.
  for (const k of row.allKeys) granted.value.delete(k)
  for (const k of keysForLevel(row, level)) granted.value.add(k)
  granted.value = new Set(granted.value)
}
// Level 2 (PII) is only meaningful for resources with field-sets.
function levelEnabled(row: ResourceRow, level: MatrixLevel): boolean {
  if (level === 2) return row.hasPii
  return true
}

// ── Fine-tuning: individual permission toggles ──
const showFineTune = ref(false)
function toggleKey(key: string) {
  if (!editable.value) return
  if (granted.value.has(key)) granted.value.delete(key)
  else granted.value.add(key)
  granted.value = new Set(granted.value)
}

// ── Sensitive operations (risk >= 2, or delete/export) ──
const sensitiveKeys = computed(() =>
  catalog.filter((c) => c.riskLevel >= 2 || c.action === 'delete' || c.action === 'export'),
)

// ── Live preview (capability-based) ──
const canList = computed(() => {
  const c: string[] = []
  if (granted.value.has('candidate:read:contacts')) c.push('видит контакты кандидатов')
  if (granted.value.has('candidate:read:salary')) c.push('видит зарплатные ожидания')
  if (granted.value.has('application:update')) c.push('двигает по этапам')
  if (granted.value.has('interview:create')) c.push('создаёт интервью')
  if (granted.value.has('hiringManager:create')) c.push('добавляет НМ')
  if (granted.value.has('emailTemplate:create')) c.push('шаблоны писем')
  return c
})
const cannotList = computed(() => {
  const c: string[] = []
  if (!granted.value.has('candidate:read:contacts')) c.push('контакты скрыты')
  if (!granted.value.has('candidate:read:salary')) c.push('зарплаты скрыты')
  if (!granted.value.has('candidate:delete')) c.push('не удаляет кандидатов')
  if (!granted.value.has('scoring:read')) c.push('без ИИ/ассистента')
  if (!granted.value.has('activityLog:read')) c.push('без журнала')
  return c
})

// ── Diff before save ──
const added = computed(() => [...granted.value].filter((k) => !initial.value.has(k)))
const removed = computed(() => [...initial.value].filter((k) => !granted.value.has(k)))
const isDirty = computed(() => added.value.length > 0 || removed.value.length > 0)
function label(key: string): string { return catalogByKey.get(key)?.labelRu ?? key }
function isSensitive(key: string): boolean {
  const e = catalogByKey.get(key); return !!e && (e.riskLevel >= 2 || e.action === 'delete' || e.action === 'export')
}

const showDiff = ref(false)
const affected = ref<{ count: number; members: { name: string }[] } | null>(null)
async function openDiff() {
  try {
    affected.value = await $fetch(`/api/access/roles/${props.roleId}/affected`)
  }
  catch { affected.value = null }
  showDiff.value = true
}

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch(`/api/access/roles/${props.roleId}/permissions`, {
      method: 'PUT',
      body: { permissions: [...granted.value] },
    })
    toast.success('Права роли сохранены')
    showDiff.value = false
    await refresh()
    initial.value = new Set(granted.value)
    emit('saved')
  }
  catch (err: unknown) {
    toast.error('Не удалось сохранить', { message: (err as { data?: { statusMessage?: string } })?.data?.statusMessage })
  }
  finally {
    saving.value = false
  }
}
function reset() {
  granted.value = new Set(initial.value)
}
</script>

<template>
  <div>
    <div v-if="!editable" class="mb-4 flex items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-600 dark:border-surface-800 dark:bg-surface-800/50 dark:text-surface-300">
      <Lock class="size-4 shrink-0" />
      Системная роль — только просмотр. Чтобы настроить права, склонируйте её в свою роль.
    </div>

    <div class="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <!-- Matrix -->
      <div class="overflow-hidden rounded-lg border border-surface-200 dark:border-surface-800">
        <table class="w-full text-sm">
          <thead class="bg-surface-50 dark:bg-surface-800/50">
            <tr>
              <th class="px-3 py-2 text-left font-medium text-surface-500">Блок</th>
              <th v-for="lvl in MATRIX_LEVELS" :key="lvl.value" class="px-2 py-2 text-center font-medium text-surface-500">{{ lvl.labelRu }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-100 dark:divide-surface-800">
            <tr v-for="row in rows" :key="row.resource">
              <td class="px-3 py-2">
                <div class="text-surface-800 dark:text-surface-200">{{ row.categoryLabelRu }}</div>
                <div class="text-xs text-surface-400">{{ row.resource }}<span v-if="isCustom(row)" class="ml-1 text-warning-600">• точечно</span></div>
              </td>
              <td v-for="lvl in MATRIX_LEVELS" :key="lvl.value" class="px-2 py-2 text-center">
                <button
                  type="button"
                  :disabled="!editable || !levelEnabled(row, lvl.value)"
                  class="inline-flex size-6 items-center justify-center rounded-full border text-xs transition-colors"
                  :class="[
                    currentLevel(row) === lvl.value && !isCustom(row)
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-surface-300 text-transparent hover:border-brand-400 dark:border-surface-600',
                    (!editable || !levelEnabled(row, lvl.value)) ? 'opacity-30 cursor-not-allowed' : '',
                  ]"
                  @click="setLevel(row, lvl.value)"
                >
                  ●
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Live preview -->
      <aside class="rounded-lg border border-surface-200 bg-surface-50 p-4 text-sm dark:border-surface-800 dark:bg-surface-800/40">
        <h4 class="mb-2 flex items-center gap-1.5 font-semibold text-surface-700 dark:text-surface-200"><ShieldCheck class="size-4" />Что сможет роль</h4>
        <ul class="mb-3 space-y-1 text-surface-600 dark:text-surface-300">
          <li v-for="c in canList" :key="c" class="flex gap-1.5"><span class="text-success-600">✓</span>{{ c }}</li>
          <li v-if="canList.length === 0" class="text-surface-400">—</li>
        </ul>
        <h4 class="mb-2 font-semibold text-surface-700 dark:text-surface-200">Не сможет</h4>
        <ul class="space-y-1 text-surface-500">
          <li v-for="c in cannotList" :key="c" class="flex gap-1.5"><span class="text-surface-400">✗</span>{{ c }}</li>
        </ul>
      </aside>
    </div>

    <!-- Fine-tuning -->
    <div class="mt-4">
      <button type="button" class="text-sm text-brand-600 hover:underline" @click="showFineTune = !showFineTune">
        {{ showFineTune ? 'Скрыть тонкую настройку' : 'Тонкая настройка (отдельные права)' }}
      </button>
      <div v-if="showFineTune" class="mt-2 rounded-lg border border-surface-200 p-3 dark:border-surface-800">
        <!-- Sensitive operations block -->
        <p class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-danger-600"><AlertTriangle class="size-3.5" />Чувствительные операции</p>
        <ul class="mb-3 space-y-1">
          <li v-for="p in sensitiveKeys" :key="p.key" class="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-danger-50/50 dark:hover:bg-danger-950/20">
            <span class="text-sm text-surface-700 dark:text-surface-200" :title="p.key">{{ p.labelRu }}</span>
            <label class="inline-flex cursor-pointer items-center">
              <input type="checkbox" :checked="granted.has(p.key)" :disabled="!editable" class="peer sr-only" @change="toggleKey(p.key)">
              <span class="h-5 w-9 rounded-full bg-surface-300 transition-colors peer-checked:bg-danger-500 dark:bg-surface-700" />
            </label>
          </li>
        </ul>
      </div>
    </div>

    <!-- Actions -->
    <div v-if="editable" class="mt-4 flex items-center justify-end gap-2">
      <UiButton v-if="isDirty" variant="ghost" size="sm" @click="reset"><RotateCcw class="size-4" />Сбросить</UiButton>
      <UiButton variant="primary" size="sm" :disabled="!isDirty" @click="openDiff"><Save class="size-4" />Сохранить…</UiButton>
    </div>

    <!-- Diff-before-save modal -->
    <Teleport to="body">
      <div v-if="showDiff" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="showDiff = false">
        <div class="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl dark:bg-surface-900">
          <h3 class="mb-3 text-base font-semibold text-surface-900 dark:text-surface-50">Изменения роли «{{ roleData?.name }}»</h3>
          <ul class="mb-3 max-h-56 space-y-1 overflow-y-auto text-sm">
            <li v-for="k in added" :key="`a-${k}`" class="flex items-center gap-2 text-success-700 dark:text-success-400">
              <span>+</span>{{ label(k) }}<span v-if="isSensitive(k)" class="rounded bg-danger-100 px-1 text-xs text-danger-700 dark:bg-danger-950 dark:text-danger-300">чувствительное</span>
            </li>
            <li v-for="k in removed" :key="`r-${k}`" class="flex items-center gap-2 text-danger-700 dark:text-danger-400">
              <span>−</span>{{ label(k) }}
            </li>
          </ul>
          <p v-if="affected" class="mb-4 text-sm text-surface-600 dark:text-surface-300">
            Затронуто участников: <strong>{{ affected.count }}</strong>
            <span v-if="affected.members.length"> — {{ affected.members.map(m => m.name).join(', ') }}</span>
          </p>
          <div class="flex justify-end gap-2">
            <UiButton variant="secondary" size="sm" @click="showDiff = false">Отмена</UiButton>
            <UiButton variant="primary" size="sm" :disabled="saving" @click="save">Применить</UiButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
