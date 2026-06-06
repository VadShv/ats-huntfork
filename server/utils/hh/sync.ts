/**
 * Фоновая синхронизация откликов hh.ru → Huntfork.
 *
 * Для каждой связанной вакансии (hh_vacancy_link):
 *   1. Берём свежий access_token через getValidAccessToken().
 *   2. Запрашиваем GET /negotiations?vacancy_id=...&page=...&per_page=100.
 *      Эндпоинт возвращает отклики на вакансию работодателя (collection=response/consider).
 *   3. Для каждого нового negotiation:
 *      - Идемпотентно по (organizationId, hhNegotiationId) — если уже импортирован,
 *        просто обновляем lastSeenAt + rawNegotiationJson.
 *      - Подтягиваем резюме GET /resumes/{id} (если ещё не сохраняли).
 *      - Создаём/находим candidate по email или (если email скрыт) по hh_resume_id.
 *      - Создаём application (source='hh', externalId=negotiationId).
 *      - Кладём резюме в document.parsedContent = { text } для последующего скоринга.
 *      - Пишем hh_negotiation с raw-снепшотами.
 *   4. Обновляем link.lastSyncAt / lastSyncStatus / importedCount.
 *
 * Все шаги делаем «best-effort»: ошибка одного отклика не валит весь синк.
 */
import { and, eq, inArray } from 'drizzle-orm'
import {
  application, applicationStageHistory, candidate, document, hhAccount,
  hhNegotiation, hhVacancyLink, job,
} from '../../database/schema'
import { apiGet } from './client'
import { getValidAccessToken } from './tokens'
import { getEntryStageForPipeline } from '../pipeline-helpers'
import { autoScoreApplication } from '../ai/autoScore'
import { extractIdentitiesFromHhResume } from '../dedup/extract'
import { getOrgGroupId, resolveCandidateBySignals, upsertCandidateIdentities } from '../dedup/resolve'
import { appendResumeVersionIfChanged } from '../resume-version/append'

interface HhResumeApi {
  id: string
  first_name?: string
  last_name?: string
  middle_name?: string
  title?: string
  contact?: Array<{ type?: { id?: string }, value?: unknown, preferred?: boolean }>
  total_experience?: { months?: number }
  experience?: Array<{
    company?: string
    position?: string
    description?: string
    start?: string
    end?: string
  }>
  education?: { primary?: Array<{ name?: string, organization?: string, year?: number }> }
  skill_set?: string[]
  skills?: string
  area?: { name?: string }
  gender?: { id?: string }
  birth_date?: string
  alternate_url?: string
  [key: string]: unknown
}

interface HhNegotiationItem {
  id: string
  resume?: { id?: string, alternate_url?: string } | null
  state?: { id?: string, name?: string } | null
  created_at?: string
  updated_at?: string
  vacancy?: { id?: string } | null
  [key: string]: unknown
}

interface HhNegotiationsPage {
  found?: number
  pages?: number
  page?: number
  per_page?: number
  items: HhNegotiationItem[]
  collection?: string
}

/** Превращаем структурированное резюме hh.ru в плоский текст для AI-скоринга. */
function resumeToText(r: HhResumeApi): string {
  const lines: string[] = []
  const fullName = [r.last_name, r.first_name, r.middle_name].filter(Boolean).join(' ').trim()
  if (fullName) lines.push(fullName)
  if (r.title) lines.push(`Желаемая должность: ${r.title}`)
  if (r.area?.name) lines.push(`Регион: ${r.area.name}`)
  if (r.total_experience?.months) {
    const years = Math.floor(r.total_experience.months / 12)
    const months = r.total_experience.months % 12
    lines.push(`Общий опыт: ${years} лет ${months} мес.`)
  }
  if (r.experience?.length) {
    lines.push('', '=== Опыт работы ===')
    for (const exp of r.experience) {
      const period = [exp.start, exp.end].filter(Boolean).join(' — ')
      lines.push(`• ${exp.position || '(должность не указана)'} в ${exp.company || '(компания не указана)'} ${period ? `(${period})` : ''}`.trim())
      if (exp.description) lines.push(exp.description.replace(/<[^>]+>/g, '').trim())
    }
  }
  if (r.education?.primary?.length) {
    lines.push('', '=== Образование ===')
    for (const ed of r.education.primary) {
      lines.push(`• ${ed.organization || ''} ${ed.name ? `— ${ed.name}` : ''} ${ed.year ? `(${ed.year})` : ''}`.trim())
    }
  }
  if (r.skill_set?.length) {
    lines.push('', '=== Ключевые навыки ===', r.skill_set.join(', '))
  }
  if (r.skills) {
    lines.push('', '=== О себе ===', r.skills.replace(/<[^>]+>/g, '').trim())
  }
  return lines.join('\n').trim()
}

/** Извлекаем email/phone из contact[]. */
function extractContacts(r: HhResumeApi): { email?: string, phone?: string } {
  let email: string | undefined
  let phone: string | undefined
  for (const c of r.contact || []) {
    const type = c.type?.id
    const v = c.value
    if (type === 'email' && typeof v === 'string') email = v
    if (type === 'cell' && v && typeof v === 'object') {
      const formatted = (v as { formatted?: string }).formatted
      if (formatted) phone = formatted
    }
  }
  return { email, phone }
}

/** Маппим hh.state → application.status (узкий перенос). */
function mapApplicationStatus(_hhState?: string | null): 'new' | 'reviewing' | 'rejected' | 'hired' {
  // Все импортированные отклики стартуют в 'new' — кадровик дальше двигает по pipeline вручную.
  return 'new'
}

export interface SyncLinkResult {
  linkId: string
  jobId: string
  fetched: number
  created: number
  updated: number
  failed: number
  error?: string
}

/**
 * Синхронизирует один hh_vacancy_link. Возвращает счётчики.
 */
export async function syncVacancyLink(linkId: string): Promise<SyncLinkResult> {
  const linkRows = await db
    .select()
    .from(hhVacancyLink)
    .where(eq(hhVacancyLink.id, linkId))
    .limit(1)
  const link = linkRows[0]
  if (!link) throw new Error(`hh_vacancy_link ${linkId} not found`)

  const result: SyncLinkResult = {
    linkId: link.id,
    jobId: link.jobId,
    fetched: 0,
    created: 0,
    updated: 0,
    failed: 0,
  }

  // Получаем job (нужен pipelineId + autoScoreOnApply)
  const jobRows = await db
    .select({ id: job.id, pipelineId: job.pipelineId, autoScoreOnApply: job.autoScoreOnApply })
    .from(job)
    .where(eq(job.id, link.jobId))
    .limit(1)
  const jobRow = jobRows[0]
  if (!jobRow) {
    result.error = 'job not found'
    return result
  }

  let entryStageId: string | null = null
  if (jobRow.pipelineId) {
    const entry = await getEntryStageForPipeline(db, jobRow.pipelineId)
    entryStageId = entry?.id ?? null
  }

  let token: string
  try {
    token = await getValidAccessToken(link.hhAccountId)
  }
  catch (err) {
    result.error = `token: ${err instanceof Error ? err.message : String(err)}`
    await db.update(hhVacancyLink).set({
      lastSyncAt: new Date(),
      lastSyncStatus: 'error',
      lastSyncError: result.error.slice(0, 500),
      updatedAt: new Date(),
    }).where(eq(hhVacancyLink.id, link.id))
    return result
  }

  // ── 1. Тянем отклики по всем коллекциям работодателя ───────────────
  // У работодателя hh.ru отклики разнесены по коллекциям. Чистый
  // GET /negotiations?vacancy_id=... ничего не возвращает — нужно ходить
  // в GET /negotiations/<collection>?vacancy_id=... для каждой коллекции.
  const EMPLOYER_COLLECTIONS = [
    'response',
    'consider',
    'phone_interview',
    'assessment',
    'interview',
    'offer',
    'hired',
    'discard_by_employer',
    'discard_visible_by_opponent',
    'discard_after_interview',
  ] as const
  const collected: HhNegotiationItem[] = []
  const collectionStats: Record<string, number> = {}
  try {
    // Для коллекций работодателя hh.ru лимит per_page = 50 (не 100, как обычно).
    const perPage = 50
    for (const collection of EMPLOYER_COLLECTIONS) {
      let page = 0
      let inCollection = 0
      // защита от рантэвея — до 40 страниц = 2000 на коллекцию
      while (page < 40) {
        let data: HhNegotiationsPage
        try {
          data = await apiGet<HhNegotiationsPage>(`/negotiations/${collection}`, token, {
            vacancy_id: link.hhVacancyId,
            page,
            per_page: perPage,
          })
        }
        catch (innerErr) {
          // 404/403 на коллекции — возможно она недоступна для тарифа.
          // Логируем и идём дальше, не валим весь синк.
          console.warn(`[hh:sync] link=${link.id} collection=${collection} skipped:`, innerErr instanceof Error ? innerErr.message : innerErr)
          break
        }
        const items = data.items || []
        collected.push(...items)
        result.fetched += items.length
        inCollection += items.length
        const totalPages = data.pages ?? 1
        if (page + 1 >= totalPages || items.length < perPage) break
        page += 1
      }
      if (inCollection > 0) collectionStats[collection] = inCollection
    }
    if (result.fetched > 0) {
      console.log(`[hh:sync] link=${link.id} vac=${link.hhVacancyId} collections=${JSON.stringify(collectionStats)}`)
    }
  }
  catch (err) {
    result.error = `fetch: ${err instanceof Error ? err.message : String(err)}`
    await db.update(hhVacancyLink).set({
      lastSyncAt: new Date(),
      lastSyncStatus: 'error',
      lastSyncError: result.error.slice(0, 500),
      updatedAt: new Date(),
    }).where(eq(hhVacancyLink.id, link.id))
    return result
  }

  // Дедупликация по id — один отклик может попасть в несколько коллекций.
  const seenIds = new Set<string>()
  for (let i = collected.length - 1; i >= 0; i--) {
    const item = collected[i]
    if (!item || !item.id || seenIds.has(item.id)) collected.splice(i, 1)
    else if (item.id) seenIds.add(item.id)
  }
  result.fetched = collected.length

  if (collected.length === 0) {
    await db.update(hhVacancyLink).set({
      lastSyncAt: new Date(),
      lastSyncStatus: 'ok',
      lastSyncError: null,
      updatedAt: new Date(),
    }).where(eq(hhVacancyLink.id, link.id))
    return result
  }

  // ── 2. Какие negotiationId уже есть? ─────────────────────────────────
  const incomingIds = collected.map(n => n.id).filter(Boolean)
  const existingNegRows = incomingIds.length
    ? await db
      .select({ id: hhNegotiation.id, hhNegotiationId: hhNegotiation.hhNegotiationId, applicationId: hhNegotiation.applicationId })
      .from(hhNegotiation)
      .where(and(
        eq(hhNegotiation.organizationId, link.organizationId),
        inArray(hhNegotiation.hhNegotiationId, incomingIds),
      ))
    : []
  const existingByHhId = new Map(existingNegRows.map(r => [r.hhNegotiationId, r]))

  // ── 3. Обрабатываем каждый отклик ────────────────────────────────────
  const newApplicationIds: string[] = []

  for (const neg of collected) {
    try {
      const existing = existingByHhId.get(neg.id)

      if (existing) {
        // Обновим last_seen + сырой JSON
        await db.update(hhNegotiation).set({
          rawNegotiationJson: neg as unknown,
          hhState: neg.state?.id ?? null,
          hhUpdatedAt: neg.updated_at ? new Date(neg.updated_at) : null,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(hhNegotiation.id, existing.id))
        result.updated += 1
        continue
      }

      const resumeId = neg.resume?.id
      if (!resumeId) {
        result.failed += 1
        continue
      }

      // Подтянем резюме
      let resume: HhResumeApi
      try {
        resume = await apiGet<HhResumeApi>(`/resumes/${resumeId}`, token)
      }
      catch {
        result.failed += 1
        continue
      }

      const { email: hhEmail, phone } = extractContacts(resume)
      const fallbackEmail = hhEmail || `hh-${resumeId}@no-email.huntfork.local`
      const firstName = resume.first_name || 'Кандидат'
      const lastName = resume.last_name || `hh#${resumeId.slice(-6)}`

      // ─── Дедупликация через candidate_identity ───
      // 1) вытянем все сигналы из резюме: hh_owner, hh_resume, phone, email, linkedin, telegram
      const identitySignals = extractIdentitiesFromHhResume(resume as unknown as Record<string, unknown>)
      const groupId = await getOrgGroupId(link.organizationId)
      const resolved = await resolveCandidateBySignals(groupId, identitySignals)

      // Общее для всех веток: снепшот сырого резюме для сохранения в candidate.
      const resumeSnapshot = {
        hhResumeId: resumeId,
        hhResumeRaw: resume as unknown as Record<string, unknown>,
        hhResumeFetchedAt: new Date(),
      }

      let candidateId: string
      if (resolved.candidateId) {
        // Нашли существующего кандидата по одному из сигналов — переиспользуем
        candidateId = resolved.candidateId
        await db.update(candidate).set({
          hhResumeId: resumeSnapshot.hhResumeId,
          hhResumeRaw: resumeSnapshot.hhResumeRaw,
          hhResumeFetchedAt: resumeSnapshot.hhResumeFetchedAt,
          // подобьём телефон, если раньше не было и сейчас пришёл
          ...(phone ? { phone } : {}),
          updatedAt: new Date(),
        }).where(eq(candidate.id, candidateId))
        if (resolved.hasConflict) {
          // Разные сигналы указали на разных кандидатов — логируем, разберём в дашборде дублей.
          console.warn('[hh:sync] identity conflict during import', {
            picked: candidateId,
            matches: resolved.matches,
          })
        }
      }
      else {
        // Ничего не нашли по identity. Для баквард-совместимости с до-бэкфильными записями
        // всё ещё проверим старым способом — по (org, email).
        const existingCand = await db
          .select({ id: candidate.id })
          .from(candidate)
          .where(and(
            eq(candidate.organizationId, link.organizationId),
            eq(candidate.email, fallbackEmail),
          ))
          .limit(1)
        if (existingCand.length > 0) {
          candidateId = existingCand[0]!.id
          await db.update(candidate).set({
            hhResumeId: resumeSnapshot.hhResumeId,
            hhResumeRaw: resumeSnapshot.hhResumeRaw,
            hhResumeFetchedAt: resumeSnapshot.hhResumeFetchedAt,
            ...(phone ? { phone } : {}),
            updatedAt: new Date(),
          }).where(eq(candidate.id, candidateId))
        }
        else {
          const insCand = await db.insert(candidate).values({
            organizationId: link.organizationId,
            firstName,
            lastName,
            email: fallbackEmail,
            phone: phone ?? null,
            hhResumeId: resumeSnapshot.hhResumeId,
            hhResumeRaw: resumeSnapshot.hhResumeRaw,
            hhResumeFetchedAt: resumeSnapshot.hhResumeFetchedAt,
          }).returning({ id: candidate.id })
          candidateId = insCand[0]!.id
        }
      }

      // Сохраняем (или обновляем last_seen_at) все identity-сигналы для этого кандидата.
      if (identitySignals.length > 0) {
        await upsertCandidateIdentities({
          candidateId,
          organizationId: link.organizationId,
          groupId,
          signals: identitySignals,
        })
      }

      // ─── Версионирование резюме ───
      // Если контент резюме изменился (стабильный хеш) и прошло > 1 часа с прошлой версии —
      // создаём новую запись в candidate_resume_version. Иначе — обновляем текущую.
      try {
        const hhUpdatedAtRaw = (resume as { updated_at?: string }).updated_at
        const hhUpdatedAt = hhUpdatedAtRaw ? new Date(hhUpdatedAtRaw) : null
        await appendResumeVersionIfChanged({
          candidateId,
          raw: resume as unknown as Record<string, unknown>,
          source: 'hh',
          triggeredBy: 'auto-sync',
          hhUpdatedAt: hhUpdatedAt && !isNaN(hhUpdatedAt.getTime()) ? hhUpdatedAt : null,
        })
      }
      catch (err) {
        // Версионирование не должно ломать импорт — логируем и идём дальше.
        console.warn('[hh:sync] resume versioning failed', { candidateId, err: (err as Error).message })
      }

      // Resume document — по storageKey hh://resume/{resumeId}
      const storageKey = `hh://resume/${resumeId}`
      const existingDoc = await db
        .select({ id: document.id })
        .from(document)
        .where(eq(document.storageKey, storageKey))
        .limit(1)
      const resumeText = resumeToText(resume)
      if (existingDoc.length === 0) {
        await db.insert(document).values({
          organizationId: link.organizationId,
          candidateId,
          type: 'resume',
          storageKey,
          originalFilename: `hh-resume-${resumeId}.json`,
          mimeType: 'application/json',
          parsedContent: { text: resumeText, source: 'hh.ru', resumeId } as unknown,
        })
      }

      // Application: idempotent по (org, candidate, job)
      let applicationId: string
      const existingApp = await db
        .select({ id: application.id })
        .from(application)
        .where(and(
          eq(application.organizationId, link.organizationId),
          eq(application.candidateId, candidateId),
          eq(application.jobId, link.jobId),
        ))
        .limit(1)
      const createdAt = neg.created_at ? new Date(neg.created_at) : new Date()
      if (existingApp.length > 0) {
        applicationId = existingApp[0]!.id
        // дополним source/externalId если ещё не проставлены
        await db.update(application).set({
          source: 'hh',
          externalId: neg.id,
          externalUrl: neg.resume?.alternate_url ?? null,
          updatedAt: new Date(),
        }).where(eq(application.id, applicationId))
      }
      else {
        const insApp = await db.insert(application).values({
          organizationId: link.organizationId,
          candidateId,
          jobId: link.jobId,
          status: mapApplicationStatus(neg.state?.id),
          currentStageId: entryStageId,
          stageChangedAt: entryStageId ? createdAt : null,
          source: 'hh',
          externalId: neg.id,
          externalUrl: neg.resume?.alternate_url ?? null,
        }).returning({ id: application.id })
        applicationId = insApp[0]!.id
        if (entryStageId) {
          try {
            await db.insert(applicationStageHistory).values({
              organizationId: link.organizationId,
              applicationId,
              fromStageId: null,
              toStageId: entryStageId,
              movedByUserId: null,
              movedAt: createdAt,
            })
          } catch { /* best-effort */ }
        }
        newApplicationIds.push(applicationId)
      }

      // hh_negotiation
      await db.insert(hhNegotiation).values({
        organizationId: link.organizationId,
        hhVacancyLinkId: link.id,
        applicationId,
        hhNegotiationId: neg.id,
        hhResumeId: resumeId,
        hhCollection: typeof neg.collection === 'string' ? neg.collection : null,
        hhState: neg.state?.id ?? null,
        hhCreatedAt: neg.created_at ? new Date(neg.created_at) : null,
        hhUpdatedAt: neg.updated_at ? new Date(neg.updated_at) : null,
        rawResumeJson: resume as unknown,
        rawNegotiationJson: neg as unknown,
      })

      result.created += 1
    }
    catch (err) {
      // Не валим весь синк из-за одного отклика
      console.error('hh sync: negotiation failed', neg.id, err)
      result.failed += 1
    }
  }

  // ── 4. Финальный апдейт link ─────────────────────────────────────────
  await db.update(hhVacancyLink).set({
    lastSyncAt: new Date(),
    lastSyncStatus: result.failed === 0 ? 'ok' : 'partial',
    lastSyncError: null,
    importedCount: (link.importedCount ?? 0) + result.created,
    updatedAt: new Date(),
  }).where(eq(hhVacancyLink.id, link.id))

  // ── 5. Авто-скоринг (если включён на вакансии) ───────────────────────
  if (jobRow.autoScoreOnApply && newApplicationIds.length > 0) {
    // Fire-and-forget — не блокируем синк
    for (const appId of newApplicationIds) {
      autoScoreApplication(appId, link.organizationId).catch((e) => {
        console.error('hh sync: autoScore failed for', appId, e)
      })
    }
  }

  return result
}

/**
 * Синхронизирует все активные hh-связи (autoSyncEnabled=true).
 * Используется фоновой задачей и кнопкой «Синхронизировать всё» в UI.
 */
export async function syncAllActiveLinks(): Promise<SyncLinkResult[]> {
  const links = await db
    .select({ id: hhVacancyLink.id, organizationId: hhVacancyLink.organizationId })
    .from(hhVacancyLink)
    .innerJoin(hhAccount, eq(hhAccount.id, hhVacancyLink.hhAccountId))
    .where(and(
      eq(hhVacancyLink.autoSyncEnabled, true),
      eq(hhAccount.isActive, true),
    ))

  const results: SyncLinkResult[] = []
  for (const l of links) {
    try {
      const r = await syncVacancyLink(l.id)
      results.push(r)
    }
    catch (err) {
      results.push({
        linkId: l.id,
        jobId: '',
        fetched: 0, created: 0, updated: 0, failed: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return results
}
