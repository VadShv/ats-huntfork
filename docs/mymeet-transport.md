# MyMeet · транспорты и диагностика «fetch failed»

## Что было

Весь обмен с MyMeet шёл только через MCP-сервер `mcp.mymeet.ai` (Google Cloud, Нидерланды).
С ВМ в российском дата-центре (Cloud.ru) соединение до него периодически обрывается,
и сервер HuntFork отдавал ошибку `Не удалось получить транскрипт: fetch failed`.
Дополнительно в импорте (поток А) инструменту передавались параметры `meeting_id`/`id`,
тогда как MCP-tools MyMeet ожидают `meetingId`.

## Что сделано

| Файл | Назначение |
|---|---|
| `server/utils/mymeet/rest.ts` | Клиент REST API `backend.mymeet.ai` (Yandex.Cloud, Москва): статус, отчёт (`202` → ещё не готов), список встреч, ping. Терпимые извлекатели транскрипта/резюме из JSON отчёта. |
| `server/utils/mymeet/client.ts` | Фасад: перебирает транспорты по порядку (`MYMEET_TRANSPORT_ORDER`, по умолчанию `rest,mcp`), собирает причины отказа каждого канала в одну понятную ошибку. |
| `server/utils/mymeet/mcp.ts` | Ошибки сети разворачиваются до кода (`ECONNRESET`, `ETIMEDOUT`, …) с указанием хоста; таймаут `MYMEET_MCP_TIMEOUT_MS`. |
| `worker.ts`, `interviewReportWorker.ts` | Используют фасад. Если запись ещё обрабатывается в MyMeet — задача остаётся в очереди и повторяется автоматически. |
| `server/api/mymeet/*` | «Подключить»/«Проверить» успешны, если работает хотя бы один канал; статус каждого канала сохраняется и показывается в настройках. |

Текст ошибки теперь вида:
`Не удалось получить транскрипт — REST: таймаут 30с (backend.mymeet.ai); MCP: fetch failed · ECONNRESET (mcp.mymeet.ai)`.

## Переменные окружения

```
MYMEET_TRANSPORT_ORDER=rest,mcp        # порядок перебора каналов
MYMEET_REST_URL=https://backend.mymeet.ai
MYMEET_REST_TIMEOUT_MS=30000
MYMEET_MCP_URL=https://mcp.mymeet.ai/mcp
MYMEET_MCP_TIMEOUT_MS=30000
```

## Диагностика на ВМ

Проверить из контейнера приложения, до каких хостов есть сеть:

```bash
docker exec reqcore_app node -e "fetch('https://backend.mymeet.ai/api/meeting/status').then(r=>console.log('rest',r.status)).catch(e=>console.error('rest',e.cause?.code||e.cause||e))"
docker exec reqcore_app node -e "fetch('https://mcp.mymeet.ai/mcp').then(r=>console.log('mcp',r.status)).catch(e=>console.error('mcp',e.cause?.code||e.cause||e))"
```

Ожидаемо: `rest 401/403/422` (хост отвечает, ключ не передан) — канал есть; `mcp ECONNRESET`/`ETIMEDOUT` — канала нет.
После деплоя нажать «Проверить» в Настройки → MyMeet: карточка покажет состояние REST и MCP.

## Ограничения

- Точная схема JSON ответа `GET /api/video/report` в открытой документации не описана; извлекатели
  транскрипта/резюме терпимы к разным формам (`transcript` строкой, массив сегментов с `speaker/start/text`,
  вложенный `transcript.segments`, `followup_v2.templates[].sections`). Сырой JSON всегда сохраняется в `report_json`.
- API MyMeet доступен только на платных тарифах.
