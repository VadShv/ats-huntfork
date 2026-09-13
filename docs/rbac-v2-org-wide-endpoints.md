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
