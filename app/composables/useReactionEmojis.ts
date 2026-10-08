/**
 * Набор реакций обсуждения — один список для панели чипов и для кнопки «добавить»
 * в действиях сообщения. Должен совпадать с allow-list сервера
 * (server/api/applications/[id]/comments/[commentId]/reactions/index.post.ts).
 */
export const REACTION_EMOJI_SET = ['👍', '❤️', '🎉', '👀', '🚀', '✅', '😄', '🤔'] as const

/** Быстрые реакции на ховере сообщения (C5) — одним кликом; остальные через палитру. */
export const QUICK_REACTION_EMOJI = ['👍', '👀', '✅', '🤔'] as const
