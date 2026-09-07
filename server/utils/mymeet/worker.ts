/**
 * Фоновый импорт отчёта MyMeet (Этап 5).
 *
 * Импорт может быть долгим (отчёт готовится асинхронно на стороне MyMeet), поэтому
 * идёт через pg-boss. Worker тянет отчёт/транскрипт через MCP-клиент и заполняет
 * meeting_report. Реальные имена tools резолвятся из discovery (resolveToolName).
 *
 * Очередь: mymeet-import
 */
import { and, eq } from 'drizzle-orm'
import { meetingReport, mymeetAccount } from '../../database/schema'
import { getBoss } from '../queue/boss'
import { getMymeetApiKey } from './account'
import {
  listMymeetTools, callMymeetTool, resolveToolName, extractToolContent, TOOL_CANDIDATES, type McpTool,
} from './mcp'

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

function pickString(obj: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}
function pickNumber(obj: any, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

export async function processMymeetImportJob(job: { data: MymeetImportPayload }): Promise<void> {
  const { organizationId, meetingReportId, externalMeetingId } = job.data

  const apiKey = await getMymeetApiKey(organizationId)
  if (!apiKey) {
    await fail(organizationId, meetingReportId, 'MyMeet не подключён')
    return
  }

  try {
    const tools: McpTool[] = await listMymeetTools(apiKey)
    // Кэшируем discovery.
    await db.update(mymeetAccount)
      .set({ lastToolsJson: { tools } as unknown as Record<string, unknown>, lastCheckedAt: new Date() })
      .where(eq(mymeetAccount.organizationId, organizationId))

    const reportTool = resolveToolName(tools, [...TOOL_CANDIDATES.getReport])
    const transcriptTool = resolveToolName(tools, [...TOOL_CANDIDATES.getTranscript])

    if (!reportTool && !transcriptTool) {
      await fail(organizationId, meetingReportId, 'Не найден MCP-tool для отчёта/транскрипта (проверьте discovery в настройках)')
      return
    }

    let reportJson: unknown = null
    let summary: string | undefined
    let title: string | undefined
    let durationSec: number | undefined
    let participants: unknown[] | undefined
    let transcriptText: string | undefined

    if (reportTool) {
      const res = await callMymeetTool(apiKey, reportTool, { meeting_id: externalMeetingId, id: externalMeetingId })
      const { text, json } = extractToolContent(res)
      reportJson = json ?? { text }
      const j = json as any
      summary = pickString(j, ['summary', 'overview', 'abstract']) ?? (text ? text.slice(0, 2000) : undefined)
      title = pickString(j, ['title', 'name', 'meeting_title'])
      durationSec = pickNumber(j, ['duration_sec', 'durationSeconds', 'duration'])
      if (Array.isArray(j?.participants)) participants = j.participants
    }

    if (transcriptTool) {
      const res = await callMymeetTool(apiKey, transcriptTool, { meeting_id: externalMeetingId, id: externalMeetingId })
      const { text, json } = extractToolContent(res)
      transcriptText = text || (typeof (json as any)?.transcript === 'string' ? (json as any).transcript : undefined)
    }

    await db.update(meetingReport)
      .set({
        status: 'completed',
        title: title ?? null,
        durationSec: durationSec ?? null,
        summary: summary ?? null,
        reportJson: (reportJson ?? null) as Record<string, unknown> | null,
        participantsJson: participants ?? null,
        transcriptText: transcriptText ?? null,
        errorMessage: null,
        importedAt: new Date(),
      })
      .where(and(eq(meetingReport.id, meetingReportId), eq(meetingReport.organizationId, organizationId)))

    logInfo('mymeet.import_completed', {
      meeting_report_id: meetingReportId,
      external_meeting_id: externalMeetingId,
      report_tool: reportTool,
      transcript_tool: transcriptTool,
      module: 'mymeet',
    })
  }
  catch (err) {
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
