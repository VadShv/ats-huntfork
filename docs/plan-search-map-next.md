# План доработок модуля «Карта поиска»

> После коммита `b230ba9` (S0-S5). Миграция `0122_search_map` применяется на проде через `npm run db:migrate`.

---

## 1. S6 — Подсказка из карточки кандидата

**Суть:** когда рекрутер открывает карточку кандидата, система берёт последнего работодателя из `candidate.hhResumeRaw` (опыт работы). Если этой компании нет в реестре доноров орг — показывается ненавязчивая подсказка «Кандидат из X — добавить в доноры?». Один клик → компания в реестре. Без автозаписи.

### Задачи
- [ ] **API:** `GET /api/candidates/[id]/donor-suggestion` — извлечь работодателя из `hhResumeRaw`, проверить наличие в `donorCompany` по `normalizedName`, вернуть `{ companyName, isAlreadyDonor, suggestedLayer }`
- [ ] **API:** `POST /api/candidates/[id]/donor-suggestion` — создать компанию в реестре + опционально привязать к карте текущей вакансии
- [ ] **UI:** компонент `DonorSuggestionBanner.vue` — вставить в карточку кандидата (`CandidateDetailDrawer` или `CandidateCard`), показать только если `!isAlreadyDonor` и у юзера есть `searchMap:add_donor`
- [ ] **Логика слоя:** авто-определение `layer` по индустрии компании (IT → `adjacent`, финтех → `adjacent`, консалтинг → `school`) — эвристика в `normalizeCompanyName.ts` или отдельный `suggestDonorLayer.ts`
- [ ] **Тесты:** unit-тест на извлечение работодателя из raw hh + на дедупликацию

### Файлы
- `server/api/candidates/[id]/donor-suggestion.get.ts` (новый)
- `server/api/candidates/[id]/donor-suggestion.post.ts` (новый)
- `server/utils/searchMap/suggestDonorLayer.ts` (новый)
- `app/components/searchMap/DonorSuggestionBanner.vue` (новый)
- Вставка в `app/components/CandidateDetailDrawer.vue` (или аналог)

---

## 2. E2E-тест «золотой путь» (Playwright)

**Суть:** ТЗ §14 требует один E2E-сценарий, проходящий через весь флоу.

### Сценарий
1. Создать вакансию с брифом
2. Открыть вкладку «Карта поиска»
3. Создать карту из шаблона
4. Добавить 2 тайтла, 1 донора вручную (новая компания → появилась в реестре)
5. «Дополнить по брифу» (AI-генерация)
6. Принять 1 донора из предложений
7. Создать 1 сегмент hh + 1 сегмент google-xray-linkedin
8. «Сохранить версию»
9. Изменить бриф → баннер stale → «Учтено» → баннер исчез
10. Экспорт PDF
11. HM (вторая сессия) видит карту read-only

### Задачи
- [ ] `tests/e2e/search-map.spec.ts`
- [ ] Фикстуры: тестовая вакансия с брифом + критериями
- [ ] Проверить, что AI-генерация мокается (не тратит реальные токены в CI)

---

## 3. Полировка UI (мелкие доработки)

### Задачи
- [ ] **Drag-and-drop** доноров между слоями (`DonorLayerBoard`) → `PATCH layer` (сейчас только через `DonorDrawer`)
- [ ] **Drag-and-drop** сегментов для `displayOrder` (сейчас нет ручной сортировки)
- [ ] **Мультивыбор доноров** в `SegmentDrawer` (поле `donorIds` — сейчас не привязывается к конкретным донорам)
- [ ] **Чипы с подсказками** из секций карты для тайтлов/ключевых слов в `SegmentDrawer` (ТЗ требует «подсказки из секций карты»)
- [ ] **`VersionDiffView`** интегрировать в `VersionHistoryDrawer` — сейчас diff-utility есть, но UI не вызывает сравнение
- [ ] **Read-only режим для HM** — при `searchMap:view` без `edit` скрыть все кнопки правки, показать формулировку stale-баннера от лица HM («Карта зафиксирована под бриф от…; бриф обновлён… — рекрутёр ещё не пересобрал карту»)
- [ ] **Авто-имя сегмента** — `buildSegmentName` используется в `buildQueryUrl.ts`, но не вызывается при создании сегмента из UI

---

## 4. Технический долг

### Задачи
- [ ] **`diffSummary` при создании версии** — сейчас сохраняется `null`, ТЗ требует jsonb с бейджами diff. Вычислять через `diffSnapshots` в `versions/index.post.ts`
- [ ] **`detachedHhSearches` при restore** — ТЗ требует предупреждение о hh-привязках перед restore. Сейчас restore просто пересоздаёт сегменты с новыми ID → hh-поиски теряют связь. Добавить warning в restore endpoint
- [ ] **Типизация `snapshot` jsonb** — сейчас `snapshot` типизирован как `any` в restore endpoint. Привести к `searchMapSnapshotSchema`
- [ ] **Орг-скопинг в `donor-companies/top.get.ts`** — проверить, что `count` корректно фильтрует по org (сейчас `leftJoin` может считать доноров из других орг)
- [ ] **Feature-flag** — `search-map` flag добавлен, но не проверяется в API endpoints. Добавить `requireFeatureFlag('search-map')` в middleware или в каждом endpoint
- [ ] **Seed** — `ensureSystemChannels` + `ensureDefaultTemplate` написаны, но не вызываются при `db:seed`. Добавить вызов в `server/scripts/seed.ts`

---

## 5. Аналитика и метрики (опц., после реального использования)

### Задачи
- [ ] Дашборд: «карта → найм» — сколько кандидатов из каждого сегмента дошли до оффера
- [ ] Метрика: время от создания карты до первого «работает»-статуса сегмента
- [ ] A/B: с картой vs без карты — время до закрытия вакансии

---

## Приоритеты

| # | Блок | Приоритет | Оценка |
|---|---|---|---|
| 1 | S6 — подсказка из карточки | High | 1-2 дня |
| 2 | E2E-тест | High | 1 день |
| 3 | Read-only для HM + VersionDiffView интеграция | Medium | 0.5 дня |
| 4 | Техдолг (diffSummary, detachedHh, feature-flag, seed) | Medium | 1 день |
| 5 | Drag-and-drop + чипы-подсказки | Low | 1-2 дня |
| 6 | Аналитика | Low | после пилота |
