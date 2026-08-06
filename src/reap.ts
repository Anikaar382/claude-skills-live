import type { Entry, FlagReason, GraveyardEntry } from "./schema"

export const STALE_DAYS = 90

const MS_PER_DAY = 86_400_000

export function daysBetween(a: string, b: Date): number {
  return Math.floor((b.getTime() - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY)
}

function reasonFor(entry: Entry, gone: boolean, now: Date): FlagReason | null {
  if (gone) return "gone"
  const graced = entry.flag?.grace_until !== null && entry.flag?.grace_until !== undefined
    ? Date.parse(`${entry.flag.grace_until}T00:00:00Z`) > now.getTime()
    : false
  if (graced) return null
  if (entry.metrics.archived) return "archived"
  if (daysBetween(entry.metrics.pushed_at, now) >= STALE_DAYS) return "stale"
  return null
}

export function reap(
  entries: Entry[],
  missing: string[],
  now: Date,
): { entries: Entry[]; flagged: Array<{ id: string; reason: FlagReason }> } {
  const gone = new Set(missing)
  const today = now.toISOString().slice(0, 10)
  const flagged: Array<{ id: string; reason: FlagReason }> = []

  const out = entries.map((entry) => {
    const reason = reasonFor(entry, gone.has(entry.id), now)
    if (reason === null) return entry
    if (entry.status === "flagged" && entry.flag?.reason === reason) return entry
    flagged.push({ id: entry.id, reason })
    return {
      ...entry,
      status: "flagged" as const,
      flag: { reason, since: today, issue: null, grace_until: null },
    }
  })

  return { entries: out, flagged }
}

export function toGraveyard(entry: Entry, reason: FlagReason, today: string): GraveyardEntry {
  return { id: entry.id, name: entry.name, url: entry.url, reason, removed: today }
}
