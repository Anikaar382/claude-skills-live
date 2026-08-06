import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertBlastRadius, blastRadiusLimit, writeArtifacts } from "../src/cli"
import { FakeGitHubClient } from "../src/github"
import { refresh } from "../src/refresh"
import { renderJson, renderReadme } from "../src/render"
import type { Entry, SkillsFile } from "../src/schema"

function entry(id: string, stars = 10): Entry {
  const [, name] = id.split("/")
  return {
    id,
    kind: "skill",
    name: name!,
    url: `https://github.com/${id}`,
    summary: "A test entry.",
    tags: [],
    added: "2026-08-06",
    source: "discovery",
    status: "active",
    metrics: { stars, pushed_at: "2026-08-01", archived: false, last_checked: "2026-08-06T04:00:00Z" },
  }
}

const NOW = new Date("2026-08-06T12:00:00Z")

test("writeArtifacts writes a README and JSON byte-identical to the renderer output", () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-"))
  const readmePath = join(dir, "README.md")
  const jsonPath = join(dir, "skills.json")
  const data: SkillsFile = { version: 1, entries: [entry("a/b"), entry("c/d")] }

  writeArtifacts(data, NOW, readmePath, jsonPath)

  expect(readFileSync(readmePath, "utf8")).toBe(renderReadme(data, NOW))
  expect(readFileSync(jsonPath, "utf8")).toBe(renderJson(data))
})

test("writeArtifacts is byte-stable across two identical calls", () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-"))
  const readmePath = join(dir, "README.md")
  const jsonPath = join(dir, "skills.json")
  const data: SkillsFile = { version: 1, entries: [entry("a/b"), entry("c/d")] }

  writeArtifacts(data, NOW, readmePath, jsonPath)
  const readme1 = readFileSync(readmePath, "utf8")
  const json1 = readFileSync(jsonPath, "utf8")

  writeArtifacts(data, NOW, readmePath, jsonPath)
  const readme2 = readFileSync(readmePath, "utf8")
  const json2 = readFileSync(jsonPath, "utf8")

  expect(readme1).toBe(readme2)
  expect(json1).toBe(json2)
})

test("writeArtifacts does not read skills.yaml from disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-"))
  const readmePath = join(dir, "README.md")
  const jsonPath = join(dir, "skills.json")

  // A skills.yaml sitting next to the output paths, with content that differs
  // entirely from what we pass in-memory. If writeArtifacts reads it, the
  // output would reflect this file instead of the passed-in SkillsFile.
  writeFileSync(
    join(dir, "skills.yaml"),
    "version: 1\nentries:\n  - id: wrong/on-disk\n    kind: tool\n",
  )

  const inMemory: SkillsFile = { version: 1, entries: [entry("real/in-memory")] }
  writeArtifacts(inMemory, NOW, readmePath, jsonPath)

  const readme = readFileSync(readmePath, "utf8")
  const json = readFileSync(jsonPath, "utf8")
  expect(readme).toContain("real/in-memory")
  expect(readme).not.toContain("wrong/on-disk")
  expect(json).toContain("real/in-memory")
  expect(json).not.toContain("wrong/on-disk")
  expect(readme).toBe(renderReadme(inMemory, NOW))
  expect(json).toBe(renderJson(inMemory))
})

test("blastRadiusLimit floors at 5 for tiny indexes and is 10% above that", () => {
  expect(blastRadiusLimit(0)).toBe(5)
  expect(blastRadiusLimit(50)).toBe(5)
  expect(blastRadiusLimit(51)).toBe(6)
  expect(blastRadiusLimit(343)).toBe(35)
})

test("a full-index blackout from the API trips the blast-radius guard", async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `owner${i}/repo${i}`)
  const entries = ids.map((id) => entry(id))
  // Every lookup comes back null, exactly what a RATE_LIMITED body produced
  // before graphqlFailure existed, and what a real outage still looks like.
  const gh = new FakeGitHubClient([], new Set(ids))

  const refreshed = await refresh(gh, entries, NOW)
  expect(refreshed.missing.length).toBe(20)
  expect(() => assertBlastRadius(refreshed.missing, entries.length)).toThrow(/20 of 20/)
  expect(() => assertBlastRadius(refreshed.missing, entries.length)).toThrow(/limit of 5/)
})

test("a plausible number of genuinely deleted repos passes the guard", async () => {
  const ids = Array.from({ length: 100 }, (_, i) => `owner${i}/repo${i}`)
  const entries = ids.map((id) => entry(id))
  const gone = new Set(ids.slice(0, 9))
  const gh = new FakeGitHubClient(
    ids.slice(9).map((id) => ({ id, stars: 10, pushed_at: "2026-08-01", archived: false, description: "d" })),
    gone,
  )

  const refreshed = await refresh(gh, entries, NOW)
  expect(refreshed.missing.length).toBe(9)
  expect(() => assertBlastRadius(refreshed.missing, entries.length)).not.toThrow()
})
