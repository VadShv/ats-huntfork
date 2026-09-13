/**
 * Единая нормализация текста вопроса для дедупа (модуль вопросов, Спринт 0).
 *
 * Ранее логика дублировалась в трёх местах с расхождениями:
 *  - server/utils/risk/buildCandidateQuestions.ts (с пунктуацией)
 *  - server/api/jobs/[id]/interview-questions/generate.post.ts (с пунктуацией)
 *  - server/api/applications/[id]/question-set/generate.post.ts (БЕЗ пунктуации — баг)
 *
 * Канон: нижний регистр + схлопывание пробелов + удаление кавычек/пунктуации.
 * Идемпотентна: normalizeQuestion(normalizeQuestion(x)) === normalizeQuestion(x).
 */
export function normalizeQuestion(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[«»"'.,;:!?()]/g, '')
    .trim()
}
