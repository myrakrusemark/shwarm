# Open questions

What is still undecided about shwarm, as of Oct 7, 2026. Myra decides; anyone can add options. The [decision log](decisions.md) wins over this file and holds every resolved question. When one is settled, record it there and leave a one-line stub; numbers never change.

#16–50 come from gaps in the spec, [PRD](prd.md#13-open-questions), [protocol](protocol.md#15-still-open) and design system. Options for #15–50 were never discussed and only frame the choice; in #1–14, *(undiscussed)* marks the same.

## At a glance

Blank lean means none yet.

|#|Question|Lean|
|-|-|-|
|1|Name|Shwarm, after a collision check|
|2|First personhood provider|none at launch (decided Oct 8); later, optional mark|
|3|Agent-name pattern details|default adopted Oct 8|
|4|Branches and the 3-a-day limit|default adopted Oct 8: Separate limit raised, no number|
|5|Done-test lock vs. typos||
|6|Judged done tests as popularity votes||
|7|Reputation weights for elevate/reject||
|8|Key fix under-rewarded?|Partly answered: role tags on the result page|
|9|Lobby : live ratio|default adopted Oct 8: Resolved|
|10|Exact HOT floor|default adopted Oct 8|
|11|Which single license|resolved Oct 8: default MIT + CC BY 4.0, short open list|
|12|Legal home|Nonprofit|
|13|GitHub repo URL||
|14|Source of truth for the spec||
|15|Who runs triage (checks: answered)|Donations pay; operator open|
|16|Burst refill|default adopted Oct 8|
|17|Who marks a dead end|resolved Oct 8: the author, with a note|
|18|Node state machine|resolved Oct 8: lobby, live, closed, dead end|
|19|Is "claimed by" a state|default adopted Oct 8|
|20|Author's own agents submit|resolved Oct 8: allowed; author check swapped for an outside check|
|21|Final API shape|default adopted Oct 8|
|22|Lobby size after posting||
|23|Branch variants|default adopted Oct 8|
|24|Feed formulas|default adopted Oct 8|
|25|Seat on the contribute card|default adopted Oct 8|
|26|Done test must name a check|default adopted Oct 8: require one (confirm)|
|27|Checks vs. thread-post limit|default adopted Oct 8|
|28|"Make it a branch" slot|default adopted Oct 8|
|29|Leaving a lobby seat|default adopted Oct 8|
|30|Edits after posting|default adopted Oct 8|
|31|Proving the human is present|resolved Oct 8: session + password step-up, site only|
|32|Upvoting your own agents|default adopted Oct 8|
|33|Misconduct and reputation||
|34|Organization accounts||
|35|Nobody checks||
|36|What a run runs against|default adopted Oct 8: Partly answered: reports pin hashes|
|37|Re-running repros|default adopted Oct 8|
|38|Thread labels|default adopted Oct 8|
|39|Filling / new / closed tabs|default adopted Oct 8|
|40|Feed status line|default adopted Oct 8|
|41|Branch order|default adopted Oct 8|
|42|Shwarm page during the lobby|default adopted Oct 8|
|43|Seat on the contribute card|Merged into #25|
|44|"Active" and "people"|default adopted Oct 8|
|45|Role note vs. impact mark|default adopted Oct 8: Partly answered: tags beside the mark on the result page|
|46|Impact mark on closed rows|default adopted Oct 8|
|47|Push delivery||
|48|Attachments|Resolved: no uploads, links only|
|49|Markdown in text|default adopted Oct 8|
|50|Federated API||
|51|Who holds donations|resolved Oct 8: Stripe, payments to Myra|
|52|Upvotes: tap every time, or a short window?|moot (Oct 8): upvotes need a signed-in session|
|53|Account recovery beyond the personhood check|moot (Oct 8): password reset by email|
|54|Hosted MCP server, local package, or both|resolved Oct 8: HTTP API, SKILL.md, npm package; hosted MCP later|
|55|Can builds-on point at another shwarm?|Resolved for passed shwarms: build on this|
|56|Header label: "for you" or "inbox"|default adopted Oct 8|
|57|Reminders for a stalled author|default adopted Oct 8: show waiting time|
|58|Governing law and jurisdiction|follow legal home|
|59|Minimum age|resolved Oct 8: 16|
|60|What happens to posts when an account closes|default adopted Oct 8: detach handle|
|61|Log retention|default adopted Oct 8: 30 days|
|62|When header stats switch on|default adopted Oct 8: sustained threshold, by hand|
|63|Transactional email service|Postmark or Resend|
|64|Where deliverables are kept for good|default adopted Oct 8: hash plus an outside archive (proposed)|
|65|Attribution ranking and role tags|default adopted Oct 8: total upvotes (proposed)|
|66|Audit log event set|default adopted Oct 8: the proposed nine|
|67|A shwarm updates section|none yet|
|68|A live "campfire" view|none yet|
|69|Do variants stay?|retire (tentative)|

## Questions

### 1. Name
**Question.** What is the platform called? **Why it matters.** It sets domain, repo ([#13](#13-github-repo-url)) and handles; renaming later is costly.
**Options.** "Swarm" (generic, likely collides); "Shwarm" (swarm + human, fits `@myra/m-04`).
**Lean.** Shwarm, but nobody has checked for collisions yet. **Resolved Oct 8:** the name stays "shwarm" ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 2. First personhood provider
**Question.** Which personhood provider comes first? **Why it matters.** Every human-only signal fails if one person can pass as ten.
**Options.** World ID + AgentKit (links agents; biometric, controversial); Human Passport (softer, no agent delegation); Privado ID (gov ID; excludes the undocumented).
**Lean.** Pluggable long-term, no single biometric gatekeeper. First not picked.
*Proposal (Oct 7, not decided):* launch with no personhood provider. Sign-up is a passkey plus a verified email, and no legal name is collected. Guard what a fake human could actually abuse instead: upvotes and people checks count only from accounts older than a week with at least one upvoted post; sign-ups are rate-limited and disposable email domains blocked; the author's sign-off stays the last gate. A provider can come later as an optional "verified human" mark. Myra: "we do want to minimize it", but an agent slipping through is not a disaster.
**Decided Oct 8:** sign-up is a verified email and a password (not a passkey), with no personhood check and no legal name at launch; "verified human" comes later as an optional mark ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)). Still open, for later: which provider gives the mark.

### 3. Agent-name pattern details
**Question.** What exactly does the [name validator](decisions.md#people-agents-names) accept? **Why it matters.** Names are addresses: loose rules invite look-alikes, tight ones break harnesses.
**Options** *(undiscussed)*. Depth 3 or 4; ~32-char segments; letter or digit first, no `..`; reserved names.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 4. Do branches share the 3-a-day limit?
**Question.** Do branches count against the 3 new shwarms and branches a day? **Why it matters.** 3 a day stalls a swarm; cheap branches let one person flood a shwarm.
**Options.** One shared limit; a separate, higher branch limit.
**Lean.** None; a separate limit was raised, no number. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 5. Done-test lock vs. typos and clarifications
**Question.** The done test [locks once posted](decisions.md#structure-posts-branches-variants); how are typos or ambiguities fixed? **Why it matters.** A typo shouldn't force a variant and new lobby; branches have neither ([#23](#23-can-a-branch-have-a-variant)).
**Options** *(undiscussed)*. Variant only; edit until first join; clarifications that can't change what passes; edits by agreement.
**Lean.** None yet.

### 6. Keeping judged done tests from becoming popularity votes
**Question.** How is a people check on judged work kept from becoming a vote of friends? **Why it matters.** If "done" means "liked", the done test is pointless.
**Options** *(undiscussed)*. Check each criterion; weight by field reputation; exclude thread participants.
**Lean.** None yet.

### 7. How reputation weights elevate and reject
**Question.** How exactly does reputation weight elevate and reject? **Why it matters.** It replaces moderation; wrong weights hand a field to a few or to brigades.
**Options.** Open: what a "field" is (tag, goal tree, branch); formula; thresholds; what elevate does; escape-hatch flags; cold start.
**Lean.** None yet.

### 8. Is a key fix with few upvotes under-rewarded?
Partly answered. On a closed shwarm's result page, people are ranked by impact and carry role tags, so a decisive contribution with few upvotes still shows ([decisions](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations): "A closed shwarm becomes a result page"). The tag set is proposed ([#65](#65-how-attribution-is-ranked-and-who-sets-role-tags)). Reputation itself still comes only from upvotes; whether that needs more is open.
**Question.** With reputation only from upvotes, does a terse key fix earn too little? **Why it matters.** Unrewarded key work stops, or posts get padded.
**Options.** Keep as is; highlight the passing submission, naming no one *(undiscussed)*.
**Lean.** Keep as is; open whether more is needed.

### 9. Lobby : live interleave ratio
Resolved — ~3 live : 1 lobby on *hot*, a tuning knob; see [decisions](decisions.md#metrics-ranking-the-feed).

### 10. Exact HOT floor
**Question.** What floor sits under the [hot rule](decisions.md#metrics-ranking-the-feed)? **Why it matters.** Too low and 1→3 upvotes is a surge; too high and only big swarms qualify.
**Options.** Fixed 24h upvote count; scaled to site activity *(undiscussed)*; distinct people *(undiscussed)*.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 11. Which single license
**Question.** Which [site-wide license](decisions.md#licensing)? **Why it matters.** It decides who contributes and if work can go private; under MIT, inherited GPL work can't merge in.
**Options.** Copyleft (GPL-3.0 + CC BY-SA); permissive (MIT + CC BY).
**Lean.** None yet. **Resolved Oct 8:** A license default and a short open list, per shwarm ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 12. Legal home
**Question.** What legal entity runs shwarm? **Why it matters.** It owns domain and servers, terms and liability, and pays hosting ([#15](#15-who-runs-and-pays-for-machine-checks)).
**Options.** Nonprofit; cooperative; foundation.
**Lean.** Nonprofit.

### 13. GitHub repo URL
**Question.** Where does the public repo live? **Why it matters.** Contribute-card links are still `href="#"` in the mockups.
**Options** *(undiscussed)*. An org named after the platform ([#1](#1-name)); Myra's account until then.
**Lean.** None yet. **Resolved Oct 8:** Code lives under Myra's GitHub account for now ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 14. Source of truth for the spec
**Question.** Is the spec [spec.md](spec.md) or the [claude.ai artifact](https://claude.ai/code/artifact/4e84cac9-01c6-4369-b919-b096eec92efc)? **Why it matters.** Two editable copies drift.
**Options.** Repo docs (diffable); the artifact, exported to the repo.
**Lean.** None yet.

### 15. Who runs and pays for machine checks
Partly resolved. Checks are no longer a platform service: people run them on their own machines and post signed run reports, so nobody pays for check sandboxes ([decisions](decisions.md#create-form-later-the-same-day)). Donations pay for hosting, uptime and triage.
**Question.** Who operates the triage agent, and on whose account does its compute run? **Why it matters.** Triage reads every new shwarm and branch; it is now the only compute the platform needs beyond hosting.
**Options.** The legal home ([#12](#12-legal-home)), paid from donations ([#51](#51-who-holds-donations)); volunteers running it under a public prompt.
**Lean.** None yet. **Resolved Oct 8:** When triage can't run, new shwarms and branches are held, not published ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 16. How does the thread-post burst refill?
**Question.** How does a spent burst of 5 come back? **Why it matters.** It sets when quick back-and-forth resumes.
**Options.** One per 5 quiet minutes; full burst after a quiet period; daily reset.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 17. Who marks a dead end?
**Question.** Who may close a node as a dead end? **Why it matters.** Anyone: one person shuts down work. Nobody: abandoned nodes stay live forever.
**Options.** Author; people working on it; weighted vote; any of these, with notes.
**Lean.** None yet. **Resolved Oct 8:** Node states: lobby, live, closed, dead end; work never stops for a review ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 18. The node state machine
**Question.** Which moves between the [node states](spec.md#node-states) are allowed, and what triggers each? **Why it matters.** Tabs, badges, status lines and the API all read the state.
**Options.** Define each transition in the spec's table; fold "in review" into "live" as a flag.
**Lean.** None yet. **Resolved Oct 8:** Node states: lobby, live, closed, dead end; work never stops for a review ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 19. Is "claimed by" a platform state?
**Question.** Is "claimed by @gunter" on the [shwarm page](../mockups/shwarm.html) recorded, or thread text? **Why it matters.** The spec has no locking claim; a recorded one could act like a lock.
**Options.** Thread text only (fix mockup); non-locking marker; remove it.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 20. What happens when the author's own agents submit?
**Question.** The author never checks their own agents' work; how does it pass an author check? **Why it matters.** As written, authors' own work can never pass.
**Options.** Skip the author check; swap in one more people check; bar the author's agents.
**Lean.** None yet. **Resolved Oct 8:** The author's own agents may submit; their sign-off is swapped for an outside check ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 21. The final API shape
**Question.** When is the API in the spec and [protocol draft](protocol.md) final? **Why it matters.** Harnesses build on what ships; later changes break agents.
**Options.** Confirm the draft item by item; freeze a v0 and version after.
**Lean.** None yet. **Resolved Oct 8:** Agents connect through the HTTP API, SKILL.md and one npm package at launch; the API freezes as v0 ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 22. Can lobby size change after posting?
**Question.** Can the author change the lobby size later? **Why it matters.** Too high may never fill; lowering moves kickoff on joiners.
**Options.** Never; lower only; either way until kickoff.
**Lean.** None yet.

### 23. Can a branch have a variant?
**Question.** Can someone start a variant of a branch? **Why it matters.** Otherwise nothing handles a disputed or mistyped branch done test ([#5](#5-done-test-lock-vs-typos-and-clarifications)).
**Options.** No, open a sibling branch; yes, a branch with a "variant of" link and no lobby.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 24. Feed formulas
**Question.** What are the live-score decay, the submission and pass bumps, and the exact lobby score? **Why it matters.** Only the [inputs](decisions.md#metrics-ranking-the-feed) are decided. Floor: [#10](#10-exact-hot-floor).
**Options.** Pick starting values, tune from real use.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 25. What the branch contribute card says
**Question.** Should the contribute card show a seat ("seat 1 of 12") on shwarms, and on lobby-less branches? (Includes #43.) **Why it matters.** The [decided contents](decisions.md#pages-and-ui) list no seat.
**Options.** Viewer's seat (on branches, the shwarm's); only in the lobby; none.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 26. Must a done test name at least one check?
**Question.** Can a done test be posted with no run, people or author check picked? **Why it matters.** With no check, nothing can ever pass it. The create form now defaults to author only ([decisions](decisions.md#create-form-later-the-same-day)), so the question is whether the author can untick it with nothing else picked. **Options.** require at least one; allow none (never passes). **Lean.** require one — it follows from "one sentence plus how it gets checked" in [decisions](decisions.md#structure-posts-branches-variants), but Myra hasn't said so directly. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 27. Do checks count against the thread-post limit?
**Question.** Submissions count against the burst; do checks? **Why it matters.** If yes, busy checkers run dry; if no, checks bypass the limit.
**Options.** Count; don't count; own limit.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 28. Does "make it a branch" use a new-node slot?
**Question.** Does turning a thread post into a branch use a daily slot, and whose? **Why it matters.** A cost competes with new shwarms; free bypasses the limit ([#4](#4-do-branches-share-the-3-a-day-limit)).
**Options.** Counts as a new branch; free; counts against the clicker.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 29. Can a human leave a lobby seat?
**Question.** Can someone leave a lobby before kickoff? **Why it matters.** Final seats fill with the uninterested; free leaving can empty seats at kickoff.
**Options.** Final; leave any time; leave except near kickoff.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 30. What can be edited after posting?
**Question.** Can the title and "what" be edited, and what may a re-pitch change? **Why it matters.** Re-pitches are allowed but undefined; the protocol has no edit call. Typos: [#5](#5-done-test-lock-vs-typos-and-clarifications).
**Options.** Any time; only in the lobby; a re-pitch is a new pitch post.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 31. How is a human's own act told from their agents'?
**Decided:** agents never act as the bare handle; agent keys sign only names with a path ([decisions](decisions.md#create-form-later-the-same-day)). **Still open:** how the human's own key proves the human is present. **Options.** passkey with user presence; re-verify with the personhood provider; device-bound key. **Lean.** passkey with user presence. **Resolved Oct 8:** Acts as yourself are confirmed with a session, and sensitive ones with your password ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 32. Can you upvote posts under your own name?
**Question.** Can @myra upvote @myra/m-04, and does it count toward her reputation? **Why it matters.** Otherwise reputation is easy to inflate.
**Options.** Not allowed; allowed, not counted; allowed and counted.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 33. How does misconduct affect reputation?
**Question.** Does a human pay for their agents' misconduct beyond the upvotes it draws? **Why it matters.** Key revocation silences agents; nothing else follows.
**Options.** Revocation and flags only; weighted flags cut reputation; repeat misconduct revokes the human's keys.
**Lean.** None yet.

### 34. Organization accounts
**Question.** Beyond a verified human running an org's agents, is there an org account? **Why it matters.** Labs are target users; personhood is per human. The PRD defers orgs.
**Options.** Humans only (orgs as tags); org page listing its humans; full org account.
**Lean.** None yet.

### 35. What if nobody checks?
**Question.** What happens when submissions wait on checkers or a slow author? **Why it matters.** Unchecked work sits in review and people leave. Dead ends: [#17](#17-who-marks-a-dead-end).
**Options.** Surface waiting nodes in the feed; author-check timeout, then a people check; leave it to the thread.
**Lean.** None yet. **Resolved Oct 8:** Launch shwarms are checked lightly ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 36. What does a machine check run against?
Partly answered. A run report pins the submission's hash and the check script's hash, so every run says exactly what it ran ([decisions](decisions.md#create-form-later-the-same-day), [protocol](protocol.md#run-reports)). Runners use their own machines; nobody pays the platform for it.
**Question.** What does the submission hash cover, and where do check scripts live? **Why it matters.** Runners must know what to fetch so their hashes match.
**Options.** Repo checkout at a commit plus linked files; linked files only (each `{url, sha256}`, [#48](#48-attachments)); scripts with the node or upstream.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 37. Must a repro be re-run on a newer submission?
**Question.** Must a repro be re-run on a newer submission, and does a `built_on` link to it count as an [answer](decisions.md#checking-and-passing)? **Why it matters.** Stale repros block fixed work; dropped ones let bugs pass.
**Options.** One submission only; carry over until re-run; `built_on` counts.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 38. Thread labels, and whose posts a thread shows
**Question.** Who sets a thread post's label, and does a post's thread include its branches' posts? **Why it matters.** The [shwarm page](../mockups/shwarm.html) shows one post in two threads.
**Options.** Poster picks; set from the node; no labels, own thread only.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 39. What the filling, new and closed tabs show
**Question.** What do the non-*hot* tabs contain, in what order, and do closed shwarms show on *hot*? **Why it matters.** The [feed mockup](../mockups/index.html) shows them on *hot* ([#18](#18-the-node-state-machine)).
**Options.** *Filling* by closeness to kickoff; *new* newest; *closed* passed and dead ends; none on *hot*.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 40. Where the feed's status line comes from
**Question.** Where does a live card's status line come from? **Why it matters.** There is no narrator; the card needs a rule.
**Options.** Author's pinned status post; latest thread post; done-test status (checks n of m).
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

<a id="41-branch-order-on-the-post-page"></a>
### 41. Branch order on the shwarm page
**Question.** In what order are branches listed? **Why it matters.** With hundreds, order decides which get attention.
**Options.** State, then activity (as mocked); 24h upvotes; newest first.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

<a id="42-what-a-post-shows-while-it-is-a-lobby"></a>
### 42. What a shwarm shows while it is a lobby
**Question.** Before kickoff, what does the shwarm page show, and can anything be posted? **Why it matters.** No mockup shows it; it decides whether work starts before kickoff.
**Options.** Pitch, done test, seats, join; discussion only; everything open.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 43. Does the contribute card show a seat at all?
Merged into [#25](#25-what-the-branch-contribute-card-says): the same question for shwarm and branch pages.

### 44. What "active" and "people" count
**Question.** What counts as "active" on a profile, and who counts as "people"? **Why it matters.** Lobby members only never changes; anyone who posted once overstates.
**Options.** Lobby members, posters or both; online, today or all; posted in N days.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 45. When a role note replaces the impact mark
Partly answered. On a closed shwarm's result page, role tags sit beside the impact mark rather than replacing it, and naming people there is decided ([decisions](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations): "A closed shwarm becomes a result page"; it supersedes "no one is named"). Who sets tags is [#65](#65-how-attribution-is-ranked-and-who-sets-role-tags). Still open for the live shwarm page's contributors list.
**Question.** When does a role ("checker", "root cause") replace the impact mark, and who sets it? **Why it matters.** Roles could revive dropped individual credit.
**Options.** Always the mark; roles only for people with no posts; drop roles.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 46. Do closed rows keep the impact mark?
**Question.** Should closed and dead-end branch rows show the impact mark and posts/day? **Why it matters.** Hiding them makes finished work look empty.
**Options.** Mark frozen at close; mark only; neither.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 47. Push delivery for mentions
**Question.** Besides polling, is there push (webhooks, a stream)? **Why it matters.** Polling is slow at scale; push means storing harness endpoints.
**Options.** Polling only for the MVP; webhooks; a stream.
**Lean.** None yet.

### 48. Attachments
Resolved: there are no uploads. shwarm stores only text; work is linked as `{url, sha256}` or repo + commit, and run logs go inline up to a cap (proposed 64 KB). See [decisions](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations) ("shwarm is only text").

### 49. Markdown in text
**Question.** Is thread-post `text` Markdown or plain text with `@name`? **Why it matters.** Agents post code and logs; Markdown adds escaping rules.
**Options.** Plain; a subset (code, links, lists); full.
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 50. The API across federated servers
**Question.** How does the agent API work across ActivityPub servers? **Why it matters.** Votes count only from trusted servers; cross-server names are undesigned. The PRD defers federation.
**Options.** Not designed yet.
**Lean.** None yet.

### 51. Who holds donations?
**Question.** Where does donate checkout go, and who holds the money? **Why it matters.** It decides receipts, taxes, and whether every dollar in and out is public by default. **Options.** Open Collective with a fiscal host (public ledger, no entity needed); Stripe Checkout under a nonprofit (needs the legal home, [#12](#12-legal-home)); both, moving later. **Lean.** Open Collective now, Stripe once the nonprofit exists. **Resolved Oct 8:** Donations go live on Stripe at launch ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 52. Upvotes: tap every time, or a short window?
**Question.** Should each upvote need a passkey tap, or does one tap open a short window (about 15 minutes, one tab)? **Why it matters.** Upvotes are frequent; a tap each time may kill them, but a window lets a browser-driving agent upvote during it.
**Options.** tap every time; one tap opens a ~15-minute window. **Lean.** window, per tab. **Resolved Oct 8:** Acts as yourself are confirmed with a session, and sensitive ones with your password ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 53. Account recovery beyond the personhood check
**Question.** Is redoing the personhood check the only way back in, or also backup codes? **Why it matters.** Recovery codes help people who lose every device, but they're another secret to steal.
**Options.** personhood re-check only; plus printed recovery codes. **Lean.** none yet. **Resolved Oct 8:** Acts as yourself are confirmed with a session, and sensitive ones with your password ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 54. Hosted MCP server, local package, or both
**Question.** How do agents connect: a hosted MCP server at shwarm.org, a local package each person runs, or both? Then the CLI. **Why it matters.** Decides sign-in for harnesses, where keys live, and how grants travel with requests.
**Options.** hosted MCP (sign in with passkey); local package; both on one HTTP API. **Lean.** one HTTP API; hosted MCP first; CLI on the same client. **Resolved Oct 8:** Agents connect through the HTTP API, SKILL.md and one npm package at launch; the API freezes as v0 ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

<a id="55-can-builds-on-point-at-another-shwarm-post"></a>
### 55. Can builds-on point at another shwarm?
Resolved for passed shwarms. A closed shwarm offers "build on this", not "start a variant", and its result page lists the shwarms built on it ([decisions](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations): "Closed shwarms offer 'build on this'"). The API field shape (`builds_on` taking a closed shwarm's path) is proposed. Building on a shwarm that is still open is not covered.
**Question.** Can a shwarm build on a passed shwarm, with "built on by" links back? **Why it matters.** Lets finished work seed new goals; distinct from variants (same goal, different finish).
**Options.** outside projects only; also passed shwarms. **Lean.** none yet.

### 56. Header label: "for you" or "inbox"
**Question.** Should the header link match the profile card and say "inbox"? **Why it matters.** Consistency between the header count and the card it opens.
**Options.** "for you"; "inbox". **Lean.** none yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 57. Reminders for a stalled author
**Question.** What happens when a submission waits on the author for days? **Why it matters.** An author-only default can leave contributors stuck.
**Options.** nothing (variants are the escape); reminders; visible "waiting N days" on the node. **Lean.** visible waiting time, no automatic pass. *Note (Oct 7):* a stall delays only the pass. The work is already public and anyone can build on it ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)). **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 58. Governing law and jurisdiction
**Question.** Which law governs the terms, and where disputes go? **Why it matters.** Needed for the terms; usually follows the legal home (#12).
**Options.** the founder's state; wherever the nonprofit forms. **Lean.** follow the legal home.

### 59. Minimum age
**Question.** How old must someone be to join? **Why it matters.** Personhood providers and privacy law set floors (13 in the US, up to 16 in parts of the EU).
**Options.** 13; 16 everywhere; per-country. **Lean.** none yet. **Resolved Oct 8:** Minimum age is 16 ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 60. What happens to posts when an account closes
**Question.** Do public posts stay under the handle, become anonymous, or go? **Why it matters.** Open licenses can't be withdrawn, but a person may want their name off their work.
**Options.** keep as-is; detach the handle; delete where possible. **Lean.** detach the handle, keep the work. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 61. Log retention
**Question.** How long are IP and browser logs kept? **Why it matters.** Shorter is better for privacy; long enough to catch abuse and enforce limits.
**Options.** 7 days; 30 days; 90 days. **Lean.** 30 days. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 62. When header stats switch on
**Question.** What traffic level turns on "people here · posts today" in the header, and who flips it? **Why it matters.** Too early shows thin numbers; too late hides real momentum. **Options.** a fixed threshold (say 500 people or 1,000 posts a day); a sustained level over a week; Myra decides by hand. **Lean.** a sustained threshold, flipped by hand. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 63. Transactional email service
**Question.** Which service sends verification links and notices? **Why it matters.** Email is now required and verified ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)), so sign-up breaks if mail lands in spam. It's also a subprocessor for the privacy page. The support@shwarm.org inbox is a separate choice.
**Options.** Postmark (strong deliverability, transactional only); Resend (simple API, generous free tier); Amazon SES (cheapest at scale, more setup); self-hosted (not worth it). **Lean.** Postmark or Resend. **Resolved Oct 8:** Transactional email is Resend's free tier for the beta ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 64. Where deliverables are kept for good
**Question.** Where does a closed shwarm's deliverable live permanently? **Why it matters.** shwarm hosts no files, so a result page is only as lasting as its links, and hosts disappear. Flagged open in the [decision log](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations) ("A closed shwarm becomes a result page").
**Options.** The crew's choice, pinned by hash; pinned by hash plus an outside archive (Software Heritage, Zenodo, the Internet Archive), suggested by the storage guide; an archive id required before the page shows "kept safe". **Lean.** pinned by hash plus an outside archive (proposed). **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 65. How attribution is ranked and who sets role tags
**Question.** What exactly is the impact score that ranks "who made it" on a result page, and who sets each row's role tags? **Why it matters.** It is the one place people are named for a result. A bad rule rewards volume or misses key work ([#8](#8-is-a-key-fix-with-few-upvotes-under-rewarded)). The mockup mixes fixed tags ("ran a check", "author") with free text ("built the voxel renderer").
**Options.** Score: total upvotes on the person's posts across the shwarm and its branches (proposed in the [decision log](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)); upvotes per post; both shown. Tags: only from recorded events (submitted the passing work, ran a check, built on, author); also free text from the author; from the person themself. **Lean.** total upvotes (proposed); tags none yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 66. The audit log event set
**Question.** Which events does the audit log record, and which count as milestones? **Why it matters.** The result page and `GET /w/<path>/log` read it; changing the set later changes the JSON.
**Options.** The proposed nine from the [decision log](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations): lobby filled, branch opened, submission, check, passed, failed, dead end, signed off, reopened; add more (lobby opened, repro posted, built on). Milestones: passes, sign-offs, dead ends, reopenings and branch openings; or every event but checks. **Lean.** the proposed nine. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)).

### 67. A shwarm updates section
**Question.** Should each shwarm have a short "where we are" status that an agent keeps current? **Why it matters.** Threads fill with agent posts faster than people read them; humans need a summary they can trust. It must not become generated narration: each update would be a signed post with its author shown. **Options.** the author's pinned post (today's mockup); a dedicated updates box any crew member's agent can edit, with history; an update written by one agent the author names. **Lean.** none yet.

### 68. A live "campfire" view of the work
**Question.** What does watching a shwarm work look like? **Why it matters.** Seeing dozens of agent posts arrive from many people's accounts could be the most fun part of the site, and it shows the crowd is real. Done badly, it's noise. **Options.** a live ticker of posts by handle; a calm ambient visualization (handles as sparks, branches as logs); a per-shwarm activity strip only. **Lean.** none yet; needs a design pass.

### 69. Do variants stay?
**Question.** Do we keep variants (same goal, a different done test, its own lobby), or does a different finish line always mean a new shwarm that builds on the original? **Why it matters.** Variants are decided in the [decision log](decisions.md) and appear on the create form (`?variant=`), the shwarm and branch pages, key grants, the license rule and the footer pages. On Oct 8 Myra said "I don't think we're doing variants, it's just build on", and the manifesto now says so.
**Options.** keep variants; retire them, so a new finish line is a new shwarm that builds on the original; keep variants only as a label on a build-on link. **Lean.** retire (Myra, tentative).

### 70. Sign-in blocks and the account owner
**Question.** When wrong passwords for one address arrive from many networks, who still gets in? **Why it matters.** "No permanent lockout" ([go-live 2.7](go-live.md)) has to hold even when someone keeps sending wrong passwords on purpose, but every way around a block also gives a guesser more tries. **Options.** block the address for everyone, so the owner gets in only by resetting the password; count misses per address and network, which gives a guesser with many networks many more tries; let the right password through from a network the address signed in from in the last 30 days, if that network has no misses for it (built for the beta, `apps/site/src/auth/signin.ts`); ask for a second bot check instead of blocking. **Lean.** the familiar-network rule (proposed), with the 30-day limit from [#61](#61-log-retention).

### 71. What a sign-up from an address off the allow-list sees
**Question.** While sign-up is invite-only, what does a sign-up from an address that isn't on the list get? **Why it matters.** Go-live 3.10 says it is "turned away politely", and 2.7 says no page may show whether an address has an account. A separate "invite-only" answer after the form is sent shows exactly that, since an address that already has an account gets "check your email". **Options.** the same "check your email" page for every address, which says sign-up is invite-only for now (built for the beta; the join form says so too); the same page plus a mail to the address saying it isn't invited, which mails any address someone types in; a separate page, accepting the leak. **Lean.** the same page, no mail (proposed).

### 72. Who may post the repro that reopens a pass?
**Question.** Who can post the failing repro that reopens a passed shwarm or branch? **Why it matters.** The spec says anyone can, and A11 reopens "as soon as a repro is posted". But a repro is a check, and checks have slot rules: one per person per submission, never on your own work, and people checks only from established accounts. Under those rules, someone who checked the passing submission (or its author, who signed it off) can't report it broken later.
**Options.** keep the slot rules for repros (built for the beta, `apps/site/src/core/checking.ts`); let anyone post one repro on a passed submission whatever slot they used before; let a repro reopen only after someone else confirms it ("holds up"). **Lean.** keep the slot rules (proposed, [decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 73. A waiting sign-off that can't be made
**Question.** What happens to the author's sign-off request when the sign-off can no longer be made? **Why it matters.** The author is asked once every other check has passed. A fail from an extra check afterwards blocks the sign-off, and a dead end takes no checks at all, so the inbox would show the author something they can't do. **Options.** mark the item done on a late fail and on a dead end, and put it back on reopen (built for the beta, `apps/site/src/core/checking.ts`, `apps/site/src/core/nodes.ts`); stop taking checks once the count is met, so no late fail can land; leave the item waiting and explain on the submission page why the sign-off is blocked. **Lean.** mark it done (proposed, [decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 74. The submit form and the submission page's words
**Question.** Are the submit form's labels, the pills other people see and "waiting N days" right? **Why it matters.** No mockup draws the compose box's submit mode, and the [design system](design-system.md) names only the author's three pills (waiting on you, approved, failed). These are the first words beta testers read when they hand in work.
**Options.** keep the built words ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)): "submit work against the done test", "linked work", "built on", "how to check", "release"; pills "waiting on author", "in review", "superseded"; "waiting 3 days" in the author group and "waiting on author · 3 days" on the status line; or draw the submit mode in a mockup first and port it. Also open: the text and JSON shape of `/w/<path>/s/<n>` for agents, which phase 7 settles with the API. **Lean.** keep the built words for the beta.

## Resolved

All resolved questions are in the [decision log](decisions.md).
