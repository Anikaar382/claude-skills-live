import type { Entry, Kind, SkillsFile } from "./schema"

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

function badgeTime(active: Entry[], now: Date): string {
  const latest = active.reduce<string | null>(
    (acc, e) => (acc === null || e.metrics.last_checked > acc ? e.metrics.last_checked : acc),
    null,
  )
  const stamp = latest ?? now.toISOString().replace(/\.\d+Z$/, "Z")
  return `${stamp.slice(0, 10)} ${stamp.slice(11, 16)} UTC`
}

function escapeMarkdownCell(text: string): string {
  // Escape pipe characters and collapse whitespace
  return text
    .replace(/\|/g, "\\|")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function row(e: Entry): string {
  const stars = e.metrics.stars.toLocaleString("en-US")
  const id = escapeMarkdownCell(e.id)
  const summary = escapeMarkdownCell(e.summary)
  return `| [${id}](${e.url}) | ${stars} | ${e.metrics.pushed_at} | ${summary} |`
}

export function renderReadme(data: SkillsFile, now: Date): string {
  const active = activeOf(data)
  const lines: string[] = [
    "# skills-live",
    "",
    "An automatically verified index of Claude Code and Agent Skills tooling.",
    "",
    `> ✅ **0 dead entries · ${active.length} verified · last checked ${badgeTime(active, now)}**`,
    "",
    "Every entry is re-checked daily. Anything archived, deleted, or untouched for 90 days is",
    "flagged and removed. See [`graveyard.yaml`](./graveyard.yaml) for what was pruned and why.",
    "",
    "`README.md` is generated from [`skills.yaml`](./skills.yaml). Do not edit it directly.",
    "",
  ]

  for (const kind of KIND_ORDER) {
    const group = active
      .filter((e) => e.kind === kind)
      .sort((a, b) => b.metrics.stars - a.metrics.stars || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    if (group.length === 0) continue
    lines.push(`## ${KIND_HEADING[kind]}`, "", "| Repo | Stars | Last push | What |", "|---|---|---|---|")
    for (const e of group) lines.push(row(e))
    lines.push("")
  }

  lines.push("---", "", "Code MIT. Data CC0.", "")
  return lines.join("\n")
}

export function renderJson(data: SkillsFile): string {
  const entries = activeOf(data).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return JSON.stringify({ version: 1, entries }, null, 2) + "\n"
}
