import { normalizeEmail, normalizeHhOwnerId, normalizeHhResumeId, normalizeLinkedinUrl, normalizePhone } from './normalize'

export interface IdentitySignal {
  kind: 'email' | 'phone' | 'hh_owner' | 'hh_resume' | 'linkedin' | 'telegram' | 'manual_external'
  valueRaw: string
  valueNormalized: string
  confidence: 'verified' | 'claimed' | 'inferred'
  source: 'hh' | 'telegram' | 'manual' | 'csv' | 'career_form' | 'import'
}

/**
 * Достаёт идентификаторы из payload резюме с hh.ru.
 * - owner.id   → hh_owner    (железный ключ: один hh-пользователь)
 * - resume.id  → hh_resume   (конкретное резюме; одно резюме = один кандидат, но один owner может иметь несколько резюме)
 * - contact[]  → email, phone (с нормализацией)
 * - site[]     → linkedin, telegram (если указали)
 */
export function extractIdentitiesFromHhResume(
  resume: Record<string, unknown> | null | undefined,
): IdentitySignal[] {
  if (!resume) return []
  const r = resume as any
  const out: IdentitySignal[] = []

  // hh owner.id
  const ownerId = normalizeHhOwnerId(r?.owner?.id)
  if (ownerId) {
    out.push({
      kind: 'hh_owner',
      valueRaw: String(r.owner.id),
      valueNormalized: ownerId,
      confidence: 'verified',
      source: 'hh',
    })
  }

  // hh resume.id
  const resumeId = normalizeHhResumeId(r?.id)
  if (resumeId) {
    out.push({
      kind: 'hh_resume',
      valueRaw: String(r.id),
      valueNormalized: resumeId,
      confidence: 'verified',
      source: 'hh',
    })
  }

  // contact[]: email, phone
  if (Array.isArray(r?.contact)) {
    for (const c of r.contact) {
      const typeId = c?.type?.id
      if (typeId === 'email') {
        const raw = typeof c?.value === 'string' ? c.value : undefined
        const norm = normalizeEmail(raw)
        if (raw && norm) {
          out.push({
            kind: 'email',
            valueRaw: raw,
            valueNormalized: norm,
            confidence: 'verified',
            source: 'hh',
          })
        }
      }
      else if (typeId === 'cell' || typeId === 'home' || typeId === 'work') {
        // hh phone payload: { formatted: '+7 (999) 123-45-67', number: '9991234567', country: '7', city: '999' }
        let raw: string | undefined
        if (typeof c?.value === 'string') raw = c.value
        else if (c?.value?.formatted) raw = c.value.formatted
        else if (c?.value?.number) raw = `+${c.value.country ?? '7'}${c.value.number}`
        const norm = normalizePhone(raw)
        if (raw && norm) {
          out.push({
            kind: 'phone',
            valueRaw: raw,
            valueNormalized: norm,
            confidence: 'verified',
            source: 'hh',
          })
        }
      }
    }
  }

  // site[]: linkedin, telegram
  if (Array.isArray(r?.site)) {
    for (const s of r.site) {
      const siteType = s?.type?.id ?? s?.type
      const url: string | undefined = typeof s?.url === 'string' ? s.url : undefined
      if (!url) continue
      if (siteType === 'linkedin' || /linkedin\.com\/in\//i.test(url)) {
        const norm = normalizeLinkedinUrl(url)
        if (norm) {
          out.push({
            kind: 'linkedin',
            valueRaw: url,
            valueNormalized: norm,
            confidence: 'claimed',
            source: 'hh',
          })
        }
      }
      else if (siteType === 'telegram' || /t\.me\//i.test(url)) {
        const m = url.match(/t\.me\/([a-z0-9_]+)/i)
        if (m && m[1]) {
          out.push({
            kind: 'telegram',
            valueRaw: url,
            valueNormalized: m[1].toLowerCase(),
            confidence: 'claimed',
            source: 'hh',
          })
        }
      }
    }
  }

  return out
}

/**
 * Достаёт идентификаторы из плоской candidate-записи в БД (для бэкфила).
 */
export function extractIdentitiesFromCandidateRow(c: {
  email?: string | null
  phone?: string | null
  hhResumeId?: string | null
  hhResumeRaw?: Record<string, unknown> | null
}): IdentitySignal[] {
  const out: IdentitySignal[] = []
  const eNorm = normalizeEmail(c.email)
  if (c.email && eNorm) {
    out.push({
      kind: 'email',
      valueRaw: c.email,
      valueNormalized: eNorm,
      confidence: 'claimed',
      source: 'import',
    })
  }
  const pNorm = normalizePhone(c.phone)
  if (c.phone && pNorm) {
    out.push({
      kind: 'phone',
      valueRaw: c.phone,
      valueNormalized: pNorm,
      confidence: 'claimed',
      source: 'import',
    })
  }
  // hh resume payload — даст owner + resume_id + ещё email/phone (могут дублировать)
  if (c.hhResumeRaw) {
    out.push(...extractIdentitiesFromHhResume(c.hhResumeRaw))
  }
  else if (c.hhResumeId) {
    const rid = normalizeHhResumeId(c.hhResumeId)
    if (rid) {
      out.push({
        kind: 'hh_resume',
        valueRaw: c.hhResumeId,
        valueNormalized: rid,
        confidence: 'verified',
        source: 'hh',
      })
    }
  }
  // дедуп внутри списка (один и тот же ключ может прийти из разных источников)
  const seen = new Set<string>()
  return out.filter(s => {
    const k = `${s.kind}::${s.valueNormalized}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
