/**
 * GET /api/extension/prompts
 *
 * S8 Sidekick: библиотека быстрых промптов для панели расширения.
 * Пока статический набор (общий для всех организаций) — без миграций.
 * Кастомные per-org промпты — следующим этапом, когда появится потребность.
 *
 * Ответ: { ok, prompts: [{ id, label, mode, instruction? }] }
 *   mode 'custom' — отправляется в /summarize с instruction
 *   остальные mode — предустановленные режимы /summarize
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  logApiRequest(event, session, 'extension.prompts', {})

  return {
    ok: true,
    prompts: [
      { id: 'summary', label: 'Саммари профиля', mode: 'summary' },
      { id: 'card', label: 'Карточка знаний', mode: 'card' },
      { id: 'questions', label: 'Вопросы к интервью', mode: 'questions' },
      { id: 'translate', label: 'Перевести на русский', mode: 'translate' },
      {
        id: 'seniority',
        label: 'Оценить синьорность',
        mode: 'custom',
        instruction: 'Оцени уровень кандидата (junior/middle/senior/lead) по фактам из текста: '
          + 'масштаб задач, самостоятельность, влияние на продукт и команду. Дай вывод одной строкой и 3-5 аргументов.',
      },
      {
        id: 'outreach',
        label: 'Черновик первого письма',
        mode: 'custom',
        instruction: 'Напиши короткое (до 90 слов) персонализированное первое сообщение кандидату '
          + 'от рекрутёра: зацепка из его опыта, одно предложение о возможности, вопрос-приглашение к диалогу. '
          + 'Без клише "уникальная возможность" и без выдуманных деталей о вакансии.',
      },
      {
        id: 'redflags',
        label: 'Стоп-факторы',
        mode: 'custom',
        instruction: 'Найди потенциальные стоп-факторы: частые смены работы, пробелы в стаже, '
          + 'несоответствия дат, расплывчатые формулировки достижений. К каждому — цитата-основание из текста. '
          + 'Если стоп-факторов нет, так и скажи.',
      },
    ],
  }
})
