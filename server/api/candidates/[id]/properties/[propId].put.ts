import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidate, propertyDefinition, propertyValue } from '../../../../database/schema'
import { refreshCandidateSearchTsv } from '../../../../utils/candidateSearchText'
import {
  setPropertyValueSchema,
  validateValueForType,
  type PropertyType,
} from '../../../../utils/schemas/property'

const paramsSchema = z.object({ id: z.string().min(1), propId: z.string().min(1) })

/**
 * PUT /api/candidates/:id/properties/:propId
 * Set a property value for a candidate. Body: { value: any }. Passing null clears.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id, propId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { value } = await readValidatedBody(event, setPropertyValueSchema.parse)

  const cand = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true },
  })
  if (!cand) throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })

  const def = await db.query.propertyDefinition.findFirst({
    where: and(
      eq(propertyDefinition.id, propId),
      eq(propertyDefinition.organizationId, orgId),
    ),
  })
  if (!def) throw createError({ statusCode: 404, statusMessage: 'Свойство не найдено' })
  if (def.entityType !== 'candidate') {
    throw createError({ statusCode: 422, statusMessage: 'Это свойство не относится к кандидату' })
  }

  const normalized = validateValueForType(def.type as PropertyType, value, def.config)

  if (normalized === null) {
    await db
      .delete(propertyValue)
      .where(
        and(
          eq(propertyValue.organizationId, orgId),
          eq(propertyValue.propertyDefinitionId, propId),
          eq(propertyValue.entityId, id),
          eq(propertyValue.entityType, 'candidate'),
        ),
      )
    // Обновляем поисковый tsv если это метка (select / multi_select) — любой отказ не блокирует ответ.
    if (def.type === 'select' || def.type === 'multi_select') {
      refreshCandidateSearchTsv({ orgId, candidateId: id }).catch((err) => {
        console.error('[candidates.properties.put] refresh tsv failed', err)
      })
    }
    return { value: null }
  }

  const [row] = await db
    .insert(propertyValue)
    .values({
      organizationId: orgId,
      propertyDefinitionId: propId,
      entityType: 'candidate',
      entityId: id,
      value: normalized as never,
    })
    .onConflictDoUpdate({
      target: [propertyValue.propertyDefinitionId, propertyValue.entityId],
      set: { value: normalized as never, updatedAt: new Date() },
    })
    .returning({ value: propertyValue.value })

  // Синхронизируем full-text индекс если менялась метка.
  if (def.type === 'select' || def.type === 'multi_select') {
    refreshCandidateSearchTsv({ orgId, candidateId: id }).catch((err) => {
      console.error('[candidates.properties.put] refresh tsv failed', err)
    })
  }

  return { value: row?.value ?? normalized }
})
