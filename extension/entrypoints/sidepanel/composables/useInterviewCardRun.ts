/**
 * useInterviewCardRun — реальная карточка интервью через серверный ИИ (П6).
 *
 * POST /api/extension/interview-card: по тексту резюме со страницы (и
 * опционально вакансии) строится структурированная карточка: вводные
 * вопросы, блоки по компетенциям (STAR) и финальные проверки.
 */
import { ref, computed } from 'vue'
import { useSidekick, useSidekickActions } from './useSidekick'
import { useToast } from './useToast'

export type IcRunState = 'idle' | 'running' | 'done' | 'error'

export interface IcQuestion { question: string, listenFor: string, redFlag?: string }
export interface IcBlock { competency: string, rationale: string, questions: IcQuestion[] }

export interface IcCard {
  role: string
  intro: string[]
  blocks: IcBlock[]
  finalChecks: string[]
}

const state = ref<IcRunState>('idle')
const card = ref<IcCard | null>(null)
const meta = ref<{ provider: string | null, model: string | null, generatedAt: string } | null>(null)
const errorMsg = ref('')
const savingNote = ref(false)
const noteSaved = ref(false)

export function useInterviewCardRun() {
  const { pageCtx, lookupInfo, selectedJobId, currentUrl } = useSidekick()
  const { send } = useSidekickActions()
  const { toast } = useToast()

  const pageText = computed<string>(() => pageCtx.value?.text ?? '')
  const hasText = computed(() => pageText.value.trim().length >= 200)

  async function run() {
    if (state.value === 'running') return
    if (!hasText.value) {
      errorMsg.value = 'Сначала считайте страницу с резюме (нужно от 200 символов текста).'
      state.value = 'error'
      return
    }
    state.value = 'running'
    errorMsg.value = ''
    noteSaved.value = false
    const resp = await send({
      type: 'interviewCard',
      text: pageText.value.slice(0, 80_000),
      title: pageCtx.value?.title || undefined,
      sourceUrl: pageCtx.value?.canonical || pageCtx.value?.url || currentUrl.value || undefined,
      jobId: selectedJobId.value || undefined,
    })
    if (resp?.ok && resp.data?.card) {
      card.value = resp.data.card
      meta.value = resp.data.meta ?? null
      state.value = 'done'
    }
    else {
      errorMsg.value = resp?.message || 'Не удалось составить карточку интервью'
      state.value = 'error'
    }
  }

  function reset() {
    state.value = 'idle'
    card.value = null
    errorMsg.value = ''
    noteSaved.value = false
  }

  function exportMarkdown(): string {
    const c = card.value
    if (!c) return ''
    const lines: string[] = [`## Карточка интервью — ${c.role} (Sidekick)`, '']
    if (c.intro.length) {
      lines.push('### Вводные вопросы')
      c.intro.forEach(q => lines.push(`- ${q}`))
      lines.push('')
    }
    c.blocks.forEach(b => {
      lines.push(`### ${b.competency}`, b.rationale, '')
      b.questions.forEach((q, i) => {
        lines.push(`${i + 1}. **${q.question}**`)
        lines.push(`   Слушать: ${q.listenFor}`)
        if (q.redFlag) lines.push(`   Ред-флаг: ${q.redFlag}`)
      })
      lines.push('')
    })
    if (c.finalChecks.length) {
      lines.push('### Финальные проверки')
      c.finalChecks.forEach(q => lines.push(`- ${q}`))
      lines.push('')
    }
    return lines.join('\n')
  }

  /** Сохранить карточку заметкой в ATS (если кандидат найден в базе). */
  async function saveToAts() {
    const candidateId = lookupInfo.value?.candidate?.id
    if (!candidateId || !card.value) return
    savingNote.value = true
    const resp = await send({ type: 'note', candidateId, body: exportMarkdown() })
    savingNote.value = false
    if (resp?.ok) {
      noteSaved.value = true
      toast('Карточка сохранена заметкой в ATS', 'success')
    }
    else {
      toast(resp?.message || 'Не удалось сохранить заметку', 'error')
    }
  }

  async function copyCard() {
    try {
      await navigator.clipboard.writeText(exportMarkdown())
      toast('Карточка скопирована', 'success')
    } catch {}
  }

  const canSaveToAts = computed(() => Boolean(lookupInfo.value?.candidate?.id))

  return {
    state, card, meta, errorMsg, savingNote, noteSaved,
    pageText, hasText, canSaveToAts,
    run, reset, exportMarkdown, saveToAts, copyCard,
  }
}
