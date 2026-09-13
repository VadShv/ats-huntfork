# Фаза 2 — Спринт G: полное дозакрытие хвоста + переписка read-only

> Финальный спринт app-level изоляции. Закрывает пропущенные при B/C эндпоинты
> (корневые [id]-файлы + смежные группы) + вводит модель доступа к переписке.
> Причина: аудит выявил, что покрыты только подпапки `[id]/*`; корневые файлы и
> группы conversations/interviews/sourcing/documents — пропущены.
> Дополняет `docs/rbac-v2-phase2-tail.md`, `docs/rbac-v2-security-invariants.md`.
> Процесс: высокий риск (доступы/данные) → сверка ДО прод-деплоя.

---

## Требования владельца (зафиксировано)

1. **Нельзя редактировать/удалять ЧУЖИЕ** кандидатов / отклики / вакансии
   (вне scope). Только свои. → scope-guard на всех mutation-эндпоинтах по ID.
2. **Переписка с кандидатом (chat) — read-only для всех, КРОМЕ ведущих рекрутеров:**
   - Все роли (с доступом к отклику) **видят** окно чата и историю переписки.
   - **Писать** в чат может ТОЛЬКО ведущий рекрутер (lead_recruiter) И ТОЛЬКО по
     вакансиям, где он числится рекрутером (`job_member.member_role='recruiter'`).
   - Ведущий на вакансии, где НЕ добавлен рекрутером → видит чат, но писать НЕ может.
   - member/hrbp/external/owner/admin — видят чат, но не пишут (по требованию;
     см. открытый вопрос про owner/admin ниже).
3. **Обсуждение (внутренние комментарии, applications/[id]/comments) — доступно
   ВСЕМ** (история по кандидату видна всем). НЕ ограничивать перепиской-логикой.
   Это отдельная сущность — не трогать её доступность (только scope по отклику).

> ВАЖНО не перепутать: «переписка/чат» = `conversations/*` (сообщения кандидату,
> Telegram) — ограничиваем запись. «Обсуждение» = `applications/[id]/comments/*`
> (внутренние заметки команды) — остаётся доступным всем (в пределах scope отклика).

---

## Часть 1 — BACKEND: scope-guard на пропущенных эндпоинтах

Использовать готовые гарды: `requireCandidateInScope`, `requireApplicationInScope`,
`requireJobInScope` (all → 404 вне scope; no-op для unrestricted owner/admin/org).

### 1.1 Корневые [id]-файлы (пропущены B/C)
- [ ] `candidates/[id].delete` → `requireCandidateInScope` (нельзя удалить чужого)
- [ ] `applications/[id].patch` → `requireApplicationInScope` (нельзя править чужой отклик)
- [ ] `applications/index.post` → проверить `isJobInScope(jobId)` перед созданием
      (нельзя создать отклик на чужую вакансию)

### 1.2 documents/[id]/* (корень)
- [ ] `re-extract.post`, `parse.post`, `parsed.get` → scope по кандидату документа
      (загрузить document.candidateId → `requireCandidateInScope`).

### 1.3 interviews/[id]/*
- [ ] `index.get/patch/delete`, `meeting-report.get`, `send-invitation.post`,
      `import-mymeet.post` → scope по вакансии интервью (interview → application/job
      → `requireJobInScope`). Редактировать/удалять интервью чужой вакансии нельзя.

### 1.4 sourcing-searches/* и sourcing-candidates/*
- [ ] `[id]` get/patch/delete/run-now/enrich → job-scope (searches/candidates
      привязаны к вакансии → `requireJobInScope`).

### 1.5 analytics/jobs/[id].get
- [ ] scope по вакансии (аналитика конкретной вакансии вне scope → 404).

### 1.6 hm/* (проверить, не открыть лишнего)
- [ ] `hm/applications/[id].get`, `hm/documents/[id]/preview.get` — у них СВОЙ
      HM-гард (`requireHm` + job-scope HM). Проверить, что HM видит только свои
      назначенные вакансии; НЕ ломать (HM-контур отдельный).

**Acceptance 1:** под external/hrbp прямой URL к чужому (кандидат.delete,
отклик.patch, интервью, документ, сорсинг, аналитика вакансии) → 404. Свои —
работают.

---

## Часть 2 — BACKEND: модель доступа к переписке (chat)

### 2.1 Новое право + хелпер
- [ ] Право `conversation:write` (или переиспользовать проверку роли+job_member).
      Рекомендация: НЕ право в матрице, а серверный хелпер `canWriteConversation
      (actor, conversationId)`:
      - true ТОЛЬКО если: `actor.role === 'lead_recruiter'` (или owner/admin — см.
        открытый вопрос) И пользователь `job_member(recruiter)` на `conversation.jobId`.
      - иначе false (read-only).
- [ ] Хелпер `requireConversationInScope(event, convId)` — видимость чата: conv →
      application/job → `requireJobInScope` (кто видит отклик — видит и его чат).

### 2.2 Гейты conversations/[id]/*
- [ ] **ЧТЕНИЕ** (index.get, unread-count, link-options.get, suggest.get,
      unread-stream) → `requireConversationInScope` (заменить голый `requireAuth`
      на scope). Видят все, кто в scope отклика.
- [ ] **ЗАПИСЬ** (messages.post, link.post, assistant.patch, read.post,
      drafts/[draftId].post) → `requireConversationInScope` + `canWriteConversation`
      → 403 если не ведущий-на-этой-вакансии.
      (read.post — «отметить прочитанным» — спорно: это не «письмо кандидату», а
      маркер. Оставить доступным всем в scope? см. открытый вопрос.)
- [ ] suggest (суфлёр) — уже под `assistant:suggest` (lead-only, off) + добавить
      scope. Консистентно с «писать может только ведущий».

**Acceptance 2:**
- member/hrbp/external открывают отклик → видят чат и историю, поле ввода
  неактивно (сервер: messages.post → 403).
- lead на вакансии где он рекрутер → пишет в чат.
- lead на вакансии где НЕ рекрутер → видит чат, писать не может (403).

---

## Часть 3 — FRONTEND (UI под модель переписки)

Да, UI обновить обязательно — иначе пользователь увидит поле ввода, нажмёт, получит
403 (плохой UX). Сервер защищает, UI — про удобство.

### 3.1 CommsChatPanel.vue (окно переписки с кандидатом)
- [ ] Получать флаг `canWrite` (из ответа conversation API или отдельного
      `usePermission`-подобного composable по conversationId).
- [ ] Если `!canWrite`: поле ввода сообщения — **disabled** + подсказка «Писать в
      чат может ведущий рекрутер, назначенный на эту вакансию» (или просто скрыть
      composer, оставив ленту сообщений read-only).
- [ ] Кнопка суфлёра — уже скрыта без `assistant:suggest` (Спринт E).
- [ ] Лента сообщений (история) — видна всегда (read-only для тех, кто не пишет).

### 3.2 Обсуждение (comments) — НЕ трогать
- [ ] Убедиться: окно обсуждения/комментариев доступно всем в scope отклика
      (composer активен) — это отдельный компонент, требование «история видна всем».

### 3.3 Прочий UI (кнопки edit/delete чужого)
- [ ] Кнопки «Удалить кандидата/отклик/вакансию», «Редактировать» — скрывать/
      дизейблить, если объект вне scope (флаг из API, как `jobInScope` в §5).
      Сервер уже 404-ит, UI — чтобы не показывать бесполезные кнопки.

---

## Часть 4 — Скрипт-аудит покрытия (для агента и ревью)

Прогонять ПОСЛЕ реализации — должен показать 0 непокрытых (кроме create/index и
явного org-wide списка). См. `scripts/audit-scope-coverage.sh` (ниже).

- [ ] 0 эндпоинтов с [id] по данным (candidate/application/job/interview/document/
      sourcing/conversation) без scope-guard, кроме create/index/явного org-wide.
- [ ] conversations записи — под canWriteConversation.
- [ ] Обновить `docs/rbac-v2-org-wide-endpoints.md` (финальный список by-design).

---

## Открытые вопросы (нужны решения владельца)

1. **owner/admin и переписка:** могут ли они писать в чат кандидату? По требованию
   «только ведущие» — формально нет. Но owner/admin обычно всевластны.
   **Рекомендация:** owner/admin МОГУТ писать (они управляют всем); ограничение
   «только ведущий + на своей вакансии» — для рекрутерских ролей. Подтвердить.
2. **read.post («отметить прочитанным»):** это не письмо кандидату, а UI-маркер.
   Разрешить всем в scope (не блокировать как запись)? Рекомендация: да, разрешить
   (это не отправка сообщения).
3. **member (обычный рекрутер) и чат:** по требованию — read-only (не пишет).
   Подтверждаю: писать может ТОЛЬКО lead. member/hrbp/external — read-only.

---

## Порядок (один спринт, порции-коммиты)
1. Часть 1 (scope-guard пропущенных) — коммит.
2. Часть 2 (переписка backend: canWriteConversation + гейты) — коммит.
3. Часть 3 (UI переписки + кнопки) — коммит.
4. Часть 4 (скрипт-аудит, 0 пропущенных, обновить org-wide список) — коммит.
Всё в один заход, но КОММИТЫ по частям. Сверка ДО прод-деплоя. Миграции (если
право conversation:write) — аддитивны + бэкап.

## DoD Спринта G
- Нельзя edit/delete чужих кандидатов/откликов/вакансий/интервью/документов (404).
- Переписка: read-only для всех, запись — только lead на своей вакансии.
- Обсуждение (comments) — доступно всем в scope (не задето).
- UI: поле чата disabled без права; кнопки edit/delete чужого скрыты.
- Скрипт-аудит: 0 непокрытых (кроме create/index/org-wide).
