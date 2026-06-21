/**
 * Сбор текста для full-text поиска кандидатов (Sprint 11).
 *
 * Объединяет: ФИО, email, phone, city, текст всех резюме кандидата
 * (document.parsedContent.text где type='resume') + hh_resume_raw → текст.
 *
 * Использует конфигурацию tsvector('simple') — без стемминга, безопасно для
 * смешанного RU/EN текста и технических терминов (Python, React, k8s).
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { candidate, document, propertyDefinition, propertyValue } from '../database/schema'
import { db } from './db'
import { resumeToText, type HhResumeApi } from './hh/sync'

/**
 * Собрать единый текст для кандидата из всех доступных источников.
 */
export async function buildCandidateSearchText(opts: {
  orgId: string
  candidateId: string
}): Promise<string> {
  const c = await db.query.candidate.findFirst({
    where: and(
      eq(candidate.organizationId, opts.orgId),
      eq(candidate.id, opts.candidateId),
    ),
    columns: {
      firstName: true,
      lastName: true,
      displayName: true,
      email: true,
      phone: true,
      city: true,
      quickNotes: true,
      aiSummary: true,
      hhResumeRaw: true,
    },
  })
  if (!c) return ''

  const docs = await db.query.document.findMany({
    where: and(
      eq(document.organizationId, opts.orgId),
      eq(document.candidateId, opts.candidateId),
      eq(document.type, 'resume'),
    ),
    columns: { parsedContent: true },
  })

  const parts: string[] = []
  parts.push(c.firstName, c.lastName, c.displayName ?? '', c.email, c.phone ?? '', c.city ?? '')
  if (c.quickNotes) parts.push(c.quickNotes)
  if (c.aiSummary) parts.push(c.aiSummary)

  for (const d of docs) {
    const text = (d.parsedContent as { text?: string } | null)?.text
    if (text) parts.push(text)
  }

  if (c.hhResumeRaw) {
    try {
      const t = resumeToText(c.hhResumeRaw as unknown as HhResumeApi)
      if (t) parts.push(t)
    }
    catch {
      // fallback: JSON dump
      parts.push(JSON.stringify(c.hhResumeRaw))
    }
  }

  // ── Метки (Sprint 1A) ──
  // Собираем labels выбранных опций select / multi_select properties этого кандидата.
  // Нужно чтобы поиск по метке «Сеньор» находил помеченных.
  try {
    const values = await db.select({
      value: propertyValue.value,
      config: propertyDefinition.config,
      type: propertyDefinition.type,
    })
      .from(propertyValue)
      .innerJoin(propertyDefinition, eq(propertyDefinition.id, propertyValue.propertyDefinitionId))
      .where(and(
        eq(propertyValue.organizationId, opts.orgId),
        eq(propertyValue.entityType, 'candidate'),
        eq(propertyValue.entityId, opts.candidateId),
        inArray(propertyDefinition.type, ['select', 'multi_select']),
      ))

    for (const row of values) {
      const cfg = row.config as { options?: Array<{ id: string, label: string }> } | null
      if (!cfg?.options) continue
      const selected = row.type === 'multi_select'
        ? (Array.isArray(row.value) ? row.value as string[] : [])
        : (typeof row.value === 'string' ? [row.value] : [])
      for (const optId of selected) {
        const opt = cfg.options.find(o => o.id === optId)
        if (opt?.label) parts.push(opt.label)
      }
    }
  }
  catch (err) {
    // Не ломаем индексацию из-за проблемы с propertyValue
    console.error('[buildCandidateSearchText] tags fetch failed', err)
  }

  return parts.filter(Boolean).join('\n').slice(0, 1_000_000) // safety cap
}

/**
 * Обновить candidate.search_tsv текущего кандидата.
 * Вызывается из мест, где меняется содержимое резюме (sync hh, upload document,
 * importResume, edit-candidate).
 */
export async function refreshCandidateSearchTsv(opts: {
  orgId: string
  candidateId: string
}): Promise<void> {
  const text = await buildCandidateSearchText(opts)
  await db.execute(sql`
    UPDATE "candidate"
       SET "search_tsv" = to_tsvector('simple', ${text})
     WHERE "organization_id" = ${opts.orgId}
       AND "id" = ${opts.candidateId}
  `)
}
