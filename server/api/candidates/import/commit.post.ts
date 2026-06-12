/**
 * POST /api/candidates/import/commit
 *
 * Sprint 5.4 (P5.4): второй шаг массового импорта.
 * Принимает массив решений (decisions) от UI и для каждой строки выполняет:
 *   • create     — создать нового кандидата (как POST /api/candidates),
 *   • merge_into — дополнить существующего недостающими полями (как enrich),
 *   • skip       — пропустить.
 *
 * Каждое действие — отдельная транзакция try/catch, partial success возвращает
 * ok=false HTTP 200 с details[] по каждой строке.
 *
 * Лимит: ≤ 500 решений за раз.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { candidate } from '../../../database/schema'
import { extractIdentitiesFromCandidateRow } from '../../../utils/dedup/extract'
import { getOrgGroupId, upsertCandidateIdentities } from '../../../utils/dedup/resolve'
import { enqueueFuzzyDetect } from '../../../utils/dedup/workers/fuzzy-job'

const MAX_DECISIONS = 500

const candidateDataCreateSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  /** email обязателен для создания (notNull в schema.candidate) */
  email: z.string().trim().email().max(255).transform(v => v.toLowerCase()),
  phone: z.string().trim().max(50).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  linkedin: z.string().trim().max(255).nullable().optional(),
  telegram: z.string().trim().max(100).nullable().optional(),
  github: z.string().trim().max(100).nullable().optional(),
})

const candidateDataMergeSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  /** email необязателен для merge — может уже быть у целевого кандидата */
  email: z.string().trim().email().max(255).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  linkedin: z.string().trim().max(255).nullable().optional(),
  telegram: z.string().trim().max(100).nullable().optional(),
  github: z.string().trim().max(100).nullable().optional(),
})

const decisionSchema = z.discriminatedUnion('action', [
  z.object({
    rowNumber: z.number().int().min(1),
    action: z.literal('create'),
    candidateData: candidateDataCreateSchema,
  }),
  z.object({
    rowNumber: z.number().int().min(1),
    action: z.literal('merge_into'),
    mergeTargetId: z.string().min(1),
    candidateData: candidateDataMergeSchema,
  }),
  z.object({
    rowNumber: z.number().int().min(1),
    action: z.literal('skip'),
  }),
])

const bodySchema = z.object({
  decisions: z.array(decisionSchema).min(1).max(MAX_DECISIONS),
})

type Decision = z.infer<typeof decisionSchema>

interface DetailItem {
  rowNumber: number
  action: 'create' | 'merge_into' | 'skip'
  status: 'created' | 'merged' | 'skipped' | 'failed'
  candidateId?: string
  message?: string
  /** Поля, которые были дополнены при merge_into. */
  added?: string[]
}

function isEmpty(v: string | null | undefined): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, bodySchema.parse)
  const decisions = body.decisions

  const groupId = await getOrgGroupId(orgId)

  let totalCreated = 0
  let totalMerged = 0
  let totalSkipped = 0
  let totalFailed = 0
  const details: DetailItem[] = []

  for (const d of decisions as Decision[]) {
    if (d.action === 'skip') {
      totalSkipped++
      details.push({ rowNumber: d.rowNumber, action: 'skip', status: 'skipped' })
      continue
    }

    if (d.action === 'create') {
      try {
        const cd = d.candidateData
        const [created] = await db.insert(candidate).values({
          organizationId: orgId,
          firstName: cd.firstName,
          lastName: cd.lastName,
          email: cd.email,
          phone: cd.phone ?? null,
          dateOfBirth: cd.dateOfBirth ?? null,
          city: cd.city ?? null,
          linkedin: cd.linkedin ?? null,
          telegram: cd.telegram ?? null,
          github: cd.github ?? null,
        }).returning({ id: candidate.id })

        if (!created) {
          throw new Error('insert returned empty')
        }

        // Identity-сигналы
        const signals = extractIdentitiesFromCandidateRow({
          email: cd.email,
          phone: cd.phone ?? null,
          linkedin: cd.linkedin ?? null,
          telegram: cd.telegram ?? null,
          github: cd.github ?? null,
        })
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
            console.error('[import.commit] upsertCandidateIdentities failed:', e)
          }
        }

        // Fuzzy-детект в фоне
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
          metadata: { name: `${cd.firstName} ${cd.lastName}`, source: 'bulk_import' },
        })

        totalCreated++
        details.push({
          rowNumber: d.rowNumber,
          action: 'create',
          status: 'created',
          candidateId: created.id,
        })
      }
      catch (err: any) {
        totalFailed++
        details.push({
          rowNumber: d.rowNumber,
          action: 'create',
          status: 'failed',
          message: err?.message ?? 'unknown error',
        })
      }
      continue
    }

    // d.action === 'merge_into'
    try {
      const targetId = d.mergeTargetId
      const cd = d.candidateData

      const [existing] = await db.select().from(candidate)
        .where(eq(candidate.id, targetId))
        .limit(1)

      if (!existing) {
        throw new Error('Целевой кандидат не найден')
      }
      if (existing.organizationId !== orgId) {
        throw new Error('Нет доступа к целевому кандидату')
      }
      if (existing.mergeStatus !== 'active') {
        throw new Error('Целевой кандидат не активен (был слит)')
      }

      const patch: Record<string, unknown> = {}
      const added: string[] = []

      if (cd.phone && isEmpty(existing.phone)) {
        patch.phone = cd.phone
        added.push('phone')
      }
      if (cd.dateOfBirth && isEmpty(existing.dateOfBirth)) {
        patch.dateOfBirth = cd.dateOfBirth
        added.push('dateOfBirth')
      }
      if (cd.city && isEmpty(existing.city)) {
        patch.city = cd.city
        added.push('city')
      }
      if (cd.linkedin && isEmpty(existing.linkedin)) {
        patch.linkedin = cd.linkedin
        added.push('linkedin')
      }
      if (cd.telegram && isEmpty(existing.telegram)) {
        patch.telegram = cd.telegram
        added.push('telegram')
      }
      if (cd.github && isEmpty(existing.github)) {
        patch.github = cd.github
        added.push('github')
      }
      if (cd.email && isEmpty(existing.email)) {
        patch.email = cd.email
        added.push('email')
      }

      if (added.length > 0) {
        ;(patch as any).updatedAt = new Date()
        await db.update(candidate)
          .set(patch)
          .where(and(eq(candidate.id, targetId), eq(candidate.organizationId, orgId)))

        // Если добавили identity-сигналы — обновим candidate_identity тоже
        const newSignals = extractIdentitiesFromCandidateRow({
          email: added.includes('email') ? cd.email ?? null : null,
          phone: added.includes('phone') ? cd.phone ?? null : null,
          linkedin: added.includes('linkedin') ? cd.linkedin ?? null : null,
          telegram: added.includes('telegram') ? cd.telegram ?? null : null,
          github: added.includes('github') ? cd.github ?? null : null,
        })
        if (newSignals.length > 0) {
          try {
            await upsertCandidateIdentities({
              candidateId: targetId,
              organizationId: orgId,
              groupId,
              signals: newSignals,
            })
          }
          catch (e) {
            console.error('[import.commit.merge] upsertCandidateIdentities failed:', e)
          }
        }
      }

      recordActivity({
        organizationId: orgId,
        actorId: session.user.id,
        action: 'updated',
        resourceType: 'candidate',
        resourceId: targetId,
        metadata: {
          kind: 'bulk_import_merge',
          added: added.join(','),
        },
      })

      totalMerged++
      details.push({
        rowNumber: d.rowNumber,
        action: 'merge_into',
        status: 'merged',
        candidateId: targetId,
        added,
      })
    }
    catch (err: any) {
      totalFailed++
      details.push({
        rowNumber: d.rowNumber,
        action: 'merge_into',
        status: 'failed',
        message: err?.message ?? 'unknown error',
      })
    }
  }

  logApiRequest(event, session, 'candidates.import.commit', {
    total_requested: decisions.length,
    total_created: totalCreated,
    total_merged: totalMerged,
    total_skipped: totalSkipped,
    total_failed: totalFailed,
  })

  return {
    ok: totalFailed === 0,
    totalRequested: decisions.length,
    totalCreated,
    totalMerged,
    totalSkipped,
    totalFailed,
    details,
  }
})
