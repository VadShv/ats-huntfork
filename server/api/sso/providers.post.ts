import { z } from 'zod'
import { eq, and, ne } from 'drizzle-orm'
import { ssoProvider } from '~~/server/database/schema'
import { prefetchOidcEndpointOrigins } from '~~/server/utils/auth'

// Hostname/IP ranges that must never be contacted server-side (SSRF prevention)
const BLOCKED_ISSUER_HOSTNAMES = new Set([
  'localhost',
  '169.254.169.254',          // AWS / Azure / DigitalOcean IMDS
  'metadata.google.internal', // GCP IMDS
  'metadata.internal',
  'instance-data',
])

function isBlockedIssuerUrl(url: string): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return true
  }
  if (BLOCKED_ISSUER_HOSTNAMES.has(hostname)) return true
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    if (a === 127 || a === 0) return true
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 169 && b === 254) return true
  }
  if (hostname === '::1') return true
  if (hostname.startsWith('fe80:')) return true
  return false
}

const registerSsoSchema = z.object({
  providerId: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'Only lowercase alphanumeric and hyphens'),
  issuer: z.string().url()
    .refine(
      (url) => url.startsWith('https://') || url.startsWith('http://'),
      'URL издателя должен использовать HTTPS (или HTTP для локальной разработки)',
    )
    .refine(
      (url) => !isBlockedIssuerUrl(url),
      'URL издателя не должен указывать на внутренние или частные сетевые адреса',
    ),
  domain: z.string().min(1).max(253).regex(
    /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
    'Must be a valid domain (e.g. company.com)',
  ),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
})

/**
 * POST /api/sso/providers — register an OIDC SSO provider for the current org.
 * Uses Better Auth's SSO plugin under the hood.
 * Only org owners/admins can register providers.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, registerSsoSchema.parse)

  // Prevent domain hijacking: reject if another org already registered this domain
  const existingDomain = await db
    .select({ id: ssoProvider.id })
    .from(ssoProvider)
    .where(and(eq(ssoProvider.domain, body.domain), ne(ssoProvider.organizationId, orgId)))
    .limit(1)

  if (existingDomain.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Этот домен Email уже зарегистрирован другой организацией',
    })
  }

  // Prevent provider ID collision: reject if providerId already exists
  const existingProvider = await db
    .select({ id: ssoProvider.id })
    .from(ssoProvider)
    .where(eq(ssoProvider.providerId, body.providerId))
    .limit(1)

  if (existingProvider.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Поставщик с таким ID уже существует. Выберите другой ID поставщика',
    })
  }

  try {
    // Pre-discover OIDC endpoint origins so better-auth trusts them during
    // registration. IdPs like Google use separate domains for token/userinfo
    // endpoints (oauth2.googleapis.com) vs their issuer (accounts.google.com).
    await prefetchOidcEndpointOrigins(body.issuer)

    const result = await (auth.api as any).registerSSOProvider({
      headers: event.headers,
      body: {
        providerId: body.providerId,
        issuer: body.issuer,
        domain: body.domain,
        organizationId: orgId,
        oidcConfig: {
          clientId: body.clientId,
          clientSecret: body.clientSecret,
          scopes: ['openid', 'email', 'profile'],
          pkce: true,
        },
      },
    })

    setResponseStatus(event, 201)
    return {
      id: result.id,
      providerId: result.providerId,
      issuer: result.issuer,
      domain: result.domain,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Не удалось зарегистрировать поставщика SSO'

    // Map Better Auth discovery errors to user-friendly messages
    if (message.includes('discovery_not_found')) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Не удалось подключиться к конечной точке обнаружения OIDC. Проверьте правильность URL издателя',
      })
    }
    if (message.includes('discovery_timeout')) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Поставщик идентификации не ответил вовремя. Повторите попытку',
      })
    }
    if (message.includes('issuer_mismatch')) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Издатель в документе обнаружения не соответствует указанному URL издателя',
      })
    }

    throw createError({ statusCode: 400, statusMessage: message })
  }
})
