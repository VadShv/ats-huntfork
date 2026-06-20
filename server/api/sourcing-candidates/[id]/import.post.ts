/**
 * POST /api/sourcing-candidates/:id/import
 *
 * Импортирует сорсинг-кандидата в воронку:
 *   1. Дёргает полное резюме hh.ru (тратит квоту, аналогично «открытию контакта»)
 *   2. Создаёт candidate + application (если ещё не существует)
 *   3. Помещает application в entry-stage вакансии
 *   4. Помечает sourcing-кандидата state='imported' + сохраняет applicationId
 *   5. Логирует действие в hh_action_log
 *
 * Идемпотентно: повторный вызов вернёт existing applicationId без создания дубля.
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  application,
  applicationStageHistory,
  candidate,
  hhActionLog,
  hhSavedSearch,
  hhSourcingCandidate,
  job,
} from '../../../database/schema'
import { apiGet } from '../../../utils/hh/client'
import { getValidAccessToken } from '../../../utils/hh/tokens'
import { getEntryStageForPipeline } from '../../../utils/pipeline-helpers'

const paramsSchema = z.object({ id: z.string().min(1) })

interface HhResumeFull {
  id: string
  first_name?: string | null
  last_name?: string | null
  middle_name?: string | null
  title?: string | null
  can_view_full_info?: boolean
  /**
   * hh.ru actions: `get_with_contact` (БЕЗ s) — платный URL раскрытия контактов,
   * `url` — бесплатный URL если контакт уже был открыт. На этапе импорта мы
   * ничего из этого не дёргаем — раскрытие идёт через POST /api/candidates/:id/open-hh-contacts.
   */
  actions?: {
    get_with_contact?: { url?: string }
    url?: string
  }
  contact?: Array<{
    type?: { id?: string, name?: string }
    value?: string | { formatted?: string, country?: string, city?: string, number?: string }
    preferred?: boolean
  }>
  alternate_url?: string
}

/**
 * Имя кандидата для записи в БД: last_name first_name → title резюме → fallback.
 * Раньше дефолт был «Без / имени» — теперь даём осмысленное имя из резюме hh,
 * а если совсем ничего нет — используем заголовок резюме или короткий ID.
 */
function extractName(resume: HhResumeFull, hhResumeId: string): { firstName: string, lastName: string } {
  const last = (resume.last_name ?? '').trim()
  const first = (resume.first_name ?? '').trim()
  if (first || last) {
    return { firstName: first || '—', lastName: last || '—' }
  }
  // Подписки нет → first/last hh не отдал. Пытаемся title резюме.
  const title = (resume.title ?? '').trim()
  if (title) {
    return { firstName: 'Кандидат hh.ru', lastName: title.slice(0, 80) }
  }
  // Совсем ничего нет → короткий fallback.
  return { firstName: 'Кандидат hh.ru', lastName: `#${hhResumeId.slice(-6)}` }
}

function extractEmail(resume: HhResumeFull): string | null {
  for (const c of resume.contact ?? []) {
    if (c.type?.id === 'email' && typeof c.value === 'string') return c.value
  }
  return null
}

function extractPhone(resume: HhResumeFull): string | null {
  for (const c of resume.contact ?? []) {
    if (c.type?.id === 'cell' || c.type?.id === 'home' || c.type?.id === 'work') {
      const v = c.value
      if (typeof v === 'string') return v
      if (v && typeof v === 'object' && 'formatted' in v && v.formatted) return v.formatted
    }
  }
  return null
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  // 1. Грузим сорсинг-кандидата
  const sc = await db.query.hhSourcingCandidate.findFirst({
    where: and(eq(hhSourcingCandidate.id, id), eq(hhSourcingCandidate.organizationId, orgId)),
  })
  if (!sc) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }

  // Если уже импортирован — возвращаем existing
  if (sc.state === 'imported' && sc.applicationId) {
    return { applicationId: sc.applicationId, alreadyImported: true }
  }

  // 2. Грузим job + saved search (для hhAccountId)
  const jobRow = await db.query.job.findFirst({
    where: and(eq(job.id, sc.jobId), eq(job.organizationId, orgId)),
    columns: { id: true, pipelineId: true },
  })
  if (!jobRow) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const searchRow = await db
    .select({ id: hhSavedSearch.id, hhAccountId: hhSavedSearch.hhAccountId })
    .from(hhSavedSearch)
    .where(eq(hhSavedSearch.id, sc.savedSearchId))
    .limit(1)
  if (searchRow.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Сорсинг-поиск не найден' })
  }
  const hhAccountId = searchRow[0]!.hhAccountId

  // 3. Тянем полное резюме hh.ru БЕЗ раскрытия контактов (квота НЕ тратится).
  //
  // Раньше здесь автоматически дёргался `actions.get_with_contacts.url` — это
  // сжигало платные просмотры контактов. Теперь импорт всегда дешёвый:
  // получаем публичные данные резюме (опыт, навыки, образование, заголовок),
  // а ФИО и контакты остаются «закрытыми». Рекрутер потом сам нажимает
  // кнопку «Открыть контакты hh.ru» на странице кандидата — там и тратится квота.
  const accessToken = await getValidAccessToken(hhAccountId)
  let resume: HhResumeFull
  try {
    resume = await apiGet<HhResumeFull>(`/resumes/${sc.hhResumeId}`, accessToken)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.insert(hhActionLog).values({
      organizationId: orgId,
      hhAccountId,
      performedByUserId: userId,
      actionType: 'import_sourcing',
      hhResumeId: sc.hhResumeId,
      sourcingCandidateId: id,
      requestPayload: { sourcingCandidateId: id } as Record<string, unknown>,
      error: msg.slice(0, 1000),
    })
    throw createError({
      statusCode: 502,
      statusMessage: `Не удалось получить резюме hh.ru: ${msg.slice(0, 200)}`,
    })
  }

  const { firstName, lastName } = extractName(resume, sc.hhResumeId)
  const email = extractEmail(resume) ?? `hh-${sc.hhResumeId}@noemail.local`
  const phone = extractPhone(resume)

  // 4. Создаём/находим candidate (идемпотентно по hhResumeId)
  let candidateId: string
  const existingCand = await db
    .select({ id: candidate.id })
    .from(candidate)
    .where(and(
      eq(candidate.organizationId, orgId),
      eq(candidate.hhResumeId, sc.hhResumeId),
    ))
    .limit(1)

  if (existingCand.length > 0) {
    candidateId = existingCand[0]!.id
    await db.update(candidate)
      .set({
        hhResumeRaw: resume as unknown as Record<string, unknown>,
        hhResumeFetchedAt: new Date(),
        ...(phone ? { phone } : {}),
        updatedAt: new Date(),
      })
      .where(eq(candidate.id, candidateId))
  } else {
    const ins = await db.insert(candidate).values({
      organizationId: orgId,
      firstName,
      lastName,
      email,
      phone,
      hhResumeId: sc.hhResumeId,
      hhResumeRaw: resume as unknown as Record<string, unknown>,
      hhResumeFetchedAt: new Date(),
    }).returning({ id: candidate.id })
    candidateId = ins[0]!.id
  }

  // 5. Application (идемпотентно по org+candidate+job)
  let entryStageId: string | null = null
  if (jobRow.pipelineId) {
    const entry = await getEntryStageForPipeline(db, jobRow.pipelineId)
    entryStageId = entry?.id ?? null
  }

  let applicationId: string
  const existingApp = await db
    .select({ id: application.id })
    .from(application)
    .where(and(
      eq(application.organizationId, orgId),
      eq(application.candidateId, candidateId),
      eq(application.jobId, sc.jobId),
    ))
    .limit(1)

  if (existingApp.length > 0) {
    applicationId = existingApp[0]!.id
  } else {
    const insApp = await db.insert(application).values({
      organizationId: orgId,
      candidateId,
      jobId: sc.jobId,
      // application_status enum: new|screening|interview|offer|hired|rejected
      status: 'new',
      currentStageId: entryStageId,
      stageChangedAt: entryStageId ? new Date() : null,
      source: 'hh_sourcing',
      externalId: sc.hhResumeId,
      externalUrl: resume.alternate_url ?? null,
    }).returning({ id: application.id })
    applicationId = insApp[0]!.id

    if (entryStageId) {
      await db.insert(applicationStageHistory).values({
        organizationId: orgId,
        applicationId,
        fromStageId: null,
        toStageId: entryStageId,
        movedByUserId: userId,
        comment: 'Импортирован из сорсинга hh.ru',
      }).onConflictDoNothing()
    }
  }

  // 6. Обновляем sourcing-candidate
  await db.update(hhSourcingCandidate)
    .set({
      state: 'imported',
      applicationId,
      reviewedByUserId: userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(hhSourcingCandidate.id, id))

  // 7. Логируем
  await db.insert(hhActionLog).values({
    organizationId: orgId,
    hhAccountId,
    performedByUserId: userId,
    actionType: 'import_sourcing',
    hhResumeId: sc.hhResumeId,
    sourcingCandidateId: id,
    applicationId,
    requestPayload: {
      sourcingCandidateId: id,
      applicationId,
      candidateId,
    } as Record<string, unknown>,
    responseStatus: 200,
    responseBody: { ok: true } as Record<string, unknown>,
  })

  // Sprint 11: переиндексируем full-text поиск (приехало новое hh_resume_raw).
  const { refreshCandidateSearchTsv } = await import('../../../utils/candidateSearchText')
  refreshCandidateSearchTsv({ orgId, candidateId }).catch((e) => {
    console.error('sourcing-candidates import: search_tsv refresh failed for', candidateId, e)
  })

  return {
    applicationId,
    candidateId,
    alreadyImported: false,
  }
})
