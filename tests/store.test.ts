import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadSkills, saveSkills, sortEntries } from "../src/store"
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

test("sortEntries orders by id ascending", () => {
  const sorted = sortEntries([entry("z/z"), entry("a/a"), entry("m/m")])
  expect(sorted.map((e) => e.id)).toEqual(["a/a", "m/m", "z/z"])
})

test("save then load round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-"))
  const path = join(dir, "skills.yaml")
  const data: SkillsFile = { version: 1, entries: [entry("b/b"), entry("a/a")] }
  saveSkills(path, data)
  expect(loadSkills(path).entries.map((e) => e.id)).toEqual(["a/a", "b/b"])
})

test("save writes entries sorted regardless of input order", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-"))
  const path = join(dir, "skills.yaml")
  saveSkills(path, { version: 1, entries: [entry("z/z"), entry("a/a")] })
  const text = readFileSync(path, "utf8")
  expect(text.indexOf("a/a")).toBeLessThan(text.indexOf("z/z"))
})

test("save output is byte-stable across two writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-"))
  const p1 = join(dir, "one.yaml")
  const p2 = join(dir, "two.yaml")
  const data: SkillsFile = { version: 1, entries: [entry("a/a"), entry("b/b")] }
  saveSkills(p1, data)
  saveSkills(p2, loadSkills(p1))
  expect(readFileSync(p1, "utf8")).toBe(readFileSync(p2, "utf8"))
})

test("load rejects a file that violates the schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-"))
  const path = join(dir, "bad.yaml")
  Bun.write(path, "version: 1\nentries:\n  - id: nope\n")
  expect(() => loadSkills(path)).toThrow()
})
