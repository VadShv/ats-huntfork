<script setup lang="ts">
/**
 * Collaboration Hub (Этап 1) — обёртка над ApplicationCommentThread с вкладками
 * по всем откликам кандидата.
 *
 * Правила:
 *  - Активная вкладка текущего отклика (currentApplicationId) — полный функционал.
 *  - Остальные вкладки — режим просмотра (readOnly): открыть и читать можно,
 *    писать/реагировать нельзя. Визуально «остужены» розоватым цветом.
 *  - Терминальные этапы (нанят/отказ) — приглушённый серый.
 *
 * Если у кандидата всего один отклик — панель вкладок скрывается, показывается
 * обычный тред (обратная совместимость).
 */
import { computed, onMounted, ref } from 'vue'
import { Eye, MessageSquare } from 'lucide-vue-next'
import ApplicationCommentThread from './ApplicationCommentThread.vue'
import DiscussionContextWidgets from './DiscussionContextWidgets.vue'

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
  stage: DiscussionTabStage | null
  commentCount: number
  createdAt: string
  updatedAt: string
}

const props = withDefaults(
  defineProps<{
    /** Отклик, открытый сейчас (в него можно писать). */
    currentApplicationId: string
    /** Кандидат — источник всех вкладок. */
    candidateId: string
    /** Компактный лейаут для drawer. */
    compact?: boolean
    /** Режим фокуса — модуль открыт в полноэкранном drawer (занимает всю высоту). */
    expanded?: boolean
    /** Показывать ли кнопку «Развернуть» (в drawer отклика скрываем). */
    canExpand?: boolean
  }>(),
  { compact: false, expanded: false, canExpand: true },
)

const emit = defineEmits<{ expand: [] }>()

const { t } = useI18n()
const localePath = useLocalePath()

const tabs = ref<DiscussionTab[]>([])
const loading = ref(true)
const activeId = ref(props.currentApplicationId)

const isReadOnly = computed(() => activeId.value !== props.currentApplicationId)
const hasMultiple = computed(() => tabs.value.length > 1)

async function fetchTabs() {
  loading.value = true
  try {
    const res = await $fetch<{ data: DiscussionTab[] }>(
      `/api/candidates/${props.candidateId}/discussion-tabs`,
    )
    // Текущий отклик всегда первым, остальные — по дате (как пришло с сервера).
    const list = res.data ?? []
    const current = list.filter(a => a.id === props.currentApplicationId)
    const others = list.filter(a => a.id !== props.currentApplicationId)
    tabs.value = [...current, ...others]
    // Гарантируем, что текущий отклик есть в списке (напр. только что создан).
    if (current.length === 0) {
      tabs.value.unshift({
        id: props.currentApplicationId,
        jobId: '',
        jobTitle: null,
        jobStatus: null,
        stage: null,
        commentCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    }
  } catch {
    // мягкий фолбэк — показываем только текущий отклик
    tabs.value = [{
      id: props.currentApplicationId,
      jobId: '',
      jobTitle: null,
      jobStatus: null,
      stage: null,
      commentCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]
  } finally {
    loading.value = false
  }
}

onMounted(fetchTabs)

function isCurrent(tab: DiscussionTab) {
  return tab.id === props.currentApplicationId
}

function isArchived(tab: DiscussionTab) {
  return Boolean(tab.stage?.isTerminal) || tab.stage?.bucket === 'rejected'
}

/** Цветовая схема вкладки: текущий = brand, чужой активный = rose, архив = grey. */
function tabClass(tab: DiscussionTab) {
  const active = tab.id === activeId.value
  if (isCurrent(tab)) {
    return active
      ? 'border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200 dark:border-brand-600'
      : 'border-transparent text-surface-600 hover:bg-brand-50/50 dark:text-surface-300 dark:hover:bg-brand-900/10'
  }
  if (isArchived(tab)) {
    return active
      ? 'border-surface-400 bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300 dark:border-surface-600'
      : 'border-transparent text-surface-400 hover:bg-surface-100/70 dark:text-surface-500 dark:hover:bg-surface-800/50'
  }
  // Чужой активный отклик — розоватый
  return active
    ? 'border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-900/20 dark:text-rose-200 dark:border-rose-700'
    : 'border-transparent text-rose-600/80 hover:bg-rose-50/60 dark:text-rose-300/70 dark:hover:bg-rose-900/10'
}

// «Подробнее» из виджетов активной вкладки
function openScreening() {
  navigateTo(localePath(`/dashboard/applications/${activeId.value}`))
}
function openRisk() {
  navigateTo(localePath(`/dashboard/candidates/${props.candidateId}`))
}
</script>

<template>
  <section
    class="flex flex-col rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900"
    :class="expanded ? 'h-full' : 'max-h-[min(72vh,760px)]'"
  >
    <!-- Панель вкладок (только если откликов > 1) -->
    <div
      v-if="hasMultiple"
      class="flex flex-none items-center gap-1 overflow-x-auto border-b border-surface-200 dark:border-surface-800 px-2 pt-2"
      role="tablist"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="tab.id === activeId"
        class="group flex flex-shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-xs font-medium transition-colors cursor-pointer"
        :class="tabClass(tab)"
        @click="activeId = tab.id"
      >
        <!-- Иконка «глаз» для чужих откликов (read-only) -->
        <Eye v-if="!isCurrent(tab)" class="size-3 flex-shrink-0 opacity-70" />

        <!-- Цветная точка этапа -->
        <span
          v-if="tab.stage?.color"
          class="size-1.5 flex-shrink-0 rounded-full"
          :style="{ backgroundColor: tab.stage.color }"
        />

        <span class="max-w-[140px] truncate" :class="isArchived(tab) ? 'line-through decoration-1' : ''">
          {{ tab.jobTitle || t('discussion_tabs.untitled_job') }}
        </span>

        <!-- Бейдж этапа -->
        <span
          v-if="tab.stage?.name"
          class="hidden sm:inline rounded px-1 py-0.5 text-[10px] font-normal opacity-80"
          :style="tab.stage.color ? { backgroundColor: tab.stage.color + '22', color: tab.stage.color } : {}"
        >
          {{ tab.stage.name }}
        </span>

        <!-- Счётчик комментариев -->
        <span
          v-if="tab.commentCount > 0"
          class="inline-flex items-center gap-0.5 rounded-full bg-surface-200/70 dark:bg-surface-700/70 px-1.5 text-[10px] tabular-nums"
        >
          <MessageSquare class="size-2.5" />
          {{ tab.commentCount }}
        </span>
      </button>
    </div>

    <!-- Контекст-шапка: AI-скрининг + оценка рисков активной вкладки (не скроллится) -->
    <div v-if="!loading" class="flex-none border-b border-surface-200 dark:border-surface-800" :class="compact ? 'px-3 pt-3' : 'px-5 pt-4'">
      <DiscussionContextWidgets
        :key="`ctx-${activeId}`"
        :application-id="activeId"
        :candidate-id="candidateId"
        :compact="compact"
        @open-screening="openScreening"
        @open-risk="openRisk"
      />
    </div>

    <!-- Тред активной вкладки — заполняет оставшуюся высоту, скролл внутри него -->
    <div v-if="!loading" class="min-h-0 flex-1">
      <!--
        :key форсирует пересоздание треда при переключении вкладки, чтобы
        useApplicationComments заново загрузил свой applicationId-scoped state.
      -->
      <ApplicationCommentThread
        :key="activeId"
        :application-id="activeId"
        :read-only="isReadOnly"
        :compact="compact"
        expanded
        :can-expand="canExpand"
        class="!rounded-none !border-0"
        @expand="emit('expand')"
      />
    </div>
    <div v-else class="py-8 text-center text-sm text-surface-400">
      {{ t('comments.loading') }}
    </div>
  </section>
</template>
