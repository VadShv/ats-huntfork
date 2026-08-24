/**
 * useVerificationRun — реальная верификация резюме через серверный ИИ (П4).
 *
 * POST /api/extension/verification/run (analysis-контур организации).
 * Отчёт эфемерный: в БД не сохраняется, живёт в панели; можно сохранить
 * заметкой в карточку кандидата, если он найден в базе.
 */
import { ref, computed } from 'vue'
import { useSidekick, useSidekickActions, sseRequest } from './useSidekick'
import { useToast } from './useToast'

export type VfRunState = 'idle' | 'running' | 'done' | 'error'

export interface VfTimelineRow { period: string, place: string, role: string, note?: string, gap?: string }
export interface VfContradiction { claim: string, issue: string, severity: 'high' | 'medium' | 'low' }
export interface VfVerifiability { claim: string, status: 'verifiable' | 'partially' | 'unverifiable', how?: string }
export interface VfRedFlag { flag: string, severity: 'high' | 'medium' | 'low', basis: string }

export interface VfReport {
  summary: string
  timeline: VfTimelineRow[]
  contradictions: VfContradiction[]
  verifiability: VfVerifiability[]
  redFlags: VfRedFlag[]
  questions: string[]
}

const state = ref<VfRunState>('idle')
const report = ref<VfReport | null>(null)
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
function normalizeReport(p: any): VfReport {
  const arr = (v: any) => (Array.isArray(v) ? v.filter(Boolean) : [])
  return {
    summary: typeof p?.summary === 'string' ? p.summary : '',
    timeline: arr(p?.timeline).map((t: any) => ({
      period: t?.period ?? '', place: t?.place ?? '', role: t?.role ?? '',
      note: t?.note ?? undefined, gap: t?.gap ?? undefined,
    })),
    contradictions: arr(p?.contradictions).map((c: any) => ({
      claim: c?.claim ?? '', issue: c?.issue ?? '', severity: c?.severity ?? 'low',
    })),
    verifiability: arr(p?.verifiability).map((v: any) => ({
      claim: v?.claim ?? '', status: v?.status ?? 'partially', how: v?.how ?? undefined,
    })),
    redFlags: arr(p?.redFlags).map((f: any) => ({
      flag: f?.flag ?? '', severity: f?.severity ?? 'low', basis: f?.basis ?? '',
    })),
    questions: arr(p?.questions).filter((q: any) => typeof q === 'string'),
  }
}

export function useVerificationRun() {
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
    report.value = null
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
      // П4: SSE-стрим — секции отчёта появляются по мере генерации
      const final = await sseRequest(
        '/api/extension/verification/run',
        { ...payload, stream: true },
        (obj) => { if (obj.partial) report.value = normalizeReport(obj.partial) },
        abortCtl.signal,
      )
      if (final?.report) {
        report.value = normalizeReport(final.report)
        meta.value = final.meta ?? null
        state.value = 'done'
      }
      else {
        errorMsg.value = 'Не удалось выполнить проверку'
        state.value = 'error'
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || abortCtl?.signal.aborted) {
        // Остановлено пользователем: оставляем частичный отчёт, если он есть
        state.value = report.value?.summary ? 'done' : 'idle'
      }
      else {
        // Фолбэк: блокирующий запрос через background (без стрима)
        const resp = await send({ type: 'verificationRun', ...payload })
        if (resp?.ok && resp.data?.report) {
          report.value = normalizeReport(resp.data.report)
          meta.value = resp.data.meta ?? null
          state.value = 'done'
        }
        else {
          errorMsg.value = resp?.message || e?.message || 'Не удалось выполнить проверку'
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
    report.value = null
    errorMsg.value = ''
    noteSaved.value = false
  }

  /** Markdown-версия отчёта (для заметки и копирования). */
  function exportMarkdown(): string {
    const r = report.value
    if (!r) return ''
    const lines: string[] = ['## Отчёт верификации (Sidekick)', '', r.summary, '']
    if (r.timeline.length) {
      lines.push('### Таймлайн')
      r.timeline.forEach(t => lines.push(`- ${t.period} — ${t.place}, ${t.role}${t.note ? ` (${t.note})` : ''}${t.gap ? ` · пробел: ${t.gap}` : ''}`))
      lines.push('')
    }
    if (r.contradictions.length) {
      lines.push('### Противоречия')
      r.contradictions.forEach(c => lines.push(`- [${c.severity}] ${c.claim} — ${c.issue}`))
      lines.push('')
    }
    if (r.redFlags.length) {
      lines.push('### Ред-флаги')
      r.redFlags.forEach(f => lines.push(`- [${f.severity}] ${f.flag} — ${f.basis}`))
      lines.push('')
    }
    if (r.questions.length) {
      lines.push('### Вопросы к интервью')
      r.questions.forEach(q => lines.push(`- ${q}`))
      lines.push('')
    }
    lines.push('—', 'Это не вывод о добросовестности кандидата и не основание для отказа.')
    return lines.join('\n')
  }

  /** Сохранить отчёт заметкой в карточку кандидата (если найден в базе). */
  async function saveToAts() {
    const candidateId = lookupInfo.value?.candidate?.id
    if (!candidateId || !report.value) return
    savingNote.value = true
    const resp = await send({ type: 'note', candidateId, body: exportMarkdown() })
    savingNote.value = false
    if (resp?.ok) {
      noteSaved.value = true
      toast('Отчёт сохранён заметкой в ATS', 'success')
    }
    else {
      toast(resp?.message || 'Не удалось сохранить заметку', 'error')
    }
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(exportMarkdown())
      toast('Отчёт скопирован', 'success')
    } catch {}
  }

  const canSaveToAts = computed(() => Boolean(lookupInfo.value?.candidate?.id))

  return {
    state, report, meta, errorMsg, savingNote, noteSaved, elapsedMs,
    pageText, hasText, canSaveToAts,
    run, stop, reset, exportMarkdown, saveToAts, copyReport,
  }
}
