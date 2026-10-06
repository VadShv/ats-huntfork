<script setup lang="ts">
/**
 * SearchMapVerdict — блок «Вердикт по рынку» в документ-виде.
 * docs/tz-search-map-v2.md §3.3: вердикт виден на экране (а не только в PDF), правится inline
 * с автосохранением, и может быть переписан ИИ только через диалог «было / стало».
 *
 * Это единственное место (вместе с запросом гипотезы), где ИИ заменяет текст, а не дополняет —
 * поэтому обязателен предпросмотр и явное подтверждение.
 */
import { Sparkles, Pencil, Check, X } from 'lucide-vue-next'

const props = defineProps<{
  jobId: string
  summary: string | null
  canEdit: boolean
}>()

const emit = defineEmits<{ saved: [summary: string] }>()

const toast = useToast()

// ── inline-редактирование ──────────────────────────────────────────
const editing = ref(false)
const draft = ref(props.summary ?? '')
const saving = ref(false)

watch(() => props.summary, v => { if (!editing.value) draft.value = v ?? '' })

function startEdit() {
  draft.value = props.summary ?? ''
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  draft.value = props.summary ?? ''
}

async function persist(text: string) {
  saving.value = true
  try {
    await $fetch(`/api/jobs/${props.jobId}/search-map`, { method: 'PATCH', body: { summary: text.trim().slice(0, 2000) || null } })
    emit('saved', text.trim())
    return true
  } catch (e: any) {
    toast.error('Не удалось сохранить вердикт', { message: e?.data?.statusMessage ?? e?.statusMessage })
    return false
  } finally {
    saving.value = false
  }
}

async function saveEdit() {
  if (draft.value.trim() === (props.summary ?? '').trim()) { editing.value = false; return }
  if (await persist(draft.value)) {
    editing.value = false
    toast.success('Вердикт сохранён')
  }
}

// ── переписать с ИИ: было / стало ──────────────────────────────────
const proposing = ref(false)
const showDiff = ref(false)
const proposal = ref<{ summary: string; previous: string | null } | null>(null)
const hint = ref('')
const showHint = ref(false)

async function propose() {
  if (proposing.value) return
  proposing.value = true
  try {
    const res = await $fetch(`/api/jobs/${props.jobId}/search-map/generate`, {
      method: 'POST',
      body: { scope: 'summary', ...(hint.value.trim() ? { hint: hint.value.trim().slice(0, 500) } : {}) },
      timeout: 320_000,
    }) as any
    proposal.value = { summary: res.summary, previous: res.previous ?? null }
    showDiff.value = true
  } catch (e: any) {
    const msg = e?.data?.statusMessage ?? e?.statusMessage
    toast.error('Не удалось сформировать вердикт', { message: msg && msg !== 'Internal Server Error' ? msg : 'Проверьте настройки ИИ' })
  } finally {
    proposing.value = false
  }
}

async function applyProposal() {
  if (!proposal.value) return
  if (await persist(proposal.value.summary)) {
    showDiff.value = false
    showHint.value = false
    hint.value = ''
    toast.success('Вердикт обновлён')
  }
}

const hasSummary = computed(() => !!props.summary?.trim())
</script>

<template>
  <div>
    <div class="mb-2 flex items-center justify-between gap-2">
      <h2 class="text-base font-semibold text-surface-900 dark:text-surface-50">Вердикт по рынку</h2>
      <div v-if="canEdit && !editing" class="flex items-center gap-1">
        <UiButton size="xs" variant="ghost" @click="startEdit">
          <Pencil class="mr-1 size-3.5" /> {{ hasSummary ? 'Править' : 'Написать' }}
        </UiButton>
        <UiButton size="xs" variant="ghost" :loading="proposing" title="Модель предложит новый текст; вы увидите «было / стало» и решите, применять ли" @click="propose">
          <Sparkles class="mr-1 size-3.5" /> {{ proposing ? 'Думает…' : hasSummary ? 'Обновить с ИИ' : 'Сформировать с ИИ' }}
        </UiButton>
        <button type="button" class="rounded px-1.5 py-1 text-xs text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800" @click="showHint = !showHint">
          {{ showHint ? 'скрыть' : 'уточнить' }}
        </button>
      </div>
    </div>

    <div v-if="showHint && canEdit && !editing" class="mb-2">
      <UiInput v-model="hint" size="sm" maxlength="500" placeholder="Что учесть: «сделай упор на вилку» или «короче, 3 предложения»" @keyup.enter="propose" />
    </div>

    <!-- Режим правки -->
    <div v-if="editing" class="space-y-2">
      <UiTextarea v-model="draft" :rows="5" autosize placeholder="Что это за роль, где основной пул, что делает поиск сложным и с какой гипотезы начать…" />
      <div class="flex items-center justify-end gap-1">
        <UiButton size="xs" variant="ghost" :disabled="saving" @click="cancelEdit"><X class="mr-1 size-3.5" /> Отмена</UiButton>
        <UiButton size="xs" variant="primary" :loading="saving" @click="saveEdit"><Check class="mr-1 size-3.5" /> Сохранить</UiButton>
      </div>
    </div>

    <!-- Чтение -->
    <div
      v-else-if="hasSummary"
      class="whitespace-pre-wrap rounded-lg border border-surface-200 bg-surface-50 px-4 py-3 text-sm leading-relaxed text-surface-800 dark:border-surface-800 dark:bg-surface-900 dark:text-surface-200"
    >{{ summary }}</div>
    <div
      v-else
      class="rounded-lg border border-dashed border-surface-300 px-4 py-3 text-sm text-surface-400 dark:border-surface-700"
    >
      Вердикт ещё не сформулирован. Это 3–5 предложений: что за роль и как её называют на рынке, где основной пул, что делает поиск сложным, с какой гипотезы начать.
      <template v-if="canEdit"> Напишите сами или попросите ИИ.</template>
    </div>

    <!-- Диалог «было / стало» -->
    <UiModal :model-value="showDiff" title="Обновить вердикт?" size="lg" @update:model-value="showDiff = $event">
      <div v-if="proposal" class="grid gap-4 md:grid-cols-2">
        <div>
          <div class="mb-1 text-xs font-medium uppercase tracking-wide text-surface-400">Было</div>
          <div class="min-h-24 whitespace-pre-wrap rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-sm text-surface-600 dark:border-surface-800 dark:bg-surface-900 dark:text-surface-400">
            {{ proposal.previous?.trim() || '— вердикта не было —' }}
          </div>
        </div>
        <div>
          <div class="mb-1 text-xs font-medium uppercase tracking-wide text-brand-600">Стало</div>
          <UiTextarea v-model="proposal.summary" :rows="6" autosize />
          <p class="mt-1 text-xs text-surface-400">Текст можно поправить перед применением.</p>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" @click="showDiff = false">Оставить как было</UiButton>
          <UiButton variant="primary" :loading="saving" @click="applyProposal">Применить</UiButton>
        </div>
      </template>
    </UiModal>
  </div>
</template>
