/**
 * Nitro scheduled task: очистка журнала расхода ИИ старше retention_days организации.
 * docs/tz-ai-usage.md §4.3. Агрегаты за прошлые периоды при этом теряются —
 * срок по умолчанию 400 дней покрывает сравнение «год к году».
 */
import { sql } from 'drizzle-orm'

export default defineTask({
  meta: { name: 'ai-usage:retention', description: 'Purge old AI usage events' },
  async run() {
    const res = await db.execute(sql`
      DELETE FROM ai_usage_event e
      USING (
        SELECT o.id AS organization_id, COALESCE(s.retention_days, 400) AS days
        FROM organization o
        LEFT JOIN ai_usage_settings s ON s.organization_id = o.id
      ) r
      WHERE e.organization_id = r.organization_id
        AND e.created_at < now() - make_interval(days => r.days)
    `)
    const deleted = (res as unknown as { count?: number }).count ?? 0
    logInfo('ai_usage.retention_done', { deleted: String(deleted) })
    return { result: { deleted } }
  },
})
