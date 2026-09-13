import { describe, it, expect } from 'vitest'
import { candidate } from '../../server/database/schema/app'

/**
 * §J regression guard: candidate.createdById must be a REAL drizzle column.
 * The scope crash ("не удалось загрузить кандидатов") happened because scope.ts
 * referenced candidate.createdById which didn't exist → sql`${undefined}` → broken
 * SQL. This test fails loudly if the column is ever removed again.
 */
describe('candidate.createdById column (§J)', () => {
  it('exists on the candidate table and maps to created_by_id', () => {
    const col = (candidate as unknown as Record<string, { name?: string }>).createdById
    expect(col).toBeTruthy()
    expect(col.name).toBe('created_by_id')
  })
})
