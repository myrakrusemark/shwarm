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
|70|Sign-in blocks and the account owner|the familiar-network rule (proposed)|
|71|What an off-list sign-up sees|the same "check your email" page, no mail (proposed)|
|72|Who may post the repro that reopens a pass|keep the slot rules (proposed)|
|73|A waiting sign-off that can't be made|mark it done (proposed)|
|74|The submit form and the submission page's words|keep the built words for the beta|
|75|The author-gone rule's edges|the built defaults (proposed)|
|76|The check form, sign-off and dead-end words|keep the built words for the beta|
|77|The branch and variant form's extras|keep the built ones for the beta|
|78|Upvote and pinned-post edges|the built defaults (proposed)|
|79|Re-pitch, late join, delete and "make it a branch" edges|the built defaults (proposed)|
|80|Limit gaps found by the limit tests||
|81|The result page and the audit log's edges|the built defaults (proposed)|
|82|The API's link spelling and the canonical link form the hash covers|settle in phase 7; the code keeps its names until then (proposed)|
|83|The inbox's edges|the built defaults (proposed)|
|84|The account modal's edges|the built defaults (proposed)|
|85|Notice email edges|the built defaults (proposed)|
|86|Export and closing edges|the built defaults (proposed)|
|87|Signed-request details table B leaves open|the built defaults (proposed)|
|88|The keys page's edges|the built defaults (proposed)|
|89|The signed request pipeline's edges|the built defaults (proposed)|
|90|The agent API's edges|the built defaults (proposed)|

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
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)). Built Oct 9 (go-live 4.8): "claimed by" is gone from the shwarm mockup and the site, and a test keeps it out of every template.

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
**Lean.** None yet. **Default adopted Oct 8** ([go-live table B](go-live.md#table-b-defaults-to-build-on-accept-all-in-one-go-or-change-any-row)). Built Oct 9 (go-live 4.4, 4.8) on the site only; the edges are [#79](#79-re-pitch-late-join-delete-and-make-it-a-branch-edges).

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

**Decided Oct 9 (Myra):** no. Variants are dropped; "build on" stays. See [decisions](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations).
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

### 75. The author-gone rule's edges
**Question.** Table B says the operator takes a gone author's sign-off. What about the edges? **Why it matters.** The operator is also a member who submits and checks work, and accounts can come back from a suspension. A rule with gaps leaves a submission nobody can sign off, or lets one person both check and pass the same work.
**Options.** for an operator who submitted the work or already checked it: keep the usual refusals, so nobody can sign off until the author is back (built for the beta, `apps/site/src/core/checking.ts`), or let another admin, or fall back to "the other checks are enough". For scope: sign-off only (built), or dead ends and reopening too. For branches: every node's author (built), or shwarm authors only. On a lifted suspension: the slot goes back to the author at once (built), or stays with the operator for submissions already waiting. Also open: a sign-off item that reached the author before they left stays in their inbox, and admins aren't told about it; and an item that reached the admins stays with them once the author is back, saying it waits on the author (built), while the author gets no new item. **Lean.** the built defaults ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 76. The check form, sign-off and dead-end words
**Question.** Are the words on the new check and sign-off forms right? **Why it matters.** No mockup draws the people check form, the inline password field, the author's dead-end and reopen box, or the opened signed log. Beta testers read these when they check work.
**Options.** keep the built words ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)): "check it", "your check", "what you checked, or what fails and how to see it", "links", "post check", "post repro", "you have a check on it already.", "sign in to check it. agents send run reports with a key.", "#2 passed. a repro on it reopens …"; the password field "password" with "enter your password to confirm." when it's empty; "your branch" with "mark it a dead end", "why it stops here", "so nobody repeats it. the note shows on the branch.", "a dead end takes no submissions or checks until you reopen it. confirms with your password.", "mark dead end", "reopening takes submissions and checks again.", "reopen"; "check script 5d02b7e · ran on linux, rtx 3060" under an opened log; the operator's "its author's account is gone, so you sign off as the operator." and the author-gone mail; or draw them in mockups first. **Lean.** keep the built words for the beta.

### 77. The branch and variant form's extras
**Question.** Are the create form's branch and variant modes right where the mockup doesn't say? **Why it matters.** `mockups/new.html` draws both modes, but predates triage and the result page; beta testers will make branches from day one.
**Options.** keep what was built for go-live 4.3 ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)): the button notes "a quick automatic check runs first. until it's done, usually within a minute, only you can see it. then it's live under <parent>, and anyone can work on it." (branch) and "… then it's linked from the original as a variant. you start in seat 1 of its lobby." (variant); a variant prefilled with the original's tags as well as its title and what; a parent or original the viewer can't see is a 404; a lobby parent, a branch picked as an original or a closed original shows core's reason in place of the form, and a closed one adds a "build on this" button; a closed shwarm's page gets a "build on this" link until the result page (5.7); `?builds_on=` names a closed shwarm in a chip under the field and hides the license picker; or change any of them. Whether variants stay at all is [#69](#69-do-variants-stay). **Lean.** keep the built ones for the beta.

### 78. Upvote and pinned-post edges
**Question.** Where go-live 4.6 and 4.7 don't say, how should upvotes and the author's pinned post behave? **Why it matters.** Upvotes decide ranking, hot, impact and the attribution on result pages, and the pinned post is the feed card's status line ([#40](#40-where-the-feeds-status-line-comes-from)). Beta testers use both from day one.
**Options.** For an upvote given before the voter is established: stays uncounted (built for the beta, `apps/site/src/core/posts.ts`), or starts counting once they are. For the established rule: a week old with one upvoted post from any verified account, also on your agents' posts (built, as proposed in A6), or only from established accounts, or only on posts as the bare handle. Upvotes on closed and dead-end nodes: allowed (built), which can move a result page's ranking after the pass, or frozen at the pass. A pace limit on upvotes: none (built), or a bucket like posts'. For the pinned post: pin only a new post from the compose box (built), or also an earlier post; a submission with the pin ticked: refused (built), or posted and pinned; no unpin (built), or unpin back to the seed's sources post; an edit counts toward the posting pace (built), or edits are free; a name added in an edit gets no inbox item (built), or it does. The words: "pin it as "where we are"", "its first line shows on the feed. it replaces the pinned post", "edit", "save", "the version you replace stays in the edit history.", "edit history" and "edited", "posted / edited 1h ago" on each earlier version, "older versions aren't shown.", "sign in to upvote", "upvote", "take back your upvote", "your upvote counts once your account is established. click to take it back", "a submission can't be pinned. submit it without the pin, or post it to pin it.". **Lean.** the built defaults (proposed, [decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 79. Re-pitch, late join, delete and "make it a branch" edges
**Question.** Where go-live 4.4 and 4.8 don't say, how should re-pitching a lobby, joining a live shwarm, deleting a post and "make it a branch" behave? **Why it matters.** A re-pitch changes what people joined for and what triage cleared; a delete changes the thread record; beta testers meet all four in the first week.
**Options.** *Re-pitch:* author only, behind the password (built), or as a plain act; spends a thread post token (built) or is free; the new words go through triage again, so a cleared lobby is seen only by its author until it's cleared again, usually within a minute (built), or stay public while being checked, or skip triage; a held node stays held for Myra (built), with no new alert when it's re-pitched (built), or an alert; under "re-pitched", everyone sees only versions that were public when replaced and the author sees all (built), or everyone sees all once the current words clear, or no history; a blocked one can't be re-pitched (built); the address (slug) stays (built) or follows the title. *Late join:* "join" under the live shwarm's contributors (built), with no leave after kickoff (as before); late joiners show among contributors and on their profile and get the node's notices, but not the kickoff notice (built). *Delete:* the post stays as a tombstone ("this post was deleted.") with its name and time, and its replies stay (built); its text, links, earlier versions and mentions are erased, kept for nobody, the operator included (built), or kept privately for moderation; it still counts toward the thread's posts and its upvotes stay (built), or it drops out of the numbers; a deleted pinned post unpins (built); no password (built); no edit or delete API at launch (table B #30). *Make it a branch:* on plain posts of a live node (built); fills the branch form with the post's first line as the title and its text as the what (built), or only the what; the branch doesn't record the post, so "became sub-branch" (THREAD-9) isn't shown yet. The words: "join", "late joiners are welcome: no seat limit now it's live.", "you're working on this.", "verify your email to join.", "re-pitch it", "the done test stays locked. the version you replace stays in the history.", "a quick automatic check runs again first. until it's done, usually within a minute, only you can see it. confirms with your password.", "re-pitch", "re-pitched", "started / re-pitched 1h ago", "a pitch needs a title and a what.", "only the author re-pitches.", "slow down: you can re-pitch again in …", "delete", "it leaves a note that a post was here. replies stay. this can't be undone.", "delete it", "this post was deleted.", "(deleted by its poster)" in the agent prompt. **Lean.** the built defaults (proposed, [decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 80. Limit gaps found by the limit tests
**Question.** Are the limits the limit tests added (go-live 4.9) right, and should a 304 skip D1? **Why it matters.** The forgot form sends mail on the free quota; the 413 page is the only thing someone sees when a form is too big, and its draft is lost; the read cap now also meters the feed and profiles.
**Options.** *Forgot password per network:* 10 an hour (built, `apps/site/src/auth/throttle.ts`), another number, or none (the per-address mail cap alone). *The 413 words:* "too large" / "that was more than 256 KB, the most we take at once." (built), or others. *256 KB on site forms:* as built (a submission whose text and how to check are both near 20,000 characters of a non-Latin script goes over and loses its draft), or a larger cap for site forms than for the API. *A 304:* a copy of the version kept in each Worker isolate for 15 seconds (built after review, to meet go-live 4.9's "a 304 costs no D1 row reads"), which makes repeat 304s free but lets a new post or a takedown made elsewhere wait up to 15 seconds for readers who already have the page, or one indexed query on the node chain every time (built first; a takedown never answers 304, but 4.9's done-when would need rewording). *The read cap:* one bucket for node pages, the feed and profiles (built), or one each.

### 81. The result page and the audit log's edges
**Question.** Where go-live 5.7 and the closed mockup don't say, how should the result page and `GET /w/<path>/log` behave? **Why it matters.** The result page is where people are named for a pass, and the log's JSON shape is part of the API that freezes as v0.
**Options.** *A passed branch:* the live template with the closed pill and "proof it's done" (built), or a result page of its own. *Milestones:* lobby filled, branch opened, passed, dead end, reopened and signed off (built, `apps/site/src/core/audit.ts`), or the mockup's view, which also shows submissions, or every event but checks. *Role tags:* "submitted the passing work", "built on", "author" (decisive), "ran a check", "<branch> passed" (built), or also "root cause" (needs a way to record it), "started the shwarm", or free text from the author ([#65](#65-how-attribution-is-ranked-and-who-sets-role-tags)). *Who made it:* 8 rows plus anyone below with a decisive tag (built), or another number. *The thread of a closed shwarm:* at `?thread=1` with "← back to the result" (built), or another address. *The log JSON:* every Accept gets JSON (built), or a text form for agents and a page; 50 events a page (built); the seeded row with a null `id` and `event: "seeded"` (built), outside the nine types, or a stored tenth event type. *The log box:* the newest 20 milestones with "all" linking to the JSON (built), or a page view of every event. The words: "← back to the result", "the exact build the checks ran" after the hash (the mockup's, now after the submission hash), "fingerprint" rows with "· of <file>", "<label> on <host> ↗" buttons, "how to use" (the mockup says "how to play"), "built on", "ran a check", "<branch> passed", "+ N more", "showing N of M events". **Lean.** the built defaults (proposed, [decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 83. The inbox's edges
**Question.** Where go-live 6.1 and the profile mockup don't say, how should the inbox behave? **Why it matters.** The inbox is where authors hear their work is ready to sign off and where people answer each other; beta testers use it from day one, and "for you N" shows on every page.
**Options.** *Reading:* only "mark read", "mark all read" and a reply read an item (built, `apps/site/src/read/inbox.ts`), or opening it ("see thread", "open") reads it too. *The reply:* lands on the reply in its thread (built), or stays on the inbox with a note; a reply reads the item (built), or not. *Hidden things:* an item whose post is hidden or deleted, or whose node doesn't show to its owner, leaves the list and the count (built), or shows as a tombstone. *The list:* 25, then "show all" up to 500 (built), or paged; a mention's first 400 characters on one line (built), or the whole post. *Sign-off words:* "needs your sign-off." for an author-only node and "needs a sign-off. its author's account is gone, so you sign off as the operator." for the operator (built), or others; the same words once the pill says approved or failed (built), or a past tense. *"Waiting on you":* on the node's own rows (built), or also on its parent's row as the mockup draws it. The new words: "show all", "showing the newest N.", "needs your sign-off.", "needs a sign-off. its author's account is gone, so you sign off as the operator.", the reply box's label "reply to <name>", and "needs its author's sign-off." on an operator's item once the author is back. **Lean.** the built defaults (proposed, [decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 84. The account modal's edges
**Question.** Where go-live 6.2 and the profile mockup don't say, how should the account modal behave? **Why it matters.** It is where people change how they sign in and where their mail goes; a gap here can lock someone out or let an address be probed. Beta testers open it in the first week.
**Options.** *Display name:* editable any time (built, `apps/site/src/web/account.tsx`), or fixed after sign-up as a "persistent pseudonym" (ID-4), or changeable with a cool-down. *Links:* two, "website" and "code" (built, as the mockup), or a free list of up to 5 with labels; 200 characters (built) or longer. *Email change:* the link lasts 24 hours (built) or 7 days like verify; an address that already has an account gets no link and the page doesn't say so (built), or the page says it's taken; the new-address mail counts toward the account mail caps (built) or not; the beta allow-list isn't checked on a change (built) or is. *Notices:* "new in your inbox" covers mentions and sign-off mails (built), or sign-off mails get a box of their own; daily digest (built) or right away as the default; "passes or fails" off (built, as the mockup) or on by default. *Change password:* asks for the current password only when the 10-minute window is closed (built, the step-up rule), or always. *Sign out everywhere:* this browser too, no password (built), or every other browser only. *Stopping a pending email change* (review fixes, Oct 9): a reset, a password change and "sign out everywhere" kill its link (built); a save with the account's own address in the field withdraws it (built), which means any save that leaves the field alone does too, since the field shows the current address; or the field shows the pending address while a change waits, or the pending note gets its own "cancel" button; the old address's warning could carry a cancel link too. *Email change pace:* 3 an hour per account (built), and/or a per-network count. The new words: the "display name" field with "optional. shown next to your handle.", "a link went to <new>. until it's clicked, <old> stays on your account.", "saved.", "your password is changed. every other browser is signed out.", "new password", "new password again", "this signs you out everywhere else. confirms with your password.", "ends every session, this one too.", "sign out everywhere", "you're signed out everywhere.", "keep it to 160 characters.", "that doesn't look like a link.", and the email change pages: "confirm your new email", "this link moves @<handle> to <address>. until you press the button, the old address stays on the account.", "didn't ask for this? don't press the button.", "press the button to use this address.", "use this address", "your new email is set", "shwarm sends your mail here from now on, and you sign in with it.", "email change links last 24 hours.", "to try again, open "account" on your profile and change the address there.", "that address is on another shwarm account now, so this one can't move to it. your old address stays.", "that's a lot of email changes. wait about <N minutes>, then try again.". **Lean.** the built defaults (proposed, [decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 85. Notice email edges
**Question.** Where go-live 6.3 and the account modal's mockup don't say, how should notice emails behave? **Why it matters.** Mail is the main way people hear that someone needs them, and too much of it gets the address marked as spam, which hurts every mail the site sends.
**Options.** *How often:* applies to mentions only, sign-off and kickoff mails always right away (built, `apps/site/src/email/notices.ts`), or to every inbox mail. *The digest:* 15:00 UTC for everyone (built, `apps/site/src/jobs/digest.ts`), another hour, or a time per person (no time zone is kept); the mentions of the day before (built) or since the last digest however long ago; unread ones only (built) or all; 20 quoted at 300 characters (built) or other numbers. *A right-away mention* quotes the first 1000 characters (built) or none. *Kickoff:* to everyone seated, the joiner too (built), or everyone but the joiner; under "new in your inbox" (built) or a box of its own. *Passes and fails:* to the people the inbox item goes to (built) or seat holders only; dead ends not mailed (built) or mailed. *A node still being checked:* its notices wait for triage, looked at again every 10 minutes for up to 3 days (built, `apps/site/src/jobs/mail.ts`), or are dropped, or wait with no end. The words: the mention mail ('@ana mentioned you on <title>', '<name> wrote:', 'reply in its thread:', 'the post goes on. read it all and reply in its thread:'), the digest ('you were mentioned N times on shwarm', 'you were mentioned N times since your last digest:', '<name> on <title>:', 'and N more in your inbox:', 'this comes once a day. you can get each mention right away instead, in your account.'), kickoff ('<title> is live', "the lobby for <title> filled, so it's live now. branches and submissions are open."), the pass and fail subjects ('<title> passed', '#N on <title> failed the author check', '<title> reopened') with 'see what passed:' and 'see why:', and 'pass and fail' in the unsubscribe footer and page. **Lean.** the built defaults (proposed, [decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 86. Export and closing edges
**Question.** Where go-live 6.4 doesn't say, what does "download your data" hold, and what exactly does closing delete and keep? **Why it matters.** Both are promises on the privacy page, closing can't be undone, and a closed account's work keeps showing in other people's shwarms.
**Options.** *The export:* the lists built (`apps/site/src/read/export.ts`), at most 5 an hour, 20,000 rows a list, or other caps; hidden posts included (built) or left out. *Closing deletes:* email address, password, display name, about, links, notice settings, admin flag, sessions, emailed links, inbox, mentions of the handle, mail rows, key networks (built, `apps/site/src/auth/close.ts`); keys revoked and kept (built) or deleted; the beta allow-list row and the address's suppression row kept (built) or deleted. *The handle:* kept with the closed account so nobody can take it (built), or freed after a while. *The address:* free to sign up again at once (built) or held for a while. *Seats:* given up in other people's lobbies (built; a join at the same moment can kick a lobby off one seat short) or kept. *Waiting sign-offs:* handed to the operator at once (built) or left until someone notices. *The names:* every name under the handle shows as "former member", agents' too (built, `apps/site/src/read/names.ts`), or "former member/m-04" for agents, or the handle kept on the audit log; quoted as `author="former member"` in the agent prompt (built). *Confirming:* the handle typed out and the password (built), or the password alone. *The closing mail's row:* keeps the address until it is sent, then drops it and the account (built), or is deleted once sent. *Mail written before a closing:* names the closed account as "former member" when it goes (built), or keeps the handle. *The author tag:* left off every post on a closed author's shwarm (built), or kept on their own posts. The words: "your data", "everything we hold about you, as a json file. confirms with your password.", "download your data", "close your account", the paragraph under it, "type <handle> to confirm", "close my account", "type <handle> to confirm." (refusal), "<title> reopened. its author picked it back up." (the reopen notice, which named the handle before), "that's a lot of downloads. wait …, then try again.", "former member", and the closing mail. **Lean.** the built defaults (proposed, [decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 87. Signed-request details table B leaves open
**Question.** Table B fixes what a signature covers and its parameters. What about the rest of how the server reads one? **Why it matters.** These details freeze with v0, every client (the CLI, the Python example, anyone's own code) has to get them exactly right, and a strict rule is easy to loosen later while a loose one is hard to tighten.
**Options.** *Bodiless requests:* always send `Content-Digest` (the empty body's sha-256) and always cover it (built, `packages/protocol/src/signature.ts`), or leave it out of GETs. *Picking the signature:* by `tag="shwarm"`, any label (built), or only the label `sig1`. *Extra coverage:* extra covered header fields allowed (built) or refused. *Parameters:* the five plus an optional `expires` (built), or also allow others and ignore them. *Nonce:* 8 to 128 visible ASCII characters (built), or a fixed form such as 22 base64url characters. *Refusal reasons* in the 401 body (built: `missing`, `malformed`, `components`, `clock_skew` with `server_time`, `expired`, `content_digest`, `unknown_key`, `invalid`), or one bare `bad_signature` that tells a client less. *The vector key's name:* `test-key-shwarm` (built), or the running example's `myra-harness-1`. **Lean.** the built defaults ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 88. The keys page's edges
**Question.** Where go-live 7.2 and the keys mockup don't say, how should keys be made, listed and ended? **Why it matters.** Keys are how every agent acts; a loose rule lets a leaked key do more than it should, and a strict one makes harnesses awkward to run. Beta testers make keys in the first week, and the secret format freezes with v0.
**Options.** *Keyid:* random from the server, 20 base32 characters (built, `apps/site/src/auth/keys.ts`), or made from the handle and the key's name (`myra-harness-1`, as the docs' example), or chosen by the browser. *Can post as:* a name, or a name cut short with `*` at the end covering every longer name (built; the spec's `@myra/fathom-*`), or only `/*` at a segment's end. *Grants:* up to 50 per key (built) or another number; a grant with nothing ticked kept as a block (built) or refused; a key with no grants allowed (built) or refused; grants only on nodes the person can see (built). *The chooser:* "you're in" means a seat or authorship anywhere in the shwarm (built) or only a seat in the shwarm itself; search is a plain title match (built) or the feed's search. *Rotate:* a new key with the same settings, a fresh expiry of the same length and a new keyid, the old one revoked at once (built), or the old one kept for a grace period, or the old expiry kept. *The cap:* 20 working keys, revoked and expired ones not counted (built); making and rotating paced at 20 an hour (built). *The list:* ended keys stay greyed for 30 days (built), or forever, or not at all. *Last used:* the name and node of the last signed request (built, written by 7.3), or only the time. The new words: "not used yet", "nothing" and "nothing yet" for a key's access, "no keys yet. make one for each harness or machine.", "20 keys is the most. revoke one to make another.", "making a key needs javascript: the key pair is made in your browser, so its secret never reaches us.", the rotate and revoke forms ("a new secret replaces this one, with the same name and access. the old one stops working at once.", "rotate key", "it stops working at once. its past posts stay, still yours.", "revoke key", "every key stops working at once. their past posts stay, still yours.", "revoke all"), "revoked. it stops working at once.", "every agent key is revoked.", "revoked 3m ago" / "expired 2d ago", "edit later" / "delete later", and the refusals listed in [wording to approve](copy-to-approve.md#72-the-keys-page). **Lean.** the built defaults (proposed, [decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

### 89. The signed request pipeline's edges
**Question.** Where go-live 7.3 and table B don't say, how should the server treat a signed request? **Why it matters.** These answers freeze with v0 and every client is written against them; the "used somewhere new" mail is how a human finds out a key leaked, and a mail per request would flood them and use up the day's mail quota.
**Options.** *A missing `Shwarm-Version`:* means 0 (built, as prd-api API-2), or refused. *The host:* signed requests only to the site's own host, with the reason `wrong_host` (built, `apps/site/src/api/signed.ts`), or any host the Worker answers on. *New refusal reasons:* `wrong_host` and `replay` added to the list in #87 (built), or folded into `invalid`. *A revoked key with a bad signature:* says `invalid`, so only the holder learns it's revoked (built), or `key_revoked` first. *A suspended account's keys:* `key_revoked` (built) or a code of their own. *The Idempotency-Key's form:* 1 to 255 visible ASCII characters (built) or a UUID only. *What's kept:* only 2xx answers, so a refusal's retry runs again (built), or every answer below 500 but 429. *A different request under a used key:* `409 idempotency_conflict` (built, the code table) or 422 (prd-api API-20). *One still running:* 409 until it finishes or 2 minutes pass (built), or a 429 with a short wait so clients retry on their own. *The replay header:* `Idempotent-Replayed: true` (built) or none. *Last use:* written at most once a minute unless the name or node changed (built), or on every request. *The "used somewhere new" mail:* on each network new to the key (built), or new to the person; the key's first network skipped when the human signed in from it (built), or mailed too; at most one per key an hour (built), or another pace; a network held back by the pace mailed with the key's next request after the hour, up to 20 networks a mail (built), or one summary at the hour's end, or a mail for each. *Last use for a refused call:* the time only, not the name and node (built), or nothing at all. *Words:* the mail and the refusal messages in [wording to approve](copy-to-approve.md#73-the-signed-request-pipeline). **Lean.** the built defaults (proposed, [decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).


### 90. The agent API's edges
**Question.** Where go-live 7.4, protocol.md and openapi.yaml don't say, or disagree, how should the agent API's calls behave? **Why it matters.** These answers freeze with v0 (7.5); the CLI, the MCP tools and everyone's own harness are written against them, and a loose rule is hard to tighten once clients depend on it.
**Options.** *Field names:* the code's (`links`, `label`, `repo`; a repro's `links`), with `attach` refused and pointed at `links` (built, `apps/site/src/api/routes.ts`), or the docs' `attach` taken too, or only the docs' (#82). *Unknown fields:* refused with a 400 that names them (built), or ignored. *A body with no `kind`:* a thread post (built, as protocol §6 allows), or refused. *Bare-handle acts:* a bare or missing `as`, `slot: "author"`, `pin`, and a `kind` that names a site-only act (upvote, join, leave, pin, sign_off, dead_end, reopen, repitch, flag) all `403 bare_handle_needs_human` (built), or a 400 for the kinds. *Creates:* `202` with `triage: "held"` as a string (built, go-live 7.4), replacing openapi's `triage: {suggestion}`; `node`, `kind` and `limits` added. *Reading triage:* only a key of the author that may read the node gets `triage` (held while pending or held, blocked, cleared; a seeded launch shwarm still pending is cleared) (built), or any key of the author's. *A signed read:* as the key's human where the key's grant gives `read`, as the public elsewhere (built), or always as the human, or refused without `read`. *Seeing nodes:* a key acts only on nodes its human can see, anything else is `404 no_such_node` (built: createNode checks parent and builds-on in core, the API reads a thread act's node first); thread acts aren't checked in core because the staging example's agents act on a branch still waiting for triage (`apps/site/src/seed/example.ts`). *Variants:* refused with a 400 pointing at `builds_on`, as decided Oct 9 (built). *The submission's answer:* the 7-character hash (built) or the full one; `release` taken as `{name, version, how_to_use}` (built). *A check's answer:* adds `post`, the check's thread post (built). *Mentions:* one row per post, naming the first name under `to` it addressed (built), or one per name; `limit` 1 to 100, default 50 (built); `since` and `before` together page through a gap (built); needs `read` on some grant and a *can post as* that covers `to` (built), filtered by the grants (most specific wins) and by what the human can see. *The per-key cap:* a bucket of 120 refilling 2 a second (built, `apps/site/src/api/limits.ts`), or a fixed minute window; spent by every signed request once its signature and nonce pass, reads, retries and `GET /limits` included (built), or writes only; a 429 says `limit: "requests"`. *RateLimit headers:* on every signed answer, the act's limit first, then the key's: `"thread";q=5;w=1500`, `"submissions";q=1;w=86400`, `"new_nodes";q=3;w=86400`, `"requests";q=120;w=60` (built), or one policy only. *`GET /limits`:* `person`, `new_nodes_today`, `requests` (`left`, `of`, `per`), and with `?node=` `thread_posts` and `submissions_today`, each with `retry_after` when none is left (built). *CORS:* `Access-Control-Allow-Origin: *` with no credentials on every agent API answer and on public text and JSON node reads, never on pages or form answers; preflights answered on `/w/*`, `/shwarms`, `/mentions`, `/key` and `/limits`, before the staging lock, and for a POST only when it asks to send a signature (built, `apps/site/src/api/cors.ts`), or a list of allowed origins. *Errors:* a signed request over 256 KB gets the API's JSON `413 payload_too_large`; `need: "can_post_as"` and `node: "*"` (for `new_shwarms`) in a 403 (built). *Production while it holds:* node calls answer 404 and `/key` and `/limits` answer (built). *Words:* the refusal messages in [wording to approve](copy-to-approve.md#74-the-agent-api). **Lean.** the built defaults (proposed, [decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).

## Resolved

All resolved questions are in the [decision log](decisions.md).

### 82. The API's link spelling and the canonical link form the hash covers
**Question.** Which field names does the API take for links, and what exact link form goes into the submission hash? **Why it matters.** [protocol §6–7](protocol.md#links-not-files) and [openapi.yaml](openapi.yaml) say `attach`, a file link `{url, sha256, name?}`, a repo link `{url, commit, name?}`, and a repro `{steps, attach}`. The site's code (go-live phase 5, `apps/site/src/core/text.ts` parseLinks) takes `links`, a file link `{url, sha256, label?}`, a repo link `{repo, commit, path?, label?}` (it also reads `name` for `label` and `url` for `repo`), and a repro `{steps, links}`. The submission hash (go-live table B row A10) is sha256 over the canonical JSON (JCS) of `{text, links}`, so the field names, and whether a label is part of it, change every hash. A runner who computes the hash to check it needs one canonical form, and v0 freezes the API.
**Options.** the docs take the code's spelling (`links`, `label`, `repo`, `path`); the code takes the docs' spelling before v0; accept both on input and hash one canonical form (for example names normalized and labels left out, so relabeling a link doesn't change the hash). **Lean.** settle it in phase 7's API work; until then the code keeps its names and the docs carry a note (proposed, [decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)).
