/**
 * Типы сорсинга hh.ru — единый источник правды для snapshot.
 *
 * SourcingSnapshot — анонимизированный снапшот резюме, который мы
 * сохраняем у себя в `hh_sourcing_candidate.snapshot` (jsonb).
 *
 * ВНИМАНИЕ: никаких контактов (имя, email, телефон) здесь быть не должно.
 * Контакты тянутся live через open-contact (тратит квоту hh).
 *
 * Обратная совместимость: все поля optional. Старые записи (до расширения)
 * содержат подмножество полей — UI рендерит по наличию (v-if).
 */

/** Одно место работы в снапшоте. */
export interface SnapshotExperienceItem {
  company: string | null
  position: string | null
  start: string | null
  end: string | null
  durationMonths: number | null
  description?: string | null
}

/** Одно учебное заведение в снапшоте. */
export interface SnapshotEducationItem {
  institution: string | null
  faculty: string | null
  level: string | null
  year: string | null
}

/**
 * Полный анонимизированный снапшот резюме.
 *
 * Поля групп:
 *  - Базовые: title, area*, salary*, age, updatedAt
 *  - Опыт: experienceYears, totalExperienceMonths, lastCompany/lastPosition
 *          (для обратной совместимости), experience[] (последние 3 места)
 *  - Навыки: skills[]
 *  - Образование: educationLevel, education[]
 *  - Условия: workFormat[], employmentForm[], relocation
 *  - Прочее: citizenship, searchActivity (пол сознательно НЕ храним — дискриминационный риск)
 */
export interface SourcingSnapshot {
  // ── Базовые ──────────────────────────────────────────────
  title: string | null
  areaId: string | null
  areaName: string | null
  salaryAmount: number | null
  salaryCurrency: string | null
  age: number | null
  updatedAt: string | null

  // ── Опыт работы ──────────────────────────────────────────
  experienceYears: number | null
  /** Сырое значение общего опыта в месяцах (рядом с experienceYears). */
  totalExperienceMonths: number | null
  /** Последняя компания (выводится из experience[0]) — для обратной совместимости. */
  lastCompany: string | null
  /** Последняя должность (выводится из experience[0]) — для обратной совместимости. */
  lastPosition: string | null
  /** Последние 3 места работы (детально, для сворачиваемого блока). */
  experience: SnapshotExperienceItem[]

  // ── Навыки ───────────────────────────────────────────────
  /** Ключевые навыки из skill_set. */
  skills: string[]

  // ── Образование ──────────────────────────────────────────
  /** Уровень образования (higher/bachelor/...). */
  educationLevel: string | null
  /** Последние 2 учебных заведения. */
  education: SnapshotEducationItem[]

  // ── Условия работы ───────────────────────────────────────
  /** Формат работы (ON_SITE/REMOTE/HYBRID/FIELD_WORK). */
  workFormat: string[]
  /** Тип занятости (full/part/project/...). */
  employmentForm: string[]
  /** Готовность к релокации. */
  relocation: { type: string | null } | null

  // ── Прочее (не PII) ──────────────────────────────────────
  /** Гражданство (страны). */
  citizenship: string[]
  /** Активность поиска / когда обновлял резюме. */
  searchActivity: string | null
}

/** Обязательные-при-создании поля снапшота (остальные optional). */
export type SourcingSnapshotInput = Partial<SourcingSnapshot> & {
  title: SourcingSnapshot['title']
  areaId: SourcingSnapshot['areaId']
  areaName: SourcingSnapshot['areaName']
  salaryAmount: SourcingSnapshot['salaryAmount']
  salaryCurrency: SourcingSnapshot['salaryCurrency']
  experienceYears: SourcingSnapshot['experienceYears']
  lastCompany: SourcingSnapshot['lastCompany']
  lastPosition: SourcingSnapshot['lastPosition']
  age: SourcingSnapshot['age']
  updatedAt: SourcingSnapshot['updatedAt']
}
