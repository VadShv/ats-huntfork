/**
 * Vitest global setup — stubs Nitro auto-imported server utilities
 * that are unavailable outside the Nuxt/Nitro runtime.
 */
import { vi } from 'vitest'

// Stub the structured logger functions (auto-imported from server/utils/logger.ts)
vi.stubGlobal('logInfo', vi.fn())
vi.stubGlobal('logWarn', vi.fn())
vi.stubGlobal('logError', vi.fn())
vi.stubGlobal('logDebug', vi.fn())

// Stub h3's auto-imported createError so server utilities that throw
// createError({ statusCode, statusMessage }) are unit-testable outside Nitro.
// Returns a real Error whose message = statusMessage and carries statusCode/data.
vi.stubGlobal('createError', (input: unknown) => {
  if (typeof input === 'string') return new Error(input)
  const o = (input ?? {}) as { statusCode?: number; statusMessage?: string; message?: string; data?: unknown }
  const err = new Error(o.statusMessage ?? o.message ?? 'Error') as Error & {
    statusCode?: number; statusMessage?: string; data?: unknown
  }
  err.statusCode = o.statusCode
  err.statusMessage = o.statusMessage
  err.data = o.data
  return err
})
