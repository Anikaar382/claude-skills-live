import { test, expect } from "bun:test"
import { daysBetween, reap, toGraveyard } from "../src/reap"
import type { Entry } from "../src/schema"

function entry(id: string, pushed: string, over: Partial<Entry> = {}): Entry {
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
    metrics: { stars: 10, pushed_at: pushed, archived: false, last_checked: "2026-08-06T04:00:00Z" },
    ...over,
  }
}

const NOW = new Date("2026-08-06T04:00:00Z")

test("daysBetween counts whole days", () => {
  expect(daysBetween("2026-08-01", NOW)).toBe(5)
})

test("does not flag at 89 days", () => {
  const { flagged } = reap([entry("a/b", "2026-05-10")], [], NOW)
  expect(flagged).toEqual([])
})

test("flags stale at exactly 90 days", () => {
  const { flagged } = reap([entry("a/b", "2026-05-08")], [], NOW)
  expect(flagged).toEqual([{ id: "a/b", reason: "stale" }])
})

test("flags stale past 90 days", () => {
  const { flagged } = reap([entry("a/b", "2026-01-01")], [], NOW)
  expect(flagged[0]!.reason).toBe("stale")
})

test("archived takes priority over stale", () => {
  const e = entry("a/b", "2026-01-01", {
    metrics: { stars: 10, pushed_at: "2026-01-01", archived: true, last_checked: "2026-08-06T04:00:00Z" },
  })
  expect(reap([e], [], NOW).flagged[0]!.reason).toBe("archived")
})

test("missing ids are flagged gone", () => {
  const { flagged } = reap([entry("a/b", "2026-08-05")], ["a/b"], NOW)
  expect(flagged).toEqual([{ id: "a/b", reason: "gone" }])
})

test("gone takes priority over archived", () => {
  const e = entry("a/b", "2026-01-01", {
    metrics: { stars: 10, pushed_at: "2026-01-01", archived: true, last_checked: "2026-08-06T04:00:00Z" },
  })
  expect(reap([e], ["a/b"], NOW).flagged[0]!.reason).toBe("gone")
})

test("grace_until in the future suppresses a stale flag", () => {
  const e = entry("a/b", "2026-01-01", {
    flag: { reason: "stale", since: "2026-07-01", issue: 5, grace_until: "2027-01-01" },
  })
  expect(reap([e], [], NOW).flagged).toEqual([])
})

test("grace_until in the past does not suppress", () => {
  const e = entry("a/b", "2026-01-01", {
    flag: { reason: "stale", since: "2026-01-01", issue: 5, grace_until: "2026-07-01" },
  })
  expect(reap([e], [], NOW).flagged[0]!.reason).toBe("stale")
})

test("grace does not suppress a gone flag", () => {
  const e = entry("a/b", "2026-08-05", {
    flag: { reason: "stale", since: "2026-07-01", issue: 5, grace_until: "2027-01-01" },
  })
  expect(reap([e], ["a/b"], NOW).flagged[0]!.reason).toBe("gone")
})

test("flagging sets status, reason and since without an issue number", () => {
  const { entries } = reap([entry("a/b", "2026-01-01")], [], NOW)
  expect(entries[0]!.status).toBe("flagged")
  expect(entries[0]!.flag).toEqual({ reason: "stale", since: "2026-08-06", issue: null, grace_until: null })
})

test("a healthy entry is returned untouched", () => {
  const e = entry("a/b", "2026-08-05")
  expect(reap([e], [], NOW).entries[0]).toEqual(e)
})

test("an already flagged entry is not re-flagged with a new since date", () => {
  const e = entry("a/b", "2026-01-01", {
    status: "flagged",
    flag: { reason: "stale", since: "2026-06-01", issue: 7, grace_until: null },
  })
  const { entries, flagged } = reap([e], [], NOW)
  expect(flagged).toEqual([])
  expect(entries[0]!.flag!.since).toBe("2026-06-01")
})

test("entry flagged blocked and archived is returned untouched", () => {
  const e = entry("a/b", "2026-01-01", {
    status: "flagged",
    flag: { reason: "blocked", since: "2026-07-01", issue: 3, grace_until: null },
    metrics: { stars: 10, pushed_at: "2026-01-01", archived: true, last_checked: "2026-08-06T04:00:00Z" },
  })
  const { entries, flagged } = reap([e], [], NOW)
  expect(flagged).toEqual([])
  expect(entries[0]).toEqual(e)
})

test("entry flagged blocked and in missing is returned untouched", () => {
  const e = entry("a/b", "2026-08-05", {
    status: "flagged",
    flag: { reason: "blocked", since: "2026-07-01", issue: 3, grace_until: null },
  })
  const { entries, flagged } = reap([e], ["a/b"], NOW)
  expect(flagged).toEqual([])
  expect(entries[0]).toEqual(e)
})

test("entry flagged dispute and stale is returned untouched", () => {
  const e = entry("a/b", "2026-01-01", {
    status: "flagged",
    flag: { reason: "dispute", since: "2026-06-01", issue: 5, grace_until: null },
  })
  const { entries, flagged } = reap([e], [], NOW)
  expect(flagged).toEqual([])
  expect(entries[0]).toEqual(e)
})

test("reason transition from stale to archived preserves since and issue", () => {
  const e = entry("a/b", "2026-01-01", {
    status: "flagged",
    flag: { reason: "stale", since: "2026-06-01", issue: 7, grace_until: null },
    metrics: { stars: 10, pushed_at: "2026-01-01", archived: true, last_checked: "2026-08-06T04:00:00Z" },
  })
  const { entries, flagged } = reap([e], [], NOW)
  expect(flagged).toEqual([{ id: "a/b", reason: "archived" }])
  expect(entries[0]!.flag).toEqual({ reason: "archived", since: "2026-06-01", issue: 7, grace_until: null })
})

test("unflagged entry going stale gets fresh since date", () => {
  const e = entry("a/b", "2026-01-01")
  const { entries, flagged } = reap([e], [], NOW)
  expect(flagged).toEqual([{ id: "a/b", reason: "stale" }])
  expect(entries[0]!.status).toBe("flagged")
  expect(entries[0]!.flag).toEqual({ reason: "stale", since: "2026-08-06", issue: null, grace_until: null })
})

test("toGraveyard captures id, reason and removal date", () => {
  const g = toGraveyard(entry("a/b", "2026-01-01"), "stale", "2026-08-06")
  expect(g).toEqual({
    id: "a/b",
    name: "b",
    url: "https://github.com/a/b",
    reason: "stale",
    removed: "2026-08-06",
  })
})
