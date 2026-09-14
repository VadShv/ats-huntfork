import { questionPreset } from '../../../database/schema'
import { createPresetSchema } from '../../../utils/schemas/preset'
import { sql } from 'drizzle-orm'

/** POST /api/question-bank/presets — создать черновик пресета. create_draft. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['create_draft'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, createPresetSchema.parse)

  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(771003)`)
    const rows = await tx.execute(
      sql`SELECT COUNT(*)::int AS n FROM "question_preset" WHERE organization_id = ${orgId}`,
    ) as unknown as Array<{ n: number }>
    const code = `PRESET-${String((rows[0]?.n ?? 0) + 1).padStart(4, '0')}`
    const [row] = await tx.insert(questionPreset).values({
      organizationId: orgId,
      code,
      name: body.name,
      description: body.description ?? null,
      interviewType: body.interviewType,
      targetRoles: body.targetRoles,
      seniority: body.seniority,
      status: 'draft',
      ownerId: session.user.id,
      createdById: session.user.id,
    }).returning()
    return row
  })

  setResponseStatus(event, 201)
  return created
})
