# Runbook

What to do when something goes wrong in production. Commands run from `apps/site/`. Rehearsed on staging on Oct 8, 2026 (go-live step 1.5).

## Roll back the code

Every deploy is a Worker version. Going back is instant and doesn't touch the database.

```
npx wrangler deployments list --env production        # find the previous version id
npx wrangler rollback <version-id> --env production --message "why"
```

Migrations are expand-then-contract, so the previous release always runs against the newer schema. On Oct 8 the v0.0.3 code served pages on staging after migration 0002 added 40 tables.

## Restore the database

Each production deploy prints a Time Travel bookmark in the GitHub Actions log (step "time travel bookmark") before it migrates. To go back to it:

```
npx wrangler d1 time-travel restore DB --env production --bookmark=<bookmark>
```

It asks to confirm, overwrites everything written since, and took 4 seconds on staging. Any point in the last 30 days also works with `--timestamp=<RFC 3339 time>`. After a restore, roll the code back to the release that matches that schema, or re-run `npx wrangler d1 migrations apply DB --env production --remote`.

## Seed the launch shwarms (go-live 3.1)

`scripts/seed-launch.ts` turns `docs/launch-shwarms.json` into core create commands as @myra (via seed), writes them as one `.sql` file under `apps/site/.wrangler/seed/`, and applies it with `wrangler d1 execute --file`. Run it from the repo root:

```
npx vite-node scripts/seed-launch.ts -- --offline                    # dry run, empty database, no Cloudflare
npx vite-node scripts/seed-launch.ts -- --target staging --dry-run   # what would change on staging
npx vite-node scripts/seed-launch.ts -- --target staging             # import, then read it back
```

The dry run lists every field it changed, normalized, dropped or couldn't parse, and exits 1 on any failure. A rerun skips slugs that are already there. Staging and local also get the running example (minecraft in doom, filled and live, with "block placement" and its thread) and six demo accounts that can't sign in; `--no-example` leaves them out. A remote file runs all or nothing, and the file starts with guards that stop it if staging changed since the plan.

**Re-seeding staging** after the JSON changes: `--target staging --replace`. The first seed on staging saves a Time Travel bookmark in `apps/site/.wrangler/seed-state.json`; `--replace` checks the JSON parses, restores that bookmark (wrangler asks to confirm and prints a bookmark that undoes it), applies the migrations again (the restore takes the schema back too), then seeds again. Everything written to staging after the bookmark goes, accounts included. The bookmark is saved only while staging holds no seeded node, so a seed from another checkout (another worktree has its own `.wrangler/`) saves none. Without a saved bookmark, pick a time from before the first seed and restore by hand, apply the migrations, then seed again:

```
npx wrangler d1 time-travel restore DB --env staging --timestamp=<RFC 3339 time before the seed>
npx wrangler d1 migrations apply DB --env staging --remote
```

Seeded nodes can't be deleted row by row: audit rows are append-only and point at them.

**Production** takes one approved shwarm at a time (3.10, 11.1) and refuses everything else: `--target production --allow-production --slugs <slug>[,<slug>]`. No example, no `--replace`, and wrangler asks before it applies. It applies only from a terminal: with no terminal (an agent's shell, CI) wrangler's confirm answers yes by itself, so the script refuses. `--dry-run` works anywhere.

## Rehearsal log

| date | where | what | result |
| --- | --- | --- | --- |
| 2026-10-08 | staging | bookmark → migrate 0002 → roll code back to the previous version → restore bookmark → re-migrate → roll forward | previous release healthy on new schema; restore 4 s, tables 44 → 4 → 44 |
