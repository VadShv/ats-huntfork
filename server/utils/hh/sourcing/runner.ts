/**
 * Сорсинг-воркер для hh.ru.
 *
 * Ключевые задачи:
 *   1. Найти все hh_saved_search, у которых nextRunAt <= now и autoRunEnabled.
 *   2. Для каждого: пройти страницы /resumes (с пагинацией) до maxPagesPerRun.
 *   3. Дедуплицировать по (savedSearchId, hhResumeId) — уникальный индекс.
 *   4. Для новых кандидатов — сохранить анонимизированный snapshot БЕЗ контактов.
 *   5. Обновить статистику запуска и переставить nextRunAt.
 *
 * Безопасность приватности:
 *   - В snapshot НЕ кладём имя, email, телефон.
 *   - Только: title (желаемая позиция), area.name, salary, total_experience,
 *     последний опыт работы (компания + должность), навыки, образование,
 *     условия работы и пр. (см. SourcingSnapshot в ./types.ts).
 *
 * Rate-limit:
 *   - hh.ru допускает ~1500 запросов/мин для search/resume; делаем паузу 150мс
 *     между страницами как страховку.
 */
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm'
import { hhSavedSearch, hhSourcingCandidate } from '../../../database/schema'
import { apiGet } from '../client'
import { getValidAccessToken } from '../tokens'
import { expandQueryForHhApi, type SourcingQuery } from './query'
import type {
  SourcingSnapshot,
  SnapshotExperienceItem,
  SnapshotEducationItem,
} from './types'

// Реэкспорт типа для обратной совместимости с импортирующими модулями.
export type { SourcingSnapshot }

/** Один элемент в hh /resumes response.items. */
interface HhResumeListItem {
  id: string
  title?: string
  area?: { id: string, name: string }
  salary?: { amount: number, currency: string } | null
  total_experience?: { months: number } | null
  experience?: Array<{
    company?: string
    company_name?: string
    position?: string
    start?: string
    end?: string | null
    description?: string
  }>
  // Ключевые навыки (skill_set — массив строк, либо skills с объектами).
  skill_set?: string[]
  skills?: Array<{ string?: string, name?: string }>
  // Образование
  education?: {
    level?: { id?: string, name?: string }
    elementary?: Array<{
      name?: string
      organization?: string
      year?: number | string
    }>
    higher?: Array<{
      name?: string
      organization?: string
      year?: number | string
      faculty?: string
    }>
  }
  // Условия работы
  work_format?: string[]
  employment_form?: string[]
  relocation?: { type?: { id?: string, name?: string } }
  // Прочее (не PII)
  citizenship?: string[]
  // Активность поиска
  search_status?: { id?: string, name?: string }
  // Эти поля могут быть в анонимизированном виде, но мы их игнорируем
  first_name?: string
  last_name?: string
  middle_name?: string
  // Возраст — берём, но не PII
  age?: number
  // Last activity
  updated_at?: string
}

interface HhResumeListResponse {
  found: number
  pages: number
  per_page: number
  page: number
  items: HhResumeListItem[]
}

/** Разница в месяцах между двумя датами (ISO). null для unknown end = "по н.в.". */
function monthsBetween(start?: string | null, end?: string | null): number | null {
  if (!start) return null
  const endDate = end ? new Date(end) : new Date()
  const startDate = new Date(start)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null
  const months = (endDate.getFullYear() - startDate.getFullYear()) * 12
    + (endDate.getMonth() - startDate.getMonth())
  return months >= 0 ? months : null
}

/** Вытащить строку навыка из разных форматов hh API. */
function extractSkills(item: HhResumeListItem): string[] {
  const out: string[] = []
  if (Array.isArray(item.skill_set)) {
    for (const s of item.skill_set) {
      if (typeof s === 'string' && s.trim()) out.push(s.trim())
    }
  }
  if (Array.isArray(item.skills)) {
    for (const s of item.skills) {
      const name = s?.string ?? s?.name
      if (typeof name === 'string' && name.trim()) out.push(name.trim())
    }
  }
  // Дедуп с сохранением порядка, ограничение 30 (чтобы не раздувать jsonb).
  return Array.from(new Set(out)).slice(0, 30)
}

/** Построить детальный список опыта (последние 3 места). */
function extractExperience(item: HhResumeListItem): SnapshotExperienceItem[] {
  if (!Array.isArray(item.experience)) return []
  return item.experience.slice(0, 3).map((e) => {
    const start = e.start ?? null
    const end = e.end ?? null
    return {
      company: e.company ?? e.company_name ?? null,
      position: e.position ?? null,
      start,
      end,
      durationMonths: monthsBetween(start, end),
      description: e.description ?? null,
    }
  })
}

/** Построить список образования (последние 2 заведения). */
function extractEducation(item: HhResumeListItem): SnapshotEducationItem[] {
  const out: SnapshotEducationItem[] = []
  const edu = item.education
  if (!edu) return out
  // higher — высшее (приоритет)
  if (Array.isArray(edu.higher)) {
    for (const h of edu.higher.slice(0, 2)) {
      out.push({
        institution: h.organization ?? h.name ?? null,
        faculty: h.faculty ?? null,
        level: 'higher',
        year: h.year != null ? String(h.year) : null,
      })
    }
  }
  // elementary — среднее, добиваем до 2
  if (out.length < 2 && Array.isArray(edu.elementary)) {
    for (const el of edu.elementary.slice(0, 2 - out.length)) {
      out.push({
        institution: el.organization ?? el.name ?? null,
        faculty: null,
        level: 'secondary',
        year: el.year != null ? String(el.year) : null,
      })
    }
  }
  return out
}

/**
 * Построить полный анонимизированный snapshot из элемента выдачи hh.
 *
 * Новые поля (skills/education/experience[]/workFormat/employmentForm/
 * relocation/citizenship/searchActivity) — optional, старые записи
 * без них рендерятся UI по v-if без ошибок.
 */
function buildSnapshot(item: HhResumeListItem): SourcingSnapshot {
  const expMonths = item.total_experience?.months ?? null
  const experience = extractExperience(item)
  const lastExp = experience[0] ?? null
  return {
    title: item.title ?? null,
    areaId: item.area?.id ?? null,
    areaName: item.area?.name ?? null,
    salaryAmount: item.salary?.amount ?? null,
    salaryCurrency: item.salary?.currency ?? null,
    experienceYears: expMonths !== null ? Math.round((expMonths / 12) * 10) / 10 : null,
    totalExperienceMonths: expMonths,
    lastCompany: lastExp?.company ?? null,
    lastPosition: lastExp?.position ?? null,
    age: item.age ?? null,
    updatedAt: item.updated_at ?? null,
    // ── Расширенные поля ──
    experience,
    skills: extractSkills(item),
    educationLevel: item.education?.level?.name ?? item.education?.level?.id ?? null,
    education: extractEducation(item),
    workFormat: Array.isArray(item.work_format) ? item.work_format.slice(0, 5) : [],
    employmentForm: Array.isArray(item.employment_form) ? item.employment_form.slice(0, 5) : [],
    relocation: item.relocation?.type
      ? { type: item.relocation.type.name ?? item.relocation.type.id ?? null }
      : null,
    citizenship: Array.isArray(item.citizenship) ? item.citizenship.slice(0, 5) : [],
    searchActivity: item.search_status?.name ?? item.search_status?.id ?? item.updated_at ?? null,
  }
}

/** Пауза между запросами hh (мс). */
const PAGE_DELAY_MS = 150

/** Результат запуска одного поиска. */
export interface SourcingRunResult {
  searchId: string
  found: number
  new: number
  pages: number
  status: 'ok' | 'error'
  error: string | null
  durationMs: number
}

/**
 * Запустить один сохранённый сорсинг-поиск.
 *
 * Внутри транзакции мы не работаем (запросы к hh — long-running),
 * но обновления БД делаем атомарно по одному кандидату.
 */
export async function runSourcingSearch(savedSearchId: string): Promise<SourcingRunResult> {
  const startedAt = Date.now()

  // 1. Грузим запись поиска
  const search = await db.query.hhSavedSearch.findFirst({
    where: eq(hhSavedSearch.id, savedSearchId),
  })
  if (!search) {
    return {
      searchId: savedSearchId,
      found: 0, new: 0, pages: 0,
      status: 'error',
      error: 'saved search not found',
      durationMs: Date.now() - startedAt,
    }
  }

  // Помечаем running
  await db.update(hhSavedSearch)
    .set({
      lastRunStatus: 'running',
      lastRunError: null,
      updatedAt: new Date(),
    })
    .where(eq(hhSavedSearch.id, savedSearchId))

  try {
    const accessToken = await getValidAccessToken(search.hhAccountId)
    const query = search.query as SourcingQuery

    // Сколько уже набрано по этому поиску (все состояния, кроме rejected).
    // Это лимитирующий только живых кандидатов.
    const cntRows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(hhSourcingCandidate)
      .where(and(
        eq(hhSourcingCandidate.savedSearchId, search.id),
        sql`${hhSourcingCandidate.state} <> 'rejected'`,
      ))
    let currentCount = cntRows[0]?.c ?? 0
    const maxCandidates = search.maxCandidates

    let pageNum = 0
    let totalFound = 0
    let newCount = 0
    let limitReached = currentCount >= maxCandidates
    const maxPages = search.maxPagesPerRun

    while (pageNum < maxPages && !limitReached) {
      const params = expandQueryForHhApi(query, pageNum, query.perPage ?? 50)
      const resp = await apiGet<HhResumeListResponse>('/resumes', accessToken, params)

      if (pageNum === 0) totalFound = resp.found

      if (!resp.items || resp.items.length === 0) break

      // Дедуп по (savedSearchId, hhResumeId): просто пытаемся вставить с onConflictDoNothing
      for (const item of resp.items) {
        if (!item.id) continue
        const snap = buildSnapshot(item)
        const inserted = await db
          .insert(hhSourcingCandidate)
          .values({
            organizationId: search.organizationId,
            savedSearchId: search.id,
            jobId: search.jobId,
            hhResumeId: item.id,
            snapshot: snap as unknown as Record<string, unknown>,
            state: 'new',
          })
          .onConflictDoNothing({
            target: [hhSourcingCandidate.savedSearchId, hhSourcingCandidate.hhResumeId],
          })
          .returning({ id: hhSourcingCandidate.id })

        if (inserted.length > 0) {
          newCount++
          currentCount++
          if (currentCount >= maxCandidates) {
            limitReached = true
            break
          }
        } else {
          // Уже есть — обновим lastSeenAt И snapshot (чтобы данные не устаревали).
          // Это основа для будущего диффа профиля.
          await db.update(hhSourcingCandidate)
            .set({
              lastSeenAt: new Date(),
              snapshot: snap as unknown as Record<string, unknown>,
              updatedAt: new Date(),
            })
            .where(and(
              eq(hhSourcingCandidate.savedSearchId, search.id),
              eq(hhSourcingCandidate.hhResumeId, item.id),
            ))
        }
      }

      pageNum++
      if (pageNum >= resp.pages) break

      // Rate-limit на всякий
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS))
    }

    // Финальный апдейт. Если лимит исчерпан — сбрасываем автозапуск, никаких новых тиков.
    const nextRunAt = !limitReached && search.autoRunEnabled && search.scheduleMinutes
      ? new Date(Date.now() + search.scheduleMinutes * 60_000)
      : null

    await db.update(hhSavedSearch)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: limitReached ? 'limit_reached' : 'ok',
        lastRunError: null,
        lastRunFound: totalFound,
        lastRunNew: newCount,
        nextRunAt,
        autoRunEnabled: limitReached ? false : search.autoRunEnabled,
        updatedAt: new Date(),
      })
      .where(eq(hhSavedSearch.id, savedSearchId))

    return {
      searchId: savedSearchId,
      found: totalFound,
      new: newCount,
      pages: pageNum,
      status: 'ok',
      error: null,
      durationMs: Date.now() - startedAt,
    }
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.update(hhSavedSearch)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: 'error',
        lastRunError: msg.slice(0, 1000),
        // При ошибке всё равно переставляем nextRunAt, чтобы не зависнуть
        nextRunAt: search.autoRunEnabled && search.scheduleMinutes
          ? new Date(Date.now() + search.scheduleMinutes * 60_000)
          : null,
        updatedAt: new Date(),
      })
      .where(eq(hhSavedSearch.id, savedSearchId))

    return {
      searchId: savedSearchId,
      found: 0,
      new: 0,
      pages: 0,
      status: 'error',
      error: msg,
      durationMs: Date.now() - startedAt,
    }
  }
}

/**
 * Найти все поиски, которые пора запускать, и обработать их по очереди.
 * Best-effort: ошибка в одном не блокирует остальные.
 */
export async function runDueSourcingSearches(): Promise<SourcingRunResult[]> {
  // Семантика: nextRunAt выставляется всегда при создании/run-now/PATCH.
  // autoRunEnabled влияет только на ПОСЛЕДУЮЩИЕ прогоны — первый прогон и ad-hoc run-now
  // идут всегда, даже если auto выключён.
  const due = await db
    .select({ id: hhSavedSearch.id })
    .from(hhSavedSearch)
    .where(and(
      eq(hhSavedSearch.isArchived, false),
      isNotNull(hhSavedSearch.nextRunAt),
      lte(hhSavedSearch.nextRunAt, new Date()),
    ))
    .limit(20) // безопасный потолок на тик

  const results: SourcingRunResult[] = []
  for (const row of due) {
    try {
      const r = await runSourcingSearch(row.id)
      results.push(r)
    }
    catch (err) {
      results.push({
        searchId: row.id,
        found: 0, new: 0, pages: 0,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      })
    }
  }
  return results
}
