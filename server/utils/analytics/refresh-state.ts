/**
 * Спринт 23: состояние последнего рефреша mv_application_stage_durations.
 * Обновляется Nitro-плагином mv-refresh.ts, читается /api/analytics/* —
 * для бейджа «данные на HH:MM» в UI аналитики.
 * Инстанс приложения один (docker compose), состояния в памяти достаточно.
 */
export const analyticsRefreshState = {
  lastRefreshAt: null as Date | null,
  lastDurationMs: null as number | null,
}
