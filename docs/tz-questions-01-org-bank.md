# ТЗ · Спринт 0-1 · Org-level Банк вопросов

> **Часть:** мастер-план `tz-questions-00-master-plan.md`
> **Зависит от:** ничего (базовый спринт)
> **Даёт для:** Спринт 2 (CARE-структура вопросов), Спринт 3 (пресеты), Спринт 4 (вопросы для персонализации)
> **Статус:** черновик на согласование

Документ включает **Спринт 0** (подготовка/развилки) и **Спринт 1** (сам Банк).

---

## СПРИНТ 0 — Подготовка (до основного кода)

Маленький, но обязательный: закрывает архитектурные развилки, чтобы дальше не
переписывать.

### 0.1. ADR: две сущности вопросов

Создать `docs/adr-questions-two-entities.md` (по образцу
`docs/adr-job-description-sections.md`), фиксирующий:

- `jobQuestion` (`app.ts:490`) = **поля публичной формы отклика** (candidate-facing,
  9 типов, ответы в `questionResponse`). Остаётся.
- `jobInterviewQuestion` (`app.ts:569`) = **интервью-вопросы вакансии**. Каноническая
  ветка для интервью; в Спринте 3 связывается с org-банком.
- `bank_question` (новая, Спринт 1) = **org-вопрос банка** — источник истины для
  формулировок и методологии.

### 0.2. Переименование формы отклика (устранение путаницы)

- Роут `server/api/jobs/[id]/questions/*` → **оставить как есть на бэке** (ломать
  публичный `apply.post.ts` и e2e рискованно), НО в UI/навигации и i18n
  использовать однозначный термин **«Вопросы формы отклика»** / `applicationForm`.
- Проверить: вкладка `dashboard.jobs.tabs.applicationForm` уже указывает на
  `application-form` (`AppTopBar.vue:119`) — путаницы во вкладках нет; вкладка
  `questions` (`:118`) ведёт на банк интервью-вопросов. **Задача 0.2** — свериться,
  что нигде в UI слово «Вопросы» не смешивает две сущности; при необходимости
  уточнить i18n-подписи.
- Компонент `JobQuestions.vue`/`QuestionForm.vue` (форма отклика) — при желании
  переименовать в `ApplicationFormQuestions.vue` (необязательно в S0).

### 0.3. Ресурс прав `questionBank` (и подготовка `risk`)

Сейчас риск-эндпоинты переиспользуют `scoring:['create']`, а `question-set`
использует `application`/`candidate`. Для org-банка нужен отдельный ресурс.

В `shared/permissions.ts` (`atsStatements`, `:30-50`) добавить:

```ts
questionBank: ['view', 'create_draft', 'edit_draft', 'publish', 'archive', 'manage_topics'],
```

Раскладка по ролям (`ROLE_STATEMENTS`, `:204-210` + raw-карты `:75-165`):

| Роль | questionBank |
|---|---|
| owner | все |
| admin | все |
| member (recruiter) | `view`, `create_draft`, `edit_draft` (публикация/архив — нет) |
| hiringManager | `view` (read-only) |

> Полная сводка прав всех спринтов — в `tz-questions-90-cross-cutting.md`.
> `risk`-ресурс здесь не обязателен (риски уже работают на `scoring`); выносим его
> отдельно в кросс-раздел как техдолг, если понадобится гранулярность.

### 0.4. Вынести общий util нормализации

Дедуп-логика продублирована: `buildCandidateQuestions.ts:40`,
`interview-questions/generate.post.ts:17`, инлайн в `question-set/generate.post.ts:108`.
Создать `server/utils/text/normalizeQuestion.ts` с единой `normalizeQuestion()` и
перевести три места на неё. Покрыть unit-тестом.

### 0.5. Компонент `UiTextarea` (нужен всем спринтам S1–S5)

Design-system не имеет `UiTextarea` (`plan-ui-unification.md:137` — запланирован,
не реализован). Все спринты модуля активно используют многострочный ввод
(промпты CARE, `freeform`, `answerNote`, шаблоны отчётов, `definition`/`goal` тем).
Чтобы S0 давал **чистую базу**, `UiTextarea` заводится здесь, а не в S1:
- API по образцу `UiInput` (`app/components/ui/UiInput.vue`): `modelValue`, `size`,
  `state`, `label`, `hint`, `errorMessage`, `rows`/`autosize`, `disabled`,
  `readonly`, `required`, `block`; emits `update:modelValue`, `blur`, `focus`.
- Токены/стили — из `app/design/tokens.ts` (радиус `lg`, focus-ring), как у `UiInput`.
- Добавить в showcase `/dashboard/design-system`.
- Все textarea новых экранов используют `UiTextarea` (не сырой `<textarea>`).

### Критерии готовности Спринта 0
ADR принят; термины в UI не смешивают две сущности; право `questionBank` заведено и
разложено по ролям; `normalizeQuestion` вынесен и покрыт тестом; `UiTextarea`
реализован и в showcase; существующий контур не сломан (прогон `npm test` + e2e apply).

---

## СПРИНТ 1 — Org-level Банк вопросов

### 1.1. Цель

Корпоративный справочник: **темы оценки** (со шкалами и BARS-якорями) + **банк
открытых вопросов** с CARE-готовой структурой, **песочница** (черновики) и
**прод-вопросы** (опубликованные). Основа для пресетов (Спринт 3), персонализации
(Спринт 4) и генерации отчётов (Спринт 5).

Модерация — **лёгкая**: черновик в песочнице → публикация в прод. Без SLA,
эскалаций, автораспределения (это later, см. мастер-план §8).

**BARS/шкалы (уточнение scope):** BARS-якоря нужны НЕ для ручного выставления баллов
на интервью (проведение интервью — вне scope, это MyMeet + рекрутёр), а как
**фундамент промпта генерации отчёта** (Спринт 5): ИИ-ассистент интерпретирует
ответы кандидата по поведенческим якорям. Якоря живут на **уровне темы**
(переиспользуются вопросами), вопрос может переопределить локально.

### 1.2. Термины

| Термин | Определение |
|---|---|
| Тема оценки | Смысловая ось: компетенция, ценность, мотивация, фактчекинг, зона риска |
| Вопрос банка | Открытый org-вопрос с целью, что-проверяем и (опц.) CARE-структурой |
| Probe | Уточняющий вопрос внутри элемента CARE (наполняется в Спринте 2) |
| Песочница | Черновики вопросов до публикации |
| Публикация | Перевод черновика в прод-статус (доступен для пресетов/вакансий) |

### 1.3. Модель данных

Схема в `server/database/schema/app.ts` (новая секция). Все таблицы org-scoped.

#### `assessment_topic` — тема оценки

```
assessment_topic
  id              text pk
  organizationId  text notNull FK organization cascade
  code            text            -- человекочитаемый, напр. "TOPIC-0042" (уникален в орг)
  name            text notNull    -- до 120 симв.
  shortName       text            -- для бейджей, до 24
  type            enum notNull    -- assessmentTopicTypeEnum (см. ниже)
  definition      text            -- что понимаем под темой
  goal            text            -- что именно выясняем
  positiveIndicators jsonb string[] default '[]'   -- поведенческие индикаторы
  negativeIndicators jsonb string[] default '[]'
  parentTopicId   text FK assessment_topic set-null  -- иерархия, глубина ≤ 3
  targetRoles     jsonb string[] default '[]'
  tags            jsonb string[] default '[]'
  status          enum notNull default 'active'   -- topicStatusEnum: draft|active|archived
  displayOrder    int default 0
  createdById     text FK user set-null
  createdAt, updatedAt
  indexes: (organizationId), (organizationId, code) unique, (parentTopicId)
```

`assessmentTopicTypeEnum`: `value | soft_skill | management | professional |
motivation | expectations | factcheck | achievement_scale | career_logic | risk_zone
| culture | custom`.

`topicStatusEnum`: `draft | active | archived`.

#### `assessment_scale` — шкала оценки (на уровне темы)

Переиспользуемая шкала. Одна тема имеет 0..N шкал; одна помечена `isDefault`.

```
assessment_scale
  id              text pk
  organizationId  text notNull FK organization cascade
  topicId         text notNull FK assessment_topic cascade
  name            text notNull            -- напр. "Ориентация на результат 1–5"
  type            enum notNull            -- scaleTypeEnum (см. ниже)
  minValue        int                     -- для numeric-шкал (напр. 1)
  maxValue        int                     -- (напр. 5)
  allowInsufficientData boolean default true  -- значение «недостаточно данных» вне среднего
  isDefault       boolean default false   -- шкала по умолчанию для темы
  displayOrder    int default 0
  createdAt, updatedAt
  indexes: (organizationId), (topicId), partial-unique (topicId) where isDefault
```

`scaleTypeEnum`: `numeric_5 | numeric_4 | numeric_3 | match_3 | verify_3 | level_5
| custom`.
- `numeric_5/4/3` — баллы 1..N (базовые для компетенций).
- `match_3` — соответствует / частично / не соответствует.
- `verify_3` — подтверждено / не подтверждено / недостаточно данных (фактчек).
- `level_5` — 0..4 по уровням темы.
- `custom` — произвольные значения.

#### `bars_anchor` — поведенческий якорь (BARS)

Описание наблюдаемого поведения для конкретного балла шкалы. Фундамент для
генерации отчёта (Спринт 5).

```
bars_anchor
  id              text pk
  organizationId  text notNull FK organization cascade
  scaleId         text notNull FK assessment_scale cascade
  value           text notNull            -- балл/значение шкалы ("1".."5" или "verified")
  anchorText      text notNull            -- поведенческий якорь (что наблюдаем в ответе)
  positiveExamples jsonb string[] default '[]'   -- примеры формулировок кандидата
  negativeExamples jsonb string[] default '[]'   -- антипримеры
  displayOrder    int default 0
  createdAt, updatedAt
  indexes: (organizationId), (scaleId), (scaleId, value) unique
```

**Правила качества якоря** (валидация-предупреждения, 1.4): якорь описывает
действие кандидата, а не оценку интервьюера; крайние значения шкалы обязательно
описаны; предупреждение при оценочной лексике («отличный», «слабый») вместо
поведенческой.

> **Опциональная локальная привязка на вопросе:** `bank_question.scaleIdOverride`
> (nullable FK) — вопрос по умолчанию наследует шкалу/якоря темы; переопределяет
> только при необходимости. Поле заводим в `bank_question` (см. ниже).

> **Уровни проявления темы (levels)** из ТЗ-референса — сворачиваем в шкалу
> `level_5` + якоря; отдельную таблицу `levels` не заводим (упрощение без потери
> смысла). Обязательные `positive/negativeIndicators` темы остаются как
> машиночитаемый сигнал для AI (генерация/персонализация/отчёт).

#### `bank_question` — вопрос банка

```
bank_question
  id              text pk
  organizationId  text notNull FK organization cascade
  code            text            -- "Q-001245" (уникален в орг); авто-генерация, см. §1.3.1
  primaryTopicId  text notNull FK assessment_topic restrict
  type            enum notNull    -- bankQuestionTypeEnum (см. ниже)
  text            text notNull    -- формулировка, до 600 симв.
  goal            text            -- цель вопроса
  assesses        text            -- что именно проверяем
  recommendedStage enum           -- interviewStageEnum: screening|recruiter|hiring_manager|final|expert
  expectedSignal  text            -- что считаем сильным ответом (аналог goodAnswer)
  strongIndicators jsonb string[] default '[]'   -- зелёные флаги
  weakIndicators   jsonb string[] default '[]'   -- красные флаги
  durationMin     int             -- рекомендуемое время, мин
  complexity      enum            -- low|medium|high
  secondaryTopicIds jsonb string[] default '[]'
  scaleIdOverride text FK assessment_scale set-null  -- опц. локальная шкала (иначе наследует тему)
  targetRoles     jsonb string[] default '[]'
  tags            jsonb string[] default '[]'
  status          enum notNull default 'draft'   -- bankQuestionStatusEnum: draft|published|archived
  version         int notNull default 1
  source          enum notNull default 'manual'  -- manual|ai_generated|imported|from_vacancy
  careReady       boolean default false          -- заполнена ли CARE-структура (Спринт 2)
  publishedAt     timestamp
  publishedById   text FK user set-null
  ownerId         text FK user set-null
  createdById     text FK user set-null
  createdAt, updatedAt
  indexes: (organizationId), (organizationId, code) unique, (primaryTopicId), (status)
```

`bankQuestionTypeEnum`: `behavioral | situational | motivational | factual |
verification | reflective | professional | control | ai_personal`.

`bankQuestionStatusEnum`: `draft | published | archived`.

#### 1.3.1. Генерация человекочитаемого `code`

`code` (у `bank_question` — `Q-NNNNNN`, у `assessment_topic` — `TOPIC-NNNN`) —
человекочитаемый идентификатор, уникальный в рамках организации. Генерация:
- **Формат:** префикс (`Q-` / `TOPIC-`) + zero-padded счётчик per-org
  (`Q-000042`), нулей достаточно на рост (6 цифр для вопросов, 4 для тем).
- **Источник счётчика:** отдельная строка-счётчик на организацию (напр. таблица
  `org_sequence(organization_id, entity, next_value)` или `SELECT max()+1` под
  advisory-lock во избежание гонок — по образцу лимита в
  `prompts/sandbox/index.post.ts:41-59`). Рекомендуется advisory-lock + insert в
  транзакции создания черновика.
- **Момент:** присваивается при создании черновика (не при публикации), больше не
  меняется (стабильная ссылка для трассировки).
- **Не для сортировки:** `code` — только для людей/поиска; порядок — `displayOrder`.

> Гонки: при параллельном создании двух вопросов без блокировки возможен дубль
> `code` → уникальный индекс `(organizationId, code)` отклонит второй; поэтому
> генерация под advisory-lock либо retry на конфликте уникальности.

`interviewStageEnum`: `screening | recruiter | hiring_manager | final | expert |
full_cycle`. Значение `full_cycle` добавлено для переиспользования этого enum как
типа пресета опросной карты в Спринте 3 (общий enum вместо дубля
`preset_interview_type` — см. `tz-questions-90-cross-cutting.md §7c`).

#### `bank_question_probe` — probe-уточнения (наполняется в Спринте 2)

Заводим таблицу уже в Спринте 1 (пустую по данным), чтобы Спринт 2 добавлял только
логику, не схему.

```
bank_question_probe
  id              text pk
  organizationId  text notNull FK organization cascade
  bankQuestionId  text notNull FK bank_question cascade
  careElement     enum notNull    -- careElementEnum: context|action|result|evaluate
  text            text notNull    -- уточняющий вопрос
  sufficientSignal text           -- признак достаточного ответа
  displayOrder    int default 0
  createdAt, updatedAt
  indexes: (organizationId), (bankQuestionId)
```

`careElementEnum`: `context | action | result | evaluate`.

### 1.4. Валидация формулировок (блокирующие + предупреждения)

По образцу `server/utils/schemas/interviewQuestion.ts`. Файл
`server/utils/schemas/bankQuestion.ts` (Zod) + чистая функция качества
`server/utils/questions/qualityChecks.ts` (детерминированная, без LLM).

**Блокирующие** (не дают опубликовать):
1. `text` непустой, ≤ 600 симв.
2. Заполнены `primaryTopicId` и `goal`.
3. Тема в статусе `active` (нельзя привязать к `draft`/`archived`).

**Предупреждения** (не блокируют, показываются в UI):
- Вопрос выглядит закрытым (начинается с «Есть ли…», «Вы…?» и т.п. — эвристика).
- Двойной вопрос (союз «и» между двумя предметами — эвристика).
- Длина > 300 симв.
- Возможный дубль (нормализованный текст совпадает с существующим — через
  `normalizeQuestion` из S0).
- Нет `expectedSignal`/индикаторов.

> Проверки на чувствительные признаки и наводящие подсказки из ТЗ-референса —
> добавим эвристикой в предупреждения; строгую AI-проверку — опционально в Спринте 2
> (через CARE-промпт структурирования).

### 1.5. AI-генерация вопросов темы (переиспользование паттерна)

`server/utils/ai/generateBankQuestions.ts` — по образцу
`generateInterviewQuestions.ts:71`:
- Вход: `{ orgId, topic (name/definition/goal/indicators), count, extraInstruction? }`.
- `loadAiConfig(orgId, { purpose: 'analysis' })`.
- Zod-схема с `.catch().default()`-гардами + `wrapBareArray`.
- Выход: черновики `bank_question` (`status='draft'`, `source='ai_generated'`),
  привязанные к теме. Дедуп по `normalizeQuestion`.
- Rate-limit 10/мин (как в `interview-questions/generate.post.ts:10`).

> CARE-структурирование сгенерированных вопросов — Спринт 2.

### 1.6. API

Все под `server/api/question-bank/`. Каждый хендлер: `requirePermission` +
скоуп по `activeOrganizationId`.

**Темы:**
- `GET    /api/question-bank/topics` — список (фильтры: type, status, parentTopicId, search); `questionBank:['view']`.
- `POST   /api/question-bank/topics` — создать; `questionBank:['manage_topics']`.
- `GET    /api/question-bank/topics/[topicId]` — детально (+ шкалы + якоря).
- `PATCH  /api/question-bank/topics/[topicId]` — правка; `manage_topics`.
- `POST   /api/question-bank/topics/[topicId]/archive` — архивация (с проверкой связей); `manage_topics`.

**Шкалы и BARS-якоря** (под темой):
- `GET    /api/question-bank/topics/[topicId]/scales` — список шкал темы (+ якоря); `view`.
- `POST   /api/question-bank/topics/[topicId]/scales` — создать шкалу; `manage_topics`.
- `PATCH  /api/question-bank/scales/[scaleId]` — правка шкалы (в т.ч. `isDefault`); `manage_topics`.
- `DELETE /api/question-bank/scales/[scaleId]` — удалить (запрет, если используется в опубликованных); `manage_topics`.
- `PUT    /api/question-bank/scales/[scaleId]/anchors` — заменить набор якорей (bulk); `manage_topics`.

**Вопросы:**
- `GET    /api/question-bank/questions` — список/поиск (фильтры: topicId, type, status, stage, tags, search, careReady); `view`.
- `POST   /api/question-bank/questions` — создать черновик (`status='draft'`); `create_draft`.
- `GET    /api/question-bank/questions/[id]` — детально (+ probes).
- `PATCH  /api/question-bank/questions/[id]` — правка черновика; `edit_draft` (или `create_draft` для своих).
- `POST   /api/question-bank/questions/[id]/publish` — публикация (валидация 1.4); `publish`.
- `POST   /api/question-bank/questions/[id]/archive` — архивация (soft); `archive`.
- `POST   /api/question-bank/questions/generate` — AI-генерация по теме; `create_draft` + rate-limit.

**Probes** (схема готова, полноценно в Спринте 2):
- `PUT    /api/question-bank/questions/[id]/probes` — заменить набор probe (bulk); `edit_draft`.

### 1.7. Права на редактирование черновиков

- `member` (recruiter): создаёт черновики, редактирует **свои** (`createdById`).
- `admin`/`owner`: редактируют любые, публикуют, архивируют.
- `hiringManager`: только `view`.
- Публиковать может только `publish` (owner/admin).
- Опубликованный вопрос **не редактируется напрямую** — правка создаёт новую версию
  (инкремент `version`, статус нового черновика). Иммутабельность прод-версий.

### 1.8. Навигация и UI

> **Design-system (обязательно):** все новые экраны строятся на `Ui*`
> (`app/components/ui/`): `UiButton`, `UiInput`, `UiSelect`, `UiBadge`, `UiCard`,
> `UiModal`, `UiDrawer`, `UiSegmented`. Табы — `DetailTabs.vue`. Тосты — `useToast()`.
> Подтверждения — `useConfirm()`. Токены — `app/design/tokens.ts` (цвета
> `brand/surface/success/warning/danger/info`, радиусы, тени). Формы — паттерн
> `zod safeParse` → `errors[path]` (как `jobs/[id]/settings.vue:291-329`).
> Reorder — нативный HTML5 DnD (как `PropertySchemaEditor.vue:234-238`), библиотеки
> DnD в проекте нет. `UiTextarea` пока НЕТ — использовать размеченный `<textarea>`
> с токен-классами (или завести `UiTextarea` в рамках спринта — согласовать с
> `plan-ui-unification.md:137`). Новые экраны добавить в showcase
> `/dashboard/design-system` при необходимости.

#### Точка входа — отдельный ярлык «Банк вопросов»
Раздел настроек org: **Настройки → Банк вопросов** (отдельный ярлык, НЕ группа
«Оценка кандидатов» — чтобы не путать со скринингом).
- Добавить в `SettingsSidebar.vue` (`settingsNav`, `:9`) и
  `SettingsMobileNav.vue` (`:9`): `{ label: t('settings.questionBank.title'),
  description: t('settings.questionBank.desc'),
  to: '/dashboard/settings/question-bank', icon: Library }` (иконка
  `lucide-vue-next`).
- Видимость пункта — только при `questionBank:['view']` (иначе не отображать, не
  «отображать и ругаться»).
- Внутри раздела — под-навигация по подразделам через `DetailTabs.vue` или
  вложенный sidebar: **Обзор · Вопросы · Темы оценки · Методология CARE (Спринт 2)
  · Шаблоны отчётов (Спринт 5) · Песочница**.

#### Страницы (`app/pages/dashboard/settings/question-bank/`)
- `index.vue` — **Обзор**: счётчики (тем, опубликованных вопросов, черновиков,
  тем без якорей), карточки `UiCard`, быстрые действия (`UiButton`), последние
  изменения.
- `questions.vue` — **Банк вопросов**: список/таблица, фильтры-чипы (`UiBadge`
  removable), поиск (`UiInput` iconLeft=Search), группировка по темам,
  создание/правка в `UiDrawer`, публикация/архив (`UiButton` + `useConfirm`).
  Переиспользовать паттерн `jobs/[id]/questions.vue` (инлайн-правка, группировка).
- `topics.vue` — **Темы оценки**: дерево/список (`UiCard`), CRUD в `UiDrawer`,
  индикаторы покрытия (сколько вопросов, есть ли якоря — `UiBadge` tone), вложенный
  редактор шкал/якорей.
- `sandbox.vue` — **Песочница**: «Мои черновики» / «Все черновики» (для admin),
  фильтры, `DetailTabs` для под-вкладок, счётчик блокирующих ошибок на карточке.

#### Компоненты (`app/components/questionBank/`)
- `TopicList.vue`, `TopicForm.vue` (в `UiDrawer`)
- `ScaleEditor.vue` — шкалы темы (тип `UiSelect`, min/max `UiInput`, `isDefault`)
- `BarsAnchorEditor.vue` — редактор якорей по баллам (строки per value, поле
  `anchorText`, примеры/антипримеры, предупреждение об оценочной лексике)
- `BankQuestionList.vue`, `BankQuestionForm.vue` (с блоком `QualityWarnings`),
  `BankQuestionCard.vue` (бейджи темы/типа/статуса/`careReady` через `UiBadge`)
- `QualityWarnings.vue` — предупреждения валидации (1.4), tone=warning

#### Composables (`app/composables/`)
- `useAssessmentTopics.ts` — CRUD тем + шкалы/якоря.
- `useBankQuestions.ts` — список/поиск/CRUD/publish/archive/generate.

#### UX-детали
- Пустые состояния — активные заготовки (не пустой прямоугольник): «Создайте первую
  тему», «Добавьте вопрос из…».
- Автосохранение черновиков с текстовым индикатором времени (не спиннер).
- Оптимистичные мутации с откатом и `toast.error` при ошибке.
- Клавиатура: `Cmd/Ctrl+K` — поиск вопроса; `Enter` — раскрытие; стрелки —
  навигация по списку (задел, не обязательно в MVP).

### 1.9. i18n
Все подписи — в `i18n/locales/ru.json` (единственная локаль). Новый блок
`settings.questionBank.*` и `questionBank.*`.

### 1.10. Миграция
`server/database/migrations/0101_question_bank.sql` (следующий индекс после `0100`)
+ запись в `meta/_journal.json` (idx 101, version "7", tag `0101_question_bank`,
`when` = epoch ms, `breakpoints: true`). Таблицы этого спринта: `assessment_topic`,
`assessment_scale`, `bars_anchor`, `bank_question`, `bank_question_probe` + все enum
(`assessmentTopicTypeEnum`, `topicStatusEnum`, `scaleTypeEnum`, `bankQuestionTypeEnum`,
`bankQuestionStatusEnum`, `interviewStageEnum`, `careElementEnum`). Enums с
идемпотентными гардами (`DO $$ BEGIN CREATE TYPE … EXCEPTION WHEN duplicate_object`),
таблицы `CREATE TABLE IF NOT EXISTS`, `--> statement-breakpoint` между операторами.
Реэкспорт новых таблиц/enums в `server/database/schema/index.ts`.

> Генерация миграции: править схему в `app.ts`, затем `drizzle-kit generate` (по
> конвенции проекта), проверить сгенерированный SQL и запись журнала.

### 1.11. Тесты
- Unit: `qualityChecks` (закрытый/двойной/длина/дубль/оценочная-лексика-якоря),
  `normalizeQuestion`.
- Unit: Zod-схемы `bankQuestion`, `assessmentScale`, `barsAnchor` (валидация).
- Unit: правило partial-unique `isDefault` шкалы на тему (одна default).
- Integration: publish блокируется при невалидном вопросе / теме не `active`;
  нельзя удалить шкалу, используемую опубликованным вопросом.
- Изоляция тенантов: список вопросов/тем/шкал не течёт между организациями.

### 1.12. Критерии готовности Спринта 1
Темы CRUD + иерархия; **шкалы + BARS-якоря на уровне темы (CRUD, одна default,
крайние значения описаны)**; вопросы CRUD с черновик→публикация; AI-генерация
вопросов темы возвращает и персистит черновики; валидация качества (блок +
предупреждения, включая оценочную лексику якорей) работает; поиск/фильтры/группировка
по темам; права разложены (member — свои черновики, owner/admin — всё, HM —
read-only); опубликованный вопрос иммутабелен (правка = новая версия); отдельный
ярлык «Банк вопросов» в настройках с под-навигацией; UI на `Ui*`; миграция
применяется; тесты зелёные; существующий контур не сломан.
