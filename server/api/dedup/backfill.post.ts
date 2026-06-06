import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { candidate, candidateIdentity, organizationGroup } from '../../database/schema'
import { extractIdentitiesFromCandidateRow } from '../../utils/dedup/extract'
import { upsertCandidateIdentities, getOrgGroupId } from '../../utils/dedup/resolve'

const bodySchema = z.object({
  /**
   * Имя группы — будет создана, если не существует. По умолчанию Astra Group.
   */
  groupName: z.string().min(1).default('Astra Group'),
  /**
   * Привязать текущую активную организацию к группе. По умолчанию true.
   */
  attachActiveOrgToGroup: z.boolean().default(true),
  /**
   * Если true — обрабатываем только кандидатов активной org. По умолчанию true.
   * (Если false — обработаем ВСЕХ кандидатов в БД; нужно для root-бэкфила.)
   */
  scopeToActiveOrg: z.boolean().default(true),
  /**
   * Чтобы не запустить повторно по ошибке.
   */
  dryRun: z.boolean().default(false),
})

/**
 * POST /api/dedup/backfill
 *
 * Идемпотентный бэкфил фундамента дедупликации:
 * 1. Создаёт organization_group с указанным именем (если ещё не создан).
 * 2. Привязывает активную организацию к этой группе (если ещё не привязана).
 * 3. По всем кандидатам организации:
 *    - извлекает identity-сигналы (phone, email, hh_owner, hh_resume, linkedin)
 *    - upsert'ит их в candidate_identity (с учётом группы).
 *
 * Безопасно вызывать многократно: existing identities обновляют lastSeenAt.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, bodySchema.parse)

  // ── Шаг 1: создаём/находим группу ──
  const existingGroup = await db
    .select({ id: organizationGroup.id })
    .from(organizationGroup)
    .where(eq(organizationGroup.name, body.groupName))
    .limit(1)

  let groupId: string
  let groupCreated = false
  if (existingGroup.length > 0) {
    groupId = existingGroup[0]!.id
  }
  else {
    if (body.dryRun) {
      groupId = 'DRY_RUN_GROUP_ID'
    }
    else {
      const [row] = await db
        .insert(organizationGroup)
        .values({
          name: body.groupName,
          mergeStrategy: 'oldest',
          fraudCheckEnabled: true,
        })
        .returning({ id: organizationGroup.id })
      groupId = row!.id
      groupCreated = true
    }
  }

  // ── Шаг 2: привязываем org к группе (через сырой SQL — organization в better-auth) ──
  let orgAttached = false
  if (body.attachActiveOrgToGroup) {
    const currentGroupId = await getOrgGroupId(orgId)
    if (currentGroupId !== groupId) {
      if (!body.dryRun) {
        await db.execute(
          sql`UPDATE "organization" SET group_id = ${groupId} WHERE id = ${orgId}`,
        )
      }
      orgAttached = true
    }
  }

  // ── Шаг 3: бэкфил identities ──
  const effectiveGroupId = body.dryRun && groupId === 'DRY_RUN_GROUP_ID' ? null : groupId

  // Берём всех нужных кандидатов
  const candidates = body.scopeToActiveOrg
    ? await db
        .select({
          id: candidate.id,
          organizationId: candidate.organizationId,
          email: candidate.email,
          phone: candidate.phone,
          hhResumeId: candidate.hhResumeId,
          hhResumeRaw: candidate.hhResumeRaw,
        })
        .from(candidate)
        .where(eq(candidate.organizationId, orgId))
    : await db
        .select({
          id: candidate.id,
          organizationId: candidate.organizationId,
          email: candidate.email,
          phone: candidate.phone,
          hhResumeId: candidate.hhResumeId,
          hhResumeRaw: candidate.hhResumeRaw,
        })
        .from(candidate)

  let totalSignalsInserted = 0
  let totalSignalsUpdated = 0
  let candidatesWithNoSignals = 0
  let candidatesProcessed = 0

  for (const c of candidates) {
    const signals = extractIdentitiesFromCandidateRow({
      email: c.email,
      phone: c.phone,
      hhResumeId: c.hhResumeId,
      hhResumeRaw: c.hhResumeRaw as Record<string, unknown> | null,
    })
    if (signals.length === 0) {
      candidatesWithNoSignals += 1
      continue
    }
    if (!body.dryRun) {
      const { inserted, updated } = await upsertCandidateIdentities({
        candidateId: c.id,
        organizationId: c.organizationId,
        groupId: effectiveGroupId,
        signals,
      })
      totalSignalsInserted += inserted
      totalSignalsUpdated += updated
    }
    else {
      totalSignalsInserted += signals.length
    }
    candidatesProcessed += 1
  }

  // ── Финальная статистика identity по группе ──
  let identityTotal = 0
  if (!body.dryRun && effectiveGroupId) {
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(candidateIdentity)
      .where(eq(candidateIdentity.groupId, effectiveGroupId))
    identityTotal = total ?? 0
  }

  return {
    ok: true,
    dryRun: body.dryRun,
    group: {
      id: groupId,
      name: body.groupName,
      created: groupCreated,
    },
    organization: {
      id: orgId,
      attachedToGroup: orgAttached,
    },
    candidates: {
      total: candidates.length,
      processed: candidatesProcessed,
      noSignals: candidatesWithNoSignals,
    },
    identities: {
      inserted: totalSignalsInserted,
      updated: totalSignalsUpdated,
      totalInGroup: identityTotal,
    },
  }
})
