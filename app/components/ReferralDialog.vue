<script setup lang="ts">
/**
 * Диалог «Передать коллеге» (docs/tz-discussion-referral.md §2.1–2.2).
 *
 * Три шага в одном окне: коллега → вакансия (необязательно) → комментарий (необязательно).
 * Открывается из профиля кандидата и из обсуждения (там подставляются кандидат и текущий отклик).
 * Если вакансия выбрана — кандидат сразу добавляется на неё; иначе коллега выберет вакансию сам.
 * Карточки о передаче появляются в обсуждении, адресат получает уведомление.
 */
import { computed, ref, watch } from 'vue'
import { Check, ChevronLeft, Handshake, Loader2, Search, X, Briefcase, UserRound, AlertTriangle } from 'lucide-vue-next'

type Colleague = { userId: string, name: string | null, email: string | null, image: string | null, role: string }
type JobOption = { id: string, title: string, department: string | null, location: string | null, recruiterIds: string[], applicationId: string | null }
type ActiveReferral = { id: string, toUserId: string, suggestedJobId: string | null, status: string, createdAt: string }
type Options = { colleagues: Colleague[], jobs: JobOption[], active: ActiveReferral[] }

export interface ReferralCreated {
  id: string
  status: 'pending' | 'accepted'
  applicationId: string | null
  toUserName: string
  jobTitle: string | null
}

const props = defineProps<{
  open: boolean
  candidateId: string
  candidateName?: string | null
  /** Отклик, из обсуждения которого передаём (карточка-источник ставится в его ленту). */
  fromApplicationId?: string | null
  /** Текущая вакансия кандидата — исключаем из списка. */
  currentJobId?: string | null
}>()

const emit = defineEmits<{
  close: []
  created: [payload: ReferralCreated]
}>()

const { t, locale } = useI18n()
const toast = useToast()

const step = ref<1 | 2 | 3>(1)
const loading = ref(false)
const submitting = ref(false)
const options = ref<Options | null>(null)
const colleagueQuery = ref('')
const jobQuery = ref('')
const onlyColleagueJobs = ref(true)
const selectedUserId = ref<string | null>(null)
const selectedJobId = ref<string | null>(null)
const note = ref('')

const NOTE_MAX = 500

watch(() => props.open, async (open) => {
  if (!open) return
  step.value = 1
  selectedUserId.value = null
  selectedJobId.value = null
  note.value = ''
  colleagueQuery.value = ''
  jobQuery.value = ''
  onlyColleagueJobs.value = true
  await load()
}, { immediate: true })

async function load() {
  loading.value = true
  try {
    options.value = await $fetch<Options>('/api/referrals/options', { query: { candidateId: props.candidateId } })
  } catch (e: any) {
    toast.error(t('referral.load_failed'), { message: e?.data?.statusMessage ?? e?.message })
    emit('close')
  } finally {
    loading.value = false
  }
}

function displayName(c: Colleague): string {
  return c.name || c.email || '—'
}

function initials(c: Colleague): string {
  const n = displayName(c)
  return n.split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}

const activeByUser = computed(() => {
  const m = new Map<string, ActiveReferral>()
  for (const a of options.value?.active ?? []) m.set(a.toUserId, a)
  return m
})

const colleagues = computed(() => {
  const q = colleagueQuery.value.trim().toLowerCase()
  const list = options.value?.colleagues ?? []
  if (!q) return list
  return list.filter(c => displayName(c).toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q))
})

const selectedColleague = computed(() => options.value?.colleagues.find(c => c.userId === selectedUserId.value) ?? null)

const colleagueJobCount = computed(() => {
  if (!selectedUserId.value) return 0
  return (options.value?.jobs ?? []).filter(j => j.id !== props.currentJobId && j.recruiterIds.includes(selectedUserId.value!)).length
})

const jobs = computed(() => {
  const q = jobQuery.value.trim().toLowerCase()
  let list = (options.value?.jobs ?? []).filter(j => j.id !== props.currentJobId)
  if (onlyColleagueJobs.value && selectedUserId.value && colleagueJobCount.value > 0) {
    list = list.filter(j => j.recruiterIds.includes(selectedUserId.value!))
  }
  if (q) list = list.filter(j => j.title.toLowerCase().includes(q) || (j.department ?? '').toLowerCase().includes(q))
  return list
})

const selectedJob = computed(() => options.value?.jobs.find(j => j.id === selectedJobId.value) ?? null)

const blockedReason = computed<string | null>(() => {
  if (!selectedUserId.value) return null
  const a = activeByUser.value.get(selectedUserId.value)
  if (!a) return null
  return a.status === 'pending'
    ? t('referral.already_pending', { date: formatDate(a.createdAt) })
    : t('referral.already_accepted', { date: formatDate(a.createdAt) })
})

const canSubmit = computed(() => !!selectedUserId.value && !blockedReason.value && !submitting.value && note.value.length <= NOTE_MAX)

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale.value === 'ru' ? 'ru-RU' : 'en-US', { day: '2-digit', month: '2-digit' })
}

function pickColleague(c: Colleague) {
  selectedUserId.value = c.userId
  if (!activeByUser.value.has(c.userId)) step.value = 2
}

function pickJob(j: JobOption | null) {
  if (j?.applicationId) return
  selectedJobId.value = j?.id ?? null
  step.value = 3
}

async function submit() {
  if (!canSubmit.value || !selectedColleague.value) return
  submitting.value = true
  try {
    const res = await $fetch<{ id: string, status: 'pending' | 'accepted', applicationId: string | null }>('/api/referrals', {
      method: 'POST',
      body: {
        candidateId: props.candidateId,
        toUserId: selectedUserId.value,
        suggestedJobId: selectedJobId.value,
        note: note.value.trim() || undefined,
        fromApplicationId: props.fromApplicationId ?? undefined,
      },
    })
    const payload: ReferralCreated = {
      id: res.id,
      status: res.status,
      applicationId: res.applicationId,
      toUserName: displayName(selectedColleague.value),
      jobTitle: selectedJob.value?.title ?? null,
    }
    toast.success(
      payload.jobTitle ? t('referral.done_with_job', { name: payload.toUserName, job: payload.jobTitle }) : t('referral.done_no_job', { name: payload.toUserName }),
    )
    emit('created', payload)
    emit('close')
  } catch (e: any) {
    toast.error(t('referral.failed'), { message: e?.data?.statusMessage ?? e?.message })
  } finally {
    submitting.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); emit('close') }
}

const stepLabels = computed(() => [t('referral.step_colleague'), t('referral.step_job'), t('referral.step_note')])

const rowClass = 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-60'
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      :aria-label="t('referral.title')"
      @click.self="emit('close')"
      @keydown="onKeydown"
    >
      <div class="flex w-full max-w-lg max-h-[min(640px,92vh)] flex-col rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl">
        <!-- Шапка -->
        <div class="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div class="min-w-0">
            <h3 class="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-surface-100">
              <Handshake class="size-4 text-brand-600" />
              {{ t('referral.title') }}
            </h3>
            <p v-if="candidateName" class="mt-0.5 truncate text-xs text-surface-500 dark:text-surface-400">{{ candidateName }}</p>
          </div>
          <UiButton variant="ghost" size="sm" icon-only :icon-left="X" :aria-label="t('referral.close')" @click="emit('close')" />
        </div>

        <!-- Шаги -->
        <ol class="mx-5 mb-3 flex items-center gap-1 text-[11px]">
          <li
            v-for="(label, i) in stepLabels"
            :key="label"
            class="flex items-center gap-1"
          >
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors"
              :class="step === i + 1
                ? 'bg-brand-600 text-white'
                : (i + 1 < step ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 cursor-pointer' : 'bg-surface-100 text-surface-400 dark:bg-surface-800')"
              :disabled="i + 1 > step"
              @click="i + 1 < step && (step = (i + 1) as 1 | 2 | 3)"
            >
              <span class="font-semibold tabular-nums">{{ i + 1 }}</span>
              <span>{{ label }}</span>
              <Check v-if="i + 1 < step" class="size-3" />
            </button>
            <span v-if="i < 2" class="h-px w-3 bg-surface-200 dark:bg-surface-700" />
          </li>
        </ol>

        <!-- Тело -->
        <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-2">
          <div v-if="loading" class="flex items-center justify-center py-10 text-surface-400">
            <Loader2 class="size-5 animate-spin" />
          </div>

          <!-- Шаг 1: коллега -->
          <template v-else-if="step === 1">
            <label class="relative mb-2 block">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-surface-400" />
              <input
                v-model="colleagueQuery"
                type="search"
                :placeholder="t('referral.search_colleague')"
                class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 py-1.5 pl-8 pr-3 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
            </label>
            <p v-if="colleagues.length === 0" class="py-6 text-center text-xs text-surface-400">{{ t('referral.no_colleagues') }}</p>
            <ul v-else class="space-y-0.5">
              <li v-for="c in colleagues" :key="c.userId">
                <button
                  type="button"
                  :class="[rowClass, selectedUserId === c.userId ? 'bg-brand-50 dark:bg-brand-900/20 ring-1 ring-brand-200 dark:ring-brand-800' : '']"
                  @click="pickColleague(c)"
                >
                  <span class="flex size-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800 text-xs font-semibold text-surface-600 dark:text-surface-300">
                    <img v-if="c.image" :src="c.image" :alt="displayName(c)" class="size-full object-cover">
                    <template v-else>{{ initials(c) }}</template>
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium text-surface-900 dark:text-surface-100">{{ displayName(c) }}</span>
                    <span class="block truncate text-[11px] text-surface-400">{{ c.email }}</span>
                  </span>
                  <span
                    v-if="activeByUser.get(c.userId)"
                    class="flex-shrink-0 rounded-full bg-warning-50 dark:bg-warning-900/30 px-2 py-0.5 text-[10px] font-medium text-warning-700 dark:text-warning-300"
                  >
                    {{ activeByUser.get(c.userId)!.status === 'pending' ? t('referral.badge_pending') : t('referral.badge_accepted') }}
                  </span>
                </button>
              </li>
            </ul>
            <p v-if="blockedReason" class="mt-3 flex items-start gap-2 rounded-lg bg-warning-50 dark:bg-warning-900/20 px-3 py-2 text-xs text-warning-800 dark:text-warning-200">
              <AlertTriangle class="mt-0.5 size-3.5 flex-shrink-0" />
              {{ blockedReason }}
            </p>
          </template>

          <!-- Шаг 2: вакансия -->
          <template v-else-if="step === 2">
            <div class="mb-2 flex items-center gap-2">
              <label class="relative block flex-1">
                <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-surface-400" />
                <input
                  v-model="jobQuery"
                  type="search"
                  :placeholder="t('referral.search_job')"
                  class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 py-1.5 pl-8 pr-3 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
              </label>
              <label
                v-if="colleagueJobCount > 0"
                class="flex flex-shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-surface-600 dark:text-surface-300"
                :title="t('referral.only_colleague_jobs_hint')"
              >
                <input v-model="onlyColleagueJobs" type="checkbox" class="size-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500/30">
                {{ t('referral.only_colleague_jobs') }}
              </label>
            </div>

            <button type="button" :class="[rowClass, selectedJobId === null ? 'bg-surface-50 dark:bg-surface-800/60' : '']" @click="pickJob(null)">
              <span class="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-400">
                <UserRound class="size-4" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block font-medium text-surface-900 dark:text-surface-100">{{ t('referral.no_job') }}</span>
                <span class="block text-[11px] text-surface-400">{{ t('referral.no_job_hint') }}</span>
              </span>
            </button>
            <div class="my-1.5 h-px bg-surface-100 dark:bg-surface-800" />
            <p v-if="jobs.length === 0" class="py-6 text-center text-xs text-surface-400">{{ t('referral.no_jobs') }}</p>
            <ul v-else class="space-y-0.5">
              <li v-for="j in jobs" :key="j.id">
                <button
                  type="button"
                  :class="[rowClass, selectedJobId === j.id ? 'bg-brand-50 dark:bg-brand-900/20 ring-1 ring-brand-200 dark:ring-brand-800' : '']"
                  :disabled="!!j.applicationId"
                  :title="j.applicationId ? t('referral.job_has_application') : undefined"
                  @click="pickJob(j)"
                >
                  <span class="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-300">
                    <Briefcase class="size-4" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium text-surface-900 dark:text-surface-100">{{ j.title }}</span>
                    <span class="block truncate text-[11px] text-surface-400">
                      {{ [j.department, j.location].filter(Boolean).join(' · ') }}
                      <template v-if="selectedUserId && j.recruiterIds.includes(selectedUserId)"> · {{ t('referral.colleague_job') }}</template>
                    </span>
                  </span>
                  <span v-if="j.applicationId" class="flex-shrink-0 rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[10px] text-surface-500">
                    {{ t('referral.job_has_application') }}
                  </span>
                </button>
              </li>
            </ul>
          </template>

          <!-- Шаг 3: комментарий и итог -->
          <template v-else>
            <dl class="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-surface-50 dark:bg-surface-800/60 px-3 py-2 text-xs">
              <dt class="text-surface-400">{{ t('referral.summary_to') }}</dt>
              <dd class="font-medium text-surface-900 dark:text-surface-100">{{ selectedColleague ? displayName(selectedColleague) : '—' }}</dd>
              <dt class="text-surface-400">{{ t('referral.summary_job') }}</dt>
              <dd class="font-medium text-surface-900 dark:text-surface-100">{{ selectedJob?.title ?? t('referral.no_job') }}</dd>
            </dl>
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-300">
              {{ t('referral.note_label') }}
              <span class="font-normal text-surface-400">· {{ t('referral.optional') }}</span>
            </label>
            <textarea
              v-model="note"
              rows="4"
              :maxlength="NOTE_MAX"
              :placeholder="t('referral.note_placeholder')"
              class="mt-1 w-full resize-none rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <div class="mt-1 flex items-center justify-between text-[11px] text-surface-400">
              <span>{{ t('referral.note_internal') }}</span>
              <span class="tabular-nums">{{ note.length }}/{{ NOTE_MAX }}</span>
            </div>
            <p class="mt-3 rounded-lg bg-brand-50 dark:bg-brand-900/20 px-3 py-2 text-xs text-brand-800 dark:text-brand-200">
              {{ selectedJob ? t('referral.effect_with_job', { job: selectedJob.title }) : t('referral.effect_no_job') }}
            </p>
          </template>
        </div>

        <!-- Подвал -->
        <div class="flex items-center justify-between gap-2 border-t border-surface-100 dark:border-surface-800 px-5 py-3">
          <UiButton v-if="step > 1" variant="ghost" size="sm" :icon-left="ChevronLeft" @click="step = (step - 1) as 1 | 2 | 3">
            {{ t('referral.back') }}
          </UiButton>
          <span v-else />
          <div class="flex items-center gap-2">
            <UiButton variant="ghost" size="sm" @click="emit('close')">{{ t('common.cancel') }}</UiButton>
            <UiButton
              v-if="step === 3"
              variant="primary"
              size="sm"
              :icon-left="Handshake"
              :disabled="!canSubmit"
              :loading="submitting"
              @click="submit"
            >
              {{ t('referral.submit') }}
            </UiButton>
            <UiButton
              v-else-if="step === 2"
              variant="secondary"
              size="sm"
              @click="step = 3"
            >
              {{ t('referral.skip_job') }}
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
