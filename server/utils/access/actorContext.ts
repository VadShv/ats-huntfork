/**
 * ─────────────────────────────────────────────
 * getActorContext — единый резолв контекста актора на запрос (RBAC v2, Sprint 0.5)
 * ─────────────────────────────────────────────
 *
 * ЕДИНАЯ точка резолва «кто это и что ему можно» на HTTP-запрос. Заменяет 5
 * разрозненных резолверов роли (getOrgRole / getMemberRole / getHmFlags / запрос
 * в requireHm / эндпоинт membership) — см. docs/audit-rbac.md §6.
 *
 * Структура ActorContext — СРАЗУ финальная (docs/rbac-v2-master-plan.md §5.1):
 * roleKeys / permissions / scope / overrides / limits / isViewAs. В Sprint 0.5
 * наполнение временное (из member.role + статических статементов роли). Спринты
 * 1-2 наполнят permissions/scope/overrides/limits из новых таблиц и can() БЕЗ
 * изменения этого интерфейса — потребители не переписываются.
 *
 * Результат кэшируется в event.context.actor на время запроса.
 */

import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { member } from '../../database/schema/auth'
import {
  expandRolesCapabilities,
  type AccessScope,
  type AccessSnapshot,
  type Capability,
  type ScopeType,
} from '../../../shared/access/capabilities'

export interface ActorContext {
  userId: string
  memberId: string
  orgId: string
  /** Ключи ролей (v2 — одна роль; массив заложен под union в v3). */
  roleKeys: string[]
  /** Развёрнутое объединение прав ролей (resource:action). */
  permissions: Set<Capability>
  /** Индивидуальные исключения (Спринт 1+; в 0.5 пусто). */
  overrides: Map<Capability, 'allow' | 'deny'>
  /** Границы данных. В 0.5 — дефолт по роли (реальный резолв — Спринт 1-3). */
  scope: AccessScope
  /** Лимиты роли (Спринт 8; в 0.5 — null). */
  limits: null
  status: string
  /** Режим «Посмотреть как» — форс read-only (Спринт 5; в 0.5 — false). */
  isViewAs: boolean
  // ── Обратная совместимость с текущими хелперами HM ──
  canViewSalary: boolean
  mustChangePassword: boolean
}

/** Дефолтный scope-тип по роли (временный маппинг Sprint 0.5). */
function defaultScopeTypeForRole(roleKey: string): ScopeType {
  switch (roleKey) {
    case 'owner':
    case 'admin':
      return 'org'
    case 'hiring_manager':
      return 'jobs'
    case 'member':
    default:
      return 'assigned'
  }
}

/**
 * Резолвит контекст актора для текущего запроса (кэш в event.context.actor).
 * Возвращает null, если нет сессии или нет активной организации.
 */
export async function getActorContext(event: H3Event): Promise<ActorContext | null> {
  // Кэш на время запроса — не гонять резолв в каждом под-запросе.
  const cached = (event.context as { actor?: ActorContext | null }).actor
  if (cached !== undefined) return cached

  const session = await auth.api.getSession({ headers: event.headers })
  const orgId = (session?.session as { activeOrganizationId?: string } | undefined)?.activeOrganizationId

  if (!session || !orgId) {
    ;(event.context as { actor?: ActorContext | null }).actor = null
    return null
  }

  const [row] = await db
    .select({
      id: member.id,
      role: member.role,
      status: member.status,
      canViewSalary: member.hmCanViewSalary,
      mustChangePassword: member.mustChangePassword,
    })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, session.user.id)))
    .limit(1)

  if (!row) {
    ;(event.context as { actor?: ActorContext | null }).actor = null
    return null
  }

  const roleKeys = [row.role]
  const actor: ActorContext = {
    userId: session.user.id,
    memberId: row.id,
    orgId,
    roleKeys,
    permissions: expandRolesCapabilities(roleKeys),
    overrides: new Map(),
    scope: { type: defaultScopeTypeForRole(row.role), departmentIds: [], jobIds: [] },
    limits: null,
    status: row.status,
    isViewAs: false,
    canViewSalary: row.canViewSalary,
    mustChangePassword: row.mustChangePassword,
  }

  ;(event.context as { actor?: ActorContext | null }).actor = actor
  return actor
}

/**
 * Проекция ActorContext в сериализуемый снапшот для клиента (SSR payload).
 * Формат — финальный (§8.7); источник в 0.5 — статические права роли.
 */
export function actorToSnapshot(actor: ActorContext | null): AccessSnapshot {
  if (!actor) {
    return {
      roleKeys: [],
      capabilities: [],
      scope: { type: 'own', departmentIds: [], jobIds: [] },
      flags: { canViewSalary: false, mustChangePassword: false, isViewAs: false },
      status: 'none',
    }
  }
  return {
    roleKeys: actor.roleKeys,
    capabilities: Array.from(actor.permissions),
    scope: actor.scope,
    flags: {
      canViewSalary: actor.canViewSalary,
      mustChangePassword: actor.mustChangePassword,
      isViewAs: actor.isViewAs,
    },
    status: actor.status,
  }
}
