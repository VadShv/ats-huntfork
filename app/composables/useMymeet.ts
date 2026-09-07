import type { MaybeRefOrGetter } from 'vue'

export interface MymeetTool { name: string, description?: string }
export interface MymeetStatus {
  connected: boolean
  hasApiKey: boolean
  lastCheckedAt: string | null
  tools: MymeetTool[]
}
export interface MymeetMeeting { id: string, title: string | null, date: string | null, durationSec: number | null }

/** Org-level MyMeet (MCP) connection + meeting listing (Этап 5). */
export function useMymeet() {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()

  const { data: status, refresh } = useFetch<MymeetStatus>('/api/mymeet/status', {
    key: 'mymeet-status',
    headers: useRequestHeaders(['cookie']),
    default: () => ({ connected: false, hasApiKey: false, lastCheckedAt: null, tools: [] }),
  })

  async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn() }
    catch (err) { handlePreviewReadOnlyError(err); throw err }
  }

  async function connect(apiKey: string) {
    const res = await guard(() => $fetch('/api/mymeet/connect', { method: 'POST', body: { apiKey } }))
    await refresh()
    return res
  }
  async function disconnect() {
    await guard(() => $fetch('/api/mymeet/disconnect', { method: 'POST' }))
    await refresh()
  }
  async function test() {
    const res = await guard(() => $fetch('/api/mymeet/test', { method: 'POST' }))
    await refresh()
    return res
  }
  async function listMeetings() {
    return guard(() => $fetch<{ tool: string, meetings: MymeetMeeting[] }>('/api/mymeet/meetings'))
  }

  return { status, refresh, connect, disconnect, test, listMeetings }
}

export interface MeetingReport {
  id: string
  interviewId: string | null
  status: 'importing' | 'completed' | 'failed'
  externalMeetingId: string
  title: string | null
  meetingDate: string | null
  durationSec: number | null
  transcriptText: string | null
  summary: string | null
  participantsJson: unknown[] | null
  sourceUrl: string | null
  errorMessage: string | null
  importedAt: string | null
}

/** Meeting report for a single interview + link/import action. */
export function useInterviewMeetingReport(interviewId: MaybeRefOrGetter<string>) {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()
  const id = computed(() => toValue(interviewId))

  const { data: report, status, refresh } = useFetch<MeetingReport | null>(
    () => `/api/interviews/${id.value}/meeting-report`,
    {
      key: computed(() => `interview-report-${id.value}`),
      headers: useRequestHeaders(['cookie']),
      default: () => null,
    },
  )

  async function importMeeting(externalMeetingId: string, title?: string) {
    try {
      const res = await $fetch(`/api/interviews/${id.value}/import-mymeet`, {
        method: 'POST', body: { externalMeetingId, title },
      })
      await refresh()
      return res
    }
    catch (err) { handlePreviewReadOnlyError(err); throw err }
  }

  return { report, status, refresh, importMeeting }
}
