/**
 * Typed error codes for the hh.ru integration layer.
 *
 * Thrown by server utils, converted to H3 errors at the API boundary
 * via `toH3Error()`. This gives consistent HTTP status codes and
 * machine-readable error codes for the client.
 */

export type HhErrorCode =
  | 'HH_NOT_CONFIGURED'
  | 'HH_NOT_CONNECTED'
  | 'HH_TOKEN_EXPIRED'
  | 'HH_RATE_LIMITED'
  | 'HH_API_ERROR'
  | 'HH_PARTIAL_FAILURE'
  | 'HH_VACANCY_NOT_LINKED'
  | 'HH_NOT_FOUND'

const STATUS_MAP: Record<HhErrorCode, number> = {
  HH_NOT_CONFIGURED: 503,
  HH_NOT_CONNECTED: 400,
  HH_TOKEN_EXPIRED: 401,
  HH_RATE_LIMITED: 429,
  HH_API_ERROR: 502,
  HH_PARTIAL_FAILURE: 207,
  HH_VACANCY_NOT_LINKED: 404,
  HH_NOT_FOUND: 404,
}

export class HhIntegrationError extends Error {
  code: HhErrorCode
  hhStatus?: number
  details?: unknown

  constructor(
    code: HhErrorCode,
    message: string,
    opts?: { hhStatus?: number, details?: unknown },
  ) {
    super(message)
    this.name = 'HhIntegrationError'
    this.code = code
    this.hhStatus = opts?.hhStatus
    this.details = opts?.details
  }

  toH3Error() {
    return createError({
      statusCode: STATUS_MAP[this.code],
      statusMessage: this.message,
      data: { code: this.code, details: this.details },
    })
  }
}
