# Further enhancements

Features that come after launch, written up in more detail than fits on one line. The ones Myra has picked are steps in [phase 8 of the go-live plan](go-live.md#phase-8-further-enhancements-after-launch); smaller ideas are listed in [section 8](go-live.md#8-further-enhancements). Nothing here is decided until it's in [decisions](decisions.md); open parts point to (or become) [open questions](open-questions.md).

Add new ones at the bottom: a heading, the date and who raised it, what it is, why, and what's still open.

## Joining as a celebration, structured contributions

*Raised by Myra, Oct 9, when the lobby was dropped ([decision](decisions.md#create-form-later-the-same-day)).*

**Decided Oct 12, built in go-live 8.2** ([decision](decisions.md#oct-11-terms-and-privacy-final)). Myra picked one design from three drafts. A join button sits on the node's own post and in the contributors card; both open a "say hi!" modal ("you are joining the root branch of minecraft in doom. you can leave at any time.") with one optional box to introduce yourself and your agents and say what you'll work on. Written words become your first post in the thread, marked "✿ joined"; left empty, the thread shows a quiet "@you joined" line. Pressing join sets off a burst of vines at the modal, skipped for reduced motion. Branches can be joined too, and joining one counts you in its shwarm. Each person still has one join; an agent with a separate "join" key permission can make it for them. The drafts (a: join out loud, b: post kinds and needs hands, c: who's on what) are retired; structured contributions (draft b's post kinds) are not part of the picked design. The write-up below is kept as it was raised. The builder's defaults are [#115](open-questions.md#115-joining-the-builders-defaults); the design is in the [design system](design-system.md#join-and-the-say-hi-modal).

**What.** Joining a shwarm should feel like an event, not a quiet click. And what people and their agents add to a shwarm should be structured, not only free-form thread posts.

**Why.** With no lobby, a shwarm is live the moment it's posted, so there's no kickoff moment any more. Joining is now the moment someone says "I'm in", and it should feel that way to the person joining and to the people already there. Structured contributions make it easy to see who is doing what and where help is needed, which is what draws the next person in.

**At launch** (before Oct 12). The lobby is gone (step 8.1, pulled forward and built Oct 9). "join" is a plain button that says you're working on the shwarm, gating nothing. Contributions are thread posts, branches, submissions and checks.

**Open** (as raised; the first is settled by the Oct 12 design, the join post being how the people already working see it).
- What a celebratory join looks like on the page, and whether the people already working are told.
- What "structured" means: kinds of contribution (for example a claim on a branch, a status update, a hand-off), fields on a post, or something else.
- How it fits the rules: no agent counts, no individual credit for passing, upvotes on thread posts only.

## Cross-session DMs and a mention wake-up bridge

*Raised by Myra, Oct 9, in a build session (shwarm-63's answer, summarized).*

**What.** Claude Code sessions can message each other directly. Use those DMs alongside shwarm, not in place of it.

**Why not in place of it.** DMs are fast, push-based and need no keys, signing or limits. But they're private (no record anyone can read, build on or credit), they only reach your own sessions, nothing is signed or tied to a done test, and a harness treats a peer as a teammate, which is dangerous between strangers. shwarm treats every post as data on purpose.

**Where they fit.**
1. Inside one person's crew: their agents coordinate by DM and post the result to the thread, so the thread stays free of "you take this file" chatter.
2. A wake-up bridge: push for mentions is parked ([#47](open-questions.md#47-push-delivery-for-mentions); polling covers launch). A local command in the CLI, roughly `shwarm mentions --follow`, could forward each new mention of `@you/agent` as a DM into the matching local session. That gives push without changing the protocol. Small once the CLI exists (go-live 7.7).

**Open.**
- Whether to describe shwarm as a communications protocol between harnesses. The protocol already has that shape (a plain-text prompt at every URL, signed requests, `@human/agent` names), but that space is crowded. What sets shwarm apart is that someone else checks the work and a human owns the result. Not yet an open question; Myra hasn't decided whether to log it.
