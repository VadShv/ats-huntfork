# ТЗ · Модуль «Карта поиска» — глобальный конструктор + карта вакансии

> **Статус:** черновик на согласование (v1, 04.10.2026)
> **Тип:** полное ТЗ модуля (одним документом; спринты — внутри, §14)
> **Паттерн:** «две сущности» — org-уровень (методология + накапливаемые справочники) → проекция в вакансию (snapshot), по образцу `docs/adr-questions-two-entities.md` и `docs/tz-questions-03-presets-vacancy.md`
> **Связанные документы:**
> - `docs/tz-questions-90-cross-cutting.md` — конвенции прав, БД-имён, миграций, ошибок, i18n, design-system. **Применяются к этому модулю целиком**, ниже даны только отличия и конкретика.
> - `docs/rbac-v2-master-plan.md` — ролевая модель (`requirePermission`, IDOR → 404, deny-by-default).
> - `docs/adr-job-description-sections.md` — паттерн «канон + проекция», источник полей описания.
> - `docs/hh-extensions-architecture.md` — hh-контур, который модуль **не меняет**.
> - `docs/plan-ui-unification.md` — только `Ui*`-компоненты.

---

## 0. Резюме для чтения за две минуты

Карта поиска — это рабочий документ рекрутёра по вакансии: **кого** ищем (тайтлы и их синонимы, ключевые слова), **где** ищем (компании-доноры по слоям, география, каналы), **какие гипотезы** проверяем и **что сработало**. Модуль состоит из двух частей:

| | Глобальный модуль — «Конструктор карт» | Локальный модуль — «Карта вакансии» |
|---|---|---|
| Где | `Настройки → Карта поиска` | Вкладка `Вакансия → Карта поиска` |
| Что хранит | Шаблоны карт, реестр компаний-доноров, справочник каналов, методические подсказки для ИИ | Конкретные гипотезы: доноры по слоям, сегменты, их статусы, версии |
| Владелец | owner / admin (HR-лид) | Рекрутёр вакансии; HM — read-only |
| Жизненный цикл | Долгий, правится редко, in place | Живёт с вакансией, меняется ежедневно, версионируется снапшотами |
| Связь с данными вакансии | Нет | Привязана к брифу, критериям и описанию через хэши → статус «устарела» |
| Роль ИИ | Хранит подсказки и правила | Генерирует и догенерирует содержимое по секциям |
| Направление данных | Шаблон → карта (копия при создании) | Новые доноры → реестр (накопление) |

Три жёстких правила модуля:
1. Глобальный модуль **никогда** не меняет локальную карту задним числом.
2. Локальная карта обогащает реестр доноров **только явным действием** пользователя.
3. hh-сорсинг (`hh_saved_search`, `hh_sourcing_candidate`, `jobs/[id]/sourcing-searches/*`) **не меняется**; единственная связка — nullable `hh_saved_search.search_map_segment_id`.

---

## 1. Цель и ценность

### 1.1. Проблема

Сейчас стратегия поиска по вакансии живёт в голове рекрутёра, в заметках и в поле `job_brief.sourcing_hints` (свободный текст, `app.ts:596`). Следствия:
- При передаче вакансии другому рекрутёру стратегия теряется.
- Нет ответа HM на вопрос «почему мы ищем именно в этих компаниях» в привязке к его брифу.
- Знание о рынке (какие компании — хорошие доноры для каких ролей) не накапливается между вакансиями.
- Нельзя понять, какая гипотеза (слой доноров, канал, набор тайтлов) реально принесла кандидатов.

### 1.2. Что даёт модуль

| Для кого | Ценность |
|---|---|
| Рекрутёр | Структурированный стартовый веер гипотез за минуты (ИИ по брифу), рабочий документ с статусами «работает / отклонена», кнопка «создать поиск hh» из сегмента |
| HR-лид | Единая методология (шаблоны секций), накапливаемый реестр доноров, видимость стратегии по каждой вакансии |
| HM | Прозрачность: версия карты привязана к его брифу; читает, что проверено и почему отклонено |
| Система | Данные для аналитики «какой слой карты принёс кандидатов» через `hh_saved_search.search_map_segment_id` |

### 1.3. Образ результата

```
ORG: Шаблон карты (секции + подсказки) ─┐    Реестр доноров ─┐   Каналы ─┐
                                        ▼                    ▼           ▼
ВАКАНСИЯ: job_search_map (snapshot шаблона)
   ├─ секции-списки: синонимы тайтлов · ключевые слова · гео · исключения
   ├─ доноры по слоям: ядро · смежный круг · школы компетенций · alumni
   ├─ сегменты: слой × тайтлы × гео × канал → приоритет, статус гипотезы, строка запроса
   │     └─ (канал = hh) → hh_saved_search.search_map_segment_id → hh_sourcing_candidate
   └─ версии: v1 «черновик ИИ» → v2 «после калибровки с HM» (хэши брифа/критериев/описания)
```

---

## 2. Ground truth — что уже есть в коде (не переделываем)

Проверено по репозиторию `VadShv/ats-huntfork` на 04.10.2026.

| Слой | Где | Как используем |
|---|---|---|
| Вакансия | `job` `app.ts:149` (`title`, `description`, `location`, `experienceLevel`, `companyId`, `departmentId`) | Вход генерации; `description` — источник хэша |
| Бриф | `jobBrief` `app.ts:581` — `hardMustHave[]`, `niceToHave[]`, `dealBreakers[]`, `idealProfile`, `sourcingHints`, `teamContext`, `freeform`; API `jobs/[id]/brief/{index.get,index.put}` | Главный вход генерации; источник хэша |
| Критерии скоринга | `scoringCriterion` `app.ts:1134` (`name`, `description`, `category`, `weight`); API `jobs/[id]/criteria/*` | Вход генерации (веса → приоритеты); источник хэша |
| hh-сорсинг | `hhSavedSearch` `app.ts:1692`, `hhSourcingCandidate` `app.ts:1729`; API `jobs/[id]/sourcing-searches/{index.get,index.post}`, `sourcing-searches/[id].*`, `jobs/[id]/sourcing-candidates.get.ts`; страница `jobs/[id]/sourcing.vue` | **Не трогаем.** Добавляем одну nullable-колонку + опциональное поле в body `index.post.ts` |
| AI-генерация запроса hh | `server/utils/hh/sourcing/aiQuery.ts` (`generateSearchQueryFromJd`, язык поиска hh.ru) | Переиспользуем знание синтаксиса hh для `boolean_string` сегментов с каналом `hh` |
| Паттерн «генерация без персиста» | `jobs/[id]/criteria/generate.post.ts` — возвращает предложения, клиент ревьюит, затем сохраняет | Тот же контракт для `search-map/generate` |
| AI-инфра | `loadAiConfig(orgId, { purpose: 'analysis' })` `server/utils/ai/loadConfig.ts:25`; `generateStructuredOutput` `provider.ts:367` (`wrapBareArray`, `temperature`, recovery) | Единственный способ вызова LLM в модуле |
| Rate-limit | `createRateLimiter` `server/utils/rateLimit.ts` (образец: 10 req/мин в `criteria/generate`) | На все AI-эндпоинты модуля |
| Scope-гуарды | `requireJobInScope` `server/utils/access/scope.ts:243`; `requireSourcingSearchInScope` `:275` | Добавляем `requireSearchMapInScope`, `requireDonorCompanyInScope` по тому же образцу (404 при чужом ID) |
| Права | `shared/permissions.ts` — `atsStatements` (`:30-60`), raw-карты ролей (owner `:~95`, admin `:~120`, member `:~150`, HM `:~200`), образец `questionBank` | Новый ресурс `searchMap`, §7 |
| Паттерн snapshot/provenance | `jobQuestionnaireMeta` `app.ts:3871` (`presetId`, `presetVersion`, `importedAt`, `adaptedAt`, `adaptationModel`) | Те же поля провенанса в `job_search_map` |
| Паттерн org-пресета | `questionPreset` `app.ts:3809` (`code`, `status`, `version`, `isDefault`, `publishedAt`) | Образец для `search_map_template` |
| Юрлица холдинга | `company` `app.ts:3045` (`legalName`, `inn`, `isDefault`) | **Не переиспользуем** для доноров — другая сущность (§3.3) |
| Вкладки вакансии | `AppTopBar.vue` `jobTabs` (`:111-127`); i18n `dashboard.jobs.tabs.*` | Регистрируем вкладку `searchMap` после `brief` |
| Раздел настроек | `SettingsSidebar.vue:74-79` (запись «Банк вопросов»), обёртка `settings/question-bank.vue` с `subNav` + `<NuxtPage>` | Тот же паттерн для `settings/search-map.vue` |
| Design-system | `app/components/ui/{UiBadge,UiButton,UiCard,UiDrawer,UiInput,UiModal,UiSegmented,UiSelect,UiTextarea}` | Только они; `UiTextarea` уже есть |
| Миграции | Последняя — `0117_review_fixes` (idx 116, `_journal.json`) | Новая — `0118_search_map` (idx 117) |
| i18n | Единственная локаль `i18n/locales/ru.json` | Блок `dashboard.searchMap.*` |

---

## 3. Термины

| Термин | Определение | Где живёт |
|---|---|---|
| **Карта поиска** | Структурированный документ стратегии поиска по вакансии: секции-списки + доноры по слоям + сегменты + версии | вакансия |
| **Шаблон карты** | Набор секций с порядком и методическими подсказками под тип роли; копируется в карту при создании | org |
| **Секция** | Блок карты одного типа (`section_type`): синонимы тайтлов, ключевые слова, гео, исключения, заметки | шаблон → карта |
| **Элемент секции** | Одна строка списка внутри секции (например, один синоним тайтла) | карта |
| **Компания-донор** | Компания, из которой потенциально берём кандидатов. Нормализованное имя + алиасы + теги | org (реестр) |
| **Слой доноров** | Классификация донора в контексте карты: `core` (прямые конкуренты/аналоги), `adjacent` (смежный круг), `school` («школа компетенций» — где выращивают нужный навык), `alumni` (бывшие сотрудники компаний-ориентиров), `custom` | карта |
| **Канал** | Источник поиска: hh, LinkedIn, GitHub, Telegram, Habr Career, рефералы, custom. Имеет приоритет и шаблон URL | org (справочник) |
| **Сегмент** | Единица гипотезы — кортеж «слой доноров × тайтлы × гео × канал» с приоритетом, оценками и статусом. Все компоненты кортежа опциональны | карта |
| **Статус гипотезы** | `untested` → `in_progress` → `working` / `rejected` | сегмент, донор |
| **Строка запроса** | Канал-специфичная поисковая строка сегмента (для hh — на языке поиска hh.ru) | сегмент |
| **Версия карты** | Иммутабельный именованный снапшот всей карты + хэши источников на момент снапшота | карта |
| **Источники карты** | Бриф, критерии скоринга, описание вакансии. Их хэши фиксируются в карте и в версии | вакансия |
| **Устаревшая карта (stale)** | Текущие хэши источников ≠ хэшам в карте; показывается баннер | вычисляется на чтении |
| **Происхождение (origin)** | `manual` / `ai` — кто создал элемент; `ai` сбрасывается в `manual` при первом ручном редактировании | элемент, донор, сегмент |

---

## 4. Ключевые архитектурные решения (зафиксированы с заказчиком)

1. **Отдельная вкладка «Карта поиска», hh-сорсинг не трогаем.** `sourcing.vue` и весь hh-контур остаются как есть. Связка — только `hh_saved_search.search_map_segment_id` (nullable, `set null`) и опциональное поле `searchMapSegmentId` в body `POST /jobs/[id]/sourcing-searches`.
2. **Реестр доноров — на уровне организации.** Главный накапливаемый актив. В вакансии — только связь «донор × карта × слой × приоритет × статус». Нормализация имён обязательна с первой версии (`normalized_name` + `aliases[]`), иначе «Яндекс / Yandex / ООО Яндекс» размножатся.
3. **Версионность — именованные снапшоты, а не версия на каждое изменение.** Снапшот = явное действие пользователя или ответ на баннер «источники изменились». Внутри текущей рабочей версии карта правится свободно. Версии иммутабельны; «откат» = новая версия из старого снапшота.
4. **Привязка к брифу, критериям и описанию через хэши.** Карта хранит `source_hashes {brief, criteria, description}`; на `GET` сравниваем с актуальными → `isStale`. Без триггеров и фоновых задач.
5. **Генерация — гибрид «пустая карта + предложение черновика + погранулярные догенерации».** Карта создаётся из шаблона пустой; если есть бриф/критерии/описание — показывается ненавязчивое предложение «Собрать черновик по брифу». Генерация **не персистит**, возвращает предложения; пользователь принимает их целиком или частично (контракт `criteria/generate.post.ts`). Всё принятое помечается `origin: 'ai'`.
6. **Сегмент — кортеж с опциональными полями, а не свободная карточка.** Это даёт автогенерацию строк запроса и аналитику «какой слой/канал сработал». Свободная мысль живёт в `note` сегмента и в секции `notes`.
7. **Промпты — в коде, методические подсказки — в данных.** Системные промпты генерации лежат в `server/utils/ai/searchMap/prompts.ts` (версионируются с кодом). Шаблон карты несёт поле `generation_guidance` (текст HR-лида: «для IT-ролей слой school — это outsource-компании и bootcamp-ы…»), которое подмешивается в промпт. Отдельной редактируемой методики (как CARE) **не делаем** — это over-engineering для первой версии.
8. **Детерминированно / LLM.** Создание карты из шаблона, нормализация доноров, хэши, диффы версий, статистика — без LLM. LLM — только по кнопке: черновик карты, догенерация доноров/тайтлов/ключевых слов, строка запроса под сегмент.
9. **Один ресурс прав `searchMap`** с гранулярными actions (§7). Отдельный action `add_donor` для рекрутёра — чтобы накопление реестра не упиралось в admin.
10. **UI только на `Ui*`** и токенах design-system; вкладки — через `jobTabs` в `AppTopBar.vue`; подтверждения — `useConfirm`; тосты — `useToast`.

---

## 5. Модель данных

Все таблицы org-scoped (`organization_id` notNull, FK cascade). Конвенция имён — `tz-questions-90-cross-cutting.md §7a`: таблицы/enum в БД `snake_case`, enum **без** суффикса `_enum`; Drizzle-alias camelCase, enum-alias с `Enum`. Новая секция в `server/database/schema/app.ts`:

```
// ═════════════════════════════════════════════════════════════════
// Модуль «Карта поиска» — docs/tz-search-map.md
// ═════════════════════════════════════════════════════════════════
```

### 5.1. Enum модуля

| Drizzle-alias | БД-имя | Значения | Назначение |
|---|---|---|---|
| `searchMapTemplateStatusEnum` | `search_map_template_status` | `draft`, `published`, `archived` | Статус шаблона (аналог `preset_status`) |
| `searchMapSectionTypeEnum` | `search_map_section_type` | `title_synonyms`, `keywords`, `geo`, `exclusions`, `notes` | Тип секции-списка. Доноры, каналы и сегменты — не секции, а отдельные таблицы |
| `donorLayerEnum` | `donor_layer` | `core`, `adjacent`, `school`, `alumni`, `custom` | Слой донора в карте |
| `donorCompanyStatusEnum` | `donor_company_status` | `active`, `archived`, `merged` | Статус записи реестра |
| `hypothesisStatusEnum` | `hypothesis_status` | `untested`, `in_progress`, `working`, `rejected` | Статус гипотезы (сегмент, донор в карте) |
| `searchMapPriorityEnum` | `search_map_priority` | `high`, `medium`, `low` | Приоритет сегмента / донора / канала |
| `searchMapOriginEnum` | `search_map_origin` | `manual`, `ai`, `template` | Происхождение элемента |
| `searchMapStatusEnum` | `search_map_status` | `draft`, `active`, `archived` | Статус карты вакансии |
| `searchMapVersionTriggerEnum` | `search_map_version_trigger` | `manual`, `sources_changed`, `ai_generated`, `calibration`, `restore` | Причина создания версии |
| `sourcingChannelCodeEnum` | **не создаём** | — | Код канала — `text`, т.к. набор расширяем пользователем (`custom`). Системные коды зафиксированы константой `SYSTEM_CHANNEL_CODES` в коде |

### 5.2. Глобальный модуль (org-уровень)

#### `search_map_template` — шаблон карты

```
search_map_template                         (Drizzle: searchMapTemplate)
  id                  text pk uuid
  organizationId      text notNull FK organization cascade
  code                text                      -- человекочитаемый, уникален в орг (напр. "SM-IT")
  name                text notNull              -- до 120
  description         text
  targetRoles         jsonb string[] default [] -- "Backend", "Sales", "C-level"
  generationGuidance  text                      -- методические подсказки для ИИ (до 4000 симв.)
  defaultChannelCodes jsonb string[] default [] -- какие каналы предзаполнять в карте
  isDefault           boolean notNull default false   -- ровно один published на орг (partial unique)
  status              search_map_template_status notNull default 'draft'
  version             integer notNull default 1       -- инкремент при публикации изменений
  createdById         text FK user set null
  publishedAt         timestamp
  publishedById       text FK user set null
  createdAt / updatedAt
  индексы: search_map_template_org_idx(organizationId);
           search_map_template_org_code_unique(organizationId, code);
           search_map_template_default_idx(organizationId) where isDefault = true
```

Правила:
- Шаблон правится **in place** (без версий-снапшотов); `version` инкрементируется при `publish`, чтобы карта знала, из какой версии создана (`job_search_map.template_version`).
- Удаление — только soft (`archived`). Карты, созданные из архивного шаблона, продолжают жить.
- Если у организации нет ни одного шаблона — при первом открытии раздела или первом создании карты сидится системный шаблон «Универсальная карта» (§5.5), `code = 'SM-DEFAULT'`, `isDefault = true`, `status = 'published'`.

#### `search_map_template_section` — секция шаблона

```
search_map_template_section                 (Drizzle: searchMapTemplateSection)
  id              text pk uuid
  organizationId  text notNull FK organization cascade
  templateId      text notNull FK search_map_template cascade
  sectionType     search_map_section_type notNull
  title           text notNull              -- "Синонимы тайтлов"
  guidance        text                      -- подсказка рекрутёру (показывается в пустом состоянии секции)
  isRequired      boolean notNull default false  -- карта не может быть «активна» с пустой required-секцией (мягко: предупреждение, не блок)
  displayOrder    integer notNull default 0
  createdAt / updatedAt
  индексы: ..._org_idx; ..._template_idx(templateId);
           search_map_template_section_unique(templateId, sectionType)  -- один тип = одна секция
```

#### `donor_company` — реестр компаний-доноров

```
donor_company                               (Drizzle: donorCompany)
  id               text pk uuid
  organizationId   text notNull FK organization cascade
  canonicalName    text notNull              -- отображаемое имя, до 160
  normalizedName   text notNull              -- normalizeCompanyName(canonicalName), §9.1
  aliases          jsonb string[] default [] -- отображаемые алиасы
  normalizedAliases jsonb string[] default [] -- normalizeCompanyName(alias) для каждого
  website          text
  hhEmployerId     text                      -- id работодателя на hh.ru, если известен (для будущего матчинга)
  industry         text                      -- свободный тег домена ("финтех", "e-com")
  techStack        jsonb string[] default []
  sizeBand         text                      -- "1-50" | "51-200" | "201-1000" | "1000+" (валидируется Zod, не enum БД)
  stage            text                      -- "startup" | "growth" | "enterprise" | "state" (Zod)
  country          text
  city             text
  tags             jsonb string[] default []
  notes            text
  status           donor_company_status notNull default 'active'
  mergedIntoId     text FK donor_company set null   -- при объединении дублей
  createdById      text FK user set null
  createdFromJobId text FK job set null     -- из какой вакансии впервые добавлен (провенанс накопления)
  createdAt / updatedAt
  индексы: donor_company_org_idx(organizationId);
           donor_company_org_normalized_unique(organizationId, normalizedName);
           donor_company_status_idx(status);
           GIN donor_company_normalized_aliases_idx(normalizedAliases)   -- поиск по алиасам
```

Правила:
- Уникальность — по `normalizedName` в орг. Попытка создать дубль → 409 с `existingId` в теле (клиент предлагает «использовать существующую»).
- Поиск при добавлении: сначала точное совпадение `normalizedName`, затем вхождение в `normalizedAliases`, затем `ILIKE` по префиксу (автодополнение).
- Объединение дублей (`merge`): все `job_search_map_donor.donor_company_id` переносятся на целевую запись, алиасы складываются, источник получает `status='merged'`, `mergedIntoId`.
- Удаление физическое запрещено — только `archived`.

#### `sourcing_channel` — справочник каналов

```
sourcing_channel                            (Drizzle: sourcingChannel)
  id               text pk uuid
  organizationId   text notNull FK organization cascade
  code             text notNull              -- 'hh' | 'linkedin' | 'github' | 'telegram' | 'habr' | 'referral' | 'custom:<slug>'
  name             text notNull
  description      text
  defaultPriority  search_map_priority notNull default 'medium'
  urlTemplate      text                      -- "https://hh.ru/search/resume?text={query}" ; плейсхолдеры {query}, {title}, {geo}
  queryLanguageHint text                     -- подсказка ИИ о синтаксисе запросов канала (для hh — ссылка на hh.ru/article/1175)
  isSystem         boolean notNull default false   -- системные нельзя удалить, можно деактивировать
  isActive         boolean notNull default true
  displayOrder     integer notNull default 0
  createdAt / updatedAt
  индексы: sourcing_channel_org_idx; sourcing_channel_org_code_unique(organizationId, code)
```

Сид системных каналов (идемпотентно при первом `GET /api/search-map/channels` в орг или при создании первой карты): `hh` (high, `urlTemplate` поиска резюме, `queryLanguageHint` = язык поиска hh.ru), `linkedin` (medium), `github` (low), `telegram` (medium), `habr` (medium), `referral` (high, без URL).

### 5.3. Локальный модуль (вакансия)

#### `job_search_map` — карта вакансии (1:1 к job)

```
job_search_map                              (Drizzle: jobSearchMap)
  id                 text pk uuid
  organizationId     text notNull FK organization cascade
  jobId              text notNull FK job cascade
  templateId         text FK search_map_template set null
  templateVersion    integer
  status             search_map_status notNull default 'draft'
  currentVersionNo   integer notNull default 0     -- 0 = снапшотов ещё нет
  sourceHashes       jsonb { brief: string|null, criteria: string|null, description: string|null } notNull default {}
  sourceHashesAt     timestamp                      -- когда хэши зафиксированы (при создании и при каждом «пересобрать»/версии)
  summary            text                           -- краткое резюме стратегии (1–3 абзаца; может писать ИИ)
  lastGeneratedAt    timestamp
  lastGenerationModel text                          -- аналог adaptationModel в job_questionnaire_meta
  createdById        text FK user set null
  createdAt / updatedAt
  индексы: job_search_map_job_unique(jobId); job_search_map_org_idx; job_search_map_template_idx
```

#### `job_search_map_section` — секция карты (копия из шаблона)

```
job_search_map_section                      (Drizzle: jobSearchMapSection)
  id              text pk uuid
  organizationId  text notNull FK organization cascade
  mapId           text notNull FK job_search_map cascade
  sectionType     search_map_section_type notNull
  title           text notNull
  guidance        text
  isRequired      boolean notNull default false
  displayOrder    integer notNull default 0
  createdAt / updatedAt
  индексы: ..._org_idx; ..._map_idx(mapId); job_search_map_section_unique(mapId, sectionType)
```

#### `job_search_map_item` — элемент секции-списка

```
job_search_map_item                         (Drizzle: jobSearchMapItem)
  id              text pk uuid
  organizationId  text notNull FK organization cascade
  mapId           text notNull FK job_search_map cascade
  sectionId       text notNull FK job_search_map_section cascade
  value           text notNull              -- до 300 симв.
  normalizedValue text notNull              -- lower/trim/ё→е; для дедупа внутри секции
  note            text                      -- короткий комментарий ("так называют в банках")
  origin          search_map_origin notNull default 'manual'
  displayOrder    integer notNull default 0
  createdAt / updatedAt
  индексы: ..._org_idx; ..._section_idx(sectionId); job_search_map_item_unique(sectionId, normalizedValue)
```

#### `job_search_map_donor` — донор в карте

```
job_search_map_donor                        (Drizzle: jobSearchMapDonor)
  id               text pk uuid
  organizationId   text notNull FK organization cascade
  mapId            text notNull FK job_search_map cascade
  donorCompanyId   text notNull FK donor_company restrict
  layer            donor_layer notNull default 'core'
  priority         search_map_priority notNull default 'medium'
  hypothesisStatus hypothesis_status notNull default 'untested'
  rationale        text                      -- почему донор включён ("тот же стек, активно сокращают")
  resultNote       text                      -- что получилось при проверке
  statusChangedAt  timestamp
  statusChangedById text FK user set null
  origin           search_map_origin notNull default 'manual'
  displayOrder     integer notNull default 0
  createdAt / updatedAt
  индексы: ..._org_idx; ..._map_idx(mapId); ..._donor_idx(donorCompanyId);
           job_search_map_donor_unique(mapId, donorCompanyId)   -- донор в карте один раз (слой меняется, не дублируется)
```

#### `job_search_map_segment` — сегмент (гипотеза)

```
job_search_map_segment                      (Drizzle: jobSearchMapSegment)
  id                text pk uuid
  organizationId    text notNull FK organization cascade
  mapId             text notNull FK job_search_map cascade
  name              text notNull            -- автособирается, если не задано: "Ядро × Senior Backend × Москва × hh"
  donorLayer        donor_layer              -- nullable: сегмент может быть не про доноров
  donorIds          jsonb string[] default [] -- конкретные job_search_map_donor.id (подмножество слоя); пусто = весь слой
  titles            jsonb string[] default [] -- тайтлы/синонимы (копии значений, не ссылки — чтобы сегмент был самодостаточен в снапшоте)
  keywords          jsonb string[] default []
  geo               jsonb string[] default []
  channelId         text FK sourcing_channel set null
  queryString       text                      -- канал-специфичная строка запроса (для hh — язык поиска hh.ru)
  queryUrl          text                      -- собранный URL по urlTemplate канала (кэш, пересчитывается при изменении)
  priority          search_map_priority notNull default 'medium'
  poolEstimate      integer                   -- 1..3 (мало / средне / много), nullable
  responseLikelihood integer                  -- 1..3
  accessDifficulty  integer                   -- 1..3 (1 = легко достучаться)
  hypothesisStatus  hypothesis_status notNull default 'untested'
  rationale         text
  resultNote        text
  statusChangedAt   timestamp
  statusChangedById text FK user set null
  origin            search_map_origin notNull default 'manual'
  displayOrder      integer notNull default 0
  isArchived        boolean notNull default false
  createdAt / updatedAt
  индексы: ..._org_idx; ..._map_idx(mapId); ..._channel_idx(channelId); ..._status_idx(hypothesisStatus)
```

Правило: оценки `poolEstimate` × `responseLikelihood` × `accessDifficulty` используются только для сортировки и подсказки «рекомендуемый приоритет» (`score = pool + response + (4 - difficulty)`, 3..9). Приоритет выставляет человек.

#### `job_search_map_version` — иммутабельный снапшот

```
job_search_map_version                      (Drizzle: jobSearchMapVersion)
  id              text pk uuid
  organizationId  text notNull FK organization cascade
  mapId           text notNull FK job_search_map cascade
  versionNo       integer notNull            -- 1, 2, 3…
  label           text notNull               -- "v1 — черновик ИИ", "v2 — после калибровки с HM"
  trigger         search_map_version_trigger notNull
  snapshot        jsonb notNull              -- SearchMapSnapshot (§5.4)
  sourceHashes    jsonb notNull              -- хэши на момент снапшота
  diffSummary     jsonb                      -- { itemsAdded, itemsRemoved, donorsAdded, donorsRemoved, segmentsAdded, segmentsRemoved, segmentsStatusChanged } относительно предыдущей версии
  comment         text                       -- свободный комментарий автора версии
  createdById     text FK user set null
  createdAt       timestamp notNull defaultNow
  индексы: ..._org_idx; ..._map_idx(mapId); job_search_map_version_unique(mapId, versionNo)
```

Правила: `UPDATE`/`DELETE` на версиях нет (ни API, ни кода). Удаляются только каскадом с картой/вакансией.

#### Расширение существующей `hh_saved_search` (`app.ts:1692`)

```
  + searchMapSegmentId  text FK job_search_map_segment set null   -- 'search_map_segment_id'
  + index hh_saved_search_segment_idx(searchMapSegmentId)
```

Больше в hh-контуре ничего не меняется.

### 5.4. Формат снапшота `SearchMapSnapshot` (jsonb, Zod в `shared/schemas/searchMap.ts`)

```ts
{
  schemaVersion: 1,
  map: { id, templateId, templateVersion, status, summary },
  sections: [{ id, sectionType, title, displayOrder, items: [{ id, value, note, origin, displayOrder }] }],
  donors: [{ id, donorCompanyId, canonicalName /* денормализовано на момент снапшота */, layer, priority, hypothesisStatus, rationale, resultNote, origin }],
  segments: [{ id, name, donorLayer, donorIds, titles, keywords, geo, channelId, channelCode, queryString, priority, poolEstimate, responseLikelihood, accessDifficulty, hypothesisStatus, rationale, resultNote, origin, isArchived }],
  sources: { brief: {...jobBrief без id/timestamps} | null, criteria: [{ key, name, category, weight }], descriptionExcerpt: string /* первые 2000 симв. */ }
}
```

Снапшот самодостаточен: денормализованные имена доноров и код канала нужны, чтобы версия читалась после архивации донора или канала. Лимит размера — 1 МБ (проверка перед записью, иначе 422 «Карта слишком большая для снапшота»; практически недостижимо — 500 сегментов ≈ 300 КБ).

### 5.5. Системный шаблон «Универсальная карта» (сид)

| displayOrder | sectionType | title | isRequired | guidance (кратко) |
|---|---|---|---|---|
| 0 | `title_synonyms` | Тайтлы и синонимы | да | Как позицию называют в разных компаниях и сегментах рынка; добавьте англоязычные варианты |
| 1 | `keywords` | Ключевые слова и навыки | да | Технологии, инструменты, методологии, домены; то, что есть в резюме, а не в вакансии |
| 2 | `geo` | География | нет | Города, регионы, часовые пояса, релокация |
| 3 | `exclusions` | Исключения | нет | Компании, которые не трогаем (клиенты, партнёры, non-poach), тайтлы-ложные срабатывания |
| 4 | `notes` | Заметки и договорённости | нет | Калибровка с HM, что обсуждали, ограничения |

`generationGuidance` по умолчанию: «Слой core — прямые конкуренты и компании с такими же продуктами/процессами. Слой adjacent — смежные индустрии с тем же навыком. Слой school — компании, где навык массово выращивают (аутсорс, интеграторы, крупные корпорации с программами). Слой alumni — бывшие сотрудники компаний-ориентиров. Не предлагай компании из секции исключений.»

---

## 6. Поведение и бизнес-правила

### 6.1. Жизненный цикл карты

```
[нет карты] --POST /search-map (templateId?)--> draft (секции из шаблона, пусто)
   draft --пользователь принял черновик ИИ или заполнил руками--> остаётся draft
   draft --POST /versions (label, trigger)--> active, currentVersionNo = 1
   active --редактирование--> active (рабочая версия меняется без снапшота)
   active --изменились источники--> active + isStale = true (баннер)
   active --POST /versions--> active, currentVersionNo++
   active --PATCH status=archived--> archived (read-only; возврат в active разрешён)
```

- Карта создаётся **только явно** (кнопка «Создать карту» на пустой вкладке), не автоматически при создании вакансии. При отсутствии карты `GET` → 404 с `{ reason: 'not_created' }`, вкладка показывает empty-state с выбором шаблона.
- Карта у вакансии одна (`job_search_map_job_unique`). Повторный `POST` → 409.
- Удаление карты — физическое, только owner/admin (`manage_registry` не нужно; `edit` + подтверждение `useConfirm`), каскадом удаляются версии. `hh_saved_search.search_map_segment_id` обнуляется (`set null`), hh-поиски живут дальше.

### 6.2. Хэши источников и статус «устарела»

`server/utils/searchMap/sourceHashes.ts`:

```ts
computeSourceHashes(jobId, orgId): Promise<{ brief, criteria, description }>
```
- `brief` = sha256 от канонического JSON полей `jobBrief` (`hardMustHave`, `niceToHave`, `dealBreakers`, `redFlagsToWatch`, `responsibilities`, `teamContext`, `idealProfile`, `sourcingHints`, `freeform`), массивы отсортированы, строки trim. Нет брифа → `null`.
- `criteria` = sha256 от отсортированного по `key` массива `{ key, name, category, weight }`. Нет критериев → `null`.
- `description` = sha256 от `job.title + '\n' + (job.description ?? '')` после `trim` и схлопывания пробелов. (Если в будущем появятся `responsibilities`/`requirements` по `adr-job-description-sections.md` — каноническое `description` всё равно автособирается, менять функцию не придётся.)

`isStale` вычисляется на `GET /search-map`: `staleSources = keys where current[k] !== map.sourceHashes[k]` (с учётом `null`: появление брифа там, где его не было, — тоже изменение). Ответ содержит `isStale: boolean` и `staleSources: ('brief'|'criteria'|'description')[]`.

Хэши карты **обновляются** в двух случаях: при создании версии (`POST /versions`) и при явном действии «Отметить как актуальную» (`POST /search-map/acknowledge-sources`) — когда рекрутёр посмотрел изменения брифа и решил, что карта им не противоречит. Никаких автоматических обновлений.

### 6.3. Правила версий

| Действие | Создаёт версию? | trigger |
|---|---|---|
| Добавить/изменить/удалить элемент, донора, сегмент, статус | Нет | — |
| Кнопка «Сохранить версию» | Да | `manual` |
| Кнопка «Пересобрать по новому брифу» на баннере stale → генерация → принятие | Да (после принятия) | `sources_changed` |
| Принять полный черновик ИИ при первом создании | Да, автоматически (`label` = «v1 — черновик ИИ») | `ai_generated` |
| Кнопка «Зафиксировать после калибровки с HM» (та же форма, пресет лейбла) | Да | `calibration` |
| «Восстановить версию N» | Да: текущее содержимое заменяется снапшотом N, создаётся новая версия | `restore` |

Восстановление заменяет содержимое карты транзакционно: удаляются текущие items/donors/segments, вставляются из снапшота с **новыми id** (старые id в снапшоте сохраняются как `sourceId` только для диффа); `donorCompanyId` — по `id` реестра, если донор `archived`/`merged` — ссылка переводится на `mergedIntoId` или донор восстанавливается в `active` (с тостом). hh-поиски, привязанные к удалённым сегментам, получают `set null` — это **предупреждение в `useConfirm`** перед восстановлением: «N поисков hh потеряют привязку к сегментам».

### 6.4. Правила доноров

- Добавление донора в карту (`POST /donors`) принимает либо `donorCompanyId`, либо `{ name, aliases?, ...поля }`. Во втором случае сервер делает `resolveOrCreateDonor` (§9.1): нашёл — связывает; не нашёл — создаёт в реестре (`createdFromJobId = jobId`, `origin` в карте = `manual`/`ai`). Требует `searchMap:add_donor` для создания новой записи реестра; просто связать существующую — достаточно `edit`.
- Донор в карте уникален; смена слоя — `PATCH`, не второй экземпляр.
- Удаление донора из карты **не** удаляет его из реестра.
- Удаление донора из реестра запрещено, если он связан хотя бы с одной картой (409 с `usedInMaps: n`) — только архив или merge.
- Компании из секции `exclusions` при генерации передаются ИИ как запрет; при ручном добавлении донора, совпадающего с исключением (по `normalizeCompanyName`), показывается предупреждение (не блок).

### 6.5. Правила сегментов

- Все компоненты кортежа опциональны, но сегмент без единого заполненного компонента (`donorLayer`, `titles`, `keywords`, `geo`, `channelId`) → 400 «Сегмент должен содержать хотя бы один параметр поиска».
- `name` автособирается на сервере, если пустое: `[Слой] × [первые 2 тайтла] × [первое гео] × [канал]`; пропуски опускаются.
- `queryUrl` пересчитывается на сервере при изменении `queryString`/`channelId`: `urlTemplate.replace('{query}', encodeURIComponent(queryString))`, остальные плейсхолдеры — первые значения `titles`/`geo`. Нет `urlTemplate` → `null`.
- Смена `hypothesisStatus` пишет `statusChangedAt/ById`; переход в `rejected` требует непустой `resultNote` (400 иначе) — это и есть история «что отклонили и почему».
- Архивированные сегменты (`isArchived`) не показываются по умолчанию, попадают в снапшот с флагом.

### 6.6. Мост в hh-сорсинг (единственное изменение существующего контура)

1. `server/api/jobs/[id]/sourcing-searches/index.post.ts`: во все три варианта `bodySchema` добавляется `searchMapSegmentId: z.string().min(1).optional()`. Перед вставкой — проверка, что сегмент принадлежит карте этой вакансии и этой орг (иначе 404). Значение пишется в `hhSavedSearch.searchMapSegmentId`.
2. `server/api/sourcing-searches/[id].patch.ts`: разрешаем менять `searchMapSegmentId` (в т.ч. в `null`) с той же проверкой.
3. `GET /api/jobs/[id]/sourcing-searches` начинает возвращать `searchMapSegmentId` (поле уже будет в select `*`).
4. Во вкладке карты у сегмента с каналом `hh` — кнопка «Создать поиск hh»: открывает модал с предзаполненными `name` (= имя сегмента), `mode: 'manual'`, `query.text` (= `queryString`), `scheduleMinutes` по умолчанию, и вызывает существующий `POST`. Валидация строки — существующая `sourcingQuerySchema` + `normalizeHhQueryText`. После создания — ссылка на `jobs/[id]/sourcing?search=<id>`.
5. Если у сегмента канал не `hh` — кнопка «Открыть в канале» по `queryUrl` (новая вкладка) и «Скопировать строку».

Ничего в воркере, скоринге, `hh_sourcing_candidate` и `sourcing.vue` не меняется.

### 6.7. Статистика (детерминированно, без LLM)

`GET /api/jobs/[id]/search-map/stats` агрегирует по сегментам: `hhSearchesCount`, `candidatesFound` (count `hh_sourcing_candidate` через `hh_saved_search.search_map_segment_id`), `candidatesByState` (`new/reviewed/approved/imported/rejected/contacted`), `lastRunAt`. По карте: сегментов всего / по статусам, доноров по слоям и статусам. Для доноров реестра (`GET /api/search-map/donor-companies/[id]`): `usedInMaps`, `workingInMaps`, `rejectedInMaps` (по `job_search_map_donor.hypothesisStatus`). Это даёт первую org-аналитику «какие доноры работают по организации» без отдельного сервиса.

---

## 7. Права (RBAC)

Один ресурс `searchMap`. Изменения в `shared/permissions.ts` — **и** в `atsStatements`, **и** в raw-картах всех четырёх ролей (иначе роль не получит право, см. `tz-questions-90 §2.1`).

```ts
// atsStatements — после questionBank:
searchMap: ['view', 'edit', 'generate', 'add_donor', 'manage_versions', 'manage_registry'],
```

| Action | Что разрешает |
|---|---|
| `view` | Читать карту вакансии, версии, статистику; читать реестр доноров, каналы, шаблоны |
| `edit` | Создавать/править/удалять карту вакансии: секции-элементы, доноров в карте, сегменты, статусы, summary; `acknowledge-sources` |
| `generate` | Запускать AI-генерацию (все scope) |
| `add_donor` | Создавать новую запись в реестре доноров (из карты или напрямую) и дополнять алиасы |
| `manage_versions` | Создавать версии, восстанавливать версии |
| `manage_registry` | CRUD шаблонов и их секций, публикация, `isDefault`; редактирование/архив/merge доноров; CRUD каналов |

| Action | owner | admin | member (рекрутёр) | hiringManager |
|---|:--:|:--:|:--:|:--:|
| `view` | ✔ | ✔ | ✔ | ✔ (read-only) |
| `edit` | ✔ | ✔ | ✔ | — |
| `generate` | ✔ | ✔ | ✔ | — |
| `add_donor` | ✔ | ✔ | ✔ | — |
| `manage_versions` | ✔ | ✔ | ✔ | — |
| `manage_registry` | ✔ | ✔ | — | — |

```ts
// ownerAtsStatements, adminAtsStatements:
searchMap: ['view', 'edit', 'generate', 'add_donor', 'manage_versions', 'manage_registry'],
// memberAtsStatements:
searchMap: ['view', 'edit', 'generate', 'add_donor', 'manage_versions'],
// hiringManagerAtsStatements:
searchMap: ['view'],
```

Обязательные правила каждого эндпоинта (`tz-questions-90 §2.5`): `requirePermission(event, { searchMap: ['<action>'] })` → `activeOrganizationId` → `requireJobInScope` для job-эндпоинтов → каждый запрос с `eq(table.organizationId, orgId)`. Чужой/несуществующий ID → **404**, нет права → **403**. HM видит карту только по вакансиям, доступным ему через существующий job-scope (`requireJobInScope` уже учитывает HM-назначения).

Обновить сид ролей RBAC v2 и прогнать `access-seed-parity.test.ts`.

---

## 8. API

Базовые соглашения: Zod-валидация `getValidatedRouterParams` / `readValidatedBody`; ошибки по карте `tz-questions-90 §4a` (400 валидация, 401, 403, 404 IDOR/нет, 409 конфликт, 422 бизнес-предусловие, 429 rate-limit). Все ответы — plain JSON, camelCase.

### 8.1. Глобальный модуль — `server/api/search-map/`

| Метод и путь | Право | Назначение |
|---|---|---|
| `GET /api/search-map/templates` | view | Список шаблонов орг (`?status=`), с количеством секций и карт, созданных из шаблона |
| `POST /api/search-map/templates` | manage_registry | Создать шаблон (draft) с секциями; body `{ code?, name, description?, targetRoles?, generationGuidance?, defaultChannelCodes?, sections: [{ sectionType, title, guidance?, isRequired?, displayOrder }] }` |
| `GET /api/search-map/templates/[id]` | view | Шаблон с секциями |
| `PATCH /api/search-map/templates/[id]` | manage_registry | Правка полей и секций (полная замена массива `sections`, транзакционно) |
| `POST /api/search-map/templates/[id]/publish` | manage_registry | `status=published`, `version++`, `publishedAt/ById`. 422, если нет ни одной секции |
| `POST /api/search-map/templates/[id]/set-default` | manage_registry | Снять `isDefault` с прочих, поставить этому. Только `published` (422) |
| `POST /api/search-map/templates/[id]/archive` | manage_registry | Soft-архив. Архив дефолтного → 409 («назначьте другой шаблон по умолчанию») |
| `POST /api/search-map/templates/[id]/duplicate` | manage_registry | Копия в `draft` с суффиксом «(копия)» |
| `GET /api/search-map/donor-companies` | view | Список реестра: `?q=` (поиск по `normalizedName`/`normalizedAliases` ILIKE), `?status=`, `?tag=`, `?industry=`, `?sort=name|usage|createdAt`, пагинация `?limit=50&offset=` (по умолчанию 50, максимум 200). Ответ `{ items, total }`; в items — `usedInMaps` |
| `POST /api/search-map/donor-companies` | add_donor | Создать донора. 409 `{ existingId }` при совпадении `normalizedName` или алиаса |
| `POST /api/search-map/donor-companies/resolve` | view | Body `{ names: string[] }` → `{ resolved: [{ name, donorCompanyId|null, matchedBy: 'name'|'alias'|null }] }`. Без создания. Используется клиентом при принятии предложений ИИ |
| `GET /api/search-map/donor-companies/[id]` | view | Карточка + статистика использования (§6.7) + список карт/вакансий, где используется (title, layer, status) |
| `PATCH /api/search-map/donor-companies/[id]` | manage_registry (любые поля) / add_donor (только добавление в `aliases`) | Правка. При смене `canonicalName` — пересчёт `normalizedName`, проверка уникальности → 409 |
| `POST /api/search-map/donor-companies/[id]/archive` | manage_registry | Soft-архив. Если используется в активных картах — 200 с `warning` (не блок) |
| `POST /api/search-map/donor-companies/[id]/merge` | manage_registry | Body `{ intoId }`. Перенос связей, объединение алиасов, `status='merged'`, `mergedIntoId`. Транзакция. 409, если `intoId` сам `merged` |
| `DELETE /api/search-map/donor-companies/[id]` | manage_registry | Только если `usedInMaps = 0`, иначе 409 |
| `GET /api/search-map/channels` | view | Список каналов (сид системных при первом вызове) |
| `POST /api/search-map/channels` | manage_registry | Создать custom-канал; `code` автогенерируется `custom:<slug>` |
| `PATCH /api/search-map/channels/[id]` | manage_registry | Правка; у `isSystem` нельзя менять `code` |
| `DELETE /api/search-map/channels/[id]` | manage_registry | Только не системный и не используемый сегментами (иначе 409); системный — `isActive=false` через PATCH |
| `GET /api/search-map/overview` | view | Цифры для страницы «Обзор»: шаблонов, доноров (active), каналов, карт по статусам, топ-10 доноров по `workingInMaps` |

### 8.2. Локальный модуль — `server/api/jobs/[id]/search-map/`

| Метод и путь | Право | Назначение |
|---|---|---|
| `GET /api/jobs/[id]/search-map` | view | Вся карта одним ответом: `{ map, sections[{...items}], donors[{..., company:{canonicalName, industry, tags}}], segments[{..., channel:{code,name,urlTemplate}, hhSearchesCount}], isStale, staleSources, canGenerate: { hasBrief, hasCriteria, hasDescription, hasAiConfig }, versionsCount }`. 404 `{ reason: 'not_created', templates: [...published] }`, если карты нет |
| `POST /api/jobs/[id]/search-map` | edit | Создать карту: body `{ templateId? }` (по умолчанию `isDefault`; нет ни одного — сид системного). Копирует секции, фиксирует `sourceHashes`. 409, если уже есть |
| `PATCH /api/jobs/[id]/search-map` | edit | `{ summary?, status? }` (`draft/active/archived`) |
| `DELETE /api/jobs/[id]/search-map` | edit | Удалить карту с версиями; `useConfirm` на клиенте; в ответе `detachedHhSearches: n` |
| `POST /api/jobs/[id]/search-map/acknowledge-sources` | edit | Обновить `sourceHashes` до актуальных без версии (рекрутёр осознанно подтвердил актуальность) |
| `POST /api/jobs/[id]/search-map/sections/[sectionId]/items` | edit | Добавить элементы: `{ items: [{ value, note?, origin? }] }` (bulk — для принятия предложений ИИ). Дубли по `normalizedValue` молча пропускаются, в ответе `skipped: n` |
| `PATCH /api/jobs/[id]/search-map/items/[itemId]` | edit | `{ value?, note?, displayOrder? }`. Если `origin='ai'` и изменился `value` → `origin='manual'` |
| `DELETE /api/jobs/[id]/search-map/items/[itemId]` | edit | — |
| `PUT /api/jobs/[id]/search-map/sections/[sectionId]/reorder` | edit | `{ itemIds: string[] }` (образец `questions/reorder.put.ts`) |
| `POST /api/jobs/[id]/search-map/donors` | edit (+ add_donor, если создаётся новая запись реестра) | `{ donors: [{ donorCompanyId? , name?, aliases?, industry?, techStack?, layer, priority?, rationale?, origin? }] }` bulk. Ответ `{ added, linkedExisting, createdInRegistry, skippedDuplicates }` |
| `PATCH /api/jobs/[id]/search-map/donors/[donorId]` | edit | `{ layer?, priority?, hypothesisStatus?, rationale?, resultNote?, displayOrder? }`; `rejected` требует `resultNote` |
| `DELETE /api/jobs/[id]/search-map/donors/[donorId]` | edit | Удалить из карты (реестр не трогается) |
| `POST /api/jobs/[id]/search-map/segments` | edit | `{ segments: [SegmentInput] }` bulk. Валидация «хотя бы один параметр» |
| `PATCH /api/jobs/[id]/search-map/segments/[segmentId]` | edit | Любые поля сегмента; пересчёт `name` (если пустое) и `queryUrl`; `rejected` требует `resultNote`; `origin` ai→manual при правке содержательных полей |
| `DELETE /api/jobs/[id]/search-map/segments/[segmentId]` | edit | Физическое удаление. Если есть привязанные `hh_saved_search` → 409 `{ hhSearches: n }` с подсказкой «архивируйте сегмент» |
| `POST /api/jobs/[id]/search-map/segments/[segmentId]/archive` | edit | `isArchived=true` (hh-поиски сохраняют связь) |
| `PUT /api/jobs/[id]/search-map/segments/reorder` | edit | `{ segmentIds }` |
| `GET /api/jobs/[id]/search-map/versions` | view | `[{ id, versionNo, label, trigger, comment, diffSummary, createdAt, createdBy:{name} }]` без снапшотов |
| `POST /api/jobs/[id]/search-map/versions` | manage_versions | `{ label, trigger: 'manual'|'calibration'|'sources_changed', comment? }` → строит снапшот, считает `diffSummary` относительно предыдущей, обновляет `sourceHashes`, `currentVersionNo++`, `status='active'`, если был `draft` |
| `GET /api/jobs/[id]/search-map/versions/[versionId]` | view | Версия со снапшотом |
| `GET /api/jobs/[id]/search-map/versions/[versionId]/diff?against=<versionId|current>` | view | Детальный дифф (§9.3): добавлено/удалено/изменено по items, donors, segments, изменения статусов |
| `POST /api/jobs/[id]/search-map/versions/[versionId]/restore` | manage_versions | Заменить текущее содержимое снапшотом и создать версию `trigger='restore'`, `label` = «vN — восстановлено из vK». Ответ содержит `detachedHhSearches` |
| `GET /api/jobs/[id]/search-map/stats` | view | §6.7 |
| `POST /api/jobs/[id]/search-map/generate` | generate | §10. Rate-limit 10/мин на орг. **Не персистит** |
| `GET /api/jobs/[id]/search-map/export?format=md` | view | Markdown-экспорт текущей карты (для отправки HM в мессенджер). Без LLM |

### 8.3. Изменения существующих эндпоинтов

| Файл | Изменение |
|---|---|
| `server/api/jobs/[id]/sourcing-searches/index.post.ts` | `+ searchMapSegmentId?` в трёх вариантах `bodySchema`; проверка принадлежности сегмента вакансии; запись в колонку |
| `server/api/sourcing-searches/[id].patch.ts` | `+ searchMapSegmentId?: string | null` с той же проверкой |
| `server/utils/access/scope.ts` | `+ requireSearchMapInScope(event, mapId, orgId)`, `+ requireDonorCompanyInScope(event, donorId, orgId)`, `+ requireSearchMapTemplateInScope(...)` — по образцу `requireSourcingSearchInScope` (:275), 404 |

### 8.4. Zod-схемы — `shared/schemas/searchMap.ts`

Единый файл, импортируется сервером и клиентом (как `generateCriteriaSchema`): `templateInputSchema`, `templateSectionInputSchema`, `donorCompanyInputSchema` (`sizeBand`, `stage` — `z.enum`), `mapDonorInputSchema`, `segmentInputSchema` (с `.refine` «хотя бы один параметр»; `poolEstimate/responseLikelihood/accessDifficulty` — `z.number().int().min(1).max(3).nullable()`), `versionInputSchema`, `generateInputSchema` (§10.2), `searchMapSnapshotSchema` (§5.4), `generateResultSchema` (§10.3).

---

## 9. Детерминированные утилиты — `server/utils/searchMap/`

### 9.1. `normalizeCompanyName(raw: string): string`

Файл `server/utils/searchMap/normalizeCompanyName.ts`, unit-тест обязателен.

Шаги: `trim` → NFKC → lower → `ё→е` → убрать кавычки всех видов (`"«»“”'`) → убрать организационно-правовые формы в начале/конце как отдельные токены (`ооо`, `оао`, `зао`, `пао`, `ао`, `ип`, `нко`, `гк`, `llc`, `inc`, `ltd`, `gmbh`, `corp`, `co`, `group`, `holding`, `групп`, `холдинг` — список константой, расширяемый) → убрать пунктуацию кроме `&+.-` внутри слова → схлопнуть пробелы. Примеры из теста: `ООО «Яндекс»` → `яндекс`; `Yandex LLC` → `yandex`; `Сбер` ≠ `Сбербанк` (не делаем стемминг — это задача алиасов); `T-Bank` → `t-bank`.

`resolveOrCreateDonor(orgId, input, ctx)`: 1) `normalizedName` точное → 2) вхождение в `normalizedAliases` (`@>`) → 3) создать. Возвращает `{ donor, matchedBy: 'name'|'alias'|'created' }`.

### 9.2. `computeSourceHashes` — §6.2.

### 9.3. `buildSnapshot(mapId)` и `diffSnapshots(a, b)`

- `buildSnapshot` — одна транзакция чтения; денормализация имён доноров и кодов каналов.
- `diffSnapshots` сопоставляет сущности по `id` (после `restore` — по `sourceId`), для items — дополнительно по `(sectionType, normalizedValue)`, для donors — по `donorCompanyId`, для segments — по `id`. Результат: `{ items: {added[], removed[]}, donors: {added[], removed[], changed[{id, fields}]}, segments: {added[], removed[], changed[{id, fields}], statusChanged[{id, from, to}]} }`. `diffSummary` версии = счётчики из этого результата.

### 9.4. `buildSegmentName`, `buildQueryUrl` — §6.5.

### 9.5. `exportMarkdown(snapshot)` — для `GET /export`: заголовок с вакансией и версией, секции списками, доноры таблицей по слоям, сегменты таблицей со статусами.

---

## 10. AI-генерация

### 10.1. Принципы

- Единственный эндпоинт `POST /api/jobs/[id]/search-map/generate`; **ничего не сохраняет** — возвращает предложения; клиент показывает панель «Предложения ИИ» с чекбоксами; принятие = обычные bulk-`POST` в items/donors/segments с `origin: 'ai'`.
- Конфиг — `loadAiConfig(orgId, { purpose: 'analysis' })`; нет конфига → 422 «Поставщик ИИ не настроен…» (текст из `criteria/generate.post.ts`).
- Нет ни брифа, ни критериев, ни описания → 422 «Для генерации нужен бриф, критерии или описание вакансии».
- Вызов — `generateStructuredOutput` с Zod-схемой результата, `temperature: 0.4` (вариативность нужна), `wrapBareArray` на случай голого массива; `.catch().default()`-гарды на каждом поле (`tz-questions-90 §6.2`).
- ИИ **всегда получает текущее содержимое карты** (items, доноры, сегменты, исключения) и инструкцию не дублировать. Дедуп дополнительно делается детерминированно на сервере перед ответом (`normalizeCompanyName`, `normalizedValue`).
- Для доноров сервер прогоняет предложенные имена через `resolve` и возвращает `donorCompanyId`, если компания уже в реестре (клиент покажет бейдж «в реестре»).
- Rate-limit: `createRateLimiter({ windowMs: 60_000, maxRequests: 10 })` на орг. Таймаут LLM — 90 с; при ошибке — 502 с нейтральным текстом, карта не меняется (graceful degradation: пользователь продолжает руками).

### 10.2. Вход — `generateInputSchema`

```ts
{
  scope: 'full' | 'section' | 'donors' | 'segments' | 'query_string' | 'summary',
  mode: 'fill_empty' | 'append',          // fill_empty — только пустые секции/слои; append — добавить к имеющемуся
  sectionId?: string,                     // для scope='section'
  layer?: DonorLayer,                     // для scope='donors' (если не задан — по всем слоям)
  segmentId?: string,                     // для scope='query_string'
  count?: number (1..30, default: full — по правилам ниже; donors — 10; section — 10; segments — 6),
  hint?: string (до 500)                  // свободная подсказка рекрутёра: "фокус на финтех", "без госкомпаний"
}
```

### 10.3. Выход — `generateResultSchema`

```ts
{
  scope, model: string,
  summary?: string,                                   // scope full|summary
  sections?: [{ sectionType, items: [{ value, note? }] }],
  donors?:   [{ name, layer, priority, rationale, industry?, techStack?, donorCompanyId: string|null, matchedBy }],
  segments?: [{ name, donorLayer?, titles, keywords, geo, channelCode, queryString?, priority, poolEstimate?, responseLikelihood?, accessDifficulty?, rationale }],
  queryString?: { segmentId, channelCode, queryString, explanation },
  warnings: string[]                                  // "предложено 12 доноров, 3 отфильтрованы как дубли/исключения"
}
```

### 10.4. Контекст промпта (собирается `buildGenerationContext(jobId)`)

1. Вакансия: `title`, `location`, `experienceLevel`, `description` (до 6000 симв.).
2. Бриф: все поля `jobBrief`, особенно `idealProfile`, `sourcingHints`, `hardMustHave`, `dealBreakers`.
3. Критерии: `name`, `description`, `weight` (веса → подсказка приоритетов).
4. Шаблон: `generationGuidance`, список секций с `guidance`.
5. Текущая карта: items по секциям, доноры (имя, слой, статус — `rejected` передаём как «не предлагать»), сегменты (кратко), секция `exclusions` как жёсткий запрет.
6. Каналы орг: `code`, `name`, `queryLanguageHint` (для `query_string` и `segments`).
7. Подсказки из реестра: до 30 доноров орг с совпадающими `industry`/`techStack`/`tags` (детерминированный выбор по пересечению тегов с ключевыми словами карты) — чтобы ИИ использовал канонические имена и уже накопленное знание.
8. `hint` пользователя.

### 10.5. Промпты — `server/utils/ai/searchMap/prompts.ts`

| Константа | Назначение | Правила в системном промпте |
|---|---|---|
| `SEARCH_MAP_SYSTEM` | Роль: senior-сорсер, строит карту поиска под вакансию | Отвечать только JSON по схеме; язык — русский, тайтлы и ключевые слова дублировать по-английски, где это принято на рынке; не выдумывать компании — только реально существующие на рынке РФ/СНГ/глобально по контексту вакансии; каждому донору — одна причина включения; не предлагать компании из исключений и `rejected` |
| `PROMPT_FULL` | Черновик карты: секции + доноры по слоям (core 6–10, adjacent 5–8, school 3–6, alumni 0–4) + 4–8 сегментов с приоритетами + summary | Сначала тайтлы и ключевые слова, потом доноры, потом сегменты из них |
| `PROMPT_SECTION` | Дополнить одну секцию N элементами | Учитывать уже имеющиеся |
| `PROMPT_DONORS` | N доноров в указанный слой / по всем слоям | Объяснять слой |
| `PROMPT_SEGMENTS` | Собрать N сегментов из имеющихся секций/доноров/каналов | Не дублировать существующие кортежи |
| `PROMPT_QUERY_STRING` | Строка запроса под сегмент для канала | Для `hh` — язык поиска hh.ru (переиспользовать описание синтаксиса из `aiQuery.ts`: AND/OR/NOT, кавычки, скобки, `*`); для LinkedIn/GitHub — boolean-синтаксис канала; вернуть `explanation` |
| `PROMPT_SUMMARY` | 1–3 абзаца резюме стратегии для HM | Без оценочных суждений о кандидатах |

Промпты тестируются через существующую `promptSandbox` (`app.ts:3538`) до релиза; это ручной шаг DoD, не код.

### 10.6. Поведение UI при генерации

- Пустая карта + есть источники → мягкий баннер в шапке: «Собрать черновик по брифу» (кнопка) / «Заполню вручную» (скрыть до перезагрузки). Не модалка.
- Любая секция/слой/сегмент имеет кнопку «Предложить ещё» (`scope: section|donors|segments`, `mode: append`).
- Сегмент без `queryString` — кнопка «Собрать строку» (`scope: query_string`).
- Панель предложений — `UiDrawer` справа: список с чекбоксами (все отмечены), бейджи «в реестре»/«новая компания», «дубль отфильтрован» в `warnings`; кнопки «Принять выбранное» / «Отклонить». Принятие полного черновика на карте без версий автоматически создаёт v1 (`trigger='ai_generated'`).
- Во время генерации — скелетон и `Loader2`, отмена через `AbortController` (сервер не прерывает LLM, но результат отбрасывается).

---

## 11. UI

### 11.1. Глобальный модуль — `Настройки → Карта поиска`

- `SettingsSidebar.vue` (и `SettingsMobileNav.vue`): после «Банк вопросов» — `{ label: 'Карта поиска', description: 'Шаблоны, компании-доноры, каналы', to: '/dashboard/settings/search-map', icon: Map, exact: false }`; виден при `searchMap:['view']`.
- Обёртка `app/pages/dashboard/settings/search-map.vue` (копия паттерна `question-bank.vue`): заголовок + `subNav` + `<NuxtPage>`. Подстраницы в `app/pages/dashboard/settings/search-map/`:

| Страница | Содержимое |
|---|---|
| `index.vue` — Обзор | Карточки-цифры из `/overview`; топ-10 доноров по «работает»; ссылки на подразделы; подсказка «как устроена карта» |
| `templates.vue` — Шаблоны | Список (`UiCard`), статус-бейджи, `isDefault`; `UiDrawer` редактора: поля шаблона + список секций с drag-порядком (`sectionType` из enum, title, guidance, isRequired) + `UiTextarea` для `generationGuidance`; кнопки Опубликовать / По умолчанию / Дублировать / Архив. Для member — read-only |
| `donor-companies.vue` — Компании-доноры | Таблица с поиском (`q`), фильтрами (статус, индустрия, тег), сортировкой (имя / использование), пагинацией; строка: имя, алиасы (бейджи), индустрия, стек, `usedInMaps`, `workingInMaps`; `UiDrawer` карточки: поля + «Где используется» (вакансия → слой → статус) + действия Архив / Объединить (модал выбора цели с поиском); кнопка «Добавить компанию»; member видит, может добавлять, не редактирует чужое |
| `channels.vue` — Каналы | Список каналов: название, код, приоритет, `urlTemplate`, активность; системные — замок на `code`; «Добавить канал» |

### 11.2. Локальный модуль — вкладка вакансии

- `AppTopBar.vue` `jobTabs`: после `brief` — `{ label: t('dashboard.jobs.tabs.searchMap'), to: \`${base}/search-map\`, icon: Map, exact: true }`.
- Страница `app/pages/dashboard/jobs/[id]/search-map.vue` (`layout: 'dashboard'`, `middleware: ['auth','require-org']`), данные — `useJobSearchMap(jobId)`.

Структура экрана (desktop; на мобильном — колонки стекаются):

```
┌ SearchMapHeader ──────────────────────────────────────────────────────────────┐
│ Карта поиска · v2 «после калибровки с HM» · [draft/active]  [Предложить черновик] │
│ [Сохранить версию ▾] [История] [Статистика] [Экспорт .md] [⋯ Архив/Удалить]      │
├ StaleBanner (если isStale) ──────────────────────────────────────────────────┤
│ ⚠ Изменились: бриф, критерии (с 02.10). [Пересобрать по новому брифу] [Актуально] │
├ AiSuggestBanner (если карта пустая и canGenerate) ───────────────────────────┤
├───────────────────────┬───────────────────────────────────────────────────────┤
│ Секции (левая колонка)│ Компании-доноры по слоям (DonorLayerBoard)             │
│  Тайтлы и синонимы    │  [Ядро 8] [Смежный круг 5] [Школы 3] [Alumni 2] [Своё] │
│  Ключевые слова       │  карточка донора: имя · приоритет · статус · причина   │
│  География            │  [+ Добавить компанию] [✨ Предложить ещё]               │
│  Исключения           │                                                        │
│  Заметки              │                                                        │
│  (SectionListEditor:  ├────────────────────────────────────────────────────────┤
│   инлайн-добавление,  │ Сегменты (SegmentTable)                                 │
│   drag, бейдж ai,     │  фильтр по статусу/каналу/слою · сортировка по приоритету│
│   ✨ Предложить ещё)   │  строка: имя · слой · тайтлы · гео · канал · приоритет · │
│                       │  статус · hh-поиски (n) · кандидаты (n)                 │
│                       │  [+ Сегмент] [✨ Предложить сегменты]                    │
└───────────────────────┴────────────────────────────────────────────────────────┘
```

Компоненты `app/components/searchMap/`:

| Компонент | Назначение |
|---|---|
| `SearchMapHeader.vue` | Заголовок, бейджи версии/статуса, действия |
| `StaleBanner.vue` | Баннер устаревания с перечнем источников и двумя действиями |
| `AiSuggestBanner.vue` | Мягкое предложение черновика |
| `SectionListEditor.vue` | Список элементов секции: инлайн `UiInput` для добавления (Enter — добавить, вставка из буфера по строкам — bulk), drag-reorder, бейдж `ai`, редактирование по клику, `guidance` в пустом состоянии |
| `DonorLayerBoard.vue` | Колонки по слоям (`UiSegmented` переключение «колонки / список» на узких экранах), карточки `DonorCard.vue`; drag между слоями = `PATCH layer` |
| `DonorCard.vue` | Имя, индустрия, приоритет (`UiBadge`), статус (`HypothesisStatusBadge`), причина; клик — `DonorDrawer` |
| `DonorDrawer.vue` | Правка слоя/приоритета/статуса/причины/результата; ссылка в реестр; «Удалить из карты» |
| `DonorCompanyPicker.vue` | Поиск по реестру с автодополнением (`/donor-companies?q=`), при отсутствии — «Создать «…» в реестре» (требует `add_donor`), выбор слоя; множественное добавление |
| `SegmentTable.vue` | Таблица сегментов с фильтрами; клик — `SegmentDrawer` |
| `SegmentDrawer.vue` | Форма кортежа: слой (`UiSelect`), доноры (мультивыбор из карты), тайтлы/ключевые слова/гео (чипы с подсказками из секций карты), канал, строка запроса (`UiTextarea` + «✨ Собрать строку» + «Скопировать» + «Открыть в канале»), оценки 1–3 (`UiSegmented`), рекомендуемый приоритет, статус + результат; для канала `hh` — «Создать поиск hh» (`CreateHhSearchModal`) и список связанных hh-поисков со статусом последнего запуска |
| `HypothesisStatusBadge.vue` | Цвета: untested — surface, in_progress — info, working — success, rejected — danger |
| `AiProposalDrawer.vue` | Панель предложений (§10.6) |
| `VersionHistoryDrawer.vue` | Список версий, `diffSummary` бейджами, «Сравнить с текущей», «Восстановить» (с `useConfirm` и предупреждением об hh-привязках) |
| `VersionDiffView.vue` | Три блока (секции / доноры / сегменты) с подсветкой added/removed/changed |
| `CreateVersionModal.vue` | `label` (пресеты: «Черновик», «После калибровки с HM», «Пересборка по брифу»), `trigger`, `comment` |
| `CreateHhSearchModal.vue` | Предзаполнение из сегмента → существующий `POST /sourcing-searches` |
| `SearchMapStatsPanel.vue` | Сегменты по статусам, доноры по слоям, кандидаты по сегментам (из `/stats`) |
| `SearchMapEmptyState.vue` | Нет карты: выбор шаблона (`isDefault` предвыбран), «Создать карту» |

Composables `app/composables/`: `useJobSearchMap(jobId)` (загрузка, оптимистичные правки, `refresh`), `useSearchMapGenerate(jobId)` (вызов, отмена, состояние), `useDonorCompanies()` (поиск/пагинация/resolve), `useSearchMapTemplates()`, `useSourcingChannels()`.

Права на клиенте — `usePermission({ searchMap: ['edit'] })` и т.д.: HM видит всё read-only (скрыты кнопки добавления, drag отключён, статусы — только чтение).

UX-детали:
- Все правки сохраняются сразу (без «Сохранить» на форме), тост при ошибке и откат оптимистичного состояния.
- Удаление и восстановление — только через `useConfirm`.
- Пустые секции показывают `guidance` из шаблона серым текстом.
- Клавиатура в `SectionListEditor`: Enter — добавить, Esc — отмена, вставка многострочного текста — bulk-добавление с предпросмотром количества.
- Статус-бейджи и приоритеты — одинаковые компоненты у доноров и сегментов.

### 11.3. Доступ HM

HM видит вкладку при `searchMap:view` и доступе к вакансии. Для HM дополнительно показывается блок «Что изменилось с вашего брифа» — это тот же `StaleBanner` в read-only формулировке («Карта зафиксирована под бриф от 28.09; бриф обновлён 02.10 — рекрутёр ещё не пересобрал карту»).

---

## 12. i18n

Единственная локаль `i18n/locales/ru.json`. Блоки:
- `dashboard.jobs.tabs.searchMap: "Карта поиска"`.
- `dashboard.searchMap.*`: `title`, `empty.*`, `header.*`, `stale.*`, `sections.types.{title_synonyms,keywords,geo,exclusions,notes}`, `donors.layers.{core: "Ядро", adjacent: "Смежный круг", school: "Школы компетенций", alumni: "Alumni", custom: "Своё"}`, `hypothesis.{untested: "Не проверена", in_progress: "В работе", working: "Работает", rejected: "Отклонена"}`, `priority.{high,medium,low}`, `segments.*`, `versions.*`, `ai.*`, `stats.*`, `errors.*`.
- `dashboard.settings.searchMap.*`: `nav`, `overview`, `templates`, `donorCompanies`, `channels`, формы и подтверждения.
- Все серверные `statusMessage` — по-русски, нейтральные (как в `criteria/generate.post.ts`).

---

## 13. Миграция, сид, конфиг

### 13.1. `0118_search_map.sql` (idx 117 в `_journal.json`)

Содержимое (порядок): 9 enum (§5.1) с идемпотентными гардами (`tz-questions-90 §7.3`) → `search_map_template`, `search_map_template_section`, `donor_company`, `sourcing_channel` → `job_search_map`, `job_search_map_section`, `job_search_map_item`, `job_search_map_donor`, `job_search_map_segment`, `job_search_map_version` → `ALTER TABLE hh_saved_search ADD COLUMN IF NOT EXISTS search_map_segment_id text REFERENCES job_search_map_segment(id) ON DELETE SET NULL` + индекс. Все `CREATE TABLE IF NOT EXISTS`, `--> statement-breakpoint` между операторами. Реэкспорт — автоматически через `export * from './app'`.

Миграция данных не требуется (новый модуль). Откат — отдельный `down`-скрипт не нужен по конвенции проекта; при необходимости колонка `search_map_segment_id` дропается независимо.

### 13.2. Сид (ленивый, в коде, идемпотентный)

`server/utils/searchMap/seed.ts`: `ensureSystemChannels(orgId)` и `ensureDefaultTemplate(orgId)` — вызываются из `GET /channels`, `GET /templates`, `POST /search-map`, `GET /overview`. Проверка существования по `code` (`hh`… / `SM-DEFAULT`) в транзакции с `ON CONFLICT DO NOTHING`. Для существующих организаций ничего не делается до первого обращения к модулю.

### 13.3. Фича-флаг

`NUXT_PUBLIC_SEARCH_MAP_ENABLED` (default `true` в dev, `false` в prod до завершения S3). Флаг скрывает вкладку и раздел настроек; API доступен (чтобы тесты и e2e работали). Снять флаг после S4.

---

## 14. Порядок поставки (спринты)

Каждый спринт деплоится независимо и не ломает существующий контур (hh-сорсинг, скоринг, вопросы).

| Спринт | Содержание | Выход для пользователя |
|---|---|---|
| **S0 · База** (малый) | Ресурс прав `searchMap` в `permissions.ts` + сид ролей + parity-тест; `normalizeCompanyName` + тест; Zod-схемы `shared/schemas/searchMap.ts`; миграция `0118_search_map` целиком (все таблицы сразу, чтобы не плодить миграции); scope-гуарды; фича-флаг; i18n-каркас | Ничего видимого; чистая база |
| **S1 · Глобальный модуль** | API `search-map/{templates, donor-companies, channels, overview}`; сид системного шаблона и каналов; настройки `search-map/{index, templates, donor-companies, channels}`; `SettingsSidebar` | HR-лид настраивает шаблон, ведёт реестр доноров и каналы |
| **S2 · Карта вакансии (ручной режим)** | API `jobs/[id]/search-map/*` без `generate` и `versions`; вкладка, `SectionListEditor`, `DonorLayerBoard`, `DonorCompanyPicker` (с созданием в реестре), `SegmentTable/Drawer`, статусы гипотез; мост в hh (`searchMapSegmentId` в `index.post.ts`/`[id].patch.ts`, `CreateHhSearchModal`); `stats`; `export.md` | Рекрутёр ведёт карту руками, создаёт hh-поиски из сегментов, копит доноров |
| **S3 · Версии и stale** | `computeSourceHashes`, `buildSnapshot`, `diffSnapshots`; API `versions/*`, `acknowledge-sources`; `StaleBanner`, `VersionHistoryDrawer`, `VersionDiffView`, `CreateVersionModal`, `restore` | История гипотез, привязка к брифу, ответ HM «почему ищем здесь» |
| **S4 · ИИ-генерация** | `generate.post.ts` со всеми scope; промпты; `buildGenerationContext`; `AiSuggestBanner`, `AiProposalDrawer`, кнопки «Предложить ещё»/«Собрать строку»; авто-v1 при принятии полного черновика; тест промптов в `promptSandbox`; снятие фича-флага | Черновик карты за минуту, догенерация по секциям |
| **S5 · Полировка и аналитика** (опц.) | Карточка донора «где используется» с переходами; топ-доноров на Обзоре; импорт доноров CSV; подсказка «кандидат из компании X — добавить в доноры?» в карточке кандидата (только предложение, без автозаписи) | Накопление знания становится заметным |

Зависимости: `S0 → S1 → S2 → S3 → S4 → S5`. S1 и S2 можно вести параллельно двумя исполнителями после S0 (S2 использует `donor-companies/resolve` и `channels` из S1 — договориться о контрактах §8.1 заранее).

---

## 15. Тестирование

Уровни — по `tz-questions-90 §10`.

**Unit (`vitest`):**
- `normalizeCompanyName` — таблица из ≥ 20 кейсов (ООО/кавычки/латиница/ё/дефисы/лишние пробелы; негатив — `Сбер` ≠ `Сбербанк`).
- `computeSourceHashes` — стабильность (порядок массивов, пробелы), чувствительность (изменение одного элемента `hardMustHave`), `null` при отсутствии брифа.
- `buildSegmentName`, `buildQueryUrl` (плейсхолдеры, encode, отсутствие шаблона).
- `diffSnapshots` — added/removed/changed/statusChanged, сопоставление по `sourceId` после restore.
- `exportMarkdown` — snapshot-тест.
- Zod: `segmentInputSchema` «хотя бы один параметр», `rejected` без `resultNote`.

**API (интеграционные, с тестовой БД):**
- Матрица прав по всем action × 4 роли (403), IDOR на чужой орг → 404 для map/donor/template/channel/version.
- Изоляция тенантов: донор орг A не резолвится в орг B; `GET /donor-companies?q=` не видит чужих.
- `POST /search-map` дважды → 409; создание из `isDefault`; сид шаблона/каналов при отсутствии (идемпотентность при параллельных вызовах).
- Донор: 409 с `existingId` при дубле; `merge` переносит связи и алиасы; `DELETE` используемого → 409.
- Сегмент: удаление с hh-привязкой → 409, архив — 200; `PATCH` ai→manual.
- Версии: создание фиксирует хэши и `diffSummary`; версии неизменяемы (нет роутов PATCH/DELETE — проверка 404/405); `restore` создаёт новую версию, `detachedHhSearches` корректен; `isStale` после `PUT /brief`.
- Мост hh: `POST /sourcing-searches` с чужим `searchMapSegmentId` → 404; с валидным — колонка заполнена; `GET /stats` считает кандидатов через связь.
- `generate`: 422 без AI-конфига; 422 без источников; 429 по лимиту; при мок-LLM — дедуп доноров против карты и исключений, `donorCompanyId` проставлен для известных.

**E2E (Playwright, 1 сценарий «золотой путь»):** создать вакансию с брифом → вкладка «Карта поиска» → создать карту из шаблона → добавить 2 тайтла, 1 донора (новая компания → появилась в реестре), 1 сегмент hh → «Сохранить версию» → изменить бриф → баннер stale → «Актуально» → баннер исчез → HM (вторая сессия) видит карту read-only.

**Паритет сида ролей:** `access-seed-parity.test.ts` зелёный после добавления `searchMap`.

---

## 16. Нефункциональные требования

| Область | Требование |
|---|---|
| Производительность | `GET /jobs/[id]/search-map` — ≤ 4 запроса к БД (карта+секции+items одним join, доноры с company, сегменты с channel и подсчётом hh), p95 < 300 мс при 200 сегментах / 100 донорах / 300 items. `GET /donor-companies` — всегда с пагинацией, индекс по `normalizedName` и GIN по алиасам |
| Размер данных | Снапшот ≤ 1 МБ (422 иначе); `generationGuidance` ≤ 4000; `queryString` ≤ 2000 (совместимо с hh `text`) |
| LLM | Таймаут 90 с; rate-limit 10/мин/орг; один вызов на запрос `generate` (без цепочек) |
| Надёжность | Все multi-row операции (создание карты, bulk-добавления, версия, restore, merge) — в транзакции |
| Безопасность | Org-scoping в каждом запросе; IDOR → 404; `queryUrl` строится только из `urlTemplate` орг (не из пользовательского ввода URL); экспорт Markdown экранирует `|` и переносы |
| Аудит | Запись в `activity_log` (существующий паттерн) на: создание/удаление карты, создание версии, restore, merge доноров, смену статуса гипотезы на `rejected`/`working` |
| Доступность | Вся вкладка работает с клавиатуры; drag имеет альтернативу «вверх/вниз» в меню элемента |
| Тёмная тема | Автоматически через токены design-system |

---

## 17. Риски и митигации

| # | Риск | Митигация |
|---|---|---|
| 1 | Размножение доноров-дублей («Яндекс»/«Yandex») обесценивает реестр | `normalizedName` unique + алиасы + `resolve` перед любым созданием + `merge` в S1; ИИ получает канонические имена из реестра |
| 2 | Галлюцинированные компании от ИИ | Промпт «только реальные компании», `rationale` обязателен, предложения не персистятся без принятия, бейдж «новая компания» виден |
| 3 | Карта без баннера stale хуже отсутствия карты | `isStale` — часть `GET` с первого релиза S3; баннер — DoD S3 |
| 4 | Путаница «Карта поиска» ↔ «Сорсинг hh» у пользователей | Разная семантика во вкладках и i18n: карта = стратегия, сорсинг = запуск поисков; из сегмента ведёт явная кнопка «Создать поиск hh» |
| 5 | Over-engineering (отдельная методология, маркетплейс шаблонов, парсинг рынка) | Вне scope §18; промпты в коде, подсказки — одно текстовое поле |
| 6 | Snapshot/restore ломает hh-привязки | Архив вместо удаления сегментов; явное предупреждение `detachedHhSearches` до restore |
| 7 | Расхождение Drizzle-alias и БД-имён | Таблица §5.1 — источник правды; сверка перед `drizzle-kit generate` |
| 8 | Член команды без `add_donor` не сможет накапливать реестр | `add_donor` дан member по умолчанию (§7) |

---

## 18. Вне scope (первая версия)

- Автоматическое извлечение доноров из работодателей кандидатов (`candidate.hhResumeRaw`) — только подсказка в S5, без автозаписи.
- Исполнители каналов кроме hh (LinkedIn/GitHub/Telegram-парсинг) — карта даёт строку и URL, запуск — руками.
- Внешние данные о размере пула (API hh «сколько резюме по запросу») — оценка 1–3 вручную/ИИ.
- Межорганизационный обмен реестрами доноров, публичные шаблоны.
- Редактируемая методология в БД (как CARE), workflow согласования карты с HM (комментарии/approve) — рассмотреть после S4 на реальном использовании.
- Автоматическое создание карты при создании вакансии.
- Удаление/редактирование версий.

---

## 19. Definition of Done (общий чеклист модуля)

- [ ] Ресурс `searchMap` в `atsStatements` и всех raw-картах ролей; `access-seed-parity.test.ts` зелёный.
- [ ] Миграция `0118_search_map` идемпотентна, имена по §5.1, `_journal.json` обновлён.
- [ ] Каждый эндпоинт: `requirePermission` → org-scope → 404 на чужой ID; покрыт тестом матрицы прав.
- [ ] hh-контур не изменён, кроме `searchMapSegmentId` (колонка + body-поле); существующие тесты сорсинга зелёные.
- [ ] Карта создаётся из шаблона, правится руками, из сегмента создаётся hh-поиск, статистика считает кандидатов по сегментам.
- [ ] Версии иммутабельны; `isStale` корректен после изменения брифа/критериев/описания; баннер показывается; restore предупреждает об hh-привязках.
- [ ] Генерация не персистит; принятые элементы помечены `origin='ai'`; дедуп против карты/исключений/реестра; 422/429 корректны; промпты проверены в `promptSandbox`.
- [ ] Реестр доноров: уникальность, алиасы, merge, «где используется».
- [ ] UI только на `Ui*`; HM read-only; тёмная тема; клавиатурная доступность списков.
- [ ] i18n — все строки в `ru.json`, вкладка `dashboard.jobs.tabs.searchMap`.
- [ ] E2E «золотой путь» зелёный; фича-флаг снят.
- [ ] Записи в `activity_log` на ключевые действия.

---

## 20. Открытые вопросы на согласование

1. **Слои доноров**: достаточно ли `core / adjacent / school / alumni / custom`, или нужен отдельный слой «стадия роста» (стартапы на этапе сокращений)? Сейчас это предлагается покрывать тегом `stage` донора + `rationale`.
2. **`add_donor` у member**: оставляем по умолчанию (накопление важнее чистоты) или включаем через роль-пресет RBAC v2 по решению org-админа?
3. **Авто-v1 при принятии черновика ИИ**: создавать версию автоматически (предлагается) или только по кнопке?
4. **Экспорт для HM**: достаточно Markdown или сразу нужен PDF (есть `MeetingReportCard`/PDF-инфра резюме)?
5. **Подсказка «добавить в доноры» из карточки кандидата (S5)**: делать в этом модуле или отложить до переработки карточки кандидата?
