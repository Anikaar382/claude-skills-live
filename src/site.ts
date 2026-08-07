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
import type { GraveyardEntry, GraveyardFile, SkillsFile } from "./schema"

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

// Mirrors GitHub's own heading-to-anchor algorithm (lowercase, drop anything
// that isn't a word character, hyphen or space, then turn spaces into
// hyphens) so the category cards link straight to the matching README
// section instead of just the repo root.
function githubAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\w\- ]+/g, "")
    .replace(/ +/g, "-")
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

export function renderSite(data: SkillsFile, graveyard: GraveyardFile, now: Date): string {
  const active = activeOf(data)
  const flagged = flaggedOf(data)
  const buried = sortedGraveyard(graveyard)
  const checked = badgeTime(active, now)

  const categories = KIND_ORDER.map((kind) => {
    const count = active.filter((e) => e.kind === kind).length
    if (count === 0) return null
    const heading = KIND_HEADING[kind]
    const href = `${REPO_URL}#${githubAnchor(heading)}`
    return (
      `<a class="category" href="${escapeHtml(href)}">` +
      `<div class="category-count">${count}</div>` +
      `<div class="category-name">${escapeHtml(heading)}</div></a>`
    )
  }).filter((c): c is string => c !== null)

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
</body>
</html>
`
}
