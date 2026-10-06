import { it, expect } from 'vitest'
import { generateInputSchema } from '../../server/utils/schemas/searchMap'
it('schema', () => {
  expect(generateInputSchema.safeParse({ scope: 'full' }).success).toBe(true)
  expect(generateInputSchema.safeParse({ scope: 'summary', hint: 'x' }).success).toBe(true)
  expect(generateInputSchema.safeParse({ scope: 'query_string', segmentId: 'a' }).success).toBe(false)
  expect(generateInputSchema.safeParse({ scope: 'query_string', segmentId: 'a', hint: '  ' }).success).toBe(false)
  expect(generateInputSchema.safeParse({ scope: 'query_string', segmentId: 'a', hint: 'добавь синонимы' }).success).toBe(true)
  expect(generateInputSchema.safeParse({ scope: 'segments', limit: 3 }).success).toBe(true)
  expect(generateInputSchema.safeParse({ scope: 'segments', limit: 11 }).success).toBe(false)
  expect(generateInputSchema.safeParse({ scope: 'donors', layer: 'school' }).success).toBe(true)
  expect(generateInputSchema.safeParse({ scope: 'section', sectionId: 's1', mode: 'append' }).data?.mode).toBe('append')
})
