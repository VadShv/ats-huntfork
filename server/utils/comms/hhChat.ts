/**
 * hh.ru chat adapter — тонкая обёртка над /common/chats API.
 *
 * Транспорт и только транспорт: не пишет в БД, не решает бизнес-логику.
 * Все вызовы принимают готовый access token (см. server/utils/hh/tokens.ts).
 *
 * Справка: https://api.hh.ru/openapi/redoc#tag/Chaty
 */
import { apiGet, apiRequest } from '../hh/client'

export interface HhChatMessagePayload {
  text?: string | null
  attachments?: Array<{
    content_type?: string
    filename?: string
    size?: number
    url?: string
    preview?: { url?: string } | null
  }> | null
  moved_participant?: unknown
}

export interface HhChatMessage {
  id: string
  creation_time: string
  last_change_time?: string | null
  payload: HhChatMessagePayload
  sender_display_info?: {
    name: string
    role?: 'APPLICANT' | 'EMPLOYER' | 'BOT' | null
    is_current_participant: boolean
  }
  sender_participant_id?: string
  type?: string
  viewed_by_opponent?: boolean
}

export interface HhChatMessagesResponse {
  id: string
  type: 'NEGOTIATION' | 'SUPPORT' | 'BOT' | 'COMMON'
  unread_message_count: number
  creation_time: string
  vacancy_id?: string | null
  messages: HhChatMessage[]
  has_more: boolean
  chat_states: {
    write_message_state: { allowed: boolean, reason?: string | null }
    send_file_state: { allowed: boolean }
  }
}

/**
 * Последние сообщения чата (order=prev → от самого нового назад).
 * Возвращает также состояние чата (можно ли писать) и счётчик непрочитанных.
 */
export function hhGetChatMessages(
  accessToken: string,
  chatId: string,
  limit = 50,
): Promise<HhChatMessagesResponse> {
  return apiGet<HhChatMessagesResponse>(
    `/common/chats/${encodeURIComponent(chatId)}/messages`,
    accessToken,
    { order: 'prev', limit },
  )
}

/**
 * Отправка текстового сообщения. Возвращает id созданного сообщения.
 * idempotency_key защищает от дублей при ретраях.
 */
export async function hhSendChatMessage(
  accessToken: string,
  chatId: string,
  text: string,
): Promise<string | null> {
  const res = await apiRequest<{ id?: string }>(
    'POST',
    `/common/chats/${encodeURIComponent(chatId)}/messages`,
    accessToken,
    { body: { text, idempotency_key: crypto.randomUUID() } },
  )
  return res.body?.id ?? null
}

/** Отметить сообщение (и всё до него) прочитанным. */
export async function hhMarkMessageRead(
  accessToken: string,
  chatId: string,
  messageId: string,
): Promise<void> {
  await apiRequest(
    'PUT',
    `/common/chats/${encodeURIComponent(chatId)}/message/${encodeURIComponent(messageId)}/read`,
    accessToken,
  )
}
