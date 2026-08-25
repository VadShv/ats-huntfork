# Sidekick — живой стриминг ИИ: реализация и карта для продолжения работ

Дата: 25.08.2026 · Статус: **все пакеты П1–П7 реализованы и задеплоены на прод**
Исходное ТЗ: [tz-sidekick-ai-speed.md](./tz-sidekick-ai-speed.md)

Документ фиксирует, что и как сделано по программе «Ускорение ИИ-генерации в Sidekick», где лежит код, как это проверять и что логично делать дальше. Цель — чтобы к доработке расширения можно было вернуться без археологии.

---

## 1. Сводка: что сделано и какими коммитами

| Пакет | Суть | Коммит(ы) |
| --- | --- | --- |
| П1 | Телеметрия: `ttft_ms`, `first_text_ms`, `total_ms`, фактическая модель из ответа API (`response_model`) в логах и SSE `done` | `85fb87e` |
| П3 | Честный reasoning: `enable_thinking=false` для GLM/Qwen при выключенном тумблере; стрим «размышлений» отдельным SSE-событием `{thinking}`; UI-блок `HfThinking` | `85fb87e` |
| П2 | Purpose `interactive`: `ai_config.is_default_interactive` + миграция 0068, фолбэк на analysis, кнопка «Использовать для панели» в настройках ИИ ATS. **Поведение не меняется, пока дефолт не назначен** | `9c96824` |
| П4 сервер | `streamStructuredOutput` (streamObject) в провайдере; `verification/run` и `interview-card` отдают SSE с partial-объектами (троттлинг 250 мс), abort при уходе клиента; блокирующий путь сохранён как фолбэк | `9c96824` |
| П5 | sha1-кэш саммари по подготовленному тексту, кэш режима «Вопросы», `textDiet` (срез боилерплейта hh.ru), пер-режимные лимиты текста и `maxOutputTokens` | `9c96824` |
| П4 клиент | `sseRequest` из панели напрямую (мимо background), partial-рендер секций верификации и карточки по мере генерации, фолбэк при обрыве | `0df1cfc` |
| П6 | Компонент `HfStages` — этапы «Читаю страницу → Думаю → Пишу» с секундомером; каретка; хвостовой скелетон; «Стоп» для верификации/карточки; автоскролл с прилипанием к низу | `0df1cfc` |
| П7 | TS-чеки, сборка, Playwright-QA всех трёх потоков, фиксы вёрстки узкой панели | `0df1cfc` |

Хронология коммитов (ветка `main`):

- `d2be597` — серверные эндпоинты Sidekick (воронка, шаблоны, верификация, карточка…)
- `85fb87e` — Этап 1: телеметрия TTFT + честный стриминг размышлений (П1, П3)
- `9c96824` — сервер П2+П4+П5: purpose interactive, SSE-стрим верификации и карточки, диета текста
- `0df1cfc` — клиент П4+П6: живой прогресс, partial-рендер, стоп, фиксы вёрстки

**Ограничение, действующее во всех коммитах:** скрининговый контур (Qwen на Yandex Cloud, `autoScore`/`structureResume`/`generateStructuredOutput`) и импорт с hh.ru не тронуты; изменения серверного ИИ — только в `server/api/extension/*` и `server/utils/ai/*`, причём аддитивно.

---

## 2. Протоколы SSE (контракт клиент ↔ сервер)

Все интерактивные эндпоинты панели отвечают `text/event-stream`, каждое событие — строка `data: <json>\n\n`.

### 2.1. Текстовый стрим — `POST /api/extension/summarize`, `/api/extension/chat`

```
{ "thinking": "…" }   — дельта размышлений reasoning-модели (может отсутствовать)
{ "delta": "…" }      — дельта видимого текста
{ "done": true, "usage": {...}, "cached": bool,
  "timing": { "ttftMs", "firstTextMs", "totalMs" }, "model": "фактическая модель из ответа API" }
{ "error": "…" }      — терминальная ошибка
```

### 2.2. Структурный стрим — `POST /api/extension/verification/run`, `/api/extension/interview-card` (при `stream: true`)

```
{ "partial": { …частичный объект по zod-схеме… } }   — троттлинг ~250 мс
{ "done": true, "report" | "card": {…},
  "meta": { "provider", "model", "totalMs", "generatedAt" },
  "usage": {...}, "timing": { "ttftMs", "totalMs" } }
{ "error": "…", "code": "AI_FAILED" }
```

Без `stream: true` оба эндпоинта работают по-старому (блокирующий JSON) — это и есть фолбэк клиента. Zod-схемы `reportSchema`/`cardSchema` не менялись; порядок полей в схеме совпадает с порядком секций UI, поэтому partial-рендер ложится естественно.

### 2.3. Клиентский разбор

`sseRequest(path, body, onEvent, signal)` в `extension/entrypoints/sidepanel/composables/useSidekick.ts` — единственный парсер SSE в панели. Требования: статус 200 **и** `Content-Type: text/event-stream`, иначе бросает «Ошибка N»; `{error}` в потоке — тоже throw; 401 → «Требуется вход на huntfork.ru». Поверх него — `sseFetch` (текстовый сахар: delta/thinking).

---

## 3. Карта кода

### Сервер (`server/`)

| Файл | Что делает |
| --- | --- |
| `utils/ai/provider.ts` | `streamTextOutput` (+`maxOutputTokens`), `streamStructuredOutput` (streamObject), `createCloudRuStreamModel` на `@ai-sdk/openai-compatible` — reasoning_content стримится как дельты |
| `utils/ai/cloudRuFetch.ts` | Инжект отключения thinking по allowlist моделей (GLM: `thinking.type=disabled`, Qwen: `chat_template_kwargs.enable_thinking=false`), ретрай при 4xx |
| `utils/ai/loadConfig.ts` | Purpose `interactive` с фолбэком на analysis |
| `utils/ai/textDiet.ts` | Построчный фильтр боилерплейта hh.ru перед отправкой в ИИ |
| `api/extension/summarize.post.ts` | SSE, sha1-кэш по подготовленному тексту, CACHEABLE = summary/fit/card/questions, пер-режимные лимиты |
| `api/extension/verification/run.post.ts`, `api/extension/interview-card.post.ts` | `stream=true` → SSE partial; abort при уходе клиента; блокирующий фолбэк |
| `api/extension/chat.post.ts`, `api/extension/search-map.post.ts` | Purpose interactive, телеметрия |
| `database/migrations/0068_ai_config_default_interactive.sql` | `ai_config.is_default_interactive` (применяется runtime-мигратором) |
| `api/ai-config/*` + `app/pages/dashboard/settings/ai/index.vue` | Бейдж и кнопка «Использовать для панели» в настройках ИИ |

### Клиент (`extension/entrypoints/sidepanel/`)

| Файл | Что делает |
| --- | --- |
| `ui/HfStages.vue` | Этапы «Читаю страницу → Думаю → Пишу», props `{ stage: 'read'|'think'|'write' }`, внутренний секундомер (100 мс, «12,4 с»), пульс точки, prefers-reduced-motion |
| `ui/HfThinking.vue` | Блок «Размышляет…» со стримом мыслей, сворачивается в «Думал N с» |
| `composables/useSidekick.ts` | `sseRequest`/`sseFetch`, состояние `capturing`/`aiRunning`, промпты, чат |
| `composables/useVerificationRun.ts`, `useInterviewCardRun.ts` | Прямой SSE из панели (мимо background), partial-объекты, stop (AbortController), фолбэк на блокирующий путь |
| `views/VerificationView.vue` | Partial-рендер секций (сводка → таймлайн → противоречия → флаги → вопросы), скелетоны, «Стоп», мета-строка |
| `views/InterviewCardView.vue` | То же для карточки интервью; `runStage` computed (capturing→read, есть role→write, иначе think); автоскролл с прилипанием (порог 60 px) |
| `views/ChatView.vue` | `HfStages` над `HfThinking` в summary-фазе |
| `views/ScreeningView.vue` | Сабтабы Оценка/Верификация/Интервью; фиксы вёрстки (см. §5) |

Background service worker в интерактивных ИИ-потоках больше не участвует (он не умеет стримить) — остаётся для импорта, дубль-чека, промптов и т. п.

---

## 4. Как это проверять (QA)

- **Playwright-скрипт из этой итерации:** запускается на собранном `.output/chrome-mv3`; мокает `chrome.runtime.sendMessage` (activeTab → hh.ru/resume, capturePage → текст > 200 симв.), `chrome.permissions`, сессию huntfork.ru и `window.fetch` для SSE-эндпоинтов (partial-события с задержками). Проверяет по всем трём потокам: этапы со временем, «Стоп», partial-рендер, мета-строку, отсутствие горизонтального перелива (`scrollWidth == clientWidth` у `.screening-view`). Аналог в репо — `extension/qa-shots.mjs`.
- **Смоук прода:** `POST /api/extension/summarize|verification/run|interview-card` без cookie → 401; логи контейнера — «Database migrations applied successfully»; телеметрия П1 в `logApiRequest`.
- **TS-чеки:** приложение — `npx nuxt prepare && npx vue-tsc --noEmit` (0 ошибок); расширение — `npx wxt prepare`, затем vue-tsc (1 предсуществующая ошибка TS2688 `wxt/client` — конфиг, не код).

Запуск нового чата summary-фазы в QA: слэш-меню («/» в пустом композере → Enter выбирает первую быструю команду) — пресеты плиток идут в `/chat`, слэш-команды в `/summarize`.

## 5. Грабли, на которые уже наступили (не повторять)

1. **Flex и узкая панель (380 px).** `.screening-view` — flex-column; любая дочерняя вьюха обязана иметь `min-width: 0; width: 100%`, иначе раздувается до min-content и панель уезжает вбок (`.vfr`, `.icr` уже поправлены).
2. **Сабтабы шире панели.** Полоса `.hf-subtabs` скроллится отдельно (`overflow-x auto`, скрытый скроллбар), сам `.screening-view` — `overflow-x: hidden`. Иначе клик по табу горизонтально прокручивает весь контент.
3. **Длинные чипы** (`пробел: …` в таймлайне) — `white-space: normal; height: auto`, иначе режутся.
4. **AI SDK v6:** `result.usage`/`result.response` — PromiseLike; оборачивать `Promise.resolve(x).catch(() => null)`. Для streamObject: `partialObjectStream` + `await result.object`.
5. **Чат-пресеты ≠ слэш-команды:** плитки из actions-grid ходят в `/api/extension/chat`, слэш-команды — в `/summarize`. В тестах не путать.
6. **`pnpm-lock.yaml` не коммитим**; канонический lock расширения — `package-lock.json`.

## 6. Конфигурация прода (на 25.08.2026)

- analysis (дефолт): cloud_ru `Qwen/Qwen3.5-397B-A17B`, max_tokens 16 384 — используется summarize/verification/interview-card/search-map (и interactive через фолбэк)
- chatbot: cloud_ru `deepseek-ai/DeepSeek-V4-Flash` — чат
- interactive: **дефолт не назначен** → работает фолбэк на analysis
- Деплой: ВМ `/opt/huntfork/reqcore-astra`, `git pull && docker compose build app && docker compose up -d app` (дефолтный `docker-compose.yml`), миграции применяются на старте

## 7. Что дальше (бэклог для продолжения)

1. **Назначить быструю модель на purpose interactive** — теперь это клик в настройках ИИ («Использовать для панели»), без деплоя. Кандидаты: не-reasoning модель Cloud.ru. После включения снять p50/p95 TTFT по телеметрии П1 и сравнить.
2. **Выяснить расхождение GLM 5.2 ↔ Qwen** — телеметрия уже пишет фактическую модель ответа (`response_model`); посмотреть логи и при необходимости поправить строку модели в настройках ИИ (правка конфига, не кода).
3. **Кэш в Redis** — сейчас in-memory на контейнер, умирает при деплое (осознанный компромисс П5).
4. **PostHog-дашборд TTFT** — p50/p95 по режимам на данных `logApiRequest`.
5. **Стриминг search-map** — единственный интерактивный эндпоинт панели ещё на блокирующем `generateObject`; переводится на `streamStructuredOutput` по образцу верификации.
6. **Тумблер «Глубокий анализ» в UI** — сервер поле `reasoning` уже принимает и честно отключает thinking; проверить/довести его проброс из всех вьюх панели.
7. **Firefox-сборка** — WXT позволяет, но не проверялась.
