# hh.ru Integration Extensions — Deep Technical Architecture

> **Based on:** `docs/hh-extensions-plan.md` (product) + `docs/hh-extensions-ui-plan.md` (UI)
> **Date:** 2025-09-15
> **Goal:** Exact schema, API routes, server utils, background jobs, data flows — grounded in real codebase patterns.

---

## 1. Existing Infrastructure (Code References)

### 1.1 hh.ru API Client (`server/utils/hh/client.ts`)

```typescript
// Core functions — all accept optional HhConfig (DB config wins, env fallback):
apiGet<T>(path, accessToken, query?, config?)         // GET → JSON
apiRequest<T>(method, path, accessToken, options?, config?) // POST/PUT/DELETE → { status, body }
getMe(accessToken, config?)                           // GET /me
exchangeCodeForTokens(code, config?)                  // OAuth code → tokens
refreshAccessToken(refreshToken, config?)             // Refresh expired token
getAuthorizationUrl(state, config?)                   // Build OAuth URL
```

- `effectiveConfig(config?)` — internal: passed config → env vars → null
- Errors: thrown `Error` with `.status` property (HTTP status code)
- Query params: arrays use repeated keys (`area=1&area=2`)

### 1.2 Config Resolver (`server/utils/hh/config.ts`)

```typescript
resolveHhConfig(orgId): Promise<HhConfig | null>    // DB → env → null
isHhConfiguredForOrg(orgId): Promise<boolean>
getHhConfigStatus(orgId): Promise<HhConfigStatus>   // for UI
saveHhConfig(orgId, input): Promise<{ clientIdMasked }>
deleteHhConfig(orgId): Promise<boolean>
```

- `HhConfig = { clientId, clientSecret, redirectUri, oauthBase, apiBase, userAgent }`
- Secret encrypted via AES-256-GCM (`encrypt()`/`decrypt()` from `server/utils/encryption.ts`)
- Key: `env.BETTER_AUTH_SECRET`

### 1.3 Token Manager (`server/utils/hh/tokens.ts`)

```typescript
getValidAccessToken(accountId): Promise<string>      // auto-refresh if expiring within 60s
upsertHhAccount(args): Promise<string>               // create/update hh_account row
getHhAccountForUser(orgId, userId): Promise<account | null>
disconnectHhAccount(orgId, userId): Promise<boolean>
```

- Tokens encrypted at rest in `hh_account` table
- `REFRESH_SKEW_SECONDS = 60` — refresh proactively
- On refresh failure: stores `lastError` on account, throws

### 1.4 Sync Engine (`server/utils/hh/sync.ts`)

```typescript
syncVacancyLink(linkId): Promise<SyncLinkResult>     // sync one hh_vacancy_link
syncAllActiveLinks(): Promise<SyncLinkResult[]>      // sync all active links
```

- `SyncLinkResult = { linkId, jobId, fetched, created, updated, failed, error? }`
- Fetches negotiations across **10 employer collections** (response, consider, phone_interview, assessment, interview, offer, hired, discard_by_employer, discard_visible_by_opponent, discard_after_interview)
- Per collection: paginated GET `/negotiations/{collection}?vacancy_id=...&page=N&per_page=50`
- Dedup by negotiation ID across collections
- For each new negotiation: fetch resume, dedup candidate via `candidate_identity`, create application, create `hh_negotiation` record
- Best-effort: one failed negotiation doesn't stop the sync
- Auto-scoring: fire-and-forget `autoScoreApplication()` for new applications

### 1.5 Webhook Pipeline (`server/utils/comms/hhWebhooks.ts`)

```
hh.ru → POST /api/webhooks/hh/{secret}     (public, 5s timeout)
  → validate secret against hh_account.webhook_secret
  → insert comms_channel_event (dedup by external_event_id, ON CONFLICT DO NOTHING)
  → enqueueHhWebhookEvent(eventRowId) → pg-boss HH_WEBHOOK_QUEUE
  → return 200 immediately

pg-boss worker (processHhWebhookJob):
  → CHAT_MESSAGE_CREATED → refreshHhConversation + maybeTriggerAutopilot
  → NEW_RESPONSE_OR_INVITATION_VACANCY → enqueueLinkSync (debounced 60s)
  → NEGOTIATION_EMPLOYER_STATE_CHANGE → enqueueLinkSync (debounced 60s)
```

- Debounce: `singletonKey + singletonSeconds=60` in pg-boss — шквал событий схлопывается
- Queues: `HH_WEBHOOK_QUEUE` (teamConcurrency=3), `HH_WEBHOOK_SYNC_QUEUE` (teamConcurrency=1)

### 1.6 Background Job System

**pg-boss** (`server/utils/queue/boss.ts`):
- Postgres-backed queue (no Redis), shares `DATABASE_URL`
- Singleton via `getBoss()`, lazy init
- Workers registered in `server/plugins/queue.ts` via `boss.work(queue, { teamSize, teamConcurrency }, handler)`
- Retry: `retryLimit`, `retryDelay`, `retryBackoff`

**Nitro scheduled tasks** (`nuxt.config.ts:270`):
```typescript
scheduledTasks: {
  '*/5 * * * *': ['hh:sync'],        // every 5 min: sync all active links
  '* * * * *':   ['hh:sourcing'],    // every 1 min: run due sourcing searches
  '0 3 * * 1':   ['rank:weekly'],    // Monday 03:00: weekly rank tick
}
```
- Tasks defined in `server/tasks/` via `defineTask({ meta, run })`

### 1.7 Permission System (`shared/permissions.ts`)

```typescript
// Resource → actions map (compile-time typed)
const atsStatements = {
  organization: ['read', 'update', 'delete'],
  job: ['create', 'read', 'update', 'delete'],
  candidate: ['create', 'read', 'update', 'delete'],
  application: ['create', 'read', 'update', 'delete'],
  comment: ['create', 'read', 'update', 'delete'],
  // ... 15 resources total
}

// Server gate:
const { user, session } = await requirePermission(event, { job: ['update'] })
// Client gate:
const { allowed } = usePermission({ job: ['update'] })
```

- 3 built-in roles: `owner` (everything), `admin` (full CRUD minus org delete), `member` (recruiter — create/read/update, no delete)
- `hiring_manager` — read-only everywhere
- RBAC v2: enforcement modes `old` / `shadow` / `new` via `env.ACCESS_ENFORCEMENT`

### 1.8 Existing hh.ru DB Tables

| Table | Purpose | Key fields |
|---|---|---|
| `hh_account` | Per-recruiter OAuth tokens | `userId`, encrypted tokens, `webhookSecret` |
| `hh_oauth_config` | Org-level OAuth app credentials | `clientId`, encrypted `clientSecret` |
| `hh_vacancy_link` | Job ↔ hh.ru vacancy link | `jobId`, `hhVacancyId`, `autoSyncEnabled` |
| `hh_negotiation` | Imported отклик | `hhNegotiationId`, `applicationId`, `hhCollection` |
| `hh_stage_mapping` | Pipeline stage → hh.ru collection | `pipelineStageId`, `hhCollection` |
| `hh_saved_search` | Cold search query | `query` (jsonb), `scheduleMinutes` |
| `hh_sourcing_candidate` | Sourced resume | `hhResumeId`, `snapshot`, `score` |
| `hh_action_log` | Audit log of push actions | `actionType`, `requestPayload` |

### 1.9 Key Conventions

- **IDs**: `text('id').primaryKey().$defaultFn(() => crypto.randomUUID())`
- **Multi-tenancy**: every table has `organizationId` with `ON DELETE CASCADE`
- **Timestamps**: `timestamp('created_at').notNull().defaultNow()`
- **JSONB**: `jsonb('field').$type<T>()` with TS generics
- **Migrations**: idempotent SQL (`IF NOT EXISTS`), numbered `NNNN_name.sql`, tracked in `_journal.json`
- **API errors**: `throw createError({ statusCode, statusMessage })`
- **Logging**: `logInfo('event.key', { ... })`, `logWarn`, `logError` (auto-imported)

---

## 2. Shared Infrastructure for New Integrations

### 2.1 Permission Extensions

**File:** `shared/permissions.ts`

Add new resources to `atsStatements`:

```typescript
const atsStatements = {
  // ... existing 15 resources ...
  hhTemplate: ['create', 'read', 'update', 'delete'],
  hhStats: ['read', 'refresh'],
  hhNegotiation: ['read', 'sync', 'import'],
  hhAutoRespond: ['read', 'create', 'update', 'delete'],
  hhBulkAction: ['execute'],
}
```

Grant matrix (add to role statement maps):

| Resource | owner | admin | member | hiring_manager |
|---|---|---|---|---|
| `hhTemplate` | CRUD | CRUD | CRU (no delete) | R |
| `hhStats` | read, refresh | read, refresh | read | read |
| `hhNegotiation` | read, sync, import | read, sync, import | read, sync, import | read |
| `hhAutoRespond` | CRUD | CRUD | read | read |
| `hhBulkAction` | execute | execute | execute | — |

### 2.2 Rate Limiter for hh.ru API

**New file:** `server/utils/hh/rateLimiter.ts`

```typescript
import pLimit from 'p-limit'

// hh.ru allows ~30 req/sec. We use 5 concurrent to be safe.
const defaultLimiter = pLimit(5)
const bulkLimiter = pLimit(3)  // more conservative for bulk ops

export async function withHhRateLimit<T>(
  fn: () => Promise<T>,
  mode: 'default' | 'bulk' = 'default',
): Promise<T> {
  const limiter = mode === 'bulk' ? bulkLimiter : defaultLimiter
  return limiter(fn)
}

// Retry with exponential backoff on 429
export async function withHhRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelayMs = 5000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = (err as Error & { status?: number }).status
      if (status !== 429 || attempt === maxRetries) throw err
      const delay = initialDelayMs * Math.pow(2, attempt)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('unreachable')
}
```

**Dependency:** `p-limit` — check if already in `package.json`; if not, add it.

### 2.3 Shared Error Types

**New file:** `server/utils/hh/errors.ts`

```typescript
export type HhErrorCode =
  | 'HH_NOT_CONFIGURED'
  | 'HH_NOT_CONNECTED'      // no hh_account for user
  | 'HH_TOKEN_EXPIRED'      // refresh failed
  | 'HH_RATE_LIMITED'       // 429
  | 'HH_API_ERROR'          // generic hh.ru API error
  | 'HH_PARTIAL_FAILURE'    // some items in batch failed
  | 'HH_VACANCY_NOT_LINKED' // job has no hh_vacancy_link
  | 'HH_NOT_FOUND'          // 404 from hh.ru

export class HhIntegrationError extends Error {
  code: HhErrorCode
  hhStatus?: number
  details?: unknown

  constructor(code: HhErrorCode, message: string, opts?: { hhStatus?: number, details?: unknown }) {
    super(message)
    this.code = code
    this.hhStatus = opts?.hhStatus
    this.details = opts?.details
  }

  toH3Error() {
    const statusMap: Record<HhErrorCode, number> = {
      HH_NOT_CONFIGURED: 503,
      HH_NOT_CONNECTED: 400,
      HH_TOKEN_EXPIRED: 401,
      HH_RATE_LIMITED: 429,
      HH_API_ERROR: 502,
      HH_PARTIAL_FAILURE: 207,
      HH_VACANCY_NOT_LINKED: 404,
      HH_NOT_FOUND: 404,
    }
    return createError({
      statusCode: statusMap[this.code],
      statusMessage: this.message,
      data: { code: this.code, details: this.details },
    })
  }
}
```

### 2.4 Helper: Get hh.ru Account + Token for Current User

**New file:** `server/utils/hh/session.ts`

```typescript
import { getHhAccountForUser, getValidAccessToken } from './tokens'
import { resolveHhConfig } from './config'
import type { HhConfig } from './config'
import { HhIntegrationError } from './errors'

export interface HhSession {
  accountId: string
  accessToken: string
  config: HhConfig
  organizationId: string
  userId: string
}

/**
 * Resolve the full hh.ru session for the current user:
 * config (DB/env) + account (OAuth tokens) + valid access token.
 * Throws HhIntegrationError if anything is missing.
 */
export async function getHhSession(orgId: string, userId: string): Promise<HhSession> {
  const config = await resolveHhConfig(orgId)
  if (!config) throw new HhIntegrationError('HH_NOT_CONFIGURED', 'hh.ru не настроен для организации')

  const account = await getHhAccountForUser(orgId, userId)
  if (!account || !account.isActive) throw new HhIntegrationError('HH_NOT_CONNECTED', 'hh.ru не подключён')

  let accessToken: string
  try {
    accessToken = await getValidAccessToken(account.id)
  } catch (err) {
    throw new HhIntegrationError('HH_TOKEN_EXPIRED', 'Не удалось обновить токен hh.ru')
  }

  return { accountId: account.id, accessToken, config, organizationId: orgId, userId }
}
```

---

## 3. [#3] Vacancy Templates — Technical Architecture

### 3.1 Schema

**File:** `server/database/schema/app.ts` (add after `hhActionLog` ~line 1794)

```typescript
export const hhVacancyTemplate = pgTable('hh_vacancy_template', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),

  name: text('name').notNull(),
  description: text('description'),

  // Full hh.ru /vacancies POST body (snapshot at creation time)
  vacancyData: jsonb('vacancy_data').notNull().$type<HhVacancyData>(),

  // Cached metadata for filtering/display
  hhAreaId: text('hh_area_id'),
  hhProfArea: text('hh_prof_area').array(),

  isShared: boolean('is_shared').notNull().default(true),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('hh_tpl_org_idx').on(t.organizationId),
  index('hh_tpl_org_shared_idx').on(t.organizationId, t.isShared),
])

export const hhVacancyTemplateRelations = relations(hhVacancyTemplate, ({ one }) => ({
  organization: one(organization, { fields: [hhVacancyTemplate.organizationId], references: [organization.id] }),
  createdBy: one(user, { fields: [hhVacancyTemplate.createdByUserId], references: [user.id] }),
}))
```

Type definition (in same file or `shared/hh-types.ts`):

```typescript
export interface HhVacancyData {
  name: string
  description: string
  area: { id: string }
  salary?: { from?: number, to?: number, currency?: string }
  employment_form?: { id: string }
  schedule?: { id: string }
  key_skills?: Array<{ name: string }>
  experience?: { id: string }
  type?: { id: string }
  // ... any other hh.ru /vacancies fields
}
```

### 3.2 Server API Routes

| File | Route | Gate | Body/Query |
|---|---|---|---|
| `server/api/hh/templates/index.get.ts` | `GET /api/hh/templates` | `hhTemplate: ['read']` | `?shared=true` |
| `server/api/hh/templates/index.post.ts` | `POST /api/hh/templates` | `hhTemplate: ['create']` | `{ name, description, vacancyData, isShared }` |
| `server/api/hh/templates/[id].put.ts` | `PUT /api/hh/templates/:id` | `hhTemplate: ['update']` | same as POST |
| `server/api/hh/templates/[id].delete.ts` | `DELETE /api/hh/templates/:id` | `hhTemplate: ['delete']` | — |
| `server/api/hh/templates/[id]/use.post.ts` | `POST /api/hh/templates/:id/use` | `job: ['create']` | `{ overrides?: Partial<HhVacancyData> }` |

**Example handler — `index.get.ts`:**

```typescript
export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { hhTemplate: ['read'] })
  const orgId = session.activeOrganizationId

  const templates = await db
    .select()
    .from(hhVacancyTemplate)
    .where(and(
      eq(hhVacancyTemplate.organizationId, orgId),
      // Show org-wide shared + own private templates
      or(
        eq(hhVacancyTemplate.isShared, true),
        eq(hhVacancyTemplate.createdByUserId, user.id),
      ),
    ))
    .orderBy(desc(hhVacancyTemplate.updatedAt))

  return templates
})
```

**Example handler — `[id]/use.post.ts`:**

```typescript
export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { job: ['create'] })
  const orgId = session.activeOrganizationId
  const templateId = getRouterParam(event, 'id')

  // 1. Load template
  const [tpl] = await db.select().from(hhVacancyTemplate)
    .where(and(eq(hhVacancyTemplate.id, templateId), eq(hhVacancyTemplate.organizationId, orgId)))
    .limit(1)
  if (!tpl) throw createError({ statusCode: 404, statusMessage: 'Шаблон не найден' })

  // 2. Merge overrides
  const body = await readBody(event)
  const vacancyBody = { ...tpl.vacancyData, ...(body.overrides ?? {}) }

  // 3. Get hh.ru session
  const hh = await getHhSession(orgId, user.id)

  // 4. Publish to hh.ru
  const result = await withHhRetry(() =>
    apiRequest<{ id: string, alternate_url: string }>('POST', '/vacancies', hh.accessToken, { body: vacancyBody }, hh.config)
  )

  // 5. Update template lastUsedAt
  await db.update(hhVacancyTemplate).set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(hhVacancyTemplate.id, templateId))

  // 6. Log action
  await db.insert(hhActionLog).values({
    organizationId: orgId, hhAccountId: hh.accountId,
    actionType: 'publish_from_template', performedByUserId: user.id,
    requestPayload: vacancyBody, responseStatus: result.status,
  })

  return { hhVacancyId: result.body?.id, url: result.body?.alternate_url }
})
```

### 3.3 Data Flow

```
POST /api/hh/templates/:id/use
  │
  ├─ load template from DB (vacancyData JSON)
  ├─ merge user overrides (title, salary, area...)
  ├─ getHhSession(orgId, userId)
  │   ├─ resolveHhConfig(orgId) → HhConfig
  │   ├─ getHhAccountForUser(orgId, userId) → account
  │   └─ getValidAccessToken(account.id) → token (auto-refresh)
  ├─ withHhRetry: apiRequest('POST', '/vacancies', token, { body }, config)
  ├─ update template.lastUsedAt
  ├─ insert hh_action_log (audit)
  └─ return { hhVacancyId, url }
```

### 3.4 Migration

**File:** `server/database/migrations/0107_hh_vacancy_templates.sql`

```sql
-- 0107: hh.ru vacancy templates — reusable vacancy drafts
CREATE TABLE IF NOT EXISTS "hh_vacancy_template" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "name" text NOT NULL,
  "description" text,
  "vacancy_data" jsonb NOT NULL,
  "hh_area_id" text,
  "hh_prof_area" text[],
  "is_shared" boolean NOT NULL DEFAULT true,
  "last_used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hh_tpl_org_idx" ON "hh_vacancy_template"("organization_id");
CREATE INDEX IF NOT EXISTS "hh_tpl_org_shared_idx" ON "hh_vacancy_template"("organization_id", "is_shared");
```

---

## 4. [#4] Auto-Respond — Technical Architecture

### 4.1 Schema Changes

**No new table.** Reuse existing `applicationComment` table + add hh.ru tracking columns.

**File:** `server/database/schema/app.ts` — modify `applicationComment` table:

```typescript
export const applicationComment = pgTable('application_comment', {
  // ... existing fields (id, organizationId, applicationId, authorUserId, text, createdAt, updatedAt) ...
  authorType: text('author_type').notNull().default('user'), // 'user' | 'hh_auto' | 'hh_recruiter'
  hhMessageId: text('hh_message_id'),           // hh.ru message UUID (for dedup)
  hhDirection: text('hh_direction'),             // 'outbound' | 'inbound'
  hhSyncStatus: text('hh_sync_status'),          // 'pending' | 'sent' | 'failed' | 'synced'
  hhSyncedAt: timestamp('hh_synced_at'),
  hhDeliveredAt: timestamp('hh_delivered_at'),
})
```

**New table for auto-respond rules:**

```typescript
export const hhAutoRespondRule = pgTable('hh_auto_respond_rule', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),

  name: text('name').notNull(),
  triggerCollection: text('trigger_collection').notNull(),  // e.g. 'response', 'consider'
  triggerDelayMinutes: integer('trigger_delay_minutes').notNull().default(0),

  // Condition: only trigger if negotiation matches these filters
  condition: jsonb('condition').$type<{
    areaIds?: string[]
    profAreaIds?: string[]
    salaryMin?: number
    resumeKeywords?: string[]
  }>(),

  // Action: send this message
  messageTemplate: text('message_template').notNull(),
  // Variables: {{candidateName}}, {{vacancyName}}, {{recruiterName}}

  isActive: boolean('is_active').notNull().default(true),
  priority: integer('priority').notNull().default(100),  // lower = higher priority

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('hh_ar_org_active_idx').on(t.organizationId, t.isActive),
])
```

### 4.2 Server Utils

**New file:** `server/utils/hh/autoRespond.ts`

```typescript
import type { HhSession } from './session'

/**
 * Evaluate auto-respond rules for a newly imported negotiation.
 * Called from sync.ts after creating an application.
 */
export async function evaluateAutoRespond(args: {
  orgId: string
  applicationId: string
  hhNegotiationId: string
  hhCollection: string
  resumeData?: HhResume
  vacancyData?: HhVacancy
}): Promise<{ triggered: boolean, ruleId?: string, messageId?: string }>

/**
 * Send a message to a candidate via hh.ru API.
 * POST /negotiations/{nid}/messages
 */
export async function sendHhMessage(args: {
  session: HhSession
  negotiationId: string
  messageText: string
}): Promise<{ hhMessageId: string }>

/**
 * Replace template variables: {{candidateName}}, {{vacancyName}}, etc.
 */
export function renderMessageTemplate(template: string, vars: {
  candidateName?: string
  vacancyName?: string
  recruiterName?: string
}): string

/**
 * Sync inbound messages from hh.ru → applicationComment.
 * Called from webhook handler on CHAT_MESSAGE_CREATED.
 */
export async function syncInboundMessages(args: {
  session: HhSession
  negotiationId: string
  applicationId: string
}): Promise<{ imported: number }>
```

### 4.3 Integration Points

**A. Trigger on new negotiation (sync.ts):**

In `syncVacancyLink()`, after creating a new application:

```typescript
// In sync.ts, after application creation:
if (link.autoRespondEnabled) {
  try {
    await evaluateAutoRespond({
      orgId: link.organizationId,
      applicationId: newApplication.id,
      hhNegotiationId: negotiation.id,
      hhCollection: collection,
      resumeData,
      vacancyData,
    })
  } catch (err) {
    logWarn('hh.autoRespond.failed', { negotiationId: negotiation.id, error: String(err) })
    // Non-fatal: sync continues even if auto-respond fails
  }
}
```

**B. Inbound message sync (hhWebhooks.ts):**

In `processHhWebhookJob()`, on `CHAT_MESSAGE_CREATED`:

```typescript
case 'CHAT_MESSAGE_CREATED': {
  // Existing: refreshHhConversation
  // NEW: also sync inbound messages to applicationComment
  const session = await getHhSession(orgId, userId)
  await syncInboundMessages({
    session,
    negotiationId: event.data.negotiation_id,
    applicationId: linkedApplication.id,
  })
  break
}
```

**C. Add `autoRespondEnabled` to `hhVacancyLink`:**

```typescript
// In hhVacancyLink table, add:
autoRespondEnabled: boolean('auto_respond_enabled').notNull().default(false),
```

### 4.4 Server API Routes

| File | Route | Gate |
|---|---|---|
| `server/api/hh/auto-respond/rules/index.get.ts` | `GET /api/hh/auto-respond/rules` | `hhAutoRespond: ['read']` |
| `server/api/hh/auto-respond/rules/index.post.ts` | `POST /api/hh/auto-respond/rules` | `hhAutoRespond: ['create']` |
| `server/api/hh/auto-respond/rules/[id].put.ts` | `PUT /api/hh/auto-respond/rules/:id` | `hhAutoRespond: ['update']` |
| `server/api/hh/auto-respond/rules/[id].delete.ts` | `DELETE /api/hh/auto-respond/rules/:id` | `hhAutoRespond: ['delete']` |
| `server/api/hh/auto-respond/test.post.ts` | `POST /api/hh/auto-respond/test` | `hhAutoRespond: ['read']` |

**Test endpoint** — dry-run rule evaluation against a sample negotiation without sending:

```typescript
// test.post.ts
export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { hhAutoRespond: ['read'] })
  const body = await readBody(event) // { ruleId, sampleNegotiationId }

  const [rule] = await db.select().from(hhAutoRespondRule)
    .where(and(eq(hhAutoRespondRule.id, body.ruleId), eq(hhAutoRespondRule.organizationId, session.activeOrganizationId)))
    .limit(1)

  const hh = await getHhSession(session.activeOrganizationId, user.id)
  const negotiation = await apiGet(`/negotiations/${body.sampleNegotiationId}`, hh.accessToken, {}, hh.config)

  // Evaluate condition without sending
  const matches = evaluateCondition(rule.condition, negotiation)
  const renderedMessage = renderMessageTemplate(rule.messageTemplate, {
    candidateName: negotiation.first_name,
    vacancyName: negotiation.vacancy.name,
  })

  return { wouldTrigger: matches, renderedMessage }
})
```

### 4.5 Data Flow

```
New negotiation imported (sync.ts)
  │
  ├─ link.autoRespondEnabled? → no: skip
  ├─ load active rules for org (sorted by priority)
  ├─ for each rule:
  │   ├─ rule.triggerCollection === negotiation.collection? → no: skip
  │   ├─ evaluateCondition(rule.condition, resumeData) → false: skip
  │   ├─ renderMessageTemplate(rule.messageTemplate, vars)
  │   ├─ if triggerDelayMinutes > 0:
  │   │   └─ enqueue delayed job (pg-boss, startAfter=delay)
  │   └─ else: sendHhMessage immediately
  │       ├─ POST /negotiations/{nid}/messages
  │       ├─ insert applicationComment (authorType='hh_auto', hhDirection='outbound', hhSyncStatus='sent')
  │       └─ return { hhMessageId }
  └─ log result
```

### 4.6 Migration

**File:** `server/database/migrations/0108_hh_auto_respond.sql`

```sql
-- 0108: auto-respond rules + application_comment hh.ru tracking columns

-- Add hh.ru tracking columns to application_comment
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "author_type" text NOT NULL DEFAULT 'user';
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "hh_message_id" text;
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "hh_direction" text;
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "hh_sync_status" text;
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "hh_synced_at" timestamp;
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "hh_delivered_at" timestamp;

-- Dedup index: one comment per hh.ru message
CREATE UNIQUE INDEX IF NOT EXISTS "app_comment_hh_msg_idx"
  ON "application_comment"("hh_message_id") WHERE "hh_message_id" IS NOT NULL;

-- Auto-respond rules table
CREATE TABLE IF NOT EXISTS "hh_auto_respond_rule" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "name" text NOT NULL,
  "trigger_collection" text NOT NULL,
  "trigger_delay_minutes" integer NOT NULL DEFAULT 0,
  "condition" jsonb,
  "message_template" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "priority" integer NOT NULL DEFAULT 100,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hh_ar_org_active_idx" ON "hh_auto_respond_rule"("organization_id", "is_active");

-- Add autoRespondEnabled to hh_vacancy_link
ALTER TABLE "hh_vacancy_link" ADD COLUMN IF NOT EXISTS "auto_respond_enabled" boolean NOT NULL DEFAULT false;
```

---

## 5. [#6] Cold Sourcing — Technical Architecture

### 5.1 Schema Changes

**Existing tables used:** `hhSavedSearch`, `hhSourcingCandidate`

**Add columns to `hhSavedSearch`:**

```typescript
// In hhSavedSearch table, add:
lastRunAt: timestamp('last_run_at'),
lastRunStats: jsonb('last_run_stats').$type<{ fetched: number, newCandidates: number, duplicates: number }>(),
isActive: boolean('is_active').notNull().default(true),
assignedToUserId: text('assigned_to_user_id').references(() => user.id, { onDelete: 'set null' }),
```

**Add columns to `hhSourcingCandidate`:**

```typescript
// In hhSourcingCandidate table, add:
sourcedFromSearchId: text('sourced_from_search_id').references(() => hhSavedSearch.id, { onDelete: 'set null' }),
relevanceScore: integer('relevance_score'),  // 0-100, from AI scoring
aiSummary: text('ai_summary'),                // AI-generated candidate summary
contactedAt: timestamp('contacted_at'),       // when recruiter reached out
contactStatus: text('contact_status'),        // 'new' | 'contacted' | 'responded' | 'rejected'
```

### 5.2 Server Utils

**New file:** `server/utils/hh/sourcing.ts` (extends existing `server/tasks/hh/sourcing.ts` logic)

```typescript
/**
 * Execute a saved search: query hh.ru /resumes, dedup, store results.
 * Called by Nitro scheduled task + manual trigger.
 */
export async function executeSavedSearch(args: {
  searchId: string
  orgId: string
  userId: string  // whose hh.ru account to use
}): Promise<SearchRunResult>

/**
 * Query hh.ru resume search API.
 * GET /resumes?text=...&area=...&period=...&page=N&per_page=50
 */
export async function searchResumes(args: {
  session: HhSession
  query: HhResumeSearchParams
}): Promise<{ items: HhResume[], pages: number, found: number }>

/**
 * Check if a resume was already sourced (dedup by hhResumeId + orgId).
 */
export async function isResumeAlreadySourced(orgId: string, hhResumeId: string): Promise<boolean>

/**
 * Score a sourced candidate using AI (best-effort, non-blocking).
 */
export async function scoreSourcedCandidate(candidateId: string): Promise<void>

export interface SearchRunResult {
  searchId: string
  fetched: number
  newCandidates: number
  duplicates: number
  errors: string[]
}
```

### 5.3 Nitro Scheduled Task

**File:** `server/tasks/hh/sourcing.ts` (modify existing)

```typescript
export default defineTask({
  meta: { name: 'hh:sourcing', description: 'Run due hh.ru saved searches' },
  async run() {
    // Find all active saved searches that are due
    const dueSearches = await db
      .select()
      .from(hhSavedSearch)
      .where(and(
        eq(hhSavedSearch.isActive, true),
        or(
          isNull(hhSavedSearch.lastRunAt),
          sql`${hhSavedSearch.lastRunAt} + (${hhSavedSearch.scheduleMinutes} || ' minutes')::interval <= now()`,
        ),
      ))
      .limit(10)  // max 10 per tick to avoid overload

    for (const search of dueSearches) {
      try {
        // Find a connected hh.ru account for this org
        const account = await getPrimaryHhAccount(search.organizationId)
        if (!account) {
          logWarn('hh.sourcing.noAccount', { searchId: search.id })
          continue
        }

        const result = await executeSavedSearch({
          searchId: search.id,
          orgId: search.organizationId,
          userId: account.userId,
        })

        // Update last run stats
        await db.update(hhSavedSearch).set({
          lastRunAt: new Date(),
          lastRunStats: { fetched: result.fetched, newCandidates: result.newCandidates, duplicates: result.duplicates },
          updatedAt: new Date(),
        }).where(eq(hhSavedSearch.id, search.id))

        logInfo('hh.sourcing.completed', { searchId: search.id, ...result })
      } catch (err) {
        logError('hh.sourcing.failed', { searchId: search.id, error: String(err) })
      }
    }

    return { result: `Processed ${dueSearches.length} searches` }
  },
})
```

### 5.4 Server API Routes

| File | Route | Gate |
|---|---|---|
| `server/api/hh/saved-searches/index.get.ts` | `GET /api/hh/saved-searches` | `hhSavedSearch: ['read']` |
| `server/api/hh/saved-searches/index.post.ts` | `POST /api/hh/saved-searches` | `hhSavedSearch: ['create']` |
| `server/api/hh/saved-searches/[id].put.ts` | `PUT /api/hh/saved-searches/:id` | `hhSavedSearch: ['update']` |
| `server/api/hh/saved-searches/[id].delete.ts` | `DELETE /api/hh/saved-searches/:id` | `hhSavedSearch: ['delete']` |
| `server/api/hh/saved-searches/[id]/run.post.ts` | `POST /api/hh/saved-searches/:id/run` | `hhSavedSearch: ['update']` |
| `server/api/hh/sourcing/candidates/index.get.ts` | `GET /api/hh/sourcing/candidates` | `hhSavedSearch: ['read']` |
| `server/api/hh/sourcing/candidates/[id]/convert.post.ts` | `POST /api/hh/sourcing/candidates/:id/convert` | `candidate: ['create']` |

**Manual run endpoint:**

```typescript
// [id]/run.post.ts
export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { hhSavedSearch: ['update'] })
  const searchId = getRouterParam(event, 'id')

  // Enqueue as pg-boss job (don't block the request)
  const boss = await getBoss()
  const jobId = await boss.send('hh-sourcing-run', { searchId, orgId: session.activeOrganizationId, userId: user.id })

  return { jobId, message: 'Поиск запущен' }
})
```

**Convert sourced candidate to full candidate:**

```typescript
// [id]/convert.post.ts
export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { candidate: ['create'] })
  const candidateId = getRouterParam(event, 'id')

  // 1. Load sourced candidate snapshot
  const [sourced] = await db.select().from(hhSourcingCandidate)
    .where(and(eq(hhSourcingCandidate.id, candidateId), eq(hhSourcingCandidate.organizationId, session.activeOrganizationId)))
    .limit(1)
  if (!sourced) throw createError({ statusCode: 404 })

  // 2. Create full candidate from snapshot
  const [candidate] = await db.insert(candidate2).values({
    organizationId: session.activeOrganizationId,
    firstName: sourced.snapshot.first_name,
    lastName: sourced.snapshot.last_name,
    // ... map fields from snapshot
  }).returning()

  // 3. Mark as converted
  await db.update(hhSourcingCandidate).set({ contactStatus: 'contacted', contactedAt: new Date() })
    .where(eq(hhSourcingCandidate.id, candidateId))

  return candidate
})
```

### 5.5 Data Flow

```
Nitro task hh:sourcing (every 1 min)
  │
  ├─ find due active saved searches (lastRunAt + scheduleMinutes <= now())
  ├─ for each search (max 10/tick):
  │   ├─ getPrimaryHhAccount(orgId) → account
  │   ├─ getHhSession(orgId, account.userId) → session
  │   ├─ searchResumes(session, search.query)
  │   │   ├─ GET /resumes?text=...&area=...&page=N (paginated)
  │   │   └─ collect all items across pages
  │   ├─ for each resume:
  │   │   ├─ isResumeAlreadySourced(orgId, resume.id)?
  │   │   │   └─ yes: skip (increment duplicates)
  │   │   └─ insert hh_sourcing_candidate (snapshot, searchId)
  │   │       └─ fire-and-forget: scoreSourcedCandidate(id) → AI scoring
  │   ├─ update hh_saved_search.lastRunAt + lastRunStats
  │   └─ log result
  └─ return summary
```

### 5.6 Migration

**File:** `server/database/migrations/0109_hh_sourcing_enhancements.sql`

```sql
-- 0109: cold sourcing enhancements

-- Add scheduling columns to hh_saved_search
ALTER TABLE "hh_saved_search" ADD COLUMN IF NOT EXISTS "last_run_at" timestamp;
ALTER TABLE "hh_saved_search" ADD COLUMN IF NOT EXISTS "last_run_stats" jsonb;
ALTER TABLE "hh_saved_search" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
ALTER TABLE "hh_saved_search" ADD COLUMN IF NOT EXISTS "assigned_to_user_id" text REFERENCES "user"("id") ON DELETE set null;

-- Add sourcing tracking columns to hh_sourcing_candidate
ALTER TABLE "hh_sourcing_candidate" ADD COLUMN IF NOT EXISTS "sourced_from_search_id" text REFERENCES "hh_saved_search"("id") ON DELETE set null;
ALTER TABLE "hh_sourcing_candidate" ADD COLUMN IF NOT EXISTS "relevance_score" integer;
ALTER TABLE "hh_sourcing_candidate" ADD COLUMN IF NOT EXISTS "ai_summary" text;
ALTER TABLE "hh_sourcing_candidate" ADD COLUMN IF NOT EXISTS "contacted_at" timestamp;
ALTER TABLE "hh_sourcing_candidate" ADD COLUMN IF NOT EXISTS "contact_status" text;

CREATE INDEX IF NOT EXISTS "hh_sc_search_idx" ON "hh_sourcing_candidate"("sourced_from_search_id");
```

---

## 6. [#7] Bulk Actions — Technical Architecture

### 6.1 Schema

**New table:** `hhBulkAction` (batch tracking)

```typescript
export const hhBulkAction = pgTable('hh_bulk_action', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  initiatedByUserId: text('initiated_by_user_id').references(() => user.id, { onDelete: 'set null' }),

  actionType: text('action_type').notNull(),  // 'invite' | 'discard' | 'move_collection' | 'send_message'
  targetType: text('target_type').notNull(),   // 'negotiation' | 'sourcing_candidate'

  // Filter: which items to act on (either explicit IDs or filter criteria)
  itemIds: text('item_ids').array(),
  filter: jsonb('filter').$type<BulkActionFilter>(),

  // Action parameters
  params: jsonb('params').$type<{
    collection?: string       // for move_collection
    messageText?: string      // for send_message
  }>(),

  // Progress tracking
  status: text('status').notNull().default('pending'),  // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  totalItems: integer('total_items').notNull().default(0),
  processedItems: integer('processed_items').notNull().default(0),
  succeededItems: integer('succeeded_items').notNull().default(0),
  failedItems: integer('failed_items').notNull().default(0),

  // Results detail (per-item status)
  results: jsonb('results').$type<Array<{ itemId: string, status: 'success' | 'failed', error?: string }>>(),

  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('hh_ba_org_status_idx').on(t.organizationId, t.status),
])

export interface BulkActionFilter {
  vacancyId?: string
  collections?: string[]
  areaIds?: string[]
  dateFrom?: string
  dateTo?: string
}
```

### 6.2 Server Utils

**New file:** `server/utils/hh/bulkActions.ts`

```typescript
/**
 * Resolve filter → list of negotiation IDs.
 * Used when user provides a filter instead of explicit IDs.
 */
export async function resolveBulkTargets(args: {
  orgId: string
  filter: BulkActionFilter
}): Promise<string[]>

/**
 * Execute a single bulk action item.
 * Returns success/failure for one negotiation.
 */
export async function executeBulkItem(args: {
  session: HhSession
  actionType: string
  targetType: string
  itemId: string
  params: Record<string, unknown>
}): Promise<{ success: boolean, error?: string }>

/**
 * Main batch processor — called by pg-boss worker.
 * Processes items sequentially with rate limiting.
 */
export async function processBulkAction(bulkActionId: string): Promise<void>
```

**`processBulkAction` implementation:**

```typescript
export async function processBulkAction(bulkActionId: string): Promise<void> {
  const [action] = await db.select().from(hhBulkAction).where(eq(hhBulkAction.id, bulkActionId)).limit(1)
  if (!action || action.status !== 'pending') return

  // Mark as running
  await db.update(hhBulkAction).set({ status: 'running', startedAt: new Date() })
    .where(eq(hhBulkAction.id, bulkActionId))

  const hh = await getHhSession(action.organizationId, action.initiatedByUserId)

  // Resolve targets
  let itemIds = action.itemIds ?? []
  if (itemIds.length === 0 && action.filter) {
    itemIds = await resolveBulkTargets({ orgId: action.organizationId, filter: action.filter })
  }

  await db.update(hhBulkAction).set({ totalItems: itemIds.length }).where(eq(hhBulkAction.id, bulkActionId))

  const results: Array<{ itemId: string, status: 'success' | 'failed', error?: string }> = []

  for (const itemId of itemIds) {
    try {
      const result = await withHhRateLimit(() =>
        withHhRetry(() => executeBulkItem({
          session: hh,
          actionType: action.actionType,
          targetType: action.targetType,
          itemId,
          params: action.params ?? {},
        })),
        'bulk',
      )

      results.push({ itemId, status: result.success ? 'success' : 'failed', error: result.error })

      const inc = result.success
        ? { processedItems: 1, succeededItems: 1 }
        : { processedItems: 1, failedItems: 1 }

      await db.update(hhBulkAction).set({
        processedItems: sql`processed_items + 1`,
        succeededItems: result.success ? sql`succeeded_items + 1` : sql`succeeded_items`,
        failedItems: result.success ? sql`failed_items` : sql`failed_items + 1`,
      }).where(eq(hhBulkAction.id, bulkActionId))
    } catch (err) {
      results.push({ itemId, status: 'failed', error: String(err) })
      await db.update(hhBulkAction).set({
        processedItems: sql`processed_items + 1`,
        failedItems: sql`failed_items + 1`,
      }).where(eq(hhBulkAction.id, bulkActionId))
    }
  }

  // Mark complete
  await db.update(hhBulkAction).set({
    status: 'completed',
    completedAt: new Date(),
    results,
  }).where(eq(hhBulkAction.id, bulkActionId))
}
```

### 6.3 pg-boss Worker Registration

**File:** `server/plugins/queue.ts` (add to existing workers)

```typescript
// Bulk action processor
await boss.work('hh-bulk-action', { teamSize: 5, teamConcurrency: 2 }, async (job) => {
  await processBulkAction(job.data.bulkActionId)
})
```

### 6.4 Server API Routes

| File | Route | Gate |
|---|---|---|
| `server/api/hh/bulk-actions/index.post.ts` | `POST /api/hh/bulk-actions` | `hhBulkAction: ['execute']` |
| `server/api/hh/bulk-actions/index.get.ts` | `GET /api/hh/bulk-actions` | `hhBulkAction: ['execute']` |
| `server/api/hh/bulk-actions/[id].get.ts` | `GET /api/hh/bulk-actions/:id` | `hhBulkAction: ['execute']` |
| `server/api/hh/bulk-actions/[id]/cancel.post.ts` | `POST /api/hh/bulk-actions/:id/cancel` | `hhBulkAction: ['execute']` |

**Create handler:**

```typescript
// index.post.ts
export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { hhBulkAction: ['execute'] })
  const body = await readBody(event) // { actionType, targetType, itemIds?, filter?, params? }

  // Create record
  const [action] = await db.insert(hhBulkAction).values({
    organizationId: session.activeOrganizationId,
    initiatedByUserId: user.id,
    actionType: body.actionType,
    targetType: body.targetType,
    itemIds: body.itemIds,
    filter: body.filter,
    params: body.params,
    status: 'pending',
  }).returning()

  // Enqueue
  const boss = await getBoss()
  await boss.send('hh-bulk-action', { bulkActionId: action.id }, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
  })

  return action
})
```

### 6.5 Data Flow

```
POST /api/hh/bulk-actions
  ├─ validate body (actionType, targetType, itemIds or filter)
  ├─ insert hh_bulk_action (status='pending')
  ├─ boss.send('hh-bulk-action', { bulkActionId })
  └─ return action (client polls GET /api/hh/bulk-actions/:id)

pg-boss worker 'hh-bulk-action':
  ├─ load action (status must be 'pending')
  ├─ set status='running'
  ├─ resolve targets (explicit IDs or filter → query)
  ├─ getHhSession(orgId, userId)
  ├─ for each itemId:
  │   ├─ withHhRateLimit(bulk): withHhRetry: executeBulkItem()
  │   │   ├─ invite: POST /negotiations/{nid}/actions { action: 'invite' }
  │   │   ├─ discard: POST /negotiations/{nid}/actions { action: 'discard' }
  │   │   ├─ move_collection: PUT /negotiations/{nid} { collection: '...' }
  │   │   └─ send_message: POST /negotiations/{nid}/messages { text: '...' }
  │   ├─ update progress counters (incremental)
  │   └─ push result to results array
  ├─ set status='completed', results=[...]
  └─ log summary
```

### 6.6 Migration

**File:** `server/database/migrations/0110_hh_bulk_actions.sql`

```sql
-- 0110: bulk action tracking
CREATE TABLE IF NOT EXISTS "hh_bulk_action" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "initiated_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "action_type" text NOT NULL,
  "target_type" text NOT NULL,
  "item_ids" text[],
  "filter" jsonb,
  "params" jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "total_items" integer NOT NULL DEFAULT 0,
  "processed_items" integer NOT NULL DEFAULT 0,
  "succeeded_items" integer NOT NULL DEFAULT 0,
  "failed_items" integer NOT NULL DEFAULT 0,
  "results" jsonb,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hh_ba_org_status_idx" ON "hh_bulk_action"("organization_id", "status");
```

---

## 7. [#8] Coverage Dashboard — Technical Architecture

### 7.1 Core Concept

Flag отклики that exist on hh.ru but are **NOT** imported into Huntfork. This requires comparing:
- **hh.ru side:** all negotiations for a linked vacancy (fetched live or from last sync)
- **Huntfork side:** `hh_negotiation` records for that vacancy link

### 7.2 Schema

**New table:** `hhCoverageGap` (cached gap detection results)

```typescript
export const hhCoverageGap = pgTable('hh_coverage_gap', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),

  vacancyLinkId: text('vacancy_link_id').notNull().references(() => hhVacancyLink.id, { onDelete: 'cascade' }),
  hhNegotiationId: text('hh_negotiation_id').notNull(),

  // Why it's a gap
  gapReason: text('gap_reason').notNull(),  // 'not_imported' | 'imported_no_application' | 'orphaned'
  hhCollection: text('hh_collection'),
  hhCandidateName: text('hh_candidate_name'),
  hhCreatedAt: timestamp('hh_created_at'),

  detectedAt: timestamp('detected_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),  // set when gap is resolved (imported)
}, (t) => [
  index('hh_cg_link_idx').on(t.vacancyLinkId),
  index('hh_cg_org_unresolved_idx').on(t.organizationId, t.resolvedAt),  // WHERE resolved_at IS NULL
])
```

### 7.3 Server Utils

**New file:** `server/utils/hh/coverage.ts`

```typescript
/**
 * Detect coverage gaps for a single vacancy link.
 * Compares hh.ru negotiations vs. imported hh_negotiation records.
 */
export async function detectCoverageGaps(args: {
  session: HhSession
  vacancyLinkId: string
}): Promise<{ gaps: CoverageGap[], totalOnHh: number, totalImported: number }>

/**
 * Detect gaps for all active vacancy links in an org.
 * Called by Nitro scheduled task.
 */
export async function detectAllCoverageGaps(orgId: string): Promise<void>

/**
 * Import a specific gap — pull the missing negotiation from hh.ru.
 */
export async function importGap(gapId: string): Promise<{ applicationId: string }>

export interface CoverageGap {
  hhNegotiationId: string
  gapReason: 'not_imported' | 'imported_no_application' | 'orphaned'
  hhCollection: string
  hhCandidateName: string
  hhCreatedAt: Date
}
```

**`detectCoverageGaps` implementation:**

```typescript
export async function detectCoverageGaps(args: {
  session: HhSession
  vacancyLinkId: string
}): Promise<{ gaps: CoverageGap[], totalOnHh: number, totalImported: number }> {
  const [link] = await db.select().from(hhVacancyLink)
    .where(eq(hhVacancyLink.id, args.vacancyLinkId)).limit(1)

  // 1. Fetch ALL negotiations from hh.ru for this vacancy
  const allHhNegotiations: HhNegotiation[] = []
  const collections = ['response', 'consider', 'phone_interview', 'assessment',
    'interview', 'offer', 'hired', 'discard_by_employer', 'discard_visible_by_opponent']

  for (const collection of collections) {
    let page = 0
    let hasMore = true
    while (hasMore) {
      const result = await withHhRetry(() =>
        apiGet<{ items: HhNegotiation[], pages: number }>(
          `/negotiations/${collection}`,
          args.session.accessToken,
          { vacancy_id: link.hhVacancyId, page, per_page: 50 },
          args.session.config,
        ),
      )
      allHhNegotiations.push(...result.items)
      hasMore = page < result.pages - 1
      page++
    }
  }

  // 2. Get all imported negotiations from DB
  const imported = await db.select().from(hhNegotiation)
    .where(eq(hhNegotiation.vacancyLinkId, args.vacancyLinkId))
  const importedIds = new Set(imported.map(n => n.hhNegotiationId))

  // 3. Find gaps: on hh.ru but not in DB
  const gaps: CoverageGap[] = []
  for (const hhNego of allHhNegotiations) {
    if (!importedIds.has(hhNego.id)) {
      gaps.push({
        hhNegotiationId: hhNego.id,
        gapReason: 'not_imported',
        hhCollection: hhNego.collection,
        hhCandidateName: `${hhNego.first_name} ${hhNego.last_name}`,
        hhCreatedAt: new Date(hhNego.created_at),
      })
    }
  }

  // 4. Upsert gaps into DB (mark resolved ones)
  await upsertGaps(args.session.organizationId, args.vacancyLinkId, gaps)

  return { gaps, totalOnHh: allHhNegotiations.length, totalImported: imported.length }
}
```

### 7.4 Nitro Scheduled Task

**File:** `server/tasks/hh/coverage.ts` (new)

```typescript
export default defineTask({
  meta: { name: 'hh:coverage', description: 'Detect hh.ru coverage gaps' },
  async run() {
    // Find orgs with active vacancy links
    const orgIds = await db.selectDistinct({ orgId: hhVacancyLink.organizationId })
      .from(hhVacancyLink)
      .where(eq(hhVacancyLink.autoSyncEnabled, true))

    for (const { orgId } of orgIds) {
      try {
        const account = await getPrimaryHhAccount(orgId)
        if (!account) continue
        await detectAllCoverageGaps(orgId)
      } catch (err) {
        logError('hh.coverage.failed', { orgId, error: String(err) })
      }
    }

    return { result: `Checked ${orgIds.length} orgs` }
  },
})
```

**Register in `nuxt.config.ts`:**

```typescript
scheduledTasks: {
  '*/5 * * * *': ['hh:sync'],
  '* * * * *':   ['hh:sourcing'],
  '*/15 * * * *': ['hh:coverage'],  // NEW: every 15 min
  '0 3 * * 1':   ['rank:weekly'],
}
```

### 7.5 Server API Routes

| File | Route | Gate |
|---|---|---|
| `server/api/hh/coverage/gaps.get.ts` | `GET /api/hh/coverage/gaps` | `hhStats: ['read']` |
| `server/api/hh/coverage/summary.get.ts` | `GET /api/hh/coverage/summary` | `hhStats: ['read']` |
| `server/api/hh/coverage/gaps/[id]/import.post.ts` | `POST /api/hh/coverage/gaps/:id/import` | `hhNegotiation: ['import']` |
| `server/api/hh/coverage/scan.post.ts` | `POST /api/hh/coverage/scan` | `hhStats: ['refresh']` |

**Summary endpoint:**

```typescript
// summary.get.ts
export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, { hhStats: ['read'] })
  const orgId = session.activeOrganizationId

  // Aggregate gaps per vacancy
  const gaps = await db
    .select({
      vacancyLinkId: hhCoverageGap.vacancyLinkId,
      vacancyName: job.title,
      gapCount: sql<number>`count(*)::int`,
      oldestGap: sql<Date>`min(${hhCoverageGap.detectedAt})`,
    })
    .from(hhCoverageGap)
    .innerJoin(hhVacancyLink, eq(hhCoverageGap.vacancyLinkId, hhVacancyLink.id))
    .innerJoin(job, eq(hhVacancyLink.jobId, job.id))
    .where(and(
      eq(hhCoverageGap.organizationId, orgId),
      isNull(hhCoverageGap.resolvedAt),  // only unresolved
    ))
    .groupBy(hhCoverageGap.vacancyLinkId, job.title)

  const totalGaps = gaps.reduce((sum, g) => sum + g.gapCount, 0)

  return { totalGaps, perVacancy: gaps }
})
```

### 7.6 Data Flow

```
Nitro task hh:coverage (every 15 min)
  │
  ├─ find orgs with active vacancy links
  ├─ for each org:
  │   ├─ for each active vacancy link:
  │   │   ├─ getHhSession(orgId, primaryAccount.userId)
  │   │   ├─ fetch ALL negotiations from hh.ru (9 collections, paginated)
  │   │   ├─ load imported hh_negotiation records from DB
  │   │   ├─ diff: hh.ru IDs - DB IDs = gaps
  │   │   ├─ upsert hh_coverage_gap (new gaps, mark resolved)
  │   │   └─ log stats
  │   └─ continue to next link
  └─ return summary

GET /api/hh/coverage/summary (UI polling)
  └─ aggregate unresolved gaps per vacancy

POST /api/hh/coverage/gaps/:id/import (manual import)
  ├─ load gap record
  ├─ fetch negotiation from hh.ru
  ├─ run through existing sync.ts import logic
  ├─ mark gap as resolved (resolvedAt = now())
  └─ return { applicationId }
```

### 7.7 Migration

**File:** `server/database/migrations/0111_hh_coverage_gaps.sql`

```sql
-- 0111: coverage gap detection
CREATE TABLE IF NOT EXISTS "hh_coverage_gap" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "vacancy_link_id" text NOT NULL REFERENCES "hh_vacancy_link"("id") ON DELETE cascade,
  "hh_negotiation_id" text NOT NULL,
  "gap_reason" text NOT NULL,
  "hh_collection" text,
  "hh_candidate_name" text,
  "hh_created_at" timestamp,
  "detected_at" timestamp NOT NULL DEFAULT now(),
  "resolved_at" timestamp
);

CREATE INDEX IF NOT EXISTS "hh_cg_link_idx" ON "hh_coverage_gap"("vacancy_link_id");
CREATE INDEX IF NOT EXISTS "hh_cg_org_unresolved_idx" ON "hh_coverage_gap"("organization_id", "resolved_at");
```

---

## 8. [#10] Analytics & Statistics — Technical Architecture

### 8.1 Schema

**New table:** `hhStatsSnapshot` (periodic snapshots for trend charts)

```typescript
export const hhStatsSnapshot = pgTable('hh_stats_snapshot', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),

  vacancyLinkId: text('vacancy_link_id').references(() => hhVacancyLink.id, { onDelete: 'cascade' }),

  // What kind of snapshot
  snapshotType: text('snapshot_type').notNull(),  // 'vacancy_daily' | 'org_daily'

  // Funnel metrics
  totalResponses: integer('total_responses').notNull().default(0),
  inConsider: integer('in_consider').notNull().default(0),
  inInterview: integer('in_interview').notNull().default(0),
  inOffer: integer('in_offer').notNull().default(0),
  hired: integer('hired').notNull().default(0),
  discarded: integer('discarded').notNull().default(0),

  // Time metrics (avg days)
  avgTimeToResponse: integer('avg_time_to_response'),    // response → consider
  avgTimeToInterview: integer('avg_time_to_interview'),   // response → interview
  avgTimeToOffer: integer('avg_time_to_offer'),           // response → offer
  avgTimeToHire: integer('avg_time_to_hire'),             // response → hired

  // Source metrics
  conversionRate: integer('conversion_rate'),  // response → hired %
  sourceBreakdown: jsonb('source_breakdown').$type<Record<string, number>>(),

  snapshotDate: date('snapshot_date').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('hh_ss_org_date_idx').on(t.organizationId, t.snapshotDate),
  index('hh_ss_link_date_idx').on(t.vacancyLinkId, t.snapshotDate),
])
```

### 8.2 Server Utils

**New file:** `server/utils/hh/stats.ts`

```typescript
/**
 * Collect stats for a single vacancy from hh.ru negotiations.
 * Computes funnel + time metrics.
 */
export async function collectVacancyStats(args: {
  session: HhSession
  vacancyLinkId: string
}): Promise<VacancyStats>

/**
 * Collect org-wide stats (aggregate across all linked vacancies).
 */
export async function collectOrgStats(orgId: string): Promise<OrgStats>

/**
 * Snapshot current stats → hh_stats_snapshot table.
 * Called by Nitro scheduled task daily.
 */
export async function snapshotStats(orgId: string): Promise<void>

/**
 * Get historical trend data for charts.
 */
export async function getStatsTrend(args: {
  orgId: string
  vacancyLinkId?: string
  dateFrom: Date
  dateTo: Date
}): Promise<StatsTrendPoint[]>

export interface VacancyStats {
  totalResponses: number
  inConsider: number
  inInterview: number
  inOffer: number
  hired: number
  discarded: number
  avgTimeToResponse: number | null
  avgTimeToInterview: number | null
  avgTimeToOffer: number | null
  avgTimeToHire: number | null
  conversionRate: number
}
```

**`collectVacancyStats` implementation:**

```typescript
export async function collectVacancyStats(args: {
  session: HhSession
  vacancyLinkId: string
}): Promise<VacancyStats> {
  const [link] = await db.select().from(hhVacancyLink)
    .where(eq(hhVacancyLink.id, args.vacancyLinkId)).limit(1)

  // Query DB for imported negotiations (faster than re-fetching from hh.ru)
  const negotiations = await db.select().from(hhNegotiation)
    .where(eq(hhNegotiation.vacancyLinkId, args.vacancyLinkId))

  // Count by collection
  const byCollection = negotiations.reduce((acc, n) => {
    acc[n.hhCollection] = (acc[n.hhCollection] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Compute time metrics from hh_negotiation timestamps
  const hiredNegos = negotiations.filter(n => n.hhCollection === 'hired')
  const avgTimeToHire = hiredNegos.length > 0
    ? Math.round(hiredNegos.reduce((sum, n) => {
        const days = (n.hiredAt?.getTime() ?? 0) - (n.createdAt?.getTime() ?? 0)
        return sum + days / (1000 * 60 * 60 * 24)
      }, 0) / hiredNegos.length)
    : null

  return {
    totalResponses: negotiations.length,
    inConsider: byCollection['consider'] ?? 0,
    inInterview: byCollection['interview'] ?? 0,
    inOffer: byCollection['offer'] ?? 0,
    hired: byCollection['hired'] ?? 0,
    discarded: byCollection['discard_by_employer'] ?? 0,
    avgTimeToHire,
    // ... other time metrics
    conversionRate: negotiations.length > 0
      ? Math.round((hiredNegos.length / negotiations.length) * 100)
      : 0,
  }
}
```

### 8.3 Nitro Scheduled Task

**File:** `server/tasks/hh/stats.ts` (new)

```typescript
export default defineTask({
  meta: { name: 'hh:stats', description: 'Snapshot hh.ru stats daily' },
  async run() {
    const orgIds = await db.selectDistinct({ orgId: hhVacancyLink.organizationId })
      .from(hhVacancyLink)
      .where(eq(hhVacancyLink.autoSyncEnabled, true))

    for (const { orgId } of orgIds) {
      try {
        await snapshotStats(orgId)
      } catch (err) {
        logError('hh.stats.failed', { orgId, error: String(err) })
      }
    }

    return { result: `Snapshotted ${orgIds.length} orgs` }
  },
})
```

**Register in `nuxt.config.ts`:**

```typescript
scheduledTasks: {
  '*/5 * * * *': ['hh:sync'],
  '* * * * *':   ['hh:sourcing'],
  '*/15 * * * *': ['hh:coverage'],
  '0 2 * * *':   ['hh:stats'],     // NEW: daily at 02:00
  '0 3 * * 1':   ['rank:weekly'],
}
```

### 8.4 Server API Routes

| File | Route | Gate |
|---|---|---|
| `server/api/hh/stats/vacancy/[linkId].get.ts` | `GET /api/hh/stats/vacancy/:linkId` | `hhStats: ['read']` |
| `server/api/hh/stats/org.get.ts` | `GET /api/hh/stats/org` | `hhStats: ['read']` |
| `server/api/hh/stats/trend.get.ts` | `GET /api/hh/stats/trend` | `hhStats: ['read']` |
| `server/api/hh/stats/refresh.post.ts` | `POST /api/hh/stats/refresh` | `hhStats: ['refresh']` |

**Vacancy stats handler:**

```typescript
// vacancy/[linkId].get.ts
export default defineEventHandler(async (event) => {
  const { user, session } = await requirePermission(event, { hhStats: ['read'] })
  const linkId = getRouterParam(event, 'linkId')

  // Try live collection (fast — queries DB, not hh.ru API)
  const hh = await getHhSession(session.activeOrganizationId, user.id)
  const stats = await collectVacancyStats({ session: hh, vacancyLinkId: linkId })

  // Also get last 30 days trend from snapshots
  const trend = await getStatsTrend({
    orgId: session.activeOrganizationId,
    vacancyLinkId: linkId,
    dateFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    dateTo: new Date(),
  })

  return { current: stats, trend }
})
```

### 8.5 Migration

**File:** `server/database/migrations/0112_hh_stats_snapshots.sql`

```sql
-- 0112: stats snapshots for trend charts
CREATE TABLE IF NOT EXISTS "hh_stats_snapshot" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "vacancy_link_id" text REFERENCES "hh_vacancy_link"("id") ON DELETE cascade,
  "snapshot_type" text NOT NULL,
  "total_responses" integer NOT NULL DEFAULT 0,
  "in_consider" integer NOT NULL DEFAULT 0,
  "in_interview" integer NOT NULL DEFAULT 0,
  "in_offer" integer NOT NULL DEFAULT 0,
  "hired" integer NOT NULL DEFAULT 0,
  "discarded" integer NOT NULL DEFAULT 0,
  "avg_time_to_response" integer,
  "avg_time_to_interview" integer,
  "avg_time_to_offer" integer,
  "avg_time_to_hire" integer,
  "conversion_rate" integer,
  "source_breakdown" jsonb,
  "snapshot_date" date NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hh_ss_org_date_idx" ON "hh_stats_snapshot"("organization_id", "snapshot_date");
CREATE INDEX IF NOT EXISTS "hh_ss_link_date_idx" ON "hh_stats_snapshot"("vacancy_link_id", "snapshot_date");
```

---

## 9. [#2] Two-Way Sync — Technical Architecture

### 9.1 Core Concept

Currently sync is **one-way** (hh.ru → Huntfork). Two-way sync enables:
- **Outbound:** Changes in Huntfork (stage move, discard, message) push to hh.ru
- **Inbound:** Webhook events update Huntfork (already partially implemented)

### 9.2 Schema Changes

**Add to `hhNegotiation` table:**

```typescript
// In hhNegotiation table, add:
syncDirection: text('sync_direction').notNull().default('inbound'),  // 'inbound' | 'outbound' | 'bidirectional'
lastOutboundSyncAt: timestamp('last_outbound_sync_at'),
lastOutboundSyncStatus: text('last_outbound_sync_status'),  // 'pending' | 'synced' | 'failed'
outboundSyncError: text('outbound_sync_error'),
```

**Add to `hhVacancyLink` table:**

```typescript
// In hhVacancyLink table, add:
twoWaySyncEnabled: boolean('two_way_sync_enabled').notNull().default(false),
```

**New table:** `hhSyncQueue` (outbound change queue)

```typescript
export const hhSyncQueue = pgTable('hh_sync_queue', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),

  negotiationId: text('negotiation_id').notNull(),  // local hh_negotiation.id
  hhNegotiationId: text('hh_negotiation_id').notNull(),

  actionType: text('action_type').notNull(),  // 'move_collection' | 'discard' | 'send_message' | 'update_stage'
  payload: jsonb('payload').$type<{
    collection?: string
    messageText?: string
    stageId?: string
  }>(),

  status: text('status').notNull().default('pending'),  // 'pending' | 'processing' | 'synced' | 'failed'
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  processedAt: timestamp('processed_at'),
}, (t) => [
  index('hh_sq_status_idx').on(t.status, t.createdAt),
  index('hh_sq_negotiation_idx').on(t.negotiationId),
])
```

### 9.3 Server Utils

**New file:** `server/utils/hh/twoWaySync.ts`

```typescript
/**
 * Enqueue an outbound change to hh.ru.
 * Called when user changes something in Huntfork UI.
 */
export async function enqueueOutboundChange(args: {
  orgId: string
  negotiationId: string  // local ID
  actionType: string
  payload: Record<string, unknown>
}): Promise<string>  // returns queue item ID

/**
 * Process pending outbound changes.
 * Called by pg-boss worker.
 */
export async function processOutboundSync(queueItemId: string): Promise<void>

/**
 * Map local pipeline stage → hh.ru collection.
 */
export function mapStageToCollection(stageId: string, orgId: string): string | null

/**
 * Map hh.ru collection → local pipeline stage.
 */
export async function mapCollectionToStage(hhCollection: string, orgId: string): Promise<string | null>
```

**`processOutboundSync` implementation:**

```typescript
export async function processOutboundSync(queueItemId: string): Promise<void> {
  const [item] = await db.select().from(hhSyncQueue).where(eq(hhSyncQueue.id, queueItemId)).limit(1)
  if (!item || item.status !== 'pending') return

  // Mark as processing
  await db.update(hhSyncQueue).set({ status: 'processing', attempts: sql`attempts + 1` })
    .where(eq(hhSyncQueue.id, queueItemId))

  try {
    // Get the negotiation to find the owning user
    const [nego] = await db.select().from(hhNegotiation)
      .where(eq(hhNegotiation.id, item.negotiationId)).limit(1)
    const [link] = await db.select().from(hhVacancyLink)
      .where(eq(hhVacancyLink.id, nego.vacancyLinkId)).limit(1)

    const hh = await getHhSession(item.organizationId, link.lastSyncedByUserId)

    switch (item.actionType) {
      case 'move_collection': {
        await withHhRetry(() =>
          apiRequest('PUT', `/negotiations/${item.hhNegotiationId}`, hh.accessToken, {
            body: { collection: item.payload.collection },
          }, hh.config),
        )
        break
      }
      case 'discard': {
        await withHhRetry(() =>
          apiRequest('POST', `/negotiations/${item.hhNegotiationId}/actions`, hh.accessToken, {
            body: { action: 'discard' },
          }, hh.config),
        )
        break
      }
      case 'send_message': {
        await withHhRetry(() =>
          apiRequest('POST', `/negotiations/${item.hhNegotiationId}/messages`, hh.accessToken, {
            body: { text: item.payload.messageText },
          }, hh.config),
        )
        break
      }
    }

    // Mark as synced
    await db.update(hhSyncQueue).set({ status: 'synced', processedAt: new Date() })
      .where(eq(hhSyncQueue.id, queueItemId))

    // Update negotiation
    await db.update(hhNegotiation).set({
      lastOutboundSyncAt: new Date(),
      lastOutboundSyncStatus: 'synced',
    }).where(eq(hhNegotiation.id, item.negotiationId))
  } catch (err) {
    await db.update(hhSyncQueue).set({
      status: 'failed',
      lastError: String(err),
    }).where(eq(hhSyncQueue.id, queueItemId))

    await db.update(hhNegotiation).set({
      lastOutboundSyncStatus: 'failed',
      outboundSyncError: String(err),
    }).where(eq(hhNegotiation.id, item.negotiationId))
  }
}
```

### 9.4 Integration Points

**A. Stage change in Huntfork → push to hh.ru:**

Hook into existing application stage update (in `server/api/applications/[id]/stage.put.ts` or equivalent):

```typescript
// After updating local stage:
if (application.hhNegotiationId && link.twoWaySyncEnabled) {
  const hhCollection = mapStageToCollection(newStageId, orgId)
  if (hhCollection) {
    await enqueueOutboundChange({
      orgId,
      negotiationId: hhNegotiation.id,
      actionType: 'move_collection',
      payload: { collection: hhCollection },
    })
  }
}
```

**B. Message in Huntfork → push to hh.ru:**

Hook into comment creation:

```typescript
// After creating applicationComment:
if (application.hhNegotiationId && link.twoWaySyncEnabled && comment.authorType === 'user') {
  await enqueueOutboundChange({
    orgId,
    negotiationId: hhNegotiation.id,
    actionType: 'send_message',
    payload: { messageText: comment.text },
  })
}
```

**C. Inbound webhook → update local (already exists, enhance):**

In `processHhWebhookJob`, on `NEGOTIATION_EMPLOYER_STATE_CHANGE`:

```typescript
case 'NEGOTIATION_EMPLOYER_STATE_CHANGE': {
  // Existing: enqueueLinkSync
  // NEW: also update local stage immediately
  const localStage = await mapCollectionToStage(event.data.collection, orgId)
  if (localStage) {
    await db.update(application).set({ stageId: localStage })
      .where(eq(application.id, linkedApplication.id))
  }
  break
}
```

### 9.5 pg-boss Worker

**File:** `server/plugins/queue.ts` (add)

```typescript
// Outbound sync processor
await boss.work('hh-outbound-sync', { teamSize: 10, teamConcurrency: 3 }, async (job) => {
  await processOutboundSync(job.data.queueItemId)
})
```

### 9.6 Server API Routes

| File | Route | Gate |
|---|---|---|
| `server/api/hh/sync/status.get.ts` | `GET /api/hh/sync/status` | `hhNegotiation: ['read']` |
| `server/api/hh/sync/queue.get.ts` | `GET /api/hh/sync/queue` | `hhNegotiation: ['read']` |
| `server/api/hh/sync/queue/[id]/retry.post.ts` | `POST /api/hh/sync/queue/:id/retry` | `hhNegotiation: ['sync']` |

### 9.7 Data Flow

```
OUTBOUND (Huntfork → hh.ru):

User moves candidate to "Interview" stage in UI
  ├─ update application.stageId locally
  ├─ link.twoWaySyncEnabled? → no: done
  ├─ mapStageToCollection(stageId) → 'interview'
  ├─ enqueueOutboundChange({ actionType: 'move_collection', payload: { collection: 'interview' } })
  │   └─ insert hh_sync_queue (status='pending')
  ├─ boss.send('hh-outbound-sync', { queueItemId })
  └─ return 200 to user (async push)

pg-boss worker 'hh-outbound-sync':
  ├─ load queue item
  ├─ getHhSession(orgId, userId)
  ├─ PUT /negotiations/{nid} { collection: 'interview' }
  ├─ update hh_sync_queue (status='synced')
  └─ update hh_negotiation (lastOutboundSyncAt)

INBOUND (hh.ru → Huntfork): [enhanced existing]

Webhook NEGOTIATION_EMPLOYER_STATE_CHANGE
  ├─ enqueueLinkSync (existing — full re-sync)
  └─ mapCollectionToStage(hhCollection) → localStageId
      └─ update application.stageId immediately (fast path)
```

### 9.8 Migration

**File:** `server/database/migrations/0113_hh_two_way_sync.sql`

```sql
-- 0113: two-way sync support

-- Add outbound tracking to hh_negotiation
ALTER TABLE "hh_negotiation" ADD COLUMN IF NOT EXISTS "sync_direction" text NOT NULL DEFAULT 'inbound';
ALTER TABLE "hh_negotiation" ADD COLUMN IF NOT EXISTS "last_outbound_sync_at" timestamp;
ALTER TABLE "hh_negotiation" ADD COLUMN IF NOT EXISTS "last_outbound_sync_status" text;
ALTER TABLE "hh_negotiation" ADD COLUMN IF NOT EXISTS "outbound_sync_error" text;

-- Add two-way sync toggle to hh_vacancy_link
ALTER TABLE "hh_vacancy_link" ADD COLUMN IF NOT EXISTS "two_way_sync_enabled" boolean NOT NULL DEFAULT false;

-- Outbound sync queue
CREATE TABLE IF NOT EXISTS "hh_sync_queue" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "negotiation_id" text NOT NULL,
  "hh_negotiation_id" text NOT NULL,
  "action_type" text NOT NULL,
  "payload" jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "processed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "hh_sq_status_idx" ON "hh_sync_queue"("status", "created_at");
CREATE INDEX IF NOT EXISTS "hh_sq_negotiation_idx" ON "hh_sync_queue"("negotiation_id");
```

---

## 10. Implementation Sequencing & Dependencies

### 10.1 Dependency Graph

```
#3 Templates ────────────────── (standalone, no deps)
#4 Auto-Respond ─────────────── (depends on: existing sync.ts, applicationComment ALTER)
#6 Cold Sourcing ────────────── (depends on: existing hh_saved_search, hh_sourcing_candidate)
#7 Bulk Actions ─────────────── (depends on: existing hh_negotiation, pg-boss)
#8 Coverage Dashboard ───────── (depends on: existing sync.ts, hh_vacancy_link)
#10 Analytics ───────────────── (depends on: existing hh_negotiation, daily snapshots)
#2 Two-Way Sync ─────────────── (depends on: ALL above + stage mapping)
```

### 10.2 Recommended Build Order

| Phase | Integrations | Rationale |
|---|---|---|
| **Phase 1** | #3 Templates, #10 Analytics | No schema deps on each other. Templates is self-contained. Analytics reads existing data. |
| **Phase 2** | #4 Auto-Respond, #6 Cold Sourcing | Both extend existing tables. Auto-Respond hooks into sync.ts. Sourcing extends existing task. |
| **Phase 3** | #7 Bulk Actions, #8 Coverage | Bulk Actions needs pg-boss queue (already exists). Coverage needs sync.ts patterns. |
| **Phase 4** | #2 Two-Way Sync | Most complex. Depends on stage mapping, all webhook flows, outbound queue. Build last. |

### 10.3 Migration Order

```
0107_hh_vacancy_templates.sql      (#3)
0108_hh_auto_respond.sql           (#4 — alters application_comment + hh_vacancy_link)
0109_hh_sourcing_enhancements.sql  (#6 — alters hh_saved_search + hh_sourcing_candidate)
0110_hh_bulk_actions.sql           (#7)
0111_hh_coverage_gaps.sql          (#8)
0112_hh_stats_snapshots.sql        (#10)
0113_hh_two_way_sync.sql           (#2 — alters hh_negotiation + hh_vacancy_link)
```

All migrations are idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`). Can be applied in one batch.

---

## 11. Testing Strategy

### 11.1 Unit Tests (Vitest)

| Module | Test file | What to test |
|---|---|---|
| `hh/rateLimiter.ts` | `tests/unit/hh/rateLimiter.test.ts` | Concurrency limit, 429 retry with backoff |
| `hh/errors.ts` | `tests/unit/hh/errors.test.ts` | Error code → HTTP status mapping |
| `hh/session.ts` | `tests/unit/hh/session.test.ts` | Config missing → HH_NOT_CONFIGURED, account missing → HH_NOT_CONNECTED |
| `hh/autoRespond.ts` | `tests/unit/hh/autoRespond.test.ts` | Template rendering, condition evaluation, rule matching |
| `hh/coverage.ts` | `tests/unit/hh/coverage.test.ts` | Gap detection (diff hh.ru IDs vs DB IDs) |
| `hh/stats.ts` | `tests/unit/hh/stats.test.ts` | Funnel counting, time metric calculation, conversion rate |
| `hh/twoWaySync.ts` | `tests/unit/hh/twoWaySync.test.ts` | Stage→collection mapping, queue enqueue |

### 11.2 Integration Tests

| Test | What it validates |
|---|---|
| `tests/integration/hh-templates.test.ts` | Create template → use template → vacancy published to hh.ru (mocked) |
| `tests/integration/hh-auto-respond.test.ts` | New negotiation → rule matches → message sent → comment recorded |
| `tests/integration/hh-bulk-actions.test.ts` | Create bulk action → pg-boss processes → all items executed |
| `tests/integration/hh-coverage.test.ts` | Sync runs → gap detected → import gap → gap resolved |
| `tests/integration/hh-two-way-sync.test.ts` | Stage change → outbound queue → hh.ru API called → negotiation updated |

### 11.3 Mock Strategy

```typescript
// Mock hh.ru API responses with vi.mock
vi.mock('server/utils/hh/client', () => ({
  apiGet: vi.fn().mockResolvedValue({ items: [], pages: 0 }),
  apiRequest: vi.fn().mockResolvedValue({ status: 200, body: { id: 'mock-vacancy' } }),
}))

// Mock pg-boss
vi.mock('server/utils/queue/boss', () => ({
  getBoss: vi.fn().mockResolvedValue({
    send: vi.fn().mockResolvedValue('mock-job-id'),
    work: vi.fn(),
  }),
}))
```

### 11.4 E2E Tests (Playwright, on test VM)

| Scenario | Steps |
|---|---|
| Template lifecycle | Login → Settings → Create template → Use template → Verify vacancy on hh.ru |
| Auto-respond rule | Login → Create rule → Trigger sync → Verify message sent |
| Coverage dashboard | Login → Open dashboard → See gaps → Import gap → Verify resolved |
| Bulk invite | Login → Select 5 candidates → Bulk invite → Verify progress → Verify all invited |

---

## 12. Deployment Notes

### 12.1 New Environment Variables

None required. All config is DB-based (via `hh_oauth_config` table, already deployed).

### 12.2 New npm Dependencies

| Package | Purpose | Used by |
|---|---|---|
| `p-limit` | Concurrency limiting for hh.ru API calls | `server/utils/hh/rateLimiter.ts` |

Check if already present: `grep '"p-limit"' package.json`. If not, `npm install p-limit`.

### 12.3 New Nitro Scheduled Tasks

Add to `nuxt.config.ts` `nitro.scheduledTasks`:

```typescript
'*/15 * * * *': ['hh:coverage'],  // #8: every 15 min
'0 2 * * *':     ['hh:stats'],    // #10: daily at 02:00
```

### 12.4 New pg-boss Queues

| Queue name | teamSize | teamConcurrency | Registered in |
|---|---|---|---|
| `hh-bulk-action` | 5 | 2 | `server/plugins/queue.ts` |
| `hh-outbound-sync` | 10 | 3 | `server/plugins/queue.ts` |

### 12.5 Database Migration Application

```bash
# On test VM:
ssh -i /tmp/kilo/vm_key user1@176.108.250.112

# Apply all 7 migrations (idempotent, safe to run together):
cd ~/ats-huntfork
for f in server/database/migrations/010{7,8,9}*.sql server/database/migrations/011{0,1,2,3}*.sql; do
  echo "Applying $f..."
  docker exec -i reqcore_db psql -U reqcore -d reqcore < "$f"
done

# Register in drizzle migrations journal (if needed for consistency)
```

### 12.6 Permission Seed

After migration, ensure new permissions are available to existing roles. The `shared/permissions.ts` changes are compile-time (no DB seed needed — roles are defined in code, not DB).

---

## 13. Summary: Files to Create/Modify

### 13.1 New Files (29 total)

**Server utils (7):**
- `server/utils/hh/rateLimiter.ts`
- `server/utils/hh/errors.ts`
- `server/utils/hh/session.ts`
- `server/utils/hh/autoRespond.ts`
- `server/utils/hh/coverage.ts`
- `server/utils/hh/stats.ts`
- `server/utils/hh/twoWaySync.ts`

**Server API routes (21):**
- `server/api/hh/templates/index.get.ts`, `index.post.ts`, `[id].put.ts`, `[id].delete.ts`, `[id]/use.post.ts`
- `server/api/hh/auto-respond/rules/index.get.ts`, `index.post.ts`, `[id].put.ts`, `[id].delete.ts`, `test.post.ts`
- `server/api/hh/saved-searches/[id]/run.post.ts`, `sourcing/candidates/index.get.ts`, `[id]/convert.post.ts`
- `server/api/hh/bulk-actions/index.post.ts`, `index.get.ts`, `[id].get.ts`, `[id]/cancel.post.ts`
- `server/api/hh/coverage/gaps.get.ts`, `summary.get.ts`, `gaps/[id]/import.post.ts`, `scan.post.ts`
- `server/api/hh/stats/vacancy/[linkId].get.ts`, `org.get.ts`, `trend.get.ts`, `refresh.post.ts`
- `server/api/hh/sync/status.get.ts`, `queue.get.ts`, `queue/[id]/retry.post.ts`

**Server tasks (2):**
- `server/tasks/hh/coverage.ts`
- `server/tasks/hh/stats.ts`

**Migrations (7):**
- `server/database/migrations/0107_hh_vacancy_templates.sql`
- `server/database/migrations/0108_hh_auto_respond.sql`
- `server/database/migrations/0109_hh_sourcing_enhancements.sql`
- `server/database/migrations/0110_hh_bulk_actions.sql`
- `server/database/migrations/0111_hh_coverage_gaps.sql`
- `server/database/migrations/0112_hh_stats_snapshots.sql`
- `server/database/migrations/0113_hh_two_way_sync.sql`

### 13.2 Modified Files (7)

| File | Changes |
|---|---|
| `server/database/schema/app.ts` | Add 4 new tables, modify 3 existing tables (applicationComment, hhVacancyLink, hhNegotiation, hhSavedSearch, hhSourcingCandidate) |
| `shared/permissions.ts` | Add 5 new permission resources |
| `server/plugins/queue.ts` | Register 2 new pg-boss workers |
| `nuxt.config.ts` | Add 2 new scheduled tasks |
| `server/utils/hh/sync.ts` | Hook auto-respond evaluation after application creation |
| `server/utils/comms/hhWebhooks.ts` | Enhance webhook handlers for two-way sync + inbound message sync |
| `server/tasks/hh/sourcing.ts` | Enhance with scheduling + AI scoring |

### 13.3 New DB Tables (4)

| Table | Migration |
|---|---|
| `hh_vacancy_template` | 0107 |
| `hh_auto_respond_rule` | 0108 |
| `hh_bulk_action` | 0110 |
| `hh_coverage_gap` | 0111 |
| `hh_stats_snapshot` | 0112 |
| `hh_sync_queue` | 0113 |

### 13.4 Modified DB Tables (5)

| Table | Columns added | Migration |
|---|---|---|
| `application_comment` | `author_type`, `hh_message_id`, `hh_direction`, `hh_sync_status`, `hh_synced_at`, `hh_delivered_at` | 0108 |
| `hh_vacancy_link` | `auto_respond_enabled`, `two_way_sync_enabled` | 0108, 0113 |
| `hh_negotiation` | `sync_direction`, `last_outbound_sync_at`, `last_outbound_sync_status`, `outbound_sync_error` | 0113 |
| `hh_saved_search` | `last_run_at`, `last_run_stats`, `is_active`, `assigned_to_user_id` | 0109 |
| `hh_sourcing_candidate` | `sourced_from_search_id`, `relevance_score`, `ai_summary`, `contacted_at`, `contact_status` | 0109 |
