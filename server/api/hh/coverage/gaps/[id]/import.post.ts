/**
 * POST /api/hh/coverage/gaps/:id/import
 *
 * Import a specific coverage gap — re-sync the vacancy link to pull
 * the missing negotiation from hh.ru.
 */
import { importGap } from '../../../../../utils/hh/coverage'

export default defineEventHandler(async (event) => {
  await requirePermission(event, { hhNegotiation: ['import'] })
  const gapId = getRouterParam(event, 'id')

  if (!gapId) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан ID gap' })
  }

  try {
    const result = await importGap(gapId)
    return { success: true, ...result }
  }
  catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : String(err),
    })
  }
})
