# Аудит архитектуры прав и доступов (RBAC) — HuntFork ATS

> Диагностический документ (READ-ONLY анализ, код не менялся). Составлен для
> передачи задачи по рефакторингу прав другому агенту/разработчику.
> Стек: Nuxt 4, Vue 3 (SSR), better-auth (плагин organization), Drizzle/Postgres.

---

## 0. Контекст задачи

- Триггер: на `/dashboard` (и `/dashboard/jobs`) при F5 **мигают** группы вакансий
  по рекрутерам (свёрнутые на ~1с раскрываются, потом схлопываются).
- Корень мигания — **роль пользователя недоступна на SSR** (см. §4). Это симптом
  более общей архитектурной проблемы прав, поэтому чинить надо фундамент, а не
  один экран.
- Ранее состояние сворачивания перенесли с localStorage на `useCookie`
  (`dashboard/index.vue`, `jobs/index.vue`) — мигание стало ДОЛЬШЕ/заметнее,
  т.к. cookie убрала задержку чтения состояния и обнажила настоящую задержку —
  async-загрузку роли.

---

## 1. Как устроено сейчас (модель прав)

### Двухуровневая модель
1. **Org-роль** (`member.role`): `owner / admin / member(=рекрутер) / hiring_manager`
   — задаёт RBAC-права через better-auth Access Control.
2. **Job-роль** (`job_member.member_role`): `hiring_manager / recruiter / watcher /
   assignee` — это **НЕ граница безопасности**, а фильтр видимости/назначения.

### Источник правды
- `shared/permissions.ts` — единый AC (`createAccessControl`), импортируется
  И сервером (`server/utils/auth.ts`), И клиентом (`app/utils/auth-client.ts`).
- Формат прав: объектная нотация better-auth `{ resource: [actions] }`
  (например `{ job: ['create'] }`), НЕ строки `job:read`.
- Ресурсы: organization, job, candidate, application, document, comment,
  interview, emailTemplate, activityLog, scoring, sourceTracking, pipeline,
  company, department (+ default org/member/invitation от better-auth).
- Deny-by-default: да, работает (нет права → `hasPermission` = error → 403).

### Схема БД
- `member` (`server/database/schema/auth.ts:84-110`): org-членство. Поля
  `role` (default `member`), `status` (active|pending|rejected|suspended),
  `hmCanViewSalary`, `mustChangePassword`. Уникальность `(userId, organizationId)`.
- `job_member` (`server/database/schema/hm.ts:31-61`): job-назначение.
  `jobId, userId, memberRole, isPrimary`.
- `hm_decision` (`server/database/schema/hm.ts:72-109`): решения HM,
  first-decision-wins через partial unique index.

---

## 2. Клиентский слой

- `app/composables/usePermission.ts` (79 строк):
  - Роль грузится **асинхронно** через `authClient.organization.getActiveMemberRole()`
    (строка 51), обёрнуто в `if (import.meta.client)` (строка 61) — **SSR-ветки НЕТ**.
  - Возвращает `{ allowed, role, isLoading }`.
  - **Не кэширует**: каждый вызов = свой запрос роли. Страница с 5 вызовами =
    5 запросов (напр. `settings/members.vue` — 3 вызова).
  - Первый рендер: `allowed=false` пока роль не пришла → кнопки/разделы мигают.
- `app/composables/useCurrentOrg.ts`: активная орг через
  `authClient.useActiveOrganization()` (реактивный хук). Роль тут не грузится.
- Паттерн в UI: `usePermission({ resource: [action] })` → `allowed` в `v-if`.
  Примеры: `settings/index.vue:12-13`, `settings/members.vue:20-23`,
  `settings/ai/index.vue:48` (использует `isLoading` чтобы прятать мигание),
  `dashboard/index.vue:64-65` (берёт `role` напрямую для группировки),
  `jobs/index.vue:259`.
- Обход `usePermission`: `components/Comments/ApplicationCommentThread.vue:39-44`
  — свой `getActiveMemberRole()` в onMounted.

---

## 3. Серверный слой (enforcement — надёжный)

- `server/utils/requirePermission.ts` (89 строк) — ГЛАВНЫЙ гард. Сессия → активная
  орг → `auth.api.hasPermission({ headers, body:{ permissions } })`. Используется
  в **~295 файлах** `server/api`.
- `server/utils/requireAuth.ts` — то же без шага проверки прав (~65 файлов).
- `server/utils/requireHm.ts` — гард для `/api/hm/*`: роль ДОЛЖНА быть
  `hiring_manager` + status active; роль берётся **прямым SELECT из `member`**.
- Скоуп/видимость: `recruiterScope.ts` (`getOrgRole`, `getAssignedJobIds`),
  `hiringManager.ts` (`getHmFlags`, `isHiringManagerOnJob`),
  `comments/visibility.ts` (`getMemberRole`, `visibilityFilter`).
- RBAC применяется **per-handler** (`requirePermission`), НЕ через middleware.
- Мультитенантность строгая: почти всё скоупится по `activeOrganizationId`
  (берётся только из сессии, не из ввода пользователя).
- HM безопасен: read-only на уровне AC; действия (`/api/hm/decisions`) пишут
  `hm_decision` и двигают этап в СИСТЕМНОМ контексте `actorUserId:null`
  (у HM нет `application:update`); PII/зарплата вырезаются вручную.

---

## 4. КЛЮЧЕВАЯ ПРОБЛЕМА: роль недоступна на SSR

Три факта (это и есть корень мигания):
1. **better-auth НЕ кладёт роль в сессию** (`server/utils/auth.ts` — нет
   `customSession`/`additionalFields` для роли). В сессии только
   `activeOrganizationId` (`schema/auth.ts:37`).
2. **`usePermission` полностью client-only** (`usePermission.ts:61`) — при SSR
   роль неизвестна → `allowed=false` для всего → элементы по правам отсутствуют
   в SSR-HTML и «появляются»/«схлопываются» после клиентского фетча роли.
3. Роль резолвится только async (`getActiveMemberRole()`), результат **не попадает
   в SSR-payload**.

**Готовый серверный источник роли УЖЕ есть:**
`server/api/auth/me/membership.get.ts` — возвращает `{ role, status,
mustChangePassword, hmCanViewSalary, ... }` по активной орге. Его можно
прокинуть в SSR (`useState`) или расширить сессию better-auth.

Как мигание возникает на дашборде конкретно:
- `dashboard/index.vue:65` `groupTopJobs = computed(() => role === 'owner'||'admin')`.
- Пока роль `null` (SSR + первый тик) → плоский список без групп → всё раскрыто.
- Роль приходит (~1с) → список перестраивается в группы → применяется свёрнутое
  состояние из cookie → группы схлопываются. Это и есть вспышка.

---

## 5. Найденные баги / несоответствия

1. 🔴 **`hiring_manager` НЕ зарегистрирован в клиентском `authClient`**
   (`app/utils/auth-client.ts:14` — только `owner, admin, member`). Клиентский
   `checkRolePermission` не знает HM → для HM даёт неверный результат. Спасает
   лишь редирект HM с дашборда (глобальный middleware).
2. 🔴 **Терминологический баг в `server/utils/comments/visibility.ts:15-17`**:
   внутренние комментарии видят роли `owner/admin/recruiter`, но org-роли
   `recruiter` НЕ существует (рекрутер = `member`). Итог: org-`member` (рекрутер)
   НЕ видит внутренние комментарии наравне с HM. Вероятная логическая ошибка прав.
3. Комментарий в шапке `shared/permissions.ts:12` врёт («три роли»), фактически
   четыре.
4. `member` без `comment:update` (только create/read/delete) и без `job:delete`
   — by design, но нигде не задокументировано единым списком.

---

## 6. Дублирование (кандидаты на консолидацию)

- **Резолв роли из БД продублирован 5 раз**: `getOrgRole` (recruiterScope.ts),
  `getMemberRole` (visibility.ts, +status), `getHmFlags` (hiringManager.ts),
  запрос внутри `requireHm.ts`, эндпоинт `me/membership.get.ts`.
  **Нет единого `getActiveMemberRole(event)` на сервере.**
- `requireAuth` ≈ `requirePermission` без шага проверки прав (почти дубль).
- `usePermission` не кэширует → N запросов роли на странице.
- Клиентские middleware (`require-hm`, `require-approved-member.global`) дважды
  фетчат `/api/auth/me/membership`.

---

## 7. Рекомендованный порядок работ (для рефакторинга)

> Принцип: права — это фундамент/сквозная инфраструктура. Внедрять ДО новых
> модулей, иначе каждый новый модуль унаследует проблемы и мигание.

**Обязательно до новых модулей (минимальный фундамент):**
1. **Провести роль на SSR** — расширить сессию better-auth (`customSession`
   с проекцией роли) ИЛИ на SSR заполнять `useState('activeMemberRole')` из
   `/api/auth/me/membership`, чтобы `usePermission` читал роль синхронно.
   → убирает мигание ГЛОБАЛЬНО (не только дашборд).
2. **Единый серверный `getActiveMemberRole(event)`** — убрать 5 дублей резолва.
3. **Кэшируемый `usePermission`** — один источник роли на страницу
   (через `useState`/`useNuxtData`), а не N запросов.

**Параллельно / потом (не блокирует новые модули):**
- Починить 3 бага из §5 (HM в клиенте, visibility-роль, комментарий).
- Консолидировать `requireAuth`/`requirePermission`.

**После фундамента:** новые модули делать по единому паттерну
(регистрация ресурса в `permissions.ts` → `requirePermission` на сервере →
`usePermission` в UI) — быстро и без мигания.

---

## 8. Что проверять при ревью изменений прав

- Серверный enforcement НЕ ослаб: `requirePermission` на всех новых/тронутых
  эндпоинтах, `activeOrganizationId` только из сессии.
- Мультитенантность цела (всё скоупится по орг).
- SSR-роль корректна: нет hydration mismatch, мигание ушло, роль одинакова
  на сервере и клиенте.
- Клиентские проверки остаются косметикой (реальный гейт — на сервере).
- Дубли резолва роли не растут (использовать единый хелпер).
- Сборка `npm run build` (клиент + сервер) без ошибок.

---

## 9. Быстрый индекс файлов

| Что | Путь |
| --- | --- |
| Матрица прав (AC) | `shared/permissions.ts` |
| better-auth сервер | `server/utils/auth.ts` |
| better-auth клиент | `app/utils/auth-client.ts` |
| Клиентский хук прав | `app/composables/usePermission.ts` |
| Активная орг (клиент) | `app/composables/useCurrentOrg.ts` |
| Главный серверный гард | `server/utils/requirePermission.ts` |
| Гард без прав | `server/utils/requireAuth.ts` |
| Гард HM | `server/utils/requireHm.ts` |
| Скоуп рекрутера | `server/utils/recruiterScope.ts` |
| HM job-доступ | `server/utils/hiringManager.ts` |
| Видимость комментариев | `server/utils/comments/visibility.ts` |
| Роль с сервера (готовый) | `server/api/auth/me/membership.get.ts` |
| Схема member/session | `server/database/schema/auth.ts` |
| Схема job_member/hm | `server/database/schema/hm.ts` |
| Мигание (дашборд) | `app/pages/dashboard/index.vue:64-115` |
| Мигание (вакансии) | `app/pages/dashboard/jobs/index.vue` |
