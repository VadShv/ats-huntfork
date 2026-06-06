import { and, eq, isNotNull } from 'drizzle-orm'
import { application, candidate } from '../../database/schema'

/**
 * Жёсткие причины отказа, при которых кандидата помечаем фрод-флагом автоматически.
 * Хранятся в application.fraud_reason.
 */
export const HARD_FRAUD_REASONS = [
  'blacklist',          // в чёрном списке организации
  'security_incident',  // сорвал интервью/угрозы/инцидент безопасности
  'fake_data',          // указал ложные данные (опыт/образование)
  'other_fraud',        // прочее, классифицированное рекрутером как фрод
] as const

export type HardFraudReason = typeof HARD_FRAUD_REASONS[number]

/** Список значений для UI-селекта с человекочитаемыми лейблами. */
export const HARD_FRAUD_REASONS_RU: Record<HardFraudReason, string> = {
  blacklist: 'Чёрный список',
  security_incident: 'Инцидент безопасности',
  fake_data: 'Ложные данные',
  other_fraud: 'Иной фрод',
}

export function isHardFraudReason(value: string | null | undefined): value is HardFraudReason {
  return !!value && (HARD_FRAUD_REASONS as readonly string[]).includes(value)
}

/**
 * Пересчитывает candidate.fraud_flag на основе всех его application.fraud_reason.
 * Если хотя бы один application с hard fraud reason — выставляем флаг.
 * Если ни одного нет И фрод-флаг был выставлен автоматически (не вручную) — снимаем.
 *
 * Возвращает true, если флаг был изменён.
 */
export async function recomputeFraudFlagForCandidate(
  candidateId: string,
): Promise<{ changed: boolean; flagged: boolean; reason: string | null }> {
  // Сколько у кандидата заявок с жёстким fraud_reason
  const applicationsWithFraud = await db
    .select({ fraudReason: application.fraudReason })
    .from(application)
    .where(and(
      eq(application.candidateId, candidateId),
      isNotNull(application.fraudReason),
    ))

  const hardFraud = applicationsWithFraud.find(a => isHardFraudReason(a.fraudReason))
  const shouldFlag = !!hardFraud
  const detectedReason = hardFraud?.fraudReason ?? null

  // Текущее состояние кандидата
  const [c] = await db
    .select({
      fraudFlag: candidate.fraudFlag,
      fraudReason: candidate.fraudReason,
      fraudFlaggedByUserId: candidate.fraudFlaggedByUserId,
    })
    .from(candidate)
    .where(eq(candidate.id, candidateId))
    .limit(1)
  if (!c) return { changed: false, flagged: false, reason: null }

  // Не трогаем флаг, если он был выставлен вручную (есть fraudFlaggedByUserId)
  const isManual = c.fraudFlag && !!c.fraudFlaggedByUserId
  if (isManual) {
    return { changed: false, flagged: c.fraudFlag, reason: c.fraudReason }
  }

  if (shouldFlag === c.fraudFlag && detectedReason === c.fraudReason) {
    return { changed: false, flagged: c.fraudFlag, reason: c.fraudReason }
  }

  await db
    .update(candidate)
    .set({
      fraudFlag: shouldFlag,
      fraudReason: detectedReason,
      fraudFlaggedAt: shouldFlag ? new Date() : null,
      fraudFlaggedByUserId: null, // auto
      updatedAt: new Date(),
    })
    .where(eq(candidate.id, candidateId))

  return { changed: true, flagged: shouldFlag, reason: detectedReason }
}

/**
 * Ручное выставление/снятие фрод-флага.
 */
export async function setFraudFlagManually(input: {
  candidateId: string
  flag: boolean
  reason?: string | null
  notes?: string | null
  userId: string
}): Promise<void> {
  await db
    .update(candidate)
    .set({
      fraudFlag: input.flag,
      fraudReason: input.flag ? (input.reason ?? 'manual') : null,
      fraudFlaggedAt: input.flag ? new Date() : null,
      fraudFlaggedByUserId: input.flag ? input.userId : null,
      fraudNotes: input.flag ? (input.notes ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(candidate.id, input.candidateId))
}
