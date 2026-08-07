import { STALE_DAYS, daysBetween } from "./reap"
import { renderJson, renderReadme } from "./render"
import type { Entry, GraveyardFile, SkillsFile } from "./schema"
import { renderSite } from "./site"

export const MAX_CHECK_AGE_HOURS = 48

// Governs every time-dependent check together. They are one concern: "is this
// dataset still fresh?", which is a property of main and of the scheduled
// refresh, never of a proposed change sitting in review.
export interface ValidateOptions {
  staleness?: boolean
}

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

// reap refuses to touch an entry carrying a human flag reason, in either
// direction. So an active entry flagged `dispute` or `blocked` that later goes
// archived would fail checkNoDead forever, with no automated route back to
// green — the same deadlock the grace exemption exists to prevent, and it gets
// the same exemption. The entry is still held by a human decision; CI is not
// the right place to shout about it.
function isHumanHeld(entry: Entry): boolean {
  const r = entry.flag?.reason
  return r === "dispute" || r === "blocked" || r === "offtopic"
}

// The README badge claims "0 dead entries". Nothing computed that number — it
// was a hardcoded string, so CI could not falsify the headline claim of the
// whole project. checkStaleness only asks how recently we LOOKED at an entry,
// never what we saw, so a human PR (or M3's vote-to-keep) could set an
// archived or three-year-old entry to active and validate would pass.
//
// A grace period, or a human hold, exempts an entry from both limbs, matching
// reap: both are deliberate "keep this listed for now" decisions, and failing
// CI for an entry the reaper is under instruction not to flag would leave main
// red with no automated path back to green.
//
// The two limbs differ in one respect that matters for where they may run.
// `archived` is content-derived and time-independent: the answer is the same
// on any day, so it is always checked. The 90-day limb is a function of the
// clock, so on a long-lived PR branch it eventually fails for the age of an
// entry the PR never touched — and the refresh commit that would fix it lands
// on main, not on the branch. That is the same trap that made push:main an
// unusable trigger for the staleness gate, so the age limb is governed by the
// same `staleness` option and is off wherever checkStaleness is off.
export function checkNoDead(data: SkillsFile, now: Date, opts: ValidateOptions = {}): string[] {
  const staleness = opts.staleness ?? true
  const problems: string[] = []
  for (const e of data.entries) {
    if (e.status !== "active") continue
    if (isGraced(e, now) || isHumanHeld(e)) continue
    if (e.metrics.archived) {
      problems.push(`${e.id}: listed as active but archived upstream`)
      continue
    }
    if (!staleness) continue
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

// The graveyard is the permanent exclusion list — it is what makes a
// content-policy block stick. validate never read it, so a PR could simply
// re-add a blocked entry to skills.yaml and pass CI, and the daily discover
// run would not catch it either since knownIds() only suppresses re-discovery.
export function checkGraveyard(data: SkillsFile, graveyard: GraveyardFile): string[] {
  const buried = new Map(graveyard.entries.map((e) => [e.id, e.reason]))
  const problems: string[] = []
  for (const e of data.entries) {
    const reason = buried.get(e.id)
    if (reason !== undefined) {
      problems.push(`${e.id}: present in skills.yaml but graveyarded as ${reason}`)
    }
  }
  return problems
}

export function checkReproducible(
  data: SkillsFile,
  graveyard: GraveyardFile,
  readme: string,
  json: string,
  site: string,
  now: Date,
): string[] {
  const problems: string[] = []
  if (renderReadme(data, now) !== readme) {
    problems.push("README.md does not match renderer output; run `bun run render`")
  }
  if (renderJson(data) !== json) {
    problems.push("data/skills.json does not match renderer output; run `bun run render`")
  }
  // docs/index.html is held to the same bar as the README: a hand-edited
  // landing page is exactly the kind of drift this gate exists to catch, and
  // it is the page a Product Hunt visitor actually lands on.
  if (renderSite(data, graveyard, now) !== site) {
    problems.push("docs/index.html does not match renderer output; run `bun run render`")
  }
  return problems
}

export function validate(
  data: SkillsFile,
  graveyard: GraveyardFile,
  readme: string,
  json: string,
  site: string,
  now: Date,
  opts: ValidateOptions = {},
): string[] {
  const staleness = opts.staleness ?? true
  return [
    ...(staleness ? checkStaleness(data, now) : []),
    // Always runs: its archived limb is content-derived, so a PR that marks an
    // archived repo active must fail even on a PR build. Its 90-day limb is
    // time-dependent and honours the same `staleness` option.
    ...checkNoDead(data, now, { staleness }),
    ...checkReproducible(data, graveyard, readme, json, site, now),
  ]
}
