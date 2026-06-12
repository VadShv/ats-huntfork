import { eq, and } from 'drizzle-orm'
import { candidate } from '../../database/schema'
import { extractIdentitiesFromCandidateRow } from '../../utils/dedup/extract'
import { getOrgGroupId, upsertCandidateIdentities } from '../../utils/dedup/resolve'
import { enqueueFuzzyDetect } from '../../utils/dedup/workers/fuzzy-job'
import { candidateIdParamSchema, updateCandidateSchema } from '../../utils/schemas/candidate'

/**
 * Sprint 3.5 (P2.4): поля, влияющие на fuzzy/exact-дедуп.
 * При их изменении нужно переочередить fuzzy-детект + обновить identity-записи.
 */
const DEDUP_RELEVANT_FIELDS = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'city',
  'email',
  'phone',
  'linkedin',
  'telegram',
  'github',
] as const

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)
  const body = await readValidatedBody(event, updateCandidateSchema.parse)

  // If email is being changed, check uniqueness within the org
  if (body.email) {
    const emailConflict = await db.query.candidate.findFirst({
      where: and(
        eq(candidate.organizationId, orgId),
        eq(candidate.email, body.email),
      ),
      columns: { id: true },
    })

    if (emailConflict && emailConflict.id !== id) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A candidate with this email already exists',
      })
    }
  }

  const [updated] = await db.update(candidate)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(candidate.id, id), eq(candidate.organizationId, orgId)))
    .returning({
      id: candidate.id,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      displayName: candidate.displayName,
      email: candidate.email,
      phone: candidate.phone,
      gender: candidate.gender,
      dateOfBirth: candidate.dateOfBirth,
      quickNotes: candidate.quickNotes,
      city: candidate.city,
      linkedin: candidate.linkedin,
      telegram: candidate.telegram,
      github: candidate.github,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    })

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // ─── Sprint 3.5 (P2.4): пересчёт fuzzy + identity-рефреш при изменении dedup-relevant полей
  const dedupFieldsChanged = DEDUP_RELEVANT_FIELDS.some(f => f in body)
  if (dedupFieldsChanged) {
    // 1. Обновляем identity-записи по актуальным данным
    try {
      const signals = extractIdentitiesFromCandidateRow({
        email: updated.email,
        phone: updated.phone,
        linkedin: updated.linkedin,
        telegram: updated.telegram,
        github: updated.github,
      })
      if (signals.length > 0) {
        const groupId = await getOrgGroupId(orgId)
        await upsertCandidateIdentities({
          candidateId: updated.id,
          organizationId: orgId,
          groupId,
          signals,
        })
      }
    }
    catch (e) {
      console.error('[candidates.update] upsertCandidateIdentities failed:', e)
    }

    // 2. Фоновый fuzzy-пересчёт — не блокирует ответ
    try {
      const groupId = await getOrgGroupId(orgId)
      void enqueueFuzzyDetect({
        candidateId: updated.id,
        organizationId: orgId,
        includeOtherOrgs: !!groupId,
      })
    }
    catch (e) {
      console.error('[candidates.update] enqueueFuzzyDetect failed:', e)
    }
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'candidate',
    resourceId: id,
    metadata: { name: `${updated.firstName} ${updated.lastName}` },
  })

  return updated
})
