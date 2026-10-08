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

## Rehearsal log

| date | where | what | result |
| --- | --- | --- | --- |
| 2026-10-08 | staging | bookmark → migrate 0002 → roll code back to the previous version → restore bookmark → re-migrate → roll forward | previous release healthy on new schema; restore 4 s, tables 44 → 4 → 44 |
