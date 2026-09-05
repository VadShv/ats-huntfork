# Мастер-профиль кандидата с версионированием резюме

> **Статус:** план проектирования (living-doc). Ещё НЕ реализовано — это дизайн-документ.
> Дата: сентябрь 2026. Обновлять по мере реализации фаз.

---

## 1. Цель

Единый **мастер-профиль кандидата**, где:
- любое новое резюме одного и того же кандидата сохраняется **новой версией** в его профиле (а не плодит дубли);
- при повторной загрузке резюме система **распознаёт того же кандидата** и присоединяет резюме как версию;
- можно **назначить каноничную версию** (promote) и видеть **таймлайн** версий с дельтами;
- профиль объединяет несколько записей кандидата (разные отклики/источники) без обязательного деструктивного слияния.

---

## 2. Что УЖЕ реализовано (фундамент, переиспользуем)

| Компонент | Файлы | Статус |
|---|---|---|
| Версии резюме (snapshot, hash, delta, is_current, source) | таблица `candidate_resume_version` (`schema/app.ts:1635–1663`), миграция `0035_resume_versioning.sql` | ✅ |
| Идемпотентный append версий (дебаунс 1ч, дельты) | `server/utils/resume-version/{append,hash,delta}.ts` | ✅ |
| UI-селектор версий + рендер резюме | `app/components/candidate/{ResumeVersionSelector,HhResumeView}.vue` | ✅ |
| Единая форма резюме для всех источников | `server/utils/ai/structureResume.ts` (`buildHhCompatibleRaw`) | ✅ |
| Дедуп: identity-ключи, exact-резолв, fuzzy, AI-арбитр | `candidate_identity`, `candidate_duplicate_candidate`, `server/utils/dedup/*`, `server/utils/fuzzy/*` | ✅ |
| Merge кандидатов + rollback (30д) | `server/utils/dedup/merge.ts`, `candidate_merge_log`, API `candidates/[id]/merge*` | ✅ |
| AI-сводка кандидата | `server/api/candidates/[id]/ai-summary.post.ts` (из `hh_resume_raw`) | ✅ |

**Где живёт резюме:** структурированное — в `candidate.hh_resume_raw`; файлы — в `document` (+`parsedContent`); история — в `candidate_resume_version`.

---

## 3. Разрыв с целью

1. **Новый файл резюме ≠ новая версия автоматически.** Версия создаётся только по ручной кнопке «Структурировать» (`documents/[docId]/structure.post.ts`).
2. **Повторная загрузка резюме → часто новый кандидат-дубль**, а не версия в существующем. Дедуп есть, но авто-присоединения нет (даже при fuzzy≥95 — только баннер).
3. **Нет `promote`** — каноничной становится последняя пришедшая (`is_current`); нельзя вручную вернуть старую версию.
4. **Нет объединённого view «мастер-профиль»** над несколькими активными записями без деструктивного merge.
5. Техдолг: тип `id` в `candidate_resume_version` (миграция `uuid` vs схема `text`); нет drizzle-relations `candidate → resumeVersions/identities`.

---

## 4. Принятые решения (согласовано)

1. **Объём:** мастер-профиль = авто-версии при загрузке + единый профиль над несколькими записями + **promote** каноничной версии + **таймлайн**. Реализуем фазы 1–3.
2. **Повторная загрузка:** авто-присоединять при **высокой уверенности** (exact identity: email/phone/hh). При **fuzzy** (похоже, но не точно) — спрашивать рекрутера (диалог «добавить как версию к X / создать нового»).
3. **Не вводим новую сущность поверх `candidate`.** `candidate` = мастер-профиль; версии = существующий `candidate_resume_version`. Федерацию нескольких активных записей делаем мягкой связью (фаза 3), merge остаётся для полного слияния.

---

## 5. План реализации по фазам

### Фаза 1 — авто-версии из файлов (ядро запроса)

- При загрузке файла-резюме в карточку (`document` type=resume) — автоматически структурировать (LLM) и вызвать `appendResumeVersionIfChanged` (source=`manual_upload`, `bypassDebounce`).
- Каждый новый файл → новая версия в `candidate_resume_version`, привязка к `document.id` (в snapshot `_hf.documentId`).
- UI: тост «Резюме добавлено как версия vN» + бейдж числа версий.
- Файлы:
  - `server/api/candidates/[id]/documents/index.post.ts` — после парсинга resume-файла запускать структурирование+версию (учесть 409 при наличии hh-резюме — приоритет hh).
  - Переиспользовать `structure.post.ts` (уже пишет версию).
  - `CandidateDetailDrawer.vue` / `candidates/[id].vue` — уведомление и обновление списка версий.

### Фаза 2 — распознавание «тот же кандидат» при загрузке нового резюме

- В флоу нового кандидата/импорта: после парсинга резюме прогонять `findDuplicatesForDraft` (`server/utils/dedup/check.ts`).
  - **Exact identity** (email/phone/hh_owner совпал) → авто-присоединить резюме как версию к существующему кандидату, документ прикрепить к нему; нового не создавать.
  - **Fuzzy** (ФИО+ДР/город) → показать диалог выбора.
- Новый API: `POST /api/candidates/[id]/resume-versions/attach-document` — прикрепить `document` к существующему кандидату + `appendResumeVersionIfChanged`.
- Файлы: `candidates/new.vue`, `candidates/import.vue`, `documents/parse-preview.post.ts` (вернуть найденные совпадения), `candidates/check-duplicates.post.ts` (переиспользовать).

### Фаза 3 — promote каноничной версии + таймлайн + мастер-профиль view

- **Promote:** `PATCH /api/candidates/[id]/resume-versions/[versionId]/promote` — снять `is_current` со старой, поставить на выбранную, обновить `candidate.hh_resume_raw` из её snapshot. Транзакция + partial unique index уже защищает.
- **Таймлайн:** новый `app/components/candidate/ResumeVersionTimeline.vue` — список версий (vN, дата, источник, дельта, «текущая»), кнопки «Сделать текущей» / «Сравнить».
- **Мастер-профиль view:** блок в карточке, объединяющий все версии резюме + (при связанных identity в группе) все отклики/документы. Опционально — «federated» связь активных записей без merge (если понадобится).

### Техдолг (заодно)

- Выровнять тип `id` в `candidate_resume_version` (миграция `uuid` → согласовать со схемой `text`), аккуратной миграцией.
- Добавить drizzle-relations `candidate → resumeVersions`, `candidate → identities` для one-shot загрузки мастер-профиля.

---

## 6. Затрагиваемые сущности (сводно)

| Слой | Что |
|---|---|
| БД | переиспользуем `candidate_resume_version`, `candidate_identity`; возможна выравнивающая миграция типа id + relations |
| API | новые: `resume-versions/[versionId]/promote` (PATCH), `resume-versions/attach-document` (POST); правка загрузки документов + parse-preview |
| Утилиты | переиспув `resume-version/append`, `dedup/check`, `dedup/resolve`, `structureResume` |
| UI | `ResumeVersionTimeline.vue` (новый), правки `CandidateDetailDrawer.vue`, `candidates/[id].vue`, `new.vue`, `import.vue` |

---

## 7. Реализовано (сентябрь 2026)

**Фаза 1–3 (коммит e1481ff):** авто-версия при загрузке резюме, promote версии
(`PATCH .../resume-versions/[versionId]/promote`), attach-document
(`POST .../resume-versions/attach-document`), relation `candidate → resumeVersions`.

**Фиксы надёжности структурирования (коммит 2e2750a):**
- `_hf` исключён из content-hash (воспроизводимость версий, работает unchanged/debounce).
- Единая точка структурирования (`structure-from-document.ts`); `structure.post.ts`
  делегирует ей; гард `skipped_existing` против дубля авто+ручное на одном документе.
- Детерминизм LLM: `temperature: 0` для разбора резюме + один retry при пустом опыте.
- Анти-обеднение: не заменять версию с опытом пустым ре-парсом того же документа.
- `[versionId].get` отдаёт top-level `source`/`fetchedAt` (чип источника, «обновлено N назад»).
- Enrich («Дополнить существующего») теперь прикрепляет загруженный файл версией.
- Drawer: `has-snapshot` не захардкожен.

Проверено на боевых данных: разные PDF одного кандидата дают разный текст и разные
должности в версиях — backend извлекает изменения корректно.

## 8. Техдолг (зафиксировано, не сделано)

**UI-паритет drawer ↔ полная страница** (в работе):
- Drawer (`CandidateDetailDrawer.vue`) и полная страница (`candidates/[id].vue`)
  показывают резюме РАЗНЫМИ наборами пропсов/кнопок. Нужно унифицировать: одинаковые
  «Порекомендовать» (ReferralButton) и селектор/действия версий в обоих местах.
- Кнопка «Структурировать» доступна только на полной странице (drawer не передаёт
  `resume-document-id`/`@structured`).
- Вынести общий блок резюме в единый компонент (напр. `CandidateResumePanel.vue`),
  чтобы drawer и страница переиспользовали один UI.

**Качество PDF-парсинга** (следующая задача):
- Двухколоночные/табличные PDF извлекаются со склейкой колонок → LLM теряет/путает
  данные. `resume-parser.ts` (`normalizeText`) не восстанавливает колоночную вёрстку.
- Обрезка текста до 15k символов теряет хвост длинных резюме (ранний опыт).
- Скан-PDF без текстового слоя не обрабатываются (нет OCR).
- Рассматриваем внешний парсер-сервис (см. раздел 9).

**Прочее (из аудита):**
- Гонка `promote` vs фоновое авто-структурирование (перезапись `hh_resume_raw`).
- `hhResumeFetchedAt` = дата прогона ИИ, а не дата резюме.
- Дублирование `mapStructuredResumeResponse` (альт. путь нормализации в provider.ts).
- Формальное расхождение типа `id` в миграции 0035 (`uuid`) vs схеме (`text`).
- `ResumeVersionTimeline.vue` из плана не создан (пока promote встроен в селектор).

## 9. Внешний парсер резюме (обсуждается)

Кандидаты на усиление извлечения текста/структуры из PDF/DOCX (self-hosted, open-source):
- **Apache Tika** (server) — зрелый, извлекает текст+метаданные из PDF/DOC/DOCX, есть
  OCR через Tesseract. Docker-образ, REST API. Не структурирует в резюме-поля, но даёт
  качественный текст (лучше pdf-parse на сложных макетах).
- **Docling** (IBM, open-source) — сильный layout-aware парсер (колонки, таблицы),
  экспорт в markdown/json. Тяжелее, python-сервис.
- **GROBID** — заточен под научные статьи, для резюме не оптимален.
- **Unstructured.io** (open-source core) — layout-aware, но тяжёлый.

Идея: вынести извлечение текста в отдельный сервис (Tika/Docling) → его вывод скармливать
существующему `structureResumeFromText` (LLM). Не заменяет LLM-структурирование, а
улучшает вход. Требует: доп. контейнер в compose, фолбэк на текущий `resume-parser.ts`,
конфиг URL сервиса. Решение и выбор — см. раздел 10.

## 10. Открытые вопросы

1. Авто-структурирование при загрузке тратит LLM-токены — делать всегда или по флагу орг/по кнопке с авто-предложением?
2. Federated мастер-профиль (несколько активных записей без merge) — нужен ли отдельной сущностью или достаточно merge + identity?
3. Пороговые значения авто-присоединения (какой fuzzy-score считать «высокой уверенностью» помимо exact identity).
4. Приоритет источников при promote (hh vs файл) — можно ли вручную назначить файловую версию каноничной при наличии hh.
5. Внешний парсер: Tika (проще, OCR) vs Docling (layout-aware, тяжелее) — что берём и на какой ВМ (ресурсы 2CPU/8GB).
