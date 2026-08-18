/**
 * POST /api/sourcing-candidates/:id/enrich
 *
 * Ленивое дообогащение снапшота из ПОЛНОГО резюме hh (GET /resumes/{id}).
 * Поисковая выдача hh НЕ содержит описаний опыта (обязанностей) — они есть
 * только в полном резюме. Вызывается из UI при раскрытии блока «Опыт работы».
 *
 * Контакты НЕ трогаем (раскрытие контактов — отдельный платный endpoint).
 * Результат кэшируется в snapshot.enrichedAt — повторные вызовы не ходят в hh.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hhSavedSearch, hhSourcingCandidate } from '../../../database/schema'
import { apiGet } from '../../../utils/hh/client'
import { getValidAccessToken } from '../../../utils/hh/tokens'

const paramsSchema = z.object({ id: z.string().min(1) })

/** Максимум мест работы и длина описания — держим снапшот компактным. */
const MAX_EXPERIENCE = 5
const MAX_DESCRIPTION = 900

interface HhFullResumeExperience {
  company?: string | null
  position?: string | null
  start?: string | null
  end?: string | null
  description?: string | null
}

interface HhFullResume {
  experience?: HhFullResumeExperience[]
  skill_set?: string[]
}

function monthsBetween(start?: string | null, end?: string | null): number | null {
  if (!start) return null
  const s = new Date(start)
  const e = end ? new Date(end) : new Date()
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()))
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  const sc = await db.query.hhSourcingCandidate.findFirst({
    where: and(eq(hhSourcingCandidate.id, id), eq(hhSourcingCandidate.organizationId, orgId)),
  })
  if (!sc) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  const snapshot = (sc.snapshot ?? {}) as Record<string, unknown>

  // Уже обогащён — возвращаем кэш, в hh не ходим
  if (snapshot.enrichedAt) {
    return { snapshot, cached: true }
  }

  const search = await db.query.hhSavedSearch.findFirst({
    where: eq(hhSavedSearch.id, sc.savedSearchId),
    columns: { hhAccountId: true },
  })
  if (!search) {
    throw createError({ statusCode: 404, statusMessage: 'Поиск не найден' })
  }

  let full: HhFullResume
  try {
    const accessToken = await getValidAccessToken(search.hhAccountId)
    full = await apiGet<HhFullResume>(`/resumes/${sc.hhResumeId}`, accessToken)
  } catch (err: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `hh.ru не отдал полное резюме: ${err?.message ?? 'неизвестная ошибка'}`,
    })
  }

  const experience = (full.experience ?? []).slice(0, MAX_EXPERIENCE).map((e) => ({
    company: e.company ?? null,
    position: e.position ?? null,
    start: e.start ?? null,
    end: e.end ?? null,
    durationMonths: monthsBetween(e.start, e.end),
    description: e.description ? e.description.slice(0, MAX_DESCRIPTION) : null,
  }))

  const next: Record<string, unknown> = {
    ...snapshot,
    enrichedAt: new Date().toISOString(),
  }
  if (experience.length > 0) next.experience = experience
  if (Array.isArray(full.skill_set) && full.skill_set.length > 0) {
    next.skills = full.skill_set.slice(0, 30)
  }

  await db.update(hhSourcingCandidate)
    .set({ snapshot: next, updatedAt: new Date() })
    .where(eq(hhSourcingCandidate.id, sc.id))

  return { snapshot: next, cached: false }
})
