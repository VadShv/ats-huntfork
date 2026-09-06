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
import { FileText, LayoutList } from 'lucide-vue-next'

const props = defineProps<{
  candidateId: string
  candidateName: string
  /** Есть ли структурированный снепшот резюме (или hh-резюме). */
  hasSnapshot: boolean
  /** id документа-резюме для кнопки «Структурировать из файла» и превью оригинала. */
  resumeDocumentId?: string | null
  /** MIME оригинального документа-резюме (для выбора превью/скачивания). */
  resumeDocumentMime?: string | null
}>()

const emit = defineEmits<{
  /** Резюме структурировано/промоутнуто — родителю стоит обновить кандидата. */
  changed: []
}>()

const { getPreviewUrl, downloadDocument } = useDocuments()

// Выбранная версия: null = текущая, иначе id конкретной версии.
const selectedVersionId = ref<string | null>(null)

// Вид: 'structure' (JSON, по умолчанию) | 'file' (оригинальный файл).
type View = 'structure' | 'file'
const view = ref<View>('structure')

// Оригинал доступен только для ручных загрузок (есть документ-резюме).
const hasOriginalFile = computed(() => Boolean(props.resumeDocumentId))
const isPdf = computed(() => (props.resumeDocumentMime ?? 'application/pdf') === 'application/pdf')
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
</script>

<template>
  <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
    <div class="mb-4 flex items-center justify-between gap-2">
      <div class="flex items-center gap-3 min-w-0">
        <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200 shrink-0">Резюме</h2>
        <!-- Переключатель вида: только когда есть оригинальный файл (ручная загрузка) -->
        <div
          v-if="hasOriginalFile"
          class="inline-flex rounded-lg border border-surface-200 dark:border-surface-700 p-0.5 shrink-0"
        >
          <button
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors"
            :class="view === 'structure'
              ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
              : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200'"
            @click="view = 'structure'"
          >
            <LayoutList class="size-3.5" /> Структура
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors"
            :class="view === 'file'
              ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300'
              : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200'"
            @click="view = 'file'"
          >
            <FileText class="size-3.5" /> Файл
          </button>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <CandidateResumeVersionSelector
          v-if="view === 'structure'"
          :candidate-id="candidateId"
          v-model="selectedVersionId"
          @promoted="onPromoted"
        />
        <ReferralButton :candidate-id="candidateId" />
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

    <!-- Оригинальный файл резюме (как есть) -->
    <template v-else>
      <iframe
        v-if="previewUrl && isPdf"
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
          Предпросмотр доступен только для PDF.
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
