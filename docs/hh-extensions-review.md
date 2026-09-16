# HH Extensions — Code Review Report

**Date:** 2026-09-16  
**Scope:** All uncommitted changes (21 tracked + 35 untracked files, 646+ insertions)  
**Tracks:** security, business-logic, performance, deploy-safety, duplication, dead-code  
**Deploy safety:** PASS — migrations idempotent, journal valid, RBAC types safe, no unbounded historical reprocessing.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical (fix before merge) | 4 |
| High (fix soon) | 11 |
| Medium (fix when convenient) | 6 |
| **Total** | **21** |

---

## Critical

### C1. Stored XSS — regex HTML sanitizer + `v-html`
- **Track:** security
- **Path:** `app/components/hh/HhNegotiationThread.vue:170` (sanitizer at 49–60)
- **Why:** hh.ru message HTML rendered via `v-html` after only regex stripping. Regex sanitization is reliably bypassable (`javascript:` URLs, nested tags, `<svg>` mutation XSS). Messages come raw from hh.ru — an applicant's HTML executes in the recruiter's authenticated session.
- **Fix:** Replace `sanitizeHtml()` with DOMPurify (`DOMPurify.sanitize(msg.text, { USE_PROFILES: { html: true } })`), or render as escaped plain text. Add `dompurify` + `isomorphic-dompurify` to deps.

### C2. IDOR — comment ownership verified after status leak
- **Track:** security
- **Path:** `server/api/hh/comments/send.post.ts:27–35`
- **Why:** Comment loaded by `commentId` alone (no `organizationId` filter). The `hhSyncStatus` gate runs *before* the org-ownership check. A caller from another org can distinguish "not found" vs "exists but wrong status" vs "belongs to another org", leaking existence and sync status.
- **Fix:** Move the org-ownership check (lines 38–45) above the status check (lines 33–35), or load the comment joined to its application filtered by `organizationId = orgId` in a single query.

### C3. Cross-org dedup — `hhMessageId` unique index not org-scoped
- **Track:** security
- **Path:** `server/api/hh/comments/sync.post.ts:107–112` (schema index at `server/database/schema/app.ts:2611`)
- **Why:** Inbound dedup query and the `uniqueIndex('idx_app_comment_hh_message_id').on(t.hhMessageId)` are global, not scoped to `applicationId`/`organizationId`. If two orgs encounter the same hh.ru message ID, the second org's import is silently skipped or fails the unique constraint.
- **Fix:** Scope both the dedup query and the unique index: `uniqueIndex(...).on(t.applicationId, t.hhMessageId)` and add `eq(applicationComment.applicationId, app.id)` to the dedup `where`. Requires a new migration to drop/recreate the index.

### C4. Fire-and-forget marks comment `failed` after successful send
- **Track:** business-logic (also performance)
- **Path:** `server/api/applications/[id]/comments/index.post.ts:148` and `server/api/hh/comments/sync.post.ts:166`
- **Why:** If `sendNegotiationMessage` succeeds but the `synced` DB update throws, the catch block overwrites status to `failed`. A retry after the 60s dedup window re-sends → duplicate message to candidate.
- **Fix:** Split the try: wrap only `sendNegotiationMessage` in try/catch; on success, best-effort update to `synced` (ignore update errors). Only mark `failed` if the send itself throws.

---

## High

### H1. Cache key omits `area` — cross-region cache collisions
- **Track:** business-logic + performance
- **Path:** `server/api/hh/similar-vacancies.post.ts:79`
- **Why:** `resumeHash` is `sha256({skills, title})` but the search also filters by `area`. Two candidates with identical skills+title but different areas share one cache entry → wrong results.
- **Fix:** Include `area?.id` in the hash input.

### H2. `cancelBulk` never resolves pending promise or clears poll
- **Track:** business-logic
- **Path:** `app/composables/useHhBulkAction.ts:94`
- **Why:** `cancelBulk` POSTs to cancel but doesn't call `clearPoll()` or resolve the promise from `runBulk`. The caller's `await runHhBulk(...)` hangs forever and `isBulkOperating` stays true.
- **Fix:** In `cancelBulk`, call `clearPoll()`, set status to `'cancelled'`, and resolve the pending promise.

### H3. No max poll limit — infinite polling on stuck jobs
- **Track:** business-logic
- **Path:** `app/composables/useHhBulkAction.ts:78`
- **Why:** If the pg-boss worker dies and the job stays `'running'`/`'pending'`, `setInterval` polls every 1.5s indefinitely.
- **Fix:** Add a max-attempts counter (e.g., 200 ≈ 5 min); on exhaustion, `clearPoll()` and resolve/reject.

### H4. `matchPercent` denominator counts duplicate skills
- **Track:** business-logic
- **Path:** `server/api/hh/similar-candidates.post.ts:87`
- **Why:** `jobSkills = [...hardSkills, ...niceSkills]` may overlap. Denominator uses `jobSkills.length` (with dups) while matching uses the deduped Set → deflated percentage.
- **Fix:** Use `jobSkillsLower.size` as the denominator; dedupe `overlapping` before counting.

### H5. Hardcoded 502 discards original hh.ru status code
- **Track:** business-logic
- **Path:** `server/api/hh/negotiations/[id]/messages.get.ts:84`
- **Why:** `statusCode: 502` hardcoded even when hh.ru returns 404 or 401; client can't distinguish error types. Inconsistent with `similar-vacancies.post.ts:135` which preserves upstream status.
- **Fix:** Use `const status = (err as ...).status ?? 502` and pass `statusCode: status`.

### H6. N+1 dedup queries in inbound comment sync
- **Track:** performance
- **Path:** `server/api/hh/comments/sync.post.ts:101–112`
- **Why:** Each hh.ru message triggers a separate `SELECT ... WHERE hh_message_id = ?`. Long threads = one DB round-trip per message.
- **Fix:** Batch the lookup — `SELECT hh_message_id FROM application_comment WHERE hh_message_id IN (...)` once, build a `Set`, skip known ids in the loop.

### H7. Comment sync re-fetches entire hh.ru thread on every call
- **Track:** performance
- **Path:** `server/api/hh/comments/sync.post.ts:93–99`
- **Why:** Full message history pulled each click; payload grows with thread length, never paginated or incremental.
- **Fix:** Track `lastInboundSyncAt` or last `hh_message_id` on the application/link; request only newer messages.

### H8. Fire-and-forget sends have no concurrency control
- **Track:** performance
- **Path:** `server/api/applications/[id]/comments/index.post.ts:124–157`
- **Why:** Each comment POST spawns an unawaited async task holding a DB + HTTP connection. A burst can exhaust the DB pool and trip hh.ru rate limits.
- **Fix:** Enqueue via pg-boss (already used by bulk actions); let a worker drain `hhSyncStatus='pending'` rows with bounded concurrency.

### H9. Similar-vacancies cache rows never evicted
- **Track:** performance
- **Path:** `server/api/hh/similar-vacancies.post.ts:160–167` + schema
- **Why:** Every miss inserts a new row; `(organizationId, resumeHash)` index is non-unique, no TTL cleanup or upsert → unbounded growth.
- **Fix:** Make `(organizationId, resumeHash)` unique + `ON CONFLICT ... DO UPDATE`; add periodic `DELETE WHERE expires_at < now()`.

### H10. Bulk status dropdown uses invalid hh.ru collection names
- **Track:** duplication
- **Path:** `app/pages/dashboard/applications/index.vue:643–648`
- **Why:** Sends `discard` and `archive` as collection names, but valid hh.ru collections are `discard_by_employer`, `discard_visible_by_opponent`, etc. These will hit non-existent hh.ru endpoints and fail. Labels also inconsistent (`consider`→"Пригласить" vs elsewhere "Подумать").
- **Fix:** Replace with valid collections + consistent labels. Extract to shared constant.

### H11. Error handling inconsistent across `sendNegotiationMessage` callers
- **Track:** duplication
- **Path:** `server/api/hh/negotiations/[id]/messages.post.ts:60`
- **Why:** No try/catch — raw 500 with no `statusMessage` on failure, unlike sibling endpoints that return 502 with descriptive messages. Frontend toast shows `undefined`.
- **Fix:** Wrap with the same try/catch pattern used in `send.post.ts:56–79`.

---

## Medium

### M1. Collection label mapping duplicated in 4+ places with inconsistent labels
- **Track:** duplication
- **Path:** `HhNegotiationCard.vue:23`, `jobs/[id]/settings.vue:221`, `settings/hh-auto-respond.vue:49`, `HhAutoRespondRuleEditor.vue:57`
- **Why:** Same mapping independently defined with divergent labels and incomplete coverage. Auto-respond editor omits `assessment`, `hired`, etc. — rules can't be created for those collections.
- **Fix:** Extract single `HH_COLLECTION_LABELS` map to `shared/hh-collections.ts`; import in all 4 files.

### M2. `EMPLOYER_COLLECTIONS` array duplicated between sync.ts and coverage.ts
- **Track:** duplication
- **Path:** `server/utils/hh/sync.ts:210` + `server/utils/hh/coverage.ts:20`
- **Why:** Copy-pasted 10-element array. Drift between the two = silent coverage gaps.
- **Fix:** Extract to `server/utils/hh/collections.ts`; import from both.

### M3. similar-candidates loads up to 1000 full JSONB resumes per request
- **Track:** performance
- **Path:** `server/api/hh/similar-candidates.post.ts:62–76`
- **Why:** `.limit(1000)` selects full `hhResumeRaw` JSONB for every active candidate, then filters in JS.
- **Fix:** Project only the skill array via JSONB expression, or add GIN index on `hhResumeRaw->'skill_set'` and push overlap filter into SQL.

### M4. Unused `linkId` prop in `HhVacancyStats.vue`
- **Track:** dead-code
- **Path:** `app/components/hh/HhVacancyStats.vue:30`
- **Fix:** Remove `linkId` from props + drop `:link-id` binding in `stats.vue`.

### M5. Unused `orgId` prop in `HhAutoRespondRuleEditor.vue`
- **Track:** dead-code
- **Path:** `app/components/hh/HhAutoRespondRuleEditor.vue:27`
- **Fix:** Remove `orgId` from `defineProps` + `withDefaults`.

### M6. Incoming applicant messages misattributed to syncing recruiter
- **Track:** security (data-integrity smell, not a vulnerability)
- **Path:** `server/api/hh/comments/sync.post.ts:124`
- **Why:** `authorUserId: userId` from the authenticated session — incoming applicant messages are attributed to the recruiter, not the applicant.
- **Fix:** Use a system/bot user ID or add an `authorType` field to distinguish applicant vs. recruiter messages.
