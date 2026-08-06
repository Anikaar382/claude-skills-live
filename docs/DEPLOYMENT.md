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

## 4. The curation pass — outstanding

The seed run's 343 entries were never curated. Every one is `kind: skill` with
empty `tags`, and its `summary` is the upstream repo's own GitHub description,
mechanically truncated to 120 characters.

Consequences today:

- `README.md` is a single undifferentiated 311-row table. The renderer groups by
  `kind`, so with one kind in use there is nothing to group.
- 202 of 343 summaries are exactly 120 characters, i.e. cut mid-sentence.
- `LICENSE-DATA` scopes the CC0 dedication around this: it covers the
  compilation, schema and derived facts, and explicitly excludes `summary`, which
  remains its upstream author's. That scoping is correct but it is a workaround
  for uncurated data, not a substitute for curating it.

Before publishing, go through `skills.yaml` and set the real `kind`, add `tags`,
and rewrite the summaries in your own words. Then `bun run src/cli.ts render`.

## Known gaps carried into M3

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
