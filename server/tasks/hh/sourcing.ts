/**
 * Nitro scheduled task: фоновый сорсинг hh.ru.
 *
 * Регистрируется в nuxt.config.ts → nitro.scheduledTasks.
 * Тик каждую минуту: воркер проверяет, какие из hh_saved_search
 * пора запустить (nextRunAt <= now + autoRunEnabled).
 *
 * Семантика «best-effort»: ошибка одного поиска не блокирует остальные.
 */
import { runDueSourcingSearches } from '../../utils/hh/sourcing/runner'

export default defineTask({
  meta: {
    name: 'hh:sourcing',
    description: 'Запуск сорсинг-поисков hh.ru, у которых наступило nextRunAt',
  },
  async run() {
    const startedAt = Date.now()
    try {
      const results = await runDueSourcingSearches()
      if (results.length === 0) {
        return { result: 'ok', searches: 0, durationMs: Date.now() - startedAt }
      }
      const totals = results.reduce((acc, r) => ({
        found: acc.found + r.found,
        new: acc.new + r.new,
        errors: acc.errors + (r.status === 'error' ? 1 : 0),
      }), { found: 0, new: 0, errors: 0 })

      const durationMs = Date.now() - startedAt
      console.log(`[hh:sourcing] OK searches=${results.length} found=${totals.found} new=${totals.new} errors=${totals.errors} duration=${durationMs}ms`)
      return { result: 'ok', searches: results.length, ...totals, durationMs }
    }
    catch (err) {
      console.error('[hh:sourcing] FAILED', err)
      return { result: 'error', error: err instanceof Error ? err.message : String(err) }
    }
  },
})
