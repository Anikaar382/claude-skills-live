import { renderJson, renderReadme } from "./render"
import type { SkillsFile } from "./schema"

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

export function validate(data: SkillsFile, readme: string, json: string, now: Date): string[] {
  return [...checkStaleness(data, now), ...checkReproducible(data, readme, json, now)]
}
