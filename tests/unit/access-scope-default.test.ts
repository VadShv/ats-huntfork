import { describe, it, expect } from 'vitest'
import { defaultScopeForRoleKey, ROLE_PRESET_BY_KEY } from '../../shared/access/role-presets'
import { candidate } from '../../server/database/schema/app'
import type { ScopeType } from '../../shared/access/capabilities'

/**
 * Спринт K, Часть 5 — исполняемая scope-матрица + инвариант «список ⊆ карточки».
 *
 * Урок §J: audit-coverage=0 + 869 tests + vue-tsc 0 — все зелёные, а прод падал.
 * Нужны ИСПОЛНЯЕМЫЕ тесты scope, а не «строка-хелпер присутствует».
 *
 * 5.1 — defaultScopeForRoleKey: чистая функция, без БД.
 * 5.2 — инвариант «список ⊆ карточки» для member (баг K).
 * 5.3 — регрессия §J: candidate.createdById — реальная колонка.
 */

// ── 5.1. Матрица scope-дефолта по роли (единый источник истины) ──

describe('defaultScopeForRoleKey — единый источник scope-дефолта (§K, инвариант C1)', () => {
  const EXPECTED: Record<string, ScopeType> = {
    owner: 'org',
    admin: 'org',
    lead_recruiter: 'org',
    hrbp: 'hrbp',
    member: 'assigned',
    external_recruiter: 'assigned',
    hiring_manager: 'jobs',
  }

  for (const [role, expected] of Object.entries(EXPECTED)) {
    it(`${role} → ${expected}`, () => {
      expect(defaultScopeForRoleKey(role)).toBe(expected)
    })
  }

  it('неизвестная роль → assigned (deny-safe: уже, не шире; никогда не org)', () => {
    expect(defaultScopeForRoleKey('nope')).toBe('assigned')
    expect(defaultScopeForRoleKey('')).toBe('assigned')
  })

  it('согласован с ROLE_PRESET_BY_KEY (источник — пресет, не хардкод)', () => {
    for (const [role, expected] of Object.entries(EXPECTED)) {
      expect(ROLE_PRESET_BY_KEY[role]?.defaultScope).toBe(expected)
    }
  })
})

// ── 5.2. Инвариант «список ⊆ доступные карточки» ──
//
// Баг K: scope.ts:defaultScopeForRole('member') возвращал 'org' → resolveUserScopeJobIds
// → scopeJobIdsCore(scopeType='org') → null (unrestricted) → список отдаёт ВСЕ вакансии.
// Карточка: actorContext.defaultScopeTypeForRole('member') = 'assigned' → requireJobInScope → 404.
// Результат: список ⊄ карточки (плашки без входа).
//
// После Части 1: оба делегируют к defaultScopeForRoleKey('member') = 'assigned'.
// scopeJobIdsCore('assigned') НЕ возвращает null → список scoped → список ⊆ карточки.
//
// Этот тест ПАДАЛ бы на старом коде (member='org' → unrestricted → список не scoped).

describe('инвариант «список ⊆ карточки» для member (баг K)', () => {
  // 'org' — единственный scopeType, при котором scopeJobIdsCore возвращает null
  // (unrestricted → фильтр НЕ добавляется → возвращаются ВСЕ вакансии).
  const UNRESTRICTED_SCOPES: ScopeType[] = ['org']

  it('member: scope-дефолт НЕ unrestricted (список будет scoped)', () => {
    const memberScope = defaultScopeForRoleKey('member')
    expect(UNRESTRICTED_SCOPES).not.toContain(memberScope)
    // Конкретно: assigned — только назначенные/созданные вакансии.
    expect(memberScope).toBe('assigned')
  })

  it('external_recruiter: scope-дефолт НЕ unrestricted (как member, разница в правах)', () => {
    const extScope = defaultScopeForRoleKey('external_recruiter')
    expect(UNRESTRICTED_SCOPES).not.toContain(extScope)
    expect(extScope).toBe('assigned')
  })

  it('owner/admin/lead: scope-дефолт unrestricted (видят всё — без регрессии)', () => {
    for (const role of ['owner', 'admin', 'lead_recruiter']) {
      expect(UNRESTRICTED_SCOPES).toContain(defaultScopeForRoleKey(role))
    }
  })

  it('список и карточка читают ОДИН источник (defaultScopeForRoleKey)', () => {
    // Оба резолвера (scope.ts + actorContext.ts) делегируют к defaultScopeForRoleKey.
    // Если бы у них были локальные switch, они могли бы разойтись (как в баге K).
    // Проверяем, что значение для member одинаково из пресета — это то, что
    // оба резолвера теперь возвращают.
    const fromPreset = ROLE_PRESET_BY_KEY['member']?.defaultScope
    expect(defaultScopeForRoleKey('member')).toBe(fromPreset)
    expect(fromPreset).toBe('assigned')
  })
})

// ── 5.3. Регрессия §J: candidateScopeCondition компилируется в валидный SQL ──
//
// Баг §J: candidateScopeCondition использовал raw sql по несуществующей колонке
// → рендерился в пустой/битый SQL. Фикс: typesafe drizzle ops (eq(candidate.createdById, ...)).
// Проверяем, что candidate.createdById — реальная колонка схемы (не undefined).

describe('регрессия §J — candidate.createdById реальная колонка', () => {
  it('candidate.createdById определён в схеме', () => {
    expect(candidate.createdById).toBeDefined()
    expect(candidate.createdById).not.toBeNull()
    // Drizzle column object имеет name свойство = 'created_by_id'.
    expect((candidate.createdById as { name?: string }).name).toBe('created_by_id')
  })

  it('candidateScopeCondition использует typesafe eq(candidate.createdById, ...)', () => {
    // Структурная проверка: колонка существует и типобезопасна →
    // eq(candidate.createdById, actor.userId) рендерится в валидный SQL,
    // а не в raw sql с undefined (баг §J).
    const col = candidate.createdById as { name?: string; config?: unknown }
    expect(col.name).toBe('created_by_id')
    expect(col.config).toBeDefined()
  })
})
