import { candidate } from '../../database/schema'
import { findDuplicatesForDraft } from '../../utils/dedup/check'
import { extractIdentitiesFromCandidateRow } from '../../utils/dedup/extract'
import { getOrgGroupId, upsertCandidateIdentities } from '../../utils/dedup/resolve'
import { enqueueFuzzyDetect } from '../../utils/dedup/workers/fuzzy-job'
import { createCandidateSchema } from '../../utils/schemas/candidate'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, createCandidateSchema.parse)
  const force = body.force === true

  // ─── 1. Дедуп: ищем дубликаты по сырым данным
  const dupes = await findDuplicatesForDraft(orgId, {
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone,
    dateOfBirth: body.dateOfBirth,
  })

  // ─── 2. Hard-block по email/phone (force не помогает)
  if (dupes.exact.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'duplicate_exact',
      data: {
        code: 'duplicate_exact',
        message: 'Кандидат с таким email или телефоном уже существует',
        exact: dupes.exact,
        fuzzy: dupes.fuzzy,
      },
    })
  }

  // ─── 3. High-score fuzzy ≥95: требуем явное подтверждение через force=true
  const hardFuzzy = dupes.fuzzy.filter(f => f.score >= 95)
  if (hardFuzzy.length > 0 && !force) {
    throw createError({
      statusCode: 409,
      statusMessage: 'duplicate_fuzzy',
      data: {
        code: 'duplicate_fuzzy',
        message: 'Похоже, кандидат уже есть в базе',
        exact: [],
        fuzzy: dupes.fuzzy,
      },
    })
  }

  // ─── 4. Создаём кандидата
  const [created] = await db.insert(candidate).values({
    organizationId: orgId,
    firstName: body.firstName,
    lastName: body.lastName,
    displayName: body.displayName ?? null,
    email: body.email,
    phone: body.phone,
    gender: body.gender ?? null,
    dateOfBirth: body.dateOfBirth ?? null,
    quickNotes: body.quickNotes ?? null,
    // Sprint 3.3 (P2.2)
    city: body.city ?? null,
    // Sprint 3.4 (P2.3): соцсети
    linkedin: body.linkedin ?? null,
    telegram: body.telegram ?? null,
    github: body.github ?? null,
  }).returning({
    id: candidate.id,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    displayName: candidate.displayName,
    email: candidate.email,
    phone: candidate.phone,
    gender: candidate.gender,
    dateOfBirth: candidate.dateOfBirth,
    city: candidate.city,
    linkedin: candidate.linkedin,
    telegram: candidate.telegram,
    github: candidate.github,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось создать кандидата' })
  }

  // ─── 5. Identity-записи (email/phone/linkedin/telegram/github) — для участия в дедупе
  const signals = extractIdentitiesFromCandidateRow({
    email: body.email,
    phone: body.phone ?? null,
    linkedin: body.linkedin ?? null,
    telegram: body.telegram ?? null,
    github: body.github ?? null,
  })
  const groupId = await getOrgGroupId(orgId)
  if (signals.length > 0) {
    try {
      await upsertCandidateIdentities({
        candidateId: created.id,
        organizationId: orgId,
        groupId,
        signals,
      })
    }
    catch (e) {
      // не валим создание из-за identity — это вторичное
      console.error('[candidates.create] upsertCandidateIdentities failed:', e)
    }
  }

  // ─── 6. Fuzzy-детект в фоне (pg-boss): не блокируем ответ клиенту
  // Пары будут записаны в candidate_duplicate_candidate воркером позже (до ~30с SLA).
  void enqueueFuzzyDetect({
    candidateId: created.id,
    organizationId: orgId,
    includeOtherOrgs: !!groupId,
  })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'candidate',
    resourceId: created.id,
    metadata: { name: `${created.firstName} ${created.lastName}`, forced: force },
  })

  trackEvent(event, session, 'candidate created', {
    candidate_id: created.id,
    forced: force,
  })

  logApiRequest(event, session, 'candidate.created', {
    candidate_id: created.id,
  })

  setResponseStatus(event, 201)
  return created
})
