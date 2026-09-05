<script setup lang="ts">
/**
 * CandidateResumePanel — единый блок «Резюме» для карточки кандидата.
 *
 * Используется и в боковом drawer (CandidateDetailDrawer), и на полной странице
 * (candidates/[id].vue), чтобы кнопки и поведение были идентичны:
 *   • заголовок «Резюме» + «Порекомендовать» (ReferralButton);
 *   • селектор версий с действием «Сделать текущей» (promote);
 *   • рендер резюме (HhResumeView) с чипом источника и структурированием из файла.
 *
 * Управление выбранной версией инкапсулировано здесь (общий источник правды),
 * что исключает рассинхрон между drawer и страницей.
 */
const props = defineProps<{
  candidateId: string
  candidateName: string
  /** Есть ли структурированный снепшот резюме (или hh-резюме). */
  hasSnapshot: boolean
  /** id документа-резюме для кнопки «Структурировать из файла» в empty state. */
  resumeDocumentId?: string | null
}>()

const emit = defineEmits<{
  /** Резюме структурировано/промоутнуто — родителю стоит обновить кандидата. */
  changed: []
}>()

// Выбранная версия: null = текущая, иначе id конкретной версии.
const selectedVersionId = ref<string | null>(null)

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
      <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200">Резюме</h2>
      <div class="flex items-center gap-2">
        <CandidateResumeVersionSelector
          :candidate-id="candidateId"
          v-model="selectedVersionId"
          @promoted="onPromoted"
        />
        <ReferralButton :candidate-id="candidateId" />
      </div>
    </div>
    <CandidateHhResumeView
      :candidate-id="candidateId"
      :has-snapshot="hasSnapshot"
      :candidate-name="candidateName"
      :version-id="selectedVersionId"
      :resume-document-id="resumeDocumentId"
      @structured="onStructured"
    />
  </div>
</template>
