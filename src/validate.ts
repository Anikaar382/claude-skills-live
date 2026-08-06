import { STALE_DAYS, daysBetween } from "./reap"
import { renderJson, renderReadme } from "./render"
import type { Entry, SkillsFile } from "./schema"

export const MAX_CHECK_AGE_HOURS = 48

const MS_PER_HOUR = 3_600_000

export function checkStaleness(data: SkillsFile, now: Date): string[] {
  const problems: string[] = []
  for (const e of data.entries) {
    if (e.status !== "active") continue
    const age = (now.getTime() - Date.parse(e.metrics.last_checked)) / MS_PER_HOUR
    if (age > MAX_CHECK_AGE_HOURS) {
      problems.push(
        `${e.id}: last_checked is ${Math.floor(age)}h old, over the ${MAX_CHECK_AGE_HOURS}h limit`,
      )
    }
  }
  return problems
}

function isGraced(entry: Entry, now: Date): boolean {
  const until = entry.flag?.grace_until
  if (until === null || until === undefined) return false
  return Date.parse(`${until}T00:00:00Z`) > now.getTime()
}

// The README badge claims "0 dead entries". Nothing computed that number — it
// was a hardcoded string, so CI could not falsify the headline claim of the
// whole project. checkStaleness only asks how recently we LOOKED at an entry,
// never what we saw, so a human PR (or M3's vote-to-keep) could set an
// archived or three-year-old entry to active and validate would pass.
//
// A grace period exempts an entry from both limbs, matching reap: grace is a
// deliberate "keep this listed for now" decision, and failing CI for an entry
// the reaper is under instruction not to flag would leave main red with no
// automated path back to green.
export function checkNoDead(data: SkillsFile, now: Date): string[] {
  const problems: string[] = []
  for (const e of data.entries) {
    if (e.status !== "active") continue
    if (isGraced(e, now)) continue
    if (e.metrics.archived) {
      problems.push(`${e.id}: listed as active but archived upstream`)
      continue
    }
    const age = daysBetween(e.metrics.pushed_at, now)
    if (age >= STALE_DAYS) {
      problems.push(
        `${e.id}: listed as active but last pushed ${age} days ago, ` +
          `at or over the ${STALE_DAYS}-day limit`,
      )
    }
  }
  return problems
}

export function checkReproducible(
  data: SkillsFile,
  readme: string,
  json: string,
  now: Date,
): string[] {
  const problems: string[] = []
  if (renderReadme(data, now) !== readme) {
    problems.push("README.md does not match renderer output; run `bun run render`")
  }
  if (renderJson(data) !== json) {
    problems.push("data/skills.json does not match renderer output; run `bun run render`")
  }
  return problems
}

export interface ValidateOptions {
  staleness?: boolean
}

export function validate(
  data: SkillsFile,
  readme: string,
  json: string,
  now: Date,
  opts: ValidateOptions = {},
): string[] {
  const staleness = opts.staleness ?? true
  return [
    ...(staleness ? checkStaleness(data, now) : []),
    // Unconditional: a dead entry is a property of the content, not of how
    // recently the content was refreshed, so it must fail a PR too and must
    // not be suppressible with --no-staleness.
    ...checkNoDead(data, now),
    ...checkReproducible(data, readme, json, now),
  ]
}
