import type { MaybeRefOrGetter } from 'vue'

export interface JobBrief {
  id: string
  jobId: string
  hardMustHave: string[]
  niceToHave: string[]
  dealBreakers: string[]
  redFlagsToWatch: string[]
  responsibilities: string | null
  teamContext: string | null
  interviewProcess: string | null
  compensationNotes: string | null
  idealProfile: string | null
  sourcingHints: string | null
  freeform: string | null
  filledById: string | null
  filledAt: string | null
  createdAt: string
  updatedAt: string
}

export type JobBriefInput = Partial<Omit<JobBrief, 'id' | 'jobId' | 'filledById' | 'filledAt' | 'createdAt' | 'updatedAt'>>

/**
 * Composable for the job brief (Этап 1). Wraps GET/PUT /api/jobs/:id/brief.
 */
export function useJobBrief(jobId: MaybeRefOrGetter<string>) {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()
  const id = computed(() => toValue(jobId))

  const { data: brief, status, error, refresh } = useFetch<JobBrief | null>(
    () => `/api/jobs/${id.value}/brief`,
    {
      key: computed(() => `job-brief-${id.value}`),
      headers: useRequestHeaders(['cookie']),
      default: () => null,
    },
  )

  async function saveBrief(payload: JobBriefInput) {
    try {
      const saved = await $fetch<JobBrief>(`/api/jobs/${id.value}/brief`, {
        method: 'PUT',
        body: payload,
      })
      brief.value = saved
      return saved
    }
    catch (err) {
      handlePreviewReadOnlyError(err)
      throw err
    }
  }

  return { brief, status, error, refresh, saveBrief }
}
