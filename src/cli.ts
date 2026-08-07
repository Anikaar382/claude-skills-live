import { readFileSync, writeFileSync } from "node:fs"
import { discover } from "./discover"
import { RealGitHubClient } from "./github"
import { reap } from "./reap"
import { refresh } from "./refresh"
import { renderJson, renderReadme } from "./render"
import type { GraveyardFile, SkillsFile } from "./schema"
import { renderSite } from "./site"
import { loadGraveyard, loadSkills, saveSkills } from "./store"
import { checkGraveyard, validate } from "./validate"

const SKILLS = "skills.yaml"
const GRAVEYARD = "graveyard.yaml"

function token(): string {
  const t = process.env.GITHUB_TOKEN
  if (!t) throw new Error("GITHUB_TOKEN is not set")
  return t
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function knownIds(): Set<string> {
  const ids = new Set<string>()
  for (const e of loadSkills(SKILLS).entries) ids.add(e.id)
  for (const e of loadGraveyard(GRAVEYARD).entries) ids.add(e.id)
  return ids
}

// Renders all three artifacts into memory first, then writes them back to
// back with no computation in between, so a mid-write death leaves the
// smallest possible window of inconsistency. Takes the in-memory SkillsFile,
// GraveyardFile and a single `now` rather than re-reading either YAML file or
// re-deriving the clock.
export function writeArtifacts(
  data: SkillsFile,
  graveyard: GraveyardFile,
  now: Date,
  readmePath = "README.md",
  jsonPath = "data/skills.json",
  sitePath = "docs/index.html",
): void {
  const readme = renderReadme(data, now)
  const json = renderJson(data)
  const site = renderSite(data, graveyard, now)
  writeFileSync(readmePath, readme)
  writeFileSync(jsonPath, json)
  writeFileSync(sitePath, site)
}

export function blastRadiusLimit(total: number): number {
  return Math.max(5, Math.ceil(total * 0.1))
}

// `gone` is the only flag reason with no threshold and no grace period behind
// it, so a single bad API answer is enough to flag the entire index: every id
// comes back missing, reap flags them all `gone`, render emits an empty README
// and validate still passes, because checkStaleness skips non-active entries.
// Refuse to write anything when the missing set is implausibly large — a real
// day never deletes a tenth of the index at once.
export function assertBlastRadius(missing: string[], total: number): void {
  const limit = blastRadiusLimit(total)
  if (missing.length > limit) {
    throw new Error(
      `refresh aborted: ${missing.length} of ${total} entries came back missing, ` +
        `over the blast-radius limit of ${limit}. Nothing was written. This is far ` +
        `more likely to be a GitHub API failure than ${missing.length} deleted repos.`,
    )
  }
}

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0]
  if (cmd === "discover") {
    const now = new Date()
    const found = await discover(new RealGitHubClient(token()), knownIds(), today(now), 1000)
    const data = loadSkills(SKILLS)
    data.entries.push(...found)
    saveSkills(SKILLS, data)
    writeArtifacts(data, loadGraveyard(GRAVEYARD), now)
    console.log(`discovered ${found.length} new entries`)
    return 0
  }
  if (cmd === "refresh") {
    const now = new Date()
    const data = loadSkills(SKILLS)
    const gh = new RealGitHubClient(token())
    const refreshed = await refresh(gh, data.entries, now)
    assertBlastRadius(refreshed.missing, data.entries.length)
    const reaped = reap(refreshed.entries, refreshed.missing, now)
    const nextData: SkillsFile = { version: 1, entries: reaped.entries }
    saveSkills(SKILLS, nextData)
    writeArtifacts(nextData, loadGraveyard(GRAVEYARD), now)
    for (const f of reaped.flagged) console.log(`flagged ${f.id}: ${f.reason}`)
    for (const id of reaped.revived) console.log(`revived ${id}: back to active`)
    console.log(
      `refreshed ${refreshed.entries.length}, flagged ${reaped.flagged.length}, ` +
        `revived ${reaped.revived.length}`,
    )
    return 0
  }
  if (cmd === "validate") {
    const staleness = !argv.includes("--no-staleness")
    const data = loadSkills(SKILLS)
    const graveyard = loadGraveyard(GRAVEYARD)
    const problems = [
      ...validate(
        data,
        graveyard,
        readFileSync("README.md", "utf8"),
        readFileSync("data/skills.json", "utf8"),
        readFileSync("docs/index.html", "utf8"),
        new Date(),
        { staleness },
      ),
      // Unconditional, like checkNoDead: re-adding a graveyarded entry is a
      // content question, not a freshness one.
      ...checkGraveyard(data, graveyard),
    ]
    for (const p of problems) console.error(`FAIL ${p}`)
    if (problems.length > 0) return 1
    console.log("validate: ok")
    return 0
  }
  if (cmd === "render") {
    const now = new Date()
    const data = loadSkills(SKILLS)
    writeArtifacts(data, loadGraveyard(GRAVEYARD), now)
    console.log("rendered README.md, data/skills.json and docs/index.html")
    return 0
  }
  console.error(`unknown command: ${cmd ?? "(none)"}`)
  return 1
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
