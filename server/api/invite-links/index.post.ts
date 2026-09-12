import { randomBytes } from 'node:crypto'
import { inviteLink } from '../../database/schema'
import { createInviteLinkSchema } from '../../utils/schemas/inviteLink'
import { getActorContext } from '../../utils/access/actorContext'
import { canBool } from '../../utils/access/can'

/**
 * POST /api/invite-links
 * Create a shareable invite link for the current organization.
 *
 * §7 authorization:
 *  - `invitation:create` (owner/admin) → any role (member/admin/hiring_manager).
 *  - `hiringManager:create` (recruiter/lead) → ONLY role='hiring_manager'.
 *    Lets recruiters add hiring managers without the power to invite
 *    recruiters/admins.
 */
export default defineEventHandler(async (event) => {
  // Base auth + active org (permission is enforced explicitly below).
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, createInviteLinkSchema.parse)

  const actor = await getActorContext(event)
  const canInviteAny = canBool(actor, 'invitation:create')
  const canInviteHm = canBool(actor, 'hiringManager:create')

  if (!canInviteAny && !canInviteHm) {
    throw createError({ statusCode: 403, statusMessage: 'Нет доступа: недостаточно прав' })
  }
  // Recruiter (HM-only) path: restrict to hiring_manager invites.
  if (!canInviteAny && body.role !== 'hiring_manager') {
    throw createError({ statusCode: 403, statusMessage: 'Можно приглашать только нанимающих менеджеров' })
  }

  // Generate a cryptographically secure token (32 bytes = 64 hex chars)
  const token = randomBytes(32).toString('hex')

  const expiresAt = new Date(Date.now() + body.expiresInHours * 60 * 60 * 1000)

  const [created] = await db.insert(inviteLink).values({
    organizationId: orgId,
    createdById: session.user.id,
    token,
    role: body.role,
    maxUses: body.maxUses ?? null,
    useCount: 0,
    expiresAt,
  }).returning({
    id: inviteLink.id,
    token: inviteLink.token,
    role: inviteLink.role,
    maxUses: inviteLink.maxUses,
    useCount: inviteLink.useCount,
    expiresAt: inviteLink.expiresAt,
    createdAt: inviteLink.createdAt,
  })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Не удалось создать ссылку-приглашение' })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'invite_link',
    resourceId: created.id,
    metadata: { role: created.role, maxUses: created.maxUses },
  })

  setResponseStatus(event, 201)
  return created
})
