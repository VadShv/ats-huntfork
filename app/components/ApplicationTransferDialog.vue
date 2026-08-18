<script setup lang="ts">
/**
 * Спринт 22 (todo 9): диалог «Перевести на другую вакансию».
 *
 * Кнопка-триггер + модалка (Teleport, как guard-диалоги QuickActions):
 * выбор целевой вакансии (открытые вакансии org, кроме текущей) и
 * опциональный комментарий. POST /api/applications/:id/transfer →
 * старый отклик уходит на этап «Переведён на другую вакансию»,
 * создаётся новый отклик на целевой вакансии.
 */
import { ArrowRightLeft, X, Loader2 } from 'lucide-vue-next'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'

const props = defineProps<{
  applicationId: string
  currentJobId: string
}>()

const emit = defineEmits<{
  transferred: [payload: { newApplicationId: string, targetJobTitle: string }]
}>()

const toast = useToast()
const { handlePreviewReadOnlyError } = usePreviewReadOnly()

const isOpen = ref(false)
const isSubmitting = ref(false)
const targetJobId = ref('')
const comment = ref('')

type JobOption = { id: string, title: string }
const jobs = ref<JobOption[]>([])
const isLoadingJobs = ref(false)

async function openDialog() {
  isOpen.value = true
  targetJobId.value = ''
  comment.value = ''
  if (jobs.value.length === 0) await loadJobs()
}

async function loadJobs() {
  isLoadingJobs.value = true
  try {
    const res = await $fetch<{ data: Array<{ id: string, title: string }> }>('/api/jobs', {
      query: { status: 'open', limit: 100, page: 1 },
      headers: useRequestHeaders(['cookie']),
    })
    jobs.value = (res.data ?? [])
      .filter(j => j.id !== props.currentJobId)
      .map(j => ({ id: j.id, title: j.title }))
  }
  catch {
    jobs.value = []
  }
  finally {
    isLoadingJobs.value = false
  }
}

async function submit() {
  if (!targetJobId.value || isSubmitting.value) return
  isSubmitting.value = true
  try {
    const res = await $fetch<{ newApplicationId: string, targetJobTitle: string }>(
      `/api/applications/${props.applicationId}/transfer`,
      {
        method: 'POST',
        body: { targetJobId: targetJobId.value, comment: comment.value.trim() || undefined },
        headers: useRequestHeaders(['cookie']),
      },
    )
    toast.success('Кандидат переведён', `Новый отклик на вакансии «${res.targetJobTitle}»`)
    isOpen.value = false
    emit('transferred', { newApplicationId: res.newApplicationId, targetJobTitle: res.targetJobTitle })
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    const code = err?.data?.data?.code
    if (code === 'DUPLICATE_APPLICATION') {
      toast.error('Не удалось перевести', { message: 'У кандидата уже есть отклик на выбранной вакансии' })
    }
    else if (code === 'NO_TRANSFERRED_STAGE') {
      toast.error('Не удалось перевести', { message: 'В воронке текущей вакансии нет этапа «Переведён на другую вакансию»' })
    }
    else {
      toast.error('Не удалось перевести', { message: err?.data?.statusMessage })
    }
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
    title="Перевести кандидата на другую вакансию"
    @click="openDialog"
  >
    <ArrowRightLeft class="size-3.5" />
    Перевести
  </button>

  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      @click.self="isOpen = false"
    >
      <div class="w-full max-w-md rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 shadow-xl">
        <div class="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-100">
            Перевести на другую вакансию
          </h3>
          <button
            type="button"
            class="rounded-lg p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            @click="isOpen = false"
          >
            <X class="size-4" />
          </button>
        </div>

        <div class="px-5 pb-4 space-y-3">
          <p class="text-xs text-surface-500 dark:text-surface-400">
            Текущий отклик перейдёт на этап «Переведён на другую вакансию», на целевой вакансии появится новый отклик. Отказ на hh.ru кандидату не отправляется.
          </p>

          <div>
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">Целевая вакансия</label>
            <div v-if="isLoadingJobs" class="flex items-center gap-2 text-xs text-surface-500 py-2">
              <Loader2 class="size-3.5 animate-spin" /> Загрузка вакансий…
            </div>
            <select
              v-else
              v-model="targetJobId"
              class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="" disabled>
                Выберите вакансию…
              </option>
              <option v-for="j in jobs" :key="j.id" :value="j.id">
                {{ j.title }}
              </option>
            </select>
            <p v-if="!isLoadingJobs && jobs.length === 0" class="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Нет других открытых вакансий.
            </p>
          </div>

          <div>
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">Комментарий (необязательно)</label>
            <textarea
              v-model="comment"
              rows="2"
              class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              placeholder="Почему переводим кандидата…"
            />
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 px-5 pb-4">
          <button
            type="button"
            class="rounded-lg px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            @click="isOpen = false"
          >
            Отмена
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50"
            :disabled="!targetJobId || isSubmitting"
            @click="submit"
          >
            <Loader2 v-if="isSubmitting" class="size-3.5 animate-spin" />
            <ArrowRightLeft v-else class="size-3.5" />
            Перевести
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
