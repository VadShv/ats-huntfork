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
 *   Доступно owner/admin и рекрутерам (role=member).
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

  // Поддерживаемые роли назначения:
  //   • hiring_manager — только пользователь с org-ролью hiring_manager;
  //   • recruiter       — только пользователь с org-ролью owner/admin/member.
  // watcher/assignee отклоняем — реализация позже.
  if (body.memberRole === 'hiring_manager') {
    if (target.role !== 'hiring_manager') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Пользователь не имеет роли «Нанимающий менеджер»',
      })
    }
  }
  else if (body.memberRole === 'recruiter') {
    if (!['owner', 'admin', 'member'].includes(target.role)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Рекрутером вакансии может быть только участник с ролью владелец, администратор или рекрутер',
      })
    }
  }
  else {
    throw createError({
      statusCode: 501,
      statusMessage: 'Роли watcher/assignee пока не поддерживаются',
    })
  }

  // ── Основной рекрутер: только для recruiter. Первый рекрутер вакансии
  //    становится основным автоматически; явный isPrimary снимает флаг с прочих. ──
  let makePrimary = false
  if (body.memberRole === 'recruiter') {
    if (body.isPrimary) {
      makePrimary = true
    }
    else {
      const [existingPrimary] = await db
        .select({ id: jobMember.id })
        .from(jobMember)
        .where(and(
          eq(jobMember.jobId, jobId),
          eq(jobMember.memberRole, 'recruiter'),
          eq(jobMember.isPrimary, true),
        ))
        .limit(1)
      makePrimary = !existingPrimary // нет основного — новый становится основным
    }
  }

  // Снимаем прежний primary до вставки, чтобы не нарушить partial unique index.
  if (makePrimary) {
    await db.update(jobMember)
      .set({ isPrimary: false })
      .where(and(
        eq(jobMember.jobId, jobId),
        eq(jobMember.memberRole, 'recruiter'),
        eq(jobMember.isPrimary, true),
      ))
  }

  // ── Идемпотентная вставка ──
  const [newRow] = await db
    .insert(jobMember)
    .values({
      organizationId: orgId,
      jobId,
      userId: body.userId,
      memberRole: body.memberRole,
      isPrimary: makePrimary,
      addedByUserId: actorId,
    })
    .onConflictDoNothing({ target: [jobMember.jobId, jobMember.userId, jobMember.memberRole] })
    .returning({
      id: jobMember.id,
      userId: jobMember.userId,
      memberRole: jobMember.memberRole,
      isPrimary: jobMember.isPrimary,
      addedAt: jobMember.addedAt,
    })

  if (!newRow) {
    // Уже был назначен — при явном запросе основного повышаем существующую запись.
    if (makePrimary) {
      await db.update(jobMember)
        .set({ isPrimary: true })
        .where(and(
          eq(jobMember.jobId, jobId),
          eq(jobMember.userId, body.userId),
          eq(jobMember.memberRole, 'recruiter'),
        ))
    }
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
