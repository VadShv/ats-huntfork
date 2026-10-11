/**
 * «Передать коллеге» — полезная нагрузка системной карточки в обсуждении
 * (docs/tz-discussion-referral.md §2.3). Одна и та же структура лежит в
 * application_comment.payload_json (kind = 'system_event') и читается клиентом.
 */

export type ReferralStatus = 'pending' | 'accepted' | 'declined' | 'hired' | 'expired'

export interface ReferralEventPayload {
  event: 'referral'
  /** 'source' — карточка в треде, откуда передали; 'target' — в треде целевого отклика. */
  role: 'source' | 'target'
  referralId: string
  status: ReferralStatus
  fromUserId: string
  fromUserName: string
  toUserId: string
  toUserName: string
  /** Вакансия, на которую рекомендован (null — «без вакансии», выберет получатель). */
  jobId: string | null
  jobTitle: string | null
  note: string | null
  /** Отклик-источник (если передавали из обсуждения). */
  sourceApplicationId: string | null
  /** Отклик на целевой вакансии (есть сразу, если вакансия выбрана; иначе — после принятия). */
  targetApplicationId: string | null
  /** Когда статус изменился последний раз (ISO). */
  resolvedAt?: string | null
}

export function isReferralEventPayload(p: unknown): p is ReferralEventPayload {
  return !!p && typeof p === 'object' && (p as { event?: unknown }).event === 'referral'
}

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  pending: 'ожидает ответа',
  accepted: 'принят',
  declined: 'отклонён',
  hired: 'нанят',
  expired: 'истёк',
}

/**
 * Текст карточки одной строкой — это `body` системного сообщения: он виден в
 * поиске по ленте, в полосе закреплённого и в уведомлениях (где карточка не рендерится).
 */
export function buildReferralBody(p: ReferralEventPayload): string {
  const job = p.jobTitle ? ` на вакансию «${p.jobTitle}»` : ''
  const note = p.note ? ` Комментарий: ${p.note}` : ''
  if (p.role === 'target') {
    return `Кандидат рекомендован: ${p.fromUserName} → ${p.toUserName}${job}.${note}`.trim()
  }
  const status = p.status === 'pending' ? '' : ` (${REFERRAL_STATUS_LABELS[p.status]})`
  return `${p.fromUserName} передал(а) кандидата коллеге ${p.toUserName}${job}${status}.${note}`.trim()
}
