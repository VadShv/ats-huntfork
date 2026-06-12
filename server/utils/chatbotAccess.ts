/**
 * Server-side gate for the chatbot feature.
 *
 * Chatbot is now generally available — no feature flag needed.
 * This helper still exists so we can later swap in role-based gating without
 * touching every endpoint.
 */
import type { H3Event } from 'h3'

export async function requireChatbotAccess(event: H3Event) {
  // Minimal permission set — chatbot reads jobs/candidates/applications/docs.
  return requirePermission(event, {
    job: ['read'],
    candidate: ['read'],
    application: ['read'],
    document: ['read'],
  })
}
