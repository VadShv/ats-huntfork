import { z } from 'zod'

// ─────────────────────────────────────────────
// Оргструктура: компании (юрлица) и подразделения
// Схемы валидации для /api/companies и /api/departments
// ─────────────────────────────────────────────

/** Создание компании (юрлица) */
export const createCompanySchema = z.object({
  name: z.string().trim().min(1, 'Название обязательно').max(200),
  legalName: z.string().trim().max(300).nullable().optional(),
  inn: z.string().trim().max(12).nullable().optional(),
  logoUrl: z.string().trim().url('Некорректный URL логотипа').max(500).nullable().optional(),
  /** Сделать компанией по умолчанию (предыдущая снимается транзакцией) */
  isDefault: z.boolean().optional(),
})

/** Обновление компании — PATCH-семантика */
export const updateCompanySchema = z.object({
  name: z.string().trim().min(1, 'Название обязательно').max(200).optional(),
  legalName: z.string().trim().max(300).nullable().optional(),
  inn: z.string().trim().max(12).nullable().optional(),
  logoUrl: z.string().trim().url('Некорректный URL логотипа').max(500).nullable().optional(),
  isDefault: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
})

/** Создание подразделения */
export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1, 'Название обязательно').max(200),
  /** Юрлицо; null = общее для всей организации */
  companyId: z.string().nullable().optional(),
  /** Родительское подразделение; null = корневой узел */
  parentId: z.string().nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
})

/** Обновление подразделения — PATCH-семантика */
export const updateDepartmentSchema = z.object({
  name: z.string().trim().min(1, 'Название обязательно').max(200).optional(),
  companyId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  isArchived: z.boolean().optional(),
})
