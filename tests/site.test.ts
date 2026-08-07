import { test, expect } from "bun:test"
import { renderSite } from "../src/site"
import type { Entry, GraveyardFile, SkillsFile } from "../src/schema"

function entry(id: string, over: Partial<Entry> = {}): Entry {
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
    metrics: { stars: 5, pushed_at: "2026-08-01", archived: false, last_checked: "2026-08-06T04:00:00Z" },
    ...over,
  }
}

const NOW = new Date("2026-08-06T05:00:00Z")
const EMPTY_GRAVEYARD: GraveyardFile = { version: 1, entries: [] }

test("only active entries are counted in the published stat", () => {
  const flagged = entry("x/gone", {
    status: "flagged",
    flag: { reason: "stale", since: "2026-08-01", issue: null, grace_until: null },
  })
  const data: SkillsFile = { version: 1, entries: [entry("a/a"), entry("b/b"), flagged] }
  const html = renderSite(data, EMPTY_GRAVEYARD, NOW)
  expect(html).toContain('<div class="stat-value">2</div><div class="stat-label">Published</div>')
})

test("flagged entries appear in the flagged table and not in the published count", () => {
  const flagged = entry("x/gone", {
    status: "flagged",
    flag: { reason: "stale", since: "2026-08-01", issue: null, grace_until: null },
  })
  const data: SkillsFile = { version: 1, entries: [entry("a/a"), flagged] }
  const html = renderSite(data, EMPTY_GRAVEYARD, NOW)
  expect(html).toContain('<div class="stat-value">1</div><div class="stat-label">Published</div>')
  expect(html).toContain("x/gone")
  expect(html).toContain("stale")
})

test("graveyard entries render with their reason", () => {
  const graveyard: GraveyardFile = {
    version: 1,
    entries: [
      {
        id: "bad/mirror",
        name: "mirror",
        url: "https://github.com/bad/mirror",
        reason: "blocked",
        removed: "2026-08-01",
      },
      {
        id: "off/topic",
        name: "topic",
        url: "https://github.com/off/topic",
        reason: "offtopic",
        removed: "2026-08-02",
      },
    ],
  }
  const data: SkillsFile = { version: 1, entries: [entry("a/a")] }
  const html = renderSite(data, graveyard, NOW)
  expect(html).toContain("bad/mirror")
  expect(html).toContain("blocked")
  expect(html).toContain("off/topic")
  expect(html).toContain("offtopic")
  expect(html).toContain('<div class="stat-value">2</div><div class="stat-label">Permanently excluded</div>')
})

test("rendering twice is byte-identical", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/a"), entry("b/b")] }
  expect(renderSite(data, EMPTY_GRAVEYARD, NOW)).toBe(renderSite(data, EMPTY_GRAVEYARD, NOW))
})

test("rendering with entries in reversed input order is byte-identical", () => {
  const flaggedA = entry("a/older", {
    status: "flagged",
    flag: { reason: "stale", since: "2026-07-01", issue: null, grace_until: null },
  })
  const flaggedB = entry("b/newer", {
    status: "flagged",
    flag: { reason: "archived", since: "2026-08-01", issue: null, grace_until: null },
  })
  const forward: SkillsFile = { version: 1, entries: [entry("a/a"), flaggedA, flaggedB] }
  const reversed: SkillsFile = { version: 1, entries: [flaggedB, flaggedA, entry("a/a")] }
  const graveyard: GraveyardFile = {
    version: 1,
    entries: [
      { id: "z/z", name: "z", url: "https://github.com/z/z", reason: "blocked", removed: "2026-08-01" },
      { id: "a/z", name: "az", url: "https://github.com/a/z", reason: "offtopic", removed: "2026-08-01" },
    ],
  }
  const graveyardRev: GraveyardFile = { version: 1, entries: [...graveyard.entries].reverse() }
  expect(renderSite(forward, graveyard, NOW)).toBe(renderSite(reversed, graveyardRev, NOW))
})

test("a summary containing script tags, ampersands, quotes and a closing td is escaped", () => {
  const flagged = entry("x/evil", {
    status: "flagged",
    summary: `<script>alert(1)</script> & "quoted" 'single'</td><td>injected`,
    flag: { reason: "dispute", since: "2026-08-01", issue: null, grace_until: null },
  })
  const data: SkillsFile = { version: 1, entries: [flagged] }
  const html = renderSite(data, EMPTY_GRAVEYARD, NOW)
  expect(html).not.toContain("<script>alert(1)</script>")
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
  expect(html).toContain("&amp;")
  expect(html).toContain("&quot;quoted&quot;")
  expect(html).toContain("&#39;single&#39;")
  expect(html).not.toContain("</td><td>injected")
  expect(html).toContain("&lt;/td&gt;&lt;td&gt;injected")
})

test("the page references no external host other than github.com", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/a")] }
  const graveyard: GraveyardFile = {
    version: 1,
    entries: [
      { id: "z/z", name: "z", url: "https://github.com/z/z", reason: "blocked", removed: "2026-08-01" },
    ],
  }
  const html = renderSite(data, graveyard, NOW)
  const refs = html.match(/https?:\/\/[^\s"'<>)]+/g) ?? []
  expect(refs.length).toBeGreaterThan(0)
  for (const ref of refs) {
    expect(ref.startsWith("https://github.com/")).toBe(true)
  }
})

test("the page is a self-contained document with no external stylesheet or script", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/a")] }
  const html = renderSite(data, EMPTY_GRAVEYARD, NOW)
  expect(html).not.toContain("<link")
  expect(html).not.toContain("<script")
  expect(html).toContain("<style>")
})

test("the last-checked stat matches the README badge time format", () => {
  const data: SkillsFile = {
    version: 1,
    entries: [entry("a/a", { metrics: { stars: 5, pushed_at: "2026-08-01", archived: false, last_checked: "2026-08-06T09:30:00Z" } })],
  }
  const html = renderSite(data, EMPTY_GRAVEYARD, NOW)
  expect(html).toContain("2026-08-06 09:30 UTC")
})

test("category breakdown links to the matching GitHub README anchor", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/a", { kind: "mcp" })] }
  const html = renderSite(data, EMPTY_GRAVEYARD, NOW)
  expect(html).toContain('href="https://github.com/pjdurden/claude-skills-live#mcp-servers"')
})
