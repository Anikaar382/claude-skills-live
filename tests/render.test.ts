import { test, expect } from "bun:test"
import { renderJson, renderReadme } from "../src/render"
import type { Entry, SkillsFile } from "../src/schema"

function entry(id: string, stars: number, over: Partial<Entry> = {}): Entry {
  const [, name] = id.split("/")
  return {
    id,
    kind: "skill",
    name: name!,
    url: `https://github.com/${id}`,
    summary: `Summary for ${name}.`,
    tags: [],
    added: "2026-08-06",
    source: "discovery",
    status: "active",
    metrics: { stars, pushed_at: "2026-08-01", archived: false, last_checked: "2026-08-06T04:00:00Z" },
    ...over,
  }
}

const NOW = new Date("2026-08-06T05:00:00Z")

test("badge reports the count of active entries and the check time", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/a", 5), entry("b/b", 9)] }
  const md = renderReadme(data, NOW)
  expect(md).toContain("0 dead entries")
  expect(md).toContain("2 verified")
  expect(md).toContain("2026-08-06 04:00 UTC")
})

test("entries are ordered by stars descending within a kind", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/low", 5), entry("b/high", 900)] }
  const md = renderReadme(data, NOW)
  expect(md.indexOf("b/high")).toBeLessThan(md.indexOf("a/low"))
})

test("flagged entries are excluded from the README", () => {
  const flagged = entry("x/gone", 999, {
    status: "flagged",
    flag: { reason: "stale", since: "2026-08-06", issue: 1, grace_until: null },
  })
  const md = renderReadme({ version: 1, entries: [entry("a/a", 1), flagged] }, NOW)
  expect(md).not.toContain("x/gone")
  expect(md).toContain("1 verified")
})

test("kind headings appear only when that kind has entries", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/a", 1, { kind: "mcp" })] }
  const md = renderReadme(data, NOW)
  expect(md).toContain("MCP servers")
  expect(md).not.toContain("Frameworks")
})

test("render is deterministic for the same input", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/a", 1), entry("b/b", 2)] }
  expect(renderReadme(data, NOW)).toBe(renderReadme(data, NOW))
})

test("json export contains only active entries and is stable", () => {
  const flagged = entry("x/x", 1, {
    status: "flagged",
    flag: { reason: "gone", since: "2026-08-06", issue: null, grace_until: null },
  })
  const json = JSON.parse(renderJson({ version: 1, entries: [entry("a/a", 1), flagged] }))
  expect(json.entries.map((e: Entry) => e.id)).toEqual(["a/a"])
})

test("uses the most recent last_checked across active entries for the badge", () => {
  const older = entry("a/a", 1)
  const newer = entry("b/b", 2, {
    metrics: { stars: 2, pushed_at: "2026-08-01", archived: false, last_checked: "2026-08-06T09:30:00Z" },
  })
  expect(renderReadme({ version: 1, entries: [older, newer] }, NOW)).toContain("2026-08-06 09:30 UTC")
})
