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

- `refresh` runs daily at 04:00 UTC and opens a metrics-only PR that is
  designed to auto-merge once checks pass. This requires a one-time repo
  setup step (a PAT secret so the bot's own PR can trigger `validate`; see
  the repo's post-push setup notes) — until that secret exists, refresh PRs
  open but do not merge themselves.
- `discover` runs daily at 06:00 UTC and opens an additions PR for human review.
- `validate` runs on every PR (schema and README/JSON reproducibility only —
  a discover PR is meant to sit open for multi-day review, so it is not
  failed by its own age) and on every push to `main` (schema, reproducibility,
  and the 48-hour staleness gate on `last_checked`, which is a signal about
  whether the scheduled refresh is still alive, not about any one PR).

If the badge at the top of the README goes red, the automation has stopped and
the freshness claim no longer holds. That is intentional — silence must not read
as success.
