/**
 * Краткая сводка изменений между двумя версиями hh-резюме для отображения
 * в селекторе версий: «+2 места работы, ↑ зарплата, контакты изменены».
 *
 * Не глубокий diff — только «человекочитаемые» дельты для UI-подсказки.
 */
export interface ResumeDelta {
  /** Количество новых записей опыта работы относительно прошлой версии (может быть отрицательным). */
  experienceCountDelta?: number
  /** Изменился ли job title (текущая желаемая должность). */
  titleChanged?: boolean
  /** Изменилась ли указанная зарплата. */
  salaryChanged?: boolean
  /** Изменился ли список контактов (телефоны/email-ы). */
  contactsChanged?: boolean
  /** Изменился ли список ключевых навыков. */
  skillsChanged?: boolean
  /** Изменился ли город. */
  cityChanged?: boolean
  /** Сводка по полю area (для отладки) */
  fieldsChanged?: string[]
}

function safeArrayLength(v: unknown): number {
  return Array.isArray(v) ? v.length : 0
}

function getNested(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    }
    else {
      return undefined
    }
  }
  return cur
}

function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * Сравнивает прошлый и текущий snapshot hh-резюме, возвращая краткую дельту.
 */
export function computeResumeDelta(
  previous: Record<string, unknown> | null | undefined,
  current: Record<string, unknown>,
): ResumeDelta {
  if (!previous) {
    // Первая версия — единственная значимая «дельта» — общий объём опыта
    return {
      experienceCountDelta: safeArrayLength(current.experience),
    }
  }

  const delta: ResumeDelta = {}
  const fieldsChanged: string[] = []

  const prevExpCount = safeArrayLength(previous.experience)
  const curExpCount = safeArrayLength(current.experience)
  if (prevExpCount !== curExpCount) {
    delta.experienceCountDelta = curExpCount - prevExpCount
    fieldsChanged.push('experience')
  }

  if (!jsonEq(previous.title, current.title)) {
    delta.titleChanged = true
    fieldsChanged.push('title')
  }

  if (!jsonEq(previous.salary, current.salary)) {
    delta.salaryChanged = true
    fieldsChanged.push('salary')
  }

  if (!jsonEq(previous.contact, current.contact)) {
    delta.contactsChanged = true
    fieldsChanged.push('contact')
  }

  if (!jsonEq(previous.skill_set, current.skill_set) || !jsonEq(previous.skills, current.skills)) {
    delta.skillsChanged = true
    fieldsChanged.push('skills')
  }

  const prevArea = getNested(previous, 'area.name') ?? getNested(previous, 'area.id')
  const curArea = getNested(current, 'area.name') ?? getNested(current, 'area.id')
  if (!jsonEq(prevArea, curArea)) {
    delta.cityChanged = true
    fieldsChanged.push('area')
  }

  if (fieldsChanged.length > 0) {
    delta.fieldsChanged = fieldsChanged
  }

  return delta
}

/**
 * Человекочитаемая строка дельты для UI (RU).
 */
export function formatResumeDeltaRu(delta: ResumeDelta): string {
  const parts: string[] = []
  if (typeof delta.experienceCountDelta === 'number' && delta.experienceCountDelta !== 0) {
    const sign = delta.experienceCountDelta > 0 ? '+' : ''
    parts.push(`${sign}${delta.experienceCountDelta} мест работы`)
  }
  if (delta.titleChanged) parts.push('должность')
  if (delta.salaryChanged) parts.push('зарплата')
  if (delta.contactsChanged) parts.push('контакты')
  if (delta.skillsChanged) parts.push('навыки')
  if (delta.cityChanged) parts.push('город')
  return parts.join(', ')
}
