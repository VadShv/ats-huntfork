/**
 * PUT /api/hh/config
 *
 * Save org-level hh.ru OAuth application credentials entered via the UI.
 * The client secret is AES-256-GCM encrypted at rest. After saving, the
 * "Подключить hh.ru" button becomes available (configured = true).
 *
 * Body: { clientId, clientSecret, redirectUri, oauthBase?, apiBase?, userAgent? }
 */
import { z } from 'zod'
import { saveHhConfig } from '../../utils/hh/config'

const bodySchema = z.object({
  clientId: z.string().min(1, 'Укажите Client ID'),
  clientSecret: z.string().min(1, 'Укажите Client Secret'),
  redirectUri: z.string().url('Redirect URI должен быть валидным URL'),
  oauthBase: z.string().url().optional().nullable(),
  apiBase: z.string().url().optional().nullable(),
  userAgent: z.string().min(1).optional().nullable(),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })

  const body = await readBody(event)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Некорректные данные',
    })
  }

  const result = await saveHhConfig(session.session.activeOrganizationId, parsed.data)

  return { ok: true, clientIdMasked: result.clientIdMasked }
})
