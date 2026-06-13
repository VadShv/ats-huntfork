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
import { apiGet } from '../../../utils/hh/client'
import { getValidAccessToken } from '../../../utils/hh/tokens'

const paramsSchema = z.object({ id: z.string().min(1) })

interface HhResumeFull {
  id: string
  first_name?: string | null
  last_name?: string | null
  middle_name?: string | null
  title?: string | null
  can_view_full_info?: boolean
  actions?: {
    get_with_contacts?: { url?: string }
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

  const contactsUrl = resumeShort.actions?.get_with_contacts?.url
  if (!contactsUrl) {
    await db.insert(hhActionLog).values({
      organizationId: orgId,
      hhAccountId,
      performedByUserId: userId,
      actionType: 'open_contacts',
      hhResumeId: cand.hhResumeId,
      requestPayload: { candidateId: id } as Record<string, unknown>,
      error: 'no_get_with_contacts_action',
    })
    throw createError({
      statusCode: 402,
      statusMessage: 'У аккаунта hh.ru нет платного доступа к контактам (или резюме недоступно)',
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

  const isPlaceholderName = cand.firstName === 'Кандидат hh.ru'
  const isPlaceholderEmail = !!cand.email && cand.email.startsWith('hh-') && cand.email.endsWith('@noemail.local')

  const patch: Record<string, unknown> = {
    hhResumeRaw: resume as unknown as Record<string, unknown>,
    hhResumeFetchedAt: new Date(),
    updatedAt: new Date(),
  }
  if (isPlaceholderName && (firstName !== 'Кандидат hh.ru' || lastName !== cand.lastName)) {
    patch.firstName = firstName
    patch.lastName = lastName
  }
  if (email && isPlaceholderEmail) {
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
    requestPayload: { candidateId: id } as Record<string, unknown>,
    responseStatus: 200,
    responseBody: {
      ok: true,
      hasEmail: !!email,
      hasPhone: !!phone,
    } as Record<string, unknown>,
  })

  return {
    ok: true as const,
    candidateId: id,
    firstName: (patch.firstName as string | undefined) ?? cand.firstName,
    lastName: (patch.lastName as string | undefined) ?? cand.lastName,
    email: (patch.email as string | undefined) ?? cand.email,
    phone: (patch.phone as string | undefined) ?? cand.phone ?? null,
  }
})
