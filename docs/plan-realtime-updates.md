# План: моментальные обновления (real-time) для всего приложения

> Цель: комментарии/обсуждения, уведомления, чаты кандидатов и статусы
> AI-проверок обновляются **мгновенно и сами**, без нажатия «обновить»
> и без ожидания опроса (как в ВК/Facebook).
>
> Статус документа: **план к утверждению** (код не менялся).

---

## 1. Краткое резюме

Real-time реально сделать, потому что в проекте **уже есть работающий
эталон** — SSE-поток непрочитанных для «Входящих» (Спринт 19.5):

- сервер: `server/api/conversations/unread-stream.get.ts`
- шина: `server/utils/comms/unreadBus.ts`
- клиент: `app/composables/useInboxUnread.ts` (`EventSource` + авто-reconnect)

План — **обобщить этот механизм** на все сущности через один общий SSE-канал
и одну общую шину событий, а затем заменить существующий polling. Мы НЕ
вводим WebSocket: SSE проще, уже проверен в этом проекте в проде, и покрывает
задачу «сервер → клиент» полностью.

**Выбор транспорта: SSE, а не WebSocket.**
- SSE уже работает в проекте (меньше риска, тот же паттерн).
- Nitro WebSocket требует `nitro.experimental.websocket: true` в
  `nuxt.config.ts` + `defineWebSocketHandler` — инфраструктуры сейчас нет.
- Нам нужна односторонняя доставка (сервер → клиент). Действия клиента
  (отправка сообщения, реакция) идут обычным REST — это уже реализовано.

---

## 2. Что есть сейчас (baseline)

| Сущность | Обновление сейчас | Задержка | Файлы |
|---|---|---|---|
| Бейдж «Входящие» | **SSE** ✅ | мгновенно | `useInboxUnread.ts`, `unread-stream.get.ts`, `unreadBus.ts` |
| Сообщения чата кандидата | polling 30с | до 30с | `Comms/CommsChatPanel.vue` L162–168 |
| Список диалогов (инбокс) | polling 30с | до 30с | `pages/dashboard/inbox.vue` L174–181 |
| AI-черновик ответа | polling 2.5с (лимит 4.5м) | до 2.5с | `Comms/CommsChatPanel.vue` L268–301 |
| **Комментарии/обсуждения** | **только при загрузке** ❌ | до F5 | `Comments/ApplicationCommentThread.vue`, `useApplicationComments.ts` |
| **Уведомления (колокольчик)** | polling 60с | до 60с | `useNotifications.ts` L109–117, `NotificationBell.vue` |
| Лента активности (timeline) | только при загрузке ❌ | до F5 | `useTimeline.ts` |
| Риски (AI) | polling backoff 2–6с, лимит 2м | 2–6с | `candidate/RiskCard.vue` L25–90 |
| Отчёт интервью (MyMeet) | polling backoff 3–6с, лимит 3м | 3–6с | `interview/MeetingReportCard.vue` L49–74 |

Наиболее заметные проблемы («лагает без F5»): **комментарии/обсуждения**
(нет обновления вообще), **уведомления** (до 60с), **лента активности**
(нет обновления). Их закрываем в первую очередь.

---

## 3. Целевая архитектура

### 3.1 Единая шина событий (обобщение `unreadBus`)

Новый файл `server/utils/realtime/eventBus.ts` — обобщённая версия
`unreadBus.ts`. Ключевые отличия:

- Подписка не только по `orgId`, но и опционально по `userId`
  (уведомления адресные — каждому пользователю своё).
- Событие несёт **тип** и **payload**, а не только «что-то изменилось».

```ts
// Псевдокод-контракт (детали при реализации)
export type RealtimeEvent =
  | { kind: 'comment.created';   applicationId: string; comment: {...} }
  | { kind: 'comment.updated';   applicationId: string; comment: {...} }
  | { kind: 'comment.deleted';   applicationId: string; commentId: string }
  | { kind: 'comment.reaction';  applicationId: string; commentId: string; ... }
  | { kind: 'notification.new';  userId: string; unread: number }
  | { kind: 'chat.message';      conversationId: string; applicationId?: string; message: {...} }
  | { kind: 'chat.unread';       unread: number }              // = текущий unreadBus
  | { kind: 'job.status';        entity: 'risk'|'mymeet'; entityId: string; status: string }
  | { kind: 'activity.new';      activity: {...} }

// Публикация: адресно по орг + (опц.) по конкретным пользователям
export function publish(orgId: string, event: RealtimeEvent, userIds?: string[]): void

// Подписка одного SSE-соединения (знает свой orgId + userId)
export function subscribe(orgId: string, userId: string, fn: (e: RealtimeEvent) => void): () => void
```

Правила адресации:
- События с `userId`-таргетом (уведомления) доставляются только подписчикам
  этого пользователя.
- Остальные события org-wide — фильтрация по видимости (напр. `isInternal`)
  делается либо на публикации (передаём список получателей), либо клиент
  игнорирует то, что ему не по правам. **Для внутренних комментариев —
  таргетировать по ролям на сервере** (не рассылать `isInternal` тем, кто
  их не должен видеть).

### 3.2 Единый SSE-эндпоинт

Новый файл `server/api/realtime/stream.get.ts` — по образцу
`unread-stream.get.ts` (те же заголовки, heartbeat 25с, `X-Accel-Buffering: no`,
`requireAuth`, скоуп по `activeOrganizationId`). Отличия:

- подписывается на `subscribe(orgId, userId, ...)`;
- пишет каждое событие как `data: ${JSON.stringify(event)}\n\n`;
- при подключении отдаёт начальный снапшот счётчиков (unread чат +
  уведомления) — чтобы бейджи были верны сразу.

Один эндпоинт на всё приложение → одно постоянное соединение на вкладку.

### 3.3 Единый клиентский композабл

Новый файл `app/composables/useRealtime.ts` — по образцу `useInboxUnread.ts`:

- открывает `new EventSource('/api/realtime/stream')` (один раз, из
  `AppTopBar.vue`, как сейчас `startInboxUnreadStream`);
- парсит событие и **раздаёт его в существующие `useState`**:
  - `comment.*` → обновляет `useState('app-comments:{applicationId}')`
    (тот же ключ, что `useApplicationComments`);
  - `notification.new` → обновляет счётчик и список (`useNotifications`);
  - `chat.message` / `chat.unread` → обновляет чат/бейдж;
  - `job.status` → снимает необходимость polling в RiskCard/MeetingReportCard;
  - `activity.new` → добавляет запись в `useTimeline`;
- авто-reconnect (как в `useInboxUnread`: переоткрытие через 5с при CLOSED);
- пауза при `document.visibilityState !== 'visible'` — опционально.

Важно: поскольку композаблы уже держат состояние в `useState` с
предсказуемыми ключами, real-time-обновление сводится к **записи в тот же
`useState`** — списки в UI обновятся реактивно, оптимистичные апдейты
остаются как есть.

---

## 4. Точки публикации событий (где дёргать шину на сервере)

| Событие | Где вызвать `publish(...)` | Точка в коде |
|---|---|---|
| `comment.created` | после INSERT + нотификаций | `server/api/applications/[id]/comments/index.post.ts` (после L173, перед ответом) |
| `comment.updated` | после PATCH | `comments/[commentId].patch.ts` |
| `comment.deleted` | после soft-delete | `comments/[commentId].delete.ts` |
| `comment.reaction` | после add/remove | `comments/[commentId]/reactions/index.post.ts`, `reactions/[emoji].delete.ts` |
| `notification.new` | внутри `createNotification` / `createNotificationsBulk` | `server/utils/comments/notifications.ts` L52, L74 (адресно по `userId`) |
| `chat.message` (входящее) | при записи входящего сообщения | `server/utils/comms/commsService.ts`, `telegramWebhooks.ts` (рядом с текущими `notifyUnreadChanged`) |
| `chat.message` (исходящее/AI-черновик) | при смене статуса draft | `server/utils/comms/assistantJobs.ts` |
| `chat.unread` | = текущий `notifyUnreadChanged` | оставить как есть (мигрировать в общую шину) |
| `job.status` (risk) | при переходе `running→completed/failed` | `server/utils/risk/worker.ts` L155/186 |
| `job.status` (mymeet) | при финализации | `server/utils/mymeet/worker.ts` |
| `activity.new` | внутри `recordActivity()` | `server/utils/**` (общий helper — одна точка) |

Правило: публикация — **best-effort** (try/catch, ошибки глотаем), никогда
не ломает основной запрос/воркер. Как уже сделано в `notifyUnreadChanged`.

---

## 5. Замена polling на клиенте

После включения SSE опрос заменяем поэтапно (сначала оставляем как fallback,
потом удаляем):

| Файл | Что убрать | На что заменить |
|---|---|---|
| `Comments/ApplicationCommentThread.vue` | нет polling (только on-mount) | реактивные апдейты из `useRealtime` |
| `useNotifications.ts` L109–117 | `setInterval(fetchUnreadCount, 60s)` | событие `notification.new` |
| `Comms/CommsChatPanel.vue` L162–168 | `setInterval(loadChat, 30s)` | событие `chat.message` |
| `pages/dashboard/inbox.vue` L174–181 | `setInterval(refresh, 30s)` | события `chat.*` |
| `Comms/CommsChatPanel.vue` L268–301 | draft-polling 2.5с | событие смены статуса draft |
| `candidate/RiskCard.vue` L25–90 | `pollUntilDone()` | событие `job.status` |
| `interview/MeetingReportCard.vue` L49–74 | `pollUntilDone()` | событие `job.status` |
| `useTimeline.ts` | нет polling | событие `activity.new` (prepend) |

Fallback: оставить лёгкий `refresh()` при `visibilitychange → visible` и
однократный fetch при монтировании (на случай пропущенных событий во время
разрыва соединения). Это дёшево и делает систему устойчивой.

---

## 6. Критично: масштабирование на несколько инстансов

Текущая шина `unreadBus.ts` работает **в памяти одного процесса** (это прямо
указано в комментарии файла, L4–6). Пока Railway-сервис = 1 инстанс — всё
работает. **При >1 инстансе** SSE-соединение может висеть на инстансе A, а
событие произойти на инстансе B — клиент его не получит.

Решение (обязательное перед горизонтальным масштабированием):
**PostgreSQL `LISTEN/NOTIFY`**.

- Postgres уже есть (`DATABASE_URL`, `postgres.js`).
- `publish()` дополнительно шлёт `pg_notify('realtime', payload)`.
- Отдельное «слушающее» соединение (`LISTEN realtime`) на каждом инстансе
  ретранслирует полученное в локальную in-memory шину → в SSE-подписчиков.
- Ограничение payload у `NOTIFY` ~8 КБ: если событие крупнее — слать
  «тонкое» уведомление (id + тип), а клиент дозапросит детали. Для наших
  событий (id + короткий превью) 8 КБ достаточно.

Рекомендация: заложить абстракцию `publish/subscribe` так, чтобы бэкенд шины
(in-memory ↔ LISTEN/NOTIFY) переключался флагом окружения, не трогая места
вызова. Сделать это можно сразу (недорого) или отдельным этапом.

---

## 7. Этапы работ (оценка)

| Этап | Содержание | Оценка |
|---|---|---|
| **0. Фундамент** | `eventBus.ts` (обобщение unreadBus), `realtime/stream.get.ts`, `useRealtime.ts`, монтаж в `AppTopBar.vue` | 1 день |
| **1. Комментарии/обсуждения** | publish в comments POST/PATCH/DELETE/reactions; приём в `useApplicationComments` через `useRealtime`; убрать зависимость от F5 | 1–1.5 дня |
| **2. Уведомления** | publish в `notifications.ts` (адресно по userId); приём в `useNotifications`; убрать polling 60с; фикс видимости `isInternal` | 1 день |
| **3. Чаты кандидатов** | publish входящих в `commsService`/`telegramWebhooks`; приём в `CommsChatPanel`/`inbox`; убрать polling 30с; мигрировать `unreadBus` в общую шину | 1.5–2 дня |
| **4. AI-статусы (risk/mymeet/draft)** | publish `job.status` из воркеров; убрать `pollUntilDone` и draft-polling | 1 день |
| **5. Лента активности** | publish в `recordActivity`; prepend в `useTimeline` | 0.5 дня |
| **6. Масштабирование** | `LISTEN/NOTIFY` бэкенд шины за флагом | 1–1.5 дня |
| **7. Тесты + прод-харднинг** | reconnect, дедуп событий, нагрузка, nginx `proxy_read_timeout`, права | 1–2 дня |

**Итого: ~1.5–2 недели.** MVP «всё заметное работает мгновенно» (этапы 0–2)
— **2–3 дня**.

---

## 8. Риски и как их закрываем

| Риск | Митигация |
|---|---|
| Несколько инстансов ломают in-memory шину | Этап 6 (LISTEN/NOTIFY); до него — держать 1 инстанс |
| Прокси/nginx рвёт SSE по таймауту | heartbeat 25с + `X-Accel-Buffering: no` — уже в эталоне |
| Пропуск событий при разрыве соединения | on-reconnect refetch + fetch по `visibilitychange` |
| Утечка `isInternal` через события | таргетирование по ролям на публикации |
| Дубли (событие + оптимистичный апдейт) | дедуп по `id` при вставке в `useState` |
| Рост числа открытых SSE-соединений | один общий поток на вкладку (не по одному на фичу) |
| Права/скоуп организации | `requireAuth` + скоуп по `activeOrganizationId` (как в эталоне) |

---

## 9. Определение готовности (Definition of Done)

- Новый комментарий/реакция другого пользователя появляется у всех открытых
  клиентов **без F5**, в пределах ~1с.
- Колокольчик уведомлений загорается **мгновенно** при упоминании/ответе.
- Новое входящее сообщение кандидата (hh/Telegram) появляется в открытом
  чате и в списке диалогов **сразу**.
- Карточки AI (риски, отчёт интервью) сами переходят в «готово» без опроса.
- Лента активности пополняется сверху в реальном времени.
- При обрыве сети клиент переподключается и досинхронизируется автоматически.
- Polling-таймеры удалены (или оставлены только как дешёвый fallback).

---

## 10. Файлы, которые появятся/изменятся (сводка)

**Новые:**
- `server/utils/realtime/eventBus.ts`
- `server/api/realtime/stream.get.ts`
- `app/composables/useRealtime.ts`

**Изменяемые (сервер — publish):**
- `server/utils/comments/notifications.ts`
- `server/api/applications/[id]/comments/index.post.ts`
- `server/api/applications/[id]/comments/[commentId].patch.ts`
- `server/api/applications/[id]/comments/[commentId].delete.ts`
- `server/api/applications/[id]/comments/[commentId]/reactions/*`
- `server/utils/comms/commsService.ts`, `telegramWebhooks.ts`, `assistantJobs.ts`
- `server/utils/risk/worker.ts`, `server/utils/mymeet/worker.ts`
- `server/utils/**` — общий `recordActivity()`
- (миграция) `server/utils/comms/unreadBus.ts` → общая шина

**Изменяемые (клиент — приём/удаление polling):**
- `app/components/AppTopBar.vue`
- `app/composables/useApplicationComments.ts`, `useNotifications.ts`,
  `useTimeline.ts`
- `app/components/Comments/ApplicationCommentThread.vue`
- `app/components/Comms/CommsChatPanel.vue`
- `app/pages/dashboard/inbox.vue`
- `app/components/candidate/RiskCard.vue`
- `app/components/interview/MeetingReportCard.vue`
- `app/components/NotificationBell.vue`
