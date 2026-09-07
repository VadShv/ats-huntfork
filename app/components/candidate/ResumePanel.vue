<script setup lang="ts">
/**
 * CandidateResumePanel — единый блок «Резюме» для карточки кандидата.
 *
 * Используется и в боковом drawer (CandidateDetailDrawer), и на полной странице
 * (candidates/[id].vue), чтобы кнопки и поведение были идентичны:
 *   • заголовок «Резюме» + «Порекомендовать» (ReferralButton);
 *   • переключатель вида «Структура / Файл»;
 *   • селектор версий с действием «Сделать текущей» (promote);
 *   • рендер резюме (HhResumeView) с чипом источника и структурированием из файла.
 *
 * Гибрид просмотра: для РУЧНЫХ загрузок (есть оригинальный файл-резюме) доступна
 * кнопка «Файл» — показывает оригинальный PDF как есть (ничего не теряется при
 * несовершенном парсинге кастомных макетов). Структурированные данные (JSON)
 * используются для скрининга/поиска/дедупа и остаются во вкладке «Структура».
 * Для hh/расширения файла нет — доступна только «Структура».
 *
 * Управление выбранной версией инкапсулировано здесь (общий источник правды),
 * что исключает рассинхрон между drawer и страницей.
 */
import { FileText, LayoutList, ShieldAlert, ArrowLeftRight, ChevronDown, ChevronUp, History, AlignLeft, Copy, Check } from 'lucide-vue-next'
import type { RiskFinding } from '~/composables/useResumeRisk'
import { useResumeComparison, type SnapshotDiff } from '~/composables/useResumeComparison'

const props = defineProps<{
  candidateId: string
  candidateName: string
  /** Есть ли структурированный снепшот резюме (или hh-резюме). */
  hasSnapshot: boolean
  /** id документа-резюме для кнопки «Структурировать из файла» и превью оригинала. */
  resumeDocumentId?: string | null
  /** MIME оригинального документа-резюме (для выбора превью/скачивания). */
  resumeDocumentMime?: string | null
  /** Оригинальное имя файла резюме — для корректного имени при скачивании. */
  resumeDocumentName?: string | null
  /**
   * Доступно ли inline-превью: оригинал PDF или есть сконвертированный preview-PDF
   * (DOC/DOCX → PDF). Если false — показываем кнопку «Скачать оригинал».
   */
  resumeDocumentPreviewAvailable?: boolean
}>()

const emit = defineEmits<{
  /** Резюме структурировано/промоутнуто — родителю стоит обновить кандидата. */
  changed: []
}>()

const { getPreviewUrl, downloadDocument } = useDocuments()

const { t } = useI18n()

// Выбранная версия: null = текущая, иначе id конкретной версии.
const selectedVersionId = ref<string | null>(null)
const isVersionPopupOpen = ref(false)

// Вид: 'structure' (JSON) | 'file' (оригинальный файл) | 'text' (извлечённый текст
// по блокам, без LLM) | 'risks' (риск-профиль) | 'compare' (сравнение версий).
type View = 'structure' | 'file' | 'text' | 'risks' | 'compare'

// Оригинал доступен только для ручных загрузок (есть документ-резюме).
const hasOriginalFile = computed(() => Boolean(props.resumeDocumentId))
// Можно ли показать inline-превью: оригинал PDF ИЛИ есть сконвертированный preview-PDF.
// Обратная совместимость: если previewAvailable не передан — падаем на проверку MIME.
const canPreview = computed(() =>
  props.resumeDocumentPreviewAvailable
  ?? ((props.resumeDocumentMime ?? 'application/pdf') === 'application/pdf'),
)

// Дефолт вида: для файловых резюме (добавлены вручную файлом) показываем оригинал —
// превью как есть, без «каши» структурирования кастомных макетов. Для hh/расширения
// файла нет → остаётся «Структура».
const view = ref<View>(props.resumeDocumentId && canPreview.value ? 'file' : 'structure')

// Пропсы документа могут прийти асинхронно (родитель дозагружает кандидата). Пока
// пользователь сам не переключал вид, синхронизируем дефолт: файловое+превью → «Файл».
const userTouchedView = ref(false)
function setView(v: View) {
  userTouchedView.value = true
  view.value = v
}
watch(
  () => [props.resumeDocumentId, canPreview.value] as const,
  ([docId, preview]) => {
    if (userTouchedView.value) return
    view.value = docId && preview ? 'file' : 'structure'
  },
)
const previewUrl = computed(() =>
  props.resumeDocumentId ? getPreviewUrl(props.resumeDocumentId) : null,
)

// Для переключения превью по версиям: если выбрана версия с documentId,
// показываем превью этого документа. Иначе — дефолтный документ кандидата.
const activeDocumentId = computed(() => {
  // Если выбрана версия и у неё есть documentId — используем его.
  const vDocId = selectedVersionId.value ? versionDocumentId.value : null
  return vDocId ?? props.resumeDocumentId
})
const activePreviewUrl = computed(() =>
  activeDocumentId.value ? getPreviewUrl(activeDocumentId.value) : null,
)

// Тянем documentId выбранной версии (лениво, для видов 'file' и 'text' — оба
// работают с оригинальным документом версии).
const versionDocumentId = ref<string | null>(null)
watch([selectedVersionId, () => view.value], async ([vId, v]) => {
  if ((v !== 'file' && v !== 'text') || !vId) { versionDocumentId.value = null; return }
  try {
    const res = await $fetch<{ versions: Array<{ id: string, documentId: string | null }> }>(
      `/api/candidates/${props.candidateId}/resume-versions`,
      { headers: useRequestHeaders(['cookie']) },
    )
    versionDocumentId.value = res.versions.find(v => v.id === vId)?.documentId ?? null
  }
  catch { versionDocumentId.value = null }
}, { immediate: false })

// ── Извлечённый текст резюме (вид «Текст») ──
// Показывает parsedContent.sections/text документа-резюме БЕЗ вызова LLM:
// мгновенно, дословно из оригинала, работает на любом (в т.ч. колоночном) макете.
// Источник — тот же GET /documents/:id/parsed. Ленивая загрузка при открытии вкладки,
// кэш по documentId, чтобы не тянуть повторно при переключениях.
interface ParsedTextData {
  text: string
  sections: Array<{ heading: string, content: string }>
  metadata?: { parserVersion?: string }
}
const textDocId = computed<string | null>(() => activeDocumentId.value ?? null)
const parsedText = ref('')
const parsedSections = ref<Array<{ heading: string, content: string }>>([])
const textParserVersion = ref<string | null>(null)
const isLoadingText = ref(false)
const textError = ref(false)
let loadedTextDocId: string | null = null

async function loadParsedText(force = false) {
  const docId = textDocId.value
  if (!docId) { parsedText.value = ''; parsedSections.value = []; return }
  if (!force && loadedTextDocId === docId) return // уже загружено для этого документа
  isLoadingText.value = true
  textError.value = false
  parsedText.value = ''
  parsedSections.value = []
  textParserVersion.value = null
  try {
    const data = await $fetch<ParsedTextData>(`/api/documents/${docId}/parsed`, {
      headers: useRequestHeaders(['cookie']),
    })
    parsedText.value = data.text || ''
    parsedSections.value = Array.isArray(data.sections) ? data.sections : []
    textParserVersion.value = data.metadata?.parserVersion ?? null
    loadedTextDocId = docId
  }
  catch {
    textError.value = true
    loadedTextDocId = null
  }
  finally {
    isLoadingText.value = false
  }
}

// Ленивая загрузка: тянем текст только когда открыт вид «Текст» или сменился документ.
watch([view, textDocId], ([v]) => { if (v === 'text') loadParsedText() })

// ── T3: копирование, источник извлечения, сворачивание длинных секций ──

// Человекочитаемый источник извлечения из metadata.parserVersion:
//   'extractor:pdfplumber' / 'extractor:ocr' → внешний сервис;
//   '1.1' и т.п. → встроенный парсер (pdf-parse/mammoth).
const extractionSourceLabel = computed(() => {
  const v = textParserVersion.value ?? ''
  if (v.startsWith('extractor:')) {
    const method = v.slice('extractor:'.length)
    return method === 'ocr' ? 'OCR' : (method || 'pdfplumber')
  }
  return t('candidate.resumeText.builtinParser')
})

const textCopied = ref(false)
let copyResetTimer: ReturnType<typeof setTimeout> | null = null
async function copyResumeText() {
  // Собираем полный текст: если есть секции — «Заголовок\nконтент», иначе плоский text.
  const full = parsedSections.value.length
    ? parsedSections.value.map(s => `${s.heading}\n${s.content}`).join('\n\n')
    : parsedText.value
  try {
    await navigator.clipboard.writeText(full)
    textCopied.value = true
    if (copyResetTimer) clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => { textCopied.value = false }, 2000)
  }
  catch { /* clipboard недоступен — молча игнорируем */ }
}
onBeforeUnmount(() => { if (copyResetTimer) clearTimeout(copyResetTimer) })

// Сворачивание длинных секций (> ~6 строк или > 600 символов).
const collapsedSections = ref<Set<number>>(new Set())
function isSectionLong(content: string): boolean {
  return content.length > 600 || content.split('\n').length > 6
}
function isSectionCollapsed(i: number): boolean {
  return collapsedSections.value.has(i)
}
function toggleSection(i: number) {
  const next = new Set(collapsedSections.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  collapsedSections.value = next
}
// При загрузке нового текста — длинные секции по умолчанию свёрнуты.
watch(parsedSections, (sections) => {
  const collapsed = new Set<number>()
  sections.forEach((s, i) => { if (isSectionLong(s.content)) collapsed.add(i) })
  collapsedSections.value = collapsed
})

function onStructured() {
  selectedVersionId.value = null
  emit('changed')
}
function onPromoted() {
  selectedVersionId.value = null
  emit('changed')
}

// Позволяет родителю (клик по риск-находке в карточке) переключить панель на «Риски».
function showRisks() {
  userTouchedView.value = true
  view.value = 'risks'
}
// Позволяет родителю (клик «Подробнее» в ComparisonCard) переключить панель на «Сравнение».
function showCompare() {
  userTouchedView.value = true
  view.value = 'compare'
}
defineExpose({ showRisks, showCompare })

// ── Риск-профиль выбранной версии (вид «Риски») ──
// null selectedVersionId → текущая версия (endpoint risk-profile);
// иначе — конкретная версия (endpoint resume-versions/:id/risk).
const riskUrl = computed(() =>
  selectedVersionId.value
    ? `/api/candidates/${props.candidateId}/resume-versions/${selectedVersionId.value}/risk`
    : `/api/candidates/${props.candidateId}/risk-profile`,
)
const { data: riskData, status: riskStatus, refresh: refreshRisk } = useFetch<{ risk: any, stale: boolean } | null>(
  riskUrl,
  {
    key: computed(() => `resume-panel-risk-${props.candidateId}-${selectedVersionId.value ?? 'current'}`),
    headers: useRequestHeaders(['cookie']),
    immediate: false,
    watch: [riskUrl],
    default: () => null,
  },
)
// Ленивая загрузка: тянем риск только когда открыт вид «Риски».
watch(view, (v) => { if (v === 'risks') refreshRisk() })
const risk = computed(() => riskData.value?.risk ?? null)
const riskFindings = computed<RiskFinding[]>(() => {
  const f = risk.value?.findingsJson
  return (f && 'findings' in f ? f.findings : []) ?? []
})
const riskLevelClass: Record<string, string> = {
  low: 'bg-success-50 text-success-700 dark:bg-success-950/50 dark:text-success-400',
  medium: 'bg-warning-50 text-warning-700 dark:bg-warning-950/50 dark:text-warning-400',
  high: 'bg-danger-50 text-danger-700 dark:bg-danger-950/50 dark:text-danger-400',
}

// ── Сравнение версий (вид «Сравнение») ──
const { versions: cmpVersions, canCompare, fetchDiff } = useResumeComparison(() => props.candidateId)
// Какая ступень развёрнута (id пары base→compare), null = все свёрнуты.
const expandedTransition = ref<string | null>(null)
const cmpDiff = ref<SnapshotDiff | null>(null)
const cmpLoading = ref(false)

function sourceLabel(src: string): string {
  switch (src) {
    case 'hh': return 'hh.ru'
    case 'manual_upload': return 'файл'
    case 'api_import': return 'API'
    case 'merged_from': return 'слияние'
    default: return src
  }
}

function fmtVersionDate(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

// Клик по ступени таймлайна (vN → vN+1) — загрузить diff пары.
async function toggleTransition(baseId: string, compareId: string) {
  const key = `${baseId}→${compareId}`
  if (expandedTransition.value === key) {
    expandedTransition.value = null
    cmpDiff.value = null
    return
  }
  expandedTransition.value = key
  cmpLoading.value = true
  cmpDiff.value = await fetchDiff(baseId, compareId)
  cmpLoading.value = false
}
</script>

<template>
  <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
    <div class="mb-4 flex items-center justify-between gap-2">
      <div class="flex items-center gap-3 min-w-0">
        <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200 shrink-0">Резюме</h2>
        <!-- Переключатель вида: Структура / Риски всегда при наличии снепшота; Файл — при ручной загрузке -->
        <div
          v-if="hasSnapshot || hasOriginalFile"
          class="inline-flex rounded-lg border border-surface-200 dark:border-surface-700 p-0.5 shrink-0"
        >
          <button
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors"
            :class="view === 'structure'
              ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
              : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200'"
            @click="setView('structure')"
          >
            <LayoutList class="size-3.5" /> Структура
          </button>
          <button
            v-if="hasSnapshot"
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors"
            :class="view === 'risks'
              ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
              : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200'"
            @click="setView('risks')"
          >
            <ShieldAlert class="size-3.5" /> {{ t('candidate.risk.tab') }}
          </button>
          <button
            v-if="canCompare"
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors"
            :class="view === 'compare'
              ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
              : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200'"
            @click="setView('compare')"
          >
            <ArrowLeftRight class="size-3.5" /> {{ t('candidate.comparison.tab') }}
          </button>
          <button
            v-if="hasOriginalFile"
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors"
            :class="view === 'file'
              ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
              : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200'"
            @click="setView('file')"
          >
            <FileText class="size-3.5" /> Файл
          </button>
          <button
            v-if="hasOriginalFile"
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors"
            :class="view === 'text'
              ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
              : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200'"
            @click="setView('text')"
          >
            <AlignLeft class="size-3.5" /> {{ t('candidate.resumeText.tab') }}
          </button>
          <!-- Версии (попап со списком) -->
          <div v-if="cmpVersions.length > 1" class="relative">
            <button
              type="button"
              class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors"
              :class="isVersionPopupOpen
                ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200'"
              @click="isVersionPopupOpen = !isVersionPopupOpen"
            >
              <History class="size-3.5" /> Версии
              <span v-if="selectedVersionId" class="text-[10px] opacity-70">v{{ cmpVersions.find(v => v.id === selectedVersionId)?.versionNumber ?? '' }}</span>
            </button>
            <div
              v-if="isVersionPopupOpen"
              class="absolute top-[calc(100%+4px)] left-0 min-w-[200px] bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg z-50 overflow-hidden max-h-60 overflow-y-auto"
            >
              <button
                type="button"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors cursor-pointer"
                :class="!selectedVersionId ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300' : 'text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800'"
                @click="selectedVersionId = null; isVersionPopupOpen = false"
              >
                <span class="flex-1">Текущая</span>
                <span v-if="cmpVersions.find(v => v.isCurrent)" class="text-[10px] text-surface-400">v{{ cmpVersions.find(v => v.isCurrent)?.versionNumber }}</span>
              </button>
              <button
                v-for="v in cmpVersions"
                :key="v.id"
                type="button"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors cursor-pointer"
                :class="selectedVersionId === v.id ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300' : 'text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800'"
                @click="selectedVersionId = v.id; isVersionPopupOpen = false"
              >
                <span class="flex-1">v{{ v.versionNumber }}</span>
                <span v-if="v.isCurrent" class="rounded bg-brand-100 px-1 text-[10px] font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">текущая</span>
                <span class="text-[10px] text-surface-400">{{ sourceLabel(v.source) }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
      </div>
    </div>

    <!-- Структурированный вид (JSON) — используется для скрининга/поиска -->
    <template v-if="view === 'structure'">
      <CandidateHhResumeView
        :candidate-id="candidateId"
        :has-snapshot="hasSnapshot"
        :candidate-name="candidateName"
        :version-id="selectedVersionId"
        :resume-document-id="resumeDocumentId"
        @structured="onStructured"
      />
    </template>

    <!-- Риск-профиль выбранной версии резюме -->
    <template v-else-if="view === 'risks'">
      <div v-if="riskStatus === 'pending'" class="py-8 text-center text-sm text-surface-400">…</div>
      <div v-else-if="!risk || risk.status !== 'completed'" class="rounded-lg border border-dashed border-surface-300 dark:border-surface-700 p-6 text-center text-sm text-surface-500">
        {{ risk?.status === 'running' ? t('candidate.risk.running') : risk?.status === 'failed' ? t('candidate.risk.failed') : t('candidate.risk.empty') }}
      </div>
      <div v-else class="space-y-4">
        <div v-if="riskData?.stale" class="rounded bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-950/40 dark:text-warning-400">
          {{ t('candidate.risk.stale') }}
        </div>
        <p v-if="risk.summary" class="text-sm text-surface-700 dark:text-surface-200">{{ risk.summary }}</p>
        <p v-if="risk.isCapped" class="rounded bg-surface-50 px-3 py-2 text-xs text-surface-500 dark:bg-surface-800/60 dark:text-surface-400">
          {{ t('candidate.risk.capped') }}
        </p>

        <div v-if="riskFindings.length" class="space-y-3">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-surface-400">{{ t('candidate.risk.findingsTitle') }}</h3>
          <div
            v-for="(f, i) in riskFindings"
            :key="i"
            class="rounded-lg border border-surface-200 p-3 dark:border-surface-800"
          >
            <div class="flex items-start justify-between gap-2">
              <p class="text-sm font-medium text-surface-800 dark:text-surface-100">{{ f.issue || f.claim }}</p>
              <div class="flex shrink-0 items-center gap-1">
                <span class="rounded px-1.5 py-0.5 text-[10px] font-medium" :class="riskLevelClass[f.severity]">{{ t(`candidate.risk.level.${f.severity}`) }}</span>
                <span class="rounded bg-surface-100 px-1.5 py-0.5 text-[10px] text-surface-500 dark:bg-surface-800">{{ t(`candidate.risk.confidence.${f.confidence}`) }}</span>
              </div>
            </div>
            <p v-if="f.evidence" class="mt-1 text-xs text-surface-500 dark:text-surface-400"><span class="font-medium">{{ t('candidate.risk.evidence') }}:</span> {{ f.evidence }}</p>
            <p v-if="f.alternative" class="mt-1 text-xs text-surface-500 dark:text-surface-400"><span class="font-medium">{{ t('candidate.risk.alternative') }}:</span> {{ f.alternative }}</p>
            <p v-if="f.question" class="mt-1 text-xs text-brand-700 dark:text-brand-300"><span class="font-medium">{{ t('candidate.risk.question') }}:</span> {{ f.question }}</p>
            <p v-if="f.listenFor" class="mt-0.5 text-xs text-surface-500 dark:text-surface-400"><span class="font-medium">{{ t('candidate.risk.listenFor') }}:</span> {{ f.listenFor }}</p>
          </div>
        </div>
        <p v-else class="text-sm text-surface-500">{{ t('candidate.risk.noFindings') }}</p>
      </div>
    </template>

    <!-- Сравнение версий резюме (таймлайн изменений) -->
    <template v-else-if="view === 'compare'">
      <div v-if="cmpVersions.length < 2" class="rounded-lg border border-dashed border-surface-300 dark:border-surface-700 p-6 text-center text-sm text-surface-500">
        {{ t('candidate.comparison.notEnough') }}
      </div>
      <div v-else class="space-y-3">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-surface-400">{{ t('candidate.comparison.timelineTitle') }}</h3>
        <!-- Версии идут desc (новейшая сверху). Ступень между vN и vN+1 показана под vN. -->
        <div
          v-for="(v, idx) in cmpVersions"
          :key="v.id"
          class="rounded-lg border border-surface-200 dark:border-surface-800"
        >
          <!-- Строка версии -->
          <div class="flex items-center justify-between gap-2 px-3 py-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-sm font-medium text-surface-800 dark:text-surface-100">v{{ v.versionNumber }}</span>
              <span v-if="v.isCurrent" class="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">{{ t('candidate.comparison.current') }}</span>
              <span class="text-xs text-surface-400">{{ fmtVersionDate(v.fetchedAt) }} · {{ sourceLabel(v.source) }}</span>
            </div>
          </div>
          <!-- Ступень к предыдущей версии (vN → vN+1), если она есть -->
          <template v-if="idx < cmpVersions.length - 1">
            <button
              type="button"
              class="flex w-full items-center gap-2 border-t border-surface-100 px-3 py-1.5 text-left text-xs hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800/50"
              @click="toggleTransition(cmpVersions[idx + 1]!.id, v.id)"
            >
              <component :is="expandedTransition === `${cmpVersions[idx + 1]!.id}→${v.id}` ? ChevronUp : ChevronDown" class="size-3 shrink-0 text-surface-400" />
              <span class="text-surface-500 dark:text-surface-400">
                {{ v.deltaSummaryText || t('candidate.comparison.noDelta') }}
              </span>
            </button>
            <!-- Разворот: полный diff пары -->
            <div
              v-if="expandedTransition === `${cmpVersions[idx + 1]!.id}→${v.id}`"
              class="border-t border-surface-100 px-3 py-3 dark:border-surface-800"
            >
              <div v-if="cmpLoading" class="py-4 text-center text-xs text-surface-400">…</div>
              <div v-else-if="cmpDiff" class="space-y-3">
                <!-- Сводка изменений -->
                <p class="text-xs font-medium text-surface-600 dark:text-surface-300">{{ cmpDiff.summary }}</p>

                <!-- Опыт работы -->
                <div v-if="cmpDiff.experience.some(e => e.status !== 'unchanged')" class="space-y-1.5">
                  <h4 class="text-[11px] font-semibold uppercase tracking-wide text-surface-400">{{ t('candidate.comparison.experience') }}</h4>
                  <div
                    v-for="(e, ei) in cmpDiff.experience.filter(x => x.status !== 'unchanged')"
                    :key="ei"
                    class="rounded-md border p-2 text-xs"
                    :class="{
                      'border-success-200 bg-success-50/50 dark:border-success-800 dark:bg-success-950/20': e.status === 'added',
                      'border-danger-200 bg-danger-50/50 dark:border-danger-800 dark:bg-danger-950/20': e.status === 'removed',
                      'border-warning-200 bg-warning-50/50 dark:border-warning-800 dark:bg-warning-950/20': e.status === 'changed',
                    }"
                  >
                    <div class="flex items-start gap-1.5">
                      <span class="font-mono font-bold" :class="{ 'text-success-600': e.status === 'added', 'text-danger-600': e.status === 'removed', 'text-warning-600': e.status === 'changed' }">
                        {{ e.status === 'added' ? '+' : e.status === 'removed' ? '−' : '~' }}
                      </span>
                      <div class="min-w-0">
                        <span class="font-medium text-surface-800 dark:text-surface-100">{{ e.company }}</span>
                        <span v-if="e.position" class="text-surface-500"> · {{ e.position }}</span>
                        <span class="text-surface-400"> · {{ e.period }}</span>
                        <p v-if="e.changes.length" class="mt-0.5 text-surface-400">{{ e.changes.join(', ') }}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Навыки -->
                <div v-if="cmpDiff.skillsAdded.length || cmpDiff.skillsRemoved.length" class="space-y-1.5">
                  <h4 class="text-[11px] font-semibold uppercase tracking-wide text-surface-400">{{ t('candidate.comparison.skills') }}</h4>
                  <div class="flex flex-wrap gap-1.5">
                    <span v-for="s in cmpDiff.skillsAdded" :key="`+${s}`" class="rounded-md bg-success-50 px-2 py-0.5 text-xs text-success-700 dark:bg-success-950/40 dark:text-success-400">+{{ s }}</span>
                    <span v-for="s in cmpDiff.skillsRemoved" :key="`-${s}`" class="rounded-md bg-danger-50 px-2 py-0.5 text-xs text-danger-700 line-through dark:bg-danger-950/40 dark:text-danger-400">−{{ s }}</span>
                  </div>
                </div>

                <!-- Поля -->
                <div v-if="cmpDiff.fields.some(f => f.changed)" class="space-y-1">
                  <h4 class="text-[11px] font-semibold uppercase tracking-wide text-surface-400">{{ t('candidate.comparison.fields') }}</h4>
                  <div
                    v-for="(f, fi) in cmpDiff.fields.filter(x => x.changed)"
                    :key="fi"
                    class="text-xs text-surface-600 dark:text-surface-300"
                  >
                    <span class="font-medium">{{ f.label }}:</span>
                    <span class="text-surface-400"> {{ f.base || '—' }} → {{ f.compare || '—' }}</span>
                  </div>
                </div>

                <!-- О себе -->
                <div v-if="cmpDiff.aboutChanged" class="text-xs text-warning-600 dark:text-warning-400">
                  {{ t('candidate.comparison.aboutChanged') }}
                </div>

                <!-- Без изменений -->
                <p v-if="!cmpDiff.hasChanges" class="text-xs text-surface-400">{{ t('candidate.comparison.noChanges') }}</p>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>

    <!-- Извлечённый текст резюме по блокам (без LLM) — точно из оригинала -->
    <template v-else-if="view === 'text'">
      <!-- Тулбар: источник извлечения + копирование -->
      <div class="mb-2 flex items-center justify-between gap-2">
        <span
          v-if="textParserVersion"
          class="text-[11px] text-surface-400 dark:text-surface-500"
        >{{ t('candidate.resumeText.extractedVia', { source: extractionSourceLabel }) }}</span>
        <span v-else />
        <button
          v-if="(parsedSections.length || parsedText) && !isLoadingText"
          type="button"
          class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          @click="copyResumeText"
        >
          <Check v-if="textCopied" class="size-3.5 text-success-600" />
          <Copy v-else class="size-3.5" />
          {{ textCopied ? t('candidate.resumeText.copied') : t('candidate.resumeText.copy') }}
        </button>
      </div>

      <!-- Loading -->
      <div v-if="isLoadingText" class="flex items-center justify-center py-12 text-surface-400">
        <div class="size-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>

      <!-- Error -->
      <div
        v-else-if="textError"
        class="rounded-lg border border-dashed border-surface-300 dark:border-surface-700 p-6 text-center"
      >
        <AlignLeft class="size-8 mx-auto text-surface-400" />
        <p class="mt-2 text-sm text-surface-600 dark:text-surface-300">{{ t('candidate.resumeText.error') }}</p>
        <button
          type="button"
          class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-2"
          @click="loadParsedText(true)"
        >
          {{ t('candidate.resumeText.retry') }}
        </button>
      </div>

      <!-- Content -->
      <div
        v-else
        class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4 overflow-y-auto"
        style="max-height: 70vh;"
      >
        <template v-if="parsedSections.length">
          <div v-for="(section, i) in parsedSections" :key="i" class="mb-4 last:mb-0">
            <h4 class="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-1">{{ section.heading }}</h4>
            <p
              class="text-sm text-surface-600 dark:text-surface-400 whitespace-pre-wrap"
              :class="{ 'line-clamp-6': isSectionCollapsed(i) }"
            >{{ section.content }}</p>
            <button
              v-if="isSectionLong(section.content)"
              type="button"
              class="mt-1 inline-flex items-center gap-0.5 text-[11px] text-brand-600 hover:text-brand-700 dark:text-brand-400"
              @click="toggleSection(i)"
            >
              <component :is="isSectionCollapsed(i) ? ChevronDown : ChevronUp" class="size-3" />
              {{ isSectionCollapsed(i) ? t('candidate.resumeText.showMore') : t('candidate.resumeText.showLess') }}
            </button>
          </div>
        </template>
        <p v-else-if="parsedText" class="text-sm text-surface-600 dark:text-surface-400 whitespace-pre-wrap">{{ parsedText }}</p>
        <p v-else class="text-sm text-surface-400 text-center py-8">{{ t('candidate.resumeText.empty') }}</p>
      </div>
    </template>

    <!-- Оригинальный файл резюме (как есть) — переключается по выбранной версии -->
    <template v-else>
      <iframe
        v-if="activePreviewUrl && canPreview"
        :src="activePreviewUrl"
        class="w-full rounded-lg border border-surface-200 dark:border-surface-800"
        style="height: 70vh;"
        title="Оригинал резюме"
      />
      <div
        v-else-if="selectedVersionId && !versionDocumentId"
        class="rounded-lg border border-dashed border-surface-300 dark:border-surface-700 p-6 text-center"
      >
        <FileText class="size-8 mx-auto text-surface-400" />
        <p class="mt-2 text-sm text-surface-600 dark:text-surface-300">
          {{ t('candidate.resumePreview.noFileForVersion') }}
        </p>
        <button
          type="button"
          class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-2"
          @click="setView('structure')"
        >
          <LayoutList class="size-4" /> {{ t('candidate.resumePreview.showStructure') }}
        </button>
      </div>
      <div
        v-else
        class="rounded-lg border border-dashed border-surface-300 dark:border-surface-700 p-6 text-center"
      >
        <FileText class="size-8 mx-auto text-surface-400" />
        <p class="mt-2 text-sm text-surface-600 dark:text-surface-300">
          Предпросмотр недоступен для этого файла.
        </p>
        <button
          v-if="resumeDocumentId"
          type="button"
          class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-2"
          @click="downloadDocument(resumeDocumentId, resumeDocumentName ?? undefined).catch(() => {})"
        >
          <FileText class="size-4" /> Скачать оригинал
        </button>
      </div>
    </template>
  </div>
</template>
