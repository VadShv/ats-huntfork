/**
 * ─────────────────────────────────────────────
 * RBAC v2 — Roles / Permissions / Scopes / Overrides (Sprint 1)
 * ─────────────────────────────────────────────
 *
 * Data model for the DB-driven access control that replaces the static
 * Better Auth AC as the source of truth for permissions.
 * See docs/rbac-v2-master-plan.md §4 (data model) and §3 (why DB-driven).
 *
 * Tables:
 *   • permission                    — catalog of every permission key (seeded)
 *   • role                          — system presets (org_id NULL) + custom per-org
 *   • role_permission               — role ↔ permission (many-to-many)
 *   • role_permission_version       — versioned snapshots for diff/rollback/audit
 *   • member_role                   — member ↔ role (many-to-many; v2 assigns exactly one)
 *   • member_scope                  — data boundaries per member
 *   • member_permission_override    — per-user allow/deny (deny wins)
 *   • role_limit                    — per-role rate/volume limits (Sprint 8)
 *
 * NOTE: member.role (text) is kept as the denormalized "primary preset" for
 * back-compat and bootstrap; can() computes effective permissions from these
 * tables. member.role → member_role migration happens in Sprint 2.
 */

import {
  pgTable,
  text,
  boolean,
  integer,
  smallint,
  timestamp,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql, relations } from 'drizzle-orm'
import { organization, user, member } from './auth'

// ─── permission catalog ────────────────────────────────────────────
export const permission = pgTable('permission', {
  /** e.g. 'candidate:read:contacts' */
  key: text('key').primaryKey(),
  resource: text('resource').notNull(),
  action: text('action').notNull(),
  /** 'contacts' | 'salary' | NULL (base permission) */
  fieldSet: text('field_set'),
  /** maps to matrix UI level (0..4) */
  uiLevel: smallint('ui_level').notNull().default(0),
  /** 0 normal, 1 sensitive, 2 critical */
  riskLevel: smallint('risk_level').notNull().default(0),
  category: text('category').notNull().default('general'),
  labelRu: text('label_ru').notNull().default(''),
  labelEn: text('label_en').notNull().default(''),
  hintRu: text('hint_ru'),
  hintEn: text('hint_en'),
})

// ─── roles (system presets + custom per-org) ────────────────────────
export const role = pgTable('role', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  /** NULL = system preset (shared, not deletable) */
  organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
  /** stable key for system presets: owner|admin|lead_recruiter|recruiter|external_recruiter|hiring_manager */
  key: text('key'),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  isAssignable: boolean('is_assignable').notNull().default(true),
  /** org|departments|jobs|assigned|own */
  defaultScope: text('default_scope').notNull().default('assigned'),
  color: text('color'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ([
  index('role_org_idx').on(t.organizationId),
  // one name per org (NULLs allowed multiple by pg, system presets use a partial unique below in SQL)
  uniqueIndex('role_org_name_unique_idx').on(t.organizationId, t.name),
]))

// ─── role ↔ permission ──────────────────────────────────────────────
export const rolePermission = pgTable('role_permission', {
  roleId: text('role_id').notNull().references(() => role.id, { onDelete: 'cascade' }),
  permission: text('permission').notNull().references(() => permission.key),
}, (t) => ([
  primaryKey({ columns: [t.roleId, t.permission] }),
  index('role_permission_role_idx').on(t.roleId),
]))

// ─── versioned role permission snapshots ────────────────────────────
export const rolePermissionVersion = pgTable('role_permission_version', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  roleId: text('role_id').notNull().references(() => role.id, { onDelete: 'cascade' }),
  snapshot: jsonb('snapshot').$type<string[]>().notNull(),
  scopeSnapshot: jsonb('scope_snapshot').$type<Record<string, unknown>>(),
  changedBy: text('changed_by').references(() => user.id, { onDelete: 'set null' }),
  changeNote: text('change_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ([
  index('role_permission_version_role_idx').on(t.roleId),
]))

// ─── member ↔ role ──────────────────────────────────────────────────
export const memberRole = pgTable('member_role', {
  memberId: text('member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull().references(() => role.id),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  isPrimary: boolean('is_primary').notNull().default(true),
}, (t) => ([
  primaryKey({ columns: [t.memberId, t.roleId] }),
  index('member_role_member_idx').on(t.memberId),
  index('member_role_org_idx').on(t.organizationId),
]))

// ─── member scope ───────────────────────────────────────────────────
export const memberScope = pgTable('member_scope', {
  memberId: text('member_id').primaryKey().references(() => member.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /** org|departments|jobs|assigned|own */
  scopeType: text('scope_type').notNull().default('assigned'),
  /** root department ids (subtree expanded at query time) */
  departmentIds: text('department_ids').array().notNull().default(sql`'{}'::text[]`),
  jobIds: text('job_ids').array().notNull().default(sql`'{}'::text[]`),
  updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ([
  index('member_scope_org_idx').on(t.organizationId),
]))

// ─── per-user permission overrides (deny wins) ──────────────────────
export const memberPermissionOverride = pgTable('member_permission_override', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  memberId: text('member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  permission: text('permission').notNull().references(() => permission.key),
  /** 'allow' | 'deny' */
  effect: text('effect').notNull(),
  reason: text('reason'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ([
  uniqueIndex('member_permission_override_unique_idx').on(t.memberId, t.permission),
  index('member_permission_override_member_idx').on(t.memberId),
  index('member_permission_override_org_idx').on(t.organizationId),
]))

// ─── per-role limits (Sprint 8) ─────────────────────────────────────
export const roleLimit = pgTable('role_limit', {
  roleId: text('role_id').primaryKey().references(() => role.id, { onDelete: 'cascade' }),
  contactsPerDay: integer('contacts_per_day'),
  emailsPerDay: integer('emails_per_day'),
  exportRowsMax: integer('export_rows_max'),
  bulkActionMax: integer('bulk_action_max'),
})

// ─── relations ──────────────────────────────────────────────────────
export const roleRelations = relations(role, ({ many, one }) => ({
  permissions: many(rolePermission),
  organization: one(organization, { fields: [role.organizationId], references: [organization.id] }),
  limits: one(roleLimit, { fields: [role.id], references: [roleLimit.roleId] }),
}))

export const rolePermissionRelations = relations(rolePermission, ({ one }) => ({
  role: one(role, { fields: [rolePermission.roleId], references: [role.id] }),
  permission: one(permission, { fields: [rolePermission.permission], references: [permission.key] }),
}))

export const memberRoleRelations = relations(memberRole, ({ one }) => ({
  member: one(member, { fields: [memberRole.memberId], references: [member.id] }),
  role: one(role, { fields: [memberRole.roleId], references: [role.id] }),
}))

export const memberScopeRelations = relations(memberScope, ({ one }) => ({
  member: one(member, { fields: [memberScope.memberId], references: [member.id] }),
}))

export const memberPermissionOverrideRelations = relations(memberPermissionOverride, ({ one }) => ({
  member: one(member, { fields: [memberPermissionOverride.memberId], references: [member.id] }),
  permission: one(permission, { fields: [memberPermissionOverride.permission], references: [permission.key] }),
}))
