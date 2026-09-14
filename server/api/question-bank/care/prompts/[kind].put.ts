import { and, desc, eq } from 'drizzle-orm'
import { carePrompt, careMethodology } from '../../../../database/schema'
import { carePromptKindParamSchema, updateCarePromptSchema } from '../../../../utils/schemas/care'
import { ensureCareMethodology } from '../../../../utils/questions/seedCareMethodology'

/**
 * PUT /api/question-bank/care/prompts/:kind — сохранить промпт → новая версия,
 * делается активной. manage_care.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_care'] })
  const orgId = session.session.activeOrganizationId
  const { kind } = await getValidatedRouterParams(event, carePromptKindParamSchema.parse)
  const body = await readValidatedBody(event, updateCarePromptSchema.parse)
  const methodology = await ensureCareMethodology(orgId, session.user.id)

  return db.transaction(async (tx) => {
    const [latest] = await tx.select({ version: carePrompt.version })
      .from(carePrompt)
      .where(and(eq(carePrompt.organizationId, orgId), eq(carePrompt.kind, kind)))
      .orderBy(desc(carePrompt.version))
      .limit(1)
    const nextVersion = (latest?.version ?? 0) + 1

    await tx.update(carePrompt)
      .set({ isActive: false })
      .where(and(eq(carePrompt.organizationId, orgId), eq(carePrompt.kind, kind), eq(carePrompt.isActive, true)))

    const [created] = await tx.insert(carePrompt).values({
      organizationId: orgId,
      kind,
      promptText: body.promptText,
      variables: body.variables,
      version: nextVersion,
      isActive: true,
      methodologyVersion: methodology.version,
      changeNote: body.changeNote ?? null,
      createdById: session.user.id,
      publishedAt: new Date(),
    }).returning()
    return created
  })
})
