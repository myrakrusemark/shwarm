# Wording to approve

New site wording from Oct 9 that no mockup had. Each line is live on staging. Mark changes inline or tell Claude; approved lines can be deleted from this list.

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

- pin it as "where we are"
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
- Log box: 'showing N of M events · filter: milestones · all', 'submission #N' in the by column, 'seeded' as an event label, and log details shown as recorded (e.g. '#1 (5967a8f) passed', 'pass · author on #1') instead of the mockup's '6 of 6 checks'
- Proof box group notes: 'N of M · one human' and 'signed off oct 13' (from the mockup), now also on a passed branch
- JSON error messages: 'filter is milestones or all', 'before is not an event in this log'

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
