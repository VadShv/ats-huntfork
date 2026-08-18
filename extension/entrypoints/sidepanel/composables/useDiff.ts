/**
 * useDiff — дифф профиля кандидата.
 *
 * Кандидат уже был в базе — панель показывает, что изменилось с прошлого раза:
 * сменил компанию, вырос грейд, обновил стек. Для реактивации спящей базы
 * это ценнее любого нового поиска.
 *
 * Сравнивает текущий parsedFull (после захвата) с candidate.snapshot
 * из расширенного ответа lookup.
 */
import { computed } from 'vue'
import { useSidekick } from './useSidekick'

export type DiffStatus = 'added' | 'changed' | 'removed' | 'same'

export interface DiffField {
  label: string
  oldValue?: string
  newValue?: string
  status: DiffStatus
}

export interface DiffState {
  visible: boolean
  lastSeen?: string
  fields: DiffField[]
}

const EMPTY: DiffState = { visible: false, fields: [] }

export function useDiff() {
  const { lookupInfo, parsedFull, phase } = useSidekick()

  const diff = computed<DiffState>(() => {
    // Дифф показывается когда кандидат существует в базе и есть snapshot.
    const info = lookupInfo.value
    if (!info) return EMPTY

    const snapshot = info.candidate?.snapshot ?? info.snapshot
    if (!snapshot) return EMPTY

    const current = parsedFull.value
    // Текущие данные могут быть из parsedFull (после захвата) или из snapshot (до).
    const curr = current || snapshot

    const fields: DiffField[] = []

    // Компания / должность
    diffScalar(fields, 'Должность', snapshot.title, curr?.title)
    diffScalar(fields, 'Компания', snapshot.company, curr?.experience?.[0]?.company)
    diffScalar(fields, 'Город', snapshot.city, curr?.city)

    // Грейд / уровень
    diffScalar(fields, 'Грейд', snapshot.grade, curr?.grade)

    // Зарплата
    diffScalar(fields, 'Зарплата', snapshot.salary, curr?.salary)

    // Навыки (множественное сравнение)
    diffSkills(fields, snapshot.skills, curr?.skills)

    const hasChanges = fields.some((f) => f.status !== 'same')
    if (!hasChanges) return EMPTY

    return {
      visible: true,
      lastSeen: info.candidate?.lastSeen ?? snapshot.lastSeen,
      fields,
    }
  })

  return { diff }
}

function diffScalar(
  out: DiffField[],
  label: string,
  oldVal: unknown,
  newVal: unknown,
) {
  const o = normalize(oldVal)
  const n = normalize(newVal)
  if (!o && !n) return
  let status: DiffStatus = 'same'
  if (!o && n) status = 'added'
  else if (o && !n) status = 'removed'
  else if (o !== n) status = 'changed'
  out.push({ label, oldValue: o || undefined, newValue: n || undefined, status })
}

function diffSkills(
  out: DiffField[],
  oldSkills: unknown,
  newSkills: unknown,
) {
  const oldArr = toArray(oldSkills)
  const newArr = toArray(newSkills)
  if (!oldArr.length && !newArr.length) return

  const oldSet = new Set(oldArr.map((s) => s.toLowerCase()))
  const newSet = new Set(newArr.map((s) => s.toLowerCase()))

  const added = newArr.filter((s) => !oldSet.has(s.toLowerCase()))
  const removed = oldArr.filter((s) => !newSet.has(s.toLowerCase()))
  const kept = newArr.filter((s) => oldSet.has(s.toLowerCase()))

  if (!added.length && !removed.length) {
    if (kept.length) out.push({ label: 'Навыки', oldValue: kept.join(', '), status: 'same' })
    return
  }

  if (added.length) {
    out.push({
      label: 'Навыки (+новые)',
      oldValue: removed.length ? removed.join(', ') : undefined,
      newValue: added.join(', '),
      status: 'added',
    })
  }
  if (removed.length && !added.length) {
    out.push({
      label: 'Навыки (−ушедшие)',
      oldValue: removed.join(', '),
      status: 'removed',
    })
  }
}

function normalize(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.filter(Boolean).join(', ')
  return String(v).trim()
}

function toArray(v: unknown): string[] {
  if (!v) return []
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean)
  return []
}
