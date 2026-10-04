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
  hint?: string | null
}): { system: string; prompt: string } {
  const system = `Ты — эксперт-сорсер по подбору IT-специалистов в России.
Твоя задача — помочь рекрутеру построить "карту поиска" для вакансии.

Карта поиска состоит из:
1. Секции (факты о вакансии): ключевые навыки, must-have, nice-to-have, гео, формат работы, уровень, домен
2. Компании-доноры (откуда искать кандидатов): ядро, смежный круг, школы компетенций, alumni
3. Сегменты (гипотезы поиска): комбинация тайтлов + гео + ключевые слова + канал

Правила:
- Отвечай на русском языке
- Будь конкретен: названия компаний, тайтлы, ключевые слова
- Для компаний-доноров указывай реальные компании на российском IT-рынке
- Для сегментов: 3-7 тайтлов, 1-3 гео, 5-15 ключевых слов
- channelCode: "hh_ru", "hh_ru_resumes", "google_xray_hh", "google_xray_linkedin", "telegram"
- Приоритеты: p1 (высший), p2, p3
- Слои доноров: core, adjacent, school, alumni, custom

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

  const scopeInstructions: Record<string, string> = {
    full: 'Сгенерируй все секции, доноров и сегменты.',
    section: 'Дополни секции карты.',
    donors: 'Предложи компании-доноры.',
    segments: 'Предложи сегменты поиска.',
    query_string: 'Уточни строки запроса для сегментов.',
    summary: 'Напиши краткое саммари карты поиска.',
  }

  parts.push(`\nЗадача: ${scopeInstructions[opts.scope] ?? scopeInstructions.full}`)

  return { system, prompt: parts.join('\n\n') }
}
