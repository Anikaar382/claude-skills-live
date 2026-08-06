import { test, expect } from "bun:test"
import { renderJson, renderReadme } from "../src/render"
import { checkReproducible, checkStaleness, validate } from "../src/validate"
import type { Entry, SkillsFile } from "../src/schema"

function entry(id: string, checked: string, over: Partial<Entry> = {}): Entry {
  return {
    id,
    kind: "skill",
    name: id.split("/")[1]!,
    url: `https://github.com/${id}`,
    summary: "s",
    tags: [],
    added: "2026-01-01",
    source: "discovery",
    status: "active",
    metrics: { stars: 10, pushed_at: "2026-08-01", archived: false, last_checked: checked },
    ...over,
  }
}

const NOW = new Date("2026-08-06T04:00:00Z")

test("passes when every active entry was checked recently", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-08-05T04:00:00Z")] }
  expect(checkStaleness(data, NOW)).toEqual([])
})

test("fails when an active entry is over 48 hours old", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-08-03T03:00:00Z")] }
  expect(checkStaleness(data, NOW).length).toBe(1)
  expect(checkStaleness(data, NOW)[0]).toContain("a/b")
})

test("ignores flagged entries in the staleness gate", () => {
  const flagged = entry("a/b", "2026-01-01T00:00:00Z", {
    status: "flagged",
    flag: { reason: "stale", since: "2026-01-01", issue: null, grace_until: null },
  })
  expect(checkStaleness({ version: 1, entries: [flagged] }, NOW)).toEqual([])
})

test("passes reproducibility when artifacts match the renderer", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-08-05T04:00:00Z")] }
  const problems = checkReproducible(data, renderReadme(data, NOW), renderJson(data), NOW)
  expect(problems).toEqual([])
})

test("fails reproducibility when the README was hand-edited", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-08-05T04:00:00Z")] }
  const tampered = renderReadme(data, NOW) + "\nsneaky manual addition\n"
  const problems = checkReproducible(data, tampered, renderJson(data), NOW)
  expect(problems.length).toBe(1)
  expect(problems[0]).toContain("README.md")
})

test("fails reproducibility when the JSON export is stale", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-08-05T04:00:00Z")] }
  const problems = checkReproducible(data, renderReadme(data, NOW), "{}\n", NOW)
  expect(problems[0]).toContain("data/skills.json")
})

test("validate aggregates both gates", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-01-01T00:00:00Z")] }
  expect(validate(data, "wrong", "wrong", NOW).length).toBe(3)
})
