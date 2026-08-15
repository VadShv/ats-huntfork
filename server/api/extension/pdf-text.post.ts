/**
 * POST /api/extension/pdf-text
 *
 * S7 Sidekick: извлечение текста из PDF (резюме, портфолио), открытого
 * во вкладке браузера. Расширение скачивает файл, шлёт base64 сюда,
 * получает текст и дальше использует ОБЫЧНЫЙ флоу: /capture (черновик →
 * подтверждение) или /summarize — без дублирования конвейеров.
 *
 * Используется тот же parseDocument (pdf-parse), что и при загрузке
 * файлов резюме в ATS.
 *
 * Body: { sourceUrl: string, dataBase64: string, filename?: string }
 * Ответ: { ok, text, meta: { pageCount, chars, filename } }
 */
import { z } from 'zod'
import { parseDocument } from '../../utils/resume-parser'
import { createRateLimiter } from '../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  message: 'Слишком много PDF-запросов. Подождите немного',
})

// ~6 МБ бинарных данных в base64 (8M символов)
const bodySchema = z.object({
  sourceUrl: z.string().url().max(2000),
  dataBase64: z.string().min(100).max(8_000_000),
  filename: z.string().max(300).optional(),
})

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { candidate: ['create'] })
  const body = await readValidatedBody(event, bodySchema.parse)

  let buffer: Buffer
  try {
    buffer = Buffer.from(body.dataBase64, 'base64')
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Некорректный base64' })
  }

  // Сигнатура PDF: %PDF
  if (buffer.length < 5 || buffer.subarray(0, 4).toString('latin1') !== '%PDF') {
    throw createError({ statusCode: 400, statusMessage: 'Файл не является PDF' })
  }

  const parsed = await parseDocument(buffer, 'application/pdf')
  if (!parsed || !parsed.text || parsed.text.trim().length < 80) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Не удалось извлечь текст из PDF (возможно, это скан без текстового слоя)',
    })
  }

  const text = parsed.text.replace(/\n{3,}/g, '\n\n').trim().slice(0, 80_000)

  logApiRequest(event, session, 'extension.pdf_text', {
    bytes: buffer.length,
    pages: parsed.metadata.pageCount,
    chars: text.length,
  })

  return {
    ok: true,
    text,
    meta: {
      pageCount: parsed.metadata.pageCount,
      chars: text.length,
      filename: body.filename ?? null,
    },
  }
})
