/**
 * Build the system + user prompts for AI generation of search map content.
 * docs/tz-search-map.md §10
 */

export function buildGeneratePrompt(opts: {
  scope: string
  jobTitle: string
  brief?: any
  criteria?: { name: string; category?: string | null; weight?: number | null }[]
  description?: string
  existingSections?: { title: string; items: string[] }[]
  existingDonors?: { name: string; layer: string }[]
  /** Активные каналы организации — модель обязана использовать только эти channelCode */
  channels?: { code: string; name: string }[]
  hint?: string | null
}): { system: string; prompt: string } {
  const channelList = (opts.channels?.length
    ? opts.channels
    : [{ code: 'hh', name: 'hh.ru' }, { code: 'linkedin', name: 'LinkedIn' }, { code: 'telegram', name: 'Telegram' }, { code: 'google_xray_linkedin', name: 'Google x-ray LinkedIn' }])
    .map(c => `"${c.code}" (${c.name})`).join(', ')

  const system = `Ты — эксперт-сорсер по подбору IT-специалистов в России.
Твоя задача — помочь рекрутеру построить "карту поиска" для вакансии.

Карта поиска состоит из:
1. Секции (факты о вакансии). Допустимые sectionType — строго из списка:
   - "title_synonyms" — как позицию называют в разных компаниях (включая англоязычные варианты)
   - "keywords" — ключевые навыки, технологии, инструменты, домены (must-have и nice-to-have)
   - "geo" — города, регионы, часовые пояса, формат работы и релокация
   - "exclusions" — компании и тайтлы, которые исключаем (ложные срабатывания)
   - "notes" — уровень, домен, ограничения и договорённости с нанимающим менеджером
2. Компании-доноры (откуда искать кандидатов): ядро, смежный круг, школы компетенций, alumni
3. Сегменты (гипотезы поиска): комбинация тайтлов + гео + ключевые слова + канал

Правила:
- Отвечай на русском языке
- Будь конкретен: названия компаний, тайтлы, ключевые слова
- Для компаний-доноров указывай реальные компании на российском IT-рынке
- Для сегментов: 3-7 тайтлов, 1-3 гео, 5-15 ключевых слов
- channelCode — строго один из: ${channelList}
- Приоритеты (priority) — строго: "high" (высший), "medium", "low"
- Слои доноров (layer / donorLayer) — строго: "core", "adjacent", "school", "alumni", "custom"

${opts.hint ? `\nДополнительная подсказка рекрутера: ${opts.hint}` : ''}`

  const parts: string[] = []
  parts.push(`Вакансия: ${opts.jobTitle}`)

  if (opts.brief) {
    const b = opts.brief
    if (b.roleProfile) parts.push(`Профиль роли: ${typeof b.roleProfile === 'string' ? b.roleProfile : JSON.stringify(b.roleProfile)}`)
    if (b.seniority) parts.push(`Грейд: ${b.seniority}`)
    if (b.format) parts.push(`Формат работы: ${b.format}`)
    if (b.location) parts.push(`Локация: ${b.location}`)
    if (b.salaryFrom || b.salaryTo) parts.push(`Зарплата: ${b.salaryFrom ?? ''}-${b.salaryTo ?? ''}`)
    if (b.mustHave) parts.push(`Must have: ${Array.isArray(b.mustHave) ? b.mustHave.join(', ') : b.mustHave}`)
    if (b.niceToHave) parts.push(`Nice to have: ${Array.isArray(b.niceToHave) ? b.niceToHave.join(', ') : b.niceToHave}`)
  }

  if (opts.criteria?.length) {
    parts.push(`Критерии оценки:\n${opts.criteria.map(c => `  - ${c.name}${c.category ? ` [${c.category}]` : ''}${c.weight ? ` (вес ${c.weight})` : ''}`).join('\n')}`)
  }

  if (opts.description) {
    const excerpt = opts.description.slice(0, 2000)
    parts.push(`Описание вакансии:\n${excerpt}`)
  }

  if (opts.existingSections?.length) {
    parts.push(`Уже заполнено:\n${opts.existingSections.map(s => `  ${s.title}: ${s.items.join(', ')}`).join('\n')}`)
  }

  if (opts.existingDonors?.length) {
    parts.push(`Уже есть доноры: ${opts.existingDonors.map(d => `${d.name} (${d.layer})`).join(', ')}`)
  }

  // Каждый scope — компактный ответ. «full» на стороне сервера разбивается на три
  // параллельных вызова (section / donors / segments): меньше токенов на вызов,
  // быстрее, и сбой одного не теряет остальные.
  const scopeInstructions: Record<string, string> = {
    full: 'Сгенерируй секции, доноров и сегменты.',
    section: 'Заполни секции карты: 3-5 секций, в каждой 5-12 пунктов. Не повторяй уже заполненное. Для секции "exclusions" перечисли, кого НЕ ищем. В "notes" — уровень, домен, ограничения. Поле summary — 3-4 предложения: где искать, почему сложно, с чего начать.',
    donors: 'Предложи 8-15 компаний-доноров. Для каждой: layer (core — где работают прямые аналоги; adjacent — смежные компании; school — где учат нужному; alumni — откуда уходят к нам), priority и 1 предложение rationale (почему оттуда). Не повторяй уже существующих доноров.',
    segments: 'Предложи 4-8 сегментов поиска. Сегмент = слой доноров × тайтлы × гео × канал. Для каждого: name, donorLayer, 3-7 titles, 5-12 keywords, 1-3 geo, channelCode, queryString на языке канала (для hh — AND/OR/NOT, кавычки; для Google x-ray — site:, кавычки, OR), priority, rationale (1 предложение: почему гипотеза сработает).',
    query_string: 'Уточни строки запроса для сегментов.',
    summary: 'Напиши краткое саммари карты поиска (3-4 предложения).',
  }

  parts.push(`\nЗадача: ${scopeInstructions[opts.scope] ?? scopeInstructions.full}`)

  return { system, prompt: parts.join('\n\n') }
}
