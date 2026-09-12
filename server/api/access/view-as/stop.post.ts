/**
 * POST /api/access/view-as/stop
 * Exit "View as" mode by clearing the cookie. Any authenticated user may clear
 * their own view-as state (fail-safe exit).
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  deleteCookie(event, 'access_view_as', { path: '/' })
  return { ok: true }
})
