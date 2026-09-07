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
import { FileText, LayoutList, ShieldAlert } from 'lucide-vue-next'
import type { RiskFinding } from '~/composables/useResumeRisk'

const props = defineProps<{
  candidateId: string
  candidateName: string
  /** Есть ли структурированный снепшот резюме (или hh-резюме). */
  hasSnapshot: boolean
  /** id документа-резюме для кнопки «Структурировать из файла» и превью оригинала. */
  resumeDocumentId?: string | null
  /** MIME оригинального документа-резюме (для выбора превью/скачивания). */
  resumeDocumentMime?: string | null
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

// Вид: 'structure' (JSON) | 'file' (оригинальный файл) | 'risks' (риск-профиль версии).
type View = 'structure' | 'file' | 'risks'

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
defineExpose({ showRisks })

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
        </div>
      </div>
      <div class="flex items-center gap-2">
        <CandidateResumeVersionSelector
          v-if="view === 'structure' || view === 'risks'"
          :candidate-id="candidateId"
          v-model="selectedVersionId"
          @promoted="onPromoted"
        />
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

    <!-- Оригинальный файл резюме (как есть) -->
    <template v-else>
      <iframe
        v-if="previewUrl && canPreview"
        :src="previewUrl"
        class="w-full rounded-lg border border-surface-200 dark:border-surface-800"
        style="height: 70vh;"
        title="Оригинал резюме"
      />
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
          @click="downloadDocument(resumeDocumentId)"
        >
          <FileText class="size-4" /> Скачать оригинал
        </button>
      </div>
    </template>
  </div>
</template>
