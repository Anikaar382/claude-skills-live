# skills-live — design

**Date:** 2026-08-06
**Status:** approved, not yet implemented
**Working name:** `skills-live` (nothing depends on it; easy to change)

## Problem

There are four large curated lists of Claude Code / agent skills. They all rot.

| Repo | License | Stars | Last push (2026-08-06) |
|---|---|---|---|
| `ComposioHQ/awesome-claude-skills` | none | 71,952 | 2026-07-24 |
| `hesreallyhim/awesome-claude-code` | NOASSERTION | 51,793 | same day |
| `VoltAgent/awesome-agent-skills` | MIT | 29,716 | 2026-08-03 |
| `travisvn/awesome-claude-skills` | none | 14,537 | **2026-04-28** |

`travisvn` has 14.5K stars and has been untouched for over three months. Every one of these
lists carries entries that are archived, moved, or dead, and none of them can tell you which.

Meanwhile the supply side is a firehose: the GuildSkills cross-agent registry indexes 167,000+
skills and Vercel's skills.sh lists 89,753. Discovery is not the scarce resource. **Verification
is.**

## Wedge

Not "a bigger list." The claim is:

> Every entry in this list was verified alive within the last 24 hours.

None of the four incumbents can make that claim, and it is mechanically checkable rather than a
matter of taste.

Additions are cheap and noisy. **Reaping is the product.**

## Non-goals

Explicitly out of scope for v1:

- No website, no frontend. The rendered `README.md` is the entire UI.
- No composite ranking score. Fake precision, and it invites gaming.
- No database, no hosting, no auth. GitHub is the datastore.
- No paid listings or sponsored placement.
- No auto-merge of add/remove PRs. Metrics-only refreshes auto-merge; membership changes do not.
- No coverage of registries beyond GitHub in v1 (see M4).

## Legal position

`ComposioHQ/awesome-claude-skills` (the largest, 72K stars) has **no license**, and
`travisvn/awesome-claude-skills` has none either. Copying their content wholesale is
infringement.

We do not copy. Every entry is derived independently from the GitHub API. Repo names, URLs,
star counts and push dates are facts and are not copyrightable. Summaries are written fresh, by
us, capped at 120 characters, never lifted from another list. Categorisation is our own.

This repo ships MIT for the code and CC0 for `skills.yaml`, so nobody downstream inherits the
problem we are working around.

## Architecture

```
                 ┌──────────────┐
   GitHub API ──▶│  discover    │──┐
                 └──────────────┘  │
                 ┌──────────────┐  │   ┌─────────────┐   ┌───────────┐
   GitHub API ──▶│  refresh     │──┼──▶│ skills.yaml │──▶│  render   │──▶ README.md
                 └──────────────┘  │   └─────────────┘   └───────────┘   data/skills.json
                 ┌──────────────┐  │          ▲
                 │  reap        │──┘          │
                 └──────┬───────┘             │
                        │ opens               │ PR
                 ┌──────▼───────┐      ┌──────┴──────┐
                 │ flag issue   │─────▶│ vote tally  │
                 └──────────────┘      └─────────────┘
```

`skills.yaml` is the single source of truth. `README.md` is generated and **never hand-edited**;
CI rejects any PR whose README diff is not reproducible from the datafile. This is what keeps
both the bot and human PRs clean.

## Data model

`skills.yaml`:

```yaml
version: 1
entries:
  - id: obra/superpowers            # canonical key: gh "owner/repo"
    kind: framework                 # framework | skill | plugin | mcp | tool
    name: Superpowers
    url: https://github.com/obra/superpowers
    summary: Agentic skills framework and spec-driven development methodology.
    tags: [skills, methodology]
    added: 2026-08-06
    source: discovery               # discovery | pr | manual
    status: active                  # active | flagged | removed
    metrics:                        # bot-owned; hand edits are reverted by CI
      stars: 268003
      pushed_at: 2026-08-06
      archived: false
      last_checked: 2026-08-06T04:00:00Z
    flag:                           # present only when status != active
      reason: stale                 # stale | archived | gone | dispute
      since: 2026-08-06
      issue: 412
      grace_until: null
```

Removed entries move to `graveyard.yaml` with the reason and date rather than being deleted, so
the list can prove what it pruned and when. That history is itself evidence for the wedge.

## Components

### 1. discover

Sources for v1, GitHub only:

- Repo search on `topic:claude-code`, `topic:claude-skills`, `topic:agent-skills`
- Code search for `path:**/SKILL.md` and `path:.claude-plugin/plugin.json`

**Inclusion bar** — this is what stops the firehose becoming a dump:

- Relevant to Claude Code or the Agent Skills standard
- Has a `SKILL.md`, a `.claude-plugin/plugin.json`, or is a documented tool for the harness
- ≥25 stars, or manually vouched in a PR
- Not a fork unless substantially diverged
- **Not a mirror of leaked or proprietary source** (rules out the March 2026 Claude Code
  sourcemap mirrors, several of which are titled as if they were open source)

Candidates clearing the bar are appended with `status: active`; borderline ones open a flag
issue with `reason: dispute` and are held out of the README until voted in.

### 2. refresh

Batch-updates `metrics` for every entry. Use the **GraphQL API**, 100 repos per query, not REST
— at ~500 entries that is 5 calls instead of 500, comfortably inside the 5,000/hr limit.

### 3. reap

Flags an entry when any of:

- `archived: true` → flag immediately
- 404 / repo gone → flag immediately
- no push in **90 days** → flag as stale

Flagging opens an issue and removes the entry from the rendered README (it stays in
`skills.yaml` with `status: flagged`, so the state is auditable).

### 4. render

`skills.yaml` → `README.md`, grouped by `kind` then `tags`, sorted by stars descending within
each group. Header carries a badge:

```
✅ 0 dead entries · 137 verified · last checked 2026-08-06 04:00 UTC
```

Also emits `data/skills.json` for downstream consumers.

**CI gate:** the build fails if any `status: active` entry has `last_checked` older than 48
hours. The headline claim has to be enforced, not asserted.

## Voting protocol

Votes resolve **membership only**. Ordering is by stars. Keeping these separate stops a
made-up composite score from becoming the thing people game.

- The bot opens **one issue per flagged entry** — never one per skill. Most entries never get an
  issue, so issue count stays proportional to disputes, not to catalogue size.
- 👍 = keep, 👎 = remove. Reactions on the issue body are the ballot.
- `net` = (👍 from eligible voters) − (👎 from eligible voters). Ineligible reactions are counted
  and displayed but excluded from `net`.
- The bot posts and edits a running tally comment.
- **Resolution after 14 days:** net ≤ 0 → bot opens a removal PR; net > 0 → `status` returns to
  `active` with `grace_until` set 180 days out, exempting it from the stale check until then.
- Anyone can open a normal PR to add or remove an entry at any time. Voting is the async path,
  not the only path.

### Sybil resistance

Listing position already has cash value — paid SKILL.md marketplaces run 70/30 and 80/20 splits
— so assume gaming from day one.

The tally ignores any account that is under 90 days old or has zero public contributions,
checked via GraphQL. Ignored votes are listed in the tally comment so the filtering is visible
rather than silent.

## Repo layout

```
skills-live/
├── skills.yaml               # source of truth
├── graveyard.yaml            # removed entries + reason + date
├── README.md                 # GENERATED — do not edit
├── data/skills.json          # GENERATED
├── src/
│   ├── discover.ts
│   ├── refresh.ts
│   ├── reap.ts
│   ├── render.ts
│   ├── tally.ts
│   └── schema.ts             # zod schema for skills.yaml
├── tests/
└── .github/workflows/
    ├── discover.yml          # daily 06:00 UTC
    ├── refresh.yml           # daily 04:00 UTC
    ├── tally.yml             # every 6h
    └── validate.yml          # on PR
```

TypeScript on Bun, matching the rest of the local tooling.

## Schedules

Hourly discovery was the original ask. Actions minutes are free on public repos so cost is not
the constraint, but 23 of every 24 runs would find nothing and the resulting PR noise trains you
to stop reading them. Daily instead:

| Workflow | Cadence | Opens |
|---|---|---|
| refresh | daily 04:00 UTC | metrics-only PR, **auto-merges** when CI passes |
| discover | daily 06:00 UTC | additions PR, human review |
| reap | runs inside refresh | flag issues, then removal PRs after the vote |
| tally | every 6h | edits tally comments, resolves expired votes |
| validate | on every PR | schema check, README reproducibility, dead-link check |

The metrics-only auto-merge matters. Without it, unreviewed bot PRs pile up and the list rots —
which is the exact failure being sold against.

## Failure modes

| Failure | Handling |
|---|---|
| GitHub API rate limit | exponential backoff; partial refresh is fine, `last_checked` is per entry |
| Code search unavailable or restricted | discovery degrades to topic search only; log and continue |
| Repo renamed | follow the redirect, update `id` and `url`, note it in the PR body |
| Repo deleted | flag `gone`, skip the 14-day vote, remove on next run |
| Bot opens a bad PR | human review gate on all membership changes |
| Vote brigading | eligibility filter, plus manual override by maintainer with reason recorded |
| Bot breaks silently | validate.yml fails the build once `last_checked` ages past 48h, badge goes red |

That last row is the lesson from `nano-daily.timer` dying at 203/EXEC for weeks without a peep.
Silence must not read as success.

## Testing

- Schema round-trip: parse `skills.yaml` → render → reparse, assert stable
- Renderer golden file
- Reaper threshold tests at 89/90/91 days, archived, 404
- Tally: eligibility filter, net calculation, 14-day expiry boundary
- All GitHub calls behind one client interface, faked in tests. No network in CI tests.

## Milestones

**M1 — seeded list.** Schema, renderer, discovery. Seed ~100–150 entries. README generated.
Shippable on its own; this alone is already a current list.

**M2 — the wedge.** Refresh, reap, freshness badge, CI staleness gate, auto-merge on
metrics-only PRs. **This is where the differentiator lands.** Ship and announce here.

**M3 — voting.** Flag issues, tally bot, eligibility filter, removal PRs.

**M4 — beyond GitHub.** skills.sh and GuildSkills ingestion, if their APIs allow it.

Sequencing note: **do not build M3 before M2 has users.** A voting system with no voters is dead
weight, and freshness is what earns the audience that makes voting mean anything.

## Risks

- **Composio has 8,154 forks and a funded company behind it.** If this works they can copy the
  automation in a week. The only real moat is being first and having `skills.yaml` become the
  format people PR against. Accept this; it is not avoidable.
- **GitHub code search** has eligibility restrictions and tighter limits than repo search.
  Discovery may be thinner than hoped. Mitigated by degrading to topic search.
- **Voting gets gamed** once listing position is worth money. Eligibility filtering raises the
  cost but does not eliminate it.
- **Reputational asset, not revenue.** Expect roughly zero direct income. This is worth doing
  for distribution and credibility, not money.

## Open questions

1. Final name. `skills-live` is a placeholder.
2. Do skills.sh and GuildSkills expose usable public APIs? Unverified — gates M4.
3. Is 90 days the right stale threshold? A skill can be complete and correctly untouched.
   Starting at 90 with `grace_until` as the escape hatch; revisit once there is real data.
