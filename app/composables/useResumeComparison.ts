import type { MaybeRefOrGetter } from 'vue'

// ─── Типы версий (из GET /resume-versions) ───────────────────────────────
export interface ResumeVersionRow {
  id: string
  versionNumber: number
  source: string
  contentHash: string | null
  deltaSummary: Record<string, unknown> | null
  deltaSummaryText: string | null
  hhUpdatedAt: string | null
  fetchedAt: string
  isCurrent: boolean
  triggeredBy: string | null
  mergedFromCandidateId: string | null
  createdAt: string
}

// ─── Типы diff ───────────────────────────────────────────────────────────
export interface DiffField {
  label: string
  base: string
  compare: string
  changed: boolean
}

export interface DiffExperience {
  status: 'added' | 'removed' | 'changed' | 'unchanged'
  company: string
  position: string
  period: string
  changes: string[]
}

export interface SnapshotDiff {
  fields: DiffField[]
  experience: DiffExperience[]
  skillsAdded: string[]
  skillsRemoved: string[]
  skillsUnchanged: number
  aboutChanged: boolean
  hasChanges: boolean
  summary: string
}

// ─── Утилиты извлечения из snapshot (hh-compatible raw) ──────────────────
function snapStr(s: any, key: string): string {
  const v = s?.[key]
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') return v.name ?? v.value ?? ''
  return String(v)
}

function expPeriod(e: any): string {
  const fmt = (d: string | null | undefined): string => {
    if (!d) return ''
    if (/настоящее|present|now|текущее/i.test(d)) return 'н.в.'
    return d
  }
  return `${fmt(e?.start) || '?'} — ${fmt(e?.end) || 'н.в.'}`
}

function expKey(e: any): string {
  return `${(e?.company ?? '').trim().toLowerCase()}|${(e?.position ?? '').trim().toLowerCase()}`
}

/**
 * Вычисляет структурный diff между двумя snapshot'ами резюме.
 * Считается клиентом из полных snapshot'ов — точно, без reliance на deltaSummary.
 */
export function computeSnapshotDiff(base: Record<string, any> | null, compare: Record<string, any> | null): SnapshotDiff {
  const b = base ?? {}
  const c = compare ?? {}

  // ── Поля (title, area, salary, phone, email) ──
  const fieldDefs: Array<{ key: string, label: string }> = [
    { key: 'title', label: 'Должность' },
    { key: 'area', label: 'Город' },
    { key: 'salary', label: 'Зарплата' },
    { key: 'phone', label: 'Телефон' },
    { key: 'email', label: 'Email' },
  ]
  const fields: DiffField[] = fieldDefs.map(({ key, label }) => {
    const bv = snapStr(b, key)
    const cv = snapStr(c, key)
    return { label, base: bv, compare: cv, changed: bv !== cv }
  })

  // ── Опыт работы ──
  const bExp: any[] = Array.isArray(b.experience) ? b.experience : []
  const cExp: any[] = Array.isArray(c.experience) ? c.experience : []
  const bMap = new Map<string, any>()
  const cMap = new Map<string, any>()
  for (const e of bExp) bMap.set(expKey(e), e)
  for (const e of cExp) cMap.set(expKey(e), e)

  const experience: DiffExperience[] = []
  // Добавленные (есть в compare, нет в base)
  for (const e of cExp) {
    const key = expKey(e)
    if (!bMap.has(key)) {
      experience.push({
        status: 'added',
        company: e?.company ?? '—',
        position: e?.position ?? '',
        period: expPeriod(e),
        changes: [],
      })
    }
  }
  // Изменённые и удалённые
  for (const e of bExp) {
    const key = expKey(e)
    const ce = cMap.get(key)
    if (!ce) {
      experience.push({
        status: 'removed',
        company: e?.company ?? '—',
        position: e?.position ?? '',
        period: expPeriod(e),
        changes: [],
      })
    }
    else {
      const changes: string[] = []
      if (snapStr(e, 'position') !== snapStr(ce, 'position')) changes.push('должность')
      if (expPeriod(e) !== expPeriod(ce)) changes.push('период')
      const bDesc = (e?.description ?? '').length
      const cDesc = (ce?.description ?? '').length
      if (bDesc !== cDesc) changes.push(`обязанности: ${bDesc}→${cDesc} симв.`)
      experience.push({
        status: changes.length ? 'changed' : 'unchanged',
        company: e?.company ?? '—',
        position: ce?.position ?? e?.position ?? '',
        period: expPeriod(ce),
        changes,
      })
    }
  }

  // ── Навыки (set diff) ──
  const bSkills: string[] = Array.isArray(b.skill_set) ? b.skill_set.map(String) : []
  const cSkills: string[] = Array.isArray(c.skill_set) ? c.skill_set.map(String) : []
  const bSet = new Set(bSkills.map(s => s.toLowerCase()))
  const cSet = new Set(cSkills.map(s => s.toLowerCase()))
  const skillsAdded = cSkills.filter(s => !bSet.has(s.toLowerCase()))
  const skillsRemoved = bSkills.filter(s => !cSet.has(s.toLowerCase()))
  const skillsUnchanged = bSkills.filter(s => cSet.has(s.toLowerCase())).length

  // ── О себе ──
  const aboutChanged = snapStr(b, 'skills') !== snapStr(c, 'skills')

  // ── Сводка ──
  const parts: string[] = []
  const expAdded = experience.filter(e => e.status === 'added').length
  const expRemoved = experience.filter(e => e.status === 'removed').length
  const expChanged = experience.filter(e => e.status === 'changed').length
  if (expAdded) parts.push(`+${expAdded} место`)
  if (expRemoved) parts.push(`−${expRemoved} место`)
  if (expChanged) parts.push(`~${expChanged} место`)
  if (skillsAdded.length) parts.push(`+${skillsAdded.length} навык`)
  if (skillsRemoved.length) parts.push(`−${skillsRemoved.length} навык`)
  const fieldsChanged = fields.filter(f => f.changed).length
  if (fieldsChanged) parts.push(`~${fieldsChanged} поле`)
  if (aboutChanged) parts.push('~о себе')

  const hasChanges = parts.length > 0
  return {
    fields,
    experience,
    skillsAdded,
    skillsRemoved,
    skillsUnchanged,
    aboutChanged,
    hasChanges,
    summary: parts.join(' · ') || 'без изменений',
  }
}

// ─── Composable ──────────────────────────────────────────────────────────
/**
 * Сравнение версий резюме кандидата. Тянет список версий (легковесный),
 * snapshot'ы — по требованию (drill-in в diff конкретной пары).
 */
export function useResumeComparison(candidateId: MaybeRefOrGetter<string>) {
  const id = computed(() => toValue(candidateId))

  const { data, status, refresh } = useFetch<{ total: number, versions: ResumeVersionRow[] }>(
    () => `/api/candidates/${id.value}/resume-versions`,
    {
      key: computed(() => `resume-comparison-${id.value}`),
      headers: useRequestHeaders(['cookie']),
      server: false,
      default: () => ({ total: 0, versions: [] }),
    },
  )

  const versions = computed(() => data.value?.versions ?? [])
  const total = computed(() => data.value?.total ?? 0)
  const canCompare = computed(() => total.value >= 2)

  /** Тянет полный snapshot конкретной версии (для drill-in diff). */
  async function fetchSnapshot(versionId: string): Promise<Record<string, any> | null> {
    try {
      const res = await $fetch<{ raw?: Record<string, any> } | null>(
        `/api/candidates/${id.value}/resume-versions/${versionId}`,
      )
      return res?.raw ?? null
    }
    catch {
      return null
    }
  }

  /** Тянет snapshot'ы двух версий и считает diff. */
  async function fetchDiff(baseId: string, compareId: string): Promise<SnapshotDiff | null> {
    const [base, compare] = await Promise.all([fetchSnapshot(baseId), fetchSnapshot(compareId)])
    if (!base && !compare) return null
    return computeSnapshotDiff(base, compare)
  }

  return { versions, total, canCompare, status, refresh, fetchSnapshot, fetchDiff }
}
