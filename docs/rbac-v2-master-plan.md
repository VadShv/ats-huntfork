# ТЗ и мастер-план: Модуль управления правами и доступами (RBAC v2)

**Версия:** 1.1
**Дата:** 12.09.2026
**Стек:** Nuxt 4 / Vue 3 (SSR) / TypeScript / Better Auth (organization plugin) / Drizzle ORM / PostgreSQL 16
**Статус:** утверждённый план к реализации по спринтам (единый источник истины)
**Основано на:** фактическом чтении кода (`shared/permissions.ts`, `server/utils/*`, `server/database/schema/*`, `app/composables/usePermission.ts`, `app/pages/dashboard/settings/*`, `server/api/*`), а также на `docs/role-model-and-permissions.md`, `docs/audit-rbac.md`, `docs/rbac-v2-review.md` и внешнем `huntfork-access-control-spec.md`.

---

## Изменения v1.1 (по итогам `docs/rbac-v2-review.md`)

Структурные правки после независимого ревью. Ревью учтено; далее источник истины — этот документ.

1. **RLS вынесен в фазу v2.1** (вне основного трека, не блокирует модуль). Причина: `server/utils/db.ts` — глобальный пул `postgres.js` (`max:10`), запросы вне транзакций; корректный `SET LOCAL app.org_id` требует переписать весь слой доступа к БД — это не 1.5 недели. App-уровень (`scopedDb` + masking + тесты изоляции) закрывает ~95% риска. Спринт 4 **не перенумерован** — помечен `[ФАЗА v2.1, вне основного трека]`, чтобы не сломать перекрёстные ссылки «Спринт N».
2. **`scopedDb` (Спринт 3): добавлен пилот** на 5–10 чувствительных эндпоинтах; жёсткий срок «2 недели» снят до замера на пилоте (разнородность ~295 мест).
3. **Одна роль на участника в v2** зафиксирована как ограничение **на уровне приложения**; схема `member_roles` остаётся many-to-many для union в v3 (НЕ упрощать до FK).
4. **План отката ПОСЛЕ переключения** enforcement (Спринт 2): feature-flag `old↔new`.
5. **Masking-on-output — архитектурный инвариант** (§5.3/§6), не отдельная задача спринта; проверяется одной строкой в тестах (§13).
6. **Раздел «Пробелы к учёту при детализации»** добавлен (§17): perf scope-фильтров, инвалидация при multi-instance, миграция старых `activity_log` под hash-chain, разделение ролей БД, реальный объём 2FA.
7. Уточнён раздел тестирования (§13) под фактическую инфраструктуру (vitest + playwright, 37 unit / 46 e2e, существующие security-тесты).

Нумерация спринтов v1.0 сохранена намеренно (перекрёстные ссылки целы). «Дырка» Спринт 4 = v2.1 подписана явно.

**Закрытые открытые вопросы (§15):**
- **§15.1 Иерархия отделов → вложенные.** Scope `departments` наследует всё поддерево по `parentId` (стратегия `byDepartmentSubtree`, рекурсивный CTE, кэш поддерева в `ActorContext`, bump версии при перемещении отдела). Детали — §15.1, §5.3.
- **§15.2 Одна роль в v2** (уже было в v1.1).
- **Порядок старта:** Спринт 0 → **0.5 (блокер, стартуем с него)** → 1 → 2 → 3. `ActorContext` в 0.5 закладывается финальной структурой, временно наполняется из `member.role`, в Спринтах 1–2 источник переключается на `can()` без смены интерфейса.

---

## 0. Резюме для принимающего решение

Сейчас в системе жёсткий RBAC на 4 ролях (`owner / admin / member / hiring_manager`), права описаны **в коде** (`shared/permissions.ts`), проверяются Better Auth AC. Кастомных ролей нет, scope нет, полевого уровня нет, per-user исключений нет, RLS нет, изоляция оргов — ручная (`eq(organizationId, orgId)` в ~295 файлах), роль недоступна на SSR (мигание UI), `activity_log` минимальный.

**Цель v2:** превратить это в гибкую систему с:
1. **5 системных пресетов** ролей: `owner`, `admin`, `lead_recruiter`, `recruiter`, `junior_recruiter` (+ сохранение `hiring_manager` как есть).
2. **UI-настройкой прав** без релиза: матрица «ресурс × уровень доступа» с тонкой настройкой отдельных прав и **полевым уровнем** (скрыть блок / только чтение / редактирование — пример: AI-интеграции «видит, но не редактирует»).
3. **Кастомными правами на каждого пользователя** (per-member overrides, `allow`/`deny`, deny сильнее).
4. **Scope** (вся орг / отдел / назначенные вакансии / только свои).
5. **Единым движком `can()`**, `scopedDb()` (авто-фильтр по оргу и scope), field masking, ролью на SSR.
6. **Расширенным иммутабельным аудитом** и «Посмотреть как» (view-as).

Ключевое архитектурное решение (§3): **отказ от статического Better Auth AC как источника истины прав** в пользу собственного движка `can()` с правами в БД. Better Auth остаётся для аутентификации, сессий, организаций и инвайтов. Это неизбежно, потому что Better Auth AC резолвит роли один раз при инициализации и не поддерживает per-tenant кастомные роли.

**Порядок реализации:** 9 спринтов (§12). Первые три (0–2) — невидимый фундамент, без них остальное унаследует текущие проблемы. Миграция — параллельным двойным чтением (shadow-mode), без простоя и без ослабления текущего enforcement.

---

## 1. Цели, не-цели, критерии приёмки

### 1.1 Цели
- Владелец/админ настраивает права ролей и отдельных пользователей в UI за ≤3 клика, без релиза.
- Гибкая «Ведущий рекрутер»: любой блок можно скрыть / дать read / дать edit; чувствительные операции — отдельно.
- Пресеты ролей + индивидуальная кастомизация поверх пресета.
- Ни один пользователь не выполняет действие вне своего scope; подтверждено автотестами.
- Каждое чувствительное действие — в неизменяемом журнале (кто, что, когда, IP, было→стало, решение allow/deny).
- Утечка данных невозможна даже при баге в коде (RLS как последний барьер).
- Новая доменная сущность подключается к авторизации в одном месте (реестр ресурсов), а не правкой 20 файлов.

### 1.2 Не-цели (v2)
- Внешний policy-движок (Casbin/Cerbos/OpenFGA) — своя `can()` проще для self-hosted (см. §11, открытый вопрос закрыт в пользу своей реализации).
- Approval-workflow (оффер выше вилки → согласование) — это workflow поверх прав, отдельный модуль.
- Мультиорганизационные пользователи с одновременными сессиями в нескольких оргах — остаётся текущая модель «одна активная орг на сессию».
- Полный SCIM-провижининг — только hook для деprovisioning (§10.6), полноценный SCIM — v3.

### 1.3 Критерии приёмки (Definition of Done для всего модуля)
1. Смена роли/scope пользователя применяется без релиза и инвалидирует его сессии ≤60 c.
2. Владелец видит интерфейс глазами пользователя («Посмотреть как»), read-only.
3. Матричные автотесты: для каждой пары (роль × permission) — allow и deny.
4. Тесты изоляции оргов: запрос ресурса чужой орги по прямому ID → 404 (не 403).
5. Тесты scope: пользователь со scope `assigned` не получает чужих данных ни через список, ни по прямому ID, ни через поиск, ни через экспорт, ни через AI-ассистента.
6. Тесты маскирования: роль без `candidate:read:contacts` не получает контакты ни в одном ответе API (включая вложенные объекты и выгрузки).
7. Тест RLS: запрос без `app.org_id` возвращает 0 строк.
8. Тест иммутабельности: `UPDATE`/`DELETE` по `audit_log` от роли приложения падает; hash-chain верифицируется.
9. `npm run build` (клиент+сервер) и `npm run test` зелёные; нет hydration mismatch.

### 1.4 Нефункциональные требования
- Проверка права `can()`: p95 < 5 мс при кэше в контексте запроса.
- Резолв прав пользователя: ≤1 запрос к БД на HTTP-запрос (далее кэш в `event.context`).
- Роль/права доступны на SSR синхронно (без мигания).

---

## 2. Анализ текущего состояния (база для плана)

### 2.1 Что есть и переиспользуется
| Компонент | Файл | Роль в v2 |
|---|---|---|
| Better Auth (auth, session, org, invites, SSO) | `server/utils/auth.ts` | Остаётся: только AuthN + организации + инвайты |
| `requireAuth` | `server/utils/requireAuth.ts` | Остаётся, станет тонкой обёрткой над контекстом актора |
| `requirePermission` | `server/utils/requirePermission.ts` | **Переписывается** на `can()` (сигнатуру сохраняем для совместимости) |
| `requireHm` | `server/utils/requireHm.ts` | Остаётся до миграции HM в общую модель (§9) |
| `recruiterScope` | `server/utils/recruiterScope.ts` | Поглощается scope-движком |
| `hiringManager` / `hm-*` | `server/utils/hiringManager.ts`, `hm-stage-resolver.ts` | Остаётся; HM интегрируется как роль-пресет |
| `comments/visibility.ts` | | Поглощается field/условной видимостью; чинится баг `recruiter` |
| `recordActivity` + `activity_log` | `server/utils/recordActivity.ts`, `schema/app.ts:898` | **Расширяется** (§7) |
| `previewReadOnly.ts` | | НЕ основа для view-as (это демо-режим); view-as — новый механизм (§8.4) |
| `member` таблица | `schema/auth.ts:84` | Расширяется полями и связями (§4) |
| `department` (иерархия `parentId`) | `schema/app.ts:2588` | Используется для scope `departments` |
| `job_member` | `schema/hm.ts:31` | Используется для scope `assigned` (recruiter/hiring_manager) |

### 2.2 Что отсутствует (greenfield)
Таблицы `permissions`, `roles`, `role_permissions`, `member_roles`, `member_scopes`, `member_permission_overrides`, `role_limits`; движок `can()`; `scopedDb()`; field masking; RLS; роль на SSR; hash-chain аудита; view-as; редактор-матрица; лимиты по роли.

### 2.3 Подтверждённые баги/долги (чинятся в рамках плана)
- 🔴 `comments/visibility.ts:17` — несуществующая роль `recruiter` (должно быть `member`); рекрутер не видит внутренние комментарии. Чинится в Спринте 4.
- 🔴 `hiring_manager` не зарегистрирован в `app/utils/auth-client.ts:14`. Снимается уходом от клиентского AC (Спринт 2).
- 🟠 AI-конфиг переиспользует `scoring:*` → рекрутер может править AI-провайдеры/ключи. Выделяется в отдельный ресурс `aiConfig`/`integration` (Спринт 1, реестр ресурсов).
- 🟠 Роль недоступна на SSR (мигание). Чинится в Спринте 0.5/2.
- 🟠 Резолв роли продублирован 5 раз. Централизуется в `getActorContext(event)` (Спринт 0.5).
- 🟠 `activity_log` без `ip/before/after/decision/hash`. Расширяется (Спринт 6).

---

## 3. Ключевое архитектурное решение: свой движок вместо статического AC

### 3.1 Проблема
Better Auth AC (`createAccessControl`) собирает роли из кода при инициализации (`ac.newRole(...)` в `shared/permissions.ts`). Кастомные роли на тенанта и правки прав без релиза в этой модели невозможны — она статична и общая для всех оргов.

### 3.2 Решение
- **Права и роли переезжают в БД** (§4). Источник истины — таблицы `permissions/roles/role_permissions/...`.
- **`can()`** (§5) — единственная точка принятия решения, читает из БД (с кэшем).
- **Better Auth** остаётся для: sign-in/up, сессии, `organization` (членство, `activeOrganizationId`), инвайтов, SSO. `member.role` сохраняется как **денормализованный «первичный пресет»** для обратной совместимости и bootstrap, но фактические права считает `can()`.
- **`hasPermission` из Better Auth больше не используется** в `requirePermission`. Клиентский AC (`checkRolePermission`) заменяется на capability-снапшот с сервера (§8.7).

### 3.3 Почему не внешний движок
Self-hosted-продукт (Docker Compose) — минимум зависимостей при развёртывании важнее декларативных политик. Своя `can()` ~300 строк, полностью тестируема матрицей, версионируется вместе с кодом. Cerbos/OpenFGA добавляют сетевой сервис в каждый деплой. Решение зафиксировано.

### 3.4 Совместимость на переходный период
`requirePermission(event, { job: ['create'] })` сохраняет сигнатуру, но внутри вызывает `can()`. Это позволяет мигрировать ~295 эндпоинтов **без массовой правки** на первом этапе — меняется только реализация гуарда. Полевой уровень и scope добавляются точечно там, где нужны.

---

## 4. Модель данных

### 4.1 Три оси (не смешивать в «роль»)
| Ось | Где | Что описывает |
|---|---|---|
| **Role** | `roles` + `role_permissions` | Набор прав (потолок возможностей) |
| **Scope** | `member_scopes` | Границы данных (org/departments/jobs/assigned/own) |
| **Overrides** | `member_permission_overrides` | Индивидуальные allow/deny поверх роли (deny сильнее) |

Правило: **роль задаёт потолок, scope — охват, override — точечная поправка.**

### 4.2 Справочник прав `permissions` (сид, не редактируется из UI)
```sql
CREATE TABLE permissions (
  key         TEXT PRIMARY KEY,            -- 'candidate:read:contacts'
  resource    TEXT NOT NULL,               -- 'candidate'
  action      TEXT NOT NULL,               -- 'read' | 'create' | 'update' | 'delete' | 'export' | 'move' | ...
  field_set   TEXT,                        -- 'contacts' | 'salary' | NULL (базовое право)
  ui_level    SMALLINT NOT NULL DEFAULT 0, -- маппинг на уровень матрицы (0..4), см. §8.3
  risk_level  SMALLINT NOT NULL DEFAULT 0, -- 0 обычное, 1 чувствительное, 2 критическое
  category    TEXT NOT NULL,               -- группировка в UI: 'candidates'|'jobs'|'ai'|'integrations'|'members'|'audit'|...
  label_ru    TEXT NOT NULL,
  label_en    TEXT NOT NULL,
  hint_ru     TEXT,                        -- «Позволяет унести базу за пределы Huntfork»
  hint_en     TEXT
);
```

### 4.3 Роли `roles` (системные пресеты + кастомные на орг)
```sql
CREATE TABLE roles (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT REFERENCES organization(id) ON DELETE CASCADE, -- NULL = системный пресет
  key           TEXT,                       -- 'owner'|'admin'|'lead_recruiter'|'recruiter'|'junior_recruiter'|'hiring_manager' для системных
  name          TEXT NOT NULL,
  description   TEXT,
  is_system     BOOLEAN NOT NULL DEFAULT FALSE,   -- системный пресет: копируется, не удаляется
  is_assignable BOOLEAN NOT NULL DEFAULT TRUE,    -- можно ли назначать участникам
  default_scope TEXT NOT NULL DEFAULT 'assigned', -- org|departments|jobs|assigned|own
  color         TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
```
- Системные пресеты: `organization_id = NULL`, `is_system = true`. Их **нельзя удалить**; при желании кастомизировать под орг — «Клонировать в свою роль».
- `owner`/`admin` — не редактируются в UI по правам (защита от самоблокировки), только просмотр.

### 4.4 Связь ролей и прав + версионирование
```sql
CREATE TABLE role_permissions (
  role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL REFERENCES permissions(key),
  PRIMARY KEY (role_id, permission)
);

-- Версионирование прав роли (для diff/rollback/аудита изменений прав, §8.5, §10.4)
CREATE TABLE role_permission_versions (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  snapshot    JSONB NOT NULL,               -- полный список permission на момент версии
  scope_snapshot JSONB,
  changed_by  TEXT REFERENCES "user"(id),
  change_note TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4.5 Назначение ролей и scope участнику
```sql
-- Роль(и) участника в организации.
-- [v1.1] В v2 назначается РОВНО ОДНА роль (ограничение на уровне приложения/UI).
-- Схема НАМЕРЕННО остаётся many-to-many (не FK), чтобы union нескольких ролей
-- в v3 не требовал миграции. НЕ упрощать до одиночного FK на member.
CREATE TABLE member_roles (
  member_id   TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  role_id     TEXT NOT NULL REFERENCES roles(id),
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (member_id, role_id)
);

-- Scope участника (границы данных). Одна строка на участника.
CREATE TABLE member_scopes (
  member_id     TEXT PRIMARY KEY REFERENCES member(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  scope_type    TEXT NOT NULL DEFAULT 'assigned', -- org|departments|jobs|assigned|own
  department_ids TEXT[] NOT NULL DEFAULT '{}',
  job_ids        TEXT[] NOT NULL DEFAULT '{}',
  updated_by    TEXT REFERENCES "user"(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Индивидуальные исключения. deny применяется последним и побеждает.
CREATE TABLE member_permission_overrides (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  member_id   TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL REFERENCES permissions(key),
  effect      TEXT NOT NULL CHECK (effect IN ('allow','deny')),
  reason      TEXT,
  expires_at  TIMESTAMPTZ,                  -- временные исключения («в процессе увольнения»)
  created_by  TEXT NOT NULL REFERENCES "user"(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, permission)
);
```

### 4.6 Лимиты по роли (защита от массового вреда)
```sql
CREATE TABLE role_limits (
  role_id          TEXT PRIMARY KEY REFERENCES roles(id) ON DELETE CASCADE,
  contacts_per_day INTEGER,                 -- раскрытий контактов в сутки
  emails_per_day   INTEGER,
  export_rows_max  INTEGER,                 -- строк за одну выгрузку
  bulk_action_max  INTEGER                  -- записей в одной массовой операции
);
```

### 4.7 Расширение `member` (Drizzle, `schema/auth.ts`)
Добавить (без удаления существующих HM-полей):
- `revoked_at TIMESTAMPTZ` — для мгновенного отзыва без удаления строки.
- `permissions_version INTEGER NOT NULL DEFAULT 0` — bump при любой смене роли/scope/override → сигнал инвалидации сессии (§5.5).
Существующее (`role`, `status`, `hmCanViewSalary`, `mustChangePassword`) сохраняется; `role` становится денормализованным «первичным пресетом» (= первичная строка `member_roles`).

### 4.8 Расширение `activity_log` (см. §7)
Добавляемые поля: `actor_email`, `before`, `after`, `ip`, `user_agent`, `decision`, `policy_reason`, `risk_level`, `prev_hash`, `entry_hash`, `field_set`. Расширить `activityActionEnum` (§7.2).

### 4.9 Диаграмма связей
```
organization
 ├── member (userId, role[legacy], status, revoked_at, permissions_version, hm_*)
 │    ├── member_roles ──────────► roles ──► role_permissions ──► permissions
 │    │                             └─ role_limits, role_permission_versions
 │    ├── member_scopes (scope_type, department_ids[], job_ids[])
 │    └── member_permission_overrides (allow/deny, expires_at)
 ├── department (parentId — иерархия)  ← scope 'departments'
 ├── job ── job_member (recruiter|hiring_manager)  ← scope 'assigned'
 └── activity_log (immutable, hash-chain)
```

---

## 5. Слой авторизации (сервер)

### 5.1 Контекст актора — единый резолв на запрос
Убирает 5 дублей резолва роли (`audit-rbac.md §6`).
```ts
// server/utils/access/actorContext.ts
interface ActorContext {
  userId: string
  memberId: string
  orgId: string
  roleKeys: string[]              // ['lead_recruiter']
  permissions: Set<string>        // развёрнутое объединение прав ролей
  overrides: Map<string, 'allow'|'deny'>
  scope: { type: ScopeType; departmentIds: string[]; jobIds: string[] }
  limits: RoleLimits | null
  status: 'active'|'pending'|'suspended'|'rejected'
  isViewAs: boolean               // режим «Посмотреть как» → форс read-only
}

// Резолвится один раз, кэшируется в event.context.actor
export async function getActorContext(event: H3Event): Promise<ActorContext>
```
- Один SQL-JOIN (member → member_roles → role_permissions (+overrides, scope, limits)).
- Кэш в `event.context` на время запроса.
- Кэш в памяти процесса с ключом `(memberId, permissions_version)` и TTL, инвалидация по bump версии (§5.5).

### 5.2 `can()` — единственная точка решения
```ts
type Decision =
  | { effect: 'allow' }
  | { effect: 'deny'; reason: string }
  | { effect: 'filtered'; scope: ScopeFilter; maskedFields: string[] }

async function can(
  actor: ActorContext,
  action: PermissionKey,          // 'candidate:read' | 'candidate:read:contacts' | ...
  resource?: ResourceRef,         // { type, id, orgId, ownerId, jobId, departmentId }
): Promise<Decision>
```
**Порядок вычисления (deny-by-default):**
1. `deny` по умолчанию.
2. Если `resource` задан: `resource.orgId === actor.orgId`? Нет → `deny` + запись в журнал как потенциальный IDOR.
3. Активное членство (`status='active'`, `revoked_at IS NULL`).
4. View-as ИЛИ любое небезопасное действие (write) при `isViewAs` → `deny`.
5. Есть ли `action` в `actor.permissions` (объединение ролей)?
6. Применить overrides: `allow` добавляет, `deny` удаляет; **deny побеждает**; истёкшие (`expires_at < now`) игнорируются.
7. ABAC-условия (§5.6).
8. Scope-фильтр + список маскируемых полей → `filtered` при необходимости.

### 5.3 Три уровня применения
**Уровень 1 — route guard** (`requirePermission` → `can()`): доступен ли раздел/действие в принципе.

**Уровень 2 — `scopedDb(actor)`** — авто-фильтр по оргу И scope в базовом query-билдере, чтобы фильтр **невозможно было забыть**.
```ts
// Правильно:
const rows = await scopedDb(actor).candidates.findMany({ where: ... })
// Неправильно (текущий антипаттерн в ~295 местах):
const rows = await db.select().from(candidate).where(eq(candidate.organizationId, orgId))
```
`scopedDb` подмешивает: `org_id = actor.orgId` всегда; для scope `assigned` — `job_id IN actor.scope.jobIds`; `departments` — стратегия **`byDepartmentSubtree`** (см. ниже); `own` — `created_by = actor.userId`.

**Стратегия `byDepartmentSubtree` (scope `departments`) [v1.1]:** `member_scopes.department_ids` — только корневые назначенные отделы. `scopedDb` разворачивает их в полное поддерево рекурсивным CTE и фильтрует по нему:
```sql
WITH RECURSIVE subtree AS (
  SELECT id, 1 AS depth FROM department
    WHERE id = ANY($assigned) AND organization_id = $org
  UNION ALL
  SELECT d.id, s.depth + 1 FROM department d
    JOIN subtree s ON d.parent_id = s.id
    WHERE s.depth < 32                    -- защита от циклов (инвариант «без циклов» лишь на уровне API)
)
-- далее: фильтр вакансий/кандидатов по department_id IN (SELECT id FROM subtree)
```
Требования реализации:
- Результат (список id поддерева) **кэшируется в `ActorContext`** на время запроса (§5.1) — не гонять CTE в каждом под-запросе (§17.1).
- Depth-limit (или visited-check) обязателен как страховка от бесконечного цикла.
- Индекс `department.parent_id` уже есть (`parent_id_idx`) — CTE дёшев (отделов немного).
- Перемещение отдела (`parentId`) → bump `permissions_version` затронутых `lead_recruiter` (§5.5).

> **Дизайн-требование под будущий RLS (v2.1):** `scopedDb` проектируется так, чтобы позже можно было навесить транзакционный org-контекст (`SET LOCAL app.org_id` внутри транзакции) **без переделки** слоя. Практически: единая точка получения соединения/транзакции внутри `scopedDb`, куда в v2.1 добавится установка контекста. RLS отложен по реализации (§11), но учтён в дизайне уже сейчас — дешёвая страховка.

**Уровень 3 — field masking (masking-on-output ПО УМОЛЧАНИЮ — инвариант).** Сериализатор вырезает поля без права и возвращает `_masked`:
```json
{ "id":"...", "name":"Иван П.", "phone": null, "expectedSalary": null,
  "_masked": ["phone","email","expectedSalary"] }
```
Реализация — `maskEntity(actor, 'candidate', row)`; карта полей→право в реестре ресурсов (§6).

> **Инвариант (не отдельная фича):** маскирование применяется **на выходе по умолчанию** для всех ресурсов из реестра, включая «сырые» пути — аналитику, экспорт, AI-контекст, вебхуки. Возврат немаскированного объекта — осознанное исключение, а не поведение по умолчанию. Дисциплина обеспечивается тем, что сериализация ресурса идёт через `maskEntity`, а не ручным `JSON`. Проверяется одной строкой в тестах (§13): «нет PII без права ни в одном ответе, включая вложенное и выгрузки».

### 5.4 Защита от IDOR
- ID уже text-UUID (не последовательные) — enumeration затруднён (сохранить).
- Проверка `resource.orgId` на каждом пути (не только в контроллере) — через `scopedDb`/`can(resource)`.
- Проверка принадлежности дочерней записи родителю (application → job → org).
- Ответ на чужой/несуществующий ID — **404**, не 403 (не подтверждать существование).
- Детект перечисления: серия `deny`/404 от одного актора → алерт + троттлинг (§10.5).

### 5.5 Инвалидация прав ≤60 c
- Любая правка роли/scope/override/отзыв → `bump permissions_version` у затронутых `member`.
- `getActorContext` сверяет закэшированную версию с БД (дешёвый `SELECT permissions_version`) при каждом запросе ИЛИ кэш с TTL ≤60 c. При расхождении — пересбор контекста.
- Отзыв участника (`revoked_at`) → следующий запрос падает 401/403.

### 5.6 ABAC-условия (тонкий слой)
Реализуются как предикаты в `can()` по `resource`+`actor`:
- «свои заметки» — `comment.author_id = actor.userId` для `comment:update/delete`.
- «только пока вакансия открыта» — `job.status='open'` для части действий.
- HM видит кандидата с этапа «интервью» (перенос текущей HM-логики).
- Interviewer не видит чужие скоркарты до отправки своей (anti-anchoring) — если внедряется роль Interviewer.
- Видимость внутренних комментариев (замена `comments/visibility.ts`, с фиксом бага `recruiter`→`member`).

---

## 6. Реестр ресурсов (единая точка расширения)
Чтобы новая сущность подключалась в одном месте (крит. приёмки 1.1):
```ts
// shared/access/resources.ts
export const RESOURCES = {
  candidate: {
    table: 'candidate',
    fields: {                       // поле → требуемое право для его показа
      phone: 'candidate:read:contacts',
      email: 'candidate:read:contacts',
      messengers: 'candidate:read:contacts',
      expectedSalary: 'candidate:read:salary',
    },
    scopeStrategy: 'byJob',         // как применять scope к этой таблице
    ownerField: 'createdBy',
  },
  job: { table: 'job', scopeStrategy: 'byJobId', /* ... */ },
  aiConfig: { table: 'ai_config', scopeStrategy: 'orgOnly', sensitive: true },
  // ...все ресурсы из инвентаря схемы
} as const
```
Из этого реестра генерируются: сид `permissions`, матрица UI, `scopedDb`, `maskEntity`, матричные тесты. **Единый источник истины ресурсов.**

**Инвариант masking-by-default:** любой ресурс, объявленный в `RESOURCES` с картой `fields`, маскируется на выходе автоматически через `maskEntity`. Добавление нового ресурса в реестр = автоматическое включение маскирования для него на всех путях; забыть невозможно, если сериализация идёт через реестр (см. §5.3, ур.3).

---

## 7. Аудит (расширение существующего `activity_log`)

### 7.1 Принцип
НЕ создавать новую таблицу — **расширить** `activity_log` (`schema/app.ts:898`). Логирование остаётся, но для чувствительных действий становится транзакционным (не fire-and-forget), чтобы не терять записи безопасности.

### 7.2 Новые поля и enum-значения
Поля: `actor_email` (денорм.), `before JSONB`, `after JSONB`, `ip INET`, `user_agent`, `decision` (`allow|deny`), `policy_reason`, `risk_level SMALLINT`, `field_set`, `prev_hash TEXT`, `entry_hash TEXT`.
Новые `activity_action`: `role_created`, `role_updated`, `role_deleted`, `member_scope_changed`, `member_override_set`, `member_suspended`, `member_revoked`, `contacts_viewed`, `resume_downloaded`, `list_exported`, `bulk_action`, `view_as_started`, `permission_denied`, `login`, `logout`.

### 7.3 Иммутабельность
- Отдельная роль БД приложения без `UPDATE/DELETE` на `activity_log`:
  `REVOKE UPDATE, DELETE ON activity_log FROM huntfork_app; GRANT INSERT, SELECT ON activity_log TO huntfork_app;`
- Hash-chain: `entry_hash = SHA256(prev_hash || canonical_json(event))`. Верификатор — команда `npm run audit:verify`.
- Для облака (будущее) — репликация в S3 Object Lock; для self-hosted достаточно REVOKE + hash-chain.
- PII в журнале маскируется для тех, у кого нет `audit:read:pii`.

### 7.4 Что логировать обязательно (risk ≥1)
Просмотр контактов, скачивание резюме, экспорт списков, bulk-операции, любые правки ролей/scope/overrides, вход в view-as, деprovisioning, все `deny` по чувствительным ресурсам.

---

## 8. UI/UX управления доступами

### 8.1 Раздел «Команда и доступы»
Путь: `app/pages/dashboard/settings/team/`. Вкладки: **Участники · Роли · Приглашения · Журнал**. (Текущий `members.vue` расширяется/переносится; `org-structure.vue` остаётся для оргструктуры и питает scope `departments`.)

### 8.2 Вкладка «Участники»
Таблица: имя+аватар, роль (инлайн-селект пресета/кастомной роли), scope (чипы отделов/вакансий), **«Доступ к»**, последняя активность, статус (активен/приглашён/приостановлен/истекает).
Ключевая колонка **«Доступ к»**: индикатор `12 вакансий · 340 кандидатов · PII скрыт` — админ видит фактический масштаб, а не имя роли.
Действия по строке: изменить роль, настроить scope, **настроить индивидуальные права (overrides)**, «Посмотреть как», приостановить, отозвать, история изменений прав.

### 8.3 Вкладка «Роли» — редактор-матрица (ядро гибкости)
Строки — ресурсы/блоки (Кандидаты, Вакансии, Заявки, Офферы, Скоркарты, Аналитика, **AI и промпты**, **Интеграции**, Шаблоны, Оргструктура, Участники, Журнал).
Столбцы — уровни (один клик по ячейке):

| Блок | Нет | Просмотр | Просмотр + PII | Редактирование | Полный |
|---|---|---|---|---|---|

Маппинг уровня → права (`permissions.ui_level`):
- **Нет** — блок скрыт (никаких `resource:*`).
- **Просмотр** — `resource:read` (без field-set контактов/зарплат).
- **Просмотр + PII** — `+ :read:contacts`, `:read:salary`.
- **Редактирование** — `+ create/update`.
- **Полный** — `+ delete/export/critical`.

**Пример из требований (AI-интеграция «видит, но не редактирует»):** для строки «AI и промпты» выбрать **Просмотр** → роль получает `aiConfig:read` (видит, что подключено), но не `aiConfig:update`/`aiConfig:key:reveal`. Именно поэтому AI-конфиг **выделяется в отдельный ресурс** из `scoring` (Спринт 1).

Под матрицей — раскрывающийся блок **«Тонкая настройка»**: отдельные permission-тумблеры для случаев, которые уровень не выражает.

**Блок «Чувствительные операции»** (красная подсветка, подтверждение, формулировки через последствия):
- «Скачивать базу кандидатов в файл» (`candidate:export:bulk`) — подсказка «Позволяет унести всю базу за пределы Huntfork».
- «Массовое отклонение заявок», «Удалять кандидатов и вакансии», «Массовые рассылки», «Управлять AI-моделями и ключами», «Управлять интеграциями», «Просматривать журнал».

`owner`/`admin` — read-only в редакторе (нельзя урезать, защита от самоблокировки). `lead_recruiter`/`recruiter`/`junior_recruiter`/кастомные — редактируемы.

### 8.4 Три механизма, снимающие основную боль
**«Посмотреть как» (view-as, read-only impersonation).** Новый механизм (НЕ `previewReadOnly.ts`). Владелец/админ входит в интерфейс глазами участника: несъёмная жёлтая полоса, `actor.isViewAs=true` → сервер форсит `deny` на любые write. Каждый вход — в журнал (`view_as_started`). Реализация: спец-режим сессии/подписанный краткоживущий контекст, разрешён только для `member:impersonate` (owner/admin).

**Live-превью в редакторе роли** (панель справа, пересчёт на каждое изменение):
```
Эта роль увидит: 1 240 из 8 900 кандидатов · 12 из 47 вакансий
Не увидит: контакты, зарплаты, офферы, биллинг
Сможет: перемещать по этапам, писать письма (до 50/день)
Не сможет: удалять, выгружать, менять настройки
```

**Diff перед сохранением** (роль затрагивает группу людей):
```
Изменения роли «Рекрутер»:
  + Скачивать базу кандидатов в файл   ⚠ чувствительное
  − Видеть аналитику команды
Затронуто участников: 4 — Анна К., Пётр С., Мария Л., Дмитрий В.
```

### 8.5 Индивидуальные права пользователя (per-user)
Отдельный экран по кнопке «Настроить права» в строке участника:
- Показывает эффективные права = роль ⊕ overrides; наглядно помечает, что унаследовано от роли, а что переопределено.
- Тумблеры allow/deny поверх роли, поле «Причина», опциональный `expires_at`.
- Предупреждение при `deny` на базовые `:read`, ломающие экраны.
- Кнопка «Сбросить к роли».

### 8.6 Приглашения
- Инвайт-ссылка с предзаданной ролью и scope; TTL 72 ч; подтверждение email. (Расширить существующие `invite-links/`.)
- Тип «гостевой доступ» с обязательной датой автоистечения (агентства/внешние интервьюеры).
- Domain capture (опционально, выкл. по умолчанию).
- Модерация заявок — уже есть (`join-requests/`, `members/:id/approve|reject`).

### 8.7 Клиентский composable (замена `usePermission`)
```ts
const { can, cannot, scope, masked, isReady } = usePermissions()
<UButton v-if="can('candidate:export')" ... />
```
- Источник — **capability-снапшот с сервера** (список эффективных прав + scope), прокинутый на SSR через `useState('accessSnapshot')`, а не клиентский Better Auth AC. Убирает мигание и баг с `hiring_manager`.
- Снимок кладётся в SSR-payload из `getActorContext` → синхронно доступен при первом рендере.
- Бэкенд повторно проверяет каждый запрос — скрытая кнопка это удобство, а не защита.

### 8.8 Вкладка «Журнал»
Фильтры: участник, тип действия, ресурс, период, уровень риска, решение (allow/deny). Отдельно **«Чувствительные просмотры»** (контакты/резюме/экспорты). Экспорт для GDPR/152-ФЗ. Индикатор целостности hash-chain.

---

## 9. Роли: пресеты и матрица

### 9.1 Системные пресеты (сид, `is_system=true`)
| Роль | key | default_scope | Суть |
|---|---|---|---|
| **Владелец** | `owner` | org | Всё + биллинг + передача владения. Нельзя удалить последнего. Не редактируется в UI. |
| **Администратор** | `admin` | org | Всё, кроме биллинга по умолчанию. Управляет ролями/участниками/интеграциями. Не редактируется в UI. |
| **Ведущий рекрутер** | `lead_recruiter` | departments | **Максимально гибкий**: базово — все вакансии своих отделов, аналитика команды, назначение рекрутеров; каждый блок настраивается матрицей (скрыть/read/edit). Пример: AI — только просмотр. |
| **Рекрутер** | `recruiter` | assigned | Полный цикл кандидата на своих вакансиях, контакты. Без approve офферов, без bulk-экспорта, без удаления. |
| **Младший рекрутер** | `junior_recruiter` | assigned | Минимум: карточки и перемещение по этапам на назначенных вакансиях; PII скрыт; без экспорта, писем-рассылок, удаления, настроек. |
| **Нанимающий менеджер** | `hiring_manager` | jobs | Как сейчас (read-only + решения через `/api/hm/*`). Мигрирует в общую модель во 2-ю очередь. |

### 9.2 Стартовая матрица пресетов (сид `role_permissions`)
Легенда: `—` нет · `R` read · `R+` read+PII · `W` create/update · `F` full(+delete/export).

| Блок | owner | admin | lead_recruiter (дефолт) | recruiter | junior_recruiter | hiring_manager |
|---|---|---|---|---|---|---|
| Кандидаты | F | F | R+/W (настр.) | R+ · W · без bulk-export | R (PII скрыт) | R (с этапа интервью) |
| Вакансии | F | F | R · W (свои отделы) | R · W (свои) | R (свои) | R (свои) |
| Заявки/этапы | F | F | W | move/update | move | R + hm-решения |
| Офферы | F | F | R · approve (настр.) | R · create | — | — |
| Скоркарты | F | F | R/W · чужие (настр.) | R/W (свои) | W (свои) | R (свои) |
| Аналитика | org | org | team | own | own | — |
| AI и промпты | F | F | **R (пример: без edit)** | — | — | — |
| Интеграции/ключи | F | F | R (настр.) | — | — | — |
| Шаблоны писем | F | F | W | W | — | — |
| Оргструктура | F | F | R | R | R | R |
| Участники/роли | F | F | — | — | — | — |
| Журнал | F | F | R (без PII, настр.) | — | — | — |
| Биллинг | F | — | — | — | — | — |

Значения «настр.» — дефолт пресета, который владелец меняет матрицей/overrides. Точная стартовая раскладка фиксируется в сиде и покрывается матричными тестами.

### 9.3 Правила безопасности пресетов
- **[v1.1] Одна роль на участника в v2.** Назначается ровно одна роль; индивидуальные отклонения — через overrides (§4.5), не через вторую роль. Схема `member_roles` остаётся many-to-many для union в v3 — ограничение действует на уровне приложения/UI, схему не упрощать.
- Нельзя снять последнего `owner`.
- `owner`/`admin` не редактируются по правам в UI.
- Нельзя `deny` базовые `:read`, ломающие вход в основные экраны, без явного подтверждения.
- Кастомная роль создаётся только клонированием пресета («Клонировать → редактировать»).

---

## 10. Защитный контур (best practices)

### 10.1 Нет hard delete в UI
`archive` → корзина (retention 30 дней) → окончательное удаление только owner/admin из отдельного экрана с подтверждением. Восстановление в 1 клик. (Оценить объём — многие сущности уже имеют `isArchived`.)

### 10.2 Bulk-операции под особым режимом
Предпросмотр 10 записей → подтверждение вводом количества («введите 47») → лимит `role_limits.bulk_action_max` → undo-баннер 30 c → одна транзакция + запись в журнал + возможность отката.

### 10.3 Лимиты по роли (не глобальные)
Раскрытие контактов, письма, экспорт, размер bulk — из `role_limits`. При превышении — мягкое «Лимит на сегодня исчерпан» + «Запросить увеличение» (заявка админу). (`rateLimit.ts` остаётся для IP-уровня; role_limits — новый слой по актору.)

### 10.4 Версионирование конфигурации
Роли/scope/overrides версионируются (`role_permission_versions` + журнал), откат возможен. Изменение прав проходит как изменение — с diff и подтверждением.

### 10.5 Детект аномалий
Триггеры: массовое раскрытие контактов ночью; всплеск экспорта у недавно изменённого сотрудника; вход из нового региона/устройства; рост просмотров вне scope; серия `deny` (перебор ID). Реакция: уведомление owner + автоограничение экспорта до подтверждения.

### 10.6 Безопасность аккаунтов
- 2FA обязательна для owner/admin (принудительное включение для всех — опция орг). (Better Auth поддерживает — включить плагин.)
- Короткоживущие сессии (уже 24ч/1ч); инвалидация при смене прав (§5.5) и выходе.
- SSO/SCIM: hook деprovisioning — отключение в каталоге → `revoked_at` в Huntfork. (Расширить `schema/sso.ts`.)
- Аудит API-ключей и токенов расширения; scope расширения ≤ прав пользователя.

---

## 11. Row-Level Security (последний барьер) — `[ФАЗА v2.1, вне основного трека]`

> **Статус (v1.1):** RLS вынесен из основного трека в фазу **v2.1** и НЕ блокирует выпуск RBAC v2. Причина: `server/utils/db.ts` — глобальный пул `postgres.js` (`max:10`), запросы не обёрнуты в транзакции; корректная установка `SET LOCAL app.org_id` требует транзакционного контекста на каждый запрос — это переписывание всего слоя доступа к БД, недооценённое в v1.0. App-уровень (`scopedDb` + masking + тесты изоляции оргов) закрывает ~95% риска. RLS внедряется после того, как app-уровень доказал надёжность на проде. При этом дизайн `scopedDb` уже учитывает будущий транзакционный контекст (§5.3), чтобы v2.1 не потребовал переделки.

### 11.1 Политика
```sql
ALTER TABLE candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON candidate FOR ALL
  USING (organization_id = current_setting('app.org_id', true)::text);
```

### 11.2 Требования внедрения (порядок критичен)
1. `organization_id NOT NULL` на всех мультитенантных таблицах (уже так почти везде; исключения-каталоги RLS не покрываются).
2. `FORCE ROW LEVEL SECURITY` (иначе владелец таблицы обходит).
3. Контекст — только `SET LOCAL app.org_id` **внутри транзакции** (иначе при пуле протечёт в чужой запрос — худший баг). Требует обернуть запросы в транзакцию с установкой контекста.
4. Пул `postgres.js` — прямое соединение или PgBouncer в **session mode**, не transaction-mode.
5. Порядок: **сначала выкатить установку `app.org_id` на каждом запросе БЕЗ политик**, проверить по логам, что контекст ставится всегда, и только потом `ENABLE`+`FORCE` таблица за таблицей.
6. Отдельная роль БД с `BYPASSRLS` — только для миграций (`migrations.ts`) и `pg_dump`, не для приложения.

### 11.3 Риск и компенсация
RLS-отказы молчаливы → dev-режим логирует каждую установку контекста и предупреждает, если запрос ушёл без `app.org_id`. Внедряется постепенно, начиная с самых чувствительных таблиц (`candidate`, `document`, `application`).

---

## 12. План по спринтам

> Принцип: права — сквозная инфраструктура. Фундамент (Спринты 0–2) — до нового UI, иначе всё унаследует мигание и ручную фильтрацию. На каждом спринте текущий enforcement НЕ ослабевает (shadow-mode параллельно старому).

### Спринт 0 — Аудит и подготовка (0.5–1 нед)
- Зафиксировать инвентарь ресурсов/полей (реестр §6, черновик) из `schema/app.ts`.
- Выбрать стратегию пула для будущего RLS (проверить прод-конфиг `postgres.js`/PgBouncer).
- **Артефакт:** реестр ресурсов + таблица «есть/нет/переделать» (частично уже в этом документе).

### Спринт 0.5 — Роль на SSR + единый контекст (1 нед) [блокер, СТАРТУЕМ С НЕГО]
- `getActorContext(event)` (§5.1) — убрать 5 дублей резолва роли.
- **[v1.1] Каркас, не времянка:** структура `ActorContext` закладывается СРАЗУ финальной (`roleKeys`, `permissions`, `scope`, `overrides`, `limits`, `isViewAs`), даже если часть полей пока заглушки. Наполнение временное — из `member.role` + существующих хелперов (`getOrgRole`/`getHmFlags`/`getMemberRole`). Спринты 1–2 наполнят из новых таблиц/`can()` **без изменения интерфейса** — потребители не переписываются.
- Прокинуть capability-снапшот на SSR (`useState`), переписать `usePermission`→`usePermissions` (§8.7). Формат снапшота — сразу финальный; источник в 0.5 — текущая роль (Better Auth), в Спринте 2 переключается на `can()`.
- **DoD:** мигание на `/dashboard` ушло; нет hydration mismatch; роль синхронна на SSR; `ActorContext` имеет финальную сигнатуру; `npm run test`/`build` зелёные.

### Спринт 1 — Модель данных и `can()` (1.5–2 нед) [фундамент]
- Миграции: `permissions`, `roles`, `role_permissions`, `member_roles`, `member_scopes`, `member_permission_overrides`, `role_limits`, `role_permission_versions`; расширение `member`.
- Сид системных пресетов (§9) + справочника `permissions` из реестра.
- Движок `can()` (§5.2) + `getActorContext` читает из новых таблиц.
- Выделить `aiConfig`/`integration` из `scoring` в отдельные ресурсы.
- **Shadow-mode:** `requirePermission` вызывает и старый `hasPermission`, и новый `can()`, логирует расхождения (двойное чтение, без переключения).
- **DoD:** матричные тесты (роль×permission) зелёные; логи shadow-mode без расхождений на реальном трафике.

### Спринт 2 — Переключение enforcement (1 нед)
- `requirePermission` → полностью на `can()`; удалить клиентский Better Auth AC.
- Миграция существующих `member.role` → `member_roles` + `member_scopes` (owner→org, admin→org, member→assigned, hiring_manager→jobs) без простоя.
- Инвалидация сессий по `permissions_version` (§5.5).
- **План отката ПОСЛЕ переключения [v1.1]:** feature-flag `ACCESS_ENFORCEMENT=old|new` (env/org-настройка). Shadow-mode (Спринт 1) прикрывает период ДО переключения; этот флаг прикрывает ПОСЛЕ — при проблеме в проде мгновенный возврат на старый AC без релиза. Флаг живёт до тех пор, пока `new` не отработает стабильно N недель, затем удаляется.
- **DoD:** тесты изоляции оргов (404) зелёные; крит.1.1 (расширяемость) выполнено; откат на `old` проверен на staging.

### Спринт 3 — `scopedDb()` + field masking (срок — после пилота)
- **Под-этап 3.0 (пилот) [v1.1]:** реализовать `scopedDb(actor)` (§5.3 ур.2) + `maskEntity` на **5–10 самых чувствительных эндпоинтах** (candidate/document/application/export/AI-ассистент). Замерить фактическую стоимость на разнородных паттернах (raw drizzle, джойны, агрегаты аналитики). **Только после замера** экстраполировать срок на оставшиеся эндпоинты. Причина: ~295 мест используют разные паттерны — оценка «2 недели» из v1.0 снята до пилота.
- Перевод остальных чувствительных эндпоинтов на `scopedDb` + masking по реестру полей (§5.3 ур.3).
- Проверить производительность scope-фильтров на списках/аналитике (`job_id IN (…сотни…)` + JOIN): индексы, планы запросов (§17.1).
- Фикс бага видимости комментариев (`recruiter`→`member`) через ABAC-условие.
- **DoD:** тесты scope и маскирования (включая вложенные объекты, выгрузки, ассистента) зелёные; пилот дал реалистичную оценку остатка.

### Спринт 4 — RLS `[ФАЗА v2.1, ВНЕ ОСНОВНОГО ТРЕКА]`
> **[v1.1] Вынесено из основного трека.** Номер спринта сохранён намеренно, чтобы не сломать перекрёстные ссылки «Спринт N» в документе. RBAC v2 выпускается БЕЗ этого спринта; он выполняется как отдельная фаза v2.1 после того, как app-уровень (Спринт 3) доказал надёжность на проде. Полное описание и требования — §11.
- `SET LOCAL app.org_id` в транзакции на каждом запросе БЕЗ политик; проверка по логам. **Требует переписать слой доступа к БД** под транзакционный контекст (см. дизайн-требование в §5.3 — `scopedDb` спроектирован под это заранее).
- `ENABLE`+`FORCE` на `candidate`, `document`, `application`, далее остальные; отдельная `BYPASSRLS`-роль для миграций и `pg_dump`.
- **DoD:** тест RLS (запрос без контекста → 0 строк) зелёный; прод стабилен.

### Спринт 5 — UI: Участники + view-as + приглашения (2 нед)
- Раздел «Команда и доступы», вкладка «Участники» с колонкой «Доступ к», инлайн-роль, scope-редактор.
- «Посмотреть как» (§8.4), расширение инвайтов (TTL/scope/гость с автоистечением).
- **DoD:** крит.1.2 (view-as) и крит.1.1 (≤3 клика смена роли) выполнены.

### Спринт 6 — Аудит v2 (1.5 нед)
- Расширение `activity_log` (§7), транзакционная запись чувствительных действий, hash-chain + `REVOKE UPDATE/DELETE`, верификатор `audit:verify`.
- Вкладка «Журнал» + «Чувствительные просмотры» + экспорт.
- **DoD:** тест иммутабельности и hash-chain зелёные; крит.1.4 выполнен.

### Спринт 7 — Кастомные роли: матрица + per-user (2 нед)
- Редактор-матрица (§8.3), «Тонкая настройка», блок «Чувствительные операции», live-превью, diff при сохранении.
- Экран индивидуальных прав (§8.5), overrides с `expires_at`.
- **DoD:** «Ведущий рекрутер» полностью настраивается в UI (пример AI «view-only» работает); per-user overrides применяются и логируются.

### Спринт 8 — Защитный контур (2 нед + 2FA отдельно)
- Корзина/retention (§10.1), bulk-режим с подтверждением и undo (§10.2), `role_limits` (§10.3), детект аномалий (§10.5), SCIM-деprovisioning hook (§10.6).
- **2FA [v1.1]:** вынести в отдельную задачу (~1 неделя): плагин Better Auth + UI enroll + recovery codes + принудительное включение для owner/admin. Это не «строка в спринте», а самостоятельный объём (§17.5).
- **DoD:** крит.1.3 (необратимые действия вне scope невозможны) и крит.1.5 подтверждены автотестами.

**Ориентировочно (основной трек, без RLS/v2.1):** ~13–15 недель при полной занятости одним человеком без отвлечений; при параллельной разработке других модулей — фактически дольше. RLS (v2.1) и 2FA — сверх этого. Оценки уточняются после Спринта 0 и пилота `scopedDb` (Спринт 3.0).

---

## 13. Тестирование (расширяем `TESTING-SECURITY.md`, не создаём заново)

### 13.0 Существующая инфраструктура [v1.1] — использовать, не строить заново
Факт: `vitest ^4.1.11` + `@playwright/test ^1.62.1`; скрипты `npm run test`, `test:watch`, `test:e2e`; **37 unit** в `tests/unit/`, **46 e2e** в `e2e/`; уже есть security-тесты (`auth-security-hardening`, `security-fixes`, `sso-security`); `TESTING-SECURITY.md` в корне.
- **Перед Спринтом 1:** прогнать `npm run test`, зафиксировать зелёную базу (baseline).
- **Матричные тесты `can()`** — чистые юниты **БЕЗ БД** (движок принимает `ActorContext` как аргумент → сотни кейсов генерируются из `permissions`, быстро).
- **Тесты изоляции оргов и scope** — в существующий `e2e/critical-flows/`.

### 13.1 Обязательные автотесты
- **Матричные тесты авторизации** — генерируются из `permissions` (новое право не остаётся непокрытым).
- **Изоляция оргов** — на каждый эндпоинт: орг A → ресурс орг B → 404.
- **Scope** — `assigned`/`departments`/`own` не пробиваются списком/прямым ID/поиском/экспортом/ассистентом.
- **Маскирование (инвариант masking-by-default, §5.3/§6)** — одна проверяющая инвариант строка-обёртка: нет PII без права ни в одном ответе (включая вложенное, выгрузки, AI-контекст, вебхуки).
- **RLS (v2.1)** — без `app.org_id` → 0 строк.
- **Иммутабельность аудита** — UPDATE/DELETE падают; hash-chain верифицируется.
- **Инвалидация** — после смены роли старые права уходят ≤60 c.
- **Откат enforcement [v1.1]** — переключение флага `ACCESS_ENFORCEMENT=old` восстанавливает старое поведение (smoke на staging).
- **Ручной чек-лист** — пройти продуктом под каждой ролью через «Посмотреть как».

---

## 14. Риски и их снятие
| Риск | Снятие |
|---|---|
| Конфликт с Better Auth AC | Уход от `hasPermission` на свой `can()`; Better Auth только AuthN/org/invites (§3) |
| Регрессия прав при переключении | Shadow-mode двойного чтения + логи расхождений (Спринт 1) до переключения (Спринт 2) |
| RLS кладёт прод (протечка контекста при пуле) | Сначала контекст без политик + проверка логами; session-mode пул; `BYPASSRLS` только миграциям (§11.2) |
| Ручная фильтрация в ~295 местах остаётся дырой | `scopedDb()` делает фильтр незабываемым; RLS как страховка (Спринты 3–4) |
| Владелец случайно заблокирует себя | `owner`/`admin` не редактируемы; запрет снятия последнего owner; запрет deny базовых read (§9.3) |
| Потеря записей аудита | Транзакционная запись для risk≥1 (не fire-and-forget) (§7.1) |
| Мигание/несинхронность прав на клиенте | Роль/снимок на SSR (Спринт 0.5); клиент — косметика (§8.7) |

---

## 15. Открытые вопросы (уточнить на Спринте 0)
1. ~~Иерархия отделов: наследует ли `lead_recruiter` вложенные отделы или scope плоский?~~ **Решено [v1.1]: scope `departments` = назначенные узлы + ВСЕ их потомки по `department.parentId`** (наследование по дереву). `member_scopes.department_ids` хранит только корневые точки входа; разворачивание в поддерево — задача `scopedDb` (стратегия `byDepartmentSubtree`, §5.3) через рекурсивный CTE. Обоснование: схема оргструктуры — дерево произвольной глубины (`schema/app.ts:2594`, «дирекция → департамент → отдел → сектор»), ведущий рекрутер отвечает за направление целиком; плоский scope противоречил бы модели и создавал «дыры» при добавлении под-отделов. Следствия: (а) поддерево кэшируется в `ActorContext` на время запроса (§5.1, §17.1); (б) рекурсивный CTE имеет защиту от циклов (depth-limit / visited-check), т.к. инвариант «без циклов» проверяется лишь на уровне API; (в) перемещение отдела (`parentId` меняется) → bump `permissions_version` (§5.5) у затронутых `lead_recruiter`, иначе кэш поддерева устареет.
2. ~~Несколько ролей на участника (union) — включаем в v2 или одна роль?~~ **Решено [v1.1]:** в v2 — ровно одна роль на участника (ограничение приложения); схема `member_roles` остаётся many-to-many, union откладывается в v3. Потребность «роль + чуть-чуть» покрывается overrides (§4.5).
3. Как AI-ассистент/расширение получают права — тем же `can()` (обязательно «не шире пользователя») — подтвердить контур.
4. Объём hard-delete → archive: какие сущности уже имеют `isArchived`, где нужна новая корзина.
5. Прод-топология БД для RLS: прямое соединение vs PgBouncer session-mode.

---

## 17. Пробелы к учёту при детализации спринтов [v1.1, из ревью §5]

Не отдельные фичи, а вопросы, которые нужно закрыть при детализации соответствующих спринтов, чтобы не всплыли в проде.

1. **Производительность scope-фильтров на списках/аналитике (Спринт 3).** `job_id IN (…сотни…)` + JOIN аналитики требуют индексов и проверки планов запросов. NFR §1.4 покрывает `can()` (p95<5 мс), но НЕ стоимость scope-фильтров в тяжёлых запросах. Действие: замерить на пилоте 3.0, добавить индексы под `scopedDb`-паттерны.
2. **Инвалидация прав при нескольких инстансах (Спринт 2).** Кэш `ActorContext` в памяти процесса (§5.1) + `permissions_version`: для single-instance self-hosted достаточно. Для облака (упоминается в аудите) нужен внешний кэш/pub-sub (Redis) или сверка версии из БД на каждом запросе. Действие: зафиксировать режим — «БД-сверка версии» по умолчанию (без внешних зависимостей), внешний кэш — опция для облака.
3. **Миграция старых `activity_log` под hash-chain (Спринт 6).** Доисторические записи без `prev_hash`/`entry_hash`. Действие: верификатор трактует запись с первым непустым `entry_hash` как «genesis»; более ранние — вне цепочки (помечены `legacy`, не участвуют в проверке целостности).
4. **Разделение ролей БД для аудита (Спринт 6).** Сейчас приложение ходит под одной ролью (`db.ts`). `REVOKE UPDATE/DELETE` на `activity_log` + `BYPASSRLS` для миграций = разделение прав БД. Действие: отдельная миграционная роль (`huntfork_migrator` с `BYPASSRLS`) в `migrations.ts`/`pgDumpEnv.ts`, приложение — `huntfork_app` без права правки журнала.
5. **Реальный объём 2FA (Спринт 8, вынесено отдельно).** Плагин Better Auth + UI (enroll, recovery codes, принудительное включение) ≈ 1 неделя. Учтено в §12 (Спринт 8) как отдельная задача, а не строка.

---

## 18. Быстрый индекс (текущий код, отталкиваемся от него)
| Что | Путь |
|---|---|
| Права (код, будет заменён БД) | `shared/permissions.ts` |
| Better Auth сервер | `server/utils/auth.ts` |
| Главный гард (перепишется на can()) | `server/utils/requirePermission.ts` |
| Гард без прав | `server/utils/requireAuth.ts` |
| Гард HM | `server/utils/requireHm.ts` |
| Скоуп рекрутера (поглотится) | `server/utils/recruiterScope.ts` |
| HM job-доступ | `server/utils/hiringManager.ts` |
| Видимость комментариев (баг recruiter) | `server/utils/comments/visibility.ts` |
| Аудит (расширится) | `server/utils/recordActivity.ts`, `schema/app.ts:898` |
| Клиентский хук (заменится) | `app/composables/usePermission.ts` |
| Схема member/session | `server/database/schema/auth.ts` |
| Схема job_member/hm | `server/database/schema/hm.ts` |
| Схема домена (реестр ресурсов) | `server/database/schema/app.ts` |
| UI участников (расширится) | `app/pages/dashboard/settings/members.vue` |
| Оргструктура (для scope departments) | `app/pages/dashboard/settings/org-structure.vue` |
| Демо read-only (НЕ view-as) | `server/utils/previewReadOnly.ts` |
