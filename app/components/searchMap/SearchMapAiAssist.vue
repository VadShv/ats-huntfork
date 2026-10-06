<script setup lang="ts">
/**
 * SearchMapAiAssist — кнопка «Дополнить с ИИ» для одного блока карты
 * (секция / доноры / гипотезы) с раскрывающейся подсказкой рекрутёра.
 * docs/tz-search-map-v2.md §3.5: ИИ дополняет, не перегенерирует.
 *
 * Запрос уходит в POST /search-map/generate с scope блока; подсказка (hint) — приоритетнее
 * общих правил промпта. Результат сообщается тостом, родитель обновляет данные по событию done.
 */
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  jobId: string
  scope: 'section' | 'donors' | 'segments'
  /** Для scope = section */
  sectionId?: string
  /** Для scope = donors — слой, в который добавлять */
  layer?: string
  label?: string
  limit?: number
  /** Подсказка по умолчанию (например, из гипотезы для «Ещё похожие») */
  presetHint?: string
  size?: 'xs' | 'sm'
  /** Что писать в плейсхолдере подсказки */
  hintPlaceholder?: string
}>(), {
  label: 'Дополнить с ИИ',
  size: 'xs',
  hintPlaceholder: 'Уточнение для модели, например: «добавь англоязычные варианты» (необязательно)',
})

const emit = defineEmits<{ done: [result: { itemsAdded: number; donorsAdded: number; segmentsAdded: number; warnings: string[] }] }>()

const toast = useToast()
const open = ref(false)
const hint = ref(props.presetHint ?? '')
const loading = ref(false)

watch(() => props.presetHint, v => { if (v !== undefined) hint.value = v })

async function run() {
  if (loading.value) return
  loading.value = true
  try {
    const body: Record<string, unknown> = { scope: props.scope, mode: 'append' }
    if (props.sectionId) body.sectionId = props.sectionId
    if (props.layer) body.layer = props.layer
    if (props.limit) body.limit = props.limit
    if (hint.value.trim()) body.hint = hint.value.trim().slice(0, 500)

    const result = await $fetch(`/api/jobs/${props.jobId}/search-map/generate`, {
      method: 'POST', body, timeout: 320_000,
    }) as any

    const added = (result.itemsAdded ?? 0) + (result.donorsAdded ?? 0) + (result.segmentsAdded ?? 0)
    if (added === 0) {
      toast.info('Модель не предложила ничего нового', 'Всё, что она придумала, уже есть в карте — попробуйте уточнить подсказку')
    } else {
      const parts: string[] = []
      if (result.itemsAdded) parts.push(`${result.itemsAdded} пунктов`)
      if (result.donorsAdded) parts.push(`${result.donorsAdded} доноров`)
      if (result.segmentsAdded) parts.push(`${result.segmentsAdded} гипотез`)
      toast.success(`Добавлено: ${parts.join(', ')}`)
    }
    for (const w of (result.warnings ?? []).slice(0, 2)) toast.warning('Генерация: предупреждение', w)
    open.value = false
    emit('done', { itemsAdded: result.itemsAdded ?? 0, donorsAdded: result.donorsAdded ?? 0, segmentsAdded: result.segmentsAdded ?? 0, warnings: result.warnings ?? [] })
  } catch (e: any) {
    const msg = e?.data?.statusMessage ?? e?.statusMessage
    toast.error('Не удалось дополнить', {
      message: msg && msg !== 'Internal Server Error' ? msg : 'Проверьте настройки ИИ (Настройки → ИИ)',
      statusCode: e?.statusCode ?? e?.status,
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="inline-flex flex-col items-end gap-1">
    <div class="flex items-center gap-1">
      <UiButton :size="size" variant="ghost" :loading="loading" :title="loading ? 'Обычно 20–60 секунд' : 'Модель добавит новое, не трогая существующее'" @click="run">
        <Sparkles class="mr-1 size-3.5" /> {{ loading ? 'Думает…' : label }}
      </UiButton>
      <button
        type="button"
        class="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800"
        :title="open ? 'Скрыть подсказку' : 'Уточнить, что именно добавить'"
        @click="open = !open"
      >
        <component :is="open ? ChevronUp : ChevronDown" class="size-3.5" />
      </button>
    </div>
    <div v-if="open" class="flex w-72 gap-1">
      <UiInput v-model="hint" :placeholder="hintPlaceholder" size="sm" class="flex-1" maxlength="500" @keyup.enter="run" />
    </div>
  </div>
</template>
