/**
 * POST /api/candidates/:id/open-hh-contacts
 *
 * Раскрывает контакты кандидата на hh.ru (тратит 1 платный просмотр контактов).
 *
 *   1. Находит существующего кандидата + его hhResumeId
 *   2. Определяет hhAccountId через связанный hh_sourcing_candidate
 *      (или через первый активный hh_account организации, если sourcing нет)
 *   3. Дёргает /resumes/{hhResumeId}, забирает actions.get_with_contacts.url
 *   4. Если URL есть — фетчит его (СПИСЫВАЕТСЯ КВОТА hh.ru)
 *   5. Обновляет candidate: firstName, lastName, email, phone, hhResumeRaw, hhResumeFetchedAt
 *   6. Логирует в hh_action_log с actionType='open_contacts'
 *
 * Идемпотентно НЕ является — каждый успешный вызов тратит квоту. UI должен
 * блокировать кнопку, если контакты уже раскрыты (firstName !== 'Кандидат hh.ru'
 * и email не вида hh-*@noemail.local).
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  candidate,
  hhAccount,
  hhActionLog,
  hhSavedSearch,
  hhSourcingCandidate,
} from '../../../database/schema'
import { findDuplicatesForDraft } from '../../../utils/dedup/check'
import { apiGet } from '../../../utils/hh/client'
import { getValidAccessToken } from '../../../utils/hh/tokens'
import { refreshCandidateSearchTsv } from '../../../utils/candidateSearchText'
import {
  isHhPlaceholderFirstName,
  isHhPlaceholderEmail,
} from '../../../../shared/hh-placeholders'

const paramsSchema = z.object({ id: z.string().min(1) })

interface HhResumeFull {
  id: string
  first_name?: string | null
  last_name?: string | null
  middle_name?: string | null
  title?: string | null
  can_view_full_info?: boolean
  /**
   * hh.ru actions:
   *   - `get_with_contact.url` (БЕЗ s!) — платный URL для раскрытия контактов.
   *     Есть только если у работодателя платный доступ И контакт ещё не
   *     открывался на эту компанию. Фетч этого URL спишет 1 платный просмотр.
   *   - `url` — бесплатный URL для повторного просмотра. Появляется,
   *     если контакт уже открывали ранее — резюме с контактами можно тянуть бесплатно.
   *   - `download` — скачивание PDF.
   */
  actions?: {
    get_with_contact?: { url?: string }
    url?: string
    download?: { pdf?: { url?: string } }
  }
  contact?: Array<{
    type?: { id?: string, name?: string }
    value?: string | { formatted?: string, country?: string, city?: string, number?: string }
    preferred?: boolean
  }>
  alternate_url?: string
}

function extractName(resume: HhResumeFull, hhResumeId: string): { firstName: string, lastName: string } {
  const last = (resume.last_name ?? '').trim()
  const first = (resume.first_name ?? '').trim()
  if (first || last) {
    return { firstName: first || '—', lastName: last || '—' }
  }
  const title = (resume.title ?? '').trim()
  if (title) {
    return { firstName: 'Кандидат hh.ru', lastName: title.slice(0, 80) }
  }
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
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  // 1. Грузим кандидата
  const cand = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
  })
  if (!cand) {
    throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  }
  if (!cand.hhResumeId) {
    throw createError({ statusCode: 400, statusMessage: 'У кандидата нет hh.ru резюме' })
  }

  // 2. Определяем hhAccountId.
  //    Сначала ищем через hh_sourcing_candidate → hh_saved_search.hhAccountId.
  //    Если sourcing нет — берём первый активный hh_account организации.
  let hhAccountId: string | null = null
  const sc = await db
    .select({ savedSearchId: hhSourcingCandidate.savedSearchId })
    .from(hhSourcingCandidate)
    .where(and(
      eq(hhSourcingCandidate.organizationId, orgId),
      eq(hhSourcingCandidate.hhResumeId, cand.hhResumeId),
    ))
    .limit(1)
  if (sc.length > 0) {
    const search = await db
      .select({ hhAccountId: hhSavedSearch.hhAccountId })
      .from(hhSavedSearch)
      .where(eq(hhSavedSearch.id, sc[0]!.savedSearchId))
      .limit(1)
    if (search.length > 0) hhAccountId = search[0]!.hhAccountId
  }
  if (!hhAccountId) {
    const acc = await db
      .select({ id: hhAccount.id })
      .from(hhAccount)
      .where(eq(hhAccount.organizationId, orgId))
      .limit(1)
    if (acc.length > 0) hhAccountId = acc[0]!.id
  }
  if (!hhAccountId) {
    throw createError({ statusCode: 400, statusMessage: 'Не найден подключённый аккаунт hh.ru' })
  }

  // 3. Получаем токен и текущую версию резюме (БЕЗ контактов)
  const accessToken = await getValidAccessToken(hhAccountId)
  let resumeShort: HhResumeFull
  try {
    resumeShort = await apiGet<HhResumeFull>(`/resumes/${cand.hhResumeId}`, accessToken)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.insert(hhActionLog).values({
      organizationId: orgId,
      hhAccountId,
      performedByUserId: userId,
      actionType: 'open_contacts',
      hhResumeId: cand.hhResumeId,
      requestPayload: { candidateId: id } as Record<string, unknown>,
      error: msg.slice(0, 1000),
    })
    throw createError({
      statusCode: 502,
      statusMessage: `Не удалось получить резюме hh.ru: ${msg.slice(0, 200)}`,
    })
  }

  // hh.ru: ключ actions называется `get_with_contact` (БЕЗ s).
  // Если он есть — контакт ещё не открывался, фетч спишет квоту.
  // Если его нет, но есть `actions.url` — контакт уже открыт на нашу
  // компанию (другой менеджер уже списал платный просмотр) — фетчим бесплатно.
  // Если нет ни того, ни другого — платного доступа к этому резюме нет.
  const paidUrl = resumeShort.actions?.get_with_contact?.url
  const freeUrl = resumeShort.actions?.url
  const contactsUrl = paidUrl ?? freeUrl
  const wouldBurnQuota = !!paidUrl

  if (!contactsUrl) {
    await db.insert(hhActionLog).values({
      organizationId: orgId,
      hhAccountId,
      performedByUserId: userId,
      actionType: 'open_contacts',
      hhResumeId: cand.hhResumeId,
      requestPayload: { candidateId: id } as Record<string, unknown>,
      error: 'no_get_with_contact_and_no_actions_url',
    })
    throw createError({
      statusCode: 402,
      statusMessage: 'У аккаунта hh.ru нет доступа к этому резюме (нет ни actions.get_with_contact, ни actions.url)',
    })
  }

  // 4. Тянем резюме с контактами — СПИСЫВАЕТСЯ КВОТА hh.ru
  let resume: HhResumeFull
  try {
    // contactsUrl — абсолютный URL вида https://api.hh.ru/resumes/{id}?with_contacts=true
    // apiGet принимает относительный путь, поэтому используем url напрямую через fetch.
    const r = await fetch(contactsUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'ReqcoreATS/1.0 (admin@reqcore)',
        Accept: 'application/json',
      },
    })
    if (!r.ok) {
      throw new Error(`hh.ru HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
    }
    resume = (await r.json()) as HhResumeFull
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.insert(hhActionLog).values({
      organizationId: orgId,
      hhAccountId,
      performedByUserId: userId,
      actionType: 'open_contacts',
      hhResumeId: cand.hhResumeId,
      requestPayload: { candidateId: id } as Record<string, unknown>,
      error: msg.slice(0, 1000),
    })
    throw createError({
      statusCode: 502,
      statusMessage: `Не удалось раскрыть контакты hh.ru: ${msg.slice(0, 200)}`,
    })
  }

  // 5. Обновляем candidate. Имя/email/телефон перетираем только если они «закрытые».
  const { firstName, lastName } = extractName(resume, cand.hhResumeId)
  const email = extractEmail(resume)
  const phone = extractPhone(resume)

  // Поддерживаем обе исторические конвенции placeholder'ов — см. shared/hh-placeholders.ts.
  const wasPlaceholderName = isHhPlaceholderFirstName(cand.firstName)
  const wasPlaceholderEmail = isHhPlaceholderEmail(cand.email)

  const patch: Record<string, unknown> = {
    hhResumeRaw: resume as unknown as Record<string, unknown>,
    hhResumeFetchedAt: new Date(),
    updatedAt: new Date(),
  }
  // Если имя было placeholder И hh вернул реальное имя (extractName при пустом
  // first_name возвращает 'Кандидат hh.ru' — такое не пишем) — перезаписываем.
  const gotRealName = !isHhPlaceholderFirstName(firstName)
  if (wasPlaceholderName && gotRealName) {
    patch.firstName = firstName
    patch.lastName = lastName
  }
  if (email && wasPlaceholderEmail) {
    patch.email = email
  }
  if (phone && !cand.phone) {
    patch.phone = phone
  }

  await db.update(candidate)
    .set(patch)
    .where(and(eq(candidate.id, id), eq(candidate.organizationId, orgId)))

  // 6. Логируем
  await db.insert(hhActionLog).values({
    organizationId: orgId,
    hhAccountId,
    performedByUserId: userId,
    actionType: 'open_contacts',
    hhResumeId: cand.hhResumeId,
    requestPayload: { candidateId: id, wouldBurnQuota } as Record<string, unknown>,
    responseStatus: 200,
    responseBody: {
      ok: true,
      hasEmail: !!email,
      hasPhone: !!phone,
      quotaBurned: wouldBurnQuota,
    } as Record<string, unknown>,
  })

  // 7. Sprint 2: после раскрытия контактов ищем возможные дубли по свежему email/phone/ФИО+ДР+город.
  // Не создаём жёстких candidate_duplicate_candidate пар — только показываем в UI модалку merge/dismiss.
  // Исключаем кандидата самого себя и merged-пары.
  const draftFirstName = (patch.firstName as string | undefined) ?? cand.firstName
  const draftLastName = (patch.lastName as string | undefined) ?? cand.lastName
  const draftEmail = (patch.email as string | undefined) ?? cand.email
  const draftPhone = (patch.phone as string | undefined) ?? cand.phone
  const draftDob = cand.dateOfBirth ?? null
  // Город на этом этапе берём из hh resume.area.name (поле похоже лежит в candidate.city)
  const draftCity = cand.city ?? null

  let possibleDuplicates: Array<{
    candidateId: string
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
    matchKind: 'exact-email' | 'exact-phone' | 'fuzzy'
    score: number | null
    crossOrg: boolean
  }> = []

  try {
    const dups = await findDuplicatesForDraft(orgId, {
      firstName: draftFirstName,
      lastName: draftLastName,
      email: draftEmail,
      phone: draftPhone,
      dateOfBirth: draftDob,
      city: draftCity,
    })
    const seen = new Set<string>()
    for (const e of dups.exact) {
      if (e.candidateId === id) continue
      if (seen.has(e.candidateId)) continue
      seen.add(e.candidateId)
      possibleDuplicates.push({
        candidateId: e.candidateId,
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email,
        phone: e.phone,
        matchKind: e.kind === 'email' ? 'exact-email' : 'exact-phone',
        score: null,
        crossOrg: e.crossOrg,
      })
    }
    for (const f of dups.fuzzy) {
      if (f.candidateId === id) continue
      if (seen.has(f.candidateId)) continue
      seen.add(f.candidateId)
      possibleDuplicates.push({
        candidateId: f.candidateId,
        firstName: f.firstName,
        lastName: f.lastName,
        email: f.email,
        phone: f.phone,
        matchKind: 'fuzzy',
        score: f.score,
        crossOrg: f.crossOrg,
      })
    }
  } catch (err) {
    // Не блокируем основной ответ из-за ошибки дедупа.
    console.error('[open-hh-contacts] dedup failed:', err)
  }

  // Sprint 11: обновляем full-text индекс поиска (приехало новое hh_resume_raw + реальное имя).
  refreshCandidateSearchTsv({ orgId, candidateId: id }).catch((err) => {
    console.error('[open-hh-contacts] search_tsv refresh failed:', err)
  })

  return {
    ok: true as const,
    candidateId: id,
    firstName: draftFirstName,
    lastName: draftLastName,
    email: draftEmail,
    phone: draftPhone ?? null,
    possibleDuplicates,
  }
})
