/**
 * POST /api/extension/lookup
 *
 * S6 Sidekick: проверка «кандидат уже в базе?» по URL текущей страницы
 * (LinkedIn / GitHub / t.me). Дополняет существующий /api/extension/check
 * (который работает только с hh.ru) — сам check не трогаем.
 *
 * Body: { url: string }
 * Ответ: { ok, supported, exists, candidate?: { id, name, addedAt },
 *          matchedBy?: { kind }, history?: [...], applications?: [...] }
 *
 * П3 Sidekick: при найденном кандидате дополнительно возвращаем последние
 * события журнала активности и активные отклики (для амбиент-контекста
 * панели — вместо прежних моков).
 */
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { activityLog, application, candidate, candidateIdentity, job, pipelineStage } from '../../database/schema'
import { normalizeGithub, normalizeLinkedinUrl, normalizeTelegram } from '../../utils/dedup/normalize'
import { getOrgGroupId } from '../../utils/dedup/resolve'
import { createRateLimiter } from '../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  message: 'Слишком много проверок. Подождите немного',
})

const bodySchema = z.object({
  url: z.string().url().max(2000),
})

/** Определяет kind и нормализованное значение идентичности по URL. */
function identityFromUrl(url: string): { kind: 'linkedin' | 'github' | 'telegram', value: string } | null {
  let host = ''
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  }
  catch {
    return null
  }

  if (host.endsWith('linkedin.com') && /\/in\//.test(url)) {
    const v = normalizeLinkedinUrl(url)
    return v ? { kind: 'linkedin', value: v } : null
  }
  if (host === 'github.com') {
    const v = normalizeGithub(url)
    return v ? { kind: 'github', value: v } : null
  }
  if (host === 't.me' || host === 'telegram.me') {
    const v = normalizeTelegram(url)
    return v ? { kind: 'telegram', value: v } : null
  }
  return null
}

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, bodySchema.parse)

  const identity = identityFromUrl(body.url)
  if (!identity) {
    return { ok: true, supported: false, exists: false }
  }

  // Область поиска: группа организаций (как в capture) либо одна организация
  const groupId = await getOrgGroupId(orgId)
  const scope = groupId
    ? eq(candidateIdentity.groupId, groupId)
    : eq(candidateIdentity.organizationId, orgId)

  const rows = await db
    .select({
      candidateId: candidateIdentity.candidateId,
      identityOrgId: candidateIdentity.organizationId,
    })
    .from(candidateIdentity)
    .where(and(
      scope,
      eq(candidateIdentity.kind, identity.kind),
      eq(candidateIdentity.valueNormalized, identity.value),
    ))
    .limit(5)

  // Берём кандидата своей организации в приоритете
  const own = rows.find(r => r.identityOrgId === orgId) ?? rows[0]
  if (!own) {
    return { ok: true, supported: true, exists: false }
  }

  const cand = await db.query.candidate.findFirst({
    where: and(
      eq(candidate.id, own.candidateId),
      eq(candidate.organizationId, orgId),
      eq(candidate.mergeStatus, 'active'),
    ),
    columns: { id: true, firstName: true, lastName: true, createdAt: true },
  })
  if (!cand) {
    return { ok: true, supported: true, exists: false }
  }

  // ─── П3: история активности + текущие отклики кандидата ───
  const [historyRows, appRows] = await Promise.all([
    db
      .select({
        action: activityLog.action,
        actorId: activityLog.actorId,
        createdAt: activityLog.createdAt,
      })
      .from(activityLog)
      .where(and(
        eq(activityLog.organizationId, orgId),
        eq(activityLog.resourceType, 'candidate'),
        eq(activityLog.resourceId, cand.id),
      ))
      .orderBy(desc(activityLog.createdAt))
      .limit(6),
    db
      .select({
        id: application.id,
        status: application.status,
        stageChangedAt: application.stageChangedAt,
        jobTitle: job.title,
        stageName: pipelineStage.name,
      })
      .from(application)
      .innerJoin(job, eq(application.jobId, job.id))
      .leftJoin(pipelineStage, eq(application.currentStageId, pipelineStage.id))
      .where(and(
        eq(application.candidateId, cand.id),
        eq(application.organizationId, orgId),
      ))
      .orderBy(desc(application.updatedAt))
      .limit(4),
  ])

  logApiRequest(event, session, 'extension.lookup', { kind: identity.kind, exists: true })

  return {
    ok: true,
    supported: true,
    exists: true,
    candidate: {
      id: cand.id,
      name: [cand.lastName, cand.firstName].filter(Boolean).join(' ') || 'Без имени',
      addedAt: cand.createdAt,
    },
    matchedBy: { kind: identity.kind },
    history: historyRows.map(h => ({
      action: h.action,
      system: !h.actorId,
      at: h.createdAt,
    })),
    applications: appRows.map(a => ({
      id: a.id,
      status: a.status,
      jobTitle: a.jobTitle,
      stageName: a.stageName,
      stageChangedAt: a.stageChangedAt,
    })),
  }
})
