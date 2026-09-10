/**
 * Grouping util для единой ленты обсуждения (Telegram-style).
 *
 * Подряд идущие текстовые комментарии одного автора в пределах gapMs
 * группируются — аватар/имя/время показываются только на первом в группе.
 *
 * Разрывают группу (рендерятся standalone):
 *   - stage_event (событие воронки)
 *   - comments с kind: ai_screening_snapshot | risk_snapshot | ai_response | ai_summary
 */
import type {
  CommentAuthor,
  ThreadComment,
  TimelineItem,
} from './useApplicationComments'

const STANDALONE_KINDS = new Set([
  'ai_screening_snapshot',
  'risk_snapshot',
  'ai_response',
  'ai_summary',
])

export interface CommentGroupUnit {
  type: 'group'
  author: CommentAuthor
  isSelf: boolean
  comments: ThreadComment[]
}

export interface StandaloneUnit {
  type: 'standalone'
  item: TimelineItem
}

export type RenderUnit = CommentGroupUnit | StandaloneUnit

/**
 * Разбить таймлайн на render-единицы: группы комментариев и standalone-элементы.
 * `items` должны быть отсортированы по возрастанию времени (как в composable `timeline`).
 */
export function groupTimeline(
  items: TimelineItem[],
  currentUserId: string,
  gapMs = 5 * 60 * 1000,
): RenderUnit[] {
  const units: RenderUnit[] = []
  let currentGroup: ThreadComment[] = []

  function flushGroup() {
    if (currentGroup.length === 0) return
    const author = currentGroup[0]!.author
    units.push({
      type: 'group',
      author,
      isSelf: author.id === currentUserId,
      comments: currentGroup,
    })
    currentGroup = []
  }

  for (const item of items) {
    if (item.type === 'stage_event') {
      flushGroup()
      units.push({ type: 'standalone', item })
      continue
    }

    const comment = item.comment

    // Snapshots / AI-ответы / AI-резюме / replies — всегда standalone
    if ((comment.kind && STANDALONE_KINDS.has(comment.kind)) || comment.parentCommentId) {
      flushGroup()
      units.push({ type: 'standalone', item })
      continue
    }

    // Группируемый текстовый комментарий
    if (currentGroup.length === 0) {
      currentGroup = [comment]
      continue
    }

    const last = currentGroup[currentGroup.length - 1]!
    const sameAuthor = last.author.id === comment.author.id
    const withinGap = new Date(comment.createdAt).getTime() - new Date(last.createdAt).getTime() <= gapMs

    if (sameAuthor && withinGap) {
      currentGroup.push(comment)
    } else {
      flushGroup()
      currentGroup = [comment]
    }
  }

  flushGroup()
  return units
}
