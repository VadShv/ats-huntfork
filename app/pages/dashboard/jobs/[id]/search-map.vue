<script setup lang="ts">
/**
 * Карта поиска по вакансии — основной экран.
 * docs/tz-search-map.md §11.2
 */
import { Radar, Sparkles, GitBranch, Plus, FileDown } from 'lucide-vue-next'

definePageMeta({ layout: 'dashboard', middleware: ['auth', 'require-org'] })

const route = useRoute()
const jobId = computed(() => route.params.id as string)
const toast = useToast()

const { allowed: canEdit } = usePermission({ searchMap: ['edit'] })
const { allowed: canView } = usePermission({ searchMap: ['view'] })

const sm = useJobSearchMap(jobId)

const showEmpty = computed(() => {
  if (sm.pending.value) return false
  if (sm.hasMap.value) return false
  const err = sm.error.value as any
  if (err && err.statusCode === 404 && err.data?.reason === 'not_created') return true
  return false
})
const hasError = computed(() => !sm.pending.value && !sm.hasMap.value && sm.error.value && !showEmpty.value)
const templates = computed(() => (sm.error.value as any)?.data?.templates ?? [])

const generating = ref(false)
const showVersions = ref(false)
const showVersionModal = ref(false)
const versions = ref<any[]>([])

// Drawers
const selectedDonor = ref<any>(null)
const showDonorDrawer = ref(false)
const selectedSegment = ref<any>(null)
const showSegmentDrawer = ref(false)
const showDonorPicker = ref(false)

// Channels for SegmentDrawer
const { data: channelsData } = useFetch('/api/search-map/channels', { key: 'sm-channels' })
const channels = computed(() => channelsData.value?.items ?? [])

function onDonorClick(donorId: string) {
  const d = sm.data.value?.donors.find((x: any) => x.donor.id === donorId)
  if (d) {
    selectedDonor.value = d
    showDonorDrawer.value = true
  }
}

function onSegmentClick(segmentId: string) {
  const s = sm.data.value?.segments.find((x: any) => x.segment.id === segmentId)
  if (s) {
    selectedSegment.value = s
    showSegmentDrawer.value = true
  }
}

async function aiGenerate() {
  generating.value = true
  try {
    const result = await $fetch(`/api/jobs/${jobId.value}/search-map/generate`, {
      method: 'POST',
      body: { scope: 'full', mode: 'append' },
    })
    toast.success(`Добавлено: ${result.itemsAdded} пунктов, ${result.donorsAdded} доноров, ${result.segmentsAdded} сегментов`)
    await sm.refresh()
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка генерации')
  } finally {
    generating.value = false
  }
}

async function loadVersions() {
  try {
    const result = await $fetch(`/api/jobs/${jobId.value}/search-map/versions`)
    versions.value = result.versions
    showVersions.value = true
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  }
}

async function restoreVersion(versionId: string) {
  if (!confirm('Восстановить версию? Текущее состояние будет сохранено как новая версия.')) return
  try {
    await $fetch(`/api/jobs/${jobId.value}/search-map/versions/${versionId}/restore`, { method: 'POST' })
    toast.success('Версия восстановлена')
    showVersions.value = false
    await sm.refresh()
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  }
}

async function createFromTemplate(templateId?: string) {
  await sm.createMap(templateId)
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <!-- Empty state -->
    <SearchMapEmptyState
      v-if="showEmpty"
      :templates="templates"
      @create="createFromTemplate"
    />

    <!-- Error (not not_created) -->
    <div v-else-if="hasError" class="rounded-lg border border-danger-300 p-8 text-center">
      <p class="text-sm text-danger-600">{{ (sm.error.value as any)?.statusMessage ?? 'Ошибка' }}</p>
    </div>

    <!-- Loading -->
    <div v-else-if="sm.pending.value" class="flex items-center justify-center py-12">
      <div class="size-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
    </div>

    <!-- Map content -->
    <div v-else-if="sm.data.value" class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Radar class="size-5 text-brand-600" />
          <h1 class="text-xl font-semibold text-surface-900 dark:text-surface-50">Карта поиска</h1>
          <UiBadge variant="surface">{{ sm.data.value.map.status }}</UiBadge>
          <UiBadge v-if="sm.data.value.versionsCount > 0" variant="brand">v{{ sm.data.value.versionsCount }}</UiBadge>
        </div>
        <div v-if="canEdit" class="flex gap-2">
          <UiButton size="sm" variant="ghost" :loading="generating" @click="aiGenerate">
            <Sparkles class="mr-1 size-4" /> AI
          </UiButton>
          <UiButton size="sm" variant="ghost" @click="showVersionModal = true">
            <GitBranch class="mr-1 size-4" /> Версия
          </UiButton>
          <UiButton size="sm" variant="ghost" @click="loadVersions">
            История
          </UiButton>
          <UiButton size="sm" variant="ghost" @click="navigateTo(`/api/jobs/${jobId}/search-map/export?format=md`)">
            .md
          </UiButton>
          <UiButton size="sm" variant="ghost" @click="navigateTo(`/api/jobs/${jobId}/search-map/export?format=pdf`)">
            <FileDown class="mr-1 size-4" /> PDF
          </UiButton>
        </div>
      </div>

      <!-- Stats panel -->
      <SearchMapStatsPanel :job-id="jobId" />

      <!-- Versions panel -->
      <div v-if="showVersions" class="rounded-lg border border-surface-200 p-4 dark:border-surface-800">
        <div class="mb-2 flex items-center justify-between">
          <h3 class="text-sm font-semibold">Версии карты</h3>
          <button class="text-surface-400 hover:text-surface-600" @click="showVersions = false">✕</button>
        </div>
        <div class="space-y-1">
          <div v-for="v in versions" :key="v.id" class="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-surface-100 dark:hover:bg-surface-800">
            <div class="flex items-center gap-2">
              <UiBadge variant="brand">v{{ v.versionNo }}</UiBadge>
              <span class="text-surface-700 dark:text-surface-300">{{ v.label }}</span>
              <span class="text-xs text-surface-400">{{ new Date(v.createdAt).toLocaleDateString('ru') }}</span>
            </div>
            <UiButton size="xs" variant="ghost" @click="restoreVersion(v.id)">Восстановить</UiButton>
          </div>
          <div v-if="!versions.length" class="py-2 text-center text-sm text-surface-400">Версий пока нет</div>
        </div>
      </div>

      <!-- Stale banner -->
      <div v-if="sm.isStale" class="rounded-lg border border-warning-300 bg-warning-50 p-4 dark:border-warning-700 dark:bg-warning-950">
        <div class="flex items-center justify-between">
          <p class="text-sm text-warning-800 dark:text-warning-200">
            ⚠ Изменились: {{ sm.staleSources.join(', ') }}
          </p>
          <UiButton v-if="canEdit" size="sm" variant="ghost" @click="sm.acknowledgeSources()">
            Учтено
          </UiButton>
        </div>
      </div>

      <!-- Two columns: sections + donors/segments -->
      <div class="grid gap-6 lg:grid-cols-2">
        <!-- Sections -->
        <div class="space-y-4">
          <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-300">Секции</h2>
          <SearchMapSectionListEditor
            v-for="section in sm.data.value.sections"
            :key="section.id"
            :section="section"
            :job-id="jobId"
            :can-edit="canEdit"
          />
        </div>

        <!-- Donors + Segments -->
        <div class="space-y-6">
          <!-- Donors -->
          <div>
            <div class="mb-3 flex items-center justify-between">
              <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-300">Компании-доноры</h2>
              <UiButton v-if="canEdit" size="sm" variant="ghost" @click="showDonorPicker = !showDonorPicker">
                <Plus class="mr-1 size-4" /> Добавить
              </UiButton>
            </div>
            <DonorCompanyPicker
              v-if="showDonorPicker && canEdit"
              :job-id="jobId"
              @added="sm.refresh()"
            />
            <SearchMapDonorLayerBoard
              :donors="sm.data.value.donors"
              :can-edit="canEdit"
              @click="onDonorClick"
            />
          </div>

          <!-- Segments -->
          <div>
            <h2 class="mb-3 text-sm font-semibold text-surface-700 dark:text-surface-300">Сегменты</h2>
            <SearchMapSegmentTable
              :segments="sm.data.value.segments"
              :can-edit="canEdit"
              @click="onSegmentClick"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Donor drawer -->
    <DonorDrawer
      v-model="showDonorDrawer"
      :donor="selectedDonor"
      :job-id="jobId"
      @updated="sm.refresh()"
    />

    <!-- Segment drawer -->
    <SegmentDrawer
      v-model="showSegmentDrawer"
      :segment="selectedSegment"
      :job-id="jobId"
      :channels="channels"
      :donors="sm.data.value?.donors ?? []"
      @updated="sm.refresh()"
    />

    <!-- Create version modal -->
    <CreateVersionModal
      v-model="showVersionModal"
      :job-id="jobId"
      @created="sm.refresh()"
    />
  </div>
</template>
