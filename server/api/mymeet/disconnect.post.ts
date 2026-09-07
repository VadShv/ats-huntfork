import { disconnectMymeet } from '../../utils/mymeet/account'

/** POST /api/mymeet/disconnect — remove the org's MyMeet connection. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { organization: ['update'] })
  await disconnectMymeet(session.session.activeOrganizationId)
  return { connected: false }
})
