/**
 * Ленивый провижн методики CARE для организации (Спринт 2).
 * Создаёт версию 1 (isActive), 3 seed-промпта, 9 builtin-триггеров, если методики
 * ещё нет. Идемпотентно. docs/tz-questions-02-care.md §6
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { careMethodology, carePrompt, careProbeTrigger } from '../../database/schema'
import {
  CARE_DESCRIPTION_DEFAULT, CARE_INTERVIEWER_INSTRUCTION_DEFAULT, CARE_SUFFICIENCY_DEFAULT,
  CARE_PROBE_TRIGGERS_DEFAULT, CARE_PROMPT_SEEDS, probeRulesFromTriggers,
} from './careDefaults'

/** Гарантировать наличие активной методики CARE у организации. Возвращает активную версию. */
export async function ensureCareMethodology(organizationId: string, createdById?: string | null) {
  const existing = await db.query.careMethodology.findFirst({
    where: and(eq(careMethodology.organizationId, organizationId), eq(careMethodology.isActive, true)),
  })
  if (existing) return existing

  return db.transaction(async (tx) => {
    // Повторная проверка внутри транзакции (гонки).
    const again = await tx.query.careMethodology.findFirst({
      where: and(eq(careMethodology.organizationId, organizationId), eq(careMethodology.isActive, true)),
    })
    if (again) return again

    const [methodology] = await tx.insert(careMethodology).values({
      organizationId,
      version: 1,
      isActive: true,
      title: 'CARE',
      description: CARE_DESCRIPTION_DEFAULT,
      interviewerInstruction: CARE_INTERVIEWER_INSTRUCTION_DEFAULT,
      sufficiencyCriteria: CARE_SUFFICIENCY_DEFAULT,
      probeRules: probeRulesFromTriggers(CARE_PROBE_TRIGGERS_DEFAULT),
      probeLimitPerElement: 3,
      probeLimitPerQuestion: 6,
      changeNote: 'Первичная методика (seed)',
      createdById: createdById ?? null,
      publishedAt: new Date(),
    }).returning()

    for (const seed of CARE_PROMPT_SEEDS) {
      await tx.insert(carePrompt).values({
        organizationId,
        kind: seed.kind,
        promptText: seed.promptText,
        variables: seed.variables,
        version: 1,
        isActive: true,
        methodologyVersion: 1,
        changeNote: 'seed',
        createdById: createdById ?? null,
        publishedAt: new Date(),
      })
    }

    // Триггеры создаём, только если их ещё нет (builtin).
    const existingTriggers = await tx.query.careProbeTrigger.findFirst({
      where: eq(careProbeTrigger.organizationId, organizationId),
      columns: { id: true },
    })
    if (!existingTriggers) {
      await tx.insert(careProbeTrigger).values(
        CARE_PROBE_TRIGGERS_DEFAULT.map((t, i) => ({
          organizationId,
          trigger: t.trigger,
          recommendedProbe: t.recommendedProbe,
          careElement: t.careElement,
          isBuiltin: true,
          isActive: true,
          displayOrder: i,
          createdById: createdById ?? null,
        })),
      )
    }

    return methodology
  })
}
