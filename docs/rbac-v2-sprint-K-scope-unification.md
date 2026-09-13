# Спринт K — Унификация scope-резолвера + фикс «плашки чужих вакансий» + чтение чужого треда

> Финализация scope-модели рекрутера. Устраняет КОРНЕВОЙ дефект: **четыре**
> независимых резолвера дефолта scope, из которых один (`scope.ts:defaultScopeForRole`)
> рассинхронён (member→`org` вместо `assigned`). Это причина бага «во вкладке
> Вакансии видны чужие плашки, а внутрь — 404».
>
> Дополняет `docs/rbac-v2-sprint-H-recruiter-model.md`,
> `docs/rbac-v2-sprint-J-recruiter-fixes.md`, `docs/rbac-v2-security-invariants.md`.
> Процесс: доступы = высокий риск → сверка ДО прод-деплоя; полная
> `npm run build` (клиент+сервер); деплой `--no-cache` (урок C1).

**Точка входа при возврате:** master-plan.md + security-invariants.md +
roles-glossary.md → `server/utils/access/` (actorContext → can → scope) →
`server/utils/recruiterScope.ts` + `server/utils/analytics/scope.ts`. Правка прав
роли — `shared/access/role-presets.ts`.

---

## 0. Диагноз (сверено с кодом на HEAD = 3388e3f)

### 0.1 Корневой дефект: ЧЕТЫРЕ источника истины для scope-дефолта

Инвариант **C1 «Единый источник истины прав»** нарушен для `defaultScope`. Один
факт («какой scope у роли по умолчанию») определяется в 4 местах:

| # | Источник | member → | Кто читает | Статус |
|---|---|---|---|---|
| 1 | `shared/access/role-presets.ts:170` | `assigned` | сид ролей в БД (`role.defaultScope`) | ✅ верно |
| 2 | `server/utils/access/actorContext.ts:80` `defaultScopeTypeForRole` | `assigned` | `getActorContext` → **карточки**, `requirePermission`, guard'ы `requireXInScope` | ✅ верно |
| 3 | `server/utils/access/scope.ts:214` `defaultScopeForRole` | **`org`** ❌ | `resolveUserScopeJobIds` → **списки/дашборд/аналитика** | 🔴 РАССИНХРОН |
| 4 | (транзитивно) `recruiterScope.ts` + `analytics/scope.ts` | наследуют #3 | вкладка «Вакансии», dashboard/stats, interviews, analytics/* | 🔴 через #3 |

**Важно:** #3 — это *fallback*. Он срабатывает, только если у member НЕТ строки в
`member_scope`. Если backfill проставил `member_scope.scopeType='assigned'` — читается
БД (верно), баг спит. Если строки нет (новый member, непро-бэкфиленный, или scope не
сохранён) — списки думают `org`, карточки думают `assigned`. → **недетерминированный
баг «у одних работает, у других нет»**.

### 0.2 Точный механизм бага «плашки чужих вакансий»

```
GET /api/jobs         → resolveRecruiterScope(orgId, userId)         [recruiterScope.ts]
                      → resolveUserScopeJobIds(orgId, userId)         [scope.ts]
                      → defaultScopeForRole('member') = 'org'  (scope.ts:214) ❌
                      → scopeIds = null → { scoped:false }
                      → фильтр inArray(job.id, ...) НЕ добавляется
                      → возвращаются ВСЕ вакансии орга               (jobs/index.get.ts:27)

GET /api/jobs/:id     → getActorContext → defaultScopeTypeForRole('member') = 'assigned' ✅
                      → requireJobInScope → job не в scope → 404
```
Результат: список отдаёт чужие вакансии, карточка их 404-ит. **Симптом воспроизведён
по коду.** Владелец: «вижу плашки вакансий, на которые не добавлен; захожу — доступа
нет; но и видеть их не должен».

### 0.3 Сопутствующее: комментарий scope.ts:214 противоречит принятой модели

`// §A2: member default → org (sees all; narrow via override)` — это ОТМЕНЁННОЕ
решение §A2. §H/§J приняли `member = assigned`. Комментарий и код — легаси, не
обновлены при §H. Это же место — источник рассинхрона.

### 0.4 Что уже верно (НЕ трогать)
- `getActorContext` / `defaultScopeTypeForRole` (#2) — `assigned`. ✅
- `role-presets` (#1) — `assigned`. ✅
- `jobs/index.get` при `override='mine'` использует `getPersonalJobIds` — не подвержен
  (там явный job_member). Баг только на дефолте/`all`.
- Guard'ы `requireXInScope`, `candidateScopeCondition` (после §J) — типобезопасны, ок.

---

## 1. Продуктовая модель (ФИКСИРУЕТСЯ этим ADR — менять только новым ADR)

Чтобы прекратить миграции модели туда-обратно (§A2 org → §H assigned → §J createdById):

| Роль (`member.role`) | scope по умолчанию | Видит вакансии | Видит кандидатов |
|---|---|---|---|
| `owner` / `admin` | `org` (unrestricted) | все | все |
| `lead_recruiter` | `org` | все (тумблер Мои/Все) | все |
| `hrbp` | `hrbp` | компании/отделы назначения | по scope |
| **`member` (Рекрутер)** | **`assigned`** | только job_member(recruiter) ИЛИ создатель | добавленные им (`createdById`) ИЛИ откликнувшиеся на его вакансии |
| `external_recruiter` | `assigned` | только job_member(recruiter) | по scope, **без PII/ИИ** (разница в правах) |
| `hiring_manager` | `jobs` | назначенные (кабинет `/hm/*`) | через HM-контур |

**Разница member vs external — в ПРАВАХ (PII/ИИ), НЕ в scope-типе.** Оба `assigned`.
`own`-как-отдельный-scopeType НЕ вводим (решение владельца, ревью). `candidate.createdById`
(§J, реальная колонка) — послабление видимости кандидата, применяется к обоим,
безвредно для hh (там `createdById=NULL`).

---

## 2. ЧАСТЬ 1 — Единый резолвер scope-дефолта (КОРНЕВОЙ ФИКС) 🔴

**Цель:** один источник истины. `role-presets.defaultScope` — канон; все резолверы
читают его. Рассинхрон становится структурно невозможным (инвариант C1).

### 2.1 `shared/access/role-presets.ts` — экспортировать хелпер
- [ ] Добавить чистую функцию:
  ```ts
  export function defaultScopeForRoleKey(roleKey: string): ScopeType {
    return ROLE_PRESET_BY_KEY[roleKey]?.defaultScope ?? 'assigned' // deny-safe дефолт
  }
  ```
  `??'assigned'` — безопасный дефолт (уже, не шире): неизвестная роль не получает org.
  Расположить в shared/ (доступен и серверу, и клиенту; чистая функция, unit-тест без БД).

### 2.2 `server/utils/access/scope.ts:200-216` — заменить тело `defaultScopeForRole`
- [ ] Удалить локальный `switch`. Заменить на:
  ```ts
  import { defaultScopeForRoleKey } from '../../../shared/access/role-presets'
  function defaultScopeForRole(roleKey: string): ScopeType {
    return defaultScopeForRoleKey(roleKey)
  }
  ```
  (или инлайн-вызов). Убрать легаси-комментарий §A2. **Это чинит member `org`→`assigned`
  → баг «плашки чужих вакансий» исчезает** (список станет scoped, как карточка).

### 2.3 `server/utils/access/actorContext.ts:64-82` — заменить тело `defaultScopeTypeForRole`
- [ ] Тоже читать из `defaultScopeForRoleKey`. Сейчас значения совпадают, но держать
  ДВА switch — это дубль, который снова разойдётся. Свести к одному источнику.
- [ ] Проверить: `AccessScope`/`ScopeType` совместимы (они из `shared/access/capabilities`,
  а preset тоже оттуда — импорт согласован).

### 2.4 Проверка отсутствия других switch по scope-дефолту
- [ ] `grep -rn "case 'member'" server/ shared/ | grep -i scope` → должно остаться 0
  локальных таблиц дефолта (только через `defaultScopeForRoleKey`).

**Acceptance 1:** под member (без явного member_scope) `GET /api/jobs` возвращает ТОЛЬКО
назначенные/созданные вакансии; чужие плашки исчезают; карточка любой видимой открывается
(нет 404 на то, что в списке). Список и карточка консистентны.

---

## 3. ЧАСТЬ 2 — Единая функция резолва (убрать дубль путей) 🟠

**Проблема:** `getActorContext.resolveMemberScope` (карточки) и `resolveUserScopeJobIds`
(списки) — две реализации «что видит юзер». Даже с общим дефолтом (Часть 1) остаётся
риск разной обработки `member_scope`/edge-case. `audit-rbac.md` называл «5 дублей
резолва роли» исходной болезнью — §H/§I убили дубли РОЛИ, но остались дубли SCOPE.

### 3.1 Свести чтение member_scope к одному хелперу
- [ ] Вынести «прочитать `member_scope` → иначе дефолт роли» в ОДНУ функцию
  `resolveEffectiveScope(memberId, roleKey): AccessScope` в `scope.ts`.
- [ ] `actorContext.resolveMemberScope` и `resolveUserScopeJobIds`/`scopeJobIdsCore`
  вызывают её (не дублируют fallback-логику).
- [ ] НЕ менять поведение — только устранить дубль. Проверить паритет (см. G1).

### 3.2 Задокументировать 4 потребителя как «read-only проекции одного резолвера»
- [ ] В шапке `recruiterScope.ts` и `analytics/scope.ts` явно указать: «дефолт scope —
  из `defaultScopeForRoleKey`; НЕ определять свой». Защита от повторного дрейфа.

**Acceptance 2:** dashboard/stats, jobs/index, interviews/index, analytics/* дают
СОГЛАСОВАННЫЕ цифры под member (одинаковый набор вакансий во всех). Тумблер Мои/Все
работает; «Все» для member = его scope (не вся орг), «Все» для lead = вся орг.

---

## 4. ЧАСТЬ 3 — Инвалидация + миграция данных

### 4.1 bump `permissions_version` при смене scope
- [ ] Убедиться (проверить, не факт что есть): изменение `member_scope` бампает
  `member.permissions_version` → per-request кэш actor (TTL) обновляется ≤60c (C5).
  Если нет — добавить bump в местах записи member_scope (`access/members/[id]/scope`).

### 4.2 Backfill member_scope для консистентности
- [ ] Идемпотентная seed-миграция: для активных member без строки `member_scope` —
  создать `member_scope(scopeType='assigned')`. Убирает зависимость от fallback #3
  (после Части 1 fallback уже верный, но явная строка = детерминизм + видимо в UI).
- [ ] bump `permissions_version` затронутых. Бэкап `rbac_pre_K_*` ДО миграции.

**Acceptance 3:** у каждого активного member есть явная `member_scope`; смена scope в
UI применяется ≤60c без перелогина.

---

## 5. ЧАСТЬ 4 — Пункт 2 владельца: чтение чужого треда того же кандидата 🟡

> **Требование:** «Рекрутер Б видит (только читает) обсуждение отклика Ивана на
> вакансию А» — общий кандидат, чужой отклик, read-only тред. Меньше работы, чем
> полный доступ; осознанное частичное послабление scope.

### 5.1 Текущее состояние (сверено)
`server/api/applications/[id]/comments/index.get.ts:32` жёстко режет
`requireApplicationInScope` → рекрутер Б (не в scope отклика Ивана) получает **404**.
Сейчас чужой тред закрыт полностью. Пункт 2 = осознанно приоткрыть ЧТЕНИЕ.

### 5.2 Модель послабления (важно НЕ сломать §G write-model)
Разрешить **чтение** треда чужого отклика, ЕСЛИ речь об общем кандидате, к которому у
актора есть легитимный доступ (он видит этого кандидата в своём scope — по §J:
`createdById` ИЛИ откликнулся на его вакансию). Запись — по-прежнему §G (scope отклика).

- [ ] Новый хелпер `requireApplicationThreadReadable(event, applicationId, orgId)`:
  - true если `isApplicationInScope` (как сейчас) — свой отклик; ИЛИ
  - true если `application.candidateId` В scope актора (`isCandidateInScope`) — общий
    кандидат: другой отклик того же человека читаем.
  - иначе 404.
- [ ] Применить ТОЛЬКО к READ-эндпоинтам обсуждения:
  `applications/[id]/comments/index.get.ts` (лента), и связанным read
  (`[commentId]` get, реакции-list, если есть). Заменить `requireApplicationInScope`
  на новый read-хелпер.
- [ ] WRITE обсуждения (`index.post`, `[commentId].patch/delete`, `snapshot.post`,
  `summarize.post`) — ОСТАВИТЬ на `requireApplicationInScope` (писать только в свой
  scope). Read-послабление НЕ распространять на запись.
- [ ] UI: если тред открыт по «чужому» отклику (read-only режим) — composer
  disabled + подсказка «Обсуждение другого отклика этого кандидата — только чтение».
  Флаг `threadReadOnly` из ответа API.

### 5.3 Границы послабления (защита от переовершаринга)
- [ ] Read-послабление действует ТОЛЬКО когда кандидат в scope актора. Если кандидат
  НЕ в scope (не его, не откликался на его вакансии) → 404 (как сейчас). Не открываем
  тред произвольного чужого кандидата.
- [ ] PII в ленте треда (снапшоты AI-скрининга/риска с контактами) — по-прежнему через
  masking по правам (member без `candidate:read:contacts` не увидит контакты в снапшоте).
  Проверить, что `payloadJson` снапшотов маскируется на выходе (D1).
- [ ] external_recruiter: послабление НЕ давать (жёсткая изоляция) — read-хелпер для
  external остаётся строгим (только свой scope). Различать по роли внутри хелпера ИЛИ
  не включать external в «candidate-in-scope» ветку.

**Acceptance 4:** рекрутер Б, у которого Иван в scope (общий кандидат), открывает
отклик Ивана на чужую вакансию А → видит ленту обсуждения read-only, composer disabled,
писать не может (403 на post). Рекрутер В, у которого Ивана нет в scope → 404.
external → 404 (без послабления). Внутренние снапшоты с PII маскируются по правам.

---

## 6. ЧАСТЬ 5 — Тесты: разорвать цикл «зелёно, но падает» 🔴

> Урок §J: `audit-coverage=0`, `869 tests`, `vue-tsc 0` — ВСЕ зелёные, а прод падал
> (битый `sql`${undefined}``). Гейты мерили не то. Баг §J и рассинхрон scope прошли бы
> все текущие проверки. **Нужен исполняемый тест scope, а не «строка есть»/«колонка есть».**

### 6.1 Исполняемая матрица scope (главная страховка)
- [ ] Тест, который РЕАЛЬНО исполняет scope-условия против БД (тест-Postgres/контейнер
  или, минимум, компилирует SQL и проверяет отсутствие `undefined`/пустых фрагментов).
- [ ] Матрица: роль {owner,admin,lead,member,external,hrbp,hm} × ресурс
  {job,candidate,application,document,interview,conversation} × кейс {свой,чужой,общий
  кандидат} → ожидаемый результат {виден/200, 403, 404, masked}.
- [ ] Явно кейс бага K: member без member_scope → jobs list scoped (НЕ вся орг);
      member → карточка чужой вакансии = 404; список ⊆ доступным карточкам (нет «плашки
      без входа»).
- [ ] Явно кейс §J: `candidateScopeCondition` под member компилируется в валидный SQL
      (нет raw-sql-по-несуществующей-колонке).

### 6.2 Инвариант «список ⊆ доступные карточки»
- [ ] Тест-свойство: для любой роли всё, что вернул `GET /api/jobs`, ДОЛЖНО открываться
  через `GET /api/jobs/:id` (нет элемента списка, который 404-ит). Это ловит рассинхрон
  список↔карточка как класс, а не точечно.

### 6.3 Усилить/пометить audit-coverage
- [ ] В `scripts/audit-scope-coverage.sh` добавить предупреждение в шапке: «наличие
  строки-хелпера ≠ корректность; см. tests/scope-matrix». Не полагаться на его 0 как
  доказательство (задокументировать в security-invariants G1).

**Acceptance 5:** матрица падает на текущем рассинхроне (до Части 1) и зеленеет после;
инвариант «список ⊆ карточки» проходит для всех ролей.

---

## 7. Порядок (один спринт, коммиты по частям)

1. **Часть 1** (единый резолвер дефолта — КОРНЕВОЙ фикс бага) — коммит. **Самоценно.**
2. **Часть 5.1-5.2** (матрица + инвариант «список⊆карточки») — коммит. Доказывает Часть 1.
3. **Часть 2** (единая функция резолва, убрать дубль) — коммит.
4. **Часть 3** (bump версии + backfill member_scope) — коммит + бэкап `rbac_pre_K_*`.
5. **Часть 4** (read-послабление чужого треда) — коммит (backend), затем UI.
6. **Часть 5.3** (пометить audit-coverage) — коммит.

Каждая часть: полная `npm run build` (клиент+сервер до «Server built»); сверка по
security-invariants ДО прод-деплоя; деплой `--no-cache` (урок C1); миграции аддитивны +
бэкап. `ACCESS_ENFORCEMENT=shadow` на время раскатки Части 1-2 (ловить расхождения в
логах), затем вернуть `new`.

---

## 8. Сверка security-invariants (заполнить в отчёте)

| Инвариант | Как затронут Спринтом K |
|---|---|
| A2 скоуп по оргу | Часть 1 — списки теперь реально scoped (был `org`-дефолт-баг) |
| A3 cross-org/scope → 404 | Часть 1 — список⊆карточки (нет «плашки без входа»); Часть 4 — read-послабление строго по candidate-in-scope |
| C1 единый источник | 🎯 ГЛАВНОЕ: 4→1 источник scope-дефолта (`defaultScopeForRoleKey`) |
| C3 роль-потолок/scope-охват | Часть 4 — послабление не расширяет за candidate-in-scope; write не тронут |
| C5 инвалидация ≤60c | Часть 3 — bump версии при смене scope |
| D1 masking | Часть 4 — PII в снапшотах треда маскируется по правам |
| B3 requirePermission не ослаблен | Часть 4 — read-хелпер отдельный; write остаётся на requireApplicationInScope |
| G1 тесты | Часть 5 — исполняемая матрица + «список⊆карточки»; audit-coverage помечен как недостаточный |
| G2 сборка | full client+server build на ВМ |
| G3 откат | `ACCESS_ENFORCEMENT=shadow`/`old` + git reset + restore `rbac_pre_K_*` |

---

## 9. НЕ ломать
- Дедуп по орге (нужен для «встал в очередь»).
- WRITE-модель обсуждения и переписки (§G) — read-послабление ТОЛЬКО на чтение треда.
- owner/admin unrestricted; lead=org; hrbp=компании/отделы; hh-контур; webhook-и.
- §J `candidate.createdById` (реальная колонка) и типобезопасные scope-условия.
- Создатель вакансии → primary recruiter (§H); линковщик hh → recruiter (§J).

## 10. DoD Спринта K
- member (без явного scope): вкладка «Вакансии» показывает ТОЛЬКО свои; чужих плашек
  нет; всё из списка открывается (список ⊆ доступные карточки). 🎯 (баг владельца)
- Один источник scope-дефолта; 4 резолвера читают его; `grep case 'member' scope` = 0
  локальных таблиц.
- Списки/дашборд/аналитика/карточки консистентны под member.
- Смена scope применяется ≤60c; у всех активных member явная member_scope.
- Чужой тред общего кандидата: read-only для тех, у кого кандидат в scope; 404 иначе;
  external без послабления; PII маскируется.
- Исполняемая scope-матрица + инвариант «список⊆карточки» зелёные; падают на рассинхроне.
