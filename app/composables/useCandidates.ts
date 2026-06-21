import type { Ref } from 'vue'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'
import type { PropertyFilter } from '~~/shared/properties'

/**
 * Composable for managing the candidates list with search, pagination, and mutations.
 * Wraps `useFetch('/api/candidates')` with a singleton key for shared state.
 */
export function useCandidates(options?: {
  search?: Ref<string | undefined> | string
  gender?: Ref<string | undefined> | string
  dobFrom?: Ref<string | undefined> | string
  dobTo?: Ref<string | undefined> | string
  propertyFilters?: Ref<PropertyFilter[] | undefined> | PropertyFilter[]
}) {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()

  const query = computed(() => {
    const pf = toValue(options?.propertyFilters)
    return {
      // Sprint 1A: переходим на q для активации FTS-ветки (websearch_to_tsquery) в /api/candidates.
      // При этом параметр search на бэке сохраняется (старый ILIKE-путь) для обратной совместимости.
      ...(toValue(options?.search) && { q: toValue(options?.search) }),
      ...(toValue(options?.gender) && { gender: toValue(options?.gender) }),
      ...(toValue(options?.dobFrom) && { dobFrom: toValue(options?.dobFrom) }),
      ...(toValue(options?.dobTo) && { dobTo: toValue(options?.dobTo) }),
      ...(pf && pf.length > 0 && { propertyFilters: JSON.stringify(pf) }),
    }
  })

  const { data, status: fetchStatus, error, refresh } = useFetch('/api/candidates', {
    key: 'candidates',
    query,
    headers: useRequestHeaders(['cookie']),
  })

  const candidates = computed(() => data.value?.data ?? [])
  const total = computed(() => data.value?.total ?? 0)

  /** Create a new candidate and refresh the list */
  async function createCandidate(payload: {
    firstName: string
    lastName: string
    displayName?: string
    email: string
    phone?: string
    gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say'
    dateOfBirth?: string
    /** Sprint 3.3 (P2.2): явный город кандидата */
    city?: string
    /** Sprint 3.4 (P2.3): соцсети — для identity-сигналов */
    linkedin?: string
    telegram?: string
    github?: string
    /** Подтверждённый fuzzy-дубль — создать всё равно (не обходит hard-блок по email/phone) */
    force?: boolean
  }) {
    try {
      const created = await $fetch('/api/candidates', {
        method: 'POST',
        body: payload,
      })
      await refresh()
      return created
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
  }

  /** Delete a candidate by ID and refresh the list */
  async function deleteCandidate(id: string) {
    try {
      await $fetch(`/api/candidates/${id}`, { method: 'DELETE' })
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
    await refresh()
  }

  return {
    candidates,
    total,
    fetchStatus,
    error,
    refresh,
    createCandidate,
    deleteCandidate,
  }
}
