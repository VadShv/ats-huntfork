import { z } from 'zod'

// ═════════════════════════════════════════════════════════════════
// Модуль «Карта поиска» — Zod-схемы
// docs/tz-search-map.md §8.4
// ═════════════════════════════════════════════════════════════════

export const donorLayerSchema = z.enum(['core', 'adjacent', 'school', 'alumni', 'custom'])
export const hypothesisStatusSchema = z.enum(['untested', 'in_progress', 'working', 'rejected'])
export const searchMapPrioritySchema = z.enum(['high', 'medium', 'low'])
export const searchMapOriginSchema = z.enum(['manual', 'ai', 'template'])
export const searchMapStatusSchema = z.enum(['draft', 'active', 'archived'])
export const searchMapSectionTypeSchema = z.enum(['title_synonyms', 'keywords', 'geo', 'exclusions', 'notes'])
export const searchMapTemplateStatusSchema = z.enum(['draft', 'published', 'archived'])
export const donorCompanyStatusSchema = z.enum(['active', 'archived', 'merged'])
export const searchMapVersionTriggerSchema = z.enum(['manual', 'sources_changed', 'ai_generated', 'calibration', 'restore'])

export const sizeBandSchema = z.enum(['1-50', '51-200', '201-1000', '1000+'])
export const companyStageSchema = z.enum(['startup', 'growth', 'enterprise', 'state'])

const score1to3 = z.number().int().min(1).max(3).nullable().optional()

// ─── Template ─────────────────────────────────────────────────────

export const templateSectionInputSchema = z.object({
  sectionType: searchMapSectionTypeSchema,
  title: z.string().min(1).max(200).trim(),
  guidance: z.string().max(2000).nullish(),
  isRequired: z.boolean().optional().default(false),
  displayOrder: z.number().int().min(0).optional().default(0),
})

export const templateInputSchema = z.object({
  code: z.string().min(1).max(50).trim().optional(),
  name: z.string().min(1).max(120).trim(),
  description: z.string().max(2000).nullish(),
  targetRoles: z.array(z.string().max(100)).max(50).optional().default([]),
  generationGuidance: z.string().max(4000).nullish(),
  defaultChannelCodes: z.array(z.string().max(100)).max(20).optional().default([]),
  sections: z.array(templateSectionInputSchema).min(1).max(20),
})

// ─── Donor Company ────────────────────────────────────────────────

export const donorCompanyInputSchema = z.object({
  canonicalName: z.string().min(1).max(160).trim(),
  aliases: z.array(z.string().min(1).max(160).trim()).max(50).optional().default([]),
  website: z.string().url().max(500).nullish(),
  hhEmployerId: z.string().max(50).nullish(),
  industry: z.string().max(100).nullish(),
  techStack: z.array(z.string().max(100)).max(100).optional().default([]),
  sizeBand: sizeBandSchema.nullish(),
  stage: companyStageSchema.nullish(),
  country: z.string().max(100).nullish(),
  city: z.string().max(100).nullish(),
  tags: z.array(z.string().max(100)).max(50).optional().default([]),
  notes: z.string().max(2000).nullish(),
})

// ─── Map Donor (in a specific map) ────────────────────────────────

export const mapDonorInputSchema = z.object({
  donorCompanyId: z.string().min(1).optional(),
  name: z.string().min(1).max(160).trim().optional(),
  aliases: z.array(z.string().min(1).max(160).trim()).max(50).optional(),
  industry: z.string().max(100).nullish(),
  techStack: z.array(z.string().max(100)).max(100).optional(),
  layer: donorLayerSchema,
  priority: searchMapPrioritySchema.optional().default('medium'),
  rationale: z.string().max(1000).nullish(),
  origin: searchMapOriginSchema.optional().default('manual'),
}).refine(d => d.donorCompanyId || d.name, 'Either donorCompanyId or name is required')

// ─── Segment ──────────────────────────────────────────────────────

/** Поля сегмента без кросс-проверки — для `.partial()` в PATCH (zod 4 запрещает partial() после refine()). */
export const segmentBaseSchema = z.object({
  name: z.string().max(200).trim().optional(),
  donorLayer: donorLayerSchema.nullish(),
  donorIds: z.array(z.string().min(1)).max(200).optional().default([]),
  titles: z.array(z.string().max(200)).max(50).optional().default([]),
  keywords: z.array(z.string().max(200)).max(50).optional().default([]),
  geo: z.array(z.string().max(200)).max(50).optional().default([]),
  channelId: z.string().min(1).nullish(),
  queryString: z.string().max(2000).nullish(),
  priority: searchMapPrioritySchema.optional().default('medium'),
  poolEstimate: score1to3,
  responseLikelihood: score1to3,
  accessDifficulty: score1to3,
  hypothesisStatus: hypothesisStatusSchema.optional().default('untested'),
  rationale: z.string().max(1000).nullish(),
  resultNote: z.string().max(2000).nullish(),
  origin: searchMapOriginSchema.optional().default('manual'),
  displayOrder: z.number().int().min(0).optional().default(0),
})

export const segmentInputSchema = segmentBaseSchema.refine(
  s => s.donorLayer || s.titles.length || s.keywords.length || s.geo.length || s.channelId,
  'Сегмент должен содержать хотя бы один параметр поиска',
)

// ─── Version ──────────────────────────────────────────────────────

export const versionInputSchema = z.object({
  label: z.string().min(1).max(200).trim(),
  trigger: z.enum(['manual', 'calibration', 'sources_changed']),
  comment: z.string().max(2000).nullish(),
})

// ─── AI Generation ────────────────────────────────────────────────

/**
 * Вход генерации (docs/tz-search-map-v2.md §3.5):
 *  - full / section / donors / segments — дополняют карту (mode append | fill_empty), пишут в БД;
 *  - summary — возвращает новый вердикт БЕЗ сохранения (клиент показывает «было/стало» и PATCH'ит);
 *  - query_string — требует segmentId и hint, возвращает новую строку БЕЗ сохранения.
 */
export const generateInputSchema = z.object({
  scope: z.enum(['full', 'section', 'donors', 'segments', 'query_string', 'summary']),
  mode: z.enum(['fill_empty', 'append']).optional().default('append'),
  sectionId: z.string().min(1).optional(),
  layer: donorLayerSchema.optional(),
  segmentId: z.string().min(1).optional(),
  /** Сколько элементов просить у модели (кнопка «Ещё похожие» → 3). */
  limit: z.number().int().min(1).max(10).optional(),
  /** @deprecated синоним limit, оставлен для совместимости */
  count: z.number().int().min(1).max(30).optional(),
  hint: z.string().max(500).nullish(),
}).superRefine((v, ctx) => {
  if (v.scope === 'query_string') {
    if (!v.segmentId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['segmentId'], message: 'Для переписывания запроса укажите гипотезу (segmentId)' })
    if (!v.hint?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hint'], message: 'Для переписывания запроса нужна подсказка — что изменить' })
  }
})

// ─── Snapshot (jsonb in versions) ─────────────────────────────────

export const searchMapSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  map: z.object({
    id: z.string(),
    templateId: z.string().nullish(),
    templateVersion: z.number().nullish(),
    status: searchMapStatusSchema,
    summary: z.string().nullish(),
  }),
  sections: z.array(z.object({
    id: z.string(),
    sectionType: searchMapSectionTypeSchema,
    title: z.string(),
    displayOrder: z.number(),
    items: z.array(z.object({
      id: z.string(),
      value: z.string(),
      note: z.string().nullish(),
      origin: searchMapOriginSchema,
      displayOrder: z.number(),
    })),
  })),
  donors: z.array(z.object({
    id: z.string(),
    donorCompanyId: z.string(),
    canonicalName: z.string(),
    layer: donorLayerSchema,
    priority: searchMapPrioritySchema,
    hypothesisStatus: hypothesisStatusSchema,
    rationale: z.string().nullish(),
    resultNote: z.string().nullish(),
    origin: searchMapOriginSchema,
  })),
  segments: z.array(z.object({
    id: z.string(),
    name: z.string(),
    donorLayer: donorLayerSchema.nullish(),
    donorIds: z.array(z.string()),
    titles: z.array(z.string()),
    keywords: z.array(z.string()),
    geo: z.array(z.string()),
    channelId: z.string().nullish(),
    channelCode: z.string().nullish(),
    queryString: z.string().nullish(),
    priority: searchMapPrioritySchema,
    poolEstimate: score1to3,
    responseLikelihood: score1to3,
    accessDifficulty: score1to3,
    hypothesisStatus: hypothesisStatusSchema,
    rationale: z.string().nullish(),
    resultNote: z.string().nullish(),
    origin: searchMapOriginSchema,
    isArchived: z.boolean(),
  })),
  sources: z.object({
    brief: z.any().nullish(),
    criteria: z.array(z.object({
      key: z.string(),
      name: z.string(),
      category: z.string().nullish(),
      weight: z.number().nullish(),
    })).optional().default([]),
    descriptionExcerpt: z.string().nullish(),
  }),
})

// ─── Generation Result ────────────────────────────────────────────

export const generateResultSchema = z.object({
  scope: z.string(),
  model: z.string(),
  summary: z.string().nullish(),
  sections: z.array(z.object({
    sectionType: searchMapSectionTypeSchema,
    items: z.array(z.object({
      value: z.string(),
      note: z.string().nullish(),
    })),
  })).optional(),
  donors: z.array(z.object({
    name: z.string(),
    layer: donorLayerSchema,
    priority: searchMapPrioritySchema,
    rationale: z.string(),
    industry: z.string().nullish(),
    techStack: z.array(z.string()).optional(),
    donorCompanyId: z.string().nullish(),
    matchedBy: z.string().nullish(),
  })).optional(),
  segments: z.array(z.object({
    name: z.string(),
    donorLayer: donorLayerSchema.nullish(),
    titles: z.array(z.string()),
    keywords: z.array(z.string()),
    geo: z.array(z.string()),
    channelCode: z.string(),
    queryString: z.string().nullish(),
    priority: searchMapPrioritySchema,
    poolEstimate: score1to3,
    responseLikelihood: score1to3,
    accessDifficulty: score1to3,
    rationale: z.string().nullish(),
  })).optional(),
  queryString: z.object({
    segmentId: z.string(),
    channelCode: z.string(),
    queryString: z.string(),
    explanation: z.string().nullish(),
  }).nullish(),
  warnings: z.array(z.string()).optional().default([]),
})
