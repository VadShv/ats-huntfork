import { and, asc, eq, or } from 'drizzle-orm'
import { promptSandbox } from '../../../database/schema'
import { requirePermission } from '../../../utils/requirePermission'

/**
 * GET /api/prompts/sandbox
 *
 * List the current user's sandbox prompts + shared prompts in the org.
 * Query: ?category=, ?search=, ?shared=true
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { scoring: ['read'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const query = getQuery(event)
  const category = query.category as string | undefined
  const search = query.search as string | undefined
  const sharedOnly = query.shared === 'true'

  const conditions = [
    eq(promptSandbox.organizationId, orgId),
    sharedOnly
      ? eq(promptSandbox.isShared, true)
      : or(
          eq(promptSandbox.userId, userId),
          eq(promptSandbox.isShared, true),
        )!,
  ]

  if (category && category !== 'all') {
    conditions.push(eq(promptSandbox.category, category))
  }

  let q = db.query.promptSandbox.findMany({
    where: and(...conditions),
    orderBy: [asc(promptSandbox.createdAt)],
  })

  let rows = await q

  if (search) {
    const lower = search.toLowerCase()
    rows = rows.filter(r =>
      r.name.toLowerCase().includes(lower)
      || (r.description?.toLowerCase().includes(lower) ?? false),
    )
  }

  return {
    prompts: rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      systemPrompt: r.systemPrompt,
      userPromptTemplate: r.userPromptTemplate,
      variables: r.variables,
      aiConfigId: r.aiConfigId,
      temperature: r.temperature ? Number(r.temperature) : null,
      modelOverride: r.modelOverride,
      isShared: r.isShared,
      tags: r.tags,
      isOwner: r.userId === userId,
      lastTestedAt: r.lastTestedAt?.getTime() ?? null,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
    })),
    total: rows.length,
  }
})
