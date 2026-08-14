import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidate } from '../../../database/schema'
import { candidateIdParamSchema } from '../../../utils/schemas/candidate'
import { loadAiConfig } from '../../../utils/ai/loadConfig'
import { generateStructuredOutput } from '../../../utils/ai/provider'
import { parseHhResume } from '../../../utils/hh/resume-render'
import { createRateLimiter } from '../../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  message: 'Слишком много запросов на создание ИИ-сводки. Подождите немного',
})

const summarySchema = z.object({
  summary: z.string().min(20).max(800).describe('Краткое описание кандидата в 3-5 строк: ключевая специализация, общий опыт, в чём силён.'),
  strengths: z.array(z.string().min(2).max(160)).min(2).max(5).describe('Сильные стороны (2-5 пунктов).'),
  concerns: z.array(z.string().min(2).max(160)).max(5).describe('Возможные риски / вопросы для уточнения (0-5 пунктов).'),
})

/**
 * POST /api/candidates/:id/ai-summary
 * Генерирует AI-саммари по сохранённому hh-резюме кандидата.
 * Сохраняет результат в candidate.ai_summary (plain text — summary + bullets).
 */
export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { scoring: ['create'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  const row = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true, firstName: true, lastName: true, hhResumeRaw: true },
  })

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Кандидат не найден' })
  if (!row.hhResumeRaw) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Нет снимка резюме кандидата — невозможно создать ИИ-сводку',
    })
  }

  const resume = parseHhResume(row.hhResumeRaw as Record<string, unknown>)

  // Готовим контекст для модели в виде сжатого текста.
  const lines: string[] = []
  if (resume.fullName) lines.push(`Кандидат: ${resume.fullName}`)
  if (resume.title) lines.push(`Желаемая должность: ${resume.title}`)
  if (resume.area) lines.push(`Регион: ${resume.area}`)
  if (resume.totalExperience?.months) {
    lines.push(`Общий опыт: ${resume.totalExperience.years} лет ${resume.totalExperience.monthsRemainder} мес.`)
  }
  if (resume.experience.length) {
    lines.push('', 'Опыт работы:')
    for (const e of resume.experience) {
      const period = [e.start, e.end].filter(Boolean).join(' — ')
      lines.push(`• ${e.position ?? '(должность не указана)'} в ${e.company ?? '(компания не указана)'} ${period ? `(${period})` : ''}`.trim())
      if (e.description) lines.push(e.description.slice(0, 600))
    }
  }
  if (resume.education.length) {
    lines.push('', 'Образование:')
    for (const ed of resume.education) {
      lines.push(`• ${ed.organization ?? ''} ${ed.name ? `— ${ed.name}` : ''} ${ed.year ? `(${ed.year})` : ''}`.trim())
    }
  }
  if (resume.skills.length) {
    lines.push('', `Ключевые навыки: ${resume.skills.slice(0, 40).join(', ')}`)
  }
  if (resume.about) {
    lines.push('', `О себе: ${resume.about.slice(0, 1500)}`)
  }
  if (resume.languages.length) {
    lines.push('', `Языки: ${resume.languages.map(l => l.level ? `${l.name} (${l.level})` : l.name).join(', ')}`)
  }
  const resumeText = lines.join('\n').slice(0, 12_000)

  const config = await loadAiConfig(orgId, { purpose: 'analysis', preferId: null })

  const result = await generateStructuredOutput(config, {
    system:
      'Ты опытный технический рекрутер. Делай краткие, точные, фактические выводы по резюме кандидата. '
      + 'Не сочиняй данные, которых нет в резюме. Пиши деловым русским языком. '
      + 'Strengths и concerns — короткие тезисы (≤ 140 символов), без «воды».',
    prompt:
      `Резюме кандидата (импортировано с hh.ru):\n\n${resumeText}\n\n`
      + 'Сформируй: 1) summary — 3-5 строк о специализации и опыте; '
      + '2) strengths — 2-5 коротких сильных сторон (на основе фактов из резюме); '
      + '3) concerns — 0-5 возможных рисков или уточняющих вопросов (например частые смены работы, гэп более года, неполная информация).',
    schema: summarySchema,
    schemaName: 'CandidateSummary',
    schemaDescription: 'Краткая AI-сводка по резюме кандидата.',
  })

  // Склеиваем в plain text для удобного отображения.
  const obj = result.object
  const parts: string[] = [obj.summary.trim()]
  if (obj.strengths.length) {
    parts.push('', 'Сильные стороны:', ...obj.strengths.map(s => `• ${s}`))
  }
  if (obj.concerns.length) {
    parts.push('', 'Стоит уточнить:', ...obj.concerns.map(s => `• ${s}`))
  }
  const summaryText = parts.join('\n')

  const now = new Date()
  await db.update(candidate)
    .set({ aiSummary: summaryText, aiSummaryAt: now, updatedAt: now })
    .where(eq(candidate.id, id))

  return {
    candidateId: id,
    aiSummary: summaryText,
    aiSummaryAt: now,
    usage: result.usage,
    structured: obj,
  }
})
