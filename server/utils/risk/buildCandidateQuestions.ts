/**
 * Детерминированная сборка персонального набора вопросов под кандидата (Этап 4).
 *
 * БЕЗ обращений к LLM: вопросы из рисков берём ПРЯМО из findings[].question/listenFor
 * (уже сгенерированы риск-движком, Этап 3), вопросы из банка вакансии — правилами
 * (N на категорию). Мержим, дедупим по нормализованному тексту, сортируем:
 * сперва risk_derived (высокий приоритет), затем банк.
 */

export interface BankQuestion {
  id: string
  text: string
  category: string
  rationale?: string | null
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

export interface AssembledItem {
  text: string
  listenFor: string | null
  category: CandidateQuestionCategory
  origin: 'from_job_bank' | 'risk_derived'
  sourceRef: string | null
  rationale: string | null
  displayOrder: number
}

/** Нормализация текста вопроса для дедупа. */
export function normalizeQuestion(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[«»"'.,;:!?()]/g, '').trim()
}

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

/**
 * Собирает набор: risk-вопросы сначала (по severity), затем банк (N на категорию).
 * Дедуп по нормализованному тексту (первое вхождение выигрывает).
 */
export function assembleCandidateQuestions(opts: {
  bank: BankQuestion[]
  findings: RiskFindingLite[]
  perBankCategory: number
}): AssembledItem[] {
  const seen = new Set<string>()
  const out: AssembledItem[] = []
  let order = 0

  // 1) Risk-derived: только находки с непустым question.
  const riskWithQ = opts.findings
    .filter(f => (f.question ?? '').trim() !== '')
    .sort((a, b) => (SEVERITY_ORDER[a.severity ?? 'low'] ?? 2) - (SEVERITY_ORDER[b.severity ?? 'low'] ?? 2))

  riskWithQ.forEach((f, i) => {
    const text = f.question!.trim()
    const n = normalizeQuestion(text)
    if (seen.has(n)) return
    seen.add(n)
    out.push({
      text,
      listenFor: f.listenFor?.trim() || null,
      category: 'verification',
      origin: 'risk_derived',
      sourceRef: `finding:${i}`,
      rationale: (f.issue || f.claim || '').trim() || null,
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
        displayOrder: order++,
      })
    }
  }

  return out
}

const VALID_CATS = new Set([
  'hard_skill', 'soft_skill', 'experience', 'motivation', 'culture', 'logistics', 'risk_probe', 'verification', 'other',
])
function normalizeCategory(c: string): CandidateQuestionCategory {
  return (VALID_CATS.has(c) ? c : 'other') as CandidateQuestionCategory
}
