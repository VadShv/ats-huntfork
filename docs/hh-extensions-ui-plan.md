# hh.ru Integration Extensions — UI Implementation Plan

> **Based on:** `docs/hh-extensions-plan.md` (product plan & architecture)
> **Date:** 2025-09-15
> **Goal:** Concrete UI implementation for all 7 integrations, grounded in existing codebase patterns.

---

## Existing UI Patterns (Reference)

| Pattern | Implementation | Used by |
|---|---|---|
| Settings page | `layout: 'settings'` + `SettingsSidebar` nav item | All settings pages |
| Integration card | Card header (icon + title + status badge) + body with state branches | `integrations.vue` |
| Permission gate | `usePermission({ resource: ['action'] })` then `<AccessDeniedBanner v-if="!allowed" />` | All protected pages |
| Modal | `UiModal v-model="show"` with header/default/footer slots | Everywhere |
| Confirm | `const { ask } = useConfirm(); await ask({ title, message, variant: 'danger' })` | Destructive actions |
| Toast | `const toast = useToast(); toast.success('Готово')` / `toast.error('Ошибка', { message })` | All mutations |
| Tabs | `useDetailTabRoute({ available: [...], defaultTab, queryKey: 'tab' })` | Job/applicant detail |
| Data fetch | `useFetch(url, { key, query })` for SSR, `$fetch(url, { method, body })` for mutations | All pages |
| Charts | `<AeChart :option="chartOption" height="320" />` (ECharts, client-only) | Analytics pages |
| Bulk ops | `selectedIds = ref<Set<string>>()` + sticky Teleport bar + `Promise.allSettled` | `applications/index.vue` |
| Drawers | `UiDrawer` or custom Teleport+Transition | `ApplicationDetailDrawer` |
| Icons | `import { FileText, Send } from 'lucide-vue-next'` then `:icon-left="FileText"` on `UiButton` | All components |
| Empty state | `<EmptyState icon="..." title="..." description="..." />` | Lists/grids |
| Badge | `<UiBadge variant="success">Текст</UiBadge>` | Status indicators |

---

## 1. [#3] Vacancy Templates — UI

### 1.1 New Pages

| Route | File | Description |
|---|---|---|
| `/dashboard/settings/hh-templates` | `app/pages/dashboard/settings/hh-templates.vue` | Template list + CRUD |

### 1.2 SettingsSidebar Update

**File:** `app/components/SettingsSidebar.vue`

Add nav item after "Интеграции":

```typescript
{ label: 'Шаблоны вакансий', to: '/dashboard/settings/hh-templates', icon: FileText }
```

Only shown when hh.ru is connected (check via `useFetch('/api/hh/status')` in sidebar, or always show and display "Connect hh.ru first" empty state).

### 1.3 Template List Page (`hh-templates.vue`)

```
┌─────────────────────────────────────────────────────┐
│  Шаблоны вакансий hh.ru                    [+ Создать] │
│  Сохраняйте черновики вакансий для повторного использования │
├─────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Senior FE │  │ QA Auto  │  │ Product  │          │
│  │ React     │  │ Playwright│  │ Manager  │          │
│  │ Москва    │  │ Remote    │  │ Москва   │          │
│  │ Used 12x  │  │ Used 3x   │  │ New      │          │
│  │ [Use] [⋯] │  │ [Use] [⋯] │  │ [Use] [⋯] │          │
│  └──────────┘  └──────────┘  └──────────┘          │
└─────────────────────────────────────────────────────┘
```

**Structure:**
- `definePageMeta({ layout: 'settings', middleware: ['auth', 'require-org'] })`
- `usePermission({ hh: ['templates:read'] })` then `AccessDeniedBanner` if denied
- `useFetch('/api/hh/templates', { key: 'hh-templates' })` — grid of template cards
- Each card: `UiCard` with name, cached area, `last_used_at` ("Used Nx" or "New"), dropdown menu (Edit / Delete)
- "Создать" button opens `HhTemplateEditor` modal
- Empty state: `<EmptyState icon="FileText" title="Нет шаблонов" />`

### 1.4 Template Editor Modal

**New component:** `app/components/hh/HhTemplateEditor.vue`

```
┌───────────────────────────────────────────┐
│  Новый шаблон                          [×] │
├───────────────────────────────────────────┤
│  Название:   [Senior Frontend React______] │
│  Описание:   [Для продуктовых команд______] │
│                                             │
│  ── Данные вакансии (hh.ru) ──             │
│  Название:   [Senior Frontend Developer___] │
│  Зарплата:   [300000] – [450000] [RUB]     │
│  Город:      [Москва ▾]                     │
│  Тип занятости: [Полная ▾]                  │
│  Описание:   [Markdown редактор...........] │
│  Ключевые навыки: [React] [TypeScript] [+]  │
│                                             │
│  ☐ Доступен всем в организации              │
├───────────────────────────────────────────┤
│                          [Отмена] [Сохранить] │
└───────────────────────────────────────────┘
```

- `UiModal v-model="show" size="lg"` with form fields
- Salary, city, employment type use `UiInput` / `UiSelect`
- Description uses existing `MarkdownDescription` component or a textarea
- Skills: tag input (add/remove chips)
- "Доступен всем" checkbox -> `is_shared` field
- Save: `$fetch('/api/hh/templates', { method: 'POST', body })` -> `toast.success` -> `refreshNuxtData('hh-templates')`

### 1.5 "Use Template" Modal

**New component:** `app/components/hh/HhTemplateUseModal.vue`

```
┌───────────────────────────────────────────┐
│  Создать вакансию из шаблона           [×] │
│  Шаблон: Senior Frontend React             │
├───────────────────────────────────────────┤
│  Поля можно изменить перед публикацией:    │
│  Название:   [Senior Frontend Developer___] │
│  Зарплата:   [350000] – [500000] [RUB]     │  <- pre-filled, editable
│  Город:      [Санкт-Петербург ▾]           │  <- changed from template
│  ...                                        │
├───────────────────────────────────────────┤
│              [Отмена] [Опубликовать на hh.ru] │
└───────────────────────────────────────────┘
```

- Pre-filled from `template.vacancy_data`, all fields editable
- "Опубликовать" -> `$fetch('/api/hh/templates/:id/use', { method: 'POST', body: overrides })`
- On success: `toast.success('Вакансия опубликована')` + link to hh.ru URL
- On failure: `toast.error('Ошибка публикации', { message: error.details })`

### 1.6 "Save as Template" Button on Job Creation

**File:** `app/pages/dashboard/jobs/new.vue`

Add a "Сохранить как шаблон" button next to "Опубликовать" in the final step of the wizard. Opens `HhTemplateEditor` pre-filled with the current form data.

---

## 2. [#7] Bulk Operations — UI

### 2.1 Existing Infrastructure (Already Implemented!)

The applications list (`app/pages/dashboard/applications/index.vue`) **already has**:
- Checkbox selection (`selectedIds = ref<Set<string>>()`)
- Sticky bulk action bar (Teleport to body, bottom-center)
- `bulkMoveToStage()` and `bulkReject()` using `Promise.allSettled`
- "Выбрано: N" counter + "Отмена" clear button

### 2.2 Enhancements to Existing Bulk Bar

**File:** `app/pages/dashboard/applications/index.vue`

Add new actions to the existing sticky bar:

```
┌──────────────────────────────────────────────────────────┐
│  Выбрано: 24  [Отправить сообщение] [Изменить статус ▾] [Отклонить] [Отмена] │
└──────────────────────────────────────────────────────────┘
```

New buttons:
1. **"Отправить сообщение"** -> opens `HhBulkMessageModal`
2. **"Изменить статус ▾"** -> dropdown with hh.ru statuses (Пригласить / Подумать / Отказать / Архив)

### 2.3 Bulk Message Modal

**New component:** `app/components/hh/HhBulkMessageModal.vue`

```
┌───────────────────────────────────────────┐
│  Отправить сообщение 24 кандидатам     [×] │
├───────────────────────────────────────────┤
│  Шаблон: [Выберите шаблон... ▾]  (optional) │
│                                             │
│  Сообщение:                                │
│  ┌───────────────────────────────────────┐ │
│  │ Здравствуйте! Спасибо за отклик на    │ │
│  │ вакансию. Мы рассмотрим вашу          │ │
│  │ кандидатуру в течение 3 дней.         │ │
│  └───────────────────────────────────────┘ │
│                                             │
│  ⚠ Будет отправлено через hh.ru каждому    │
│    кандидату. Это действие нельзя отменить. │
├───────────────────────────────────────────┤
│                          [Отмена] [Отправить] │
└───────────────────────────────────────────┘
```

- `UiModal v-model="show" size="md"`
- Template dropdown pulls from #3 templates (message-type templates)
- Textarea for message body, pre-filled if template selected
- Warning banner about irreversibility
- "Отправить" -> `useConfirm().ask({ title: 'Отправить 24 сообщения?', variant: 'danger' })` -> `$fetch('/api/hh/bulk/message', { method: 'POST', body: { applicationIds: [...selectedIds], messageText } })`
- Response shows per-item results: "Успешно: 22, Ошибки: 2" with expandable error details

### 2.4 Bulk Status Change

**Enhance existing `bulkMoveToStage`** to also sync to hh.ru:

The existing function already changes stage locally. Add a parallel hh.ru status sync:

```typescript
async function bulkSetHhStatus(hhStatus: string) {
  const result = await $fetch('/api/hh/bulk/status', {
    method: 'POST',
    body: { applicationIds: [...selectedIds], hhStatus }
  })
  if (result.failed.length > 0) {
    toast.warning(`${result.succeeded.length} обновлено, ${result.failed.length} с ошибками`)
  } else {
    toast.success(`Обновлено: ${result.succeeded.length}`)
  }
  refreshNuxtData('applications')
  selectedIds.value.clear()
}
```

### 2.5 Progress Indicator for Large Batches

For >20 items, show a progress bar in the bulk action bar:

```
┌───────────────────────────────────────────┐
│  Выбрано: 85  Отправка сообщений... 42/85 │
│  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└───────────────────────────────────────────┘
```

- Replace action buttons with progress bar during operation
- Use reactive counter updated as `Promise.allSettled` resolves

---

## 3. [#2] Vacancy Statistics — UI

### 3.1 New Components

| Component | File | Description |
|---|---|---|
| `HhVacancyStats` | `app/components/hh/HhVacancyStats.vue` | Stats panel for vacancy detail |
| `HhStatsWidget` | `app/components/hh/HhStatsWidget.vue` | Dashboard widget (top 5 vacancies) |

### 3.2 Vacancy Detail — New Tab

**File:** `app/components/AppTopBar.vue` — add "Статистика" to `jobTabs`:

```typescript
{ label: 'Статистика', to: `/dashboard/jobs/${jobId}/stats`, icon: BarChart3 }
```

**New page:** `app/pages/dashboard/jobs/[id]/stats.vue`

```
┌─────────────────────────────────────────────────────┐
│  ← Senior Frontend Developer                        │
│  Статистика hh.ru                        [Обновить ↻] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐ │
│  │ 1 247   │  │   89    │  │  7.1%   │  │   12   │ │
│  │ Просмотров│ │ Откликов │ │ Конверсия│ │ Приглаш.│ │
│  └─────────┘  └─────────┘  └─────────┘  └────────┘ │
│                                                     │
│  Просмотры и отклики за 30 дней                     │
│  ┌───────────────────────────────────────────────┐ │
│  │     /\                                         │ │
│  │   /   \    /\                                  │ │
│  │  /      \/   \                                 │ │
│  │ /                \___                          │ │
│  └───────────────────────────────────────────────┘ │
│  1 сен                          15 сен          30 сен│
│                                                     │
│  Статусы откликов                                   │
│  ┌───────────────────────────────────────────────┐ │
│  │ Приглашены   ████████████  12  (13%)          │ │
│  │ Отказ        ██████████████████ 18  (20%)     │ │
│  │ Думают       ████████████████████████ 42 (47%)│ │
│  │ Ответили     ██████  6  (7%)                   │ │
│  │ Активные     ███████████  11  (12%)           │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  Последнее обновление: 15 мин назад                 │
└─────────────────────────────────────────────────────┘
```

**Structure:**
- `definePageMeta({ layout: 'dashboard', middleware: ['auth', 'require-org'] })`
- `usePermission({ hh: ['stats:read'] })` -> `AccessDeniedBanner` if denied
- `useFetch('/api/hh/stats/:vacancyId', { key: 'hh-stats' })` -> stats data
- **Metric cards:** 4 `UiCard` in a grid — views, applications, conversion rate, invitations
- **Trend chart:** `<AeChart :option="trendOption" />` — line chart with two series (views, applications) over 30 days. Use `baseCartesianOption()` from `chart-theme.ts` for consistent styling.
- **Status breakdown:** horizontal bar chart or simple stacked bars with `UiBadge` counts
- **"Обновить" button:** `UiButton variant="outline" :icon-left="RefreshCw"` -> `$fetch('/api/hh/stats/refresh', { method: 'POST' })` -> `refreshNuxtData('hh-stats')`
- **Not published state:** `<EmptyState icon="BarChart3" title="Вакансия не опубликована на hh.ru" />`
- **Stale data badge:** if `fetched_at` > 24h ago, show `<UiBadge variant="warning">Данные могут быть устаревшими</UiBadge>`

### 3.3 Dashboard Widget

**File:** `app/pages/dashboard/index.vue` (main dashboard)

Add `HhStatsWidget` to the dashboard widget grid:

```
┌─────────────────────────────────┐
│  Вакансии hh.ru        [Подробнее] │
├─────────────────────────────────┤
│  1. Senior FE    89 откликов +12 │
│  2. QA Engineer  45 откликов +3  │
│  3. Product Mgr  34 откликов -2  │
│  4. Designer     28 откликов —   │
│  5. DevOps       19 откликов +1  │
└─────────────────────────────────┘
```

- `useFetch('/api/hh/stats', { key: 'hh-stats-summary' })` -> top 5 by application count
- Each row: vacancy name, count, trend arrow (+/-/— compared to previous day)
- "Подробнее" -> navigates to `/dashboard/jobs/:id/stats` for top vacancy
- Only shown if org has hh.ru connected (check `useFetch('/api/hh/status')`)

---

## 4. [#8] Negotiation History Sync — UI

### 4.1 New Components

| Component | File | Description |
|---|---|---|
| `HhNegotiationList` | `app/components/hh/HhNegotiationList.vue` | List of negotiations for a vacancy |
| `HhNegotiationThread` | `app/components/hh/HhNegotiationThread.vue` | Message thread modal |
| `HhNegotiationCard` | `app/components/hh/HhNegotiationCard.vue` | Single negotiation card |

### 4.2 Vacancy Detail — New Tab

**File:** `app/components/AppTopBar.vue` — add "Отклики hh.ru" to `jobTabs`:

```typescript
{ label: 'Отклики hh.ru', to: `/dashboard/jobs/${jobId}/negotiations`, icon: MessageSquare }
```

**New page:** `app/pages/dashboard/jobs/[id]/negotiations.vue`

```
┌─────────────────────────────────────────────────────┐
│  ← Senior Frontend Developer                        │
│  Отклики hh.ru                  [Синхронизировать ↻] │
│  Последняя синхронизация: 12 мин назад               │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ── Импортированы в Huntfork (45) ──               │
│  ┌───────────────────────────────────────────────┐ │
│  │ ● Иван Петров      Приглашён    3 сообщ.       │ │
│  │   ivan@email       15 сен, 14:32 [Открыть]     │ │
│  ├───────────────────────────────────────────────┤ │
│  │ ● Анна Смирнова     Думает      1 сообщ.       │ │
│  │   anna@email       15 сен, 12:01 [Открыть]     │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ── Только на hh.ru (8) ──  ⚠ не импортированы     │
│  ┌───────────────────────────────────────────────┐ │
│  │ ◐ Дмитрий Волков   Активен     0 сообщ.       │ │
│  │   (контакты скрыты) 15 сен, 16:45              │ │
│  │   [Импортировать в Huntfork]                   │ │
│  ├───────────────────────────────────────────────┤ │
│  │ ◐ Елена Кузнецова  Активен     0 сообщ.       │ │
│  │   (контакты скрыты) 15 сен, 16:30              │ │
│  │   [Импортировать в Huntfork]                   │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Structure:**
- `definePageMeta({ layout: 'dashboard', middleware: ['auth', 'require-org'] })`
- `usePermission({ hh: ['negotiations:read'] })` -> `AccessDeniedBanner`
- `useFetch('/api/hh/negotiations?vacancyId=...', { key: 'hh-negotiations' })` -> paginated list
- **Two sections:** "Импортированы в Huntfork" (green dot) and "Только на hh.ru" (orange dot)
- **"Синхронизировать" button:** `UiButton variant="outline" :icon-left="RefreshCw"` -> `$fetch('/api/hh/negotiations/sync', { method: 'POST', body: { vacancyId } })` -> shows progress -> `refreshNuxtData('hh-negotiations')`
- **Sync timestamp:** "Последняя синхронизация: X мин назад" from `last_synced_at`
- **Pagination:** "Показать ещё" button at bottom (load more, not infinite scroll)

### 4.3 Negotiation Card (`HhNegotiationCard.vue`)

Props: `negotiation` (the negotiation object)

- **Imported (green dot):** candidate name, email, status badge, message count, "Открыть" button -> opens `HhNegotiationThread` modal
- **Not imported (orange dot):** candidate name (or "Контакты скрыты" if hh.ru hasn't revealed them), status badge, "Импортировать в Huntfork" button
- **Status badge:** `UiBadge` with color mapping: Активен=info, Приглашён=success, Отказ=danger, Думает=warning
- **"Импортировать" action:** `$fetch('/api/hh/negotiations/import/:hhId', { method: 'POST' })` -> `toast.success('Отклик импортирован')` -> `refreshNuxtData('hh-negotiations')`

### 4.4 Message Thread Modal (`HhNegotiationThread.vue`)

```
┌───────────────────────────────────────────────┐
│  Иван Петров — переписка                  [×] │
│  Статус: Приглашён                              │
├───────────────────────────────────────────────┤
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ 15 сен, 12:01                    <- кандидат │ │
│  │ Здравствуйте! Откликнулся на вакансию     │ │
│  │ Senior Frontend Developer.                │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ 15 сен, 14:32  рекруiter ->               │ │
│  │ Добрый день! Спасибо за отклик.           │ │
│  │ Приглашаем на собеседование...            │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ 15 сен, 14:35                    <- кандидат │ │
│  │ Спасибо! Буду рад обсудить.               │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
├───────────────────────────────────────────────┤
│  [Написать кандидату____________________] [Отправить] │
└───────────────────────────────────────────────┘
```

- `UiModal v-model="show" size="lg"` or `UiDrawer` (side panel, consistent with `ApplicationDetailDrawer`)
- Messages rendered as a scrollable list, incoming (left-aligned, gray bg) vs outgoing (right-aligned, brand bg)
- Each message: timestamp, author label, text (sanitized HTML -> render as rich text)
- **Reply box at bottom:** `UiTextarea` + "Отправить" button -> `$fetch('/api/hh/negotiations/:id/messages', { method: 'POST', body: { text } })` -> append to list optimistically
- **Auto-scroll** to bottom on open and on new message
- **Empty thread:** "Нет сообщений" centered text

### 4.5 Auto-Sync Indicator

On the negotiations page header, a subtle auto-refresh indicator:

```
  ⟳ Авто-синхронизация каждые 30 мин (вакансия активна)
```

- Only shown when vacancy status is "active" on hh.ru
- No UI timer needed — background job handles sync; UI just shows the policy text

---

## 5. [#10] Similar Vacancies — UI

### 5.1 New Components

| Component | File | Description |
|---|---|---|
| `HhSimilarVacancies` | `app/components/hh/HhSimilarVacancies.vue` | Sidebar widget on candidate detail |
| `HhSimilarCandidates` | `app/components/hh/HhSimilarCandidates.vue` | Sidebar widget on vacancy detail |

### 5.2 Candidate Detail — Sidebar Widget

**File:** `app/pages/dashboard/candidates/[id].vue`

Add `HhSimilarVacancies` to the right sidebar / below existing content:

```
┌─────────────────────────────────┐
│  Похожие вакансии на hh.ru      │
├─────────────────────────────────┤
│  ┌───────────────────────────┐  │
│  │ Senior React Developer    │  │
│  │ Яндекс · Москва           │  │
│  │ 350-500k RUB              │  │
│  │ [На hh.ru ↗] [Связать]    │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │ Frontend Lead             │  │
│  │ Авито · Москва            │  │
│  │ 400-600k RUB              │  │
│  │ [На hh.ru ↗] [Связать]    │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │ Senior Vue Developer      │  │
│  │ Тинькофф · Remote         │  │
│  │ 300-450k RUB              │  │
│  │ [На hh.ru ↗] [Связать]    │  │
│  └───────────────────────────┘  │
│                                 │
│  [Показать ещё ↓]               │
└─────────────────────────────────┘
```

**Structure:**
- `usePermission({ hh: ['vacancies:read'] })` — hide widget entirely if denied
- `useFetch('/api/hh/similar-vacancies', { method: 'POST', body: { candidateId } })` — lazy fetch on mount
- **Loading state:** 3 skeleton cards (`SkeletonRow`)
- **Each card:** vacancy title, employer name, area, salary range
- **"На hh.ru" link:** opens `alternate_url` in new tab (`target="_blank"`)
- **"Связать" button:** links candidate to this hh.ru vacancy (creates an application record) -> `toast.success`
- **"Показать ещё":** loads 5 more results (pagination)
- **Empty state:** `<EmptyState icon="Search" title="Нет похожих вакансий" />`
- **No skills state:** if candidate has no skills/position -> "Добавьте навыки и желаемую должность кандидату, чтобы найти похожие вакансии"

### 5.3 Reverse: Similar Candidates on Vacancy Detail

On the vacancy pipeline page (`jobs/[id]/index.vue`), add a collapsible sidebar section:

```
┌─────────────────────────────────┐
│  ▼ Похожие кандидаты (из базы)  │
├─────────────────────────────────┤
│  ● Иван Петров    92% совпадение │
│  ● Анна Смирнова  87% совпадение │
│  ● Дмитрий Волков 81% совпадение │
│  [Откликнуть на вакансию]        │
└─────────────────────────────────┘
```

- Matches candidates in the org's DB against the vacancy's requirements
- Match score: based on skills overlap (computed server-side)
- "Откликнуть" -> creates an application linking the candidate to this vacancy

---

## 6. [#6] Auto-Respond — UI

### 6.1 New Pages & Components

| Route | File | Description |
|---|---|---|
| `/dashboard/settings/hh-auto-respond` | `app/pages/dashboard/settings/hh-auto-respond.vue` | Rules list + CRUD |

| Component | File | Description |
|---|---|---|
| `HhAutoRespondRuleEditor` | `app/components/hh/HhAutoRespondRuleEditor.vue` | Create/edit rule modal |
| `HhAutoRespondLog` | `app/components/hh/HhAutoRespondLog.vue` | Log table |

### 6.2 SettingsSidebar Update

Add nav item:

```typescript
{ label: 'Авто-ответы', to: '/dashboard/settings/hh-auto-respond', icon: Zap }
```

### 6.3 Auto-Respond Page (`hh-auto-respond.vue`)

```
┌─────────────────────────────────────────────────────┐
│  Авто-ответы hh.ru                       [+ Создать правило] │
│  Автоматически отправляйте сообщения кандидатам     │
│  при получении отклика                              │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ ● Быстрый ответ (все вакансии)      Вкл        │ │
│  │   Шаблон: "Спасибо за отклик"                  │ │
│  │   Отправлено: 342                              │ │
│  │   Последняя отправка: 5 мин назад              │ │
│  │   [Изменить] [Журнал] [Удалить]                │ │
│  ├───────────────────────────────────────────────┤ │
│  │ ● React-разработчикам (Senior FE React)  Вкл   │ │
│  │   Условия: React + TypeScript, Москва          │ │
│  │   Шаблон: "Привет! Подходит по стеку..."      │ │
│  │   Отправлено: 28                               │ │
│  │   Последняя отправка: 2 часа назад             │ │
│  │   [Изменить] [Журнал] [Удалить]                │ │
│  ├───────────────────────────────────────────────┤ │
│  │ ○ Junior-отклики (все вакансии)     Выкл       │ │
│  │   Условия: опыт < 1 года                       │ │
│  │   Шаблон: "Спасибо, но мы ищем senior..."     │ │
│  │   Отправлено: 0 (отключено)                    │ │
│  │   [Изменить] [Журнал] [Удалить]                │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ── Журнал отправок (последние 50) ──              │
│  ┌───────────────────────────────────────────────┐ │
│  │ Время           Кандидат        Статус  Текст  │ │
│  │ 15 сен 16:45    Иван Петров     ✓       "Спас..│ │
│  │ 15 сен 16:30    Анна Смирнова   ✓       "Спас..│ │
│  │ 15 сен 16:15    Дмитрий Волков  ✗       Ошибка │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Structure:**
- `definePageMeta({ layout: 'settings', middleware: ['auth', 'require-org'] })`
- `usePermission({ hh: ['autorespond:read'] })` -> `AccessDeniedBanner`
- `useFetch('/api/hh/auto-respond/rules', { key: 'hh-auto-rules' })` -> rules list
- `useFetch('/api/hh/auto-respond/log?limit=50', { key: 'hh-auto-log' })` -> log table
- **Rule card:** toggle switch (active/inactive), name, scope (vacancy or "все"), conditions summary, template name, sent count, last sent, action buttons
- **Toggle:** `UiSegmented` or custom switch -> `$fetch('/api/hh/auto-respond/rules/:id', { method: 'PUT', body: { is_active: !current } })`
- **Log table:** simple table with time, candidate name, status icon, message preview (truncated), error text if failed
- **Empty state:** `<EmptyState icon="Zap" title="Нет правил авто-ответа" />`

### 6.4 Rule Editor Modal (`HhAutoRespondRuleEditor.vue`)

```
┌───────────────────────────────────────────────────┐
│  Новое правило авто-ответа                    [×] │
├───────────────────────────────────────────────────┤
│  Название: [Быстрый ответ_______________________]  │
│                                                     │
│  ── Когда срабатывать ──                           │
│  Область применения:                                │
│    (●) Все вакансии                                │
│    ( ) Конкретная вакансия: [Senior FE React ▾]   │
│                                                     │
│  Условия (необязательно):                          │
│  Ключевые слова в резюме: [React] [TypeScript] [+] │
│  Город: [Москва ▾]                                 │
│  Мин. опыт (лет): [3]                               │
│                                                     │
│  ── Что отправлять ──                              │
│  Источник сообщения:                               │
│    (●) Шаблон: [Спасибо за отклик ▾]               │
│    ( ) Свой текст:                                  │
│  ┌───────────────────────────────────────────────┐ │
│  │ Здравствуйте! Спасибо за отклик на вакансию.  │ │
│  │ Мы рассмотрим вашу кандидатуру в течение 3... │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ── Когда отправлять ──                            │
│  Задержка:                                          │
│    (●) Немедленно                                   │
│    ( ) Через: [5] минут                            │
│                                                     │
│  ☑ Активно                                         │
├───────────────────────────────────────────────────┤
│                              [Отмена] [Сохранить]  │
└───────────────────────────────────────────────────┘
```

- `UiModal v-model="show" size="lg"`
- **Scope:** radio buttons — "Все вакансии" or vacancy select (`UiSelect` populated from `useFetch('/api/jobs')`)
- **Conditions:** keyword tag input, city select, experience number input — all optional
- **Message source:** radio — template select (from #3) or inline textarea
- **Delay:** radio — immediate or N minutes
- **Active checkbox:** `is_active` field
- Save: `$fetch('/api/hh/auto-respond/rules', { method: 'POST', body })` -> `toast.success` -> `refreshNuxtData('hh-auto-rules')`

### 6.5 Log View (`HhAutoRespondLog.vue`)

- Props: `ruleId?` (optional — filter by rule)
- `useFetch('/api/hh/auto-respond/log', { query: { ruleId, limit: 50 } })`
- Table columns: time, candidate name, status icon (check/x), message preview (first 50 chars), error text
- "Повторить" button on failed entries -> retry send
- Pagination: "Показать ещё 50"

---

## 7. [#4] Comment Sync — UI

### 7.1 No New Pages — Enhance Existing Components

Comment sync reuses the existing `ApplicationCommentThread` and `ApplicationCommentComposer` components. Changes are additive.

### 7.2 Comment Item Enhancement

**File:** `app/components/Comments/ApplicationCommentItem.vue`

Add hh.ru sync status badge next to each comment:

```
┌───────────────────────────────────────────┐
│  Рекруiter · 15 сен, 14:32    [hh.ru ✓]  │  <- synced badge
│  Добрый день! Спасибо за отклик.          │
│  Приглашаем на собеседование...           │
└───────────────────────────────────────────┘

┌───────────────────────────────────────────┐
│  Рекруiter · 15 сен, 14:35  [ожидает hh]  │  <- pending badge (yellow)
│  Отправил резюведение тимлиду...           │
└───────────────────────────────────────────┘

┌───────────────────────────────────────────┐
│  Кандидат · 15 сен, 14:40    [hh.ru ←]    │  <- incoming badge (blue)
│  Спасибо! Буду рад обсудить.               │
└───────────────────────────────────────────┘
```

**New badges based on `hh_sync_status` field:**

| `hh_sync_status` | Badge | Color | Icon |
|---|---|---|---|
| `synced` + `hh_direction='outgoing'` | "hh.ru" | blue (info) | `Check` |
| `synced` + `hh_direction='incoming'` | "hh.ru" | blue (info) | `ArrowLeft` |
| `pending` | "ожидает hh" | yellow (warning) | `Clock` |
| `failed` | "ошибка hh" | red (danger) | `AlertCircle` |
| `local` (or null) | no badge | — | — |

Implementation: add a small `UiBadge` after the timestamp in the comment item header, visible only when `comment.hh_sync_status` is present.

### 7.3 Comment Composer Enhancement

**File:** `app/components/Comments/ApplicationCommentComposer.vue`

Add "Send to hh.ru" toggle when the application is linked to hh.ru:

```
┌───────────────────────────────────────────┐
│  [Написать комментарий___________________] │
│  [Отправить]                  ☑ На hh.ru  │  <- toggle, checked by default
└───────────────────────────────────────────┘
```

- Toggle visible only when `application.hhNegotiationId` exists AND org has hh.ru config
- Default: checked (ON) — comments go to hh.ru by default for linked applications
- When unchecked: comment is saved with `hh_sync_status='local'` (internal only, not synced)
- Toggle label: "На hh.ru" with a small `Send` icon
- Uses `UiSegmented` or a simple checkbox-style toggle

**Modified submit flow:**

```typescript
async function submitComment() {
  const body = { text: commentText.value, isInternal: !sendToHh.value }
  // If sendToHh is false, mark as local-only
  if (!sendToHh.value) body.hhLocalOnly = true
  await $fetch(`/api/applications/${applicationId}/comments`, { method: 'POST', body })
  // Existing useApplicationComments handles the rest
}
```

### 7.4 Incoming Messages from Candidates

When a candidate sends a message on hh.ru, the background sync job creates a comment with `hh_direction='incoming'`. These render differently:

```
┌───────────────────────────────────────────┐
│  Кандидат · 15 сен, 14:40    [hh.ru ←]   │  <- left-aligned, candidate style
│  Спасибо! Буду рад обсудить.               │
└───────────────────────────────────────────┘
```

- Incoming comments have a distinct visual style: left-aligned, candidate avatar/name, light gray background
- This is already partially handled by the existing `ApplicationCommentItem` which supports different author types
- The `hh_direction='incoming'` field drives the styling

### 7.5 Manual Sync Button

**File:** `app/components/Comments/ApplicationCommentThread.vue`

Add a "Синхронизировать с hh.ru" button in the thread header (next to existing actions like "Watchers", "AI Summary"):

```
┌───────────────────────────────────────────┐
│  Обсуждение    [↻ Синхр. hh] [👁 Watchers] │
├───────────────────────────────────────────┤
│  ... existing comment list ...             │
└───────────────────────────────────────────┘
```

- Button visible only when application is linked to hh.ru
- `UiButton variant="ghost" size="sm" :icon-left="RefreshCw"`
- Click -> `$fetch('/api/hh/comments/sync', { method: 'POST', body: { applicationId } })` -> `toast.success('Синхронизировано')` -> `refreshNuxtData('comments')`
- Shows loading spinner during sync

### 7.6 Sync Status Indicator

Below the thread header, a subtle status line:

```
  Последняя синхронизация: 2 мин назад | Все комментарии синхронизированы
```

Or if there are pending/failed comments:

```
  ⚠ 2 комментария ожидают отправки на hh.ru | [Синхронизировать]
```

- Computed from comments array: count where `hh_sync_status` is `pending` or `failed`
- If 0 pending -> show "Все комментарии синхронизированы" (green text)
- If >0 pending -> show warning with quick sync link

### 7.7 Failed Comment Retry

For comments with `hh_sync_status='failed'`:

- Show a small "Повторить" button on the comment item
- Click -> `$fetch('/api/hh/comments/send', { method: 'POST', body: { commentId } })` -> update status
- If retry fails again -> keep as `failed`, show error message

### 7.8 Existing `useApplicationComments` Composable Changes

**File:** `app/composables/useApplicationComments.ts`

The composable already handles comment CRUD. Changes needed:

1. **Create:** add `hhLocalOnly?: boolean` to the create body. When false/undefined and application is hh-linked, server sets `hh_sync_status='pending'` and triggers async send.
2. **List:** the response already includes all comments — just ensure `hh_sync_status`, `hh_direction`, `hh_message_id` fields are included in the API response.
3. **No new methods** — the sync is server-side (background job + manual trigger endpoint).

---

## 8. Summary — All New Files

### New Pages (7)

| File | Integration |
|---|---|
| `app/pages/dashboard/settings/hh-templates.vue` | #3 |
| `app/pages/dashboard/settings/hh-auto-respond.vue` | #6 |
| `app/pages/dashboard/jobs/[id]/stats.vue` | #2 |
| `app/pages/dashboard/jobs/[id]/negotiations.vue` | #8 |

### New Components (12)

| File | Integration |
|---|---|
| `app/components/hh/HhTemplateEditor.vue` | #3 |
| `app/components/hh/HhTemplateUseModal.vue` | #3 |
| `app/components/hh/HhBulkMessageModal.vue` | #7 |
| `app/components/hh/HhVacancyStats.vue` | #2 |
| `app/components/hh/HhStatsWidget.vue` | #2 |
| `app/components/hh/HhNegotiationList.vue` | #8 |
| `app/components/hh/HhNegotiationCard.vue` | #8 |
| `app/components/hh/HhNegotiationThread.vue` | #8 |
| `app/components/hh/HhSimilarVacancies.vue` | #10 |
| `app/components/hh/HhSimilarCandidates.vue` | #10 |
| `app/components/hh/HhAutoRespondRuleEditor.vue` | #6 |
| `app/components/hh/HhAutoRespondLog.vue` | #6 |

### Modified Existing Files (7)

| File | Changes | Integration |
|---|---|---|
| `app/components/SettingsSidebar.vue` | Add 2 nav items (templates, auto-respond) | #3, #6 |
| `app/components/AppTopBar.vue` | Add 2 job tabs (stats, negotiations) | #2, #8 |
| `app/pages/dashboard/applications/index.vue` | Add bulk message + hh status buttons to existing bulk bar | #7 |
| `app/pages/dashboard/jobs/new.vue` | Add "Save as Template" button | #3 |
| `app/pages/dashboard/index.vue` | Add `HhStatsWidget` to dashboard | #2 |
| `app/pages/dashboard/candidates/[id].vue` | Add `HhSimilarVacancies` widget | #10 |
| `app/pages/dashboard/jobs/[id]/index.vue` | Add `HhSimilarCandidates` widget | #10 |
| `app/components/Comments/ApplicationCommentItem.vue` | Add hh.ru sync status badges | #4 |
| `app/components/Comments/ApplicationCommentComposer.vue` | Add "Send to hh.ru" toggle | #4 |
| `app/components/Comments/ApplicationCommentThread.vue` | Add manual sync button + status indicator | #4 |
| `app/composables/useApplicationComments.ts` | Add `hhLocalOnly` to create body | #4 |

### New Composables (0)

All data fetching uses existing patterns (`useFetch`, `$fetch`, `refreshNuxtData`). No new composables needed — each page/component fetches its own data with `useFetch` and mutates with `$fetch`.

### Implementation Notes

- All new components go in `app/components/hh/` directory (new)
- All hh.ru pages use `definePageMeta({ middleware: ['auth', 'require-org'] })`
- Settings pages use `layout: 'settings'`, job detail pages use `layout: 'dashboard'`
- Permission checks: `usePermission({ hh: ['resource:action'] })` — client-side cosmetic only, server enforces
- Charts: reuse `AeChart.client.vue` + `baseCartesianOption()` from `chart-theme.ts`
- Modals: reuse `UiModal` with `size="lg"` for forms, `size="md"` for confirmations
- Toasts: `useToast()` for all mutation feedback
- Icons: `lucide-vue-next` — `FileText`, `BarChart3`, `MessageSquare`, `Zap`, `RefreshCw`, `Send`, `Search`, `Check`, `AlertCircle`, `Clock`
