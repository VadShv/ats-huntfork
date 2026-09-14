import { and, desc, eq } from 'drizzle-orm'
import { careMethodology } from '../../../database/schema'
import { updateMethodologySchema } from '../../../utils/schemas/care'
import { ensureCareMethodology } from '../../../utils/questions/seedCareMethodology'

/**
 * PUT /api/question-bank/care/methodology — сохранить изменения методики.
 * Создаёт НОВУЮ версию (иммутабельность прошлых), делает её активной. manage_care.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_care'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, updateMethodologySchema.parse)

  const current = await ensureCareMethodology(orgId, session.user.id)

  return db.transaction(async (tx) => {
    // Следующий номер версии.
    const [latest] = await tx.select({ version: careMethodology.version })
      .from(careMethodology)
      .where(eq(careMethodology.organizationId, orgId))
      .orderBy(desc(careMethodology.version))
      .limit(1)
    const nextVersion = (latest?.version ?? 0) + 1

    // Снять активность со всех.
    await tx.update(careMethodology)
      .set({ isActive: false })
      .where(and(eq(careMethodology.organizationId, orgId), eq(careMethodology.isActive, true)))

    const [created] = await tx.insert(careMethodology).values({
      organizationId: orgId,
      version: nextVersion,
      isActive: true,
      title: body.title ?? current.title,
      description: body.description !== undefined ? body.description : current.description,
      interviewerInstruction: body.interviewerInstruction !== undefined ? body.interviewerInstruction : current.interviewerInstruction,
      sufficiencyCriteria: body.sufficiencyCriteria ?? current.sufficiencyCriteria,
      probeRules: current.probeRules, // snapshot переносится; обновляется через триггеры
      probeLimitPerElement: body.probeLimitPerElement ?? current.probeLimitPerElement,
      probeLimitPerQuestion: body.probeLimitPerQuestion ?? current.probeLimitPerQuestion,
      changeNote: body.changeNote ?? null,
      createdById: session.user.id,
      publishedAt: new Date(),
    }).returning()
    return created
  })
})
