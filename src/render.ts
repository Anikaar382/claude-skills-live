import type { Entry, Flag, Kind, SkillsFile } from "./schema"

type FlaggedEntry = Entry & { flag: Flag }

// ⚠️ MUST BE UPDATED AT FIRST PUSH, and on any later rename or transfer.
//
// The whole point of the validate badge is that it goes RED on its own when
// the automation dies. If this slug does not match the repo's real
// owner/name, GitHub serves a 404 for the badge image and the README renders
// "no badge" instead — which reads as absence, not as failure, and silently
// removes the one watchdog a human reader can see without running anything.
//
// A constant rather than an env var on purpose: renderReadme's output is
// covered byte-for-byte by the reproducibility gate, so anything that could
// differ between a CI runner and a contributor's shell would turn a config
// difference into a confusing artifact-mismatch failure. One value, in source,
// reviewed like any other change.
export const REPO_SLUG = "pjdurden/claude-skills-live"

export const VALIDATE_BADGE_URL =
  `https://github.com/${REPO_SLUG}/actions/workflows/validate.yml/badge.svg`

// Derived, not hardcoded: a rename should move the title with the badge rather
// than leaving the page introducing itself by its old name.
export const REPO_NAME = REPO_SLUG.split("/")[1] ?? REPO_SLUG

export const KIND_ORDER = ["framework", "skill", "plugin", "mcp", "tool"] as const

export const KIND_HEADING: Record<Kind, string> = {
  framework: "Frameworks and meta-harnesses",
  skill: "Skills",
  plugin: "Plugins",
  mcp: "MCP servers",
  tool: "Tools",
}

function activeOf(data: SkillsFile): Entry[] {
  return data.entries.filter((e) => e.status === "active")
}

// Most recently flagged first, ties broken by id, so the output is a total
// order and therefore byte-stable under the reproducibility gate.
function flaggedOf(data: SkillsFile): FlaggedEntry[] {
  return data.entries
    .filter((e): e is FlaggedEntry => e.status === "flagged" && e.flag !== undefined)
    .sort(
      (a, b) =>
        (a.flag.since < b.flag.since ? 1 : a.flag.since > b.flag.since ? -1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
}

function badgeTime(active: Entry[], now: Date): string {
  const latest = active.reduce<string | null>(
    (acc, e) => (acc === null || e.metrics.last_checked > acc ? e.metrics.last_checked : acc),
    null,
  )
  const stamp = latest ?? now.toISOString().replace(/\.\d+Z$/, "Z")
  return `${stamp.slice(0, 10)} ${stamp.slice(11, 16)} UTC`
}

// `summary` is up to 120 characters of text authored by whoever owns the
// repository — anyone can create a 25-star repo with any description they
// like — and it is rendered into a page this project publishes. Escaping only
// `|` left `[x](http://evil)` rendering as a live link and
// `![](http://tracker/x.png)` as a remote image fetched by every reader, which
// makes the page a tracking beacon and a redirect surface on someone else's
// behalf. `<` and `>` are escaped because GitHub-flavoured Markdown passes
// raw HTML through, and a backtick would otherwise let a summary open a code
// span that swallows the rest of the row.
//
// Backslash is escaped first, in the same single pass, so the escape is
// injective: without it a summary containing `\` could combine with an
// inserted backslash to re-form the construct being escaped.
const CELL_ESCAPE = /[\\`|[\]<>]/g

function escapeMarkdownCell(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(CELL_ESCAPE, (c) => `\\${c}`)
}

function row(e: Entry): string {
  const stars = e.metrics.stars.toLocaleString("en-US")
  const id = escapeMarkdownCell(e.id)
  const summary = escapeMarkdownCell(e.summary)
  // Tags are sorted so the column is stable regardless of the order a curator
  // happened to write them in — the reproducibility gate compares bytes.
  const tags = [...e.tags].sort().map((t) => escapeMarkdownCell(t)).join(", ")
  return `| [${id}](${e.url}) | ${stars} | ${e.metrics.pushed_at} | ${tags} | ${summary} |`
}

export function renderReadme(data: SkillsFile, now: Date): string {
  const active = activeOf(data)
  const lines: string[] = [
    `# ${REPO_NAME}`,
    "",
    // Static markdown, so it goes red on its own with nothing running. The
    // generated badge below can only ever report what the last successful run
    // saw; this one reports that a run happened at all.
    `![validate](${VALIDATE_BADGE_URL})`,
    "",
    "An automatically verified index of Claude Code and Agent Skills tooling.",
    "",
    `> ✅ **0 dead entries · ${active.length} verified · last checked ${badgeTime(active, now)}**`,
    "",
    "Every entry is re-checked daily. Anything archived, deleted, or untouched for 90 days is",
    "flagged and delisted from the tables below, with the reason and the date it happened",
    "recorded under \"Recently flagged\" for as long as it stays flagged. An entry returns to",
    "the tables by itself once the condition clears. [`graveyard.yaml`](./graveyard.yaml) is",
    "separate: it holds entries permanently excluded from the index and never reconsidered.",
    "",
    "`README.md` is generated from [`skills.yaml`](./skills.yaml). Do not edit it directly.",
    "",
  ]

  for (const kind of KIND_ORDER) {
    const group = active
      .filter((e) => e.kind === kind)
      .sort((a, b) => b.metrics.stars - a.metrics.stars || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    if (group.length === 0) continue
    lines.push(
      `## ${KIND_HEADING[kind]}`,
      "",
      "| Repo | Stars | Last push | Tags | What |",
      "|---|---|---|---|---|",
    )
    for (const e of group) lines.push(row(e))
    lines.push("")
  }

  // Reaping is the product, so it needs public evidence. Without this section
  // a flagged entry simply disappears from the page with no trace a reader can
  // see, and the claim that anything is being checked is unfalsifiable.
  const flagged = flaggedOf(data)
  if (flagged.length > 0) {
    lines.push(
      "## Recently flagged",
      "",
      "Delisted from the tables above. These come back automatically if the repo does.",
      "",
      "| Repo | Reason | Flagged since |",
      "|---|---|---|",
    )
    for (const e of flagged) {
      lines.push(
        `| [${escapeMarkdownCell(e.id)}](${e.url}) | ${e.flag.reason} | ${e.flag.since} |`,
      )
    }
    lines.push("")
  }

  lines.push("---", "", "Code MIT. Data CC0.", "")
  return lines.join("\n")
}

export function renderJson(data: SkillsFile): string {
  const entries = activeOf(data).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return JSON.stringify({ version: 1, entries }, null, 2) + "\n"
}
