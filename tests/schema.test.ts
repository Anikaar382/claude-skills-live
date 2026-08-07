import { test, expect } from "bun:test"
import { EntrySchema, SkillsFileSchema, GraveyardEntrySchema } from "../src/schema"

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

test("rejects a graveyard entry with an id that has no slash", () => {
  const bad = {
    id: "superpowers",
    name: "Superpowers",
    url: "https://github.com/obra/superpowers",
    reason: "archived",
    removed: "2026-08-06",
  }
  expect(() => GraveyardEntrySchema.parse(bad)).toThrow()
})

test("accepts a graveyard entry with reason blocked", () => {
  const ok = {
    id: "obra/superpowers",
    name: "Superpowers",
    url: "https://github.com/obra/superpowers",
    reason: "blocked",
    removed: "2026-08-06",
  }
  expect(GraveyardEntrySchema.parse(ok).reason).toBe("blocked")
})

test("accepts a graveyard entry with reason offtopic", () => {
  const ok = {
    id: "obra/superpowers",
    name: "Superpowers",
    url: "https://github.com/obra/superpowers",
    reason: "offtopic",
    removed: "2026-08-06",
  }
  expect(GraveyardEntrySchema.parse(ok).reason).toBe("offtopic")
})

test("accepts a graveyard entry with a valid owner/repo id", () => {
  const ok = {
    id: "obra/superpowers",
    name: "Superpowers",
    url: "https://github.com/obra/superpowers",
    reason: "archived",
    removed: "2026-08-06",
  }
  expect(GraveyardEntrySchema.parse(ok).id).toBe("obra/superpowers")
})

test("rejects a url that does not match the id", () => {
  // The README renders [id](url), so this is a phishing primitive: display
  // text says anthropics/skills, the link goes somewhere else.
  const bad = { ...validEntry, url: "https://evil.example.com/anthropics/skills" }
  expect(() => EntrySchema.parse(bad)).toThrow(/url must be/)
})

test("rejects a url pointing at a different GitHub repo than the id", () => {
  const bad = { ...validEntry, url: "https://github.com/someone/else" }
  expect(() => EntrySchema.parse(bad)).toThrow(/url must be/)
})

test("accepts the canonical url for the id", () => {
  expect(EntrySchema.parse(validEntry).url).toBe("https://github.com/obra/superpowers")
})

test("rejects an id containing a double quote", () => {
  // buildBatchQuery interpolates owner and name into GraphQL string literals
  // with no escaping, so this used to be a query-injection primitive.
  const bad = { ...validEntry, id: 'a"/b', url: 'https://github.com/a"/b' }
  expect(() => EntrySchema.parse(bad)).toThrow()
})

test("rejects an id containing a backslash", () => {
  const bad = { ...validEntry, id: "a\\/b", url: "https://github.com/a\\/b" }
  expect(() => EntrySchema.parse(bad)).toThrow()
})

test("accepts dots, dashes and underscores in an id", () => {
  const ok = { ...validEntry, id: "some.org/my_repo-v2.0", url: "https://github.com/some.org/my_repo-v2.0" }
  expect(EntrySchema.parse(ok).id).toBe("some.org/my_repo-v2.0")
})

test("rejects duplicate ids in a skills file", () => {
  const file = { version: 1, entries: [validEntry, { ...validEntry, name: "Other" }] }
  expect(() => SkillsFileSchema.parse(file)).toThrow(/duplicate id: obra\/superpowers/)
})

test("accepts distinct ids in a skills file", () => {
  const other = { ...validEntry, id: "obra/other", url: "https://github.com/obra/other" }
  expect(SkillsFileSchema.parse({ version: 1, entries: [validEntry, other] }).entries.length).toBe(2)
})
