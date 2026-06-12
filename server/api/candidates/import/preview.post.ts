/**
 * POST /api/candidates/import/preview
 *
 * Sprint 5.4 (P5.4): первый шаг массового импорта.
 * Принимает multipart с одним файлом (.csv или .xlsx), парсит и для каждой
 * строки прогоняет dedup-check. Возвращает превью для отрисовки таблицы
 * в UI: рекрутер видит, какие строки — новые, какие — дубли, и выбирает
 * действие для каждой (create / merge_into / skip).
 *
 * Лимиты:
 *   • Размер файла ≤ 5 MB
 *   • Количество строк ≤ 500
 *
 * Файл НЕ сохраняется на диск — только в памяти.
 */
import { findDuplicatesForDraft } from '../../../utils/dedup/check'
import { parseCsv, parseXlsx, type ParsedCandidateRow } from '../../../utils/dedup/import-parse'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const MAX_ROWS = 500

interface PreviewRowResult {
  row: ParsedCandidateRow
  duplicates: {
    exact: Array<{
      candidateId: string
      kind: 'email' | 'phone'
      firstName: string | null
      lastName: string | null
      organizationId: string
    }>
    fuzzy: Array<{
      candidateId: string
      score: number
      firstName: string | null
      lastName: string | null
      organizationId: string
    }>
  }
  /** Рекомендуемое действие по умолчанию. */
  suggestedAction: 'create' | 'merge_into' | 'skip'
  /** ID кандидата, в которого предлагается смерджить (если suggestedAction='merge_into'). */
  suggestedMergeTargetId?: string
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId

  // Парсим multipart
  const formData = await readMultipartFormData(event)
  if (!formData || formData.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Файл не загружен' })
  }

  const filePart = formData.find(p => p.name === 'file' && p.filename)
  if (!filePart || !filePart.data) {
    throw createError({ statusCode: 400, statusMessage: 'Поле "file" обязательно' })
  }

  if (filePart.data.length > MAX_FILE_SIZE) {
    throw createError({
      statusCode: 413,
      statusMessage: `Файл слишком большой (${(filePart.data.length / 1024 / 1024).toFixed(1)} MB > 5 MB)`,
    })
  }

  const filename = filePart.filename ?? ''
  const ext = filename.toLowerCase().split('.').pop()

  let rows: ParsedCandidateRow[]
  if (ext === 'csv') {
    rows = parseCsv(filePart.data)
  }
  else if (ext === 'xlsx' || ext === 'xls') {
    rows = await parseXlsx(filePart.data)
  }
  else {
    throw createError({
      statusCode: 400,
      statusMessage: 'Поддерживаются только .csv и .xlsx файлы',
    })
  }

  if (rows.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Файл не содержит строк с данными' })
  }

  if (rows.length > MAX_ROWS) {
    throw createError({
      statusCode: 413,
      statusMessage: `Слишком много строк (${rows.length} > ${MAX_ROWS}). Разделите файл на части.`,
    })
  }

  // Для каждой строки — dedup-check. Делаем последовательно, чтобы не убить БД.
  const previewRows: PreviewRowResult[] = []
  for (const row of rows) {
    // Если в строке ошибки парсинга — не делаем dedup-check, помечаем как skip
    if (row.errors.length > 0) {
      previewRows.push({
        row,
        duplicates: { exact: [], fuzzy: [] },
        suggestedAction: 'skip',
      })
      continue
    }

    try {
      const dedup = await findDuplicatesForDraft(orgId, {
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        phone: row.phone,
        dateOfBirth: row.dateOfBirth,
        city: row.city,
      })

      let suggestedAction: PreviewRowResult['suggestedAction'] = 'create'
      let suggestedMergeTargetId: string | undefined

      if (dedup.exact.length > 0) {
        // Точный дубль — по умолчанию мерджим
        suggestedAction = 'merge_into'
        suggestedMergeTargetId = dedup.exact[0]!.candidateId
      }
      else if (dedup.fuzzy.length > 0 && dedup.fuzzy[0]!.score >= 95) {
        // Очень похожий fuzzy — тоже мерджим
        suggestedAction = 'merge_into'
        suggestedMergeTargetId = dedup.fuzzy[0]!.candidateId
      }
      else if (dedup.fuzzy.length > 0) {
        // Подозрение — пусть рекрутер сам решит
        suggestedAction = 'create'
      }

      previewRows.push({
        row,
        duplicates: {
          exact: dedup.exact.map(d => ({
            candidateId: d.candidateId,
            kind: d.kind,
            firstName: d.firstName,
            lastName: d.lastName,
            organizationId: d.organizationId,
          })),
          fuzzy: dedup.fuzzy.map(d => ({
            candidateId: d.candidateId,
            score: d.score,
            firstName: d.firstName,
            lastName: d.lastName,
            organizationId: d.organizationId,
          })),
        },
        suggestedAction,
        suggestedMergeTargetId,
      })
    }
    catch (err: any) {
      // Если dedup-check упал на одной строке — не валим весь импорт
      previewRows.push({
        row: { ...row, errors: [...row.errors, `Dedup-check ошибка: ${err.message ?? 'unknown'}`] },
        duplicates: { exact: [], fuzzy: [] },
        suggestedAction: 'skip',
      })
    }
  }

  return {
    totalRows: rows.length,
    validRows: previewRows.filter(r => r.row.errors.length === 0).length,
    rowsWithErrors: previewRows.filter(r => r.row.errors.length > 0).length,
    exactDuplicates: previewRows.filter(r => r.duplicates.exact.length > 0).length,
    fuzzyDuplicates: previewRows.filter(r => r.duplicates.fuzzy.length > 0 && r.duplicates.exact.length === 0).length,
    rows: previewRows,
  }
})
