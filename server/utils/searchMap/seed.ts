import { eq, and } from 'drizzle-orm'
import { sourcingChannel, searchMapTemplate, searchMapTemplateSection } from '../../database/schema/app'

// ═════════════════════════════════════════════════════════════════
// Seed: system channels + default template (lazy, idempotent)
// docs/tz-search-map.md §5.5, §13.2
// ═════════════════════════════════════════════════════════════════

const SYSTEM_CHANNELS = [
  { code: 'hh', name: 'hh.ru', defaultPriority: 'high' as const, urlTemplate: 'https://hh.ru/search/resume?text={query}', queryLanguageHint: 'Язык поиска hh.ru: AND/OR/NOT, кавычки для точной фразы, скобки для группировки, * для усечения', targetSite: null, displayOrder: 0 },
  { code: 'linkedin', name: 'LinkedIn', defaultPriority: 'medium' as const, urlTemplate: 'https://www.linkedin.com/search/results/people/?keywords={query}', queryLanguageHint: 'Boolean-синтаксис LinkedIn: AND/OR/NOT, кавычки, скобки', targetSite: null, displayOrder: 1 },
  { code: 'github', name: 'GitHub', defaultPriority: 'low' as const, urlTemplate: 'https://github.com/search?q={query}&type=users', queryLanguageHint: 'Boolean-синтаксис GitHub', targetSite: null, displayOrder: 2 },
  { code: 'telegram', name: 'Telegram', defaultPriority: 'medium' as const, urlTemplate: null, queryLanguageHint: null, targetSite: null, displayOrder: 3 },
  { code: 'habr', name: 'Habr Career', defaultPriority: 'medium' as const, urlTemplate: 'https://career.habr.com/candidates?query={query}', queryLanguageHint: null, targetSite: null, displayOrder: 4 },
  { code: 'referral', name: 'Рефералы', defaultPriority: 'high' as const, urlTemplate: null, queryLanguageHint: null, targetSite: null, displayOrder: 5 },
  { code: 'google_xray_linkedin', name: 'Google x-ray LinkedIn', defaultPriority: 'medium' as const, urlTemplate: 'https://www.google.com/search?q={query}', queryLanguageHint: 'Google x-ray: boolean AND/OR/NOT (заглавные), кавычки для точной фразы, intitle:, -intitle:, - для исключений', targetSite: 'linkedin.com/in', displayOrder: 6 },
  { code: 'google_xray_github', name: 'Google x-ray GitHub', defaultPriority: 'low' as const, urlTemplate: 'https://www.google.com/search?q={query}', queryLanguageHint: 'Google x-ray: boolean, inurl:, filetype:pdf для резюме, - для исключений', targetSite: 'github.com', displayOrder: 7 },
]

export async function ensureSystemChannels(orgId: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const ch of SYSTEM_CHANNELS) {
      await tx.insert(sourcingChannel).values({
        organizationId: orgId,
        code: ch.code,
        name: ch.name,
        defaultPriority: ch.defaultPriority,
        urlTemplate: ch.urlTemplate,
        queryLanguageHint: ch.queryLanguageHint,
        targetSite: ch.targetSite,
        isSystem: true,
        isActive: true,
        displayOrder: ch.displayOrder,
      }).onConflictDoNothing()
    }
  })
}

const DEFAULT_TEMPLATE_SECTIONS = [
  { sectionType: 'title_synonyms' as const, title: 'Тайтлы и синонимы', guidance: 'Как позицию называют в разных компаниях и сегментах рынка; добавьте англоязычные варианты', isRequired: true, displayOrder: 0 },
  { sectionType: 'keywords' as const, title: 'Ключевые слова и навыки', guidance: 'Технологии, инструменты, методологии, домены; то, что есть в резюме, а не в вакансии', isRequired: true, displayOrder: 1 },
  { sectionType: 'geo' as const, title: 'География', guidance: 'Города, регионы, часовые пояса, релокация', isRequired: false, displayOrder: 2 },
  { sectionType: 'exclusions' as const, title: 'Исключения', guidance: 'Компании, которые не трогаем (клиенты, партнёры, non-poach), тайтлы-ложные срабатывания', isRequired: false, displayOrder: 3 },
  { sectionType: 'notes' as const, title: 'Заметки и договорённости', guidance: 'Калибровка с HM, что обсуждали, ограничения', isRequired: false, displayOrder: 4 },
]

const DEFAULT_GENERATION_GUIDANCE = 'Слой core — прямые конкуренты и компании с такими же продуктами/процессами. Слой adjacent — смежные индустрии с тем же навыком. Слой school — компании, где навык массово выращивают (аутсорс, интеграторы, крупные корпорации с программами). Слой alumni — бывшие сотрудники компаний-ориентиров. Не предлагай компании из секции исключений.'

export async function ensureDefaultTemplate(orgId: string): Promise<void> {
  const [existing] = await db.select({ id: searchMapTemplate.id })
    .from(searchMapTemplate)
    .where(and(eq(searchMapTemplate.organizationId, orgId), eq(searchMapTemplate.code, 'SM-DEFAULT')))
    .limit(1)
  if (existing) return

  await db.transaction(async (tx) => {
    const [template] = await tx.insert(searchMapTemplate).values({
      organizationId: orgId,
      code: 'SM-DEFAULT',
      name: 'Универсальная карта',
      generationGuidance: DEFAULT_GENERATION_GUIDANCE,
      isDefault: true,
      status: 'published',
      version: 1,
      publishedAt: new Date(),
    }).returning()

    for (const section of DEFAULT_TEMPLATE_SECTIONS) {
      await tx.insert(searchMapTemplateSection).values({
        organizationId: orgId,
        templateId: template.id,
        sectionType: section.sectionType,
        title: section.title,
        guidance: section.guidance,
        isRequired: section.isRequired,
        displayOrder: section.displayOrder,
      })
    }
  })
}
