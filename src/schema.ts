import { z } from "zod"

export const KindSchema = z.enum(["framework", "skill", "plugin", "mcp", "tool"])
export const FlagReasonSchema = z.enum(["stale", "archived", "gone", "dispute"])
export const StatusSchema = z.enum(["active", "flagged", "removed"])
export const SourceSchema = z.enum(["discovery", "pr", "manual"])

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const ID_REGEX = /^[^/\s]+\/[^/\s]+$/

export const MetricsSchema = z.object({
  stars: z.number().int().nonnegative(),
  pushed_at: z.string().regex(DATE),
  archived: z.boolean(),
  last_checked: z.string().regex(DATETIME),
})

export const FlagSchema = z.object({
  reason: FlagReasonSchema,
  since: z.string().regex(DATE),
  issue: z.number().int().positive().nullable(),
  grace_until: z.string().regex(DATE).nullable(),
})

export const EntrySchema = z
  .object({
    id: z.string().regex(ID_REGEX),
    kind: KindSchema,
    name: z.string().min(1),
    url: z.string().url(),
    summary: z.string().min(1).max(120),
    tags: z.array(z.string()).default([]),
    added: z.string().regex(DATE),
    source: SourceSchema,
    status: StatusSchema,
    metrics: MetricsSchema,
    flag: FlagSchema.optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.status !== "active" && !entry.flag) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "flag is required when status is not active",
        path: ["flag"],
      })
    }
  })

export const SkillsFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(EntrySchema),
})

export const GraveyardEntrySchema = z.object({
  id: z.string().regex(ID_REGEX),
  name: z.string(),
  url: z.string().url(),
  reason: FlagReasonSchema,
  removed: z.string().regex(DATE),
})

export const GraveyardFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(GraveyardEntrySchema),
})

export type Kind = z.infer<typeof KindSchema>
export type FlagReason = z.infer<typeof FlagReasonSchema>
export type Metrics = z.infer<typeof MetricsSchema>
export type Flag = z.infer<typeof FlagSchema>
export type Entry = z.infer<typeof EntrySchema>
export type SkillsFile = z.infer<typeof SkillsFileSchema>
export type GraveyardEntry = z.infer<typeof GraveyardEntrySchema>
export type GraveyardFile = z.infer<typeof GraveyardFileSchema>
