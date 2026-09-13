import { getQuery } from 'h3'
import { db } from '../../utils/db'
import { job } from '../../database/schema'
import { analyticsQuerySchema, resolvePeriod } from '../../utils/analytics/filters'
import { resolveAnalyticsScope } from '../../utils/analytics/scope'
import { computeTimeToFill } from '../../utils/analytics/aggregations'
import { eq, and, sql, desc } from 'drizzle-orm'
import { department, company } from '../../database/schema'

/**
 * GET /api/analytics/export?report=jobs|recruiters — экспорт CSV (Центр аналитики, Фаза 9).
 *
 * Возвращает text/csv с соответствующими колонками. Используется для выгрузки
 * отчётов руководством. exceljs не тянем для CSV — простой конструктор.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const report = getQuery(event).report as string ?? 'jobs'
  const q = await getValidatedQuery(event, analyticsQuerySchema.parse)
  const period = resolvePeriod(q)
  const scope = await resolveAnalyticsScope(orgId, session.user.id, q.scope)

  if (report === 'jobs') {
    const jobConds: any[] = [eq(job.organizationId, orgId)]
    if (scope.scoped) {
      if (scope.jobIds.length === 0) return csvResponse([], [])
      jobConds.push(sql`${job.id} IN (${sql.join(scope.jobIds.map(id => sql`${id}`), sql`, `)})`)
    }

    const jobs = await db.select({
      id: job.id, title: job.title, status: job.status,
      departmentName: department.name, companyName: company.name,
      openedAt: job.openedAt, closedAt: job.closedAt, firstOpenedAt: job.firstOpenedAt,
      headcount: job.headcount, reopenCount: job.reopenCount,
      closeReason: job.closeReason, createdAt: job.createdAt,
    })
      .from(job)
      .leftJoin(department, eq(department.id, job.departmentId))
      .leftJoin(company, eq(company.id, job.companyId))
      .where(and(...jobConds))
      .orderBy(desc(job.createdAt))
      .limit(500)

    // Наймы за всё время + момент последнего найма (для единого time-to-fill).
    const hireAgg: any = jobs.length
      ? await db.execute(sql`
          SELECT v.job_id, count(DISTINCT v.application_id)::int AS cnt, max(v.entered_at) AS last_hired_at
          FROM mv_application_stage_durations v
          WHERE v.organization_id = ${orgId} AND v.stage_type = 'hired'
            AND v.job_id IN (${sql.join(jobs.map(j => sql`${j.id}`), sql`, `)})
          GROUP BY v.job_id
        `)
      : []
    const hireByJob = new Map<string, any>(hireAgg.map((r: any) => [r.job_id, r]))

    const now = Date.now()
    const rows = jobs.map(j => {
      const openedAt = j.openedAt ?? j.firstOpenedAt ?? j.createdAt
      const daysOpen = j.status === 'open' ? Math.round((now - openedAt.getTime()) / 86400000) : ''
      const h = hireByJob.get(j.id) ?? {}
      const timeToFill = computeTimeToFill({
        openedAt, closedAt: j.closedAt, lastHiredAt: h.last_hired_at ? new Date(h.last_hired_at) : null,
        headcount: j.headcount, status: j.status, totalHires: h.cnt ?? 0,
      }) ?? ''
      return {
        Вакансия: j.title,
        Статус: j.status,
        Подразделение: j.departmentName ?? '',
        Компания: j.companyName ?? '',
        'Дней открыта': daysOpen,
        'Срок закрытия': timeToFill,
        'Reopen count': j.reopenCount,
        'Причина закрытия': j.closeReason ?? '',
        'Создана': j.createdAt.toISOString(),
      }
    })

    const headers = Object.keys(rows[0] ?? { Вакансия: '' })
    const format = getQuery(event).format as string ?? 'csv'
    return format === 'xlsx'
      ? await xlsxResponse(event, rows, headers, 'Вакансии')
      : csvResponse(event, rows, headers)
  }

  const format = getQuery(event).format as string ?? 'csv'
  return format === 'xlsx' ? await xlsxResponse(event, [], [], 'Отчёт') : csvResponse(event, [], [])
})

/** Простой CSV-конструктор (без exceljs — для CSV достаточно). */
function csvResponse(event: any, rows: Record<string, any>[], headers: string[]) {
  const escape = (v: any) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(escape).join(',')]
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(','))
  }
  setHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="analytics-${Date.now()}.csv"`)
  return lines.join('\n')
}

/** XLSX-конструктор через exceljs (dynamic import — не раздувает бандл). */
async function xlsxResponse(event: any, rows: Record<string, any>[], headers: string[], sheetName: string) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Huntfork'
  wb.created = new Date()
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = headers.map(h => ({ header: h, key: h, width: Math.max(12, Math.min(40, h.length + 6)) }))
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F7' } }
  for (const row of rows) ws.addRow(row)

  const buf = await wb.xlsx.writeBuffer()
  setHeader(event, 'content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'content-disposition', `attachment; filename="analytics-${Date.now()}.xlsx"`)
  return new Uint8Array(buf)
}
