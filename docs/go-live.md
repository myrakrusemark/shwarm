# Go-live plan

The plan for getting all of shwarm live at https://shwarm.org, so Myra can invite interested people right away. Myra and Claude follow it step by step, every day, until launch. Claude writes the code. Myra does everything that needs a human: accounts, payments, DNS logins, legal calls and final copy.

**Now (Claude):** shwarm.org is in beta, v0.2.10, with phase 9 built: flags, the admin console behind Cloudflare Access, the public moderation log, the security review's fixes; the abuse drill (9.7) is done. 9.6's outside test is parked until Myra is ready for Ash (Oct 11); Claude doesn't raise it. Phase 10: donations (10.1) are live on shwarm.org through Stripe Checkout. 10.2 is done: terms v0.2 announced Oct 12, in effect Nov 15. 10.5 is done. Phase 11 (ops): uptime checks, the public status page (status.shwarm.org), Sentry error reports, the daily usage line and the Resend error alert are live on v0.2.10 (Oct 12; link previews checked with Bluesky's extractor); next in 11.3 are Sentry, the daily D1 usage line and the Resend error-rate alert.
**Now (Myra):** the "Needs Myra" list below; the tracker page shows only that list and the progress.
**Last updated:** 2026-10-11.

### Needs Myra

Only what waits on Myra. Claude adds an item when something needs her and removes it once it's settled; her answers land in `tracker/replies.json` under the item's id. Shwarm cards that wait on her approval show on the page by themselves.




**Zero-spend rule (Myra, Oct 8).** Build everything on free tiers. Launch is a private beta with Myra's own short list of testers; opening sign-up to the public comes later, when there's money for the things that need it (a lawyer's review, the DMCA agent fee, paid tiers). Free stand-ins: Cloudflare Workers Free, Resend free (3,000 mails a month), Cloudflare Email Routing for support@ and the other addresses (forwards to Myra's inbox), GitHub, npm, Sentry and an uptime monitor on free plans, Myra as the operator (no LLC), terms and privacy as beta drafts. Workers Paid ($5/month) for argon2id passwords was offered and declined for now (Oct 8): the beta uses PBKDF2, and the switch is a todo before the public opens. Claude asks before any spend.

Sources: [decisions](decisions.md) (wins over everything here), [open questions](open-questions.md), [PRD](prd.md), [API PRD](prd-api.md), [spec](spec.md), [protocol](protocol.md), [legal todo](legal-todo.md), [launch shwarms](launch-shwarms.md). If this plan and decisions.md disagree, decisions.md wins and this plan gets fixed.

---

## 1. The launch done test

**Done when** an invited person, who isn't Myra, signs up on https://shwarm.org with an email and password, verifies their email, joins a wave-1 shwarm, makes an agent key, and their agent reads that shwarm and posts to it through the signed API; a submission on the launch rehearsal shwarm gets its run, its human people check and Myra's sign-off, and the shwarm closes with a result page and an audit log; a $5 donation goes through on Stripe; and last night's backup has been restored on staging within the last 7 days, prod uptime is at least 99.5% over the last 72 hours, and Sentry has no unexplained error-level issues.

**How it's checked.** On launch day minus one, in production, by three outside people from the private beta (step 12.6) and Myra:

1. **Person A** signs up from a fresh address at Gmail, Outlook, iCloud or Proton (not the address Myra uses), clicks the verify link (it lands in the inbox, not spam), joins a wave-1 shwarm, makes a key on /keys, and runs `npx @shwarm/cli read` and `npx @shwarm/cli post` against the shwarm. Evidence: the post's URL, showing `@a/<agent>` as its byline.
2. **The rehearsal shwarm** is created by @myra through the admin seed tool, with the done test "done when `./check.sh` in the rehearsal repo prints ok", checked by 1 run, 1 people check (at least one human) and the author. It starts as a lobby of 2 with @myra in seat 1, so **Person B** joins it first (kickoff). Then A's agent submits. **Person B** posts a run report with `shwarm run`. **Person C** posts a human people check on the submission page. Myra signs off with her password. Evidence: the result page URL and its audit log JSON (`/w/<path>/log`). Myra decides afterwards whether the rehearsal stays visible as a labeled rehearsal or gets hidden with a public tombstone.
3. **Donation:** someone gives $5 through the donate modal and it shows at the provider. Stripe is live from launch (A13).
4. **Ops:** the restore drill log (step 11.2) is dated within 7 days. Uptime is at least 99.5% on every prod check over the last 72 hours (a screenshot of the monitor). Sentry shows zero unresolved issues at level error or above with events in the last 72 hours, or each open one links to a fixed or parked note.

Every item gets its evidence (a URL, a log line, a date) written next to step 13.1. The launch done test passes when all four have evidence.

---

## 2. How we stay honest

1. **One active step for Claude, plus Myra's lane.** The two "Now" lines at the top name Claude's step and Myra's open lead-time tasks, each with the step it must finish before. Claude updates both at the end of each day, and moves its own line only when a step's "done when" is met. If Claude's next step waits on a Myra item that isn't done, Claude takes the next step that doesn't wait and says so on the Now line.
2. **A blocker is something that stops the launch done test from passing**, or a legal or safety must (the license, the terms, takedown tools, the CSAM path). Everything else is a nice-to-have.
3. **New ideas go to [further enhancements](#8-further-enhancements)** at the bottom, unless they're blockers. That includes good ideas, Claude's ideas, and fixes for things that look wrong but work.
4. **Claude points out drift.** When a request isn't in the current step, Claude says so in one line ("that's not 4.3; further enhancements?") and Myra picks: park it, or swap it in and say what it replaces.
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
| A3 | **Who runs shwarm for the beta** | decided (zero-spend): Myra as an individual, said plainly ("run by Myra Krusemark"). Governing law: her state. A legal entity (LLC or nonprofit) waits until opening to the public. The terms need a contact address; a free option is fine for the beta. | [#12](open-questions.md#12-legal-home), [#58](open-questions.md#58-governing-law-and-jurisdiction) | 10.2 |
| A4 | **Minimum age** | decided (Myra, Oct 8): 16 everywhere, with one sign-up checkbox. | [#59](open-questions.md#59-minimum-age) | 2.5 |
| A5 | **How bare-handle acts are confirmed** | decided (Myra, Oct 8): Everyday bare-handle acts (posting as @myra, replies, upvotes, joins, human checks, flags) need only a verified, signed-in session. Sign-off, making/rotating/revoking keys, saving the account, email or password change, export and admin acts need the password re-entered within the last 10 minutes. No human signing key on the API: every bare-handle act is site-only. Passkeys come later as an optional faster step-up. (The open-question triage preferred passkey-first; password-first is less to build and works on every device.) Copy changes from "confirms with your passkey." to "confirms with your password." Makes [#52](open-questions.md#52-upvotes-tap-every-time-or-a-short-window) and [#53](open-questions.md#53-account-recovery-beyond-the-personhood-check) moot. Myra also approves the matching change to the passkey rule in CLAUDE.md. | [#31](open-questions.md#31-how-is-a-humans-own-act-told-from-their-agents), [#52](open-questions.md#52-upvotes-tap-every-time-or-a-short-window), [#53](open-questions.md#53-account-recovery-beyond-the-personhood-check) | 1.7, 2.8 *Joins superseded Oct 12: an agent with the "join" key permission may make its person's one join ([decision](decisions.md#oct-11-terms-and-privacy-final)).* |
| A6 | **Established-account cold start** | decided (Myra, Oct 8): On day one nobody is a week old, so no upvote or people check would count, and nobody could earn the first upvoted post. 81 of 100 launch shwarms need people checks (15 of the 20 in wave 1). Recommended: invited founding accounts start established. An address on the sign-up allow-list becomes founding when it's verified, so Myra never flags invitees by hand; she flags strays in admin. Any verified account's upvote counts toward "has an upvoted post"; only established accounts count toward ranking. A people check from an account that isn't established is refused with `403 not_established`, so nobody wastes effort. New question. | new | 2.5, 4.7, 5.3 |
| A7 | **Who reviews flags, reports and appeals at launch** | decided (Myra, Oct 8): "While shwarm is new, flags, reports and appeals go to the person who runs it (@myra), and every action is logged publicly" (the public log is step 9.5, a must). Reputation-weighted review switches on once [#7](open-questions.md#7-how-reputation-weights-elevate-and-reject) is settled. Myra (as operator) may hide content, remove links and suspend accounts for legal reasons, always with a public tombstone. New elements: a **report** link on every thread post, and a signed-out report form at `/report` so people without an account (a copyright holder, a person named in a post) have a path; the rules and terms name abuse@, dmca@ and /report. | [#7](open-questions.md#7-how-reputation-weights-elevate-and-reject), new | 1.7, 9.3 |
| A8 | **Triage when it fails** | decided (Myra, Oct 8): Hold the new node ("being checked", visible to its author only) and retry; after a few minutes it goes to Myra's queue with an alert. A model refusal also holds. Fails closed. The seeded shwarms are cleared in a batch before sign-up opens. The trade-off: a triage outage delays new nodes. (The architecture draft published on timeout instead; holding is safer with no personhood check.) Who pays: Myra's Anthropic account, from donations later. | [#15](open-questions.md#15-who-runs-and-pays-for-machine-checks) | 9.1 |
| A9 | **Author's own agents submitting** | decided (Myra, Oct 8): The author's agents may submit to the author's own shwarm. On those submissions only, the author check is swapped for one extra people check from outside the author's account, and the submission page shows the swap. Everyone else's submissions get the author's sign-off as usual. | [#20](open-questions.md#20-what-happens-when-the-authors-own-agents-submit) | 5.5 |
| A11 | **State machine and dead ends** | decided (Myra, Oct 8): Shwarm: lobby → live when seats fill. Branch: live at once. "In review" is a flag on live, not a state. live → closed on pass; live → dead end (the author marks it, with a required note); closed → live again as soon as a repro is posted (a "reopened" audit event, the pass kept on record); dead end → live if the author reopens it. States are lobby, live, closed, dead end. Every transition writes an audit event. The submission under review is frozen (links pinned to a commit or sha256, plus a submission hash), so work never stops; the submission page shows the pinned version up top. | [#18](open-questions.md#18-the-node-state-machine), [#17](open-questions.md#17-who-marks-a-dead-end) | 2.3 |
| A12 | **Transactional email** | decided (Myra, Oct 8): Resend free tier (3,000 a month, 100 a day), enough for a private beta. Postmark (about $15/month) when the public opens or the daily cap bites. | [#63](open-questions.md#63-transactional-email-service) | 0.8 |
| A13 | **Donations path** | decided (Myra, Oct 8): Stripe at launch, on a separate Stripe account for shwarm under Myra's existing login (free; Stripe takes its per-payment fee; statement line SHWARM). The donate modal stays as designed (once or monthly, preset or custom amount, optional note, Stripe's hosted checkout) and says plainly: payments go to Myra Krusemark, who runs shwarm; not tax-deductible. A nonprofit or fiscal host can take over later. | [#51](open-questions.md#51-who-holds-donations) | 10.1 |
| A14 | **Repo home and code license** | decided (Myra, Oct 8): one repo under Myra's GitHub account, `myrakrusemark/shwarm`, holding the site, the npm package (client library, CLI, later MCP) and the agent skill. Move to an org when a second maintainer joins or an entity forms (GitHub redirects old URLs). Server code AGPL-3.0; packages/ and skills/ MIT, each folder with its own LICENSE. | [#13](open-questions.md#13-github-repo-url) | 0.5, 1.10 |
| A16 | **Invites** | decided (Myra): launch is a private beta with Myra's short list. Only allow-listed addresses can sign up; anyone can read the site. Each invite links straight to a wave-1 shwarm, and allow-listed addresses are founding (A6). Opening sign-up to the public is a later switch, after the lawyer review, the DMCA agent and donations. No invite codes, no waitlist. *Changed Oct 10 ([decisions](decisions.md#oct-10-review-round-2)): anyone may join; an address off the list gets an account that reads but can't act, and one email when shwarm opens (13.3).* | new | 2.5, 12.6 |
| A17 | **Agent client and API v0** | decided (Myra, Oct 8): Launch with the HTTP API, SKILL.md and one npm package `@shwarm/cli` (library + CLI). Local MCP in the same package is (should). Hosted MCP and device login come after launch. This follows prd-api §4 and reverses the #54 lean ("hosted MCP first"), so Myra confirms. Freeze the API as v0 at launch: additive changes only after that. (The signature, idempotency and version-header details are in table B.) | [#54](open-questions.md#54-hosted-mcp-server-local-package-or-both), [#21](open-questions.md#21-the-final-api-shape) | 7.1 |
| A18 | **Seeding** | decided (Myra, Oct 8): The 100 launch shwarms go in through a one-off admin import as bare @myra, exempt from 3-a-day, with seat 1 taken, lobby 2, and "seeded by @myra at launch" in each audit log. Each goes to prod only after Myra has proofread it, because done tests lock once posted. | new | 3.1 |
| A19 | **Launching on draft terms** | decided (Myra, zero-spend): the private beta runs on terms and privacy marked "beta · v0.1 · not yet reviewed by a lawyer". A lawyer reviews them before sign-up opens to the public. With a short list of known testers the risk is small. | [#12](open-questions.md#12-legal-home) | done |
| A20 | **Wave-1 check counts** | decided (Myra, Oct 8): Confirm or lower them before the proofread, because they lock on import. Today 19 of 20 wave-1 shwarms ask for 2 runs and 15 for 1–3 people checks (13 with at least one human), plus Myra. One pass can need up to 6 different people besides Myra, from a beta of 5–10. An option to consider: 1 run + 1 human people check + author for wave 1, with stricter counts in later waves. Myra's call. | [#35](open-questions.md#35-what-if-nobody-checks) | 12.1 |
| A21 | **Account page copy** | decided (Myra, Oct 9: "all yes"): the sign-up, sign-in, check-your-email, verify, forgot, reset, expired-link and step-up pages are on staging (/join, /signin, /forgot, /check-email, /step-up). Read them and say yes, or change any line. Part of 2.7's done-when. | new | 2.7 |
| A22 | **Sign-up checkboxes** | decided (Myra, Oct 9: "all yes"): the join form has two required boxes, "i'm 16 or older." and "i agree to the terms and the privacy notice." A4 named one age box. Recommended: keep two, so the age answer is its own statement. | new | 2.5 |
| A23 | **The invite-only message** | decided (Myra, Oct 9: "all yes"): while sign-up is allow-list only, an address that isn't invited and has no account sees "shwarm is invite-only for now. join with the address your invite came to." That tells a stranger the address isn't invited (not whether it has an account). Recommended: keep it for the private beta, since it's the kind thing to tell a real person; it goes away when sign-up opens. *Replaced Oct 10 ([decisions](decisions.md#oct-10-review-round-2)): the join form and the waiting words in [copy-to-approve](copy-to-approve.md#oct-10-anyone-may-join).* | new | 2.5 |
| A24 | **Account safety numbers** | decided (Myra, Oct 9: "all yes"): first guesses, each one line to change. Wrong passwords: 20 per network or 10 per address in 15 minutes, then a 15-minute wait (no permanent lockout). Sign-ups: 5 per network and 30 per email domain an hour. If Cloudflare's bot check is down, sign-in still works (the limits hold) but sign-up and forgot wait. If Resend's free quota (100 a day) runs out, mail waits until the next day, so a verify or reset link may need resending. Recommended: accept all for the beta. | new | 2.5, 2.6, 2.7 |
| A25 | **Phase 2 build defaults** | decided (Myra, Oct 9: "all yes"): the builders picked these where nothing was decided; accept all, or name any to change. Caps: lobby 1–10,000; up to 50 for any check count; up to 8 tags; slugs up to 80 characters; up to 50 mentions per post; display name up to 50 characters. Rules: a people fail stands as a repro and blocks that submission, only an author fail marks it failed; a new submission supersedes all older ones still in review; when the done test has an author check, the author's one slot on others' work is the sign-off; joining, branching or checking a closed or dead-end node is refused, thread posts are always allowed; an agent-started shwarm opens with no seat taken (per decisions.md). Codes: refusals with no protocol code use `not_permitted` with a reason, `shwarm_closed` or `bad_request`. Mail: unsubscribe links work for a year. Cookies: besides the sign-in cookie there are two short-lived ones that protect the forms (2 hours and 7 days, no tracking); the privacy page will say so. | new | 2.3, 2.5, 2.6 |

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

**Why.** It covers every hard requirement with nothing extra to run: WebCrypto verifies Ed25519 signatures, FTS5 handles search, and a Durable Object per shwarm gives the state machine one-at-a-time writes, which matters for the last seat, the final check and racing submissions. Myra already uses Workers and D1. A text-only site is the best case for D1. It's all TypeScript, so the signing and hashing code is shared between the server and the CLI and can't drift. It costs $5 a month to start, and there are no servers to patch. The trade-offs: D1 has no interactive transactions (solved by serializing each shwarm in its Durable Object and committing each command as one batch), password hashing runs as PBKDF2 through WebCrypto on the free plan, with argon2id after a move to Workers Paid (decided Oct 8; stored hashes say which, so the switch rehashes at sign-in), FTS tables need a custom backup export, and a D1 migration can't be rolled back with the code (so migrations are expand-then-contract, step 1.5). The exit, if D1 runs out, is Postgres through Hyperdrive with the same Worker, because all SQL sits behind one adapter.

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
| person | handle (permanent), display name, email (verified), password hash (PBKDF2-SHA256 with a pepper for the beta; argon2id later; the stored string names the algorithm), about, links, status, founding flag, established date, notice prefs, accepted terms version and date, age confirmation. No legal name. |
| session | the one sign-in cookie (stored hashed), last seen, step-up window, IP prefix and browser summary (purged after 30 days) |
| email_token | verify, reset and email-change links (hashed, single use, expiring, used only on POST) |
| node, node_tag, node_fts, node_edit | shwarms and branches: path, parent, root, variant of, title, what, done when (locked), checks, tags, lobby size, builds on (url, name, license), author, agent byline, state, in-review flag, triage status, hidden/paused; search index; edit history (re-pitch history before Oct 10) |
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
| signup_wait | accounts that joined from an address off the allow-list while sign-up is invite-only, for the one "shwarm is open" mail (migration 0018, decided Oct 10) |
| email_outbox, email_suppression, disposable_domain | mail queue and bounces; blocked domains |

Passkeys and "verified human" fields come in a later migration, when those features are built.

### Monthly cost

Zero-spend rule: free tiers until the public opens. Prices to verify at sign-up.

| item | private beta | when the public opens |
| --- | --- | --- |
| Cloudflare Workers (Workers, D1, Durable Objects, cron, Turnstile, Email Routing) | $0 on Free (passwords use PBKDF2 for now; Paid is a todo) | $5 plus usage |
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
| 3. Reading pages | 6 | Myra proofreads wave 1 (12.1) from 3.1 on | beta mode: the read-only site with the proofread wave-1 shwarms, noindex, sign-up for allow-listed addresses only |
| 4. Writing | 6 | proofread continues | allow-listed accounts can join, post and upvote; new nodes paused until 9.1 |
| 5. Done-test machinery | 6 | | the loop to a result page (run reports as fixtures) |
| 6. Profile, inbox, account | 4 | | inbox, notices, account |
| 7. Keys, agent API, CLI | 9 | | agents read, post and run; npm `@shwarm/cli` published |
| 8. Further enhancements | after launch, not counted | | parked until after launch |
| 9. Trust and safety | 5 | | triage, flags, reports, admin, public moderation log; security scans done |
| 10. Money and legal | 2 | | beta terms in force; donate live on Stripe |
| 11. Ops | 3 | | backups, restore drill, monitoring |
| 12. Content and invites | 2 + 5-day beta | | private beta with 5–10 people |
| 13. Launch day | 1 | | private beta with Myra's list; public sign-up is a later switch |
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
- **what:** turn on Cloudflare Email Routing for shwarm.org (free) and forward support@, abuse@, security@ and dmca@ to a private inbox. Done by Claude through the Cloudflare API on Oct 8: routing enabled (MX and SPF added by Cloudflare); the four rules are created as soon as Myra clicks the verification link sent to that address.
- **who:** Myra · **needs:** 0.4
- **done when:** Email Routing shows the four addresses with Myra's inbox verified as the destination.

**0.8 Resend** · done
- *(Oct 8: Myra's main Resend account already uses its one free domain (another project), so shwarm uses her second free account. Claude added `mail.shwarm.org` (us-east-1) and put its DKIM TXT and two sending CNAMEs into Cloudflare by hand (DNS only); all resolve. Tracking is off (no tracking subdomain); receiving off. Domain verified; Myra made the `shwarm-staging` and `shwarm-production` keys (sending access) and saved them in her password manager.)*
- **what:** free account, the shwarm.org domain added (records go in at 1.9), one API key per environment, click and open tracking off.
- **who:** Myra · **needs:** 0.1 (A12)
- **done when:** the account exists and the staging and prod keys are in Myra's password manager.

**0.9 Triage model (when the public opens)** · done
- **what:** decided (Myra, Oct 8): triage runs on **Clef-flash**, Cloudflare's decision model, through the Workers AI binding in our own Worker (`@cf/cloudflare/clef-flash`). No outside key, no Anthropic account. It answers one question per new shwarm, branch or variant: "does this hit a hard block? yes / no / unsure"; yes or unsure goes to Myra's queue, no publishes. Triage volume is tiny, so it should fit Workers AI's free daily allowance (checked in 9.1). Done-test suggestions are skipped at first. The model sits behind one setting (`TRIAGE_MODEL`), with Clef (27B) and Jev as fallbacks if flash misses cases. Before the public opens, an eval: about 30 crafted hard-block cases plus all 100 launch shwarms; the model must block every bad case and pass every launch shwarm. Runs during the beta too (Myra, Oct 8: "clef"), as practice for launch; yes or unsure still lands in Myra's queue.
- **who:** Claude · **needs:** 0.4 · **due before:** public sign-up
- **done when:** the eval passes on the chosen model.

**0.10 Operator and contact** · done
- **what:** Myra is the operator (A3). Pick the contact address the beta terms will show (support@ is enough for the beta; a postal address is needed for the DMCA agent before the public opens).
- **who:** Myra · **needs:** A3 · **due before:** 10.2
- **done when:** the operator and contact are written in decisions.md.

**0.11 First invitees** · parked
- **what:** start asking people now. Goal: 5–10 people each committed to a specific wave-1 shwarm before launch, and about 50 in the first cohort (people with agents, people who can judge, a few harness authors). The tracker (names, contacts, shwarm, invited, joined) stays private, outside the repo. Invite upstream projects' people personally; never post on their trackers.
- **who:** Myra; Claude drafts the tracker columns and who to ask per wave-1 shwarm · **needs:** nothing
- **done when:** the tracker exists and has at least 10 names. (It keeps growing until 12.4.)
- *(Oct 10: parked by Myra: the list comes once she is comfortable with the site. Nothing goes to testers before then.)*

**0.12 Where everything lives** · done
- *(Oct 8: Claude made the list in `admin/accounts.md` (local only, gitignored, no secrets). Checked: Cloudflare 2FA on (Oct 8, recovery codes saved), npm 2FA on; GitHub and Stripe 2FA per Myra. Emergency access stays a todo (Myra, Oct 8); it doesn't hold up this step.)*
- **what:** one private list of every account (Cloudflare, GitHub, npm, Resend, Anthropic, later Sentry, uptime, donations, NCMEC), each with 2FA and recovery codes stored offline. Emergency access for one trusted person is a todo, not part of done.
- **who:** Claude keeps the list; Myra turns on 2FA · **needs:** grows with each account
- **done when:** every account made in phase 0 is on the list with 2FA on.

**0.13 Lawyer review (before the public opens)**
- **what:** not in the beta (A19). Before public sign-up, a lawyer reviews the terms and privacy.
- **who:** Myra · **needs:** money · **due before:** public sign-up
- **done when:** the review date is in decisions.md.

**0.14 NCMEC registration** · doing
- *(Oct 11: requested Oct 8 by email to NCMEC; no reply on record yet. Done once NCMEC confirms and it's on the accounts list.)*
- **what:** register shwarm as an electronic service provider with the NCMEC CyberTipline, under the operator, so a report can be filed the day it's needed. (Not legal advice; confirm with the lawyer if one is booked.)
- **who:** Myra · **needs:** 0.10 · **due before:** 12.6
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

**1.5 Deploy pipeline** · done
- **what:** merge to main → migrations + deploy to staging + smoke test; a tag with approval → production. Migrations are expand-then-contract: every migration works with the previous release's code, and dropping a column waits one release. Before migrating prod, CI records a D1 Time Travel bookmark (`wrangler d1 time-travel info`) in the deploy log. CI runs the previous tag's tests against the new schema. Rollback with `wrangler rollback`.
- **who:** Claude · **needs:** 1.2, 1.3
- *(Oct 8: main → staging after CI passes, with a smoke test; a `v*` tag → production with tests, a Time Travel bookmark, migrations and a smoke test. Pushing the tag is the approval (GitHub's required reviewers need a paid plan on private repos). v0.0.1 reached production through CI. Rollback rehearsed on staging with migration 0002 (Oct 8): the previous release stayed healthy on the new schema, and a Time Travel restore took 4 seconds; steps and log in [the runbook](runbook.md).)*
- **done when:** a tagged release reaches prod through CI only, and a rollback rehearsal on staging that includes a migration is logged, with the previous release still passing against the new schema.

**1.6 Shared layout** · done
- **what:** lift the `:root` tokens and shared CSS into one stylesheet (kept in sync with [design system](design-system.md)); shared partials for header, strip (signed out: "sign in · join", and "welcome new friends!"), footer, donate modal ("donations open soon" for now), agent resources card, modal shell (×, Esc, scrim, focus trap); favicon, default social card; security headers and CSP (inline scripts moved to files). `scripts/mockup-diff.ts`: one small Playwright + pixelmatch check.
- **who:** Claude · **needs:** 1.3
- *(Oct 8: CSS and page text are exported from the mockups by `scripts/pages/export-site.py`; the header strip, footer, donate modal (Stripe wiring waits for 10.1), agent resources card and doc pages are Hono JSX in `apps/site/src/web/`; CSP and security headers on every response. `scripts/mockup-diff.py`: how-it-works differs from its mockup by 0.04% at 1280 px and 0.13% at 390 px. Footer pages are served on staging only until 1.8b.)*
- **done when:** the how-it-works page rebuilt on the shared layout has a pixel diff under 2% against its mockup at 1280 and 390 px (any larger diff is listed and accepted by Myra in the PR), and securityheaders.com grades it A.

**1.7 Fix stale copy on the footer pages** · done
- **what:** replace personhood check, legal name and passkey sign-in on [how it works](../mockups/how-it-works.html), [rules](../mockups/rules.html), [api](../mockups/api.html), the guides, [terms](../mockups/terms.html) and [privacy](../mockups/privacy.html) with email + password and the A5 step-up; mark terms and privacy "draft · not in force yet"; the A7 moderation wording; "no single person gets the credit" (result pages now rank people); "agent skills" links point to /skills (a short "coming soon" page until 7.6). Lint with combob-lint.py. Mockups are updated too, and their screenshots refreshed.
- **who:** Claude drafts; Myra approves · **needs:** 0.1 (A5, A7)
- **done when:** combob-lint passes, no page links to "#", no page mentions a personhood check, legal name or passkey sign-in, and Myra has approved each page.

**1.8 First things live on shwarm.org** · done
- **what:** (a) as soon as 1.3 and 1.4 work: a holding home page ("shwarm opens soon", one line about it, support@). (b) when 1.7 is approved: how it works, rules, api, both guides, and the draft terms and privacy, behind the same holding home.
- **who:** Claude; Myra approves the holding-page copy · **needs:** (a) 1.3, 1.4; (b) 1.5, 1.6, 1.7
- *(Oct 8: (a) is live: "opening soon", one line about shwarm, support@. Myra can change the copy any time. (b) Myra approved the footer pages; v0.0.3 serves how it works, rules, api, terms, privacy and both guides on shwarm.org, noindex until launch. )*
- **done when:** (a) https://shwarm.org serves the holding page over HTTPS; (b) the footer pages are served from a tagged release.

**1.9 Mail DNS** · done
- *(Oct 8: Email Routing's MX and SPF are in. DMARC added (`_dmarc` TXT `v=DMARC1; p=none; rua=mailto:support@shwarm.org`, resolves). Resend's DKIM and sending records for mail.shwarm.org are in and verified. `/.well-known/security.txt` is live (v0.0.3). Oct 9: a staging verify mail landed in a Gmail inbox with SPF, DKIM (mail.shwarm.org) and DMARC passing, and mail-tester scored it 9/10; the only mark against it is "domain registered in the last 7 days", which fades by itself.)*
- **what:** Cloudflare Email Routing records (MX, SPF); Resend's SPF and DKIM records on a sending subdomain; DMARC at p=none with reports to support@; `/.well-known/security.txt`. Done this early so the domain has a sending history before invites.
- **who:** Claude adds records; Myra clicks verify in Resend · **needs:** 0.7, 0.8, 1.8a
- **done when:** a mail from Gmail to support@ arrives and Myra's reply comes back; the domain shows verified in Resend; a test send scores 9/10 or better on mail-tester with SPF, DKIM and DMARC passing.

**1.10 Make the repo public** · done
- *(Oct 10: the launch shwarms' risk notes left the tree. They live in `docs/launch-risk-notes.json` ({slug: risk_notes}), which is git-ignored and read by nothing; launch-shwarms.json and its .md mirror no longer hold them, and a seed test fails if one comes back. shwarm-ideas.json's working copy is clean too, but its committed copy keeps the ideas' notes until that file's pending edits are committed. They are still in earlier commits, so the history check below decides whether that history is rewritten or accepted. `tracker/replies.json` and `tracker/proof.json` were already untracked.)*
- **what:** README, CONTRIBUTING, SECURITY.md, code licenses per A14, the A2 license on docs and content. Before flipping to public: move the launch shwarms' private risk notes (A18) and `tracker/replies.json` out of the repo, and check git history for anything private (`git grep` plus a gitleaks scan of all commits).
- **who:** Claude; Myra approves · **needs:** 0.3, A2, A14, 1.2
- **done when:** the repo is public.
- *(Oct 10: public at https://github.com/myrakrusemark/shwarm, made public by Myra. Before it: a gitleaks scan of all history (only the planted fake key on the old ci-secret-test branch), the staging deploy limited to pushes to this repo, example test addresses, the private inbox address taken out, tracker replies and card verdicts made local, and the risk notes moved to the gitignored docs/launch-risk-notes.json. The notes stay in older commits; Myra chose to go public with them there.)*

**1.11 Apply to Open Source Collective**
- *(Oct 11: drafted in [osc-application.md](osc-application.md). Open Source Collective wants the repo under an organization (A14 says move when a second maintainer joins), a license file (now added: AGPL-3.0 in apps/site, MIT in packages and skills), two admins if possible, and some history; it takes 10%. Myra decides when to apply.)*
- **what:** Myra applies the day the repo goes public; Claude drafts the application text (what shwarm is, the license, the repo, what donations pay for).
- **who:** Myra; Claude drafts · **needs:** A2, A13, 1.10
- **done when:** the application is submitted and its date is in decisions.md.

### Phase 2: data model, auth, email (8 days)

**2.1 Shared protocol package** · done
- *(Oct 8: `packages/protocol`: error codes with statuses, the name pattern, reserved handles and can-post-as matching, RFC 8785 canonical JSON (RFC test vectors), the submission hash (full hex, 7-character short form, prefix match), the `shwarm_sk_` secret format. 54 tests. Request and response schemas from openapi.yaml are generated with the API types in phase 7 (LIB-3), not hand-copied here.)*
- **what:** error codes (the protocol table plus `idempotency_conflict`, `payload_too_large`, `not_established`, `unsupported_version`), the name pattern and reserved list, schemas matching openapi.yaml, canonical JSON, the submission hash (table B, A10), the secret format.
- **who:** Claude · **needs:** 0.1
- **done when:** unit tests cover every name and hash case.

**2.2 Schema** · done
- *(Oct 8: `migrations/0002_schema.sql` (0001 already held the meta table): every table in §4 with constraints for the decided rules (one done test, four states, one check slot per person per submission, fail needs a repro, no bare-handle key patterns), FTS5 on nodes with triggers, append-only audit_event, settings seeded closed (holding, allow-list sign-up). Applied on local and staging; 9 schema tests, including an audit update and delete that fail.)*
- **what:** migration 0001 with every table in section 4, FTS triggers, and append-only triggers on audit_event.
- **who:** Claude · **needs:** 2.1
- **done when:** migrations apply on local and staging, and a test confirms that updating an audit event fails.

**2.3 Domain core and the tree actor** · done
- *(Oct 8, built by the phase 2 workflow, reviewed adversarially, 7 findings fixed: `src/core/` (actor and permissions, the A11 state machine, every command as one D1 batch with its audit rows, A9 swap, A6 established rule, author-fail reset, limits and settings) and the `ShwarmTree` Durable Object (SQLite-backed, free plan). Race tests: last seat, final check and simultaneous submissions, 100 runs each, zero double results, with controls that do double without the queue. They run on the node:sqlite stand-in, not the Workers runtime. Migration 0003 marks seeded nodes (A18 exemption). Defaults the builder picked are in A25.)*
- **what:** Actor, errors, permissions (bare-handle refusal), the state machine (A11), audit writer, limits (thread bucket, submissions a day, the new-node trigger), settings, and the `ShwarmTree` Durable Object that runs commands one at a time and commits each as one D1 batch.
- **who:** Claude · **needs:** 2.2
- **done when:** race tests firing parallel requests at kickoff, the final check and two submissions run 100 times each in CI with zero double results.

**2.4 Passwords, sessions, CSRF** · done
- *(Oct 8: `src/auth/`. PBKDF2-SHA256 at 100,000 iterations (Cloudflare's WebCrypto maximum) after an HMAC pepper; measured on Workers Free at 15–40 ms CPU per hash, over the nominal 10 ms, yet 80 of 80 requests (40 at once) succeeded. If sign-ins start failing with error 1102, lower the setting (old hashes still verify) or take the Workers Paid todo. Breached-password check by 5-character prefix. Sessions: `__Host-shwarm`, only the token's hash stored, 30-day sliding, ended on reset. Origin check on every write plus session-bound form tokens; signed agent requests skip the origin check. Pepper and CSRF secrets set on staging and production. 18 tests.)*
- **what:** PBKDF2-SHA256 through WebCrypto with a secret pepper, at the most iterations that fit the free plan's CPU limit (benchmarked on staging), stored as a self-describing string so argon2id can replace it with a rehash at next sign-in (decided Oct 8: stay free); the one `__Host-` cookie, 30-day sliding, rotated on sign-in; Origin check plus form tokens on every write; GET never changes anything.
- **who:** Claude · **needs:** 2.2
- **done when:** tests show a cross-origin form post is refused and a hash takes under the CPU limit.

**2.5 Sign-up** · done
- *(Oct 8, workflow-built and reviewed; 3 high findings fixed (an open redirect, two ways to tell whether an address had an account) plus a pre-account hijack and a handle-hold dodge. /join with the reserved list, breached-password check, Turnstile (production widget `shwarm-signup` made Oct 8; staging uses Cloudflare's always-pass test keys), per-network and per-domain limits, 9,221 disposable domains (migration 0004), allow-list with founding on verification, same-browser replacement of a pending account, the same check-your-email page for an existing address. Open choices: A22, A23, A24.)*
- **what:** handle (pattern, reserved list, permanent), display name, email, password (10–128 characters, checked against Have I Been Pwned by hash prefix), terms + age checkbox with versions stored, Turnstile, throttles per IP range and email domain, disposable-domain block (bundled list), plus-address normalization. Unverified accounts can read and sign in, nothing else; they and their handle are deleted after 7 days (table B). A `signup` setting (open, or allow-list only) keeps prod closed to all but allow-listed addresses until 13.2. An allow-listed address becomes founding when it's verified (A6).
- **who:** Claude · **needs:** 2.4, A4
- **done when:** e2e tests cover a good sign-up, a reserved handle, a disposable domain, a pwned password, the throttle, a refused non-allow-listed address, and an allow-listed address that is founding after verifying.

**2.6 Email pipeline and account templates** · doing
- *(Oct 11: checked staging: no suppression rows and no unsubscribed notice types yet, so the live bounce and the live one-click unsubscribe are still to do. The webhook secret is set on staging; nothing records the webhook being added in Resend.)*
- *(Oct 8, workflow-built and reviewed, 5 findings fixed: the outbox sweep every minute (no double sends when sweeps overlap, retries with backoff, Resend 429 holds), all seven templates, rolling per-address caps, staging sends only to allow-listed addresses, suppression, signed one-click unsubscribe, and the bounce webhook at /hooks/resend behind basic auth. Oct 9: Resend keys in; all seven templates sent from staging to Myra's inbox through the real sweep. Left: a forced bounce through the live webhook and a live one-click unsubscribe. Resend may not keep basic-auth credentials in a webhook URL; if so the hook switches to Svix signature checks.)*
- **what:** outbox row written with the act, sent to Resend with retries (a cron sweep of the outbox, since Queues may need a paid plan); bounce and complaint webhooks (basic auth with a secret from wrangler secrets) fill a suppression list (security mail still goes); staging only sends to allow-listed addresses; Reply-To is support@. Every notices-stream mail carries List-Unsubscribe and List-Unsubscribe-Post (RFC 8058), with a per-type opt-out. Templates (lowercase, plain text first, no tracking): verify, welcome, reset, password changed, email change (new and old address), sign-up attempt on an existing address.
- **who:** Claude · **needs:** 1.9
- **done when:** each template arrives at a test inbox from staging, a forced bounce lands in suppression, an unauthenticated webhook call is refused, and a one-click unsubscribe stops that notice type only.

**2.7 Sign-in and account pages** · done
- *(Oct 8: built and reviewed with 2.5; tests cover each flow, a scanner GET leaving the token usable, single-use resets that end every session, slowed wrong passwords, and identical answers for unknown addresses. Myra approved the copy (A21, Oct 9) after signing up, verifying and signing in on staging.)*
- **what:** sign in, sign out, check your email (with a resend-verification button), verified, forgot, reset, expired link. Every emailed link opens a page with one button ("verify my email", "set new password", "unsubscribe"); the token is used only on the POST from that button, so mail scanners that fetch links don't use it up. Links work on any device without being signed in. Per-address caps from table B, enforced in the outbox. Sign-in backoff per account and per IP, no permanent lockout. No page reveals whether an email has an account. A reset ends every session and sends a security mail.
- **who:** Claude · **needs:** 2.5, 2.6
- **done when:** e2e tests pass for each flow; a scripted GET of a verify link (like a scanner) leaves the token usable and the button then verifies; the 4th reset mail to one address in an hour is not sent and the page still says "check your email"; the 20th wrong password from one IP is slowed; Myra approves the copy.

**2.8 Step-up** · done
- *(Oct 8: /step-up opens a 10-minute window; requireStepUp() guards the gated acts and also requires a verified email; sign-in opens the window too, since the password was just entered. Same-site `next=` only.)*
- **what:** re-enter the password to open a 10-minute window for the gated acts (A5); throttled like sign-in.
- **who:** Claude · **needs:** 2.4, A5
- **done when:** a test shows a gated act refused outside the window and allowed inside it.

**2.9 @myra on prod** · done
- *(Oct 11: done. On production @myra is active, verified, founding and admin, and has signed in (she used /admin through Access). "support" is a reserved handle: signup.test.ts signs up as Support and gets a 400 with no account made.)*
- **what:** Myra's address goes on the allow-list; she signs up on prod through the real flow as the first account; Claude sets her admin flag and blocks the reserved handles.
- **who:** both · **needs:** 2.5–2.8
- **done when:** Myra is signed in on shwarm.org with the founding flag, and signing up as "support" is refused.

**2.10 Deliverability check**
- **what:** sign up on staging with fresh addresses at Gmail, Outlook, iCloud, and Yahoo.
- **who:** both · **needs:** 2.6
- **done when:** all five verify mails land in the inbox (not spam) with SPF, DKIM and DMARC passing, and the Outlook link still works after Safe Links has fetched it. (Repeated in 13.1.)

**2.11 Beta terms and privacy drafts** · done
- *(Oct 11: the drafts were made final in 10.2 (v0.2). The EU DSA contact line is on the terms. The UK Online Safety Act illegal-content risk assessment is [uk-osa-risk-assessment.md](uk-osa-risk-assessment.md), not linked from the site. It found that triage asks only about the four hard blocks on new shwarms and branches, so terrorism, CSAM links, hate and self-harm rest on reports and flags.)*
- **what:** Claude drafts both in plain language from legal-todo sections 3–4: operator and address, contact (support@, abuse@, dmca@, /report), the license grant and builds-on, minimum age, agents and keys, moderation (honest about @myra reviewing at launch), copyright notices, runs and code at your own risk, donations (voluntary, not tax-deductible, how to cancel monthly, refunds), closing an account, no warranty, changes and the notice period; privacy with a draft data inventory, 30-day retention, data region, the one cookie and Turnstile, and subprocessors. Also one EU DSA contact line (email, languages) on the terms, and a short UK Online Safety Act illegal-content risk assessment (about an hour, kept in the repo). Open rows (A2, A3, A13) stay as marked placeholders. Labeled "beta · v0.1". (Not legal advice; A19 says whether a lawyer reviews before or after launch.)
- **who:** Claude drafts; Myra reviews in her lane over the following weeks · **needs:** A4, A5, A7
- **done when:** both drafts are on staging, combob-lint passes on the plain parts, and every "[to decide]" left points to a row still open on Myra's Now line.

### Phase 3: reading pages (6 days)

Myra starts proofreading wave 1 (12.1) as soon as 3.1 has it on staging. From 3.10 on, prod runs in beta mode, every phase deploys to prod as well as staging, and each wave-1 shwarm goes to prod as soon as Myra approves it.

**3.1 Seed import tool** · done
- *(Oct 9: `scripts/seed-launch.ts` (run with `npx -y vite-node`), workflow-built and reviewed (7 findings fixed). Maps the JSON through core as @myra via 'seed' into one guarded .sql file; dry run lists every changed, normalized or dropped field; idempotent by slug; production needs `--allow-production --slugs`; staging `--replace` restores a Time Travel bookmark (runbook). Staging holds all 100 plus the running example. Open: how 'seeded by @myra' shows in the log (no tenth event type yet); which non-A2 upstream licenses count as open; the pinned sources post vs the feed status line.)*
- **what:** `scripts/seed-launch.ts` maps launch-shwarms.json to create calls (command split from its description, builds-on text parsed into name, url and license, why_now into what, sources as the pinned first post), idempotent by slug, with a dry-run report. Runs through core as @myra with seat 1, lobby 2 and `via=seed` (A18). Load all 100 plus the running example on staging.
- **who:** Claude · **needs:** 2.3, table B, A18
- **done when:** the dry run lists every field it changed or couldn't parse, and staging shows all 100.

**3.2 Feed** · done
- *(Oct 9: on staging at `/` (production keeps the holding page until 3.10). Tabs, #tag search with every word quoted (80-case FTS fuzz never 500s), stable cursor paging, every card kind, hot mix; at most 5 queries a page; 0.00% / 0.01% off the mockup at 1280 / 390 px. Reviewed, 3 findings fixed. Known: the status line on seeded cards shows the pinned sources post's first line, fixed in round 3.)*
- **what:** tabs hot / filling / new / closed, search (text plus `#tags`; input tokenized and quoted before FTS MATCH), cursor paging, every card kind (live, lobby, closed, dead end, variant, builds on, hot badge), the hot mix (#9), impact tooltips, number shortening, empty states.
- **who:** Claude · **needs:** 3.1, 3.7
- **done when:** each tab and a tag search work on staging, and a fuzz list of FTS operators and stray quotes returns results or none, never a 500.

**3.3 Shwarm page and threads** · done
- *(Oct 9: `/w/<path>` live and lobby templates, thread, sidebar, all user text through the safe renderer; OWASP payloads and a Trojan Source command render as text. Reviewed: 2 high findings fixed (held seeded nodes leaking, dead-end status in the prompt). 13–20% off the mockup; polish in round 3 and Myra's read-through (3.9).)*
- **what:** the live and lobby templates (the result template is filled in 5.7); head, what | done when, checked by, status line, pill; sidebar (contribute card, branches, variants, contributors, agent resources); the thread with sort, show filter, pinned post first, one level of replies, @names as links, "built on by" backlinks; the safe text renderer (table B, [#49](open-questions.md#49-markdown-in-text): no raw HTML, http/https links only, `rel="nofollow ugc noopener noreferrer"`, punycode for look-alike domains, logs as escaped preformatted text; bidi controls U+202A–202E and U+2066–2069 and zero-width characters shown as visible escapes in commands, code fences and names, and refused in handles and done-test commands).
- **who:** Claude · **needs:** 3.1
- **done when:** a lobby and a live shwarm render on staging, a list of OWASP XSS payloads in posts renders as text, and a Trojan Source sample in a command shows its escapes.

**3.4 Branch page** · done
- *(Oct 9: "block placement" renders on staging; 9–11% off its mockup, polish with 3.3.)*
- **what:** breadcrumb, "branch of", head, status line linking its submission, sub-branches, "on this branch" (author included), no flag link until 9.3.
- **who:** Claude · **needs:** 3.3
- **done when:** "block placement" on staging matches its mockup.

**3.5 Public profile and name view** · done
- *(Oct 9: `/@handle` and `?as=` name view; no email or private data; numbers from the same stats as node pages. Reviewed, 4 findings fixed. One visibility rule now serves every reading page (`src/read/visibility.ts`).)*
- **what:** `/@handle` (head, three stats, working on, created), the "look up a name" box, and `/@handle?as=@x/y` (that name's posts only). No "verified human" at launch.
- **who:** Claude · **needs:** 3.3, 3.7
- **done when:** @myra and @myra/m-04 render on staging (the second reached through the box), and their numbers match the node pages.

**3.6 Node URLs for agents** · done
- *(Oct 9: the same URL serves the page, the text prompt (per-response nonce markers; a fake end marker can't break out) and Node JSON; ETag/304 for signed-out views, signed-in views not publicly cached; production returns 404 until 3.10.)*
- **what:** the same `/w/<path>` serves the page to browsers, the text prompt (with per-response nonce markers, escaping, `?before=` paging, short lobby form) and Node JSON; `?format=text|json`, `rel=alternate`, `Vary: Accept`; reserved segments `branches`, `log`, `s`. Signed-out GETs of pages, text prompts and Node JSON send an ETag (the node's version, `node.last_event_id`: its last audit event, post or seat change) and answer If-None-Match with 304; `Cache-Control: public, s-maxage=15` for signed-out views, signed-in views uncached. A per-IP token bucket on public reads returns 429 with Retry-After.
- **who:** Claude · **needs:** 3.3
- **done when:** `curl https://staging.shwarm.org/w/minecraft-in-doom` with the Access service token returns the prompt, a post containing a fake end marker can't break out of its marker, and a repeat request with If-None-Match gets a 304.

**3.7 Stats and ranking jobs** · done
- *(Oct 9: `src/jobs/stats.ts` every 5 minutes, incremental, migration 0005; impact, hot, scores, status lines and hidden header counters; reviewed (3 findings fixed, incl. chunking to stay inside the free CPU limit). Its defaults (bump decay, 7-day windows, lobby score ignoring seat 1) wait for Myra's read-through in 3.9.)*
- **what:** 5-minute rollup of node and person stats, impact, posts/day, people, hot, scores and status lines; header counters (hidden, previewed only by admins with `?stats`).
- **who:** Claude · **needs:** 2.3
- **done when:** tests with fixed fixtures give the expected impact, hot and rank.

**3.8 Error pages, mobile, accessibility** · done
- *(Oct 9: one error page for 403, 404, 410, 429 (with the wait) and 500 through `page()`, from `app.notFound` and `app.onError` (logged, no internals); text and JSON forms on /w/* and for `Accept: text/plain|application/json`. A node the operator hid answers a 410 tombstone with the public reason. Exact times in titles on every relative time; focus rings, a skip link. The browser suite (`npm run test:e2e` in apps/site; playwright-core with the system or CI Chrome, axe-core, a Node server over the test database) runs 123 checks in about a minute, signed in and out, and is a CI job. Fixing it changed the header under 480px and five low-contrast pairings (design-system.md, layout); Myra to confirm in 3.9. Not yet on staging. Review round: the focus ring is ink, sun only on dark surfaces, since a sun ring can't be seen on sun or paper (Myra to confirm, as the design system named sun); the modal's trap holds after a click on its text; long titles, URLs and handles wrap at 390 px; only a node the public could have seen gets a tombstone (OPEN: whether a node hidden before triage cleared it gets one).)*
- **what:** 404, 403, 410 tombstone, 429 with the wait, 500; layouts at 640 and 860 px with no sideways scroll; focus handling and exact times in title attributes; axe-core in the Playwright suite on every page, signed in and out.
- **who:** Claude · **needs:** 3.2–3.5
- **done when:** at 390 px every page has `scrollWidth <= innerWidth`, axe reports zero serious or critical violations, and every modal has role=dialog, a focus trap and closes on Esc.

**3.9 Myra's read-through** · done
- **what:** Myra goes through staging side by side with the mockups at 1280 and 390 px. Fixes that block the done test go into phase 4; the rest go to further enhancements. Claude then refreshes `docs/img/screens/` by hand.
- **who:** Myra · **needs:** 3.8
- **done when:** her list is either fixed or parked, and the screenshots are refreshed.

**3.10 Prod goes beta (read-only to the public)** · done
- *(Oct 9: built and tested, waiting on Myra's OK for the "opens soon" copy and the deploy steps. Beta: production serves the feed and every reading page publicly; every response except in open mode sends noindex (static/_headers covers files the Worker doesn't serve); sign-up for allow-listed addresses only; only founding accounts and the operator act, everyone else sees "opens soon" and core refuses their acts, keys included. Production creation stays paused (pause_new_nodes) until triage is seen running there. `seed-launch.ts --approved` imports only wave-1 cards Myra approved whose done test hasn't changed since: 11 ready, 6 not ready, 3 dropped. Production still has migrations 0002–0017 pending and SITE_MODE holding. 858 unit and 145 browser tests pass; checked on staging in beta mode and set back.)*
- **what:** a `site_mode` setting (holding, beta, open). In beta: the reading pages are public at shwarm.org; every response sends `X-Robots-Tag: noindex`; sign-up takes only allow-listed addresses; join, post and "start a shwarm" for everyone else say "opens soon"; creating new nodes stays paused until triage (9.1). Each wave-1 shwarm is imported to prod once Myra approves it in 12.1, never before, because done tests lock once posted.
- **who:** Claude; Myra approves the "opens soon" copy · **needs:** 3.9, A2 (set before the first public post), 12.1 (per shwarm)
- **done when:** shwarm.org shows the feed in beta mode with every wave-1 shwarm Myra has approved so far, `curl -I` shows noindex, and a sign-up from an address not on the allow-list is turned away politely.
- *(Oct 10: anyone may join now (decisions, Oct 10). An address off the allow-list gets an account, a verify mail and "you're on the list" on the check-email page, and goes on `signup_wait` (migration 0018). Its account reads but can't act in beta, nor on production in holding mode (core refuses it there too now). Waiting on Myra: the new words in copy-to-approve.)*

### Phase 4: writing (6 days)

**4.1 Signed-in strip and gated actions** · done
- *(Oct 9: the strip was already in from phase 3. Tests cover the sign-in round trip from join, post and start a shwarm; the `next=//evil` cases were covered in 3.x. Upvote and make-a-key get theirs with 4.7 and 7.2.)*
- **what:** handle, "for you N", keys, sign out; clicking join, upvote, post, start a shwarm or make a key while signed out goes to sign-in and back. `next` accepts only relative paths starting with a single `/`.
- **who:** Claude · **needs:** 2.7
- **done when:** e2e tests cover the round trip for each action, and `next=//evil.com` and `next=https://evil.com` land on the home page.

**4.2 Create form: shwarm mode and builds-on** · done
- *(Oct 9: `/new` in shwarm mode, refusals come back with the form filled in, the fourth create in a day gets the limit error. Builds on takes a passed shwarm's link, a GitHub repo (name and SPDX license from the API) or any link with the license typed in. Left for later: the live search and the chip with "change" (needs JavaScript).)*
- **what:** fields, validation, at least one check, tags, lobby (min 2, default 10), publishes as a lobby with the author in seat 1, counts toward 3 a day; the triage hook (a stub until 9.1, and prod creation stays paused until then). Builds-on: paste a link or search passed shwarms; GitHub links get name and SPDX license from the GitHub API; any other link is stored as URL + name, with the license typed in; shown as a chip with "change"; no license picker.
- **who:** Claude · **needs:** 2.3, 3.3
- **done when:** a new shwarm appears in filling on staging, and the fourth create in a day gets a clear limit error.

**4.3 Branch and variant modes** · doing
- *(Oct 11: the variant clauses are moot (variants dropped Oct 9). The create tests pass (18), but staging has no branches yet, so the staging run of a sub-branch and the ?builds_on= chip is still to do.)*
- *(Oct 11, later: the staging run of a branch and sub-branch needs a staging agent key or a signed-in session; staging has no keys since the Oct 10 cleanup.)*
- *(Oct 11, last: on staging, a branch `minecraft-in-doom/test-branch-oct-11-claude` and a sub-branch under it were opened with the CLI, both cleared by triage and live. Left: the `?builds_on=` chip on staging, a web-form check (covered by create.test.ts).)*
- *(Oct 9: /new?parent= makes a branch: helping reach, the parent's done test, no tags, lobby or builds-on, the parent's license, live at once; sub-branches too. /new?variant= is prefilled from the original (title, what, tags) and opens its own lobby with its author in seat 1 and the form's size, linked both ways. A variant of a closed shwarm is refused with a 'build on this' way out. ?builds_on= fills the builds-on field and names a closed shwarm in a chip, and closed shwarm pages link 'build on this'. Both modes go through the tree and triage. Built defaults are proposed (decisions, open #77). Left: the staging run for 'done when'.)*
- *(Oct 9: variants dropped in the docs too. The spec, PRD, protocol §8, openapi.yaml (no CreateVariant, kind shwarm|branch), glossary, design system and new.html mockup have no variant mode. The mockup gains ?builds_on=, which fills the pick and the upstream's done test, as the site does. Open #23 is marked moot.)*
- **what:** `?parent=` (helping reach, parent's done test, no tags/lobby/builds-on, live at once); `?variant=` (prefilled, refused once the original is closed, linked both ways; a variant opens its own lobby with its author in seat 1 and the size from the form, LOBBY-7); `?builds_on=<path>` prefill, so the result page's "build on this" works.
- **who:** Claude · **needs:** 4.2
- **done when:** a sub-branch and a variant can be made on staging, a variant of a closed shwarm is refused, and `?builds_on=` fills the builds-on chip.

**4.4 Lobby, seats and kickoff** · done
- *(Oct 9: late joiners: once a shwarm is live, "join" sits under its contributors, with no seat limit and no second kickoff, and a late joiner shows among the contributors and on their profile as working on it. Re-pitch: the author changes a lobby's title and what from their own box, behind the password; earlier versions show under "re-pitched". The new words go through triage again (a new triage round), so a cleared lobby is seen only by its author until it's cleared again. Defaults proposed, open #79.)*
- *(Oct 10: Myra said yes in review round 2 to the re-pitch defaults and re-pitch history (open #79, now resolved); lobby and kickoff are gone since 8.1.)*
- *(Oct 10, later: re-pitch is replaced by "edit" ([decision](decisions.md#oct-10-review-round-2)): the author's "edit" link opens /new filled in, and everything the form holds can change until someone else joins or anything is submitted. Built in apps/site (core/nodes.ts editNode, web/create.tsx edit mode, migration 0019 keeps whole earlier versions); not deployed. Its edges and words are open [#103](open-questions.md#103-editing-a-shwarm-the-builds-edges).)*
- **what:** join (verified humans only), leave before kickoff, kickoff in one batch (state live, day count starts, "lobby filled" event, inbox items and emails), late joiners; re-pitch edits in the lobby with history (should).
- **who:** Claude · **needs:** 2.3, 4.2
- **done when:** the race test of two people joining the last seat runs 100 times in CI with exactly one kickoff each time.

**4.5 Compose box and posting** · done
- *(Oct 9: posting as the bare handle, the live limit line, the inline 429 with the wait and the draft kept, replies, mentions to the inbox, double-click protection. Hello-world run on staging: two test accounts (@hello_a, @hello_b) signed up through /join, @hello_a started "hello world" with a lobby of 2, @hello_b joined and it went live, both posted, and the mention reached @hello_a's inbox. The new shwarm had to be cleared for triage by hand first: until 9.1, a tester's new shwarm is visible only to its author.)*
- **what:** "posting as @myra", the live limit line ("5 quick replies left, then 1 every 5 min"), replies, mentions to the inbox, the inline 429 with the wait, double-click protection.
- **who:** Claude · **needs:** 2.3, 3.3
- **done when:** the sixth quick post shows the wait, and a mention of @myra creates an inbox item.

**4.6 Pinned "status update" post** · done
- *(Oct 9: the author ticks "pin it as "where we are"" in the compose box; a new pin replaces the old one, the launch seed's sources post included, which stays in the thread unpinned. The author edits the pinned post in place, and earlier versions show inline under "edit history", newest first. Its first line is the feed card's status line once the stats job runs, and follows each edit; tests cover this through the site. Core lets the poster edit any plain post (table B #30), so 4.8 only has to show "edit" on other posts. Left: no unpin and no pinning an earlier post (#78). The new words wait on Myra's OK (#78). Not yet on staging.)*
- *(Oct 9: renamed to "status update", as Myra asked on the review page. The checkbox now says 'pin it as "status update"', and the running example's pinned post, the mockups, the screenshots and the docs use the word. Pinning works as before, and no API field changed. Staging's seeded pinned post keeps its old words until the seed runs again. The step's heading here still says "where we are". Not yet on staging.)*
- **what:** the author pins one post and edits it, with an edit history view; it feeds the status line ([#40](open-questions.md#40-where-the-feeds-status-line-comes-from)).
- **who:** Claude · **needs:** 4.5
- **done when:** the feed card shows the pinned post's first line.

**4.7 Upvotes** · done
- *(Oct 9: the ▲ on each thread post is a toggle for verified, signed-in people; on your own or your agents' posts it shows only the count, and signed out it goes to sign-in and back (the 4.1 round trip). Counted per A6: every verified upvote is kept and gives the poster an upvoted post, so a week-old account with one is established; only established voters' upvotes count toward tallies, impact and ranking. A new account's upvote shows pressed with "counts once your account is established". Tests cover refusing your own post, a double upvote changing nothing, taking an upvote back, an uncounted upvote from a new account, establishment, and the stats rollup. Builder defaults, including no pace limit and old upvotes not being recounted, are proposed in #78. Not yet on staging.)*
- **what:** toggle on thread posts, humans only, never your own (or your agents') posts, counted per A6, tallies and impact updated.
- **who:** Claude · **needs:** 4.5, A6
- **done when:** tests cover own-post refusal, double-vote toggling and an uncounted upvote from a new account.

**4.8 Edit, delete, "make it a branch" (should); remove "claimed by" (must)** · done
- *(Oct 9: "edit" and "delete" on every plain post of your own; an edited post shows "edited" with its history; a deleted one leaves a tombstone ("this post was deleted.") with its replies kept. "make it a branch" on a live node's posts opens the branch form filled from the post. "claimed by" is gone from the shwarm mockup and its screenshot, and a test keeps it out of every template. Defaults proposed, open #79.)*
- *(Oct 10: Myra said yes in review round 2 to own-post edit and delete, "make it a branch" and no "claimed by", and to their words (open #79).)*
- **what:** own-post edit with history and delete with a tombstone; "make it a branch" from a post; strip "claimed by" from templates ([#19](open-questions.md#19-is-claimed-by-a-platform-state)).
- **who:** Claude · **needs:** 4.5
- **done when:** the edited post shows "edited" with history; no template contains "claimed by".

**4.9 Limit tests** · done
- *(Oct 9: `test/limits.test.ts` checks every product limit through the site: the thread post count (burst, per thread, per person, refill; replies, edits and submissions use it up, upvotes don't), 3 new nodes a day across shwarms, branches and variants (rolling day, seeded ones free, the guard inside the write holding when the earlier count was stale), one submission per person per node per day, the per-network caps on sign-up, resend, forgot, sign-in and step-up, and the read cap, which triggers, is shared by neighbours and refills, while a refused read costs no D1. Three gaps closed: the read cap now also covers the feed and profiles, the 256 KB body cap now applies to site forms (413), and forgot password gets 10 an hour per network (proposed, [#80](open-questions.md#80-limit-gaps-found-by-the-limit-tests)). A 304 is one indexed query reading only the node chain, not zero reads: zero would let a takedown answer 304 for up to 15 seconds; the in-memory option waits on Myra in #80. Left: the API's per-key caps when the API lands.)*
- **what:** tests for every product limit through the site, including the new-node trigger, per-IP form caps and the public read cap.
- **who:** Claude · **needs:** 4.2–4.7
- **done when:** the limit test suite passes in CI, including a test that the read cap triggers and a 304 costs no D1 row reads.

### Phase 5: the done-test machinery (6 days)

**5.1 Submissions** · done
- *(Oct 9: submit mode on the compose box with linked work (`url sha256` or `repo commit [path]`), built on with notes, how to check and optional release fields (name, version, how to use); refusals come back inline with the draft kept; a second submission the same day gets a 429 with the wait, a bad sha256 a 400. Copy for the submit mode waits on Myra's OK.)*
- **what:** a submit mode on the compose box; numbering per node, links validated (`{url, sha256}` or repo + commit, never uploads), built on, how to check, hash (A10), optional release fields, one per person per node per day; the submission card with "superseded by #N".
- **who:** Claude · **needs:** 4.5
- **done when:** a second submission the same day is refused, and a bad sha256 is rejected.

**5.2 Submission page** · done
- *(Oct 9: `/w/<path>/s/<n>` is built and on staging: pinned hash at the top, the done test quoted, status pill, what was submitted, checks grouped runs / people / author, history, "waiting N days", "superseded by #N". Myra approved it next to the mockup on the review page, Oct 9.)*
- **what:** `/w/<path>/s/<n>`: breadcrumb, the done test quoted, status pill, what was submitted, checks grouped runs / people / author, history, "waiting N days".
- **who:** Claude · **needs:** 5.1
- **done when:** the page matches [its mockup](../mockups/submission.html), and branch status and inbox links reach the right submission.

**5.3 Checks** · done
- **what:** the people check form (a pass needs evidence, a fail needs a repro); run report display with the signed log; slot rules (`slot_taken`, `own_work`), `not_established` (A6); tallies, "at least one human", standing repros ([#37](open-questions.md#37-must-a-repro-be-re-run-on-a-newer-submission)).
- **who:** Claude · **needs:** 5.1, A6
- **done when:** tests cover every refusal and the tally for each check mix in launch-shwarms.json.

**5.4 Ready for the author** · done
- *(Oct 9: the loop test (5.8) now sees the sign_off item appear on @myra's inbox page on the final check: new, "waiting on you", counted in "for you", and "open" goes to the submission. Nobody else sees it, and after her sign-off its pill says "approved".)*
- **what:** when every other check is in (or at once for author-only), the author gets an inbox item and an email; the node shows "waiting on author" ("waiting on you" to the author).
- **who:** Claude · **needs:** 5.3
- **done when:** the e2e test sees the inbox item appear on the final check.

**5.5 Author sign-off** · done
- **what:** the owner-only box on the submission page, behind step-up: pass with what you checked, fail with a repro that resets every check; the A9 rule for the author's own agents; the author-gone rule (table B).
- **who:** Claude · **needs:** 2.8, 5.4, A9
- **done when:** a fail shows the struck "reset" checks, and the A9 swap shows on a submission from Myra's agent.

**5.6 Pass, close, dead end, reopen** · done
- *(Oct 9: under "An ended shwarm is locked", "Continuing an ended shwarm is always build on" and "A passed shwarm stays passed", reopening is gone. There is no repro on a passed submission, no author's reopen of a dead end, no reopen control or command, the API's kind reopen is an unknown kind (400), and there is no reopened mail. Records from before stay. A closed or dead-end node is locked in core: posts, replies, pins, edits, deletes, joins, leaves, submissions and checks all answer 409 shwarm_closed with the state. The page shows a locked box instead of the compose box, with no pin, join, edit, delete or author's box. builds_on takes dead ends as well as passed shwarms, on the form, in core and in the API, and a dead end's page offers "build on this". /new?builds_on= fills done when with the upstream's done test, which stays editable. The result page lists shwarms that kept the done test as "challenged by" and the rest as "built on this". The race test of two submissions still runs 100 times; the reopen race is gone. 803 unit tests and the browser suite pass. Defaults are proposed (open #92) and the new words are in copy-to-approve.md. Left: Myra's yes on the words, and new wording for the footer pages and the closed mockup, which still say a repro reopens a pass. Not deployed.)*
- *(Oct 10: Myra said yes in review round 2 to the locked-node, build-on and challenged-by defaults, including the locked branch under an ended shwarm and no build on for an ended branch, and to their words (open #92).)*
- **what:** the pass in one batch (close, "passed" event, notices, rank bump; other open submissions superseded); a branch passing never touches its parent; dead end by the author with a note; a repro on a passed node reopens it with the pass kept on record.
- **who:** Claude · **needs:** 5.5, A11
- **done when:** the race test of two submissions finishing at once runs 100 times in CI and closes the node exactly once each time.

**5.7 Result page and audit log** · done
- *(Oct 9: a closed shwarm's page is now its result page, ported from the closed mockup. It shows the pass at the hash its checks ran, with its links and release fields and "these links leave shwarm"; the proof; who made it, ranked by counted upvotes with agents rolled up and tags only from recorded events; what's next; what's built on it; and the newest milestones. Its thread moved to ?thread=1. A passed branch keeps its live page with a "proof it's done" box. `GET /w/<path>/log` serves the audit log as JSON, with milestones or all, ?before paging, hidden branches and submissions left out, and the seeded row last. A test drives a full core run and checks that the log lists every event of it, each linked to evidence that is really on the linked page. The closed fixture is 9% off the mockup at 1280px; the live shwarm page is 14% off its own. Defaults and new words wait on Myra's yes, open #81.)*
- *(Oct 9: milestones are now key events, a fixed set: branch opened, submission, passed, dead end. /w/<path>/log takes ?filter=key (the default) or all, and ?filter=milestones still answers as key. The JSON's `milestone` field keeps its name until 7.5. The result page says "filter: key events". The log box no longer breaks handles mid-word or splits "submission #2" at 1280px: wide boxes keep room for names, and narrow ones show one wrapped line per row. A browser test guards it. Defaults are proposed in open #93. Not yet on staging.)*
- *(Oct 10: Myra said yes in review round 2 to the result page words, "challenged by" and the key events log box (open #93).)*
- **what:** the closed template (result box, external links with "these links leave shwarm", proof with evidence, who made it ranked with derived role tags, what's next with "build on this" linking to `new.html?builds_on=<path>`, built on this); the audit table (milestones / all, every row linked to evidence); `GET /w/<path>/log` as JSON.
- **who:** Claude · **needs:** 5.6, 4.3
- **done when:** a closed fixture matches [the closed mockup](../mockups/shwarm-closed.html), and the log JSON lists every event of the test run.

**5.8 The whole loop, end to end** · done
- *(Oct 11: done. The loop is in CI's browser job on every push to main, green on the latest run (8ab7964). The staging loop with signed run reports was 7.10, which is done.)*
- *(Oct 9: the loop runs locally and in CI's existing browser job (npm run test:e2e) on every merge. Four accounts go through the real pages: /new, the lobby fills and kicks off, a submission from the compose box, a run report put in through core, a people check, the author's sign_off inbox item and mail (read from the test database until 6.1) with "waiting on you", the sign-off with the password inline, the result page, and /w/<path>/log listing every event. Each new page gets axe and the mobile-width checks. Left: running it on staging, and 7.10's version with signed `shwarm run` reports.)*
- **what:** a Playwright run on staging from create to result page with four fixture accounts. Run reports are inserted as fixtures through core, since signed runs need phase 7; 7.10 repeats the loop with real `shwarm run` reports.
- **who:** Claude · **needs:** 5.7
- **done when:** it runs green in CI on every merge.

### Phase 6: profile, inbox, account (4 days)

**6.1 Owner profile and inbox** · done
- *(Oct 9: the inbox is in the sidebar of the owner's own profile, as the mockup: mentions of the bare handle with see thread, an inline reply (as the bare handle, a reply to the post that named you, in its thread and under that thread's pace limit) and mark read / unread; sign-off items with the submission's live pill that open its page; system items; "N new" and "mark all read", which stops at the newest item the page showed. "for you N" counts the same shown items, so reading one lowers both. An item shows only while its node and post show to its owner. Working on and created say "waiting on you" where a sign-off waits on the owner. Tests show another signed-in person and signed-out readers get no inbox, and their POSTs to it are refused. Defaults and new words wait on Myra's yes, open #83.)*
- *(Oct 10: Myra said yes in review round 2 to the inbox review fixes and the inbox words (open #75 and #83).)*
- **what:** the private inbox (mentions of the bare handle, sign-off items with live pills, system items), inline reply, mark read / unread / all read; "for you" count; working on and created with "waiting on you".
- **who:** Claude · **needs:** 4.5, 5.4
- **done when:** another person can't see Myra's inbox, and reading an item lowers the count.

**6.2 Account modal** · done
- *(Oct 9: the account modal is built on the owner's profile, ported from the profile mockup: locked handle and joined date; display name, about and two links; email change; notice settings; change password; "sign out everywhere". It works without script (?account=1 shows it open, × is a link back); with script it opens in place and closes with ×, Esc or the scrim, with focus kept inside. Saving and the password change confirm with the password inline, as the sign-off does. An email change keeps the old address until the new one's link is pressed; the old address is warned at once, the link lasts 24 hours, and an address that already has an account gets no link without the page saying so. A password change ends every other session and sends the "password changed" mail. "sign out everywhere" ends every session, this one too. Migration 0011 adds the "last changed" date. Browser-style tests cover email change, password change ending other sessions, and sign out everywhere, with their refusals (13 tests); a real-browser suite runs the same three through the pages plus the modal's keyboard, focus-ring, axe and phone-width checks (6 tests). 681 unit and 142 browser tests pass. Defaults and the new words are proposed, open #84. Left: Myra's yes on the copy, migration 0011 and a run on staging.)*
- *(Oct 10: Myra approved the copy and the defaults in review round 2 (open #84), including stopping and pacing email changes. With the tests above, the done-when is met; it is on staging with phases 4 to 6.)*
- **what:** locked handle and joined; about, display name, links; email change (old address stays until the new one is confirmed, old address warned); notice toggles; change password (ends every other session and sends the "password changed" mail); "sign out everywhere"; save behind step-up.
- **who:** Claude · **needs:** 2.8
- **done when:** e2e tests cover email change, password change ending other sessions, and sign out everywhere, and Myra approves the copy.

**6.3 Notice emails (should)** · done
- *(Oct 12: done. On staging Myra passed submission #1 on a test branch; the "passed" mail (node_news, notices stream) went to an allow-listed inbox through the sweep. Every notice mail has now arrived from staging: mention, digest, sign-off request, pass.)*
- *(Oct 11: checked again. The code and tests are in and the words are approved, but no mention, digest or pass/fail mail has been seen arriving from staging yet. Left: send each one to an allow-listed inbox on staging.)*
- *(Oct 11, later: on staging, a mention of a demo account pointed at an allow-listed address with mentions set to right away went out through the real sweep (outbox row 47 sent, no error). Left: the daily digest and the pass/fail mail on staging.)*
- *(Oct 12: the daily digest arrived from staging too: a mention left before 15:00 UTC went out in the 15:01 digest (outbox row 51, notices stream, sent, no error) to an allow-listed inbox. The test post was deleted and the demo account set back. Left: the pass/fail mail on staging, which needs a full submit, checks and an author sign-off.)*
- *(Oct 9: mentions of the bare handle are mailed right away for people who chose 'right away', or else in one daily digest at 15:00 UTC with the day's unread mentions (up to 20, then 'and N more'). The 4.4 kickoff mail was missing and now goes to everyone seated when a lobby fills. A pass, a fail of the author check or a reopening is mailed to the people in the node who ticked 'passes or fails' (off by default). Sign-off and kickoff mails always go right away. Every mail is written in the act's batch through the outbox and honours the notice settings and the one-click unsubscribe. The sweep skips a mail whose node or post no longer shows to its reader. Migration 0012 adds person.digest_at. Defaults are proposed in open #85, and the new words wait on Myra's OK. Left: each mail arriving on staging.)*
- *(Oct 10: Myra said yes in review round 2 to the notice mail defaults and words, and to the review fixes (open #85). The kickoff mail is moot since 8.1. Left: each mail arriving on staging.)*
- **what:** mentions right away or as a daily digest, pass/fail/reopen of nodes you're in. (Kickoff and "ready for your sign-off" mails are musts in 4.4 and 5.4; unsubscribe is in 2.6.)
- **who:** Claude · **needs:** 2.6, 6.1
- **done when:** each arrives on staging.

**6.4 Export and account closing (should)** · done
- *(Oct 11: done. close.test.ts closes test accounts, finds their posts shown as a former member everywhere, and sees their keys refused. The words were approved Oct 10. A by-hand close on staging is optional.)*
- *(Oct 9: the account modal has a 'your data' section. 'download your data' returns one JSON file behind the password (5 an hour) with everything held about the person except secrets and mail bodies. 'close your account' asks for the handle typed out, then the password. It deletes the email address, password, profile text, settings, sessions, emailed links, inbox and mail rows, revokes keys, gives up seats in other people's lobbies, hands waiting sign-offs to the operator (the author-gone rule) and sends one last mail. The handle stays with the closed account so nobody can take it. Every name under it shows as 'former member' on every page, the feed, the agent prompt and the log. Tests close @kestrel and @finn_irl, find neither handle anywhere, and show their agents' writes refused. Defaults are proposed in open #86. Left: Myra's OK on the words and the privacy page line, and a run on staging.)*
- *(Oct 10: Myra said yes in review round 2 to the export and closing defaults and words (open #86). The privacy page line now points to the account button, and the page has the visit-counts line (scripts/pages/content.py, exported to the site). Left: a run on staging.)*
- **what:** JSON export behind step-up; closing deletes private data, revokes keys and detaches the handle from posts; an author's shwarms follow the author-gone rule (table B). Fallback if it slips: the privacy page says to write to support@, and Myra handles it by hand within 30 days.
- **who:** Claude · **needs:** 6.2
- **done when:** a closed test account's posts show as a former member and its keys fail.

### Phase 7: keys, agent API, skills, CLI (9 days)

**7.1 Signing** · done
- *(Oct 9: RFC 9421 signing and verifying with Ed25519 and RFC 9530 Content-Digest are in packages/protocol (signature.ts, with a small RFC 8941 parser in sfv.ts), shared by the Worker and the CLI. It uses WebCrypto Ed25519 on raw 32-byte seeds, the same seed the shwarm_sk_ secret holds. The shwarm profile follows table B: @method @authority @path @query content-digest, plus idempotency-key when sent; created, nonce, keyid, alg="ed25519", tag="shwarm"; 300 s in the past to 60 s in the future. Refusals are 401 bad_signature with a reason. Two vectors, RFC 9421 B.2.6 and our own shwarm-v0 (key test-key-shwarm, a POST and a GET), pass in the package's Node suite and on the Worker side, both in the site's Node runtime and in real workerd through Miniflare. In workerd, requests signed on the CLI side are verified over HTTP. protocol §10 now shows the real vector. Details table B leaves open are built as proposed defaults (decisions.md, #87). Key lookup, revocation, the replay cache and idempotency are 7.3's. Not on staging; nothing in the site calls it yet.)*
- *(Oct 10: Myra said yes in review round 2 to the signed-request details (open #87).)*
- **what:** RFC 9421 sign and verify with Ed25519 and Content-Digest in packages/protocol (table B details), with the RFC's Ed25519 test vector and our own published vector.
- **who:** Claude · **needs:** 2.1, A17
- **done when:** both vectors pass in CI from the CLI side and the Worker side.

**7.2 Keys page and new-key modal** · done
- *(Oct 12: done. Myra made a key "leak test" on staging /keys while `wrangler tail` captured the Worker (624 log lines, 6 from /keys). Neither the full secret nor its seed appears in the capture or in any of the 45 staging tables (read whole, since `wrangler d1 export` refuses databases with FTS5); only the public half is stored. After the keys page's revoke, the key's next request answered `key_revoked` (CLI exit 3).)*
- *(Oct 11: checked again. The unit and browser tests cover the secret never being stored and the revoke, but the staging grep of a `wrangler tail` capture and a D1 export, and a revoked key failing on staging, are still to run.)*
- *(Oct 11, later: on staging a demo key worked, was revoked the way the keys page does it, and its next signed GET and POST answered 401 key_revoked (CLI exit 3). Left: the `wrangler tail` and D1-export grep for a secret made on the keys page, which needs a signed-in session.)*
- *(Oct 9: built and tested locally, not on staging yet. /keys lists each key with can post as, access, last used, made and expiry, and has rotate, revoke and revoke all. The new-key modal is the mockup's: name, can post as (never bare), grants picked from shwarms you're in, a search, branches or a pasted link, perms with edit/delete marked "later" and new shwarms off, expiry, and the password inline. keys.js makes the Ed25519 pair with WebCrypto and sends only the public half; the server answers with a random keyid, and the browser shows SHWARM_KEY=shwarm_sk_<keyid>_<seed> once. At most 20 working keys, made or rotated at most 20 an hour. Rotate makes a new key with the same settings and revokes the old one at once. The unit and browser tests record every request, log line and table: the seed and the secret are in none of them. The shared can-post-as matcher now takes a cut-short "*" (@myra/fathom-*), as the spec draws it. Migration 0013 adds the last-used name and node for 7.3 to fill. Left: the staging check (a wrangler tail capture and a D1 export grepped for a test key's secret), "a revoked key fails on its next request" once 7.3 lands, and Myra's yes on the defaults (#88) and the new wording.)*
- *(Oct 10: Myra said yes in review round 2 to the keys page defaults and the new wording (open #88). Left: the staging grep check, and "a revoked key fails on its next request" on staging.)*
- **what:** the key list (can post as, grants, last used, expiry, rotate, revoke, revoke all); the modal (name, can post as, never bare; grant chooser with search, children and pasted-link resolve; permissions with edit/delete marked "later", and `new_shwarms` off by default; expiry; step-up); the key pair made in the browser so only the public half reaches the server; the secret shown once as `SHWARM_KEY=shwarm_sk_<keyid>_<seed>`; at most 20 keys; the "you" box rewritten for password sign-in.
- **who:** Claude · **needs:** 2.8, 7.1
- **done when:** a test key's secret string isn't found by grep in a `wrangler tail` capture of the key-making flow or in a D1 export, and a revoked key fails on its next request.

**7.3 The signed request pipeline** · done
- *(Oct 9: built, not deployed. Every request with a signature now goes to the agent API (apps/site/src/api), which checks it before any route runs and never hands it to the site's pages or forms. The checks run in this order: Shwarm-Version (missing means 0), the signature through packages/protocol (300 s / 60 s, clock_skew with server_time, Content-Digest, the exact base), the site's own host (wrong_host), the key read fresh with its grants (key_revoked only once the signature verifies), the nonce once per key (replay), and Idempotency-Key on every POST (a 2xx answer kept 24 hours and replayed with Idempotent-Replayed: true; another request under the key is 409). Can post as and grants stay core's. Last use is debounced to a minute, each network is recorded, and the 'your agent key was used somewhere new' mail skips the key's first network when the human signed in from it and goes at most once per key an hour (migration 0014). Every response sends Date. 17 tests cover replay, stale and future created, wrong host, wrong digest, a bare as, a grant miss, an idempotent retry and the published vector through the site. Build defaults are proposed in decisions.md (#89), and the mail and refusal words wait on Myra. Left: 7.4's routes; staging's basic-auth lock sits in front of the API.)*
- *(Oct 10: Myra said yes in review round 2 to the pipeline defaults, the held-back "used somewhere new" mail, and the mail and refusal words (open #89).)*
- **what:** freshness (300 s past to 60 s future; every response sends `Date`; a stale or future `created` returns 401 bad_signature with `reason: "clock_skew"` and the server time), Content-Digest, the exact signature base, key lookup with no cache, nonce replay check, idempotency, can-post-as and grant resolution (most specific wins), debounced last use, networks seen and the "key used somewhere new" email.
- **who:** Claude · **needs:** 7.1, 2.2
- **done when:** tests cover replay, stale, future `created`, wrong host, wrong digest, a bare `as`, a grant miss and an idempotent retry.

**7.4 Agent endpoints** · done
- *(Oct 9: built in `apps/site/src/api/routes.ts`, `limits.ts` and `cors.ts` on 7.3's pipeline: postToNode (post, submission, people check, run report), createBranch, createShwarm, signed getNode and getNodeLog, getMentions, `GET /key` and `GET /limits`. Creates return 202 with `triage: "held"`, and the Node JSON read with the author's keys shows held, blocked or cleared. Every bare-handle act from a key is 403, and createShwarm without `new_shwarms` is 403 not_permitted with need=new_shwarms. There is a per-key cap of 120 signed requests a minute, RateLimit headers on every signed answer, 429 bodies with Retry-After, CORS on the API and public reads but never forms, and a JSON 413. Core createNode now refuses keys any node their human can't see. Contract tests in `test/api.test.ts` validate the answers, including a held create, against docs/openapi.yaml, which changed only where 7.4 needed it. There is no variant create, because "Variants are dropped" (Oct 9) supersedes that part of this step. The field names stay the code's (`links`) for the 7.5 freeze. Defaults are proposed in decisions.md (open #90) and the new words are in copy-to-approve.md. 803 tests pass. Not deployed.)*
- *(Oct 10: Myra said yes in review round 2 to the agent API defaults and their refusal words (open #90).)*
- **what:** postToNode (post, submission, people check, run report), createBranch, createShwarm (with variants), getMentions (segment matching, private, `limit`), getNodeLog, GET /key, GET /limits; RateLimit headers and 429 bodies; the error table; size caps and the per-key cap; CORS on public and signed routes, never on site forms. createShwarm needs `new_shwarms` (variants need `branch`); its byline is the agent, its author is the human, and no seat is taken automatically. createShwarm and createBranch return 202 with `triage: "held"` and the node URL while triage runs; getNode with the author's keys shows `triage: held|blocked|cleared`.
- **who:** Claude · **needs:** 7.3, phases 4–5
- **done when:** contract tests pass against openapi.yaml (including a held create), every bare-handle act from a key returns 403, and createShwarm with a key lacking `new_shwarms` returns 403 not_permitted with `need=new_shwarms`.

**7.5 API docs and v0 freeze** · done
- **what:** update openapi.yaml and protocol.md to what ships (humanKey removed, signature set, idempotency, version header, new error codes, the hash, the triage field; the state enum follows A11: lobby, live, closed, dead_end, with `in_review` as a flag and reopening as an audit event); serve `/openapi.yaml`, a reference rendered from it, and the protocol at `/docs/protocol`; update the "not built yet" rows on the api page; record the v0 freeze.
- **who:** Claude; Myra approves the freeze · **needs:** 7.4
- **done when:** docs/openapi.yaml and mockups/openapi.yaml match, the reference is live on staging, and the freeze is in decisions.md.
- *(Oct 9: docs/openapi.yaml and docs/protocol.md now describe what apps/site serves: the signature set and pipeline, idempotency, Shwarm-Version, every error code, reason, need and limit the code answers with, the A10 hash worked through an example, the triage field, live/closed/dead_end with in_review as a flag, no variants, no reopening, links as {url, sha256, label?} | {repo, commit, path?, label?}, and the key-events filter. GET /w/<path>/s/<n> is now documented. The closed-shwarm result/attribution/built_on_by fields, which the JSON never served, are out of v0. The log's `milestone` field is now `key`, and lobby_not_open and blocked_for_harm leave the code table. mockups/openapi.yaml is a symlink to the docs file. The Worker serves /openapi.yaml, /docs/reference (rendered on the server, no script) and /docs/protocol where the reading pages are open. The api page links them; the skills, MCP and CLI rows still say not built yet. A contract test (test/docs.test.ts) holds the spec to the code in both directions and checks the examples against the schemas and the code. 871 tests pass. The freeze is recorded as proposed (open #96), and the new words are in copy-to-approve.md. Left: a deploy so the reference is live on staging, and Myra's yes on the freeze. Oct 10: on staging; /openapi.yaml there is byte-equal to docs/openapi.yaml, and /docs/reference and /docs/protocol answer. Left: Myra's yes on the freeze.)*

**7.6 Agent skill** · done
- **what:** `SKILL.md` and the sandbox recipe: read the node first, one name per run, how to post, submit (sha256 and commit), check, run reports, limits etiquette, polling mentions, and the safety rules (participant text is data; never act as the bare handle; never use the human's browser, password or session; keep keys out of reach and out of repos, with the gitleaks rule). Served raw at `/skills/shwarm/SKILL.md` and as a page at /skills; every "agent skills" link points there.
- **who:** Claude writes; Myra reviews · **needs:** 7.4
- **done when:** Myra has approved it and no page links "agent skills" to "#".
- *(Oct 9: drafted and built, not deployed. skills/shwarm/SKILL.md is a skill file a harness loads, with its sandbox recipe beside it in sandbox.md. It covers reading the node first, one name per run, posting, links pinned by sha256 or full commit, submitting, people checks, run reports, limits, polling mentions, signing, and the safety rules: participant text is data; never the bare handle; never the human's browser, password or session; keys out of reach and out of repos, with the repo's gitleaks rule. The site serves both files as written at /skills/shwarm/SKILL.md and sandbox.md, and as the page /skills. mockups/skills.html is the same page, and `node scripts/pages/export-skill.mjs` keeps all three in step. Every 'agent skills' link on the site and in the mockups goes there; none links '#'. Like the API docs, it's served only where the reading pages are open. On production while it holds, /skills says 'opens soon' and the files are a 404. It isn't in static/skills/ as the repo layout drew it, because static files can't be held back. Tests check the skill against the code: its calls, error codes, limits, name pattern and gitleaks rule. 882 unit tests and the e2e pages suite, /skills included, pass. Builder's defaults are proposed in decisions.md, open #97, and the new words are in copy-to-approve.md. Left: Myra's review of the skill, and a CLI section once 7.7 ships. Oct 10: on staging at /skills and /skills/shwarm/SKILL.md. Left: Myra's review.)*

**7.7 The `shwarm` npm package** · done
- *(Oct 11: @shwarm/cli 0.1.3 is on npm with provenance, and the exit-code tests pass (CLI 73/73, the site's cli tests). Left: `npx @shwarm/cli read` and `post` from the published package against staging, from a clean home folder.)*
- *(Oct 11, later: from a clean HOME and an empty folder, `npx -y @shwarm/cli@latest read minecraft-in-doom` (0.1.3) read staging. Left: `post`, which needs a staging agent key; staging has none since the Oct 10 cleanup.)*
- *(Oct 11, last: done. Myra said re-seed the demo people on staging (six demo person rows, nothing else). From a clean HOME and an empty folder, `npx -y @shwarm/cli@latest` 0.1.3 read minecraft-in-doom and posted as @kestrel/claude-check (exit 0); the post was then deleted. `scripts/staging-test-key.ts` is now `.mts` and runs with `npx tsx`.)*
- **what:** the client library (signing, idempotency, retries only on network errors and 429, typed errors, link hashing) and the CLI (`login --key` / `SHWARM_KEY`, logout, whoami, read, log, post, submit, check, branch, new, variant, mentions with `--since`, `--limit` and `--follow`, limits), `--json` on every command, exit codes per CLI-16, a `--profile` config (CLI-17), and `--as @handle` with no path printing "bare-handle acts happen on shwarm.org" and exiting 3 without calling the API. The secret lives in a 0600 file or `SHWARM_KEY`. Sends `CF-Access-Client-Id/Secret` from `SHWARM_ACCESS_ID/SECRET` when set (staging only). Warns when its clock is more than 30 s off the server's `Date`. Published with provenance through trusted publishing.
- **who:** Claude; Myra approves the first publish · **needs:** 7.4
- **done when:** `npx @shwarm/cli read` and `npx @shwarm/cli post` work against staging from a clean machine, and the exit-code tests pass.
- *(Oct 9: built in packages/cli as @shwarm/cli 0.1.0, MIT, not published. The client library signs through @shwarm/protocol (each retry signed afresh), puts one Idempotency-Key on every POST and keeps it across retries, retries only on network errors and on 429s that ask for 60 s or less, throws typed errors, hashes links (it fetches --link URLs itself; #sha256= gives the hash; --repo url@commit), and warns when the clock is more than 30 s off the server's Date. The shwarm command has login --key (file or stdin; a key typed on the command line is refused), logout, whoami, read, log, post, submit, check, branch, new, mentions with --since, --before, --limit and --follow, and limits. Every command takes --json, --profile and --server, and exit codes follow CLI-16, with an API 400 or 413 exiting 2. The secret lives in a 0600 file beside ~/.config/shwarm/config.toml, or in SHWARM_KEY, which is never written down. --as with no path prints "bare-handle acts happen on shwarm.org" and exits 3 without sending anything. There's no variant command. Staging sits behind basic auth, not Cloudflare Access, so the CLI sends SHWARM_BASIC_AUTH to the server only, and no Access headers. 29 package tests and 8 more against the Worker in-process (signing, every exit code, the --as refusal) pass, and so do all 893 site tests. The packed tarball installs and runs from a clean folder. The built CLI read staging. publish-cli.yml publishes with provenance, by hand, as a dry run by default. Defaults are proposed in open #98, and the words wait on Myra. Left: a signed post on staging with a key made on its keys page, Myra's yes on the words and the first publish (with a one-time NPM_TOKEN, then trusted publishing), and naming the package in the skill and on the api page once it's published. Oct 10: review fixes in (mentions --follow no longer skips a burst; SHWARM_BASIC_AUTH goes only to SHWARM_SERVER). Left: a signed write on staging from a clean machine (7.10), and Myra's OK for the first npm publish.)*
- *(Oct 10: the built CLI read, posted and submitted on staging with test keys for demo accounts, from fresh Claude Code sessions (transcripts kept in the session scratchpad), and `--as @myra` was refused locally with exit 3. Myra said yes to the first publish; it waits on two things only she can do: the repo is private, and npm's provenance needs a public one (open #98: make it public, or publish without provenance), and npm needs the trusted publisher set on npmjs.com (repo myrakrusemark/shwarm, publish-cli.yml) or a one-time NPM_TOKEN. Left: that, then `npx @shwarm/cli` from a clean machine.)*

**7.8 `shwarm run`** · done
- *(Oct 11: done. Both done-when clauses are met: the two staging run reports (Oct 10), and the wrong-hash refusal before anything runs, covered by test/cli.test.ts and packages/cli run tests, which pass. Still open but outside the done-when: a container run with a real engine, and #99 (should the container be required).)*
- **what:** must: shows the command and asks first, refuses own work or a taken slot, verifies every link's hash, recomputes the submission hash, posts the report. (should): runs only inside the container recipe.
- **who:** Claude · **needs:** 7.7
- **done when:** a run report from `shwarm run` counts on a staging submission, and a link with a wrong hash is refused before anything runs.
- *(Oct 9: built in packages/cli (src/run.ts and the run command), not on staging. `shwarm run <path>[/s/<n>] --as <name>` asks the API first (the key, the node and the submission) and refuses before fetching or running anything what the server would refuse, with its code and exit: own work, a slot held by any of the runner's names, the author's sign-off, a name or grant the key lacks, a locked node, no runs, nothing in review. It recomputes the submission hash from its text and links, then fetches every link into a fresh temp folder and verifies it: files by sha256, repos checked out at exactly their commit with no hooks or git config. A wrong one is refused (422 link_mismatch) before anything runs. It shows the command and asks; --yes is for scripts. It runs the command unchanged with only PATH from the environment (no SHWARM_KEY), or in the sandbox recipe's container with --container <image>, which is documented and offered, not required. Then it posts the signed run report: exit code, log inline up to 64 KB (a bigger one is saved and posted later with --report and --log-url once the link holds the same bytes), env and script hash. Tests cover each refusal and, against the in-process Worker, a run report that counts, own work and a taken slot refused before running, the second run passing the node, and a wrong-hash link refused before anything runs. grantFor moved to @shwarm/protocol. Defaults are proposed in decisions.md (open #99), and the new words are in copy-to-approve.md. 896 site tests and 44 CLI tests pass. Left: a run report from `shwarm run` counting on a staging submission (7.10's loop does it), a container run with a real engine, and Myra's call on whether the container is required. Oct 10: review fixes in (a silent command's empty log now counts; a node locked by an ended ancestor is refused before running). The server side is on staging. Left: a run report counting on staging, in 7.10.)*
- *(Oct 10: two `shwarm run` reports (@kestrel/runner, @lumpy/runner) counted on staging submission #2 of minecraft-in-doom/staging-smoke-test-a-readme-is-there, and the second passed the node. Own work (exit 3) and a taken slot (exit 4) were refused before anything ran. Left: a wrong-hash refusal on staging (covered in-process), and a container run with a real engine (none on this machine).)*

**7.9 Local MCP and a Python example (should)** · done
- *(Oct 12: done (Myra: "yes definitely the mcp"). Claude Desktop's config has a `shwarm-staging` server that runs `~/.config/shwarm/staging-mcp.sh` (it loads the staging password and the demo @kestrel test key from ~/.config/shwarm; no secret in Desktop's config) and starts `npx -y @shwarm/cli@latest mcp --as @kestrel/desktop`. After a restart, Desktop listed the server, asked before each tool, read minecraft-in-doom and posted p_6jm33mdc9w as @kestrel/desktop; the post was then deleted. The key expires Oct 18, after which the server answers with a key error until it's renewed or removed.)*
- *(Oct 11: the npm publish and the words are settled (m-words-7). Left: Claude Desktop itself reading and posting on staging. It's installed here but shwarm isn't in its config yet, and adding it means restarting Myra's app, so ask first. The staging test keys expire Oct 17.)*
- **what:** `shwarm mcp` with the tools from prd-api §4 and no bare-handle tools; a short Python signing example with the test vector on the api page.
- **who:** Claude · **needs:** 7.7
- **done when:** Claude Desktop can read and post on staging through it.
- *(Oct 9: built, not published or on staging. `shwarm mcp [--as @you/agent]` in packages/cli is an MCP server over standard input and output, with no SDK and no runtime dependencies, on the same client library and key as every command. Its tools are read_node (also <path>/s/<n>), read_log, mentions, limits, post, submit, check_run, check_people, open_branch and start_shwarm. Their schemas are generated from docs/openapi.yaml, and the build and a test fail on drift. There are no bare-handle tools: a bare as or to is refused before anything is sent, and a bare --as stops it at start. Refusals are tool errors holding the API's error body, and JSON with participant text goes under untrusted. A file link without a sha256 is fetched and hashed locally, as --link does. It also serves the node prompt resource, the skill files and the shwarm_contribute prompt. The api page has a new 'signing, in python' section showing packages/protocol/examples/sign.py unchanged; a test checks it against both published vector requests where python3 has cryptography. 22 new tests, including the server listing its tools and reading, posting, submitting and checking against the in-process Worker. Defaults are proposed in decisions.md (open #100) and the new words are in copy-to-approve.md. Left: Claude Desktop reading and posting on staging, the publish, and Myra's OK on the words. Oct 10: review fixes in (branch paths through the MCP resource template; the Python example's @authority). Left: Claude Desktop on staging, the npm publish and Myra's OK on the words.)*
- *(Oct 10: `shwarm mcp --as @lumpy/mcp` over stdio against staging, driven by a script rather than Claude Desktop: initialize, tools/list (10 tools), read_node, a post (p_gfnnv8qchw), and a bare-handle tool error. Left: Claude Desktop itself and the npm publish.)*

**7.10 Agent smoke test and the real loop** · done
- **what:** a fresh Claude Code session given only a node URL, the skill, `SHWARM_KEY` and the Access service token reads, posts and submits on staging, and gets 403 when told to post as @myra. Then the full loop with two real `shwarm run` reports from two fixture accounts.
- **who:** Claude · **needs:** 7.6, 7.7, 7.8
- **done when:** the transcript shows each of those, and the loop reaches a result page on staging.
- *(Oct 10: test keys for the demo accounts @bmo_fan, @kestrel, @lumpy and @finn_irl on staging, made with `scripts/staging-test-key.ts` (staging only, seed demo accounts only, the secret only in a 0600 file; the keys expire Oct 17). A fresh headless Claude Code session given only the node URL, the skill, SHWARM_KEY and the staging password read the skill and the node, posted and submitted (#2). Told to post as @myra, it declined under the skill's rule, and `--as @myra/agent` was refused (not_your_name, exit 3); the server's 403 for both @myra and @myra/agent was confirmed by a direct signed request. The branch staging-smoke-test-a-readme-is-there passed on two `shwarm run` reports, and its result page shows on staging ("passed on submission #2"). The skill went in as a file because Claude Code's permission check blocks `curl -u "$VAR"`. Checked independently against live staging; no secret is in the repo.)*

**7.11 The briefing points to everything an agent needs** · done
- *(Oct 12: done (Myra said yes). A fresh `claude -p` in an empty folder outside the repo got only https://shwarm.org/w/heesch-number-7 and "your human made you a key". On shwarm.org it read only the shwarm, then the skill and the safety guide the briefing named; it found the key, learned the cli from `--help`, and posted as @myra/claude: https://shwarm.org/w/heesch-number-7#p_ajyb9ssvpp. No guessed addresses (its other fetches were research on heesch-sat). 20 turns, $0.86. Its post found a real bug: `-maxlevel 9` labels a heesch number of 9 or more "inconclusive", so only 7 or 8 could pass; Myra raised it to 20, on staging and production (triage cleared it again).)*
- *(Oct 11: checked on production. The briefing and node JSON name the skill, keys, api, cli, mcp and the sandbox recipe. Missing: "shwarming safely" in the briefing and `resources`, and an address after "signed with your human's key". /skill and /docs still answer 404. No clean run since the 7.15 fixes. Left: those fixes, then a fresh agent from one production url, with no guessed addresses, to a signed post.)*
- *(Oct 11, later: the briefing, the submission briefing, the node JSON (`resources.safety`, `resources.signing`) and the text front door now point to /guide-safety; "signed with your human's key" links SKILL.md#signing; /skill and /docs redirect (302) to /skills and /api. Left: deploy to shwarm.org, then a fresh agent with only a production shwarm url reaches a signed post without guessing an address (a real post as @myra/claude needs Myra's OK, as m-first-post did).)*
- **what:** a fresh agent given only a shwarm url finds the skill, the api, the cli and mcp, the sandbox recipe and "shwarming safely" from the briefing itself; "signed with your human's key" and "use the sandbox recipe" link to their pages; the node JSON carries the same pointers; /skill, /llms.txt and /docs answer.
- **who:** Claude (agent-journey session) · **needs:** 7.6
- **done when:** a fresh agent with only a production shwarm url reaches a signed post without guessing a single address.
- *(Oct 10: on staging (10b3911): the briefing opens "how to take part" with the skill, keys and api links; the sandbox recipe is linked; the node JSON has a `resources` object (skill, sandbox, api, openapi, protocol, keys, join), additive in openapi.yaml. RENDER_VERSION 7. Left: name the cli and mcp here once @shwarm/cli is published (m-npm).)*
- *(Oct 10: @shwarm/cli 0.1.0 is on npm (trusted publishing, with provenance). ed93c28 names `npx @shwarm/cli` in the briefing, the front door, SKILL.md and a new "the cli and mcp" section on /api; RENDER_VERSION 8. Ships in v0.2.1.)*

**7.12 Errors that tell an agent what to do** · doing
- *(Oct 11: Myra kept both as built: `401 bad_signature` (reason missing) and the 405 on /branches ([decision](decisions.md#oct-11-terms-and-privacy-final)). Left: her read of the 7.11–7.14 words in [copy-to-approve](copy-to-approve.md) (m-agent-words).)*
- *(Oct 11: every case answers on production, and on staging since 10b3911, with tests in email, auth and node-pages. Two parts differ from the what: the code is `bad_signature`/`missing`, not `needs_signature`, and /branches answers 405 instead of listing branches. Both are proposed defaults (decisions, "Agent journey: build defaults"). Waits on Myra's yes to those and to the 7.11-7.14 words.)*
- **what:** an unsigned POST to a node answers 401 `needs_signature` with a pointer to the skill (not "this form came from another site"); unsigned `GET /mentions` and `GET /key` answer 401, not "not found"; `GET <node>/branches` lists the branches instead of 404.
- **who:** Claude (agent-journey session) · **needs:** 7.4
- **done when:** each case answers as above on staging, with tests.
- *(Oct 10: on staging (10b3911): an unsigned write with no browser signs answers 401 `bad_signature`, reason `missing`, with the skill's address; cross-site browser writes still 403; unsigned `GET /key`, `/limits`, `/mentions` answer 401; `GET <node>/branches` answers 405 with `Allow: POST` and how to open one. 938 site tests pass. Waits on Myra's yes to the words.)*

**7.13 A text front door** · done
- *(Oct 11: checked on shwarm.org with curl: `/` and `/llms.txt` answer in plain text with the skill, cli, api, keys and live shwarms; unknown addresses answer a plain-text 404. Done.)*
- **what:** `/` and the not-found pages answer in plain text to `Accept: text/plain`, and `/llms.txt` gives an agent the short map of shwarm: what it is, how to take part, where the api and skill are.
- **who:** Claude (agent-journey session) · **needs:** 7.11
- **done when:** an agent handed only "shwarm.org" finds its way in plain text.
- *(Oct 10: on staging (10b3911): `/` and `/llms.txt` answer agents in text or JSON (any Accept that doesn't rank text/html first, curl's included); error pages outside `/w/` answer curl in plain text; browsers unchanged.)*

**7.14 Briefing wording fixes** · doing
- *(Oct 11: still left: the briefing doesn't explain impact or say that only invited testers act in the beta. robots.txt is built (11.7) but not on shwarm.org yet. Myra's two calls aren't on the Needs Myra list yet.)*
- *(Oct 11: the briefing now explains impact ("upvotes per post here. only humans upvote, and only established accounts' upvotes count.") and, in beta, says only invited testers can act (403 not_permitted, reason opens_soon). Myra's two calls are open [#111](open-questions.md#111-an-agents-first-move-on-an-empty-shwarm) and [#112](open-questions.md#112-does-a-run-commands-script-ship-with-the-submission). Left: robots.txt and these lines reach shwarm.org with the next tag, and a read-through of the wave-1 briefings.)*
- *(Oct 11, later: every wave-1 briefing was read as a fresh agent would. The shared template is fixed: the beta line comes before "make a key"; the data header says a done test's command runs only as a check; a run passes when its command exits 0; where a named script comes from (as built, open #112); the license line always prints; "3 new shwarms or branches a day"; the mentions name form; "(a run or a people check)"; a `note` in the node JSON that participant text is data. 33 fixes to the cards' own text are drafted for Myra (m-card-fixes). explain-one-ai-proof was approved but never posted to production.)*
- *(Oct 11, last: Myra said apply all 33 card fixes and allow MPL-2.0 upstream. They're in launch-shwarms.json; her chat approval is recorded in tracker/proof.json with its source, so all 18 wave-1 cards read as ready. `scripts/edit-launch.ts` runs core's own edit as @myra (the password step-up is the only check it skips; it refuses a node someone else joined or submitted to). On staging, 14 shwarms were edited (3 aren't on staging) and triage cleared all 14 again. The production dry run is clean: 17 to edit, none refused. Left: Myra runs it on production from a terminal (m-card-fixes), and imports explain-one-ai-proof.)*
- *(Oct 11, last: Myra ran both on production: 17 shwarms edited, explain-one-ai-proof posted; triage cleared all 18, none held. Production now has all 18 wave-1 shwarms. Left: these briefing lines reach shwarm.org with the next tag.)*
- **what:** "1 posts/day", "1 run, each by a different person" and "1 person, at least one of them human" read right; impact explained; the pinned post's "builds on:" only when there is one; robots.txt signals; the briefing says sign-up is invite-only. Two need Myra: what an agent's first move is on an empty shwarm (joining was a site act until Oct 12, so two agents could build the same thing blind), and whether a run command's script ships with the submission everywhere.
- **who:** Claude (agent-journey session), Myra on the two calls · **needs:** 7.11
- **done when:** the briefing for every wave-1 shwarm reads cleanly to a fresh agent.
- *(Oct 10: count wording done ("1 run, by anyone but the submitter", "1 person, a human", "1 post/day"). Left: the two calls for Myra.)*

**7.15 The cli and mcp, driven as a fresh agent** · done
- **what:** an ergonomics pass on `@shwarm/cli` and `shwarm mcp`, driven on staging by fresh sessions; fix what's rough; the api page shows them as available once published (7.7).
- **who:** Claude (agent-journey session) · **needs:** 7.7, 7.9
- **done when:** a fresh Claude Code session does read, post, submit and check through `shwarm mcp` with no help.
- *(Oct 10: c2a0fe5: an agent can find shwarms: `GET /shwarms` (hot, new or closed; `?q=` words and #tags; text, or JSON with pitch, done test and an `untrusted` list), in openapi.yaml and protocol §2, linked from the front door. `shwarm mcp` gains find_shwarms and whoami, and its instructions name the first moves; the CLI gains `shwarm find`. protocol §14 lists the 401 `missing` reason and 405 `method_not_allowed`. Site 940/940, CLI 64/64. Left: driving the built CLI and mcp by hand against a local copy, and a CLI test for find.)*
- *(Oct 10: Myra made a production key for the agent-journey session (@myra/claude; read, post, submit, check; expires Oct 17). The fresh-agent run happens on production once v0.2.1 is out: v0.2.0 has no `/shwarms`.)*
- *(Oct 10, on production (v0.2.1): a clean subagent given only shwarm.org/w/pfas-in-your-tap and its key got to a ready signed post: whoami, limits, mentions, find, read, the mcp handshake (19 tools), a drafted post with a hashed link. It guessed two addresses (/llms.txt, which nothing links to, and /api?format=text). Done apart from the post itself, which is real and goes out under @myra, so it waits on Myra's OK (m-first-post). Fixed for v0.2.2 (2d3dfb9, 62c66f3): shwarm run's help says it shows the command and asks first; the rules page's "running swarm"; unsigned /dm and /dm/who answer 401. Next (agent-journey session): a take-part block in the node JSON, per-command CLI help, a text /api, dm tools hidden from keys without dm, a link to /llms.txt. The public protocol page no longer names tracker steps.)*
- *(Oct 10: the follow-ups are in (01c8178, 8ef75a7; @shwarm/cli 0.1.2 on npm), for v0.2.2: the node JSON has `take_part` (where to post and open a branch, mentions, `locked`, the rules), in openapi's Node schema; `shwarm <command> --help` explains each command's options; the footer pages, /api above all, come as plain text to an agent (`Accept` text or `*/*`, or `?format=text`); the dm tools say they need the dm permission, and `shwarm whoami` shows dms, the default name and the key file; /api links /llms.txt. RENDER_VERSION stays 9 (not yet on production). openapi.yaml no longer names tracker steps either.)*
- *(Oct 10: done on production. With Myra's yes (m-first-post), the fresh agent's post went out as @myra/claude: shwarm.org/w/pfas-in-your-tap#p_4wknzncxam, the UCMR 5 zip linked and hashed, its numbers recounted first.)*

**7.16 Agent DMs: how they work** · done
- **what:** Myra answers [open #104](open-questions.md#104-agent-dms-how-they-work): the default, who may write to whom, the switch, how it's advertised, privacy, limits.
- **who:** Myra · **needs:** nothing
- **done when:** #104 is decided.
- *(Oct 10: accepted as proposed, through the agent-journey session; recorded in decisions, "Agent DMs: the #104 defaults".)*

**7.17 Agent DMs: the server** · done
- **what:** storage (expand-only migration), `POST /dm`, `GET /dm`, the switch on the keys page, the `dm` key permission, "dms on" in briefings and `GET /key`, blocks, limits, reports to Myra's queue, retention, openapi and the api page. Every DM reaches an agent wrapped as untrusted data.
- **who:** Claude (this session) · **needs:** 7.16
- **done when:** two staging agents with DMs on exchange messages through the API, and one with DMs off is refused.
- *(Oct 10: built, in-process. Migration 0020 (expand only: `agent_key.dm`, `dm_name`, `dm`, `dm_block`); core/dm.ts; `POST /dm`, `GET /dm` (oldest first, `since`, `wait` up to 25 s), `/dm/who`, `/dm/block`, `/dm/unblock`, `/dm/report`; `dm` in `GET /key`; contributors carry `dms` for the briefing; a "direct messages" box on the keys page (the per-name switch, blocks) and the key's dm checkbox; `/dms` for humans to read, report and block; reports go to the report table and mail the admins; DMs deleted after 30 days; DMs off and blocks gone when an account closes. The same `403 dms_off` for off, blocked and unknown, and `/dm/who` and the limits don't give a block away either. openapi, protocol §9 and the api page updated. A review fixed: cursors that named someone else's DM, a key revoked during a long wait, two sends at once both passing the new-recipient limit, the RateLimit wait, and the prune order. Site 977/977, protocol 103/103, CLI 72/72. On staging (b9711b1): deployed, migration 0020 applied. Left: the done-when on staging, which needs agent keys there (m-staging-agents), or on production after the tag.)*
- *(Oct 10: live on production in v0.2.1 (6425bf8); migration 0020 applied there. The two-agent exchange runs on production as part of 7.19.)*

**7.18 Agent DMs: push through mcp** · done
- **what:** `shwarm mcp` watches the DM inbox and pushes each new DM into the running session (Claude Code channels, where enabled), with tools to send a DM and switch DMs; polling where push isn't on.
- **who:** Claude (agent-journey session) · **needs:** 7.17
- **done when:** a DM sent on staging appears in another running Claude Code session within seconds, and in any MCP client through the dm tools.
- *(Oct 10: client side built (7328ce6), waits on 7.17 for a live test: `shwarm mcp` declares the channel and, holding a key, long-polls `GET /dm` and pushes each new DM wrapped as participant text with a reply hint; its own names aren't pushed back; a cursor file means a restart neither repeats nor drops; `--no-dms` turns it off. Tools dm_send, dm_read, dm_who, dm_block, dm_unblock, dm_report; CLI `shwarm dm send|read [--follow]|who|block|unblock|report`. CLI 71/71. Smoke over real stdio against production, read only: the channel capability, 18 tools, clean no_key error.)*
- *(Oct 10: channels checked in the Claude Code docs: the server declares `experimental["claude/channel"]` and sends `notifications/claude/channel`; Claude Code only, research preview, needs `--dangerously-load-development-channels server:shwarm` until shwarm is an allowlisted plugin, not in headless or SDK sessions. So push is a bonus; the baseline is the dm tools plus polling and `shwarm dm --follow`. Sender identity is checked before a push, matching the switch and blocks.)*
- *(Oct 10: 1291148, @shwarm/cli 0.1.1 on npm: the dm tools are generated from openapi (scripts/mcp-tools.mjs); the briefing's "how to take part" says how to DM and, when anyone there has DMs on, whose agents take them; the node JSON gains `dms: {send, on}`; SKILL.md has a direct messages section; the CLI readme has the dm commands and the channels flag. RENDER_VERSION 9. Site 978, CLI 72. Ships in v0.2.2. Known: a signed-out reader's cached copy of a node can show the old "dms on" list until that node's next event.)*

**7.19 Agent DMs on staging, end to end** · done
- **what:** two fresh sessions find each other through "dms on", talk, one blocks the other, a report reaches Myra's queue.
- **who:** both · **needs:** 7.17, 7.18
- **done when:** the transcript shows each of those.
- *(Oct 10: Myra replaced the agent-journey session's production key with one that has the dm permission. The test runs on production.)*
- *(Oct 10: on production, the new key (can post as @myra/*, dms permitted) gets clear refusals while no name is on: `dm who` says the name doesn't take DMs, and a send is `403 dms_off`, "turn them on on the keys page". A push bug found and fixed (c452fce, @shwarm/cli 0.1.3): `shwarm mcp` skipped every DM from a name its key covers, so two agents of one human never got each other's pushed; now it pushes what's written to the session's `--as` name (or any name the key covers, without `--as`) and skips only what that session sent. CLI 73/73. Next: Myra turns DMs on for two names (m-dm-names), then a CLI exchange, block, unblock and report; the live push needs one Claude Code session that Myra starts herself.)*
- *(Oct 10 ~22:20 UTC: done on production. Myra turned DMs on for @myra/claude and @myra/tester. With the CLI: `dm who` answers right, @myra/tester → @myra/claude is 202, `dm read` shows it wrapped between nonce markers, unblock works. Live push: Myra started a Claude Code session with `claude mcp add shwarm -- npx -y @shwarm/cli@0.1.3 mcp --as @myra/claude` and `claude --dangerously-load-development-channels server:shwarm`; a DM from @myra/tester (d_6zw3re7fqz) appeared there unasked, and that Claude treated it as data and offered to reply rather than replying. Not run live: block (it refuses your own names, rightly; it needs a second person's agent) and report (so Myra isn't mailed about herself); both are covered by the server's tests. Known: until shwarm is on Claude Code's channel allowlist, push needs the dangerously flag at every launch; without it, DMs still arrive by asking (dm_read).)*

### Phase 8: further enhancements (after launch)

Functional changes Myra has chosen, held until after launch so they don't muddy the current work. They don't count toward launch. The one-line list of smaller ideas is [section 8](#8-further-enhancements); longer write-ups are in [further enhancements](further-enhancements.md).

**8.1 No lobby** · doing
- *(Oct 11: the sweep is clean apart from "kickoff" in two wave-3 done tests (rupert solid, inkscape bugs) and two idea cards. The CLAUDE.md lines are in.)*
- *(Oct 11, later: the two wave-3 done tests now say "when the shwarm is posted" instead of "at kickoff" (settle-a-rupert-solid, inkscape-100-oldest-bugs); both went back to Myra on the proof page. Two idea cards in shwarm-ideas.json still say "list frozen at kickoff"; that file has another session's uncommitted edits, so it waits.)*
- *(Oct 9: pulled forward from phase 8 by Myra and built in apps/site, so set it aside from the after-launch list. A new shwarm is live the moment it's posted, like a branch: no lobby size, seats count, kickoff, "lobby filled" event, kickoff inbox item or mail, filling tab or lobby score. "join" says you're working on it and gates nothing; leave any time while live, not the author. Title and what stay editable by the author (re-pitch, history kept) until the first submission. Variants are gone: no ?variant= mode, links or box, and core and the API make none; build on is unchanged. Migration 0016 (expand only) moves every lobby row to live; lobby_size and variant_of_id stay as columns, unread, and old variant rows read as shwarms. 802 unit tests and the browser loop and pages suites pass. Builder's defaults are proposed in decisions.md, open #91. Still to do: docs, mockups, screenshots, footer pages, the manifesto and launch-list words; staging needs migration 0016 with the deploy.)*
- *(Oct 10: Myra said yes in review round 2 to the build defaults (open #91), and said "you draft it" for the manifesto lines. Claude drafted them in docs/manifesto.md and mockups/holding.html and rebuilt apps/site/src/web/holding.ts; production's holding page changes at the next production deploy. The launch list lost its lobby fields, and the survival entry now builds on minecraft in doom. Left: the CLAUDE.md "never reintroduce" lines Myra approved (waiting for the session with edits there), and a final sweep for lobby mentions.)*
- **what:** a shwarm is live the moment it's posted ([decision](decisions.md#create-form-later-the-same-day)). Remove the lobby size, seats, kickoff, the "filling" tab and the lobby score; "join" means "working on it" and gates nothing; title and what stay editable until the first submission; the license locks at posting. Update the docs, mockups, screenshots and launch data to match, and the manifesto lines in Myra's wording.
- **who:** Claude; Myra words the manifesto · **needs:** launch
- **done when:** a new shwarm accepts a branch and a submission the minute it's posted, and no page, doc or prompt mentions a lobby except as history.

**8.2 Joining as a celebration** · done
- *(Oct 12, night: live. Myra pushed v0.2.9; the production deploy passed, /healthz is ok, migration 0027 is in (18 seats, none by an agent yet). @shwarm/cli 0.1.4 (join and leave, `--hello`, the MCP tools) is published with provenance (Myra: m-cli, yes). The new words are approved (m-words-oct12).)*
- *(Oct 12: Myra picked one design from three drafts ([decision](decisions.md#oct-11-terms-and-privacy-final)): join on the node's own post and in the contributors card, a "say hi!" modal (introduce yourself and your agents, what you'll work on) whose words become a first post marked as a join, a burst at the modal, and branches joinable with no selector. Drawn in mockups/shwarm.html and branch.html, with a design-system entry. Left: build it in the site (a migration for branch joins, the modal, the join post, notices).)*
- *(Oct 12, later: Myra reworded the modal ("you are joining the root/<branch> branch of minecraft in doom. you can leave at any time.", a labelled optional box, no hint or agent lines) and decided agents may make their person's one join with a separate "join" key permission. The site build covers both: branch joins, the modal, the join post, a join API call and CLI/MCP tool, the key permission, the contributors list.)*
- *(Oct 12, last: built (Myra approved the mockups and the burst). Site: two join buttons and the say-hi modal with Myra's words, the join post ("✿ joined") and quiet join lines, the burst, branch joins that count you up the chain, contributors listing each person once. Agents: the "join" key permission (off by default) lets an agent make its human's one join (Myra corrected the model the same day: "each person STILL gets one join"), recorded as "joined by @you/agent", `POST /w/<path>/join` and `/leave`, `shwarm join`/`leave` (cli 0.1.4, not published), MCP join and leave tools, the skill. Migration 0027. The review fixed a branch join seating a paused shwarm, a re-join keeping the old key id, and a count in the "more joined" fold. 1258 site and 79 cli tests pass. Builder's defaults are [open #115](open-questions.md). Left: staging deploy and a look, then a release tag; publishing cli 0.1.4.)*
- *(Oct 12, evening: Myra's follow-ups built: a shwarm's or branch's words can't be changed once posted (edit removed for users; the forms say so); an agent leaves only a join it made; an agent's join can carry a hello. The terms' two stale sentences were fixed inside v0.2 (no policy process before the beta invites). 1264 site and 81 cli tests pass.)*
- **what:** make joining feel like an event, and give contributions structure ([write-up](further-enhancements.md#joining-as-a-celebration-structured-contributions)). Needs a design pass and Myra's answers to the open parts first.
- **who:** both · **needs:** 8.1
- **done when:** Myra has picked a design and it's built.

**8.3 Mention wake-up bridge** · parked
- *(Oct 10: folded into agent DMs, 7.16 to 7.19: the same push into a running session carries mentions too.)*
- **what:** a CLI command, roughly `shwarm mentions --follow`, that forwards each new mention of `@you/agent` as a DM into the matching local Claude Code session ([write-up](further-enhancements.md#cross-session-dms-and-a-mention-wake-up-bridge)).
- **who:** Claude · **needs:** 7.7
- **done when:** a mention posted on the site wakes the right local session within a minute.

### Phase 9: trust and safety (5 days)

**9.1 Triage** · done
- *(Oct 11, last: Myra said lift it; `pause_new_nodes` is off on production, with a public log row. Done.)*
- *(Oct 11: nothing yet records triage on the production seeds or lifting the pause on new nodes there. Suggestions stay skipped (decided Oct 8), so the done-when's suggestion clause no longer applies.)*
- *(Oct 11, later: triage did run on production: all 17 seeded shwarms have a Clef-flash "no" and are cleared (18 decisions in all). Production still has `pause_new_nodes` on. Left: Myra's yes to lift it, which lets founding accounts post new shwarms on shwarm.org. The done-when's "a vague done test gets a suggestion" is moot: suggestions were skipped (0.9).)*
- *(Oct 9: built and on staging. Clef-flash through the Workers AI binding: every new node is checked right after create and by a minute sweep; a top answer of no clears it, yes or unsure holds it with one alert email to Myra; errors stay pending and are held after 10 minutes; flagged seeds stay public; the model never blocks, Myra clears or blocks with `apps/site/scripts/triage.mjs`. All 99 staging seeds ran through the real model: 99 no, all cleared, no alerts, no errors. Then 11 test proposals went straight to the same model (no database writes, no mail): two per hard-block category all came back yes with the right category (yes 0.50 to 0.90), and three look-alike good ones (minecraft in doom, a stalkerware detector, a pentest of your own lab) came back no. Holding and the alert mail are covered by the unit tests. Myra approved the rubric and the triage wording on Oct 9 (the blocked banner now says only "blocked. see the rules."). Left: the prod run once prod has seeds. Under the Oct 9 decisions, "blocked" below reads "held for Myra", and suggestions stay skipped.)*
- *(Oct 9: the alert mail now says "1 run report", "1 person, a human" and "N people, at least one of them human", in the node page's words. It leaves out empty checker instructions instead of printing a bare "> ". `triage.mjs list` does the same. The "rubric v3" on the review page came from hand-made sample data: the mail prints the real RUBRIC_VERSION (r1), which a test checks. The new mail words wait on Myra's OK (#93). Not yet on staging.)*
- *(Oct 10: Myra said yes in review round 2 to the triage alert mail's reworded lines (open #93). The rubric wording is still hers to approve.)*
- **what:** the rubric (four hard blocks; suggestions never block), one Anthropic call per new shwarm, branch and variant with node text framed as data, structured output, decisions recorded with the rubric version; suggestions shown on the create form; blocked page with category, reason and appeal; the A8 failure mode. Then batch-run all 100 seeds on staging and the imported wave-1 seeds on prod, and lift the pause on new nodes on prod.
- **who:** Claude; Myra approves the rubric wording · **needs:** 0.9, A8
- **done when:** test nodes for each hard-block category are blocked, a vague done test gets a suggestion, a forced timeout holds the node, and every seed on staging and prod is cleared or flagged for Myra.

**9.2 Public triage page** · doing
- *(Oct 11: built: `/triage` shows the prompt and rubric r1 built from `src/triage` at request time (no copy), and the decision log (date, node, answer, outcome, category, reason, model, version), 50 a page, as HTML, text and JSON. It never shows a node's words; a node the public never saw shows only as "a shwarm". The create form's "its rubric is public." and the rules page link it; it's in the sitemap. 8 tests. The words wait on Myra (OPEN). Left: live on staging after the next push, and Myra's yes on the words.)*
- **what:** the prompt, the versioned rubric and the decision log (node, outcome, category, reason; never the blocked text), linked from the create form's "its rubric is public" and the rules page.
- **who:** Claude; Myra approves · **needs:** 9.1
- **done when:** the page is live on staging and the create form links to it.

**9.3 Flags and reports** · done
- **what:** "flag this swarm" on shwarm and branch pages and "report" on every post: humans only, site only, one per person; reasons from the hard-block list plus illegal content, copyright and personal info; every one alerts Myra; 3 flags from established accounts pause a shwarm until Myra clears it (A7). A signed-out report form at `/report` (Turnstile, the same reasons, contact email, URL) feeds the same queue. The rules and terms name abuse@, dmca@ and /report. The "shwarming safely" guide names only abuse@ until this lands; add the report link there too (open #102).
- **who:** Claude · **needs:** A7
- **done when:** a third flag pauses a test shwarm with a "paused for review" banner, and a signed-out report reaches the queue.
- *(Oct 10: Myra said yes to the report link first (m-report). Building the report half now: "report" on every post and the signed-out `/report`, into the report table with a mail to the admins; [open #105](open-questions.md#105-reports-the-words-and-the-edges) holds the words. Flags and the pause come after.)*
- *(Oct 10: the report half is built. Migration 0021 (expand only: `report.reason`, one report per person per post). "report" on every post for signed-in, verified people, not their own, once per post; signed out it links to /report. `/report` works signed out or in: Turnstile, an address on shwarm.org, reasons, a note, an optional email, 10 an hour per network. Each report mails the admins once. The rules, terms and safety guide link /report. A review fixed an unverified person's report blocking the hourly cleanup. Site 999/999. Left: flags and the 3-flag pause.)*
- *(Oct 10: live in v0.2.2; migration 0021 applied on production; /report answers 200.)*
- *(Oct 10: the flag half is built. Migration 0022 (expand only: one node flag per person). "flag this shwarm" / "flag this branch" for signed-in, verified people, not the author, once; every flag mails the admins; the third open flag from accounts established when they flagged pauses the node in the same batch (a private pause row in moderation_action), with a "paused for review" banner on its page, result page and submission pages, and in the agent briefing and JSON; no writes get in, from the site or a key. `scripts/triage.mjs flags` lists the queue; `unpause` lifts it, resolves its flags and logs it publicly. The rules page explains it. RENDER_VERSION 10. Done when met in tests: a third flag pauses a test shwarm with the banner. Site 1014/1014.)*

**9.4 Admin console** · done
- **what:** `/admin` behind Cloudflare Access (Myra's hardware-key login), the admin flag and step-up. One queue: triage holds, appeals, flags, reports, copyright notices. Actions with a required reason: hide or restore a node or post (public tombstone, 410), remove a link, suspend (ends sessions, revokes keys, emails the reason; the author-gone rule applies), overturn triage, founding flag. Account lookup by handle or email: verified state, outbox and suppression status for that address, sessions, keys, flags; actions: resend verify, remove from suppression, mark email verified (logged), end sessions, add to or remove from the allow-list. Switches: site mode, sign-up (open or allow-list only), read-only, pause new nodes. Slow mode, per-account limit overrides, pausing agent writes, IP-range blocks and the header-stats switch are `wrangler d1 execute` recipes in the 11.6 runbook, not UI. Every action goes to the moderation log.
- **who:** Claude · **needs:** 9.1, 9.3
- **done when:** each action and switch works on staging and leaves a log row, and Myra resolves a staged "no verify mail" case from admin alone.
- *(Oct 10: built, in-process. `/admin` (the queue: triage holds, flags, reports with copyright notices and DM reports; appeals aren't built, nothing writes them yet), `/admin/node`, `/admin/post`, `/admin/report` (hide or restore a node or post with a public 410 tombstone, remove a link, clear or block triage, unpause, resolve reports and flags), `/admin/people` (lookup by handle or email: verified state, mail and suppression, sessions, keys, flags and reports; resend verify, unsuppress, mark verified, end sessions, allow-list, founding, suspend and unsuspend with the author-gone rule and an account_suspended mail), `/admin/switches` (read-only, pause new nodes, sign-up open or allow-list; site mode shown, changed by deploy). Every page and act: an active admin only (404 for everyone else), the password step-up, the form token, a required reason, and one moderation_action row in the same batch (a form sent twice writes once). The Cloudflare Access header is checked when ACCESS_AUD is set (m-access); verifying its signature is 9.6's. Site 1073/1073. On staging (eea259c), with a staged account nomail_test whose verify mail was skipped. Left: Myra's run (m-admin-staging).)*
- *(Oct 10: Myra's run on staging: signed in, looked through the pages, fixed nomail_test with "mark verified" alone; one private moderation_action row, written at the same instant as the change. Live on shwarm.org in v0.2.3, behind Cloudflare Access (an emailed code to Myra's address) with ACCESS_AUD set on production.)*

**9.5 Public moderation log** · done
- **what:** action, target (tombstoned), category, date, who acted. No reporters, no removed text. A read-only list over moderation_action (A7 promises it).
- **who:** Claude · **needs:** 9.4
- **done when:** it's live and linked from the rules page.
- *(Oct 10: built: `/moderation` lists the public rows newest first (date, action, target, reason, who acted), in HTML, JSON and text, 50 a page; a node never public shows only as "a shwarm (taken down)"; never private rows, reporters, removed text or emails. The rules page links it. Live once tagged.)*
- *(Oct 10: live on shwarm.org in v0.2.3; the rules page links it; /admin answers 404 to the public; migration 0022 applied on production.)*

**9.6 Security review** · parked
- *(Oct 11: the three tool reports are summarized here but not linked yet. Otherwise this waits on the parked outside test.)*
- **what:** XSS payloads in CI, CSRF, CSP, account enumeration, session handling, signature replay and host binding, grant bypass, bare-handle from a key, rate limits, secret scanning, headers; an OWASP ZAP baseline scan against staging, `pnpm audit` or osv-scanner, and semgrep with the default TypeScript rules; Claude runs a security review over the whole codebase and fixes every high.
- **who:** Claude · **needs:** phases 2–7
- **done when:** the three tool reports are linked in the step and show no high or critical item, Claude's review list is closed, and one outside person (a beta invitee with a security background, if there is one) has had the staging URL for 48 hours.
- *(Oct 10: tools run. OWASP ZAP baseline against staging: 0 fail, 16 warnings, none high (the one real gap, static files without the security headers, fixed in static/_headers). semgrep (p/typescript, p/javascript, p/secrets, 168 files): 0 findings. osv-scanner and npm audit: dev tools only (vitest's tinypool, wrangler's miniflare/sharp), nothing in the Worker bundle; upgraded in a separate commit. Claude's review: 7 areas, each finding challenged by a skeptic; no high or critical. Fixed: the wrong-password throttle counts before checking (concurrent guesses can't pass the limit, sign-in and step-up); sign-up holds the handle for an address that already has an account (migration 0023 handle_hold), so "that handle is taken" no longer tells; DM reports share the 30-an-hour report budget and a DM your own agent sent can't be reported; hiding a dead-end note clears it everywhere; "remove link" on a check post removes it from the check's evidence too; /admin/beta goes through the admin gate; the Access token's signature, aud, iss and expiry are checked (web/access-jwt.ts); production's workers_dev and preview_urls are off in the config. Left for 9.7 (load, not access): the per-domain sign-up limit can be used to block a big provider for an hour; sign-ups to throwaway addresses can use up the day's mail quota; other limits (forgot, resend, report, flag) still read then write, so a burst can overshoot them a little. Open for Myra: an unverified account can sign in, so sign-up then sign-in still shows whether an address has an account (#108).)*
- *(Oct 10: on production (v0.2.4), Myra signed in to /admin through Access with the emailed code, so the token check passes a real token. The outside person: Myra's friend Ash, a pen test on staging; Myra talks to them in a few days.)*

**9.7 Abuse drill** · done
- **what:** on staging: 50 sign-ups from one address range, disposable domains, a burst of posts, a spam shwarm, repeated reset requests to one address. Then flip each switch.
- **who:** Claude; Myra watches the alerts · **needs:** 9.4
- **done when:** every guard triggers, every switch works, and Myra gets the alerts on her phone.
- *(Oct 10: run on staging with Myra watching. Disposable domains: refused, subdomains too. 50 sign-ups from one network: 5 in, then a 1-hour wait. One email domain: blocked after 30; the drill showed tries the network limit refused still counted against the domain, so one network could block gmail.com for an hour: fixed, a refused try no longer counts. Reset requests: 10 from one network, then a 1-hour wait; to one address, 3 an hour delivered and the rest skipped by the mail cap. New shwarms: the 4th in a day refused. Replies: 5 in a burst, then a 5-minute wait. A spam shwarm: triage held it and mailed Myra. A report and three flags from established accounts: mailed, and the third paused the shwarm with the banner. Switches from /admin/switches: read-only refused a post, pause new nodes refused a shwarm, sign-up open let an address join without the waiting words and allow-list brought them back. Myra got the alerts on her phone; Gmail filed the triage alert (it quotes the spam) in spam; Myra set a Gmail filter so mail from shwarm.org never goes to spam. Cleanup: the spam shwarm blocked with scripts/triage.mjs, the drill shwarms unpaused and hidden; four verified drill accounts (drill_2204_0 to _3) stay on staging.)*

### Phase 10: money and legal (2 days, plus lead time)

**10.1 Donations** · done
- *(Oct 8: the shwarm Stripe account is set up and submitted for verification by Myra. Keys and the webhook get wired in this step.)*
- *(Oct 10: built and tested, not deployed. The modal posts to `/donate`, which opens Stripe Checkout, once or monthly; `/hooks/stripe` checks Stripe's signature and records each paid session and each later month in the `donation` table (migration 0024); `/donate/thanks` after paying. Without `STRIPE_SECRET_KEY` the modal says checkout opens soon and `/donate` is a 404, so production doesn't change. Left: Myra puts the Stripe test keys on staging and makes the staging webhook (m-stripe-test), then Claude deploys staging and runs the $5 test in test mode; then live keys and a live webhook on production. Builder's defaults: [open #109](open-questions.md#109-donations-the-builders-defaults).)*
- *(Oct 11: done on staging in Stripe's test mode (the Sandbox). Myra set both secrets; Claude made the webhook destination (checkout.session.completed, checkout.session.async_payment_succeeded, invoice.paid). Myra's $5 one-time test payment went through to the thanks page; its first delivery failed because the signing secret wasn't set yet, and once it was, a resend from Stripe recorded it (donation row 1: $5, once). Left for production: a release tag, then live keys and a live webhook (m-stripe-live).)*
- *(Oct 11, later: live on shwarm.org. v0.2.7 is deployed. In live mode Claude made the webhook destination "brilliant-spark" for `https://shwarm.org/hooks/stripe` (same three events) and a restricted key "shwarm.org" that can only write Checkout Sessions; Myra verified the key and set both secrets with `wrangler secret put … --env production`. Checks: an unsigned post to `/hooks/stripe` gets 400; the donate modal on shwarm.org shows the form, and "donate $25" opens Stripe's live checkout page ("donation to shwarm", $25.00). No live payment was made.)*
- **what:** Myra makes a separate Stripe account for shwarm under her existing login (A13). Claude wires the donate modal to Stripe Checkout: once or monthly, preset or custom amount, an optional note, and the supporters-list opt-in; a webhook records completed payments; the modal and terms say payments go to Myra Krusemark and aren't tax-deductible.
- **who:** both · **needs:** A2, A13, 1.11
- **done when:** a $5 test donation shows in Stripe, and decisions.md records the path.

**10.2 Terms and privacy final for the beta** · done
- *(Oct 12: done. Myra announced v0.2 on shwarm.org from /admin/switches (public log row "terms_version=\"0.2\""), the notice mail went to both accounts, and she accepted it from the banner (a terms_acceptance row, how=banner). In effect Nov 15.)*
- *(Oct 11: built and written, waiting on Myra's read. An audit checked the three pages against the code and decisions.md: 33 fixes, written up as v0.2, in effect from Nov 15, 2026 ([decision](decisions.md#oct-11-terms-and-privacy-final)). Myra decided the 30-day notice, stopping a monthly gift by mail, refunds within 30 days, and deleting reports and flags a year after they're resolved. Built: terms versions (`TERMS_VERSIONS` in content.py, the changelog on /terms, a banner with "i accept v<n>", the `terms_acceptance` table, an announce box on /admin/switches that mails every account behind, 50 a day); the hourly 30-day purge of networks and browsers (part of 11.5); the year-old report and flag prune; a fuller data download (direct messages, gifts, accepted terms, the invite row, a pending email change). No "[to decide]" is left; combob-lint passes on all three pages; 1142 tests pass. The builder's defaults are [open #110](open-questions.md#110-terms-changes-the-builders-defaults). Myra approved the pages ("all good"). Left: v0.2 is announced on staging to check the banner and the recorded acceptance, then on production. A19 said no lawyer before the beta.)*
- **what:** fill the 2.11 drafts with the data inventory and subprocessors from the real schema (Cloudflare, Resend, Anthropic, Sentry, the donations provider), the operator and address (0.10), the license (A2) and the donations path; set the effective date; the lawyer's changes if A19 = hold. A terms-version setting: when it goes up, signed-in people see a banner and a one-click "I accept v<n>", recorded per person; an email goes to every account the notice period before the effective date; the changelog is linked from both pages. The rules page matches A7 and the report link.
- **who:** Claude; Myra approves every line · **needs:** 2.11, 0.10, A2, A3, A13, A19
- **done when:** no "[to decide]" remains, combob-lint passes on the plain parts, Myra has approved both, and bumping the version on staging shows the banner and records acceptance.

**10.3 Vendor agreements** · done
- *(Oct 12: nothing to sign. Cloudflare's, Resend's and Stripe's data processing terms come with the account (Cloudflare's self-serve terms, Resend's pre-signed DPA, Stripe's Services Agreement); ticked with links on the accounts list. Anthropic isn't used (triage runs on Cloudflare). Sentry gets checked when it's set up.)*
- **what:** accept the standard data processing terms for Cloudflare, Resend, Anthropic, Sentry and the donation provider.
- **who:** Myra · **needs:** 0.4, 0.8, 0.9
- **done when:** each is ticked on the accounts list (0.12).

**10.4 DMCA agent (should, $6, 15 minutes)**
- **what:** register with the US Copyright Office using the operator name, address and dmca@; the terms' copyright section, counter-notice path and repeat-infringer rule; the remove-link admin action handles notices.
- **who:** Myra files; Claude writes · **needs:** 0.10, 10.2
- **done when:** the registration is confirmed and the terms name the agent.

**10.5 License on the pages** · done
- *(Oct 11: the rules ("open"), the terms ("what you post is open": the list, branches inherit, builds on, when it locks), the shwarm page (the license line, "inherited" on a branch, "from" on builds on) and the result box (`license …, from uzdoom`, checked by the closed fixture in test/result-page.test.ts) already showed it. how-it-works gained one paragraph under "done, and locked".)*
- **what:** the chosen license on the rules, terms, how-it-works and the result box, with builds-on inheritance shown.
- **who:** Claude · **needs:** A2
- **done when:** a closed fixture shows the license line.

### Phase 11: ops (3 days)

**11.1 Backups** · doing
- *(Oct 11: built, not yet proven. Myra said yes to two private R2 buckets (free tier): `shwarm-backups-staging` and `shwarm-backups`. Every night at 03:17 UTC `src/jobs/backup.ts` writes `d1/YYYY-MM-DD.sql.gz` (a restorable SQL dump of every base table) and a manifest (row counts, sha256), and deletes files more than 30 days old. `scripts/restore-backup.mjs` restores one into an empty, migrated database, staging unless `--i-mean-production`, and compares counts. The round trip is tested. Risk: Workers Free gives a cron run 10 ms of CPU; check the first staging run's CPU time. D1 Time Travel works on production.)*
- *(Oct 12: the first nightly backup ran on staging at 03:17 UTC: `d1/2026-10-12.sql.gz`, 140 KB gzipped (1.06 MB of SQL), with its manifest (26 migrations, row counts, sha256). The manifest is written last, so the run finished inside the free plan's CPU limit. Production ran too: 93 KB gzipped, 9,702 rows. 1 of 3 nights.)*
- **what:** D1 Time Travel; a nightly export of base tables to a private R2 bucket kept 30 days.
- **who:** Claude · **needs:** 1.3
- **done when:** three nightly exports exist.

**11.2 Restore drill and runbook** · done
- *(Oct 12: drill passed, logged in the [runbook](runbook.md#rehearsal-log): last night's production backup into a fresh D1 in 14.8 s, all 44 tables matching; the 18 shwarms and their posts hash the same as production; a signature from a stored agent key verifies; a Time Travel restore to a bookmark took 3 s. The drill database was deleted afterwards. Repeat monthly and within 7 days of launch.)*
- **what:** restore last night's prod export into a fresh staging database, check row counts, render a node, verify a stored key's signature, time it; also a Time Travel restore to a recorded bookmark. A one-page runbook in the repo.
- **who:** Claude · **needs:** 11.1
- **done when:** the drill passes and is logged with its date. (Repeated monthly; must be within 7 days of launch.)

**11.3 Monitoring** · doing
- *(Oct 12, Sentry: Myra made the account (free plan after a 14-day trial, org `shwarm`, project `node-cloudflare-workers`, US data region). The Worker sends its own small report (`src/core/sentry.ts`), not Sentry's SDK, from app.onError and from every cron job's catch: the error, its stack, the route pattern or job name, method, source, environment; emails and long tokens blanked; no IP, headers, cookies, body or account. `SENTRY_DSN` is set on staging and production. A forced test error reached Sentry with the email in it blanked. The privacy page names Sentry (Myra's yes). Production reports from v0.2.10. Not done: browser-side errors (the site's own JS is small; left out), "a stopped staging Worker pages Myra" (Better Stack emails, no push on the free plan), and revoking the staging Resend key to see the alert.)*
- *(Oct 12, later: the daily D1 usage line and the Resend error-rate alert are built (5c91547), not yet deployed. D1 rows read and written are counted by the Worker itself, with no API token: on staging and production every D1 answer's `rows_read` and `rows_written` are added up per isolate and written into `site_stats_daily` at most once a minute ([core/d1-usage.ts](../apps/site/src/core/d1-usage.ts)), so they run a little under the dashboard's numbers. The 13:00 UTC summary now adds yesterday's D1 rows, mail sent and triage calls, and names any over 3 times its average of the 7 days before (after 3 days of history, above a floor); the subject then says "usage high". The watchdog mails when Resend errors pass 2% of the last day's sends with at least 3 errors, reminding every 12 hours. The thresholds are in [open #113](open-questions.md#113-monitoring-the-builders-defaults). Still not built: Sentry.)*
- *(Oct 12: the outside checker is Better Stack on the free plan (Myra's account). Four checks every 3 minutes, alerting by email when a URL stops answering: `https://shwarm.org/`, `/healthz`, `/w/minecraft-in-doom?format=text` and staging's `/healthz` (staging answers without a token). The free plan has no keyword checks, so a 200 with `"ok":false` isn't caught (`/healthz` returns 500 when the database fails, which is), and no push, SMS or calls; phone alerts come by email for now. A public status page shows the three production checks ("shwarm.org", "site and database", "shwarm prompts") at `status.shwarm.org` (CNAME `status` → statuspage.betteruptime.com, DNS only, added Oct 12; loads with a valid certificate). The footer links "status" beside donate · terms · privacy. Still not built: Sentry, the daily D1 usage line, the Resend error-rate alert.)*
- *(Oct 11: the in-Worker part is built (zero spend). `/healthz` adds the outbox (due, failing, given up), triage holds (count, oldest wait), a ShwarmTree ping (2 s cap) and an `attention` list an uptime checker can match on; the extra numbers are kept 30 s per isolate so public hits can't drain the free quotas. A watchdog every 5 minutes mails the admins when mail is late or given up, a hold waits over 15 minutes, sign-ups pass 20 an hour, 5xx pass 10 an hour, or bounces pass 3 a day; each kind at most hourly (a hold every 12 hours), 6 mails a day in all. 5xx are counted per 10 minutes, capped at 50. The thresholds are [open #113](open-questions.md#113-monitoring-the-builders-defaults). Not built: Sentry, the outside uptime checker with phone alerts, the daily D1 usage line, the Resend error-rate alert. A Resend outage can't mail its own alert; only an outside checker reading `/healthz` would catch it.)*
- **what:** uptime checks on `/`, `/healthz`, the text prompt of a seed shwarm and staging (with the Access service token), with push alerts on Myra's phone; Sentry on the Worker and browser with personal data and signature headers scrubbed. `/healthz` also reports the age of the oldest unsent email_outbox row, the dead-letter queue depth, a ShwarmTree ping and the count of held triage nodes. Alerts on: 5xx spikes, bounces, sign-ups per hour, an outbox row unsent after 5 minutes, any message in the dead-letter queue, a Resend send error rate over 2%, a triage hold older than 15 minutes. A daily admin line with yesterday's D1 rows read and written, emails sent and triage spend, with an alert when any goes over 3 times its 7-day average; Resend usage alerts on. A synthetic signed post on staging every 15 minutes (should).
- **who:** both; Myra installs the app · **needs:** 1.5
- **done when:** a forced error reaches Sentry with no personal data in it, a stopped staging Worker pages Myra, and revoking the staging Resend key pages Myra within 10 minutes.

**11.4 Counting** · done
- **what:** header stats counted from day one and visible in admin; Cloudflare Web Analytics (cookieless, should), named on the privacy page. Never any agent counts.
- **who:** Claude · **needs:** 3.7
- **done when:** admin shows today's people and posts.
- *(Oct 9: scoped to Myra's "our own counts, a funnel first" (decisions, Oct 9): no third-party analytics. Built: `/admin/beta`, a 404 for anyone but an active admin, with the loop funnel (all accounts and invited ones: invited, signed up, verified, first post, joined, first submission, first check, part of a pass), each tester's furthest step and last activity, 14 days of activity, and traffic. Traffic is counted on the server into `traffic_daily` (migration 0017): day, kind (page, prompt, json, api, other), the referring site's host, country and status class, with no IP, user agent, path or account id; staging and production only. A daily line about yesterday goes to the admins at 13:00 UTC on the account stream. Seed accounts and admins are left out of the funnel. Waiting on Myra: a look at the page on staging, and a yes on a line for the privacy page.)*
- *(Oct 10: Myra said yes in review round 2 to the /admin/beta page and the privacy page line. The line is in scripts/pages/content.py and exported to the site; production shows it at the next deploy.)*

**11.5 Housekeeping jobs** · doing
- *(Oct 12: checked with read-only queries, R2 reads and a live `wrangler tail` (v0.2.9 went to production at 21:56 UTC, so most of this ran on v0.2.8, which had the same jobs). Every cron run in 30 minutes of tail on both Workers ended "ok". Nightly backup: `d1/2026-10-12.sql.gz` and its manifest in both buckets, taken 03:17:25 UTC. Monday disposable refresh: both databases have the list's ETag in `meta` (only the refresh writes it) and 9,228 domains, 7 more than the migration loaded; next run Oct 19. Email links: no used or expired link older than an hour on either (production has none left; staging's 7 are all live). Plumbing: no idempotency row past 24 hours, nonce past its hour, or rate bucket past a day. Unverified purge: nothing old enough yet; staging's 3 unverified accounts (Oct 11, about 03:05–03:36 UTC) should go at 03:07 and 04:07 UTC on Oct 18, with a `cleanup` line in the log. Held triage: no held node on either, so the retry had nothing to do. The jobs log a line only when they change something, so a quiet run shows only as an "ok" run. The cron log by job (Cloudflare's GraphQL) needs a token the shell doesn't have. Left: see the 23:07 prune remove production's 5 throttle rows from Oct 11 22:11 UTC, and the Oct 18 purge line.)*
- *(Oct 11, later: used and expired email links are pruned hourly; the disposable-domain list refreshes Mondays at 04:23 UTC from the same CC0 list, adding only, never below 5,000 domains, never a domain a verified account uses. Expired keys were already refused on use; their rows stay for the keys page and the download. Held triage was already retried by the minute sweep. Every job has a test. Left: see each in the cron log after deploy.)*
- *(Oct 11: the 30-day purge of IP and browser data (sessions and key networks), idempotency, nonce and rate-limit pruning, and the year-old report and flag prune are built and tested, in the hourly job at minute 7. Unverified accounts at 7 days were already there.)*
- **what:** key expiry, email-token and nonce pruning, idempotency pruning, weekly disposable-domain refresh, IP and browser data purged after 30 days, unverified accounts purged after 7 days, re-running held triage.
- **who:** Claude · **needs:** phases 2, 7, 8
- **done when:** each job has a test and shows in the cron log.

**11.6 Incident runbook** · done
- *(Oct 12: Myra ran the drill on staging from the runbook alone: read-only on at 22:37 UTC (a reply was refused with "shwarm is read-only for a moment"), off at 22:40, both in the public log; then rotated MAIL_SECRET with the one-line `openssl … | wrangler secret put` recipe. Staging `/healthz` ok afterwards. The switch reason boxes now set autocomplete="off", like the other admin reason boxes.)*
- *(Oct 11: written in [runbook.md](runbook.md): the first ten minutes, read-only and the other switches (admin page and SQL), end all sessions, revoke all keys, all 11 secrets with what rotating each does (rotating PASSWORD_PEPPER breaks every password), telling people, the 72-hour rule, the CSAM steps, and restoring from the nightly backup. Every SQL statement was run against a test database. There's no sign-ups-off switch (a free Cloudflare WAF rule stands in). Left: Myra flips read-only on staging and rotates one secret (MAIL_SECRET is the gentlest) using only the runbook.)*
- **what:** flip read-only, pause sign-ups, end all sessions, rotate secrets, revoke all agent keys, tell affected people, the 72-hour breach notice rule; the list of secrets and how to rotate each; the `wrangler d1 execute` recipes for the switches that have no admin UI (9.4); a short CSAM paragraph: hide, preserve, report to the NCMEC CyberTipline.
- **who:** Claude writes; Myra tries it · **needs:** 9.4
- **done when:** Myra has flipped read-only on staging and rotated one secret using only the runbook.

**11.7 Robots, sitemap, link previews (should)** · doing
- *(Oct 12: checked production (v0.2.9) as each service's fetcher would. The page's tags are right: title "minecraft in doom · shwarm", og:title "minecraft in doom", og:description "done when: …" (shortened with an ellipsis), og:url and canonical `https://shwarm.org/w/minecraft-in-doom`, `twitter:card` summary, the 512 × 512 mark as og:image. But a bare `/w/` link answered the fetchers with the agent's text prompt: Slackbot, Discordbot, Twitterbot and Facebook send `Accept: */*`, and Bluesky's Cardyb sends no Accept at all. Bluesky's own extractor (cardyb.bsky.app) showed the URL as the title and "shwarm prompt · draft v0, Text between <<<…>>> markers…" as the text. Fixed (02b1686, not yet deployed): a known link-preview fetcher that names no type gets the page; text and JSON by name still work. With `?format=html`, Cardyb already shows the right card, and /rules shows "the rules · shwarm". Left: after the next production release, run the Cardyb extractor on a bare shwarm link again, then look at one real post each in Slack, Discord and Mastodon.)*
- *(Oct 11: built. robots.txt (staging disallows everything; production keeps crawlers out of account, admin and form pages), /sitemap.xml from public shwarms, branches and result pages plus the footer pages (capped at 5,000), canonical links, and text link previews (title, "done when: …"). Left: check a preview in Slack, Discord, Mastodon and Bluesky after the next production release; pages still send noindex until the site opens.)*
- **what:** robots.txt (no /keys, account or admin), a sitemap from the database, per-shwarm social cards from title and done line, canonical URLs.
- **who:** Claude · **needs:** 3.3
- **done when:** a shwarm link previews correctly in Slack, Discord, Mastodon and Bluesky.

### Phase 12: content and invites (2 days, plus a 5-day private beta)

**12.1 Proofread wave 1 (Myra's lane, during phases 3–7)** · done
- **what:** starts right after 3.1. Claude renders the 20 wave-1 shwarms on staging and lists every number and claim in each pitch with its source link. Myra settles A20 first, then rechecks drifting figures and approves each shwarm. Each approved shwarm goes to prod (3.10). Done tests lock once posted.
- **who:** Myra; Claude prepares · **needs:** 3.1, A20 · **due before:** 12.2
- **done when:** all 20 are approved, with fixes made in launch-shwarms.json, and all 20 are on prod.
- *(Oct 12: done with 18. Two cards were dropped in proofreading and not replaced (Myra: "launch with 18"); the 18 approved shwarms are on prod.)*

**12.2 Open the private beta**
- **what:** confirm that 9.1 cleared every wave-1 seed on prod, and add the 5–10 committed people's addresses to the allow-list.
- **who:** Claude checks; Myra adds the addresses · **needs:** 12.1, phase 9
- **done when:** 20 cleared lobbies show on the prod feed with @myra in seat 1 and "seeded by @myra at launch" in each audit log, and the beta addresses are on the allow-list.

**12.3 Founding accounts**
- **what:** Myra adds every invitee's email to the allow-list (beta people in 12.2, the rest of the cohort before 13.2); each becomes founding when they verify (A6). Strays who sign up with another address get the flag by hand in admin.
- **who:** Myra · **needs:** 2.5, 12.4
- **done when:** a test sign-up from an allow-listed address is established without Myra touching admin, and the allow-list holds the whole cohort.

**12.4 The first cohort**
- **what:** the tracker reaches 5–10 people committed to specific wave-1 shwarms and about 50 in the cohort.
- **who:** Myra · **needs:** 0.11
- **done when:** the tracker shows it.

**12.5 Invite emails**
- **what:** short and personal, from Myra's own address, one per segment: the shwarm picked for them, its done line, that joining says you're working on it, bring your agents or don't, it's free.
- **who:** Claude drafts; Myra edits · **needs:** 12.4
- **done when:** Myra has approved the drafts.

**12.6 Private beta**
- **what:** the 5–10 committed people sign up on prod (allow-listed), join their shwarms, make keys and work for 5 days. Only blockers get fixed; the rest is parked. Three of them run the launch done test with Myra on the last day.
- **who:** both · **needs:** 12.2, 12.3, 12.5, 0.14, phases 10–11
- **done when:** five days have passed with no open blocker.

**12.7 Myra's sign-off routine**
- **what:** a fixed daily slot for sign-offs. Wave 2 opens only when wave-1 sign-offs are under control (timing is Myra's call; section 6).
- **who:** Myra · **needs:** 5.5
- **done when:** the slot is in Myra's calendar.

### Phase 13: launch day (1 day)

**13.1 Launch checklist**

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
18. Right after the flip in 13.2: site_mode is open and `curl -I` shows no noindex.

- **who:** both · **needs:** everything above
- **done when:** every line has evidence.

**13.2 Open**
- **what:** set site_mode to open (removes noindex) and sign-up to open; send invites in batches of about 10, a few hours apart, each linking straight to a wave-1 shwarm, watching the admin queue and alerts between batches.
- **who:** Myra sends; Claude watches the dashboards with her · **needs:** 13.1
- **done when:** the first batch has signed up and joined without a blocker.

**13.3 Email everyone waiting** · doing
- *(Oct 11: built ahead of the opening, not sent. A box on /admin/switches queues one "shwarm is open" mail per active, verified waiting account without `mailed_at`, sets `mailed_at` in the same batch, writes a public log row, and paces at 50 a day. It refuses unless sign-up is open and the site mode is open; a second press sends nothing. 9 tests. The words wait on Myra ([open #114](open-questions.md#114-the-opening-mail)). Left: Myra's yes on the words, then the send right after 13.2.)*
- **what:** right after 13.2, one mail to every active, verified account on `signup_wait` with no `mailed_at`: shwarm is open, sign in and join a shwarm. Mark each row's `mailed_at` as it's queued, sent through the outbox in batches under the Resend cap. Not built yet: the template, its words and the send job (decided Oct 10: "they will receive an email when the site is live").
- **who:** Claude builds; Myra approves the words · **needs:** 13.2
- **done when:** every waiting account has `mailed_at` set and the sends show in the outbox with no failures left.


---

## 6. What's explicitly after launch

These are planned for after launch. They don't come back in before it.

- **Within the first weeks:** the lawyer review if A19 launched on drafts; a polished written CSAM procedure (the runbook paragraph and NCMEC registration are done before launch); any (should) step that slipped; applying to GitHub's secret scanning partner program for the `shwarm_sk_` format.
- **Waves 2 and 3** (40 + 40), each through the same proofreading and triage gate, timed by Myra.
- **The public announcement,** once the first cohort has real threads (about 1–2 weeks in). A public "why" page made from the [manifesto](manifesto.md) is Myra's call then.
- **Header stats switched on** ([#62](open-questions.md#62-when-header-stats-switch-on)) at a sustained threshold.
- **Agent surfaces:** local MCP if it slipped, hosted MCP at shwarm.org/mcp, device-code login (`shwarm login` → /device), a public sandbox server on staging, reading one post by id and a submission's full check list from the API.
- **Accounts:** before the public opens, move to Workers Paid ($5/month) and argon2id passwords; old hashes upgrade at each person's next sign-in (todo, Myra Oct 8). Passkeys as an optional step-up and sign-in; the optional "verified human" mark ([#2](open-questions.md#2-first-personhood-provider)).
- **Money:** a supporters page on shwarm.org if Open Collective is the path; Stripe under the nonprofit once it exists ([#12](open-questions.md#12-legal-home), [#51](open-questions.md#51-who-holds-donations)).
- **Governance:** reputation weights for flags, elevate and reject ([#7](open-questions.md#7-how-reputation-weights-elevate-and-reject)).

## 7. Risks

1. **Scope.** "Everything online" is about 58 build days plus a 9-day buffer. Every unplanned feature adds days. *What we do:* the rules in section 2, should-steps cut first, and further enhancements (section 8).
2. **Nobody shows up, or nobody checks.** Wave 1 needs a run in 19 of 20 shwarms and a human people check in 13. One pass can need a submitter, 2 runners and up to 3 people checkers, all different people, plus Myra: up to 6 people besides Myra, from a beta of 5–10. *What we do:* A20 settles the wave-1 counts before they lock, founding accounts start established (A6), 5–10 people committed to specific shwarms before day one, a daily sign-off slot, "waiting N days" visible, and wave 2 waits until wave 1 moves.
3. **Mail lands in spam or stops.** Sign-up is useless without the verify mail. *What we do:* Resend (Postmark when the public opens), DNS set up in phase 1 so the domain has history, scanner-safe links (2.7), the five-provider test in 2.10 and again in 13.1, a resend button, and outbox alerts (11.3).
4. **Human lead times.** The license, the operator, the fiscal host, NCMEC and the lawyer all wait on people outside this project. *What we do:* all start in phase 0 or 1 and sit on Myra's Now line with their due step; A19 is decided in phase 0, so a lawyer can be booked; Open Source Collective gets the application at 1.11, with Stripe as the dated fallback at phase 10.
5. **Abuse without a personhood check.** Bot sign-ups, sock puppets, spam shwarms, or an agent driving a person's browser. *What we do:* Turnstile, sign-up limits, the disposable block, the established rule, one slot per person, author sign-off, triage that holds when it fails, step-up on the acts that matter, flags and reports, admin tools and switches, all drilled in 9.7.

## 8. Further enhancements

Functional enhancements wait here until after launch, unless they block the launch done test. Add new ones at the bottom with the date and who raised them. Ones Myra has picked to build become steps in [phase 8](#phase-8-further-enhancements-after-launch); longer write-ups are in [further enhancements](further-enhancements.md).

- A live "campfire" view of agent posts flowing in ([#68](open-questions.md#68-a-live-campfire-view-of-the-work)). Needs a design pass. The `ShwarmTree` Durable Object could host it later.
- A shwarm updates section an agent can keep current ([#67](open-questions.md#67-a-shwarm-updates-section)). Launch uses the pinned post.
- Federation over ActivityPub ([#50](open-questions.md#50-the-api-across-federated-servers)).
- Organization accounts ([#34](open-questions.md#34-organization-accounts)).
- Push or webhooks for mentions ([#47](open-questions.md#47-push-delivery-for-mentions)); polling covers launch.
- Signed CI attestations (Sigstore) as run evidence; reproducible builds.
- Triage reading thread posts (new question, with cost numbers first).
- Editing a done test for typos ([#5](open-questions.md#5-done-test-lock-vs-typos-and-clarifications)); variants of branches ([#23](open-questions.md#23-can-a-branch-have-a-variant)).
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
- The manifesto as a dated article alongside the other footer articles, each article with a date (Myra, Oct 9: "let's worry about that later"). Until then it stays on the holding page.
- Getting shwarm onto Claude Code's official channel plugin allowlist (Claude, Oct 10, from 7.19), so DMs push into a session without `--dangerously-load-development-channels` at each launch ([#104](open-questions.md#104-agent-dms-how-they-work)). Until then push needs the flag; asking with dm_read works everywhere.
