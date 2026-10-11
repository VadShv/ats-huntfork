import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { application, department, job, referral } from '../../database/schema/app'
import { jobMember } from '../../database/schema/hm'
import { member, user } from '../../database/schema/auth'
import { canSeeInternalRole } from '../../../shared/access/discussion'

const querySchema = z.object({ candidateId: z.string().min(1) })

/**
 * GET /api/referrals/options?candidateId=
 * Данные для диалога «Передать коллеге» одним запросом (docs/tz-discussion-referral.md §2.1):
 *  - colleagues — активные участники, которые видят внутреннее обсуждение (без себя);
 *  - jobs       — открытые вакансии с рекрутёрами и признаком «кандидат уже на вакансии»;
 *  - active     — незакрытые рефералы этого кандидата (чтобы показать «уже передан»).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { candidateId } = await getValidatedQuery(event, querySchema.parse)

  const cand = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM candidate WHERE id = ${candidateId} AND organization_id = ${orgId}
  `)
  if (Number((cand as any[])[0]?.n ?? 0) === 0) throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })

  const members = await db
    .select({ userId: user.id, name: user.name, email: user.email, image: user.image, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), eq(member.status, 'active')))
    .orderBy(user.name)
  const colleagues = members.filter(m => m.userId !== userId && canSeeInternalRole(m.role))

  const jobs = await db
    .select({ id: job.id, title: job.title, department: department.name, location: job.location })
    .from(job)
    .leftJoin(department, eq(department.id, job.departmentId))
    .where(and(eq(job.organizationId, orgId), eq(job.status, 'open')))
    .orderBy(job.title)
  const jobIds = jobs.map(j => j.id)

  const recruiters = jobIds.length
    ? await db
        .select({ jobId: jobMember.jobId, userId: jobMember.userId, isPrimary: jobMember.isPrimary })
        .from(jobMember)
        .where(and(eq(jobMember.organizationId, orgId), eq(jobMember.memberRole, 'recruiter'), inArray(jobMember.jobId, jobIds)))
    : []
  const apps = jobIds.length
    ? await db
        .select({ id: application.id, jobId: application.jobId })
        .from(application)
        .where(and(eq(application.organizationId, orgId), eq(application.candidateId, candidateId), inArray(application.jobId, jobIds)))
    : []
  const appByJob = new Map(apps.map(a => [a.jobId, a.id]))
  const recByJob = new Map<string, string[]>()
  for (const r of recruiters) {
    const list = recByJob.get(r.jobId) ?? []
    if (r.isPrimary) list.unshift(r.userId)
    else list.push(r.userId)
    recByJob.set(r.jobId, list)
  }

  const active = await db
    .select({ id: referral.id, toUserId: referral.toUserId, suggestedJobId: referral.suggestedJobId, status: referral.status, createdAt: referral.createdAt })
    .from(referral)
    .where(and(eq(referral.organizationId, orgId), eq(referral.candidateId, candidateId), inArray(referral.status, ['pending', 'accepted'])))

  return {
    colleagues,
    jobs: jobs.map(j => ({ ...j, recruiterIds: recByJob.get(j.id) ?? [], applicationId: appByJob.get(j.id) ?? null })),
    active,
  }
})
