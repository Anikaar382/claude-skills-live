import { test, expect } from "bun:test"
import { FakeGitHubClient, type RepoMeta } from "../src/github"
import { discover, isEligible, toEntry } from "../src/discover"

function meta(id: string, over: Partial<RepoMeta> = {}): RepoMeta {
  return { id, stars: 100, pushed_at: "2026-08-01", archived: false, description: "A thing.", ...over }
}

test("rejects repos under the star bar", () => {
  expect(isEligible(meta("a/b", { stars: 24 }), new Set())).toBe(false)
  expect(isEligible(meta("a/b", { stars: 25 }), new Set())).toBe(true)
})

test("rejects archived repos", () => {
  expect(isEligible(meta("a/b", { archived: true }), new Set())).toBe(false)
})

test("rejects ids already known", () => {
  expect(isEligible(meta("a/b"), new Set(["a/b"]))).toBe(false)
})

test("rejects mirrors of leaked proprietary source", () => {
  expect(isEligible(meta("someone/claude-code-source-code"), new Set())).toBe(false)
  expect(isEligible(meta("someone/system-prompts-leaks"), new Set())).toBe(false)
})

test("toEntry truncates a long description to 120 characters", () => {
  const e = toEntry(meta("a/b", { description: "x".repeat(400) }), "2026-08-06")
  expect(e.summary.length).toBeLessThanOrEqual(120)
})

test("toEntry falls back when description is null", () => {
  expect(toEntry(meta("a/b", { description: null }), "2026-08-06").summary).toBe(
    "No description provided upstream.",
  )
})

test("toEntry marks the entry as active discovery with today's date", () => {
  const e = toEntry(meta("a/b"), "2026-08-06")
  expect(e.status).toBe("active")
  expect(e.source).toBe("discovery")
  expect(e.added).toBe("2026-08-06")
  expect(e.metrics.stars).toBe(100)
})

test("discover deduplicates across queries", async () => {
  const gh = new FakeGitHubClient([meta("a/b"), meta("c/d")])
  const found = await discover(gh, new Set(), "2026-08-06", 10)
  expect(found.map((e) => e.id).sort()).toEqual(["a/b", "c/d"])
})

test("discover excludes ids already known", async () => {
  const gh = new FakeGitHubClient([meta("a/b"), meta("c/d")])
  const found = await discover(gh, new Set(["a/b"]), "2026-08-06", 10)
  expect(found.map((e) => e.id)).toEqual(["c/d"])
})
