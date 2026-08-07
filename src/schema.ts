import { z } from "zod"

export const KindSchema = z.enum(["framework", "skill", "plugin", "mcp", "tool"])
// `blocked` is a content-policy exclusion (leaked or proprietary source).
// `offtopic` is a scope exclusion: real, legitimate software that simply is not
// Claude Code / Agent Skills tooling. Both are permanent human decisions, but
// conflating them would make the graveyard unreadable.
export const FlagReasonSchema = z.enum([
  "stale",
  "archived",
  "gone",
  "dispute",
  "blocked",
  "offtopic",
])
export const StatusSchema = z.enum(["active", "flagged", "removed"])
export const SourceSchema = z.enum(["discovery", "pr", "manual"])

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
// Deliberately an allow-list, not a deny-list. GitHub owner and repo names are
// already restricted to these characters, and buildBatchQuery interpolates the
// two halves straight into GraphQL string literals with no escaping — so a `"`
// or a `\` in an id is a query-injection primitive. That used to be
// unreachable because every id came from the GitHub API; it is reachable now
// that source can be `pr` or `manual`.
const ID_REGEX = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

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
    // The README renders `[id](url)`, so a free-form url lets a PR show the
    // display text `anthropics/skills` while linking anywhere at all. Pinning
    // url to id makes the link text and the destination the same claim.
    const expected = `https://github.com/${entry.id}`
    if (entry.url !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `url must be ${expected} to match the id, got ${entry.url}`,
        path: ["url"],
      })
    }
  })

export const SkillsFileSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(EntrySchema),
  })
  // Ids are the primary key everywhere: knownIds(), the reap `gone` set, the
  // graveyard check. A duplicate silently makes those set lookups ambiguous —
  // it is the root cause of the known duplicate-in-`missing` bug — and lets
  // two rows claim the same repo with different metadata.
  .superRefine((file, ctx) => {
    const seen = new Set<string>()
    file.entries.forEach((entry, i) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate id: ${entry.id}`,
          path: ["entries", i, "id"],
        })
      }
      seen.add(entry.id)
    })
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
