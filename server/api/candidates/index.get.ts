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

  // Sprint 2 hotfix: scope → ts_filter weight-классы. Обычный SQL literal,
  // потому что enum уже валидирован zod — SQL-injection исключен.
  // 'all' возвращает null — берём search_tsv без фильтрации.
  const scopeWeights: Record<typeof query.scope, string | null> = {
    all: null,
    labels: '{a}',
    notes: '{b}',
    resume: '{c,d}',
  }
  const weightFilter = scopeWeights[query.scope]
  // tsvectorExpr — что используется в @@ и ts_rank_cd (оригинал или отфильтрованный).
  const tsvectorExpr = weightFilter
    ? sql`ts_filter("candidate"."search_tsv", ${weightFilter}::"char"[])`
    : sql`"candidate"."search_tsv"`

  if (ftsQuery) {
    conditions.push(
      sql`${tsvectorExpr} @@ websearch_to_tsquery('russian', ${ftsQuery})`,
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
    // scope!=all: ранжируем по отфильтрованному tsvector — релевантность считается только по выбранным весам.
    selectMap.score = sql<number>`ts_rank_cd(${tsvectorExpr}, websearch_to_tsquery('russian', ${ftsQuery}), 32)`
    // ts_headline на сыром резюме невозможен (нет хранимого текста), делаем сниппет по быстро доступным полям.
    selectMap.snippet = sql<string | null>`ts_headline(
      'russian',
      coalesce(${candidate.aiSummary}, '') || ' ' || coalesce(${candidate.quickNotes}, '') || ' ' || coalesce(${candidate.city}, ''),
      websearch_to_tsquery('russian', ${ftsQuery}),
      'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=14, MinWords=4, ShortWord=2'
    )`
  }

  const orderClause = ftsQuery
    ? [desc(sql`ts_rank_cd(${tsvectorExpr}, websearch_to_tsquery('russian', ${ftsQuery}), 32)`), desc(candidate.updatedAt)]
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

  // ─── Sprint 4: pg_trgm fuzzy fallback по ФИО ───
  // Запускаем ТОЛЬКО когда:
  //   • есть FTS-запрос (q), длиной >= 3 символов
  //   • запрос — одно слово без операторов (нет пробелов/кавычек/+/-/|)
  //     иначе булевый запрос всё равно нужно матчить через FTS, а не trgm
  //   • первая страница (page === 1)
  //   • основной FTS вернул < 5 результатов
  //   • scope === 'all' или scope === 'labels' — fuzzy имеет смысл только
  //     для поиска по ФИО, не по тексту резюме
  //   • нет property-фильтров с пустым intersection (туда мы уже не дошли)
  //
  // matchType: 'exact' добавляется ко всем основным результатам,
  // 'fuzzy' — к найденным через trgm. similarity — только у fuzzy.
  const FUZZY_THRESHOLD = 5
  const FUZZY_MIN_SIM = 0.25 // % оператор по умолчанию pg_trgm.similarity_threshold (0.3),
                              // 0.25 даёт чуть больше recall для коротких ФИО.
  const canFuzzy =
    ftsQuery &&
    ftsQuery.length >= 3 &&
    !/[\s"+\-|()]/.test(ftsQuery) &&
    query.page === 1 &&
    data.length < FUZZY_THRESHOLD &&
    (query.scope === 'all' || query.scope === 'labels')

  type Row = (typeof data)[number] & {
    matchType?: 'exact' | 'fuzzy'
    similarity?: number
    score?: number
    snippet?: string | null
  }
  const exactRows: Row[] = data.map((c) => ({ ...(c as Row), matchType: 'exact' as const }))

  let fuzzyRows: Row[] = []
  if (canFuzzy) {
    const needle = ftsQuery!.toLowerCase()
    const existingIds = exactRows.map((r) => r.id)
    const limit = FUZZY_THRESHOLD - data.length

    // pg_trgm: индекс на lower(first||' '||last||' '||display) gin_trgm_ops (миграция 0047).
    // % использует similarity_threshold (по умолчанию 0.3) — индекс работает.
    // Дополнительно фильтруем similarity() >= FUZZY_MIN_SIM на случай если threshold меняли в сессии.
    // organizationId — критично, иначе утечка между орг.
    const nameExpr = sql`lower(coalesce(${candidate.firstName}, '') || ' ' || coalesce(${candidate.lastName}, '') || ' ' || coalesce(${candidate.displayName}, ''))`
    const fuzzyConditions = [
      eq(candidate.organizationId, orgId),
      sql`${nameExpr} % ${needle}`,
      sql`similarity(${nameExpr}, ${needle}) >= ${FUZZY_MIN_SIM}`,
    ]
    if (existingIds.length > 0) {
      fuzzyConditions.push(sql`${candidate.id} NOT IN (${sql.join(existingIds.map((id) => sql`${id}`), sql`, `)})`)
    }
    // Учитываем property filters, если они были (intersection уже посчитан, conditions содержат inArray).
    // Простейший путь: переиспользовать matching ids — но они уже сужены до условий FTS+property.
    // Здесь property filter уже применён через conditions выше; повторим через тот же inArray, если был.
    if (propertyFilters.length > 0) {
      // matching посчитан выше — но переменная вне scope. Перевычислять дорого; вместо этого
      // полагаемся на то, что conditions[*] уже содержит inArray(candidate.id, [...matching]).
      // Извлекаем те же id из exactRows + считаем что fuzzy будет ограничен теми же intersection.
      // Для корректности — пересчитываем intersection.
      const matching = await entityIdsMatchingFilters({
        organizationId: orgId,
        entityType: 'candidate',
        filters: propertyFilters,
      })
      if (!matching || matching.size === 0) {
        fuzzyRows = []
      } else {
        fuzzyConditions.push(inArray(candidate.id, [...matching]))
      }
    }

    // dob-фильтры тоже учитываем — fuzzy не должен «расширять» seach за их пределы.
    if (query.gender) fuzzyConditions.push(eq(candidate.gender, query.gender))
    if (query.dobFrom) fuzzyConditions.push(gte(candidate.dateOfBirth, query.dobFrom))
    if (query.dobTo) fuzzyConditions.push(lte(candidate.dateOfBirth, query.dobTo))

    try {
      const fuzzyData = await db
        .select({
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
          similarity: sql<number>`similarity(${nameExpr}, ${needle})`,
        })
        .from(candidate)
        .leftJoin(application, eq(application.candidateId, candidate.id))
        .where(and(...fuzzyConditions))
        .groupBy(candidate.id)
        .orderBy(desc(sql`similarity(${nameExpr}, ${needle})`))
        .limit(limit)
      fuzzyRows = fuzzyData.map((c) => ({
        ...(c as unknown as Row),
        matchType: 'fuzzy' as const,
        // округление до 2 знаков, чтобы фронту проще было показывать %
        similarity: Math.round((c.similarity as number) * 100) / 100,
      }))
    } catch (err) {
      // Если pg_trgm extension не установлен (миграция ещё не применена) —
      // не валим основной поиск, просто пропускаем fallback.
      console.warn('[candidates] trgm fallback failed:', (err as Error).message)
      fuzzyRows = []
    }
  }

  const combined: Row[] = [...exactRows, ...fuzzyRows]

  // Bulk-attach properties for the current page
  const ids = combined.map((c) => c.id)
  const propertyMap = await loadPropertyEntriesForEntities({
    organizationId: orgId,
    entityType: 'candidate',
    entityIds: ids,
  })
  const enriched = combined.map((c) => ({ ...c, properties: propertyMap.get(c.id) ?? [] }))

  // total отражает только основной FTS — fuzzy не входит в пагинацию,
  // это «бонусные» подсказки сверх. Иначе пользователь увидит total=8, но
  // переключится на page=2 и получит пусто (fuzzy показываем только на page=1).
  return { data: enriched, total, page: query.page, limit: query.limit }
})
