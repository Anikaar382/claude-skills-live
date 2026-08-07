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

test("the page is self-contained: no external stylesheet, and its one script tag has no src", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/a")] }
  const html = renderSite(data, EMPTY_GRAVEYARD, NOW)
  expect(html).not.toContain("<link")
  expect(html).not.toMatch(/<script[^>]*\ssrc=/)
  expect(html).toContain("<style>")
  expect(html).toContain("<script>")
})

test("the last-checked stat matches the README badge time format", () => {
  const data: SkillsFile = {
    version: 1,
    entries: [entry("a/a", { metrics: { stars: 5, pushed_at: "2026-08-01", archived: false, last_checked: "2026-08-06T09:30:00Z" } })],
  }
  const html = renderSite(data, EMPTY_GRAVEYARD, NOW)
  expect(html).toContain("2026-08-06 09:30 UTC")
})

test("category breakdown links to the matching listing group below, not out to GitHub", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/a", { kind: "mcp" })] }
  const html = renderSite(data, EMPTY_GRAVEYARD, NOW)
  expect(html).toContain('href="#group-mcp"')
  expect(html).toContain('id="group-mcp"')
})

test("every active entry's id appears in the rendered page, and flagged/graveyarded ids do not appear in the active listing", () => {
  const flagged = entry("x/gone", {
    status: "flagged",
    flag: { reason: "stale", since: "2026-08-01", issue: null, grace_until: null },
  })
  const graveyard: GraveyardFile = {
    version: 1,
    entries: [
      { id: "bad/mirror", name: "mirror", url: "https://github.com/bad/mirror", reason: "blocked", removed: "2026-08-01" },
    ],
  }
  const data: SkillsFile = { version: 1, entries: [entry("a/a"), entry("b/b"), flagged] }
  const html = renderSite(data, graveyard, NOW)

  expect(html).toContain('data-search="a/a')
  expect(html).toContain('data-search="b/b')

  const listing = html.slice(html.indexOf('class="listing-section"'), html.indexOf('class="flagged-section"'))
  expect(listing).toContain("a/a")
  expect(listing).toContain("b/b")
  expect(listing).not.toContain("x/gone")
  expect(listing).not.toContain("bad/mirror")
})

test("entries within a kind group are ordered by stars descending, id ascending", () => {
  const data: SkillsFile = {
    version: 1,
    entries: [
      entry("z/low", { metrics: { stars: 1, pushed_at: "2026-08-01", archived: false, last_checked: "2026-08-06T04:00:00Z" } }),
      entry("b/tiehigh", { metrics: { stars: 10, pushed_at: "2026-08-01", archived: false, last_checked: "2026-08-06T04:00:00Z" } }),
      entry("a/tiehigh", { metrics: { stars: 10, pushed_at: "2026-08-01", archived: false, last_checked: "2026-08-06T04:00:00Z" } }),
    ],
  }
  const html = renderSite(data, EMPTY_GRAVEYARD, NOW)
  const group = html.slice(html.indexOf('id="group-skill"'), html.indexOf('</div>\n</section>\n<section class="flagged-section"'))
  const posA = group.indexOf("a/tiehigh")
  const posB = group.indexOf("b/tiehigh")
  const posZ = group.indexOf("z/low")
  expect(posA).toBeGreaterThan(-1)
  expect(posB).toBeGreaterThan(-1)
  expect(posZ).toBeGreaterThan(-1)
  expect(posA).toBeLessThan(posB)
  expect(posB).toBeLessThan(posZ)
})

test("tag chips are deterministic across repeated renders and reversed input order", () => {
  const data: SkillsFile = {
    version: 1,
    entries: [
      entry("a/a", { tags: ["alpha", "shared"] }),
      entry("b/b", { tags: ["beta", "shared"] }),
      entry("c/c", { tags: ["shared"] }),
    ],
  }
  const reversed: SkillsFile = { version: 1, entries: [...data.entries].reverse() }
  const html1 = renderSite(data, EMPTY_GRAVEYARD, NOW)
  const html2 = renderSite(data, EMPTY_GRAVEYARD, NOW)
  const htmlReversed = renderSite(reversed, EMPTY_GRAVEYARD, NOW)
  expect(html1).toBe(html2)
  expect(html1).toBe(htmlReversed)

  const chipsShared = html1.indexOf('data-tag="shared"')
  const chipsAlpha = html1.indexOf('data-tag="alpha"')
  expect(chipsShared).toBeGreaterThan(-1)
  expect(chipsAlpha).toBeGreaterThan(-1)
  expect(chipsShared).toBeLessThan(chipsAlpha)
})

test("an entry summary with script tags, quotes and a closing td is escaped in both the visible cell and any data- attribute", () => {
  const evil = entry("evil/one", {
    summary: `<script>alert(1)</script> & "quoted" 'single'</td><td>injected`,
  })
  const data: SkillsFile = { version: 1, entries: [evil] }
  const html = renderSite(data, EMPTY_GRAVEYARD, NOW)
  expect(html).not.toContain("<script>alert(1)</script>")
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
  expect(html).not.toContain("</td><td>injected")
  // The data-search attribute carries the lower-cased summary and must be
  // escaped the same way as the visible <p class="entry-summary">.
  const dataSearchStart = html.indexOf('data-search="')
  const dataSearchAttr = html.slice(dataSearchStart, html.indexOf('"', dataSearchStart + 13))
  expect(dataSearchAttr).not.toContain("<script>")
  expect(dataSearchAttr).not.toContain('"quoted"')
  expect(dataSearchAttr).toContain("&lt;script&gt;")
})

test("the page still renders every entry when the inline script block is stripped out", () => {
  const data: SkillsFile = {
    version: 1,
    entries: [entry("a/a"), entry("b/b"), entry("c/c", { kind: "mcp" })],
  }
  const html = renderSite(data, EMPTY_GRAVEYARD, NOW)
  const withoutScript = html.replace(/<script>[\s\S]*?<\/script>/, "")
  expect(withoutScript).toContain("a/a")
  expect(withoutScript).toContain("b/b")
  expect(withoutScript).toContain("c/c")
  expect(withoutScript).toContain('class="entry-card"')
})

test("the filters UI is hidden by default so a no-JS visitor never sees dead controls", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/a")] }
  const html = renderSite(data, EMPTY_GRAVEYARD, NOW)
  expect(html).toContain('<div class="filters" id="filters" hidden>')
})
