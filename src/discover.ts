import type { GitHubClient, RepoMeta } from "./github"
import type { Entry } from "./schema"

export const MIN_STARS = 25

export const SEARCH_QUERIES = [
  "topic:claude-code",
  "topic:claude-skills",
  "topic:agent-skills",
  "topic:claude-code-plugin",
] as const

// Lowercase and strip every non-alphanumeric character (hyphen, underscore, dot,
// whitespace, slash, ...) so "system-prompts_leaks", "system_prompts-leaks" and
// "systempromptsleaks" all collapse to the same comparable form before matching.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

// Mirrors of leaked or proprietary source. Several market themselves as open source.
//
// Tested (via isEligible) against the normalized form of both the repo id and its
// description, so a mirror can't dodge the filter just by using an innocuous repo
// name and putting the giveaway language in the description instead.
//
// Each pattern anchors on a Claude-specific token ("claude") paired with a second,
// leak- or source-diagnostic token, rather than a bare topical word like "prompt"
// or "source" on its own. A generic prompt-engineering tool ("write and test system
// prompts for your agents") or a legitimate open-source Claude Code alternative
// will mention "system prompt" or "source" without also bundling in the specific
// "claude ... system prompt" / "claude code source" phrasing that only shows up in
// an actual extraction or mirror of Claude's own material — that's what keeps this
// list from also catching those legitimate tools.
export const BLOCKED_ID_PATTERNS = [
  // "system prompt(s) leak(ed)" in either order, any separator or none at all —
  // covers openly-named leak dumps (e.g. system_prompts_leaks) without even
  // needing "claude" in the string, since "leak" next to "system prompt" is
  // already a strong, non-topical signal on its own.
  /systemprompt.*leak|leak.*systemprompt/,
  // Keyword-only mirrors that describe themselves as Claude's system prompt(s)
  // but never use the word "leak" (e.g. claude-code-system-prompts).
  /claude.*systemprompt|systemprompt.*claude/,
  // Mirrors of Claude('s/ Code's) proprietary source, e.g. "claude-code-source",
  // "claude-code-source-code", "source-code-of-claude".
  /claudecodesource|sourcecodeofclaude/,
] as const

export function isEligible(meta: RepoMeta, known: Set<string>): boolean {
  if (known.has(meta.id)) return false
  if (meta.archived) return false
  if (meta.stars < MIN_STARS) return false
  const normalizedId = normalize(meta.id)
  const normalizedDescription = normalize(meta.description ?? "")
  if (
    BLOCKED_ID_PATTERNS.some((re) => re.test(normalizedId) || re.test(normalizedDescription))
  ) {
    return false
  }
  return true
}

export function toEntry(meta: RepoMeta, today: string): Entry {
  const name = meta.id.split("/")[1] ?? meta.id
  const raw = (meta.description ?? "").trim()
  const summary = raw === "" ? "No description provided upstream." : raw.slice(0, 120)
  return {
    id: meta.id,
    kind: "skill",
    name,
    url: `https://github.com/${meta.id}`,
    summary,
    tags: [],
    added: today,
    source: "discovery",
    status: "active",
    metrics: {
      stars: meta.stars,
      pushed_at: meta.pushed_at,
      archived: meta.archived,
      last_checked: `${today}T00:00:00Z`,
    },
  }
}

export async function discover(
  gh: GitHubClient,
  known: Set<string>,
  today: string,
  perQuery = 100,
): Promise<Entry[]> {
  const seen = new Set(known)
  const out: Entry[] = []
  for (const query of SEARCH_QUERIES) {
    for (const meta of await gh.searchRepos(query, perQuery)) {
      if (!isEligible(meta, seen)) continue
      seen.add(meta.id)
      out.push(toEntry(meta, today))
    }
  }
  return out
}
