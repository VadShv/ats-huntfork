/**
 * POST /api/extension/import
 *
 * Импортирует резюме с hh.ru в Huntfork. Триггерится из Chrome-расширения
 * при клике рекрутёра на кнопку «Добавить в Huntfork».
 *
 * Алгоритм:
 *   1. Получаем resumeId (из тела или из URL)
 *   2. Через `importResumeFromHh` тянем JSON с hh API org-токеном,
 *      сохраняем candidate + hh_resume_raw + document + (опц.) application.
 *      Полная семантика идентична импорту через отклик в sync.ts.
 *
 * Body:
 *   { resumeId?: string, url?: string, jobId?: string }
 *
 * Ответ: { candidateId, applicationId?, candidateCreated, applicationCreated?,
 *          candidate: {...}, hhResumeId }
 */
import { z } from 'zod'
import { ImportResumeError, importResumeFromHh } from '../../utils/hh/importResume'

const bodySchema = z.object({
  resumeId: z.string().min(8).max(128).optional(),
  url: z.string().url().optional(),
  jobId: z.string().min(1).optional(),
}).refine(v => v.resumeId || v.url, { message: 'Нужен resumeId или url' })

function extractResumeId(input: { resumeId?: string, url?: string }): string | null {
  if (input.resumeId) return input.resumeId
  if (input.url) {
    const m = input.url.match(/\/resume\/([a-f0-9]+)/i)
    return m?.[1] ?? null
  }
  return null
}

export default defineEventHandler(async (event) => {
  // candidate:create — то же право, что и для обычного создания кандидата
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const body = await readValidatedBody(event, bodySchema.parse)

  const resumeId = extractResumeId(body)
  if (!resumeId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Не удалось извлечь resumeId из URL',
    })
  }

  try {
    const result = await importResumeFromHh({
      organizationId: orgId,
      resumeId,
      jobId: body.jobId,
      source: 'hh-extension',
      triggeredByUserId: userId,
    })
    return { ok: true as const, ...result }
  }
  catch (err) {
    if (err instanceof ImportResumeError) {
      const statusCode = err.code === 'NO_HH_ACCOUNT' ? 412 // Precondition Failed
        : err.code === 'HH_API_FAILED' ? 502 // Bad Gateway
        : err.code === 'JOB_NOT_FOUND' ? 404
        : 500
      throw createError({
        statusCode,
        statusMessage: err.message,
        data: { code: err.code },
      })
    }
    console.error('[ext:import] failed', { resumeId, err: (err as Error).message })
    throw createError({ statusCode: 500, statusMessage: 'Ошибка импорта' })
  }
})
