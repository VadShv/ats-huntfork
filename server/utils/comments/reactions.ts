import { eq } from 'drizzle-orm'
import { commentReaction } from '../../database/schema/app'

export interface ReactionGroup {
  emoji: string
  count: number
  userIds: string[]
  reactedByMe: boolean
}

/** Реакции допустимого набора — единый allow-list для POST и клиента (useReactionEmojis). */
export const ALLOWED_REACTION_EMOJI = ['👍', '❤️', '🎉', '👀', '🚀', '✅', '😄', '🤔'] as const

/**
 * Сгруппированные реакции одного комментария — в том же виде, что отдаёт GET /comments.
 * POST/DELETE реакции возвращают этот список, чтобы клиент показывал серверную правду
 * сразу, не дожидаясь SSE-рефетча.
 */
export async function getCommentReactions(database: typeof db, commentId: string, viewerUserId: string): Promise<ReactionGroup[]> {
  const rows = await database
    .select({ userId: commentReaction.userId, emoji: commentReaction.emoji })
    .from(commentReaction)
    .where(eq(commentReaction.commentId, commentId))
  const byEmoji = new Map<string, ReactionGroup>()
  for (const r of rows) {
    let g = byEmoji.get(r.emoji)
    if (!g) {
      g = { emoji: r.emoji, count: 0, userIds: [], reactedByMe: false }
      byEmoji.set(r.emoji, g)
    }
    g.count += 1
    g.userIds.push(r.userId)
    if (r.userId === viewerUserId) g.reactedByMe = true
  }
  return Array.from(byEmoji.values())
}

/**
 * Эмодзи из сегмента URL. Параметры маршрута приходят percent-encoded
 * (`%E2%9D%A4%EF%B8%8F`), поэтому без decodeURIComponent DELETE не находил строку
 * и реакция «не снималась». Декодируем безопасно и нормализуем к NFC.
 */
export function decodeReactionEmoji(raw: string): string {
  let value = raw
  try {
    value = decodeURIComponent(raw)
  } catch {
    // уже декодировано или битая строка — используем как есть
  }
  return value.normalize('NFC')
}
