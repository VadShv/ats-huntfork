import { and, eq } from 'drizzle-orm'
import { job } from '../../../../database/schema/app'
import { jobMember } from '../../../../database/schema/hm'
import { member } from '../../../../database/schema/auth'
import { idParamSchema } from '../../../../utils/schemas/job'
import { addJobMemberSchema } from '../../../../utils/schemas/hiringManager'

/**
 * POST /api/jobs/[id]/members
 * Назначает пользователя на вакансию с указанной ролью (в v1 — только HM).
 * Права: `job:update` — это часть редактирования вакансии (команда),
 *   а не org-member (создание НМ как юзера org уже сделано через invite-link).
 *   Доступно owner/admin и рекрутёрам (role=member).
 *
 * Может быть несколько НМ на одной вакансии (первое решение выигрывает — см. ТЗ §4.10).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const actorId = session.user.id

  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, addJobMemberSchema.parse)

  // ── job принадлежит org ──
  const [ownedJob] = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.organizationId, orgId)))
    .limit(1)
  if (!ownedJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  // ── target user состоит в org (member) ──
  const [target] = await db
    .select({
      userId: member.userId,
      role: member.role,
      status: member.status,
    })
    .from(member)
    .where(and(
      eq(member.organizationId, orgId),
      eq(member.userId, body.userId),
    ))
    .limit(1)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Пользователь не состоит в организации' })
  }
  if (target.status !== 'active') {
    throw createError({ statusCode: 409, statusMessage: 'Учётная запись пользователя неактивна' })
  }

  // v1: назначить НМ можно только пользователя с ролью hiring_manager.
  // watcher/assignee из body.memberRole в v1 отклоняем — реализация позже.
  if (body.memberRole !== 'hiring_manager') {
    throw createError({
      statusCode: 501,
      statusMessage: 'В v1 доступна только роль hiring_manager',
    })
  }
  if (target.role !== 'hiring_manager') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Пользователь не имеет роли «Нанимающий менеджер»',
    })
  }

  // ── Идемпотентная вставка ──
  const [newRow] = await db
    .insert(jobMember)
    .values({
      organizationId: orgId,
      jobId,
      userId: body.userId,
      memberRole: body.memberRole,
      addedByUserId: actorId,
    })
    .onConflictDoNothing({ target: [jobMember.jobId, jobMember.userId, jobMember.memberRole] })
    .returning({
      id: jobMember.id,
      userId: jobMember.userId,
      memberRole: jobMember.memberRole,
      addedAt: jobMember.addedAt,
    })

  if (!newRow) {
    // Уже был назначен — возвращаем 200 идемпотентно.
    return { success: true, alreadyAssigned: true }
  }

  await recordActivity({
    organizationId: orgId,
    actorId,
    action: 'created',
    resourceType: 'job_member',
    resourceId: newRow.id,
    metadata: {
      jobId,
      userId: body.userId,
      memberRole: body.memberRole,
    },
  })

  return { success: true, member: newRow }
})
