/**
 * Детерминированная сборка персонального набора вопросов под кандидата (Этап 4).
 *
 * БЕЗ обращений к LLM: вопросы из рисков берём ПРЯМО из findings[].question/listenFor
 * (уже сгенерированы риск-движком, Этап 3), вопросы из банка вакансии — правилами
 * (N на категорию). Мержим, дедупим по нормализованному тексту, сортируем:
 * сперва risk_derived (высокий приоритет), затем банк.
 */

import { createHash } from 'node:crypto'

export interface BankQuestion {
  id: string
  text: string
  category: string
  rationale?: string | null
  topicId?: string | null
  criterionId?: string | null
  isRequired?: boolean
  expectedSignal?: string | null
}

export interface RiskFindingLite {
  issue?: string
  claim?: string
  question?: string
  listenFor?: string
  severity?: 'low' | 'medium' | 'high'
}

export type CandidateQuestionCategory =
  | 'hard_skill' | 'soft_skill' | 'experience' | 'motivation'
  | 'culture' | 'logistics' | 'risk_probe' | 'verification' | 'other'

export type ItemPriority = 'must_ask' | 'should_ask' | 'optional'

export interface AssembledItem {
  text: string
  listenFor: string | null
  category: CandidateQuestionCategory
  origin: 'from_job_bank' | 'risk_derived'
  sourceRef: string | null
  rationale: string | null
  priority: ItemPriority
  topicId: string | null
  displayOrder: number
}

/**
 * Стабильный идентификатор находки риска: хеш содержания (не индекс массива).
 * При переупорядочивании findings sourceRef одинаковой находки не меняется (фикс §5.2.1).
 */
export function findingSourceRef(f: RiskFindingLite): string {
  const basis = `${normalizeQuestion(f.question ?? '')}|${normalizeQuestion(f.issue ?? f.claim ?? '')}`
  const hash = createHash('sha1').update(basis).digest('hex').slice(0, 12)
  return `finding:${hash}`
}

// Реэкспорт из единого util (Спринт 0). Оставлен для обратной совместимости
// существующих импортов `normalizeQuestion` из этого модуля.
export { normalizeQuestion } from '../text/normalizeQuestion'
import { normalizeQuestion } from '../text/normalizeQuestion'

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

/**
 * Собирает набор: risk-вопросы сначала (по severity), затем банк (N на категорию).
 * Дедуп по нормализованному тексту (первое вхождение выигрывает).
 */
export function assembleCandidateQuestions(opts: {
  bank: BankQuestion[]
  findings: RiskFindingLite[]
  perBankCategory: number
  budgetMax?: number
}): AssembledItem[] {
  const seen = new Set<string>()
  const out: AssembledItem[] = []
  let order = 0

  // 1) Risk-derived: только находки с непустым question. Приоритет must/should по severity.
  const riskWithQ = opts.findings
    .filter(f => (f.question ?? '').trim() !== '')
    .sort((a, b) => (SEVERITY_ORDER[a.severity ?? 'low'] ?? 2) - (SEVERITY_ORDER[b.severity ?? 'low'] ?? 2))

  riskWithQ.forEach((f) => {
    const text = f.question!.trim()
    const n = normalizeQuestion(text)
    if (seen.has(n)) return
    seen.add(n)
    const sev = f.severity ?? 'low'
    out.push({
      text,
      listenFor: f.listenFor?.trim() || null,
      category: 'verification',
      origin: 'risk_derived',
      sourceRef: findingSourceRef(f), // стабильный хеш, не индекс (§5.2.1)
      rationale: (f.issue || f.claim || '').trim() || null,
      priority: (sev === 'high' || sev === 'medium') ? 'must_ask' : 'should_ask',
      topicId: null,
      displayOrder: order++,
    })
  })

  // 2) Bank: не более perBankCategory на категорию, порядок как пришёл.
  if (opts.perBankCategory > 0) {
    const perCat: Record<string, number> = {}
    for (const q of opts.bank) {
      const text = q.text.trim()
      if (!text) continue
      const n = normalizeQuestion(text)
      if (seen.has(n)) continue
      const cat = q.category
      if ((perCat[cat] ?? 0) >= opts.perBankCategory) continue
      perCat[cat] = (perCat[cat] ?? 0) + 1
      seen.add(n)
      out.push({
        text,
        listenFor: null,
        category: (normalizeCategory(cat)),
        origin: 'from_job_bank',
        sourceRef: q.id,
        rationale: q.rationale?.trim() || null,
        // is_required → must_ask; иначе should_ask (скоринг-правила — в endpoint, best-effort).
        priority: q.isRequired ? 'must_ask' : 'should_ask',
        topicId: q.topicId ?? null,
        displayOrder: order++,
      })
    }
  }

  // 3) Бюджет: обрезаем ОСНОВНЫЕ вопросы до budgetMax по приоритету.
  //    must_ask сохраняются всегда; optional/should_ask режутся первыми (с конца).
  const budget = opts.budgetMax ?? 0
  if (budget > 0 && out.length > budget) {
    const rank: Record<ItemPriority, number> = { must_ask: 0, should_ask: 1, optional: 2 }
    const sorted = [...out].sort((a, b) => rank[a.priority] - rank[b.priority] || a.displayOrder - b.displayOrder)
    const kept = sorted.slice(0, budget).sort((a, b) => a.displayOrder - b.displayOrder)
    // Пересчёт displayOrder последовательно.
    kept.forEach((it, i) => { it.displayOrder = i })
    return kept
  }

  return out
}

const VALID_CATS = new Set([
  'hard_skill', 'soft_skill', 'experience', 'motivation', 'culture', 'logistics', 'risk_probe', 'verification', 'other',
])
function normalizeCategory(c: string): CandidateQuestionCategory {
  return (VALID_CATS.has(c) ? c : 'other') as CandidateQuestionCategory
}
