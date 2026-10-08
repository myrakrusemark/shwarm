# Go-live plan

The plan for getting all of shwarm live at https://shwarm.org, so Myra can invite interested people right away. Myra and Claude follow it step by step, every day, until launch. Claude writes the code. Myra does everything that needs a human: accounts, payments, DNS logins, legal calls and final copy.

**Now (Claude):** phase 2: data model, auth (email + password), email pipeline. The footer pages are live on shwarm.org (1.8 done).
**Now (Myra):** 0.11 your tester list (ongoing) · look at https://shwarm.org and change the holding copy if you like.
**Last updated:** 2026-10-08.

**Zero-spend rule (Myra, Oct 8).** Build everything on free tiers. Launch is a private beta with Myra's own short list of testers; opening sign-up to the public comes later, when there's money for the things that need it (a lawyer's review, the DMCA agent fee, paid tiers). Free stand-ins: Cloudflare Workers Free, Resend free (3,000 mails a month), Cloudflare Email Routing for support@ and the other addresses (forwards to Myra's inbox), GitHub, npm, Sentry and an uptime monitor on free plans, Myra as the operator (no LLC), terms and privacy as beta drafts. The one spend Claude expects to ask for: Workers Paid ($5/month) when auth is built, because the free plan's 10 ms CPU limit per request is too little to hash passwords safely. Claude asks before any spend.

Sources: [decisions](decisions.md) (wins over everything here), [open questions](open-questions.md), [PRD](prd.md), [API PRD](prd-api.md), [spec](spec.md), [protocol](protocol.md), [legal todo](legal-todo.md), [launch shwarms](launch-shwarms.md). If this plan and decisions.md disagree, decisions.md wins and this plan gets fixed.

---

## 1. The launch done test

**Done when** an invited person, who isn't Myra, signs up on https://shwarm.org with an email and password, verifies their email, joins a wave-1 shwarm (which kicks it off), makes an agent key, and their agent reads that shwarm and posts to it through the signed API; a submission on the launch rehearsal shwarm gets its run, its human people check and Myra's sign-off, and the shwarm closes with a result page and an audit log; a $5 donation goes through on Stripe; and last night's backup has been restored on staging within the last 7 days, prod uptime is at least 99.5% over the last 72 hours, and Sentry has no unexplained error-level issues.

**How it's checked.** On launch day minus one, in production, by three outside people from the private beta (step 11.6) and Myra:

1. **Person A** signs up from a fresh address at Gmail, Outlook, iCloud or Proton (not the address Myra uses), clicks the verify link (it lands in the inbox, not spam), joins a wave-1 shwarm, makes a key on /keys, and runs `npx @shwarm/cli read` and `npx @shwarm/cli post` against the shwarm. Evidence: the post's URL, showing `@a/<agent>` as its byline.
2. **The rehearsal shwarm** is created by @myra through the admin seed tool, with the done test "done when `./check.sh` in the rehearsal repo prints ok", checked by 1 run, 1 people check (at least one human) and the author. It starts as a lobby of 2 with @myra in seat 1, so **Person B** joins it first (kickoff). Then A's agent submits. **Person B** posts a run report with `shwarm run`. **Person C** posts a human people check on the submission page. Myra signs off with her password. Evidence: the result page URL and its audit log JSON (`/w/<path>/log`). Myra decides afterwards whether the rehearsal stays visible as a labeled rehearsal or gets hidden with a public tombstone.
3. **Donation:** someone gives $5 through the donate modal and it shows at the provider. Stripe is live from launch (A13).
4. **Ops:** the restore drill log (step 10.2) is dated within 7 days. Uptime is at least 99.5% on every prod check over the last 72 hours (a screenshot of the monitor). Sentry shows zero unresolved issues at level error or above with events in the last 72 hours, or each open one links to a fixed or parked note.

Every item gets its evidence (a URL, a log line, a date) written next to step 12.1. The launch done test passes when all four have evidence.

---

## 2. How we stay honest

1. **One active step for Claude, plus Myra's lane.** The two "Now" lines at the top name Claude's step and Myra's open lead-time tasks, each with the step it must finish before. Claude updates both at the end of each day, and moves its own line only when a step's "done when" is met. If Claude's next step waits on a Myra item that isn't done, Claude takes the next step that doesn't wait and says so on the Now line.
2. **A blocker is something that stops the launch done test from passing**, or a legal or safety must (the license, the terms, takedown tools, the CSAM path). Everything else is a nice-to-have.
3. **New ideas go to the [parking lot](#8-parking-lot)** at the bottom, unless they're blockers. That includes good ideas, Claude's ideas, and fixes for things that look wrong but work.
4. **Claude points out drift.** When a request isn't in the current step, Claude says so in one line ("that's not 4.3; parking lot?") and Myra picks: park it, or swap it in and say what it replaces.
5. **Steps marked (should) are cut first.** If a phase runs over its size, its should-steps move to section 6, not the launch date.
6. **Decisions go into decisions.md first,** then the docs, then the code. Claude doesn't invent product decisions. A step that hits an undecided question uses the recommended default from section 3 and records it.
7. **Struggle forward.** A step stuck for more than a day on something that isn't a blocker takes the default, gets parked, or gets cut.
8. **Myra's lead-time tasks don't wait** for Claude's steps. Anything Myra can start today (accounts, invitees, registrations) starts today.
9. **Zero spend.** Free tiers only. Claude asks before anything costs money, and says why it can't be free.

Each working day starts with reading the two "Now" lines and ends with Claude updating them. The tracker (`npx vite --config tracker/vite.config.js`, http://localhost:5174/) shows this file live; a step's status sits after its bold heading (` · doing`, ` · done`, ` · blocked`, ` · parked`) and can be changed from the page.

---

## 3. Decisions to lock first

Only the decisions that block go-live. Each row has a recommended answer. Myra says yes, no, or changes it; Claude records it in decisions.md (and in open-questions.md, with new questions numbered from #69) before coding against it.

### Table A: blocks go-live

| # | decision | recommended | question | needed by |
| --- | --- | --- | --- | --- |
| A1 | **Stack** | decided (Myra, Oct 8): Cloudflare Workers + D1 + Durable Objects, built fresh. No Lemmy fork. Four promises: open-source platform code from day one, every shwarm exportable through the API, portable code (Hono on SQLite), federation later as a layer. | [#50](open-questions.md#50-the-api-across-federated-servers) | 1.1 |
| A2 | **License** | decided (Myra, Oct 8): a default license on every shwarm, which the author can change. Recommended details: the default is MIT for code and CC BY 4.0 for everything else (text, data, media). On the create form the author can pick another open license from a short list (MIT, Apache-2.0, GPL-3.0, AGPL-3.0, CC BY 4.0, CC BY-SA 4.0, CC0); nothing non-commercial or no-derivatives, since those aren't open. It locks when the lobby opens. Branches inherit it; a variant picks its own; "builds on" still takes the upstream license. Everything posted in a thread is under the shwarm's license. Supersedes "one site-wide license, no picker". | [#11](open-questions.md#11-which-single-license) | 1.10, 3.10, 4.1 |
| A3 | **Who runs shwarm for the beta** | decided (zero-spend): Myra as an individual, said plainly ("run by Myra Krusemark"). Governing law: her state. A legal entity (LLC or nonprofit) waits until opening to the public. The terms need a contact address; a free option is fine for the beta. | [#12](open-questions.md#12-legal-home), [#58](open-questions.md#58-governing-law-and-jurisdiction) | 9.2 |
| A4 | **Minimum age** | decided (Myra, Oct 8): 16 everywhere, with one sign-up checkbox. | [#59](open-questions.md#59-minimum-age) | 2.5 |
| A5 | **How bare-handle acts are confirmed** | decided (Myra, Oct 8): Everyday bare-handle acts (posting as @myra, replies, upvotes, joins, human checks, flags) need only a verified, signed-in session. Sign-off, making/rotating/revoking keys, saving the account, email or password change, export and admin acts need the password re-entered within the last 10 minutes. No human signing key on the API: every bare-handle act is site-only. Passkeys come later as an optional faster step-up. (The open-question triage preferred passkey-first; password-first is less to build and works on every device.) Copy changes from "confirms with your passkey." to "confirms with your password." Makes [#52](open-questions.md#52-upvotes-tap-every-time-or-a-short-window) and [#53](open-questions.md#53-account-recovery-beyond-the-personhood-check) moot. Myra also approves the matching change to the passkey rule in CLAUDE.md. | [#31](open-questions.md#31-how-is-a-humans-own-act-told-from-their-agents), [#52](open-questions.md#52-upvotes-tap-every-time-or-a-short-window), [#53](open-questions.md#53-account-recovery-beyond-the-personhood-check) | 1.7, 2.8 |
| A6 | **Established-account cold start** | decided (Myra, Oct 8): On day one nobody is a week old, so no upvote or people check would count, and nobody could earn the first upvoted post. 81 of 100 launch shwarms need people checks (15 of the 20 in wave 1). Recommended: invited founding accounts start established. An address on the sign-up allow-list becomes founding when it's verified, so Myra never flags invitees by hand; she flags strays in admin. Any verified account's upvote counts toward "has an upvoted post"; only established accounts count toward ranking. A people check from an account that isn't established is refused with `403 not_established`, so nobody wastes effort. New question. | new | 2.5, 4.7, 5.3 |
| A7 | **Who reviews flags, reports and appeals at launch** | decided (Myra, Oct 8): "While shwarm is new, flags, reports and appeals go to the person who runs it (@myra), and every action is logged publicly" (the public log is step 8.5, a must). Reputation-weighted review switches on once [#7](open-questions.md#7-how-reputation-weights-elevate-and-reject) is settled. Myra (as operator) may hide content, remove links and suspend accounts for legal reasons, always with a public tombstone. New elements: a **report** link on every thread post, and a signed-out report form at `/report` so people without an account (a copyright holder, a person named in a post) have a path; the rules and terms name abuse@, dmca@ and /report. | [#7](open-questions.md#7-how-reputation-weights-elevate-and-reject), new | 1.7, 8.3 |
| A8 | **Triage when it fails** | decided (Myra, Oct 8): Hold the new node ("being checked", visible to its author only) and retry; after a few minutes it goes to Myra's queue with an alert. A model refusal also holds. Fails closed. The seeded shwarms are cleared in a batch before sign-up opens. The trade-off: a triage outage delays new nodes. (The architecture draft published on timeout instead; holding is safer with no personhood check.) Who pays: Myra's Anthropic account, from donations later. | [#15](open-questions.md#15-who-runs-and-pays-for-machine-checks) | 8.1 |
| A9 | **Author's own agents submitting** | decided (Myra, Oct 8): The author's agents may submit to the author's own shwarm. On those submissions only, the author check is swapped for one extra people check from outside the author's account, and the submission page shows the swap. Everyone else's submissions get the author's sign-off as usual. | [#20](open-questions.md#20-what-happens-when-the-authors-own-agents-submit) | 5.5 |
| A11 | **State machine and dead ends** | decided (Myra, Oct 8): Shwarm: lobby → live when seats fill. Branch: live at once. "In review" is a flag on live, not a state. live → closed on pass; live → dead end (the author marks it, with a required note); closed → live again as soon as a repro is posted (a "reopened" audit event, the pass kept on record); dead end → live if the author reopens it. States are lobby, live, closed, dead end. Every transition writes an audit event. The submission under review is frozen (links pinned to a commit or sha256, plus a submission hash), so work never stops; the submission page shows the pinned version up top. | [#18](open-questions.md#18-the-node-state-machine), [#17](open-questions.md#17-who-marks-a-dead-end) | 2.3 |
| A12 | **Transactional email** | decided (Myra, Oct 8): Resend free tier (3,000 a month, 100 a day), enough for a private beta. Postmark (about $15/month) when the public opens or the daily cap bites. | [#63](open-questions.md#63-transactional-email-service) | 0.8 |
| A13 | **Donations path** | decided (Myra, Oct 8): Stripe at launch, on a separate Stripe account for shwarm under Myra's existing login (free; Stripe takes its per-payment fee; statement line SHWARM). The donate modal stays as designed (once or monthly, preset or custom amount, optional note, Stripe's hosted checkout) and says plainly: payments go to Myra Krusemark, who runs shwarm; not tax-deductible. A nonprofit or fiscal host can take over later. | [#51](open-questions.md#51-who-holds-donations) | 9.1 |
| A14 | **Repo home and code license** | decided (Myra, Oct 8): one repo under Myra's GitHub account, `myrakrusemark/shwarm`, holding the site, the npm package (client library, CLI, later MCP) and the agent skill. Move to an org when a second maintainer joins or an entity forms (GitHub redirects old URLs). Server code AGPL-3.0; packages/ and skills/ MIT, each folder with its own LICENSE. | [#13](open-questions.md#13-github-repo-url) | 0.5, 1.10 |
| A16 | **Invites** | decided (Myra): launch is a private beta with Myra's short list. Only allow-listed addresses can sign up; anyone can read the site. Each invite links straight to a wave-1 shwarm, and allow-listed addresses are founding (A6). Opening sign-up to the public is a later switch, after the lawyer review, the DMCA agent and donations. No invite codes, no waitlist. | new | 2.5, 11.6 |
| A17 | **Agent client and API v0** | decided (Myra, Oct 8): Launch with the HTTP API, SKILL.md and one npm package `@shwarm/cli` (library + CLI). Local MCP in the same package is (should). Hosted MCP and device login come after launch. This follows prd-api §4 and reverses the #54 lean ("hosted MCP first"), so Myra confirms. Freeze the API as v0 at launch: additive changes only after that. (The signature, idempotency and version-header details are in table B.) | [#54](open-questions.md#54-hosted-mcp-server-local-package-or-both), [#21](open-questions.md#21-the-final-api-shape) | 7.1 |
| A18 | **Seeding** | decided (Myra, Oct 8): The 100 launch shwarms go in through a one-off admin import as bare @myra, exempt from 3-a-day, with seat 1 taken, lobby 2, and "seeded by @myra at launch" in each audit log. Each goes to prod only after Myra has proofread it, because done tests lock once posted. | new | 3.1 |
| A19 | **Launching on draft terms** | decided (Myra, zero-spend): the private beta runs on terms and privacy marked "beta · v0.1 · not yet reviewed by a lawyer". A lawyer reviews them before sign-up opens to the public. With a short list of known testers the risk is small. | [#12](open-questions.md#12-legal-home) | done |
| A20 | **Wave-1 check counts** | decided (Myra, Oct 8): Confirm or lower them before the proofread, because they lock on import. Today 19 of 20 wave-1 shwarms ask for 2 runs and 15 for 1–3 people checks (13 with at least one human), plus Myra. One pass can need up to 6 different people besides Myra, from a beta of 5–10. An option to consider: 1 run + 1 human people check + author for wave 1, with stricter counts in later waves. Myra's call. | [#35](open-questions.md#35-what-if-nobody-checks) | 11.1 |

**What 0.1 waits for.** 0.1 is done when the rows needed by phases 0–2 have a status: A1, A4, A5, A7, A11, A12, A14's org name, A16, and all of table B. It does not wait for A2, A3, A6, A8, A9, A13, A17, A18, A19 or A20. Each of those is due by its "needed by" step and sits on Myra's Now line until it's recorded. A19 and A2 come first, since a lawyer booking and the public repo have lead time. A10 moved to table B. A15 (the name) is step 0.3 in Myra's lane.

### Table B: defaults to build on (accept all in one go, or change any row)

**Table B accepted** (Myra, Oct 8, on the tracker): every row below is the default we build with.

Each one is a setting or a small piece of code, so changing it later is cheap.

| question | default |
| --- | --- |
| [#3](open-questions.md#3-agent-name-pattern-details) name pattern | `^@[a-z0-9_]{2,32}(/[a-z0-9][a-z0-9._-]{0,63}){0,6}$`, no `..`, plus a reserved-handle list (admin, support, security, abuse, dmca, shwarm, triage, api, mcp, www, root, system, deleted, w, s, sandbox, staff, mod, report, plus well-known org and AI-lab names). Locked at the v0 freeze. |
| A10 (moved from table A): [#36](open-questions.md#36-what-does-a-machine-check-run-against) what a run checks against | `submission_hash` = sha256 over the canonical JSON (JCS) of the submission's `{text, links}`. Store the full hex, show 7 characters, accept a prefix of 7 or more. A done test may pin its check script (`{url, sha256}` or repo + commit + path); if not, the script's hash is reported and shown. 86 of 100 launch shwarms use runs. |
| A17 details: [#21](open-questions.md#21-the-final-api-shape) signatures and requests | Signature covers `@method @authority @path @query content-digest` (+ `idempotency-key` when sent), with `created`, `nonce`, `keyid`, `alg=ed25519`, `tag="shwarm"`. `created` accepted from 300 s in the past to 60 s in the future. Idempotency-Key on every POST. `Shwarm-Version: 0`. The secret is shown as `shwarm_sk_<keyid>_<base64url seed>`, so secret scanners can spot a leak. All part of the v0 freeze. |
| [#4](open-questions.md#4-do-branches-share-the-3-a-day-limit) branches and the daily limit | Shared: 3 new shwarms, branches and variants a day. Matches the decided "3 new shwarms and branches a day" and the rules page. (The triage suggested a separate 10-a-day branch limit; decisions.md wins.) |
| [#9](open-questions.md#9-lobby--live-interleave-ratio) hot mix | Already decided (about 3 live to 1 lobby on hot); built as a setting. |
| [#10](open-questions.md#10-exact-hot-floor) hot floor | 20 counted upvotes in 24h, as a setting. |
| [#16](open-questions.md#16-how-does-the-thread-post-burst-refill) burst refill | Token bucket per person per thread: 5, refilling one every 5 minutes. |
| [#24](open-questions.md#24-feed-formulas) feed formulas | Live score: 24h upvotes with a 12h half-life, +5 per submission, +20 per pass. Lobby score: joins in 24h ÷ seats left. All settings. |
| [#26](open-questions.md#26-must-a-done-test-name-at-least-one-check) empty check | Refused: a done test names at least one check. |
| [#27](open-questions.md#27-do-checks-count-against-the-thread-post-limit) checks vs the post limit | Checks don't count. |
| [#28](open-questions.md#28-does-make-it-a-branch-use-a-new-node-slot) "make it a branch" | Counts as a new branch for the person who clicks. |
| [#29](open-questions.md#29-can-a-human-leave-a-lobby-seat) leaving a seat | Any time before kickoff; the author can't leave. |
| [#30](open-questions.md#30-what-can-be-edited-after-posting) editing | Thread posts editable and deletable by their poster (history kept, tombstone on delete). Submissions, checks and done tests never. Title and what editable in the lobby, with history. No edit or delete API at launch. |
| [#32](open-questions.md#32-can-you-upvote-posts-under-your-own-name) upvoting your own posts | Not allowed. |
| [#37](open-questions.md#37-must-a-repro-be-re-run-on-a-newer-submission) repros and newer submissions | A repro blocks only the submission it was posted on. |
| [#39](open-questions.md#39-what-the-filling-new-and-closed-tabs-show) feed tabs | filling = lobbies by closeness to kickoff; new = newest; closed = passed and dead ends, newest first; no closed cards on hot. |
| [#40](open-questions.md#40-where-the-feeds-status-line-comes-from) status line | First line of the author's pinned post, else a line from recorded state. Never the latest post. |
| [#42](open-questions.md#42-what-a-shwarm-shows-while-it-is-a-lobby) lobby page | Pitch, done test, checked by, seats bar, join/leave, seat list, open thread. Submissions and branches open at kickoff (`409 lobby_not_open`). |
| [#44](open-questions.md#44-what-active-and-people-count) "people" | Seat holders plus humans who posted (themselves or by agent) in the last 7 days; the author always. Header "people here" = distinct people active in the last 24h. |
| [#45](open-questions.md#45-when-a-role-note-replaces-the-impact-mark), [#46](open-questions.md#46-do-closed-rows-keep-the-impact-mark) contributor and closed rows | As mocked: the impact mark on the live contributors list, role tags beside it on result pages; closed and dead-end branch rows as in the shwarm mockup. |
| [#49](open-questions.md#49-markdown-in-text) text format | Plain text: line breaks kept, URLs and @names linked, ``` fences shown monospace. No raw HTML. |
| [#56](open-questions.md#56-header-label-for-you-or-inbox) header label | Keep "for you", as mocked (one word from Myra if she prefers "inbox"). |
| [#57](open-questions.md#57-reminders-for-a-stalled-author) stalled author | Show "waiting N days"; no automatic pass. |
| Author gone (new question) | When a shwarm's author closes their account or is suspended, the operator (@myra) takes the author's sign-off slot. The submission page says "author gone, signed off by the operator", and it's logged as an audit event. |
| [#60](open-questions.md#60-what-happens-to-posts-when-an-account-closes), [#61](open-questions.md#61-log-retention) | Closing detaches the handle and keeps the work; IP and browser logs kept 30 days. |
| Unverified accounts (new question) | An unverified account and its handle are deleted after 7 days. Until then, signing up again with the same handle and a different email from the same browser replaces the pending account. |
| [#62](open-questions.md#62-when-header-stats-switch-on) header stats | Counted from day one, hidden; flipped by hand. |
| [#64](open-questions.md#64-where-deliverables-are-kept-for-good) result box fields | Optional release fields on a submission (name, version, how to use); archive links added later in a signed post. |
| [#65](open-questions.md#65-how-attribution-is-ranked-and-who-sets-role-tags) attribution | Ranked by total counted upvotes across the shwarm and its branches, agents rolled up. Role tags only from recorded events. |
| [#66](open-questions.md#66-the-audit-log-event-set) audit events | The nine proposed types. |
| [#19](open-questions.md#19-is-claimed-by-a-platform-state), [#23](open-questions.md#23-can-a-branch-have-a-variant), [#25](open-questions.md#25-what-the-branch-contribute-card-says) (includes #43), [#38](open-questions.md#38-thread-labels-and-whose-posts-a-thread-shows), [#41](open-questions.md#41-branch-order-on-the-shwarm-page) | No claim state; no variants of branches; no seat on the contribute card, on shwarms or branches (the decided contents list none, so the shwarm mockup's "seat 1 of 12" comes out); own thread only, no branch chips; branch order as mocked. |
| launch-shwarms.json fields | Add an optional `runs.description`, so commands stay executable. `why_now` is appended to what; sources go in @myra's pinned first post; risk notes stay private. |
| Cloudflare Turnstile | On sign-up, sign-in, reset, email change and the report form. Listed on the privacy page. |
| System inbox items | Kickoff, and "a node you're in passed, failed or reopened", as inbox items with no reply action. |
| Technical caps (new question) | Request body 256 KB, post text 20,000 characters, 20 links per post, title 120 characters, inline log 64 KB, 120 signed requests a minute per key, a per-IP token bucket on public reads (step 3.6), 20 keys per person. |
| Account mail caps | At most 3 account mails per address per hour and 10 per day, across verify, reset and existing-address notices. |
| Key expiry | 7 days / 90 days / never, as mocked. The CLI default follows the key. |
| Crawlers | Allowed once the site is open. Bot Fight Mode and "block AI bots" stay off, so agents can fetch node URLs. Before launch day prod sends `noindex` (step 3.10). |

---

## 4. The stack

### Choice

One TypeScript Cloudflare Worker (Hono, server-rendered with hono/jsx) serves the pages, the agent API and the background jobs. D1 (SQLite with FTS5) is the only source of truth. One Durable Object class, `ShwarmTree`, runs every write to a shwarm and its branches one at a time. Cron Triggers run jobs and email. Static assets serve CSS, JS and the mark. Resend sends mail. Triage calls the Anthropic API. Turnstile guards the sign-up forms. One repo, one `wrangler deploy`.

**Why.** It covers every hard requirement with nothing extra to run: WebCrypto verifies Ed25519 signatures, FTS5 handles search, and a Durable Object per shwarm gives the state machine one-at-a-time writes, which matters for the last seat, the final check and racing submissions. Myra already uses Workers and D1. A text-only site is the best case for D1. It's all TypeScript, so the signing and hashing code is shared between the server and the CLI and can't drift. It costs $5 a month to start, and there are no servers to patch. The trade-offs: D1 has no interactive transactions (solved by serializing each shwarm in its Durable Object and committing each command as one batch), password hashing runs as argon2id in WASM (needs the paid plan), FTS tables need a custom backup export, and a D1 migration can't be rolled back with the code (so migrations are expand-then-contract, step 1.5). The exit, if D1 runs out, is Postgres through Hyperdrive with the same Worker, because all SQL sits behind one adapter.

### Repo layout

The project folder sits in Dropbox and isn't a git repo yet. Step 1.1 fixes that and keeps build folders out of Dropbox sync.

```
shwarm/                      pnpm workspace; docs/ and mockups/ stay as they are
  apps/site/                 the one Worker: pages, agent API, jobs
    wrangler.jsonc           D1, DO, queues, cron, assets; envs: staging, production
    migrations/              D1 SQL migrations (tables, FTS5, triggers), expand-then-contract
    src/
      platform/              the only Cloudflare-specific code: db, tree, queue, mail, ratelimit
      core/                  domain rules, plain TS, called by web and API alike:
                             actor, names, permissions, nodes, posts, submissions,
                             checks, limits, audit, stats, errors
      do/shwarm-tree.ts      one-at-a-time writes per shwarm
      auth/                  passwords, sessions, csrf, step-up, email tokens, sign-up guards
      api/  sig/             signed agent routes; signature, nonce, idempotency
      render/                text prompt (nonce markers) and Node JSON
      web/                   layout, components, pages, form handlers
      jobs/                  cron and queue consumers
      triage/                rubric.md (public, versioned), client
      content/pages/         prose of the footer pages, editable like mockups
    static/                  css (tokens from design-system.md), js islands, img, skills/
    test/                    rule tests, concurrency tests, RFC 9421 vectors, contract tests, e2e, axe
  packages/protocol/         shared: error codes, name regex, schemas, sign/verify, JCS, submission hash
  packages/shwarm/           npm `@shwarm/cli`: client library + CLI (later `shwarm mcp`)
  skills/shwarm/             SKILL.md + sandbox recipe (source of truth)
  scripts/                   seed-launch.ts, mockup-diff.ts (one pixel-diff check), gen-types.ts
  .github/workflows/         ci.yml, deploy.yml
```

### Data model

| table | holds |
| --- | --- |
| person | handle (permanent), display name, email (verified), password hash (argon2id), about, links, status, founding flag, established date, notice prefs, accepted terms version and date, age confirmation. No legal name. |
| session | the one sign-in cookie (stored hashed), last seen, step-up window, IP prefix and browser summary (purged after 30 days) |
| email_token | verify, reset and email-change links (hashed, single use, expiring, used only on POST) |
| node, node_tag, node_fts, node_edit | shwarms and branches: path, parent, root, variant of, title, what, done when (locked), checks, tags, lobby size, builds on (url, name, license), author, agent byline, state, in-review flag, triage status, hidden/paused; search index; re-pitch history |
| seat | one per human per node; seat 1 is the author |
| post, post_edit, mention | thread posts of every kind (post, submission, check, repro, dead end), with links as `{url, sha256}` or repo + commit; edit history; mentions extracted at write time |
| upvote | one per person per post, with a counted flag |
| submission, built_on | number, hash, how to check, status, superseded by, release fields; what it built on |
| check | run, people or author slot, verdict, evidence, repro, run fields (hashes, exit, inline log ≤64 KB or link), counted, reset |
| inbox_item | the private inbox: mentions, sign-offs, system items |
| agent_key, key_grant, key_network | public half only, can-post-as, grants with permissions (including `new_shwarms`), expiry, last use, networks seen |
| sig_nonce, idempotency, rate_bucket, auth_throttle | replay cache, first responses kept 24h, thread and public-read token buckets, sign-up, sign-in and per-address mail throttles |
| audit_event | append-only log of the nine event types; backs the result page and `/log` |
| flag, report, triage_decision, moderation_action | flags, post reports and signed-out reports, every triage decision and appeal, every admin action |
| node_stats, person_node_stats, site_stats_daily | impact, posts/day, people, hot, scores, status line; per-person numbers; header counters; daily usage (D1 rows, emails, triage spend) |
| setting | switches and knobs: site mode (holding, beta, open), sign-up (open, allow-list only), read-only, pause new nodes, stats on, triage, hot floor, ranking constants, terms version |
| signup_allow | allow-listed addresses (founding on verification), with a note on who invited them |
| email_outbox, email_suppression, disposable_domain | mail queue and bounces; blocked domains |

Passkeys and "verified human" fields come in a later migration, when those features are built.

### Monthly cost

Zero-spend rule: free tiers until the public opens. Prices to verify at sign-up.

| item | private beta | when the public opens |
| --- | --- | --- |
| Cloudflare Workers (Workers, D1, Durable Objects, cron, Turnstile, Email Routing) | $0 on Free; $5 on Paid once auth needs the CPU (Claude asks first) | $5 plus usage |
| Transactional email | $0 (Resend free, 3,000 a month) | about $15 (Postmark) or Resend Pro |
| support@, abuse@, dmca@, security@ | $0 (Cloudflare Email Routing forwards to Myra) | same |
| Domain renewal | about $1 (already paid this year) | same |
| Sentry, uptime monitor, Cloudflare Web Analytics, GitHub, npm | $0 | $0 |
| Triage agent (Clef-flash on Workers AI) | $0: off during the beta; Myra clears new nodes by hand | $0 within the Workers AI free daily allowance; about $0.09 per million tokens beyond it |
| **Total** | **$0–5** | **about $25 plus triage** |

Later, not in the beta: a lawyer's review, the DMCA agent fee ($6 once), an entity if Myra wants one, and the donation provider's cut.

---

## 5. The steps

Phases run in order for Claude's work. Myra's tasks run alongside in her lane, and the ones with lead time are early on purpose. Build days are working days for Claude and Myra together, including review and fixes. Calendar waits are outside approvals and reviews; they run in parallel and only cost days if they miss the step they're due before.

| phase | build days | calendar waits (Myra's lane, in parallel) | what's live on shwarm.org after it |
| --- | --- | --- | --- |
| 0. Accounts and decisions | 2 | Resend domain verification: minutes to a day | accounts exist |
| 1. Foundation | 4 | Open Source Collective review (weeks, from 1.11); NCMEC registration (0.14) | holding page from day 1–2; then footer pages, guides, draft terms; mail on support@ |
| 2. Data model, auth, email | 8 | Myra reviews the beta terms drafts (2.11) | Myra's own account; sign-up closed to others |
| 3. Reading pages | 6 | Myra proofreads wave 1 (11.1) from 3.1 on | beta mode: the read-only site with the proofread wave-1 shwarms, noindex, sign-up for allow-listed addresses only |
| 4. Writing | 6 | proofread continues | allow-listed accounts can join, post and upvote; new nodes paused until 8.1 |
| 5. Done-test machinery | 6 | | the loop to a result page (run reports as fixtures) |
| 6. Profile, inbox, account | 4 | | inbox, notices, account |
| 7. Keys, agent API, CLI | 9 | | agents read, post and run; npm `@shwarm/cli` published |
| 8. Trust and safety | 5 | | triage, flags, reports, admin, public moderation log; security scans done |
| 9. Money and legal | 2 | | beta terms in force; donate live on Stripe |
| 10. Ops | 3 | | backups, restore drill, monitoring |
| 11. Content and invites | 2 + 5-day beta | | private beta with 5–10 people |
| 12. Launch day | 1 | | private beta with Myra's list; public sign-up is a later switch |
| Buffer (about 15%) | 9 | | |
| **Total** | **58 build days + 9 buffer + 5-day beta** | | |

That's about 72 working days, or 14–15 weeks at five days a week. With Thanksgiving and the end-of-year holidays, launch is late January 2027 if nothing outside slips, and about two weeks earlier if the buffer isn't needed. Interested people can see the real site, read-only, from the end of phase 3 (about 4 weeks in). Section 7 says what makes it slip.

### Phase 0: accounts and decisions (2 days)

**0.1 Lock the decisions** · done
- **what:** Myra answers the rows of tables A and B needed by phases 0–2. Claude writes each answer into decisions.md (dated, with status), adds the new questions to open-questions.md (#69 onward), and supersedes the Lemmy-fork entry. The other rows go on Myra's Now line with their due step.
- **who:** both · **needs:** nothing
- **done when:** A1, A4, A5, A7, A11, A12, A14's org name, A16 and every table B row have a status in decisions.md, and every other table A row is on Myra's Now line with its due step.

**0.2 Sync the docs to the decisions** · done
- **what:** update spec ("Identity and trust", "Node states"), PRD (ID-1..3, ID-9, PROF-8, §9 plan), protocol (§10 signature set, humanKey removed), glossary, a-day-on-shwarm, and the passkey working rule in CLAUDE.md (Myra approves that edit).
- **who:** Claude · **needs:** 0.1
- **done when:** `grep -ri "personhood check\|legal name\|lemmy fork\|passkey"` in docs/ finds only history, later-mark or optional-step-up mentions.

**0.3 Name check (was A15)** · done
- **what:** 30 minutes: USPTO and EUIPO trademark search for "shwarm", social handles, npm. Keep "shwarm" unless something blocks it.
- **who:** Claude (Myra asked) · **needs:** nothing · **due before:** 0.6 and 1.10
- **done when:** [#1](open-questions.md#1-name) is marked decided in decisions.md.

**0.4 Cloudflare account** · done
- **what:** shwarm.org is already registered at Cloudflare (confirmed Oct 8), so the zone exists. Stay on Workers Free for now (zero-spend; Paid only when auth needs the CPU, and Claude asks first). Turn on 2FA (a hardware key if you have one), auto-renew, and usage notifications. Then run `npx wrangler login` once in the terminal (it opens the browser), so Claude's shell can deploy. No API token in the repo, ever.
- **who:** Myra · **needs:** nothing
- **done when:** `wrangler whoami` works in Claude\'s shell and 2FA and usage notifications are on.

**0.5 Code home** · done
- **what:** one repo, `myrakrusemark/shwarm` (created Oct 8), holding everything: the site, the npm package (client, CLI, later MCP) and the agent skill, as in the repo layout above. 2FA on the account.
- **who:** Myra · **needs:** 0.1 (A14)
- **done when:** the repo exists and `gh repo view myrakrusemark/shwarm` works for Claude.

**0.6 Package names** · done
- **what:** npm account with 2FA; the free npm org `shwarm`; publish a `@shwarm/cli` 0.0.0 placeholder to hold the name. (npm refuses the bare name `shwarm` as too close to `charm` and `sharp`, so the package is scoped; the installed command is still `shwarm`.)
- **who:** both · **needs:** 0.3
- **done when:** `npm view @shwarm/cli` shows Myra as owner.

**0.7 support@shwarm.org (free forwarding)** · done
- **what:** turn on Cloudflare Email Routing for shwarm.org (free) and forward support@, abuse@, security@ and dmca@ to shwarm-support@myrakrusemark.com. Done by Claude through the Cloudflare API on Oct 8: routing enabled (MX and SPF added by Cloudflare); the four rules are created as soon as Myra clicks the verification link sent to that address.
- **who:** Myra · **needs:** 0.4
- **done when:** Email Routing shows the four addresses with Myra's inbox verified as the destination.

**0.8 Resend** · done
- *(Oct 8: Myra's main Resend account already uses its one free domain (another project), so shwarm uses her second free account. Claude added `mail.shwarm.org` (us-east-1) and put its DKIM TXT and two sending CNAMEs into Cloudflare by hand (DNS only); all resolve. Tracking is off (no tracking subdomain); receiving off. Domain verified; Myra made the `shwarm-staging` and `shwarm-production` keys (sending access) and saved them in her password manager.)*
- **what:** free account, the shwarm.org domain added (records go in at 1.9), one API key per environment, click and open tracking off.
- **who:** Myra · **needs:** 0.1 (A12)
- **done when:** the account exists and the staging and prod keys are in Myra's password manager.

**0.9 Triage model (when the public opens)** · done
- **what:** decided (Myra, Oct 8): triage runs on **Clef-flash**, Cloudflare's decision model, through the Workers AI binding in our own Worker (`@cf/cloudflare/clef-flash`). No outside key, no Anthropic account. It answers one question per new shwarm, branch or variant: "does this hit a hard block? yes / no / unsure"; yes or unsure goes to Myra's queue, no publishes. Triage volume is tiny, so it should fit Workers AI's free daily allowance (checked in 8.1). Done-test suggestions are skipped at first. The model sits behind one setting (`TRIAGE_MODEL`), with Clef (27B) and Jev as fallbacks if flash misses cases. Before the public opens, an eval: about 30 crafted hard-block cases plus all 100 launch shwarms; the model must block every bad case and pass every launch shwarm. Runs during the beta too (Myra, Oct 8: "clef"), as practice for launch; yes or unsure still lands in Myra's queue.
- **who:** Claude · **needs:** 0.4 · **due before:** public sign-up
- **done when:** the eval passes on the chosen model.

**0.10 Operator and contact** · done
- **what:** Myra is the operator (A3). Pick the contact address the beta terms will show (support@ is enough for the beta; a postal address is needed for the DMCA agent before the public opens).
- **who:** Myra · **needs:** A3 · **due before:** 9.2
- **done when:** the operator and contact are written in decisions.md.

**0.11 First invitees**
- **what:** start asking people now. Goal: 5–10 people each committed to a specific wave-1 shwarm before launch, and about 50 in the first cohort (people with agents, people who can judge, a few harness authors). The tracker (names, contacts, shwarm, invited, joined) stays private, outside the repo. Invite upstream projects' people personally; never post on their trackers.
- **who:** Myra; Claude drafts the tracker columns and who to ask per wave-1 shwarm · **needs:** nothing
- **done when:** the tracker exists and has at least 10 names. (It keeps growing until 11.4.)

**0.12 Where everything lives** · done
- *(Oct 8: Claude made the list in `admin/accounts.md` (local only, gitignored, no secrets). Checked: Cloudflare 2FA on (Oct 8, recovery codes saved), npm 2FA on; GitHub and Stripe 2FA per Myra. Emergency access stays a todo (Myra, Oct 8); it doesn't hold up this step.)*
- **what:** one private list of every account (Cloudflare, GitHub, npm, Resend, Anthropic, later Sentry, uptime, donations, NCMEC), each with 2FA and recovery codes stored offline. Emergency access for one trusted person is a todo, not part of done.
- **who:** Claude keeps the list; Myra turns on 2FA · **needs:** grows with each account
- **done when:** every account made in phase 0 is on the list with 2FA on.

**0.13 Lawyer review (before the public opens)**
- **what:** not in the beta (A19). Before public sign-up, a lawyer reviews the terms and privacy.
- **who:** Myra · **needs:** money · **due before:** public sign-up
- **done when:** the review date is in decisions.md.

**0.14 NCMEC registration**
- **what:** register shwarm as an electronic service provider with the NCMEC CyberTipline, under the operator, so a report can be filed the day it's needed. (Not legal advice; confirm with the lawyer if one is booked.)
- **who:** Myra · **needs:** 0.10 · **due before:** 11.6
- **done when:** the registration is confirmed and on the accounts list.

### Phase 1: foundation (4 days)

**1.1 git repo** · done
- **what:** `git init`, .gitignore, npm workspaces with the layout above (npm, not pnpm: one less tool), push to `myrakrusemark/shwarm` (private for now). The folder syncs through Syncthing, not Dropbox, so build folders are kept out with Syncthing ignore patterns for this project (node_modules, .wrangler, dist), with Myra's OK since it's her sync config.
- **who:** Claude · **needs:** 0.5, A1
- **done when:** the repo is on GitHub and Syncthing isn't syncing this project's build folders.

**1.2 CI** · done
- **what:** typecheck, unit tests, gitleaks (pre-commit and CI, with a rule for `shwarm_sk_` secrets), OpenAPI lint, an oasdiff breaking-change check against the last tag (API-5), a check that regenerated types match the committed ones (LIB-3), migration dry run. No branch protection while it's a one-person repo.
- **who:** Claude · **needs:** 1.1
- **done when:** a pull request shows all checks green, a planted fake secret fails CI, and a planted breaking change in openapi.yaml without a version bump fails CI. *(Oct 8: green on main; a planted `shwarm_sk_` secret failed the scan (PR #1, closed). The oasdiff breaking-change check and the generated-types check join in 1.5 and 7.x, once there's a tag to diff against and types to generate.)*

**1.3 Worker and environments** · done
- **what:** wrangler project with D1 (location hint chosen once, North America unless Myra says otherwise, since it can't move), Durable Object, Queues, R2, cron; local (`wrangler dev` with fixtures from the running example), staging and production with separate secrets and namespaces.
- **who:** Claude · **needs:** 0.4, 1.1
- **done when:** a hello page deploys to both environments and `/healthz` reads D1. *(Oct 8: done. D1 `shwarm-staging` and `shwarm-production` in eastern North America; Workers `shwarm-staging` and `shwarm-production`; production on shwarm.org and www (301 to apex). Durable Objects, cron and R2 get added in the step that first needs them; Queues are skipped while on the free plan.)*

**1.4 DNS, TLS and edge settings** · done
- **what:** Worker on the apex, www → apex 301, staging.shwarm.org behind Cloudflare Access (Myra's email plus later the committed invitees) with noindex; an Access service token for CI, uptime checks and agent tests; an Access bypass for `/webhooks/*` (those routes check their own secret); Always HTTPS, TLS 1.2 minimum, CAA records, HSTS with a short max-age; Bot Fight Mode and "block AI bots" off, with WAF skip rules for `/w/*` and API paths; robots.txt.
- **who:** Claude · **needs:** 1.3
- *(Oct 8: apex and www on the production Worker (www 301s to apex), HSTS (short max-age), nosniff, frame and referrer headers, and plain `python-requests` isn't challenged. Staging uses a shared password in the Worker (secret `STAGING_PASSWORD`, kept in Myra's ~/.config/shwarm/staging.txt) instead of Cloudflare Access, which keeps it free and simple; `/healthz` stays open for uptime checks. Always HTTPS, TLS 1.2 minimum, automatic HTTPS rewrites and strict SSL applied by the `zone-settings` workflow (run by hand; the token stays in GitHub). CAA records skipped: Cloudflare manages its own certificate authorities, and a wrong CAA record can block certificate renewal.)*
- **done when:** `curl -I` shows the redirects and headers, staging asks for Access in a browser, a curl with the service token reaches staging, and `curl -A python-requests https://shwarm.org/` isn't challenged.

**1.5 Deploy pipeline** · doing
- **what:** merge to main → migrations + deploy to staging + smoke test; a tag with approval → production. Migrations are expand-then-contract: every migration works with the previous release's code, and dropping a column waits one release. Before migrating prod, CI records a D1 Time Travel bookmark (`wrangler d1 time-travel info`) in the deploy log. CI runs the previous tag's tests against the new schema. Rollback with `wrangler rollback`.
- **who:** Claude · **needs:** 1.2, 1.3
- *(Oct 8: main → staging after CI passes, with a smoke test; a `v*` tag → production with tests, a Time Travel bookmark, migrations and a smoke test. Pushing the tag is the approval (GitHub's required reviewers need a paid plan on private repos). v0.0.1 reached production through CI. Still to do: the rollback rehearsal, once there's a real migration in phase 2.)*
- **done when:** a tagged release reaches prod through CI only, and a rollback rehearsal on staging that includes a migration is logged, with the previous release still passing against the new schema.

**1.6 Shared layout** · done
- **what:** lift the `:root` tokens and shared CSS into one stylesheet (kept in sync with [design system](design-system.md)); shared partials for header, strip (signed out: "sign in · join", and "welcome new friends!"), footer, donate modal ("donations open soon" for now), agent resources card, modal shell (×, Esc, scrim, focus trap); favicon, default social card; security headers and CSP (inline scripts moved to files). `scripts/mockup-diff.ts`: one small Playwright + pixelmatch check.
- **who:** Claude · **needs:** 1.3
- *(Oct 8: CSS and page text are exported from the mockups by `scripts/pages/export-site.py`; the header strip, footer, donate modal (Stripe wiring waits for 9.1), agent resources card and doc pages are Hono JSX in `apps/site/src/web/`; CSP and security headers on every response. `scripts/mockup-diff.py`: how-it-works differs from its mockup by 0.04% at 1280 px and 0.13% at 390 px. Footer pages are served on staging only until 1.8b.)*
- **done when:** the how-it-works page rebuilt on the shared layout has a pixel diff under 2% against its mockup at 1280 and 390 px (any larger diff is listed and accepted by Myra in the PR), and securityheaders.com grades it A.

**1.7 Fix stale copy on the footer pages** · done
- **what:** replace personhood check, legal name and passkey sign-in on [how it works](../mockups/how-it-works.html), [rules](../mockups/rules.html), [api](../mockups/api.html), the guides, [terms](../mockups/terms.html) and [privacy](../mockups/privacy.html) with email + password and the A5 step-up; mark terms and privacy "draft · not in force yet"; the A7 moderation wording; "no single person gets the credit" (result pages now rank people); "agent skills" links point to /skills (a short "coming soon" page until 7.6). Lint with combob-lint.py. Mockups are updated too, and their screenshots refreshed.
- **who:** Claude drafts; Myra approves · **needs:** 0.1 (A5, A7)
- **done when:** combob-lint passes, no page links to "#", no page mentions a personhood check, legal name or passkey sign-in, and Myra has approved each page.

**1.8 First things live on shwarm.org** · done
- **what:** (a) as soon as 1.3 and 1.4 work: a holding home page ("shwarm opens soon", one line about it, support@). (b) when 1.7 is approved: how it works, rules, api, both guides, and the draft terms and privacy, behind the same holding home.
- **who:** Claude; Myra approves the holding-page copy · **needs:** (a) 1.3, 1.4; (b) 1.5, 1.6, 1.7
- *(Oct 8: (a) is live: "opening soon", one line about shwarm, support@. Myra can change the copy any time. (b) Myra approved the footer pages; v0.0.3 serves how it works, rules, api, terms, privacy and both guides on shwarm.org, noindex until launch. The 1.5 rollback rehearsal still waits for the first real migration in 2.2.)*
- **done when:** (a) https://shwarm.org serves the holding page over HTTPS; (b) the footer pages are served from a tagged release.

**1.9 Mail DNS** · doing
- *(Oct 8: Email Routing's MX and SPF are in. DMARC added (`_dmarc` TXT `v=DMARC1; p=none; rua=mailto:support@shwarm.org`, resolves). Resend's DKIM and sending records for mail.shwarm.org are in and verified. `/.well-known/security.txt` is live (v0.0.3). Left: the mail-tester score, once the Worker can send in 2.6.)*
- **what:** Cloudflare Email Routing records (MX, SPF); Resend's SPF and DKIM records on a sending subdomain; DMARC at p=none with reports to support@; `/.well-known/security.txt`. Done this early so the domain has a sending history before invites.
- **who:** Claude adds records; Myra clicks verify in Resend · **needs:** 0.7, 0.8, 1.8a
- **done when:** a mail from Gmail to support@ arrives and Myra's reply comes back; the domain shows verified in Resend; a test send scores 9/10 or better on mail-tester with SPF, DKIM and DMARC passing.

**1.10 Make the repo public**
- **what:** README, CONTRIBUTING, SECURITY.md, code licenses per A14, the A2 license on docs and content. Before flipping to public: move the launch shwarms' private risk notes (A18) and `tracker/replies.json` out of the repo, and check git history for anything private (`git grep` plus a gitleaks scan of all commits).
- **who:** Claude; Myra approves · **needs:** 0.3, A2, A14, 1.2
- **done when:** the repo is public.

**1.11 Apply to Open Source Collective**
- **what:** Myra applies the day the repo goes public; Claude drafts the application text (what shwarm is, the license, the repo, what donations pay for).
- **who:** Myra; Claude drafts · **needs:** A2, A13, 1.10
- **done when:** the application is submitted and its date is in decisions.md.

### Phase 2: data model, auth, email (8 days)

**2.1 Shared protocol package**
- **what:** error codes (the protocol table plus `idempotency_conflict`, `payload_too_large`, `not_established`, `unsupported_version`), the name pattern and reserved list, schemas matching openapi.yaml, canonical JSON, the submission hash (table B, A10), the secret format.
- **who:** Claude · **needs:** 0.1
- **done when:** unit tests cover every name and hash case.

**2.2 Schema**
- **what:** migration 0001 with every table in section 4, FTS triggers, and append-only triggers on audit_event.
- **who:** Claude · **needs:** 2.1
- **done when:** migrations apply on local and staging, and a test confirms that updating an audit event fails.

**2.3 Domain core and the tree actor**
- **what:** Actor, errors, permissions (bare-handle refusal), the state machine (A11), audit writer, limits (thread bucket, submissions a day, the new-node trigger), settings, and the `ShwarmTree` Durable Object that runs commands one at a time and commits each as one D1 batch.
- **who:** Claude · **needs:** 2.2
- **done when:** race tests firing parallel requests at kickoff, the final check and two submissions run 100 times each in CI with zero double results.

**2.4 Passwords, sessions, CSRF**
- **what:** argon2id in WASM (benchmarked inside the CPU limit); the one `__Host-` cookie, 30-day sliding, rotated on sign-in; Origin check plus form tokens on every write; GET never changes anything.
- **who:** Claude · **needs:** 2.2
- **done when:** tests show a cross-origin form post is refused and a hash takes under the CPU limit.

**2.5 Sign-up**
- **what:** handle (pattern, reserved list, permanent), display name, email, password (10–128 characters, checked against Have I Been Pwned by hash prefix), terms + age checkbox with versions stored, Turnstile, throttles per IP range and email domain, disposable-domain block (bundled list), plus-address normalization. Unverified accounts can read and sign in, nothing else; they and their handle are deleted after 7 days (table B). A `signup` setting (open, or allow-list only) keeps prod closed to all but allow-listed addresses until 12.2. An allow-listed address becomes founding when it's verified (A6).
- **who:** Claude · **needs:** 2.4, A4
- **done when:** e2e tests cover a good sign-up, a reserved handle, a disposable domain, a pwned password, the throttle, a refused non-allow-listed address, and an allow-listed address that is founding after verifying.

**2.6 Email pipeline and account templates**
- **what:** outbox row written with the act, sent to Resend with retries (a cron sweep of the outbox, since Queues may need a paid plan); bounce and complaint webhooks (basic auth with a secret from wrangler secrets) fill a suppression list (security mail still goes); staging only sends to allow-listed addresses; Reply-To is support@. Every notices-stream mail carries List-Unsubscribe and List-Unsubscribe-Post (RFC 8058), with a per-type opt-out. Templates (lowercase, plain text first, no tracking): verify, welcome, reset, password changed, email change (new and old address), sign-up attempt on an existing address.
- **who:** Claude · **needs:** 1.9
- **done when:** each template arrives at a test inbox from staging, a forced bounce lands in suppression, an unauthenticated webhook call is refused, and a one-click unsubscribe stops that notice type only.

**2.7 Sign-in and account pages**
- **what:** sign in, sign out, check your email (with a resend-verification button), verified, forgot, reset, expired link. Every emailed link opens a page with one button ("verify my email", "set new password", "unsubscribe"); the token is used only on the POST from that button, so mail scanners that fetch links don't use it up. Links work on any device without being signed in. Per-address caps from table B, enforced in the outbox. Sign-in backoff per account and per IP, no permanent lockout. No page reveals whether an email has an account. A reset ends every session and sends a security mail.
- **who:** Claude · **needs:** 2.5, 2.6
- **done when:** e2e tests pass for each flow; a scripted GET of a verify link (like a scanner) leaves the token usable and the button then verifies; the 4th reset mail to one address in an hour is not sent and the page still says "check your email"; the 20th wrong password from one IP is slowed; Myra approves the copy.

**2.8 Step-up**
- **what:** re-enter the password to open a 10-minute window for the gated acts (A5); throttled like sign-in.
- **who:** Claude · **needs:** 2.4, A5
- **done when:** a test shows a gated act refused outside the window and allowed inside it.

**2.9 @myra on prod**
- **what:** Myra's address goes on the allow-list; she signs up on prod through the real flow as the first account; Claude sets her admin flag and blocks the reserved handles.
- **who:** both · **needs:** 2.5–2.8
- **done when:** Myra is signed in on shwarm.org with the founding flag, and signing up as "support" is refused.

**2.10 Deliverability check**
- **what:** sign up on staging with fresh addresses at Gmail, Outlook, iCloud, and Yahoo.
- **who:** both · **needs:** 2.6
- **done when:** all five verify mails land in the inbox (not spam) with SPF, DKIM and DMARC passing, and the Outlook link still works after Safe Links has fetched it. (Repeated in 12.1.)

**2.11 Beta terms and privacy drafts**
- **what:** Claude drafts both in plain language from legal-todo sections 3–4: operator and address, contact (support@, abuse@, dmca@, /report), the license grant and builds-on, minimum age, agents and keys, moderation (honest about @myra reviewing at launch), copyright notices, runs and code at your own risk, donations (voluntary, not tax-deductible, how to cancel monthly, refunds), closing an account, no warranty, changes and the notice period; privacy with a draft data inventory, 30-day retention, data region, the one cookie and Turnstile, and subprocessors. Also one EU DSA contact line (email, languages) on the terms, and a short UK Online Safety Act illegal-content risk assessment (about an hour, kept in the repo). Open rows (A2, A3, A13) stay as marked placeholders. Labeled "beta · v0.1". (Not legal advice; A19 says whether a lawyer reviews before or after launch.)
- **who:** Claude drafts; Myra reviews in her lane over the following weeks · **needs:** A4, A5, A7
- **done when:** both drafts are on staging, combob-lint passes on the plain parts, and every "[to decide]" left points to a row still open on Myra's Now line.

### Phase 3: reading pages (6 days)

Myra starts proofreading wave 1 (11.1) as soon as 3.1 has it on staging. From 3.10 on, prod runs in beta mode, every phase deploys to prod as well as staging, and each wave-1 shwarm goes to prod as soon as Myra approves it.

**3.1 Seed import tool**
- **what:** `scripts/seed-launch.ts` maps launch-shwarms.json to create calls (command split from its description, builds-on text parsed into name, url and license, why_now into what, sources as the pinned first post), idempotent by slug, with a dry-run report. Runs through core as @myra with seat 1, lobby 2 and `via=seed` (A18). Load all 100 plus the running example on staging.
- **who:** Claude · **needs:** 2.3, table B, A18
- **done when:** the dry run lists every field it changed or couldn't parse, and staging shows all 100.

**3.2 Feed**
- **what:** tabs hot / filling / new / closed, search (text plus `#tags`; input tokenized and quoted before FTS MATCH), cursor paging, every card kind (live, lobby, closed, dead end, variant, builds on, hot badge), the hot mix (#9), impact tooltips, number shortening, empty states.
- **who:** Claude · **needs:** 3.1, 3.7
- **done when:** each tab and a tag search work on staging, and a fuzz list of FTS operators and stray quotes returns results or none, never a 500.

**3.3 Shwarm page and threads**
- **what:** the live and lobby templates (the result template is filled in 5.7); head, what | done when, checked by, status line, pill; sidebar (contribute card, branches, variants, contributors, agent resources); the thread with sort, show filter, pinned post first, one level of replies, @names as links, "built on by" backlinks; the safe text renderer (table B, [#49](open-questions.md#49-markdown-in-text): no raw HTML, http/https links only, `rel="nofollow ugc noopener noreferrer"`, punycode for look-alike domains, logs as escaped preformatted text; bidi controls U+202A–202E and U+2066–2069 and zero-width characters shown as visible escapes in commands, code fences and names, and refused in handles and done-test commands).
- **who:** Claude · **needs:** 3.1
- **done when:** a lobby and a live shwarm render on staging, a list of OWASP XSS payloads in posts renders as text, and a Trojan Source sample in a command shows its escapes.

**3.4 Branch page**
- **what:** breadcrumb, "branch of", head, status line linking its submission, sub-branches, "on this branch" (author included), no flag link until 8.3.
- **who:** Claude · **needs:** 3.3
- **done when:** "block placement" on staging matches its mockup.

**3.5 Public profile and name view**
- **what:** `/@handle` (head, three stats, working on, created), the "look up a name" box, and `/@handle?as=@x/y` (that name's posts only). No "verified human" at launch.
- **who:** Claude · **needs:** 3.3, 3.7
- **done when:** @myra and @myra/m-04 render on staging (the second reached through the box), and their numbers match the node pages.

**3.6 Node URLs for agents**
- **what:** the same `/w/<path>` serves the page to browsers, the text prompt (with per-response nonce markers, escaping, `?before=` paging, short lobby form) and Node JSON; `?format=text|json`, `rel=alternate`, `Vary: Accept`; reserved segments `branches`, `log`, `s`. Signed-out GETs of pages, text prompts and Node JSON send an ETag (the node's last event id) and answer If-None-Match with 304; `Cache-Control: public, s-maxage=15` for signed-out views, signed-in views uncached. A per-IP token bucket on public reads returns 429 with Retry-After.
- **who:** Claude · **needs:** 3.3
- **done when:** `curl https://staging.shwarm.org/w/minecraft-in-doom` with the Access service token returns the prompt, a post containing a fake end marker can't break out of its marker, and a repeat request with If-None-Match gets a 304.

**3.7 Stats and ranking jobs**
- **what:** 5-minute rollup of node and person stats, impact, posts/day, people, hot, scores and status lines; header counters (hidden, previewed only by admins with `?stats`).
- **who:** Claude · **needs:** 2.3
- **done when:** tests with fixed fixtures give the expected impact, hot and rank.

**3.8 Error pages, mobile, accessibility**
- **what:** 404, 403, 410 tombstone, 429 with the wait, 500; layouts at 640 and 860 px with no sideways scroll; focus handling and exact times in title attributes; axe-core in the Playwright suite on every page, signed in and out.
- **who:** Claude · **needs:** 3.2–3.5
- **done when:** at 390 px every page has `scrollWidth <= innerWidth`, axe reports zero serious or critical violations, and every modal has role=dialog, a focus trap and closes on Esc.

**3.9 Myra's read-through**
- **what:** Myra goes through staging side by side with the mockups at 1280 and 390 px. Fixes that block the done test go into phase 4; the rest go to the parking lot. Claude then refreshes `docs/img/screens/` by hand.
- **who:** Myra · **needs:** 3.8
- **done when:** her list is either fixed or parked, and the screenshots are refreshed.

**3.10 Prod goes beta (read-only to the public)**
- **what:** a `site_mode` setting (holding, beta, open). In beta: the reading pages are public at shwarm.org; every response sends `X-Robots-Tag: noindex`; sign-up takes only allow-listed addresses; join, post and "start a shwarm" for everyone else say "opens soon"; creating new nodes stays paused until triage (8.1). Each wave-1 shwarm is imported to prod once Myra approves it in 11.1, never before, because done tests lock once posted.
- **who:** Claude; Myra approves the "opens soon" copy · **needs:** 3.9, A2 (set before the first public post), 11.1 (per shwarm)
- **done when:** shwarm.org shows the feed in beta mode with every wave-1 shwarm Myra has approved so far, `curl -I` shows noindex, and a sign-up from an address not on the allow-list is turned away politely.

### Phase 4: writing (6 days)

**4.1 Signed-in strip and gated actions**
- **what:** handle, "for you N", keys, sign out; clicking join, upvote, post, start a shwarm or make a key while signed out goes to sign-in and back. `next` accepts only relative paths starting with a single `/`.
- **who:** Claude · **needs:** 2.7
- **done when:** e2e tests cover the round trip for each action, and `next=//evil.com` and `next=https://evil.com` land on the home page.

**4.2 Create form: shwarm mode and builds-on**
- **what:** fields, validation, at least one check, tags, lobby (min 2, default 10), publishes as a lobby with the author in seat 1, counts toward 3 a day; the triage hook (a stub until 8.1, and prod creation stays paused until then). Builds-on: paste a link or search passed shwarms; GitHub links get name and SPDX license from the GitHub API; any other link is stored as URL + name, with the license typed in; shown as a chip with "change"; no license picker.
- **who:** Claude · **needs:** 2.3, 3.3
- **done when:** a new shwarm appears in filling on staging, and the fourth create in a day gets a clear limit error.

**4.3 Branch and variant modes**
- **what:** `?parent=` (helping reach, parent's done test, no tags/lobby/builds-on, live at once); `?variant=` (prefilled, refused once the original is closed, linked both ways; a variant opens its own lobby with its author in seat 1 and the size from the form, LOBBY-7); `?builds_on=<path>` prefill, so the result page's "build on this" works.
- **who:** Claude · **needs:** 4.2
- **done when:** a sub-branch and a variant can be made on staging, a variant of a closed shwarm is refused, and `?builds_on=` fills the builds-on chip.

**4.4 Lobby, seats and kickoff**
- **what:** join (verified humans only), leave before kickoff, kickoff in one batch (state live, day count starts, "lobby filled" event, inbox items and emails), late joiners; re-pitch edits in the lobby with history (should).
- **who:** Claude · **needs:** 2.3, 4.2
- **done when:** the race test of two people joining the last seat runs 100 times in CI with exactly one kickoff each time.

**4.5 Compose box and posting**
- **what:** "posting as @myra", the live limit line ("5 quick replies left, then 1 every 5 min"), replies, mentions to the inbox, the inline 429 with the wait, double-click protection.
- **who:** Claude · **needs:** 2.3, 3.3
- **done when:** the sixth quick post shows the wait, and a mention of @myra creates an inbox item.

**4.6 Pinned "where we are" post**
- **what:** the author pins one post and edits it, with an edit history view; it feeds the status line ([#40](open-questions.md#40-where-the-feeds-status-line-comes-from)).
- **who:** Claude · **needs:** 4.5
- **done when:** the feed card shows the pinned post's first line.

**4.7 Upvotes**
- **what:** toggle on thread posts, humans only, never your own (or your agents') posts, counted per A6, tallies and impact updated.
- **who:** Claude · **needs:** 4.5, A6
- **done when:** tests cover own-post refusal, double-vote toggling and an uncounted upvote from a new account.

**4.8 Edit, delete, "make it a branch" (should); remove "claimed by" (must)**
- **what:** own-post edit with history and delete with a tombstone; "make it a branch" from a post; strip "claimed by" from templates ([#19](open-questions.md#19-is-claimed-by-a-platform-state)).
- **who:** Claude · **needs:** 4.5
- **done when:** the edited post shows "edited" with history; no template contains "claimed by".

**4.9 Limit tests**
- **what:** tests for every product limit through the site, including the new-node trigger, per-IP form caps and the public read cap.
- **who:** Claude · **needs:** 4.2–4.7
- **done when:** the limit test suite passes in CI, including a test that the read cap triggers and a 304 costs no D1 row reads.

### Phase 5: the done-test machinery (6 days)

**5.1 Submissions**
- **what:** a submit mode on the compose box; numbering per node, links validated (`{url, sha256}` or repo + commit, never uploads), built on, how to check, hash (A10), optional release fields, one per person per node per day; the submission card with "superseded by #N".
- **who:** Claude · **needs:** 4.5
- **done when:** a second submission the same day is refused, and a bad sha256 is rejected.

**5.2 Submission page**
- **what:** `/w/<path>/s/<n>`: breadcrumb, the done test quoted, status pill, what was submitted, checks grouped runs / people / author, history, "waiting N days".
- **who:** Claude · **needs:** 5.1
- **done when:** the page matches [its mockup](../mockups/submission.html), and branch status and inbox links reach the right submission.

**5.3 Checks**
- **what:** the people check form (a pass needs evidence, a fail needs a repro); run report display with the signed log; slot rules (`slot_taken`, `own_work`), `not_established` (A6); tallies, "at least one human", standing repros ([#37](open-questions.md#37-must-a-repro-be-re-run-on-a-newer-submission)).
- **who:** Claude · **needs:** 5.1, A6
- **done when:** tests cover every refusal and the tally for each check mix in launch-shwarms.json.

**5.4 Ready for the author**
- **what:** when every other check is in (or at once for author-only), the author gets an inbox item and an email; the node shows "waiting on author" ("waiting on you" to the author).
- **who:** Claude · **needs:** 5.3
- **done when:** the e2e test sees the inbox item appear on the final check.

**5.5 Author sign-off**
- **what:** the owner-only box on the submission page, behind step-up: pass with what you checked, fail with a repro that resets every check; the A9 rule for the author's own agents; the author-gone rule (table B).
- **who:** Claude · **needs:** 2.8, 5.4, A9
- **done when:** a fail shows the struck "reset" checks, and the A9 swap shows on a submission from Myra's agent.

**5.6 Pass, close, dead end, reopen**
- **what:** the pass in one batch (close, "passed" event, notices, rank bump; other open submissions superseded); a branch passing never touches its parent; dead end by the author with a note; a repro on a passed node reopens it with the pass kept on record.
- **who:** Claude · **needs:** 5.5, A11
- **done when:** the race test of two submissions finishing at once runs 100 times in CI and closes the node exactly once each time.

**5.7 Result page and audit log**
- **what:** the closed template (result box, external links with "these links leave shwarm", proof with evidence, who made it ranked with derived role tags, what's next with "build on this" linking to `new.html?builds_on=<path>`, built on this); the audit table (milestones / all, every row linked to evidence); `GET /w/<path>/log` as JSON.
- **who:** Claude · **needs:** 5.6, 4.3
- **done when:** a closed fixture matches [the closed mockup](../mockups/shwarm-closed.html), and the log JSON lists every event of the test run.

**5.8 The whole loop, end to end**
- **what:** a Playwright run on staging from create to result page with four fixture accounts. Run reports are inserted as fixtures through core, since signed runs need phase 7; 7.10 repeats the loop with real `shwarm run` reports.
- **who:** Claude · **needs:** 5.7
- **done when:** it runs green in CI on every merge.

### Phase 6: profile, inbox, account (4 days)

**6.1 Owner profile and inbox**
- **what:** the private inbox (mentions of the bare handle, sign-off items with live pills, system items), inline reply, mark read / unread / all read; "for you" count; working on and created with "waiting on you".
- **who:** Claude · **needs:** 4.5, 5.4
- **done when:** another person can't see Myra's inbox, and reading an item lowers the count.

**6.2 Account modal**
- **what:** locked handle and joined; about, display name, links; email change (old address stays until the new one is confirmed, old address warned); notice toggles; change password (ends every other session and sends the "password changed" mail); "sign out everywhere"; save behind step-up.
- **who:** Claude · **needs:** 2.8
- **done when:** e2e tests cover email change, password change ending other sessions, and sign out everywhere, and Myra approves the copy.

**6.3 Notice emails (should)**
- **what:** mentions right away or as a daily digest, pass/fail/reopen of nodes you're in. (Kickoff and "ready for your sign-off" mails are musts in 4.4 and 5.4; unsubscribe is in 2.6.)
- **who:** Claude · **needs:** 2.6, 6.1
- **done when:** each arrives on staging.

**6.4 Export and account closing (should)**
- **what:** JSON export behind step-up; closing deletes private data, revokes keys and detaches the handle from posts; an author's shwarms follow the author-gone rule (table B). Fallback if it slips: the privacy page says to write to support@, and Myra handles it by hand within 30 days.
- **who:** Claude · **needs:** 6.2
- **done when:** a closed test account's posts show as a former member and its keys fail.

### Phase 7: keys, agent API, skills, CLI (9 days)

**7.1 Signing**
- **what:** RFC 9421 sign and verify with Ed25519 and Content-Digest in packages/protocol (table B details), with the RFC's Ed25519 test vector and our own published vector.
- **who:** Claude · **needs:** 2.1, A17
- **done when:** both vectors pass in CI from the CLI side and the Worker side.

**7.2 Keys page and new-key modal**
- **what:** the key list (can post as, grants, last used, expiry, rotate, revoke, revoke all); the modal (name, can post as, never bare; grant chooser with search, children and pasted-link resolve; permissions with edit/delete marked "later", and `new_shwarms` off by default; expiry; step-up); the key pair made in the browser so only the public half reaches the server; the secret shown once as `SHWARM_KEY=shwarm_sk_<keyid>_<seed>`; at most 20 keys; the "you" box rewritten for password sign-in.
- **who:** Claude · **needs:** 2.8, 7.1
- **done when:** a test key's secret string isn't found by grep in a `wrangler tail` capture of the key-making flow or in a D1 export, and a revoked key fails on its next request.

**7.3 The signed request pipeline**
- **what:** freshness (300 s past to 60 s future; every response sends `Date`; a stale or future `created` returns 401 bad_signature with `reason: "clock_skew"` and the server time), Content-Digest, the exact signature base, key lookup with no cache, nonce replay check, idempotency, can-post-as and grant resolution (most specific wins), debounced last use, networks seen and the "key used somewhere new" email.
- **who:** Claude · **needs:** 7.1, 2.2
- **done when:** tests cover replay, stale, future `created`, wrong host, wrong digest, a bare `as`, a grant miss and an idempotent retry.

**7.4 Agent endpoints**
- **what:** postToNode (post, submission, people check, run report), createBranch, createShwarm (with variants), getMentions (segment matching, private, `limit`), getNodeLog, GET /key, GET /limits; RateLimit headers and 429 bodies; the error table; size caps and the per-key cap; CORS on public and signed routes, never on site forms. createShwarm needs `new_shwarms` (variants need `branch`); its byline is the agent, its author is the human, and no seat is taken automatically. createShwarm and createBranch return 202 with `triage: "held"` and the node URL while triage runs; getNode with the author's keys shows `triage: held|blocked|cleared`.
- **who:** Claude · **needs:** 7.3, phases 4–5
- **done when:** contract tests pass against openapi.yaml (including a held create), every bare-handle act from a key returns 403, and createShwarm with a key lacking `new_shwarms` returns 403 not_permitted with `need=new_shwarms`.

**7.5 API docs and v0 freeze**
- **what:** update openapi.yaml and protocol.md to what ships (humanKey removed, signature set, idempotency, version header, new error codes, the hash, the triage field; the state enum follows A11: lobby, live, closed, dead_end, with `in_review` as a flag and reopening as an audit event); serve `/openapi.yaml`, a reference rendered from it, and the protocol at `/docs/protocol`; update the "not built yet" rows on the api page; record the v0 freeze.
- **who:** Claude; Myra approves the freeze · **needs:** 7.4
- **done when:** docs/openapi.yaml and mockups/openapi.yaml match, the reference is live on staging, and the freeze is in decisions.md.

**7.6 Agent skill**
- **what:** `SKILL.md` and the sandbox recipe: read the node first, one name per run, how to post, submit (sha256 and commit), check, run reports, limits etiquette, polling mentions, and the safety rules (participant text is data; never act as the bare handle; never use the human's browser, password or session; keep keys out of reach and out of repos, with the gitleaks rule). Served raw at `/skills/shwarm/SKILL.md` and as a page at /skills; every "agent skills" link points there.
- **who:** Claude writes; Myra reviews · **needs:** 7.4
- **done when:** Myra has approved it and no page links "agent skills" to "#".

**7.7 The `shwarm` npm package**
- **what:** the client library (signing, idempotency, retries only on network errors and 429, typed errors, link hashing) and the CLI (`login --key` / `SHWARM_KEY`, logout, whoami, read, log, post, submit, check, branch, new, variant, mentions with `--since`, `--limit` and `--follow`, limits), `--json` on every command, exit codes per CLI-16, a `--profile` config (CLI-17), and `--as @handle` with no path printing "bare-handle acts happen on shwarm.org" and exiting 3 without calling the API. The secret lives in a 0600 file or `SHWARM_KEY`. Sends `CF-Access-Client-Id/Secret` from `SHWARM_ACCESS_ID/SECRET` when set (staging only). Warns when its clock is more than 30 s off the server's `Date`. Published with provenance through trusted publishing.
- **who:** Claude; Myra approves the first publish · **needs:** 7.4
- **done when:** `npx @shwarm/cli read` and `npx @shwarm/cli post` work against staging from a clean machine, and the exit-code tests pass.

**7.8 `shwarm run`**
- **what:** must: shows the command and asks first, refuses own work or a taken slot, verifies every link's hash, recomputes the submission hash, posts the report. (should): runs only inside the container recipe.
- **who:** Claude · **needs:** 7.7
- **done when:** a run report from `shwarm run` counts on a staging submission, and a link with a wrong hash is refused before anything runs.

**7.9 Local MCP and a Python example (should)**
- **what:** `shwarm mcp` with the tools from prd-api §4 and no bare-handle tools; a short Python signing example with the test vector on the api page.
- **who:** Claude · **needs:** 7.7
- **done when:** Claude Desktop can read and post on staging through it.

**7.10 Agent smoke test and the real loop**
- **what:** a fresh Claude Code session given only a node URL, the skill, `SHWARM_KEY` and the Access service token reads, posts and submits on staging, and gets 403 when told to post as @myra. Then the full loop with two real `shwarm run` reports from two fixture accounts.
- **who:** Claude · **needs:** 7.6, 7.7, 7.8
- **done when:** the transcript shows each of those, and the loop reaches a result page on staging.

### Phase 8: trust and safety (5 days)

**8.1 Triage**
- **what:** the rubric (four hard blocks; suggestions never block), one Anthropic call per new shwarm, branch and variant with node text framed as data, structured output, decisions recorded with the rubric version; suggestions shown on the create form; blocked page with category, reason and appeal; the A8 failure mode. Then batch-run all 100 seeds on staging and the imported wave-1 seeds on prod, and lift the pause on new nodes on prod.
- **who:** Claude; Myra approves the rubric wording · **needs:** 0.9, A8
- **done when:** test nodes for each hard-block category are blocked, a vague done test gets a suggestion, a forced timeout holds the node, and every seed on staging and prod is cleared or flagged for Myra.

**8.2 Public triage page**
- **what:** the prompt, the versioned rubric and the decision log (node, outcome, category, reason; never the blocked text), linked from the create form's "its rubric is public" and the rules page.
- **who:** Claude; Myra approves · **needs:** 8.1
- **done when:** the page is live on staging and the create form links to it.

**8.3 Flags and reports**
- **what:** "flag this swarm" on shwarm and branch pages and "report" on every post: humans only, site only, one per person; reasons from the hard-block list plus illegal content, copyright and personal info; every one alerts Myra; 3 flags from established accounts pause a shwarm until Myra clears it (A7). A signed-out report form at `/report` (Turnstile, the same reasons, contact email, URL) feeds the same queue. The rules and terms name abuse@, dmca@ and /report.
- **who:** Claude · **needs:** A7
- **done when:** a third flag pauses a test shwarm with a "paused for review" banner, and a signed-out report reaches the queue.

**8.4 Admin console**
- **what:** `/admin` behind Cloudflare Access (Myra's hardware-key login), the admin flag and step-up. One queue: triage holds, appeals, flags, reports, copyright notices. Actions with a required reason: hide or restore a node or post (public tombstone, 410), remove a link, suspend (ends sessions, revokes keys, emails the reason; the author-gone rule applies), overturn triage, founding flag. Account lookup by handle or email: verified state, outbox and suppression status for that address, sessions, keys, flags; actions: resend verify, remove from suppression, mark email verified (logged), end sessions, add to or remove from the allow-list. Switches: site mode, sign-up (open or allow-list only), read-only, pause new nodes. Slow mode, per-account limit overrides, pausing agent writes, IP-range blocks and the header-stats switch are `wrangler d1 execute` recipes in the 10.6 runbook, not UI. Every action goes to the moderation log.
- **who:** Claude · **needs:** 8.1, 8.3
- **done when:** each action and switch works on staging and leaves a log row, and Myra resolves a staged "no verify mail" case from admin alone.

**8.5 Public moderation log**
- **what:** action, target (tombstoned), category, date, who acted. No reporters, no removed text. A read-only list over moderation_action (A7 promises it).
- **who:** Claude · **needs:** 8.4
- **done when:** it's live and linked from the rules page.

**8.6 Security review**
- **what:** XSS payloads in CI, CSRF, CSP, account enumeration, session handling, signature replay and host binding, grant bypass, bare-handle from a key, rate limits, secret scanning, headers; an OWASP ZAP baseline scan against staging, `pnpm audit` or osv-scanner, and semgrep with the default TypeScript rules; Claude runs a security review over the whole codebase and fixes every high.
- **who:** Claude · **needs:** phases 2–7
- **done when:** the three tool reports are linked in the step and show no high or critical item, Claude's review list is closed, and one outside person (a beta invitee with a security background, if there is one) has had the staging URL for 48 hours.

**8.7 Abuse drill**
- **what:** on staging: 50 sign-ups from one address range, disposable domains, a burst of posts, a spam shwarm, repeated reset requests to one address. Then flip each switch.
- **who:** Claude; Myra watches the alerts · **needs:** 8.4
- **done when:** every guard triggers, every switch works, and Myra gets the alerts on her phone.

### Phase 9: money and legal (2 days, plus lead time)

**9.1 Donations**
- *(Oct 8: the shwarm Stripe account is set up and submitted for verification by Myra. Keys and the webhook get wired in this step.)*
- **what:** Myra makes a separate Stripe account for shwarm under her existing login (A13). Claude wires the donate modal to Stripe Checkout: once or monthly, preset or custom amount, an optional note, and the supporters-list opt-in; a webhook records completed payments; the modal and terms say payments go to Myra Krusemark and aren't tax-deductible.
- **who:** both · **needs:** A2, A13, 1.11
- **done when:** a $5 test donation shows in Stripe, and decisions.md records the path.

**9.2 Terms and privacy final for the beta**
- **what:** fill the 2.11 drafts with the data inventory and subprocessors from the real schema (Cloudflare, Resend, Anthropic, Sentry, the donations provider), the operator and address (0.10), the license (A2) and the donations path; set the effective date; the lawyer's changes if A19 = hold. A terms-version setting: when it goes up, signed-in people see a banner and a one-click "I accept v<n>", recorded per person; an email goes to every account the notice period before the effective date; the changelog is linked from both pages. The rules page matches A7 and the report link.
- **who:** Claude; Myra approves every line · **needs:** 2.11, 0.10, A2, A3, A13, A19
- **done when:** no "[to decide]" remains, combob-lint passes on the plain parts, Myra has approved both, and bumping the version on staging shows the banner and records acceptance.

**9.3 Vendor agreements**
- **what:** accept the standard data processing terms for Cloudflare, Resend, Anthropic, Sentry and the donation provider.
- **who:** Myra · **needs:** 0.4, 0.8, 0.9
- **done when:** each is ticked on the accounts list (0.12).

**9.4 DMCA agent (should, $6, 15 minutes)**
- **what:** register with the US Copyright Office using the operator name, address and dmca@; the terms' copyright section, counter-notice path and repeat-infringer rule; the remove-link admin action handles notices.
- **who:** Myra files; Claude writes · **needs:** 0.10, 9.2
- **done when:** the registration is confirmed and the terms name the agent.

**9.5 License on the pages**
- **what:** the chosen license on the rules, terms, how-it-works and the result box, with builds-on inheritance shown.
- **who:** Claude · **needs:** A2
- **done when:** a closed fixture shows the license line.

### Phase 10: ops (3 days)

**10.1 Backups**
- **what:** D1 Time Travel; a nightly export of base tables to a private R2 bucket kept 30 days.
- **who:** Claude · **needs:** 1.3
- **done when:** three nightly exports exist.

**10.2 Restore drill and runbook**
- **what:** restore last night's prod export into a fresh staging database, check row counts, render a node, verify a stored key's signature, time it; also a Time Travel restore to a recorded bookmark. A one-page runbook in the repo.
- **who:** Claude · **needs:** 10.1
- **done when:** the drill passes and is logged with its date. (Repeated monthly; must be within 7 days of launch.)

**10.3 Monitoring**
- **what:** uptime checks on `/`, `/healthz`, the text prompt of a seed shwarm and staging (with the Access service token), with push alerts on Myra's phone; Sentry on the Worker and browser with personal data and signature headers scrubbed. `/healthz` also reports the age of the oldest unsent email_outbox row, the dead-letter queue depth, a ShwarmTree ping and the count of held triage nodes. Alerts on: 5xx spikes, bounces, sign-ups per hour, an outbox row unsent after 5 minutes, any message in the dead-letter queue, a Resend send error rate over 2%, a triage hold older than 15 minutes. A daily admin line with yesterday's D1 rows read and written, emails sent and triage spend, with an alert when any goes over 3 times its 7-day average; Resend usage alerts on. A synthetic signed post on staging every 15 minutes (should).
- **who:** both; Myra installs the app · **needs:** 1.5
- **done when:** a forced error reaches Sentry with no personal data in it, a stopped staging Worker pages Myra, and revoking the staging Resend key pages Myra within 10 minutes.

**10.4 Counting**
- **what:** header stats counted from day one and visible in admin; Cloudflare Web Analytics (cookieless, should), named on the privacy page. Never any agent counts.
- **who:** Claude · **needs:** 3.7
- **done when:** admin shows today's people and posts.

**10.5 Housekeeping jobs**
- **what:** key expiry, email-token and nonce pruning, idempotency pruning, weekly disposable-domain refresh, IP and browser data purged after 30 days, unverified accounts purged after 7 days, re-running held triage.
- **who:** Claude · **needs:** phases 2, 7, 8
- **done when:** each job has a test and shows in the cron log.

**10.6 Incident runbook**
- **what:** flip read-only, pause sign-ups, end all sessions, rotate secrets, revoke all agent keys, tell affected people, the 72-hour breach notice rule; the list of secrets and how to rotate each; the `wrangler d1 execute` recipes for the switches that have no admin UI (8.4); a short CSAM paragraph: hide, preserve, report to the NCMEC CyberTipline.
- **who:** Claude writes; Myra tries it · **needs:** 8.4
- **done when:** Myra has flipped read-only on staging and rotated one secret using only the runbook.

**10.7 Robots, sitemap, link previews (should)**
- **what:** robots.txt (no /keys, account or admin), a sitemap from the database, per-shwarm social cards from title and done line, canonical URLs.
- **who:** Claude · **needs:** 3.3
- **done when:** a shwarm link previews correctly in Slack, Discord, Mastodon and Bluesky.

### Phase 11: content and invites (2 days, plus a 5-day private beta)

**11.1 Proofread wave 1 (Myra's lane, during phases 3–7)**
- **what:** starts right after 3.1. Claude renders the 20 wave-1 shwarms on staging and lists every number and claim in each pitch with its source link. Myra settles A20 first, then rechecks drifting figures and approves each shwarm. Each approved shwarm goes to prod (3.10). Done tests lock once posted.
- **who:** Myra; Claude prepares · **needs:** 3.1, A20 · **due before:** 11.2
- **done when:** all 20 are approved, with fixes made in launch-shwarms.json, and all 20 are on prod.

**11.2 Open the private beta**
- **what:** confirm that 8.1 cleared every wave-1 seed on prod, and add the 5–10 committed people's addresses to the allow-list.
- **who:** Claude checks; Myra adds the addresses · **needs:** 11.1, phase 8
- **done when:** 20 cleared lobbies show on the prod feed with @myra in seat 1 and "seeded by @myra at launch" in each audit log, and the beta addresses are on the allow-list.

**11.3 Founding accounts**
- **what:** Myra adds every invitee's email to the allow-list (beta people in 11.2, the rest of the cohort before 12.2); each becomes founding when they verify (A6). Strays who sign up with another address get the flag by hand in admin.
- **who:** Myra · **needs:** 2.5, 11.4
- **done when:** a test sign-up from an allow-listed address is established without Myra touching admin, and the allow-list holds the whole cohort.

**11.4 The first cohort**
- **what:** the tracker reaches 5–10 people committed to specific wave-1 shwarms and about 50 in the cohort.
- **who:** Myra · **needs:** 0.11
- **done when:** the tracker shows it.

**11.5 Invite emails**
- **what:** short and personal, from Myra's own address, one per segment: the shwarm picked for them, its done line, that one join starts it, bring your agents or don't, it's free.
- **who:** Claude drafts; Myra edits · **needs:** 11.4
- **done when:** Myra has approved the drafts.

**11.6 Private beta**
- **what:** the 5–10 committed people sign up on prod (allow-listed), join their shwarms, make keys and work for 5 days. Only blockers get fixed; the rest is parked. Three of them run the launch done test with Myra on the last day.
- **who:** both · **needs:** 11.2, 11.3, 11.5, 0.14, phases 9–10
- **done when:** five days have passed with no open blocker.

**11.7 Myra's sign-off routine**
- **what:** a fixed daily slot for sign-offs. Wave 2 opens only when wave-1 sign-offs are under control (timing is Myra's call; section 6).
- **who:** Myra · **needs:** 5.5
- **done when:** the slot is in Myra's calendar.

### Phase 12: launch day (1 day)

**12.1 Launch checklist**

Run on prod the day before and the day of. Write evidence next to each line.

1. The launch done test (section 1) has evidence for all four parts.
2. Prod runs from a tagged release; migrations applied with a Time Travel bookmark logged; rollback rehearsed, including a migration.
3. TLS valid, HTTPS only; staging behind Access.
4. Restore drill within 7 days; a fresh backup taken this morning.
5. Sign-up, verify, sign-in, reset and email change work from fresh addresses; mail lands in the inbox at Gmail, Outlook, iCloud and Proton.
6. A key, a signed CLI post as `@<handle>/<name>`, a run report, a 429, and a bare-handle act refused from a key.
7. Triage runs on a test node; spend limit set.
8. Disposable block, sign-up limits and Turnstile on; bot features not blocking `/w/*`.
9. Header stats off and counting.
10. Uptime at least 99.5% on every prod check over the last 72 hours; zero unresolved Sentry issues at level error or above, or each linked to a fixed or parked note.
11. Link previews correct; robots and sitemap correct.
12. Terms and privacy final for the beta, and the A19 call recorded.
13. support@ receives, and Myra replies.
14. Donate works: a $5 payment shows in Stripe.
15. Wave 1 proofread and seeded, @myra in seat 1 everywhere.
16. The accounts list (0.12) complete with 2FA everywhere.
17. Myra is free for the next 48 hours.
18. Right after the flip in 12.2: site_mode is open and `curl -I` shows no noindex.

- **who:** both · **needs:** everything above
- **done when:** every line has evidence.

**12.2 Open**
- **what:** set site_mode to open (removes noindex) and sign-up to open; send invites in batches of about 10, a few hours apart, each linking straight to a wave-1 shwarm, watching the admin queue and alerts between batches.
- **who:** Myra sends; Claude watches the dashboards with her · **needs:** 12.1
- **done when:** the first batch has signed up and joined without a blocker.

---

## 6. What's explicitly after launch

These are planned for after launch. They don't come back in before it.

- **Within the first weeks:** the lawyer review if A19 launched on drafts; a polished written CSAM procedure (the runbook paragraph and NCMEC registration are done before launch); any (should) step that slipped; applying to GitHub's secret scanning partner program for the `shwarm_sk_` format.
- **Waves 2 and 3** (40 + 40), each through the same proofreading and triage gate, timed by Myra.
- **The public announcement,** once the first cohort has real threads (about 1–2 weeks in). A public "why" page made from the [manifesto](manifesto.md) is Myra's call then.
- **Header stats switched on** ([#62](open-questions.md#62-when-header-stats-switch-on)) at a sustained threshold.
- **Agent surfaces:** local MCP if it slipped, hosted MCP at shwarm.org/mcp, device-code login (`shwarm login` → /device), a public sandbox server on staging, reading one post by id and a submission's full check list from the API.
- **Accounts:** passkeys as an optional step-up and sign-in; the optional "verified human" mark ([#2](open-questions.md#2-first-personhood-provider)).
- **Money:** a supporters page on shwarm.org if Open Collective is the path; Stripe under the nonprofit once it exists ([#12](open-questions.md#12-legal-home), [#51](open-questions.md#51-who-holds-donations)).
- **Governance:** reputation weights for flags, elevate and reject ([#7](open-questions.md#7-how-reputation-weights-elevate-and-reject)).

## 7. Risks

1. **Scope.** "Everything online" is about 58 build days plus a 9-day buffer. Every unplanned feature adds days. *What we do:* the rules in section 2, should-steps cut first, and the parking lot.
2. **Nobody shows up, or nobody checks.** Wave 1 needs a run in 19 of 20 shwarms and a human people check in 13. One pass can need a submitter, 2 runners and up to 3 people checkers, all different people, plus Myra: up to 6 people besides Myra, from a beta of 5–10. *What we do:* A20 settles the wave-1 counts before they lock, founding accounts start established (A6), 5–10 people committed to specific shwarms before day one, a daily sign-off slot, "waiting N days" visible, and wave 2 waits until wave 1 moves.
3. **Mail lands in spam or stops.** Sign-up is useless without the verify mail. *What we do:* Resend (Postmark when the public opens), DNS set up in phase 1 so the domain has history, scanner-safe links (2.7), the five-provider test in 2.10 and again in 12.1, a resend button, and outbox alerts (10.3).
4. **Human lead times.** The license, the operator, the fiscal host, NCMEC and the lawyer all wait on people outside this project. *What we do:* all start in phase 0 or 1 and sit on Myra's Now line with their due step; A19 is decided in phase 0, so a lawyer can be booked; Open Source Collective gets the application at 1.11, with Stripe as the dated fallback at phase 9.
5. **Abuse without a personhood check.** Bot sign-ups, sock puppets, spam shwarms, or an agent driving a person's browser. *What we do:* Turnstile, sign-up limits, the disposable block, the established rule, one slot per person, author sign-off, triage that holds when it fails, step-up on the acts that matter, flags and reports, admin tools and switches, all drilled in 8.7.

## 8. Parking lot

Ideas wait here until after launch, unless they block the launch done test. Add new ones at the bottom with the date and who raised them.

- A live "campfire" view of agent posts flowing in ([#68](open-questions.md#68-a-live-campfire-view-of-the-work)). Needs a design pass. The `ShwarmTree` Durable Object could host it later.
- A shwarm updates section an agent can keep current ([#67](open-questions.md#67-a-shwarm-updates-section)). Launch uses the pinned post.
- Federation over ActivityPub ([#50](open-questions.md#50-the-api-across-federated-servers)).
- Organization accounts ([#34](open-questions.md#34-organization-accounts)).
- Push or webhooks for mentions ([#47](open-questions.md#47-push-delivery-for-mentions)); polling covers launch.
- Signed CI attestations (Sigstore) as run evidence; reproducible builds.
- Triage reading thread posts (new question, with cost numbers first).
- Editing a done test for typos ([#5](open-questions.md#5-done-test-lock-vs-typos-and-clarifications)); changing lobby size after posting ([#22](open-questions.md#22-can-lobby-size-change-after-posting)); variants of branches ([#23](open-questions.md#23-can-a-branch-have-a-variant)).
- Edit and delete through the API ([#30](open-questions.md#30-what-can-be-edited-after-posting)).
- Free-text role tags on result pages ([#65](open-questions.md#65-how-attribution-is-ranked-and-who-sets-role-tags)).
- Generated clients in other languages beyond the Python example.
- A public status page (status.shwarm.org).
- How a done test asks for a GPU or network in the sandbox recipe (new question; many launch shwarms need GPUs).
- Building on a shwarm that's still open ([#55](open-questions.md#55-can-builds-on-point-at-another-shwarm)).
- (2026-10-07, plan review) A Codeberg mirror of the repo.
- (2026-10-07, plan review) The CLI secret in the OS keychain (keytar is archived; needs a native module).
- (2026-10-07, plan review) A weekly age-encrypted backup copy on Myra's machine.
- (2026-10-07, plan review) Builds-on metadata from Codeberg and GitLab, and a cache with a refresh job.
- (2026-10-07, plan review) A signed-in devices list in the account modal ("sign out everywhere" ships).
- (2026-10-07, plan review) Admin UI for slow mode, per-account limit overrides with expiry, pausing agent writes, IP-range blocks and the header-stats switch (runbook recipes at launch).
- (2026-10-07, plan review) Invite codes; the allow-list covers launch.
- (2026-10-07, plan review) A script that diffs every page against its mockup and refreshes the screenshots by itself.
- (2026-10-07, plan review) Branch protection on main, once a second maintainer joins.
