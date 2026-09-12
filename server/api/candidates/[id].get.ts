import { eq, and, or, count, inArray } from 'drizzle-orm'
import { candidate, candidateDuplicateCandidate, candidateResumeVersion } from '../../database/schema'
import { candidateIdParamSchema } from '../../utils/schemas/candidate'
import { loadPropertyEntriesForEntity } from '../../utils/properties'
import { getActorContext } from '../../utils/access/actorContext'
import { isCandidateInScope } from '../../utils/access/scope'
import { maskCandidate } from '../../utils/access/mask'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const actor = await getActorContext(event)

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  // Scope guard: out-of-scope (or cross-org) candidate → 404 (do not confirm
  // existence). Unrestricted actors (owner/admin/org scope) pass through.
  if (actor && !(await isCandidateInScope(actor, id))) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

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
      // Единообразие резюме: нужен только факт наличия и источник — сам raw вырезаем из ответа ниже.
      hhResumeRaw: true,
      aiSummary: true,
      aiSummaryAt: true,
      fraudFlag: true,
      fraudReason: true,
      fraudFlaggedAt: true,
      fraudFlaggedByUserId: true,
      fraudNotes: true,
      mergeStatus: true,
      mergedIntoId: true,
      manualReviewOnly: true,
      createdAt: true,
      updatedAt: true,
    },
    with: {
      applications: {
        columns: { id: true, status: true, createdAt: true, source: true, externalUrl: true, score: true, currentStageId: true, resumeVersionId: true },
        with: {
          job: {
            columns: { id: true, title: true },
          },
          // Аудит синхронизации (Н-6): этап воронки для бейджа на странице кандидата
          currentStage: {
            columns: { id: true, name: true, color: true, type: true },
          },
          // NB: resumeVersion не через with (uuid/text несовместимость на проде) —
          // подтягиваем отдельным запросом ниже.
        },
        orderBy: (application, { desc }) => [desc(application.createdAt)],
      },
      documents: {
        columns: { id: true, type: true, originalFilename: true, mimeType: true, sizeBytes: true, previewStorageKey: true, parsedContent: true, createdAt: true },
        orderBy: (document, { desc }) => [desc(document.createdAt)],
      },
    },
  })

  // Подтянуть versionNumber для откликов с resumeVersionId (отдельный запрос —
  // т.к. candidate_resume_version.id на проде uuid, а application.resume_version_id text,
  // и Drizzle JOIN падает с "operator does not exist: uuid = text").
  const versionIds = (result.applications ?? [])
    .map((a: any) => a.resumeVersionId)
    .filter((v: string | null): v is string => v != null)
  const versionMap = new Map<string, number>()
  if (versionIds.length) {
    const versions = await db.query.candidateResumeVersion.findMany({
      where: inArray(candidateResumeVersion.id, versionIds),
      columns: { id: true, versionNumber: true },
    })
    for (const v of versions) versionMap.set(v.id, v.versionNumber)
  }
  for (const app of (result.applications ?? [])) {
    ;(app as any).resumeVersion = app.resumeVersionId == null
      ? null
      : versionMap.has(app.resumeVersionId)
        ? { id: app.resumeVersionId, versionNumber: versionMap.get(app.resumeVersionId)! }
        : null
  }

  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  // Replace heavy parsedContent with a lightweight `parsed` boolean
  const { documents, hhResumeRaw, ...rest } = result

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

  // Единообразие резюме: структура может быть не только с hh (hhResumeId),
  // но и из разбора загруженного файла (_hf.source = 'document_parse').
  const resumeSource = hhResumeRaw
    ? ((hhResumeRaw as { _hf?: { source?: string } })._hf?.source === 'document_parse' ? 'document' : 'hh')
    : null

  // Field masking (masking-on-output by default): null out contacts/salary the
  // actor may not read and report them in `_masked`. hhResumeRaw is already
  // stripped above; contacts (email/phone/telegram/…) live in `rest`.
  const payload = {
    ...rest,
    hasResumeSnapshot: hhResumeRaw != null,
    resumeSource,
    documents: documents.map(({ parsedContent, previewStorageKey, ...doc }) => ({
      ...doc,
      parsed: parsedContent != null,
      // Доступно ли inline-превью (PDF-оригинал или сконвертированный preview-PDF).
      previewAvailable: doc.mimeType === 'application/pdf' || previewStorageKey != null,
    })),
    properties,
    fuzzyDuplicatesCount: Number(dupCount?.value ?? 0),
  }

  return maskCandidate(actor, payload)
})
