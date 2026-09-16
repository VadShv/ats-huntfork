# hh.ru Integration Extensions — Implementation Plan (full-stack)

> **Goal:** Довести 7 интеграций (#2, #3, #4, #6, #7, #8, #10) до рабочего UI: закрыть бэкенд-пробелы, реализовать страницы/компоненты, провести RBAC, i18n, миграции и проверку.
> **Based on:** `docs/hh-extensions-plan.md` (продукт/архитектура), `docs/hh-extensions-ui-plan.md` (вайрфреймы UI).
> **Scope:** все 7 фич по фазам; полный backend там, где его нет (#8/#10/#4 + добор #6).
> **Date:** 2026-09-15

---

## 0. Текущий статус (по факту кода)

| # | Фича | Backend | Миграция | RBAC | UI | Фаза |
|---|---|---|---|---|---|---|
| 3 | Шаблоны вакансий | ✅ `templates/` CRUD+use | ✅ 0107 | ✅ `hhTemplate` | ❌ | 1 |
| 7 | Массовые действия | ✅ `bulk-actions/` (async job) | ✅ 0110 | ✅ `hhBulkAction` | ❌ | 1 |
| 2 | Статистика | ✅ `stats/` | ✅ 0112 | ✅ `hhStats` | ❌ | 1 |
| 8 | Переговоры (история) | ⚠️ только `sync/:linkId` | ❌ | ✅ `hhNegotiation` | ❌ | 2 |
| 10 | Похожие вакансии | ❌ | ❌ | ❌ | ❌ | 2 |
| 6 | Авто-ответы | ⚠️ rules CRUD+test, нет `/log` GET | ✅ 0108 | ✅ `hhAutoRespond` | ❌ | 2 |
| 4 | Синхр. комментариев | ❌ | ❌ | ❌ | ❌ | 3 |

**Реальные эндпоинты (фиксация формы):**
- `POST /api/hh/bulk-actions` `{ actionType, targetType, itemIds[], filter?, params?: {collection?, messageText?} }` → row `{id, status:'pending', …}` + BullMQ-джоба. `GET /api/hh/bulk-actions/:id` → прогресс/результат. `POST /api/hh/bulk-actions/:id/cancel`.
- `GET /api/hh/stats/vacancy/:linkId` → `{ current, trend }` (ключ — `linkId` связи `hhVacancyLink`, не vacancyId). `GET /api/hh/stats/org`, `GET /api/hh/stats/trend`, `POST /api/hh/stats/refresh`.
- `GET /api/hh/auto-respond/rules` (сорт. по `priority`), `POST/PUT/DELETE /api/hh/auto-respond/rules[/:id]`, `POST /api/hh/auto-respond/test`. **Нет** `GET /api/hh/auto-respond/log`.
- `POST /api/hh/sync/:linkId` → `syncVacancyLink(linkId)`. **Нет** list/thread/import переговоров.
- `GET /api/hh/templates`, `POST /api/hh/templates`, `PUT/DELETE /api/hh/templates/:id`, `POST /api/hh/templates/:id/use`.

**Точки вставки UI:**
- `app/components/SettingsSidebar.vue` — статический массив `settingsNav`; «Интеграции» на строке 81.
- `app/components/AppTopBar.vue` — `jobTabs` computed (строка 111), ключи i18n `dashboard.jobs.tabs.*`.
- `app/pages/dashboard/applications/index.vue` — `selectedIds` (стр.459), sticky `<Teleport>` (стр.1075), `bulkReject`/`bulkMoveToStage` — точка расширения.
- i18n: `i18n/locales/ru.json` (+ `en.json` и др.).
- UI-кит: `UiModal/UiButton/UiCard/UiBadge/UiDrawer/UiInput/UiSelect/UiSegmented/UiTextarea`, `analytics/AeChart.client.vue`, `EmptyState`. Композаблы: `usePermission`, `useConfirm`, `useToast`, `useDetailTabRoute`.

**Коррекция к UI-плану:** ворота прав используют camelCase-ресурсы — `{ hhTemplate: ['read'] }`, **не** `{ hh: ['templates:read'] }`.

---

## 1. Cross-cutting (выполняется первым / параллельно с Phase 1)

### 1.1 RBAC — новые ресурсы
**Файл:** `shared/permissions.ts` (statements + ролевые пресеты), `shared/access/resources.ts`, `shared/access/matrix.ts`, `shared/access/role-presets.ts`.

- [ ] Зарегистрировать ресурс `hhComment: ['read','sync']` (для #4).
- [ ] Зарегистрировать ресурс `hhSimilarVacancy: ['read']` (для #10).
- [ ] Добавить ресурсы в пресеты ролей: `admin` — все действия; `recruiter` — `hhComment:['read','sync']`, `hhSimilarVacancy:['read']`; `hiring_manager` — read.
- [ ] Провести `tests/` для матрицы (есть исполняемый scope-matrix — обновить инварианты).

### 1.2 i18n
- [ ] Добавить ключи `dashboard.jobs.tabs.stats` и `dashboard.jobs.tabs.hhNegotiations` во все локали (`i18n/locales/*.json`).
- [ ] Строки страниц/компонентов hh — через `t()` с префиксом `dashboard.settings.hh.*` / `dashboard.hh.*` (не хардкод).

### 1.3 Общая инфра
- [ ] Создать каталог `app/components/hh/` (все 12 новых компонентов).
- [ ] Общий композабл `app/composables/useHhStatus.ts` — кэшированный `useFetch('/api/hh/status')` (`connected`, `configured`) для ворот/пустых состояний (один запрос на layout).
- [ ] Единый стиль ошибок hh: тосты `toast.error(title, { message })` с кодом из `HhApiError`.

---

## 2. Phase 1 — Quick Wins (параллельно, нет кросс-зависимостей)

### 2.1 [#3] Шаблоны вакансий — UI only (backend готов)

**Ворота:** `usePermission({ hhTemplate: ['read'] })` (+ `['create','update','delete']` для действий).

**Новые файлы:**
- [ ] `app/pages/dashboard/settings/hh-templates.vue` — `layout:'settings'`, `middleware:['auth','require-org']`; `useFetch('/api/hh/templates', {key:'hh-templates'})`; сетка `UiCard` (name, cached area, `last_used_at` → «Использовано Nx»/«Новое», dropdown Edit/Delete); «+ Создать» → `HhTemplateEditor`; `EmptyState` когда пусто; `AccessDeniedBanner` если нет прав.
- [ ] `app/components/hh/HhTemplateEditor.vue` — `UiModal size="lg"`; поля: name, description, vacancy_data (name, salary from/to/currency, area, employment_type, description via `MarkdownDescription`, skills tag-input), `is_shared` checkbox. Save → `POST /api/hh/templates` / `PUT /api/hh/templates/:id` → `toast.success` → `refreshNuxtData('hh-templates')`.
- [ ] `app/components/hh/HhTemplateUseModal.vue` — предзаполнен из `template.vacancy_data`, все поля редактируемы; «Опубликовать» → `POST /api/hh/templates/:id/use` → `toast.success` + ссылка на hh.ru URL.

**Правки:**
- [ ] `SettingsSidebar.vue` — после «Интеграции» (стр.81) добавить пункт `{ label: 'Шаблоны вакансий', to: '/dashboard/settings/hh-templates', icon: FileText }` (воротить видимость через `useHhStatus` или всегда показывать + пустое состояние).
- [ ] `app/pages/dashboard/jobs/new.vue` — кнопка «Сохранить как шаблон» рядом с «Опубликовать» → открывает `HhTemplateEditor` с предзаполнением текущей формы.

**Проверка:** typecheck/lint; ручной CRUD; публикация из шаблона (на hh-сэндбоксе/моке); пустое состояние; запрет при отсутствии прав.

---

### 2.2 [#7] Массовые действия — UI (backend готов, async-job форма)

**Ворота:** `usePermission({ hhBulkAction: ['execute'] })`.

**Правки `app/pages/dashboard/applications/index.vue`** (расширить существующий sticky bulk-bar, стр.1075):
- [ ] Кнопка **«Отправить сообщение»** → открывает `HhBulkMessageModal` (только для откликов, привязанных к hh.ru; прочие — skip с причиной).
- [ ] Кнопка **«Изменить статус hh ▾»** → dropdown статусов hh.ru (Пригласить/Подумать/Отказать/Архив).
- [ ] Оба действия → `POST /api/hh/bulk-actions` `{ actionType:'sendMessage'|'setStatus', targetType:'application', itemIds:[...selectedIds], params:{ messageText } | { collection: hhStatus } }` → получить `action.id` → опрос `GET /api/hh/bulk-actions/:id` (poll каждые 1–2с) → прогресс-бар «42/85» в sticky-баре → по завершению тост «Успешно: N, Ошибки: M» + `refreshNuxtData('applications')` + `selectedIds.clear()`.
- [ ] Кнопка «Отмена» операции → `POST /api/hh/bulk-actions/:id/cancel`.
- [ ] Сохранить существующие локальные `bulkReject`/`bulkMoveToStage` без изменений.

**Новые файлы:**
- [ ] `app/components/hh/HhBulkMessageModal.vue` — `UiModal size="md"`; dropdown шаблонов (message-type из #3) + textarea; warning о необратимости; `useConfirm().ask({variant:'danger'})` перед отправкой; результат с раскрываемыми ошибками.
- [ ] `app/composables/useHhBulkAction.ts` — обёртка создания+опроса+отмены джобы (переиспользуется).

**Проверка:** выбор >20 → прогресс; частичный сбой → перечень ошибок; отклики без `hhNegotiationId` → skip; >100 → предупреждение + обработать первые 100 (или фон. джоба уже это делает — уточнить по `bulkActions` worker).

---

### 2.3 [#2] Статистика вакансий — UI (backend готов)

**Ворота:** `usePermission({ hhStats: ['read'] })` (+ `['refresh']` для кнопки).

**Новые файлы:**
- [ ] `app/pages/dashboard/jobs/[id]/stats.vue` — `layout:'dashboard'`; определить `hhVacancyLink` по jobId (`useFetch('/api/hh/status')` или link-эндпоинт); `useFetch('/api/hh/stats/vacancy/:linkId', {key:'hh-stats'})` → `{current, trend}`; 4 метрика-карточки (views, applications, conversion, invitations); тренд-график `<AeChart :option="trendOption" />` (line, 2 серии) через `baseCartesianOption()` из `chart-theme.ts`; разбивка по статусам (горизонт. бары/`UiBadge`); «Обновить» → `POST /api/hh/stats/refresh` → `refreshNuxtData('hh-stats')`; `EmptyState` «Не опубликована на hh.ru»; badge «Данные могут быть устаревшими» если `fetched_at` > 24ч.
- [ ] `app/components/hh/HhVacancyStats.vue` — инкапсуляция панели метрик+графика (переиспользуется).
- [ ] `app/components/hh/HhStatsWidget.vue` — виджет дашборда: `useFetch('/api/hh/stats/org', {key:'hh-stats-summary'})` → top-5 по откликам, тренд-стрелка; «Подробнее» → `/dashboard/jobs/:id/stats`.

**Правки:**
- [ ] `AppTopBar.vue` `jobTabs` (стр.111) — добавить `{ label: t('dashboard.jobs.tabs.stats'), to: \`${base}/stats\`, icon: BarChart3, exact: true }`.
- [ ] `app/pages/dashboard/index.vue` — добавить `HhStatsWidget` в сетку виджетов (воротить по `useHhStatus().connected`).

**Проверка:** вакансия без linkId → «Не опубликована»; 404 на hh.ru → stale-badge; первый запрос (нет истории) → только current, без тренда.

---

## 3. Phase 2 — Medium Effort

### 3.1 [#8] История переговоров — backend + UI

**Backend (пробел):**
- [ ] Изучить `server/utils/hh/sync.ts` `syncVacancyLink` — сохраняются ли сообщения переговоров. Если нет:
  - [ ] Миграция `0114_hh_negotiation_history.sql` — таблица `hh_negotiation_history` (схема из `docs/hh-extensions-plan.md` §4.1); + схема в `server/database/schema`.
  - [ ] Дополнить `syncVacancyLink` персистентностью сообщений + `is_in_huntfork` (match по `hh_negotiation_id` в `applications`).
- [ ] `GET /api/hh/negotiations?vacancyLinkId=` — пагин. список, две секции (imported / hh-only). `requirePermission({ hhNegotiation: ['read'] })`.
- [ ] `GET /api/hh/negotiations/:id/messages` — полный тред.
- [ ] `POST /api/hh/negotiations/import/:hhId` — импорт отклика в Huntfork. `requirePermission({ hhNegotiation: ['import'] })`.
- [ ] (Синхронизация уже есть: `POST /api/hh/sync/:linkId`.)

**Ворота:** `usePermission({ hhNegotiation: ['read'] })` (+ `['sync','import']`).

**Новые файлы UI:**
- [ ] `app/pages/dashboard/jobs/[id]/negotiations.vue` — `layout:'dashboard'`; `useFetch('/api/hh/negotiations', {query:{vacancyLinkId}})`; две секции (зелёная точка / оранжевая точка); «Синхронизировать» → `POST /api/hh/sync/:linkId` → прогресс → `refreshNuxtData('hh-negotiations')`; «Последняя синхронизация: X мин назад» из `last_synced_at`; «Показать ещё» (load more).
- [ ] `app/components/hh/HhNegotiationCard.vue` — имя/статус-badge/счётчик сообщений; imported → «Открыть» (→ `HhNegotiationThread`); hh-only → «Импортировать в Huntfork» → `POST /api/hh/negotiations/import/:hhId`.
- [ ] `app/components/hh/HhNegotiationList.vue` — список карточек + пагинация.
- [ ] `app/components/hh/HhNegotiationThread.vue` — `UiModal size="lg"` или `UiDrawer`; сообщения (incoming лево/серый, outgoing право/brand); sanitize HTML; reply → `POST` к существующему/новому эндпоинту отправки сообщения (уточнить — переиспользовать #4 send или `negotiations/topic/:id/messages`); авто-skroll.

**Правки:**
- [ ] `AppTopBar.vue` `jobTabs` — добавить `{ label: t('dashboard.jobs.tabs.hhNegotiations'), to: \`${base}/negotiations\`, icon: MessageSquare, exact: true }`.

**Проверка:** отклик только на hh.ru → оранжевый badge + «Импортировать»; несколько резюме одного кандидата — отдельные записи; HTML в сообщениях — sanitize; авто-синхр. индикатор для активной вакансии.

---

### 3.2 [#10] Похожие вакансии — полный backend + UI

**Backend (с нуля):**
- [ ] Миграция `0115_hh_similar_vacancies_cache.sql` — `hh_similar_vacancies_cache` (TTL 1ч) + схема.
- [ ] `POST /api/hh/similar-vacancies` `{ candidateId | resumeText }` — извлечь критерии (skills, position, area), cache (resume_hash), на миссе `GET https://api.hh.ru/vacancies?text=&area=&per_page=20`, исключить вакансии своей организации, кэш. `requirePermission({ hhSimilarVacancy: ['read'] })`.
- [ ] (Reverse) «Похожие кандидаты» — матчинг кандидатов org против требований вакансии (skills overlap, server-side) — эндпоинт `POST /api/hh/similar-candidates` или reuse существующий поиск кандидатов.

**Ворота:** `usePermission({ hhSimilarVacancy: ['read'] })` — скрывать виджет целиком при запрете.

**Новые файлы UI:**
- [ ] `app/components/hh/HhSimilarVacancies.vue` — на `candidates/[id].vue`: `useFetch('/api/hh/similar-vacancies', {method:'POST', body:{candidateId}})` lazy on mount; skeleton-карточки; каждая: title, employer, area, salary, «На hh.ru ↗» (`alternate_url`, `target="_blank"`), «Связать» (создать application); «Показать ещё»; `EmptyState` / «Добавьте навыки…».
- [ ] `app/components/hh/HhSimilarCandidates.vue` — на `jobs/[id]/index.vue`: кандидаты из базы с % совпадения; «Откликнуть на вакансию».

**Правки:**
- [ ] `app/pages/dashboard/candidates/[id].vue` — добавить `HhSimilarVacancies` в правый сайдбар/под контентом.
- [ ] `app/pages/dashboard/jobs/[id]/index.vue` — collapsible-секция `HhSimilarCandidates`.

**Проверка:** нет skills/position → промпт; 0 результатов → broaden (убрать area, top skills); диверсификация по работодателю.

---

### 3.3 [#6] Авто-ответы — добор backend + UI

**Backend (добор):**
- [ ] `GET /api/hh/auto-respond/log?ruleId=&limit=` — таблица лога (миграция 0108 уже создала `hh_auto_respond_log`; добавить схему если нет). `requirePermission({ hhAutoRespond: ['read'] })`.
- [ ] «Повторить» для failed — `POST /api/hh/auto-respond/log/:id/retry` (или reuse `test.post`).

**Ворота:** `usePermission({ hhAutoRespond: ['read'] })` (+ `['create','update','delete']`).

**Новые файлы UI:**
- [ ] `app/pages/dashboard/settings/hh-auto-respond.vue` — `layout:'settings'`; `useFetch('/api/hh/auto-respond/rules')` + `useFetch('/api/hh/auto-respond/log?limit=50')`; карточки правил (toggle active/inactive → `PUT`, name, scope, условия, template, sent_count, last_sent, [Изменить][Журнал][Удалить]); журнал-таблица (время, кандидат, статус-иконка, превью, ошибка); `EmptyState`.
- [ ] `app/components/hh/HhAutoRespondRuleEditor.vue` — `UiModal size="lg"`; scope (все/конкретная вакансия из `useFetch('/api/jobs')`); условия (keywords tag-input, city, min experience); источник сообщения (template из #3 / inline textarea); задержка (немедленно/N мин); `is_active`. Save → `POST/PUT /api/hh/auto-respond/rules`.
- [ ] `app/components/hh/HhAutoRespondLog.vue` — таблица + «Повторить» для failed + пагинация.

**Правки:**
- [ ] `SettingsSidebar.vue` — пункт `{ label: 'Авто-ответы', to: '/dashboard/settings/hh-auto-respond', icon: Zap }` после «Шаблоны вакансий».

**Проверка:** toggle → `PUT`; несколько правил на один отклик → порядок/«first match only»; failed → retry; withdrawn отклик → skip.

---

## 4. Phase 3 — Deep Integration

### 4.1 [#4] Синхронизация комментариев — полный backend + UI

**Backend (с нуля):**
- [ ] Миграция `0116_application_comment_hh_sync.sql` — `ALTER application_comment ADD hh_message_id TEXT UNIQUE, hh_direction TEXT, hh_sync_status TEXT DEFAULT 'local', hh_synced_at TIMESTAMPTZ` + индексы (см. план §5.1). + схема.
- [ ] Модифицировать существующий `POST /api/applications/:id/comments` — при `application.hhNegotiationId` + org hh config: ставить `hh_sync_status='pending'`, async-отправка `POST https://api.hh.ru/negotiations/topic/:id/messages`; флаг `hhLocalOnly` → `'local'`.
- [ ] `POST /api/hh/comments/sync` `{ applicationId }` — двунапр. синхр. `requirePermission({ hhComment: ['sync'] })`.
- [ ] `POST /api/hh/comments/send` `{ commentId }` — ретрай отправки. `requirePermission({ hhComment: ['sync'] })`.
- [ ] Фоновая джоба `hh:comments:sync` (каждые 5 мин для активных applications) — инбаунд (дедуп по `hh_message_id`) + аутбаунд (pending/failed).
- [ ] Существующий GET комментариев — вернуть `hh_sync_status`, `hh_direction`, `hh_message_id`.

**Ворота:** `usePermission({ hhComment: ['read','sync'] })`.

**Правки UI (additive, переиспользует существующие компоненты):**
- [ ] `app/components/Comments/ApplicationCommentItem.vue` — badge по `hh_sync_status`: `synced`+outgoing → «hh.ru ✓» (info), `synced`+incoming → «hh.ru ←» (info), `pending` → «ожидает hh» (warning), `failed` → «ошибка hh» (danger) + «Повторить»; incoming — стиль кандидата (лево, серый).
- [ ] `app/components/Comments/ApplicationCommentComposer.vue` — тумблер «На hh.ru» (виден при `application.hhNegotiationId` + hh config, default ON); unchecked → `hhLocalOnly:true`.
- [ ] `app/components/Comments/ApplicationCommentThread.vue` — кнопка «↻ Синхр. hh» в хедере → `POST /api/hh/comments/sync`; индикатор «Последняя синхр.: X мин» / «⚠ N ожидают отправки».
- [ ] `app/composables/useApplicationComments.ts` — добавить `hhLocalOnly?` в body create; типы для `hh_*` полей.

**Проверка:** bidirectional; дедуп; edit после sync → warning (не ре-сенд); delete локально без удаления на hh.ru; negotiation closed → failed gracefully; >5000 chars → валидация; markdown→plain text для hh.ru.

---

## 5. Миграции (новые)

| # | Файл | Назначение | Фича |
|---|---|---|---|
| 0114 | `0114_hh_negotiation_history.sql` | `hh_negotiation_history` | #8 |
| 0115 | `0115_hh_similar_vacancies_cache.sql` | `hh_similar_vacancies_cache` | #10 |
| 0116 | `0116_application_comment_hh_sync.sql` | ALTER `application_comment` + индексы | #4 |

Все миграции — idempotent (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), + journal.json, + drizzle-схема.

---

## 6. Сводный манифест файлов

**Новые страницы (4):** `settings/hh-templates.vue`, `settings/hh-auto-respond.vue`, `jobs/[id]/stats.vue`, `jobs/[id]/negotiations.vue`.
**Новые компоненты (12):** `hh/HhTemplateEditor`, `hh/HhTemplateUseModal`, `hh/HhBulkMessageModal`, `hh/HhVacancyStats`, `hh/HhStatsWidget`, `hh/HhNegotiationList`, `hh/HhNegotiationCard`, `hh/HhNegotiationThread`, `hh/HhSimilarVacancies`, `hh/HhSimilarCandidates`, `hh/HhAutoRespondRuleEditor`, `hh/HhAutoRespondLog`.
**Новые композаблы (3):** `useHhStatus`, `useHhBulkAction`, (+`useApplicationComments` правки).
**Правки существующих (11):** `SettingsSidebar.vue`, `AppTopBar.vue`, `applications/index.vue`, `jobs/new.vue`, `dashboard/index.vue`, `candidates/[id].vue`, `jobs/[id]/index.vue`, `Comments/ApplicationCommentItem.vue`, `Comments/ApplicationCommentComposer.vue`, `Comments/ApplicationCommentThread.vue`, `useApplicationComments.ts`.
**Backend новые эндпоинты:** `hh/negotiations/index.get`, `hh/negotiations/[id]/messages.get`, `hh/negotiations/import/[hhId].post`, `hh/similar-vacancies.post`, `hh/similar-candidates.post`, `hh/auto-respond/log/index.get`, `hh/auto-respond/log/[id]/retry.post`, `hh/comments/sync.post`, `hh/comments/send.post`.
**RBAC/i18n:** `shared/permissions.ts` (+ `access/resources|matrix|role-presets.ts`), `i18n/locales/*.json`.

---

## 7. Верификация

- [ ] `npm run typecheck` (или эквивалент из AGENTS.md) — после каждой фазы.
- [ ] `npm run lint` — после каждой фазы.
- [ ] Unit-тесты: condition evaluation (#6), sanitize HTML (#8), dedup `hh_message_id` (#4), similar-vacancies cache (#10).
- [ ] Integration-тесты эндпоинтов с mock hh.ru (nock/msw) — #8 list/thread/import, #10 similar, #4 sync/send, #6 log.
- [ ] E2E (playwright, `e2e/`): CRUD шаблонов; bulk-действия с прогрессом; страница статистики; переговоры (две секции); авто-ответ toggle; comment sync badge.
- [ ] RBAC: исполняемая scope-matrix — новые ресурсы `hhComment`, `hhSimilarVacancy` + инварианты.
- [ ] Ручной QA-чеклист: rate limit/partial failure/offline (нет hh config) для каждой фичи.

---

## 8. Рекомендуемый порядок и параллелизация

```
Week 1–2  Phase 1 (параллельно, 3 ворктри):
  ├── #3 Шаблоны (UI only)            ~2–3д
  ├── #7 Массовые действия (UI)       ~2–3д
  └── #2 Статистика (UI)              ~3–4д
Week 3–4  Phase 2:
  ├── #8 Переговоры (backend+UI)      ~4–5д  (можно стартовать сразу)
  ├── #10 Похожие вакансии (full)     ~2–3д  (можно стартовать сразу)
  └── #6 Авто-ответы (добор+UI)       ~3–4д  (после #3 — шаблоны для message body)
Week 5–6  Phase 3:
  └── #4 Comment Sync (full)          ~6–8д  (после #8 — переиспользует sync-паттерны)
```

Cross-cutting (§1) — в начале, параллельно с Phase 1 (RBAC-ресурсы #4/#10 нужны только в Phase 2/3, но i18n + `useHhStatus` + каталог `hh/` — сразу).

**Agent Manager:** Phase 1 — 3 независимых worktree-сессии; Phase 2 — 3 сессии (#6 после #3); Phase 3 — 1 сессия. Каждая сессия: ветка `feat/hh-<feature>`, по завершении — typecheck/lint + PR.

---

## 9. Риски / открытые вопросы

- **#8 хранилище переговоров:** нужно подтвердить, что `syncVacancyLink` не персистит сообщения — иначе миграция 0114 избыточна. (Задача §3.1 шаг 1.)
- **#7 форма джобы:** уточнить по worker'у `HH_BULK_ACTION_QUEUE` (`server/utils/hh/bulkActions`), как возвращаются per-item результаты и обрабатывается ли >100 в фоне — это влияет на UI прогресса.
- **#8 отправка сообщения в тред:** есть ли эндпоинт отправки `negotiations/topic/:id/messages` на backend, или переиспользовать #4 `comments/send`. Решить до реализации треда.
- **#10 similar-candidates:** есть ли существующий поиск/матчинг кандидатов для reuse (reverse-направление).
- **Rate limits hh.ru (429):** убедиться, что общие limiter'ы (`server/utils/hh/client.ts`) применяются в новых эндпоинтах #8/#10/#4.
- **GDPR:** лог авто-ответа хранит текст сообщений — TTL (default 90д) — подтвердить политику хранения.
