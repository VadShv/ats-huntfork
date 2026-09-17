/**
 * hh.ru applicant_comments API — внутренние комментарии к соискателю.
 * Не видны кандидату. Paid employer method.
 *
 * Endpoints:
 *   GET    /applicant_comments/{applicant_id}                  — list
 *   POST   /applicant_comments/{applicant_id}                  — create
 *   PUT    /applicant_comments/{applicant_id}/{comment_id}     — update
 *   DELETE /applicant_comments/{applicant_id}/{comment_id}     — delete
 */
import { apiGet, apiRequest, type HhQueryParams } from './client'
import type { HhConfig } from './config'

function normalizeApplicantId(raw: unknown): string {
  let v = String(raw ?? '').trim()
  v = decodeURIComponent(v).replace(/^["'\s]+|["'\s]+$/g, '')
  if (!/^\d+$/.test(v)) {
    throw new Error(`Invalid hh applicant_id: ${JSON.stringify(raw)}`)
  }
  return v
}

export interface HhApplicantComment {
  id: string
  text: string
  created_at: string
  updated_at?: string
  is_mine?: boolean
  author?: { full_name?: string, id?: string }
  access_type?: { id?: string, name?: string }
  applicant?: { id?: string }
}

export interface HhApplicantCommentsResponse {
  items: HhApplicantComment[]
  found: number
  pages: number
  per_page: number
  page: number
}

const MAX_TEXT_LENGTH = 10_000

function validateText(text: string): void {
  if (!text || !text.trim()) {
    throw new Error('Текст комментария не может быть пустым')
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Текст комментария превышает лимит hh.ru (${MAX_TEXT_LENGTH} символов)`)
  }
}

export async function listApplicantComments(
  applicantId: string,
  accessToken: string,
  config?: HhConfig | null,
  page = 0,
): Promise<HhApplicantCommentsResponse> {
  const id = normalizeApplicantId(applicantId)
  const query: HhQueryParams = { per_page: 50, page }
  return apiGet<HhApplicantCommentsResponse>(
    `/applicant_comments/${id}`,
    accessToken,
    query,
    config,
  )
}

export async function createApplicantComment(
  applicantId: string,
  text: string,
  accessToken: string,
  config?: HhConfig | null,
): Promise<HhApplicantComment> {
  const id = normalizeApplicantId(applicantId)
  validateText(text)
  const { body } = await apiRequest<HhApplicantComment>(
    'POST',
    `/applicant_comments/${id}`,
    accessToken,
    {
      body: {
        text,
        access_type: { id: 'coworkers' },
      },
    },
    config,
  )
  if (!body) {
    throw new Error('hh.ru вернул пустой ответ при создании комментария')
  }
  return body
}

export async function updateApplicantComment(
  applicantId: string,
  commentId: string,
  text: string,
  accessToken: string,
  config?: HhConfig | null,
): Promise<HhApplicantComment> {
  const id = normalizeApplicantId(applicantId)
  validateText(text)
  const { body } = await apiRequest<HhApplicantComment>(
    'PUT',
    `/applicant_comments/${id}/${commentId}`,
    accessToken,
    { body: { text } },
    config,
  )
  if (!body) {
    throw new Error('hh.ru вернул пустой ответ при обновлении комментария')
  }
  return body
}

export async function deleteApplicantComment(
  applicantId: string,
  commentId: string,
  accessToken: string,
  config?: HhConfig | null,
): Promise<void> {
  const id = normalizeApplicantId(applicantId)
  await apiRequest(
    'DELETE',
    `/applicant_comments/${id}/${commentId}`,
    accessToken,
    undefined,
    config,
  )
}

/**
 * Extract applicant_id from a stored hh.ru resume raw JSON.
 * Returns null if the owner.id field is absent.
 */
export function extractApplicantId(resumeRaw: Record<string, unknown> | null | undefined): string | null {
  if (!resumeRaw) return null
  const owner = resumeRaw.owner as Record<string, unknown> | undefined
  if (!owner || owner.id == null) return null
  const raw = String(owner.id).trim().replace(/^["'\s]+|["'\s]+$/g, '')
  return /^\d+$/.test(raw) ? raw : null
}
