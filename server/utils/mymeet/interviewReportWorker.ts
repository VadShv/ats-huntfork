/**
 * Генерация отчёта по интервью нашим ассистентом (Спринт 5, поток Б).
 * Долгий LLM-вызов → pg-boss. Собирает транскрипт (MyMeet) + опросник + BARS-якоря,
 * генерирует отчёт, сохраняет meeting_report, опционально write-back в опросник.
 * Очередь: interview-report. docs/tz-questions-05-mymeet-reports.md §5.8
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import {
  meetingReport, applicationQuestionSet, applicationQuestionItem,
  assessmentScale, barsAnchor, reportTemplate, application, job, jobBrief,
} from '../../database/schema'
import { getBoss } from '../queue/boss'
import { getMymeetApiKey } from './account'
import { callMymeetByKey } from './mcp'
import { loadAiConfig } from '../ai/loadConfig'
import type { SupportedProvider } from '../ai/provider'
import {
  generateInterviewReport, renderReportMarkdown,
  type ReportQuestionInput, type ReportBarsInput, type QuestionAnswerMatch,
} from '../ai/generateInterviewReport'
import { withAiOperation } from '../ai/usage/context'

export const INTERVIEW_REPORT_QUEUE = 'interview-report'

export interface InterviewReportPayload {
  organizationId: string
  meetingReportId: string
  applicationId: string
  externalMeetingId: string
  reportTemplateId: string | null
  writeBackAnswers: boolean
  createdById?: string | null
}

export async function enqueueInterviewReport(payload: InterviewReportPayload): Promise<void> {
  const boss = await getBoss()
  await boss.send(INTERVIEW_REPORT_QUEUE, payload, {
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 15 * 60,
    singletonKey: `interview-report:${payload.meetingReportId}`,
    singletonHours: 1,
  })
}

export async function processInterviewReportJob(
  jobs: { data: InterviewReportPayload } | { data: InterviewReportPayload }[],
): Promise<void> {
  const list = Array.isArray(jobs) ? jobs : [jobs]
  for (const j of list) await runInterviewReportJob(j.data)
}

async function fail(orgId: string, reportId: string, message: string) {
  await db.update(meetingReport)
    .set({ status: 'failed', errorMessage: message })
    .where(and(eq(meetingReport.id, reportId), eq(meetingReport.organizationId, orgId)))
}

async function runInterviewReportJob(payload: InterviewReportPayload): Promise<void> {
  const { organizationId: orgId, meetingReportId, applicationId, externalMeetingId } = payload

  const apiKey = await getMymeetApiKey(orgId)
  if (!apiKey) return fail(orgId, meetingReportId, 'MyMeet не подключён')

  // 1) Транскрипт из MyMeet.
  let transcript = ''
  try {
    const res = await callMymeetByKey(apiKey, 'getTranscript', { meeting_id: externalMeetingId, meetingId: externalMeetingId })
    transcript = res?.text?.trim() || ''
    if (!transcript && res?.json) transcript = JSON.stringify(res.json)
  }
  catch (e) {
    return fail(orgId, meetingReportId, `Не удалось получить транскрипт: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!transcript) return fail(orgId, meetingReportId, 'Транскрипт пуст или tool не найден (discovery)')

  // 2) Опросник (основные вопросы активного набора/snapshot).
  const set = await db.query.applicationQuestionSet.findFirst({
    where: and(eq(applicationQuestionSet.applicationId, applicationId), eq(applicationQuestionSet.organizationId, orgId)),
    columns: { id: true },
  })
  const items = set
    ? await db.query.applicationQuestionItem.findMany({
      where: and(eq(applicationQuestionItem.setId, set.id), eq(applicationQuestionItem.organizationId, orgId), isNull(applicationQuestionItem.parentItemId)),
    })
    : []
  const questions: ReportQuestionInput[] = items.map(i => ({ itemId: i.id, text: i.text, listenFor: i.listenFor, topicId: i.topicId }))

  // 3) BARS-якоря тем опросника.
  const topicIds = [...new Set(items.map(i => i.topicId).filter(Boolean) as string[])]
  const bars: ReportBarsInput[] = []
  for (const topicId of topicIds) {
    const scale = await db.query.assessmentScale.findFirst({
      where: and(eq(assessmentScale.topicId, topicId), eq(assessmentScale.organizationId, orgId), eq(assessmentScale.isDefault, true)),
      with: { anchors: true, topic: { columns: { name: true } } },
    })
    if (scale) {
      bars.push({
        topicId,
        topicName: (scale as { topic?: { name?: string } }).topic?.name ?? '',
        scaleType: scale.type,
        anchors: (scale.anchors ?? []).map((a: typeof barsAnchor.$inferSelect) => ({ value: a.value, anchorText: a.anchorText })),
      })
    }
  }

  // 4) Шаблон отчёта + контекст вакансии.
  const tpl = payload.reportTemplateId
    ? await db.query.reportTemplate.findFirst({ where: and(eq(reportTemplate.id, payload.reportTemplateId), eq(reportTemplate.organizationId, orgId)) })
    : await db.query.reportTemplate.findFirst({ where: and(eq(reportTemplate.organizationId, orgId), eq(reportTemplate.isDefault, true), eq(reportTemplate.isActive, true)) })

  const app = await db.query.application.findFirst({
    where: eq(application.id, applicationId), columns: { jobId: true },
  })
  let jobContext: { title?: string, briefHighlights?: string } | undefined
  if (app) {
    const jobRow = await db.query.job.findFirst({ where: eq(job.id, app.jobId), columns: { title: true } })
    const brief = await db.query.jobBrief.findFirst({ where: eq(jobBrief.jobId, app.jobId), columns: { idealProfile: true } })
    jobContext = { title: jobRow?.title, briefHighlights: brief?.idealProfile ?? undefined }
  }

  // 5) Генерация.
  const config = await loadAiConfig(orgId, { purpose: 'analysis', preferId: tpl?.preferredAiConfigId ?? undefined })
  let report, truncated = false
  try {
    const gen = await withAiOperation({ organizationId: orgId, jobId: app?.jobId ?? null, entity: { type: 'meeting_report', id: meetingReportId }, trigger: 'background', source: 'queue:interview-report' }, () => generateInterviewReport(
      {
        id: config.id,
        provider: config.provider as SupportedProvider,
        model: config.model,
        apiKeyEncrypted: config.apiKeyEncrypted,
        baseUrl: config.baseUrl,
        maxTokens: config.maxTokens,
      },
      {
        transcript,
        questions,
        bars,
        reportTemplatePromptText: tpl?.promptText ?? '',
        jobContext,
      },
    ))
    report = gen.report
    truncated = gen.truncated
  }
  catch (e) {
    return fail(orgId, meetingReportId, `Ошибка генерации: ${e instanceof Error ? e.message : String(e)}`)
  }

  const markdown = renderReportMarkdown(report)
  if (truncated) report.summary = `${report.summary}\n\n(отчёт по неполному транскрипту — усечён по бюджету)`

  const qaMap: QuestionAnswerMatch[] = report.questionAnswers

  // 6) Сохранить отчёт.
  await db.update(meetingReport)
    .set({
      status: 'completed',
      source: 'assistant',
      reportTemplateId: tpl?.id ?? null,
      templateVersion: tpl?.version ?? null,
      templateName: tpl?.name ?? null,
      reportMarkdown: markdown,
      questionAnswerMap: qaMap,
      summary: report.summary,
      generatedByModel: config.model,
      aiProvider: config.provider,
      transcriptText: transcript,
      importedAt: new Date(),
    })
    .where(and(eq(meetingReport.id, meetingReportId), eq(meetingReport.organizationId, orgId)))

  // 7) Безопасный write-back (§5.8.4a): только matched + confidence>=medium.
  if (payload.writeBackAnswers) {
    for (const qa of qaMap) {
      if (!qa.itemId || !qa.matched) continue
      if (qa.confidence !== 'medium' && qa.confidence !== 'high') continue
      await db.update(applicationQuestionItem)
        .set({
          answerNote: qa.answerText,
          askStatus: 'asked',
          answerAutoFilled: true,
          answerConfidence: qa.confidence,
          updatedAt: new Date(),
        })
        .where(and(eq(applicationQuestionItem.id, qa.itemId), eq(applicationQuestionItem.organizationId, orgId)))
    }
  }
}
