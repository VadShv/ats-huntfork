import { eq, and, or, ilike, desc, sql, inArray, count } from 'drizzle-orm'
import { application, candidate, job, pipelineStage, pipelineStageTypeEnum } from '../../database/schema'
import { applicationQuerySchema } from '../../utils/schemas/application'
import { propertyFiltersArraySchema } from '../../utils/schemas/property'
import {
  entityIdsMatchingFilters,
  loadPropertyEntriesForEntities,
  type PropertyFilter,
} from '../../utils/properties'

/**
 * GET /api/applications
 * List applications for the current organization.
 * Filterable by jobId, candidateId, status, stageId, stageType, and custom
 * property filters. Paginated. Includes current pipeline stage fields (left join).
 *
 * Stage filter precedence:
 *   ?stageId=<uuid>   — filter where currentStageId = stageId (exact)
 *   ?stageType=<type> — filter where the joined pipelineStage.type matches
 *                       (all matching stages across all pipelines)
 *   When both are present, stageId wins.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const query = await getValidatedQuery(event, applicationQuerySchema.parse)

  const offset = (query.page - 1) * query.limit
  const conditions = [eq(application.organizationId, orgId)]

  if (query.jobId) {
    conditions.push(eq(application.jobId, query.jobId))
  }
  if (query.candidateId) {
    conditions.push(eq(application.candidateId, query.candidateId))
  }
  if (query.status) {
    conditions.push(eq(application.status, query.status))
  }
  if (query.needsManualReview) {
    conditions.push(eq(application.needsManualReview, true))
  }

  // ─── Sprint 1B: full-text поиск через q ───
  // FTS по candidate.search_tsv ОР ILIKE по job.title (срабатывает как "найди отклики где кандидат или вакансия матчит").
  // candidate.search_tsv не экспортирован в Drizzle — используем raw SQL ссылку.
  const ftsQuery = query.q && query.q.length > 0 ? query.q : null
  if (ftsQuery) {
    const escapedIlike = ftsQuery.replace(/[%_\\]/g, '\\$&')
    const pattern = `%${escapedIlike}%`
    conditions.push(
      or(
        sql`"candidate"."search_tsv" @@ websearch_to_tsquery('russian', ${ftsQuery})`,
        ilike(job.title, pattern),
      )!,
    )
  }
  if (query.stageIds) {
    // Фаза 1: мультиселект этапов. Каждый выбранный этап захватывает свои подэтапы
    // (например «Отказ» → все причины отказа). Лимит 50 id — защита от злоупотребления.
    const ids = [...new Set(query.stageIds.split(',').map(s => s.trim()).filter(Boolean))].slice(0, 50)
    if (ids.length > 0) {
      const childStages = await db
        .select({ id: pipelineStage.id })
        .from(pipelineStage)
        .where(and(
          eq(pipelineStage.organizationId, orgId),
          inArray(pipelineStage.parentStageId, ids),
        ))
      conditions.push(inArray(application.currentStageId, [...new Set([...ids, ...childStages.map(s => s.id)])]))
    }
  }
  else if (query.stageId) {
    // Спринт 22: фильтр по родительскому этапу (например «Отказ») включает
    // его подэтапы (причины отказа). Для обычных этапов — точное совпадение.
    const childStages = await db
      .select({ id: pipelineStage.id })
      .from(pipelineStage)
      .where(and(
        eq(pipelineStage.organizationId, orgId),
        eq(pipelineStage.parentStageId, query.stageId),
      ))
    if (childStages.length > 0) {
      conditions.push(inArray(application.currentStageId, [query.stageId, ...childStages.map(s => s.id)]))
    }
    else {
      conditions.push(eq(application.currentStageId, query.stageId))
    }
  }
  else if (query.stageType) {
    // Type-based match — filter on the joined stage's type column.
    // We use a subquery-style approach: only rows where the left-joined
    // pipelineStage.type equals the requested value are included.
    // This is expressed via the join condition + WHERE on pipelineStage.type.
    conditions.push(eq(pipelineStage.type, query.stageType as (typeof pipelineStageTypeEnum.enumValues)[number]))
  }

  // ── Custom property filters ──
  let propertyFilters: PropertyFilter[] = []
  if (query.propertyFilters) {
    let raw: unknown
    try {
      raw = JSON.parse(query.propertyFilters)
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'Некорректное значение propertyFilters' })
    }
    const result = propertyFiltersArraySchema.safeParse(raw)
    if (!result.success) {
      throw createError({ statusCode: 400, statusMessage: 'Некорректное значение propertyFilters' })
    }
    propertyFilters = result.data as PropertyFilter[]
  }
  if (propertyFilters.length > 0) {
    const matching = await entityIdsMatchingFilters({
      organizationId: orgId,
      entityType: 'application',
      filters: propertyFilters,
    })
    if (!matching || matching.size === 0) {
      return { data: [], total: 0, page: query.page, limit: query.limit }
    }
    conditions.push(inArray(application.id, [...matching]))
  }

  const where = and(...conditions)

  // При FTS — ранжируем по релевантности кандидата + возвращаем snippet.
  const selectMap: Record<string, unknown> = {
    id: application.id,
    status: application.status,
    score: application.score,
    notes: application.notes,
    // Sprint 3: source нужен в UI для бейджей (hh / hh_sourcing / manual / api) и фильтра «Скрыть холодных»
    source: application.source,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    candidateId: application.candidateId,
    candidateFirstName: candidate.firstName,
    candidateLastName: candidate.lastName,
    candidateEmail: candidate.email,
    candidateManualReviewOnly: candidate.manualReviewOnly,
    jobId: application.jobId,
    jobTitle: job.title,
    jobStatus: job.status,
    currentStageId: application.currentStageId,
    currentStageName: pipelineStage.name,
    currentStageColor: pipelineStage.color,
    // Фаза 1: для колонки «Состояние» (В работе / Нанят / Отказ) — без легаси-статуса
    currentStageBucket: pipelineStage.bucket,
    currentStageType: pipelineStage.type,
    needsManualReview: application.needsManualReview,
  }
  if (ftsQuery) {
    // ts_rank_cd по search_tsv кандидата. Для матчей только по job.title score будет 0 — такие попадут в хвост.
    selectMap.score_fts = sql<number>`ts_rank_cd("candidate"."search_tsv", websearch_to_tsquery('russian', ${ftsQuery}), 32)`
    selectMap.snippet = sql<string | null>`ts_headline(
      'russian',
      coalesce(${candidate.aiSummary}, '') || ' ' || coalesce(${candidate.quickNotes}, '') || ' ' || coalesce(${candidate.city}, '') || ' ' || coalesce(${job.title}, ''),
      websearch_to_tsquery('russian', ${ftsQuery}),
      'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=14, MinWords=4, ShortWord=2'
    )`
  }

  const orderClause = ftsQuery
    ? [desc(sql`ts_rank_cd("candidate"."search_tsv", websearch_to_tsquery('russian', ${ftsQuery}), 32)`), desc(application.createdAt)]
    : [desc(application.createdAt)]

  // Когда в WHERE есть ссылки на candidate/job (FTS ветка или stageType-filter),
  // count тоже нужно делать через JOIN, иначе PG кидает "missing FROM-clause".
  // Напрямую строим count(*) с тем же набором JOIN.
  const [data, totalRes] = await Promise.all([
    db
      .select(selectMap as Record<string, never>)
      .from(application)
      .innerJoin(candidate, eq(candidate.id, application.candidateId))
      .innerJoin(job, eq(job.id, application.jobId))
      .leftJoin(pipelineStage, eq(pipelineStage.id, application.currentStageId))
      .where(where)
      .orderBy(...orderClause)
      .limit(query.limit)
      .offset(offset),
    db
      .select({ c: count() })
      .from(application)
      .innerJoin(candidate, eq(candidate.id, application.candidateId))
      .innerJoin(job, eq(job.id, application.jobId))
      .leftJoin(pipelineStage, eq(pipelineStage.id, application.currentStageId))
      .where(where),
  ])
  const total = totalRes[0]?.c ?? 0

  // Bulk-attach properties for the current page (org-global + per-job)
  const ids = data.map((a) => a.id)
  const jobIds = [...new Set(data.map((a) => a.jobId))]
  const entityJobIds = new Map(data.map((a) => [a.id, a.jobId] as const))
  const propertyMap = await loadPropertyEntriesForEntities({
    organizationId: orgId,
    entityType: 'application',
    entityIds: ids,
    jobIds,
    entityJobIds,
  })
  const enriched = data.map((a) => ({
    ...a,
    properties: propertyMap.get(a.id) ?? [],
  }))

  return { data: enriched, total, page: query.page, limit: query.limit }
})
