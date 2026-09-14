import { and, eq, inArray } from 'drizzle-orm'
import { careProbeTrigger } from '../../../database/schema'
import { replaceTriggersSchema } from '../../../utils/schemas/care'

/**
 * PUT /api/question-bank/care/triggers — сохранить набор триггеров (bulk).
 * Builtin-триггеры не удаляются физически (можно менять isActive/порядок);
 * пользовательские без id создаются, отсутствующие в наборе — удаляются. manage_care.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_care'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, replaceTriggersSchema.parse)

  return db.transaction(async (tx) => {
    const existing = await tx.query.careProbeTrigger.findMany({
      where: eq(careProbeTrigger.organizationId, orgId),
    })
    const existingById = new Map(existing.map(t => [t.id, t]))
    const keepIds = new Set(body.triggers.map(t => t.id).filter(Boolean) as string[])

    // Удаляем пользовательские (не builtin), которых больше нет в наборе.
    const toDelete = existing
      .filter(t => !t.isBuiltin && !keepIds.has(t.id))
      .map(t => t.id)
    if (toDelete.length) {
      await tx.delete(careProbeTrigger).where(inArray(careProbeTrigger.id, toDelete))
    }

    const result = []
    for (const [i, t] of body.triggers.entries()) {
      if (t.id && existingById.has(t.id)) {
        const [updated] = await tx.update(careProbeTrigger)
          .set({
            trigger: t.trigger,
            recommendedProbe: t.recommendedProbe,
            careElement: t.careElement ?? null,
            isActive: t.isActive,
            displayOrder: t.displayOrder ?? i,
            updatedAt: new Date(),
          })
          .where(and(eq(careProbeTrigger.id, t.id), eq(careProbeTrigger.organizationId, orgId)))
          .returning()
        if (updated) result.push(updated)
      }
      else {
        const [created] = await tx.insert(careProbeTrigger).values({
          organizationId: orgId,
          trigger: t.trigger,
          recommendedProbe: t.recommendedProbe,
          careElement: t.careElement ?? null,
          isBuiltin: false,
          isActive: t.isActive,
          displayOrder: t.displayOrder ?? i,
          createdById: session.user.id,
        }).returning()
        result.push(created)
      }
    }
    return { items: result }
  })
})
