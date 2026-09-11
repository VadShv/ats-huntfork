# План унификации UI/UX (Huntfork)

> **Статус:** черновик плана (код ещё не пишем). Цель — привести систему к единой
> дизайн-системе: одинаковые кнопки, поля, фильтры и единый раздел Настроек.
> **Не трогаем:** карточки откликов и карточки резюме (эталон, берём как есть).

## Согласованные решения

1. **Порядок этапов:** сначала раздел Настроек (порядок + тех-долг), затем кнопки везде.
2. **UiButton:** расширяем компонент (добавить `outline`/`success`, `size="xs"`, `icon-left`/`icon-right`, `block`).
3. **Охват рефактора:** помодульно, пошагово (одна итерация = один модуль/экран, легко ревьюить).
4. **Тех-долг Настроек:** убираем в этот же этап (дубли, редиректы, мусорный каталог).
5. **Формат:** этот письменный план + чек-лист ниже.

---

## Контекст: что уже есть

Дизайн-система: `app/components/ui/` — `UiButton`, `UiInput`, `UiSelect`, `UiBadge`,
`UiCard`, `UiModal`, `UiDrawer`. Витрина: `app/pages/dashboard/design-system.vue`
(`/dashboard/_design-system`). Токены: `app/design/tokens.ts`.
Фильтры: `FilterDrawer`, `SavedViewsMenu`, `ColumnsMenu`, `PropertyFilterBar`.

Проникновение дизайн-системы сейчас низкое (~1–5%): ~992 сырых `<button>`,
333 `<input>`, 91 `<select>`, 67 `<textarea>` против единичных `Ui*`.

---

## Этап 1 — Раздел «Настройки»

### 1.1 Тех-долг (убрать сразу) — ВЫПОЛНЕНО

- [x] Удалить мусорный каталог `app/pages/dashboard/settings/org-9 app/`
      (пустое дерево папок, НЕ в git — безопасно).
- [x] ~~Удалить~~ **Заменить на 302-редирект** орфан-страницы
      `settings/companies.vue` и `settings/departments.vue` → `org-structure`
      (дублируют `org-structure.vue`; ссылок на маршруты в коде нет).
      Решение: редирект (паттерн `teams.vue`) — сохраняет старые закладки, без 404.
- [x] `settings/teams.vue` (302-редирект на `league?tab=team`): оставлен как
      back-compat редирект.
- [x] Починить подсветку ярлыка «Настройки ИИ»: `exact:true` → `exact:false`
      (как у `pipelines`).

### 1.2 Недостающие ярлыки/разделы (обсудить объём)

Кандидаты на вынос в Настройки (сейчас разбросаны/инлайн):
- [ ] **Свойства (properties)** — центральный экран управления схемой
      (сейчас только инлайн `PropertySchemaEditor`).
- [ ] **Шаблоны сообщений** — единый раздел (email-шаблоны интервью +
      message-templates + reject-шаблоны воронки, сейчас в 3 местах).
- [ ] **Уведомления** — экран настроек предпочтений (сейчас только лента).
- [ ] **Sourcing** — общие настройки (сейчас только per-job). Низкий приоритет.

> Примечание: добавление новых разделов = новый функционал, требует отдельного
> согласования по объёму. На этом этапе достаточно завести ярлыки-заглушки или
> перенести существующие экраны.

### 1.3 Унификация макета страниц Настроек

Эталон паттерна — `settings/integrations.vue` и `settings/index.vue`:
контейнер `mx-auto max-w-2xl`, шапка `<h1> + <p>`, карточки-секции
`rounded-xl border bg-white dark:bg-surface-900` с иконкой в цветном квадрате.

- [ ] Единая ширина контейнера (сейчас `max-w-2xl` vs `max-w-5xl` у `league`).
- [ ] Единый `definePageMeta` (часть страниц дублирует `layout/middleware`,
      хотя наследуют от `settings.vue`).
- [ ] Кнопки/поля на страницах Настроек → перевести на `Ui*` (пересекается с Этапом 2).

---

## Этап 2 — Кнопки везде (`UiButton`)

### 2.1 Расширить компонент `UiButton.vue`

Привести к API, который уже ожидает витрина `design-system.vue`:
- [ ] Варианты: добавить `outline`, `success` (к `primary/secondary/ghost/danger`).
- [ ] Размеры: добавить `xs` (к `sm/md/lg`).
- [ ] Props иконок: `icon-left`, `icon-right` (компонент lucide) — как альтернатива слотам.
- [ ] Ширина: добавить алиас `block` (сейчас только `fullWidth`) ИЛИ переименовать
      согласованно и обновить потребителей.
- [ ] Обновить JSDoc-шапку компонента и витрину, чтобы «витрина = факт».
- [ ] Зафиксировать канон паддингов/скруглений/`disabled` (устранить разнобой
      `rounded-lg` vs `rounded-md`, `opacity-40/50/60`, `emerald` vs `success`).

### 2.2 Массовая замена сырых `<button>` → `<UiButton>` (помодульно)

Порядок по «очагам» (число сырых кнопок в файле, оценка):
- [ ] `pages/dashboard/jobs/[id]/index.vue` (~55)
- [ ] `pages/dashboard/jobs/new.vue` (~50)
- [ ] `pages/dashboard/settings/org-structure.vue` (~30, убрать локальные `btnPrimary/btnGhost/iconBtn`)
- [ ] `pages/dashboard/settings/members.vue` (~30)
- [ ] `pages/dashboard/candidates/[id].vue` (~30)
- [ ] `pages/dashboard/interviews/[id].vue` (~22) + `components/InterviewScheduleSidebar.vue` (~17)
- [ ] `pages/dashboard/applications/index.vue` (~18) + `settings/integrations.vue` (~18) + `settings/pipelines/[id].vue` (~18)
- [ ] `pages/dashboard/jobs/[id]/candidates.vue` (~17) + `components/candidate/HhResumeView.vue` (~18)
- [ ] `pages/dashboard/candidates/index.vue` (~15) + `components/CandidateDetailSidebar.vue` (~15)
- [ ] Остальные (source-tracking, duplicates, updates, chatbot, виджеты с локальными `btn*`)
- [ ] Убрать локальные «мини-ДС»: `org-structure.vue`, `TeamsManager.vue`, `DuelsWidget.vue`.

> Отдельная семантика — link-кнопки (`<button class="underline">` «Повторить/Retry»,
> заголовки сортировки таблиц). Решить: отдельный вариант `UiButton variant="link"`
> или оставить как есть. Предложение: добавить `link`-вариант.

---

## Этап 3 — Поля ввода (`UiInput` / `UiSelect` / `UiTextarea`)

- [ ] Создать `UiTextarea` (сейчас обёртки нет, ~67 сырых `<textarea>`).
- [ ] Помодульно заменить сырые `<input>/<select>/<textarea>` на `Ui*`
      (начать с форм: `jobs/new`, `candidates/new`, `jobs/[id]/settings`, `AiConfigForm`).
- [ ] Устранить смешение токенов `primary-*` ↔ `brand-*` в чекбоксах/фокус-рингах.

---

## Этап 4 — Фильтры и панели списков

Сейчас три несовместимые «школы»:
- **A (эталон):** `FilterDrawer + SavedViewsMenu + ColumnsMenu` — jobs, candidates, applications.
- **B:** аналитика — `AnalyticsFilterBar + useAnalyticsFilters` (URL-sync).
- **C (ad-hoc):** interviews, source-tracking, timeline, inbox, achievements, `jobs/[id]/*`.

- [ ] Ввести единый `SearchInput` (сейчас поиск сделан ≥5 способами).
- [ ] Ввести единый паттерн панели списка: поиск + фильтры (`FilterDrawer`) + сортировка
      + сохранённые виды + колонки.
- [ ] Внутри `FilterDrawer` заменить сырые `<select>`/чек-листы на `Ui*`.
- [ ] Свести дублирующую логику дат/периодов (source-tracking vs analytics) в одно место.
- [ ] Перевести ad-hoc страницы (school C) на единый паттерн, где применимо.
- [ ] Решить: сближать ли систему аналитики (school B) с общей или оставить отдельной.

---

## Принципы (definition of done для унификации)

1. Никаких сырых `<button>/<input>/<select>/<textarea>` с инлайн-Tailwind в
   продуктовых экранах — только `Ui*` (исключения: карточки откликов/резюме).
2. Один смысл — один компонент/вариант (не копипастить классы).
3. Витрина `design-system.vue` = фактическому API компонентов.
4. Каждая итерация — один модуль/экран, отдельный коммит, визуальная проверка
   светлой/тёмной темы.
5. Токены семантические (`brand/surface/success/danger/...`), без `emerald/primary`-разнобоя.
