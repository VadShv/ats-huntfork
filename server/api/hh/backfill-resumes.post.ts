import { and, eq, isNull, isNotNull, inArray } from 'drizzle-orm'
import { candidate, application, hhVacancyLink, hhAccount, hhNegotiation } from '../../database/schema'
import { apiGet } from '../../utils/hh/client'
import { getValidAccessToken } from '../../utils/hh/tokens'

/**
 * POST /api/hh/backfill-resumes
 *
 * Одноразовый бэкфил: для всех кандидатов в текущей организации, у которых уже
 * есть hh-импортированный отклик (application.source='hh'), но `candidate.hh_resume_raw`
 * пустой — подтягиваем резюме из hh.ru и записываем snapshot.
 *
 * Делается лениво: на каждый кандидат — 1 запрос /resumes/{id}. На больших базах
 * имеет смысл запускать вне пика.
 *
 * Возвращает счётчики: processed/updated/failed.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  // 1) Берём активный hh-аккаунт организации — нужен токен.
  const accountRows = await db.select({ id: hhAccount.id })
    .from(hhAccount)
    .where(and(eq(hhAccount.organizationId, orgId), eq(hhAccount.isActive, true)))
    .limit(1)
  const account = accountRows[0]
  if (!account) {
    throw createError({ statusCode: 422, statusMessage: 'No active hh.ru account for this organization' })
  }
  let token: string
  try {
    token = await getValidAccessToken(account.id)
  }
  catch (err) {
    throw createError({ statusCode: 422, statusMessage: `hh token error: ${err instanceof Error ? err.message : 'unknown'}` })
  }

  // 2) Находим кандидатов без hh_resume_raw, но с hh-applications.
  //    JOIN: candidate ←— application(source=hh) — берём один externalId per candidate
  //    (negotiationId), через который доберёмся до resume.id из hh_negotiation.rawNegotiationJson.
  const candidatesWithoutResume = await db
    .selectDistinct({ candidateId: candidate.id })
    .from(candidate)
    .innerJoin(application, eq(application.candidateId, candidate.id))
    .where(and(
      eq(candidate.organizationId, orgId),
      isNull(candidate.hhResumeRaw),
      eq(application.source, 'hh'),
      isNotNull(application.externalId),
    ))

  const candidateIds = candidatesWithoutResume.map(r => r.candidateId)
  if (candidateIds.length === 0) {
    return { processed: 0, updated: 0, failed: 0, note: 'all candidates already have hh resume snapshot' }
  }

  // 3) Для каждого кандидата находим один negotiation → берём resume.id из raw_negotiation_json.
  //    Используем самый свежий externalId на кандидата.
  const negRows = await db
    .select({
      candidateId: application.candidateId,
      negotiationId: application.externalId,
      raw: hhNegotiation.rawNegotiationJson,
    })
    .from(application)
    .innerJoin(hhNegotiation, eq(hhNegotiation.applicationId, application.id))
    .where(and(
      eq(application.organizationId, orgId),
      eq(application.source, 'hh'),
      inArray(application.candidateId, candidateIds),
    ))

  // Map candidateId → resumeId (берём первый встретившийся; при необходимости можно по дате)
  const candidateToResumeId = new Map<string, string>()
  for (const n of negRows) {
    if (candidateToResumeId.has(n.candidateId)) continue
    const raw = n.raw as any
    const resumeId = raw?.resume?.id
    if (typeof resumeId === 'string' && resumeId) {
      candidateToResumeId.set(n.candidateId, resumeId)
    }
  }

  let updated = 0
  let failed = 0
  const errors: string[] = []

  // Простая последовательная обработка с защитой по лимиту hh (≤ 100 req/sec, но не злоупотребляем)
  for (const [candId, resumeId] of candidateToResumeId) {
    try {
      const resume = await apiGet<Record<string, unknown>>(`/resumes/${resumeId}`, token)
      await db.update(candidate).set({
        hhResumeId: resumeId,
        hhResumeRaw: resume,
        hhResumeFetchedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(candidate.id, candId))
      updated += 1
    }
    catch (err) {
      failed += 1
      const msg = err instanceof Error ? err.message : String(err)
      if (errors.length < 10) errors.push(`${candId}: ${msg}`)
    }
    // Минимальная пауза, чтобы не бомбить hh
    await new Promise(r => setTimeout(r, 50))
  }

  return {
    processed: candidateToResumeId.size,
    updated,
    failed,
    totalNeeded: candidateIds.length,
    skipped: candidateIds.length - candidateToResumeId.size,
    errors,
  }
})
