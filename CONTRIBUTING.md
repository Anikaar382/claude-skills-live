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
