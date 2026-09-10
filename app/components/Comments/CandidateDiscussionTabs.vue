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
  }>(),
  { compact: false },
)

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

/** Цветовая схема вкладки: текущий = brand (ATS primary), архив = grey. */
function tabClass(tab: DiscussionTab) {
  const active = tab.id === activeId.value
  if (isCurrent(tab)) {
    return active
      ? 'border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200 dark:border-brand-400'
      : 'border-transparent text-surface-600 hover:bg-brand-50/50 dark:text-surface-300 dark:hover:bg-brand-900/10'
  }
  if (isArchived(tab)) {
    return active
      ? 'border-surface-400 bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300 dark:border-surface-600'
      : 'border-transparent text-surface-400 hover:bg-surface-100/70 dark:text-surface-500 dark:hover:bg-surface-800/50'
  }
  return active
    ? 'border-surface-300 bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-200 dark:border-surface-600'
    : 'border-transparent text-surface-500 hover:bg-surface-100/60 dark:text-surface-400 dark:hover:bg-surface-800/50'
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
    class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900"
    :class="compact ? '' : ''"
  >
    <!-- Панель вкладок (только если откликов > 1) -->
    <div
      v-if="hasMultiple"
      class="flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-surface-200 dark:border-surface-800 px-2 pt-2"
      role="tablist"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="tab.id === activeId"
        class="group flex flex-shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer"
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

    <!-- Тред активной вкладки -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      mode="default"
    >
      <div v-if="!loading" :key="activeId">
        <!-- Контекст-шапка: AI-скрининг + оценка рисков активной вкладки -->
        <div :class="compact ? 'px-3 pt-3' : 'px-4 pt-3'">
          <DiscussionContextWidgets
            :key="`ctx-${activeId}`"
            :application-id="activeId"
            :candidate-id="candidateId"
            :compact="compact"
            @open-screening="openScreening"
            @open-risk="openRisk"
          />
        </div>
        <ApplicationCommentThread
          :key="activeId"
          :application-id="activeId"
          :read-only="isReadOnly"
          :compact="compact"
          class="!border-0"
        />
      </div>
    </Transition>
    <div v-else class="py-8 text-center text-sm text-surface-400">
      <span class="inline-block size-4 animate-spin rounded-full border-2 border-surface-300 border-t-brand-500 align-middle mr-2" />
      {{ t('comments.loading') }}
    </div>
  </section>
</template>
