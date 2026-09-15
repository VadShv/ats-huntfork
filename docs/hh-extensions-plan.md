# hh.ru Integration Extensions — Product Plan & Architecture

> **Status:** Draft for review
> **Date:** 2025-09-15
> **Scope:** 7 new integrations (#2, #3, #4, #6, #7, #8, #10) building on the existing hh.ru OAuth + vacancy parsing + webhook infrastructure.
> **Prerequisite:** Org-level OAuth config (commit `2ea3ba1`) is deployed and working.

---

## Table of Contents

1. [Context & Existing Infrastructure](#1-context--existing-infrastructure)
2. [Integration Overview](#2-integration-overview)
3. [Phase 1 — Quick Wins](#3-phase-1--quick-wins)
   - 3.1 [#3] Vacancy Templates
   - 3.2 [#7] Bulk Operations
   - 3.3 [#2] Vacancy Statistics
4. [Phase 2 — Medium Effort](#4-phase-2--medium-effort)
   - 4.1 [#8] Negotiation History Sync
   - 4.2 [#10] Similar Vacancies
   - 4.3 [#6] Auto-Respond
5. [Phase 3 — Deep Integration](#5-phase-3--deep-integration)
   - 5.1 [#4] Comment Sync
6. [Cross-Cutting Concerns](#6-cross-cutting-concerns)
7. [Migration Summary](#7-migration-summary)
8. [Risk Register](#8-risk-register)

---

## 1. Context & Existing Infrastructure

### What already works

| Capability | Location | Notes |
|---|---|---|
| OAuth connect/disconnect | `server/api/hh/connect.get.ts`, `callback.get.ts` | Per-org, tokens in `hh_tokens` table |
| Token refresh | `server/utils/hh/tokens.ts` | Auto-refresh on expiry |
| Org-level config (UI) | `server/api/hh/config.*.ts`, `server/utils/hh/config.ts` | DB → env fallback, AES-256-GCM encryption |
| Vacancy parsing | `server/api/hh/parse-vacancy.post.ts` | Fetch + parse hh.ru vacancy by ID/URL |
| Vacancy publishing | `server/api/hh/vacancies.post.ts` | Create/update vacancies on hh.ru |
| Webhook receiver | `server/api/hh/webhooks.post.ts` | Receives отклики, status changes |
| Sync engine | `server/utils/hh/sync.ts` | Syncs applications, statuses, vacancies |
| API client | `server/utils/hh/client.ts` | `apiGet`, `apiRequest`, `getMe` — all accept optional `HhConfig` |

### Key types & utilities

```typescript
// server/utils/hh/config.ts
type HhConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  oauthBase: string      // https://hh.ru/oauth
  apiBase: string        // https://api.hh.ru
  userAgent: string
}

// Config resolution: DB (hh_oauth_config) → env vars → null
async function resolveHhConfig(orgId: string): Promise<HhConfig | null>
async function isHhConfiguredForOrg(orgId: string): Promise<boolean>
```

### hh.ru API endpoints used (and new ones needed)

| Endpoint | Method | Status |
|---|---|---|
| `/oauth/authorize` | GET | ✅ Used |
| `/oauth/token` | POST | ✅ Used |
| `/me` | GET | ✅ Used |
| `/vacancies/{id}` | GET | ✅ Used (parse) |
| `/vacancies` | POST/PUT | ✅ Used (publish) |
| `/employers/{id}/managers` | GET | ✅ Used |
| `/negotiations` | GET | 🆕 Needed (#8) |
| `/negotiations/{id}/messages` | GET/POST | 🆕 Needed (#4, #8) |
| `/negotiations/{id}` | PUT | 🆕 Needed (#7 bulk status) |
| `/vacancies/active` | GET | 🆕 Needed (#2 stats) |
| `/vacancies/{id}/stats` | GET | 🆕 Needed (#2 stats) |
| `/suggests/vacancies` | GET | 🆕 Needed (#10 similar) |
| `/negotiations/topic/{id}/messages` | POST | 🆕 Needed (#6 auto-respond) |

---

## 2. Integration Overview

### Priority matrix

| # | Integration | Phase | Effort | Value | Dependencies |
|---|---|---|---|---|---|
| 3 | Vacancy Templates | 1 | S (2-3d) | High — saves recruiter time | None |
| 7 | Bulk Operations | 1 | S (2-3d) | High — mass status updates | Existing sync |
| 2 | Vacancy Statistics | 1 | M (3-4d) | Medium — analytics dashboard | None |
| 8 | Negotiation History | 2 | M (4-5d) | High — full conversation visibility | Existing webhook |
| 10 | Similar Vacancies | 2 | S (2d) | Medium — candidate sourcing | None |
| 6 | Auto-Respond | 2 | M (4-5d) | High — faster candidate response | Templates (#3) |
| 4 | Comment Sync | 3 | L (6-8d) | High — bidirectional comments | Existing `applicationComment` |

### Sequencing rationale

- **Phase 1** has no cross-dependencies — all three can be built in parallel.
- **Phase 2**: #6 depends on #3 (templates provide the auto-respond message body). #8 and #10 are independent.
- **Phase 3**: #4 is the most complex (bidirectional sync, conflict resolution) and benefits from patterns established in Phase 2.

---

## 3. Phase 1 — Quick Wins

### 3.1 [#3] Vacancy Templates

**Goal:** Let recruiters save vacancy drafts as reusable templates, then create new vacancies from a template with one click.

#### Data Model

```sql
-- New table: hh_vacancy_templates
CREATE TABLE hh_vacancy_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,                    -- template label, e.g. "Senior Frontend React"
  description   TEXT,                             -- optional internal note
  -- Snapshot of hh.ru vacancy fields
  vacancy_data  JSONB NOT NULL,                   -- full /vacancies POST body
  -- Metadata
  hh_area_id    TEXT,                             -- cached city/region for filtering
  hh_prof_area  TEXT[],                           -- cached professional areas
  is_shared     BOOLEAN NOT NULL DEFAULT true,    -- org-wide vs personal
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hh_tpl_org ON hh_vacancy_templates(org_id);
CREATE INDEX idx_hh_tpl_org_shared ON hh_vacancy_templates(org_id, is_shared);
```

#### API Endpoints

| Route | Method | Permission | Description |
|---|---|---|---|
| `/api/hh/templates` | GET | `hh:templates:read` | List templates (org-wide + own private) |
| `/api/hh/templates` | POST | `hh:templates:write` | Create template from existing vacancy or manual |
| `/api/hh/templates/:id` | PUT | `hh:templates:write` | Update template |
| `/api/hh/templates/:id` | DELETE | `hh:templates:write` | Delete template |
| `/api/hh/templates/:id/use` | POST | `hh:vacancies:write` | Create new vacancy from template (calls hh.ru API) |

#### Architecture Flow (use template)

```
Client → POST /api/hh/templates/:id/use
  → load template (vacancy_data)
  → merge overrides (title, salary, area) from request body
  → resolveHhConfig(orgId)
  → getAccessToken(orgId) → refresh if needed
  → POST https://api.hh.ru/vacancies (merged body)
  → update template.last_used_at
  → return { hhVacancyId, url }
```

#### UI

- **Settings → Integrations → Templates tab:** grid of template cards with "Use" button, "Edit", "Delete".
- **"Use" modal:** pre-filled form with key fields (title, salary, city, employment type) — all editable before publishing.
- **"Save as Template" button** on the existing vacancy creation form.

#### Edge Cases

- Template references a professional area that hh.ru deprecated → show warning, let user pick a new one.
- User's org loses hh.ru connection → templates still visible, "Use" button disabled with tooltip.
- `vacancy_data` schema changes on hh.ru side → validate before publishing, show field-level errors.

---

### 3.2 [#7] Bulk Operations

**Goal:** Allow recruiters to select multiple отклики (applications) and perform batch actions: change status, send message, archive, reject.

#### Data Model

No new tables. Uses existing `applications` table + hh.ru Negotiations API.

```typescript
// Request body for bulk action
interface BulkActionRequest {
  applicationIds: string[]       // Huntfork application IDs (max 100)
  action: 'setStatus' | 'sendMessage' | 'archive' | 'reject'
  params: {
    // for setStatus
    hhStatus?: string            // e.g. 'invitation', 'discard', 'response'
    // for sendMessage
    messageText?: string
    // for reject
    rejectionReason?: string
  }
}

interface BulkActionResponse {
  total: number
  succeeded: { applicationId: string, hhNegotiationId: string }[]
  failed: { applicationId: string, error: string }[]
}
```

#### API Endpoints

| Route | Method | Permission | Description |
|---|---|---|---|
| `/api/hh/bulk/status` | POST | `hh:applications:write` | Set status for multiple applications |
| `/api/hh/bulk/message` | POST | `hh:applications:write` | Send same message to multiple candidates |
| `/api/hh/bulk/reject` | POST | `hh:applications:write` | Reject multiple candidates with reason |

#### Architecture Flow (bulk status change)

```
Client → POST /api/hh/bulk/status { applicationIds, hhStatus }
  → resolveHhConfig(orgId)
  → getAccessToken(orgId)
  → for each applicationId (parallel, max concurrency 5):
      → load application → get hhNegotiationId
      → PUT https://api.hh.ru/negotiations/{id} { status: hhStatus }
      → update local application.status
  → collect results { succeeded, failed }
  → return summary
```

**Rate limiting:** hh.ru allows ~30 requests/sec. Use p-limit with concurrency=5 to stay safe. Process in batches of 50 if >100 items.

#### UI

- Checkbox column in the applications list table.
- Sticky action bar appears when ≥1 selected: "X selected" + action buttons.
- Confirmation modal for destructive actions (reject, archive) with count and optional message.
- Progress indicator for long-running bulk operations (shows "12/50 done").

#### Edge Cases

- Some applications don't have `hhNegotiationId` (imported manually) → skip with reason "Not linked to hh.ru".
- hh.ru returns 429 (rate limit) → pause batch, retry after backoff, continue.
- Partial failure → return per-item results, let user retry failed subset.
- User selects >100 items → show warning, process first 100, offer "Process all in background".

---

### 3.3 [#2] Vacancy Statistics

**Goal:** Pull view/application/conversion stats from hh.ru for each published vacancy and display them in a dashboard widget.

#### Data Model

```sql
-- New table: hh_vacancy_stats (cached, refreshed periodically)
CREATE TABLE hh_vacancy_stats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  vacancy_id      UUID NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  hh_vacancy_id   TEXT NOT NULL,                  -- hh.ru vacancy ID
  -- Snapshot stats
  views_total     INTEGER NOT NULL DEFAULT 0,
  views_unique    INTEGER NOT NULL DEFAULT 0,
  applications    INTEGER NOT NULL DEFAULT 0,
  invitations     INTEGER NOT NULL DEFAULT 0,
  discards        INTEGER NOT NULL DEFAULT 0,
  responses       INTEGER NOT NULL DEFAULT 0,
  -- Conversion rates (computed)
  conversion_rate DECIMAL(5,2),                    -- applications / views_unique * 100
  -- Temporal
  stats_date      DATE NOT NULL,                   -- which day these stats are for
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(vacancy_id, stats_date)
);

CREATE INDEX idx_hh_stats_org_vacancy ON hh_vacancy_stats(org_id, vacancy_id);
CREATE INDEX idx_hh_stats_date ON hh_vacancy_stats(stats_date);
```

#### API Endpoints

| Route | Method | Permission | Description |
|---|---|---|---|
| `/api/hh/stats/:vacancyId` | GET | `hh:stats:read` | Get latest stats for a vacancy |
| `/api/hh/stats` | GET | `hh:stats:read` | Get aggregate stats for all org vacancies |
| `/api/hh/stats/refresh` | POST | `hh:stats:write` | Manually trigger stats refresh |

#### Architecture Flow (stats refresh)

```
Scheduled job (every 4 hours) OR manual trigger
  → load all org vacancies with hh_vacancy_id
  → resolveHhConfig(orgId)
  → for each vacancy:
      → GET https://api.hh.ru/vacancies/{id}/stats
      → upsert into hh_vacancy_stats (today's snapshot)
      → compute conversion_rate
  → return updated stats
```

#### UI

- **Vacancy detail page → "Statistics" tab:** line chart of views/applications over time, current conversion rate, status breakdown (invited/rejected/responded).
- **Dashboard widget:** top 5 vacancies by application count, with sparkline trends.
- **"Refresh" button** for manual sync with loading spinner.

#### Edge Cases

- Vacancy not yet published to hh.ru → show "Not published" state.
- hh.ru stats API returns 404 (vacancy deleted/archived on hh.ru) → mark vacancy as stale, show last known stats with "Data may be outdated" badge.
- First-time fetch (no historical data) → show only current snapshot, no trend chart.

---

## 4. Phase 2 — Medium Effort

### 4.1 [#8] Negotiation History Sync

**Goal:** Sync the full negotiation (отклик) history from hh.ru so recruiters see all interactions — including отклики that exist on hh.ru but were **never imported into Huntfork**. This is critical: the UI must explicitly flag which отклики are on hh.ru but NOT in Huntfork.

#### Data Model

```sql
-- New table: hh_negotiation_history
CREATE TABLE hh_negotiation_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  hh_negotiation_id   TEXT NOT NULL,               -- hh.ru negotiation/topic ID
  application_id      UUID REFERENCES applications(id) ON DELETE SET NULL,
  -- NULL = отклик exists on hh.ru but NOT imported into Huntfork
  hh_vacancy_id       TEXT NOT NULL,
  vacancy_id          UUID REFERENCES vacancies(id) ON DELETE SET NULL,
  -- Candidate info from hh.ru
  candidate_name      TEXT,
  candidate_email     TEXT,
  hh_resume_id        TEXT,
  -- Negotiation state
  hh_status           TEXT NOT NULL,               -- 'active', 'invitation', 'discarded', 'response', etc.
  -- Messages (synced from hh.ru)
  messages            JSONB NOT NULL DEFAULT '[]', -- [{ id, text, author, direction, createdAt }]
  message_count       INTEGER NOT NULL DEFAULT 0,
  -- Sync tracking
  is_in_huntfork      BOOLEAN NOT NULL DEFAULT false, -- false = on hh.ru only, not imported
  last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, hh_negotiation_id)
);

CREATE INDEX idx_hh_neg_org ON hh_negotiation_history(org_id);
CREATE INDEX idx_hh_neg_vacancy ON hh_negotiation_history(org_id, hh_vacancy_id);
CREATE INDEX idx_hh_neg_not_imported ON hh_negotiation_history(org_id, is_in_huntfork) WHERE is_in_huntfork = false;
```

#### API Endpoints

| Route | Method | Permission | Description |
|---|---|---|---|
| `/api/hh/negotiations` | GET | `hh:negotiations:read` | List negotiations for a vacancy (paginated) |
| `/api/hh/negotiations/:id/messages` | GET | `hh:negotiations:read` | Get full message thread |
| `/api/hh/negotiations/sync` | POST | `hh:negotiations:write` | Trigger full sync for a vacancy |
| `/api/hh/negotiations/import/:hhId` | POST | `hh:negotiations:write` | Import an unimported отклик into Huntfork |

#### Architecture Flow (sync negotiations for a vacancy)

```
Client → POST /api/hh/negotiations/sync { vacancyId }
  → resolveHhConfig(orgId)
  → getAccessToken(orgId)
  → GET https://api.hh.ru/vacancies/{hhVacancyId}/negotiations
    (paginated: items_per_page=100, page=1..N)
  → for each negotiation:
      → GET https://api.hh.ru/negotiations/{id}/messages
      → upsert into hh_negotiation_history
      → check if linked application exists in Huntfork:
          match by hh_negotiation_id in applications table
          → set application_id + is_in_huntfork=true
          → or set is_in_huntfork=false (отклик on hh.ru only)
  → return { total, imported, notImported }
```

#### UI

- **Vacancy detail → "Отклики" tab** (enhanced):
  - Two-section list: "Импортированы в Huntfork" (green badge) and "Только на hh.ru" (orange badge).
  - Each отклик card: candidate name, status badge, message count, last message preview, "View thread" button.
  - For unimported отклики: "Import" button to pull into Huntfork as a full application.
- **Message thread modal:** full conversation with direction indicators (incoming/outgoing), timestamps, formatted text.
- **Sync indicator:** "Last synced: 15 min ago" with refresh button. Auto-sync every 30 min if vacancy is open.

#### Edge Cases

- **Отклик on hh.ru but not in Huntfork** → shown with orange "Только на hh.ru" badge. User can click "Import" to create a full application record.
- Candidate has multiple отклики for the same vacancy (different resumes) → each is a separate negotiation entry.
- Message contains HTML formatting → sanitize and render as rich text.
- Negotiation was deleted on hh.ru → keep in history with "Deleted on hh.ru" badge, don't remove.
- Rate limit during sync → pause, show "Sync paused, will resume" notification.

---

### 4.2 [#10] Similar Vacancies

**Goal:** When viewing a candidate's resume, show similar vacancies across hh.ru that match their skills/experience — helping recruiters find better matches.

#### Data Model

No persistent storage needed. Results are fetched on-demand and cached briefly.

```sql
-- Optional cache table (TTL 1 hour)
CREATE TABLE hh_similar_vacancies_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  resume_hash     TEXT NOT NULL,                   -- hash of search criteria
  results         JSONB NOT NULL,                  -- array of vacancy summaries
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, resume_hash)
);
```

#### API Endpoints

| Route | Method | Permission | Description |
|---|---|---|---|
| `/api/hh/similar-vacancies` | POST | `hh:vacancies:read` | Find similar vacancies for a resume/candidate |

#### Architecture Flow

```
Client → POST /api/hh/similar-vacancies { candidateId or resumeText }
  → extract search criteria:
      - skills from candidate profile / parsed resume
      - desired position / area
  → check cache (resume_hash, not expired)
  → if cache miss:
      → resolveHhConfig(orgId)
      → getAccessToken(orgId)
      → GET https://api.hh.ru/vacancies?text={skills}&area={area}&per_page=20
      → filter: exclude own org's vacancies
      → cache results (TTL 1h)
  → return { vacancies: [{ id, name, employer, salary, area, url, alternate_url }] }
```

#### UI

- **Candidate detail → "Similar Vacancies" sidebar widget:**
  - List of 5-10 matching vacancies with: title, company, salary, location.
  - "View on hh.ru" link opens the vacancy in a new tab.
  - "Use as match" button to link the candidate to this vacancy.
- **Vacancy detail → "Similar Candidates"** (reverse direction): shows candidates in the org's DB that match the vacancy's requirements.

#### Edge Cases

- No skills/position data for candidate → show "Add skills to find similar vacancies" prompt.
- hh.ru search returns 0 results → broaden search (remove area filter, use only top skills).
- All results are from the same employer → diversify, show top 3 per employer.

---

### 4.3 [#6] Auto-Respond

**Goal:** Automatically send a pre-configured message to candidates immediately when their отклик is received via webhook. This reduces time-to-first-response from hours to seconds.

> **Important clarification:** Отлики already appear in Huntfork's DB quickly via the existing webhook. This integration adds **automatic message sending** — the recruiter configures templates and rules, and the system sends a message on hh.ru on their behalf without manual action.

#### Data Model

```sql
-- New table: hh_auto_respond_rules
CREATE TABLE hh_auto_respond_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  vacancy_id      UUID REFERENCES vacancies(id) ON DELETE CASCADE,
  -- NULL vacancy_id = rule applies to all vacancies in org
  name            TEXT NOT NULL,
  -- Trigger conditions
  trigger_type    TEXT NOT NULL DEFAULT 'on_new_application',
  -- Currently only 'on_new_application'; extensible to 'on_status_change' etc.
  conditions      JSONB NOT NULL DEFAULT '{}',
  -- e.g. { "resumeKeywords": ["React", "TypeScript"], "area": "Москва", "minExperience": 3 }
  -- Action
  template_id     UUID REFERENCES hh_vacancy_templates(id) ON DELETE SET NULL,
  message_text    TEXT,                             -- inline message (if no template)
  -- Scheduling
  delay_minutes   INTEGER NOT NULL DEFAULT 0,       -- delay before sending (0 = immediate)
  is_active       BOOLEAN NOT NULL DEFAULT true,
  -- Tracking
  sent_count      INTEGER NOT NULL DEFAULT 0,
  last_sent_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hh_auto_org ON hh_auto_respond_rules(org_id);
CREATE INDEX idx_hh_auto_vacancy ON hh_auto_respond_rules(org_id, vacancy_id);
CREATE INDEX idx_hh_auto_active ON hh_auto_respond_rules(org_id, is_active) WHERE is_active = true;

-- Log table for audit
CREATE TABLE hh_auto_respond_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  rule_id         UUID NOT NULL REFERENCES hh_auto_respond_rules(id) ON DELETE CASCADE,
  application_id  UUID REFERENCES applications(id) ON DELETE SET NULL,
  hh_negotiation_id TEXT,
  message_text    TEXT NOT NULL,
  status          TEXT NOT NULL,                   -- 'sent', 'failed', 'skipped'
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hh_auto_log_org ON hh_auto_respond_log(org_id, created_at DESC);
```

#### API Endpoints

| Route | Method | Permission | Description |
|---|---|---|---|
| `/api/hh/auto-respond/rules` | GET | `hh:autorespond:read` | List rules |
| `/api/hh/auto-respond/rules` | POST | `hh:autorespond:write` | Create rule |
| `/api/hh/auto-respond/rules/:id` | PUT | `hh:autorespond:write` | Update rule |
| `/api/hh/auto-respond/rules/:id` | DELETE | `hh:autorespond:write` | Delete rule |
| `/api/hh/auto-respond/log` | GET | `hh:autorespond:read` | View sent log |

#### Architecture Flow (auto-respond on webhook)

```
[Existing webhook handler] receives new отклик
  → creates application in DB (existing behavior)
  → NEW: check auto-respond rules:
      → load active rules for org (and vacancy-specific + org-wide)
      → for each matching rule:
          → evaluate conditions (keywords, area, experience)
          → if match:
              → resolve message text (template or inline)
              → if delay_minutes > 0:
                  → enqueue delayed job (queue/scheduler)
              → else:
                  → send immediately:
                      → getAccessToken(orgId)
                      → POST https://api.hh.ru/negotiations/topic/{negotiationId}/messages
                        { message: text }
                      → log to hh_auto_respond_log
                      → increment rule.sent_count
```

#### UI

- **Settings → Integrations → Auto-Respond tab:**
  - List of rules with toggle (active/inactive), name, vacancy scope, sent count.
  - "Create Rule" form:
    - Scope: all vacancies or specific vacancy.
    - Conditions: keywords in resume, area, minimum experience.
    - Message: select template (from #3) or write inline.
    - Delay: immediate or N minutes.
  - **Log view:** table of recent auto-responds with candidate name, message preview, status, timestamp.

#### Edge Cases

- Multiple rules match one отклик → execute all matching rules in order (configurable: "first match only" vs "all matches").
- hh.ru API fails to send message → log as 'failed', show in log with retry button.
- Candidate withdraws отклик before message sent → skip, log as 'skipped'.
- Rule references a deleted template → fall back to empty message, disable rule, notify admin.
- Rate limit → queue message, send when limit resets.
- **Duplicate prevention:** if auto-respond already sent for this negotiation, don't send again (check log table).

---

## 5. Phase 3 — Deep Integration

### 5.1 [#4] Comment Sync

**Goal:** Bidirectional sync of comments between Huntfork's `applicationComment` system and hh.ru negotiation messages. When a recruiter writes a comment in Huntfork, it appears on hh.ru. When a candidate messages on hh.ru, it appears as a comment in Huntfork.

> **Key decision:** Reuse the existing `applicationComment` table — do NOT create a new table. Add an `hh_message_id` column to link comments to hh.ru messages.

#### Data Model Changes

```sql
-- Extend existing applicationComment table (ALTER, not new table)
ALTER TABLE application_comment
  ADD COLUMN hh_message_id    TEXT UNIQUE,        -- links to hh.ru message ID
  ADD COLUMN hh_direction     TEXT,               -- 'incoming' (from candidate) | 'outgoing' (to candidate)
  ADD COLUMN hh_sync_status   TEXT DEFAULT 'local', -- 'local' | 'synced' | 'pending' | 'failed'
  ADD COLUMN hh_synced_at     TIMESTAMPTZ;

-- Index for finding unsynced outgoing comments
CREATE INDEX idx_app_comment_hh_sync
  ON application_comment(org_id, hh_sync_status)
  WHERE hh_sync_status IN ('pending', 'failed');

-- Index for dedup on incoming
CREATE INDEX idx_app_comment_hh_msg
  ON application_comment(hh_message_id)
  WHERE hh_message_id IS NOT NULL;
```

#### API Endpoints

| Route | Method | Permission | Description |
|---|---|---|---|
| `/api/hh/comments/sync` | POST | `hh:comments:write` | Sync comments for an application (bidirectional) |
| `/api/hh/comments/send` | POST | `hh:comments:write` | Send a Huntfork comment to hh.ru |

No new GET endpoints — comments are read through the existing `applicationComment` API. The `hh_direction` and `hh_sync_status` fields are returned in the existing response.

#### Architecture Flow (bidirectional sync)

```
Trigger: scheduled job (every 5 min for active applications) OR manual

=== INBOUND (hh.ru → Huntfork) ===
  → GET https://api.hh.ru/negotiations/{negotiationId}/messages
  → for each message:
      → check if application_comment with hh_message_id exists
      → if not: insert into application_comment:
          { text: message.text,
            author: 'candidate' if incoming, current user if outgoing,
            hh_message_id: message.id,
            hh_direction: message.direction,
            hh_sync_status: 'synced',
            hh_synced_at: now() }
      → if exists: update text if changed (rare, but possible with edits)

=== OUTBOUND (Huntfork → hh.ru) ===
  → query application_comment WHERE hh_sync_status IN ('pending', 'failed')
    AND hh_direction IS NULL OR hh_direction = 'outgoing'
  → for each comment:
      → POST https://api.hh.ru/negotiations/topic/{negotiationId}/messages
        { message: comment.text }
      → on success: update hh_sync_status='synced', hh_message_id=response.id, hh_synced_at=now()
      → on failure: update hh_sync_status='failed', keep for retry
```

#### When a recruiter writes a comment in Huntfork

```
Client → POST /api/applications/:id/comments { text }  (existing endpoint, modified)
  → insert into application_comment:
      { text, author: currentUser, hh_sync_status: 'pending' }
  → if application has hh_negotiation_id AND org has hh config:
      → immediately attempt to send to hh.ru (async, non-blocking):
          → POST https://api.hh.ru/negotiations/topic/{id}/messages
          → on success: update hh_sync_status='synced', hh_message_id
          → on failure: leave as 'pending', will be retried by sync job
  → return comment (with hh_sync_status)
```

#### UI

- **Application detail → Comments section** (enhanced):
  - Each comment shows a badge: "hh.ru" (synced, blue), "Pending sync" (yellow), "Sync failed" (red), or no badge (internal-only comment).
  - **"Send to hh.ru" toggle** on the comment composer: when checked (default for applications linked to hh.ru), the comment is sent to hh.ru. When unchecked, it stays internal to Huntfork.
  - Incoming messages from candidates appear with a distinct style (left-aligned, candidate avatar) vs recruiter comments (right-aligned).
  - "Sync" button to manually trigger bidirectional sync.
- **Sync status indicator:** "Last synced: 2 min ago" with spinner during active sync.

#### Conflict Resolution

| Scenario | Resolution |
|---|---|
| Comment edited in Huntfork after sync to hh.ru | hh.ru messages cannot be edited. Show warning: "This comment was already sent to hh.ru and cannot be edited there." Keep local edit, do not re-send. |
| Comment deleted in Huntfork after sync | Do NOT delete on hh.ru (hh.ru API doesn't support message deletion). Mark local comment as deleted, keep hh_message_id for dedup. |
| Same message arrives from hh.ru (duplicate) | Dedup by `hh_message_id` — skip if already exists. |
| Comment created offline (no hh.ru connection) | Stored with `hh_sync_status='pending'`. Synced when connection restored. |

#### Edge Cases

- Application not linked to hh.ru (manually created) → comments are local-only, no sync attempted.
- hh.ru negotiation closed/archived → outgoing sync fails gracefully, mark as 'failed' with error "Negotiation closed".
- Large message (>5000 chars) → hh.ru may reject. Validate length before sending, show error.
- Message contains formatting (markdown/HTML) → convert to plain text for hh.ru (hh.ru messages are plain text).
- Multiple recruiters comment simultaneously → all sent to hh.ru independently, order may differ. Use timestamps for display order.

---

## 6. Cross-Cutting Concerns

### 6.1 Permissions (RBAC)

New permission keys to register in the existing RBAC system:

| Permission | Default Roles | Description |
|---|---|---|
| `hh:templates:read` | recruiter, hiring_manager, admin | View vacancy templates |
| `hh:templates:write` | recruiter, admin | Create/edit/delete templates |
| `hh:stats:read` | recruiter, hiring_manager, admin | View vacancy statistics |
| `hh:stats:write` | admin | Trigger stats refresh |
| `hh:negotiations:read` | recruiter, hiring_manager, admin | View negotiation history |
| `hh:negotiations:write` | recruiter, admin | Sync/import negotiations |
| `hh:autorespond:read` | recruiter, hiring_manager, admin | View auto-respond rules & log |
| `hh:autorespond:write` | admin | Create/edit/delete auto-respond rules |
| `hh:comments:write` | recruiter, admin | Sync comments to hh.ru |
| `hh:applications:bulk` | recruiter, admin | Bulk operations on applications |

### 6.2 Rate Limiting

All hh.ru API calls must respect rate limits:

```typescript
// Shared rate limiter for hh.ru API
const hhRateLimiter = {
  maxConcurrent: 5,        // max parallel requests
  minTimeMs: 100,          // min 100ms between requests (10/sec per org)
  retryOn429: true,        // auto-retry on rate limit
  maxRetries: 3,           // max retry attempts
  backoffMs: 5000,         // initial backoff (doubles each retry)
}

// For bulk operations specifically:
const bulkRateLimiter = {
  ...hhRateLimiter,
  maxConcurrent: 3,        // more conservative for bulk
  batchSize: 50,           // process in batches of 50
  batchDelayMs: 2000,      // pause between batches
}
```

### 6.3 Error Handling

Unified error response format for all new endpoints:

```typescript
interface HhApiError {
  code: string              // 'HH_NOT_CONFIGURED' | 'HH_TOKEN_EXPIRED' | 'HH_RATE_LIMITED' | 'HH_API_ERROR' | 'HH_PARTIAL_FAILURE'
  message: string           // human-readable
  hhStatus?: number        // original hh.ru HTTP status
  details?: unknown        // additional context
}
```

### 6.4 Background Jobs

| Job | Trigger | Frequency | Description |
|---|---|---|---|
| `hh:stats:refresh` | Cron | Every 4 hours | Refresh vacancy stats for all orgs |
| `hh:negotiations:sync` | Cron | Every 30 min (per open vacancy) | Sync negotiation history |
| `hh:comments:sync` | Cron | Every 5 min (per active application) | Bidirectional comment sync |
| `hh:auto-respond:send` | Event (webhook) + delayed queue | On new отклик | Send auto-respond message |
| `hh:bulk:process` | Manual trigger | One-off | Process bulk operation in background |

Implementation: use the existing Nitro scheduled tasks or a queue system (BullMQ if available, otherwise Nitro hooks with `setTimeout` for delayed actions).

### 6.5 Encryption & Security

- Auto-respond message templates may contain PII → no special encryption needed (stored as plain text in DB, same as existing comments).
- hh.ru API tokens are already encrypted in `hh_tokens` table.
- Bulk operations must be auditable: log who triggered, what was affected, and results.
- Auto-respond log retains message text for audit — consider GDPR retention policy (configurable TTL, default 90 days).

### 6.6 Testing Strategy

For each integration:

1. **Unit tests:** utility functions (condition evaluation, message formatting, rate limiter).
2. **Integration tests:** API endpoints with mocked hh.ru responses (use `nock` or `msw`).
3. **E2E tests:** full flow from UI to hh.ru sandbox API (if available) or mocked.
4. **Manual QA checklist:** verify rate limiting, partial failures, offline behavior.

---

## 7. Migration Summary

All migrations follow the existing idempotent pattern (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).

| Migration # | Tables/Changes | Phase | Integration |
|---|---|---|---|
| 0107 | `hh_vacancy_templates` | 1 | #3 Templates |
| 0108 | `hh_vacancy_stats` | 1 | #2 Stats |
| 0109 | `hh_negotiation_history` | 2 | #8 Negotiation History |
| 0110 | `hh_similar_vacancies_cache` | 2 | #10 Similar Vacancies |
| 0111 | `hh_auto_respond_rules`, `hh_auto_respond_log` | 2 | #6 Auto-Respond |
| 0112 | ALTER `application_comment` (add hh_* columns) | 3 | #4 Comment Sync |

Each migration also updates the `journal.json` with the corresponding entry.

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| hh.ru API changes/breaks | Medium | High | Abstract all API calls behind `client.ts`; version-check `User-Agent`; monitor for 404s |
| Rate limit (429) during bulk sync | High | Medium | Conservative concurrency, exponential backoff, queue remaining items |
| Auto-respond sends inappropriate message | Medium | High | Template approval workflow, keyword filtering, daily send limit, audit log with disable switch |
| Comment sync creates duplicates | Low | Medium | Dedup by `hh_message_id` (unique constraint), idempotent upserts |
| Negotiation history grows unbounded | Medium | Low | Pagination on API, archival policy for closed negotiations >180 days |
| Org loses hh.ru connection mid-sync | Medium | Medium | Graceful degradation, mark items as 'pending', resume on reconnection |
| Template references deprecated hh.ru fields | Low | Medium | Validate `vacancy_data` against current hh.ru schema before use; show warnings |
| Auto-respond triggers on withdrawn отклики | Low | Low | Check negotiation status before sending; log as 'skipped' |

---

## Appendix A: Implementation Order (Recommended)

```
Week 1-2:  Phase 1 (parallel)
  ├── #3 Templates (2-3 days)
  ├── #7 Bulk Operations (2-3 days)
  └── #2 Vacancy Statistics (3-4 days)

Week 3-4:  Phase 2
  ├── #8 Negotiation History (4-5 days) — can start immediately
  ├── #10 Similar Vacancies (2 days) — can start immediately
  └── #6 Auto-Respond (4-5 days) — starts after #3 Templates is done

Week 5-6:  Phase 3
  └── #4 Comment Sync (6-8 days) — starts after #8 (reuses sync patterns)
```

## Appendix B: hh.ru API Reference

### Negotiations

- `GET /negotiations?vacancy_id={id}&page={n}&per_page={n}` — list negotiations for a vacancy
- `GET /negotiations/{id}/messages` — get message thread
- `POST /negotiations/topic/{topicId}/messages` — send message to candidate
- `PUT /negotiations/{id}` — update negotiation status

### Vacancies

- `GET /vacancies/active` — list active vacancies (for stats)
- `GET /vacancies/{id}/stats` — view statistics for a vacancy
- `GET /vacancies?text={query}&area={id}` — search vacancies (for similar)

### Response format (all hh.ru endpoints)

```json
{
  "items": [...],
  "page": 0,
  "pages": 1,
  "per_page": 20,
  "found": 1,
  "total": 1
}
```
