import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeArtifacts } from "../src/cli"
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
