# ТЗ · Кросс-раздел · Сквозные требования модуля вопросов (Спринты 0–5)

> **Часть:** мастер-план `tz-questions-00-master-plan.md`
> **Тип:** сквозной документ (cross-cutting) — консолидирует общие требования, на
> которые ссылаются ТЗ отдельных спринтов.
> **Зависит от:** ничего (описывает конвенции). **Обязателен для:** всех спринтов 0–5.
> **Статус:** черновик на согласование
> **Связанные документы:**
> - `tz-questions-00-master-plan.md` — мастер-план (§7 «Основные риски» разворачивается здесь в §12)
> - `tz-questions-01-org-bank.md` — Спринт 0–1 (эталон тона/глубины)
> - `tz-questions-02-care.md` … `tz-questions-05-mymeet-reports.md` — спринты 2–5
> - `docs/rbac-v2-master-plan.md` — ролевая модель проекта (конвенции прав)
> - `docs/role-model-and-permissions.md` — текущая матрица org-ролей
> - `docs/plan-ui-unification.md` — design-system (`Ui*`, токены)

---

## 1. Заголовок и назначение (применимо ко всем спринтам)

Документ фиксирует **единые правила**, которые дублировались бы в каждом ТЗ
спринта: права и мультитенантность, общий util нормализации, версионирование и
иммутабельность, AI-соглашения, конвенции миграций/i18n/design-system, стратегия
тестирования, нефункциональные требования, консолидированный реестр рисков и общий
Definition of Done. ТЗ спринтов **ссылаются** сюда, а не переписывают.

Принцип чтения: если требование встречается в двух и более спринтах — оно **здесь**;
если оно уникально для спринта — оно в ТЗ спринта. При конфликте формулировок
**приоритет у этого документа** (кросс-раздел — источник истины для сквозных правил),
кроме случаев, где ТЗ спринта явно ужесточает правило.

Таблица покрытия спринтов сквозными разделами:

| Раздел кросс-документа | S0 | S1 | S2 | S3 | S4 | S5 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| §2 Права `questionBank` | ✔ (заводит) | ✔ | ✔ | ✔ | ✔ | ✔ |
| §3 Мультитенантность/изоляция | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| §4 `normalizeQuestion` | ✔ (выносит) | ✔ | — | ✔ | ✔ | — |
| §5 Версионирование/иммутабельность | — | ✔ | ✔ | ✔ | ✔ | ✔ |
| §6 AI-инфраструктура | — | ✔ | ✔ | ✔ | ✔ | ✔ |
| §7 Миграции | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| §8 i18n | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| §9 Design-system | — | ✔ | ✔ | ✔ | ✔ | ✔ |
| §10 Тестирование | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| §11 NFR | — | ✔ | ✔ | ✔ | ✔ | ✔ |
| §12 Риски | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| §13 Definition of Done | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

---

## 2. Ролевая модель и права — консолидированная сводка

### 2.1. Как устроены права в проекте (ground truth)

Единый источник истины — `shared/permissions.ts`. Файл импортируется и сервером
(`server/utils/auth.ts`), и клиентом, поэтому роли/стейтменты всегда синхронны.
Ключевые структуры:

| Структура | Файл:строки | Роль |
|---|---|---|
| `atsStatements` | `shared/permissions.ts:30-50` | Реестр ATS-ресурсов → массив допустимых actions. `as const` обязателен для вывода типов. |
| `statements` (merged) | `shared/permissions.ts:53-56` | `{ ...defaultStatements, ...atsStatements }` — better-auth defaults (`organization/member/invitation/team/ac`) + наши ресурсы. Из него типизируется `requirePermission`. |
| `ac` | `shared/permissions.ts:59` | `createAccessControl(statements)`. |
| raw-карты ролей | `shared/permissions.ts:75-165` | `ownerAtsStatements` (`:75-90`), `adminAtsStatements` (`:92-107`), `memberAtsStatements` (`:109-128`), `hiringManagerAtsStatements` (`:152-165`) — «только ATS»-права каждой роли. |
| `ac.newRole(...)` | `shared/permissions.ts:130-170` | owner (`:130`), admin (`:135`), member (`:140`), hiringManager (`:167`) — слияние better-auth defaults роли с ATS-картой. |
| `ROLE_STATEMENTS` | `shared/permissions.ts:204-210` | `{ owner, admin, member, hiring_manager }` = `{ ...<роль>DefaultStatements, ...<роль>AtsStatements }` — **полный** merged-реестр для развёртки capability. **То же слияние, что `ac.newRole()`** → shadow-parity. |
| `expandRoleCapabilities` | `shared/access/capabilities.ts:72-82` | Разворачивает `ROLE_STATEMENTS[role]` в плоский набор строк `resource:action`. Именно этот набор проверяет `can()` и клиентский `usePermissions`. |
| `requirePermission` | `server/utils/requirePermission.ts:44-129` | Единственный гуард роутов. В режиме `env.ACCESS_ENFORCEMENT` (`old`/`shadow`/`new`) решает legacy-AC и/или `can()`. |

**Вывод (критично для всех спринтов):** чтобы новый ресурс `questionBank` реально
проверялся, его нужно добавить **и** в `atsStatements` (для типов
`requirePermission`), **и** в raw-карту каждой роли (owner/admin/member/hiringManager),
потому что `ROLE_STATEMENTS` (`:204-210`) собирается именно из raw-карт, а
`expandRoleCapabilities` (`capabilities.ts:72`) читает `ROLE_STATEMENTS`.
Добавления только в `atsStatements` **недостаточно** — роль не получит право.

### 2.2. Новые ресурсы/actions по всем спринтам

Один ресурс на весь модуль — `questionBank`. Гранулярность действий покрывает все
операции спринтов 1–5.

| Ресурс | Actions | Вводится | Используется в спринтах |
|---|---|---|---|
| `questionBank` | `view`, `create_draft`, `edit_draft`, `publish`, `archive`, `manage_topics`, `manage_care`, `manage_reports` | S0 (базовый набор) → расширяется в S2/S5 | S1 (темы/вопросы/публикация), S2 (`manage_care`), S3 (пресеты — под `edit_draft`/`publish`), S4 (опросник читает `view`), S5 (`manage_reports`) |

Семантика actions:

| Action | Что разрешает | Спринт-владелец |
|---|---|---|
| `view` | Читать банк: темы, шкалы, BARS, вопросы, пресеты, CARE, шаблоны отчётов, карту вакансии. | S1 |
| `create_draft` | Создавать черновик вопроса (`status='draft'`); запускать AI-генерацию вопросов темы. | S1 |
| `edit_draft` | Править **любой** черновик (не только свой), в т.ч. probes и пресеты-черновики. | S1/S3 |
| `publish` | Публиковать вопрос/пресет (перевод draft→published), создавать новую версию. | S1/S3 |
| `archive` | Soft-архивация вопроса/темы/пресета (без физического удаления). | S1 |
| `manage_topics` | CRUD тем оценки, шкал (`assessment_scale`), BARS-якорей (`bars_anchor`). | S1 |
| `manage_care` | Править методику CARE (`care_methodology`) и её промпты. | S2 |
| `manage_reports` | CRUD библиотеки шаблонов отчётов (`report_template`), пометка `isDefault`. | S5 |

> **Правка своих черновиков рекрутёром.** Рекрутёр (`member`) получает `create_draft`,
> но **не** `edit_draft`. Право «править **свой** черновик» реализуется **ABAC-условием
> в хендлере**: `create_draft` ∧ `bank_question.createdById === session.user.id`.
> Это не отдельный action — это проверка владения поверх `create_draft` (см. образец
> ABAC «свои заметки» в `rbac-v2-master-plan.md §5.6`). Именно так S1 §1.7 трактует
> «редактирует свои».

> **Про `risk` как ресурс (техдолг, необязательно).** Риск-эндпоинты сейчас
> переиспользуют `scoring:['create']` (`assessRisk.ts`, `risk/worker.ts` — мастер-план
> §2). В рамках модуля вопросов **это не трогаем** — риски уже работают и
> переиспользуются S4 как готовые `findings[]`. Отдельный ресурс `risk` фиксируется
> как **опциональный техдолг**: заводится только если понадобится гранулярность
> (например, отделить «видеть риски» от «править скоринг»). До появления явной
> потребности — не вводим (правило «модерация лёгкая, без over-engineering», §12).

### 2.3. Полная матрица прав `questionBank`

Строки — actions, столбцы — роли. `✔` — разрешено; `✔*` — разрешено с ABAC-условием
владения; `—` — запрещено (deny-by-default).

| Action | owner | admin | member (рекрутёр) | hiringManager (НМ) |
|---|:--:|:--:|:--:|:--:|
| `view` | ✔ | ✔ | ✔ | ✔ (read-only) |
| `create_draft` | ✔ | ✔ | ✔ | — |
| `edit_draft` | ✔ | ✔ | ✔* (только свой черновик, через ABAC) | — |
| `publish` | ✔ | ✔ | — | — |
| `archive` | ✔ | ✔ | — | — |
| `manage_topics` | ✔ | ✔ | — | — |
| `manage_care` | ✔ | ✔ | — | — |
| `manage_reports` | ✔ | ✔ | — | — |

Формулировка политики словами:
- **owner / admin** — всё (полный контроль справочника, публикация, методика, отчёты).
- **member (рекрутёр)** — `view` + `create_draft` + правка **своих** черновиков; НЕ публикует,
  НЕ архивирует, НЕ ведёт темы/CARE/отчёты.
- **hiringManager (НМ)** — только `view` (read-only везде, как и по всей системе,
  `permissions.ts:152-165`). Замечание: HM не зарегистрирован в клиентском AC
  (`role-model-and-permissions.md §4`), но `ROLE_STATEMENTS.hiring_manager`
  (`permissions.ts:209`) даёт `view` серверно — новые серверные проверки корректны.

### 2.4. Точные изменения в коде (как добавить `questionBank`)

**Шаг 1 — реестр `atsStatements` (`shared/permissions.ts:30-50`).** Добавить строку
(для типизации `requirePermission`):

```ts
const atsStatements = {
  organization: ['read', 'update', 'delete'],
  // …существующие…
  assistant: ['access', 'send', 'scopeOrg', 'reasoning', 'agents', 'selectModel', 'suggest'],
  // ── Модуль вопросов (S0) ──
  questionBank: ['view', 'create_draft', 'edit_draft', 'publish', 'archive', 'manage_topics', 'manage_care', 'manage_reports'],
} as const
```

**Шаг 2 — raw-карты ролей** (owner/admin — всё; member — усечённо; HM — только view):

```ts
// ownerAtsStatements (:75-90)  — добавить:
questionBank: ['view', 'create_draft', 'edit_draft', 'publish', 'archive', 'manage_topics', 'manage_care', 'manage_reports'],

// adminAtsStatements (:92-107) — идентично owner:
questionBank: ['view', 'create_draft', 'edit_draft', 'publish', 'archive', 'manage_topics', 'manage_care', 'manage_reports'],

// memberAtsStatements (:109-128) — только view + create_draft + edit_draft:
questionBank: ['view', 'create_draft', 'edit_draft'],

// hiringManagerAtsStatements (:152-165) — только view:
questionBank: ['view'],
```

**Шаг 3 — ничего больше.** `ac.newRole()` (`:130-170`) читает те же raw-карты →
better-auth AC обновится автоматически. `ROLE_STATEMENTS` (`:204-210`) собран из raw-карт
→ `expandRoleCapabilities` (`capabilities.ts:72`) развернёт `questionBank:*`
автоматически. Тип `PermissionRequest` в `requirePermission.ts:14-16` выводится из
`statements` → `requirePermission(event, { questionBank: ['publish'] })` типобезопасен.

> **Важно про `edit_draft` у member.** Мы даём member `edit_draft` в capability, но
> хендлер `PATCH /questions/[id]` **дополнительно** проверяет владение для member
> (ABAC, §2.2). Так capability-матрица остаётся простой, а тонкое правило «свой
> черновик» живёт в одном месте — в хендлере. Альтернатива (не давать `edit_draft`
> вовсе и открывать правку через `create_draft`) сложнее для тестов — **не выбрана**.

**Шаг 4 — тест паритета.** `access-seed-parity.test.ts` (уже есть) проверяет, что
DB-сид ролей совпадает с `ROLE_STATEMENTS`. При добавлении `questionBank` в статический
реестр обновить сид ролей RBAC v2 (если DB-роли активны) и прогнать этот тест — иначе
`shadow`/`new`-режим `requirePermission` разойдётся (см. §10.4).

### 2.5. Обязательное правило для каждого эндпоинта

Каждый новый эндпоинт модуля начинается с двух вещей:

1. `const session = await requirePermission(event, { questionBank: ['<action>'] })`
   — гуард прав (`requirePermission.ts:44`). 401 без сессии, 403 без права.
2. Скоуп по `session.session.activeOrganizationId` — **каждый** SQL-запрос содержит
   `eq(<table>.organizationId, orgId)` (см. §3). `activeOrganizationId` гарантирован
   гуардом (`requirePermission.ts:58-62` кидает 403 без активной орг).

**403 без утечки существования.** Для org-scoped ресурсов ответ на «нет права» — 403
с нейтральным текстом («Нет доступа: недостаточно прав», `requirePermission.ts:106`).
Для запроса **чужого/несуществующего** ID (IDOR) ответ — **404**, а не 403, чтобы не
подтверждать существование ресурса чужой орги (`rbac-v2-master-plan.md §5.4`,
`scope.ts` — `requireXInScope` кидают 404). Это разные случаи: 403 = «раздел закрыт»,
404 = «в вашей орге такого нет».

Ссылка на конвенции: `docs/rbac-v2-master-plan.md` — §3.4 (сохранение сигнатуры
`requirePermission`), §5.2 (порядок `can()`, deny-by-default), §5.4 (IDOR→404),
§6 (реестр ресурсов как единая точка расширения).

---

## 3. Мультитенантность и изоляция тенантов

### 3.1. Базовое правило

Все новые сущности модуля — **org-scoped** (мастер-план §5: «всё org-scoped по
`organizationId`»). Каждая таблица имеет `organizationId text notNull FK organization
cascade`, и **каждый** запрос (SELECT/UPDATE/DELETE/INSERT) фильтруется/проставляет
`organizationId = activeOrganizationId`. Забыть фильтр = утечка между тенантами.

Это самый крупный риск модуля (мастер-план §7.2): проект исторически job-scoped, а
модуль вводит **org-level** сущности с агрегатами поверх многих вакансий. Ошибка в
org-скоупе шире по радиусу поражения, чем ошибка в job-скоупе.

### 3.2. Зоны повышенной опасности

| Зона | Почему опасна | Митигация |
|---|---|---|
| **Агрегатные запросы** (матрица покрытия S3: тема×критерий; «топ вопросов»; счётчики Обзора S1; «темы без якорей») | `GROUP BY`/`COUNT` без `WHERE organizationId` соберёт данные всех орг в одну цифру/строку | `organizationId` — **первый** предикат в `WHERE`, до `GROUP BY`. Обязательный тест-изоляции на каждый агрегат. |
| **Cross-table JOIN** (вопрос→тема→шкала→якорь; пресет→секция→вопрос; опросник→snapshot→bank_question) | JOIN по FK без org-условия на **каждой** таблице стыка пропустит чужие строки, если FK случайно указывает вовне | org-условие на **каждой** таблице JOIN, не только на «корневой». |
| **Разыменование по ID из тела запроса** (`scaleIdOverride`, `sourceBankQuestionId`, `reportTemplateId`, `primaryTopicId`) | Клиент может подставить ID чужой орги | Перед привязкой — `SELECT … WHERE id = $id AND organizationId = $org`; нет строки → 404. |
| **AI-контекст** (промпт CARE/персонализации собирает вопросы/темы/якоря) | В промпт может утечь чужой вопрос, если сборка контекста не org-scoped | Сборщик промпта читает только org-scoped выборки; тест: контекст не содержит данных чужой орги. |
| **Snapshot опросника (S4)** | Слепок копирует данные банка — важно копировать только свою орг | Источник snapshot — org-scoped выборка; в самом snapshot org-принадлежность неявная (он внутри application своей орги). |

### 3.3. Переиспользуемые guard-хелперы

Для сущностей, привязанных к вакансии/отклику/интервью, использовать готовые
scope-guard'ы из `server/utils/access/scope.ts` — они уже решают и org-изоляцию, и
scope рекрутёра/HRBP, и возвращают **404** (не подтверждая существование):

| Хелпер | Файл:строки | Когда применять в модуле |
|---|---|---|
| `requireJobInScope(event, jobId)` | `scope.ts:243-248` | Карта вопросов вакансии (S3), любые `jobs/[id]/*`-эндпоинты модуля. |
| `requireApplicationInScope(event, appId, orgId)` | `scope.ts:256-272` | Персональный опросник (S4): `applications/[id]/questionnaire/*`. |
| `requireInterviewInScope(event, interviewId, orgId)` | `scope.ts:316-328` | Отчёт по интервью (S5), если привязан к `interview`. |
| `requireCandidateInScope` / `requireDocumentInScope` | `scope.ts:232-237` / `:302-310` | Если опросник/отчёт разыменовывает кандидата/документ. |

Правило: **org-only** сущности банка (`assessment_topic`, `bank_question`,
`question_preset`, `care_methodology`, `report_template`) фильтруются напрямую по
`organizationId` (у них нет job-scope — они видны всей орге при наличии `view`).
**Job/application-scoped** сущности (карта вакансии, опросник отклика) дополнительно
проходят `requireXInScope`, чтобы рекрутёр с ограниченным scope не увидел чужую вакансию.

### 3.4. Обязательные тесты изоляции

Для **каждого** нового листинг-/агрегат-/детально-эндпоинта — тест: «данные орги A не
видны из сессии орги B» (список, прямой ID→404, поиск, агрегат). Это часть DoD
каждого спринта (§10, §13). Эталон в проекте: `e2e/critical-flows/cross-org-isolation.spec.ts`
и unit-паттерн изоляции. Формулировка инварианта — `rbac-v2-master-plan.md §1.3 п.4`
(«ресурс чужой орги по прямому ID → 404, не 403»).

---

## 4. Общий util нормализации текста вопроса

### 4.1. Проблема (техдолг из мастер-плана §7.5)

Логика нормализации текста вопроса для дедупа **продублирована в 3 местах** с
идентичной, но независимо поддерживаемой реализацией:

| Место | Файл:строка | Текущая реализация |
|---|---|---|
| Детерминированная сборка набора | `server/utils/risk/buildCandidateQuestions.ts:40` | `normalizeQuestion(s)`: `toLowerCase().replace(/\s+/g,' ').replace(/[«»"'.,;:!?()]/g,'').trim()` |
| Генерация интервью-вопросов вакансии | `server/api/jobs/[id]/interview-questions/generate.post.ts:17` | `norm(s)`: та же логика, другое имя |
| Сборка набора отклика (инлайн) | `server/api/applications/[id]/question-set/generate.post.ts:108` | инлайн `i.text.toLowerCase().replace(/\s+/g,' ').trim()` — **упрощённая** (без пунктуации!) — расхождение поведения |

Третье место дедупит слабее (не срезает пунктуацию) → потенциальные дубли между
manual и сгенерированными элементами.

### 4.2. Решение — единый util (S0)

Создать `server/utils/text/normalizeQuestion.ts` — **единственный источник**:

```ts
/** Нормализация текста вопроса для дедупа: регистр, пробелы, пунктуация. */
export function normalizeQuestion(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[«»"'.,;:!?()]/g, '').trim()
}
```

Перевести все три места на импорт из него:
- `buildCandidateQuestions.ts:40` — удалить локальную, `export { normalizeQuestion } from '../text/normalizeQuestion'` для обратной совместимости импортов, либо переимпортировать.
- `interview-questions/generate.post.ts:17` — удалить `norm`, импортировать `normalizeQuestion`.
- `question-set/generate.post.ts:108` — заменить инлайн на `normalizeQuestion` (это **исправляет** расхождение — теперь пунктуация учитывается и здесь).

Новые места модуля (валидация «возможный дубль» S1 §1.4, дедуп AI-генерации S1 §1.5,
дедуп персонализации S4) используют **этот же** util. Никаких новых копий.

### 4.3. Тест

Unit `tests/unit/normalize-question.test.ts` (по образцу `dedup-normalize.test.ts`):
регистр, множественные пробелы, кавычки-ёлочки, пунктуация, идемпотентность
(`f(f(x)) === f(x)`), пустая строка. Обязателен в S0 (S0 §0.4, S1 §1.11).

---

## 4a. Ошибки и HTTP-коды — общие соглашения (фикс ревью №5)

Все эндпоинты модуля следуют единой карте ошибок. Спринт-доки не повторяют её —
ссылаются сюда; в ТЗ спринта указываются лишь **специфичные** бизнес-ошибки (422).

### 4a.1. Карта кодов

| Код | Когда | Тело / i18n |
|---|---|---|
| **400** | Невалидное тело/параметры (Zod `safeParse` провалился) | `{ statusCode, message, issues[] }`; сообщения из `errors.validation.*` |
| **403** | Нет права (`requirePermission` отклонил) | без раскрытия существования объекта, где чувствительно |
| **404** | Объект не найден **или** вне организации (IDOR) → **всегда 404**, не 403 | `errors.notFound.*`. Чужой org-объект неотличим от несуществующего |
| **409** | Конфликт состояния: мутация опубликованного/snapshot; уник-конфликт `code`; параллельная правка (optimistic lock) | `errors.conflict.*` + причина |
| **422** | Бизнес-правило: публикация невалидного вопроса; тема не `active`; шкала используется; сумма весов пресета ≠ 100; write-back в snapshot | `errors.rule.<name>` (перечислять в ТЗ спринта) |
| **429** | Rate-limit (AI/тяжёлые) | `createRateLimiter` message (`rateLimit.ts`) |
| **502** | Ошибка внешнего/LLM-вызова (провайдер/ MyMeet MCP) | `errors.upstream.*`; для фоновых — статус `failed` + `errorMessage` |
| **500** | Непредвиденное | generic; детали в лог, не клиенту |

### 4a.2. Обязательные правила

- **IDOR → 404, не 403** (§3.5): не раскрываем существование чужого объекта.
- **Валидация — Zod** на входе каждого эндпоинта; `issues[]` → фронт мапит в
  `errors[path]` (паттерн `jobs/[id]/settings.vue:291-329`).
- **i18n:** все тексты ошибок — ключи в `ru.json` (блок `errors.*` + модульные
  `questionBank.errors.*` / `application.questionnaire.errors.*`). Нет хардкода строк.
- **Конкурентные мутации (optimistic locking):** таблицы с ручной правкой
  (`bank_question`, `care_methodology`, `question_preset`, `applicationQuestionSet`)
  проверяют `updatedAt`/`version` из тела запроса против БД; несовпадение → **409**
  «объект изменён другим пользователем, обновите». Это закрывает сценарий «два
  рекрутёра/методолога правят одновременно» (ревью №5). Для генерации опросника
  двумя людьми одновременно — singleton по `applicationId` (pg-boss singletonKey,
  как `mymeet/worker.ts:38`) либо 409 на второй параллельный запуск.
- **Фоновые задачи (pg-boss):** ошибка не роняет HTTP — пишется в статус записи
  (`failed` + `errorMessage`), UI поллит и показывает.

---

## 5. Версионирование и иммутабельность — общие правила

### 5.1. Принципы (мастер-план §5, §3.8)

1. **Опубликованное иммутабельно.** Прямая правка опубликованной сущности запрещена;
   правка = **новая версия** (инкремент `version`, новая строка/новый черновик).
2. **Нет физического удаления** сущностей, участвовавших в оценке кандидата.
   Только **soft-archive** (`status='archived'`/`isArchived=true`). Причина: аудит
   решений по кандидату должен оставаться воспроизводимым.
3. **Snapshot** персонального опросника (S4) — слепок на момент подтверждения; при
   обновлении верхнего уровня показывается **баннер** «данные обновились», а не молчаливая
   перезапись (мастер-план §1, §3.8; риск §12).

### 5.2. Консолидированная таблица: что создаёт новую версию

| Сущность | Иммутабельна после | Что создаёт новую версию / как «меняется» | Физическое удаление | Спринт |
|---|---|---|---|---|
| `bank_question` | `status='published'` | Правка опубликованного → инкремент `version`, новый `status='draft'` (S1 §1.7). Черновик правится на месте. | Нет → `archive` (soft) | S1 |
| `assessment_topic` | — (справочник) | Правится на месте; вывод из оборота → `status='archived'` (с проверкой связей). | Нет → `archived` | S1 |
| `assessment_scale` / `bars_anchor` | пока используется опубликованным вопросом | Правка допустима; удаление шкалы **запрещено**, если на неё ссылается опубликованный вопрос (S1 §1.6 DELETE). | Нет, пока есть ссылки | S1 |
| `care_methodology` | версия, вошедшая в snapshot опросника | Правка = **новая версия** методики (версионируемая, мастер-план §5). Старые snapshot ссылаются на свою версию. | Нет | S2 |
| `question_preset` | `status='published'` | Правка опубликованного пресета → новая версия пресета. Импорт в вакансию фиксирует версию. | Нет → archive | S3 |
| `job_questionnaire_meta` (карта вакансии) | — | Ре-импорт/ре-адаптация = новая генерация; предыдущая карта заменяется, но связь `source_preset_version` фиксируется. | Замена (не оценка кандидата) | S3 |
| `applicationQuestionSet` (опросник) | **подтверждение** (snapshot) | Regenerate → **новая версия** набора, `source_snapshot(jsonb)` не затирается; ручные items и заполненные `answerNote`/`askStatus` сохраняются (см. `question-set/generate.post.ts:93-105`). | Нет (аудит решений) | S4 |
| `applicationQuestionItem` | внутри snapshot | Ручной item и заполненный ответ сохраняются при regenerate; регенерируемые — удаляются и пересоздаются. | Только регенерируемые | S4 |
| `report_template` | — | Правка на месте; `isDefault` — partial-unique (один default на орг). | Нет → archive | S5 |
| `meetingReport` | сгенерирован | Перегенерация = новый отчёт (или новая версия), исходный сохраняется для аудита. | Нет | S5 |

### 5.3. Правило баннера «устарело» (обязательно для S4, DoD)

Snapshot **без** индикатора устаревания опаснее отсутствия snapshot (мастер-план §7.3):
рекрутёр может готовиться по неактуальной повестке, не зная об этом. Требование:
- Опросник хранит ссылки на источники и **их версии** (bank_question.version, preset.version,
  care.version, resumeRisk.id).
- При расхождении текущей версии источника и версии в snapshot — **баннер** «данные
  обновились → перегенерировать» (не молчаливая перезапись).
- Regenerate — явное действие рекрутёра, создающее новую версию.

---

## 6. AI-инфраструктура — общие соглашения

### 6.1. Загрузка конфига: `loadAiConfig(orgId, { purpose })`

Все AI-вызовы модуля идут через `loadAiConfig` (`server/utils/ai/loadConfig.ts:25`).
Допустимые `purpose` (`loadConfig.ts:16`): **`chatbot` | `analysis` | `interactive` |
`structuring`**. Значения `'screening'` **нет** — не выдумывать. Раскладка по задачам модуля:

| Задача модуля | purpose | Обоснование | Спринт |
|---|---|---|---|
| AI-генерация вопросов темы | `analysis` | Аналитическая генерация (аналог `generateInterviewQuestions`). | S1 |
| CARE-структурирование вопроса | `structuring` | Структурный разбор формулировки по CARE. Fallback на `analysis`, если дефолт structuring не задан (`loadConfig.ts:59-65`). | S2 |
| Адаптация карты вакансии под бриф/описание | `analysis` | 1 проход, есть аналог `generateInterviewQuestions`. | S3 |
| Персонализация опросника (формулировки + probe) | `analysis` | Осмысленный проход поверх детерминированного каркаса. | S4 |
| Генерация отчёта по интервью (наш ассистент) | `analysis` | Более сильная модель, транскрипт + опросник + BARS + шаблон (мастер-план §3.9 поток Б). | S5 |

`loadAiConfig` уже устойчив: `preferId` → дефолт purpose → fallback (`interactive`/`structuring`
→ `analysis`) → любой конфиг → 422 с подсказкой «Настройки → ИИ» (`loadConfig.ts:29-76`).
Модуль **не** добавляет новых purpose (иначе миграция enum `ai_config_purpose` — не наш scope).

### 6.2. Устойчивый structured output: `generateStructuredOutput`

Все структурированные генерации — через `generateStructuredOutput`
(`provider.ts:367-466`). Обязательные приёмы для «богатых» схем модуля (CARE+probe+флаги):

| Приём | Где в `provider.ts` | Как применять в модуле |
|---|---|---|
| `JSON_ONLY_GUARD` | `:288`, добавляется автоматически к `system` (`:407`) | Ничего делать не нужно — гард встроен. |
| `extractJsonPayload` + recovery | `:253-281`, `:433-462` | При `NoObjectGeneratedError` ответ чинится из markdown-фенсов/грязного JSON и ревалидируется схемой. |
| `wrapBareArray` | опция `:376`, применяется в `:277-279`, `:434` | Передавать, если схема — объект-обёртка, а модель может вернуть голый массив: `items => ({ questions: items })`. |
| `.catch().default(...)`-гарды в Zod | — (на стороне схемы) | В Zod-схемах модуля каждое необязательное поле — `.catch(<дефолт>).default(<дефолт>)`, чтобы частичный ответ не рушил парсинг (образец `bankQuestion.ts`, S1 §1.4). |
| timeout 300 c | `:402` (`AbortController`, `300_000`) | Встроен; для длинных генераций (отчёт S5) закладывать async-путь (§6.5, §11). |
| `disableThinking` | опция `:384`, `:391-394` | Для чисто структурного вывода (CARE-структурирование) можно `disableThinking:true` — быстрее на reasoning-моделях. Персонализации/отчёту оставить thinking по умолчанию. |
| `temperature` | опция `:377`, дефолт `0.1` (`:412`) | Детерминированный каркас → низкая температура; персонализация формулировок допускает 0.2–0.3. |

Провайдеры: `provider.ts` поддерживает openai/anthropic/google/openai_compatible/
yandex/cloud_ru (`:18`, `PROVIDER_REGISTRY :45-157`). Модуль **провайдер-агностичен** —
работает через `ProviderConfig`, не завязывается на конкретного вендора.

### 6.3. Rate-limit новых AI-эндпоинтов

Каждый AI-эндпоинт модуля защищён `createRateLimiter` (`server/utils/rateLimit.ts:65`).
Эталон — `interview-questions/generate.post.ts:10-14` (**10/мин**, sliding window по IP).
Применять `await limiter(event)` **первой** строкой хендлера (до `requirePermission`),
как в `generate.post.ts:29`.

| Эндпоинт | Лимит | Спринт |
|---|---|---|
| `POST /question-bank/questions/generate` | 10/мин | S1 |
| `POST /question-bank/questions/[id]/structure-care` | 10/мин | S2 |
| `POST /jobs/[id]/questionnaire/adapt` | 10/мин | S3 |
| `POST /applications/[id]/questionnaire/generate` | 10/мин | S4 |
| `POST /applications/[id]/report/generate` | 5/мин (тяжелее) | S5 |

Замечание из `rateLimit.ts:13-20`: лимитер **per-process**, не шарится между репликами.
Self-hosted single-instance — ок; при горизонтальном масштабировании лимит выносится на
edge. Для модуля этого достаточно (защитный контур, не публичный API).

### 6.4. Graceful degradation до детерминированного каркаса

Ключевой инвариант надёжности (мастер-план §7.4): при отказе/невалидном ответе LLM
модуль **деградирует до детерминированного каркаса**, а не падает.

- **S1 AI-генерация вопросов** — при отказе LLM возвращаем понятную ошибку (генерация
  вручную остаётся); черновики не создаются частично-битыми.
- **S3 адаптация карты** — при отказе LLM карта собирается из пресета «как есть»
  (без адаптации формулировок), с пометкой «адаптация не выполнена».
- **S4 персонализация** — **обязательно**: детерминированный каркас (отбор из банка +
  risk-вопросы из `findings[]` + probe-структура) уже собран `assembleCandidateQuestions`
  (`buildCandidateQuestions.ts:50`); LLM лишь **переформулирует**. Отказ LLM → отдаём
  каркас с исходными формулировками, опросник рабочий.
- **S5 отчёт** — при отказе нашего ассистента остаётся поток А (импорт отчёта MyMeet).

### 6.5. `CURRENT_DATE` и async

- **Инъекция текущей даты** в промпт там, где релевантно (расчёт стажа, «сколько лет
  назад», актуальность фактов) — как это делает риск-движок. Для персонализации/отчёта
  подавать `CURRENT_DATE` в контекст, чтобы модель корректно трактовала временны́е ссылки.
- **Async для тяжёлых генераций** (отчёт S5): по образцу риск-воркера — очередь
  `pg-boss` (`server/utils/queue/boss.ts`, `risk/worker.ts:13,35`), `retryLimit:2`,
  `expireInSeconds: 5*60` (`worker.ts:37,40`) → таймаут 300 c согласован с
  `generateStructuredOutput` (`provider.ts:402`). Прогресс — через SSE (§11).

Ссылки на код: `provider.ts` (структурный вывод, recovery), `loadConfig.ts` (резолв
конфига), `rateLimit.ts` (лимитер), `risk/worker.ts` (async-паттерн, таймауты).

---

## 7. Миграции — конвенция

### 7.1. Общая процедура

Порядок (по конвенции проекта, S1 §1.10):
1. Правим схему в `server/database/schema/app.ts` (новая секция модуля).
2. `drizzle-kit generate` — генерирует SQL-файл `NNNN_<name>.sql`.
3. Проверяем сгенерированный SQL: enum'ы — с **идемпотентными гардами**
   (`DO $$ BEGIN CREATE TYPE … EXCEPTION WHEN duplicate_object THEN null; END $$;`),
   таблицы — `CREATE TABLE IF NOT EXISTS`, между операторами — `--> statement-breakpoint`.
4. Добавляем запись в `server/database/migrations/meta/_journal.json`.
5. **Реэкспорт** новых таблиц/enum в `server/database/schema/index.ts`.

### 7.2. Нумерация и журнал

Последняя миграция — `0100_candidate_created_by.sql` (idx 100, `_journal.json:698-703`).
Формат журнала (`_journal.json:2`): `version: "7"`, `dialect: "postgresql"`, записи
`{ idx, version:"7", when:<epoch ms>, tag:"NNNN_name", breakpoints:true }`.

Раскладка индексов модуля по спринтам:

| Миграция | Спринт | Содержимое (таблицы/enum) |
|---|---|---|
| `0101_question_bank.sql` | S1 | `assessment_topic`, `assessment_scale`, `bars_anchor`, `bank_question`, `bank_question_probe` + enum: `assessmentTopicTypeEnum`, `topicStatusEnum`, `scaleTypeEnum`, `bankQuestionTypeEnum`, `bankQuestionStatusEnum`, `interviewStageEnum`, `careElementEnum` |
| `0102_care_methodology.sql` | S2 | `care_methodology` (версионируемая), `care_prompt` (промпты 3 видов), `care_probe_trigger` (seed 9 правил); наполнение `bank_question_probe`; enum `carePromptKindEnum` |
| `0103_question_presets.sql` | S3 | `question_preset`, `preset_section`, `preset_section_question`, `job_questionnaire_meta` (лёгкая обёртка провенанса, НЕ тяжёлая `job_questionnaire`); расширение `jobInterviewQuestion` (`source_bank_question_id`, `link_mode`, `overridden_fields`, `criterion_id`, `preset_id`, `section_ref`); enum `presetStatusEnum`, `linkModeEnum`, `interviewTypeEnum` |
| `0104_candidate_questionnaire.sql` | S4 | расширение `applicationQuestionSet` (`source_snapshot jsonb`, версия, snapshot), `applicationQuestionItem` (`parent_item_id`, `care_element`, `priority`, `topic_id`, `scale_id`); enum `itemPriorityEnum` (БД `item_priority`, без суффикса `_enum`) + `ALTER TYPE candidate_question_origin ADD VALUE 'personalized'` (реальное имя enum из `app.ts:57`) |
| `0105_interview_reports.sql` | S5 | `report_template`; расширение `meetingReport` (`template`, `source`, `report_template_id`, `question_answer_map jsonb`); enum `reportSourceEnum` |

Записи журнала (пример для S1): `{ "idx": 101, "version": "7", "when": <epoch ms>,
"tag": "0101_question_bank", "breakpoints": true }`; далее idx 102…105 в порядке спринтов.

### 7a. Конвенция именования БД (ИСТОЧНИК ПРАВДЫ) — риск R1b

> **Риск именования (R1b):** в проекте два «слоя» имён — **Drizzle-alias** (TS,
> camelCase, напр. `bankQuestionStatusEnum`) и **имя объекта в PostgreSQL** (SQL,
> snake_case, напр. `bank_question_status`). Ошибка сопоставления (лишний суффикс
> `_enum`, разные alias для одной сущности в разных спринтах) ведёт к падению
> миграций и рассинхрону схемы. Ниже — **единственный источник правды**; спринт-доки
> ссылаются сюда.

**Правила (выведены из реального кода `server/database/schema/app.ts`):**
1. **Таблицы:** БД-имя — `snake_case`, TS-переменная — `camelCase`
   (`pgTable('bank_question', …)` → `export const bankQuestion`). Префикс-неймспейс
   НЕ используем: имена самоописательны (`bank_question` = вопрос банка/org,
   `assessment_topic`, `care_prompt` и т.д.), а `bank_` / `job_interview_` /
   `application_question_` уже несут уровень сущности. Коллизии слова «question»
   сняты картой §7b (не префиксом).
2. **Enum:** БД-имя — `snake_case` **БЕЗ суффикса `_enum`**. Проверено: в коде
   **0 из ~20** enum имеют `_enum` в БД-имени (`job_status`, `candidate_question_origin`,
   `meeting_report_status`, …). TS-alias — `camelCase` **С суффиксом `Enum`**
   (`export const jobStatusEnum = pgEnum('job_status', […])`). Образец:
   `app.ts:57` `candidateQuestionOriginEnum = pgEnum('candidate_question_origin', …)`.
3. **Колонки:** БД `snake_case`, TS-ключ `camelCase` (`display_order` ↔ `displayOrder`).
4. **Индексы:** `<table>_<columns>_idx`; unique — `<table>_<columns>_unique`
   (образец `app.ts:503`, `:557`).
5. **FK onDelete:** по существующим паттернам (`cascade` для владения,
   `set null` для мягких ссылок на `user`).

**Таблицы модуля (Drizzle ↔ БД):**

| Спринт | Drizzle-alias (TS) | БД-имя (PostgreSQL) | Что это (нативно) |
|---|---|---|---|
| S1 | `assessmentTopic` | `assessment_topic` | тема оценки (компетенция/ценность/риск) |
| S1 | `assessmentScale` | `assessment_scale` | шкала оценки темы |
| S1 | `barsAnchor` | `bars_anchor` | BARS-якорь (поведение по баллу) |
| S1 | `bankQuestion` | `bank_question` | вопрос банка (org) — НЕ путать с `job_question` (§7b) |
| S1 | `bankQuestionProbe` | `bank_question_probe` | probe-уточнение по CARE |
| S2 | `careMethodology` | `care_methodology` | методика CARE (редактируемая) |
| S2 | `carePrompt` | `care_prompt` | промпт CARE (прод-источник) |
| S2 | `careProbeTrigger` | `care_probe_trigger` | триггеры уточнений |
| S3 | `questionPreset` | `question_preset` | пресет опросной карты |
| S3 | `presetSection` | `preset_section` | раздел пресета (1 тема) |
| S3 | `presetSectionQuestion` | `preset_section_question` | ссылка раздела на вопрос банка |
| S3 | `jobQuestionnaireMeta` | `job_questionnaire_meta` | провенанс карты вакансии (1:1 к job) |
| S5 | `reportTemplate` | `report_template` | шаблон отчёта по интервью |

**Enum модуля (Drizzle ↔ БД), без суффикса `_enum`:**

| Спринт | Drizzle-alias (TS) | БД-имя (PostgreSQL) | Значения |
|---|---|---|---|
| S1 | `assessmentTopicTypeEnum` | `assessment_topic_type` | value, soft_skill, management, professional, motivation, expectations, factcheck, achievement_scale, career_logic, risk_zone, culture, custom |
| S1 | `topicStatusEnum` | `topic_status` | draft, active, archived |
| S1 | `scaleTypeEnum` | `scale_type` | numeric_5, numeric_4, numeric_3, match_3, verify_3, level_5, custom |
| S1 | `bankQuestionTypeEnum` | `bank_question_type` | behavioral, situational, motivational, factual, verification, reflective, professional, control, ai_personal |
| S1 | `bankQuestionStatusEnum` | `bank_question_status` | draft, published, archived |
| S1 | `interviewStageEnum` | `interview_stage` | screening, recruiter, hiring_manager, final, expert |
| S1 | `careElementEnum` | `care_element` | context, action, result, evaluate |
| S2 | `carePromptKindEnum` | `care_prompt_kind` | structure_question, personalize_questionnaire, generate_report |
| S2 | `probeSourceEnum` | `probe_source` | **ai_structured, manual, trigger** (канон §7c) |
| S3 | `presetStatusEnum` | `preset_status` | draft, published, archived |
| S3 | ~~`presetInterviewTypeEnum`~~ → **`interviewStageEnum`** | `interview_stage` | **переиспользуем S1 + `full_cycle`** (канон §7c; отдельный `preset_interview_type` УБРАН) |
| S3 | `questionLinkModeEnum` | `question_link_mode` | linked, copy, linked_with_overrides |
| S4 | `itemPriorityEnum` | `item_priority` | must_ask, should_ask, optional |
| S4 | (расширение сущ.) `candidateQuestionOriginEnum` | `candidate_question_origin` | +`personalized` (ALTER TYPE ADD VALUE) |
| S5 | `reportTemplateKindEnum` | `report_template_kind` | **standard, executive, screening, technical, custom** (канон §7c) |
| S5 | `reportSourceEnum` | `report_source` | mymeet, assistant |
| S5 | (расширение сущ.) `meetingReportStatusEnum` | `meeting_report_status` | +`generating` (ALTER TYPE ADD VALUE) |

> **Правка S1:** `interviewStageEnum` / `interview_stage` получает **6-е значение
> `full_cycle`** (для пресетов «полный цикл»), т.к. этот enum теперь общий для
> этапа интервью (вопрос банка) и типа пресета. Итог: `screening | recruiter |
> hiring_manager | final | expert | full_cycle`.

### 7b. Карта устранения коллизий «question» (для нового разработчика)

Слово «question» в проекте перегружено. Эта таблица — шпаргалка «что есть что»,
чтобы новичок не перепутал:

| Имя в БД | Уровень | Что это | Кто заполняет |
|---|---|---|---|
| `job_question` (сущ.) | вакансия | поле **публичной формы отклика** | рекрутёр настраивает, соискатель отвечает |
| `question_response` (сущ.) | отклик | **ответ соискателя** на поле формы | соискатель |
| `job_interview_question` (сущ.) | вакансия | **интервью-вопрос вакансии** (карта вакансии) | AI/рекрутёр |
| `job_question_prompt` (сущ.) | вакансия | промпт генерации интервью-вопросов | система |
| `application_question_set/_item` (сущ.) | отклик | **персональный опросник кандидата** | генерация + рекрутёр |
| **`bank_question`** (новое) | **организация** | **вопрос банка** (корпоративный эталон) | методолог/рекрутёр |
| **`question_preset`** (новое) | **организация** | **опросная карта-шаблон** (набор вопросов банка) | методолог |

Мнемоника: **`bank_`/`*_preset` = организация/банк** (переиспользуемый эталон);
**`job_*question`** = привязано к вакансии; **`application_question_*`** = привязано
к отклику; **`*_response`** = ответ соискателя. Направление наследования:
`bank_question` → `question_preset` → `job_interview_question` →
`application_question_item`.

### 7c. Канонизация значений enum (устранение разночтений — фикс R1b/№1)

Ревью выявило **три enum, где значения расходились между спринт-доками**. Ниже —
принятые канонические версии; спринт-доки приведены к ним. Это обязательно к
исполнению: миграции берут значения ОТСЮДА.

**1. `probe_source`** (S2 — источник probe-уточнения)
- Канон: **`ai_structured | manual | trigger`** (3 значения, из S2 §4.6).
- Обоснование: различаем probe из AI-структурирования, ручные и из справочника
  триггеров — это разная провенанс-семантика, все три нужны.
- Правка: §7a исправлена (было ошибочно `manual, ai_generated`).

**2. `preset_interview_type` → УБРАН, переиспользуем `interview_stage`** (S3)
- Канон: **отдельный enum не создаём**; поле `question_preset.interviewType`
  использует существующий `interviewStageEnum` (S1), расширенный значением
  **`full_cycle`**. Итог: `screening | recruiter | hiring_manager | final |
  expert | full_cycle`.
- Обоснование: значения S3 (`recruiter/hiring_manager`) и S1
  (`interview_stage`) семантически совпадали; два enum с одной семантикой →
  путаница «какой применять» + лишний маппинг. Один общий enum убирает дубль
  (ревью №2). Сценария раздельной эволюции не выявлено.
- Правка: S1 добавляет `full_cycle` в `interview_stage`; S3 убирает
  `presetInterviewTypeEnum`, ссылается на `interviewStageEnum`.

**3. `report_template_kind`** (S5 — вид шаблона отчёта)
- Канон: **`standard | executive | screening | technical | custom`** (5 значений,
  из S5 §5.5.1).
- Обоснование: `standard` понятнее дефолтного `default`; `screening` нужен как
  отдельный вид отчёта. Значения S5 полнее.
- Правка: §7a исправлена (было `default, executive, technical, custom`).

> **Инвариант:** при любом расхождении «спринт-док ↔ §7a» истина — §7a/§7c. Перед
> `drizzle-kit generate` сверить значения enum с этой секцией.

### 7.3. Идемпотентные enum-гарды (обязательный шаблон)

```sql
DO $$ BEGIN
  CREATE TYPE "bank_question_status" AS ENUM ('draft','published','archived');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
```

Причина — повторный прогон миграции (dev-среды, восстановление) не должен падать на
уже существующем типе. Все `CREATE TYPE`/`CREATE TABLE` модуля — идемпотентны.
Имя типа в `CREATE TYPE` — строго по таблице §7a (БД-имя, без `_enum`).

### 7.4. Реэкспорт схемы

`server/database/schema/index.ts` (5 строк, re-export паттерн):

```ts
export * from './auth'
export * from './app'   // ← новые таблицы модуля объявляются в app.ts, попадают сюда автоматически
export * from './sso'
export * from './hm'
export * from './rbac'
```

Так как все таблицы модуля живут в `app.ts`, отдельного файла заводить **не нужно** —
`export * from './app'` уже реэкспортирует их. Если для чистоты выделяется отдельный
файл `schema/questions.ts`, добавить `export * from './questions'` строкой ниже.

---

## 8. i18n — конвенция

### 8.1. Единственная локаль — `ru.json`

Проект русскоязычный, локаль одна: `i18n/locales/ru.json`. **`en.json` не заводить.**
Все подписи модуля — только в `ru.json`. Плейсхолдеры — интерполяция `{count}` и т.п.
(образцы уже в файле, напр. `:1397`).

### 8.2. Новые блоки по спринтам

| Блок | Назначение | Спринт |
|---|---|---|
| `settings.questionBank.*` | Заголовок/описание раздела настроек, под-навигация (Обзор/Вопросы/Темы/CARE/Отчёты/Песочница). | S1 |
| `questionBank.*` | Формы, бейджи, валидация качества, пустые состояния банка. | S1 |
| `questionBank.topics.*`, `questionBank.scales.*`, `questionBank.bars.*` | Темы, шкалы, BARS-якоря. | S1 |
| `care.*` | Методология CARE: редактор, элементы Context/Action/Result/Evaluate, probe. | S2 |
| `application.questionnaire.*` | Персональный опросник в карточке отклика: генерация, приоритеты, баннер «устарело», probe. | S4 |
| `interview.report.*` | Библиотека шаблонов отчётов, генерация отчёта, поток MyMeet/наш. | S5 |

### 8.3. Ярлыки вкладок

Подписи вкладок вакансии — через существующий блок `dashboard.jobs.tabs.*`
(`ru.json:1399-1408`): там уже есть `questions` («Вопросы», `:1403`), `applicationForm`
(«Форма заявки», `:1404`), `brief`, `aiAnalysis` и т.д. Новые вкладки модуля на уровне
вакансии (напр. карта вопросов S3) добавляются **в этот же блок** ключом
`t('dashboard.jobs.tabs.<key>')`, не выдумывая новый неймспейс. Уточнение из S0 §0.2:
следить, чтобы «Вопросы» (интервью-банк) и «Форма заявки» (поля отклика) не смешивались
в подписях.

---

## 9. Design-system — обязательные правила

### 9.1. Только `Ui*` (правило `plan-ui-unification.md`)

Новые страницы/вкладки модуля строятся **только** на компонентах `Ui*`; никакого
сырого `<button>`/`<input>` с инлайн-Tailwind (правило `plan-ui-unification.md`, дублируется
в мастер-плане §3.10 и S1 §1.8). Фактический инвентарь `app/components/ui/`:

| Компонент | Файл | Назначение |
|---|---|---|
| `UiButton` | `app/components/ui/UiButton.vue` | Все действия/кнопки. |
| `UiInput` | `app/components/ui/UiInput.vue` | Однострочный ввод, поиск (`iconLeft=Search`). |
| `UiSelect` | `app/components/ui/UiSelect.vue` | Выпадающие списки (тип шкалы, стадия, приоритет). |
| `UiBadge` | `app/components/ui/UiBadge.vue` | Бейджи темы/типа/статуса/`careReady`, чипы-фильтры (removable), tone `success/warning/danger/info`. |
| `UiCard` | `app/components/ui/UiCard.vue` | Карточки Обзора, тем, вопросов, пресетов. |
| `UiModal` | `app/components/ui/UiModal.vue` | Подтверждения-диалоги (короткие). |
| `UiDrawer` | `app/components/ui/UiDrawer.vue` | CRUD-формы тем/вопросов/пресетов (боковая панель). |
| `UiSegmented` | `app/components/ui/UiSegmented.vue` | Переключатели («Мои/Все черновики», режимы). |

Табы — `app/components/DetailTabs.vue` (под-навигация раздела и вкладок отклика).
Токены — `app/design/tokens.ts` (цвета `brand/accent/surface/success/warning/danger/info`
как `var(--color-*)`, радиусы, тени; правило «менять в двух местах»: `main.css` +
`tokens.ts`, `tokens.ts:11`). Тосты — `useToast()`. Подтверждения — `useConfirm()`.
Reorder — **нативный HTML5 DnD** (образец `PropertySchemaEditor.vue`); библиотеки DnD в
проекте нет.

### 9.2. `UiTextarea` отсутствует (важно)

Компонента `UiTextarea` в `app/components/ui/` **нет** (проверено — файла нет). Модулю
нужны многострочные поля (текст вопроса до 600 симв., определение темы, anchorText,
CARE-элементы, шаблон отчёта). Варианты (согласовать с `plan-ui-unification.md`):
1. Разметить `<textarea>` токен-классами (быстро, но плодит разметку).
2. **Предпочтительно:** завести `app/components/ui/UiTextarea.vue` в рамках S1 (одна
   компонента закрывает потребность всех спринтов) и добавить её в showcase.

### 9.3. Showcase

Новые экраны/компоненты модуля добавить в showcase `/dashboard/design-system` при
появлении (S1 §1.8). Это часть DoD спринта, если спринт вводит новые UI-паттерны.

---

## 10. Тестирование — стратегия

Стек: **vitest** (unit/integration, `tests/unit/*.test.ts`) + **playwright**
(e2e, `e2e/critical-flows/*.spec.ts`). Эталоны в проекте: `candidate-questions.test.ts`,
`job-brief-questions-schema.test.ts`, `access-matrix.test.ts`, `access-seed-parity.test.ts`,
`cross-org-isolation.spec.ts`, `candidate-application.spec.ts`.

### 10.1. Уровни и что покрывают

| Уровень | Что проверяет | Где | Пример эталона |
|---|---|---|---|
| **Unit** | Чистые функции: `normalizeQuestion`; `assembleCandidateQuestions` (сборка, дедуп, порядок); quality-checks (закрытый/двойной/длина/дубль/оценочная лексика якорей); Zod-схемы (`bankQuestion`, `assessmentScale`, `barsAnchor`); правило partial-unique `isDefault`; cap приоритетов/бюджета опросника. | `tests/unit/*.test.ts` | `candidate-questions.test.ts`, `job-brief-questions-schema.test.ts` |
| **Integration** | Publish-gating (нельзя опубликовать невалидный вопрос / тему не `active`); sync/diff (баннер «устарело» при расхождении версий); snapshot-preserve (regenerate не затирает ручное/ответы — ср. `question-set/generate.post.ts:93-105`); запрет удаления шкалы, используемой опубликованным вопросом. | `tests/unit/` (с тестовой БД) | — |
| **e2e** | Сквозной поток: генерация опросника из карточки отклика (S4); генерация/импорт отчёта (S5); публикация вопроса из UI. | `e2e/critical-flows/` | `candidate-application.spec.ts` |
| **Tenant-isolation suite** | Каждый листинг/агрегат/детально: орг A не видна из орг B (список, ID→404, поиск, агрегат). | unit + e2e | `cross-org-isolation.spec.ts` |

### 10.2. Матрица прав

Для `questionBank` — матричный тест «роль × action → allow/deny» по образцу
`access-matrix.test.ts`: owner/admin (всё allow), member (view/create_draft/edit_draft
allow; publish/archive/manage_* deny), hiringManager (только view allow). Плюс
ABAC-тест: member правит **свой** черновик (allow) и **чужой** (deny).

### 10.3. Что каждый спринт обязан добавить

| Спринт | Обязательные тесты |
|---|---|
| S0 | `normalizeQuestion` unit; матрица прав `questionBank`; регрессия существующего контура (`npm test` + e2e apply зелёные). |
| S1 | quality-checks; Zod-схемы; partial-unique `isDefault`; publish-gating; запрет удаления используемой шкалы; изоляция тем/вопросов/шкал. |
| S2 | CARE-структурирование (recovery при кривом LLM-ответе); версионирование методики; probe-схема. |
| S3 | Импорт пресета (детерминизм); адаптация (деградация при отказе LLM); матрица покрытия (агрегат — изоляция!); `criterion_id`-связь. |
| S4 | Сборка+персонализация (деградация до каркаса); snapshot-preserve; баннер «устарело»; cap приоритетов; изоляция опросника. |
| S5 | Генерация отчёта (BARS-контекст); шаблоны отчётов (один default); поток MyMeet vs наш; изоляция отчётов. |

### 10.4. Паритет сида ролей

При добавлении `questionBank` в `shared/permissions.ts` — прогнать
`access-seed-parity.test.ts` (сверяет статический `ROLE_STATEMENTS` с DB-сидом ролей
RBAC v2). Расхождение сломает `shadow`/`new`-режим `requirePermission`
(`requirePermission.ts:64-120`). Обновить сид ролей вместе со статическим реестром.

---

## 11. Нефункциональные требования

| NFR | Требование | Ссылка/эталон |
|---|---|---|
| **Async тяжёлых LLM** | Генерация отчёта (S5) и любые генерации >30 c — через очередь `pg-boss`, не в HTTP-запросе. `retryLimit:2`, `expireInSeconds:5*60` (=300 c), согласовано с таймаутом `generateStructuredOutput`. | `risk/worker.ts:13,35-40`; `provider.ts:402` |
| **SSE для прогресса** | Прогресс длинных операций (генерация опросника/отчёта, песочница-тест) — через `text/event-stream`. | `prompts/sandbox/[id]/test.post.ts:72,140` (`sendStream`); `applications/[id]/thread-stream.get.ts:32` |
| **Rate limits** | Каждый AI-эндпоинт — `createRateLimiter` (10/мин; отчёт 5/мин), первой строкой хендлера. | `rateLimit.ts:65`; `interview-questions/generate.post.ts:10` |
| **PII-маскирование** | **Не требуется** для модуля вопросов — защищённый контур (подтверждено заказчиком): вопросы/темы/якоря/опросник видит рекрутёр/owner/admin с `questionBank:view`; чувствительные контакты кандидата в тексты вопросов не выносятся. Маскирование остаётся инвариантом для сущностей кандидата (`rbac-v2-master-plan.md §5.3`), но новые сущности модуля PII не несут. |
| **Аудит** | `recordActivity` (`recordActivity.ts:44`) на значимые действия: публикация/архивация вопроса, правка CARE, генерация опросника/отчёта. Поля `action`, `resourceType`, `resourceId`, опц. `before/after/decision/riskLevel`. Hash-chain уже встроен (`recordActivity.ts:64-73`). | `recordActivity.ts:44-61` |
| **Performance матрицы покрытия** | Агрегатные запросы (тема×критерий S3, счётчики Обзора S1) — с `organizationId` первым предикатом и индексами `(organizationId)`, `(organizationId, code) unique`, `(primaryTopicId)`, `(status)` (S1 §1.3). Избегать N+1 при рендере матрицы — один агрегатный запрос, не запрос-на-ячейку. |
| **Пустые состояния** | Матрица покрытия/списки при отсутствии данных — активная заготовка («Создайте первую тему»), не пустой прямоугольник (S1 §1.8 UX; риск §12). |

### 11a. Пагинация list-API и перф-бюджеты (фикс ревью №6)

Единые правила для всех списков и агрегатов модуля; спринт-доки ссылаются сюда.

**Пагинация (обязательна для всех GET-списков):**
- Все листинги (`question-bank/questions`, `topics`, `presets`, каталог пресетов,
  `report-templates`, версии) принимают **`limit` (деф. 50, max 100)** + **`offset`**
  (или keyset/cursor по `createdAt,id` для больших наборов) + фильтры + поиск.
- Ответ: `{ items[], total, limit, offset }` (или `{ items[], nextCursor }`).
- Причина: org с 500+ вопросами не должна получать всё разом (ревью №12).
- `GET /api/mymeet/meetings` — пагинация на стороне MyMeet-tool
  (`mymeet_list_meetings`, поле `scope`/страницы); прокидываем параметры страницы.

**Перф-бюджеты:**
- **Матрица покрытия** (`criterion × question`, S3): худший кейс ~50 критериев ×
  ~200 вопросов = 10k ячеек. Считать одним агрегатным запросом с GROUP BY
  (`criterion_id`), не N+1; отдавать разреженно (только заполненные пары +
  список «дыр»). Порог отзывчивости < 300 мс на типовой вакансии; при экстремуме —
  строить на клиенте из плоского списка `{criterionId, questionId}`.
- **LLM token-budget (отчёт, S5 поток Б):** контекст = транскрипт (может быть
  десятки тыс. символов) + опросник + BARS + шаблон. Стратегия при превышении
  лимита модели: **приоритет сохранения** — опросник + BARS + шаблон целиком;
  **транскрипт** обрезается/чанкуется по релевантности (сегменты по спикерам,
  ближе к темам опросника). Оценить input/output-бюджет до вызова; при превышении —
  чанковый проход (map-reduce по сегментам) либо усечение с пометкой в отчёте
  «анализ по части транскрипта». Детали — S5.
- **Индексы:** все частые фильтры (`organizationId`, `status`, `primaryTopicId`,
  `jobId`) покрыты индексами (заведены в схемах спринтов).

---

## 12. Риски реализации — консолидированная таблица

Разворачивает топ-риски мастер-плана §7 в полную таблицу с вероятностью, серьёзностью,
митигацией и спринтом-владельцем. Вероятность/серьёзность: Н/С/В (низкая/средняя/высокая).

| # | Риск | Вер. | Сер. | Митигация | Владелец |
|---|---|:--:|:--:|---|---|
| R1 | **Путаница двух сущностей вопросов** (`jobQuestion` = поля формы отклика vs `jobInterviewQuestion` = интервью-вопросы; + новый `bank_question`) | В | В | ADR `adr-questions-two-entities.md` + переименование в UI/i18n «Форма заявки» до любого кода; проверка, что «Вопросы» нигде не смешивает сущности (S0 §0.1–0.2). | S0 |
| R1b | **Расхождение имён БД** (Drizzle camelCase-alias vs PostgreSQL snake_case; ошибочный суффикс `_enum` в БД-имени; разные alias/значения enum для одной сущности в разных спринтах) | С | В | Единая таблица соответствий Drizzle↔БД (§7a) как источник правды; правило «enum БД-имя БЕЗ `_enum`» (0/20 в коде); канонизация alias (`presetInterviewTypeEnum`/`questionLinkModeEnum`/`reportSourceEnum`); **канонизация ЗНАЧЕНИЙ enum — §7c** (`probe_source`, `report_template_kind`; `preset_interview_type` УБРАН — переиспользуем `interview_stage`+`full_cycle`); `CREATE TYPE` строго по §7a/§7c; сверка сгенерированного SQL после `drizzle-kit generate`. | S0/все |
| R2 | **Скачок на org-level модель / утечка тенанта** (проект исторически job-scoped; агрегаты поверх многих вакансий) | С | В | Строгий org-scoping во всех запросах (§3); `organizationId` первым предикатом; org-условие на каждой таблице JOIN; обязательные tenant-isolation тесты на каждый листинг/агрегат; `requireXInScope` для job/application-scoped (§3.3). | Кросс (все) |
| R3 | **Snapshot без баннера «устарело»** (рекрутёр готовится по неактуальной повестке) | С | В | Хранить версии источников в snapshot; баннер «данные обновились → перегенерировать»; regenerate = новая версия, не затирая ручное (§5.3). Часть DoD S4. | S4 |
| R4 | **Хрупкость LLM на богатых схемах** (CARE + probe + флаги) | В | С | `.catch().default()`-гарды в Zod; `wrapBareArray`; recovery `extractJsonPayload` (`provider.ts:433-462`); деградация до детерминированного каркаса (§6.4). | S2/S4 |
| R5 | **Тройной дедуп** (`normalizeQuestion` в 3 местах, одно — расходится) | С | С | Вынести единый util `server/utils/text/normalizeQuestion.ts`; перевести 3 места (`buildCandidateQuestions.ts:40`, `interview-questions/generate.post.ts:17`, `question-set/generate.post.ts:108`); unit-тест (§4). | S0 |
| R6 | **MyMeet: 3 tool-а из 11** (`TOOL_CANDIDATES` покрывает 3; для S5 нужны `get_meeting_status`, `search`, `record`/`regenerate_template`) | С | С | Расширить `TOOL_CANDIDATES` или хардкодить имена после discovery; поток Б (наш ассистент) не зависит от недостающих tool-ов (использует `get_transcript`). | S5 |
| R7 | **Over-engineering** (тяжёлый workflow модерации, BARS-калибровка, проведение интервью) | С | С | Модерация лёгкая (draft→publish, без SLA); проведение интервью/выставление баллов — вне scope (MyMeet + рекрутёр); BARS — только каркас промпта отчёта (мастер-план §7.7, §8). | Кросс (все) |
| R8 | **Пустое состояние матрицы покрытия** (нет тем/критериев → пустой экран, непонятно что делать) | С | Н | Активные заготовки пустых состояний; онбординг-подсказки «Создайте тему/пресет»; матрица деградирует до списка при нехватке данных (§11). | S3 |
| R9 | **Сложность версионирования** (иммутабельность published + snapshot + версии методики → путаница «какая версия сейчас») | С | С | Единая консолидированная таблица версий (§5.2); явная связь source→version на каждом переходе; баннер «устарело» (§5.3); тесты publish-gating и snapshot-preserve (§10). | S1/S4 |
| R10 | **Расхождение статического AC и DB-сида ролей** (добавили `questionBank` только в один слой) | С | С | Добавлять в `atsStatements` **и** raw-карты ролей (§2.4); прогон `access-seed-parity.test.ts`; матрица прав (§10.2, §10.4). | S0 |
| R11 | **Rate-limit не шарится между репликами** (per-process, `rateLimit.ts:13`) | Н | Н | Self-hosted single-instance — приемлемо; при масштабировании — лимит на edge (документировано в `rateLimit.ts`). | Кросс |

---

## 13. Definition of Done — общий чеклист для каждого спринта

Спринт считается готовым, когда выполнены **все** пункты (спринт-специфичные критерии —
в ТЗ спринта, в дополнение к этому):

**Права и безопасность**
- [ ] Каждый новый эндпоинт начинается с `requirePermission(event, { questionBank: [...] })` и скоупа по `activeOrganizationId` (§2.5).
- [ ] Права `questionBank` разложены по ролям корректно (owner/admin — всё; member — view/create_draft/свой edit; HM — view) (§2.3).
- [ ] IDOR: чужой/несуществующий ID → **404**, отсутствие права → **403** (§2.5).
- [ ] `access-seed-parity.test.ts` зелёный; матрица прав покрыта (§10.2, §10.4).

**Мультитенантность**
- [ ] Все запросы фильтруются по `organizationId`; JOIN'ы — org-условие на каждой таблице (§3).
- [ ] Tenant-isolation тесты на каждый новый листинг/агрегат/детально (список, ID→404, поиск, агрегат) зелёные (§3.4, §10.1).

**Версионирование / иммутабельность**
- [ ] Опубликованное иммутабельно (правка = новая версия); soft-archive вместо удаления для оценочных сущностей (§5.1–5.2).
- [ ] (S4) Баннер «устарело» реализован; snapshot-preserve при regenerate (§5.3).

**AI**
- [ ] AI-вызовы через `loadAiConfig(orgId, { purpose })` с корректным purpose (без `screening`) (§6.1).
- [ ] `generateStructuredOutput` с `.catch().default()`/`wrapBareArray`/recovery; graceful degradation до каркаса (§6.2, §6.4).
- [ ] AI-эндпоинты за `createRateLimiter`; тяжёлые — async (pg-boss, 300 c) + SSE-прогресс (§6.3, §11).

**Миграции / схема**
- [ ] Миграция с правильным индексом (0101…0105), идемпотентные enum-гарды, запись в `_journal.json`, реэкспорт в `schema/index.ts` (§7).
- [ ] **Имена БД строго по §7a:** таблицы/колонки/enum — `snake_case`; БД-имя enum БЕЗ суффикса `_enum`; Drizzle-alias — по таблице соответствий; `CREATE TYPE` = БД-имя из §7a. Нет разночтений alias между спринтами (R1b).
- [ ] `drizzle-kit generate` прогнан, SQL проверен вручную (сверка имён с §7a).

**i18n / UI**
- [ ] Подписи только в `ru.json`, нужные блоки заведены; вкладки через `dashboard.jobs.tabs.*` (§8).
- [ ] UI только на `Ui*` + токены + `DetailTabs` + `useToast`/`useConfirm`; нет сырого `<button>`/`<input>`; новые паттерны — в showcase (§9).

**Тесты / регрессия**
- [ ] Unit/integration/e2e спринта зелёные; существующий контур (скрининг, hh-sync, дедуп, скоринг, риски, apply e2e) не сломан.
- [ ] `npm test` и сборка (клиент+сервер) зелёные; нет hydration mismatch.

**Аудит**
- [ ] `recordActivity` на значимых действиях спринта (публикация, правка CARE, генерация опросника/отчёта) (§11).
