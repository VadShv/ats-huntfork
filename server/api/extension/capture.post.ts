/**
 * POST /api/extension/capture
 *
 * S1 Universal Capture: принимает сырой текст страницы (LinkedIn, Habr Career,
 * GitHub, HUNT, Podbor.io или любой сайт), прогоняет через LLM-структуризацию
 * (тот же конвейер, что разбор файлов резюме — 'analysis'-провайдер организации,
 * скрининговый контур не затрагивается) и возвращает ЧЕРНОВИК кандидата
 * с результатами проверки на дубликаты. НИЧЕГО не сохраняет в БД —
 * сохранение только через /api/extension/capture-confirm после превью.
 *
 * Body:
 *   {
 *     sourceUrl: string,          // URL страницы-источника
 *     site?: string,              // linkedin | habr | github | hunt | podbor | generic
 *     title?: string,             // document.title
 *     text: string,               // извлечённый текст (80..80000 символов)
 *     selection?: boolean,        // true, если текст — выделение пользователя
 *     contacts?: {                // контакты, найденные расширением на странице
 *       emails?: string[], phones?: string[], telegrams?: string[], links?: string[]
 *     }
 *   }
 *
 * Ответ: { ok, parsed: StructuredResume, contacts: {email,phone,telegram,linkedin,github},
 *          duplicates: {exact[], fuzzy[], social[]}, meta: {provider, model} }
 */
import { and, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { candidate, candidateIdentity } from '../../database/schema'
import { structureResumeFromText } from '../../utils/ai/structureResume'
import { findDuplicatesForDraft } from '../../utils/dedup/check'
import {
  normalizeEmail, normalizeGithub, normalizeLinkedinUrl,
  normalizePhone, normalizeTelegram,
} from '../../utils/dedup/normalize'
import { getOrgGroupId } from '../../utils/dedup/resolve'
import { createRateLimiter } from '../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  message: 'Слишком много запросов на разбор страниц. Подождите немного',
})

const bodySchema = z.object({
  sourceUrl: z.string().url().max(2000),
  site: z.string().max(40).optional(),
  title: z.string().max(300).optional(),
  text: z.string().min(80, 'Слишком мало текста для разбора').max(80_000),
  selection: z.boolean().optional(),
  contacts: z.object({
    emails: z.array(z.string().max(200)).max(10).optional(),
    phones: z.array(z.string().max(50)).max(10).optional(),
    telegrams: z.array(z.string().max(100)).max(10).optional(),
    links: z.array(z.string().max(500)).max(30).optional(),
  }).optional(),
})

/** Первое непустое значение. */
function first(...vals: Array<string | null | undefined>): string | null {
  for (const v of vals) {
    const t = v?.trim()
    if (t) return t
  }
  return null
}

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, bodySchema.parse)

  // ─── 1. Собираем текст для LLM: заголовок + контакты со страницы + контент.
  // Контакты-«подсказки» помогают модели не потерять email/телефон,
  // которые на странице могут лежать вне основного блока.
  const hintLines: string[] = []
  if (body.title) hintLines.push(`Заголовок страницы: ${body.title}`)
  hintLines.push(`URL страницы: ${body.sourceUrl}`)
  const c = body.contacts
  if (c?.emails?.length) hintLines.push(`Email со страницы: ${c.emails.join(', ')}`)
  if (c?.phones?.length) hintLines.push(`Телефоны со страницы: ${c.phones.join(', ')}`)
  if (c?.telegrams?.length) hintLines.push(`Telegram со страницы: ${c.telegrams.join(', ')}`)
  if (c?.links?.length) hintLines.push(`Ссылки профилей со страницы: ${c.links.slice(0, 10).join(', ')}`)
  const llmText = `${hintLines.join('\n')}\n\n${body.text}`

  // ─── 2. LLM-структуризация (тот же конвейер, что разбор файла резюме).
  let parsed, config
  try {
    const res = await structureResumeFromText({ orgId, text: llmText })
    parsed = res.parsed
    config = res.config
  }
  catch (err) {
    console.error('[ext:capture] structure failed', { url: body.sourceUrl, err: (err as Error).message })
    throw createError({
      statusCode: 502,
      statusMessage: 'Не удалось разобрать страницу через ИИ. Проверьте настройки ИИ-провайдера организации',
      data: { code: 'AI_FAILED' },
    })
  }

  // ─── 3. Сводим контакты: приоритет — то, что нашла LLM, затем контакты со страницы.
  const parsedByType = (t: string) => parsed.contacts.find(pc => pc.type === t)?.value ?? null
  const links = c?.links ?? []
  const linkOf = (re: RegExp) => links.find(l => re.test(l)) ?? null

  const email = first(parsedByType('email'), ...(c?.emails ?? []))
  const phone = first(parsedByType('phone'), ...(c?.phones ?? []))
  const telegram = first(parsedByType('telegram'), ...(c?.telegrams ?? []))
  const linkedin = first(
    parsedByType('linkedin'),
    linkOf(/linkedin\.com\/in\//i),
    body.site === 'linkedin' ? body.sourceUrl : null,
  )
  const github = first(
    parsedByType('github'),
    linkOf(/github\.com\/[^/]+\/?$/i),
    body.site === 'github' ? body.sourceUrl : null,
  )

  // ─── 4. Дедуп: точные совпадения по email/телефону + fuzzy по ФИО/городу.
  const duplicates = await findDuplicatesForDraft(orgId, {
    firstName: parsed.firstName ?? '',
    lastName: parsed.lastName ?? '',
    email,
    phone,
    city: parsed.area || null,
  })

  // ─── 5. Дополнительно: точные совпадения по соцсетям (linkedin/telegram/github)
  // через candidate_identity — сильный сигнал «этот профиль уже захватывали».
  const socialConds = [
    { kind: 'linkedin', v: normalizeLinkedinUrl(linkedin) },
    { kind: 'telegram', v: normalizeTelegram(telegram) },
    { kind: 'github', v: normalizeGithub(github) },
  ].filter((x): x is { kind: string, v: string } => !!x.v)

  const social: Array<{ kind: string, candidateId: string, candidateName: string | null, crossOrg: boolean }> = []
  if (socialConds.length > 0) {
    const groupId = await getOrgGroupId(orgId)
    const scope = groupId
      ? eq(candidateIdentity.groupId, groupId)
      : eq(candidateIdentity.organizationId, orgId)
    const rows = await db
      .select({
        kind: candidateIdentity.kind,
        candidateId: candidateIdentity.candidateId,
        identityOrgId: candidateIdentity.organizationId,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
      })
      .from(candidateIdentity)
      .leftJoin(candidate, eq(candidate.id, candidateIdentity.candidateId))
      .where(and(
        scope,
        or(...socialConds.map(sc => and(
          eq(candidateIdentity.kind, sc.kind),
          eq(candidateIdentity.valueNormalized, sc.v),
        ))),
      ))
      .limit(10)
    const seen = new Set<string>()
    for (const r of rows) {
      const key = `${r.kind}:${r.candidateId}`
      if (seen.has(key)) continue
      seen.add(key)
      social.push({
        kind: r.kind,
        candidateId: r.candidateId,
        candidateName: [r.firstName, r.lastName].filter(Boolean).join(' ') || null,
        crossOrg: r.identityOrgId !== orgId,
      })
    }
  }

  logApiRequest(event, session, 'extension.capture', {
    site: body.site ?? 'generic',
    text_length: body.text.length,
    selection: !!body.selection,
    exact_dupes: duplicates.exact.length,
    fuzzy_dupes: duplicates.fuzzy.length,
    social_dupes: social.length,
  })

  return {
    ok: true as const,
    parsed,
    contacts: { email, phone, telegram, linkedin, github },
    duplicates: { exact: duplicates.exact, fuzzy: duplicates.fuzzy, social },
    meta: {
      provider: (config as { provider?: string }).provider ?? null,
      model: (config as { model?: string }).model ?? null,
    },
  }
})
