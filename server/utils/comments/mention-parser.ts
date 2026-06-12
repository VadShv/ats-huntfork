/**
 * @mention parser for collaboration thread comments.
 *
 * Supports two patterns:
 *   1. @"Имя Фамилия"   — quoted full name (allows spaces, кириллицу)
 *   2. @username         — bare token (latin/digits/dot/dash/underscore)
 *
 * The parser returns *tokens* — raw strings that need to be resolved to user
 * IDs via {@link resolveMentions} against the current organization's members.
 */

import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { user } from '../../database/schema/auth'
import { member } from '../../database/schema/auth'

// Quoted name pattern: @"Иван Иванов"
const QUOTED_RE = /@"([^"]+)"/g
// Bare username: @ivan.ivanov  /  @ivan_v  /  @ivan-v  /  @ivan123
// Unicode letters allowed so что @Иван тоже распознаётся как одно слово.
const BARE_RE = /@([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu

export function parseMentionTokens(body: string): string[] {
  if (!body) return []
  const tokens = new Set<string>()

  // First extract quoted mentions and strip them from body, чтобы
  // bare-pattern не дробил «Иван Иванов» на @Иван + Иванов.
  let stripped = body
  let m: RegExpExecArray | null
  QUOTED_RE.lastIndex = 0
  while ((m = QUOTED_RE.exec(body)) !== null) {
    const token = m[1]?.trim()
    if (token) tokens.add(token)
  }
  stripped = body.replace(QUOTED_RE, ' ')

  BARE_RE.lastIndex = 0
  while ((m = BARE_RE.exec(stripped)) !== null) {
    const token = m[1]?.trim()
    if (token) tokens.add(token)
  }

  return [...tokens]
}

/**
 * Resolve raw mention tokens to user IDs within an organization.
 *
 * Matching strategy (case-insensitive):
 *   - user.name == token (full name)
 *   - lower(user.email) startsWith `${token.toLowerCase()}@` (username before @)
 *
 * Returns deduplicated array of matched user IDs.
 */
export async function resolveMentions(
  database: typeof db,
  organizationId: string,
  tokens: string[],
): Promise<string[]> {
  if (tokens.length === 0) return []

  // Build lowercased forms once
  const lowered = tokens.map(t => t.toLowerCase())
  const namesEq = tokens // exact-name match preserves casing
  const emailPrefixes = lowered.map(t => `${t}@%`)

  const members = await database
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.status, 'active'),
        or(
          inArray(user.name, namesEq),
          // lowered name
          inArray(sql`lower(${user.name})`, lowered),
          // username portion of the email
          ...emailPrefixes.map(p => sql`lower(${user.email}) like ${p}`),
        ),
      ),
    )

  return [...new Set(members.map(m => m.id))]
}
