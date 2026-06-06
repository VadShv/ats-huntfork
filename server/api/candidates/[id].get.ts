import { eq, and, or, count } from 'drizzle-orm'
import { candidate, candidateDuplicateCandidate } from '../../database/schema'
import { candidateIdParamSchema } from '../../utils/schemas/candidate'
import { loadPropertyEntriesForEntity } from '../../utils/properties'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  const result = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      email: true,
      phone: true,
      gender: true,
      dateOfBirth: true,
      quickNotes: true,
      hhResumeId: true,
      hhResumeFetchedAt: true,
      aiSummary: true,
      aiSummaryAt: true,
      fraudFlag: true,
      fraudReason: true,
      fraudFlaggedAt: true,
      fraudFlaggedByUserId: true,
      fraudNotes: true,
      mergeStatus: true,
      mergedIntoId: true,
      createdAt: true,
      updatedAt: true,
    },
    with: {
      applications: {
        columns: { id: true, status: true, createdAt: true, source: true, externalUrl: true, score: true, currentStageId: true },
        with: {
          job: {
            columns: { id: true, title: true },
          },
        },
        orderBy: (application, { desc }) => [desc(application.createdAt)],
      },
      documents: {
        columns: { id: true, type: true, originalFilename: true, mimeType: true, parsedContent: true, createdAt: true },
        orderBy: (document, { desc }) => [desc(document.createdAt)],
      },
    },
  })

  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // Replace heavy parsedContent with a lightweight `parsed` boolean
  const { documents, ...rest } = result

  const properties = await loadPropertyEntriesForEntity({
    organizationId: orgId,
    entityType: 'candidate',
    entityId: result.id,
  })

  // Сколько pending fuzzy-дублей у кандидата (для баннера в карточке)
  const [dupCount] = await db
    .select({ value: count() })
    .from(candidateDuplicateCandidate)
    .where(and(
      eq(candidateDuplicateCandidate.status, 'pending'),
      or(
        eq(candidateDuplicateCandidate.candidateIdA, result.id),
        eq(candidateDuplicateCandidate.candidateIdB, result.id),
      )!,
    ))

  return {
    ...rest,
    documents: documents.map(({ parsedContent, ...doc }) => ({
      ...doc,
      parsed: parsedContent != null,
    })),
    properties,
    fuzzyDuplicatesCount: Number(dupCount?.value ?? 0),
  }
})
