/**
 * Rate limiting and retry helpers for hh.ru API calls.
 *
 * hh.ru allows ~30 req/sec. We use conservative concurrency limits
 * and exponential backoff on 429 responses.
 */
import pLimit from 'p-limit'

const defaultLimiter = pLimit(5)
const bulkLimiter = pLimit(3)

/**
 * Run a function through the concurrency limiter.
 * Use mode='bulk' for batch operations (more conservative).
 */
export async function withHhRateLimit<T>(
  fn: () => Promise<T>,
  mode: 'default' | 'bulk' = 'default',
): Promise<T> {
  const limiter = mode === 'bulk' ? bulkLimiter : defaultLimiter
  return limiter(fn)
}

/**
 * Retry with exponential backoff on 429 (rate limited) responses.
 * The hh.ru client throws errors with a `.status` property.
 */
export async function withHhRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelayMs = 5000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    }
    catch (err) {
      const status = (err as Error & { status?: number }).status
      if (status !== 429 || attempt === maxRetries) throw err
      const delay = initialDelayMs * Math.pow(2, attempt)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('withHhRetry: unreachable')
}
