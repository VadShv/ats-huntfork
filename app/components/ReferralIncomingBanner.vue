<script setup lang="ts">
/**
 * Баннер «Вам передали кандидата» в профиле кандидата (docs/tz-discussion-referral.md §2.4).
 * Показывается адресату, пока реферал ждёт ответа. Принять — кандидат ложится на вакансию
 * (предложенную или выбранную здесь), отклонить — статус уходит в карточку обсуждения.
 */
import { computed, ref, watch } from 'vue'
import { Handshake, Loader2, Check, X, Briefcase } from 'lucide-vue-next'

type Incoming = {
  id: string
  fromUserId: string
  fromName: string
  suggestedJobId: string | null
  suggestedJobTitle: string | null
  note: string | null
  createdAt: string
}
type JobOption = { id: string, title: string, applicationId: string | null }

const props = defineProps<{ candidateId: string }>()
const emit = defineEmits<{
  /** Кандидат принят — родителю стоит обновить список откликов. */
  accepted: [payload: { applicationId: string }]
}>()

const { t, locale } = useI18n()
const toast = useToast()
const localePath = useLocalePath()

const incoming = ref<Incoming[]>([])
const jobs = ref<JobOption[] | null>(null)
const chosenJob = ref<Record<string, string>>({})
const busy = ref<string | null>(null)

async function load() {
  try {
    const res = await $fetch<{ incoming: Incoming[] }>('/api/referrals', { query: { candidateId: props.candidateId } })
    incoming.value = res.incoming
    for (const r of incoming.value) if (!(r.id in chosenJob.value)) chosenJob.value[r.id] = ''
    if (incoming.value.some(r => !r.suggestedJobId) && !jobs.value) {
      const opts = await $fetch<{ jobs: JobOption[] }>('/api/referrals/options', { query: { candidateId: props.candidateId } })
      jobs.value = opts.jobs
    }
  } catch {
    incoming.value = []
  }
}

watch(() => props.candidateId, () => { void load() }, { immediate: true })

const availableJobs = computed(() => (jobs.value ?? []).filter(j => !j.applicationId))

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(locale.value === 'ru' ? 'ru-RU' : 'en-US', { day: '2-digit', month: 'short' })
}

async function respond(r: Incoming, accept: boolean) {
  const jobId = r.suggestedJobId ?? chosenJob.value[r.id]
  if (accept && !jobId) return
  busy.value = r.id
  try {
    const res = await $fetch<{ status: string, applicationId?: string }>(`/api/referrals/${r.id}/respond`, {
      method: 'POST',
      body: accept ? { accept: true, jobId } : { accept: false },
    })
    incoming.value = incoming.value.filter(x => x.id !== r.id)
    if (accept && res.applicationId) {
      toast.success(t('referral.banner_accepted'))
      emit('accepted', { applicationId: res.applicationId })
    } else {
      toast.info(t('referral.banner_declined'))
    }
  } catch (e: any) {
    toast.error(t('referral.banner_failed'), { message: e?.data?.statusMessage ?? e?.message })
  } finally {
    busy.value = null
  }
}

defineExpose({ reload: load })
</script>

<template>
  <div
    v-for="r in incoming"
    :key="r.id"
    class="rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50/70 dark:bg-brand-900/20 p-4"
  >
    <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div class="flex min-w-0 items-start gap-3">
        <span class="mt-0.5 flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
          <Handshake class="size-4" />
        </span>
        <div class="min-w-0 text-sm">
          <div class="font-semibold text-surface-900 dark:text-surface-50">
            {{ t('referral.banner_title') }}
            <span class="ml-1 text-xs font-normal text-surface-400">{{ formatDate(r.createdAt) }}</span>
          </div>
          <div class="mt-0.5 text-surface-700 dark:text-surface-200">
            <NuxtLink :to="localePath(`/dashboard/people/${r.fromUserId}`)" class="font-medium hover:underline">{{ r.fromName }}</NuxtLink>
            {{ t('referral.banner_from') }}
            <template v-if="r.suggestedJobTitle"> {{ t('referral.banner_job', { job: r.suggestedJobTitle }) }}</template>
            <span v-else class="text-surface-500"> — {{ t('referral.banner_no_job') }}</span>
          </div>
          <p v-if="r.note" class="mt-1.5 whitespace-pre-wrap break-words rounded-md bg-white/70 dark:bg-surface-900/50 px-2.5 py-1.5 text-xs text-surface-700 dark:text-surface-200">«{{ r.note }}»</p>
        </div>
      </div>
      <div class="flex flex-shrink-0 flex-col gap-2 md:items-end">
        <p v-if="!r.suggestedJobId && jobs && availableJobs.length === 0" class="text-xs text-warning-700 dark:text-warning-300">{{ t('referral.banner_no_jobs') }}</p>
        <label v-else-if="!r.suggestedJobId" class="flex items-center gap-2 text-xs text-surface-600 dark:text-surface-300">
          <Briefcase class="size-3.5 text-surface-400" />
          <select
            v-model="chosenJob[r.id]"
            class="rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-1 text-xs text-surface-900 dark:text-surface-100 focus:border-brand-500 focus:outline-none"
          >
            <option value="" disabled>{{ t('referral.banner_choose_job') }}</option>
            <option v-for="j in availableJobs" :key="j.id" :value="j.id">{{ j.title }}</option>
          </select>
        </label>
        <div class="flex items-center gap-2">
          <UiButton
            variant="primary"
            size="sm"
            :icon-left="busy === r.id ? Loader2 : Check"
            :disabled="busy !== null || (!r.suggestedJobId && !chosenJob[r.id])"
            @click="respond(r, true)"
          >
            {{ t('referral.banner_accept') }}
          </UiButton>
          <UiButton variant="ghost" size="sm" :icon-left="X" :disabled="busy !== null" @click="respond(r, false)">
            {{ t('referral.banner_decline') }}
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>
