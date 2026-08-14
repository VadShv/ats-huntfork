import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { candidateMergeLog, organization, user } from '../../../database/schema'
import { buildMergesQuery } from '../../../utils/dedup/merges-query'

/**
 * Sprint 4.1 (P3.1): экспорт журнала слияний в CSV или XLSX.
 *
 * GET /api/dedup/merges/export?format=csv|xlsx&<те же фильтры что у /merges>
 *
 * Возвращает файл с потоковым ответом. Лимит — 10 000 строк (чтобы не вешать сервер).
 */
const querySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  status: z.enum(['active', 'expired', 'rolled_back', 'all']).default('all'),
  mergeKind: z.enum(['auto', 'manual', 'all']).default('all'),
  userId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
  includeOtherOrgs: z.coerce.boolean().default(true),
  /** Sprint 4.2 (P3.2): own | cross | all */
  orgScope: z.enum(['own', 'cross', 'all']).default('all'),
})

const EXPORT_HARD_LIMIT = 10_000

const HEADERS_RU = [
  'Дата',
  'Тип',
  'Статус',
  'Организация',
  'Cross-org',
  'Score',
  'Primary ФИО',
  'Primary email',
  'Primary ID',
  'Merged ФИО',
  'Merged email',
  'Merged ID',
  'Сигналы',
  'Причина',
  'Откатимо до',
  'Откачено',
  'Исполнитель',
  'Email исполнителя',
] as const

function formatName(first: string | null, last: string | null, email: string | null, id: string): string {
  const n = [last, first].filter(Boolean).join(' ').trim()
  return n || email || id.slice(0, 8)
}

function signalsToText(signals: unknown): string {
  const labels: Record<string, string> = { name: 'ФИО', city: 'город', dob: 'дата рожд.', employer: 'работодатель', manual: 'ручное' }
  if (Array.isArray(signals)) {
    return signals.map((s: any) => `${labels[s?.kind] ?? s?.kind ?? '?'}: ${s?.score ?? s?.value ?? ''}`).join(' · ')
  }
  if (signals && typeof signals === 'object') {
    return Object.entries(signals as Record<string, unknown>)
      .map(([k, v]) => `${labels[k] ?? k}: ${v}`)
      .join(' · ')
  }
  return ''
}

function statusText(rollbackUntil: Date | null, isRolledBack: boolean): string {
  if (isRolledBack) return 'Откачено'
  if (!rollbackUntil || rollbackUntil.getTime() <= Date.now()) return 'Окно закрыто'
  return 'Активно'
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function isoDate(d: Date | null): string {
  if (!d) return ''
  return new Date(d).toISOString()
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const query = await getValidatedQuery(event, querySchema.parse)

  const { primary, merged, whereConds, rollbackExists } = await buildMergesQuery(orgId, {
    status: query.status,
    mergeKind: query.mergeKind,
    userId: query.userId,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    search: query.search,
    includeOtherOrgs: query.includeOtherOrgs,
  })

  // Sprint 4.2 (P3.2): фильтр own | cross | all
  if (query.orgScope === 'own') {
    whereConds.push(eq(candidateMergeLog.organizationId, orgId))
  }
  else if (query.orgScope === 'cross') {
    whereConds.push(sql`${candidateMergeLog.organizationId} <> ${orgId}`)
  }

  const rows = await db
    .select({
      id: candidateMergeLog.id,
      createdAt: candidateMergeLog.createdAt,
      mergeKind: candidateMergeLog.mergeKind,
      score: candidateMergeLog.score,
      reason: candidateMergeLog.reason,
      signals: candidateMergeLog.signals,
      rollbackUntil: candidateMergeLog.rollbackUntil,
      primaryCandidateId: candidateMergeLog.primaryCandidateId,
      mergedCandidateId: candidateMergeLog.mergedCandidateId,
      primaryFirstName: primary.firstName,
      primaryLastName: primary.lastName,
      primaryEmail: primary.email,
      mergedFirstName: merged.firstName,
      mergedLastName: merged.lastName,
      mergedEmail: merged.email,
      performerName: user.name,
      performerEmail: user.email,
      hasRollback: rollbackExists,
      snapshot: candidateMergeLog.snapshot,
      organizationId: candidateMergeLog.organizationId,
      organizationName: organization.name,
    })
    .from(candidateMergeLog)
    .leftJoin(primary, eq(primary.id, candidateMergeLog.primaryCandidateId))
    .leftJoin(merged, eq(merged.id, candidateMergeLog.mergedCandidateId))
    .leftJoin(user, eq(user.id, candidateMergeLog.performedByUserId))
    .leftJoin(organization, eq(organization.id, candidateMergeLog.organizationId))
    .where(and(...whereConds))
    .orderBy(desc(candidateMergeLog.createdAt))
    .limit(EXPORT_HARD_LIMIT)

  // ─── Подготавливаем строки (плоский формат)
  const rowData = rows.map((r) => {
    const snap = r.snapshot as any
    const pFirst = r.primaryFirstName ?? snap?.primary?.firstName ?? null
    const pLast = r.primaryLastName ?? snap?.primary?.lastName ?? null
    const pEmail = r.primaryEmail ?? snap?.primary?.email ?? null
    const mFirst = r.mergedFirstName ?? snap?.merged?.firstName ?? null
    const mLast = r.mergedLastName ?? snap?.merged?.lastName ?? null
    const mEmail = r.mergedEmail ?? snap?.merged?.email ?? null
    return [
      isoDate(r.createdAt),
      r.mergeKind === 'auto' ? 'Авто' : 'Ручное',
      statusText(r.rollbackUntil, Boolean(r.hasRollback)),
      r.organizationName ?? r.organizationId,
      r.organizationId !== orgId ? 'Да' : 'Нет',
      r.score ?? '',
      formatName(pFirst, pLast, pEmail, r.primaryCandidateId),
      pEmail ?? '',
      r.primaryCandidateId,
      formatName(mFirst, mLast, mEmail, r.mergedCandidateId),
      mEmail ?? '',
      r.mergedCandidateId,
      signalsToText(r.signals),
      r.reason ?? '',
      isoDate(r.rollbackUntil),
      r.hasRollback ? 'Да' : 'Нет',
      r.performerName ?? '',
      r.performerEmail ?? '',
    ]
  })

  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

  // ─── CSV
  if (query.format === 'csv') {
    const headerLine = HEADERS_RU.map(csvEscape).join(',')
    const dataLines = rowData.map(row => row.map(csvEscape).join(','))
    // BOM \uFEFF — чтобы Excel корректно открыл UTF-8 с кириллицей
    const body = '\uFEFF' + [headerLine, ...dataLines].join('\r\n') + '\r\n'

    setResponseHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
    setResponseHeader(event, 'Content-Disposition', `attachment; filename="merges-${ts}.csv"`)
    setResponseHeader(event, 'Cache-Control', 'no-store')
    return body
  }

  // ─── XLSX
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Huntfork'
  wb.created = new Date()
  const ws = wb.addWorksheet('Журнал слияний', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  ws.columns = HEADERS_RU.map((h) => ({ header: h, key: h, width: Math.max(12, Math.min(40, h.length + 6)) }))

  // Стиль заголовка
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F7' } }
  ws.getRow(1).alignment = { vertical: 'middle' }

  for (const row of rowData) {
    ws.addRow(row)
  }

  // Подгоняем ширину под данные (грубая эвристика)
  ws.columns?.forEach((col, i) => {
    let max = String(HEADERS_RU[i] ?? '').length + 2
    for (const row of rowData) {
      const v = row[i]
      if (v != null) {
        const len = String(v).length
        if (len > max) max = len
      }
    }
    col.width = Math.min(60, Math.max(12, max + 2))
  })

  const buf = await wb.xlsx.writeBuffer()

  setResponseHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="merges-${ts}.xlsx"`)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return Buffer.from(buf as ArrayBuffer)
})
