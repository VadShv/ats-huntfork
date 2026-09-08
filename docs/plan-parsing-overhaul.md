# План: качественная доработка парсинга резюме (Cloud.ru / self-hosted)

> Статус: **Фаза 1 (быстрые победы) реализована; фазы 3–5 — на согласование**
> Автор: аудит парсинга, сентябрь 2026
> Инфраструктура: self-hosted на VM Cloud.ru через `docker-compose.production.yml`
> Хранилище: MinIO (S3), БД: PostgreSQL (локальный контейнер)

## Прогресс реализации

**✅ Сделано (Фаза 1 — низкорисковые правки + деплой extractor):**
- Общий хелпер `detectDocumentMime()` + `isAllowedDocumentMime()` в `server/utils/schemas/document.ts`.
- Фикс `.doc`/`application/x-cfb` в 3 эндпоинтах (`candidates/[id]/documents`, `documents/parse-preview`, `chatbot/upload`) + унификация `public/jobs/[slug]/apply`.
- `extractResumeText`: убран `JSON.stringify`-fallback (больше не течёт мусор в скоринг).
- `extractor` добавлен в `docker-compose.production.yml` + `EXTRACTOR_URL` в `app` + healthcheck/`depends_on`.
- Тома данных переведены на `DATA_ROOT` (bind-mount на отдельный диск, напр. `/mnt/data2`).
- Unit-тесты: `tests/unit/document-mime.test.ts` (OLE2/x-cfb, PDF/DOCX/PNG) + обновлён `resume-parser.test.ts`. Все зелёные, `tsc --noEmit` — 0 ошибок.
- Документация: `SELF-HOSTING.md` (разделы «Data Location & Extra Disks», «Resume Text Extractor»), `.env.example` (`DATA_ROOT`, `EXTRACTOR_URL`).

**⏳ Осталось (по согласованию):** Часть 3 (убрать LLM из структурирования + generic-парсер), Часть 4 (очередь/надёжность), Часть 5 (golden-корпус). Расширение Sidekick — по вашему решению НЕ трогаем (вариант «a»).

## Цели

1. **Развернуть все парсеры в прод** — layout-aware извлечение текста (pdfplumber + PyMuPDF), OCR (Tesseract rus+eng), DOC/DOCX→PDF (LibreOffice). Сейчас Python-`extractor` есть только в dev-compose и в проде **молча выключен**.
2. **Убрать LLM из структурирования резюме** — перейти на детерминированный (rule-based) разбор текста в поля. Ноль токенов, предсказуемость, отсутствие галлюцинаций.
3. **Починить баги парсинга** из аудита (в первую очередь `.doc`/`x-cfb`, надёжность фонового структурирования).
4. **Не потерять качество отбора** — компенсировать отказ от LLM усилением extractor'а, обобщённым generic-парсером и сохранением полного сырого текста для скоринга.

## Разделение слоёв (важно для понимания)

Парсинг = два независимых слоя:

| Слой | Что делает | Технология сейчас | После доработки |
|------|-----------|-------------------|-----------------|
| **A. Извлечение текста** | binary (PDF/DOC/DOCX) → плоский текст | Python-extractor (dev) → JS-fallback `pdf-parse`/`mammoth`/`word-extractor` | **extractor в проде** как основной, JS-fallback остаётся |
| **B. Структурирование** | текст → поля (ФИО, опыт, навыки…) | rule-based (hh/portfolio) → **LLM fallback** | **только rule-based** (hh + portfolio + новый generic) |

«Уйти от LLM» касается **только слоя B**. Слой A (извлечение) остаётся детерминированным и, наоборот, усиливается.

---

## ⚠️ Риски отказа от LLM (честно, до реализации)

Текущие rule-based парсеры (`server/utils/ai/hh-text-structurer.ts`) заточены под:
- **hh.ru-экспорт** (`structureHhResumeText`) — очень регулярная структура.
- **«портфолио»-макет** (`structurePortfolioResumeText`) — ALL-CAPS секции.

Они опираются на захардкоженные списки (города, индустрии, должностные маркеры). Всё, что не подходит ни под один шаблон, сейчас **уходит в LLM**. После отказа от LLM такие резюме дадут **неполную структуру** (пустой опыт/должность).

Два места вызывают структурирование:

1. `server/utils/resume-version/structure-from-document.ts:87` — **загрузка файла**. Резюме обычно из hh/стандартные → rule-based справляется в большинстве случаев. Риск умеренный.
2. `server/api/extension/capture.post.ts:89` — **захват веб-страницы** расширением Sidekick (LinkedIn/Habr/GitHub). Это **произвольный HTML-текст**, не резюме-макет → rule-based почти всегда вернёт `null`. **Здесь отказ от LLM ломает функцию сильнее всего.**

### Как компенсируем потерю качества

- **A1. Extractor в проде** — правильный порядок текста и колонок означает, что регэкспам rule-based становится сильно легче (сейчас в проде текст «перемешан» pdf-parse'ом, что само по себе валит rule-based).
- **B1. Новый generic-парсер секций** — поверх `extractSections()` (он уже знает RU/EN заголовки) собираем поля из секций без привязки к hh-шаблону. Ловит бОльшую долю нестандартных резюме.
- **B2. Полный сырой текст в скоринг** — уже реализовано: AI-оценка (`autoScore`, `analyze`, `batch-score`) читает **полный текст** через `extractResumeText(document.parsed_content)`, а не структуру. Значит для **отбора** ключевые детали не теряются, даже если карточка структурирована неполно. Структура нужна в основном для UI-карточки и дедупа.
- **B3. Явная пометка неполноты** — если rule-based вернул мало полей, помечаем версию `partial` и показываем в UI бейдж «Структурировано автоматически, проверьте поля» + кнопку ручной правки.

### Решение по расширению Sidekick

Отказ от LLM в `capture.post.ts` (слой B) сделает захват веб-страниц практически неработоспособным. Возможны варианты — **согласовать отдельно**:
- (a) оставить LLM **только** в `capture.post.ts` (расширение), убрать LLM **только** из загрузки файлов;
- (b) убрать LLM везде и принять, что захват страниц даёт лишь черновик (ФИО+контакты по regex, остальное — вручную);
- (c) вынести захват в отдельный тикет, в этом плане тронуть только загрузку файлов.

**Рекомендация: (a)** — файлы (основной поток) полностью на rule-based, расширение сохраняет LLM (там нет альтернативы). Это даёт «ноль LLM для загруженных резюме» и не ломает Sidekick. Если нужно строго «ноль LLM вообще» — вариант (b).

> **✅ РЕШЕНО (пользователь):** вариант **(a)**. Расширение Sidekick НЕ трогаем — LLM в `capture.post.ts` остаётся. LLM убираем только из пути загрузки файлов.

---

## Часть 1 — Развернуть парсеры в прод (слой A)

Extractor уже полностью готов: `services/extractor/{app.py,Dockerfile,requirements.txt}`, healthcheck в dev-compose. Нужно перенести его в прод и связать с приложением.

### 1.1 Добавить сервис `extractor` в `docker-compose.production.yml`

```yaml
  extractor:
    build:
      context: ./src/services/extractor   # прод собирает app из ./src (см. app.build.context)
      dockerfile: Dockerfile
    image: reqcore-extractor:latest
    container_name: reqcore_extractor
    restart: unless-stopped
    expose:
      - "8000"                            # только внутренняя сеть, наружу не публикуем
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"]
      interval: 10s
      timeout: 5s
      retries: 5
```

И в сервис `app`:
```yaml
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
      S3_ENDPOINT: http://minio:9000
      EXTRACTOR_URL: http://extractor:8000      # ← ДОБАВИТЬ
    depends_on:
      db: { condition: service_healthy }
      minio: { condition: service_healthy }
      extractor: { condition: service_healthy } # ← ДОБАВИТЬ (не обязательно; при падении есть JS-fallback)
```

> Примечание про контекст сборки: в проде `app.build.context = ./src`, значит и extractor надо собирать из `./src/services/extractor`. Проверить, что каталог `services/extractor` попадает в `./src` при вашем способе доставки кода на VM (git clone / rsync). Если структура иная — скорректировать `context`.

### 1.2 Ресурсы VM

Extractor тянет LibreOffice + Tesseract + PyMuPDF — образ ~1.5–2 ГБ, RAM в пике до ~500–800 МБ на OCR больших сканов. Проверить, что на VM Cloud.ru есть запас (рекомендую +1 ГБ RAM сверх текущего). LibreOffice-конверсия — CPU-bound; на слабой VM поднять таймауты (`CONVERT_TIMEOUT_MS`/`CONVERT_TIMEOUT_SEC`).

### 1.3 Проверка после деплоя

- `curl http://extractor:8000/health` из контейнера app → `{"ok": true}`.
- Загрузить многоколоночный PDF → в `document.parsed_content.metadata.parserVersion` должно появиться `extractor:pymupdf` / `extractor:pdfplumber` (а не `1.1`), это маркер, что extractor реально используется.
- Загрузить скан (картинку-PDF) → `parserVersion: extractor:pdfplumber+ocr`, `isScanned: true`.
- Загрузить `.docx` → появляется `previewStorageKey` (превью через LibreOffice).

### 1.4 Документация

Дописать в `SELF-HOSTING.md` раздел про extractor: зачем нужен, что при его отсутствии деградирует (нет OCR, нет layout, нет DOC-превью), как проверить.

---

## Часть 2 — Починка багов извлечения (слой A)

### 2.1 [CRITICAL] Фикс `.doc` / `application/x-cfb` в 3 эндпоинтах

`file-type` v21 определяет OLE2 (`.doc`) как `application/x-cfb`, а не «пусто». Фикс есть только в `public/jobs/[slug]/apply.post.ts`. Вынести детект в общий хелпер и применить везде.

**Новый хелпер** в `server/utils/schemas/document.ts`:
```ts
const OLE2_MAGIC = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])

/** MIME по magic-bytes с ремапом legacy .doc (file-type отдаёт x-cfb для OLE2). */
export async function detectDocumentMime(buffer: Buffer): Promise<string | undefined> {
  const detected = await fileTypeFromBuffer(buffer)
  let mime = detected?.mime
  if (!mime || mime === 'application/x-cfb') {
    if (buffer.length >= 8 && Buffer.compare(buffer.subarray(0, 8), OLE2_MAGIC) === 0) {
      mime = 'application/msword'
    }
  }
  return mime
}
```

Заменить ручную логику на `detectDocumentMime(...)` в:
- `server/api/candidates/[id]/documents/index.post.ts:102-111` (баг: только `!mimeType`)
- `server/api/documents/parse-preview.post.ts:59-70` (баг)
- `server/api/chatbot/upload.post.ts:49` (баг)
- `server/api/public/jobs/[slug]/apply.post.ts:278-296, 315-330` (уже корректно — унифицировать через хелпер, чтобы не расходилось)

**Тест:** unit на `detectDocumentMime` c OLE2-фикстурой из `e2e/fixtures/test-buffers.ts` → ожидаем `application/msword`.

### 2.2 `extractResumeText` — не отдавать мусор в скоринг

`server/utils/resume-parser.ts:586` при неизвестной форме `parsedContent` делает `JSON.stringify(object)` и отдаёт как «текст резюме». Это попадает в AI-оценку. Заменить fallback на `return null` (структурный `{text}` формат — единственный актуальный; legacy-строка обрабатывается выше).

### 2.3 Синхронное извлечение — снизить риск таймаутов

Сейчас `parseDocument()` вызывается **синхронно** в реквесте с суммой таймаутов до ~2.5 мин (extractor 45с + pdf-parse 30с + convert 70с). Для публичной подачи заявки это риск обрыва по прокси.

Минимальный шаг (без очередей): вынести `convertToPdfViaService` (превью, 70с) из критического пути — делать превью **после** ответа пользователю (фоновый best-effort), а не блокировать загрузку. Извлечение текста оставить синхронным (оно нужно сразу для версии), но снизить `EXTRACTOR_TIMEOUT_MS` до 20–25с для публичного пути.

> Полный перевод извлечения в pg-boss — см. Часть 4 (опционально, больший объём).

---

## Часть 3 — Убрать LLM из структурирования (слой B)

### 3.1 Новый generic rule-based парсер

Добавить `structureGenericResumeText(rawText)` в `hh-text-structurer.ts` (или отдельный `generic-structurer.ts`), который работает поверх `extractSections()`:

- **ФИО**: первая Title-Case строка из 2–3 слов в шапке (до первой секции), не совпадающая с городом/должностью. Учесть **оба порядка** («Фамилия Имя» и «Имя Фамилия») — см. 3.3.
- **Контакты**: email + телефон (см. 3.4 — международный формат).
- **Секции**: `extractSections()` уже отдаёт `{heading, content}` для RU/EN. Маппинг заголовков → поля:
  - `experience`/`опыт работы` → блоки опыта (даты-периоды по общим паттернам, а не только hh).
  - `education`/`образование` → записи.
  - `skills`/`навыки` → split по запятым/буллетам.
  - `about`/`о себе` → текст.
  - `languages`/`языки` → пары name/level.
- Вернуть `StructuredResume` или (при слишком малой уверенности) частичный объект с флагом `partial`.

Порядок в `structureResumeRuleBased`:
```ts
export function structureResumeRuleBased(rawText: string): StructuredResume | null {
  return structureHhResumeText(rawText)
    ?? structurePortfolioResumeText(rawText)
    ?? structureGenericResumeText(rawText)   // ← НОВЫЙ, ловит нестандартные
}
```

### 3.2 `structureResumeFromText` — убрать LLM-ветку (для загрузки файлов)

В `server/utils/ai/structureResume.ts:220-289`:
- Всегда идти через `structureResumeRuleBased`.
- Если вернулся `null` → **не звать LLM**, а вернуть минимальный объект из regex-страховки (ФИО по возможности + контакты email/phone) с `source: 'rule_based'` и пометкой неполноты, чтобы карточка не была пустой и рекрутер дозаполнил вручную.
- Удалить импорт/вызов `generateStructuredOutput` **из этого файла** (не трогая сам `provider.ts` — он используется скорингом, дедупом, риском и т.д.).
- Оставить regex-дозаполнение контактов (строки 274-280) — оно ценно и в rule-based.

> **Согласовать (см. риски выше):** если выбран вариант (a), в `capture.post.ts` оставить отдельный путь с LLM. Тогда `structureResumeFromText` получает флаг `allowLlm?: boolean` (по умолчанию `false` для файлов, `true` для расширения). Если выбран (b) — LLM убирается полностью, расширение отдаёт черновик.

### 3.3 Фикс порядка ФИО

`hh-text-structurer.ts:134` жёстко берёт `lastName=w[0]; firstName=w[1]` (hh-порядок «Фамилия Имя»). Для generic-парсера и иностранных резюме добавить эвристику определения порядка (напр. по словарю распространённых имён или по позиции отчества). Покрыть тестами оба порядка.

### 3.4 Телефоны — международный формат через libphonenumber-js

`libphonenumber-js` уже в зависимостях. Заменить RU-only regex (`structureResume.ts:276`, `hh-text-structurer.ts:142/488`) на `findPhoneNumbersInText()` — ловит `+7/+380/+995/+1/...`. Нормализовать в E.164.

### 3.5 Чистка мёртвого кода после отказа от LLM

После 3.2 в `structureResume.ts` остаются неиспользуемые: system/user промпты, `disableThinking`, часть импортов. Убрать. **Не трогать** `provider.ts`, `loadConfig.ts`, `mapStructuredResumeResponse` — они нужны другим AI-функциям (скоринг, риск, дедуп, расширение).

---

## Часть 4 — Надёжность фонового структурирования (опционально, рекомендуется)

Сейчас `structureDocumentIntoVersion` (`candidates/[id]/documents/index.post.ts:232`) — «оторванный» промис без ретраев и трекинга. После отказа от LLM он станет быстрым (мс, не минуты), поэтому острота падает, но надёжность стоит поднять:

- **Вариант лёгкий:** оставить inline (раз теперь быстро), но добавить в `candidate_resume_version` статус `structuring_status` (`done|partial|failed`) + `structuring_error`, чтобы видеть и переструктурировать пакетно.
- **Вариант правильный:** очередь pg-boss `RESUME_STRUCTURE_QUEUE` по образцу `RESUME_RISK_QUEUE` (`server/utils/risk/worker.ts`) с `retryLimit`/singleton. Извлечение текста тоже можно вынести туда же.

`parse-all.post.ts` (последовательный ре-парсинг всех документов в одном реквесте) — тоже кандидат в очередь.

---

## Часть 5 — Тесты и golden-корпус (критично для «перестать домучивать»)

Сейчас `tests/unit/resume-parser.test.ts` покрывает только синтетический мини-PDF «John Doe». Нужен корпус реальных форматов:

1. Собрать 15–25 **обезличенных** резюме: hh-экспорт, портфолио, дизайнерские 2-колоночные, скан, `.doc`, `.docx`, иностранное (EN). Положить в `tests/fixtures/resumes/` (без персональных данных — заменить ФИО/контакты).
2. **Golden-тесты слоя A**: для каждого файла зафиксировать ожидаемый нормализованный текст (или ключевые фрагменты) — ловит регрессии извлечения.
3. **Golden-тесты слоя B**: для каждого — ожидаемую структуру (ФИО, число мест опыта, навыки) — ловит регрессии rule-based.
4. **Метрика fallback-rate**: считать долю резюме, где generic-парсер не смог собрать опыт. Рост = формат поменялся, сигнал дорабатывать.
5. Паритет JS↔Python нормализации (`normalizeText` vs `_normalize`) — тест на одинаковый выход.

---

## Порядок реализации (предлагаемый)

| Шаг | Объём | Риск | Зависит от |
|-----|-------|------|-----------|
| 1. Фикс `.doc`/x-cfb (2.1) + тест | S | низкий | — |
| 2. Extractor в prod-compose (1.1–1.4) | S | низкий | доступ к VM |
| 3. `extractResumeText` fix (2.2) | XS | низкий | — |
| 4. Golden-корпус + тесты слоя A (5.1–5.2) | M | низкий | — |
| 5. Generic-парсер (3.1) + тесты слоя B (5.3) | L | средний | 4 |
| 6. Телефоны libphonenumber (3.4) | S | низкий | — |
| 7. Убрать LLM из загрузки файлов (3.2, 3.5) | M | **средний** | 5 |
| 8. Решение по расширению Sidekick (a/b/c) | — | — | согласование |
| 9. Превью вне критического пути (2.3) | S | низкий | 2 |
| 10. Надёжность/очередь (Часть 4) | L | средний | опционально |

**Быстрые победы для немедленного эффекта:** шаги 1, 2, 3 (низкий риск, сразу чинят прод). Отказ от LLM (шаг 7) делать **после** генерик-парсера и golden-тестов (шаги 4–5), иначе просядет качество без страховки.

---

## Кандидат на будущее: SmartResume (Alibaba) — отложено

Рассмотрен внешний проект [SmartResume](https://github.com/alibaba/SmartResume) (форк `VadShv/SmartResume-ats`) — layout-aware pipeline парсинга резюме.

**Что это:** полный Python-пайплайн, концептуально повторяющий наш `services/extractor` + слой структурирования, но «взрослее»:
- Слой A (извлечение): pdfplumber + **RapidOCR** + **обученная layout-detection модель** (заявлено mAP@0.5 = 92.1%).
- Слой B (структурирование): **LLM**, в т.ч. локальный `Qwen-0.6B-resume` через vLLM.
- Заявленные метрики: точность полей 93.1%, 1.22с/страница, многоязычность.

**Почему отложено (не берём в Фазу 1):**
1. **Противоречит решению «без LLM».** Слой структурирования SmartResume — это LLM (свой локальный вместо облачного). Внедрение целиком = возврат к LLM.
2. **Ресурсы.** Требует CUDA/GPU, ≥8 ГБ RAM, ≥10 ГБ storage. Наш extractor — лёгкий CPU-контейнер. Локальный Qwen на CPU-only VM Cloud.ru будет медленным.
3. **Лицензия.** Их README прямо предупреждает: внутренние PDF/OCR-компоненты не опубликованы, публичная версия урезана, лицензии моделей планируют менять на более пермиссивные. Требует юридической проверки до коммерческого self-hosted использования.
4. **RU/hh.ru.** Обучение/метрики преимущественно под другие рынки; наши rule-based заточены под специфичный формат hh.ru.
5. **Зрелость.** Форк-заготовка («refactored version, may not be fully compatible»), не production-дистрибутив.

**Что потенциально ценно (на будущее, точечно):** только **layout-detection часть** слоя A — она объективно сильнее наших регэксп-эвристик колонок в `services/extractor/app.py` на дизайнерских/многоколоночных резюме. Возможный шаг Фазы 3+: встроить layout-модель/OCR внутрь нашего CPU-extractor'а **без** LLM-части и **без** GPU — при условии, что лицензия это позволит. Оценивается отдельным исследованием.

## Открытые вопросы на согласование

1. **Расширение Sidekick** — вариант (a) убрать LLM только из файлов / (b) убрать везде / (c) отдельный тикет? *(Рекомендация: a)*
2. **Очередь или inline** для структурирования (Часть 4) — лёгкий вариант или полноценный pg-boss?
3. **Ресурсы VM Cloud.ru** — есть ли запас RAM/CPU под extractor (LibreOffice+Tesseract)?
4. **Способ доставки кода на VM** — git clone в `./src`? От этого зависит `build.context` для extractor.
