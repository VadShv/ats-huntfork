# ТЗ: Банк промптов + Песочница промптов

## Контекст

В проекте Huntfork (ATS на Nuxt 4) ИИ-модули распределены по `server/utils/ai/`, `server/api/`, `server/utils/comms/`, `server/utils/dedup/`, `server/utils/hh/sourcing/`. Промпты захардкожены в исходном коде — нет единой точки обзора. Новый раздел «Банк промптов» даст рекрутерам и админам:

1. **Банк промптов** (read-only) — реестр всех промптов, которые работают в проде, с текстом, источником и метаданными.
2. **Песочница промптов** — CRUD для создания и редактирования собственных промптов с возможностью тестирования against AI-конфигурации.

---

## 1. Инвентаризация промптов в проде

| # | Модуль | Файл | Категория | Описание |
|---|--------|------|-----------|----------|
| 1 | AI-скоринг: генерация критериев | `server/utils/ai/scoring.ts:190` | scoring | Создание 4–6 критериев оценки из описания вакансии |
| 2 | AI-скоринг: оценка кандидата | `server/utils/ai/scoring.ts:267` | scoring | Оценка кандидата по критериям с evidence/confidence |
| 3 | Риск-анализ резюме | `server/utils/ai/assessRisk.ts:73` | risk | Смысловые риск-находки по резюме (противоречия, подозрительности) |
| 4 | Генерация интервью-вопросов | `server/utils/ai/generateInterviewQuestions.ts:89` | interview | Вопросы для интервью под вакансию из JD + брифа |
| 5 | Структурирование резюме | `server/utils/ai/structureResume.ts:238` | parsing | Разбор плоского текста резюме в hh-совместимый JSON |
| 6 | Chatbot base system prompt | `server/api/chatbot/chat.post.ts:74` | chatbot | Базовый системный промпт ИИ-копилота (инструменты, стиль, безопасность) |
| 7 | HH sourcing query | `server/utils/hh/sourcing/aiQuery.ts:90` | sourcing | Генерация поискового запроса hh.ru из JD |
| 8 | Comms assistant (суфлёр) | `server/utils/comms/assistant.ts:151` | assistant | Динамический промпт ассистента переписки (персона, тон, база знаний) |
| 9 | Dedup AI-арбитр | `server/utils/dedup/ai-arbiter.ts:171` | dedup | Решение: один ли человек в двух карточках кандидатов |
| 10 | Sidekick summarize (7 режимов) | `server/api/extension/summarize.post.ts:92` | extension | summary, fit, fragment, questions, translate, card, custom |
| 11 | Candidate AI-summary | `server/api/candidates/[id]/ai-summary.post.ts:85` | summary | Краткая AI-сводка по резюме кандидата |
| 12 | AI config test connection | `server/api/ai-config/[id]/test-connection.post.ts:46` | infra | Технический промпт проверки подключения |

---

## 2. Архитектура

```
┌─────────────────────────────────────────────────────────┐
│                   Frontend (Nuxt pages)                   │
│  /dashboard/prompts          — Банк промптов (read-only)  │
│  /dashboard/prompts/sandbox  — Песочница (CRUD + test)    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                    API (Nuxt server)                      │
│  GET  /api/prompts/registry        — все прод-промпты     │
│  GET  /api/prompts/registry/:id    — один промпт          │
│  GET  /api/prompts/sandbox         — список песочницы     │
│  POST /api/prompts/sandbox         — создать              │
│  GET  /api/prompts/sandbox/:id     — получить             │
│  PATCH /api/prompts/sandbox/:id    — обновить             │
│  DELETE /api/prompts/sandbox/:id   — удалить              │
│  POST /api/prompts/sandbox/:id/test — тест против AI     │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              Prompt Registry (static module)              │
│  server/utils/ai/promptRegistry.ts                       │
│  — декларативный реестр всех прод-промптов               │
│  — извлекает текст промпта из исходников                 │
└─────────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              Database (Drizzle + Postgres)                │
│  prompt_sandbox — таблица пользовательских промптов       │
└─────────────────────────────────────────────────────────┘
```

### 2.1. Prompt Registry — `server/utils/ai/promptRegistry.ts`

Реестр — это статический массив объектов, декларативно описывающих каждый прод-промпт. Текст промпта извлекается из исходного файла через функцию-экстрактор (не парсинг кода — прямой импорт значения, где возможно, или хардкод текста в реестре с `sourceFile`/`sourceLine` для навигации).

```typescript
export interface ProductionPrompt {
  id: string                    // стабильный идентификатор: 'scoring.generateCriteria'
  module: string                // имя модуля: 'AI Scoring Engine'
  name: string                  // человекочитаемое: 'Генерация критериев оценки'
  category: PromptCategory      // grouping
  description: string           // что делает
  systemPrompt: string          // текст system-промпта
  userPromptTemplate?: string   // шаблон user-промпта (с плейсхолдерами {{var}})
  variables?: PromptVariable[]  // переменные шаблона
  schemaName?: string           // имя Zod-схемы structured output
  temperature?: number          // температура
  sourceFile: string            // путь к файлу-источнику
  sourceLine: number            // строка в файле
  isDynamic?: boolean           // промпт собирается динамически (assistant.ts)
  subPrompts?: ProductionPrompt[] // вложенные режимы (summarize.post.ts)
}

export type PromptCategory =
  | 'scoring' | 'risk' | 'interview' | 'parsing'
  | 'chatbot' | 'sourcing' | 'assistant' | 'dedup'
  | 'extension' | 'summary' | 'infra'

export interface PromptVariable {
  name: string                  // 'jobTitle'
  description: string           // 'Название вакансии'
  required: boolean
  example?: string              // пример значения для теста
}
```

Реестр содержит **12 записей** (перечисленных в таблице выше). Для `extension/summarize.post.ts` — одна запись с 7 `subPrompts` (по режиму). Для `comms/assistant.ts` — `isDynamic: true` с описанием переменных (personaName, personaRole, tone, goals, rules, knowledgeBase).

### 2.2. Database Schema — `prompt_sandbox`

```sql
CREATE TABLE prompt_sandbox (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL DEFAULT 'custom',
  system_prompt   TEXT NOT NULL,
  user_prompt_template TEXT,
  variables       JSONB,          -- [{ name, description, example }]
  ai_config_id    TEXT REFERENCES ai_config(id) ON DELETE SET NULL,
  temperature     NUMERIC(3,2) DEFAULT 0.3,
  model_override  TEXT,           -- опц. override модели
  is_shared       BOOLEAN NOT NULL DEFAULT FALSE,
  tags            TEXT[],         -- произвольные теги
  last_test_result JSONB,         -- кэш последнего тест-прогона
  last_tested_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX prompt_sandbox_org_idx ON prompt_sandbox(organization_id);
CREATE INDEX prompt_sandbox_org_user_idx ON prompt_sandbox(organization_id, user_id);
CREATE INDEX prompt_sandbox_shared_idx ON prompt_sandbox(organization_id) WHERE is_shared = true;
```

Drizzle-схема в `server/database/schema/app.ts`:

```typescript
export const promptSandbox = pgTable('prompt_sandbox', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull().default('custom'),
  systemPrompt: text('system_prompt').notNull(),
  userPromptTemplate: text('user_prompt_template'),
  variables: jsonb('variables').$type<PromptVariable[]>(),
  aiConfigId: text('ai_config_id').references(() => aiConfig.id, { onDelete: 'set null' }),
  temperature: numeric('temperature', { precision: 3, scale: 2 }).default('0.30'),
  modelOverride: text('model_override'),
  isShared: boolean('is_shared').notNull().default(false),
  tags: text('tags').array(),
  lastTestResult: jsonb('last_test_result'),
  lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ([
  index('prompt_sandbox_org_idx').on(t.organizationId),
  index('prompt_sandbox_org_user_idx').on(t.organizationId, t.userId),
]))
```

### 2.3. API Endpoints

#### Банк промптов (read-only)

**`GET /api/prompts/registry`**
- Auth: `requirePermission({ prompts: ['read'] })` (или fallback на любой авторизованный пользователь)
- Response: `ProductionPrompt[]` — весь реестр, сгруппированный по category
- Query: `?category=scoring` — фильтр по категории

**`GET /api/prompts/registry/:id`**
- Response: `ProductionPrompt` — один промпт с полным текстом

#### Песочница (CRUD)

**`GET /api/prompts/sandbox`**
- Response: `SandboxPrompt[]` — список промптов пользователя + shared-промпты org
- Query: `?category=`, `?search=`, `?shared=true`

**`POST /api/prompts/sandbox`**
- Body: `{ name, description?, category, systemPrompt, userPromptTemplate?, variables?, aiConfigId?, temperature?, isShared?, tags? }`
- Валидация: `systemPrompt` 1..16000 символов, `name` 1..200, лимит 100 промптов на пользователя

**`GET /api/prompts/sandbox/:id`**
- Проверка: принадлежит пользователю ИЛИ `isShared` в той же org

**`PATCH /api/prompts/sandbox/:id`**
- Только владелец может редактировать
- Body: partial update

**`DELETE /api/prompts/sandbox/:id`**
- Только владелец может удалить

**`POST /api/prompts/sandbox/:id/test`**
- Body: `{ variables?: Record<string, string>, aiConfigId?: string }` — значения переменных для подстановки в шаблон
- Выполняет `streamTextOutput` с system+user промптом, подставив переменные
- Response: SSE-стрим с результатом (как в extension/summarize)
- Сохраняет `lastTestResult` и `lastTestedAt`

---

## 3. Frontend

### 3.1. Страницы

#### `/dashboard/prompts/index.vue` — Банк промптов

```
┌─────────────────────────────────────────────────────┐
│  Банк промптов                           [Песочница] │
├─────────────────────────────────────────────────────┤
│  [All] [Scoring] [Risk] [Interview] [Parsing] ...    │  ← фильтр по категориям
├─────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────┐  │
│  │ 📊 AI Scoring Engine                          │  │
│  │    Генерация критериев оценки                 │  │
│  │    Создание 4–6 критериев из описания вакансии│  │
│  │    📄 scoring.ts:190  ·  temp: 0.1  ·  schema │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │ 📊 AI Scoring Engine                          │  │
│  │    Оценка кандидата по критериям              │  │
│  │    ...                                        │  │
│  └───────────────────────────────────────────────┘  │
│  ...                                                 │
└─────────────────────────────────────────────────────┘
```

Клик по карточке → модальное окно или раскрывающаяся панель с полным текстом промпта (system + user template), переменными, схемой, ссылкой на исходный файл.

**Read-only**: кнопок «редактировать» нет. Только «копировать промпт» (в песочницу или в буфер).

#### `/dashboard/prompts/sandbox/index.vue` — Песочница

```
┌─────────────────────────────────────────────────────┐
│  Песочница промптов                    [+ Новый промпт]│
├─────────────────────────────────────────────────────┤
│  [Мои промпты] [Shared]  🔍 поиск                    │
├─────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────┐  │
│  │ 🧪 Мой промпт скрининга                       │  │
│  │    Кастомный скоринг по безопасности           │  │
│  │    🏷️ scoring, security    ✅ тест 2 мин назад │  │
│  │    [✏️] [📋] [▶ Тест] [🗑️]                    │  │
│  └───────────────────────────────────────────────┘  │
│  ...                                                 │
└─────────────────────────────────────────────────────┘
```

#### `/dashboard/prompts/sandbox/new.vue` и `/:id.vue` — Редактор

```
┌─────────────────────────────────────────────────────┐
│  ← Назад              Новый промпт                    │
├─────────────────────────────────────────────────────┤
│  Название: [________________________]                │
│  Описание: [________________________]                │
│  Категория: [custom ▾]   Теги: [____] [+]           │
│  AI-конфиг: [org default ▾]  Температура: [0.3]     │
│  ☐ Shared с организацией                             │
├─────────────────────────────────────────────────────┤
│  System prompt:                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │ Ты — эксперт по безопасности...              │    │
│  │                                               │    │
│  └─────────────────────────────────────────────┘    │
│  User prompt template (опц.):                       │
│  ┌─────────────────────────────────────────────┐    │
│  │ Оцени кандидата: {{candidateName}}           │    │
│  │ Вакансия: {{jobTitle}}                        │    │
│  └─────────────────────────────────────────────┘    │
│  Переменные:                                         │
│    {{candidateName}} — [Имя кандидата] [пример: Иван]│
│    {{jobTitle}} — [Должность] [пример: DevOps]      │
│    [+ добавить переменную]                           │
├─────────────────────────────────────────────────────┤
│  [▶ Тест]                    [Отмена] [Сохранить]    │
└─────────────────────────────────────────────────────┘
```

Кнопка «Тест» открывает панель с подстановкой переменных и стримингом ответа модели (как Sidekick summarize).

### 3.2. Компоненты

| Компонент | Назначение |
|-----------|------------|
| `PromptCard.vue` | Карточка промпта в банке (read-only) |
| `PromptDetailModal.vue` | Модалка с полным текстом промпта |
| `SandboxPromptCard.vue` | Карточка промпта в песочнице (с действиями) |
| `PromptEditor.vue` | Форма редактирования промпта |
| `PromptTestPanel.vue` | Панель тестирования с подстановкой переменных и стримингом |
| `PromptCategoryFilter.vue` | Фильтр по категориям |

### 3.3. Навигация

В `app/components/AppTopBar.vue` добавить пункт после «Ассистент»:

```typescript
{ label: t('dashboard.nav.prompts'), to: '/dashboard/prompts', icon: BookOpen, exact: false }
```

i18n (`i18n/locales/ru.json`):

```json
{
  "dashboard": {
    "nav": {
      "prompts": "Промпты"
    },
    "prompts": {
      "title": "Банк промптов",
      "subtitle": "Реестр ИИ-промптов, работающих в проде",
      "sandbox": "Песочница",
      "sandboxTitle": "Песочница промптов",
      "sandboxSubtitle": "Создавайте и тестируйте собственные промпты",
      "categories": {
        "scoring": "Скоринг",
        "risk": "Риск-анализ",
        "interview": "Интервью",
        "parsing": "Парсинг",
        "chatbot": "Чат-бот",
        "sourcing": "Сорсинг",
        "assistant": "Ассистент",
        "dedup": "Дедупликация",
        "extension": "Sidekick",
        "summary": "Саммари",
        "infra": "Инфра",
        "custom": "Кастомные"
      },
      "newPrompt": "Новый промпт",
      "test": "Тест",
      "copyToSandbox": "Копировать в песочницу",
      "systemPrompt": "System prompt",
      "userPromptTemplate": "User prompt (шаблон)",
      "variables": "Переменные",
      "save": "Сохранить",
      "cancel": "Отмена",
      "shared": "Shared",
      "myPrompts": "Мои промпты"
    }
  }
}
```

---

## 4. План реализации

### Этап 1: Prompt Registry (server-only, no DB)
1. Создать `server/utils/ai/promptRegistry.ts` с реестром из 12 записей
2. Создать `server/api/prompts/registry/index.get.ts` и `registry/[id].get.ts`
3. Добавить permission `prompts: ['read']` в `shared/permissions.ts`

### Этап 2: Database + Sandbox API
4. Добавить таблицу `promptSandbox` в `server/database/schema/app.ts`
5. Сгенерировать миграцию: `npm run db:generate`
6. Создать API: `server/api/prompts/sandbox/` (index.get, index.post, [id].get, [id].patch, [id].delete, [id]/test.post.ts)

### Этап 3: Frontend
7. Создать страницы: `app/pages/dashboard/prompts/index.vue` и `sandbox/`
8. Создать компоненты: `PromptCard`, `PromptDetailModal`, `SandboxPromptCard`, `PromptEditor`, `PromptTestPanel`
9. Добавить навигацию в `AppTopBar.vue`
10. Добавить i18n в `ru.json` и `en.json`

### Этап 4: Тестирование
11. Юнит-тесты для registry и sandbox API
12. E2E-тест: создание → редактирование → тест → удаление

---

## 5. Безопасность

- Банк промптов: только `requireAuth` — тексты не содержат секретов (ключи в `aiConfig`, не в промптах)
- Песочница: `requirePermission({ prompts: ['write'] })` для создания/редактирования
- Test endpoint: использует `loadAiConfig` с проверкой org-принадлежности — ключи не утекают
- Лимит: 100 промптов на пользователя, `systemPrompt` ≤ 16000 символов
- Shared-промпты: видны всем в org, редактировать/удалять может только владелец
- Rate limit на test: 20 запросов/мин (как summarize)
