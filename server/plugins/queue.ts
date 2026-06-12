import { FUZZY_QUEUE, processFuzzyJob } from '../utils/dedup/workers/fuzzy-job'
import { getBoss, stopBoss } from '../utils/queue/boss'

/**
 * Стартуем pg-boss и регистрируем воркеров.
 *
 * ВАЖНО: запускается ПОСЛЕ migrations.ts (имя файла идёт позже по алфавиту).
 * Это сознательно: pg-boss автоматически создаёт свою схему `pgboss` на старте,
 * и если миграции ещё не пробежали, это не критично — но порядок предсказуемее.
 *
 * Build-time prerender пропускает плагин (нет DATABASE_URL).
 */
export default defineNitroPlugin(async (nitroApp) => {
  if (import.meta.prerender) return

  // Railway/Yandex Cloud — env инжектится только при run, не при build
  if (!process.env.DATABASE_URL) {
    logWarn('queue.start_skipped_no_dsn')
    return
  }

  try {
    const boss = await getBoss()

    // Создаём очередь (идемпотентно: повторный вызов — no-op)
    // В pg-boss 10 нужно явно регистрировать очереди перед send/work
    try {
      await boss.createQueue(FUZZY_QUEUE)
    }
    catch (err) {
      // createQueue может не существовать в старых версиях — игнорируем,
      // work() сам создаст таблицу на лету
      logDebug('queue.create_queue_skipped', {
        queue: FUZZY_QUEUE,
        error_message: err instanceof Error ? err.message : String(err),
      })
    }

    // Один воркер на инстанс, до 4 параллельных задач (тяжёлый CPU+SQL)
    await boss.work(
      FUZZY_QUEUE,
      { batchSize: 1, teamSize: 4, teamConcurrency: 4 } as any,
      processFuzzyJob as any,
    )

    logInfo('queue.workers_registered', { queue: FUZZY_QUEUE })

    // Graceful shutdown
    nitroApp.hooks.hook('close', async () => {
      await stopBoss()
    })
  }
  catch (err) {
    logError('queue.start_failed', {
      error_message: err instanceof Error ? err.message : String(err),
    })
    // Не валим запуск приложения целиком — без очереди fuzzy-детект
    // деградирует в синхронный fallback (см. enqueueFuzzyDetect catch).
  }
})
