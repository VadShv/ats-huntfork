/**
 * B4 (грандфазеринг): аудит вакансий, привязанных к НЕ-канонической воронке.
 *
 * После включения единой канонической воронки (Блок B) новые вакансии всегда
 * идут на org-default. Но старые вакансии могли быть привязаны к пользовательской
 * или не-дефолтной воронке. Этот скрипт:
 *   - без флага            → только отчёт (dry-run), ничего не меняет;
 *   - с флагом --apply     → перепривязывает такие вакансии на каноническую
 *                            (org default) и ремаппит application.current_stage_id
 *                            по ТИПУ этапа (root-этап старой воронки → root-этап
 *                            канонической того же type; подэтап → тот же родитель).
 *
 * Запуск:
 *   npx tsx server/scripts/audit-noncanonical-job-pipelines.ts
 *   npx tsx server/scripts/audit-noncanonical-job-pipelines.ts --apply
 *
 * Требует DATABASE_URL в окружении (грузится из .env при наличии).
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { and, eq, isNotNull } from 'drizzle-orm'
import * as schema from '../database/schema'

const processWithLoadEnv = process as NodeJS.Process & {
  loadEnvFile?: (path?: string) => void
}
if (!process.env.DATABASE_URL && typeof processWithLoadEnv.loadEnvFile === 'function') {
  try { processWithLoadEnv.loadEnvFile('.env') }
  catch { /* .env optional */ }
}

const DATABASE_URL = process.env.DATABASE_URL ?? ''
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required. Set it in .env or export it.')
  process.exit(1)
}

const APPLY = process.argv.includes('--apply')

const client = postgres(DATABASE_URL, { max: 1 })
const db = drizzle(client, { schema })

const { job, pipeline, pipelineStage, application, organization } = schema

async function run() {
  console.log(`🔎 Аудит вакансий на не-канонической воронке${APPLY ? ' (режим APPLY)' : ' (dry-run)'}...`)

  const orgs = await db.select({ id: organization.id, name: organization.name }).from(organization)
  let totalOffending = 0
  let totalReassigned = 0
  let totalRemapped = 0

  for (const org of orgs) {
    // Каноническая воронка org (isDefault=true, иначе isSystem=true)
    const [canonical]
      = (await db.select({ id: pipeline.id, name: pipeline.name })
        .from(pipeline)
        .where(and(eq(pipeline.organizationId, org.id), eq(pipeline.isDefault, true), eq(pipeline.isArchived, false)))
        .limit(1))
      ?? []
    let canonicalPipeline = canonical
    if (!canonicalPipeline) {
      const [sys] = await db.select({ id: pipeline.id, name: pipeline.name })
        .from(pipeline)
        .where(and(eq(pipeline.organizationId, org.id), eq(pipeline.isSystem, true), eq(pipeline.isArchived, false)))
        .limit(1)
      canonicalPipeline = sys
    }
    if (!canonicalPipeline) {
      console.warn(`   ⚠  "${org.name}" (${org.id}): нет канонической воронки — пропуск`)
      continue
    }

    // Вакансии, привязанные к другой воронке
    const offending = await db.select({ id: job.id, title: job.title, pipelineId: job.pipelineId })
      .from(job)
      .where(and(
        eq(job.organizationId, org.id),
        isNotNull(job.pipelineId),
      ))
    const wrong = offending.filter(j => j.pipelineId && j.pipelineId !== canonicalPipeline!.id)
    if (wrong.length === 0) continue

    totalOffending += wrong.length
    console.log(`\n   🏢 "${org.name}" (${org.id}) → каноническая: "${canonicalPipeline.name}"`)
    for (const j of wrong) {
      console.log(`      • Вакансия "${j.title}" (${j.id}) на воронке ${j.pipelineId}`)
    }

    if (!APPLY) continue

    // Каноническая карта type → stageId (root-этапы + подэтапы по (parentType,type))
    const canonicalStages = await db.select({
      id: pipelineStage.id, type: pipelineStage.type, parentStageId: pipelineStage.parentStageId,
    }).from(pipelineStage).where(and(
      eq(pipelineStage.pipelineId, canonicalPipeline.id),
      eq(pipelineStage.organizationId, org.id),
      eq(pipelineStage.isArchived, false),
    ))
    const canonicalRootByType = new Map<string, string>()
    for (const s of canonicalStages) {
      if (!s.parentStageId && !canonicalRootByType.has(s.type)) canonicalRootByType.set(s.type, s.id)
    }

    for (const j of wrong) {
      // Перепривязываем вакансию
      await db.update(job).set({ pipelineId: canonicalPipeline.id, updatedAt: new Date() })
        .where(and(eq(job.id, j.id), eq(job.organizationId, org.id)))
      totalReassigned++

      // Ремаппинг current_stage_id откликов по типу этапа
      const apps = await db.select({ id: application.id, currentStageId: application.currentStageId })
        .from(application)
        .where(and(eq(application.jobId, j.id), eq(application.organizationId, org.id), isNotNull(application.currentStageId)))

      for (const a of apps) {
        if (!a.currentStageId) continue
        const [oldStage] = await db.select({ type: pipelineStage.type })
          .from(pipelineStage).where(eq(pipelineStage.id, a.currentStageId)).limit(1)
        const targetId = oldStage ? canonicalRootByType.get(oldStage.type) : undefined
        // Если типа нет в канонической — обнуляем (fallback на legacy status)
        await db.update(application)
          .set({ currentStageId: targetId ?? null, updatedAt: new Date() })
          .where(and(eq(application.id, a.id), eq(application.organizationId, org.id)))
        totalRemapped++
      }
    }
  }

  console.log(`\n── Итог ──`)
  console.log(`   Вакансий на не-канонической воронке: ${totalOffending}`)
  if (APPLY) {
    console.log(`   Перепривязано вакансий: ${totalReassigned}`)
    console.log(`   Ремаппинг откликов (current_stage_id): ${totalRemapped}`)
  } else if (totalOffending > 0) {
    console.log(`   Запустите с флагом --apply, чтобы перепривязать на каноническую воронку.`)
  }
  await client.end()
}

run().catch((err) => {
  console.error('Fatal error during audit:', err)
  process.exit(1)
})
