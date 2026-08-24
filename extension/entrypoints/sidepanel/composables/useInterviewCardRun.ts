/**
 * useInterviewCardRun — реальная карточка интервью через серверный ИИ (П6).
 *
 * POST /api/extension/interview-card: по тексту резюме со страницы (и
 * опционально вакансии) строится структурированная карточка: вводные
 * вопросы, блоки по компетенциям (STAR) и финальные проверки.
 */
import { ref, computed } from 'vue'
import { useSidekick, useSidekickActions, sseRequest } from './useSidekick'
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
const meta = ref<{ provider: string | null, model: string | null, totalMs?: number | null, generatedAt: string } | null>(null)
const errorMsg = ref('')
const savingNote = ref(false)
const noteSaved = ref(false)
// П6: секундомер генерации + возможность остановить
const elapsedMs = ref(0)
let abortCtl: AbortController | null = null
let timerId: ReturnType<typeof setInterval> | null = null

function startTimer() {
  const t0 = Date.now()
  elapsedMs.value = 0
  stopTimer()
  timerId = setInterval(() => { elapsedMs.value = Date.now() - t0 }, 100)
}
function stopTimer() {
  if (timerId) { clearInterval(timerId); timerId = null }
}

/** Безопасная нормализация частичного объекта из стрима (поля могут отсутствовать). */
function normalizeCard(p: any): IcCard {
  const arr = (v: any) => (Array.isArray(v) ? v.filter(Boolean) : [])
  return {
    role: typeof p?.role === 'string' ? p.role : '',
    intro: arr(p?.intro).filter((q: any) => typeof q === 'string'),
    blocks: arr(p?.blocks).map((b: any) => ({
      competency: b?.competency ?? '',
      rationale: b?.rationale ?? '',
      questions: arr(b?.questions).map((q: any) => ({
        question: q?.question ?? '',
        listenFor: q?.listenFor ?? '',
        redFlag: q?.redFlag ?? undefined,
      })),
    })),
    finalChecks: arr(p?.finalChecks).filter((q: any) => typeof q === 'string'),
  }
}

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
    card.value = null
    meta.value = null
    startTimer()
    const payload = {
      text: pageText.value.slice(0, 80_000),
      title: pageCtx.value?.title || undefined,
      sourceUrl: pageCtx.value?.canonical || pageCtx.value?.url || currentUrl.value || undefined,
      jobId: selectedJobId.value || undefined,
    }
    abortCtl = new AbortController()
    try {
      // П4: SSE-стрим — блоки карточки появляются по мере генерации
      const final = await sseRequest(
        '/api/extension/interview-card',
        { ...payload, stream: true },
        (obj) => { if (obj.partial) card.value = normalizeCard(obj.partial) },
        abortCtl.signal,
      )
      if (final?.card) {
        card.value = normalizeCard(final.card)
        meta.value = final.meta ?? null
        state.value = 'done'
      }
      else {
        errorMsg.value = 'Не удалось составить карточку интервью'
        state.value = 'error'
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || abortCtl?.signal.aborted) {
        // Остановлено пользователем: оставляем частичную карточку, если она есть
        state.value = card.value?.role ? 'done' : 'idle'
      }
      else {
        // Фолбэк: блокирующий запрос через background (без стрима)
        const resp = await send({ type: 'interviewCard', ...payload })
        if (resp?.ok && resp.data?.card) {
          card.value = normalizeCard(resp.data.card)
          meta.value = resp.data.meta ?? null
          state.value = 'done'
        }
        else {
          errorMsg.value = resp?.message || e?.message || 'Не удалось составить карточку интервью'
          state.value = 'error'
        }
      }
    } finally {
      stopTimer()
      abortCtl = null
    }
  }

  /** П6: остановить генерацию. */
  function stop() {
    abortCtl?.abort()
  }

  function reset() {
    abortCtl?.abort()
    stopTimer()
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
    state, card, meta, errorMsg, savingNote, noteSaved, elapsedMs,
    pageText, hasText, canSaveToAts,
    run, stop, reset, exportMarkdown, saveToAts, copyCard,
  }
}
