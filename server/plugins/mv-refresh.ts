import { db } from '../utils/db'
import { analyticsRefreshState } from '../utils/analytics/refresh-state'

/**
 * Спринт 23 (фундамент аналитики): периодический рефреш материализованного
 * представления mv_application_stage_durations.
 *
 * ВАЖНО: имя файла идёт ПОСЛЕ migrations.ts по алфавиту — плагин стартует,
 * когда миграция 0067 уже создала mv (Nitro-плагины запускаются последовательно).
 *
 * REFRESH ... CONCURRENTLY не блокирует чтение аналитики во время рефреша
 * (требует уникального индекса mv_asd_history_id_uidx — создан в 0067).
 * Без pg_cron: обычный setInterval внутри инстанса приложения; при нескольких
 * инстансах параллельный CONCURRENTLY-рефреш безопасен (Postgres сериализует).
 */
const REFRESH_INTERVAL_MS = 15 * 60 * 1000 // 15 минут

async function refreshAnalyticsMv(reason: 'startup' | 'interval') {
  const startedAt = Date.now()
  try {
    await db.execute(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_application_stage_durations`)
    const durationMs = Date.now() - startedAt
    analyticsRefreshState.lastRefreshAt = new Date()
    analyticsRefreshState.lastDurationMs = durationMs
    console.log(`[Reqcore] analytics mv refreshed (${reason}) in ${durationMs}ms`)
    logInfo('analytics.mv_refreshed', { reason, duration_ms: durationMs })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // В консоль тоже — logError пишет только в PostHog и не виден в docker logs
    console.error(`[Reqcore] analytics mv refresh failed (${reason}): ${message}`)
    logError('analytics.mv_refresh_failed', { reason, error_message: message })
  }
}

export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  if (!process.env.DATABASE_URL) {
    logWarn('analytics.mv_refresh_skipped_no_dsn')
    return
  }

  // Первый рефреш сразу после старта (миграции уже применены плагином migrations.ts).
  // Не await — не задерживаем старт приложения.
  void refreshAnalyticsMv('startup')

  const timer = setInterval(() => { void refreshAnalyticsMv('interval') }, REFRESH_INTERVAL_MS)
  // Не держим event loop открытым ради таймера при завершении процесса
  if (typeof timer.unref === 'function') timer.unref()
})
