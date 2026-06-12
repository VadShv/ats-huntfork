<script setup lang="ts">
import { Upload, FileText, AlertTriangle, CheckCircle2, GitMerge, X, Loader2, Plus } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({ title: 'Импорт кандидатов' })

const toast = useToast()

// ── Состояние выбора файла и превью ──────────────────────────────────────────
interface ParsedRow {
  rowNumber: number
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  dateOfBirth: string | null
  city: string | null
  linkedin: string | null
  telegram: string | null
  github: string | null
  raw: Record<string, string>
  errors: string[]
}

interface DupExact {
  candidateId: string
  kind: 'email' | 'phone'
  firstName: string | null
  lastName: string | null
  organizationId: string
}
interface DupFuzzy {
  candidateId: string
  score: number
  firstName: string | null
  lastName: string | null
  organizationId: string
}

interface PreviewRow {
  row: ParsedRow
  duplicates: { exact: DupExact[]; fuzzy: DupFuzzy[] }
  suggestedAction: 'create' | 'merge_into' | 'skip'
  suggestedMergeTargetId?: string
  // local UI state
  action: 'create' | 'merge_into' | 'skip'
  mergeTargetId?: string
}

interface PreviewResponse {
  totalRows: number
  validRows: number
  rowsWithErrors: number
  exactDuplicates: number
  fuzzyDuplicates: number
  rows: PreviewRow[]
}

const selectedFile = ref<File | null>(null)
const isDragOver = ref(false)
const isUploading = ref(false)
const isCommitting = ref(false)
const preview = ref<PreviewResponse | null>(null)

function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    selectedFile.value = target.files[0] ?? null
    preview.value = null
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    const f = files[0]
    if (!f) return
    const ext = f.name.toLowerCase().split('.').pop()
    if (ext !== 'csv' && ext !== 'xlsx' && ext !== 'xls') {
      toast.error?.('Неверный формат', { message: 'Поддерживаются только .csv и .xlsx файлы' })
      return
    }
    selectedFile.value = f
    preview.value = null
  }
}

function clearFile() {
  selectedFile.value = null
  preview.value = null
}

async function uploadPreview() {
  if (!selectedFile.value) return
  isUploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', selectedFile.value)
    const data = await $fetch<PreviewResponse>('/api/candidates/import/preview', {
      method: 'POST',
      body: formData,
    })
    // Применяем suggestedAction по умолчанию + локальное состояние
    preview.value = {
      ...data,
      rows: data.rows.map(r => ({
        ...r,
        action: r.suggestedAction,
        mergeTargetId: r.suggestedMergeTargetId,
      })),
    }
    toast.success?.(`Файл проверен: ${data.totalRows} строк, ${data.exactDuplicates} точных, ${data.fuzzyDuplicates} похожих`)
  }
  catch (err: any) {
    const msg = err?.data?.statusMessage ?? err?.statusMessage ?? err?.message ?? 'Не удалось проверить файл'
    toast.error?.('Ошибка', { message: String(msg) })
  }
  finally {
    isUploading.value = false
  }
}

// ── Подсчёт решений ──────────────────────────────────────────────────────────
const stats = computed(() => {
  if (!preview.value) return { create: 0, merge: 0, skip: 0 }
  let create = 0; let merge = 0; let skip = 0
  for (const r of preview.value.rows) {
    if (r.action === 'create') create++
    else if (r.action === 'merge_into') merge++
    else skip++
  }
  return { create, merge, skip }
})

async function commit() {
  if (!preview.value) return
  if (stats.value.create === 0 && stats.value.merge === 0) {
    toast.error?.('Нечего импортировать', { message: 'Все строки помечены как «пропустить»' })
    return
  }
  isCommitting.value = true
  try {
    const decisions = preview.value.rows.map((r) => {
      if (r.action === 'skip' || r.row.errors.length > 0) {
        return { rowNumber: r.row.rowNumber, action: 'skip' as const }
      }
      const candidateData = {
        firstName: r.row.firstName ?? '',
        lastName: r.row.lastName ?? '',
        email: r.row.email,
        phone: r.row.phone,
        dateOfBirth: r.row.dateOfBirth,
        city: r.row.city,
        linkedin: r.row.linkedin,
        telegram: r.row.telegram,
        github: r.row.github,
      }
      if (r.action === 'create') {
        return { rowNumber: r.row.rowNumber, action: 'create' as const, candidateData }
      }
      return {
        rowNumber: r.row.rowNumber,
        action: 'merge_into' as const,
        mergeTargetId: r.mergeTargetId ?? r.suggestedMergeTargetId!,
        candidateData,
      }
    })
    const res = await $fetch<{
      ok: boolean
      totalRequested: number
      totalCreated: number
      totalMerged: number
      totalSkipped: number
      totalFailed: number
    }>('/api/candidates/import/commit', {
      method: 'POST',
      body: { decisions },
    })
    const summary = `Создано: ${res.totalCreated}, дополнено: ${res.totalMerged}, пропущено: ${res.totalSkipped}, ошибок: ${res.totalFailed}`
    if (res.ok) {
      toast.success?.(`Импорт завершён: ${summary}`)
    }
    else {
      toast.error?.('Импорт завершён с ошибками', { message: summary })
    }
    // Сброс
    selectedFile.value = null
    preview.value = null
  }
  catch (err: any) {
    const msg = err?.data?.statusMessage ?? err?.statusMessage ?? err?.message ?? 'Не удалось завершить импорт'
    toast.error?.('Ошибка', { message: String(msg) })
  }
  finally {
    isCommitting.value = false
  }
}

function fullName(c: { firstName: string | null; lastName: string | null }): string {
  return [c.lastName, c.firstName].filter(Boolean).join(' ') || '(без имени)'
}
</script>

<template>
  <div class="mx-auto max-w-[1400px] px-4 py-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <Upload class="size-6 text-brand-600" />
        <div>
          <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-50">
            Импорт кандидатов
          </h1>
          <p class="text-sm text-surface-500 dark:text-surface-400">
            Загрузите CSV или XLSX (до 5 МБ, до 500 строк) — система найдёт дубли и предложит действия
          </p>
        </div>
      </div>
    </div>

    <!-- Загрузка файла -->
    <div
      v-if="!preview"
      class="rounded-lg border-2 border-dashed transition-colors p-12 text-center"
      :class="isDragOver
        ? 'border-brand-500 bg-brand-50/40 dark:bg-brand-950/30'
        : 'border-surface-300 dark:border-surface-700'"
      @dragover.prevent="isDragOver = true"
      @dragleave.prevent="isDragOver = false"
      @drop="handleDrop"
    >
      <FileText class="size-12 mx-auto mb-4 text-surface-400 dark:text-surface-600" />
      <div v-if="selectedFile" class="space-y-3">
        <p class="text-sm font-medium text-surface-700 dark:text-surface-300">
          {{ selectedFile.name }}
          <span class="text-xs text-surface-500">({{ (selectedFile.size / 1024).toFixed(1) }} КБ)</span>
        </p>
        <div class="flex items-center justify-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-surface-300 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800"
            :disabled="isUploading"
            @click="clearFile"
          >
            <X class="size-3.5" /> Убрать
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
            :disabled="isUploading"
            @click="uploadPreview"
          >
            <Loader2 v-if="isUploading" class="size-3.5 animate-spin" />
            <CheckCircle2 v-else class="size-3.5" />
            {{ isUploading ? 'Проверяем…' : 'Проверить файл' }}
          </button>
        </div>
      </div>
      <div v-else class="space-y-3">
        <p class="text-sm font-medium text-surface-700 dark:text-surface-300">
          Перетащите файл сюда или выберите вручную
        </p>
        <p class="text-xs text-surface-500 dark:text-surface-400">
          Поддерживаются .csv и .xlsx — колонки firstName/lastName/email/phone/dateOfBirth/city/linkedin/telegram/github
          (можно на русском: Имя, Фамилия, Почта, Телефон…)
        </p>
        <label class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-surface-300 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800 cursor-pointer">
          <Upload class="size-3.5" />
          Выбрать файл
          <input type="file" accept=".csv,.xlsx,.xls" class="hidden" @change="handleFileSelect" />
        </label>
      </div>
    </div>

    <!-- Превью -->
    <div v-if="preview">
      <!-- Stats bar -->
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <div class="rounded-lg border border-surface-200 dark:border-surface-800 p-3">
          <div class="text-xs text-surface-500 dark:text-surface-400">Всего строк</div>
          <div class="text-lg font-semibold text-surface-900 dark:text-surface-50">{{ preview.totalRows }}</div>
        </div>
        <div class="rounded-lg border border-surface-200 dark:border-surface-800 p-3">
          <div class="text-xs text-surface-500 dark:text-surface-400">С ошибками</div>
          <div class="text-lg font-semibold text-red-600 dark:text-red-400">{{ preview.rowsWithErrors }}</div>
        </div>
        <div class="rounded-lg border border-surface-200 dark:border-surface-800 p-3">
          <div class="text-xs text-surface-500 dark:text-surface-400">Точных дублей</div>
          <div class="text-lg font-semibold text-amber-600 dark:text-amber-400">{{ preview.exactDuplicates }}</div>
        </div>
        <div class="rounded-lg border border-surface-200 dark:border-surface-800 p-3">
          <div class="text-xs text-surface-500 dark:text-surface-400">Похожих (fuzzy)</div>
          <div class="text-lg font-semibold text-purple-600 dark:text-purple-400">{{ preview.fuzzyDuplicates }}</div>
        </div>
        <div class="rounded-lg border border-surface-200 dark:border-surface-800 p-3">
          <div class="text-xs text-surface-500 dark:text-surface-400">Готово к импорту</div>
          <div class="text-lg font-semibold text-green-600 dark:text-green-400">
            {{ stats.create + stats.merge }}
          </div>
        </div>
      </div>

      <!-- Table -->
      <div class="rounded-lg border border-surface-200 dark:border-surface-800 overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-surface-50 dark:bg-surface-900/50 text-xs text-surface-500 dark:text-surface-400">
            <tr>
              <th class="px-3 py-2 text-left font-medium">№</th>
              <th class="px-3 py-2 text-left font-medium">Кандидат</th>
              <th class="px-3 py-2 text-left font-medium">Контакты</th>
              <th class="px-3 py-2 text-left font-medium">Город / ДР</th>
              <th class="px-3 py-2 text-left font-medium">Дубль</th>
              <th class="px-3 py-2 text-left font-medium">Действие</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in preview.rows"
              :key="r.row.rowNumber"
              class="border-t border-surface-200 dark:border-surface-800"
              :class="r.row.errors.length > 0
                ? 'bg-red-50/40 dark:bg-red-950/20'
                : r.duplicates.exact.length > 0
                  ? 'bg-amber-50/30 dark:bg-amber-950/20'
                  : r.duplicates.fuzzy.length > 0
                    ? 'bg-purple-50/30 dark:bg-purple-950/20'
                    : ''"
            >
              <td class="px-3 py-2 align-top text-xs text-surface-500">{{ r.row.rowNumber }}</td>
              <td class="px-3 py-2 align-top">
                <div class="font-medium text-surface-900 dark:text-surface-50">
                  {{ fullName(r.row) }}
                </div>
                <div v-if="r.row.errors.length > 0" class="text-xs text-red-600 dark:text-red-400 mt-1">
                  <AlertTriangle class="inline size-3" /> {{ r.row.errors.join('; ') }}
                </div>
              </td>
              <td class="px-3 py-2 align-top text-xs text-surface-600 dark:text-surface-300">
                <div v-if="r.row.email">{{ r.row.email }}</div>
                <div v-if="r.row.phone">{{ r.row.phone }}</div>
                <div v-if="!r.row.email && !r.row.phone" class="text-surface-400">—</div>
              </td>
              <td class="px-3 py-2 align-top text-xs text-surface-600 dark:text-surface-300">
                <div v-if="r.row.city">{{ r.row.city }}</div>
                <div v-if="r.row.dateOfBirth">{{ r.row.dateOfBirth }}</div>
              </td>
              <td class="px-3 py-2 align-top">
                <div v-if="r.duplicates.exact.length > 0" class="space-y-1">
                  <span
                    v-for="(d, i) in r.duplicates.exact"
                    :key="i"
                    class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                  >
                    <AlertTriangle class="size-3" /> {{ d.kind }} · {{ fullName(d) }}
                  </span>
                </div>
                <div v-else-if="r.duplicates.fuzzy.length > 0" class="space-y-1">
                  <span
                    v-for="(d, i) in r.duplicates.fuzzy.slice(0, 2)"
                    :key="i"
                    class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                  >
                    <GitMerge class="size-3" /> {{ d.score }}% · {{ fullName(d) }}
                  </span>
                </div>
                <div v-else class="text-xs text-surface-400">—</div>
              </td>
              <td class="px-3 py-2 align-top">
                <select
                  v-if="r.row.errors.length === 0"
                  v-model="r.action"
                  class="text-xs rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-1 w-full max-w-[180px]"
                >
                  <option value="create">Создать нового</option>
                  <option
                    v-if="r.duplicates.exact.length > 0 || r.duplicates.fuzzy.length > 0"
                    value="merge_into"
                  >
                    Дополнить существующего
                  </option>
                  <option value="skip">Пропустить</option>
                </select>
                <span v-else class="text-xs text-red-600 dark:text-red-400">Пропуск (ошибка)</span>
                <!-- Выбор цели для merge -->
                <select
                  v-if="r.action === 'merge_into' && r.row.errors.length === 0"
                  v-model="r.mergeTargetId"
                  class="mt-1 text-xs rounded-md border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-1 w-full max-w-[180px]"
                >
                  <option
                    v-for="d in [...r.duplicates.exact, ...r.duplicates.fuzzy]"
                    :key="d.candidateId"
                    :value="d.candidateId"
                  >
                    {{ fullName(d) }}
                  </option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Sticky footer with commit -->
      <div class="sticky bottom-0 mt-6 -mx-4 px-4 py-3 bg-white dark:bg-surface-950 border-t border-surface-200 dark:border-surface-800 flex items-center justify-between">
        <div class="flex items-center gap-3 text-xs text-surface-600 dark:text-surface-400">
          <span class="inline-flex items-center gap-1">
            <Plus class="size-3 text-green-600" /> Создать: <b>{{ stats.create }}</b>
          </span>
          <span class="inline-flex items-center gap-1">
            <GitMerge class="size-3 text-amber-600" /> Дополнить: <b>{{ stats.merge }}</b>
          </span>
          <span class="inline-flex items-center gap-1">
            <X class="size-3 text-surface-400" /> Пропустить: <b>{{ stats.skip }}</b>
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-surface-300 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800"
            :disabled="isCommitting"
            @click="clearFile"
          >
            <X class="size-3.5" /> Отменить
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
            :disabled="isCommitting || (stats.create === 0 && stats.merge === 0)"
            @click="commit"
          >
            <Loader2 v-if="isCommitting" class="size-3.5 animate-spin" />
            <CheckCircle2 v-else class="size-3.5" />
            {{ isCommitting ? 'Импортируем…' : `Импортировать ${stats.create + stats.merge} решений` }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
