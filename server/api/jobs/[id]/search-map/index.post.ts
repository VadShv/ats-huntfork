import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import {
  jobSearchMap, searchMapTemplate, searchMapTemplateSection, jobSearchMapSection,
} from '../../../../database/schema/app'

const idParamSchema = z.object({ id: z.string().min(1) })
const createMapSchema = z.object({ templateId: z.string().min(1).optional() })

/**
 * POST /api/jobs/[id]/search-map — создать карту из шаблона.
 * Право: searchMap:edit. 409 если уже есть. Копирует секции, фиксирует sourceHashes.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { searchMap: ['edit'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, createMapSchema.parse).catch(() => ({ templateId: undefined }))
  await requireJobInScope(event, jobId)

  const [existing] = await db.select({ id: jobSearchMap.id }).from(jobSearchMap)
    .where(and(eq(jobSearchMap.jobId, jobId), eq(jobSearchMap.organizationId, orgId))).limit(1)
  if (existing) throw createError({ statusCode: 409, statusMessage: 'Карта уже существует' })

  await ensureDefaultTemplate(orgId)

  let templateId = body.templateId
  if (!templateId) {
    const [defaultTpl] = await db.select({ id: searchMapTemplate.id }).from(searchMapTemplate)
      .where(and(eq(searchMapTemplate.organizationId, orgId), eq(searchMapTemplate.isDefault, true), eq(searchMapTemplate.status, 'published'))).limit(1)
    templateId = defaultTpl?.id
  }

  const sourceHashes = await computeSourceHashes(jobId, orgId)

  const [created] = await db.transaction(async (tx) => {
    const [m] = await tx.insert(jobSearchMap).values({
      organizationId: orgId,
      jobId,
      templateId: templateId ?? null,
      templateVersion: templateId ? (await tx.select({ v: searchMapTemplate.version }).from(searchMapTemplate).where(eq(searchMapTemplate.id, templateId)).limit(1))[0]?.v : null,
      status: 'draft',
      sourceHashes,
      sourceHashesAt: new Date(),
      createdById: session.user.id,
    }).returning()

    if (templateId) {
      const tplSections = await tx.select().from(searchMapTemplateSection)
        .where(eq(searchMapTemplateSection.templateId, templateId))
        .orderBy(searchMapTemplateSection.displayOrder)

      for (const s of tplSections) {
        await tx.insert(jobSearchMapSection).values({
          organizationId: orgId,
          mapId: m.id,
          sectionType: s.sectionType,
          title: s.title,
          guidance: s.guidance,
          isRequired: s.isRequired,
          displayOrder: s.displayOrder,
        })
      }
    }

    return [m]
  })

  setResponseStatus(event, 201)
  return created
})
