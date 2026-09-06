import { z } from 'zod'

// ─────────────────────────────────────────────
// Job brief validation schemas (Этап 1)
// ─────────────────────────────────────────────

const chipList = z.array(z.string().trim().min(1).max(300)).max(50)
const longText = z.string().max(10_000)

/** Schema for upserting a job brief. All fields optional (PUT = full upsert). */
export const upsertBriefSchema = z.object({
  hardMustHave: chipList.optional(),
  niceToHave: chipList.optional(),
  dealBreakers: chipList.optional(),
  redFlagsToWatch: chipList.optional(),
  responsibilities: longText.nullish(),
  teamContext: longText.nullish(),
  interviewProcess: longText.nullish(),
  compensationNotes: longText.nullish(),
  idealProfile: longText.nullish(),
  sourcingHints: longText.nullish(),
  freeform: longText.nullish(),
})

export type UpsertBriefInput = z.infer<typeof upsertBriefSchema>

/** Route param schema for job id. */
export const jobIdParamSchema = z.object({
  id: z.string().min(1),
})
