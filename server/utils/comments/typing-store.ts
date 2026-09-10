/**
 * In-memory typing indicator store.
 * Map<applicationId, Map<userId, { name, expiresAt }>>
 * TTL: 3 seconds. Cleanup on access.
 */

interface TypingEntry { name: string, expiresAt: number }
const store = new Map<string, Map<string, TypingEntry>>()
const TTL_MS = 3000

export function setTyping(applicationId: string, userId: string, name: string) {
  let appMap = store.get(applicationId)
  if (!appMap) {
    appMap = new Map()
    store.set(applicationId, appMap)
  }
  appMap.set(userId, { name, expiresAt: Date.now() + TTL_MS })
}

export function getTyping(applicationId: string, excludeUserId?: string): Array<{ userId: string, name: string }> {
  const appMap = store.get(applicationId)
  if (!appMap) return []
  const now = Date.now()
  const result: Array<{ userId: string, name: string }> = []
  for (const [userId, entry] of appMap) {
    if (entry.expiresAt < now) {
      appMap.delete(userId)
      continue
    }
    if (userId !== excludeUserId) {
      result.push({ userId, name: entry.name })
    }
  }
  return result
}

export function clearTyping(applicationId: string, userId: string) {
  store.get(applicationId)?.delete(userId)
}
