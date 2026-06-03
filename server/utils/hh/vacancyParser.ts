/**
 * Utilities for parsing hh.ru vacancy URLs/IDs and converting hh-format
 * vacancy data into Huntfork's job form shape.
 *
 * hh.ru URL shapes that should resolve to a vacancy_id:
 *   https://hh.ru/vacancy/12345678
 *   https://hh.ru/vacancy/12345678?param=...
 *   https://spb.hh.ru/vacancy/12345678
 *   https://nn.hh.ru/employer/123/vacancy/12345678
 *   bare ID: 12345678
 */

const VACANCY_ID_RE = /vacancy\/(\d+)/i
const BARE_ID_RE = /^\s*(\d{4,})\s*$/

export function extractVacancyId(input: string): string | null {
  if (!input) return null
  const bare = input.match(BARE_ID_RE)
  if (bare) return bare[1]!
  const m = input.match(VACANCY_ID_RE)
  if (m) return m[1]!
  return null
}

/** hh.ru API response for /vacancies/{id} — partial typing of fields we use. */
export interface HhVacancyApi {
  id: string
  name: string
  description?: string
  branded_description?: string
  area?: { name?: string }
  employment?: { id?: string; name?: string }
  schedule?: { id?: string; name?: string }
  experience?: { id?: string; name?: string }
  salary?: {
    from?: number | null
    to?: number | null
    currency?: string | null
    gross?: boolean | null
  } | null
  key_skills?: Array<{ name: string }>
  professional_roles?: Array<{ id: string; name: string }>
  alternate_url?: string
  employer?: { id?: string; name?: string }
  [key: string]: unknown
}

/** Strip HTML tags from hh.ru description preserving simple line breaks. */
export function stripHtml(input: string): string {
  if (!input) return ''
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Map hh employment+schedule to Huntfork's job.type enum. */
export function mapJobType(
  employmentId?: string,
  scheduleId?: string,
): 'full_time' | 'part_time' | 'contract' | 'internship' {
  if (employmentId === 'probation') return 'internship'
  if (employmentId === 'part') return 'part_time'
  if (employmentId === 'project') return 'contract'
  // schedule fallback (rare hh combos)
  if (scheduleId === 'flyInFlyOut') return 'full_time'
  return 'full_time'
}

/** Map hh experience id to Huntfork experienceLevel enum. */
export function mapExperienceLevel(
  experienceId?: string,
): 'junior' | 'mid' | 'senior' | 'lead' | undefined {
  switch (experienceId) {
    case 'noExperience': return 'junior'
    case 'between1And3': return 'mid'
    case 'between3And6': return 'senior'
    case 'moreThan6': return 'lead'
    default: return undefined
  }
}

/** Map hh schedule id to Huntfork remoteStatus. */
export function mapRemoteStatus(
  scheduleId?: string,
): 'remote' | 'hybrid' | 'onsite' | undefined {
  switch (scheduleId) {
    case 'remote': return 'remote'
    case 'flexible': return 'hybrid'
    case 'fullDay': return 'onsite'
    case 'shift': return 'onsite'
    default: return undefined
  }
}

/**
 * Convert raw hh.ru vacancy API response → flat Huntfork form payload.
 * The shape is intentionally aligned with `form` state in dashboard/jobs/new.vue.
 */
export interface ParsedHhVacancy {
  hhVacancyId: string
  hhVacancyUrl: string
  title: string
  description: string
  location: string
  type: 'full_time' | 'part_time' | 'contract' | 'internship'
  experienceLevel?: 'junior' | 'mid' | 'senior' | 'lead'
  remoteStatus?: 'remote' | 'hybrid' | 'onsite'
  salaryMin?: number
  salaryMax?: number
  salaryCurrency?: string
  keySkills: string[]
  professionalRoles: string[]
}

export function toHuntforkForm(raw: HhVacancyApi): ParsedHhVacancy {
  const description = stripHtml(raw.description || raw.branded_description || '')
  return {
    hhVacancyId: raw.id,
    hhVacancyUrl: raw.alternate_url || `https://hh.ru/vacancy/${raw.id}`,
    title: raw.name,
    description,
    location: raw.area?.name || '',
    type: mapJobType(raw.employment?.id, raw.schedule?.id),
    experienceLevel: mapExperienceLevel(raw.experience?.id),
    remoteStatus: mapRemoteStatus(raw.schedule?.id),
    salaryMin: raw.salary?.from ?? undefined,
    salaryMax: raw.salary?.to ?? undefined,
    salaryCurrency: raw.salary?.currency ?? undefined,
    keySkills: (raw.key_skills || []).map(s => s.name).filter(Boolean),
    professionalRoles: (raw.professional_roles || []).map(r => r.name).filter(Boolean),
  }
}
