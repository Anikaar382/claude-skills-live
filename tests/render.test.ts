import { test, expect } from "bun:test"
import { renderJson, renderReadme } from "../src/render"
import type { Entry, FlagReason, SkillsFile } from "../src/schema"

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

test("flagged entries are excluded from the kind tables and not counted as verified", () => {
  const flagged = entry("x/gone", 999, {
    status: "flagged",
    flag: { reason: "stale", since: "2026-08-06", issue: 1, grace_until: null },
  })
  const md = renderReadme({ version: 1, entries: [entry("a/a", 1), flagged] }, NOW)
  expect(md).toContain("1 verified")
  // Present only below the "Recently flagged" heading, never in a kind table.
  const above = md.slice(0, md.indexOf("## Recently flagged"))
  expect(above).not.toContain("x/gone")
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

test("summary containing pipe character is escaped", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/pipe", 1, { summary: "CLI | API tool" })] }
  const md = renderReadme(data, NOW)
  expect(md).toContain("CLI \\| API tool")
})

test("summary containing newline renders on a single line", () => {
  const singleLineSummary = "Single line summary"
  const multiLineSummary = "Multi\nline\nsummary"
  const singleLineData: SkillsFile = { version: 1, entries: [entry("a/single", 1, { summary: singleLineSummary })] }
  const multiLineData: SkillsFile = { version: 1, entries: [entry("a/multi", 1, { summary: multiLineSummary })] }
  const singleMd = renderReadme(singleLineData, NOW)
  const multiMd = renderReadme(multiLineData, NOW)
  const singleLineCount = singleMd.split("\n").length
  const multiLineCount = multiMd.split("\n").length
  expect(multiLineCount).toBe(singleLineCount)
  expect(multiMd).toContain("Multi line summary")
})

test("summary with tabs and whitespace runs collapses to single spaces", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/ws", 1, { summary: "Text\t\twith  spaces" })] }
  const md = renderReadme(data, NOW)
  expect(md).toContain("Text with spaces")
  expect(md).not.toContain("\t")
})

test("rendering with same ids but reversed input order produces byte-identical output", () => {
  const e1 = entry("dup/id", 1, { name: "first" })
  const e2 = entry("dup/id", 1, { name: "second" })
  const data1: SkillsFile = { version: 1, entries: [e1, e2] }
  const data2: SkillsFile = { version: 1, entries: [e2, e1] }
  expect(renderReadme(data1, NOW)).toBe(renderReadme(data2, NOW))
})

test("the header carries the static validate workflow badge", () => {
  const md = renderReadme({ version: 1, entries: [entry("a/a", 1)] }, NOW)
  expect(md).toContain(
    "![validate](https://github.com/pjdurden/skills-live/actions/workflows/validate.yml/badge.svg)",
  )
})

test("the badge sits in the header, above the first kind section", () => {
  const md = renderReadme({ version: 1, entries: [entry("a/a", 1)] }, NOW)
  expect(md.indexOf("badge.svg")).toBeLessThan(md.indexOf("## "))
})

function flaggedEntry(id: string, reason: FlagReason, since: string): Entry {
  return entry(id, 1, {
    status: "flagged",
    flag: { reason, since, issue: null, grace_until: null },
  })
}

test("the Recently flagged section lists id, reason and since", () => {
  const data: SkillsFile = {
    version: 1,
    entries: [entry("a/a", 1), flaggedEntry("x/dead", "gone", "2026-08-04")],
  }
  const md = renderReadme(data, NOW)
  expect(md).toContain("## Recently flagged")
  expect(md).toContain("| [x/dead](https://github.com/x/dead) | gone | 2026-08-04 |")
})

test("the Recently flagged section is omitted entirely when nothing is flagged", () => {
  const md = renderReadme({ version: 1, entries: [entry("a/a", 1)] }, NOW)
  expect(md).not.toContain("## Recently flagged")
  expect(md).not.toContain("| Repo | Reason | Flagged since |")
})

test("the Recently flagged section sits after the kind sections", () => {
  const data: SkillsFile = {
    version: 1,
    entries: [entry("a/a", 1, { kind: "tool" }), flaggedEntry("x/dead", "gone", "2026-08-04")],
  }
  const md = renderReadme(data, NOW)
  expect(md.indexOf("## Tools")).toBeLessThan(md.indexOf("## Recently flagged"))
  expect(md.indexOf("## Recently flagged")).toBeLessThan(md.indexOf("Code MIT"))
})

test("flagged rows sort by since descending then id, regardless of input order", () => {
  const older = flaggedEntry("a/older", "stale", "2026-07-01")
  const newerA = flaggedEntry("b/newer", "archived", "2026-08-01")
  const newerB = flaggedEntry("a/newer", "gone", "2026-08-01")
  const forward = renderReadme({ version: 1, entries: [older, newerA, newerB] }, NOW)
  const reversed = renderReadme({ version: 1, entries: [newerB, newerA, older] }, NOW)
  expect(forward).toBe(reversed)
  expect(forward.indexOf("a/newer")).toBeLessThan(forward.indexOf("b/newer"))
  expect(forward.indexOf("b/newer")).toBeLessThan(forward.indexOf("a/older"))
})

test("human flag reasons are shown in Recently flagged too", () => {
  const md = renderReadme(
    { version: 1, entries: [flaggedEntry("x/d", "dispute", "2026-08-02")] },
    NOW,
  )
  expect(md).toContain("| [x/d](https://github.com/x/d) | dispute | 2026-08-02 |")
})

test("the header describes flagging as delisting, not removal", () => {
  const md = renderReadme({ version: 1, entries: [entry("a/a", 1)] }, NOW)
  expect(md).toContain("flagged and delisted")
  expect(md).not.toContain("flagged and removed")
  expect(md).toContain("permanently excluded")
  expect(md).not.toContain("what was pruned and why")
})
