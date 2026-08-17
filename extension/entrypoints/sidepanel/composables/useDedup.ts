/**
 * useDedup — дедупликация в момент захвата.
 *
 * Подсвечивает вероятные совпадения прямо в полях карточки, с указанием,
 * чем совпало. Не после сохранения, а до — рекрутер видит дубль сразу.
 *
 * Типы совпадений:
 *   exact  — email/телефон (красная рамка)
 *   fuzzy  — имя+компания (жёлтая пунктирная)
 *   social — LinkedIn/профиль (синяя)
 */
import { computed } from 'vue'
import { useSidekick } from './useSidekick'

export type MatchKind = 'exact' | 'fuzzy' | 'social'

export interface FieldMatch {
  /** Какое поле совпало. */
  field: 'email' | 'phone' | 'name' | 'linkedin' | 'github' | 'telegram'
  /** Тип совпадения. */
  kind: MatchKind
  /** Чем совпало (текст для бейджа). */
  label: string
  /** ID кандидата-дубликата (для открытия). */
  candidateId?: string
  /** Имя кандидата-дубликата. */
  candidateName?: string
  /** Скор схожести (для fuzzy). */
  score?: number
}

export function useDedup() {
  const { capDupes, blockedExact } = useSidekick()

  /** Карта: fieldName → список совпадений. */
  const fieldMatches = computed<Record<string, FieldMatch[]>>(() => {
    const map: Record<string, FieldMatch[]> = {}
    const push = (field: FieldMatch['field'], m: Omit<FieldMatch, 'field'>) => {
      if (!map[field]) map[field] = []
      map[field].push({ field, ...m })
    }

    // blockedExact — email/phone (exact, блокирующий)
    for (const x of blockedExact.value ?? []) {
      const kind = (x.kind || '').toLowerCase()
      if (kind.includes('email') || kind.includes('почт')) {
        push('email', { kind: 'exact', label: 'email в базе', candidateId: x.candidateId, candidateName: x.candidateName })
      } else if (kind.includes('phone') || kind.includes('телеф')) {
        push('phone', { kind: 'exact', label: 'телефон в базе', candidateId: x.candidateId, candidateName: x.candidateName })
      } else {
        // Неизвестный тип — показываем на обоих полях как exact
        push('email', { kind: 'exact', label: x.kind || 'совпадение', candidateId: x.candidateId, candidateName: x.candidateName })
      }
    }

    // capDupes.exact — тоже точные совпадения
    for (const x of capDupes.value?.exact ?? []) {
      const kind = (x.kind || '').toLowerCase()
      if (kind.includes('email') || kind.includes('почт')) {
        push('email', { kind: 'exact', label: 'email', candidateId: x.candidateId, candidateName: x.candidateName })
      } else if (kind.includes('phone') || kind.includes('телеф')) {
        push('phone', { kind: 'exact', label: 'телефон', candidateId: x.candidateId, candidateName: x.candidateName })
      }
    }

    // capDupes.social — совпадение по профилю (LinkedIn/GitHub/Telegram)
    for (const x of capDupes.value?.social ?? []) {
      const profile = (x.profile || x.kind || '').toLowerCase()
      if (profile.includes('linkedin') || profile.includes('линк')) {
        push('linkedin', { kind: 'social', label: 'LinkedIn в базе', candidateId: x.candidateId, candidateName: x.candidateName })
      } else if (profile.includes('github')) {
        push('github', { kind: 'social', label: 'GitHub в базе', candidateId: x.candidateId, candidateName: x.candidateName })
      } else if (profile.includes('telegram') || profile.includes('t.me')) {
        push('telegram', { kind: 'social', label: 'Telegram в базе', candidateId: x.candidateId, candidateName: x.candidateName })
      } else {
        push('linkedin', { kind: 'social', label: 'профиль в базе', candidateId: x.candidateId, candidateName: x.candidateName })
      }
    }

    // capDupes.fuzzy — имя+компания (показываем на поле имени)
    for (const x of capDupes.value?.fuzzy ?? []) {
      push('name', {
        kind: 'fuzzy',
        label: `похож: ${x.candidateName || '?'}${x.score ? ' ' + x.score + '%' : ''}`,
        candidateId: x.candidateId,
        candidateName: x.candidateName,
        score: x.score,
      })
    }

    return map
  })

  /** Есть ли хоть одно совпадение. */
  const hasAny = computed(() => Object.keys(fieldMatches.value).length > 0)

  /** CSS-класс рамки для поля по типу совпадения. */
  function fieldClass(field: string): string {
    const matches = fieldMatches.value[field]
    if (!matches || !matches.length) return ''
    // Приоритет: exact > social > fuzzy
    const hasExact = matches.some((m) => m.kind === 'exact')
    const hasSocial = matches.some((m) => m.kind === 'social')
    if (hasExact) return 'hf-field--exact'
    if (hasSocial) return 'hf-field--social'
    return 'hf-field--fuzzy'
  }

  return { fieldMatches, hasAny, fieldClass }
}
