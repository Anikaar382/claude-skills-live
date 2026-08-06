import { test, expect } from "bun:test"
import { EntrySchema, SkillsFileSchema } from "../src/schema"

const validEntry = {
  id: "obra/superpowers",
  kind: "framework",
  name: "Superpowers",
  url: "https://github.com/obra/superpowers",
  summary: "Agentic skills framework and spec-driven development methodology.",
  tags: ["skills", "methodology"],
  added: "2026-08-06",
  source: "discovery",
  status: "active",
  metrics: {
    stars: 268003,
    pushed_at: "2026-08-06",
    archived: false,
    last_checked: "2026-08-06T04:00:00Z",
  },
}

test("accepts a valid active entry", () => {
  expect(EntrySchema.parse(validEntry).id).toBe("obra/superpowers")
})

test("rejects a summary over 120 characters", () => {
  const bad = { ...validEntry, summary: "x".repeat(121) }
  expect(() => EntrySchema.parse(bad)).toThrow()
})

test("rejects an id that is not owner/repo", () => {
  const bad = { ...validEntry, id: "superpowers" }
  expect(() => EntrySchema.parse(bad)).toThrow()
})

test("requires a flag when status is not active", () => {
  const bad = { ...validEntry, status: "flagged" }
  expect(() => EntrySchema.parse(bad)).toThrow(/flag is required/)
})

test("accepts a flagged entry that carries a flag", () => {
  const ok = {
    ...validEntry,
    status: "flagged",
    flag: { reason: "stale", since: "2026-08-06", issue: null, grace_until: null },
  }
  expect(EntrySchema.parse(ok).flag?.reason).toBe("stale")
})

test("defaults tags to an empty array", () => {
  const { tags, ...noTags } = validEntry
  expect(EntrySchema.parse(noTags).tags).toEqual([])
})

test("parses a whole skills file", () => {
  const file = { version: 1, entries: [validEntry] }
  expect(SkillsFileSchema.parse(file).entries.length).toBe(1)
})
