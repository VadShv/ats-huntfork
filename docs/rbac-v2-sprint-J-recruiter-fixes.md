# Спринт J — фикс видимости кандидатов у рекрутера + линковка откликов + ИИ per-user

> Один заход, коммиты по частям. Дополняет security-invariants.
> Процесс: доступы/PII = высокий риск. Полная `npm run build` (клиент+СЕРВЕР);
> деплой `--no-cache` (урок C1); esbuild-transform всех server-файлов (vue-tsc
> недостаточно). Миграция аддитивна + бэкап. `audit-scope-coverage.sh = 0`.

---

## Причины (проверено по коду/БД/прод-логам)

1. **🔴 Рекрутер не видит НИ список кандидатов, НИ карточки** — «не удалось
   загрузить». Корень: `candidateScopeCondition`/`isCandidateInScope`/
   `documentScopeCondition` (Спринт H) используют raw `sql` со ссылкой
   `${candidate.createdById}`, а **колонки `candidate.created_by_id` НЕТ** →
   `undefined` рендерится пусто → битый SQL `( = $2 OR EXISTS...)` →
   `PostgresError: syntax error`. Падает у ВСЕХ scoped-ролей (member/lead-mine/
   hrbp/external) на ~30 эндпоинтах (список + все карточки/действия кандидата).
   owner/admin (unrestricted → условие undefined) не задеты.

2. **⚠️ Отклики с hh.ru могут «сыпаться невидимо»**: ингест hh всегда ставит
   `application.jobId = hhVacancyLink.jobId` (валидно), НО **никогда не назначает
   рекрутера** на вакансию. Видимость = `application.jobId ∈ job_member(recruiter)`.
   `hh/link-vacancy.post` создаёт только связь, НЕ делает линкующего рекрутером →
   при линковке к чужой/существующей вакансии отклики невидимы линкующему.

3. **Модель «свой кандидат»** должна учитывать «я добавил» — но колонки нет и она
   не проставляется → escape-hatch не работает.

**Решение владельца:** отклики видит любой `job_member(recruiter)` вакансии
(создатель / основной / дополнительный / назначенный). Открепили → перестал
видеть (это происходит автоматически — scope считается live по job_member).

---

## ЧАСТЬ 1 — 🔴 фикс видимости кандидатов (корень)

1.1 Миграция (аддитивно): `ALTER TABLE candidate ADD COLUMN created_by_id text
    REFERENCES "user"(id) ON DELETE SET NULL` + индекс. Drizzle-поле
    `createdById` в схеме `candidate`.
1.2 `scope.ts`: переписать `candidateScopeCondition` / `isCandidateInScope` /
    `documentScopeCondition` на ТИПОБЕЗОПАСНЫЕ drizzle-операторы (`eq`, `inArray`,
    `exists()`), убрать raw `sql` со ссылками на колонки. Модель:
    - candidate виден iff `created_by_id = actor.userId` ИЛИ EXISTS(application на
      вакансии в scope).
1.3 `candidates/index.post`: проставлять `createdById = session.user.id`.

**Acceptance 1:** рекрутер (assigned) открывает «Кандидаты» → видит своих (по его
вакансиям + добавленных им); карточка своего кандидата открывается; чужой → 404.
Никаких «не удалось загрузить». owner/admin — без изменений.

---

## ЧАСТЬ 2 — ⚠️ линковка откликов к рекрутеру

2.1 `hh/link-vacancy.post`: при линковке hh-вакансии к job — **upsert линкующего
    как `job_member(recruiter)`** на эту вакансию (если ещё не member), чтобы
    входящие отклики были ему видны. Зеркало логики `jobs/index.post`.
    (`isPrimary` НЕ трогаем — если у вакансии уже есть основной, линкующий станет
    дополнительным рекрутером.)
2.2 Открепление (`members/[userId].delete`) уже работает: scope считается live по
    job_member → открепили → перестал видеть/линковаться. Подтвердить, не менять.
2.3 Сценарий «hh-вакансия не слинкована» (отклик дропается webhook'ом с
    `no_vacancy_link`) — оставляем (нельзя импортировать отклик без вакансии), но
    это уже логируется в `comms_channel_event` (skipped). UI «несопоставленных» —
    отдельная фича, вне спринта.

**Acceptance 2:** рекрутер линкует hh-вакансию к своей/новой вакансии → он
`job_member(recruiter)` → входящие отклики видны. Открепили из job_member →
перестал видеть.

---

## ЧАСТЬ 3 — раздел «ИИ-ассистент» в индивидуальных правах (per-user)

3.1 `AccessMemberRightsModal`: выделить **отдельную секцию «ИИ-ассистент»** с 6
    тумблерами (`assistant:access/send/scopeOrg/reasoning/agents/selectModel`
    + suggest) наверху/отдельно от общей «AI и промпты». Сохранение как per-user
    override (allow/deny), сервер применяет (уже работает через resolver+overrides).

**Acceptance 3:** в модалке индивидуальных прав есть раздел «ИИ-ассистент» с
переключателями; выдача access конкретному member → он видит ассистента; снятие →
не видит.

---

## ЧАСТЬ 4 — подтверждение (тесты/проверка)

4.1 #1 создатель вакансии → `job_member(recruiter, isPrimary=true)` (уже есть в
    jobs/index.post) — подтвердить.
4.2 #3 lead в ассистенте видит ТОЛЬКО свои чаты (все chatbot/* фильтруют userId) —
    подтвердить.
4.3 #4 member во вкладке «Вакансии» видит только назначенные (jobs/index.get scope
    assigned) — проверить UI; поправить если баг (но по коду — inArray, не raw sql,
    не подвержен багу Части 1).

---

## НЕ ломать
- owner/admin (unrestricted), lead/hrbp/external поведение.
- Дедуп по орге, обсуждение, переписку G, HM-контур, webhook-и по секрету.
- job-роль recruiter (job_member), isPrimary-логику основного рекрутера.

## DoD
- Рекрутер видит своих кандидатов (список + карточки), никаких ошибок загрузки.
- Линковка hh-вакансии делает линкующего рекрутером → отклики видимы; открепление
  — перестаёт.
- Модель «свой кандидат» (createdById) работает.
- Раздел «ИИ-ассистент» в per-user правах.
- Прод пересобран --no-cache; миграция + бэкап; audit-coverage=0; тесты зелёные.
