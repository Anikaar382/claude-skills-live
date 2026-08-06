import { test, expect } from "bun:test"
import { FakeGitHubClient, buildBatchQuery, chunk, throttleAction, type RepoMeta } from "../src/github"

function meta(id: string, stars = 100): RepoMeta {
  return { id, stars, pushed_at: "2026-08-01", archived: false, description: "d" }
}

test("chunk splits into fixed-size groups", () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
})

test("chunk returns empty array for empty input", () => {
  expect(chunk([], 100)).toEqual([])
})

test("buildBatchQuery emits one alias per id with owner and name split", () => {
  const q = buildBatchQuery(["a/b", "c/d"])
  expect(q).toContain('r0: repository(owner: "a", name: "b")')
  expect(q).toContain('r1: repository(owner: "c", name: "d")')
  expect(q).toContain("fragment M on Repository")
})

test("fake getRepos returns metadata for known ids", async () => {
  const gh = new FakeGitHubClient([meta("a/b", 42)])
  const got = await gh.getRepos(["a/b"])
  expect(got.get("a/b")?.stars).toBe(42)
})

test("fake getRepos returns null for gone ids", async () => {
  const gh = new FakeGitHubClient([meta("a/b")], new Set(["x/y"]))
  const got = await gh.getRepos(["a/b", "x/y"])
  expect(got.get("x/y")).toBeNull()
})

test("fake searchRepos respects the max argument", async () => {
  const gh = new FakeGitHubClient([meta("a/b"), meta("c/d"), meta("e/f")])
  expect((await gh.searchRepos("anything", 2)).length).toBe(2)
})

test("throttleAction: 429 under the cap backs off", () => {
  const headers = new Headers()
  expect(throttleAction(429, headers, 3)).toBe("backoff")
})

test("throttleAction: 429 at the cap throws", () => {
  const headers = new Headers()
  expect(throttleAction(429, headers, 5)).toBe("throw")
})

test("throttleAction: 403 with x-ratelimit-remaining zero backs off", () => {
  const headers = new Headers({ "x-ratelimit-remaining": "0" })
  expect(throttleAction(403, headers, 2)).toBe("backoff")
})

test("throttleAction: 403 without rate-limit headers throws immediately", () => {
  const headers = new Headers()
  expect(throttleAction(403, headers, 1)).toBe("throw")
})

test("throttleAction: 200 proceeds", () => {
  const headers = new Headers()
  expect(throttleAction(200, headers, 5)).toBe("proceed")
})
