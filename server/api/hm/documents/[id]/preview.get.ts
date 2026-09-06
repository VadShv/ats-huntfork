import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { application, document } from '../../../../database/schema/app'
import { requireHm } from '../../../../utils/requireHm'
import { isHiringManagerOnJob } from '../../../../utils/hiringManager'

/**
 * GET /api/hm/documents/:id/preview
 *
 * HM-специфичный стриминг PDF-резюме для inline-превью на портале нанимающего
 * менеджера. По продуктовому решению НМ видит файл резюме как есть (включая PII в
 * файле) — но ТОЛЬКО по кандидатам, чьи отклики привязаны к вакансиям, на которые
 * этот НМ назначен.
 *
 * Безопасность:
 *   - requireHm: роль hiring_manager, active, в текущей org.
 *   - Документ должен принадлежать той же org (защита от IDOR).
 *   - Доступ выдаётся, только если кандидат-владелец документа откликнулся хотя бы
 *     на одну вакансию, где текущий пользователь — HM (isHiringManagerOnJob).
 *   - 404 (а не 403) для чужих/несуществующих — не раскрываем существование.
 *   - Только PDF (DOC/DOCX → 415; превью для них появится после DOCX→PDF конвертации).
 *   - Жёсткий CSP + X-Frame-Options SAMEORIGIN только для этого маршрута.
 */
export default defineEventHandler(async (event) => {
  const session = await requireHm(event)
  const orgId = session.session.activeOrganizationId

  const { id: documentId } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse)

  // 1. Документ в этой org (иначе 404 — без утечки существования)
  const doc = await db.query.document.findFirst({
    where: and(
      eq(document.id, documentId),
      eq(document.organizationId, orgId),
    ),
    columns: {
      candidateId: true,
      storageKey: true,
      previewStorageKey: true,
      originalFilename: true,
      mimeType: true,
    },
  })

  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Документ не найден' })
  }

  // 2. Кандидат должен иметь отклик на вакансию, где этот пользователь — HM.
  const apps = await db
    .select({ jobId: application.jobId })
    .from(application)
    .where(and(
      eq(application.organizationId, orgId),
      eq(application.candidateId, doc.candidateId),
    ))

  const jobIds = [...new Set(apps.map(a => a.jobId))]
  let allowed = false
  for (const jobId of jobIds) {
    if (await isHiringManagerOnJob(orgId, session.user.id, jobId)) {
      allowed = true
      break
    }
  }

  if (!allowed) {
    // 404 вместо 403 — не раскрываем, что документ существует
    throw createError({ statusCode: 404, statusMessage: 'Документ не найден' })
  }

  // 3. Стримим PDF: оригинал (если PDF) либо производный preview-PDF (DOC/DOCX).
  const previewKey = doc.mimeType === 'application/pdf'
    ? doc.storageKey
    : doc.previewStorageKey
  if (!previewKey) {
    throw createError({
      statusCode: 415,
      statusMessage: 'Предпросмотр доступен только для PDF-файлов',
    })
  }

  const s3Response = await s3Client.send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: previewKey,
    }),
  )

  if (!s3Response.Body) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось получить документ' })
  }

  const encodedFilename = encodeURIComponent(doc.originalFilename)

  const headers: Record<string, string> = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
    'Cache-Control': 'private, no-store',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  }

  if (s3Response.ContentLength) {
    headers['Content-Length'] = String(s3Response.ContentLength)
  }

  setResponseHeaders(event, headers)

  return s3Response.Body.transformToWebStream()
})
