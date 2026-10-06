# ТЗ · Учёт и аналитика расхода ИИ («Расход ИИ»)

Версия: 1.0 · 06.10.2026 · HuntFork (`VadShv/ats-huntfork`, `main` = `a518117`)
Связанные документы: `docs/plan-prompt-bank.md` (Банк промптов), `docs/tz-search-map-v2.md` §6.1 (заменяется этим ТЗ).

---

## 0. Коротко

Сейчас в системе видно расход только на **скрининг**: страница `/dashboard/ai-analysis` читает одну таблицу `analysis_run`. Остальные 25 мест, где система обращается к модели (карта поиска, риски, дедуп, вопросы, опросники, отчёты по интервью, суфлёр, чат-бот, расширение, комментарии, песочница промптов), либо пишут токены в свои таблицы, либо только в лог, либо нигде.

Делаем **один журнал ИИ-вызовов** и **один каталог ИИ-операций**:

1. **Каталог операций = Банк промптов.** Каждая ИИ-операция системы получает ключ, совпадающий с `id` в `server/utils/ai/promptRegistry.ts` (`scoring.scoreApplication`, `searchMap.segments`…). Банк промптов становится полным реестром: что за операция, какой промпт, какая модель, **сколько стоит**.
2. **Учёт на уровне модели, а не вызывающего кода.** Middleware AI SDK (`wrapLanguageModel`) встраивается в `createLanguageModel` и записывает каждый вызов модели — включая прямые `generateText` / `streamText`, многошаговые агенты и стримы. Новая ИИ-фича учитывается автоматически.
3. **Контекст без переписывания сигнатур.** `withAiOperation({ operation, entity, trigger }, fn)` на `AsyncLocalStorage`: эндпоинт или воркер один раз говорит «сейчас идёт такая-то операция по такой-то сущности», middleware это читает.
4. **Цена фиксируется в момент вызова** (снимок цены и валюты конфигурации), поэтому история не «плывёт» при смене тарифа.
5. **Дашборд «Расход ИИ»**: разрезы по операциям, моделям, людям, вакансиям, триггерам; журнал вызовов; бюджеты и предупреждения; расход в карточке промпта, вакансии и карты поиска; юнит-экономика (стоимость ИИ на отклик, на вакансию, на найм).

Тексты промптов и ответов **не сохраняются** (персональные данные кандидатов) — только счётчики, длины и хэш версии промпта.

---

## 1. Цель: на какие вопросы отвечает модуль

Руководитель / владелец организации должен за минуту ответить:

| Вопрос | Где ответ |
|---|---|
| Сколько мы потратили на ИИ за месяц и сколько потратим к концу месяца | KPI-карточки + прогноз |
| На что именно уходят деньги: скрининг, карта поиска, суфлёр, чат-бот… | Разрез «Операции» |
| Какая модель / конфигурация самая дорогая и стоит ли переключить | Разрез «Модели» |
| Кто из рекрутёров тратит больше всего и на что | Разрез «Люди» |
| Сколько стоит ИИ на одной вакансии, на один отклик, на один найм | Разрез «Вакансии» + юнит-экономика |
| Сколько уходит на фоновые процессы (автоскоринг, риски, автопилот), а сколько — на ручные клики | Разрез «Триггеры» |
| Где деньги сгорают впустую: ошибки, таймауты, «размышления» reasoning-моделей, повторы | Блок «Потери» |
| Изменили промпт — подорожала операция или подешевела | Версии промпта (хэш) в карточке операции |
| Сколько стоит один конкретный клик «Дополнить по брифу» | Журнал вызовов → трейс |
| Не вылетим ли за бюджет | Бюджеты, пороги, уведомления |

---

## 2. Ground truth: что есть сейчас

### 2.1. Инфраструктура
- Все модели создаются через `createLanguageModel(config)` (`server/utils/ai/provider.ts:163`); для Cloud.ru без thinking — через `createCloudRuStreamModel` (`provider.ts`, используется в `generateStructuredOutput` и `streamTextOutput`).
- Обёртки: `generateStructuredOutput` (`provider.ts:367`, возвращает `usage.promptTokens/completionTokens` и `responseModel`), `streamTextOutput` (`:500`), `streamStructuredOutput` (`:537`).
- Часть кода зовёт AI SDK напрямую, минуя обёртки: чат-бот (`server/api/chatbot/chat.post.ts:312`, `streamText`, до 8 шагов с инструментами), суфлёр (`server/utils/comms/assistant.ts:195`, `generateText`), ИИ в треде комментариев (`server/utils/comments/ai-thread-worker.ts:236`), саммари комментариев (`server/api/applications/[id]/comments/summarize.post.ts:137`).
- AI SDK `ai@6.0.174`: `LanguageModelUsage` содержит `inputTokens`, `outputTokens`, `inputTokenDetails.cacheReadTokens / cacheWriteTokens / noCacheTokens`, `outputTokenDetails.reasoningTokens`; есть `wrapLanguageModel` с `wrapGenerate` / `wrapStream`.
- Конфигурации: `ai_config` (`server/database/schema/app.ts:1095`) — `provider, model, inputPricePer1m, outputPricePer1m` (комментарий: «в USD»), назначения `isDefaultChatbot / Analysis / Interactive / Structuring`. Валюта не хранится, хотя Yandex и Cloud.ru тарифицируют в рублях.
- Фоновые задачи — pg-boss (`server/utils/queue/boss.ts`): автоскоринг, риски, отчёты по интервью MyMeet, ИИ в комментариях, автопилот суфлёра, вебхуки Telegram.
- Банк промптов: `server/utils/ai/promptRegistry.ts` — 12 записей верхнего уровня (+7 подрежимов Sidekick), API `/api/prompts/registry`, страница `/dashboard/prompts`, песочница `/api/prompts/sandbox/[id]/test`.

### 2.2. Где сейчас хранятся токены

| Таблица | Что | Используется дашбордом |
|---|---|---|
| `analysis_run` (`app.ts:1181`) | скрининг: `provider, model, promptTokens, completionTokens, status` | да — единственный источник `/api/ai-analysis/stats` |
| `resume_risk` (`app.ts:2281`) | риск-анализ резюме: `model, promptTokens, completionTokens` | нет |
| `meeting_report` (`app.ts:2438`) | отчёт по интервью: `generatedByModel, usageInputTokens, usageOutputTokens` | нет |
| `candidate_duplicate_candidate` (`app.ts:2521`) | ИИ-арбитр дублей: `aiUsageInputTokens, aiUsageOutputTokens` | нет |

Текущий дашборд считает стоимость по цене **default-конфигурации анализа**, а не той модели, что реально отработала (`server/api/ai-analysis/stats.get.ts`, расчёт `inputPrice/outputPrice` от `defaultAnalysisConfig`).

### 2.3. Полная инвентаризация ИИ-вызовов

| # | Операция (бизнес) | Код | Вызов | Токены сейчас |
|---|---|---|---|---|
| 1 | Скрининг отклика | `utils/ai/scoring.ts:266` ← `applications/[id]/analyze.post.ts`, `jobs/[id]/batch-score.post.ts`, `utils/ai/autoScore.ts` | structured | `analysis_run` |
| 2 | Генерация критериев оценки | `utils/ai/scoring.ts:189` ← `jobs/[id]/criteria/generate.post.ts`, `ai-config/generate-criteria.post.ts` | structured | нет |
| 3 | Структурирование резюме | `utils/ai/structureResume.ts:263` ← загрузка документа, `extension/capture*.post.ts`, `resume-version/structure-from-document.ts` | structured | возвращает, не пишет |
| 4 | Риск-анализ резюме | `utils/ai/assessRisk.ts:97` ← `utils/risk/worker.ts` | structured | `resume_risk` |
| 5 | ИИ-арбитр дублей | `utils/dedup/ai-arbiter.ts:162` ← `dedup/duplicates/[pairId]/ai-arbitrate.post.ts`, `dedup/ai-arbitrate-batch.post.ts` | structured | `candidate_duplicate_candidate` |
| 6 | ИИ-сводка кандидата | `api/candidates/[id]/ai-summary.post.ts:88` | structured | нет |
| 7 | Вопросы к интервью по вакансии | `utils/ai/generateInterviewQuestions.ts:96` ← `jobs/[id]/interview-questions/generate.post.ts` | structured | нет |
| 8 | Генерация вопросов банка | `utils/ai/generateBankQuestions.ts:73` ← `question-bank/questions/generate.post.ts` | structured | нет |
| 9 | Структурирование вопроса по CARE | `utils/ai/structureQuestionCare.ts:136` ← `question-bank/questions/[id]/structure-care.post.ts` | structured | нет |
| 10 | Персонализация опросной карты | `utils/ai/personalizeQuestionnaire.ts:95` ← `applications/[id]/question-set/personalize.post.ts` | structured | нет |
| 11 | Отчёт по интервью | `utils/ai/generateInterviewReport.ts:141` ← `utils/mymeet/interviewReportWorker.ts` | structured | `meeting_report` |
| 12–16 | Карта поиска: секции, доноры, гипотезы, вердикт, запрос гипотезы | `api/jobs/[id]/search-map/generate.post.ts:189` | structured ×1–3 | только ответ и лог (`runs[]`) |
| 17 | Карта поиска из расширения | `api/extension/search-map.post.ts:99` | structured | лог |
| 18 | hh-запрос из описания вакансии | `utils/hh/sourcing/aiQuery.ts:150` ← `jobs/[id]/sourcing-searches/index.post.ts` | structured | лог |
| 19 | Суфлёр: черновик ответа | `utils/comms/assistant.ts:195` ← `comms/assistantJobs.ts:134` | generateText | лог |
| 20 | Суфлёр: автопилот | то же ← `comms/assistantJobs.ts:274` (`autopilot: true`) | generateText | лог |
| 21 | Первый контакт в Telegram | то же ← `applications/[id]/telegram-first-contact.post.ts:62` | generateText | лог |
| 22 | Чат-бот / агенты | `api/chatbot/chat.post.ts:312` (до 8 шагов) | streamText | только клиенту (SSE `finish`) |
| 23 | Sidekick: 7 режимов | `api/extension/summarize.post.ts:209` | stream | нет |
| 24 | Sidekick: чат | `api/extension/chat.post.ts:102` | stream | нет |
| 25 | Sidekick: карточка интервью | `api/extension/interview-card.post.ts:110 / :157` | structured / stream | только ответ |
| 26 | Sidekick: верификация | `api/extension/verification/run.post.ts:119 / :166` | structured / stream | только ответ |
| 27 | Саммари обсуждения отклика | `api/applications/[id]/comments/summarize.post.ts:137` | generateText | нет |
| 28 | @ИИ в треде комментариев | `utils/comments/ai-thread-worker.ts:236` | generateText | нет |
| 29 | Песочница промптов: тест | `api/prompts/sandbox/[id]/test.post.ts:78` | stream | нет |
| 30 | Проверка подключения | `api/ai-config/[id]/test-connection.post.ts:34` | structured | нет |

В Банке промптов из этого списка есть 12 записей; отсутствуют №2 (отдельно от скоринга нет), 8–11, 12–17, 21, 24–29.

---

## 3. Ключевые решения

### 3.1. Каталог ИИ-операций = Банк промптов
- Ключ операции (`operation`) — строка вида `<домен>.<действие>` и **совпадает с `ProductionPrompt.id`** в `promptRegistry.ts`. Подрежимы — через точку (`extension.summarize.fit`, `searchMap.segments`).
- В `ProductionPrompt` добавляются поля:
  - `feature: AiFeature` — бизнес-группа для дашборда (§5.1);
  - `purpose: 'analysis' | 'structuring' | 'interactive' | 'chatbot'` — какое назначение конфигурации использует;
  - `defaultTrigger: 'user' | 'background' | 'extension' | 'system'`;
  - `entityType?: 'job' | 'application' | 'candidate' | 'search_map' | 'conversation' | 'meeting_report' | 'question' | 'duplicate_pair' | 'prompt_sandbox'`;
  - `costNote?: string` — подсказка, от чего зависит цена («растёт с длиной резюме», «до 8 шагов»).
- Реестр дополняется до полноты (§5.2). Добавляется тест: каждый ключ, переданный в `withAiOperation` в коде, существует в реестре, и каждая запись реестра где-то используется (grep-тест по `server/`).
- Банк промптов получает в карточке промпта блок «Использование» (§8.4) — то есть промпт, модель и расход видны в одном месте.

### 3.2. Учёт на уровне модели (middleware)
- Новый модуль `server/utils/ai/usage/middleware.ts`: `usageMiddleware(config)` на `wrapGenerate` и `wrapStream`.
- `createLanguageModel` и `createCloudRuStreamModel` возвращают `wrapLanguageModel({ model, middleware: usageMiddleware(config) })`. Других изменений в местах вызова для **учёта токенов** не требуется: прямые `generateText` / `streamText` тоже проходят через модель.
- Один вызов модели = одно событие. Многошаговый агент (чат-бот, до 8 шагов) = N событий с общим `trace_id` и `step_no`.
- `ProviderConfig` дополняется необязательными `id`, `name`, `inputPricePer1m`, `outputPricePer1m`, `cachedInputPricePer1m`, `priceCurrency` — `loadAiConfig` уже возвращает строку `ai_config` целиком, передаётся как есть. Для конфигов, собранных вручную (тест подключения, `chat.post.ts:278`), поля передаются явно.

### 3.3. Контекст операции (AsyncLocalStorage)
- `server/utils/ai/usage/context.ts`:
  ```ts
  withAiOperation<T>(ctx: {
    operation: AiOperationKey          // из реестра
    entity?: { type: AiEntityType; id: string }
    jobId?: string | null              // для разреза по вакансиям, если сущность — не вакансия
    trigger?: 'user' | 'background' | 'extension' | 'system'
    userId?: string | null             // кто инициировал; для фоновых — владелец задачи
    organizationId: string
    traceId?: string                   // если не задан — генерируется
  }, fn: () => Promise<T>): Promise<T>
  ```
- Вызывается **один раз** на верхнем уровне: в эндпоинте (после `requirePermission`) или в обработчике pg-boss-задачи. Вложенный `withAiOperation` переопределяет `operation`, но наследует `traceId`, пользователя и вакансию (пример: генерация вопросов интервью внутри зовёт генерацию критериев).
- Если middleware видит вызов без контекста — событие пишется с `operation = 'unattributed'`, в лог уходит предупреждение со стеком (первые 5 кадров). На дашборде «Без атрибуции» — отдельная строка; цель — 0.
- Для фоновых задач контекст передаётся в payload задачи (`aiCtx: { userId, trigger }`) и восстанавливается в обработчике.

### 3.4. Снимок цены
- В момент вызова в событие копируются цены и валюта конфигурации. Стоимость считается сразу (`cost`) и хранится в валюте конфигурации **и** в базовой валюте организации (`cost_base`) по курсу на момент вызова.
- Изменение цен в `ai_config` не меняет историю. Для пересчёта истории (ошибся с тарифом) — отдельное действие «Пересчитать по текущим ценам» за выбранный период с записью в журнал аудита (§10.3).

### 3.5. Приватность
- Не сохраняются: текст промпта, текст ответа, имена кандидатов, содержимое резюме.
- Сохраняются: длины (`prompt_chars`, `completion_chars`), `system_prompt_hash` (SHA-256 первых 64 hex — для определения версии промпта), идентификаторы сущностей.
- Журнал виден только ролям с правом `aiUsage:view_org` (§9); рекрутёр видит только свои события.

### 3.6. Надёжность
- Запись события **никогда не ломает** основной вызов: `try/catch`, ошибки учёта — в лог `[ai-usage] write failed`.
- Запись не блокирует ответ: события копятся в буфере процесса и вставляются батчем (до 50 штук или раз в 2 секунды); при завершении процесса — сброс буфера (`nitro close` hook).
- При ошибке вызова модели событие тоже пишется (`status = error / timeout / aborted`) — иначе не видно потерь.

---

## 4. Модель данных

Миграция `0123_ai_usage.sql`.

### 4.1. `ai_usage_event` — журнал вызовов

| Поле | Тип | Описание |
|---|---|---|
| `id` | text PK | uuid |
| `organization_id` | text FK → organization, cascade | |
| `created_at` | timestamptz | момент старта вызова |
| `trace_id` | text | одна бизнес-операция (клик / задача); все шаги и части |
| `step_no` | smallint | номер шага внутри трейса (агенты, 3 части карты поиска) |
| `operation` | text | ключ из реестра (`searchMap.segments`) или `unattributed` |
| `feature` | text | бизнес-группа (§5.1), денормализовано для быстрых срезов |
| `trigger` | text | `user` / `background` / `extension` / `system` |
| `user_id` | text FK → user, set null | инициатор |
| `job_id` | text FK → job, set null | вакансия (если применимо) — главный разрез |
| `entity_type` | text | `application`, `candidate`, `search_map`… |
| `entity_id` | text | без FK (сущности разных типов) |
| `ai_config_id` | text FK → ai_config, set null | какая конфигурация |
| `ai_config_name` | text | снимок имени (конфиг могут удалить) |
| `purpose` | text | назначение, по которому выбрана конфигурация |
| `provider` | text | `openai`, `cloud_ru`… |
| `model` | text | запрошенная модель |
| `response_model` | text | фактическая модель из ответа API |
| `mode` | text | `generate` / `stream` |
| `input_tokens` | integer | всего входных |
| `cached_input_tokens` | integer | из них прочитано из кэша провайдера |
| `cache_write_tokens` | integer | записано в кэш (Anthropic) |
| `output_tokens` | integer | всего выходных |
| `reasoning_tokens` | integer | из них «размышления» |
| `tokens_estimated` | boolean | провайдер не вернул usage — оценка по символам (§6.3) |
| `prompt_chars` | integer | длина system + prompt |
| `completion_chars` | integer | длина ответа |
| `system_prompt_hash` | text | версия промпта |
| `duration_ms` | integer | |
| `ttft_ms` | integer | время до первого токена (стримы) |
| `status` | text | `ok` / `repaired` (JSON восстановлен) / `error` / `timeout` / `aborted` |
| `error_code` | text | `schema`, `rate_limit`, `auth`, `timeout`, `provider_5xx`, `other` |
| `error_message` | text | до 300 символов, без данных кандидата |
| `finish_reason` | text | `stop`, `length`, `tool-calls`… |
| `price_currency` | text | `USD` / `RUB` |
| `input_price_per_1m` | numeric(12,4) | снимок |
| `cached_input_price_per_1m` | numeric(12,4) | снимок |
| `output_price_per_1m` | numeric(12,4) | снимок |
| `cost` | numeric(14,6) | в валюте конфигурации; null, если цена не задана |
| `cost_base` | numeric(14,6) | в базовой валюте организации |
| `fx_rate` | numeric(12,6) | курс на момент вызова |
| `is_backfilled` | boolean | перенесено из старых таблиц (§11) |

Индексы: `(organization_id, created_at desc)`, `(organization_id, feature, created_at)`, `(organization_id, operation, created_at)`, `(organization_id, job_id, created_at)`, `(organization_id, user_id, created_at)`, `(trace_id)`.

### 4.2. Изменения `ai_config`
- `price_currency text not null default 'USD'` — валюта цен (`USD` / `RUB`).
- `cached_input_price_per_1m numeric(10,4)` — цена кэшированного входа (если null — как обычный вход).
- Комментарии полей «в USD» заменить на «в валюте `price_currency`».
- В UI настроек ИИ: выбор валюты, подсказка для Yandex/Cloud.ru «тариф указывается за 1 000 токенов — умножьте на 1 000» (с калькулятором), предупреждение «Цена не задана — расход по этой модели считается только в токенах».

### 4.3. `ai_usage_settings` — настройки организации (1 строка на организацию)
| Поле | Описание |
|---|---|
| `organization_id` PK | |
| `base_currency` | `RUB` по умолчанию |
| `usd_rub_rate` | курс вручную; `rate_updated_at` |
| `rate_source` | `manual` (по умолчанию) / `cbr` — опционально подтягивать курс ЦБ раз в сутки |
| `retention_days` | срок хранения сырых событий, по умолчанию 400 |

### 4.4. `ai_usage_budget` — бюджеты
| Поле | Описание |
|---|---|
| `id`, `organization_id` | |
| `scope` | `org` / `feature` / `operation` / `user` |
| `scope_key` | ключ фичи / операции / id пользователя; null для `org` |
| `period` | `month` (основной) / `day` |
| `limit_amount`, `currency` | |
| `thresholds` | jsonb, по умолчанию `[50, 80, 100]` (%) |
| `on_exceed` | `notify` (по умолчанию) / `block_background` — останавливать только фоновые операции (§7.3) |
| `is_active`, `created_by_id`, `created_at` | |

### 4.5. `ai_usage_alert` — сработавшие пороги (чтобы не слать повторно)
`id, organization_id, budget_id, period_start, threshold, spent_amount, notified_at`.

### 4.6. Агрегаты (этап 4, по факту нагрузки)
`ai_usage_daily (organization_id, day, feature, operation, model, user_id, job_id, trigger, calls, errors, input_tokens, output_tokens, reasoning_tokens, cached_input_tokens, cost_base)` — пересчёт ночным cron через pg-boss и инкремент за текущий день на лету. Включается, только если запросы дашборда по `ai_usage_event` станут медленнее 1 с на реальных объёмах.

---

## 5. Каталог операций

### 5.1. Бизнес-группы (`feature`)

| `feature` | Название на дашборде |
|---|---|
| `screening` | Скрининг и критерии |
| `resume` | Разбор резюме |
| `verification` | Проверка кандидатов (риски, верификация, дубли) |
| `interview` | Интервью и опросные карты |
| `question_bank` | Банк вопросов |
| `search_map` | Карта поиска |
| `sourcing` | Сорсинг hh |
| `comms` | Коммуникации (суфлёр, автопилот, первый контакт) |
| `assistant` | ИИ-ассистент (чат-бот, агенты) |
| `extension` | Sidekick (расширение) |
| `collaboration` | Комментарии и обсуждения |
| `prompt_lab` | Банк промптов (песочница) |
| `system` | Служебное (проверка подключения) |

### 5.2. Операции (ключ = `id` в Банке промптов)

Жирным — новые записи реестра.

| `operation` | `feature` | purpose | триггер | сущность / вакансия |
|---|---|---|---|---|
| `scoring.scoreApplication` | screening | analysis | user / background (`autoScore`, batch) | application / job |
| `scoring.generateCriteria` | screening | analysis | user | job |
| `parsing.structureResume` | resume | structuring | user / extension / background | candidate |
| `risk.assessResumeRisk` | verification | analysis | background | candidate / job по отклику |
| `dedup.aiArbiter` | verification | analysis | user / background (batch) | duplicate_pair |
| **`extension.verification`** | verification | interactive | extension | candidate |
| `summary.candidateAiSummary` | verification | interactive | user | candidate |
| `interview.generateQuestions` | interview | analysis | user | job |
| **`interview.personalizeQuestionnaire`** | interview | analysis | user | application / job |
| **`interview.report`** | interview | analysis | background (MyMeet) | meeting_report / job |
| **`extension.interviewCard`** | interview | interactive | extension | candidate |
| **`questionBank.generate`** | question_bank | analysis | user | question |
| **`questionBank.structureCare`** | question_bank | structuring | user | question |
| **`searchMap.sections`** | search_map | structuring | user | search_map / job |
| **`searchMap.donors`** | search_map | analysis | user | search_map / job |
| **`searchMap.segments`** | search_map | analysis | user | search_map / job |
| **`searchMap.summary`** | search_map | structuring | user | search_map / job |
| **`searchMap.queryString`** | search_map | analysis | user | search_map / job |
| **`extension.searchMap`** | search_map | interactive | extension | job |
| `sourcing.hhQuery` | sourcing | analysis | user | job |
| `assistant.commsAssistant` | comms | interactive | user | conversation / job |
| **`assistant.commsAutopilot`** | comms | interactive | background | conversation / job |
| **`assistant.telegramFirstContact`** | comms | interactive | user | application / job |
| `chatbot.baseSystemPrompt` → переименовать в операцию **`chatbot.chat`** (промпт остаётся подзаписью) | assistant | chatbot | user | conversation |
| `extension.summarize.*` (7 подрежимов) | extension | interactive | extension | candidate |
| **`extension.chat`** | extension | interactive | extension | — |
| **`comments.summarize`** | collaboration | interactive | user | application / job |
| **`comments.aiThread`** | collaboration | interactive | background | application / job |
| **`promptLab.sandboxTest`** | prompt_lab | выбранная | user | prompt_sandbox |
| `infra.testConnection` | system | — | user | ai_config |

Для динамических промптов (чат-бот, суфлёр) карточка в Банке промптов уже помечена `isDynamic`; учёт от этого не зависит.

### 5.3. Связанные операции
В одном трейсе может быть несколько операций: «Дополнить по брифу» = `searchMap.sections` + `searchMap.donors` + `searchMap.segments` (3 параллельных вызова, `step_no` 1–3); генерация вопросов интервью может вызвать `scoring.generateCriteria`. Дашборд показывает и стоимость операции, и стоимость **действия пользователя** (трейса) — «один клик „Дополнить по брифу“ стоит в среднем X».

---

## 6. Правила подсчёта

### 6.1. Токены
Из `LanguageModelUsage` (AI SDK 6):
- `input_tokens` = `inputTokens`;
- `cached_input_tokens` = `inputTokenDetails.cacheReadTokens` (fallback — устаревшее `cachedInputTokens`);
- `cache_write_tokens` = `inputTokenDetails.cacheWriteTokens`;
- `output_tokens` = `outputTokens` (включает reasoning);
- `reasoning_tokens` = `outputTokenDetails.reasoningTokens` (fallback — `reasoningTokens`).

Для стримов usage берётся из финальной части (`finish` в `wrapStream`); если стрим прерван клиентом — `status = aborted`, токены по последнему известному значению или оценка (§6.3).

### 6.2. Стоимость
```
billable_input = input_tokens − cached_input_tokens
cost = billable_input / 1e6 × input_price
     + cached_input_tokens / 1e6 × (cached_input_price ?? input_price)
     + output_tokens / 1e6 × output_price
cost_base = cost × fx_rate      (1, если валюта конфигурации = базовой)
```
- Reasoning-токены входят в `output_tokens` и оплачиваются как выход — отдельно не умножаются, но показываются отдельно («из них размышления»).
- Если цена конфигурации не задана — `cost = null`; на дашборде такие вызовы считаются в токенах и помечаются «без цены» (с количеством и ссылкой на настройку).

### 6.3. Оценка, если провайдер не вернул usage
Некоторые OpenAI-совместимые эндпоинты не отдают usage в стриме. Тогда `tokens_estimated = true`, `input ≈ prompt_chars / 3.2`, `output ≈ completion_chars / 3.2` (коэффициент для смешанного рус./англ. текста; вынести в константу). На дашборде — пометка «≈» и доля оценочных вызовов.

### 6.4. Особые случаи
| Ситуация | Как пишем |
|---|---|
| JSON восстановлен из «грязного» ответа (`provider.ts`, ветка `extractJsonPayload`) | одно событие, `status = repaired`, токены из `err.usage` |
| Ошибка до ответа (401, 429, сеть) | событие с нулями, `status = error`, `error_code` |
| Таймаут 300 с | `status = timeout`, токены — если есть |
| Повторная попытка вызывающим кодом | отдельное событие в том же трейсе |
| Многошаговый агент | событие на каждый шаг, общий `trace_id` |
| Fallback на другую конфигурацию (`structuring` → `analysis`) | `purpose` = запрошенное, `ai_config_id` = фактическое; на дашборде видно «просили structuring, ушло в analysis» |
| Тест подключения | учитывается (`feature = system`), но по умолчанию скрыт фильтром |

---

## 7. Бюджеты и предупреждения

### 7.1. Настройка
Настройки → ИИ → вкладка «Бюджет». Можно задать:
- общий бюджет организации на месяц;
- бюджет на фичу (например, «Ассистент — не более 15 000 ₽»);
- бюджет на пользователя (опционально).

### 7.2. Проверка и уведомления
- Проверка — после записи каждого батча событий: сумма `cost_base` за текущий период по скоупу сравнивается с порогами; новый порог → запись в `ai_usage_alert` + уведомление.
- Каналы: in-app уведомление владельцу и администраторам (существующий модуль уведомлений) и баннер на странице «Расход ИИ». Email — если в организации включены email-уведомления.
- Текст: «Расход ИИ за октябрь достиг 80 % бюджета: 40 120 ₽ из 50 000 ₽. Больше всего — Скрининг (54 %). Прогноз на конец месяца: 61 000 ₽».

### 7.3. Блокировка (только по явной настройке `block_background`)
- При 100 % останавливаются только **фоновые** операции этого скоупа (`trigger = background`: автоскоринг, риски, автопилот, ИИ в комментариях): задачи pg-boss откладываются до начала следующего периода или до увеличения бюджета, в интерфейсе — статус «Отложено: исчерпан бюджет ИИ».
- Ручные действия пользователя **не блокируются** никогда — показывается предупреждение в тосте. Решение принимает человек.

### 7.4. Прогноз
`прогноз = потрачено с начала месяца / прошедшие дни × дней в месяце`, плюс поправка: если последние 7 дней дороже среднего — по последним 7 дням. Показывается рядом с бюджетом.

---

## 8. Интерфейс

### 8.1. Страница «Расход ИИ» — `/dashboard/ai-usage`
Пункт меню рядом с «ИИ-анализ». Фильтры сверху (сохраняются в URL): период (7 / 30 / 90 дней, месяц, свой), фича, операция, модель, конфигурация, пользователь, вакансия, триггер, статус; переключатель «₽ / $ / токены».

**Блок 1. Сводка (KPI-карточки)**
- Расход за период и изменение к предыдущему периоду (%).
- Прогноз на конец месяца и % бюджета (полоса с порогами).
- Вызовов / действий пользователей (трейсов).
- Средняя стоимость действия.
- Доля потерь: ошибки + таймауты + прерванные (в ₽ и %).
- Доля «размышлений» в выходных токенах.
- Вызовы без цены и без атрибуции (если > 0 — жёлтым, со ссылкой «исправить»).

**Блок 2. Динамика** — столбчатый график по дням, стек по фичам (переключатель: по моделям / по триггерам); линия бюджета на день.

**Блок 3. Операции** — главная таблица, дерево «фича → операция»:
| Операция | Вызовов | Действий | Токены вход / выход | Из них размышления | ₽ | Доля | Ср. ₽ за действие | Ошибки | Ср. время | Модель (основная) |
Сортировка по любой колонке, клик → карточка операции (§8.2).

**Блок 4. Вкладки разрезов**
- **Модели** — модель × конфигурация: вызовы, токены, ₽, средняя цена 1 000 токенов, % ошибок, среднее время, доля reasoning; рядом — подсказка «Операции X и Y можно перевести на structuring-модель: −N ₽/мес» (если для операции с `purpose = structuring` реально использовалась analysis-конфигурация).
- **Люди** — пользователь: ₽, вызовы, топ-3 операции, доля фоновых от его действий (автопилот, автоскоринг его вакансий).
- **Вакансии** — вакансия: ₽, вызовы, откликов, ₽ на отклик, нанято, ₽ на найм, топ операций; ссылка на вакансию.
- **Триггеры** — ручные / фоновые / расширение / системные: ₽ и вызовы; для фоновых — по задачам.

**Блок 5. Потери и аномалии**
- Топ-10 самых дорогих одиночных вызовов за период (операция, модель, токены, ₽, ссылка на трейс).
- Операции, подорожавшие > 1,5× к прошлому периоду при той же частоте (с указанием причины: сменилась модель / вырос промпт / новая версия промпта по хэшу).
- Операции с ошибками > 10 %.
- Вызовы с `finish_reason = length` (модель упёрлась в лимит — деньги потрачены, результата нет).

**Блок 6. Журнал вызовов** — таблица событий с фильтрами и пагинацией: время, операция, пользователь, сущность (ссылка), модель, токены, ₽, длительность, статус. Клик → **трейс**: все шаги действия на временной шкале (параллельные части карты поиска, шаги агента) с суммой.

**Экспорт** — CSV по текущим фильтрам (события или агрегат текущей вкладки).

### 8.2. Карточка операции (drawer)
- Описание из Банка промптов и ссылка на промпт.
- Графики: вызовы и ₽ по дням; распределение стоимости одного вызова (p50 / p90 / max).
- Таблица по версиям промпта (`system_prompt_hash`): период действия версии, вызовов, средние токены вход / выход, ₽ за вызов — видно, как правка промпта повлияла на цену.
- Разбивка по моделям.
- Последние 20 вызовов.

### 8.3. Встройки в существующие экраны
| Где | Что |
|---|---|
| Вакансия (`jobs/[id]`) | плашка «ИИ по вакансии: 1 240 ₽ · 312 вызовов» с раскрытием по операциям; ссылка на дашборд с фильтром по вакансии |
| Карта поиска (`SearchMapStatsPanel`) | «Генерация: N запусков · X ₽ · последний Y с»; у кнопок «Дополнить» — подсказка «обычно ≈ Z ₽» (средняя за 30 дней) |
| Кандидат | в табе ИИ — «ИИ по кандидату: X ₽» (разбор резюме, риски, сводка, верификация) |
| Страница «ИИ-анализ» | карточка «Стоимость» берёт данные из журнала по `feature = screening` с правильной ценой каждой модели; ссылка «Весь расход ИИ →» |
| Настройки → ИИ | валюта, цена кэша, предупреждение «цена не задана»; на карточке конфигурации — «за 30 дней: X ₽, N вызовов, операции: …»; вкладка «Бюджет» |
| Чат-бот | в разговоре — «Этот разговор: N шагов · X ₽» (видит автор) |

### 8.4. Банк промптов
- В списке промптов — колонки «Вызовов за 30 дн.» и «₽ за 30 дн.», сортировка по стоимости.
- В карточке промпта — блок «Использование»: вызовы, ₽, средние токены, основная модель, версии промпта по хэшу (как в §8.2), кнопка «Открыть в Расходе ИИ».
- В песочнице — после теста показывается «Тест: вход N / выход M токенов · X ₽» и сравнение со средним по прод-операции: «на 30 % дешевле текущего промпта».

---

## 9. Права (RBAC)

В `shared/permissions.ts` добавить ресурс:
```ts
aiUsage: ['view_own', 'view_org', 'view_costs', 'manage_budgets', 'export', 'recalculate'],
```
| Роль | Права |
|---|---|
| owner | все |
| admin | `view_own, view_org, view_costs, manage_budgets, export` |
| member (рекрутёр) | `view_own` — свои вызовы в токенах; деньги — только если выдано `view_costs` в пресете |
| hiring manager | нет |

- `view_own` — дашборд с принудительным фильтром `user_id = me`.
- `view_costs` — без него все суммы скрываются, остаются токены и вызовы.
- `recalculate` — пересчёт истории по текущим ценам (§3.4), только owner.

---

## 10. API

Все эндпоинты — `server/api/ai-usage/*`, фильтры в query: `from, to, feature, operation, model, aiConfigId, userId, jobId, trigger, status`.

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/summary` | KPI §8.1-1, прогноз, бюджет, предыдущий период |
| GET | `/timeseries?groupBy=feature\|model\|trigger&interval=day\|week` | ряды для графика |
| GET | `/breakdown?by=operation\|feature\|model\|config\|user\|job\|trigger` | строки таблиц §8.1-3/4 |
| GET | `/anomalies` | §8.1-5 |
| GET | `/events?cursor&limit` | журнал |
| GET | `/traces/:traceId` | все события трейса |
| GET | `/operations` | каталог операций (реестр + статистика за 30 дней) |
| GET | `/operations/:key` | карточка операции §8.2 |
| GET | `/export.csv?kind=events\|breakdown&by=…` | CSV |
| GET / PUT | `/settings` | валюта, курс, срок хранения |
| GET / POST / PATCH / DELETE | `/budgets[/:id]` | бюджеты |
| POST | `/recalculate` | `{from, to, aiConfigId?}` — пересчёт `cost` по текущим ценам, аудит |
| GET | `/api/jobs/:id/ai-usage`, `/api/candidates/:id/ai-usage`, `/api/jobs/:id/search-map/ai-usage` | встройки §8.3 |

Изменения существующих:
- `GET /api/prompts/registry` и `/registry/:id` — поле `usage30d` (если у пользователя есть `aiUsage:view_own`+).
- `GET /api/ai-analysis/stats` — стоимость считать из `ai_usage_event` (по цене каждой модели), формат ответа не меняется.
- `POST /api/prompts/sandbox/:id/test` — в финальном событии стрима `usage` и `cost`.

### 10.3. Аудит
Изменения цен в `ai_config`, бюджетов, курса и запуск пересчёта пишутся в существующий журнал активности (`recordActivity`).

---

## 11. Перенос истории (backfill)

Одноразовый скрипт в миграции (идемпотентный, по `is_backfilled` + исходному id в `entity_id`):

| Источник | → `operation` | Поля |
|---|---|---|
| `analysis_run` | `scoring.scoreApplication` | provider, model, tokens, status, created_at, application → job |
| `resume_risk` | `risk.assessResumeRisk` | model, tokens, created_at, candidate |
| `meeting_report` | `interview.report` | generatedByModel, usageInput/OutputTokens |
| `candidate_duplicate_candidate` | `dedup.aiArbiter` | aiUsageInput/OutputTokens (где не null) |

Цена — по текущей цене конфигурации с совпадающими `provider + model` (если такой нет — `cost = null`). На дашборде перенесённые данные помечены «история, цена приблизительная». Старые колонки токенов не удаляются (на них опираются существующие экраны).

После переноса `search_map_generation_run` из ТЗ карты поиска §6.1 **не создаётся** — её роль выполняет этот журнал; `runs[]` в ответе `generate` остаётся для UI.

---

## 12. Встраивание контекста: что поменять в коде

Для каждой строки §2.3 — обернуть верхний уровень в `withAiOperation`. Ориентировочно:

| Место | Изменение |
|---|---|
| `applications/[id]/analyze.post.ts` | `withAiOperation({ operation: 'scoring.scoreApplication', entity: application, jobId, trigger: 'user' })` |
| `jobs/[id]/batch-score.post.ts`, `utils/ai/autoScore.ts` | то же, `trigger: 'background'` для автоскоринга; один `traceId` на пакет |
| `utils/risk/worker.ts`, `utils/mymeet/interviewReportWorker.ts`, `utils/comments/ai-thread-worker.ts`, `utils/comms/assistantJobs.ts` | восстановление контекста из payload задачи |
| `jobs/[id]/search-map/generate.post.ts` | внешний `withAiOperation` по `scope` и вложенный на каждую часть (`searchMap.sections/donors/segments`) |
| `api/chatbot/chat.post.ts` | `operation: 'chatbot.chat'`, `entity: conversation`, конфиг с ценами в `createLanguageModel` |
| `api/extension/*.post.ts` | `trigger: 'extension'`, операция по режиму (`extension.summarize.${mode}`) |
| `api/prompts/sandbox/[id]/test.post.ts` | `promptLab.sandboxTest` |
| `api/ai-config/[id]/test-connection.post.ts` | `infra.testConnection`, `trigger: 'system'` |
| `api/ai-config/generate-criteria.post.ts`, `jobs/[id]/criteria/generate.post.ts` | `scoring.generateCriteria` |
| прочие из §2.3 | по таблице §5.2 |

Чтобы не забыть новые места: unit-тест `ai-usage-coverage.test.ts` ищет в `server/` все вызовы `generateStructuredOutput / streamTextOutput / streamStructuredOutput / generateText / streamText` и проверяет, что файл (или его вызывающий из списка исключений) содержит `withAiOperation` с ключом из реестра.

---

## 13. Поставка по этапам

| Этап | Состав | Результат |
|---|---|---|
| **Э1. Ядро учёта** | миграция (§4.1–4.3), `ai_config.price_currency / cached_input_price`, middleware, контекст, буферизованная запись, реестр до полноты (§5.2), обёртки во всех местах (§12), тест покрытия, backfill | все вызовы пишутся в журнал с ценой; данные копятся с первого дня |
| **Э2. Дашборд** | API §10 (кроме бюджетов), страница §8.1 блоки 1–4 и 6, карточка операции, Банк промптов §8.4, «ИИ-анализ» на новый источник, RBAC §9 | видно, на что и кто тратит |
| **Э3. Контроль** | бюджеты и уведомления §7, встройки §8.3, потери и аномалии (блок 5), экспорт CSV, пересчёт истории | контроль бюджета и юнит-экономика |
| **Э4. По факту нагрузки** | дневные агрегаты §4.6, курс ЦБ, очистка по `retention_days` | только если понадобится |

Э1 стоит сделать сразу и отдельно: даже без дашборда через неделю будут реальные данные для решений по картам поиска, моделям и бюджету.

---

## 14. Тестирование и приёмка

### 14.1. Unit
- `usage/cost.test.ts` — формула §6.2: с кэшем и без, валюта, null-цена, курс.
- `usage/normalizeUsage.test.ts` — маппинг `LanguageModelUsage` (новые и устаревшие поля), оценка §6.3.
- `usage/context.test.ts` — вложенность `withAiOperation`, наследование `traceId`, событие без контекста → `unattributed`.
- `usage/middleware.test.ts` — на mock-модели (`MockLanguageModelV3` из `ai/test`): generate, stream, stream с обрывом, ошибка, многошаговый `streamText` → N событий с одним трейсом.
- `usage/budget.test.ts` — пороги, повторное срабатывание не шлёт второе уведомление, прогноз.
- `ai-usage-coverage.test.ts` — §12.
- `prompt-registry-completeness.test.ts` — ключи операций ↔ реестр.

### 14.2. Приёмка
- [ ] Каждая операция из §5.2, выполненная вручную, появляется в журнале с правильными `operation`, `feature`, `user`, `job`, сущностью, моделью и ценой.
- [ ] «Дополнить по брифу» в карте поиска даёт трейс из 3 событий; сумма совпадает со строкой «стоимость действия».
- [ ] Чат-бот с инструментами даёт по событию на шаг, в одном трейсе.
- [ ] Фоновый автоскоринг пишется с `trigger = background` и пользователем-владельцем задачи.
- [ ] Ошибка ключа API даёт событие `status = error, error_code = auth` с нулевыми токенами; основной вызов возвращает ту же ошибку, что и раньше.
- [ ] Падение записи в журнал (например, выключена таблица) не ломает ни одну ИИ-функцию.
- [ ] Смена цены в `ai_config` не меняет стоимость прошлых событий; пересчёт меняет и пишется в аудит.
- [ ] Для конфигурации Cloud.ru в рублях стоимость в ₽ без конвертации; для OpenAI в $ — по курсу из настроек.
- [ ] Страница «ИИ-анализ» показывает ту же сумму по скринингу, что и «Расход ИИ» с фильтром `screening`.
- [ ] Рекрутёр без `view_costs` не видит сумм ни в API, ни в UI.
- [ ] Бюджет 80 % → одно уведомление; при `block_background` и 100 % автоскоринг откладывается, ручной скрининг работает с предупреждением.
- [ ] В Банке промптов у каждой операции есть блок «Использование»; после правки промпта появляется новая версия по хэшу.
- [ ] «Без атрибуции» = 0 после Э1.

---

## 15. Риски

| Риск | Мера |
|---|---|
| Провайдер не отдаёт usage в стриме | `includeUsage` / `stream_options.include_usage` там, где поддерживается; иначе оценка с пометкой «≈» |
| Неверно введённые цены (особенно «за 1 000» у российских провайдеров) | подсказка-калькулятор в настройках; пересчёт истории |
| Нагрузка записи при массовом скоринге | буфер и батч-вставка; индексы только нужные |
| Забыли обернуть новое место | `unattributed` на дашборде + тест покрытия |
| Чувствительность данных | тексты не храним, доступ по RBAC, срок хранения |
| Рост таблицы | индексы по `(org, created_at)`, очистка по сроку, агрегаты на Э4 |

---

## 16. Вне рамок

- Сверка с фактическими счетами провайдеров через их billing API (OpenAI Usage API, Yandex Billing) — после того как появятся реальные данные и станет понятно расхождение.
- Учёт стоимости MyMeet и других не-LLM сервисов (это не токены; можно добавить позже как `feature = external` с ручной ценой за вызов).
- Эмбеддинги и транскрибация — сейчас в системе не используются; middleware для `EmbeddingModel` добавляется тем же способом, когда появятся.
- Автоматическая смена модели при превышении бюджета.
