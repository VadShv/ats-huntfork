<script setup lang="ts">
/**
 * Обсуждение отдельным окном (ТЗ docs/tz-discussion-window.md).
 *
 * Роут без меню и шапки приложения: мини-строка 32px · тред на всю высоту.
 * Открывается из «⋯» треда, карточки кандидата и страницы интервью через
 * useDiscussionWindow().open(); переводы этапа транслируются в основное окно.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ExternalLink, X } from 'lucide-vue-next'
import CandidateDiscussionTabs from '~/components/Comments/CandidateDiscussionTabs.vue'
import { useDiscussionWindow, saveDiscussionWindowBounds } from '~/composables/useDiscussionWindow'
import type { StageMoveResult } from '~/composables/useApplicationStages'

definePageMeta({
  layout: 'default',
  middleware: ['auth', 'require-org'],
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const localePath = useLocalePath()
const applicationId = computed(() => route.params.id as string)

interface ApplicationLite {
  id: string
  candidateId: string
  candidate: { firstName: string, lastName: string } | null
  job: { title: string | null } | null
}

const { data: application, error, pending } = await useFetch<ApplicationLite>(
  () => `/api/applications/${applicationId.value}`,
  {
    key: computed(() => `disc-window-${applicationId.value}`),
    headers: useRequestHeaders(['cookie']),
    watch: [applicationId],
  },
)

const candidateName = computed(() => {
  const c = application.value?.candidate
  return c ? `${c.firstName} ${c.lastName}`.trim() : ''
})

useHead({
  title: computed(() => candidateName.value
    ? `${candidateName.value} · ${t('discussion_window.title')} — HuntFork`
    : `${t('discussion_window.title')} — HuntFork`),
})

const { broadcastStageChanged, announceOpened, announceClosed, openApplicationInMain } = useDiscussionWindow()

function onStageChanged(payload: StageMoveResult) {
  broadcastStageChanged(applicationId.value, payload)
}

/** Переключение «Другие отклики» внутри окна меняет URL — F5 откроет тот же тред. */
function onSwitchApplication(id: string) {
  if (id === applicationId.value) return
  void router.replace(localePath(`/dashboard/applications/${id}/discussion`))
}

function openCard() {
  openApplicationInMain(applicationId.value)
}

function closeWindow() {
  window.close()
}

/** Ключ тредов: меняется вместе с откликом, чтобы тред перемонтировался. */
const threadKey = computed(() => `${applicationId.value}:${application.value?.candidateId ?? ''}`)

const mounted = ref(false)
function onBeforeUnload() {
  saveDiscussionWindowBounds()
  announceClosed()
}
onMounted(() => {
  mounted.value = true
  announceOpened(applicationId.value)
  window.addEventListener('beforeunload', onBeforeUnload)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})
// Переключение отклика внутри окна — сообщаем основному окну новый id.
watch(applicationId, (id) => { if (mounted.value) announceOpened(id) })
</script>

<template>
  <div class="flex h-screen flex-col bg-surface-50 dark:bg-surface-950">
    <!-- Мини-строка: окно без шапки приложения остаётся узнаваемым, из него есть выход в карточку -->
    <div class="flex h-8 flex-shrink-0 items-center gap-2 border-b border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-3 text-[11px] text-surface-500 dark:text-surface-400">
      <span class="size-2 rounded-full bg-brand-600" />
      <span class="font-semibold text-surface-700 dark:text-surface-200">HuntFork</span>
      <span>· {{ t('discussion_window.title') }}</span>
      <span class="flex-1" />
      <button
        v-if="application"
        type="button"
        class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-800 dark:hover:text-surface-100 cursor-pointer transition-colors"
        :title="t('comments.open_application')"
        @click="openCard"
      >
        <ExternalLink class="size-3" />
        {{ t('discussion_window.open_card') }}
      </button>
    </div>

    <!-- Тред -->
    <div class="min-h-0 flex-1">
      <div v-if="pending && !application" class="flex h-full items-center justify-center text-sm text-surface-400">
        <span class="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-surface-300 border-t-brand-500" />
        {{ t('comments.loading') }}
      </div>
      <div v-else-if="error || !application" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p class="text-sm font-semibold text-surface-700 dark:text-surface-200">{{ t('discussion_window.unavailable') }}</p>
        <p class="max-w-xs text-xs text-surface-500">{{ t('discussion_window.unavailable_hint') }}</p>
        <UiButton variant="secondary" size="sm" :icon-left="X" @click="closeWindow">{{ t('discussion_window.close') }}</UiButton>
      </div>
      <CandidateDiscussionTabs
        v-else
        :key="threadKey"
        :current-application-id="applicationId"
        :candidate-id="application.candidateId"
        fill
        @stage-changed="onStageChanged"
        @switch-application="onSwitchApplication"
      />
    </div>
  </div>
</template>
