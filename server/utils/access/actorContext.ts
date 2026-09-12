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
import { member, user as userTable } from '../../database/schema/auth'
import { memberScope } from '../../database/schema/rbac'
import {
  type AccessScope,
  type AccessSnapshot,
  type Capability,
  type ScopeType,
} from '../../../shared/access/capabilities'
import {
  resolveMemberCapabilities,
  resolveMemberOverrides,
  applyOverrides,
} from './permissionResolver'
import { ensureMemberRbac } from './memberRbacSync'

// Executor shape accepted by ensureMemberRbac (db or tx).
type ExecutorLike = Parameters<typeof ensureMemberRbac>[0]

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
  /** Имя участника, от чьего лица идёт просмотр (для баннера). */
  viewAsName?: string | null
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
    case 'hrbp':
      return 'hrbp'
    case 'lead_recruiter':
      return 'org'
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

  const memberCols = {
    id: member.id,
    userId: member.userId,
    role: member.role,
    status: member.status,
    canViewSalary: member.hmCanViewSalary,
    mustChangePassword: member.mustChangePassword,
    revokedAt: member.revokedAt,
    permissionsVersion: member.permissionsVersion,
  }

  const [realRow] = await db
    .select(memberCols)
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, session.user.id)))
    .limit(1)

  if (!realRow) {
    ;(event.context as { actor?: ActorContext | null }).actor = null
    return null
  }

  // ── View-as (read-only impersonation, Sprint 5) ──
  // If a view_as cookie is set AND the real member is owner/admin, rebuild the
  // actor AS the target member with isViewAs=true. The cookie alone grants
  // nothing — we re-verify the real member's privilege here on every request.
  let row = realRow
  let isViewAs = false
  let viewAsName: string | null = null
  const viewAsMemberId = getCookie(event, 'access_view_as')
  if (viewAsMemberId && viewAsMemberId !== realRow.id
    && (realRow.role === 'owner' || realRow.role === 'admin')) {
    const [targetRow] = await db
      .select({ ...memberCols, userName: userTable.name })
      .from(member)
      .innerJoin(userTable, eq(userTable.id, member.userId))
      .where(and(eq(member.organizationId, orgId), eq(member.id, viewAsMemberId)))
      .limit(1)
    if (targetRow) {
      row = targetRow
      isViewAs = true
      viewAsName = targetRow.userName
    }
  }

  // ── Self-healing (Sprint 2): if the member has no member_role assignment yet
  // (created by an un-instrumented path, or pre-backfill), lazily project
  // member.role → member_role + member_scope. Best-effort, never blocks the
  // request. Effective perms below still resolve correctly via the role-key
  // fallback even if this no-ops (e.g. presets not seeded yet).
  let permissionsVersion = row.permissionsVersion
  try {
    const healed = await ensureMemberRbac(db as unknown as ExecutorLike, {
      memberId: row.id,
      organizationId: orgId,
      roleKey: row.role,
    })
    if (healed) {
      // Version was not bumped here (initial projection, not a change); the
      // per-request cache key uses the current version which is fine.
      void permissionsVersion
    }
  }
  catch { /* self-heal best-effort */ }

  const roleKeys = [row.role]

  // Effective permissions: member_role → role_permission (union), + per-member
  // overrides (deny wins). Falls back to role-key path / static map.
  const [baseCaps, overrides, scope] = await Promise.all([
    resolveMemberCapabilities(row.id, orgId, row.role, permissionsVersion),
    resolveMemberOverrides(row.id),
    resolveMemberScope(row.id, row.role),
  ])
  const permissions = applyOverrides(baseCaps, overrides)

  const actor: ActorContext = {
    // When impersonating, the actor IS the target member (userId/memberId of the
    // target) so scope resolves for them. isViewAs forces read-only in can().
    userId: row.userId,
    memberId: row.id,
    orgId,
    roleKeys,
    permissions,
    overrides,
    scope,
    limits: null,
    status: row.status,
    // revoked members are treated as inactive for access decisions
    isViewAs,
    viewAsName,
    canViewSalary: row.canViewSalary,
    mustChangePassword: row.mustChangePassword,
  }

  // Effective status: a revoked member is never active regardless of status text.
  if (row.revokedAt) {
    actor.status = 'revoked'
  }

  ;(event.context as { actor?: ActorContext | null }).actor = actor
  return actor
}

/** Read the member's scope from member_scope, falling back to the role default. */
async function resolveMemberScope(memberId: string, roleKey: string): Promise<AccessScope> {
  try {
    const [row] = await db
      .select({
        scopeType: memberScope.scopeType,
        departmentIds: memberScope.departmentIds,
        jobIds: memberScope.jobIds,
      })
      .from(memberScope)
      .where(eq(memberScope.memberId, memberId))
      .limit(1)
    if (row) {
      return {
        type: row.scopeType as ScopeType,
        departmentIds: row.departmentIds ?? [],
        jobIds: row.jobIds ?? [],
      }
    }
  }
  catch { /* pre-migration */ }
  return { type: defaultScopeTypeForRole(roleKey), departmentIds: [], jobIds: [] }
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
      viewAsName: actor.viewAsName ?? null,
    },
    status: actor.status,
  }
}
