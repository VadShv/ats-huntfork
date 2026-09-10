/**
 * Application stage management — fetch available stages + move application.
 * Wraps PATCH /api/applications/:id/stage and GET /api/applications/:id/stages.
 */
import { ref, computed } from 'vue'

export interface StageInfo {
  id: string
  name: string | null
  color: string | null
  bucket: string | null
  type: string | null
  displayOrder: number
  isTerminal: boolean
  isArchived: boolean
  bucket: string | null
  parentStageId: string | null
  isHidden: boolean
  presetKey: string | null
  isCurrent: boolean
}

export function useApplicationStages(applicationId: string) {
  const stages = ref<StageInfo[]>([])
  const loading = ref(false)
  const moving = ref(false)
  const toast = useToast()
  const { t } = useI18n()

  async function fetchStages() {
    loading.value = true
    try {
      const res = await $fetch<StageInfo[]>(
        `/api/applications/${applicationId}/stages`,
      )
      stages.value = res ?? []
    } catch {
      stages.value = []
    } finally {
      loading.value = false
    }
  }

  const currentStage = computed(() => stages.value.find(s => s.isCurrent) ?? null)

  /** Next non-terminal stage after current. */
  const nextStage = computed(() => {
    const cur = currentStage.value
    if (!cur) return null
    return stages.value.find(s => s.displayOrder > cur.displayOrder && !s.isTerminal && s.bucket !== 'rejected') ?? null
  })

  /** First rejected-bucket stage. */
  const rejectStage = computed(() =>
    stages.value.find(s => s.bucket === 'rejected') ?? null,
  )

  async function moveStage(stageId: string, comment?: string): Promise<boolean> {
    if (moving.value) return false
    moving.value = true
    try {
      const res = await $fetch<{ currentStageName: string }>(
        `/api/applications/${applicationId}/stage`,
        { method: 'PATCH', body: { stageId, comment } },
      )
      toast.success(t('comments.move_stage_success', { stage: res.currentStageName }))
      await fetchStages()
      return true
    } catch (e: any) {
      toast.error(e?.data?.statusMessage ?? e?.message ?? 'Не удалось изменить этап')
      return false
    } finally {
      moving.value = false
    }
  }

  return { stages, loading, moving, currentStage, nextStage, rejectStage, fetchStages, moveStage }
}
