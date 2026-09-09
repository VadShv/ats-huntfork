import { describe, it, expect } from 'vitest'
import { resolveStageFilterIds } from '../../server/utils/ai/stage-filter'

/**
 * Юнит-тест единого этапного резолвера ИИ-инструментов (W2.2/W3.2).
 *
 * Мокаем минимальную Drizzle-цепочку select().from().where() → Promise<rows>.
 * Проверяем, что резолвер строит фильтр по current_stage_id (этап+подэтапы для
 * stageId; все id типа для stageType) и корректно различает «пусто» vs «legacy».
 */

/** Фейковый db: select().from().where() возвращает заранее заданные строки. */
function fakeDb(rows: Array<{ id: string }>) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    }),
  }
}

describe('resolveStageFilterIds', () => {
  it('stageId → [сам этап + его подэтапы] (без дублей)', async () => {
    // where(...) вернёт подэтапы; сам stageId добавляется в резолвере
    const db = fakeDb([{ id: 'sub-1' }, { id: 'sub-2' }])
    const ids = await resolveStageFilterIds(db, 'org1', { stageId: 'root-1' })
    expect(ids).not.toBeNull()
    expect(new Set(ids!)).toEqual(new Set(['root-1', 'sub-1', 'sub-2']))
  })

  it('stageId без подэтапов → [только сам этап]', async () => {
    const db = fakeDb([])
    const ids = await resolveStageFilterIds(db, 'org1', { stageId: 'leaf' })
    expect(ids).toEqual(['leaf'])
  })

  it('stageId не дублируется, если случайно вернулся среди подэтапов', async () => {
    const db = fakeDb([{ id: 'root-1' }, { id: 'sub-1' }])
    const ids = await resolveStageFilterIds(db, 'org1', { stageId: 'root-1' })
    expect(ids!.filter(x => x === 'root-1')).toHaveLength(1)
    expect(new Set(ids!)).toEqual(new Set(['root-1', 'sub-1']))
  })

  it('stageType → все id этапов этого типа', async () => {
    const db = fakeDb([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    const ids = await resolveStageFilterIds(db, 'org1', { stageType: 'assessment' })
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('stageType без этапов → [] (заведомо пусто, НЕ null)', async () => {
    const db = fakeDb([])
    const ids = await resolveStageFilterIds(db, 'org1', { stageType: 'no_show' })
    expect(ids).toEqual([])
    expect(ids).not.toBeNull()
  })

  it('ни stageId, ни stageType → null (legacy-путь)', async () => {
    const db = fakeDb([{ id: 'x' }])
    const ids = await resolveStageFilterIds(db, 'org1', {})
    expect(ids).toBeNull()
  })

  it('stageId имеет приоритет над stageType', async () => {
    // Первый вызов where() (ветка stageId) вернёт подэтапы; ветка stageType не вызывается
    const db = fakeDb([{ id: 'sub' }])
    const ids = await resolveStageFilterIds(db, 'org1', { stageId: 'root', stageType: 'interview' })
    expect(new Set(ids!)).toEqual(new Set(['root', 'sub']))
  })
})
