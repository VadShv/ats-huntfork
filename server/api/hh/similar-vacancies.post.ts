/**
 * POST /api/hh/similar-vacancies
 *
 * По кандидату (с hh-резюме) ищет похожие вакансии на hh.ru.
 * Использует skill_set + title из raw-резюме для поискового запроса.
 * Результаты кэшируются на 1 час по хэшу резюме (hhSimilarVacanciesCache).
 *
 * Тело: { candidateId: string }
 * Ответ: { items: HhSimilarVacancy[], fromCache: boolean }
 */
import { and, eq, gt } from 'drizzle-orm'
import { apiGet } from '../../utils/hh/client'
import { resolveHhConfig } from '../../utils/hh/config'
import { getValidAccessToken } from '../../utils/hh/tokens'
import { candidate, hhAccount, hhSimilarVacanciesCache } from '../../database/schema'

export interface HhSimilarVacancy {
  id: string
  name: string
  employer: { name: string, id: string }
  area: { name: string } | null
  salary: { from: number | null, to: number | null, currency: string | null } | null
  alternate_url: string
}

interface HhVacancySearchItem {
  id: string
  name: string
  employer?: { name?: string, id?: string }
  area?: { name?: string }
  salary?: { from?: number | null, to?: number | null, currency?: string | null } | null
  alternate_url?: string
}

interface HhVacancySearchResponse {
  items: HhVacancySearchItem[]
  found: number
  pages: number
}

const CACHE_TTL_MS = 3600000

export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhSimilarVacancy: ['read'] })
  const orgId = session.activeOrganizationId

  const body = await readBody<{ candidateId?: string }>(event)
  const candidateId = body?.candidateId
  if (!candidateId) {
    throw createError({ statusCode: 400, statusMessage: 'Не указан candidateId' })
  }

  const cand = await db
    .select({
      id: candidate.id,
      hhResumeRaw: candidate.hhResumeRaw,
    })
    .from(candidate)
    .where(and(eq(candidate.id, candidateId), eq(candidate.organizationId, orgId)))
    .limit(1)

  if (!cand[0]) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  const raw = cand[0].hhResumeRaw as Record<string, unknown> | null
  if (!raw) {
    throw createError({ statusCode: 400, statusMessage: 'У кандидата нет hh-резюме' })
  }

  const skillSet = Array.isArray(raw.skill_set) ? raw.skill_set as string[] : []
  const title = typeof raw.title === 'string' ? raw.title : ''
  const area = (raw.area ?? null) as { id?: string, name?: string } | null

  if (!title) {
    throw createError({ statusCode: 400, statusMessage: 'В резюме не указана должность (title)' })
  }

  const resumeHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ skills: skillSet, title, area: area?.id }))
    .digest('hex')

  const now = new Date()
  const cached = await db
    .select({ results: hhSimilarVacanciesCache.results })
    .from(hhSimilarVacanciesCache)
    .where(and(
      eq(hhSimilarVacanciesCache.organizationId, orgId),
      eq(hhSimilarVacanciesCache.resumeHash, resumeHash),
      gt(hhSimilarVacanciesCache.expiresAt, now),
    ))
    .limit(1)

  if (cached[0]) {
    return { items: cached[0].results as HhSimilarVacancy[], fromCache: true }
  }

  const account = await db
    .select({ id: hhAccount.id, hhEmployerId: hhAccount.hhEmployerId })
    .from(hhAccount)
    .where(and(eq(hhAccount.organizationId, orgId), eq(hhAccount.isActive, true)))
    .limit(1)

  if (!account[0]) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Аккаунт hh.ru не подключён. Подключите в Настройках → Интеграции.',
    })
  }

  let accessToken: string
  try {
    accessToken = await getValidAccessToken(account[0].id)
  }
  catch (err) {
    throw createError({
      statusCode: 401,
      statusMessage: `Не удалось обновить токен hh.ru: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  const config = await resolveHhConfig(orgId)

  let searchRes: HhVacancySearchResponse
  try {
    searchRes = await apiGet<HhVacancySearchResponse>(
      '/vacancies',
      accessToken,
      { text: title, area: area?.id, per_page: 20 },
      config,
    )
  }
  catch (err) {
    const status = (err as Error & { status?: number }).status ?? 502
    throw createError({
      statusCode: status,
      statusMessage: `Ошибка hh.ru API: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  const ownEmployerId = account[0].hhEmployerId
  const items: HhSimilarVacancy[] = (searchRes.items ?? [])
    .filter((item) => {
      if (!item.alternate_url) return false
      if (ownEmployerId && item.employer?.id === ownEmployerId) return false
      return true
    })
    .map((item) => ({
      id: item.id,
      name: item.name,
      employer: { name: item.employer?.name ?? '—', id: item.employer?.id ?? '' },
      area: item.area?.name ? { name: item.area.name } : null,
      salary: item.salary
        ? { from: item.salary.from ?? null, to: item.salary.to ?? null, currency: item.salary.currency ?? null }
        : null,
      alternate_url: item.alternate_url,
    }))

  await db
    .insert(hhSimilarVacanciesCache)
    .values({
      organizationId: orgId,
      resumeHash,
      results: items,
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
    })
    .onConflictDoUpdate({
      target: [hhSimilarVacanciesCache.organizationId, hhSimilarVacanciesCache.resumeHash],
      set: {
        results: items,
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
        createdAt: new Date(),
      },
    })

  return { items, fromCache: false }
})
