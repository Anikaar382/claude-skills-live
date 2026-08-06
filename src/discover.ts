import type { GitHubClient, RepoMeta } from "./github"
import type { Entry } from "./schema"

export const MIN_STARS = 25

export const SEARCH_QUERIES = [
  "topic:claude-code",
  "topic:claude-skills",
  "topic:agent-skills",
  "topic:claude-code-plugin",
] as const

// Mirrors of leaked or proprietary source. Several market themselves as open source.
export const BLOCKED_ID_PATTERNS = [
  /claude-code-source/i,
  /source-code-of-claude/i,
  /system-prompts?-leak/i,
  /leaked-system-prompt/i,
] as const

export function isEligible(meta: RepoMeta, known: Set<string>): boolean {
  if (known.has(meta.id)) return false
  if (meta.archived) return false
  if (meta.stars < MIN_STARS) return false
  if (BLOCKED_ID_PATTERNS.some((re) => re.test(meta.id))) return false
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
