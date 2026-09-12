/**
 * ─────────────────────────────────────────────
 * Resource registry — single point of extension (RBAC v2, master plan §6)
 * ─────────────────────────────────────────────
 *
 * Declares every access-controlled resource once. From this registry we derive
 * (Sprint 1) the permission catalog seed, and (later sprints) the matrix UI,
 * scopedDb strategies, field masking, and matrix tests.
 *
 * Adding a new domain resource = one entry here (master plan crit. §1.1), not
 * edits in 20 places.
 *
 * Sprint 1 scope: `fields` (PII → required permission) and `scopeStrategy` are
 * declared but consumed only from Sprint 3 (scopedDb / masking). They are here
 * now so the catalog and future layers stay in sync.
 */

export type ScopeStrategy =
  | 'orgOnly' // filter by org only (no per-user narrowing)
  | 'byJobId' // resource has a jobId → scope by assigned/subtree jobs
  | 'byJob' // resource linked to a job via parent → scope by job
  | 'byOwner' // scope by creator (own)

export interface ResourceDef {
  /** DB table name (for scopedDb/masking wiring later). */
  table: string
  /** Standard CRUD-ish actions this resource supports (base permissions). */
  actions: readonly string[]
  /** Field → permission key required to expose it (PII masking, Sprint 3). */
  fields?: Record<string, string>
  /** Extra field-set read permissions this resource defines (e.g. contacts, salary). */
  fieldSets?: readonly string[]
  scopeStrategy: ScopeStrategy
  /** Column holding the creator id (for scope 'own'). */
  ownerField?: string
  /** true → resource is sensitive (surfaced in UI "sensitive operations"). */
  sensitive?: boolean
  category: string
}

/**
 * Registry. Resource keys here MUST match the resource segment used in
 * permission keys (`<resource>:<action>[:<fieldSet>]`) and the Better Auth
 * statement resource names in shared/permissions.ts (for shadow-mode parity).
 */
export const RESOURCES = {
  organization: {
    table: 'organization',
    actions: ['read', 'update', 'delete'],
    scopeStrategy: 'orgOnly',
    category: 'org',
  },
  // ── Platform resources managed by Better Auth's org plugin. Declared here so
  // the permission catalog contains member/invitation/team/ac keys that the
  // presets grant (parity with the default AC). scopeStrategy is org-only.
  member: {
    table: 'member',
    actions: ['create', 'update', 'delete'],
    scopeStrategy: 'orgOnly',
    category: 'members',
  },
  invitation: {
    table: 'invitation',
    actions: ['create', 'cancel'],
    scopeStrategy: 'orgOnly',
    category: 'members',
  },
  team: {
    table: 'gamification_team',
    actions: ['create', 'update', 'delete'],
    scopeStrategy: 'orgOnly',
    category: 'members',
  },
  ac: {
    table: 'role',
    actions: ['create', 'read', 'update', 'delete'],
    scopeStrategy: 'orgOnly',
    category: 'members',
  },
  job: {
    table: 'job',
    actions: ['create', 'read', 'update', 'delete'],
    scopeStrategy: 'byJobId',
    ownerField: 'createdBy',
    category: 'jobs',
  },
  candidate: {
    table: 'candidate',
    actions: ['create', 'read', 'update', 'delete'],
    fields: {
      phone: 'candidate:read:contacts',
      email: 'candidate:read:contacts',
      messengers: 'candidate:read:contacts',
      expectedSalary: 'candidate:read:salary',
    },
    fieldSets: ['contacts', 'salary'],
    scopeStrategy: 'byJob',
    ownerField: 'createdBy',
    category: 'candidates',
  },
  application: {
    table: 'application',
    actions: ['create', 'read', 'update', 'delete'],
    scopeStrategy: 'byJob',
    category: 'candidates',
  },
  document: {
    table: 'document',
    actions: ['create', 'read', 'update', 'delete'],
    scopeStrategy: 'byJob',
    sensitive: true,
    category: 'candidates',
  },
  comment: {
    table: 'application_comment',
    actions: ['create', 'read', 'update', 'delete'],
    scopeStrategy: 'byJob',
    ownerField: 'authorId',
    category: 'candidates',
  },
  interview: {
    table: 'interview',
    actions: ['create', 'read', 'update', 'delete'],
    scopeStrategy: 'byJob',
    category: 'interviews',
  },
  emailTemplate: {
    table: 'email_template',
    actions: ['create', 'read', 'update', 'delete'],
    scopeStrategy: 'orgOnly',
    category: 'templates',
  },
  activityLog: {
    table: 'activity_log',
    actions: ['read'],
    scopeStrategy: 'orgOnly',
    sensitive: true,
    category: 'audit',
  },
  scoring: {
    table: 'criterion_score',
    actions: ['create', 'read', 'update', 'delete'],
    scopeStrategy: 'byJob',
    category: 'ai',
  },
  sourceTracking: {
    table: 'tracking_link',
    actions: ['create', 'read', 'update', 'delete'],
    scopeStrategy: 'orgOnly',
    category: 'sourcing',
  },
  pipeline: {
    table: 'pipeline',
    actions: ['create', 'read', 'update', 'delete'],
    scopeStrategy: 'orgOnly',
    category: 'pipelines',
  },
  company: {
    table: 'company',
    actions: ['create', 'read', 'update', 'delete'],
    scopeStrategy: 'orgOnly',
    category: 'org-structure',
  },
  department: {
    table: 'department',
    actions: ['create', 'read', 'update', 'delete'],
    scopeStrategy: 'orgOnly',
    category: 'org-structure',
  },
} as const satisfies Record<string, ResourceDef>

export type ResourceKey = keyof typeof RESOURCES
