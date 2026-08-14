import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

interface UpdateResult {
  success: boolean
  message: string
  previousVersion: string | null
  steps: { step: string; status: 'success' | 'failed'; detail?: string }[]
}

/**
 * POST /api/updates/apply
 *
 * Triggers a self-hosted update via Docker Compose.
 * This endpoint orchestrates the update process:
 *   1. Pulls latest code from the default branch
 *   2. Rebuilds the Docker containers
 *   3. Restarts the application
 *
 * Only works for Docker-based deployments. Railway deployments
 * auto-update via GitHub integration.
 *
 * Requires authentication (owner only).
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { organization: ['delete'] })

  const steps: UpdateResult['steps'] = []

  // Read current version before update
  const { readFile } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  let previousVersion: string | null = null
  try {
    const pkg = await readFile(resolve(process.cwd(), 'package.json'), 'utf-8')
    previousVersion = JSON.parse(pkg).version
  }
  catch {
    previousVersion = null
  }

  // Verify we're running in Docker
  try {
    const { access } = await import('node:fs/promises')
    await access('/.dockerenv')
  }
  catch {
    return {
      success: false,
      message: 'Обновление через интерфейс доступно только для развёртываний в Docker. При других способах развёртывания обновите приложение вручную',
      previousVersion,
      steps: [],
    } satisfies UpdateResult
  }

  // Verify required commands are available
  for (const cmd of ['git', 'docker'] as const) {
    try {
      await execFileAsync('which', [cmd], { timeout: 5_000 })
    }
    catch {
      return {
        success: false,
        message: `Команда «${cmd}» недоступна в контейнере. Для обновления в один клик в образе контейнера должны быть установлены git и Docker CLI, а сокет Docker должен быть подключён. Обновите приложение вручную`,
        previousVersion,
        steps: [],
      } satisfies UpdateResult
    }
  }

  // Step 1: Pull latest changes
  try {
    const { stdout } = await execFileAsync('git', ['pull', 'origin', 'main'], {
      cwd: '/app',
      timeout: 120_000,
    })
    steps.push({
      step: 'Pull latest code',
      status: 'success',
      detail: stdout.trim(),
    })
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка'
    steps.push({ step: 'Pull latest code', status: 'failed', detail: message })
    return {
      success: false,
      message: 'Не удалось получить последнюю версию кода. Проверьте подключение к сети и повторите попытку',
      previousVersion,
      steps,
    } satisfies UpdateResult
  }

  // Step 2: Rebuild and restart via Docker Compose
  try {
    const { stdout } = await execFileAsync(
      'docker', ['compose', 'up', '--build', '--detach', '--no-deps', 'app'],
      {
        cwd: '/app',
        timeout: 600_000, // 10 minutes for build
      },
    )
    steps.push({
      step: 'Rebuild & restart',
      status: 'success',
      detail: stdout.trim(),
    })
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка'
    steps.push({ step: 'Rebuild & restart', status: 'failed', detail: message })
    return {
      success: false,
      message: 'Не удалось пересобрать приложение. Текущая версия продолжает работать. Обновите вручную',
      previousVersion,
      steps,
    } satisfies UpdateResult
  }

  return {
    success: true,
    message: 'Обновление запущено. Приложение скоро перезапустится. Обновите страницу примерно через 30 секунд',
    previousVersion,
    steps,
  } satisfies UpdateResult
})
