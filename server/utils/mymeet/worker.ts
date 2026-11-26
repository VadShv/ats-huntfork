/**
 * Фоновый импорт отчёта MyMeet (Этап 5).
 *
 * Импорт может быть долгим (отчёт готовится асинхронно на стороне MyMeet), поэтому
 * идёт через pg-boss. Worker тянет отчёт/транскрипт через фасад client.ts
 * (REST backend.mymeet.ai → запасной MCP) и заполняет meeting_report.
 *
 * Очередь: mymeet-import
 */
import { and, eq } from 'drizzle-orm'
import { meetingReport } from '../../database/schema'
import { getBoss } from '../queue/boss'
import { getMymeetApiKey } from './account'
import { fetchMeetingData, MymeetNotReadyError } from './client'

export const MYMEET_IMPORT_QUEUE = 'mymeet-import'

export interface MymeetImportPayload {
  organizationId: string
  meetingReportId: string
  externalMeetingId: string
}

export async function enqueueMymeetImport(payload: MymeetImportPayload): Promise<void> {
  try {
    const boss = await getBoss()
    await boss.send(MYMEET_IMPORT_QUEUE, payload, {
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 10 * 60,
      singletonKey: `mymeet-import:${payload.meetingReportId}`,
      singletonHours: 1,
    })
  }
  catch (err) {
    logError('mymeet.enqueue_failed', {
      meeting_report_id: payload.meetingReportId,
      error_message: err instanceof Error ? err.message : String(err),
      module: 'mymeet',
    })
  }
}

/** pg-boss 10 передаёт МАССИВ джобов (batch) — обрабатываем каждый. */
export async function processMymeetImportJob(
  jobs: { data: MymeetImportPayload } | { data: MymeetImportPayload }[],
): Promise<void> {
  const list = Array.isArray(jobs) ? jobs : [jobs]
  for (const job of list) {
    await runMymeetImportJob(job.data)
  }
}

async function runMymeetImportJob(payload: MymeetImportPayload): Promise<void> {
  const { organizationId, meetingReportId, externalMeetingId } = payload

  const apiKey = await getMymeetApiKey(organizationId)
  if (!apiKey) {
    await fail(organizationId, meetingReportId, 'MyMeet не подключён')
    return
  }

  try {
    const data = await fetchMeetingData(apiKey, externalMeetingId)

    await db.update(meetingReport)
      .set({
        status: 'completed',
        title: data.title,
        durationSec: data.durationSec,
        summary: data.summary,
        reportJson: data.json,
        participantsJson: data.participants,
        transcriptText: data.transcriptText,
        errorMessage: null,
        importedAt: new Date(),
      })
      .where(and(eq(meetingReport.id, meetingReportId), eq(meetingReport.organizationId, organizationId)))

    logInfo('mymeet.import_completed', {
      meeting_report_id: meetingReportId,
      external_meeting_id: externalMeetingId,
      via: data.via,
      has_transcript: Boolean(data.transcriptText),
      module: 'mymeet',
    })
  }
  catch (err) {
    if (err instanceof MymeetNotReadyError) {
      // Запись ещё обрабатывается на стороне MyMeet — оставляем importing, pg-boss повторит.
      await db.update(meetingReport)
        .set({ errorMessage: `${err.message}. Повторим автоматически.` })
        .where(and(eq(meetingReport.id, meetingReportId), eq(meetingReport.organizationId, organizationId)))
      throw err
    }
    await fail(organizationId, meetingReportId, err instanceof Error ? err.message : String(err))
    throw err
  }
}

async function fail(orgId: string, id: string, message: string): Promise<void> {
  await db.update(meetingReport)
    .set({ status: 'failed', errorMessage: message.slice(0, 500) })
    .where(and(eq(meetingReport.id, id), eq(meetingReport.organizationId, orgId)))
  logError('mymeet.import_failed', { meeting_report_id: id, error_message: message, module: 'mymeet' })
}
