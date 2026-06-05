/**
 * Парсер hh.ru resume API payload → плоская структура для UI и PDF.
 *
 * Документация полей: https://api.hh.ru/openapi/redoc#operation/get-resume
 *
 * Все поля опциональны — на разных тарифах/состояниях аккаунта они могут отсутствовать.
 * Старайтесь не падать на missing/null, лучше пропустить блок.
 */

export interface ParsedExperience {
  position?: string
  company?: string
  start?: string
  end?: string
  description?: string // plain text (HTML тэги вырезаны)
}

export interface ParsedEducation {
  name?: string // факультет/специальность
  organization?: string
  year?: number
  result?: string
}

export interface ParsedLanguage {
  name?: string
  level?: string
}

export interface ParsedSalary {
  amount?: number
  currency?: string
}

export interface ParsedTotalExperience {
  months?: number
  years?: number
  monthsRemainder?: number
}

export interface ParsedContact {
  type?: 'email' | 'cell' | 'home' | 'work' | string
  value?: string
}

export interface ParsedHhResume {
  // identity
  firstName?: string
  lastName?: string
  middleName?: string
  fullName?: string
  title?: string // желаемая должность
  // demographics
  birthDate?: string
  gender?: string
  area?: string
  // финансы / тип занятости
  salary?: ParsedSalary
  employments?: string[] // type of employment
  schedules?: string[]
  // итог по опыту
  totalExperience?: ParsedTotalExperience
  // блоки
  experience: ParsedExperience[]
  education: ParsedEducation[]
  skills: string[]          // skill_set — короткие тэги
  about?: string            // skills — длинный текст
  languages: ParsedLanguage[]
  // контакты и ссылки
  contacts: ParsedContact[]
  alternateUrl?: string
  photoUrl?: string
}

function stripHtml(s?: string): string | undefined {
  if (!s) return undefined
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() || undefined
}

function pickString(o: any, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o?.[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

export function parseHhResume(raw: Record<string, unknown>): ParsedHhResume {
  const r = raw as any

  // identity
  const firstName = pickString(r, 'first_name')
  const lastName = pickString(r, 'last_name')
  const middleName = pickString(r, 'middle_name')
  const fullName = [lastName, firstName, middleName].filter(Boolean).join(' ').trim() || undefined

  // total_experience
  const totMonths = r?.total_experience?.months
  let totalExperience: ParsedTotalExperience | undefined
  if (typeof totMonths === 'number' && totMonths > 0) {
    totalExperience = {
      months: totMonths,
      years: Math.floor(totMonths / 12),
      monthsRemainder: totMonths % 12,
    }
  }

  // experience
  const experience: ParsedExperience[] = Array.isArray(r?.experience)
    ? r.experience.map((e: any) => ({
        position: pickString(e, 'position'),
        company: pickString(e, 'company'),
        start: pickString(e, 'start'),
        end: pickString(e, 'end'),
        description: stripHtml(pickString(e, 'description')),
      }))
    : []

  // education.primary[]
  const education: ParsedEducation[] = Array.isArray(r?.education?.primary)
    ? r.education.primary.map((e: any) => ({
        organization: pickString(e, 'organization'),
        name: pickString(e, 'name'),
        result: pickString(e, 'result'),
        year: typeof e?.year === 'number' ? e.year : undefined,
      }))
    : []

  // skills
  const skills: string[] = Array.isArray(r?.skill_set)
    ? r.skill_set.filter((s: unknown) => typeof s === 'string' && (s as string).trim()).map((s: string) => s.trim())
    : []
  const about = stripHtml(pickString(r, 'skills'))

  // languages
  const languages: ParsedLanguage[] = Array.isArray(r?.language)
    ? r.language.map((l: any) => ({
        name: pickString(l, 'name'),
        level: pickString(l?.level, 'name'),
      })).filter((l: ParsedLanguage) => l.name)
    : []

  // contacts
  const contacts: ParsedContact[] = Array.isArray(r?.contact)
    ? r.contact.map((c: any) => {
        const type = pickString(c?.type, 'id') as ParsedContact['type']
        let value: string | undefined
        if (typeof c?.value === 'string') value = c.value
        else if (c?.value && typeof c.value === 'object') value = pickString(c.value, 'formatted', 'number') ?? undefined
        return { type, value }
      }).filter((c: ParsedContact) => c.value)
    : []

  // employments / schedules
  const employments: string[] = Array.isArray(r?.employments)
    ? r.employments.map((e: any) => pickString(e, 'name')).filter(Boolean) as string[]
    : []
  const schedules: string[] = Array.isArray(r?.schedules)
    ? r.schedules.map((s: any) => pickString(s, 'name')).filter(Boolean) as string[]
    : []

  // salary
  let salary: ParsedSalary | undefined
  if (r?.salary && typeof r.salary === 'object') {
    salary = {
      amount: typeof r.salary.amount === 'number' ? r.salary.amount : undefined,
      currency: pickString(r.salary, 'currency'),
    }
  }

  // photo
  const photoUrl = pickString(r?.photo, 'medium', 'small', 'large')

  return {
    firstName,
    lastName,
    middleName,
    fullName,
    title: pickString(r, 'title'),
    birthDate: pickString(r, 'birth_date'),
    gender: pickString(r?.gender, 'name', 'id'),
    area: pickString(r?.area, 'name'),
    salary,
    employments,
    schedules,
    totalExperience,
    experience,
    education,
    skills,
    about,
    languages,
    contacts,
    alternateUrl: pickString(r, 'alternate_url'),
    photoUrl,
  }
}
