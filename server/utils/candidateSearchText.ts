/**
 * Сбор текста для full-text поиска кандидатов (Sprint 11 → Sprint 1A → Sprint 2).
 *
 * Объединяет: ФИО, email, phone, city, текст всех резюме кандидата
 * (document.parsedContent.text где type='resume') + hh_resume_raw → текст
 * + labels select / multi_select меток.
 *
 * Sprint 2: текст разбит на группы A/B/C/D, индексация через setweight для
 * ранжирования (имя/email/метка > summary/city > hhResumeRaw > длинное резюме).
 * Конфигурация tsvector переключена с 'simple' на 'russian' (стемминг + stopwords).
 *
 * Обратная совместимость: buildCandidateSearchText() возвращает склеенный текст
 * как раньше (для legacy callers — backfill endpoint). Новая функция
 * buildCandidateSearchGroups() возвращает структуру по весам.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { candidate, document, propertyDefinition, propertyValue } from '../database/schema'
import { db } from './db'
import { resumeToText, type HhResumeApi } from './hh/sync'

/**
 * Группы текста по весам для tsvector_setweight.
 *
 * A (вес 1.0): высокоприоритетный сигнал — ФИО, email, phone, displayName, labels меток.
 *              Запрос «Иван» сначала покажет кандидатов с именем Иван, а не тех у кого
 *              в резюме упомянут какой-то Иван.
 * B (вес 0.4): структурированные метаданные — aiSummary, quickNotes, city.
 *              Это короткие, сфокусированные тексты — релевантнее длинных резюме.
 * C (вес 0.2): сериализованное hh_resume_raw (JSON-дамп) — менее организованный,
 *              но содержательный сигнал.
 * D (вес 0.1): сырой текст резюме (document.parsedContent.text) — длинный, шумный.
 *              Совпадение здесь — слабый сигнал по сравнению с ФИО/skills.
 */
export interface CandidateSearchGroups {
  a: string
  b: string
  c: string
  d: string
}

export async function buildCandidateSearchGroups(opts: {
  orgId: string
  candidateId: string
}): Promise<CandidateSearchGroups> {
  const c = await db.query.candidate.findFirst({
    where: and(
      eq(candidate.organizationId, opts.orgId),
      eq(candidate.id, opts.candidateId),
    ),
    columns: {
      firstName: true,
      lastName: true,
      displayName: true,
      email: true,
      phone: true,
      city: true,
      quickNotes: true,
      aiSummary: true,
      hhResumeRaw: true,
    },
  })
  if (!c) return { a: '', b: '', c: '', d: '' }

  const docs = await db.query.document.findMany({
    where: and(
      eq(document.organizationId, opts.orgId),
      eq(document.candidateId, opts.candidateId),
      eq(document.type, 'resume'),
    ),
    columns: { parsedContent: true },
  })

  // ── A: высокий приоритет ──
  const aParts: string[] = [
    c.firstName,
    c.lastName,
    c.displayName ?? '',
    c.email,
    c.phone ?? '',
  ]

  // Метки (Sprint 1A) — тоже сильный сигнал. Запрос «Сеньор» должен ловить
  // помеченных «Сеньор» в первую очередь.
  try {
    const values = await db.select({
      value: propertyValue.value,
      config: propertyDefinition.config,
      type: propertyDefinition.type,
    })
      .from(propertyValue)
      .innerJoin(propertyDefinition, eq(propertyDefinition.id, propertyValue.propertyDefinitionId))
      .where(and(
        eq(propertyValue.organizationId, opts.orgId),
        eq(propertyValue.entityType, 'candidate'),
        eq(propertyValue.entityId, opts.candidateId),
        inArray(propertyDefinition.type, ['select', 'multi_select']),
      ))

    for (const row of values) {
      const cfg = row.config as { options?: Array<{ id: string, label: string }> } | null
      if (!cfg?.options) continue
      const selected = row.type === 'multi_select'
        ? (Array.isArray(row.value) ? row.value as string[] : [])
        : (typeof row.value === 'string' ? [row.value] : [])
      for (const optId of selected) {
        const opt = cfg.options.find(o => o.id === optId)
        if (opt?.label) aParts.push(opt.label)
      }
    }
  }
  catch (err) {
    console.error('[buildCandidateSearchGroups] tags fetch failed', err)
  }

  // ── B: средний приоритет ──
  const bParts: string[] = []
  if (c.aiSummary) bParts.push(c.aiSummary)
  if (c.quickNotes) bParts.push(c.quickNotes)
  if (c.city) bParts.push(c.city)

  // ── C: низкий приоритет ──
  const cParts: string[] = []
  if (c.hhResumeRaw) {
    try {
      const t = resumeToText(c.hhResumeRaw as unknown as HhResumeApi)
      if (t) cParts.push(t)
    }
    catch {
      cParts.push(JSON.stringify(c.hhResumeRaw))
    }
  }

  // ── D: самый низкий приоритет (длинные сырые резюме) ──
  const dParts: string[] = []
  for (const d of docs) {
    const text = (d.parsedContent as { text?: string } | null)?.text
    if (text) dParts.push(text)
  }

  // Safety cap по группам — суммарно ~1Mb для всех.
  return {
    a: aParts.filter(Boolean).join('\n').slice(0, 50_000),
    b: bParts.filter(Boolean).join('\n').slice(0, 100_000),
    c: cParts.filter(Boolean).join('\n').slice(0, 300_000),
    d: dParts.filter(Boolean).join('\n').slice(0, 600_000),
  }
}

/**
 * Legacy: вернуть склеенный текст всех групп (для совместимости с backfill endpoint,
 * который до Sprint 2 индексировал через simple to_tsvector). Используется только для
 * fallback-путей. Основной путь — refreshCandidateSearchTsv через setweight.
 */
export async function buildCandidateSearchText(opts: {
  orgId: string
  candidateId: string
}): Promise<string> {
  const groups = await buildCandidateSearchGroups(opts)
  return [groups.a, groups.b, groups.c, groups.d].filter(Boolean).join('\n').slice(0, 1_000_000)
}

/**
 * Обновить candidate.search_tsv через setweight по группам.
 * Sprint 2: russian config + веса A/B/C/D.
 */
export async function refreshCandidateSearchTsv(opts: {
  orgId: string
  candidateId: string
}): Promise<void> {
  const g = await buildCandidateSearchGroups(opts)
  await db.execute(sql`
    UPDATE "candidate"
       SET "search_tsv" =
         setweight(to_tsvector('russian', ${g.a}), 'A') ||
         setweight(to_tsvector('russian', ${g.b}), 'B') ||
         setweight(to_tsvector('russian', ${g.c}), 'C') ||
         setweight(to_tsvector('russian', ${g.d}), 'D')
     WHERE "organization_id" = ${opts.orgId}
       AND "id" = ${opts.candidateId}
  `)
}
