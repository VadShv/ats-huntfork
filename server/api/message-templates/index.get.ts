import { eq } from 'drizzle-orm'
import { messageTemplate } from '../../database/schema'

const SYSTEM_TEMPLATES = [
  { key: 'interview_invite', title: 'Приглашение на интервью', body: 'Приглашаю на интервью по вакансии {{job_title}}. Какие дата и время вам удобны?', category: 'interview', isSystem: true },
  { key: 'rejection', title: 'Отказ', body: 'К сожалению, на данный момент мы не можем продолжить рассмотрение вашей кандидатуры на позицию {{job_title}}. Спасибо за интерес!', category: 'rejection', isSystem: true },
  { key: 'request_docs', title: 'Запрос документов', body: 'Для продолжения рассмотрения просим предоставить следующие документы: резюме, рекомендация, портфолио.', category: 'request', isSystem: true },
  { key: 'request_feedback', title: 'Запрос обратной связи', body: 'Поделитесь, пожалуйста, обратной связью по результатам интервью. Что понравилось, что можно улучшить?', category: 'request', isSystem: true },
  { key: 'offer', title: 'Оффер', body: 'Рады предложить вам позицию {{job_title}}! Подробности оффера и условия — во вложении. Ожидаем вашего ответа до {{deadline}}.', category: 'offer', isSystem: true },
]

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const custom = await db.query.messageTemplate.findMany({
    where: eq(messageTemplate.organizationId, orgId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  })

  return [
    ...SYSTEM_TEMPLATES.map(t => ({ id: `system:${t.key}`, ...t })),
    ...custom.map(t => ({ id: t.id, key: t.key, title: t.title, body: t.body, category: t.category, isSystem: t.isSystem })),
  ]
})
