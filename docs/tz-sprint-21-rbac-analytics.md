# ТЗ — Спринт 21: администрирование прав через UI и аналитический дашборд

Автор: Vladimir Serzhantov · Дата: 2026-08-18 · Статус: draft v1

Скоуп: **два независимых, но связанных трека** — (A) полноценное администрирование ролей, скоупов и участников из UI, (B) аналитический дашборд подбора уровня Хантфлоу поверх уже имеющихся сущностей (`application_stage_history`, `pipeline_stage`, `activity_log`, `application_source_tracking`).

Ссылки на существующие артефакты:

- `shared/permissions.ts` — 12 ресурсов, роли owner/admin/member/hiring_manager (базовая матрица)
- `docs/role-model-and-permissions.md` — текущая ролевая документация
- `server/utils/recruiterScope.ts` — реализация скоупа «мои вакансии» через `jobMember`
- `app/pages/dashboard/settings/members.vue` — админка участников (два списка + матрица read-only)

Что базовое не трогаем: **базовые этапы воронки, скрининг Qwen Yandex, импорт с hh.ru, миграционный пайплайн**. Все переходы этапов — только через существующий единый API перехода.

---

## Часть A. Администрирование прав через UI

Цель: дать owner/admin возможность полностью управлять доступом «из настроек», без редактирования кода. При этом **встроенные роли (owner/admin/member/hiring_manager) остаются защищёнными** — их можно только копировать и на их основе создавать кастомные роли.

### A.1. Модель данных

Новые таблицы (одна миграция, идемпотентно):

```sql
-- Кастомные роли уровня организации (клон одной из системных за базу)
CREATE TABLE role_definition (
  id text PRIMARY KEY,                            -- gen_random_uuid
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  code text NOT NULL,                             -- kebab-case, уникален в рамках org
  name text NOT NULL,                             -- отображаемое имя
  description text,
  base_role text NOT NULL,                        -- 'owner'|'admin'|'member'|'hiring_manager' (шаблон, откуда клонировали права)
  is_system boolean NOT NULL DEFAULT false,       -- true у 4 встроенных, редактировать нельзя
  is_archived boolean NOT NULL DEFAULT false,
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX role_definition_org_idx ON role_definition(organization_id);

-- Разрешения роли: одна строка = один action на ресурсе
CREATE TABLE role_permission (
  id text PRIMARY KEY,
  role_id text NOT NULL REFERENCES role_definition(id) ON DELETE CASCADE,
  resource text NOT NULL,                         -- 'job'|'candidate'|... (из shared/permissions.ts)
  action text NOT NULL,                           -- 'create'|'read'|'update'|'delete' (+ future: 'export'|'assign'|'move_stage')
  UNIQUE (role_id, resource, action)
);
CREATE INDEX role_permission_role_idx ON role_permission(role_id);

-- Назначение роли пользователю в организации (заменяет одноимённое поле в member,
-- но пока сосуществует с ним — миграция читает старое значение и сидлит по нему).
-- Один пользователь — одна роль в организации (v1).
CREATE TABLE member_role_assignment (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES role_definition(id) ON DELETE RESTRICT,
  assigned_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
```

Сид при создании организации: 4 записи `role_definition` с `is_system=true` и `code IN ('owner','admin','member','hiring_manager')`; заполнение `role_permission` из статических `shared/permissions.ts` (единая точка правды при первичном сиде).

### A.2. Ресурсы и действия — расширение статитик

К уже существующим `create/read/update/delete` на 12 ресурсах добавить **гранулярные действия** (модификация `shared/permissions.ts`, обратно совместимо):

| Ресурс | Новые действия | Смысл |
|---|---|---|
| `job` | `assign_recruiter`, `assign_hm`, `publish`, `archive`, `export` | Права на назначение членов, публикацию, архивацию, экспорт |
| `application` | `move_stage`, `reject`, `bulk_action`, `export`, `reassign` | Перевод между этапами, отказ, массовые действия |
| `candidate` | `merge`, `export`, `import`, `delete_pii` | Слияние дублей, выгрузка PII, GDPR-удаление |
| `interview` | `schedule_others`, `cancel_others`, `join_link` | Слот-менеджмент за других |
| `document` | `download`, `delete` | Разделение просмотр/скачивание/удаление |
| `emailTemplate` | `publish`, `share_across_org` | Публикация как «утверждённый» |
| `activityLog` | `export` | Выгрузка аудита |
| `sourceTracking` | `create_link`, `edit_link`, `view_analytics` | UTM-ссылки vs. аналитика |
| `pipeline` | `create_template`, `assign_to_job` | Отделение шаблонов от применения |
| `organization` | `manage_members`, `manage_roles`, `manage_integrations`, `manage_billing`, `manage_sso` | Раздробление админских способностей |
| `analytics` (новое) | `view_org`, `view_own`, `export`, `drill_down` | Скоупы аналитики |
| `automation` (новое) | `create`, `read`, `update`, `delete`, `run_manual` | Автоматизации/триггеры |

`requirePermission` в бэке не меняет сигнатуру — только словарь. Клиентский `usePermission` продолжает работать (better-auth AC).

### A.3. Скоупы данных (data scoping)

Права + матрица определяют **что можно делать**, скоупы — **над какими записями**. В v1 закрепить 3 скоупа на ресурсы `job`, `application`, `interview`, `candidate`:

- `own` — «мои» (я в `jobMember` как recruiter/assignee; для candidate — я создатель/владелец воронки)
- `team` — «моей команды» (см. A.4)
- `org` — «вся организация»

Хранение: на роль в `role_definition` добавляется JSONB-колонка `data_scopes` вида `{"job":"own","application":"own","interview":"team","candidate":"org"}`. По умолчанию:

- `owner`/`admin` — `org` везде
- `member` — `own` на job/application/interview (текущее поведение через recruiterScope), `org` на candidate (read)
- `hiring_manager` — `own` на job (где он в jobMember как hiring_manager) и всё дочернее по FK

Реализация: `resolveRecruiterScope` из Спринта 20.2 превращается в универсальный `resolveDataScope(orgId, userId, resource)` — возвращает `{scope: 'org'|'team'|'own', ids: string[] | null}` (null = не сужать). Все критичные API (`/api/jobs`, `/api/applications`, `/api/interviews`, `/api/dashboard/*`, `/api/analytics/*`) идут через него. Сентинел `'__none__'` для пустого списка остаётся.

### A.4. Команды (teams) — минимальная поддержка

Для скоупа `team` нужна лёгкая группировка:

```sql
CREATE TABLE team (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE TABLE team_member (
  team_id text NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  is_lead boolean NOT NULL DEFAULT false,
  PRIMARY KEY (team_id, user_id)
);
```

Простой список без иерархии (иерархия — v2). «Команда» видит вакансии, где хоть один из членов команды состоит в `jobMember`.

### A.5. UI — админка

Все правки — в `app/pages/dashboard/settings/`.

#### A.5.1. `settings/members.vue` — существующая страница

Оставляем два списка (команда / НМ). Добавляем в правой части каждой строки:

- Селектор роли: `Select` со списком **всех ролей организации** (системных + кастомных), недоступен для owner-самого-себя и disabled, если `!organization:manage_members` у текущего пользователя.
- Селектор команды: `Combobox` из `team` (можно назначать в несколько команд — но одна из них помечается primary).
- Иконка «настроить доступ к вакансиям»: открывает боковую панель `MemberJobAccessDrawer` (см. A.5.4).

Уже существующая RolePermissionsMatrix (сейчас read-only) остаётся, но теперь она умеет:

- Читать активный `role_id` из URL-параметра `?role=<id>` (по умолчанию — owner)
- Показывать пометку «Системная роль (только чтение)» для is_system
- Для кастомных ролей — inline-редактор (см. A.5.3)

#### A.5.2. Новая страница `settings/roles/index.vue` — «Роли и права»

Отдельный раздел в навигации настроек. Содержит:

- Список ролей (карточками): 4 системные + N кастомных. У каждой: имя, описание, база, число участников, «Дублировать», «Архивировать» (только кастомные).
- Кнопка «Создать роль» → модалка «На основе какой роли?» (owner/admin/member/hiring_manager) → сразу открывается редактор роли.
- Пустое состояние: «Пока только системные роли. Создайте свою — например, «Рекрутёр с правом отклонять» или «HR BP с доступом к аналитике».»

#### A.5.3. `settings/roles/[id].vue` — редактор роли

Разделы:

1. **Основное** — имя, code (auto из имени), описание, база (только для отображения).
2. **Матрица прав** — редактируемая версия текущей `RolePermissionsMatrix`. По строкам — ресурсы, по колонкам — actions (C/R/U/D + гранулярные). Чекбоксы с батч-переключалками (вся строка / вся колонка). Изменения диффятся визуально относительно базовой роли — «+ добавлено», «− убрано», индикация в шапке (`3 изменения относительно шаблона»).
3. **Скоупы данных** — таблица по ресурсам, для каждого — Radio `own / team / org`. Только для ресурсов, где скоуп имеет смысл (job/application/interview/candidate).
4. **Ограничения** (v1 minimal, v2 расширение) — «Может создавать вакансии максимум N в день», «Не может видеть кандидатов старше M месяцев», «Может видеть только вакансии со статусом X». Сохраняем в JSONB `constraints` — v1 просто хранение и отображение, применение — v2.
5. **Участники этой роли** — кто сейчас назначен (переход в участники с фильтром).
6. **История изменений роли** — read-only лента из `activity_log` (`role.*` события).

Действия: «Сохранить», «Дублировать», «Архивировать» (запрещено если >0 активных участников). Атомарный `PATCH /api/roles/:id` — валидация на бэке проверяет, что нельзя убрать `organization:read` у роли, назначенной себе (защита от блокировки).

#### A.5.4. `MemberJobAccessDrawer.vue` — доступ к вакансиям пользователя

Right-side drawer из строки участника. Три вкладки:

- **Назначения** — таблица вакансий, где пользователь состоит в `jobMember`, с колонками «Роль на вакансии» (recruiter / hiring_manager / watcher / assignee), «Кем добавлен», «Когда». Кнопка «Добавить вакансию» → комбобокс + выбор роли.
- **Массовое назначение** — фильтр по вакансиям (статус, департамент, теги) + «Назначить рекрутёром на все».
- **Просмотр под этим пользователем** — «Открыть UI как <имя>» (impersonation — v2, пока просто ссылка на дашборд с preview-параметром).

#### A.5.5. `settings/teams/index.vue` — команды

CRUD команд. Карточка команды: имя, описание, список участников с лидом, счётчик активных вакансий команды, кнопка «Открыть вакансии команды».

#### A.5.6. Расширение `settings/index.vue`

Раздел «Безопасность»:

- Тумблер «Требовать 2FA для owner/admin».
- Тумблер «Ограничить создание пользователей только по инвайт-ссылке».
- Настройка домена: «Автоматически подтверждать регистрацию по email на домене X с ролью Y».
- Аудит-лог доступа: ссылка на `settings/audit-log` (see A.6).

Раздел «Ограничения по умолчанию»:

- «Максимальное число активных вакансий на рекрутёра» — soft cap (предупреждение при превышении, не блокировка).
- «Автоматически архивировать закрытые вакансии через N дней».
- «Автоматически убирать назначения рекрутёра при увольнении пользователя» (при `member.status='inactive'`).

#### A.5.7. `settings/audit-log.vue` — журнал доступа (новое)

Уже есть таблица `activity_log`. Добавляем страницу и API `GET /api/activity-log/index` с фильтрами:

- Актор (user)
- Действие (enum, включая новые role.*, permission.*, team.*)
- Ресурс (type + id)
- Диапазон дат
- Экспорт в CSV (право `activityLog:export`)

Инфинити-лист + группировка по дню. Каждая строка — expandable JSON с `metadata`.

### A.6. Бэк — API

Новые эндпоинты (все под `organization:manage_roles` кроме read-only):

```
GET    /api/roles                            — список ролей org
POST   /api/roles                            — создать кастомную (body: name, base_role)
GET    /api/roles/:id                        — детально + разрешения + скоупы
PATCH  /api/roles/:id                        — обновить (matrix diff, scopes, constraints)
DELETE /api/roles/:id                        — архивировать (soft; hard delete запрещён)
POST   /api/roles/:id/duplicate              — клонировать

GET    /api/teams                            — список команд
POST   /api/teams
PATCH  /api/teams/:id
DELETE /api/teams/:id
POST   /api/teams/:id/members                — {userId, isLead?}
DELETE /api/teams/:id/members/:userId

PATCH  /api/members/:userId/role             — {roleId} — сменить роль пользователю в org
POST   /api/members/:userId/job-access       — {jobId, memberRole} — добавить в jobMember
DELETE /api/members/:userId/job-access/:jobMemberId

GET    /api/activity-log                     — фильтруемая лента
GET    /api/activity-log/export?format=csv   — экспорт

GET    /api/permissions/matrix               — снапшот текущего пользователя (для usePermission)
                                               учитывает role_definition + role_permission + data_scopes
```

Все мутации логируются в `activity_log` с `resourceType='role'|'team'|'member'` и подробным `metadata` (diff разрешений).

### A.7. Каскадирующие проверки

- Нельзя удалить/архивировать роль с активными участниками — сначала переназначить.
- Нельзя убрать `organization:read` у своей же роли.
- Нельзя понизить последнего owner (проверка на API-уровне: `count(role='owner') >= 1`).
- При `job.delete` (permission) — предупреждение о каскаде откликов/интервью с указанием счётчиков; двойное подтверждение.

### A.8. Миграционный план (обратная совместимость)

1. Миграция создаёт 4 записи `role_definition` для каждой org (сид из `shared/permissions.ts`) — `is_system=true`.
2. Миграция копирует `member.role` → `member_role_assignment.role_id` (маппинг owner→owner-role-id и т. д.).
3. Better-auth AC-слой продолжает использовать `member.role`; параллельно `requirePermission` начинает **читать из `role_permission`** — так между запусками не будет расхождения.
4. Через 1 релиз-цикл убираем чтение `member.role` в бэке и оставляем только `member_role_assignment` как источник правды. `member.role` остаётся полем совместимости с Better Auth.

---

## Часть B. Аналитический дашборд подбора

Ссылки на существующее: `server/api/dashboard/stats.get.ts` (уже даёт counts, pipeline, jobsByStatus, recentApplications, topJobs), `application_stage_history` (движения по этапам), `pipeline_stage.bucket` (`working`/`rejected`), `application_source_tracking` (UTM), `job.pipelineId`, `activity_log`.

Аналога «Хантфлоу-подобной» страницы **пока нет** — есть только оперативный дашборд для одного пользователя. Мы делаем **отдельный раздел «Аналитика»**, не трогая текущий `/dashboard`.

### B.1. Информационная архитектура

Новая ветка навигации `/dashboard/analytics`:

- `analytics/index.vue` — **Обзор** (KPI + временные тренды)
- `analytics/funnel.vue` — **Воронка** (Хантфлоу-style: этапы, конверсии, среднее время)
- `analytics/velocity.vue` — **Скорость подбора** (SLA этапов, отставания)
- `analytics/sources.vue` — **Источники и каналы** (UTM + custom sources)
- `analytics/team.vue` — **Команда и рекрутёры** (индивидуальные метрики)
- `analytics/jobs.vue` — **По вакансиям** (сортируемая таблица со всеми метриками)
- `analytics/rejections.vue` — **Причины отказов** (по кастомным reject-этапам)

Каждая страница — с едиными глобальными фильтрами (см. B.2).

### B.2. Глобальная панель фильтров

Компонент `AnalyticsFilterBar.vue`, состояние — в URL (share-friendly):

- Период: пресеты (7 дней / 30 / 90 / квартал / год / всё время) + custom range + сравнение с предыдущим периодом
- Организация → project (пока одна orga) → **вакансии** (мультивыбор)
- **Рекрутёры** (мультивыбор, с учётом скоупа текущего пользователя)
- **Команды**
- **Департаменты / теги вакансий** (v2)
- **Источники** (channel + campaign)
- **Воронка/шаблон** (для сравнения «яблок с яблоками»)

Фильтры применяются к _любой_ странице через один composable `useAnalyticsFilters()` (в URL, реактивный, синхронизируется с `AnalyticsFilterBar`).

### B.3. Раздел «Обзор» — `analytics/index.vue`

KPI-плитки (с дельтой к предыдущему периоду):

- Активные вакансии
- Открытые вакансии без активности > 7 дней
- Новых откликов за период
- Отклики в работе
- **Time-to-Hire** (среднее и p50/p90) — от даты создания application до перехода в терминальный success-этап
- **Time-to-Interview** — от `new` до первого интервью
- **Offer Acceptance Rate** — hired / offer
- **Overall Conversion** — hired / total applications
- Всего интервью за период / показатель no-show

Тренд-графики (line + area):

- Отклики по дням (стеком по статусам)
- Найм по неделям
- Средний time-to-hire по неделям

Все графики — Chart.js (уже подключён по стеку `visualize` / `shared/10-charts-and-dataviz.md`), даунсемплинг серверный.

### B.4. Раздел «Воронка» — `analytics/funnel.vue` (ключевой Хантфлоу-аналог)

Компонент `PipelineFunnelChart.vue`:

- **Горизонтальная воронка** по этапам активной воронки (или сравнения нескольких, если фильтр допускает). Каждый этап — цвет из `pipeline_stage.color`, ширина пропорциональна числу applications, дошедших до этого этапа.
- Наведение показывает: **вошло / вышло дальше / отсеялось / зависло**. Отдельно — **средняя длительность на этапе** и **p90**.
- Клик по этапу → выпадает список отсеянных applications с причинами отказа (см. B.7).
- Переключатель «Абсолют / Относительные %».
- Сравнение периодов: показывает вторую полупрозрачную воронку сзади.

Дополнительные виджеты на странице:

- **Матрица переходов** (heatmap N×N этапов) — из `application_stage_history`. Позволяет увидеть, откуда куда чаще всего двигают, включая «возвраты» на предыдущие этапы.
- **Топ-3 «узких мест»**: этапы с наибольшим средним временем + перечнем таких applications.

Расчёт сервером в `GET /api/analytics/funnel`:
- Использует `application_stage_history` (`from_stage_id`, `to_stage_id`, `moved_at`) — стандартный оконный запрос: длительность на этапе = `lead(moved_at) - moved_at`.
- Для applications без ухода с этапа — берём `now() - moved_at`.
- Для «первого попадания» — минимальный `moved_at` в этот этап (учитываем возвраты).
- Материализованное представление `mv_stage_metrics_daily` для агрегата по дням (обновляется по крону раз в 30 мин, инвалидируется при ручном событии `application_stage_history.insert`).

### B.5. Раздел «Скорость подбора» — `analytics/velocity.vue`

Добавляем в `pipeline_stage` две колонки (миграция):

```sql
ALTER TABLE pipeline_stage
  ADD COLUMN sla_hours integer,        -- ожидаемое время на этапе
  ADD COLUMN warning_hours integer;    -- когда подсвечивать «замедление»
```

- **SLA-таблица**: этап → sla → факт p50/p90 → % выхода за SLA. Возможность отредактировать SLA прямо здесь (если есть `pipeline:update`).
- **Замедления сейчас**: список applications, которые превысили SLA по своему текущему этапу, с сортировкой по «просрочка ч.».
- **Гистограмма** времени на этапе (bins 0–24ч, 1–3 дня, 3–7, 7–14, >14).
- **Time-to-Hire** breakdown по вакансиям (топ-10 самых медленных / быстрых).

### B.6. Раздел «Источники» — `analytics/sources.vue`

Использует `application_source_tracking`:

- **Таблица источников**: channel × campaign, с колонками «Отклики / Прошли скрининг / Интервью / Оффер / Найм», конверсия каждой ступени.
- Bar-chart топ-10 источников по найму.
- **Стоимость 1 найма** (v2, если появится cost-per-source) — placeholder + пометка «будет доступно с интеграцией бюджета».
- **UTM-разбивка** для одной кампании — drill-down по source/medium.

### B.7. Раздел «Причины отказов» — `analytics/rejections.vue`

- Bar-chart по этапам bucket=`rejected` (какой этап отсеивает больше всех).
- **Распределение причин отказа** — если есть кастомные reject-этапы «Не подошёл по опыту / Отклонил оффер / Прошёл собес, но…».
- **Матрица «где отказали × источник»** — heatmap. Помогает увидеть источник с высоким отсевом на конкретных этапах.
- Клик по ячейке — раскрытие списка отказанных applications с ссылкой в карточки.

### B.8. Раздел «Команда» — `analytics/team.vue`

Права: доступ по `analytics:view_org`. Рекрутёру доступен только сам себя (`view_own`).

- **Лидерборд рекрутёров** (за период): назначено вакансий, добавлено кандидатов, интервью проведено, найм закрыт, средний time-to-hire, конверсия. Сортируемая таблица.
- Individual view: клик на рекрутёра → страница с личными графиками (вакансии, воронка по его applications, sla-нарушения).
- «Загрузка» — активных вакансий × кандидатов в работе на рекрутёра (простая карточка + предупреждение при превышении soft cap из настроек).

### B.9. Раздел «По вакансиям» — `analytics/jobs.vue`

- Мега-таблица с колонками: вакансия, статус, воронка, дней открыта, откликов всего / за период, применён / интервью / оффер / найм, конверсия, time-to-hire, назначенные рекрутёры.
- Экспорт CSV/XLSX (`analytics:export`).
- Bulk-select + быстрые действия: «Отметить в риске», «Переназначить рекрутёра», «Открыть карточку».

### B.10. Бэк — API

```
GET /api/analytics/overview          — KPI + тренды (period, filters)
GET /api/analytics/funnel            — данные для воронки + матрица переходов
GET /api/analytics/velocity          — SLA breakdown + slow applications
GET /api/analytics/sources           — UTM/channel таблица
GET /api/analytics/rejections        — reject reasons breakdown
GET /api/analytics/team              — лидерборд + individual
GET /api/analytics/jobs              — таблица по вакансиям (пагинация серверная)
GET /api/analytics/export?report=X   — CSV/XLSX выгрузка
```

Общий контракт:

- Все принимают одни и те же query-параметры (`from`, `to`, `compareFrom`, `compareTo`, `jobIds[]`, `recruiterIds[]`, `sourceIds[]`, `pipelineIds[]`).
- Валидация через zod-схему `analyticsFilterSchema` в `server/utils/schemas/analytics.ts`.
- Скоуп применяется автоматически: `analytics:view_own` → сужение до `resolveDataScope`.
- Кэш на 30 сек в памяти + `mv_stage_metrics_daily` материализация.

### B.11. Data warehouse — материализованные представления

Одна миграция, идемпотентно. Пример для базового MV (см. sql — псевдокод, финальный DDL в PR):

```sql
CREATE MATERIALIZED VIEW mv_application_stage_durations AS
SELECT
  h.organization_id,
  h.application_id,
  a.job_id,
  h.to_stage_id AS stage_id,
  s.pipeline_id,
  s.bucket,
  h.moved_at AS entered_at,
  LEAD(h.moved_at) OVER (PARTITION BY h.application_id ORDER BY h.moved_at) AS exited_at,
  h.moved_by_user_id
FROM application_stage_history h
JOIN application a ON a.id = h.application_id
JOIN pipeline_stage s ON s.id = h.to_stage_id;

CREATE INDEX ON mv_application_stage_durations (organization_id, entered_at);
```

Обновление — `REFRESH MATERIALIZED VIEW CONCURRENTLY` по крону раз в 15 минут + вручную из UI (кнопка «Обновить» в analytics с индикатором «данные от HH:MM»).

### B.12. Экспорт и подписки

- Экспорт любой таблицы аналитики в CSV/XLSX (право `analytics:export`).
- **Подписки на отчёты**: пользователь может подписаться на еженедельное письмо/уведомление с обзорной страницей. Хранение — простая таблица `analytics_subscription (user_id, report_key, cadence)` + существующий cron-механизм.

---

## Часть C. UX-акценты и штрихи

- **Empty states** на каждой странице аналитики (короткий текст + пример «попробуйте выбрать период 30 дней»).
- **Skeleton loaders** для всех графиков — читать `shared/05-taste.md`.
- **Дизайн-токены** — только уже имеющиеся, палитра Nexus.
- **Локализация** — все строки через `useI18n`, ключи в `i18n/locales/ru.json`.
- **Мобильный** — обзорная страница адаптивна (KPI-плитки в 2 столбца), сложные графики — с overflow-x. Полная админка ролей мобильно не приоритет.

---

## Часть D. Roadmap и оценка

### Спринт 21.1 (2 недели) — фундамент прав

1. Миграции `role_definition`, `role_permission`, `member_role_assignment`, `team`, `team_member`.
2. Сид системных ролей из `shared/permissions.ts`.
3. Универсальный `resolveDataScope`.
4. API ролей и команд (CRUD + assign).
5. UI: `settings/roles/index.vue`, `settings/roles/[id].vue` (создание + редактор матрицы + скоупы).
6. Обновление `settings/members.vue`: селектор роли из динамического списка; MemberJobAccessDrawer.
7. Аудит-лог: `settings/audit-log.vue` + API.

Готово, если: owner создаёт кастомную роль «Тимлид рекрутинга», даёт ей org-скоуп на job/candidate/application, назначает пользователю — тот видит новое поведение без релиза кода.

### Спринт 21.2 (2 недели) — аналитика фундамент

1. Материализованное представление `mv_application_stage_durations` + крон-refresh.
2. API: `/api/analytics/overview`, `/funnel`, `/jobs`.
3. Компоненты: `AnalyticsFilterBar`, KPI-плитки, `PipelineFunnelChart`, матрица переходов.
4. Страницы: `analytics/index.vue`, `analytics/funnel.vue`, `analytics/jobs.vue`.
5. Экспорт CSV для jobs.

Готово, если: owner может открыть funnel за 30 дней, увидеть конверсии по этапам, кликом раскрыть отсеянных.

### Спринт 21.3 (2 недели) — расширения

1. SLA на этапах (миграция + UI редактирования + `/velocity`).
2. `analytics/sources.vue`, `analytics/rejections.vue`, `analytics/team.vue`.
3. Подписки на отчёты.
4. Гранулярные права (`assign_recruiter`, `move_stage`, `analytics:*`) — переход `requirePermission` на новую матрицу.
5. Полное отключение чтения `member.role` в бэке (после проверки).

---

## Часть E. Что осознанно не делаем в этом ТЗ

- **Иерархия команд / департаментов** — плоский список в v1.
- **Impersonation** («войти как пользователь») — сложно с точки зрения аудита, отдельный ТЗ.
- **ABAC / policy-as-code** — избыточно, пока хватает RBAC + скоупы.
- **Cost-per-hire, ROI по каналам** — нет источника данных о расходах.
- **Predictive analytics / ML-прогноз найма** — отдельный трек.
- **Multi-org аналитика** — сейчас одна org на пользователя.

---

## Часть F. Риски и как их снимаем

| Риск | Как снимаем |
|---|---|
| Расхождение статических `shared/permissions.ts` с БД | Единственная точка правды — БД; статические — только для сида и для клиента (снапшот через `/api/permissions/matrix`) |
| Ломаем текущий скоуп рекрутёра из Спринта 20.2 | `resolveRecruiterScope` становится частным случаем `resolveDataScope`; параллельный запуск в шедоу-режиме 1 релиз |
| Тяжёлые запросы аналитики на больших org | Материализованные представления + пагинация + кэш; страница показывает «данные от HH:MM» |
| Утечка PII через экспорт | Право `candidate:export` отделено; сам экспорт логируется в `activity_log` с чек-суммой файла |
| Пользователь блокирует сам себя | На API — валидация «нельзя убрать `organization:read`/`manage_roles` у своей роли, если ты единственный owner» |
| Массовые операции без подтверждения | Все bulk-actions требуют ввод «текста подтверждения» + двойного клика |

---

## Часть G. Метрики успеха

Через 30 дней после релиза Спринта 21:

- % owner/admin, кто создал хотя бы одну кастомную роль — цель 40%
- Среднее число ролей на организацию — 5–7
- % активных пользователей, открывающих `/dashboard/analytics` хотя бы раз в неделю — 60%
- Медианный TTFB `/api/analytics/funnel` за 30 дней данных — < 400 мс
- Число обращений в поддержку про «не хватает прав» — снижение на 50%

