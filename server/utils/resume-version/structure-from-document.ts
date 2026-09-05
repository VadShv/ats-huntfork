import { and, eq } from 'drizzle-orm'
import { candidate, document } from '../../database/schema'
import { structureResumeFromText, buildHhCompatibleRaw } from '../ai/structureResume'
import { appendResumeVersionIfChanged } from './append'
import { refreshCandidateSearchTsv } from '../candidateSearchText'

export interface StructureFromDocumentResult {
  action: 'created' | 'unchanged' | 'debounced' | 'no_snapshot' | 'skipped_hh' | 'insufficient_text' | 'failed'
  versionNumber?: number
  versionId?: string
  reason?: string
}

/**
 * Структурирует загруженный документ-резюме в hh-совместимый JSON, сохраняет его
 * в candidate.hh_resume_raw и добавляет новую версию резюме (candidate_resume_version).
 *
 * Единая точка для авто-версионирования при загрузке файла (documents POST) и для
 * ручного «Структурировать». Best-effort: возвращает статус, не бросает наружу —
 * вызывающий сам решает, что делать (лог/тост).
 *
 * Правила:
 *   - настоящий hh-снепшот (hh_resume_id != null) приоритетен → 'skipped_hh';
 *   - документ должен быть типа 'resume' с достаточным текстом → иначе 'insufficient_text';
 *   - LLM-ошибки не роняют загрузку файла → 'failed'.
 */
export async function structureDocumentIntoVersion(opts: {
  orgId: string
  candidateId: string
  documentId: string
  triggeredBy: string
  /** Пропустить дебаунс версий (ручной вызов). По умолчанию true для загрузки файла. */
  bypassDebounce?: boolean
}): Promise<StructureFromDocumentResult> {
  const { orgId, candidateId, documentId, triggeredBy, bypassDebounce = true } = opts

  const cand = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, candidateId), eq(candidate.organizationId, orgId)),
    columns: { id: true, hhResumeId: true },
  })
  if (!cand) return { action: 'failed', reason: 'candidate_not_found' }

  // Настоящее hh-резюме приоритетно — не перезаписываем разбором файла.
  if (cand.hhResumeId) return { action: 'skipped_hh' }

  const doc = await db.query.document.findFirst({
    where: and(
      eq(document.id, documentId),
      eq(document.candidateId, candidateId),
      eq(document.organizationId, orgId),
    ),
    columns: { id: true, type: true, originalFilename: true, parsedContent: true },
  })
  if (!doc || doc.type !== 'resume') return { action: 'insufficient_text', reason: 'not_resume' }

  const text = (doc.parsedContent as { text?: string } | null)?.text?.trim() ?? ''
  if (text.length < 200) return { action: 'insufficient_text' }

  try {
    const { parsed, config } = await structureResumeFromText({ orgId, text })
    const raw = buildHhCompatibleRaw(parsed, {
      documentId: doc.id,
      sourceFilename: doc.originalFilename,
      provider: (config as { provider?: string }).provider ?? null,
      model: (config as { model?: string }).model ?? null,
    })

    await db.update(candidate)
      .set({ hhResumeRaw: raw, hhResumeFetchedAt: new Date() })
      .where(and(eq(candidate.id, candidateId), eq(candidate.organizationId, orgId)))

    const appended = await appendResumeVersionIfChanged({
      candidateId,
      raw,
      source: 'manual_upload',
      triggeredBy,
      bypassDebounce,
    })

    refreshCandidateSearchTsv({ orgId, candidateId }).catch(() => {})

    return {
      action: appended.action === 'no_snapshot' ? 'no_snapshot' : appended.action,
      versionNumber: appended.versionNumber,
      versionId: appended.versionId,
    }
  }
  catch (err) {
    return { action: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
}
