import {
  KIND_HEADING,
  KIND_ORDER,
  REPO_NAME,
  REPO_SLUG,
  activeOf,
  badgeTime,
  flaggedOf,
  type FlaggedEntry,
} from "./render"
import type { Entry, GraveyardEntry, GraveyardFile, SkillsFile } from "./schema"

const REPO_URL = `https://github.com/${REPO_SLUG}`

// `summary` and `id` are attacker-controlled: anyone can create a repo with
// any description and point it at this index. `&` is replaced first, in the
// same single pass as the others, so the escape stays injective — otherwise a
// summary containing a literal `&amp;` could be re-interpreted after an `&`
// got inserted around something else.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function sortedGraveyard(graveyard: GraveyardFile): GraveyardEntry[] {
  // Most recently removed first, ties broken by id — the same total order
  // convention as the flagged table, so the reproducibility gate has a single
  // stable answer regardless of the order graveyard.yaml happens to list rows.
  return [...graveyard.entries].sort(
    (a, b) =>
      (a.removed < b.removed ? 1 : a.removed > b.removed ? -1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

function flaggedRow(e: FlaggedEntry): string {
  const id = escapeHtml(e.id)
  const url = escapeHtml(e.url)
  const reason = escapeHtml(e.flag.reason)
  const since = escapeHtml(e.flag.since)
  const summary = escapeHtml(e.summary)
  return (
    `<tr><td><a href="${url}">${id}</a></td><td>${reason}</td>` +
    `<td>${since}</td><td>${summary}</td></tr>`
  )
}

function graveyardRow(e: GraveyardEntry): string {
  const id = escapeHtml(e.id)
  const url = escapeHtml(e.url)
  const reason = escapeHtml(e.reason)
  const removed = escapeHtml(e.removed)
  return `<tr><td><a href="${url}">${id}</a></td><td>${reason}</td><td>${removed}</td></tr>`
}

function stat(value: string, label: string): string {
  return `<div class="stat"><div class="stat-value">${value}</div><div class="stat-label">${escapeHtml(label)}</div></div>`
}

// Same total order renderReadme's `row()` uses (stars descending, id ascending
// as the tiebreaker) so the README and the site never disagree about which
// entry leads a category.
function sortedGroup(active: Entry[], kind: Entry["kind"]): Entry[] {
  return active
    .filter((e) => e.kind === kind)
    .sort((a, b) => b.metrics.stars - a.metrics.stars || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// `data-search` and `data-tags` are read by the inline script, never written
// into the DOM as markup — filtering works by comparing these attribute
// strings and toggling `hidden`, so escaping them the same way as any other
// interpolated value is enough; there is no innerHTML path for it to escape.
function entryCard(e: Entry): string {
  const id = escapeHtml(e.id)
  const url = escapeHtml(e.url)
  const summary = escapeHtml(e.summary)
  const stars = e.metrics.stars.toLocaleString("en-US")
  const pushed = escapeHtml(e.metrics.pushed_at)
  const tags = [...e.tags].sort()
  const searchBlob = escapeHtml(`${e.id} ${e.summary} ${tags.join(" ")}`.toLowerCase())
  const tagsJson = escapeHtml(JSON.stringify(tags))
  const tagSpans = tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")
  return (
    `<article class="entry-card" data-search="${searchBlob}" data-tags="${tagsJson}">` +
    `<div class="entry-head"><a class="entry-id" href="${url}">${id}</a>` +
    `<span class="entry-stars">★ ${stars}</span></div>` +
    `<div class="entry-pushed">pushed ${pushed}</div>` +
    (tagSpans.length > 0 ? `<div class="entry-tags">${tagSpans}</div>` : "") +
    `<p class="entry-summary">${summary}</p>` +
    `</article>`
  )
}

function kindGroup(active: Entry[], kind: Entry["kind"]): string | null {
  const group = sortedGroup(active, kind)
  if (group.length === 0) return null
  const heading = KIND_HEADING[kind]
  return (
    `<div class="kind-group" id="group-${kind}">` +
    `<h3>${escapeHtml(heading)} <span class="kind-count">${group.length}</span></h3>` +
    `<div class="entry-grid">${group.map(entryCard).join("")}</div>` +
    `</div>`
  )
}

// Tag chips are built from the tags actually present so the filter UI never
// offers a tag that would zero out every entry. Sorted by count descending,
// then tag name ascending — a total order, so the chip list is byte-stable
// under the reproducibility gate regardless of Map insertion order.
function tagCounts(active: Entry[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>()
  for (const e of active) {
    for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
}

function tagChip(t: { tag: string; count: number }): string {
  const tag = escapeHtml(t.tag)
  return (
    `<button type="button" class="tag-chip" data-tag="${tag}">${tag} ` +
    `<span class="chip-count">${t.count}</span></button>`
  )
}

// The inline script is a static string with no interpolated data — the data
// it reads lives entirely in `data-*` attributes already escaped above — so
// it cannot break byte-determinism and needs no separate templating.
const FILTER_SCRIPT = `
(function () {
  var filters = document.getElementById("filters");
  var searchInput = document.getElementById("search-input");
  var chipsContainer = document.getElementById("tag-chips");
  var resultCount = document.getElementById("result-count");
  var clearBtn = document.getElementById("clear-filters");
  if (!filters || !searchInput || !chipsContainer || !resultCount || !clearBtn) return;

  var cards = Array.prototype.slice.call(document.querySelectorAll(".entry-card"));
  var groups = Array.prototype.slice.call(document.querySelectorAll(".kind-group"));
  var total = cards.length;
  var activeTags = Object.create(null);
  var query = "";

  function cardTags(card) {
    try {
      return JSON.parse(card.getAttribute("data-tags") || "[]");
    } catch (err) {
      return [];
    }
  }

  function matches(card) {
    if (query) {
      var hay = card.getAttribute("data-search") || "";
      if (hay.indexOf(query) === -1) return false;
    }
    var selected = Object.keys(activeTags);
    if (selected.length > 0) {
      var tags = cardTags(card);
      var any = false;
      for (var i = 0; i < selected.length; i++) {
        if (tags.indexOf(selected[i]) !== -1) {
          any = true;
          break;
        }
      }
      if (!any) return false;
    }
    return true;
  }

  function apply() {
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var ok = matches(cards[i]);
      cards[i].hidden = !ok;
      if (ok) shown += 1;
    }
    for (var g = 0; g < groups.length; g++) {
      var visible = groups[g].querySelectorAll(".entry-card:not([hidden])").length;
      groups[g].hidden = visible === 0;
    }
    resultCount.textContent = "Showing " + shown + " of " + total;
    var hasFilter = query !== "" || Object.keys(activeTags).length > 0;
    clearBtn.hidden = !hasFilter;
  }

  searchInput.addEventListener("input", function () {
    query = searchInput.value.trim().toLowerCase();
    apply();
  });

  chipsContainer.addEventListener("click", function (ev) {
    var target = ev.target;
    while (target && target !== chipsContainer && !target.classList.contains("tag-chip")) {
      target = target.parentNode;
    }
    if (!target || target === chipsContainer) return;
    var tag = target.getAttribute("data-tag");
    if (activeTags[tag]) {
      delete activeTags[tag];
      target.classList.remove("active");
    } else {
      activeTags[tag] = true;
      target.classList.add("active");
    }
    apply();
  });

  clearBtn.addEventListener("click", function () {
    query = "";
    searchInput.value = "";
    activeTags = Object.create(null);
    var active = chipsContainer.querySelectorAll(".tag-chip.active");
    for (var i = 0; i < active.length; i++) active[i].classList.remove("active");
    apply();
  });

  filters.hidden = false;
  apply();
})();
`

export function renderSite(data: SkillsFile, graveyard: GraveyardFile, now: Date): string {
  const active = activeOf(data)
  const flagged = flaggedOf(data)
  const buried = sortedGraveyard(graveyard)
  const checked = badgeTime(active, now)

  // Local jump links straight to the matching group in the listing below —
  // the stat cards used to point out to GitHub, which was the entire gap this
  // page exists to close: a reader clicking a number should land on the
  // entries, not leave the page to see them.
  const categories = KIND_ORDER.map((kind) => {
    const count = active.filter((e) => e.kind === kind).length
    if (count === 0) return null
    const heading = KIND_HEADING[kind]
    return (
      `<a class="category" href="#group-${kind}">` +
      `<div class="category-count">${count}</div>` +
      `<div class="category-name">${escapeHtml(heading)}</div></a>`
    )
  }).filter((c): c is string => c !== null)

  const groups = KIND_ORDER.map((kind) => kindGroup(active, kind)).filter(
    (g): g is string => g !== null,
  )
  const chips = tagCounts(active).map(tagChip).join("")

  const flaggedSection =
    flagged.length > 0
      ? `<div class="table-wrap"><table><thead><tr><th>Repo</th><th>Reason</th>` +
        `<th>Since</th><th>What</th></tr></thead><tbody>` +
        flagged.map(flaggedRow).join("") +
        `</tbody></table></div>`
      : `<p class="empty">Nothing is currently flagged.</p>`

  const graveyardSection =
    buried.length > 0
      ? `<div class="table-wrap"><table><thead><tr><th>Repo</th><th>Reason</th>` +
        `<th>Removed</th></tr></thead><tbody>` +
        buried.map(graveyardRow).join("") +
        `</tbody></table></div>`
      : `<p class="empty">Nothing has been permanently excluded.</p>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(REPO_NAME)}</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #5f6368;
  --border: #e2e2e2;
  --accent: #0b5fff;
  --card-bg: #f6f7f9;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1115;
    --fg: #eaeaea;
    --muted: #9aa0a6;
    --border: #2a2d34;
    --accent: #6ea8ff;
    --card-bg: #171a20;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem 1.25rem 4rem;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.5;
}
main {
  max-width: 960px;
  margin: 0 auto;
}
header h1 {
  font-size: 2rem;
  margin: 0 0 0.35rem;
}
header p {
  color: var(--muted);
  margin: 0;
  font-size: 1.05rem;
}
section {
  margin-top: 3rem;
}
h2 {
  font-size: 1.15rem;
  margin: 0 0 0.75rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.5rem;
}
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
  margin-top: 2rem;
}
.stat {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.1rem 1rem;
}
.stat-value {
  font-size: 2rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.stat-label {
  color: var(--muted);
  font-size: 0.85rem;
  margin-top: 0.25rem;
}
.claim p {
  max-width: 68ch;
}
.claim .shrink {
  color: var(--muted);
}
.categories {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
}
.category {
  display: block;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  text-decoration: none;
  color: var(--fg);
}
.category:hover {
  border-color: var(--accent);
}
.category-count {
  font-size: 1.5rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.category-name {
  color: var(--muted);
  font-size: 0.85rem;
  margin-top: 0.2rem;
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  min-width: 480px;
}
th, td {
  text-align: left;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
tbody tr:last-child td {
  border-bottom: none;
}
th {
  color: var(--muted);
  font-weight: 600;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
a { color: var(--accent); }
.empty {
  color: var(--muted);
}
footer {
  margin-top: 4rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.85rem;
}
footer p { margin: 0.35rem 0; }
.filters {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
}
.filters[hidden] {
  display: none;
}
.filters-row {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  align-items: center;
}
.search-input {
  flex: 1 1 240px;
  min-width: 0;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font-size: 0.95rem;
}
.clear-filters {
  padding: 0.5rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font-size: 0.85rem;
  cursor: pointer;
}
.clear-filters[hidden] {
  display: none;
}
.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.tag-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg);
  color: var(--fg);
  font-size: 0.8rem;
  padding: 0.3rem 0.65rem;
  cursor: pointer;
}
.tag-chip .chip-count {
  color: var(--muted);
}
.tag-chip.active {
  border-color: var(--accent);
  color: var(--accent);
}
.result-count {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
}
.kind-group {
  margin-top: 2rem;
}
.kind-group[hidden] {
  display: none;
}
.kind-group h3 {
  font-size: 1rem;
  margin: 0 0 0.75rem;
  color: var(--muted);
}
.kind-group h3 .kind-count {
  color: var(--fg);
  font-weight: 700;
}
.entry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.75rem;
}
.entry-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.85rem 1rem;
  background: var(--card-bg);
  min-width: 0;
  overflow-wrap: anywhere;
}
.entry-card[hidden] {
  display: none;
}
.entry-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}
.entry-id {
  font-weight: 600;
  font-size: 0.95rem;
}
.entry-stars {
  color: var(--muted);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.entry-pushed {
  color: var(--muted);
  font-size: 0.75rem;
  margin-top: 0.2rem;
}
.entry-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.5rem;
}
.entry-tags .tag {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.72rem;
  padding: 0.15rem 0.5rem;
  color: var(--muted);
}
.entry-summary {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
}
</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(REPO_NAME)}</h1>
<p>An automatically verified index of Claude Code and Agent Skills tooling.</p>
</header>
<div class="stats">
${stat(String(active.length), "Published")}
${stat(String(flagged.length), "Flagged and delisted")}
${stat(String(buried.length), "Permanently excluded")}
${stat(checked, "Last checked")}
</div>
<section class="claim">
<h2>How this stays honest</h2>
<p>Every entry is re-checked daily against the GitHub API. Anything archived, deleted, or gone
90 days without a push is flagged and delisted automatically, with no human in the loop. An
entry returns to the tables by itself the instant the condition clears. <span class="shrink">If
this list is shrinking, that is the system working, not failing.</span></p>
</section>
<section class="categories-section">
<h2>By category</h2>
<div class="categories">
${categories.join("\n")}
</div>
</section>
<section class="listing-section">
<h2>Browse all ${active.length} entries</h2>
<div class="filters" id="filters" hidden>
<div class="filters-row">
<input type="search" id="search-input" class="search-input" placeholder="Search id, tag or summary" aria-label="Search entries">
<button type="button" id="clear-filters" class="clear-filters" hidden>Clear filters</button>
</div>
<div class="tag-chips" id="tag-chips">
${chips}
</div>
<p class="result-count" id="result-count" aria-live="polite"></p>
</div>
${groups.join("\n")}
</section>
<section class="flagged-section">
<h2>Currently flagged</h2>
<p>Delisted from the tables on GitHub. These come back automatically if the repo does.</p>
${flaggedSection}
</section>
<section class="graveyard-section">
<h2>Permanently excluded</h2>
<p><code>blocked</code> entries leak or reproduce a proprietary source (a leaked system prompt,
for example) and are excluded on content grounds. <code>offtopic</code> entries are real,
legitimate software that simply is not Claude Code or Agent Skills tooling; being wrong for this
list is not a judgement on the project itself. Neither kind is reconsidered automatically.</p>
${graveyardSection}
</section>
<footer>
<p>Generated from <a href="${escapeHtml(REPO_URL)}/blob/main/skills.yaml">skills.yaml</a> in
<a href="${escapeHtml(REPO_URL)}">${escapeHtml(REPO_SLUG)}</a>. Do not edit this page directly.</p>
<p>Code MIT. Data CC0, except the <code>summary</code> field, which is quoted verbatim from each
repository's own description and remains the repository owner's — see
<a href="${escapeHtml(REPO_URL)}/blob/main/LICENSE-DATA">LICENSE-DATA</a>.</p>
</footer>
</main>
<script>${FILTER_SCRIPT}</script>
</body>
</html>
`
}
