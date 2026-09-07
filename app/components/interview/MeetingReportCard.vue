<script setup lang="ts">
import { Video, Loader2, Link2, ExternalLink, ChevronDown, ChevronUp, RefreshCcw } from 'lucide-vue-next'
import type { MymeetMeeting } from '~/composables/useMymeet'

const props = defineProps<{ interviewId: string }>()

const { t } = useI18n()
const toast = useToast()
const { status: mymeetStatus } = useMymeet()
const { report, status, refresh, importMeeting } = useInterviewMeetingReport(() => props.interviewId)
const { allowed: canEdit } = usePermission({ interview: ['update'] })
const { listMeetings } = useMymeet()

const dialogOpen = ref(false)
const meetings = ref<MymeetMeeting[]>([])
const loadingMeetings = ref(false)
const transcriptOpen = ref(false)

async function openDialog() {
  dialogOpen.value = true
  loadingMeetings.value = true
  try {
    const res = await listMeetings()
    meetings.value = res.meetings
  }
  catch (err: any) {
    toast.error(t('interview.mymeet.listError'), { message: err?.data?.statusMessage })
    dialogOpen.value = false
  }
  finally { loadingMeetings.value = false }
}

const importing = ref(false)
async function pick(m: MymeetMeeting) {
  importing.value = true
  try {
    await importMeeting(m.id, m.title ?? undefined)
    dialogOpen.value = false
    toast.success(t('interview.mymeet.importing'))
    // Poll for completion.
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 3000))
      await refresh()
      if (report.value?.status === 'completed' || report.value?.status === 'failed') break
    }
  }
  catch (err: any) {
    toast.error(t('interview.mymeet.importError'), { message: err?.data?.statusMessage })
  }
  finally { importing.value = false }
}

function fmtDuration(sec: number | null): string {
  if (!sec) return ''
  const m = Math.round(sec / 60)
  return `${m} ${t('interview.mymeet.min')}`
}
</script>

<template>
  <div class="rounded-lg border border-surface-200 bg-white p-5 dark:border-surface-800 dark:bg-surface-900">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="inline-flex items-center gap-1.5 text-sm font-semibold text-surface-700 dark:text-surface-200">
        <Video class="size-4 text-brand-600" /> {{ t('interview.mymeet.title') }}
      </h2>
      <button
        v-if="canEdit && mymeetStatus.connected"
        type="button"
        class="inline-flex items-center gap-1 rounded-lg border border-surface-200 px-2.5 py-1 text-xs text-surface-600 hover:bg-surface-50 dark:border-surface-700 dark:hover:bg-surface-800"
        @click="openDialog"
      >
        <Link2 class="size-3.5" /> {{ report ? t('interview.mymeet.relink') : t('interview.mymeet.link') }}
      </button>
    </div>

    <p v-if="!mymeetStatus.connected" class="text-xs text-surface-500 dark:text-surface-400">
      {{ t('interview.mymeet.notConnected') }}
    </p>

    <template v-else>
      <div v-if="status === 'pending'" class="py-4 text-center text-sm text-surface-400">…</div>
      <p v-else-if="!report" class="text-xs text-surface-500 dark:text-surface-400">
        {{ t('interview.mymeet.empty') }}
      </p>

      <div v-else-if="report.status === 'importing'" class="inline-flex items-center gap-1.5 text-sm text-surface-500">
        <Loader2 class="size-4 animate-spin" /> {{ t('interview.mymeet.importing') }}
        <button type="button" class="ml-2 text-surface-400 hover:text-surface-600" @click="refresh()"><RefreshCcw class="size-3.5" /></button>
      </div>

      <div v-else-if="report.status === 'failed'" class="text-sm text-danger-600">
        {{ t('interview.mymeet.failed') }}<span v-if="report.errorMessage" class="text-xs"> — {{ report.errorMessage }}</span>
      </div>

      <div v-else class="space-y-2">
        <div class="flex items-center gap-2 text-sm font-medium text-surface-800 dark:text-surface-100">
          {{ report.title || t('interview.mymeet.report') }}
          <span v-if="report.durationSec" class="text-xs font-normal text-surface-400">· {{ fmtDuration(report.durationSec) }}</span>
          <a v-if="report.sourceUrl" :href="report.sourceUrl" target="_blank" class="text-brand-600 hover:text-brand-700"><ExternalLink class="size-3.5" /></a>
        </div>
        <p v-if="report.summary" class="whitespace-pre-line text-sm text-surface-700 dark:text-surface-200">{{ report.summary }}</p>

        <div v-if="report.transcriptText">
          <button type="button" class="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700" @click="transcriptOpen = !transcriptOpen">
            {{ t('interview.mymeet.transcript') }}
            <ChevronUp v-if="transcriptOpen" class="size-3" /><ChevronDown v-else class="size-3" />
          </button>
          <pre v-if="transcriptOpen" class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-surface-50 p-3 text-xs text-surface-600 dark:bg-surface-800/60 dark:text-surface-300">{{ report.transcriptText }}</pre>
        </div>
      </div>
    </template>

    <!-- Link dialog -->
    <div v-if="dialogOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="dialogOpen = false">
      <div class="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl dark:bg-surface-900">
        <h3 class="mb-3 text-sm font-semibold text-surface-800 dark:text-surface-100">{{ t('interview.mymeet.selectMeeting') }}</h3>
        <div v-if="loadingMeetings" class="py-8 text-center text-surface-400"><Loader2 class="mx-auto size-5 animate-spin" /></div>
        <p v-else-if="!meetings.length" class="py-6 text-center text-sm text-surface-500">{{ t('interview.mymeet.noMeetings') }}</p>
        <ul v-else class="max-h-80 space-y-1 overflow-auto">
          <li v-for="m in meetings" :key="m.id">
            <button
              type="button"
              :disabled="importing"
              class="flex w-full items-center justify-between gap-2 rounded-md border border-surface-200 p-2.5 text-left text-sm hover:bg-surface-50 disabled:opacity-50 dark:border-surface-700 dark:hover:bg-surface-800"
              @click="pick(m)"
            >
              <span class="min-w-0 truncate text-surface-800 dark:text-surface-100">{{ m.title || m.id }}</span>
              <span class="shrink-0 text-xs text-surface-400">{{ m.date ? new Date(m.date).toLocaleDateString() : '' }}</span>
            </button>
          </li>
        </ul>
        <div class="mt-4 text-right">
          <button type="button" class="rounded-lg px-3 py-1.5 text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800" @click="dialogOpen = false">
            {{ t('interview.mymeet.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
