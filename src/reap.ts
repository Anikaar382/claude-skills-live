import type { Entry, FlagReason, GraveyardEntry } from "./schema"

export const STALE_DAYS = 90

const MS_PER_DAY = 86_400_000

// Reasons the reaper derives from observable repo state, and may therefore
// also un-derive.
const AUTO_REASONS: ReadonlySet<FlagReason> = new Set<FlagReason>(["stale", "archived", "gone"])

// Human decisions. Automation never sets, clears or overwrites these, in either
// direction — a repo being healthy again does not undo a scope or policy call.
const HUMAN_REASONS: ReadonlySet<FlagReason> = new Set<FlagReason>([
  "blocked",
  "dispute",
  "offtopic",
])

// Returns Infinity when `a` cannot be parsed. The DATE regex in schema.ts is
// shape-only, so "2026-13-45" is a legal-looking date that Date.parse rejects.
// Returning NaN made every comparison false, which meant such an entry was
// never stale, never flagged and always rendered — the failure landed on the
// side of the false claim the whole project exists to avoid. Infinity fails
// the other way: an unparseable date reads as maximally stale.
export function daysBetween(a: string, b: Date): number {
  const start = Date.parse(`${a}T00:00:00Z`)
  if (Number.isNaN(start)) return Number.POSITIVE_INFINITY
  return Math.floor((b.getTime() - start) / MS_PER_DAY)
}

// What the repo's own state says right now, ignoring any grace period and any
// flag already on the entry.
function autoReason(entry: Entry, gone: boolean, now: Date): FlagReason | null {
  if (gone) return "gone"
  if (entry.metrics.archived) return "archived"
  if (daysBetween(entry.metrics.pushed_at, now) >= STALE_DAYS) return "stale"
  return null
}

function isGraced(entry: Entry, now: Date): boolean {
  const until = entry.flag?.grace_until
  if (until === null || until === undefined) return false
  return Date.parse(`${until}T00:00:00Z`) > now.getTime()
}

export function reap(
  entries: Entry[],
  missing: string[],
  now: Date,
): { entries: Entry[]; flagged: Array<{ id: string; reason: FlagReason }>; revived: string[] } {
  const gone = new Set(missing)
  const today = now.toISOString().slice(0, 10)
  const flagged: Array<{ id: string; reason: FlagReason }> = []
  const revived: string[] = []

  const out = entries.map((entry) => {
    // Never override human decisions (blocked, dispute, offtopic), in either
    // direction.
    if (HUMAN_REASONS.has(entry.flag?.reason as FlagReason)) return entry

    const raw = autoReason(entry, gone.has(entry.id), now)

    // A grace period suppresses flagging, but it does not make the repo
    // healthy, so it must not trigger a revival either — the entry stays
    // exactly as it is until the grace expires. Grace never suppresses `gone`.
    const reason = raw === "gone" ? raw : isGraced(entry, now) ? null : raw

    if (reason === null) {
      // Genuinely healthy again. Without this the index is a one-way ratchet:
      // a repo that goes quiet for 91 days, gets flagged, then pushes the next
      // day would stay delisted forever, since nothing else ever clears a flag.
      if (raw === null && entry.status === "flagged" && AUTO_REASONS.has(entry.flag?.reason as FlagReason)) {
        revived.push(entry.id)
        const { flag: _dropped, ...rest } = entry
        return { ...rest, status: "active" as const }
      }
      return entry
    }

    // If already flagged with same reason, return unchanged
    if (entry.status === "flagged" && entry.flag?.reason === reason) return entry

    // If already flagged with a different auto-reason, preserve since/issue/grace_until
    if (entry.status === "flagged" && entry.flag && entry.flag.reason !== reason) {
      flagged.push({ id: entry.id, reason })
      return {
        ...entry,
        flag: { reason, since: entry.flag.since, issue: entry.flag.issue, grace_until: entry.flag.grace_until },
      }
    }

    // Transition from unflagged to flagged - set fresh metadata
    flagged.push({ id: entry.id, reason })
    return {
      ...entry,
      status: "flagged" as const,
      flag: { reason, since: today, issue: null, grace_until: null },
    }
  })

  return { entries: out, flagged, revived }
}

export function toGraveyard(entry: Entry, reason: FlagReason, today: string): GraveyardEntry {
  return { id: entry.id, name: entry.name, url: entry.url, reason, removed: today }
}
