import { and, eq } from 'drizzle-orm'
import { hhVacancyLink } from '../../database/schema/app'

export async function resolveHhAccountForJob(orgId: string, jobId: string): Promise<string> {
  const [link] = await db
    .select({ hhAccountId: hhVacancyLink.hhAccountId })
    .from(hhVacancyLink)
    .where(and(eq(hhVacancyLink.jobId, jobId), eq(hhVacancyLink.organizationId, orgId)))
    .limit(1)
  if (!link) {
    throw createError({ statusCode: 404, statusMessage: 'Связь с hh.ru не найдена' })
  }
  return link.hhAccountId
}
