# Deployment

Everything here has to happen at or immediately after the first push. None of it
could be done during implementation, because the repo had no GitHub remote.

Items 1–3 are required for the automation to work at all. Item 4 is required for
the published index to be worth reading.

## 1. Set `REPO_SLUG`

`src/render.ts` defines `REPO_SLUG` (currently `pjdurden/skills-live`), which
builds the workflow-status badge URL. If the repo lands under a different
`owner/name`, change it, then:

```bash
bun run src/cli.ts render
git commit -am "chore: point badge at the real repo slug"
```

A wrong slug renders a 404 badge image, which reads as *no badge* rather than as
*failure* — quietly disabling the watchdog it exists to provide.

It is a constant rather than an environment variable on purpose: an env var could
differ between CI and a contributor's shell, and the reproducibility gate would
surface that as a confusing artifact mismatch.

## 2. Create a PAT — without this, auto-merge never fires

GitHub does not trigger `pull_request` workflows for PRs opened with the default
`GITHUB_TOKEN`. It is an anti-recursion measure and there is no way around it
from inside the workflow file. `pull_request_target` does not help: the
suppression applies to the triggering event, not to the listener's trigger type.

So, as shipped, bot-opened PRs get no `validate` run at all. Combined with branch
protection requiring that check, refresh PRs open and then hang forever.

Fix:

1. Create a fine-grained PAT scoped to this repo with `contents: write` and
   `pull requests: write`.
2. Store it as a repo secret, e.g. `PAT_TOKEN`.
3. Add `token: ${{ secrets.PAT_TOKEN }}` to the `create-pull-request@v7` step in
   **both** `.github/workflows/refresh.yml` and `.github/workflows/discover.yml`.

A `workflow_run` chain is the alternative that needs no new credential — a second
workflow triggered by the first's completion, checking out the PR head and
posting a commit status. It needs `statuses: write`, and it was not built or
evaluated here.

## 3. Repository settings

- Enable **Allow auto-merge**.
- Set Actions → General → Workflow permissions to **Read and write**, and tick
  **Allow GitHub Actions to create and approve pull requests**.
- Add branch protection on `main` requiring the `validate` check. Note the
  chicken-and-egg: a check cannot be *selected* in branch protection until it has
  run at least once, so push, let `validate` run, then add the rule.
- Create the `automated` and `needs-review` labels. `create-pull-request` errors
  on the label step if they do not exist.
- Confirm the default branch is actually named `main` — branch protection and the
  workflow docs assume it.

Then trigger `refresh` and `discover` once each via `workflow_dispatch` and
confirm the refresh PR opens, gets a `validate` check, and auto-merges, while the
discover PR opens, gets a check, and waits for a human. If step 2 was skipped,
the refresh PR opening but never merging is the predicted failure, not a new bug.

## 4. The curation pass — done

Completed 2026-08-07 over all 342 seeded entries.

- Real `kind` on every entry: 133 `tool`, 86 `plugin`, 84 `skill`, 29
  `framework`, 10 `mcp`. The README is six sections rather than one flat table.
- 1–3 `tags` per entry from a fixed 25-term vocabulary, rendered as a Tags
  column. Tags are sorted at render time, because a curator can write them in
  any order and the reproducibility gate compares bytes.
- Every `summary` rewritten. 201 were upstream descriptions cut mid-sentence;
  none are now.
- 15 entries removed as out of scope, recorded in `graveyard.yaml` under the
  `offtopic` reason so `knownIds()` keeps them out permanently.

Keep `LICENSE-DATA`'s scoping as written even though summaries are now
original. It says the `summary` field *may* quote upstream text, and three short
factual ones still substantially match — "Dashboard for monitoring Claude Code
sessions" has no meaningfully different phrasing. The permissive wording costs
nothing and stays true as new entries arrive from `discover`, which still seeds
summaries from upstream descriptions until a human rewrites them.

When you merge a discover PR, rewrite the new summaries as part of the review.
That is what the PR body asks for, and it is what keeps the licensing claim and
the prose quality true over time.

## Known gaps carried into M3

- **The discovery inclusion bar is too loose.** Curation removed 15 entries
  worth 231k stars between them — a Kubernetes platform, a Python shell, an SVG
  icon library, two generic chat clients. All reached the index through a stray
  `claude-code`-family topic tag on an unrelated repo. `isEligible` checks
  known/archived/stars/blocklists and nothing else: it never checks `pushed_at`,
  and `RepoMeta` carries no `fork` field at all, so the bar's stated "not an
  undiverged fork" rule is unimplemented. Until that is tightened, every
  discover PR needs a real human read rather than a skim.
- **Nothing is ever removed.** The reaper flags and delists; actual removal is
  M3's vote flow. `README.md` says "flagged and delisted" accordingly.
- **`graveyard.yaml` holds only content-policy blocks**, not reaped repos, so the
  spec's "pruning history is evidence for the wedge" is not yet realised. The
  Recently-flagged table in the README is the current stand-in.
- **`grace_until` is only settable by hand.** M3's voting is what was meant to
  set it. An `active` entry carrying a live `grace_until` is exempt from both
  limbs of `checkNoDead`, so a human can grant an exemption to the "0 dead
  entries" claim without the badge disclosing it.
- **Scheduled workflows are disabled by GitHub after 60 days of repo
  inactivity.** If that fires, the badge freezes green rather than going red.
  Daily bot commits normally prevent it.
