<script setup lang="ts">
import { Sparkles, Loader2, RefreshCcw } from 'lucide-vue-next'

const props = defineProps<{
  candidateId: string
  aiSummary?: string | null
  aiSummaryAt?: string | null
  /** Можно ли запускать генерацию (нужен hh-снепшот) */
  canGenerate: boolean
}>()

const emit = defineEmits<{
  (e: 'generated'): void
}>()

const toast = useToast()
const isGenerating = ref(false)
const localSummary = ref<string | null>(props.aiSummary ?? null)
const localSummaryAt = ref<string | null>(props.aiSummaryAt ?? null)

watch(() => props.aiSummary, v => { localSummary.value = v ?? null })
watch(() => props.aiSummaryAt, v => { localSummaryAt.value = v ?? null })

const fetchedAgo = computed(() => {
  if (!localSummaryAt.value) return null
  const diff = Date.now() - new Date(localSummaryAt.value).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин. назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч. назад`
  return `${Math.floor(h / 24)} дн. назад`
})

async function generate() {
  if (!props.canGenerate || isGenerating.value) return
  isGenerating.value = true
  try {
    const res = await $fetch<{ aiSummary: string; aiSummaryAt: string }>(
      `/api/candidates/${props.candidateId}/ai-summary`,
      { method: 'POST' },
    )
    localSummary.value = res.aiSummary
    localSummaryAt.value = res.aiSummaryAt
    emit('generated')
    toast.success('AI-саммари обновлено')
  }
  catch (err: any) {
    toast.error('Не удалось сгенерировать саммари', { message: err?.data?.statusMessage ?? err?.statusMessage })
  }
  finally {
    isGenerating.value = false
  }
}
</script>

<template>
  <div class="rounded-lg border border-violet-200 dark:border-violet-900 bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:from-violet-950/40 dark:to-fuchsia-950/40 p-4">
    <div class="flex items-center justify-between gap-2 mb-2">
      <h3 class="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-900 dark:text-violet-200">
        <Sparkles class="size-4" />
        AI-саммари
      </h3>
      <button
        type="button"
        :disabled="!canGenerate || isGenerating"
        class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
        :title="canGenerate ? 'Сгенерировать или обновить саммари' : 'Нет резюме с hh для анализа'"
        @click="generate"
      >
        <Loader2 v-if="isGenerating" class="size-3.5 animate-spin" />
        <RefreshCcw v-else class="size-3.5" />
        {{ localSummary ? 'Обновить' : 'Сгенерировать' }}
      </button>
    </div>

    <p v-if="!localSummary && !isGenerating" class="text-xs text-violet-700/80 dark:text-violet-300/80">
      Нажмите «Сгенерировать», чтобы получить короткое описание кандидата от AI на основе резюме.
    </p>

    <p
      v-else-if="localSummary"
      class="whitespace-pre-line text-sm leading-relaxed text-surface-800 dark:text-surface-200"
    >{{ localSummary }}</p>

    <p
      v-if="localSummary && fetchedAgo"
      class="mt-2 text-[10px] text-violet-600/70 dark:text-violet-400/70"
    >
      Обновлено {{ fetchedAgo }}
    </p>
  </div>
</template>
