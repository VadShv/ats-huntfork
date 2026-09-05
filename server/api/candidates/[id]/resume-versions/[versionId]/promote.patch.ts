import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidate, candidateResumeVersion } from '../../../../../database/schema'
import { refreshCandidateSearchTsv } from '../../../../../utils/candidateSearchText'

const paramsSchema = z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
})

/**
 * PATCH /api/candidates/:id/resume-versions/:versionId/promote
 *
 * Делает выбранную версию резюме канонической (is_current) и синхронизирует
 * candidate.hh_resume_raw из её snapshot — карточка/скоринг/поиск/AI-summary
 * начинают опираться на выбранную версию. Мастер-профиль: рекрутер может
 * вернуть любую прошлую версию как актуальную.
 *
 * Партиал-уникальный индекс (candidate_id) WHERE is_current гарантирует одну
 * текущую версию — снимаем флаг со старой до установки на новую.
 * Права: candidate:update.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id, versionId } = await getValidatedRouterParams(event, paramsSchema.parse)

  // Кандидат принадлежит org.
  const cand = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true },
  })
  if (!cand) throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })

  // Версия принадлежит этому кандидату.
  const target = await db.query.candidateResumeVersion.findFirst({
    where: and(eq(candidateResumeVersion.id, versionId), eq(candidateResumeVersion.candidateId, id)),
    columns: { id: true, versionNumber: true, isCurrent: true, snapshot: true },
  })
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Версия резюме не найдена' })

  if (target.isCurrent) {
    return { ok: true as const, alreadyCurrent: true, versionNumber: target.versionNumber }
  }

  await db.transaction(async (tx) => {
    // Снимаем прежний is_current (до установки нового — важно для partial unique index).
    await tx.update(candidateResumeVersion)
      .set({ isCurrent: false })
      .where(and(
        eq(candidateResumeVersion.candidateId, id),
        eq(candidateResumeVersion.isCurrent, true),
      ))
    await tx.update(candidateResumeVersion)
      .set({ isCurrent: true })
      .where(eq(candidateResumeVersion.id, versionId))
    // Синхронизируем «живое» резюме кандидата со snapshot выбранной версии.
    await tx.update(candidate)
      .set({ hhResumeRaw: target.snapshot as Record<string, unknown>, hhResumeFetchedAt: new Date() })
      .where(and(eq(candidate.id, id), eq(candidate.organizationId, orgId)))
  })

  // Полнотекстовый поиск — в фоне.
  refreshCandidateSearchTsv({ orgId, candidateId: id }).catch(() => {})

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'candidate',
    resourceId: id,
    metadata: { event: 'resume_version_promoted', versionId, versionNumber: target.versionNumber },
  })

  return { ok: true as const, versionNumber: target.versionNumber }
})
