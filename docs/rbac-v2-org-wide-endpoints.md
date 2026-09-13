# RBAC v2 — Эндпоинты «org-wide by design» (scope НЕ применяется)

> Финальный список из Фазы 2 §D2. Эти эндпоинты намеренно НЕ скоупятся по
> member-scope — они работают на уровне всей организации и защищены ПРАВОМ
> (permission), а не границей данных. Для прозрачности аудита.

## Управление организацией / настройки (гейт по праву owner/admin)
- `access/*` — управление ролями/участниками/scope/аудитом (`member:update`).
- `ai-config/*`, `ai/*` — настройки ИИ организации (`scoring`/owner-admin).
- `companies/*`, `departments/*` — оргструктура (read для scope; write owner/admin).
- `pipelines/*` — воронки организации (общие шаблоны).
- `prompts/*` — банк промптов (общий, гейт правом lead).
- `email-templates/*`, `comms/*` (настройки) — шаблоны/настройки орга.
- `organization/*`, `settings/*`, `teams/*`, `invite-links/*`, `join-requests/*`,
  `members/*` — управление участниками/приглашениями (owner/admin).
- Интеграции: `hh/*` mgmt, `calendar/*` mgmt — `organization:update` (§D1).

## Внешние / служебные (защита секретом или сервер-сервер, НЕ трогать)
- `webhooks/hh/[secret]`, `webhooks/telegram/[secret]` — секрет в URL.
- `calendar/webhook` — валидация `X-Goog-Channel-ID`.
- `calendar/renew-webhooks` — `CRON_SECRET` (планировщик).
- `hh/callback`, `calendar/google/callback` — OAuth-callback (CSRF-state + сессия).

## Справочники / пользовательские (не про данные кандидатов)
- `auth/*` — аутентификация.
- `gamification/*` — геймификация (командные метрики, не PII кандидатов).
- `profile/*`, `notifications/*` — личные настройки пользователя.
- `properties/*` (определения кастом-полей орга), `saved-views/*` (личные виды).

## Скоупятся по member-scope (для справки — НЕ в этом списке)
`candidates/[id]/*` (§B), `applications/[id]/*` (§C1), `jobs/[id]/*` (§C2),
`sourcing-*` (§C3), `analytics/*` (§C4), `tracking-links/[id]/*` +
`source-tracking/stats` (§D2), а также базовые списки candidates/applications/
jobs/interviews/documents/conversations + AI-ассистент (§3).

Правило: любой эндпоинт с данными кандидатов/вакансий/откликов → scoped
(out-of-scope → 404); всё остальное — гейт по праву, см. выше.

---

## Спринт G — финальное дозакрытие (0 непокрытых)

`bash scripts/audit-scope-coverage.sh` → **0 непокрытых** [id]-эндпоинтов с
данными (кроме create/index/org-wide). Добавлено в Спринте G:

- **Корневые [id]-мутации:** `applications/[id].patch`, `candidates/[id].delete`,
  `applications/index.post` (create-gate по job-scope).
- **documents/[id]/*:** parsed/parse/re-extract — scope по кандидату документа.
- **interviews/[id]/*:** index.patch/delete, meeting-report, send-invitation,
  import-mymeet — scope по вакансии интервью (interview→application.jobId).
- **analytics/jobs/[id]{,/candidates}** — job-scope (чужая вакансия → 404).
- **Переписка (chat) — модель записи (§G2):**
  - Чтение (`conversations/[id]/link-options,suggest.get/post,read.post`,
    `unread-count`, `unread-stream`) — `requireConversationInScope` (+ фильтр
    счётчиков по scope).
  - Запись (`messages.post`, `link.post`, `assistant.patch`, `drafts`) —
    `requireConversationWrite`: owner/admin ИЛИ lead_recruiter + job_member
    (recruiter) на вакансии диалога; иначе 403. `read.post` («прочитано») —
    разрешён всем в scope (маркер, не письмо).
  - UI: композер read-only без права (флаг `canWrite` из API).

**Не тронуто (по требованию):** обсуждение (`applications/[id]/comments/*`) —
доступно всем в scope; HM-контур (`hm/*`, `requireHm`+`isHiringManagerOnJob`);
job-роль `recruiter` (`job_member`); webhook-и по секрету.
