export interface RepoMeta {
  id: string
  stars: number
  pushed_at: string
  archived: boolean
  description: string | null
}

export interface GitHubClient {
  searchRepos(query: string, max: number): Promise<RepoMeta[]>
  getRepos(ids: string[]): Promise<Map<string, RepoMeta | null>>
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function buildBatchQuery(ids: string[]): string {
  const parts = ids.map((id, i) => {
    const [owner, name] = id.split("/")
    return `  r${i}: repository(owner: "${owner}", name: "${name}") { ...M }`
  })
  return [
    "query {",
    ...parts,
    "}",
    "fragment M on Repository {",
    "  nameWithOwner",
    "  stargazerCount",
    "  pushedAt",
    "  isArchived",
    "  description",
    "}",
  ].join("\n")
}

function toMeta(node: {
  nameWithOwner: string
  stargazerCount: number
  pushedAt: string
  isArchived: boolean
  description: string | null
}): RepoMeta {
  return {
    id: node.nameWithOwner,
    stars: node.stargazerCount,
    pushed_at: node.pushedAt.slice(0, 10),
    archived: node.isArchived,
    description: node.description,
  }
}

export class RealGitHubClient implements GitHubClient {
  constructor(private token: string) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "skills-live",
    }
  }

  async searchRepos(query: string, max: number): Promise<RepoMeta[]> {
    const out: RepoMeta[] = []
    for (let page = 1; out.length < max && page <= 10; page++) {
      const url =
        `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}` +
        `&sort=stars&order=desc&per_page=100&page=${page}`
      const res = await fetch(url, { headers: this.headers() })
      if (res.status === 403 || res.status === 429) {
        await Bun.sleep(2000 * page)
        page--
        continue
      }
      if (!res.ok) throw new Error(`search failed: ${res.status} ${await res.text()}`)
      const body = (await res.json()) as { items?: Array<Record<string, unknown>> }
      const items = body.items ?? []
      if (items.length === 0) break
      for (const it of items) {
        out.push({
          id: String(it.full_name),
          stars: Number(it.stargazers_count),
          pushed_at: String(it.pushed_at).slice(0, 10),
          archived: Boolean(it.archived),
          description: (it.description as string | null) ?? null,
        })
      }
    }
    return out.slice(0, max)
  }

  async getRepos(ids: string[]): Promise<Map<string, RepoMeta | null>> {
    const out = new Map<string, RepoMeta | null>()
    for (const group of chunk(ids, 100)) {
      const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ query: buildBatchQuery(group) }),
      })
      if (!res.ok) throw new Error(`graphql failed: ${res.status} ${await res.text()}`)
      const body = (await res.json()) as { data?: Record<string, unknown> }
      group.forEach((id, i) => {
        const node = body.data?.[`r${i}`]
        out.set(id, node ? toMeta(node as Parameters<typeof toMeta>[0]) : null)
      })
    }
    return out
  }
}

export class FakeGitHubClient implements GitHubClient {
  constructor(
    private repos: RepoMeta[],
    private gone: Set<string> = new Set(),
  ) {}

  async searchRepos(_query: string, max: number): Promise<RepoMeta[]> {
    return this.repos.slice(0, max)
  }

  async getRepos(ids: string[]): Promise<Map<string, RepoMeta | null>> {
    const out = new Map<string, RepoMeta | null>()
    for (const id of ids) {
      if (this.gone.has(id)) out.set(id, null)
      else out.set(id, this.repos.find((r) => r.id === id) ?? null)
    }
    return out
  }
}
