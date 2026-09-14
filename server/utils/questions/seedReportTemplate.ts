/**
 * Ленивый провижн дефолтного шаблона отчёта «Стандартный» для организации (Спринт 5).
 * Идемпотентно. docs/tz-questions-05-mymeet-reports.md §5.5.1
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { reportTemplate } from '../../database/schema'
import { DEFAULT_REPORT_PROMPT } from '../ai/generateInterviewReport'

/** Гарантировать наличие дефолтного активного шаблона отчёта у организации. */
export async function ensureDefaultReportTemplate(organizationId: string, createdById?: string | null) {
  const existing = await db.query.reportTemplate.findFirst({
    where: and(eq(reportTemplate.organizationId, organizationId), eq(reportTemplate.isDefault, true), eq(reportTemplate.isActive, true)),
  })
  if (existing) return existing

  return db.transaction(async (tx) => {
    const again = await tx.query.reportTemplate.findFirst({
      where: and(eq(reportTemplate.organizationId, organizationId), eq(reportTemplate.isDefault, true), eq(reportTemplate.isActive, true)),
    })
    if (again) return again

    const [created] = await tx.insert(reportTemplate).values({
      organizationId,
      name: 'Стандартный',
      description: 'Базовый отчёт по интервью на основе транскрипта, опросника и BARS',
      kind: 'standard',
      promptText: DEFAULT_REPORT_PROMPT,
      isDefault: true,
      isActive: true,
      version: 1,
      createdById: createdById ?? null,
    }).returning()
    return created
  })
}
