export const EMPLOYER_COLLECTIONS = [
  'response',
  'consider',
  'phone_interview',
  'assessment',
  'interview',
  'offer',
  'hired',
  'discard_by_employer',
  'discard_visible_by_opponent',
  'discard_after_interview',
] as const

export type EmployerCollection = typeof EMPLOYER_COLLECTIONS[number]
