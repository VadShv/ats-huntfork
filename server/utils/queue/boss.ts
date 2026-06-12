import PgBoss from 'pg-boss'

/**
 * Singleton-обёртка над pg-boss.
 *
 * pg-boss — фоновая очередь поверх Postgres (без Redis): хранит задачи
 * в системных таблицах `pgboss.*`, поддерживает retry/throttle/concurrency.
 *
 * Используем для тяжёлых неинтерактивных операций, которые не должны
 * замедлять hot-path API (создание кандидата, hh-sync).
 *
 * Связан с тем же DATABASE_URL, что и Drizzle. На первом старте pg-boss
 * автоматически создаёт схему `pgboss` и нужные таблицы.
 */

let _boss: PgBoss | null = null
let _starting: Promise<PgBoss> | null = null

/**
 * Ленивая инициализация. Возвращает уже-запущенный экземпляр или стартует новый.
 * Конкурирующие вызовы (тот же тик) дождутся одного и того же promise.
 */
export async function getBoss(): Promise<PgBoss> {
  if (_boss) return _boss
  if (_starting) return _starting

  _starting = (async () => {
    const dsn = process.env.DATABASE_URL
    if (!dsn) throw new Error('[queue/boss] DATABASE_URL не задан')

    const boss = new PgBoss({
      connectionString: dsn,
      // Хранить выполненные задачи 24ч для отладки, потом archive
      archiveCompletedAfterSeconds: 24 * 3600,
      // Удалять архивированные через 7 дней
      deleteAfterDays: 7,
    })

    boss.on('error', (err: unknown) => {
      console.error('[pg-boss] error:', err)
      logError('queue.boss_error', {
        error_message: err instanceof Error ? err.message : String(err),
      })
    })

    await boss.start()
    _boss = boss
    logInfo('queue.boss_started')
    return boss
  })()

  try {
    return await _starting
  }
  catch (err) {
    _starting = null
    throw err
  }
}

/**
 * Останавливаем боса при graceful shutdown. Вызывается из SIGTERM/SIGINT.
 */
export async function stopBoss(): Promise<void> {
  if (!_boss) return
  try {
    await _boss.stop({ graceful: true, timeout: 5000 })
  }
  catch (err) {
    console.error('[pg-boss] stop error:', err)
  }
  finally {
    _boss = null
    _starting = null
  }
}
