import { test, expect } from "bun:test"
import { FakeGitHubClient, type RepoMeta } from "../src/github"
import { refresh } from "../src/refresh"
import type { Entry } from "../src/schema"

function meta(id: string, over: Partial<RepoMeta> = {}): RepoMeta {
  return { id, stars: 500, pushed_at: "2026-08-05", archived: false, description: "d", fork: false, ...over }
}

function entry(id: string, over: Partial<Entry> = {}): Entry {
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
    metrics: { stars: 1, pushed_at: "2026-01-01", archived: false, last_checked: "2026-01-01T00:00:00Z" },
    ...over,
  }
}

const NOW = new Date("2026-08-06T04:00:00Z")

test("updates stars, pushed_at, archived and last_checked", async () => {
  const gh = new FakeGitHubClient([meta("a/b")])
  const { entries } = await refresh(gh, [entry("a/b")], NOW)
  expect(entries[0]!.metrics).toEqual({
    stars: 500,
    pushed_at: "2026-08-05",
    archived: false,
    last_checked: "2026-08-06T04:00:00Z",
  })
})

test("preserves curated fields", async () => {
  const gh = new FakeGitHubClient([meta("a/b", { description: "upstream changed this" })])
  const { entries } = await refresh(gh, [entry("a/b", { summary: "ours", kind: "mcp", tags: ["x"] })], NOW)
  expect(entries[0]!.summary).toBe("ours")
  expect(entries[0]!.kind).toBe("mcp")
  expect(entries[0]!.tags).toEqual(["x"])
})

test("reports missing ids and leaves their metrics untouched", async () => {
  const gh = new FakeGitHubClient([], new Set(["x/y"]))
  const { entries, missing } = await refresh(gh, [entry("x/y")], NOW)
  expect(missing).toEqual(["x/y"])
  expect(entries[0]!.metrics.last_checked).toBe("2026-01-01T00:00:00Z")
})

test("refreshes flagged entries too so a revived repo can be seen", async () => {
  const flagged = entry("a/b", {
    status: "flagged",
    flag: { reason: "stale", since: "2026-05-01", issue: 3, grace_until: null },
  })
  const { entries } = await refresh(new FakeGitHubClient([meta("a/b")]), [flagged], NOW)
  expect(entries[0]!.metrics.stars).toBe(500)
  expect(entries[0]!.status).toBe("flagged")
})

test("handles an empty entry list without calling the API", async () => {
  const { entries, missing } = await refresh(new FakeGitHubClient([]), [], NOW)
  expect(entries).toEqual([])
  expect(missing).toEqual([])
})
