/**
 * Промпты AI-генерации карты поиска.
 * docs/tz-search-map.md §10, docs/tz-search-map-v2.md §2a (R0), §3.5 (точечное дополнение).
 *
 * Структура промпта стабильна: системные правила → каналы организации → контекст вакансии
 * (бриф, критерии, описание) → что уже есть в карте → задача части → подсказка рекрутёра.
 * Стабильная часть впереди — чтобы у провайдеров с кэшем префикса он срабатывал.
 */
import {
  buildBriefContext, prepareDescription, formatExistingSegments,
  type BriefLike, type ExistingSegmentLike, type GenerationPart,
} from './generationContext'

export interface GeneratePromptOptions {
  part: GenerationPart
  jobTitle: string
  brief?: BriefLike | null
  criteria?: { name: string; category?: string | null; weight?: number | null }[]
  description?: string | null
  existingSections?: { title: string; items: string[] }[]
  existingDonors?: { name: string; layer: string }[]
  existingSegments?: ExistingSegmentLike[]
  /** Активные каналы организации — модель обязана использовать только эти channelCode */
  channels?: { code: string; name: string; queryLanguageHint?: string | null }[]
  /** Подсказка рекрутёра из UI («добавь гипотезы через Telegram-сообщества») */
  hint?: string | null
  /** Сколько элементов просим (кнопки «Ещё похожие» → 3) */
  limit?: number | null
  /** Для part = 'query_string' — гипотеза, чей запрос переписываем */
  targetSegment?: {
    name: string
    titles: string[]
    keywords: string[]
    geo: string[]
    channelCode?: string | null
    channelName?: string | null
    queryLanguageHint?: string | null
    queryString?: string | null
  } | null
  /** Текущий вердикт — для part = 'summary' (переписываем с учётом существующего) */
  currentSummary?: string | null
  /** Для part = 'sections' с конкретной секцией: дополнять только её */
  targetSection?: { sectionType: string; title: string; guidance?: string | null } | null
  /** Для part = 'donors' с конкретным слоем */
  targetLayer?: string | null
}

const DEFAULT_CHANNELS = [
  { code: 'hh', name: 'hh.ru' }, { code: 'linkedin', name: 'LinkedIn' },
  { code: 'telegram', name: 'Telegram' }, { code: 'google_xray_linkedin', name: 'Google x-ray LinkedIn' },
]

export function buildGeneratePrompt(opts: GeneratePromptOptions): { system: string; prompt: string } {
  const channels = opts.channels?.length ? opts.channels : DEFAULT_CHANNELS
  const channelList = channels.map(c => `"${c.code}" (${c.name})`).join(', ')

  const system = `Ты — эксперт-сорсер по подбору персонала в России (IT, финансы, продажи, производство, управление).
Ты помогаешь рекрутёру построить «карту поиска» — набор проверяемых гипотез о том, где и кого искать под вакансию.

Карта поиска состоит из:
1. Секции (факты о вакансии). sectionType — строго из списка:
   - "title_synonyms" — как позицию называют в разных компаниях (включая англоязычные варианты)
   - "keywords" — ключевые навыки, технологии, инструменты, домены (must-have и nice-to-have)
   - "geo" — города, регионы, часовые пояса, формат работы и релокация
   - "exclusions" — компании и тайтлы, которые исключаем (ложные срабатывания, non-poach)
   - "notes" — уровень, домен, ограничения и договорённости с нанимающим менеджером
2. Компании-доноры (откуда брать кандидатов) по слоям: core — где работают прямые аналоги;
   adjacent — похожая функция в другом контексте; school — где учат нужному; alumni — откуда уже приходили.
3. Гипотезы поиска: слой доноров × тайтлы × гео × канал. Гипотеза должна быть проверяемой:
   понятно, какой запрос запустить и по какому результату считать её сработавшей.

Правила:
- Отвечай на русском языке; названия компаний и тайтлы — как их пишут на рынке.
- Будь конкретен: реальные компании российского рынка, реальные формулировки тайтлов из резюме.
- Не выдумывай факты о вакансии — используй только переданный контекст.
- Не повторяй то, что уже есть в карте (списки «уже есть» ниже).
- channelCode — строго один из: ${channelList}
- priority — строго: "high", "medium", "low"
- layer / donorLayer — строго: "core", "adjacent", "school", "alumni", "custom"`

  const parts: string[] = []
  parts.push(`Вакансия: ${opts.jobTitle}`)

  const briefCtx = buildBriefContext(opts.brief, opts.part)
  parts.push(briefCtx.text)

  if (opts.criteria?.length) {
    parts.push(`Критерии оценки кандидатов:\n${opts.criteria.map(c =>
      `  - ${c.name}${c.category ? ` [${c.category}]` : ''}${c.weight ? ` (вес ${c.weight})` : ''}`).join('\n')}`)
  }

  const description = prepareDescription(opts.description)
  if (description && opts.part !== 'query_string') {
    parts.push(`Описание вакансии (текст публикации):\n${description}`)
  }

  if (opts.existingSections?.length && (opts.part === 'sections' || opts.part === 'summary' || opts.part === 'segments')) {
    const filled = opts.existingSections.filter(s => s.items.length)
    if (filled.length) {
      parts.push(`Уже заполнено в карте:\n${filled.map(s => `  ${s.title}: ${s.items.slice(0, 40).join(', ')}`).join('\n')}`)
    }
  }

  if (opts.existingDonors?.length && (opts.part === 'donors' || opts.part === 'segments' || opts.part === 'summary')) {
    parts.push(`Уже есть доноры: ${opts.existingDonors.map(d => `${d.name} (${d.layer})`).join(', ')}`)
  }

  if (opts.part === 'segments' || opts.part === 'summary') {
    const existing = formatExistingSegments(opts.existingSegments ?? [])
    if (existing) parts.push(existing)
  }

  if (briefCtx.sourcingHints && (opts.part === 'segments' || opts.part === 'donors' || opts.part === 'query_string')) {
    parts.push(`Подсказки по поиску от нанимающего менеджера / рекрутёра — учти в первую очередь:\n${briefCtx.sourcingHints}`)
  }

  parts.push(`\nЗадача: ${taskInstruction(opts)}`)

  if (opts.hint?.trim()) {
    parts.push(`Уточнение рекрутёра (приоритетнее общих правил): ${opts.hint.trim()}`)
  }

  return { system, prompt: parts.join('\n\n') }
}

function taskInstruction(opts: GeneratePromptOptions): string {
  const n = opts.limit && opts.limit > 0 ? opts.limit : null
  switch (opts.part) {
    case 'sections':
      if (opts.targetSection) {
        const t = opts.targetSection
        return [
          `Дополни ТОЛЬКО секцию "${t.sectionType}" («${t.title}»)${t.guidance ? ` — ${t.guidance}` : ''}:`,
          `${n ? `не более ${n}` : '5–12'} новых пунктов, которых ещё нет в карте. Другие секции не возвращай, summary оставь пустым.`,
        ].join(' ')
      }
      return [
        'Заполни секции карты: 3–5 секций, в каждой 5–12 пунктов. Не повторяй уже заполненное.',
        'Для "title_synonyms" — реальные формулировки из резюме, включая англоязычные.',
        'Для "keywords" — навыки и инструменты из must-have и описания; помечай must-have в note.',
        'Для "exclusions" — кого НЕ ищем (из deal-breakers и здравого смысла).',
        'В "notes" — уровень, домен, ограничения, договорённости.',
        'Поле summary — 3–4 предложения: где искать, почему сложно, с чего начать.',
      ].join(' ')
    case 'summary':
      return [
        'Напиши вердикт по рынку для этой карты: 3–5 предложений простым деловым языком.',
        'Что это за роль и как её называют на рынке; где основной пул и почему; что делает поиск сложным',
        '(узкие must-have, вилка, география, конкуренция за кандидатов); с какой гипотезы начинать и что проверить за первую неделю.',
        opts.currentSummary ? `Текущий вердикт (перепиши, сохранив верные факты): «${opts.currentSummary.slice(0, 1500)}»` : '',
        'Верни только текст вердикта в поле summary.',
      ].filter(Boolean).join(' ')
    case 'donors':
      return [
        `Предложи ${n ? `не более ${n}` : '8–15'} компаний-доноров${opts.targetLayer ? ` для слоя "${opts.targetLayer}" (все с layer = "${opts.targetLayer}")` : ''}.`,
        'Для каждой: layer (core / adjacent / school / alumni), priority и rationale в одно предложение — почему там работают нужные люди.',
        'Опирайся на must-have и идеальный профиль: ищи компании, где такие задачи решают каждый день.',
        'Не повторяй существующих доноров.',
      ].join(' ')
    case 'segments':
      return [
        `Предложи ${n ? `не более ${n}` : '4–8'} гипотез поиска. Гипотеза = слой доноров × тайтлы × гео × канал.`,
        'Строй гипотезы из трёх источников: (1) must-have и идеальный профиль из брифа — где такие люди работают сейчас;',
        '(2) требования из описания — какие формулировки тайтлов и навыков они используют в своих резюме;',
        '(3) подсказки по поиску, если есть, — обязательны к использованию.',
        'Для каждой: name (короткое, понятное рекрутёру), donorLayer, 3–7 titles, 5–12 keywords, 1–3 geo, channelCode, priority,',
        'rationale — одно предложение: почему сработает и из какого источника выведена (бриф / описание / подсказка).',
        'queryString не нужен — он собирается автоматически.',
        'Разнообразь каналы и слои: не все гипотезы через один канал.',
      ].join(' ')
    case 'query_string': {
      const t = opts.targetSegment
      if (!t) return 'Нет гипотезы для переписывания запроса.'
      return [
        `Перепиши строку запроса для гипотезы «${t.name}» под канал ${t.channelName ?? t.channelCode ?? '—'}.`,
        t.queryLanguageHint ? `Синтаксис канала: ${t.queryLanguageHint}.` : '',
        `Тайтлы: ${t.titles.join(', ') || '—'}. Ключевые слова: ${t.keywords.join(', ') || '—'}. Гео: ${t.geo.join(', ') || '—'}.`,
        t.queryString ? `Текущий запрос: ${t.queryString}` : 'Текущего запроса нет.',
        'Не добавляй префикс site: — он подставляется автоматически.',
        'Верни одну строку запроса в поле queryString и короткое пояснение (что изменил и почему) в поле explanation.',
      ].filter(Boolean).join(' ')
    }
  }
}
