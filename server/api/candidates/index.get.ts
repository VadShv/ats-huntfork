import { eq, and, or, ilike, desc, sql, gte, lte, inArray } from 'drizzle-orm'
import { candidate, application } from '../../database/schema'
import { candidateQuerySchema } from '../../utils/schemas/candidate'
import { propertyFiltersArraySchema } from '../../utils/schemas/property'
import {
  entityIdsMatchingFilters,
  loadPropertyEntriesForEntities,
  type PropertyFilter,
} from '../../utils/properties'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const query = await getValidatedQuery(event, candidateQuerySchema.parse)

  const offset = (query.page - 1) * query.limit
  const conditions = [eq(candidate.organizationId, orgId)]

  // ─── Sprint 1A: full-text поиск через q (websearch_to_tsquery) ───
  // Параллельно поддерживаем старый search для обратной совместимости.
  // NB: candidate.search_tsv хранится в БД (миграция 0045), но не экспортирован в Drizzle schema —
  // используем raw SQL ссылку на колонку, чтобы не трогать схему.
  const ftsQuery = query.q && query.q.length > 0 ? query.q : null
  if (ftsQuery) {
    conditions.push(
      sql`"candidate"."search_tsv" @@ websearch_to_tsquery('simple', ${ftsQuery})`,
    )
  }
  else if (query.search) {
    // Legacy ILIKE путь (вызывается, если q не передан) — ничего не ломаем.
    const escaped = query.search.replace(/[%_\\]/g, '\\$&')
    const pattern = `%${escaped}%`
    conditions.push(
      or(
        ilike(candidate.firstName, pattern),
        ilike(candidate.lastName, pattern),
        ilike(candidate.email, pattern),
      )!,
    )
  }

  if (query.gender) {
    conditions.push(eq(candidate.gender, query.gender))
  }

  // dateOfBirth is stored as ISO 8601 text (YYYY-MM-DD), so lexicographic comparison works
  if (query.dobFrom) {
    conditions.push(gte(candidate.dateOfBirth, query.dobFrom))
  }
  if (query.dobTo) {
    conditions.push(lte(candidate.dateOfBirth, query.dobTo))
  }

  // ── Custom property filters (intersection-based) ──
  let propertyFilters: PropertyFilter[] = []
  if (query.propertyFilters) {
    let raw: unknown
    try {
      raw = JSON.parse(query.propertyFilters)
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'Invalid propertyFilters' })
    }
    const result = propertyFiltersArraySchema.safeParse(raw)
    if (!result.success) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid propertyFilters' })
    }
    propertyFilters = result.data as PropertyFilter[]
  }
  if (propertyFilters.length > 0) {
    const matching = await entityIdsMatchingFilters({
      organizationId: orgId,
      entityType: 'candidate',
      filters: propertyFilters,
    })
    if (!matching || matching.size === 0) {
      return { data: [], total: 0, page: query.page, limit: query.limit }
    }
    conditions.push(inArray(candidate.id, [...matching]))
  }

  const where = and(...conditions)

  // При full-text запросе — сортируем по релевантности + возвращаем snippet (ts_headline).
  // При обычном запросе — старая логика по createdAt.
  const selectMap: Record<string, unknown> = {
    id: candidate.id,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    displayName: candidate.displayName,
    email: candidate.email,
    phone: candidate.phone,
    gender: candidate.gender,
    dateOfBirth: candidate.dateOfBirth,
    quickNotes: candidate.quickNotes,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    applicationCount: sql<number>`count(${application.id})::int`,
  }
  if (ftsQuery) {
    // ts_rank_cd — норма по длине документа (флаг 32), короткие не проигрывают длинным.
    selectMap.score = sql<number>`ts_rank_cd("candidate"."search_tsv", websearch_to_tsquery('simple', ${ftsQuery}), 32)`
    // ts_headline на сыром резюме невозможен (нет хранимого текста), делаем сниппет по быстро доступным полям.
    selectMap.snippet = sql<string | null>`ts_headline(
      'simple',
      coalesce(${candidate.aiSummary}, '') || ' ' || coalesce(${candidate.quickNotes}, '') || ' ' || coalesce(${candidate.city}, ''),
      websearch_to_tsquery('simple', ${ftsQuery}),
      'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=14, MinWords=4, ShortWord=2'
    )`
  }

  const orderClause = ftsQuery
    ? [desc(sql`ts_rank_cd("candidate"."search_tsv", websearch_to_tsquery('simple', ${ftsQuery}), 32)`), desc(candidate.updatedAt)]
    : [desc(candidate.createdAt)]

  const [data, total] = await Promise.all([
    db
      .select(selectMap as Record<string, never>)
      .from(candidate)
      .leftJoin(application, eq(application.candidateId, candidate.id))
      .where(where)
      .groupBy(candidate.id)
      .orderBy(...orderClause)
      .limit(query.limit)
      .offset(offset),
    db.$count(candidate, where),
  ])

  // Bulk-attach properties for the current page
  const ids = data.map((c) => c.id)
  const propertyMap = await loadPropertyEntriesForEntities({
    organizationId: orgId,
    entityType: 'candidate',
    entityIds: ids,
  })
  const enriched = data.map((c) => ({ ...c, properties: propertyMap.get(c.id) ?? [] }))

  return { data: enriched, total, page: query.page, limit: query.limit }
})
