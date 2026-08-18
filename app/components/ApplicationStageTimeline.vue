<script setup lang="ts">
/**
 * ApplicationStageTimeline
 *
 * Vertical timeline of all stage moves for a single application.
 * Fetches GET /api/applications/:id/stage-history and renders
 * each entry with colored dots, user name, relative time, and
 * optional comment.
 */

const props = defineProps<{
  applicationId: string
}>()

const { t } = useI18n()

// ── Data fetching ─────────────────────────────────────────────────────────────

type HistoryEntry = {
  id: string
  fromStageId: string | null
  fromStageName: string | null
  fromStageColor: string | null
  fromStageParentName?: string | null
  toStageId: string
  toStageName: string
  toStageColor: string
  toStageParentName?: string | null
  movedByUserId: string | null
  movedByUserName: string | null
  comment: string | null
  movedAt: string
}

const { data, status } = useFetch<HistoryEntry[]>(
  () => `/api/applications/${props.applicationId}/stage-history`,
  {
    key: `stage-history-${props.applicationId}`,
    headers: useRequestHeaders(['cookie']),
  },
)

const history = computed<HistoryEntry[]>(() => data.value ?? [])
const isLoading = computed(() => status.value === 'pending')

// ── Relative time (reuse inline impl matching the pattern in the codebase) ────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'только что'
  if (mins < 60) return `${mins} мин. назад`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} ч. назад`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days} д. назад`
  return new Date(dateStr).toLocaleDateString('ru-RU')
}
</script>

<template>
  <div>
    <!-- Loading skeleton -->
    <div v-if="isLoading" class="space-y-4">
      <div
        v-for="i in 3"
        :key="i"
        class="flex gap-3 animate-pulse"
      >
        <!-- Dot skeleton -->
        <div class="mt-1 shrink-0 size-2.5 rounded-full bg-surface-200 dark:bg-surface-700" />
        <!-- Text skeleton -->
        <div class="flex-1 space-y-1.5 pb-4 border-l border-surface-100 dark:border-surface-800 pl-4 -ml-[7px]">
          <div class="h-4 w-48 rounded bg-surface-200 dark:bg-surface-700" />
          <div class="h-3 w-32 rounded bg-surface-100 dark:bg-surface-800" />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <p
      v-else-if="history.length === 0"
      class="text-sm text-surface-400 dark:text-surface-500 italic py-2"
    >
      {{ t('applications.history.empty') }}
    </p>

    <!-- Timeline entries -->
    <ol v-else class="relative">
      <li
        v-for="(entry, idx) in history"
        :key="entry.id"
        class="flex gap-0"
      >
        <!-- Left rail: dot + line -->
        <div class="flex flex-col items-center mr-3 shrink-0">
          <!-- Colored dot (toStageColor) -->
          <span
            class="mt-1 size-2.5 rounded-full ring-2 ring-white dark:ring-surface-900 shrink-0"
            :style="{ backgroundColor: entry.toStageColor }"
          />
          <!-- Vertical line connecting to next item -->
          <div
            v-if="idx < history.length - 1"
            class="flex-1 w-px bg-surface-200 dark:bg-surface-700 mt-1"
            style="min-height: 1.5rem"
          />
        </div>

        <!-- Entry content -->
        <div class="pb-5 min-w-0 flex-1">
          <!-- Stage transition line -->
          <div class="flex flex-wrap items-center gap-1.5 text-sm">
            <!-- fromStage badge (or dash) -->
            <span
              v-if="entry.fromStageName"
              class="inline-flex items-center gap-1 rounded-full border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-0.5 text-xs font-medium text-surface-600 dark:text-surface-300"
            >
              <span
                class="size-1.5 rounded-full shrink-0"
                :style="{ backgroundColor: entry.fromStageColor ?? '#94a3b8' }"
              />
              <template v-if="entry.fromStageParentName">{{ entry.fromStageParentName }} / </template>{{ entry.fromStageName }}
            </span>
            <span
              v-else
              class="inline-flex items-center rounded-full border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-0.5 text-xs font-medium text-surface-400 dark:text-surface-500"
            >—</span>

            <!-- Arrow -->
            <span class="text-surface-400 dark:text-surface-500 text-xs">→</span>

            <!-- toStage badge -->
            <span
              class="inline-flex items-center gap-1 rounded-full border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-0.5 text-xs font-semibold text-surface-700 dark:text-surface-200"
            >
              <span
                class="size-1.5 rounded-full shrink-0"
                :style="{ backgroundColor: entry.toStageColor }"
              />
              <template v-if="entry.toStageParentName">{{ entry.toStageParentName }} / </template>{{ entry.toStageName }}
            </span>
          </div>

          <!-- Sub-line: actor + relative time -->
          <p class="mt-0.5 text-xs text-surface-400 dark:text-surface-500">
            {{ entry.movedByUserName ?? t('applications.history.system') }}
            ·
            {{ timeAgo(entry.movedAt) }}
          </p>

          <!-- Optional comment -->
          <blockquote
            v-if="entry.comment"
            class="mt-1.5 border-l-2 border-surface-200 dark:border-surface-700 pl-2.5 text-xs italic text-surface-500 dark:text-surface-400"
          >
            {{ entry.comment }}
          </blockquote>
        </div>
      </li>
    </ol>
  </div>
</template>
