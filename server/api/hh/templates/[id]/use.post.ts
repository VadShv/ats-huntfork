/**
 * POST /api/hh/templates/:id/use
 *
 * Publish a vacancy to hh.ru using a template. Merges user overrides
 * (title, salary, area, etc.) on top of the stored vacancyData, then
 * POSTs to hh.ru /vacancies.
 *
 * Body: { overrides?: Partial<HhVacancyData> }
 * Returns: { hhVacancyId, url }
 */
import { and, eq } from 'drizzle-orm'
import { hhVacancyTemplate, hhActionLog } from '../../../../database/schema'
import { apiRequest } from '../../../../utils/hh/client'
import { getHhSession } from '../../../../utils/hh/session'
import { withHhRetry } from '../../../../utils/hh/rateLimiter'
import { HhIntegrationError } from '../../../../utils/hh/errors'

export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { job: ['create'] })
  const orgId = session.activeOrganizationId
  const templateId = getRouterParam(event, 'id')

  if (!templateId) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан ID шаблона' })
  }

  // 1. Load template
  const [tpl] = await db
    .select()
    .from(hhVacancyTemplate)
    .where(and(eq(hhVacancyTemplate.id, templateId), eq(hhVacancyTemplate.organizationId, orgId)))
    .limit(1)
  if (!tpl) {
    throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })
  }

  // 2. Merge overrides
  const body = await readBody<{ overrides?: Record<string, unknown> }>(event)
  const vacancyBody = { ...(tpl.vacancyData as Record<string, unknown>), ...(body?.overrides ?? {}) }

  // 3. Get hh.ru session
  let hh
  try {
    hh = await getHhSession(orgId, user.id)
  }
  catch (err) {
    if (err instanceof HhIntegrationError) throw err.toH3Error()
    throw err
  }

  // 4. Publish to hh.ru
  let result: { status: number, body: { id?: string, alternate_url?: string } | null }
  try {
    result = await withHhRetry(() =>
      apiRequest<{ id: string, alternate_url: string }>(
        'POST',
        '/vacancies',
        hh.accessToken,
        { body: vacancyBody },
        hh.config,
      ),
    )
  }
  catch (err) {
    const hhStatus = (err as Error & { status?: number }).status
    // Log the failure
    await db.insert(hhActionLog).values({
      organizationId: orgId,
      hhAccountId: hh.accountId,
      actionType: 'publish_from_template',
      requestPayload: vacancyBody,
      responseStatus: hhStatus ?? null,
      error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      performedByUserId: user.id,
    })
    throw createError({
      statusCode: 502,
      statusMessage: `Ошибка публикации на hh.ru: ${hhStatus ?? 'unknown'}`,
    })
  }

  // 5. Update template lastUsedAt
  await db
    .update(hhVacancyTemplate)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(hhVacancyTemplate.id, templateId))

  // 6. Log success
  await db.insert(hhActionLog).values({
    organizationId: orgId,
    hhAccountId: hh.accountId,
    actionType: 'publish_from_template',
    requestPayload: vacancyBody,
    responseStatus: result.status,
    responseBody: result.body,
    performedByUserId: user.id,
  })

  return {
    hhVacancyId: result.body?.id ?? null,
    url: result.body?.alternate_url ?? null,
  }
})
