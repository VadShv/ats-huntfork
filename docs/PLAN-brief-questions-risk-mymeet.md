# План: Бриф · Вопросы · Риск-анализ · MyMeet

Единый план масштабной доработки Huntfork по четырём направлениям. Документ —
источник правды для проектирования; реализация разбита на этапы, каждый из которых
самодостаточен, деплоится независимо и не ломает существующий контур
(скрининг Qwen, hh-sync, дедуп, скоринг).

Решения, принятые на старте:
- **Бриф и Банк вопросов — на уровне вакансии** (job-scoped, изоляция между вакансиями; перенос — отдельной кнопкой «клонировать» позже).
- **Риск-анализ — отдельный новый движок** (детерминированный слой дат + интерпретирующий LLM). Из движка расширения переиспользуем `parseDate`/`monthsBetween` и идею confidence-cap (`computeWolf`); полный timeline-движок (gaps/overlaps/inflation) НЕ берём в MVP.
- **Даты в рисках — считает КОД, не LLM.** И СЕЙЧАС из дат анализируем **ТОЛЬКО частоту смен мест работы** (job-hopping): число мест, средний/медианный срок, короткие места, jobHoppingScore. Никаких gaps/пересечений/инфляции стажа в MVP — это отдельный расширяемый слой на потом. LLM получает готовые числа и НЕ считает даты.
- **Смысловой LLM-движок включаем сразу, но серьёзно**: `confidence` (date_math/document/linguistic), `alternative`, `question`+`listenFor`, `metrics`; `overallRisk` с **cap** (high только при hard-evidence, чтобы лингвистика не давала false-positive шторм).
- **CURRENT_DATE закрепляем**: серверный `new Date()` инъектируется в промпт + пишется в `assessedAt`. Модель никогда не «угадывает» текущую дату.
- **Риск = профиль РЕЗЮМЕ, не вакансии.** Одна таблица `resume_risk`, привязка к `resumeVersionId` (полная версионность), кэш по существующему `candidateResumeVersion.contentHash`. Считается 1 раз на версию, переиспользуется на всех откликах кандидата (10 откликов → 0 повторных генераций). `jobMismatch` убран — соответствие вакансии частично покрывает скоринг. Главное поле — `CandidateRiskCard` под AI Summary в карточке кандидата; вид «Риски» (per-version) в панели резюме; карточка отклика переиспользует тот же профиль.
- **risk_policy на уровне орг** (bounded): пороги + доп.инструкции — «коробка + настройка под себя».
- **Вопросы под кандидата — без второго LLM-вызова**: берутся прямо из `findings[].question`/`listenFor` риск-движка.
- **MyMeet — через MCP-сервер, не REST.** MyMeet отдаёт MCP-эндпоинт `https://mcp.mymeet.ai/mcp` (HTTP transport, `Authorization: Bearer <key>`). В бэкенд Huntfork встраивается **MCP-клиент** (детерминированные вызовы tools, без внешнего AI-агента). Ключ — на уровне организации, вводится в UI (шифруется, клиенту не возвращается).
- **MyMeet — только ручная привязка (pull)**: рекрутер выбирает встречу и импортирует отчёт; без inbound-webhook на первом этапе.

---

## 0. Термины и связи доменов

```
job (вакансия)
├── brief                 (1:1)   ← Этап 1
├── jobQuestion[]         (1:N)   существующая таблица «вопросы формы»
├── jobInterviewQuestion[] (1:N)  ← Этап 2  банк интервью-вопросов вакансии
└── application[] (отклик = candidate × job)
    ├── candidate
    │     ├── hhResumeRaw / document(resume)
    │     └── candidateResumeVersion[]        (существующие версии резюме)
    │           └── resumeRisk (1:1 на версию) ← Этап 3  ПРОФИЛЬ РЕЗЮМЕ
    │                 ├── tenureJson  (частота смен — КОД, не LLM)
    │                 └── findingsJson (LLM: confidence/alternative/question/listenFor + cap)
    ├── applicationQuestionSet  (1:1, из findings[].question — БЕЗ LLM) ← Этап 4
    └── interview[]
        └── meetingReport (импорт MyMeet через MCP-клиент) ← Этап 5

  Риск НЕ зависит от вакансии: 1 прогон на версию резюме → виден на всех откликах.
  Карточка кандидата = риск текущей версии; панель резюме = риск выбранной версии.

org (организация)
├── riskPolicy (1:1)  ← Этап 3  пороги + доп.инструкции (bounded)
└── mymeetAccount (API-ключ, MCP https://mcp.mymeet.ai/mcp) ← Этап 5
```

Ключевой инсайт: **весь AI-контур уже есть**. `loadAiConfig(orgId,{purpose})`,
`generateStructuredOutput(config,{system,prompt,schema,...})`, паттерн
`criterionScore`/`analysisRun` для персиста и аудита, pg-boss для фоновых задач,
шаблон hh-интеграции для внешних сервисов. Новые фичи — это преимущественно
новые таблицы + endpoints + вкладки, а не новая инфраструктура.

Общие соглашения (из ресёрча кодовой базы):
- Каждый endpoint начинается с `requirePermission(event, { <resource>: [...] })` и скоупится по `session.session.activeOrganizationId`.
- Новые права — в `shared/permissions.ts` (`atsStatements` + каждая роль).
- Схема — `server/database/schema/app.ts` (или новый файл, реэкспорт в `index.ts`), затем миграция `NNNN_*.sql` + `meta/NNNN_snapshot.json` + запись в `meta/_journal.json`.
- Новая вкладка вакансии — запись в `jobTabs` (`app/components/AppTopBar.vue:111`) + страница `app/pages/dashboard/jobs/[id]/<name>.vue`.
- AI-purpose для новых фич: `analysis` (риски, генерация вопросов, разбор отчёта MyMeet). Скрининг-контур (`screening`/Qwen) не трогаем.
- Zod-схемы валидации — `server/utils/schemas/`.

---

## ЭТАП 1 — Бриф вакансии

### Цель
Отдельная вкладка «Бриф» в вакансии: структурированный + свободный ввод результатов
брифа с ЛПР. Часть полей — **внутренние** (не публикуются на джоб-борде), но важны
для отбора/интервью. Бриф питает генерацию вопросов (Этап 2) и риск-анализ (Этап 3)
как контекст.

### Данные
Таблица `job_brief` (1:1 к job, отдельная таблица, чтобы не раздувать `job` и
разграничить права на чтение):

```
job_brief
  id, organizationId, jobId (unique, FK cascade)
  -- Структурированные поля (все опциональны)
  hardMustHave        jsonb  string[]  -- жёсткие требования (обязательно)
  niceToHave          jsonb  string[]  -- желательно
  dealBreakers        jsonb  string[]  -- стоп-факторы
  responsibilities    text             -- реальные задачи (может отличаться от публичного описания)
  teamContext         text             -- команда, руководитель, подчинённые
  interviewProcess    text             -- этапы, кто собеседует
  compensationNotes   text             -- вилка/бонусы/условия (внутреннее)
  idealProfile        text             -- портрет идеального кандидата
  sourcingHints       text             -- где искать, компании-доноры
  redFlagsToWatch     jsonb  string[]  -- на что смотреть при отборе (питает риски)
  -- Свободная форма
  freeform            text             -- заметки брифа целиком (сырьё для AI)
  -- Метаданные
  filledById, filledAt, updatedAt, createdAt
  isInternal          boolean default true  -- глобальный флаг «не для публикации»
```

Публичный контур (`server/api/public/jobs/[slug].get.ts`) **не** обращается к
`job_brief` — по построению бриф никогда не утекает наружу. Это архитектурная
гарантия, а не флаг.

### API
- `GET  /api/jobs/[id]/brief`  — `{job:['read']}`; вернуть бриф или `null`.
- `PUT  /api/jobs/[id]/brief`  — `{job:['update']}`; upsert по `jobId`; `recordActivity`.
- Валидация: `server/utils/schemas/jobBrief.ts` (`briefSchema` со всеми полями optional).

### UI
- Новая вкладка `jobTabs`: `{ label: t('...tabs.brief'), to: '${base}/brief', icon: ClipboardList }` (`AppTopBar.vue:111`).
- Страница `app/pages/dashboard/jobs/[id]/brief.vue`:
  - Composable `useJobBrief(jobId)` (get/save, паттерн `useJobQuestions`).
  - Секции-аккордеоны: «Требования» (chip-инпуты must/nice/deal-breakers),
    «Контекст роли», «Процесс», «Компенсация (внутреннее)», «Стоп-факторы»,
    «Свободные заметки».
  - Автосохранение (debounce) + явная кнопка «Сохранить».
  - Бейдж «Внутреннее — не публикуется» вверху.
  - Права: HM (`hiringManager`) — read-only; recruiter/admin/owner — edit.

### Идеи по реализации (как лучше)
1. **Гибрид «структура + текст»**: структурированные chip-поля дают машиночитаемый
   сигнал для AI (must-have → веса критериев скоринга, red-flags → риск-движок),
   а `freeform` ловит всё, что не влезло. AI на Этапах 2–3 читает оба.
2. **Импорт из описания**: кнопка «Заполнить бриф из описания вакансии (AI)» —
   один вызов `generateStructuredOutput` (purpose `analysis`), предзаполняет
   структурированные поля черновиком, рекрутер правит. Дёшево, ускоряет заполнение.
3. **Связь со скорингом**: `hardMustHave`/`niceToHave` можно позже маппить в
   `scoringCriterion` (существующая таблица per-job) — «сгенерировать критерии из
   брифа». Не в MVP этапа, но заложить поля так, чтобы это было тривиально.
4. **Аудит**: `job_brief.updatedAt` + `recordActivity` — видно, кто и когда менял.
5. **Версионность брифа — НЕ делаем в MVP** (усложняет). При надобности — по образцу
   `candidateResumeVersion`.

### Критерии готовности
Вкладка открывается, бриф сохраняется/читается, HM видит read-only, публичный
эндпоинт не отдаёт бриф (тест), activity пишется.

---

## ЭТАП 2 — Банк вопросов под вакансию (AI-генерация)

### Цель
Вкладка «Вопросы» в вакансии: рекрутер задаёт **промпт-инструкцию**, система на
основе `промпт + описание вакансии + бриф` генерирует список вопросов. Вопросы
редактируемы, версионируемы, категоризируемы. Это **банк вопросов вакансии** —
基础 для персональных наборов под кандидата (Этап 4).

> Важно не путать с существующей `jobQuestion` (это вопросы **формы отклика** для
> соискателя). Здесь — **интервью-вопросы для рекрутера/HM**. Отдельная таблица.

### Данные
```
job_interview_question
  id, organizationId, jobId (FK cascade)
  text            text          -- сам вопрос
  category        enum          -- hard_skill | soft_skill | experience | motivation | culture | logistics | risk_probe | other
  rationale       text          -- зачем этот вопрос (для интервьюера)
  goodAnswer      text          -- на что похож сильный ответ (опц.)
  source          enum          -- ai_generated | manual | edited
  displayOrder    int
  isArchived      boolean
  createdById, createdAt, updatedAt

job_question_prompt          -- сохранённая инструкция генерации (1:1 к job)
  id, organizationId, jobId (unique)
  promptText      text          -- инструкция рекрутера
  lastGeneratedAt, lastModel, lastProvider
  updatedAt, createdAt
```

### AI-генерация
Новый util `server/utils/ai/generateInterviewQuestions.ts` по паттерну
`scoring.ts:generateCriteriaFromDescription`:
- Вход: `{ orgId, jobTitle, jobDescription, brief?, promptText, count? }`.
- `loadAiConfig(orgId,{purpose:'analysis'})`.
- Zod-схема: `{ questions: [{ text, category, rationale, goodAnswer? }] }` с
  `.catch().default()`-гардами (устойчивость).
- `system`: «Ты помощник рекрутера. Сгенерируй интервью-вопросы строго по
  вакансии/брифу и инструкции. Не выдумывай требований вне контекста…».
- `prompt`: блоки `<вакансия>`, `<бриф>`, `<инструкция рекрутера>`.
- Возврат — массив, который endpoint пишет в `job_interview_question`
  (`source='ai_generated'`).

### API
- `GET   /api/jobs/[id]/interview-questions`               — список.
- `POST  /api/jobs/[id]/interview-questions/generate`      — `{promptText, count?}` → генерит и (по флагу) сохраняет; rate-limit.
- `POST  /api/jobs/[id]/interview-questions`               — ручное добавление.
- `PATCH /api/jobs/[id]/interview-questions/[qid]`         — правка (source→`edited`).
- `DELETE`/`archive`, `reorder.put.ts`                     — как у `jobQuestion`.
- `GET/PUT /api/jobs/[id]/interview-questions/prompt`      — сохранённая инструкция.
- Права: read=`{job:['read']}`, mutate=`{job:['update']}`.

### UI
- Вкладка `jobTabs`: `{ ...tabs.questions, to: '${base}/questions', icon: MessageCircleQuestion }`.
- Страница `app/pages/dashboard/jobs/[id]/questions.vue`:
  - Верх: textarea «Инструкция для генерации» + кнопка «Сгенерировать»
    (спиннер, стрим или блокирующий вызов), выбор количества/категорий.
  - Ниже: список вопросов, группировка по `category`, drag-reorder, инлайн-правка,
    «добавить вручную», «архивировать». Бейдж источника (AI/ручной/правленый).
  - Кнопка «Перегенерировать» (не затирает ручные — добавляет/помечает).
  - Composable `useInterviewQuestions(jobId)`.

### Идеи по реализации
1. **Идемпотентность генерации**: не удалять существующие при повторной генерации —
   добавлять новые + помечать дубли (нормализация текста). Ручные вопросы неприкосновенны.
2. **Категории как enum** — потом легко фильтровать при сборке персонального набора
   (Этап 4: «взять по 2 hard_skill + все risk_probe»).
3. **Стрим** (SSE) как в `verification/run.post.ts` — вопросы появляются по мере
   генерации, UX лучше. В MVP допустим блокирующий вызов.
4. **Переиспользование брифа**: если бриф пуст — генерим только по описанию; наличие
   брифа заметно повышает качество (передаём must/nice/deal-breakers).

### Критерии готовности
Инструкция сохраняется, генерация возвращает и персистит вопросы, ручное
редактирование/reorder/archive работают, HM видит read-only.

---

## ЭТАП 3 — Риск-анализ резюме (профиль резюме, per-version)

> Раздел переписан после ревью и уточнений заказчика. Итоговые решения:
> - **Риск — свойство РЕЗЮМЕ, а не вакансии.** Считается 1 раз на версию резюме и
>   переиспользуется на всех откликах кандидата (10 откликов → 0 повторных генераций).
> - **`jobMismatch` УБРАН.** Риск полностью независим от вакансии. Соответствие
>   требованиям вакансии уже частично покрывает существующий скоринг
>   (`criterionScore`/`analysisRun`) — не дублируем.
> - **Даты СЕЙЧАС = только частота смен работ (job-hopping).** Никаких gaps /
>   пересечений / инфляции стажа в MVP — расширяемый слой на потом.
> - **Все даты считает КОД, не LLM.** LLM получает готовые числа и только их интерпретирует.
> - **Смысловой LLM-движок включаем сразу**, серьёзно: `confidence`, `alternative`,
>   `question`+`listenFor`, `metrics`, и **cap** на overallRisk.
> - **CURRENT_DATE** инъектируется в промпт + пишется в запись (`assessedAt`).
> - **Полная версионность** по `resumeVersionId`. Кэш — по существующему
>   `candidateResumeVersion.contentHash` (не изобретаем свой хэш).

### Главная идея размещения (по запросу заказчика)
- **Карточка кандидата** (`app/pages/dashboard/candidates/[id].vue`): новый блок
  `CandidateRiskCard.vue` — **строкой под `AiSummaryCard`**, над `ResumePanel`.
  Показывает риск **текущей версии** резюме (`isCurrent`) — быстрый взгляд, как саммари.
- **Панель резюме** (`ResumePanel.vue`): вид «Риски» — риск **выбранной версии**
  (`selectedVersionId`), с историей по версиям. Без конфликта с карточкой:
  карточка = «риск текущего резюме» (glance), панель = «риски по версиям» (деталь).
- **Карточка отклика** (`applications/[id].vue`): переиспользуем **тот же** риск-профиль
  резюме (текущей версии) — тот же результат, без повторной генерации. Виден на всех
  откликах кандидата.

### Архитектура: детерминированный слой + интерпретирующий LLM

```
                        ┌─────────────────────────────────────────┐
resumeVersion.snapshot ─► server/utils/risk/timeline.ts (КОД)      │
(.experience периоды)   │   • parseDate / monthsBetween  (порт из  │
                        │     extension useVerification.ts:243-274)│
CURRENT_DATE (server) ──►   • computeJobHopping(...) → facts        │
                        └───────────────┬──────────────────────────┘
                                        │ pre-computed FACTS (числа)
                                        ▼
                        ┌─────────────────────────────────────────┐
resumeText, CURRENT_DATE ► server/utils/ai/assessRisk.ts (LLM)     │
policy, facts ──────────►   LLM ИНТЕРПРЕТИРУЕТ факты, НЕ парсит даты│
                        │   → findingsJson (confidence/alt/question)│
                        │   ВАЖНО: НЕТ jobContext, НЕТ jobMismatch  │
                        └───────────────┬──────────────────────────┘
                                        │
                        ┌───────────────▼──────────────────────────┐
                        │ aggregateRisk() (КОД, с cap):             │
                        │  high ТОЛЬКО при hard-evidence            │
                        │  (date_math|document); linguistic → ≤mid  │
                        └──────────────────────────────────────────┘
                                        │
                     запись в resume_risk (по resumeVersionId)
```

### Что переиспользуем из движка расширения (факт из кода)
`extension/entrypoints/sidepanel/composables/useVerification.ts`:
- `parseDate` (`:243-262`), `monthsBetween` (`:272-274`) — **портируем** в `risk/timeline.ts`.
- `computeWolf` (`:431-452`) — **портируем идею cap** (linguistic без hard-evidence не
  поднимает выше порога) в `aggregateRisk`.
- gaps/overlaps/inflation/reverse (`analyzeTimeline :298-403`) — **НЕ портируем** (MVP:
  только частота смен). Задел на будущее.

### 3a. Детерминированный слой — `server/utils/risk/timeline.ts`
- Вход: `experience: {start,end}[]` из `resumeVersion.snapshot` (структурированный
  hh-raw) + `CURRENT_DATE` (серверный `new Date()`).
- Только частота смен (MVP):
```
computeJobHopping(experience, now) → TimelineFacts {
  jobsCount:          int
  totalMonths:        int      // существующий computeExperienceMonths (structureResume.ts)
  avgTenureMonths:    int
  medianTenureMonths: int
  shortStints:        [{ company, months }]   // < policy.shortStintMonths (деф. 12)
  shortStintRatio:    float 0..1
  jobHoppingScore:    int 0..100              // прозрачная формула
  jobHoppingLevel:    enum low|medium|high    // пороги из policy
  hasStructuredDates: boolean                 // false → блок пропускаем
}
```
- Формула `jobHoppingScore` — чистая, документированная, **обязательные unit-тесты**
  (ядро; тесты прежде кода). Никакого LLM.
- Фолбэк: нет структурированных периодов → `hasStructuredDates=false`, блок дат не
  показываем. LLM даты НЕ парсит.

### 3b. Интерпретирующий LLM — `server/utils/ai/assessRisk.ts`
- **Вход:** `{ orgId, CURRENT_DATE, facts (из 3a), resumeText, policy }`.
  **Нет** `jobContext`/`brief` — риск не зависит от вакансии.
- `loadAiConfig(orgId,{purpose:'analysis'})`.
- `CURRENT_DATE` в `system` («Сегодня <ISO>. Даты уже посчитаны — не считай сам»).
- **Схема `findingsJson`:**
```
findings: [{
  claim:       string
  issue:       string
  category:    enum inconsistency|suspicious|fact_to_verify   // БЕЗ job_mismatch
  confidence:  enum date_math|document|linguistic
  severity:    enum low|medium|high
  evidence:    string          // цитата-основание из текста
  alternative: string          // доброкачественное объяснение
  question:    string          // готовый вопрос на интервью
  listenFor:   string          // на что смотреть в ответе
}]
metrics: { density: int 0..100, adequacy: int 0..100 }
summary: string
```
- `.catch().default()`-гарды на всех полях.
- `system`: «Ты аналитик отбора. Сегодня <CURRENT_DATE>. Работай ТОЛЬКО с фактами из
  резюме и с ПЕРЕДАННЫМИ числами по датам. **НЕ считай даты/стаж/длительность.** Для
  каждой находки укажи confidence, доброкачественную альтернативу, вопрос и listenFor.
  Оцениваешь только САМО РЕЗЮМЕ (противоречия, подозрительное, факты для проверки), НЕ
  соответствие какой-либо вакансии. Не выдумывай, не решай о найме».
- `prompt`: `<сегодня>`, `<факты-даты>`, `<резюме>`, `<policy>`.
- Источник текста: из того же `resumeVersion.snapshot` (единообразно с датами) —
  `resumeToText(snapshot)`; либо `extractResumeText` для текущего документа.

### 3c. Агрегация с cap — `aggregateRisk()` (КОД)
- overallRisk из findings + jobHoppingLevel, с **cap**: `high` только если есть
  находка `confidence ∈ {date_math, document}` ИЛИ `jobHoppingLevel=high`; иначе
  (только `linguistic`) потолок `medium`.
- `overallScore` (0..100) — из формулы (severity × множитель confidence), не от LLM.

### 3d. Политика (орг-уровень, bounded)
```
risk_policy (1:1 org)
  shortStintMonths      int   default 12
  jobHoppingThresholds  jsonb {mediumScore, highScore}
  capLinguisticToMedium bool  default true
  extraInstructions     text  (≤2000)   -- «коробка + под себя»
```
API `GET/PUT /api/org-settings/risk-policy` (`{organization:['update']}`).

### Данные — ОДНА таблица, привязка к версии резюме
```
resume_risk (N: одна запись на версию резюме, версионируется естественно)
  id, organizationId
  candidateId       (FK cascade)         -- для быстрых выборок
  resumeVersionId   (FK candidate_resume_version, cascade, UNIQUE)
  status            enum running|completed|failed
  overallRisk       enum low|medium|high
  overallScore      int 0..100
  isCapped          boolean               -- сработал ли cap (для UI-индикатора)
  summary           text
  tenureJson        jsonb                 -- TimelineFacts из 3a (частота смен)
  findingsJson      jsonb                 -- findings из 3b (с confidence/alt/question/listenFor)
  metricsJson       jsonb
  provider, model, promptTokens, completionTokens, rawResponse
  contentHash       text                  -- = candidateResumeVersion.contentHash (кэш-гард)
  assessedAt        timestamp             -- закреплённый CURRENT_DATE прогона
  triggeredById, createdAt
```
- **Якорь = `resumeVersionId`**, UNIQUE → одна актуальная оценка на версию.
- **Кэш = `contentHash`**: существующее поле версии; если совпадает с записью — не
  пересчитываем. Один кандидат на 10 вакансий → 1 прогон на текущую версию, виден везде.
- **Нет `applicationId`, нет `jobId`, нет `contextHash`** — риск не зависит от вакансии
  (это чинит прежние баги #6/#7 радикально: пересчёта под вакансию просто нет).
- Версионность: при новой версии резюме (`candidateResumeVersion`) — новый прогон;
  карточка кандидата берёт запись, связанную с `isCurrent`-версией; панель — с выбранной.

### Запуск (фон)
- pg-boss очередь `resume-risk` (шаблон `dedup/workers/fuzzy-job.ts` + регистрация в
  `server/plugins/queue.ts`).
- Профильный слой (частота смен) дёшев — можно синхронно; LLM-слой — фоном.
- Триггеры: авто после структурирования/создания новой версии резюме; ручная кнопка
  «Обновить» в `CandidateRiskCard`.
- Кэш-гард по `contentHash` — не гоняем повторно на неизменной версии.

### API
- `GET  /api/candidates/[id]/risk-profile`  — риск **текущей** версии (для CandidateRiskCard); `{candidate:['read']}`.
- `GET  /api/candidates/[id]/resume-versions/[versionId]/risk` — риск конкретной версии (для панели/истории).
- `POST /api/candidates/[id]/risk`          — enqueue прогон текущей версии; `{candidate:['read']}` + новое право `risk:['create']`.
- `GET/PUT /api/org-settings/risk-policy`   — политика орг.
- Прим.: у отклика **нет** своего риск-эндпоинта — карточка отклика читает
  `GET /api/candidates/[id]/risk-profile` (переиспользование).

### UI
- **`CandidateRiskCard.vue`** (по образцу `AiSummaryCard.vue`), строка под саммари в
  `candidates/[id].vue`:
  - props: `candidateId`, `riskLevel`, `findings` (top-3 по severity/confidence), `assessedAt`, `isCapped`;
  - GET `/api/candidates/[id]/risk-profile`;
  - кнопка «Обновить» (re-enqueue) — как «Сгенерировать» у саммари;
  - блок «Стабильность занятости» (из `tenureJson`): job-hopping бейдж, число мест,
    средний/медианный срок, короткие места; помечен «рассчитано, не AI»;
  - индикатор cap («оценка ограничена: нет твёрдых доказательств»);
  - клик по находке → `emit` → родитель переключает `ResumePanel` на вид «Риски».
- **`ResumePanel.vue`** — новый вид «Риски» рядом со «Структура»/«Файл»: риск
  выбранной версии (`selectedVersionId`), полный список findings с
  severity/confidence-бейджами, `alternative`, свёрнутыми `question`/`listenFor`, `evidence`.
- **Карточка отклика** `applications/[id].vue`: компактный `CandidateRiskCard` (тот же
  компонент/эндпоинт) — виден на каждом отклике без повторной генерации.
- HM: read-only.

### Идеи по реализации
1. **Тесты-прежде-кода** на `computeJobHopping` и `aggregateRisk` (cap) — ядро.
2. **CURRENT_DATE везде**: в промпт и в `assessedAt`. Никогда не полагаемся на «знание» модели о дате.
3. **LLM интерпретирует, не считает**: даты числами из 3a; в промпте запрет считать даты.
4. **Cap против false-positive**: linguistic-only не даёт high (порт идеи `computeWolf`).
5. **Риск = профиль резюме**: нет вакансии в контексте, нет jobMismatch → нет пересчёта
   под каждую вакансию → 10 откликов = 1 прогон.
6. **Кэш по существующему `contentHash`**: не плодим свои хэши, версионность бесплатна.
7. **Карточка vs панель**: карточка = текущая версия (glance), панель = выбранная (история). Без конфликта.
8. **Вопросы рождаются здесь**: `findings[].question`/`listenFor` → прямой вход в Этап 4 без второго LLM-вызова.
9. **Не блокируем пайплайн**: риск — сигнал, не автоотказ.
10. **Задел на будущее**: полный timeline (gaps/overlaps/inflation) — подэтап 3-ext;
    `timeline.ts` проектируем расширяемым, но не реализуем сейчас.

### Критерии готовности
`computeJobHopping` + `aggregateRisk` покрыты unit-тестами; риск привязан к
`resumeVersionId` (UNIQUE) и кэшируется по `candidateResumeVersion.contentHash`; один
кандидат на N откликов → **1 прогон на текущую версию**, виден на всех откликах без
повторной генерации; `CURRENT_DATE` инъектируется и пишется в `assessedAt`; findings
без `job_mismatch`, с confidence/alternative/question/listenFor; overallRisk с cap
(`isCapped` в UI); `risk_policy` редактируется; `CandidateRiskCard` под саммари +
вид «Риски» в `ResumePanel` (per-version); карточка отклика переиспользует профиль;
HM read-only.

---

## ЭТАП 4 — Персональные вопросы под кандидата

### Цель
В отклике (вкладка «Интервью») — блок вопросов, сгенерированный **конкретно под
кандидата**: берём банк вопросов вакансии (Этап 2) + результаты риск-анализа
(Этап 3, факты для проверки/нестыковки) и собираем целевой список: релевантные
вопросы вакансии + верификационные вопросы под выявленные риски.

### Данные
```
application_question_set              -- сгенерированный набор под отклик (1:активный)
  id, organizationId, applicationId (FK cascade)
  status enum  draft|ready
  basedOnResumeRiskId  (FK resume_risk, nullable)  -- риск-профиль резюме кандидата
  generatedAt, createdById

application_question_item
  id, setId (FK cascade), organizationId
  text        text
  listenFor   text   -- на что смотреть в ответе (из findings[].listenFor)
  category    enum   -- те же + verification (под конкретный риск/факт)
  origin      enum   -- from_job_bank | risk_derived | manual
  sourceRef   text   -- id job_interview_question или id находки риска (трассировка)
  rationale   text   -- «проверяет несоответствие X» / «частые смены работ»
  askStatus   enum   -- pending|asked|skipped   (отметки во время интервью)
  answerNote  text   -- краткий ответ/итог (ручной ввод интервьюера)
  displayOrder int
```

### Сборка набора — БЕЗ второго LLM-вызова (по ревью #8)
`server/utils/risk/buildCandidateQuestions.ts` — **чисто детерминированная сборка**:
1. Тянем банк вопросов вакансии (`job_interview_question`, не архивные).
2. Тянем риск-профиль резюме кандидата (`resume_risk` текущей версии — тот же, что в
   `CandidateRiskCard`; см. Этап 3, не зависит от вакансии).
3. **Вопросы из рисков берём ПРЯМО из `findings[].question` + `listenFor`** — они
   уже сгенерированы риск-движком в Этапе 3 (`origin='risk_derived'`, `sourceRef`=id
   находки, `rationale`=`issue`). Второй LLM-вызов НЕ нужен — это устраняет дублирующую
   генерацию и следствие проблемы #3/#8.
4. Отбор из банка — правилами (N на категорию), 0 токенов.
5. Мержим, дедуп по нормализованному тексту, сортируем: сперва risk_derived (high
   severity/confidence выше), затем релевантные из банка.

Итог: **сборка набора — 0 обращений к LLM** (весь AI уже отработал в Этапах 2 и 3).
Дёшево, быстро, детерминированно, полностью трассируемо.

### API
- `POST /api/applications/[id]/question-set/generate` — собрать/пересобрать набор.
- `GET  /api/applications/[id]/question-set`          — активный набор + items.
- `PATCH /api/applications/[id]/question-set/items/[itemId]` — правка/askStatus/answerNote.
- `POST/DELETE` для ручных item’ов, `reorder`.
- Права: read `{candidate:['read']}`, mutate `{application:['update']}` (или `interview`).

### UI
- В карточке отклика — секция/вкладка «Интервью» (`applications/[id].vue`; сейчас там
  `InterviewScheduleSidebar` и список интервью). Добавляем блок
  `ApplicationQuestionSet.vue`:
  - Кнопка «Сгенерировать вопросы под кандидата» (учитывает риск-прогон, если есть).
  - Список с группировкой: сверху «Проверить (из рисков)» с привязкой к факту,
    ниже — по категориям из банка.
  - Во время интервью: чекбоксы `asked/skipped` + поле «краткий ответ»
    (`answerNote`) — это потом ляжет рядом с отчётом MyMeet (Этап 5).
  - Экспорт/печать набора (для оффлайн-интервью).
- Если риск-прогона нет — предложить сначала запустить риск-анализ (кросс-этапная связка).

### Идеи по реализации
1. **Ноль LLM-вызовов при сборке** (ревью #8): risk-вопросы уже готовы в
   `findings[].question`; банк — правилами. Весь AI отработал раньше.
2. **Трассируемость**: каждый вопрос помнит, откуда он (`origin`+`sourceRef`) —
   видно, что «этот вопрос закрывает несоответствие X» или «проверяет частые смены работ».
3. **Пересборка не теряет ручное**: ручные item’ы и заполненные `answerNote`
   сохраняются при regenerate.
4. **listenFor рядом с вопросом**: интервьюер сразу видит, на что смотреть в ответе.
5. **Готовность к MyMeet**: `answerNote`/`askStatus` — точки, которые Этап 5 может
   автозаполнять из транскрипт-отчёта (матчинг вопрос↔ответ), но это пост-MVP.

### Критерии готовности
Набор собирается из банка + рисков **без обращений к LLM**, risk-вопросы приходят из
`findings[].question`/`listenFor`, трассировка работает, ручная правка и отметки
`asked/answerNote` сохраняются, regenerate не затирает ручное.

---

## ЭТАП 5 — Интеграция с MyMeet (MCP-клиент, ручная привязка / pull)

### Цель
Импорт отчётов MyMeet (транскрибация → структурированный отчёт по интервью) и
привязка к интервью. **Ручной pull**: рекрутер подключает MyMeet (API-ключ на уровне
организации в UI), выбирает встречу и импортирует отчёт в конкретное интервью.

### Ключевое отличие: MyMeet — это MCP-сервер, а не REST
MyMeet предоставляет **MCP-эндпоинт**, а не набор фиксированных REST-роутов:
```
endpoint:   https://mcp.mymeet.ai/mcp
transport:  streamable HTTP (MCP)
auth:       заголовок  Authorization: Bearer <api-key>
```
Референс-конфиги, которые дал заказчик (для сведения; в нашем случае это делает
бэкенд, а не Claude Desktop):
- `mcp-remote https://mcp.mymeet.ai/mcp --header "Authorization: Bearer <key>"`
- `claude mcp add mymeet --transport http https://mcp.mymeet.ai/mcp --header "Authorization: Bearer <key>"`

**Решение (подтверждено заказчиком): встроить MCP-клиент в бэкенд Huntfork.**
Сервер сам подключается к `mcp.mymeet.ai`, получает список tools и вызывает их
детерминированно (без внешнего AI-агента — экономно и предсказуемо).

Технически: в проекте уже есть `ai@^6` (Vercel AI SDK), где есть
`experimental_createMCPClient`. Транспорт — streamable HTTP через официальный
`@modelcontextprotocol/sdk` (`StreamableHTTPClientTransport`), в который прокидываем
заголовок `Authorization`. Обе библиотеки совместимы; конкретную зависимость
(`@modelcontextprotocol/sdk`) добавляем в этот этап.

> Первый шаг реализации этапа — **discovery**: подключиться к `mcp.mymeet.ai`,
> вызвать `tools/list`, зафиксировать реальные имена tools и их input/output-схемы
> (напр. «список встреч», «получить отчёт», «получить транскрипт»). Ниже — плейсхолдеры;
> точные имена берём из discovery. Это единственная внешняя неизвестность плана.

### Данные
```
mymeet_account                        -- подключение на уровне орг
  id, organizationId (unique)
  apiKeyEncrypted   text              -- AES-256-GCM (server/utils/encryption.ts)
  connectedById, createdAt, updatedAt
  lastToolsJson     jsonb             -- кэш tools/list после discovery (имена+схемы)
  lastCheckedAt     timestamp

meeting_report                        -- импортированный отчёт MyMeet
  id, organizationId
  interviewId   (FK interview, cascade, nullable до привязки)
  applicationId (денормализация)
  status        enum  importing|completed|failed
  externalMeetingId  text  (unique в рамках орг)
  title, meetingDate, durationSec
  transcriptText    text              -- полная транскрибация (или ссылка)
  reportJson        jsonb             -- структурированный отчёт MyMeet как есть
  summary           text
  participantsJson  jsonb
  importedById, importedAt, sourceUrl
```

Отдельно от `interview.notes` — отчёт крупный, версионируемый и приходит извне.

### Интеграция (MCP-клиент) — `server/utils/mymeet/mcp.ts`
- `getMymeetClient(orgId)`: расшифровывает ключ (JIT), создаёт MCP-клиент к
  `https://mcp.mymeet.ai/mcp` (streamable HTTP + `Authorization: Bearer <key>`),
  открывает сессию. Обязательно закрывать клиент после вызова (нет пула
  долгоживущих соединений в MVP — открыл/вызвал/закрыл).
- `listMymeetTools(orgId)`: `tools/list` → кэшируем в `mymeet_account.lastToolsJson`.
- `callMymeetTool(orgId, name, args)`: типизированная обёртка над `tools/call`
  с таймаутом и нормализацией ошибок.
- Высокоуровневые функции поверх tools (имена tools — из discovery):
  `listMeetings(params)`, `getReport(meetingId)`, `getTranscript(meetingId)`.
`server/utils/mymeet/account.ts`: `upsertMymeetAccount`/`getApiKey`/`disconnect`
(шаблон `hh/tokens.ts`, но без refresh — статический ключ).

### API (наше приложение)
- `POST   /api/mymeet/connect`   — сохранить API-ключ (шифруем); `{organization:['update']}`.
- `DELETE /api/mymeet/disconnect`
- `GET    /api/mymeet/status`     — подключено ли + результат discovery (`hasApiKey`, список tools).
- `POST   /api/mymeet/test`       — тест соединения = `tools/list` (как `ai-config/test-connection`).
- `GET    /api/mymeet/meetings`   — список встреч (через MCP tool) для выбора при привязке.
- `POST   /api/interviews/[id]/import-mymeet` — тело `{ externalMeetingId }`:
  создаёт `meeting_report(status=importing)` + enqueue job; `{interview:['update']}`.
- (опц.) `POST /api/mymeet/reports/[id]/reprocess` — перечитать/AI-резюмировать.

### Фоновая обработка
- pg-boss очередь `mymeet-import` (импорт долгий: отчёт готовится асинхронно на
  стороне MyMeet). Шаблон `fuzzy-job.ts` + регистрация в `server/plugins/queue.ts`.
- Флоу: `import-mymeet` создаёт `meeting_report(status=importing)` и шлёт job; worker
  через MCP-клиент тянет отчёт/транскрипт (при необходимости поллит до готовности),
  сохраняет `reportJson`/`transcriptText`, опц. прогоняет наш `analysis`-провайдер
  для единого краткого summary и (пост-MVP) матчинга вопрос↔ответ с
  `application_question_set` (автозаполнение `answerNote`).

### UI
- **Настройки** (`app/pages/dashboard/settings/*` или org-settings-раздел):
  карточка «MyMeet» — ввод API-ключа, кнопка «Проверить» (tools/list), статус,
  список обнаруженных возможностей. Ключ вводит owner/admin; **заказчик вводит сам**,
  клиенту ключ не возвращается (только `hasApiKey`).
- **Интервью** (`applications/[id].vue`, `interviews/[id].vue`): кнопка «Привязать
  встречу MyMeet» → модалка со списком встреч (`GET /api/mymeet/meetings`), выбор →
  импорт. После импорта — блок `MeetingReportCard.vue`: summary, участники,
  длительность, сворачиваемая транскрибация, ссылка на MyMeet, статус importing/failed.
- HM: read-only просмотр отчёта.

### Идеи по реализации
1. **MCP discovery — первый шаг** (единственная внешняя неизвестность). Зафиксировать
   реальные имена/схемы tools, закэшировать в `lastToolsJson`. Всё остальное строится
   поверх них.
2. **MCP-клиент в бэкенде, детерминированно**: вызываем конкретные tools по коду, а не
   через AI-агента — предсказуемо и без лишних токенов. (AI-агентный режим — возможное
   расширение позже, инфраструктура `chatTools.ts` это позволяет.)
3. **Соединение открыл/вызвал/закрыл** в MVP (без пула). MCP-сессия к внешнему серверу
   не должна жить между запросами — меньше утечек/зависаний.
4. **Секрет — как у всех**: `apiKeyEncrypted` через `server/utils/encryption.ts`
   (AES-256-GCM). Ключ клиенту не возвращаем (только `hasApiKey`), как в `ai-config`.
5. **Только pull на MVP** (решение заказчика): без публичного webhook. `externalMeetingId`
   unique заложен, чтобы позже без боли добавить inbound-режим.
6. **Матчинг встреча↔интервью**: MVP — ручной выбор. Позже — подсказка по участникам/дате.
7. **Единый summary**: прогнать отчёт через наш `analysis`-провайдер для единого формата (опц.).
8. **Долгая генерация**: обязательно фон (pg-boss) + статус в UI, не блокирующий запрос.

### Ключу заказчик вводит сам — мне ключ НЕ нужен
Настройку в UI делаю так же, как `ai-config`: поле ввода ключа → шифрование на
сервере → хранение `apiKeyEncrypted` → клиенту возвращается только `hasApiKey`.
Для проектирования/реализации мне ключ не требуется. Он понадобится только для
**реального прогона discovery/импорта в рантайме** (можно ввести через UII на VM,
либо временно в env для e2e). Ключ в чат присылать не нужно.

### Критерии готовности
Ключ MyMeet сохраняется (шифруется), `tools/list` проходит и кэшируется, список встреч
тянется через MCP, импорт создаёт `meeting_report` (фон) и привязывает к интервью,
отчёт виден в карточке, HM read-only.

---

## Сквозные задачи (по всем этапам)

- **Права**: добавить при необходимости ресурсы `risk`, `interview` (mutate),
  `integration` в `shared/permissions.ts` (`atsStatements` + owner/admin/member/HM).
- **i18n**: все новые строки — через `t(...)` + ключи в `i18n/` (проект многоязычный, Crowdin/Weblate).
- **Миграции** (уточнено по ревью #10): рантайм-раннер `server/plugins/migrations.ts`
  читает **только** `meta/_journal.json` + сами `.sql` (см. `readMigrations` там же,
  строки 19-35). `meta/NNNN_snapshot.json` рантайму **НЕ нужен** — снапшоты нужны лишь
  если генерируешь миграции через `drizzle-kit generate/migrate` локально (0083
  добавлен без снапшота и работает). Итого на этап: создать `NNNN_*.sql` + добавить
  запись в `_journal.json` (`tag`,`when`), поправить `server/database/schema/*` для типов.
  Порядок нумерации: `0084_job_brief`, `0085_interview_questions`,
  `0086_resume_risk_and_policy`, `0087_candidate_question_set`, `0088_mymeet`.
- **Тесты**: vitest на утилиты (агрегация риска, сборка набора вопросов, парсинг
  отчёта); Playwright e2e на ключевые вкладки. Приоритет — детерминированные утилиты.
- **Rate-limit**: все AI-endpoints — через `createRateLimiter` (как `verification/run`).
- **Логи/аналитика**: `logApiRequest` + токены/модель на каждом AI-вызове (единый паттерн).
- **Новая зависимость (Этап 5)**: `@modelcontextprotocol/sdk` для MCP-транспорта
  (streamable HTTP) поверх `experimental_createMCPClient` из `ai@^6`. Единственная новая
  внешняя библиотека во всём плане.
- **Дата-логика (Этап 3)**: вынесена в `server/utils/risk/tenure.ts`, чистые функции,
  обязательные unit-тесты. LLM-схемы не содержат полей с датами/месяцами/разрывами.
- **Фичефлаги на вакансии**: `autoRiskOnApply` (и т.п.) по образцу `autoScoreOnApply` —
  чтобы AI-фичи включались по желанию, не ломая тем, кому не нужно.

## Порядок и зависимости

```
Этап 1 (Бриф) ──────────────┐
                            ├──► Этап 2 (Вопросы вакансии) ──┐
Этап 1 ─────────────────────┘                               ├──► Этап 4 (Вопросы под кандидата)
                                                            │
Этап 3 (Риски) ─────────────────────────────────────────────┘
Этап 5 (MyMeet) — независим, можно параллельно в любой момент
```

Рекомендуемая последовательность: **1 → 2 → 3 → 4 → 5**. Этап 5 можно вести
параллельно (не зависит от 1–4). Этап 4 требует готовых 2 и 3.

## Оценка (very rough, порядок величины)

| Этап | Backend | Frontend | AI | Итого |
|------|:------:|:-------:|:--:|:----:|
| 1 Бриф | таблица+2 endpoint | 1 вкладка | 1 опц. вызов | S |
| 2 Вопросы вакансии | 2 таблицы+~6 endpoint | 1 вкладка | 1 движок | M |
| 3 Риски | таблица+2 endpoint+queue | карточка+вкладка | 1 движок | M–L |
| 4 Вопросы кандидата | 2 таблицы+~5 endpoint | блок в интервью | 1 движок (гибрид) | M |
| 5 MyMeet | 2 таблицы+client+~6 endpoint+queue | настройки+модалка+карточка | опц. summary | M–L |

S≈дни, M≈~неделя, L≈>неделя (зависит от команды; ориентир, не обязательство).
