import { sql, type SQL } from 'drizzle-orm'
import { resolveRecruiterScope, type RecruiterScope } from '../recruiterScope'

/**
 * Центр аналитики: единый скоуп видимости для всех /api/analytics/* эндпоинтов.
 *
 * Роль member (рекрутер) видит только назначенные ему вакансии; owner/admin —
 * всю организацию. hiring_manager сюда не попадает (отсечён requirePermission).
 *
 * Это дефолтный фильтр видимости рабочих экранов, а не граница безопасности
 * (member имеет application:read на всю орг). Но для аналитики мы намеренно
 * сужаем выдачу, чтобы рекрутер видел «свою» картину.
 */

export interface AnalyticsScope extends RecruiterScope {
  /**
   * WHERE-условие для колонки job_id (alias.job_id). null — ограничение не нужно
   * (owner/admin). Для scoped-рекрутера без вакансий даёт заведомо ложное условие,
   * чтобы выдача была пустой, а не «вся орг».
   */
  jobIdCondition(alias: string): SQL | null
}

/**
 * Резолвит аналитический скоуп пользователя.
 * @param override 'mine' | 'all' — явный выбор клиента (обычно не используется в аналитике)
 */
export async function resolveAnalyticsScope(
  orgId: string,
  userId: string,
  override?: 'mine' | 'all',
): Promise<AnalyticsScope> {
  const scope = await resolveRecruiterScope(orgId, userId, override)

  return {
    ...scope,
    jobIdCondition(alias: string): SQL | null {
      if (!scope.scoped) return null
      const a = sql.raw(alias)
      if (scope.jobIds.length === 0) {
        // Рекрутер без назначенных вакансий → пустая выдача (а не вся орг).
        return sql`${a}.job_id = '__none__'`
      }
      return sql`${a}.job_id IN (${sql.join(scope.jobIds.map(id => sql`${id}`), sql`, `)})`
    },
  }
}

/** Только admin/owner: бросает 403 для рекрутера/НМ (для раздела сравнения рекрутеров). */
export function assertOrgAdmin(role: string | null): void {
  if (role !== 'owner' && role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Доступ только для администраторов организации' })
  }
}
