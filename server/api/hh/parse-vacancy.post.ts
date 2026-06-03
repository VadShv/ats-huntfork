/**
 * POST /api/hh/parse-vacancy
 *
 * Принимает URL или ID вакансии hh.ru, запрашивает её через API hh.ru
 * (под токеном текущего пользователя) и возвращает данные, пригодные
 * для автозаполнения формы создания вакансии в Huntfork.
 *
 * Тело запроса: { url: string }
 * Ответ: ParsedHhVacancy
 */
import { apiGet, isHhConfigured, type HhVacancyApi } from '../../utils/hh/client'
import { getHhAccountForUser, getValidAccessToken } from '../../utils/hh/tokens'
import { extractVacancyId, toHuntforkForm } from '../../utils/hh/vacancyParser'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  if (!isHhConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Интеграция с hh.ru не настроена',
    })
  }

  const body = await readBody<{ url?: string }>(event)
  const rawUrl = (body?.url ?? '').trim()
  if (!rawUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Не указан URL или ID вакансии',
    })
  }

  const vacancyId = extractVacancyId(rawUrl)
  if (!vacancyId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Не удалось распознать ID вакансии в ссылке. Ожидаемый формат: https://hh.ru/vacancy/12345678',
    })
  }

  const acc = await getHhAccountForUser(
    session.session.activeOrganizationId,
    session.user.id,
  )
  if (!acc || !acc.isActive) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Аккаунт hh.ru не подключён. Подключите в Настройках → Интеграции.',
    })
  }

  let accessToken: string
  try {
    accessToken = await getValidAccessToken(acc.id)
  }
  catch (err) {
    throw createError({
      statusCode: 401,
      statusMessage: `Не удалось обновить токен hh.ru: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  let raw: HhVacancyApi
  try {
    raw = await apiGet<HhVacancyApi>(`/vacancies/${vacancyId}`, accessToken)
  }
  catch (err) {
    const status = (err as Error & { status?: number }).status ?? 502
    throw createError({
      statusCode: status === 404 ? 404 : 502,
      statusMessage: status === 404
        ? `Вакансия ${vacancyId} не найдена на hh.ru`
        : `Ошибка hh.ru API: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  return toHuntforkForm(raw)
})
