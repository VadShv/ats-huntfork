/**
 * useVerificationRun — реальная верификация резюме через серверный ИИ (П4).
 *
 * POST /api/extension/verification/run (analysis-контур организации).
 * Отчёт эфемерный: в БД не сохраняется, живёт в панели; можно сохранить
 * заметкой в карточку кандидата, если он найден в базе.
 */
import { ref, computed } from 'vue'
import { useSidekick, useSidekickActions } from './useSidekick'
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
const meta = ref<{ provider: string | null, model: string | null, generatedAt: string } | null>(null)
const errorMsg = ref('')
const savingNote = ref(false)
const noteSaved = ref(false)

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
    const resp = await send({
      type: 'verificationRun',
      text: pageText.value.slice(0, 80_000),
      title: pageCtx.value?.title || undefined,
      sourceUrl: pageCtx.value?.canonical || pageCtx.value?.url || currentUrl.value || undefined,
      jobId: selectedJobId.value || undefined,
    })
    if (resp?.ok && resp.data?.report) {
      report.value = resp.data.report
      meta.value = resp.data.meta ?? null
      state.value = 'done'
    }
    else {
      errorMsg.value = resp?.message || 'Не удалось выполнить проверку'
      state.value = 'error'
    }
  }

  function reset() {
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
    state, report, meta, errorMsg, savingNote, noteSaved,
    pageText, hasText, canSaveToAts,
    run, reset, exportMarkdown, saveToAts, copyReport,
  }
}
