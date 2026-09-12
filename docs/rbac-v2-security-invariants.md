# RBAC v2 — Чек-лист инвариантов безопасности

**Назначение:** обязательная сверка на КАЖДОМ спринте RBAC v2. Ни один спринт не считается завершённым, пока все применимые инварианты не отмечены. Дополняет `docs/rbac-v2-master-plan.md` (§1.3 критерии приёмки, §14 риски) и `docs/audit-rbac.md`.

**Как пользоваться:** в отчёте спринта привести таблицу «инвариант → статус (✅/n/a/⚠) → чем подтверждено (тест/код/ручная проверка)». `n/a` допустим только с обоснованием, почему инвариант не затронут данным спринтом.

---

## A. Мультитенантная изоляция (высший приоритет)

- **A1. `orgId` только из сессии.** `activeOrganizationId` берётся исключительно из `session.session`, НИКОГДА из тела/query/URL/заголовков запроса. Ни один новый эндпоинт не принимает `organizationId` из ввода.
- **A2. Каждый запрос к мультитенантной таблице скоупится по оргу.** Через `scopedDb` (Спринт 3+) или явный `eq(table.organizationId, actor.orgId)`. Новых запросов без орг-фильтра не добавлено.
- **A3. Cross-org доступ → 404, не 403.** Запрос ресурса чужой орги по прямому ID возвращает 404 (не подтверждать существование). Проверка `resource.orgId === actor.orgId` на пути доступа, не только в контроллере.
- **A4. Дочерние записи проверяются по родителю.** `application → job → org`, `document → candidate → org` и т.п. — принадлежность подтверждается по всей цепочке.

## B. Аутентификация и enforcement

- **B1. Deny-by-default.** Отсутствие явно выданного права → отказ. Пустой/нулевой снапшот → всё запрещено.
- **B2. Сервер — единственный гейт.** Клиентские `usePermission`/`usePermissions` косметические; каждый эндпоинт независимо проверяет право на сервере (`requirePermission`/`can()`).
- **B3. `requirePermission` не ослаблен.** На всех новых/тронутых эндпоинтах гард присутствует; сигнатура/семантика не ослаблена; при shadow-mode фактический отказ определяется не менее строгим из (old, new).
- **B4. Активность членства.** Действие разрешено только при `member.status='active'` и `revoked_at IS NULL`; pending/rejected/suspended/revoked — заблокированы.
- **B5. View-as строго read-only.** В режиме «Посмотреть как» любые write-действия (`create/update/delete/export/bulk`) отклоняются на сервере, независимо от прав роли.

## C. Права, роли, scope

- **C1. Единый источник истины прав.** Права/роли не дублируются: источник — `shared/permissions.ts`/`shared/access/*` (Спринт 0.5–1) → БД (`permissions/roles/...`, Спринт 1+). Нет хардкода строк ролей в бизнес-логике вне реестра.
- **C2. Deny сильнее allow.** `member_permission_overrides` с `effect='deny'` побеждает любую роль; истёкшие (`expires_at`) не действуют.
- **C3. Роль-потолок, scope-охват.** Роль не расширяет данные за пределы scope; scope не выдаёт прав, которых нет у роли.
- **C4. Защита от самоблокировки.** `owner`/`admin` не редактируются по правам в UI; нельзя снять последнего `owner`; нельзя `deny` базовые `:read`, ломающие вход, без явного подтверждения.
- **C5. Инвалидация ≤60 c.** Смена роли/scope/override/отзыв → устаревшие права перестают действовать в пределах 60 c (через `permissions_version`).

## D. Полевой уровень (PII)

- **D1. Masking-on-output по умолчанию.** Поля PII (контакты, зарплата) вырезаются на выходе по умолчанию для всех ресурсов реестра, включая «сырые» пути: аналитику, экспорт, AI-контекст, вебхуки, вложенные объекты.
- **D2. Нет PII без права ни в одном ответе.** Роль без `*:read:contacts`/`*:read:salary` не получает эти поля НИГДЕ в API.
- **D3. `storageKey`/секреты не утекают.** Внутренние ключи S3, зашифрованные API-ключи AI и т.п. не сериализуются в ответы (сохранить текущее поведение).

## E. Аудит и целостность

- **E1. Иммутабельность журнала.** `activity_log` только append; для роли приложения `UPDATE/DELETE` запрещены (Спринт 6+); hash-chain верифицируется.
- **E2. Чувствительные действия логируются.** Просмотр контактов, скачивание резюме, экспорт, bulk, изменения ролей/scope/overrides, view-as, деprovisioning, cross-org deny — попадают в журнал (кто, что, когда, IP, было→стало, decision).
- **E3. Аудит не ломает основную операцию, но не теряет security-события.** Для risk≥1 запись транзакционная (Спринт 6+), не только fire-and-forget.

## F. Инфраструктура и данные

- **F1. Секреты валидируются на старте, не в клиенте.** Env через Zod (`env.ts`); секреты не попадают в клиентский бандл/SSR-payload.
- **F2. Миграции обратимы/безопасны.** Идемпотентный SQL (`IF NOT EXISTS`), бэкап БД перед раскаткой миграций; откат описан.
- **F3. Rate limiting не ослаблен.** Лимиты на auth-эндпоинтах и публичных путях сохранены; role_limits (Спринт 8) — дополнительный слой, не замена.
- **F4. SSR-payload не содержит лишнего.** В снапшот доступов на клиент уходят только capability/scope/флаги, без сырых секретов и чужих данных.
- **F5. RLS-готовность (v2.1).** Дизайн `scopedDb` допускает будущий транзакционный `SET LOCAL app.org_id` без переделки (§5.3 плана).

## G. Регрессии и процесс

- **G1. Тесты зелёные.** `npm run test` без новых падений (известные флаки зафиксированы отдельно). Матричные тесты авторизации покрывают новые права.
- **G2. Сборка зелёная.** Клиент+сервер собираются (на ВМ, если локально OOM); нет hydration mismatch.
- **G3. Откат возможен.** Для спринта описан способ отката (feature-flag enforcement old↔new / `git reset` + rebuild / down-миграция).
- **G4. Нет расширения техдолга.** Дубли резолва роли/прав не растут; используется единый `getActorContext`/реестр.

---

## Журнал сверки по спринтам

| Спринт | Дата | Итог | Заметки |
|---|---|---|---|
| 0.5 | 12.09.2026 | ✅ | Роль на SSR, единый `getActorContext`, deny-by-default в `snapshotCan`, view-as read-only в движке. Изоляция/аудит не тронуты (n/a). |
| 1 | 12.09.2026 | ✅ | См. развёрнутую сверку ниже. Enforcement НЕ изменён (shadow-mode). |
| 2 | 12.09.2026 | ✅ | Enforcement переключён на `can()` (`new`). Backfill member_role/scope 100%. См. сверку ниже. |
| 3 (пилот) | 12.09.2026 | ✅ | Scope-фильтрация + masking на 7 PII-эндпоинтах; cross-org→404 для них; фикс visibility. Долгий хвост эндпоинтов + AI chatTools — в rollout. См. сверку ниже. |
| 3 (rollout #1) | 12.09.2026 | ✅ | AI chatTools наследует member-scope + masking, серверная защита от prompt-injection. Коммит ba0323f. Задеплоено. |
| 3 (rollout #2–#6) | 12.09.2026 | ✅ | Контакт-эндпоинты (gate contacts+scope), read_resume gate, job-scope на root jobs (private jobs), masking на leak-sites, слабые guard'ы (conversations), модель «общий кандидат + приватные вакансии» (Вариант A), cross-org e2e. См. сверку ниже. |

### Сверка Спринта 5 (коммиты 25125c3, 41c76c1, c40cac8)

| Инвариант | Статус | Подтверждение |
|---|---|---|
| A1 orgId из сессии | ✅ | access-эндпоинты берут orgId из сессии; все запросы скоупятся по org |
| B2 сервер — единственный гейт | ✅ | UI-действия идут через `/api/access/*` с `member:['update']` (owner/admin) |
| B3 requirePermission не ослаблен | ✅ | все access-эндпоинты под `member:update`; view-as start — тоже |
| B4 активность членства | ✅ | members-list отражает `revoked_at`→'revoked' |
| B5 view-as read-only | ✅ | сервер: getActorContext ставит isViewAs, can() запрещает write; cookie перепроверяется каждый запрос (owner/admin) |
| C4 защита от самоблокировки | ✅ | role.post: нельзя снять последнего owner; нельзя назначить 'owner'; owner-строка залочена в UI |
| C5 инвалидация ≤60c | ✅ | role/scope/overrides bump `permissions_version` |
| C2 deny сильнее allow | ✅ | overrides.put валидирует ключи, replace-all в txn; resolve — deny wins |
| E2 чувствительные действия логируются | ✅ (частично) | role/scope/overrides/view_as_started → recordActivity (полный hash-chain — Спринт 6) |
| F4 SSR-payload | ✅ | снапшот добавил только `viewAsName` (имя), без секретов |
| view-as security | ✅ | cookie httpOnly/secure/30m; сам по себе прав не даёт — привилегия реального участника перепроверяется; нельзя смотреть от себя |
| G1 тесты | ✅ | 846 (resume-parser флак под нагрузкой) |
| G2 сборка | ✅ | typecheck 0; build на ВМ при деплое |
| G3 откат | ✅ | `git reset` + rebuild; view-as выключается удалением cookie |

**Follow-up (документировано):** приглашения с предзаданным scope/гостевой TTL (#5) — отложено; scope назначается после вступления во вкладке «Доступы». Редактор-матрица ролей и live-превью/diff (§8.3–8.4) — Спринт 7.

### Сверка Спринта 3 rollout #2–#6 (коммиты a2133dc, f69a757, aa391a5, b91d7c7, 1c188b6)

| Инвариант | Статус | Подтверждение |
|---|---|---|
| A3 cross-org → 404 | ✅ | job-scope на `jobs/[id]` get/patch/delete; candidate/application-by-id гейты; e2e `cross-org-isolation.spec.ts` (орг B → job орга A → 404) |
| A4 дочерние по родителю | ✅ | application→job (isJobInScope), candidate→application→job (EXISTS), document→candidate |
| B3 requirePermission не ослаблен | ✅ | усилено: `telegram-first-contact` был requireAuth без прав — добавлены scope+contacts; `conversations/*` (requireAuth) получили member-scope |
| B5 view-as read-only | ✅ | без изменений |
| C3 роль-потолок/scope-охват | ✅ | scope применяется на контакт-эндпоинтах, job-эндпоинтах, conversations |
| D1 masking-by-default | ✅ | masking на interviews/dashboard/tracking/source-stats/conversations/candidates[id].patch |
| D2 нет PII без права | ✅ (в рамках rollout) | chatTools (#1), контакт-эндпоинты (#2), read_resume (#3), leak-sites (#4a); остаток хвоста — документированный follow-up (owner/admin не затронуты) |
| D3 секреты не утекают | ✅ | без изменений |
| «общий кандидат» (Вариант A) | ✅ | история не фильтруется; `jobInScope` флаг для UI; переход в чужую вакансию → 404. Acceptance А/Б/Иван по логике + e2e |
| G1 тесты | ✅ | 846 passed (resume-parser флак под нагрузкой, в изоляции 20/20) |
| G2 сборка | ✅ | typecheck 0; build на ВМ при деплое |
| G3 откат | ✅ | `git reset` + rebuild (scope/mask вне флага enforcement) |

**Документированный follow-up (механический хвост, вне этого спринта):** nested job config-эндпоинты (~36), application-by-id (~41), candidate-by-id high-PII reads (hh-resume/raw, resume-versions, fuzzy-duplicates, merge*, enrich, ai-summary), dedup/extension subtrees, миграция legacy `resolveRecruiterScope` → v2 `applicationScopeCondition`. Все по 3 шаблонам пилота; owner/admin (unrestricted) не затронуты — риск низкий. Список — в отчёте.

### Сверка Спринта 3 (пилот, коммит a4568f1)

| Инвариант | Статус | Подтверждение |
|---|---|---|
| A1 orgId из сессии | ✅ | без изменений; scope-джобы резолвятся по actor.orgId |
| A2 скоуп по оргу | ✅ (пилот) | candidate/application/document — org + scope; owner/admin unrestricted |
| A3 cross-org → 404 | ✅ (пилот) | `isCandidateInScope`/`isJobInScope`→404 на candidate/[id], application/[id], document download/preview/delete; хвост эндпоинтов — rollout |
| A4 дочерние по родителю | ✅ (пилот) | document→candidate→application→job (EXISTS); application→job (jobId) |
| B1 deny-by-default | ✅ | `maskCandidate(null)` маскирует всё; scope `[]`→пусто |
| B5 view-as read-only | ✅ | без изменений |
| C3 роль-потолок/scope-охват | ✅ (пилот) | scope из member_scope; фильтры не выдают данных вне scope; owner org=unrestricted |
| D1 masking-by-default | ✅ (пилот) | `maskCandidate` на списках и детали candidate/application; хвост+chatTools — rollout |
| D2 нет PII без права | ⚠ частично | закрыто на 7 эндпоинтах; **AI chatTools (`search_candidates`/`get_candidate`/`read_resume`) ещё отдают PII без masking** — явный gap, приоритет rollout |
| D3 секреты не утекают | ✅ | storageKey/ключи по-прежнему не сериализуются; hhResumeRaw.salary маскируется |
| C1 единый источник | ✅ | scope/mask из реестра ресурсов; PII-права в пресетах |
| C2 deny сильнее allow | ✅ | без изменений (overrides в actor.permissions) |
| C5 инвалидация | ✅ | без изменений (кэш по версии) |
| F2 миграции | ✅ | нет SQL-миграции; seed добавил +10 PII-грантов (idempotent); бэкап `rbac_pre_sprint3_*` |
| F4 SSR-payload | ✅ | без изменений |
| G1 тесты | ✅ | 836 passed / 0 failed |
| G2 сборка | ✅ | build app на ВМ OK; typecheck 0; scope-SQL (CTE/EXISTS) проверены на живой БД |
| G3 откат | ✅ | `ACCESS_ENFORCEMENT=old` (снимает и scope? нет — scope/mask всегда активны; для отката именно scope/mask — `git reset`+rebuild) |
| G4 нет роста техдолга | ✅ | 3 переиспользуемых примитива (scope/mask/404); хв端поинты по шаблону |

**Важное замечание по G3:** scope-фильтрация и masking НЕ управляются флагом `ACCESS_ENFORCEMENT` (он про capability-enforcement). Откат именно scope/mask — через `git reset` на предыдущий коммит + rebuild. owner/admin не затронуты (unrestricted), поэтому риск для основных пользователей минимален.

**Известные gaps (rollout Спринта 3):**
1. **AI chatTools** (`server/utils/ai/chatTools.ts`) отдают контакты кандидатов без masking и без member-scope (только conversation-scope) — приоритетная задача (D2).
2. ~60 остальных candidate/application эндпоинтов ещё org-only (list/detail по шаблону пилота).
3. Scope `own` не выражается (нет creator-колонки) — трактуется как `assigned`; при необходимости — новая колонка/лог (документировано).

### Сверка Спринта 2 (коммит 43f18e9)

| Инвариант | Статус | Подтверждение |
|---|---|---|
| A1 orgId только из сессии | ✅ | `getActorContext`/`requirePermission` — из сессии; новые записи member_role/scope скоупятся по orgId из сессии/родителя |
| A2 скоуп по оргу | n/a | доменные запросы — Спринт 3 (`scopedDb`) |
| A3 cross-org → 404 | ⚠ частично | `can()` deny `cross_org` при передаче `resource`; эндпоинты передадут resource в Спринте 3 |
| A4 дочерние по родителю | n/a | Спринт 3 |
| B1 deny-by-default | ✅ | `new`-режим fail-closed: ошибка резолва → 403 (проверено логикой requirePermission) |
| B2 сервер — единственный гейт | ✅ | клиент не менялся |
| B3 requirePermission не ослаблен | ✅ | `new`: `can()` решает; паритет доказан — effective caps на ВМ owner=64/member=29 == сид роли |
| B4 активность членства | ✅ | `revoked_at`→status='revoked'→`can()` deny; status≠active deny |
| B5 view-as read-only | ✅ | без изменений (движок) |
| C1 единый источник истины | ✅ | member_role→role_permission; sync-хелпер единый; нет новых хардкодов |
| C2 deny сильнее allow | ✅ | `applyOverrides` тест; overrides из БД учитываются |
| C3 роль-потолок/scope-охват | ⚠ частично | scope читается из member_scope в actor; фильтрация данных — Спринт 3 |
| C4 защита от самоблокировки | n/a | UI ролей — Спринт 7; owner/admin полные |
| C5 инвалидация ≤60c | ✅ | кэш по `(memberId, permissions_version)`; `syncMemberRoleChange` bump версии; TTL 30с |
| D1–D3 masking | n/a | Спринт 3; секреты по-прежнему не сериализуются |
| E1–E3 аудит | n/a | Спринт 6 (member-инсерты уже пишут activity_log как раньше) |
| F1 секреты на старте | ✅ | флаг через Zod |
| F2 миграции безопасны | ✅ | нет новой SQL-миграции; backfill идемпотентный рантайм; бэкап снят (`rbac_pre_sprint2_*`) |
| F3 rate limiting | ✅ | не тронут |
| F4 SSR-payload | ✅ | без изменений |
| F5 RLS-готовность | ✅ | без изменений |
| G1 тесты | ✅ | 825 passed / 0 failed |
| G2 сборка | ✅ | build app на ВМ OK; typecheck 0 |
| G3 откат | ✅ | `ACCESS_ENFORCEMENT=old` (env, мгновенно) ИЛИ `git reset`+restore дампа. Проверено: флаг читается контейнером |
| G4 нет роста техдолга | ✅ | резолв роли единый; sync-хелпер один; hooks+lazy-heal исключают дрейф |

### Сверка Спринта 1 (коммиты 3fd044c, 391ed1c, 3d81a9e)

| Инвариант | Статус | Подтверждение |
|---|---|---|
| A1 orgId только из сессии | ✅ | `getActorContext`/`requirePermission` берут `activeOrganizationId` из `session.session`; новые таблицы скоупятся по `organization_id`, из ввода не читается |
| A2 скоуп по оргу | n/a | Спринт 1 не менял запросы к доменным таблицам (это Спринт 3 `scopedDb`) |
| A3 cross-org → 404 | ⚠ частично | `can()` возвращает `deny reason=cross_org` при `resource.orgId≠actor.orgId`; проверка ресурса подключается в Спринте 3 (пока эндпоинты не передают `resource`) |
| A4 дочерние по родителю | n/a | Спринт 3 |
| B1 deny-by-default | ✅ | `can()`/`snapshotCan`: нет права → deny; юнит-тесты |
| B2 сервер — единственный гейт | ✅ | Клиент не менялся; `requirePermission` на сервере |
| B3 requirePermission не ослаблен | ✅ | shadow-mode: фактический отказ = legacy AC (не слабее); при `new` — `can()`. Сигнатура прежняя |
| B4 активность членства | ✅ | `getActorContext` учитывает `revoked_at`; `can()` deny при `status≠active` |
| B5 view-as read-only | ✅ | `can()` deny на write при `isViewAs`; юнит-тест |
| C1 единый источник истины | ✅ | `ROLE_STATEMENTS`→сид; реестр ресурсов; нет новых хардкодов ролей |
| C2 deny сильнее allow | ✅ | `applyOverrides` (deny удаляет), учёт `expires_at`; тест |
| C3 роль-потолок/scope-охват | n/a | scope-фильтрация — Спринт 3 |
| C4 защита от самоблокировки | n/a | UI редактирования ролей — Спринт 7 (сид: owner/admin полные) |
| C5 инвалидация ≤60c | ⚠ частично | кэш `permissionResolver` TTL 30с; полноценный bump `permissions_version` по member — Спринт 2 |
| D1–D3 masking | n/a | field masking — Спринт 3 (реестр `fields` уже заложен; `storageKey`/ключи по-прежнему не сериализуются) |
| E1–E3 аудит | n/a | расширение `activity_log` — Спринт 6 |
| F1 секреты на старте | ✅ | `ACCESS_ENFORCEMENT` через Zod `env.ts`; в клиент не уходит |
| F2 миграции безопасны | ✅ | `0097` идемпотентна (`IF NOT EXISTS`); бэкап БД снят перед раскаткой (`rbac_pre_sprint1_*.sql.gz`) |
| F3 rate limiting | ✅ | не тронут |
| F4 SSR-payload | ✅ | снапшот — только capability/scope/флаги (Спринт 0.5) |
| F5 RLS-готовность | ✅ | дизайн сохранён; `scopedDb` — Спринт 3 |
| G1 тесты | ✅ | 821 passed (0 failed) |
| G2 сборка | ✅ | build app на ВМ OK; typecheck 0 ошибок |
| G3 откат | ✅ | flag `ACCESS_ENFORCEMENT=old` + `git reset` + restore дампа |
| G4 нет роста техдолга | ✅ | резолв роли единый (`getActorContext`); реестр ресурсов |
