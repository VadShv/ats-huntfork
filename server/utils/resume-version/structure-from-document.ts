import { and, desc, eq } from 'drizzle-orm'
import { candidate, document, candidateResumeVersion } from '../../database/schema'
import { structureResumeFromText, buildHhCompatibleRaw } from '../ai/structureResume'
import { appendResumeVersionIfChanged } from './append'
import { refreshCandidateSearchTsv } from '../candidateSearchText'

export interface StructureFromDocumentResult {
  action: 'created' | 'unchanged' | 'debounced' | 'no_snapshot' | 'skipped_hh' | 'skipped_existing' | 'insufficient_text' | 'failed'
  versionNumber?: number
  versionId?: string
  /** Итоговый hh-совместимый raw (для рендера в ответе API). */
  raw?: Record<string, unknown>
  reason?: string
}

function experienceCount(raw: Record<string, unknown> | null | undefined): number {
  const exp = raw?.experience
  return Array.isArray(exp) ? exp.length : 0
}

/**
 * Структурирует загруженный документ-резюме в hh-совместимый JSON, сохраняет его
 * в candidate.hh_resume_raw и добавляет новую версию резюме (candidate_resume_version).
 *
 * Единая точка для авто-версионирования при загрузке файла (documents POST) и для
 * ручного «Структурировать». Best-effort: возвращает статус, не бросает наружу.
 *
 * Защиты:
 *   - настоящий hh-снепшот (hh_resume_id != null) приоритетен → 'skipped_hh';
 *   - документ должен быть типа 'resume' с достаточным текстом → 'insufficient_text';
 *   - НЕ структурировать повторно тот же документ без forceRestructure, если версия
 *     из него уже есть → 'skipped_existing' (устраняет дубль авто+ручное);
 *   - анти-обеднение: не перетирать версию с опытом пустым результатом LLM.
 */
export async function structureDocumentIntoVersion(opts: {
  orgId: string
  candidateId: string
  documentId: string
  triggeredBy: string
  /** Пропустить дебаунс версий. По умолчанию true. */
  bypassDebounce?: boolean
  /** Принудительно перезапустить разбор, даже если версия из документа уже есть (ручная кнопка). */
  forceRestructure?: boolean
}): Promise<StructureFromDocumentResult> {
  const { orgId, candidateId, documentId, triggeredBy, bypassDebounce = true, forceRestructure = false } = opts

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

  // Анти-дубль: если из этого документа уже есть версия и не форсим — не структурируем повторно.
  const priorVersions = await db
    .select({ snapshot: candidateResumeVersion.snapshot })
    .from(candidateResumeVersion)
    .where(eq(candidateResumeVersion.candidateId, candidateId))
    .orderBy(desc(candidateResumeVersion.versionNumber))
  const fromThisDoc = priorVersions.filter(
    v => (v.snapshot as any)?._hf?.documentId === documentId,
  )
  if (!forceRestructure && fromThisDoc.length > 0) {
    return { action: 'skipped_existing' }
  }
  // Максимум опыта среди уже имеющихся версий этого документа — для анти-обеднения.
  const priorMaxExp = Math.max(0, ...fromThisDoc.map(v => experienceCount(v.snapshot as any)))

  try {
    const { parsed, config } = await structureResumeFromText({ orgId, text })
    const raw = buildHhCompatibleRaw(parsed, {
      documentId: doc.id,
      sourceFilename: doc.originalFilename,
      provider: (config as { provider?: string }).provider ?? null,
      model: (config as { model?: string }).model ?? null,
    })

    // Анти-обеднение: если новый разбор потерял опыт, а прошлая версия документа
    // его имела — не перетираем (недетерминизм LLM не должен ухудшать данные).
    if (experienceCount(raw) === 0 && priorMaxExp > 0) {
      return { action: 'skipped_existing', reason: 'empty_experience_guard' }
    }

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
      raw,
    }
  }
  catch (err) {
    return { action: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
}
