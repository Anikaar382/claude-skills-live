import { writeFileSync } from "node:fs"
import { discover } from "./discover"
import { RealGitHubClient } from "./github"
import { renderJson, renderReadme } from "./render"
import { loadGraveyard, loadSkills, saveSkills } from "./store"

const SKILLS = "skills.yaml"
const GRAVEYARD = "graveyard.yaml"

function token(): string {
  const t = process.env.GITHUB_TOKEN
  if (!t) throw new Error("GITHUB_TOKEN is not set")
  return t
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function knownIds(): Set<string> {
  const ids = new Set<string>()
  for (const e of loadSkills(SKILLS).entries) ids.add(e.id)
  for (const e of loadGraveyard(GRAVEYARD).entries) ids.add(e.id)
  return ids
}

function writeArtifacts(): void {
  const data = loadSkills(SKILLS)
  writeFileSync("README.md", renderReadme(data, new Date()))
  writeFileSync("data/skills.json", renderJson(data))
}

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0]
  if (cmd === "discover") {
    const found = await discover(new RealGitHubClient(token()), knownIds(), today())
    const data = loadSkills(SKILLS)
    data.entries.push(...found)
    saveSkills(SKILLS, data)
    writeArtifacts()
    console.log(`discovered ${found.length} new entries`)
    return 0
  }
  if (cmd === "render") {
    writeArtifacts()
    console.log("rendered README.md and data/skills.json")
    return 0
  }
  console.error(`unknown command: ${cmd ?? "(none)"}`)
  return 1
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
