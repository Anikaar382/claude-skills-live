# skills-live M1 + M2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-maintaining index of Claude Code / Agent Skills tooling whose headline claim — every listed entry was verified alive within the last 24 hours — is enforced by CI rather than asserted.

**Architecture:** `skills.yaml` is the single source of truth. Pure functions transform it; `README.md` and `data/skills.json` are generated artifacts that CI proves are reproducible from the datafile. All GitHub access goes through one `GitHubClient` interface so every test runs offline against a fake. GitHub Actions workflows invoke a single CLI with subcommands and open PRs; they never push to `main`.

**Tech Stack:** TypeScript on Bun 1.3.14, `zod` for schema, `yaml` for serialisation, `bun test` for tests, GitHub REST search + GraphQL batch for data, GitHub Actions for scheduling.

## Global Constraints

- Runtime is Bun 1.3.14 (already installed). Do not add Node-only APIs or a bundler.
- Dependencies are limited to `zod` and `yaml`. No test framework — `bun test` is built in.
- `README.md` and `data/skills.json` are **generated**. Never hand-edit them. CI rejects a PR whose README is not byte-identical to `render()` output.
- `skills.yaml` entries are always sorted by `id` ascending on save, so diffs stay reviewable.
- `summary` is capped at **120 characters**.
- Inclusion bar: ≥25 stars, not archived, has `SKILL.md` / `.claude-plugin/plugin.json` / is a documented harness tool, not an undiverged fork, **not a mirror of leaked or proprietary source**.
- Stale threshold is **90 days** since `pushed_at`. CI staleness gate is **48 hours** since `last_checked`.
- Code is MIT; `skills.yaml` and `data/skills.json` are CC0.
- Never copy prose or categorisation from another awesome-list. Seed summaries from the upstream repo's own description only.
- Commits are signed. This repo is already configured with `user.signingkey=~/.claude/oss-scan/sign_key.pub`; do not use the hardware key, it blocks on a physical touch.
- All GitHub calls in tests go through `FakeGitHubClient`. No network access in `bun test`.

## File Structure

| File | Responsibility |
|---|---|
| `src/schema.ts` | zod schemas + inferred types for `Entry`, `SkillsFile`, `GraveyardFile` |
| `src/store.ts` | Load/save YAML, deterministic sorting |
| `src/github.ts` | `GitHubClient` interface, real REST+GraphQL impl, `FakeGitHubClient` |
| `src/render.ts` | `skills.yaml` → README markdown + JSON export |
| `src/discover.ts` | Candidate search + inclusion bar |
| `src/refresh.ts` | Batch metrics update |
| `src/reap.ts` | Flag stale / archived / gone entries |
| `src/validate.ts` | Schema, reproducibility and staleness gates |
| `src/cli.ts` | Subcommand dispatch |

Split by responsibility. `reap` is a separate module from `refresh` even though one workflow runs both, because their rules are tested independently.

---

### Task 1: Project scaffold and schema

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `LICENSE`, `LICENSE-DATA`
- Create: `src/schema.ts`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Entry`, `SkillsFile`, `GraveyardFile`, `Kind`, `FlagReason` types and the matching zod schemas `EntrySchema`, `SkillsFileSchema`, `GraveyardFileSchema`

- [ ] **Step 1: Create the scaffold files**

`package.json`:

```json
{
  "name": "skills-live",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "discover": "bun run src/cli.ts discover",
    "refresh": "bun run src/cli.ts refresh",
    "render": "bun run src/cli.ts render",
    "validate": "bun run src/cli.ts validate",
    "test": "bun test"
  },
  "dependencies": {
    "yaml": "^2.6.0",
    "zod": "^3.23.8"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["src", "tests"]
}
```

`.gitignore`:

```
node_modules/
*.log
.env
```

`LICENSE`: the standard MIT text, copyright `2026 pjdurden`.

`LICENSE-DATA`: the standard CC0 1.0 Universal text, applying to `skills.yaml`, `graveyard.yaml` and `data/skills.json`.

- [ ] **Step 2: Install dependencies**

Run: `bun install`
Expected: `node_modules/` created, `bun.lock` written, exit 0.

- [ ] **Step 3: Write the failing test**

`tests/schema.test.ts`:

```ts
import { test, expect } from "bun:test"
import { EntrySchema, SkillsFileSchema } from "../src/schema"

const validEntry = {
  id: "obra/superpowers",
  kind: "framework",
  name: "Superpowers",
  url: "https://github.com/obra/superpowers",
  summary: "Agentic skills framework and spec-driven development methodology.",
  tags: ["skills", "methodology"],
  added: "2026-08-06",
  source: "discovery",
  status: "active",
  metrics: {
    stars: 268003,
    pushed_at: "2026-08-06",
    archived: false,
    last_checked: "2026-08-06T04:00:00Z",
  },
}

test("accepts a valid active entry", () => {
  expect(EntrySchema.parse(validEntry).id).toBe("obra/superpowers")
})

test("rejects a summary over 120 characters", () => {
  const bad = { ...validEntry, summary: "x".repeat(121) }
  expect(() => EntrySchema.parse(bad)).toThrow()
})

test("rejects an id that is not owner/repo", () => {
  const bad = { ...validEntry, id: "superpowers" }
  expect(() => EntrySchema.parse(bad)).toThrow()
})

test("requires a flag when status is not active", () => {
  const bad = { ...validEntry, status: "flagged" }
  expect(() => EntrySchema.parse(bad)).toThrow(/flag is required/)
})

test("accepts a flagged entry that carries a flag", () => {
  const ok = {
    ...validEntry,
    status: "flagged",
    flag: { reason: "stale", since: "2026-08-06", issue: null, grace_until: null },
  }
  expect(EntrySchema.parse(ok).flag?.reason).toBe("stale")
})

test("defaults tags to an empty array", () => {
  const { tags, ...noTags } = validEntry
  expect(EntrySchema.parse(noTags).tags).toEqual([])
})

test("parses a whole skills file", () => {
  const file = { version: 1, entries: [validEntry] }
  expect(SkillsFileSchema.parse(file).entries.length).toBe(1)
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `bun test tests/schema.test.ts`
Expected: FAIL — cannot resolve `../src/schema`.

- [ ] **Step 5: Write the implementation**

`src/schema.ts`:

```ts
import { z } from "zod"

export const KindSchema = z.enum(["framework", "skill", "plugin", "mcp", "tool"])
export const FlagReasonSchema = z.enum(["stale", "archived", "gone", "dispute"])
export const StatusSchema = z.enum(["active", "flagged", "removed"])
export const SourceSchema = z.enum(["discovery", "pr", "manual"])

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

export const MetricsSchema = z.object({
  stars: z.number().int().nonnegative(),
  pushed_at: z.string().regex(DATE),
  archived: z.boolean(),
  last_checked: z.string().regex(DATETIME),
})

export const FlagSchema = z.object({
  reason: FlagReasonSchema,
  since: z.string().regex(DATE),
  issue: z.number().int().positive().nullable(),
  grace_until: z.string().regex(DATE).nullable(),
})

export const EntrySchema = z
  .object({
    id: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
    kind: KindSchema,
    name: z.string().min(1),
    url: z.string().url(),
    summary: z.string().min(1).max(120),
    tags: z.array(z.string()).default([]),
    added: z.string().regex(DATE),
    source: SourceSchema,
    status: StatusSchema,
    metrics: MetricsSchema,
    flag: FlagSchema.optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.status !== "active" && !entry.flag) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "flag is required when status is not active",
        path: ["flag"],
      })
    }
  })

export const SkillsFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(EntrySchema),
})

export const GraveyardEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  reason: FlagReasonSchema,
  removed: z.string().regex(DATE),
})

export const GraveyardFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(GraveyardEntrySchema),
})

export type Kind = z.infer<typeof KindSchema>
export type FlagReason = z.infer<typeof FlagReasonSchema>
export type Metrics = z.infer<typeof MetricsSchema>
export type Flag = z.infer<typeof FlagSchema>
export type Entry = z.infer<typeof EntrySchema>
export type SkillsFile = z.infer<typeof SkillsFileSchema>
export type GraveyardEntry = z.infer<typeof GraveyardEntrySchema>
export type GraveyardFile = z.infer<typeof GraveyardFileSchema>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test tests/schema.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .gitignore LICENSE LICENSE-DATA bun.lock src/schema.ts tests/schema.test.ts
git commit -m "feat: project scaffold and skills.yaml schema"
```

---

### Task 2: Store — deterministic YAML load and save

**Files:**
- Create: `src/store.ts`
- Create: `skills.yaml`, `graveyard.yaml`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: `SkillsFileSchema`, `GraveyardFileSchema`, `SkillsFile`, `GraveyardFile`, `Entry` from `src/schema.ts`
- Produces:
  - `loadSkills(path: string): SkillsFile`
  - `saveSkills(path: string, data: SkillsFile): void`
  - `loadGraveyard(path: string): GraveyardFile`
  - `saveGraveyard(path: string, data: GraveyardFile): void`
  - `sortEntries(entries: Entry[]): Entry[]`

- [ ] **Step 1: Write the failing test**

`tests/store.test.ts`:

```ts
import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadSkills, saveSkills, sortEntries } from "../src/store"
import type { Entry, SkillsFile } from "../src/schema"

function entry(id: string, stars = 10): Entry {
  const [, name] = id.split("/")
  return {
    id,
    kind: "skill",
    name: name!,
    url: `https://github.com/${id}`,
    summary: "A test entry.",
    tags: [],
    added: "2026-08-06",
    source: "discovery",
    status: "active",
    metrics: { stars, pushed_at: "2026-08-01", archived: false, last_checked: "2026-08-06T04:00:00Z" },
  }
}

test("sortEntries orders by id ascending", () => {
  const sorted = sortEntries([entry("z/z"), entry("a/a"), entry("m/m")])
  expect(sorted.map((e) => e.id)).toEqual(["a/a", "m/m", "z/z"])
})

test("save then load round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-"))
  const path = join(dir, "skills.yaml")
  const data: SkillsFile = { version: 1, entries: [entry("b/b"), entry("a/a")] }
  saveSkills(path, data)
  expect(loadSkills(path).entries.map((e) => e.id)).toEqual(["a/a", "b/b"])
})

test("save writes entries sorted regardless of input order", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-"))
  const path = join(dir, "skills.yaml")
  saveSkills(path, { version: 1, entries: [entry("z/z"), entry("a/a")] })
  const text = readFileSync(path, "utf8")
  expect(text.indexOf("a/a")).toBeLessThan(text.indexOf("z/z"))
})

test("save output is byte-stable across two writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-"))
  const p1 = join(dir, "one.yaml")
  const p2 = join(dir, "two.yaml")
  const data: SkillsFile = { version: 1, entries: [entry("a/a"), entry("b/b")] }
  saveSkills(p1, data)
  saveSkills(p2, loadSkills(p1))
  expect(readFileSync(p1, "utf8")).toBe(readFileSync(p2, "utf8"))
})

test("load rejects a file that violates the schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-"))
  const path = join(dir, "bad.yaml")
  Bun.write(path, "version: 1\nentries:\n  - id: nope\n")
  expect(() => loadSkills(path)).toThrow()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/store.test.ts`
Expected: FAIL — cannot resolve `../src/store`.

- [ ] **Step 3: Write the implementation**

`src/store.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs"
import { parse, stringify } from "yaml"
import {
  GraveyardFileSchema,
  SkillsFileSchema,
  type Entry,
  type GraveyardFile,
  type SkillsFile,
} from "./schema"

const YAML_OPTS = { lineWidth: 0, sortMapEntries: false } as const

export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function loadSkills(path: string): SkillsFile {
  return SkillsFileSchema.parse(parse(readFileSync(path, "utf8")))
}

export function saveSkills(path: string, data: SkillsFile): void {
  const normalised: SkillsFile = { version: 1, entries: sortEntries(data.entries) }
  writeFileSync(path, stringify(SkillsFileSchema.parse(normalised), YAML_OPTS))
}

export function loadGraveyard(path: string): GraveyardFile {
  return GraveyardFileSchema.parse(parse(readFileSync(path, "utf8")))
}

export function saveGraveyard(path: string, data: GraveyardFile): void {
  const entries = [...data.entries].sort((a, b) => (a.id < b.id ? -1 : 1))
  writeFileSync(path, stringify(GraveyardFileSchema.parse({ version: 1, entries }), YAML_OPTS))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/store.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Create the empty datafiles**

`skills.yaml`:

```yaml
version: 1
entries: []
```

`graveyard.yaml`:

```yaml
version: 1
entries: []
```

- [ ] **Step 6: Commit**

```bash
git add src/store.ts tests/store.test.ts skills.yaml graveyard.yaml
git commit -m "feat: deterministic YAML store for skills and graveyard"
```

---

### Task 3: GitHub client interface, real implementation, and fake

**Files:**
- Create: `src/github.ts`
- Test: `tests/github.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `interface RepoMeta { id: string; stars: number; pushed_at: string; archived: boolean; description: string | null }`
  - `interface GitHubClient { searchRepos(query: string, max: number): Promise<RepoMeta[]>; getRepos(ids: string[]): Promise<Map<string, RepoMeta | null>> }`
  - `class RealGitHubClient implements GitHubClient` (constructor takes a token string)
  - `class FakeGitHubClient implements GitHubClient` (constructor takes `RepoMeta[]` and an optional `Set<string>` of ids treated as gone)
  - `chunk<T>(items: T[], size: number): T[][]`
  - `buildBatchQuery(ids: string[]): string`

`getRepos` maps an id to `null` when the repo is gone (404). Every later task depends on that convention.

- [ ] **Step 1: Write the failing test**

`tests/github.test.ts`:

```ts
import { test, expect } from "bun:test"
import { FakeGitHubClient, buildBatchQuery, chunk, type RepoMeta } from "../src/github"

function meta(id: string, stars = 100): RepoMeta {
  return { id, stars, pushed_at: "2026-08-01", archived: false, description: "d" }
}

test("chunk splits into fixed-size groups", () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
})

test("chunk returns empty array for empty input", () => {
  expect(chunk([], 100)).toEqual([])
})

test("buildBatchQuery emits one alias per id with owner and name split", () => {
  const q = buildBatchQuery(["a/b", "c/d"])
  expect(q).toContain('r0: repository(owner: "a", name: "b")')
  expect(q).toContain('r1: repository(owner: "c", name: "d")')
  expect(q).toContain("fragment M on Repository")
})

test("fake getRepos returns metadata for known ids", async () => {
  const gh = new FakeGitHubClient([meta("a/b", 42)])
  const got = await gh.getRepos(["a/b"])
  expect(got.get("a/b")?.stars).toBe(42)
})

test("fake getRepos returns null for gone ids", async () => {
  const gh = new FakeGitHubClient([meta("a/b")], new Set(["x/y"]))
  const got = await gh.getRepos(["a/b", "x/y"])
  expect(got.get("x/y")).toBeNull()
})

test("fake searchRepos respects the max argument", async () => {
  const gh = new FakeGitHubClient([meta("a/b"), meta("c/d"), meta("e/f")])
  expect((await gh.searchRepos("anything", 2)).length).toBe(2)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/github.test.ts`
Expected: FAIL — cannot resolve `../src/github`.

- [ ] **Step 3: Write the implementation**

`src/github.ts`:

```ts
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
```

A partial GraphQL response returns `data.rN = null` alongside an `errors` array for repos that no longer exist. Treating a null node as gone is exactly what we want, so the errors array is deliberately ignored.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/github.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/github.ts tests/github.test.ts
git commit -m "feat: GitHub client interface with GraphQL batching and test fake"
```

---

### Task 4: Renderer — README and JSON from skills.yaml

**Files:**
- Create: `src/render.ts`
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: `Entry`, `SkillsFile` from `src/schema.ts`
- Produces:
  - `renderReadme(data: SkillsFile, now: Date): string`
  - `renderJson(data: SkillsFile): string`
  - `KIND_ORDER: readonly Kind[]`
  - `KIND_HEADING: Record<Kind, string>`

Only `status: "active"` entries appear in either artifact.

- [ ] **Step 1: Write the failing test**

`tests/render.test.ts`:

```ts
import { test, expect } from "bun:test"
import { renderJson, renderReadme } from "../src/render"
import type { Entry, SkillsFile } from "../src/schema"

function entry(id: string, stars: number, over: Partial<Entry> = {}): Entry {
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
    metrics: { stars, pushed_at: "2026-08-01", archived: false, last_checked: "2026-08-06T04:00:00Z" },
    ...over,
  }
}

const NOW = new Date("2026-08-06T05:00:00Z")

test("badge reports the count of active entries and the check time", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/a", 5), entry("b/b", 9)] }
  const md = renderReadme(data, NOW)
  expect(md).toContain("0 dead entries")
  expect(md).toContain("2 verified")
  expect(md).toContain("2026-08-06 04:00 UTC")
})

test("entries are ordered by stars descending within a kind", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/low", 5), entry("b/high", 900)] }
  const md = renderReadme(data, NOW)
  expect(md.indexOf("b/high")).toBeLessThan(md.indexOf("a/low"))
})

test("flagged entries are excluded from the README", () => {
  const flagged = entry("x/gone", 999, {
    status: "flagged",
    flag: { reason: "stale", since: "2026-08-06", issue: 1, grace_until: null },
  })
  const md = renderReadme({ version: 1, entries: [entry("a/a", 1), flagged] }, NOW)
  expect(md).not.toContain("x/gone")
  expect(md).toContain("1 verified")
})

test("kind headings appear only when that kind has entries", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/a", 1, { kind: "mcp" })] }
  const md = renderReadme(data, NOW)
  expect(md).toContain("MCP servers")
  expect(md).not.toContain("Frameworks")
})

test("render is deterministic for the same input", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/a", 1), entry("b/b", 2)] }
  expect(renderReadme(data, NOW)).toBe(renderReadme(data, NOW))
})

test("json export contains only active entries and is stable", () => {
  const flagged = entry("x/x", 1, {
    status: "flagged",
    flag: { reason: "gone", since: "2026-08-06", issue: null, grace_until: null },
  })
  const json = JSON.parse(renderJson({ version: 1, entries: [entry("a/a", 1), flagged] }))
  expect(json.entries.map((e: Entry) => e.id)).toEqual(["a/a"])
})

test("uses the most recent last_checked across active entries for the badge", () => {
  const older = entry("a/a", 1)
  const newer = entry("b/b", 2, {
    metrics: { stars: 2, pushed_at: "2026-08-01", archived: false, last_checked: "2026-08-06T09:30:00Z" },
  })
  expect(renderReadme({ version: 1, entries: [older, newer] }, NOW)).toContain("2026-08-06 09:30 UTC")
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/render.test.ts`
Expected: FAIL — cannot resolve `../src/render`.

- [ ] **Step 3: Write the implementation**

`src/render.ts`:

```ts
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

function row(e: Entry): string {
  const stars = e.metrics.stars.toLocaleString("en-US")
  return `| [${e.id}](${e.url}) | ${stars} | ${e.metrics.pushed_at} | ${e.summary} |`
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
      .sort((a, b) => b.metrics.stars - a.metrics.stars || (a.id < b.id ? -1 : 1))
    if (group.length === 0) continue
    lines.push(`## ${KIND_HEADING[kind]}`, "", "| Repo | Stars | Last push | What |", "|---|---|---|---|")
    for (const e of group) lines.push(row(e))
    lines.push("")
  }

  lines.push("---", "", "Code MIT. Data CC0.", "")
  return lines.join("\n")
}

export function renderJson(data: SkillsFile): string {
  const entries = activeOf(data).sort((a, b) => (a.id < b.id ? -1 : 1))
  return JSON.stringify({ version: 1, entries }, null, 2) + "\n"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/render.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts tests/render.test.ts
git commit -m "feat: deterministic README and JSON renderer"
```

---

### Task 5: Discovery and the inclusion bar

**Files:**
- Create: `src/discover.ts`
- Test: `tests/discover.test.ts`

**Interfaces:**
- Consumes: `GitHubClient`, `RepoMeta` from `src/github.ts`; `Entry`, `Kind` from `src/schema.ts`
- Produces:
  - `SEARCH_QUERIES: readonly string[]`
  - `MIN_STARS: 25`
  - `BLOCKED_ID_PATTERNS: readonly RegExp[]`
  - `isEligible(meta: RepoMeta, known: Set<string>): boolean`
  - `toEntry(meta: RepoMeta, today: string): Entry`
  - `discover(gh: GitHubClient, known: Set<string>, today: string, perQuery?: number): Promise<Entry[]>`

`known` must contain ids from both `skills.yaml` (any status) and `graveyard.yaml`, so removed entries do not get rediscovered.

- [ ] **Step 1: Write the failing test**

`tests/discover.test.ts`:

```ts
import { test, expect } from "bun:test"
import { FakeGitHubClient, type RepoMeta } from "../src/github"
import { discover, isEligible, toEntry } from "../src/discover"

function meta(id: string, over: Partial<RepoMeta> = {}): RepoMeta {
  return { id, stars: 100, pushed_at: "2026-08-01", archived: false, description: "A thing.", ...over }
}

test("rejects repos under the star bar", () => {
  expect(isEligible(meta("a/b", { stars: 24 }), new Set())).toBe(false)
  expect(isEligible(meta("a/b", { stars: 25 }), new Set())).toBe(true)
})

test("rejects archived repos", () => {
  expect(isEligible(meta("a/b", { archived: true }), new Set())).toBe(false)
})

test("rejects ids already known", () => {
  expect(isEligible(meta("a/b"), new Set(["a/b"]))).toBe(false)
})

test("rejects mirrors of leaked proprietary source", () => {
  expect(isEligible(meta("someone/claude-code-source-code"), new Set())).toBe(false)
  expect(isEligible(meta("someone/system-prompts-leaks"), new Set())).toBe(false)
})

test("toEntry truncates a long description to 120 characters", () => {
  const e = toEntry(meta("a/b", { description: "x".repeat(400) }), "2026-08-06")
  expect(e.summary.length).toBeLessThanOrEqual(120)
})

test("toEntry falls back when description is null", () => {
  expect(toEntry(meta("a/b", { description: null }), "2026-08-06").summary).toBe(
    "No description provided upstream.",
  )
})

test("toEntry marks the entry as active discovery with today's date", () => {
  const e = toEntry(meta("a/b"), "2026-08-06")
  expect(e.status).toBe("active")
  expect(e.source).toBe("discovery")
  expect(e.added).toBe("2026-08-06")
  expect(e.metrics.stars).toBe(100)
})

test("discover deduplicates across queries", async () => {
  const gh = new FakeGitHubClient([meta("a/b"), meta("c/d")])
  const found = await discover(gh, new Set(), "2026-08-06", 10)
  expect(found.map((e) => e.id).sort()).toEqual(["a/b", "c/d"])
})

test("discover excludes ids already known", async () => {
  const gh = new FakeGitHubClient([meta("a/b"), meta("c/d")])
  const found = await discover(gh, new Set(["a/b"]), "2026-08-06", 10)
  expect(found.map((e) => e.id)).toEqual(["c/d"])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/discover.test.ts`
Expected: FAIL — cannot resolve `../src/discover`.

- [ ] **Step 3: Write the implementation**

`src/discover.ts`:

```ts
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
```

Every discovered entry lands as `kind: "skill"` with empty `tags`. Reclassification happens in human review of the discovery PR — that is what the review gate is for, and guessing `kind` from a description would be wrong more often than right.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/discover.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/discover.ts tests/discover.test.ts
git commit -m "feat: discovery pass with inclusion bar"
```

---

### Task 6: CLI and the first real seed run — M1 complete

**Files:**
- Create: `src/cli.ts`
- Modify: `skills.yaml` (seeded with real data), `README.md`, `data/skills.json` (generated)

**Interfaces:**
- Consumes: everything from Tasks 1-5
- Produces: `bun run src/cli.ts <discover|render>` and the exported `main(argv: string[]): Promise<number>`

`refresh` and `validate` subcommands are added in Tasks 7-9; this task wires only `discover` and `render`.

- [ ] **Step 1: Write the implementation**

`src/cli.ts`:

```ts
import { writeFileSync } from "node:fs"
import { discover } from "./discover"
import { RealGitHubClient } from "./github"
import { renderJson, renderReadme } from "./render"
import { loadGraveyard, loadSkills, saveSkills } from "./store"

const SKILLS = "skills.yaml"
const GRAVEYARD = "graveyard.yaml"

function token(): string {
  const t = process.env.GITHUB_TOKEN
  if (!t) throw new Error("GITHUB_TOKEN is not set")
  return t
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function knownIds(): Set<string> {
  const ids = new Set<string>()
  for (const e of loadSkills(SKILLS).entries) ids.add(e.id)
  for (const e of loadGraveyard(GRAVEYARD).entries) ids.add(e.id)
  return ids
}

function writeArtifacts(): void {
  const data = loadSkills(SKILLS)
  writeFileSync("README.md", renderReadme(data, new Date()))
  writeFileSync("data/skills.json", renderJson(data))
}

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0]
  if (cmd === "discover") {
    const found = await discover(new RealGitHubClient(token()), knownIds(), today())
    const data = loadSkills(SKILLS)
    data.entries.push(...found)
    saveSkills(SKILLS, data)
    writeArtifacts()
    console.log(`discovered ${found.length} new entries`)
    return 0
  }
  if (cmd === "render") {
    writeArtifacts()
    console.log("rendered README.md and data/skills.json")
    return 0
  }
  console.error(`unknown command: ${cmd ?? "(none)"}`)
  return 1
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
```

- [ ] **Step 2: Create the data directory and run discovery for real**

```bash
mkdir -p data
GITHUB_TOKEN=$(gh auth token) bun run src/cli.ts discover
```

Expected: prints a discovered count in the low hundreds; `skills.yaml` gains entries; `README.md` and `data/skills.json` appear.

- [ ] **Step 3: Verify the artifacts are sane**

```bash
bun run src/cli.ts render && git diff --stat
```

Expected: no diff on the second render — the output is already deterministic. If `git diff` shows changes, the renderer is not stable and must be fixed before continuing.

- [ ] **Step 4: Human curation pass**

Open `skills.yaml` and, for every entry: set the correct `kind` (discovery lands everything as `skill`), add `tags`, and rewrite any `summary` that reads as marketing copy. Delete anything that does not belong. This is the one manual step in the whole system and it happens exactly once, at seeding.

Then re-render:

```bash
bun run src/cli.ts render
```

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: PASS, all tests from Tasks 1-5.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts skills.yaml README.md data/skills.json
git commit -m "feat: CLI with discover and render, seed initial index

M1 complete."
```

---

### Task 7: Refresh — batch metrics update

**Files:**
- Create: `src/refresh.ts`
- Modify: `src/cli.ts`
- Test: `tests/refresh.test.ts`

**Interfaces:**
- Consumes: `GitHubClient`, `RepoMeta` from `src/github.ts`; `Entry` from `src/schema.ts`
- Produces: `refresh(gh: GitHubClient, entries: Entry[], now: Date): Promise<{ entries: Entry[]; missing: string[] }>`

`missing` lists ids whose lookup returned `null`. Task 8 consumes it. Entries whose lookup failed keep their old metrics and their old `last_checked`, so the staleness gate catches a silently broken refresh.

- [ ] **Step 1: Write the failing test**

`tests/refresh.test.ts`:

```ts
import { test, expect } from "bun:test"
import { FakeGitHubClient, type RepoMeta } from "../src/github"
import { refresh } from "../src/refresh"
import type { Entry } from "../src/schema"

function meta(id: string, over: Partial<RepoMeta> = {}): RepoMeta {
  return { id, stars: 500, pushed_at: "2026-08-05", archived: false, description: "d", ...over }
}

function entry(id: string, over: Partial<Entry> = {}): Entry {
  return {
    id,
    kind: "skill",
    name: id.split("/")[1]!,
    url: `https://github.com/${id}`,
    summary: "s",
    tags: [],
    added: "2026-01-01",
    source: "discovery",
    status: "active",
    metrics: { stars: 1, pushed_at: "2026-01-01", archived: false, last_checked: "2026-01-01T00:00:00Z" },
    ...over,
  }
}

const NOW = new Date("2026-08-06T04:00:00Z")

test("updates stars, pushed_at, archived and last_checked", async () => {
  const gh = new FakeGitHubClient([meta("a/b")])
  const { entries } = await refresh(gh, [entry("a/b")], NOW)
  expect(entries[0]!.metrics).toEqual({
    stars: 500,
    pushed_at: "2026-08-05",
    archived: false,
    last_checked: "2026-08-06T04:00:00Z",
  })
})

test("preserves curated fields", async () => {
  const gh = new FakeGitHubClient([meta("a/b", { description: "upstream changed this" })])
  const { entries } = await refresh(gh, [entry("a/b", { summary: "ours", kind: "mcp", tags: ["x"] })], NOW)
  expect(entries[0]!.summary).toBe("ours")
  expect(entries[0]!.kind).toBe("mcp")
  expect(entries[0]!.tags).toEqual(["x"])
})

test("reports missing ids and leaves their metrics untouched", async () => {
  const gh = new FakeGitHubClient([], new Set(["x/y"]))
  const { entries, missing } = await refresh(gh, [entry("x/y")], NOW)
  expect(missing).toEqual(["x/y"])
  expect(entries[0]!.metrics.last_checked).toBe("2026-01-01T00:00:00Z")
})

test("refreshes flagged entries too so a revived repo can be seen", async () => {
  const flagged = entry("a/b", {
    status: "flagged",
    flag: { reason: "stale", since: "2026-05-01", issue: 3, grace_until: null },
  })
  const { entries } = await refresh(new FakeGitHubClient([meta("a/b")]), [flagged], NOW)
  expect(entries[0]!.metrics.stars).toBe(500)
  expect(entries[0]!.status).toBe("flagged")
})

test("handles an empty entry list without calling the API", async () => {
  const { entries, missing } = await refresh(new FakeGitHubClient([]), [], NOW)
  expect(entries).toEqual([])
  expect(missing).toEqual([])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/refresh.test.ts`
Expected: FAIL — cannot resolve `../src/refresh`.

- [ ] **Step 3: Write the implementation**

`src/refresh.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/refresh.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/refresh.ts tests/refresh.test.ts
git commit -m "feat: batch metrics refresh"
```

---

### Task 8: Reaper — flag stale, archived and gone entries

**Files:**
- Create: `src/reap.ts`
- Test: `tests/reap.test.ts`

**Interfaces:**
- Consumes: `Entry`, `FlagReason`, `GraveyardEntry` from `src/schema.ts`
- Produces:
  - `STALE_DAYS: 90`
  - `daysBetween(a: string, b: Date): number`
  - `reap(entries: Entry[], missing: string[], now: Date): { entries: Entry[]; flagged: Array<{ id: string; reason: FlagReason }> }`
  - `toGraveyard(entry: Entry, reason: FlagReason, today: string): GraveyardEntry`

Gone entries are flagged with `reason: "gone"` and skip the 14-day vote; the removal PR that consumes them arrives in M3. `reap` never mutates its inputs and never removes anything itself.

- [ ] **Step 1: Write the failing test**

`tests/reap.test.ts`:

```ts
import { test, expect } from "bun:test"
import { daysBetween, reap, toGraveyard } from "../src/reap"
import type { Entry } from "../src/schema"

function entry(id: string, pushed: string, over: Partial<Entry> = {}): Entry {
  return {
    id,
    kind: "skill",
    name: id.split("/")[1]!,
    url: `https://github.com/${id}`,
    summary: "s",
    tags: [],
    added: "2026-01-01",
    source: "discovery",
    status: "active",
    metrics: { stars: 10, pushed_at: pushed, archived: false, last_checked: "2026-08-06T04:00:00Z" },
    ...over,
  }
}

const NOW = new Date("2026-08-06T04:00:00Z")

test("daysBetween counts whole days", () => {
  expect(daysBetween("2026-08-01", NOW)).toBe(5)
})

test("does not flag at 89 days", () => {
  const { flagged } = reap([entry("a/b", "2026-05-10")], [], NOW)
  expect(flagged).toEqual([])
})

test("flags stale at exactly 90 days", () => {
  const { flagged } = reap([entry("a/b", "2026-05-08")], [], NOW)
  expect(flagged).toEqual([{ id: "a/b", reason: "stale" }])
})

test("flags stale past 90 days", () => {
  const { flagged } = reap([entry("a/b", "2026-01-01")], [], NOW)
  expect(flagged[0]!.reason).toBe("stale")
})

test("archived takes priority over stale", () => {
  const e = entry("a/b", "2026-01-01", {
    metrics: { stars: 10, pushed_at: "2026-01-01", archived: true, last_checked: "2026-08-06T04:00:00Z" },
  })
  expect(reap([e], [], NOW).flagged[0]!.reason).toBe("archived")
})

test("missing ids are flagged gone", () => {
  const { flagged } = reap([entry("a/b", "2026-08-05")], ["a/b"], NOW)
  expect(flagged).toEqual([{ id: "a/b", reason: "gone" }])
})

test("gone takes priority over archived", () => {
  const e = entry("a/b", "2026-01-01", {
    metrics: { stars: 10, pushed_at: "2026-01-01", archived: true, last_checked: "2026-08-06T04:00:00Z" },
  })
  expect(reap([e], ["a/b"], NOW).flagged[0]!.reason).toBe("gone")
})

test("grace_until in the future suppresses a stale flag", () => {
  const e = entry("a/b", "2026-01-01", {
    flag: { reason: "stale", since: "2026-07-01", issue: 5, grace_until: "2027-01-01" },
  })
  expect(reap([e], [], NOW).flagged).toEqual([])
})

test("grace_until in the past does not suppress", () => {
  const e = entry("a/b", "2026-01-01", {
    flag: { reason: "stale", since: "2026-01-01", issue: 5, grace_until: "2026-07-01" },
  })
  expect(reap([e], [], NOW).flagged[0]!.reason).toBe("stale")
})

test("grace does not suppress a gone flag", () => {
  const e = entry("a/b", "2026-08-05", {
    flag: { reason: "stale", since: "2026-07-01", issue: 5, grace_until: "2027-01-01" },
  })
  expect(reap([e], ["a/b"], NOW).flagged[0]!.reason).toBe("gone")
})

test("flagging sets status, reason and since without an issue number", () => {
  const { entries } = reap([entry("a/b", "2026-01-01")], [], NOW)
  expect(entries[0]!.status).toBe("flagged")
  expect(entries[0]!.flag).toEqual({ reason: "stale", since: "2026-08-06", issue: null, grace_until: null })
})

test("a healthy entry is returned untouched", () => {
  const e = entry("a/b", "2026-08-05")
  expect(reap([e], [], NOW).entries[0]).toEqual(e)
})

test("an already flagged entry is not re-flagged with a new since date", () => {
  const e = entry("a/b", "2026-01-01", {
    status: "flagged",
    flag: { reason: "stale", since: "2026-06-01", issue: 7, grace_until: null },
  })
  const { entries, flagged } = reap([e], [], NOW)
  expect(flagged).toEqual([])
  expect(entries[0]!.flag!.since).toBe("2026-06-01")
})

test("toGraveyard captures id, reason and removal date", () => {
  const g = toGraveyard(entry("a/b", "2026-01-01"), "stale", "2026-08-06")
  expect(g).toEqual({
    id: "a/b",
    name: "b",
    url: "https://github.com/a/b",
    reason: "stale",
    removed: "2026-08-06",
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/reap.test.ts`
Expected: FAIL — cannot resolve `../src/reap`.

- [ ] **Step 3: Write the implementation**

`src/reap.ts`:

```ts
import type { Entry, FlagReason, GraveyardEntry } from "./schema"

export const STALE_DAYS = 90

const MS_PER_DAY = 86_400_000

export function daysBetween(a: string, b: Date): number {
  return Math.floor((b.getTime() - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY)
}

function reasonFor(entry: Entry, gone: boolean, now: Date): FlagReason | null {
  if (gone) return "gone"
  const graced = entry.flag?.grace_until !== null && entry.flag?.grace_until !== undefined
    ? Date.parse(`${entry.flag.grace_until}T00:00:00Z`) > now.getTime()
    : false
  if (graced) return null
  if (entry.metrics.archived) return "archived"
  if (daysBetween(entry.metrics.pushed_at, now) >= STALE_DAYS) return "stale"
  return null
}

export function reap(
  entries: Entry[],
  missing: string[],
  now: Date,
): { entries: Entry[]; flagged: Array<{ id: string; reason: FlagReason }> } {
  const gone = new Set(missing)
  const today = now.toISOString().slice(0, 10)
  const flagged: Array<{ id: string; reason: FlagReason }> = []

  const out = entries.map((entry) => {
    const reason = reasonFor(entry, gone.has(entry.id), now)
    if (reason === null) return entry
    if (entry.status === "flagged" && entry.flag?.reason === reason) return entry
    flagged.push({ id: entry.id, reason })
    return {
      ...entry,
      status: "flagged" as const,
      flag: { reason, since: today, issue: null, grace_until: null },
    }
  })

  return { entries: out, flagged }
}

export function toGraveyard(entry: Entry, reason: FlagReason, today: string): GraveyardEntry {
  return { id: entry.id, name: entry.name, url: entry.url, reason, removed: today }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/reap.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/reap.ts tests/reap.test.ts
git commit -m "feat: reaper flags stale, archived and gone entries"
```

---

### Task 9: Validation gates and the refresh CLI command

**Files:**
- Create: `src/validate.ts`
- Modify: `src/cli.ts`
- Test: `tests/validate.test.ts`

**Interfaces:**
- Consumes: `SkillsFile`, `Entry` from `src/schema.ts`; `renderReadme`, `renderJson` from `src/render.ts`
- Produces:
  - `MAX_CHECK_AGE_HOURS: 48`
  - `checkStaleness(data: SkillsFile, now: Date): string[]`
  - `checkReproducible(data: SkillsFile, readme: string, json: string, now: Date): string[]`
  - `validate(data: SkillsFile, readme: string, json: string, now: Date): string[]`

`validate` returns an array of human-readable problems. Empty means pass.

- [ ] **Step 1: Write the failing test**

`tests/validate.test.ts`:

```ts
import { test, expect } from "bun:test"
import { renderJson, renderReadme } from "../src/render"
import { checkReproducible, checkStaleness, validate } from "../src/validate"
import type { Entry, SkillsFile } from "../src/schema"

function entry(id: string, checked: string, over: Partial<Entry> = {}): Entry {
  return {
    id,
    kind: "skill",
    name: id.split("/")[1]!,
    url: `https://github.com/${id}`,
    summary: "s",
    tags: [],
    added: "2026-01-01",
    source: "discovery",
    status: "active",
    metrics: { stars: 10, pushed_at: "2026-08-01", archived: false, last_checked: checked },
    ...over,
  }
}

const NOW = new Date("2026-08-06T04:00:00Z")

test("passes when every active entry was checked recently", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-08-05T04:00:00Z")] }
  expect(checkStaleness(data, NOW)).toEqual([])
})

test("fails when an active entry is over 48 hours old", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-08-03T03:00:00Z")] }
  expect(checkStaleness(data, NOW).length).toBe(1)
  expect(checkStaleness(data, NOW)[0]).toContain("a/b")
})

test("ignores flagged entries in the staleness gate", () => {
  const flagged = entry("a/b", "2026-01-01T00:00:00Z", {
    status: "flagged",
    flag: { reason: "stale", since: "2026-01-01", issue: null, grace_until: null },
  })
  expect(checkStaleness({ version: 1, entries: [flagged] }, NOW)).toEqual([])
})

test("passes reproducibility when artifacts match the renderer", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-08-05T04:00:00Z")] }
  const problems = checkReproducible(data, renderReadme(data, NOW), renderJson(data), NOW)
  expect(problems).toEqual([])
})

test("fails reproducibility when the README was hand-edited", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-08-05T04:00:00Z")] }
  const tampered = renderReadme(data, NOW) + "\nsneaky manual addition\n"
  const problems = checkReproducible(data, tampered, renderJson(data), NOW)
  expect(problems.length).toBe(1)
  expect(problems[0]).toContain("README.md")
})

test("fails reproducibility when the JSON export is stale", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-08-05T04:00:00Z")] }
  const problems = checkReproducible(data, renderReadme(data, NOW), "{}\n", NOW)
  expect(problems[0]).toContain("data/skills.json")
})

test("validate aggregates both gates", () => {
  const data: SkillsFile = { version: 1, entries: [entry("a/b", "2026-01-01T00:00:00Z")] }
  expect(validate(data, "wrong", "wrong", NOW).length).toBe(3)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/validate.test.ts`
Expected: FAIL — cannot resolve `../src/validate`.

- [ ] **Step 3: Write the implementation**

`src/validate.ts`:

```ts
import { renderJson, renderReadme } from "./render"
import type { SkillsFile } from "./schema"

export const MAX_CHECK_AGE_HOURS = 48

const MS_PER_HOUR = 3_600_000

export function checkStaleness(data: SkillsFile, now: Date): string[] {
  const problems: string[] = []
  for (const e of data.entries) {
    if (e.status !== "active") continue
    const age = (now.getTime() - Date.parse(e.metrics.last_checked)) / MS_PER_HOUR
    if (age > MAX_CHECK_AGE_HOURS) {
      problems.push(
        `${e.id}: last_checked is ${Math.floor(age)}h old, over the ${MAX_CHECK_AGE_HOURS}h limit`,
      )
    }
  }
  return problems
}

export function checkReproducible(
  data: SkillsFile,
  readme: string,
  json: string,
  now: Date,
): string[] {
  const problems: string[] = []
  if (renderReadme(data, now) !== readme) {
    problems.push("README.md does not match renderer output; run `bun run render`")
  }
  if (renderJson(data) !== json) {
    problems.push("data/skills.json does not match renderer output; run `bun run render`")
  }
  return problems
}

export function validate(data: SkillsFile, readme: string, json: string, now: Date): string[] {
  return [...checkStaleness(data, now), ...checkReproducible(data, readme, json, now)]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/validate.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Wire `refresh` and `validate` into the CLI**

In `src/cli.ts`, add these imports beside the existing ones:

```ts
import { readFileSync } from "node:fs"
import { reap } from "./reap"
import { refresh } from "./refresh"
import { validate } from "./validate"
```

Then insert both blocks immediately before the `if (cmd === "render")` block:

```ts
  if (cmd === "refresh") {
    const now = new Date()
    const data = loadSkills(SKILLS)
    const gh = new RealGitHubClient(token())
    const refreshed = await refresh(gh, data.entries, now)
    const reaped = reap(refreshed.entries, refreshed.missing, now)
    saveSkills(SKILLS, { version: 1, entries: reaped.entries })
    writeArtifacts()
    for (const f of reaped.flagged) console.log(`flagged ${f.id}: ${f.reason}`)
    console.log(`refreshed ${refreshed.entries.length}, flagged ${reaped.flagged.length}`)
    return 0
  }
  if (cmd === "validate") {
    const problems = validate(
      loadSkills(SKILLS),
      readFileSync("README.md", "utf8"),
      readFileSync("data/skills.json", "utf8"),
      new Date(),
    )
    for (const p of problems) console.error(`FAIL ${p}`)
    if (problems.length > 0) return 1
    console.log("validate: ok")
    return 0
  }
```

- [ ] **Step 6: Verify the wiring end to end**

```bash
GITHUB_TOKEN=$(gh auth token) bun run src/cli.ts refresh
bun run src/cli.ts validate
```

Expected: refresh prints a count and any flags; validate prints `validate: ok` and exits 0.

Then confirm the gate actually bites:

```bash
printf '\ntampered\n' >> README.md && bun run src/cli.ts validate; echo "exit=$?"
git checkout README.md
```

Expected: `FAIL README.md does not match renderer output`, `exit=1`.

- [ ] **Step 7: Run the full test suite and commit**

```bash
bun test
git add src/validate.ts tests/validate.test.ts src/cli.ts skills.yaml README.md data/skills.json
git commit -m "feat: staleness and reproducibility gates, refresh CLI command"
```

---

### Task 10: GitHub Actions workflows — M2 complete

**Files:**
- Create: `.github/workflows/validate.yml`
- Create: `.github/workflows/refresh.yml`
- Create: `.github/workflows/discover.yml`
- Create: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: the `discover`, `refresh`, `render` and `validate` CLI subcommands
- Produces: nothing consumed by later tasks (M3 adds `tally.yml` beside these)

Workflows never push to `main`. `refresh` opens a metrics-only PR that auto-merges once checks pass; `discover` opens an additions PR that waits for human review.

- [ ] **Step 1: Write the validation workflow**

`.github/workflows/validate.yml`:

```yaml
name: validate
on:
  pull_request:
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"
      - run: bun install --frozen-lockfile
      - run: bun test
      - run: bun run src/cli.ts validate
```

- [ ] **Step 2: Write the refresh workflow**

`.github/workflows/refresh.yml`:

```yaml
name: refresh
on:
  schedule:
    - cron: "0 4 * * *"
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"
      - run: bun install --frozen-lockfile
      - run: bun run src/cli.ts refresh
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - id: cpr
        uses: peter-evans/create-pull-request@v7
        with:
          branch: bot/refresh
          title: "chore: daily metrics refresh"
          body: |
            Automated metrics refresh. Stars, push dates and archive status only,
            plus any entries the reaper flagged.

            Auto-merges when checks pass.
          commit-message: "chore: daily metrics refresh"
          labels: automated
      - if: steps.cpr.outputs.pull-request-number != ''
        run: gh pr merge --squash --auto "${{ steps.cpr.outputs.pull-request-number }}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Auto-merge requires branch protection with required status checks on `main`, plus "Allow auto-merge" enabled in repository settings. Turn both on before the first scheduled run, otherwise the `gh pr merge --auto` step fails.

- [ ] **Step 3: Write the discovery workflow**

`.github/workflows/discover.yml`:

```yaml
name: discover
on:
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  discover:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"
      - run: bun install --frozen-lockfile
      - run: bun run src/cli.ts discover
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: peter-evans/create-pull-request@v7
        with:
          branch: bot/discover
          title: "feat: new candidate entries"
          body: |
            Candidates that cleared the inclusion bar (>=25 stars, not archived,
            not a mirror of proprietary source).

            **Review before merging.** Everything lands as `kind: skill` with empty
            tags; set the correct kind, add tags, and rewrite any summary that reads
            as marketing copy.
          commit-message: "feat: new candidate entries"
          labels: automated, needs-review
```

- [ ] **Step 4: Write CONTRIBUTING.md**

`CONTRIBUTING.md`:

```markdown
# Contributing

## Adding an entry

Edit `skills.yaml`, then run `bun run render` and commit the regenerated
`README.md` and `data/skills.json` alongside it. PRs that edit `README.md`
directly are rejected by CI.

Inclusion bar:

- Relevant to Claude Code or the Agent Skills standard
- Ships a `SKILL.md`, a `.claude-plugin/plugin.json`, or is a documented tool for the harness
- At least 25 stars, or make the case in the PR
- Not an undiverged fork
- Not a mirror of leaked or proprietary source

## Removing an entry

Open a PR moving the entry to `graveyard.yaml` with a reason and date. The bot
does this automatically for anything archived, deleted, or untouched for 90 days.

## How the automation works

- `refresh` runs daily at 04:00 UTC and opens a metrics-only PR that auto-merges.
- `discover` runs daily at 06:00 UTC and opens an additions PR for human review.
- `validate` runs on every PR: schema, README reproducibility, and a 48-hour
  staleness gate on `last_checked`.

If the badge at the top of the README goes red, the automation has stopped and
the freshness claim no longer holds. That is intentional — silence must not read
as success.
```

- [ ] **Step 5: Verify the workflows parse and the suite is green**

```bash
bun test
bun run src/cli.ts validate
```

Expected: all tests pass; `validate: ok`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows CONTRIBUTING.md
git commit -m "feat: scheduled refresh and discovery workflows, CI gates

M2 complete."
```

- [ ] **Step 7: Manual repository setup (not scriptable)**

After pushing, in GitHub repo settings:

1. Enable "Allow auto-merge".
2. Add branch protection on `main` requiring the `validate` check.
3. Under Actions → General, set workflow permissions to "Read and write" and tick "Allow GitHub Actions to create and approve pull requests".

Then trigger both workflows once by hand via `workflow_dispatch` and confirm the refresh PR opens and auto-merges, and the discover PR opens and waits.

---

## Self-Review

**Spec coverage.** `skills.yaml` as source of truth (Tasks 1-2), graveyard (Tasks 2, 8), GitHubClient with GraphQL batching (Task 3), renderer and badge and JSON export (Task 4), discovery with inclusion bar including the leaked-source exclusion (Task 5), M1 seed (Task 6), refresh (Task 7), reap with the 90-day threshold and grace window (Task 8), 48-hour CI staleness gate and README reproducibility (Task 9), daily schedules with metrics-only auto-merge (Task 10), MIT plus CC0 licensing (Task 1), deterministic sorting (Task 2).

Deliberately deferred to M3, per the spec's sequencing note: flag issues, vote tally, eligibility filter, removal PRs. `reap` flags and records but never removes, which is why `graveyard.yaml` is created empty in Task 2 and only written by hand until M3 lands.

**Type consistency.** `RepoMeta` is `{ id, stars, pushed_at, archived, description }` in Task 3 and used with those exact names in Tasks 5 and 7. `getRepos` returns `Map<string, RepoMeta | null>` throughout. `refresh` returns `{ entries, missing }` in Task 7 and is destructured as such in Task 9. `reap` returns `{ entries, flagged }` in Task 8 and is destructured as such in Task 9. `Entry.metrics.last_checked` is an ISO datetime everywhere; `pushed_at`, `added`, `since`, `grace_until` and `removed` are all plain dates.

**Placeholder scan.** No TBDs. Every code step carries runnable code. Step 4 of Task 6 is manual curation by design and is described concretely rather than deferred. Step 7 of Task 10 is GitHub UI configuration that cannot be scripted from the repo and is enumerated exactly.
