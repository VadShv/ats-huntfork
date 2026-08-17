/**
 * useAmbient — амбиентный статус кандидата.
 *
 * До любого нажатия панель показывает, знаком ли уже этот кандидат:
 * уже в базе, общались 8 месяцев назад, отказ на оффере по деньгам и т.д.
 * Снимает самый дорогой класс ошибок — повторный холодный заход к кандидату,
 * который вас уже знает.
 *
 * Тон:
 *   high — отказ на оффере / конфликт по деньгам  (жёлтый)
 *   mid  — был контакт, но не дошло до оффера      (синий)
 *   low  — просто в базе, без истории             (серый)
 *
 * Источник: lookupInfo.candidate.history + candidate.matchSignals
 * (расширение ответа lookup; пока бэкенд не готов — моки).
 */
import { computed } from 'vue'
import { useSidekick } from './useSidekick'

export type AmbientTone = 'high' | 'mid' | 'low'

export interface AmbientEvent {
  /** ISO-date или относительная строка («8 месяцев назад»). */
  when: string
  /** Что произошло. */
  what: string
  /** Этап воронки, на котором остановились. */
  stage?: string
  /** Причина, если был отказ. */
  reason?: string
}

export interface AmbientState {
  /** Показывать ли полосу вообще. */
  visible: boolean
  tone: AmbientTone
  /** Короткая сводка для тултипа. */
  summary: string
  /** Детальная история для раскрытия. */
  events: AmbientEvent[]
  /** Чем совпал кандидат при дедупликации. */
  matchedOn: string[]
  /** Последний контакт (для «общались N назад»). */
  lastContact?: string
}

/** Мок-данные для демонстрации, пока бэкенд не отдаёт history/matchSignals. */
const MOCK_HIGH: AmbientState = {
  visible: true,
  tone: 'high',
  summary: 'В базе · отказ на оффере по деньгам · 8 мес назад',
  lastContact: '8 месяцев назад',
  matchedOn: ['email', 'телефон'],
  events: [
    { when: '8 месяцев назад', what: 'Оффер', stage: 'Offer', reason: 'деньги (просил +30%)' },
    { when: '9 месяцев назад', what: 'Интервью с нанимающим', stage: 'Interview' },
    { when: '9 месяцев назад', what: 'Скрининг', stage: 'Screening' },
    { when: '10 месяцев назад', what: 'Добавлен в базу', stage: 'New' },
  ],
}

const MOCK_MID: AmbientState = {
  visible: true,
  tone: 'mid',
  summary: 'В базе · был контакт · 3 мес назад',
  lastContact: '3 месяца назад',
  matchedOn: ['LinkedIn'],
  events: [
    { when: '3 месяца назад', what: 'Скрининг', stage: 'Screening', reason: 'не подошёл по стеку' },
    { when: '4 месяца назад', what: 'Добавлен в базу', stage: 'New' },
  ],
}

const MOCK_LOW: AmbientState = {
  visible: true,
  tone: 'low',
  summary: 'Уже в базе · без истории общения',
  matchedOn: ['имя + компания'],
  events: [
    { when: '1 месяц назад', what: 'Добавлен в базу', stage: 'New' },
  ],
}

const EMPTY: AmbientState = { visible: false, tone: 'low', summary: '', events: [], matchedOn: [] }

export function useAmbient() {
  const { lookupInfo, phase } = useSidekick()

  const ambient = computed<AmbientState>(() => {
    // Полоса показывается только когда кандидат найден в базе (exists).
    const info = lookupInfo.value
    if (!info || phase.value !== 'exists') {
      // Если lookupInfo есть, но phase ещё checking — не показываем.
      return EMPTY
    }

    const candidate = info.candidate ?? info
    const history: AmbientEvent[] = candidate.history ?? null
    const matchSignals: string[] = candidate.matchSignals ?? null

    // Реальные данные, если бэкенд их отдаёт.
    if (history && history.length) {
      const hasOfferRefusal = history.some(
        (e) => e.stage === 'Offer' && (e.reason || '').length > 0,
      )
      const tone: AmbientTone = hasOfferRefusal ? 'high' : 'mid'
      const last = history[0]
      return {
        visible: true,
        tone,
        summary: buildSummary(history, tone),
        events: history,
        matchedOn: matchSignals ?? [],
        lastContact: last?.when,
      }
    }

    // Кандидат в базе, но истории нет → low (просто в базе).
    // Пока бэкенд не отдаёт history — используем мок для демонстрации.
    // В проде этот блок убирается и остаётся только MOCK_LOW-логика через matchSignals.
    if (matchSignals && matchSignals.length) {
      return { ...MOCK_LOW, matchedOn: matchSignals }
    }

    // Демонстрационный режим: кандидат существует, но данных по истории нет.
    // Чередуем моки, чтобы UX был виден. В проде — return MOCK_LOW или EMPTY.
    return MOCK_HIGH
  })

  return { ambient }
}

function buildSummary(events: AmbientEvent[], tone: AmbientTone): string {
  const last = events[0]
  const parts = ['В базе']
  if (tone === 'high') {
    const refusal = events.find((e) => e.stage === 'Offer' && e.reason)
    if (refusal) parts.push(`отказ на оффере (${refusal.reason})`)
  } else if (tone === 'mid') {
    parts.push('был контакт')
  }
  if (last?.when) parts.push(last.when)
  return parts.join(' · ')
}
