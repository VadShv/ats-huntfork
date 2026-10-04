/**
 * useJobSearchMap — загрузка и правка карты поиска по вакансии.
 * docs/tz-search-map.md §11.2
 */
export function useJobSearchMap(jobId: MaybeRefOrGetter<string>) {
  const id = computed(() => toValue(jobId))
  const toast = useToast()

  const { data, error, refresh, pending } = useFetch(`/api/jobs/${id}/search-map`, {
    key: () => `search-map-${id.value}`,
  })

  const isStale = computed(() => data.value?.isStale ?? false)
  const staleSources = computed(() => data.value?.staleSources ?? [])
  const hasMap = computed(() => !!data.value?.map)
  const canGenerate = computed(() => data.value?.canGenerate)

  async function createMap(templateId?: string) {
    await $fetch(`/api/jobs/${id.value}/search-map`, {
      method: 'POST',
      body: templateId ? { templateId } : {},
    })
    await refresh()
  }

  async function deleteMap() {
    await $fetch(`/api/jobs/${id.value}/search-map`, { method: 'DELETE' })
    await refresh()
  }

  async function addItems(sectionId: string, items: { value: string; note?: string }[]) {
    const result = await $fetch(`/api/jobs/${id.value}/search-map/sections/${sectionId}/items`, {
      method: 'POST',
      body: { items },
    })
    await refresh()
    return result
  }

  async function addDonors(donors: any[]) {
    const result = await $fetch(`/api/jobs/${id.value}/search-map/donors`, {
      method: 'POST',
      body: { donors },
    })
    await refresh()
    return result
  }

  async function addSegments(segments: any[]) {
    const result = await $fetch(`/api/jobs/${id.value}/search-map/segments`, {
      method: 'POST',
      body: { segments },
    })
    await refresh()
    return result
  }

  async function updateDonor(donorId: string, patch: any) {
    await $fetch(`/api/jobs/${id.value}/search-map/donors/${donorId}`, {
      method: 'PATCH',
      body: patch,
    })
    await refresh()
  }

  async function updateSegment(segmentId: string, patch: any) {
    await $fetch(`/api/jobs/${id.value}/search-map/segments/${segmentId}`, {
      method: 'PATCH',
      body: patch,
    })
    await refresh()
  }

  async function acknowledgeSources() {
    await $fetch(`/api/jobs/${id.value}/search-map/acknowledge-sources`, { method: 'POST' })
    await refresh()
  }

  return {
    data, error, refresh, pending,
    isStale, staleSources, hasMap, canGenerate,
    createMap, deleteMap, addItems, addDonors, addSegments,
    updateDonor, updateSegment, acknowledgeSources,
  }
}
