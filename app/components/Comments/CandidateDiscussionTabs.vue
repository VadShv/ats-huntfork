<script setup lang="ts">
/**
 * Обёртка над ApplicationCommentThread для кандидата с несколькими откликами.
 *
 * Новая оболочка (docs/tz-discussion-shell.md): панели вкладок больше нет —
 * список откликов передаётся в тред и показывается переключателем
 * «Другие отклики (N) ▾» в шапке. Правила прежние:
 *  - текущий отклик (currentApplicationId) — полный функционал;
 *  - другие отклики — только чтение (readOnly), с полосой «Просмотр».
 *
 * Имя компонента сохранено ради трёх точек встраивания (страница отклика,
 * шторка воронки, страница вакансии).
 */
import { computed, onMounted, ref } from 'vue'
import ApplicationCommentThread, { type DiscussionAppOption } from './ApplicationCommentThread.vue'
import { useUnreadComments } from '~/composables/useUnreadComments'
import type { StageMoveResult } from '~/composables/useApplicationStages'

interface DiscussionTabStage {
  id: string
  name: string | null
  color: string | null
  bucket: string | null
  type: string | null
  isTerminal: boolean
}

interface DiscussionTab {
  id: string
  jobId: string
  jobTitle: string | null
  jobStatus: string | null
  source: string | null
  externalId: string | null
  stage: DiscussionTabStage | null
  commentCount: number
  stageChangedAt: string | null
  createdAt: string
  updatedAt: string
}

const props = withDefaults(
  defineProps<{
    /** Отклик, открытый сейчас (в него можно писать). */
    currentApplicationId: string
    /** Кандидат — источник списка откликов и контекста риска. */
    candidateId: string
    /** Компактный лейаут для drawer. */
    compact?: boolean
  }>(),
  { compact: false },
)

const emit = defineEmits<{
  /** Этап отклика изменён из обсуждения — хозяин (страница/шторка) обновляет карточку отклика. */
  'stage-changed': [payload: StageMoveResult]
}>()

const localePath = useLocalePath()

const tabs = ref<DiscussionTab[]>([])
/** Имя кандидата для шапки-паспорта (приходит вместе со списком откликов). */
const candidateName = ref<string | null>(null)
const loading = ref(true)
const activeId = ref(props.currentApplicationId)

const isReadOnly = computed(() => activeId.value !== props.currentApplicationId)
const activeHhLinked = computed(() => {
  const tab = tabs.value.find(t => t.id === activeId.value)
  return tab?.source === 'hh' && !!tab?.externalId
})

function fallbackTab(): DiscussionTab {
  return {
    id: props.currentApplicationId,
    jobId: '',
    jobTitle: null,
    jobStatus: null,
    source: null,
    externalId: null,
    stage: null,
    commentCount: 0,
    stageChangedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

async function fetchTabs() {
  loading.value = true
  try {
    const res = await $fetch<{ data: DiscussionTab[], candidate?: { firstName: string, lastName: string } | null }>(`/api/candidates/${props.candidateId}/discussion-tabs`)
    const list = res.data ?? []
    candidateName.value = res.candidate ? `${res.candidate.firstName} ${res.candidate.lastName}`.trim() || null : null
    const current = list.filter(a => a.id === props.currentApplicationId)
    const others = list.filter(a => a.id !== props.currentApplicationId)
    tabs.value = [...current, ...others]
    if (current.length === 0) tabs.value.unshift(fallbackTab())
  } catch {
    tabs.value = [fallbackTab()]
  } finally {
    loading.value = false
  }
}

const { unreadCount, fetchUnread } = useUnreadComments()

onMounted(() => {
  fetchTabs()
  fetchUnread()
})

const applications = computed<DiscussionAppOption[]>(() =>
  tabs.value.map(tab => ({
    id: tab.id,
    jobTitle: tab.jobTitle,
    stageName: tab.stage?.name ?? null,
    stageColor: tab.stage?.color ?? null,
    isTerminal: Boolean(tab.stage?.isTerminal) || tab.stage?.bucket === 'rejected',
    commentCount: tab.commentCount,
    unreadCount: unreadCount(tab.id),
    isCurrent: tab.id === props.currentApplicationId,
    stageChangedAt: tab.stageChangedAt,
  })),
)

function onStageChanged(payload: StageMoveResult) {
  // Обновить этап в списке «Другие отклики» и пробросить наверх.
  void fetchTabs()
  emit('stage-changed', payload)
}

function openScreening() {
  navigateTo(localePath(`/dashboard/applications/${activeId.value}`))
}
function openRisk() {
  navigateTo(localePath(`/dashboard/candidates/${props.candidateId}`))
}
</script>

<template>
  <div>
    <ApplicationCommentThread
      v-if="!loading"
      :key="activeId"
      :application-id="activeId"
      :candidate-id="candidateId"
      :candidate-name="candidateName"
      :applications="applications"
      :read-only="isReadOnly"
      :compact="compact"
      :hh-linked="activeHhLinked"
      @switch-application="(id) => { activeId = id }"
      @stage-changed="onStageChanged"
      @open-screening="openScreening"
      @open-risk="openRisk"
    />
    <div
      v-else
      class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 py-8 text-center text-sm text-surface-400"
    >
      <span class="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-surface-300 border-t-brand-500 align-middle" />
      {{ $t('comments.loading') }}
    </div>
  </div>
</template>
