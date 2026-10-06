<script setup lang="ts">
/**
 * SearchMapDocumentView — «читаемая» карта поиска прямо в интерфейсе: то же содержимое
 * и порядок блоков, что в PDF (shared/searchMap/documentModel.ts), но живое:
 * гипотезы и доноры кликабельны, у блоков есть кнопки точечного ИИ-дополнения.
 * docs/tz-search-map-v2.md §3.2–3.5.
 *
 * Компонент не ходит в API сам (кроме дочернего SearchMapAiAssist) — всё через props/emits,
 * чтобы документ можно было отрисовать из тех же данных, что и редактор.
 */
import { Copy, ExternalLink, AlertTriangle } from 'lucide-vue-next'
import type { SearchMapDocument, DocHypothesis } from '~~/shared/searchMap/documentModel'
import { factsLine } from '~~/shared/searchMap/documentModel'
import { SCORE_LABELS } from '~~/shared/searchMap/labels'

const props = defineProps<{
  doc: SearchMapDocument
  jobId: string
  canEdit: boolean
  /** Показывать ли блок версий (грузится отдельно) */
  showVersions?: boolean
}>()

const emit = defineEmits<{
  'segment-click': [segmentId: string]
  'donor-click': [donorId: string]
  'refresh': []
  'restore-version': [versionId: string]
}>()

const toast = useToast()

const fmtDate = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

const STALE_LABELS: Record<string, string> = { brief: 'бриф', criteria: 'критерии', description: 'описание' }
const staleText = computed(() => props.doc.staleSources.map(s => STALE_LABELS[s] ?? s).join(', '))

const factsText = computed(() => factsLine(props.doc.facts))

const sectionsWithContent = computed(() => props.doc.sections.filter(s => s.items.length || s.isRequired))

const PRIORITY_TONE: Record<string, 'danger' | 'warning' | 'neutral'> = { high: 'danger', medium: 'warning', low: 'neutral' }
const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger'> = {
  untested: 'neutral', in_progress: 'info', working: 'success', rejected: 'danger',
}

function scoreDots(v: number | null): string {
  if (!v) return '···'
  return '●'.repeat(Math.min(3, v)) + '○'.repeat(Math.max(0, 3 - v))
}

function scoreTitle(h: DocHypothesis): string {
  const s = h.scores
  return `${SCORE_LABELS.poolEstimate}: ${s.pool ?? '—'} · ${SCORE_LABELS.responseLikelihood}: ${s.response ?? '—'} · ${SCORE_LABELS.accessDifficulty}: ${s.access ?? '—'}`
}

async function copyQuery(q: string) {
  try {
    await navigator.clipboard.writeText(q)
    toast.success('Запрос скопирован')
  } catch {
    toast.error('Не удалось скопировать')
  }
}

function openUrl(url: string) {
  window.open(url, '_blank', 'noopener')
}

/** Якорная навигация по блокам документа (xl+). */
const anchors = computed(() => [
  { id: 'sm-verdict', label: 'Вердикт' },
  { id: 'sm-who', label: 'Кого ищем' },
  { id: 'sm-donors', label: 'Откуда берём' },
  { id: 'sm-hypotheses', label: 'Гипотезы' },
  ...(props.doc.queries.length ? [{ id: 'sm-queries', label: 'Запросы' }] : []),
  ...(props.showVersions && props.doc.versions.length ? [{ id: 'sm-versions', label: 'Версии' }] : []),
])

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="relative xl:grid xl:grid-cols-[1fr_11rem] xl:gap-8">
    <article class="min-w-0 space-y-8">
      <!-- Stale -->
      <div v-if="doc.staleSources.length" class="flex items-start gap-2 rounded-lg border border-warning-300 bg-warning-50 px-4 py-3 text-sm text-warning-800 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-200">
        <AlertTriangle class="mt-0.5 size-4 shrink-0" />
        <div>
          Изменились источники: <strong>{{ staleText }}</strong>. Карта могла устареть — дополните её по брифу или отметьте изменения как учтённые.
        </div>
      </div>

      <!-- Вердикт -->
      <section id="sm-verdict" class="scroll-mt-20">
        <slot name="verdict" />
        <p class="mt-3 text-xs text-surface-500 dark:text-surface-400">
          {{ factsText }}
          <span v-if="doc.facts.lastGeneratedAt"> · ИИ-дополнение {{ fmtDate(doc.facts.lastGeneratedAt) }}<template v-if="doc.facts.lastGenerationModel"> ({{ doc.facts.lastGenerationModel }})</template></span>
        </p>
      </section>

      <!-- Кого ищем -->
      <section id="sm-who" class="scroll-mt-20">
        <h2 class="mb-3 text-base font-semibold text-surface-900 dark:text-surface-50">Кого ищем</h2>
        <div class="grid gap-4 md:grid-cols-2">
          <div
            v-for="s in sectionsWithContent"
            :key="s.id ?? s.sectionType"
            class="rounded-lg border border-surface-200 p-4 dark:border-surface-800"
          >
            <div class="mb-2 flex items-start justify-between gap-2">
              <h3 class="text-sm font-medium text-surface-900 dark:text-surface-50">
                {{ s.title }}
                <span v-if="s.isRequired && !s.items.length" class="ml-1 text-xs font-normal text-warning-600">не заполнено</span>
              </h3>
              <SearchMapAiAssist
                v-if="canEdit && s.id"
                :job-id="jobId"
                scope="section"
                :section-id="s.id"
                label="Дополнить"
                @done="emit('refresh')"
              />
            </div>
            <ul v-if="s.items.length" class="space-y-1 text-sm">
              <li v-for="i in s.items" :key="i.id ?? i.value" class="flex items-baseline gap-2 text-surface-700 dark:text-surface-300">
                <span class="mt-1.5 size-1 shrink-0 rounded-full bg-surface-400" />
                <span class="min-w-0">
                  {{ i.value }}
                  <span v-if="i.note" class="text-surface-400"> — {{ i.note }}</span>
                  <UiBadge v-if="i.isAi" tone="brand" size="sm" class="ml-1 align-middle">ИИ</UiBadge>
                </span>
              </li>
            </ul>
            <p v-else class="text-xs text-surface-400">{{ s.guidance ?? 'Пока пусто — добавьте пункты в редакторе или дополните с ИИ' }}</p>
          </div>
        </div>
        <p v-if="!sectionsWithContent.length" class="text-sm text-surface-400">Секции пусты</p>
      </section>

      <!-- Откуда берём -->
      <section id="sm-donors" class="scroll-mt-20">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-50">Откуда берём: компании-доноры</h2>
          <SearchMapAiAssist
            v-if="canEdit"
            :job-id="jobId"
            scope="donors"
            label="Дополнить доноров"
            hint-placeholder="Например: «добавь региональные компании» или «только продуктовые»"
            @done="emit('refresh')"
          />
        </div>
        <div v-if="doc.donorLayers.length" class="space-y-4">
          <div v-for="l in doc.donorLayers" :key="l.key">
            <div class="mb-1.5 flex items-baseline gap-2">
              <h3 class="text-sm font-medium text-surface-900 dark:text-surface-50">{{ l.label }}</h3>
              <span class="text-xs text-surface-400">{{ l.donors.length }} · {{ l.hint }}</span>
            </div>
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <button
                v-for="d in l.donors"
                :key="d.id ?? d.name"
                type="button"
                class="flex flex-col items-start gap-1 rounded-lg border border-surface-200 p-3 text-left transition hover:border-brand-300 hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800/50"
                @click="d.id && emit('donor-click', d.id)"
              >
                <div class="flex w-full items-center justify-between gap-2">
                  <span class="truncate text-sm font-medium text-surface-900 dark:text-surface-50">{{ d.name }}</span>
                  <UiBadge :tone="STATUS_TONE[d.status] ?? 'neutral'" size="sm">{{ d.statusLabel }}</UiBadge>
                </div>
                <div class="flex flex-wrap items-center gap-1 text-xs text-surface-500">
                  <UiBadge :tone="PRIORITY_TONE[d.priority] ?? 'neutral'" size="sm">{{ d.priorityLabel }}</UiBadge>
                  <span v-if="d.industry">{{ d.industry }}</span>
                  <UiBadge v-if="d.isAi" tone="brand" size="sm">ИИ</UiBadge>
                </div>
                <p v-if="d.rationale" class="line-clamp-2 text-xs text-surface-600 dark:text-surface-400">{{ d.rationale }}</p>
                <p v-if="d.resultNote" class="line-clamp-2 text-xs text-success-700 dark:text-success-400">→ {{ d.resultNote }}</p>
              </button>
            </div>
          </div>
        </div>
        <p v-else class="rounded-lg border border-dashed border-surface-300 p-6 text-center text-sm text-surface-400 dark:border-surface-700">
          Доноров пока нет — добавьте вручную в редакторе или дополните с ИИ
        </p>
      </section>

      <!-- Гипотезы -->
      <section id="sm-hypotheses" class="scroll-mt-20">
        <div class="mb-1 flex items-center justify-between gap-2">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-50">Гипотезы поиска</h2>
          <SearchMapAiAssist
            v-if="canEdit"
            :job-id="jobId"
            scope="segments"
            label="Дополнить гипотезы"
            hint-placeholder="Например: «через Telegram-сообщества» или «alumni Big 4 в регионах»"
            @done="emit('refresh')"
          />
        </div>
        <p class="mb-3 text-xs text-surface-500 dark:text-surface-400">
          Гипотеза = слой доноров × должности × гео × канал. Нажмите на строку, чтобы открыть запрос, оценить и отметить результат.
        </p>
        <div v-if="doc.hypotheses.length" class="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-800">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-surface-200 bg-surface-50 text-left text-xs text-surface-500 dark:border-surface-800 dark:bg-surface-900">
                <th class="px-3 py-2 font-medium">Гипотеза</th>
                <th class="px-3 py-2 font-medium">Канал</th>
                <th class="px-3 py-2 font-medium">Приоритет</th>
                <th class="px-3 py-2 font-medium" title="Пул · Отклик · Доступ (1–3)">Оценка</th>
                <th class="px-3 py-2 font-medium">Статус</th>
                <th class="px-3 py-2 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="h in doc.hypotheses"
                :key="h.id ?? h.name"
                class="cursor-pointer border-b border-surface-100 last:border-0 hover:bg-surface-50 dark:border-surface-900 dark:hover:bg-surface-800/50"
                @click="h.id && emit('segment-click', h.id)"
              >
                <td class="px-3 py-2.5 align-top">
                  <div class="flex items-center gap-1.5 font-medium text-surface-900 dark:text-surface-50">
                    {{ h.name }}
                    <UiBadge v-if="h.isAi" tone="brand" size="sm">ИИ</UiBadge>
                  </div>
                  <div v-if="h.subtitle" class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">{{ h.subtitle }}</div>
                  <div class="mt-0.5 text-xs text-surface-400">{{ h.layerLabel }}<template v-if="h.rationale"> · {{ h.rationale }}</template></div>
                </td>
                <td class="px-3 py-2.5 align-top text-surface-600 dark:text-surface-400">{{ h.channelName }}</td>
                <td class="px-3 py-2.5 align-top">
                  <UiBadge :tone="PRIORITY_TONE[h.priority] ?? 'neutral'" size="sm">{{ h.priorityLabel }}</UiBadge>
                </td>
                <td class="px-3 py-2.5 align-top font-mono text-[10px] leading-4 tracking-widest text-surface-500" :title="scoreTitle(h)">
                  <div>{{ scoreDots(h.scores.pool) }}</div>
                  <div>{{ scoreDots(h.scores.response) }}</div>
                  <div>{{ scoreDots(h.scores.access) }}</div>
                </td>
                <td class="px-3 py-2.5 align-top">
                  <UiBadge :tone="STATUS_TONE[h.status] ?? 'neutral'" size="sm">{{ h.statusLabel }}</UiBadge>
                  <div v-if="h.hhSearchesCount" class="mt-0.5 text-xs text-surface-400">hh-поисков: {{ h.hhSearchesCount }}</div>
                  <div v-if="h.resultNote" class="mt-0.5 line-clamp-2 text-xs text-surface-500">{{ h.resultNote }}</div>
                </td>
                <td class="px-3 py-2.5 align-top text-right" @click.stop>
                  <div class="inline-flex gap-0.5">
                    <UiButton v-if="h.queryString" size="xs" variant="ghost" icon-only title="Скопировать запрос" @click="copyQuery(h.queryString)">
                      <Copy class="size-3.5" />
                    </UiButton>
                    <UiButton v-if="h.queryUrl" size="xs" variant="ghost" icon-only title="Открыть в канале" @click="openUrl(h.queryUrl)">
                      <ExternalLink class="size-3.5" />
                    </UiButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="rounded-lg border border-dashed border-surface-300 p-6 text-center text-sm text-surface-400 dark:border-surface-700">
          Гипотез пока нет — нажмите «Дополнить гипотезы» или создайте вручную в редакторе
        </p>
      </section>

      <!-- Строки запросов -->
      <section v-if="doc.queries.length" id="sm-queries" class="scroll-mt-20">
        <h2 class="mb-3 text-base font-semibold text-surface-900 dark:text-surface-50">Строки запросов</h2>
        <div class="space-y-2">
          <div v-for="q in doc.queries" :key="q.name + q.channelName" class="rounded-lg border border-surface-200 p-3 dark:border-surface-800">
            <div class="mb-1 flex items-center justify-between gap-2">
              <span class="text-sm font-medium text-surface-900 dark:text-surface-50">{{ q.name }} <span class="font-normal text-surface-400">· {{ q.channelName }}</span></span>
              <div class="inline-flex gap-0.5">
                <UiButton size="xs" variant="ghost" icon-only title="Скопировать" @click="copyQuery(q.queryString)"><Copy class="size-3.5" /></UiButton>
                <UiButton v-if="q.queryUrl" size="xs" variant="ghost" icon-only title="Открыть в канале" @click="openUrl(q.queryUrl)"><ExternalLink class="size-3.5" /></UiButton>
              </div>
            </div>
            <code class="block whitespace-pre-wrap break-words rounded bg-surface-50 px-2 py-1.5 font-mono text-xs text-surface-700 dark:bg-surface-900 dark:text-surface-300">{{ q.queryString }}</code>
          </div>
        </div>
      </section>

      <!-- Версии -->
      <section v-if="showVersions && doc.versions.length" id="sm-versions" class="scroll-mt-20">
        <h2 class="mb-3 text-base font-semibold text-surface-900 dark:text-surface-50">Версии карты</h2>
        <ol class="space-y-2">
          <li v-for="v in doc.versions" :key="v.id ?? v.versionNo" class="flex items-start justify-between gap-3 rounded-lg border border-surface-200 px-3 py-2 dark:border-surface-800">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <UiBadge tone="brand" size="sm">v{{ v.versionNo }}</UiBadge>
                <span class="font-medium text-surface-900 dark:text-surface-50">{{ v.label }}</span>
                <UiBadge v-if="v.isCurrent" tone="success" size="sm">текущая</UiBadge>
                <span class="text-xs text-surface-400">{{ fmtDate(v.createdAt) }}<template v-if="v.triggerLabel"> · {{ v.triggerLabel }}</template></span>
              </div>
              <p v-if="v.comment" class="mt-0.5 text-xs text-surface-600 dark:text-surface-400">{{ v.comment }}</p>
              <p v-if="v.diffLine" class="mt-0.5 text-xs text-surface-400">{{ v.diffLine }}</p>
            </div>
            <UiButton v-if="canEdit && v.id && !v.isCurrent" size="xs" variant="ghost" @click="emit('restore-version', v.id)">Восстановить</UiButton>
          </li>
        </ol>
      </section>
    </article>

    <!-- Якорная навигация -->
    <nav class="hidden xl:block">
      <div class="sticky top-20 space-y-1 text-xs">
        <button
          v-for="a in anchors"
          :key="a.id"
          type="button"
          class="block w-full rounded px-2 py-1 text-left text-surface-500 hover:bg-surface-100 hover:text-surface-900 dark:hover:bg-surface-800 dark:hover:text-surface-50"
          @click="scrollTo(a.id)"
        >
          {{ a.label }}
        </button>
      </div>
    </nav>
  </div>
</template>
