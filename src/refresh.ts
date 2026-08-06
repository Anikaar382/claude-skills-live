import type { GitHubClient } from "./github"
import type { Entry } from "./schema"

export async function refresh(
  gh: GitHubClient,
  entries: Entry[],
  now: Date,
): Promise<{ entries: Entry[]; missing: string[] }> {
  if (entries.length === 0) return { entries: [], missing: [] }

  const stamp = now.toISOString().replace(/\.\d+Z$/, "Z")
  const found = await gh.getRepos(entries.map((e) => e.id))
  const missing: string[] = []

  const updated = entries.map((e) => {
    const meta = found.get(e.id) ?? null
    if (meta === null) {
      missing.push(e.id)
      return e
    }
    return {
      ...e,
      metrics: {
        stars: meta.stars,
        pushed_at: meta.pushed_at,
        archived: meta.archived,
        last_checked: stamp,
      },
    }
  })

  return { entries: updated, missing }
}
