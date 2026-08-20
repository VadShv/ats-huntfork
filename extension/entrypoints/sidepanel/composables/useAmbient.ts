/**
 * useAmbient — амбиентный статус кандидата (П3, реальные данные).
 *
 * До любого нажатия панель показывает, знаком ли уже этот кандидат.
 * Источник: расширенный ответ /api/extension/lookup —
 * matchedBy { kind }, history [{ action, system, at }],
 * applications [{ status, jobTitle, stageName, stageChangedAt }].
 *
 * Тон:
 *   high — есть отклик со статусом rejected/offer (история серьёзная)
 *   mid  — есть активные отклики или события общения
 *   low  — просто в базе, без истории
 *
 * Никаких моков: если данных нет — полоса честно не показывается
 * или показывает «в базе, без истории».
 */
import { computed } from 'vue'
import { useSidekick } from './useSidekick'

export type AmbientTone = 'high' | 'mid' | 'low'

export interface AmbientEvent {
  when: string
  what: string
  stage?: string
  reason?: string
}

export interface AmbientState {
  visible: boolean
  tone: AmbientTone
  summary: string
  events: AmbientEvent[]
  matchedOn: string[]
}

const EMPTY: AmbientState = { visible: false, tone: 'low', summary: '', events: [], matchedOn: [] }

const ACTION_LABELS: Record<string, string> = {
  created: 'Добавлен в базу',
  updated: 'Профиль обновлён',
  status_changed: 'Смена статуса',
  stage_changed: 'Смена этапа',
  comment_added: 'Заметка рекрутёра',
  scored: 'Оценён ИИ',
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Новый',
  screening: 'Скрининг',
  interview: 'Интервью',
  offer: 'Оффер',
  hired: 'Нанят',
  rejected: 'Отказ',
}

const MATCH_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  github: 'GitHub',
  telegram: 'Telegram',
  email: 'email',
  phone: 'телефон',
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 30) return `${days} дн назад`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} мес назад`
  const years = Math.floor(months / 12)
  return `${years} г назад`
}

export function useAmbient() {
  const { lookupInfo, phase } = useSidekick()

  const ambient = computed<AmbientState>(() => {
    const info = lookupInfo.value
    if (!info || phase.value !== 'exists' || !info.exists) return EMPTY

    const history: Array<{ action: string, system: boolean, at: string }> = info.history ?? []
    const applications: Array<{ status: string, jobTitle: string, stageName: string | null, stageChangedAt: string | null }>
      = info.applications ?? []
    const matchedOn = info.matchedBy?.kind
      ? [MATCH_LABELS[info.matchedBy.kind] ?? info.matchedBy.kind]
      : []

    // События: отклики (вакансия + этап) важнее журнала.
    const events: AmbientEvent[] = []
    for (const a of applications) {
      events.push({
        when: relTime(a.stageChangedAt),
        what: `${a.jobTitle} — ${STATUS_LABELS[a.status] ?? a.status}`,
        stage: a.stageName ?? undefined,
      })
    }
    for (const h of history) {
      events.push({
        when: relTime(h.at),
        what: (ACTION_LABELS[h.action] ?? h.action) + (h.system ? ' (система)' : ''),
      })
    }

    const hasSerious = applications.some(a => a.status === 'rejected' || a.status === 'offer')
    const hasContact = applications.length > 0
      || history.some(h => h.action === 'comment_added' || h.action === 'stage_changed' || h.action === 'status_changed')

    const tone: AmbientTone = hasSerious ? 'high' : hasContact ? 'mid' : 'low'

    const parts = ['В базе']
    if (hasSerious) {
      const s = applications.find(a => a.status === 'rejected' || a.status === 'offer')!
      parts.push(`${STATUS_LABELS[s.status] ?? s.status} по «${s.jobTitle}»`)
      const when = relTime(s.stageChangedAt)
      if (when) parts.push(when)
    }
    else if (hasContact) {
      const a = applications[0]
      if (a) {
        parts.push(`в работе по «${a.jobTitle}»`)
        if (a.stageName) parts.push(a.stageName)
      }
      else {
        parts.push('был контакт')
      }
    }
    else {
      parts.push('без истории общения')
      const added = relTime(info.candidate?.addedAt)
      if (added) parts.push(`добавлен ${added}`)
    }

    return {
      visible: true,
      tone,
      summary: parts.join(' · '),
      events,
      matchedOn,
    }
  })

  return { ambient }
}
