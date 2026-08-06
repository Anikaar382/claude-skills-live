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

## Licensing what you contribute

Data contributions are dedicated under CC0 (see `LICENSE-DATA`), but that
dedication covers the compilation, the schema and the derived factual data
about each entry; the `summary` field may quote a repository's own upstream
description, which remains its author's.

## Delisting vs. removing

These are two different things and only one of them is automated.

**Delisting** is what the bot does. Anything archived, deleted, or untouched
for 90 days is flagged: it drops out of the README's tables, appears under
"Recently flagged" with the reason and the date, and stays in `skills.yaml`.
Nothing is moved to `graveyard.yaml` by automation. If the repo recovers — a
new push, an unarchive, a deleted repo restored — the next refresh clears the
flag by itself and the entry returns to the tables.

**Removal** is permanent and always human. Open a PR moving the entry to
`graveyard.yaml` with a reason and date. That file is the exclusion list for
entries this project will not carry at all, such as mirrors of leaked or
proprietary source; CI fails any PR that puts a graveyarded id back into
`skills.yaml`, and discovery will not re-add it.

## How the automation works

- `refresh` runs daily at 04:00 UTC and opens a metrics-only PR that is
  designed to auto-merge once checks pass. This requires a one-time repo
  setup step (a PAT secret so the bot's own PR can trigger `validate`; see
  the repo's post-push setup notes) — until that secret exists, refresh PRs
  open but do not merge themselves.
- `discover` runs daily at 06:00 UTC and opens an additions PR for human review.
- `validate` runs on every PR (schema, README/JSON reproducibility, and the
  no-dead-entries gate — but not the age gate, since a discover PR is meant
  to sit open for multi-day review and must not be failed by its own age)
  and again on its own daily schedule at 05:30 UTC, where it additionally
  runs the 48-hour staleness gate on `last_checked`. That gate is a signal
  about whether the scheduled refresh is still alive rather than about any
  one PR, so its trigger has to be a clock: if it only ran when `main` was
  pushed, a dead scheduler would produce no PR, no merge, no push, and
  therefore no run of the check meant to detect it.

If the badge at the top of the README goes red, the automation has stopped and
the freshness claim no longer holds. That is intentional — silence must not read
as success.
