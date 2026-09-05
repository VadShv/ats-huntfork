/**
 * ─────────────────────────────────────────────
 * Hiring Manager domain (Sprint 20.1)
 * ─────────────────────────────────────────────
 *
 * Two tables:
 *   • job_members     — вакансия ↔ пользователь (кто из HM/наблюдателей закреплён)
 *   • hm_decisions    — решения HM на канонической фазе `new`
 *
 * See docs/tz-hiring-manager-role-v1.md for the product spec.
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { relations } from 'drizzle-orm'
import { user, organization } from './auth'
import { job, application } from './app'

/**
 * Assignment of a user to a job with a specific member role.
 * Currently used for HM assignment; `member_role='hiring_manager'` is the
 * only path in v1. Future watcher/assignee roles reuse the same table.
 */
export const jobMember = pgTable(
  'job_member',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    jobId: text('job_id')
      .notNull()
      .references(() => job.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Values: 'hiring_manager' | 'recruiter' | 'watcher' | 'assignee'. Used: 'hiring_manager', 'recruiter'. */
    memberRole: text('member_role').notNull(),
    /**
     * Основной рекрутер вакансии. Только один recruiter на вакансию может быть
     * основным (partial unique index uq_job_member_primary_recruiter).
     * Статистика «вакансий в работе» считается по основному рекрутеру.
     */
    isPrimary: boolean('is_primary').notNull().default(false),
    addedByUserId: text('added_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    addedAt: timestamp('added_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ([
    uniqueIndex('uq_job_member_job_user_role').on(t.jobId, t.userId, t.memberRole),
    index('idx_job_member_user').on(t.userId),
    index('idx_job_member_job').on(t.jobId),
    index('idx_job_member_org').on(t.organizationId),
  ]),
)

/**
 * HM decision on a candidate application at the `new` stage.
 *
 * Model: first-decision-wins.
 * Only ONE effective (is_effective=true AND cancelled_at IS NULL) row per application
 * is allowed at any time — enforced by `ux_hm_decisions_effective_per_app`.
 *
 * Cancellation (24h window) sets cancelled_at + is_effective=false, freeing the slot.
 */
export const hmDecision = pgTable(
  'hm_decision',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    applicationId: text('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    jobId: text('job_id')
      .notNull()
      .references(() => job.id, { onDelete: 'cascade' }),
    hmUserId: text('hm_user_id')
      .notNull()
      .references(() => user.id),
    /** 'approved' | 'rejected' */
    decision: text('decision').notNull(),
    comment: text('comment'),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancelledByUserId: text('cancelled_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    cancelReason: text('cancel_reason'),
    /**
     * TRUE while the decision is the effective (winning) one for its application.
     * Flipped to FALSE on cancellation or on override by a recruiter (v2 feature).
     */
    isEffective: boolean('is_effective').notNull().default(true),
  },
  (t) => ([
    index('idx_hm_decision_application').on(t.applicationId),
    index('idx_hm_decision_hm_user').on(t.hmUserId, t.decidedAt),
    index('idx_hm_decision_org').on(t.organizationId),
    // ux_hm_decisions_effective_per_app is a PARTIAL unique index and is
    // declared in the SQL migration (0059) — Drizzle Kit generates
    // whole-column unique indexes only.
  ]),
)

export const jobMemberRelations = relations(jobMember, ({ one }) => ({
  organization: one(organization, { fields: [jobMember.organizationId], references: [organization.id] }),
  job: one(job, { fields: [jobMember.jobId], references: [job.id] }),
  user: one(user, { fields: [jobMember.userId], references: [user.id] }),
  addedBy: one(user, { fields: [jobMember.addedByUserId], references: [user.id] }),
}))

export const hmDecisionRelations = relations(hmDecision, ({ one }) => ({
  organization: one(organization, { fields: [hmDecision.organizationId], references: [organization.id] }),
  application: one(application, { fields: [hmDecision.applicationId], references: [application.id] }),
  job: one(job, { fields: [hmDecision.jobId], references: [job.id] }),
  hmUser: one(user, { fields: [hmDecision.hmUserId], references: [user.id] }),
  cancelledBy: one(user, { fields: [hmDecision.cancelledByUserId], references: [user.id] }),
}))
