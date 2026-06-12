/**
 * P2.5 Sprint 3.1: hh_owner_id обязательный для resume-exact.
 *
 * Правило: если во входящих сигналах есть hh_owner — мы доверяем hh_resume-совпадению ТОЛЬКО если у этого же
 * кандидата в БД тоже есть совпадающий hh_owner. Иначе — hh_resume матч отбрасываем (он уйдёт в fuzzy).
 * Если hh_owner во входящих НЕТ — оставляем hh_resume как было (беквард-совместимость).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Мок drizzle-db. Очень упрощённый chainable query builder.
// Поведение «что вернуть» задаётся через скрипт fixtures[].
// ─────────────────────────────────────────────────────────────────────────────

interface FixtureStep {
  table: 'candidate_identity' | 'candidate'
  rows: any[]
}

let fixtures: FixtureStep[] = []
let stepIdx = 0

function createDbMock() {
  return {
    select() {
      const tx: any = {
        from(_table: any) {
          tx._from = _table
          return tx
        },
        where(_w: any) {
          return tx
        },
        limit(_n: number) {
          return Promise.resolve(currentRows())
        },
        then(resolve: any) {
          return Promise.resolve(currentRows()).then(resolve)
        },
      }
      return tx
    },
    insert() { return { values: () => Promise.resolve() } },
    update() { return { set: () => ({ where: () => Promise.resolve() }) } },
  }

  function currentRows() {
    const step = fixtures[stepIdx]
    stepIdx += 1
    return step?.rows ?? []
  }
}

vi.stubGlobal('db', createDbMock())
vi.stubGlobal('logInfo', vi.fn())
vi.stubGlobal('logWarn', vi.fn())
vi.stubGlobal('logError', vi.fn())
vi.stubGlobal('logDebug', vi.fn())

// Импорт ПОСЛЕ stubGlobal — чтобы модуль использовал наш мок.
const { resolveCandidateBySignals } = await import('../../server/utils/dedup/resolve')
import type { IdentitySignal } from '../../server/utils/dedup/extract'

beforeEach(() => {
  fixtures = []
  stepIdx = 0
})

describe('resolveCandidateBySignals — P2.5: hh_owner обязательный для hh_resume', () => {
  it('hh_resume-матч ВАЛИДЕН если hh_owner совпадает с обеих сторон', async () => {
    const signals: IdentitySignal[] = [
      { kind: 'hh_resume', valueNormalized: 'r1', source: 'hh', confidence: 'verified' },
      { kind: 'hh_owner', valueNormalized: 'owner-42', source: 'hh', confidence: 'verified' },
    ]
    fixtures = [
      // 1: select по kind=hh_owner — ничего не нашли (новый кандидат для входящего owner)
      { table: 'candidate_identity', rows: [] },
      // 2: select по kind=hh_resume — есть совпадение с C1
      { table: 'candidate_identity', rows: [{ candidateId: 'C1', kind: 'hh_resume', valueNormalized: 'r1' }] },
      // 3: select из candidate — статус active
      { table: 'candidate', rows: [{ id: 'C1', mergeStatus: 'active', mergedIntoId: null }] },
      // 4: hh_owner-проверка для resumeMatchedIds=[C1] — owner совпадает
      { table: 'candidate_identity', rows: [{ candidateId: 'C1', valueNormalized: 'owner-42' }] },
    ]

    const res = await resolveCandidateBySignals('group-1', signals)
    expect(res.candidateId).toBe('C1')
    expect(res.matches.some(m => m.kind === 'hh_resume')).toBe(true)
  })

  it('hh_resume-матч ОТБРАСЫВАЕТСЯ если hh_owner во входящих ЕСТЬ, но не совпадает у кандидата', async () => {
    const signals: IdentitySignal[] = [
      { kind: 'hh_resume', valueNormalized: 'r1', source: 'hh', confidence: 'verified' },
      { kind: 'hh_owner', valueNormalized: 'owner-X', source: 'hh', confidence: 'verified' },
    ]
    fixtures = [
      // 1: select по kind=hh_owner — никого с owner-X нет
      { table: 'candidate_identity', rows: [] },
      // 2: select по kind=hh_resume — совпадение с C1
      { table: 'candidate_identity', rows: [{ candidateId: 'C1', kind: 'hh_resume', valueNormalized: 'r1' }] },
      // 3: select из candidate — статус active
      { table: 'candidate', rows: [{ id: 'C1', mergeStatus: 'active', mergedIntoId: null }] },
      // 4: hh_owner-проверка для C1 — у C1 owner=owner-Y, НЕ совпадает с owner-X
      { table: 'candidate_identity', rows: [{ candidateId: 'C1', valueNormalized: 'owner-Y' }] },
    ]

    const res = await resolveCandidateBySignals('group-1', signals)
    // hh_resume-матч отброшен, других сигналов с матчами нет → candidateId=null
    expect(res.candidateId).toBeNull()
  })

  it('hh_resume-матч ОСТАЁТСЯ если hh_owner во входящих НЕТ (беквард-совместимость)', async () => {
    const signals: IdentitySignal[] = [
      { kind: 'hh_resume', valueNormalized: 'r1', source: 'hh', confidence: 'verified' },
    ]
    fixtures = [
      // 1: select по kind=hh_resume — совпадение с C1
      { table: 'candidate_identity', rows: [{ candidateId: 'C1', kind: 'hh_resume', valueNormalized: 'r1' }] },
      // 2: select из candidate — статус active
      { table: 'candidate', rows: [{ id: 'C1', mergeStatus: 'active', mergedIntoId: null }] },
      // (нет шага hh_owner-проверки — incomingOwners.length === 0)
    ]

    const res = await resolveCandidateBySignals('group-1', signals)
    expect(res.candidateId).toBe('C1')
    expect(res.matches.some(m => m.kind === 'hh_resume')).toBe(true)
  })

  it('hh_owner имеет НАИБОЛЬШИЙ приоритет — сильнее phone/email', async () => {
    // Сигналы указывают на разных кандидатов: hh_owner→C_OWNER, email→C_EMAIL
    const signals: IdentitySignal[] = [
      { kind: 'email', valueNormalized: 'foo@bar.com', source: 'manual', confidence: 'claimed' },
      { kind: 'hh_owner', valueNormalized: 'owner-7', source: 'hh', confidence: 'verified' },
    ]
    fixtures = [
      // 1: select email → C_EMAIL
      { table: 'candidate_identity', rows: [{ candidateId: 'C_EMAIL', kind: 'email', valueNormalized: 'foo@bar.com' }] },
      // 2: select hh_owner → C_OWNER
      { table: 'candidate_identity', rows: [{ candidateId: 'C_OWNER', kind: 'hh_owner', valueNormalized: 'owner-7' }] },
      // 3: select candidate × 2 (оба active)
      { table: 'candidate', rows: [
        { id: 'C_EMAIL', mergeStatus: 'active', mergedIntoId: null },
        { id: 'C_OWNER', mergeStatus: 'active', mergedIntoId: null },
      ] },
    ]

    const res = await resolveCandidateBySignals('group-1', signals)
    expect(res.candidateId).toBe('C_OWNER') // hh_owner=100 > email=60
    expect(res.hasConflict).toBe(true)
  })

  it('hh_resume имеет НИЗКИЙ приоритет — phone сильнее hh_resume', async () => {
    const signals: IdentitySignal[] = [
      { kind: 'phone', valueNormalized: '+79990001122', source: 'manual', confidence: 'claimed' },
      { kind: 'hh_resume', valueNormalized: 'r1', source: 'hh', confidence: 'verified' },
    ]
    fixtures = [
      // 1: select phone → C_PHONE
      { table: 'candidate_identity', rows: [{ candidateId: 'C_PHONE', kind: 'phone', valueNormalized: '+79990001122' }] },
      // 2: select hh_resume → C_RESUME
      { table: 'candidate_identity', rows: [{ candidateId: 'C_RESUME', kind: 'hh_resume', valueNormalized: 'r1' }] },
      // 3: candidate fetch
      { table: 'candidate', rows: [
        { id: 'C_PHONE', mergeStatus: 'active', mergedIntoId: null },
        { id: 'C_RESUME', mergeStatus: 'active', mergedIntoId: null },
      ] },
    ]

    const res = await resolveCandidateBySignals('group-1', signals)
    expect(res.candidateId).toBe('C_PHONE') // phone=80 > hh_resume=40
    expect(res.hasConflict).toBe(true)
  })
})
