import { test, expect } from "bun:test"
import { renderJson, renderReadme } from "../src/render"
import { checkNoDead, checkReproducible, checkStaleness, validate } from "../src/validate"
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

test("validate defaults to staleness on, and a stale entry fails it", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-01-01T00:00:00Z")] }
  const problems = validate(data, renderReadme(data, NOW), renderJson(data), NOW)
  expect(problems.length).toBe(1)
  expect(problems[0]).toContain("a/b")
})

test("validate with staleness: false skips the staleness gate for the same stale entry", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-01-01T00:00:00Z")] }
  const problems = validate(data, renderReadme(data, NOW), renderJson(data), NOW, {
    staleness: false,
  })
  expect(problems).toEqual([])
})

test("validate with staleness: false still runs the reproducibility gate", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-01-01T00:00:00Z")] }
  const problems = validate(data, "wrong", "wrong", NOW, { staleness: false })
  expect(problems.length).toBe(2)
})

test("checkNoDead passes a fresh, unarchived active entry", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-08-05T04:00:00Z")] }
  expect(checkNoDead(data, NOW)).toEqual([])
})

test("checkNoDead fails an active entry that is archived upstream", () => {
  const e = entry("a/b", "2026-08-05T04:00:00Z", {
    metrics: { stars: 10, pushed_at: "2026-08-01", archived: true, last_checked: "2026-08-05T04:00:00Z" },
  })
  const problems = checkNoDead({ version: 1, entries: [e] }, NOW)
  expect(problems.length).toBe(1)
  expect(problems[0]).toContain("archived")
})

test("checkNoDead fails an active entry at exactly the 90-day push limit", () => {
  const e = entry("a/b", "2026-08-05T04:00:00Z", {
    metrics: { stars: 10, pushed_at: "2026-05-08", archived: false, last_checked: "2026-08-05T04:00:00Z" },
  })
  expect(checkNoDead({ version: 1, entries: [e] }, NOW).length).toBe(1)
})

test("checkNoDead passes an active entry at 89 days", () => {
  const e = entry("a/b", "2026-08-05T04:00:00Z", {
    metrics: { stars: 10, pushed_at: "2026-05-10", archived: false, last_checked: "2026-08-05T04:00:00Z" },
  })
  expect(checkNoDead({ version: 1, entries: [e] }, NOW)).toEqual([])
})

test("checkNoDead fails an active entry whose pushed_at is unparseable", () => {
  const e = entry("a/b", "2026-08-05T04:00:00Z", {
    metrics: { stars: 10, pushed_at: "2026-13-45", archived: false, last_checked: "2026-08-05T04:00:00Z" },
  })
  expect(checkNoDead({ version: 1, entries: [e] }, NOW).length).toBe(1)
})

test("checkNoDead ignores flagged entries, which are not rendered anyway", () => {
  const e = entry("a/b", "2026-08-05T04:00:00Z", {
    status: "flagged",
    flag: { reason: "archived", since: "2026-01-01", issue: null, grace_until: null },
    metrics: { stars: 10, pushed_at: "2020-01-01", archived: true, last_checked: "2026-08-05T04:00:00Z" },
  })
  expect(checkNoDead({ version: 1, entries: [e] }, NOW)).toEqual([])
})

test("checkNoDead exempts an active entry inside a live grace window", () => {
  const e = entry("a/b", "2026-08-05T04:00:00Z", {
    flag: { reason: "stale", since: "2026-06-01", issue: 1, grace_until: "2027-01-01" },
    metrics: { stars: 10, pushed_at: "2020-01-01", archived: true, last_checked: "2026-08-05T04:00:00Z" },
  })
  expect(checkNoDead({ version: 1, entries: [e] }, NOW)).toEqual([])
})

test("checkNoDead does not exempt an active entry whose grace has expired", () => {
  const e = entry("a/b", "2026-08-05T04:00:00Z", {
    flag: { reason: "stale", since: "2026-01-01", issue: 1, grace_until: "2026-07-01" },
    metrics: { stars: 10, pushed_at: "2020-01-01", archived: false, last_checked: "2026-08-05T04:00:00Z" },
  })
  expect(checkNoDead({ version: 1, entries: [e] }, NOW).length).toBe(1)
})

test("--no-staleness does not suppress the no-dead-entries gate", () => {
  // The exact hole: an entry checked five minutes ago, so staleness is happy,
  // that a PR flipped back to active while it is archived upstream.
  const e = entry("a/b", "2026-08-06T03:55:00Z", {
    metrics: { stars: 10, pushed_at: "2026-08-01", archived: true, last_checked: "2026-08-06T03:55:00Z" },
  })
  const data: SkillsFile = { version: 1, entries: [e] }
  const problems = validate(data, renderReadme(data, NOW), renderJson(data), NOW, {
    staleness: false,
  })
  expect(problems.length).toBe(1)
  expect(problems[0]).toContain("archived")
})
