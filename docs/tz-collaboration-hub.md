# ТЗ — Collaboration Hub: модуль «Обсуждения» 2.0

Дата: 07.09.2026 · Статус: к реализации (Этап 1)
Связанные документы:
[funnel-architecture.md](./funnel-architecture.md) (воронка, `application.currentStageId` → `pipeline_stage`),
[role-model-and-permissions.md](./role-model-and-permissions.md) (видимость `is_internal`, права `comment`/`application`),
[candidate-master-profile.md](./candidate-master-profile.md) (кандидат ↔ отклики, риск-профиль),
исходный разбор фичи — `server/utils/comments/*`, `app/components/Comments/*`.

---

## 1. Суть и мотивация

Сегодня «Обсуждение» на отклике (`ApplicationCommentThread`) — плоский тред комментариев одного отклика: mentions, реакции, вложения, watchers, уведомления (миграция `0041_collaboration_thread`). Этого мало для реальной работы команды:

1. **Один кандидат — несколько откликов.** `application` уникальна по `(organizationId, candidateId, jobId)`, то есть человек может откликнуться/быть добавлен на несколько вакансий. Обсуждения по каждому отклику изолированы — рекрутер не видит, что уже обсуждали этого же кандидата на другой вакансии.
2. **Контекст «почему обсуждаем» живёт отдельно.** AI-скрининг (`/api/applications/:id/scores`) и оценка рисков (`/api/candidates/:id/risk-profile`) — на других экранах/карточках. В обсуждении их приходится пересказывать руками.
3. **UI аскетичный.** Тред без «шапки контекста», без разделения человек/система, плоский (reply отключён), поллинг вместо realtime.

**Цель:** превратить «Обсуждение» в **контекстный командный хаб по кандидату** — вкладки по всем откликам человека (писать только в текущий), живые виджеты AI-результатов, единый timeline и капитальный UI.

---

## 2. Философия и принципы

1. **Кандидат — единица контекста, отклик — единица действия.** Смотрим по всем откликам кандидата; пишем/реагируем — только в текущем.
2. **Виджеты, а не копипаст.** AI-скрининг и риски втягиваются как типизированные карточки (sticky-шапка + pin-снимок в ленту), а не как текст руками.
3. **Read-only ≠ мёртвый.** Чужие вкладки видно, но действия заблокированы и на UI, и на сервере; визуально «остужены» цветом.
4. **Без ломающих изменений.** Каждый этап аддитивен: существующий `ApplicationCommentThread` продолжает работать; правки в схему — только новые nullable-поля/таблицы.
5. **Безопасность tenant-first.** Любая выборка по org; видимость `is_internal` по роли не ослабляется (`server/utils/comments/visibility.ts`).

---

## 3. Что уже есть (фиксация текущего состояния)

| Компонент | Текущее поведение |
| --- | --- |
| Тред отклика | `application_comment` (+ mentions/reactions/attachments/watchers/notifications), API `server/api/applications/[id]/comments/*` |
| Видимость | owner/admin/recruiter видят всё; hiring_manager/member — только `is_internal=false` (сервер, `visibility.ts`) |
| UI | `app/components/Comments/ApplicationCommentThread.vue` + Item/Composer/Reactions/Attachment/StickerPicker; composable `useApplicationComments.ts` |
| Кандидат ↔ отклики | `application.candidateId`, индекс `application_candidate_id_idx`, uniq `(org, candidate, job)`; список отдаёт `GET /api/applications?candidateId=...` (вакансия, этап, цвет этапа) |
| AI-скрининг | `GET /api/applications/:id/scores` → `compositeScore`, разбивка по критериям (strengths/gaps/confidence), последний `analysisRun` |
| Оценка рисков | `GET /api/candidates/:id/risk-profile` → `overallRisk` (low/medium/high), `overallScore`, `summary`, `findingsJson`, `tenureJson`, флаг `stale`; риск привязан к версии резюме и общий для всех откликов кандидата |
| Timeline / аудит | `recordActivity()` + `GET /api/applications/:id/stage-history` |
| Realtime-паттерн | SSE уже применён в `server/api/conversations/unread-stream.get.ts` |

---

## 4. Целевая структура окна обсуждений

```
┌────────────────────────────────────────────────────────────┐
│ Обсуждение · Иван Петров                                     │
│ ┌───────────┬───────────────┬───────────────┐               │  ← Вкладки откликов
│ │ ● Backend │ Frontend (👁)  │ DevOps (👁)    │  …            │    текущий = brand,
│ │  (текущий)│  розоватый     │  розоватый     │               │    чужие = rose + «глаз»
│ └───────────┴───────────────┴───────────────┘               │
│ ┌──────────────────────┐ ┌──────────────────────┐           │  ← Sticky-виджеты
│ │ 🤖 AI-скрининг: 78    │ │ ⚠ Риск: high · 3     │           │    (контекст-шапка,
│ │ gaps: Go, k8s   [↧]  │ │ частые смены   [↧]   │           │     сворачиваемые)
│ └──────────────────────┘ └──────────────────────┘           │
│ ────────────────────────────────────────────────            │
│  Лента (тред + системные события + pin-виджеты)             │  ← Timeline
│  …                                                          │
│ ────────────────────────────────────────────────            │
│  [ Композер ] (только для текущего отклика)                  │  ← Действие
└────────────────────────────────────────────────────────────┘
```

### 4.1 Цветовые токены вкладок

| Вкладка | Токены | Смысл |
| --- | --- | --- |
| Текущий отклик | `brand-*` (синий), точка-индикатор | «здесь я работаю» |
| Другой отклик (в работе) | `rose-50/100` фон, `rose-200` рамка, иконка «глаз» | «только просмотр» |
| Другой отклик (терминальный: нанят/отказ) | серый, приглушённый, бейдж этапа | «архив, только просмотр» |

Каждая вкладка несёт бейдж вакансии + этап воронки (цвет из `pipeline_stage.color`) и счётчик комментариев.

---

## 5. Функциональные требования по этапам

### Этап 0 — Редизайн UX (фикс-окно чата) ✅ реализовано

Мотивация: длинная переписка растягивала карточку отклика (тред жил в скролле страницы без ограничения высоты).

- **0.1 Фикс-окно**: `ApplicationCommentThread` — `flex flex-col` с ограниченной высотой (`max-h-[min(60vh,640px)]`, в drawer/tabs — `expanded` → `h-full`). Sticky-хедер (заголовок + подписчики + «развернуть»), sticky-футер (композер/снимки), скроллится **только** зона ленты. `CandidateDiscussionTabs` тоже стал flex-контейнером: вкладки+виджеты — `flex-none` шапка, тред — `flex-1`.
- **0.2 Скролл-поведение**: автоскролл вниз при открытии; плавающая кнопка «Вниз»/«N новых», когда пользователь не у низа; при новом сообщении доскролл только если уже был внизу (не мешаем чтению истории).
- **0.3 Навигация**: липкие разделители дней (`ThreadDayDivider`: Сегодня/Вчера/дата), линия «Новые сообщения» (`ThreadNewMessagesLine`) по отметке прочтения (`lastSeenAt` в localStorage).
- **0.4 Режим фокуса**: кнопка «Развернуть» (Maximize2) → `ApplicationDiscussionDrawer` — обсуждение во весь экран справа (Teleport + useEscapeStack). В drawer отклика кнопка скрыта (`canExpand=false`).
- **0.5 Полиш**: единый каркас/бордеры/бейджи; i18n `thread_ui.*`.
- Composable: `renderRows` (дни + линия «новые»), `unseenCount`, `loadLastSeen()`, `markSeen()`.
- Файлы: `ApplicationCommentThread.vue`, `CandidateDiscussionTabs.vue`, `ApplicationDiscussionDrawer.vue`, `ThreadDayDivider.vue`, `ThreadNewMessagesLine.vue`, `useApplicationComments.ts`; интеграция в `pages/dashboard/applications/[id].vue`, `pages/dashboard/jobs/[id]/index.vue`, `ApplicationDetailDrawer.vue`.

### Этап 1 — Вкладки по откликам кандидата (read-only для чужих) ✅ первый

- Компонент-обёртка `CandidateDiscussionTabs.vue` над `ApplicationCommentThread`.
- Источник вкладок — `GET /api/applications?candidateId=<id>` (переиспользуем; данные вакансии/этапа/цвета уже есть). Счётчик комментариев на отклик — лёгким агрегатом (доп. эндпоинт или расширение выборки).
- Текущий отклик активен по умолчанию; полный функционал (писать/реагировать/вложения/edit/delete).
- Другие отклики: проп `readOnly` в тред → скрыть композер, меню действий, реакции-тоглы, watcher-управление. Остаётся только чтение.
- **Серверный guard:** read-only обеспечивается уже существующей моделью прав (POST/PATCH/DELETE требуют `application:update`, автор/роль). Дополнительно: UI не даёт писать в неактивную вкладку; повторно проверяется на сервере (не полагаемся на скрытие кнопки).
- Видимость `is_internal` на чужих вкладках работает как раньше (НМ не увидит внутренние).
- Цветовое разграничение + бейджи вакансии/этапа.
- i18n RU/EN.

**Не входит в Этап 1:** запись в чужие вкладки, виджеты, realtime.

### Этап 2 — Sticky-виджеты AI-скрининга и рисков (просмотр) ✅ реализовано

- Компактные карточки над тредом: скрининг (балл + топ-2 gaps) и риск (уровень + summary + счётчик находок), сворачиваемые (состояние в `useState`), кнопка «Подробнее» → страница отклика / карточка кандидата.
- Скрининг берётся из scores **активной** вкладки (per-application, `/api/applications/:id/scores`); риск — из candidate risk-profile (общий, `useResumeRisk`), с бейджем `stale` при устаревании.
- Пустые состояния: «скрининг не запускался» / «риск не оценивался».
- Файлы: `app/components/Comments/DiscussionContextWidgets.vue`, встроен в `CandidateDiscussionTabs` над тредом; i18n `discussion_widgets.*`.

### Этап 3 — Pin-виджеты в ленту (снимок + аудит) ✅ реализовано

- Кнопки «Прикрепить результат» (AI-скрининг / Оценка рисков) над композером → системный комментарий-виджет со снимком данных на момент вставки.
- Схема: `application_comment.kind` (nullable text; NULL/'text' — обычный комментарий, 'ai_screening_snapshot' | 'risk_snapshot' | 'system_event') + `payload_json jsonb`. Миграция `0090_comment_kind_payload` (аддитивная) + journal-запись.
- **Снимок собирается на сервере** (`POST /api/applications/:id/comments/snapshot`), не принимаем payload от клиента — достоверность и фиксация обсуждаемой версии (флаг `stale` в риск-снимке). Снимки не редактируются (только удаляются), markdown не рендерится.
- Файлы: `snapshot.post.ts`, `CommentSnapshotWidget.vue`, рендер в `ApplicationCommentItem`, метод `attachSnapshot()` в composable, i18n `comment_snapshot.*`.
- GET `/comments` теперь отдаёт `kind` + `payloadJson`.

### Этап 4 — Timeline-события + realtime ✅ реализовано

- Единая лента: комментарии/снимки + события смены этапа (`stage-history`), отсортированные по времени. События рендерятся отдельным компактным компонентом `ThreadStageEvent`. Слияние — на клиенте (без дублирующих строк в БД).
- SSE-стрим `GET /api/applications/:id/thread-stream` по паттерну `unread-stream.get.ts`: лёгкий пинг при любом изменении треда → клиент дебаунс-рефетчит ленту. Мгновенное появление у всех открывших отклик, замена поллинга.
- Шина `server/utils/comments/threadBus.ts` (in-memory pub/sub, как `unreadBus`); `notifyThreadChanged()` вызывается из create/patch/delete комментария, add/remove реакции, snapshot и из `moveApplicationStage` (все пути смены этапа).
- Клиент: `useApplicationComments` → `timeline`, `fetchStageHistory()`, `connectStream()`; тред подписывается в `onMounted`, отписка в `onBeforeUnmount`.
- i18n `thread_events.*`. Для мультиинстанса шину заменить на PG LISTEN/NOTIFY (отмечено в коде).

### Этап 5 — Продвинутое (беклог идей) ⏸ ОТЛОЖЕН

Статус: зафиксирован, к реализации после редизайна (Этап 0 завершён). Новые фичи ложить в уже единый визуальный язык.

- Reply-цепочки: `parentCommentId` уже в схеме — включить threaded-UI (сейчас `can-reply=false`).
- Задачи из упоминаний: `@user проверь диплом` + чекбокс → лёгкий to-do на watcher.
- Быстрые ответы/шаблоны внутренних заметок.
- Фильтр/поиск по треду: «только внутренние», «с упоминанием меня», «только виджеты».
- ИИ-сводка обсуждения (TL;DR).
- Кросс-откликовая заметка о кандидате (target `candidate` в generic `comment`) — закреплена во всех вкладках.

---

## 6. Модель данных (изменения)

| Этап | Изменение | Тип |
| --- | --- | --- |
| 1 | — (переиспользуем `application`, `application_comment`) | нет миграций |
| 3 | `application_comment.kind` (enum, default `text`), `application_comment.payload_json` (jsonb, nullable) | аддитивная миграция |
| 4 | — (события читаются из `activity`/`stage-history`); опц. materialized-лента позже | нет обязательных |

Инвариант: все новые поля nullable/с дефолтом — старый код и тред продолжают работать.

---

## 7. API (изменения)

| Этап | Эндпоинт | Назначение |
| --- | --- | --- |
| 1 | `GET /api/applications?candidateId=…` (существует) | список откликов кандидата для вкладок |
| 1 | (опц.) счётчик комментариев на отклик | бейдж на вкладке |
| 2 | `GET /api/applications/:id/scores` (существует) | виджет скрининга |
| 2 | `GET /api/candidates/:id/risk-profile` (существует) | виджет риска |
| 3 | `POST /api/applications/:id/comments` (расширить `kind`/`payload`) | pin-снимок |
| 4 | `GET /api/applications/:id/thread-stream` (SSE) | realtime ленты |

---

## 8. Права и видимость

- Чтение вкладок: `application:read` (org-scoped). Внутренние комментарии фильтруются по роли на сервере — без изменений.
- Запись: только текущий отклик, `application:update`/`comment:create`, автор/роль как сейчас.
- Read-only чужих вкладок гарантируется сервером (существующие guard'ы), UI лишь отражает.

---

## 9. Порядок реализации

1. **Этап 1** — вкладки + read-only + цвета + i18n (текущий заход).
2. Этап 2 — sticky-виджеты.
3. Этап 3 — pin-снимки (миграция `kind`/`payload_json`).
4. Этап 4 — timeline + SSE.
5. Этап 5 — по приоритету из беклога.
