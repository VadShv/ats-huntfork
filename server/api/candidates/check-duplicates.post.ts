import { z } from 'zod'
import { findDuplicatesForDraft } from '../../utils/dedup/check'

/**
 * Live-проверка на дубликаты при заполнении формы /dashboard/candidates/new.
 * Вызывается с debounce 500мс при изменении ФИО/email/phone.
 *
 * НЕ требует email — на ранних этапах формы recruiter ещё мог не ввести его,
 * но мы уже хотим показать fuzzy по ФИО.
 */
const checkSchema = z.object({
  firstName: z.string().trim().max(100).optional().nullable(),
  lastName: z.string().trim().max(100).optional().nullable(),
  email: z.string().trim().max(255).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  dateOfBirth: z.string().trim().max(20).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, checkSchema.parse)

  const result = await findDuplicatesForDraft(orgId, body)

  return {
    exact: result.exact,
    fuzzy: result.fuzzy,
  }
})
