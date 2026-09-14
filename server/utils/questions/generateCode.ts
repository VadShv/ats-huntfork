/**
 * Генерация человекочитаемого code для сущностей банка (Спринт 1).
 *   - вопрос банка → "Q-000042"
 *   - тема оценки  → "TOPIC-0042"
 * Уникален в рамках организации. Под advisory-lock во избежание гонок;
 * при коллизии уникального индекса — retry на уровне вызывающего кода.
 * docs/tz-questions-01-org-bank.md §1.3.1
 */
import { sql } from 'drizzle-orm'

/** Минимальный интерфейс исполнителя запросов (db или транзакция tx). */
interface SqlExecutor {
  execute: <T = Record<string, unknown>>(query: ReturnType<typeof sql>) => Promise<T[]>
}

// Стабильные lock-ключи per-entity (произвольные константы).
const LOCK_KEYS: Record<string, number> = {
  bank_question: 771001,
  assessment_topic: 771002,
}

interface CodeSpec {
  table: 'bank_question' | 'assessment_topic'
  prefix: string
  pad: number
}

const SPECS: Record<string, CodeSpec> = {
  bank_question: { table: 'bank_question', prefix: 'Q-', pad: 6 },
  assessment_topic: { table: 'assessment_topic', prefix: 'TOPIC-', pad: 4 },
}

/**
 * Вернуть следующий code для сущности в организации.
 * Должно вызываться ВНУТРИ транзакции создания записи (tx), чтобы advisory-lock
 * держался до коммита. Считает max существующего числового суффикса + 1.
 */
export async function nextEntityCode(
  tx: SqlExecutor,
  entity: 'bank_question' | 'assessment_topic',
  organizationId: string,
): Promise<string> {
  const spec = SPECS[entity]
  const lockKey = LOCK_KEYS[entity]

  // Транзакционный advisory-lock (снимается на коммите/роллбэке).
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`)

  // Считаем текущее количество записей организации как основу счётчика.
  // (Простая и достаточная стратегия для банка; при удалении номера могут
  // переиспользоваться — это допустимо для человекочитаемого кода.)
  const rows = await tx.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM ${sql.raw(`"${spec.table}"`)} WHERE organization_id = ${organizationId}`,
  )
  const next = (rows[0]?.n ?? 0) + 1
  return `${spec.prefix}${String(next).padStart(spec.pad, '0')}`
}
