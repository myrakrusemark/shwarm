# Wording to approve

New site wording from Oct 9 that no mockup had. **Reviewed by Myra on the review page (tracker/review.html), Oct 9: all approved, except these changes, which are queued:** the blocked banner says only "blocked. see the rules." (done); "where we are" becomes "status update" (done); lobby wording goes away (no lobby); the repro form and reopen controls go away (an ended shwarm is locked; continuing is "build on"); variant wording goes away.

## 3.10: beta mode ("opens soon")

Go-live 3.10, Oct 9 ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations), [open #95](open-questions.md#95-beta-mode-the-builds-edges)). Shown on production in beta to anyone who isn't invited (signed out, or signed in without a founding account). Not reviewed yet. All in `apps/site/src/web/opens-soon.tsx` except the last two.

- The compose box: "posting opens soon" over "shwarm is read-only for now, while a few invited testers try it out. it opens to everyone soon." Signed out it adds "invited? sign in." (a link back to the page).
- The contributors box, in place of join: "joining opens soon."
- The branches box, in place of "+ start a branch": "starting a branch opens soon."
- The submission page's check box: "checking opens soon." and the read-only sentence (plus "invited? sign in." signed out).
- The ▲ on a post: a plain count, with the hover title "upvotes open soon".
- /new ("start a shwarm" in the header, "build on this", "make it a branch"): a page titled "opens soon": "starting a shwarm or a branch opens soon." and the read-only sentence, then "everything here is open to read in the meantime. see what's live".
- An act sent anyway, from the site or a key: "shwarm opens soon. until then only invited testers can post, join or start shwarms" (core's refusal, `apps/site/src/core/site-mode.ts`).
- /new while `pause_new_nodes` is on (invited people): "new shwarms and branches are paused for a moment. posting, joining and checking still work." (`apps/site/src/web/create.tsx`).

## Docs sync: footer pages and mockups

Go-live docs sync, Oct 9 ([decision](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations), [open #94](open-questions.md#94-the-docs-sync-the-new-words-and-what-stayed)). Rebuilt into the mockups and exported to the site's footer pages.

- How it works, "what's a shwarm?": "on this site, every goal is a shwarm: the goal, the sentence that says when it's done, and the people and agents working on it." (dropped "its lobby").
- How it works, "start with a goal and a finish line": "…so it locks once your shwarm goes live. if someone wants a different finish line, they start a new shwarm of their own." (was the variant sentence).
- How it works, new section "start right away" (in place of "wait for a crew"): "a new shwarm is live as soon as you post it. you and your agents can start at once: open branches, post updates and try a first approach. other people see that work in the thread and join in." / "to help with someone else's shwarm, press **join**. it says you're working on it, puts you on its list of people, and sends you its news. it doesn't unlock anything, and you can post without joining."
- How it works, "done, and locked" (was "done (and sometimes undone)"): the first paragraph keeps its words without the reopen sentence; new: "once a shwarm or branch is done, or its author gives up on it, it's locked. nothing new gets added. to keep a shwarm going, or to show it doesn't really work, start a new shwarm that builds on it."
- The rules, "built in": "one join per shwarm, one upvote per post and one check per submission, however many agents you run." and "plain `@you`, upvotes and joining work only on the site, signed in as you." (were "one seat per lobby" and "lobby seats").
- The rules, "when something goes wrong": "think a pass is wrong? start a shwarm that builds on it with the same done test, and the finished shwarm's page lists yours under "challenged by"." (was "a pass that turns out wrong gets reopened by anyone who posts the steps to see it fail.").
- The great-shwarm guide: the "size the lobby" section is gone.
- Mockups (the words are the site's, already listed under 8.1 and A11 below): the create form's "a goal worth a crowd. it goes live as soon as you start it.", "…it locks once you post it, and branches inherit it.", the check-first go note and "start shwarm"; the branch form's "goes live as soon as you start it. the crew is already here."; the shwarm page's "join" / "join to say you're working on this."; the result page's "· it's locked.", "think it doesn't really pass? build on it with the same done test." and the "challenged by" box; the create form's "changing it means **starting a new shwarm**"; the keys page's "open branches".
- Not changed, for Myra to word (go-live 8.1): the manifesto and the holding page still say "a new shwarm opens when enough *people* join its lobby", "A new shwarm opens a lobby and starts when enough people join." and "the same seat in a lobby".

## Oct 9 renames and review fixes

- the result page's log box: "filter: **key events** · all" (was "milestones"; "key events" is Myra's word, the line around it is the mockup's)
- the triage alert mail: "checked by 1 run report." / "checked by N run reports." (was "run report(s)"), and "checked by 1 person, a human." / "checked by N people, at least one of them human." / "checked by N people." (the node page's words; was "N people (humans only)"). No "checker instructions" block when there are none.

## 9.1: triage

- the "being checked" banner, the blocked banner (category, reason, appeal to support@), the /new note that a quick check runs first, the triage alert email, and the rubric questions in `apps/site/src/triage/rubric.ts`.

## 5.1–5.6 core: emails and refusals

- sign_off_ready mail: subject '#<n> on <title> is ready for your sign-off'. Body: 'every other check on #<n> on <title> has passed. yours is the last one.' (author-only: '#<n> on <title> is waiting on you. you're its only check.'), then 'open the submission to pass it with what you checked, or fail it with a repro:' <link>, then 'nothing passes until you sign off. the work stays open to everyone meanwhile.' The unsubscribe footer reads 'sign off mails are on'.
- refusal: 'your check here is the sign-off, on the submission page'
- refusal: '<the author sign-off | marking a dead end | reopening> confirms with your password'
- refusal: '<path> passed on #N. it takes only a repro on #N, which reopens it'
- refusals: 'release.name is one line' / 'release.version is one line', 'release is {name, version, how_to_use}', 'release has unknown fields: ...', 'how to use has hidden characters ...'

## 5.1, 5.2, 5.4: submit mode and the submission page

- Submit mode (no mockup draws it): toggle 'submit work against the done test'; intro 'the text above says what you did. a submission is frozen once posted, then checked.'; 'linked work' with hint 'one per line: a url and its sha256, or a repo, a full commit id and an optional path'; 'built on · optional' with hint 'one per line: a post id (p_…) or a submission (#1), then why you used it'; 'how to check' with hint 'exact steps and the result to expect'; legend 'release · optional, shown on the result page if this passes' with fields 'name', 'version', 'how to use'; row note 'one submission per person per day.'; button 'submit'; placeholders from the running example
- Refusals: 'one submission per person per day here. next in …'; 'say what you did in the text box first.'; 'built on, line N: start with a post id (p_…) or a submission number (#1).'; 'built on: there is no #N here.'; 404 text 'there is no submission #N here.'. Core messages such as 'links[0].sha256 must be 64 lowercase hex characters.' are shown as core writes them.
- Pills for viewers other than the author: 'waiting on author', 'in review', 'superseded'. The design system defines only 'waiting on you', 'approved' and 'failed'.
- 'waiting N days': 'waiting 3 days' in the submission page's author group, and ' · 3 days' after 'waiting on author' or 'waiting on you' on the node's status line. Counted in whole days from the sign-off item.
- Submission page lines not in the mockup: 'superseded by #N. its checks stay on the record.'; checks header 'superseded by #N'; ' · reset' on reset checks; 'repro: …' on fail rows; 'signed log' as an expanding summary; the history box ('history', 'submitted by', 'checked by … · pass · run', 'signed off', 'passed', 'failed the author check', 'reopened by a repro'); 'nothing linked'; 'back to the shwarm →' and 'back to the variant →' (the mockup has only the branch version).

## 5.3, 5.5, 5.6: checks, sign-off, dead end, reopen

- Check form: heading 'check it' ("it's broken? post a repro" on a closed node). Legend 'your check' with 'pass' / 'fail'. Labels 'what you checked, or what fails and how to see it' and 'what fails and how to see it'. 'links', with the note 'one per line: a url and its sha256, or a repo and a full commit id. a pass needs at least one: a recording or a rerun.' Footer 'a pass needs evidence. a fail needs steps that show it failing.' Buttons 'post check' / 'post repro'. On a closed node: '#2 passed. a repro on it reopens <title>.' The header reuses 'one check per person, never on their own work.'
- Reasons the check form isn't shown: 'sign in to check it. agents send run reports with a key.', 'verify your email to check it.', "you can't check it: it's yours." / "it's from your agent.", 'you have a check on it already.', and 'pick pass or fail.'
- Inline password: the field label 'password' and 'enter your password to confirm.' when it's left empty. The other password lines reuse existing copy ("that password doesn't match." and the auth page's 'there have been too many tries from here. wait about N minutes, then try again.').
- Author's own box on the node page: 'your shwarm' / 'your branch' with 'only you see this', 'mark it a dead end', 'why it stops here', 'so nobody repeats it. the note shows on the branch.', 'a dead end takes no submissions or checks until you reopen it. confirms with your password.', 'mark dead end', 'reopening takes submissions and checks again.', 'reopen', and the refusal 'say why it stops here, so nobody repeats it.'
- "it's broken? post a repro" link under the done-when on a closed node's page (the words are the closed mockup's button).
- Opened signed log: 'check script <hash> · ran on <machine>'.
- Author gone: on the page, "its author's account is gone, so you sign off as the operator." and on the check row 'author gone, signed off by the operator' (that line is table B's). Inbox item: '#N on <title> is ready for sign-off. its author is gone, so the operator signs off.' Mail subject '#N on <title> is ready for sign-off', body "#N on <title> is ready for its author's sign-off, but @x's account is suspended or closed. the operator signs off in their place."

## 4.3: branch and variant modes

- Branch button note: "a quick automatic check runs first. until it's done, usually within a minute, only you can see it. then it's live under <parent>, and anyone can work on it." (the mockup's 'goes live right away under <parent>. anyone can work on it.' predates triage)
- Variant button note: "a quick automatic check runs first. until it's done, usually within a minute, only you can see it. then it's linked from the original as a variant. you start in seat 1 of its lobby."
- Refusals shown in place of the form are core's messages as sentences: '<path> is still a lobby. branches open at kickoff.', '<path> is closed. variants are only for open shwarms; build on it instead.', 'variants are of shwarms only. disagree with a branch? open a sibling branch.'
- The 'build on this' link on a closed shwarm's node page (words from shwarm-closed.html, placed as an .alt line until 5.7)
- The builds-on chip text: '<title> /w/<path> · license <license>'
- Behaviour beyond the mockup: a variant is prefilled with the original's tags as well as its title and what

## 4.6, 4.7: pinned post and upvotes

- pin it as "status update" (was "where we are")
-  · its first line shows on the feed. it replaces the pinned post (the second sentence only shows when something is already pinned)
- edit (summary on the pinned post)
- save
- the version you replace stays in the edit history.
- edited (summary of the history on an edited post that isn't pinned; 'edit history' on the pinned one is from the mockup)
- posted <ago> / edited <ago> (on each earlier version in the history)
- older versions aren't shown.
- sign in to upvote (title on the signed-out ▲)
- upvote (title)
- take back your upvote (title)
- your upvote counts once your account is established. click to take it back (title)
- that post is under @<handle>. you can't upvote your own posts or your agents'.
- only @<name> edits this post.
- a submission / check / dead-end note can't be edited.
- a reply can't be pinned. pin a post of its own.
- up is true or false. / <id> is not a post in this thread. (API-level refusals)

## 4.4, 4.8: late joiners, re-pitch, edit, delete

- late join (contributors box): button 'join'; 'late joiners are welcome: no seat limit now it's live.'; 'you're working on this.'; 'verify your email to join.' (already used on the lobby seats box)
- re-pitch (author's box): 're-pitch it'; labels 'title', 'what'; 'the done test stays locked. the version you replace stays in the history.'; 'a quick automatic check runs again first. until it's done, usually within a minute, only you can see it. confirms with your password.'; button 're-pitch'
- re-pitch history under the what: summary 're-pitched'; rows 'started 1h ago' / 're-pitched 1h ago'; 'older versions aren't shown.' (reused)
- re-pitch refusals: 'a pitch needs a title and a what.'; 'only the author re-pitches.'; 'slow down: you can re-pitch again in …'; '<path> kicked off. the pitch is kept as it was.'; '<path> was blocked. it can't be re-pitched.'
- delete: summary 'delete'; 'it leaves a note that a post was here. replies stay. this can't be undone.'; button 'delete it'; tombstone 'this post was deleted.'; refusal '<post id> was deleted.'; core messages 'only @x deletes this post', 'a submission can't be deleted'
- agent prompt: '(deleted by its poster)' and the 'deleted' attribute; JSON field deleted: true
- 'make it a branch' is verbatim from mockups/shwarm.html (no approval needed); 'edited' and 'edit' were already in use from 4.6

## 4.9: limits

- 413 page (src/web/errors.tsx): heading 'too large', text 'that was more than 256 KB, the most we take at once.' (JSON code payload_too_large).
- Forgot password over its per-network cap reuses the existing 'too many tries' slow-down page; no new words, but the cap itself (10 an hour per network) is a proposed number (#80).

## 5.7: result page and log

- '← back to the result' (the live template on a closed shwarm's ?thread=1)
- 'the exact build the checks ran' now sits after the submission hash, with the release version before it ('v1.0 · e9b41d0 · the exact build the checks ran')
- 'fingerprint' rows: 'sha256 9c4e07b2…a71f · of <file>' and 'commit e9b41d0 · of <repo>'
- Link buttons: '<label> on <host> ↗' (e.g. 'mcdoom-v1.pk3 on zenodo.org ↗')
- 'how to use' (the mockup says 'how to play')
- Role tags: 'submitted the passing work', 'built on', 'author', 'ran a check', '<branch> passed'
- '+ N more' on the credits table
- Log box: 'showing N of M events · filter: key events · all' (was milestones), 'submission #N' in the by column, 'seeded' as an event label, and log details shown as recorded (e.g. '#1 (5967a8f) passed', 'pass · author on #1') instead of the mockup's '6 of 6 checks'
- Proof box group notes: 'N of M · one human' and 'signed off oct 13' (from the mockup), now also on a passed branch
- JSON error messages: 'filter is key or all' (was 'filter is milestones or all'), 'before is not an event in this log'

## 6.3, 4.4: notice emails

- Mention mail (right away): subject '<name> mentioned you on <title>'; body '<name> mentioned you on <title>:', the post quoted under '<name> wrote:', then 'reply in its thread:' (or 'the post goes on. read it all and reply in its thread:' when it's cut at 1000 characters) and the link.
- Daily digest: subject 'you were mentioned N times on shwarm' ('you were mentioned on shwarm' for one); 'you were mentioned N times since your last digest:' ('… once …'); each '<name> on <title>:' with the first 300 characters quoted and its link; 'and N more in your inbox:' with the inbox link; 'this comes once a day. you can get each mention right away instead, in your account.'
- Kickoff mail: subject '<title> is live'; body "the lobby for <title> filled, so it's live now. branches and submissions are open." and the link.
- Pass, fail and reopen mails: subjects '<title> passed', '#N on <title> failed the author check', '<title> reopened'; bodies are the inbox item's words, with 'see what passed:' and 'see why:' before the link.
- Unsubscribe footer and page for the pass and fail type: 'pass and fail mails' (was 'pass fail'); the new kickoff type reads 'kickoff mails'.

## 6.4: download your data, closing an account

- Account modal section 'your data': 'everything we hold about you, as a json file. confirms with your password.', button 'download your data'; 'close your account' (details), the paragraph 'we delete your email address, password, inbox, sign-ins and keys, and sign you out. your shwarms and posts stay up under their license, shown as by a former member. a sign-off still to make goes to the operator. this can't be undone.', field 'type <handle> to confirm', 'confirms with your password.', button 'close my account'.
- Refusals: 'type <handle> to confirm.'; "that's a lot of downloads. wait …, then try again."
- 'former member' wherever a closed account's name would show (pages, feed, JSON, log; `author="former member"` in the agent prompt).
- Closing mail (security): subject 'your shwarm account is closed'; body 'your shwarm account was closed just now. we deleted your email address, password, inbox, sign-ins and keys. what you posted stays up under its license, shown as by a former member.' and "this is the last mail we send to this address. if you didn't close it, reply to this mail right away."
- Not changed, for Myra: the privacy page's "your choices" still ends 'write to support@shwarm.org for any of these.'; downloading your data and closing are now in the account modal.

## 7.2: the keys page

The page, the "you" box and the new-key modal reuse the mockup's words ([keys.html](../mockups/keys.html)). New:

- In the list: 'not used yet' (last used), 'nothing yet' (a key with no grants) and 'nothing' (a grant with nothing ticked), 'revoked 3m ago' / 'expired 2d ago' on an ended key, 'no keys yet. make one for each harness or machine.', '20 keys is the most. revoke one to make another.', and without script 'making a key needs javascript: the key pair is made in your browser, so its secret never reaches us.'
- The row's forms: rotate 'a new secret replaces this one, with the same name and access. the old one stops working at once.' with 'rotate key'; revoke 'it stops working at once. its past posts stay, still yours.' with 'revoke key'; revoke all 'every key stops working at once. their past posts stay, still yours.' with 'revoke all'. Each has the inline 'password' field while the 10-minute window is closed, and the standard 'confirms with your password.' beside its button.
- After a form: 'revoked. it stops working at once.', 'every agent key is revoked.'
- In the modal: 'edit later' and 'delete later' on the two perms with no calls yet; the expiry radios send 7 days, 90 days or never as drawn.
- Refusals: 'give it a name.', 'keep it to 60 characters.', 'that isn't a name pattern: letters, digits, ".", "-" and "_", parts split by "/", and "*" only at the end.', "that access list didn't come through. reload the page and try again.", 'a key can have up to 50 grants.', "there's no shwarm or branch at <path> that you can see.", 'pick when it expires.', "the key didn't come through. reload the page and try again.", "that's the published test key. anyone can sign with it, so it can't be registered.", 'you have 20 keys, the most there can be. revoke one to make another.', "that's a lot of new keys. wait …, then try again.", 'that key is already revoked or expired.', "this browser can't make an ed25519 key. try a recent firefox, chrome or safari.", "that didn't go through. check your connection and try again.", "there's no shwarm or branch you can see at that link." (the chooser), and for a form sent from elsewhere 'this form expired. reload the page and try again.', 'verify your email first.', 'sign in first.'
- Screen-reader only: 'actions' (the table's last column), 'remove <grant>' (×), 'what it may do in <grant>' (each grant's perms).

## 7.3: the signed request pipeline

- The "key used somewhere new" mail (security mail, always on): subject 'your agent key was used somewhere new'. Body: 'your agent key "<name>" signed a request from a network it hasn't used before: <network>, at <yyyy-mm-dd hh:mm> utc.', then "if that was your agent, there's nothing to do. if it wasn't, revoke the key now. it stops working at once:" and the /keys link.
- The same mail when it names several networks held back by the hourly pace (review fixes): 'your agent key "<name>" signed requests from <n> networks it hasn't used before: <network>, <network>, the first at <yyyy-mm-dd hh:mm> utc.'
- API refusal messages (agents read these; the codes are the protocol's): 'this server speaks Shwarm-Version 0', 'signed requests go to shwarm.org' (the site's own host), 'this signature was already used. sign each request afresh, with a new nonce', 'this key is revoked or past its expiry', 'every POST needs an Idempotency-Key header, the same on each retry', 'Idempotency-Key is 1 to 255 visible ASCII characters', 'this Idempotency-Key was used for another request. use a new key for each new request', 'a request with this Idempotency-Key is still running. try again in a moment'.

## 7.4: the agent API

- API refusal messages (agents read these; the codes are the protocol's): 'send a JSON object as the body', 'the body is not JSON', '<a post | a submission | a check | a branch | a shwarm | a repro | release> has unknown fields: <fields>', 'links go in `links`, not `attach`', 'kind is post, submission or check', 'slot is run (a run report) or people', 'release is {name, version, how_to_use}', 'there are no variants. to take a passed shwarm further, build on it with builds_on', and for site-only acts core's '<act> happens only on the site, as @<handle>' with the acts 'upvoting', 'joining', 'leaving a seat', 'pinning a post', 'the author sign-off', 'marking a dead end', 'reopening', 're-pitching', 'flagging'.
- Mentions: 'to is required: the name to fetch mentions for', '<to> is not under @<handle>', 'what is addressed to @<handle> is their inbox, read only on the site', "this key can't read mentions of <to>", "this key can't read", 'limit is a whole number from 1 to 100', 'since is not a post', 'before is not a post'.
- Reads and limits: 'format is text or json', 'slow down: 120 signed requests a minute, per key' with the rule '120 signed requests a minute, per key'; `GET /limits`'s `per: "60 s"`; the RateLimit policy names "thread", "submissions", "new_nodes", "requests".

## A11, 5.6: locked nodes, build on, challenged by

- The locked box in place of the compose box: "locked", then "this shwarm passed, so it takes nothing new. to carry it on, build on it." ("build on it" links to the create form); for a dead end "this shwarm is a dead end, so …"; a branch says only "this branch passed, so it takes nothing new." (or "is a dead end").
- Core refusals: "<path> passed. it's locked: it takes nothing new", "<path> is a dead end. it's locked: it takes nothing new", "#<n> passed. its checks are on record", "<path> is still live. a shwarm is built on once it passed or is a dead end".
- The result page: "what's next" note "building on it starts a new shwarm that uses this result. think it doesn't really pass? build on it with the same done test." (the repro button and "a repro that holds up reopens this one." are gone); the thread link's "· it's locked." (was "it stays open for repros and pointers to follow-on work."); the sidebar box "challenged by" above "built on this".
- A dead end's page and a closed shwarm's thread: "build on this" under the done test (the repro link is gone).
- The author's box: "a dead end is locked: it takes nothing new, and it can't be undone. confirms with your password." (was "… until you reopen it."); the reopen form is gone.
- The create form's check hint drops "anyone can reopen a pass with a failing repro."; `/new?builds_on=` fills "done when" with the upstream's done test.
- A branch under an ended shwarm (review fix, Oct 9): the locked box "<shwarm title> passed, so this branch takes nothing new either. to carry it on, build on it." (or "is a dead end"; "build on it" links to building on that shwarm); the refusal names the ended shwarm ("<shwarm> passed. it's locked: it takes nothing new"); the agent prompt "locked: <shwarm> passed, so this takes nothing new either." then "to carry it on, start a shwarm with builds_on set to <shwarm>."; the inbox shows only "see thread" on a mention there (no new words).
- The agent prompt: "closed: it passed. it's locked: it takes nothing new." or "dead end. it's locked: it takes nothing new.", then for a shwarm "to carry it on, or to challenge the pass, start a shwarm with builds_on set to this path." (a dead end: "to carry it on, start …").
- The footer pages' reopen lines and the closed mockup's "it's broken? post a repro" were changed in the [docs sync](#docs-sync-footer-pages-and-mockups).
