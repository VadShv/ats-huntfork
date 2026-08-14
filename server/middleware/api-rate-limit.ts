import { createRateLimiter } from '../utils/rateLimit'

const SAFE_METHODS = new Set(['GET', 'HEAD'])
const SKIP_METHODS = new Set(['OPTIONS'])

// Baseline global API limits (per IP). Реальные рекрутеры в SPA легко выбивают 300/мин:
// один открытый KAM = ~6 параллельных fetch'ей + автодогрузка откликов
// + watch'еры при переключении вкладок Pipeline/Table.
const globalReadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 1200,
  message: 'Слишком много запросов к API. Повторите попытку немного позже',
})

const globalWriteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 200,
  message: 'Слишком много запросов на запись. Повторите попытку немного позже',
})

// Auth endpoints get their own buckets to reduce brute-force risk without
// starving the rest of the API traffic from the same IP.
const authReadLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxRequests: 600,
  message: 'Слишком много запросов на вход. Повторите попытку немного позже',
})

const authWriteLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxRequests: 40,
  message: 'Слишком много попыток входа. Подождите перед следующей попыткой',
})

export default defineEventHandler(async (event) => {
  // Skip all rate limiting in development and CI for E2E test stability
  if (process.env.NODE_ENV !== 'production' || process.env.CI || process.env.GITHUB_ACTIONS) return

  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return

  const method = event.method.toUpperCase()
  if (SKIP_METHODS.has(method)) return

  if (path.startsWith('/api/auth/')) {
    if (SAFE_METHODS.has(method)) {
      await authReadLimiter(event)
      return
    }

    await authWriteLimiter(event)
    return
  }

  if (SAFE_METHODS.has(method)) {
    await globalReadLimiter(event)
    return
  }

  await globalWriteLimiter(event)
})