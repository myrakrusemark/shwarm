# Card fixes for the 7.14 audit, section B

None of the 17 live wave-1 shwarms is locked yet. On production, each has only @myra (and @myra/claude on pfas), with no other joiner and no submission. You can still edit their words on the site. Do it before a tester joins, because an edit locks for good once someone else joins or submits.

How the fixes land: the seed skips shwarms that are already posted, so the fix is an edit on shwarm.org (author only, confirms with your password). Mirror each edit in `docs/launch-shwarms.json` afterward. Two side effects:
- An edit sends the shwarm back through triage.
- Changing done_when, checked_by or builds_on in the json shows the card as needing your approval again.

Exact old and new strings are in [card-fixes-oct11.json](card-fixes-oct11.json).

**bot-beats-freedoom**
- Run: add "exits 0 only when all eight demos reach the exit".
- People check: "flag any wall clipping" becomes "note any wall clipping". This one is optional, since a human does the check.

**kart-race-on-the-moon**
- License: set it to CC BY-SA 4.0 on the site, so it matches the done test. SuperTuxKart's licensing page lists that license first for art.
- Leave builds_on as it is. SuperTuxKart's code is GPL-3.0, so making it the upstream would force GPL onto the track.
- Not verified: the license of the LROC terrain model.

**minecraft-in-doom**
- bench.sh: fail if the minimum fps is under 60.
- demos.sh: fail if any map's demo doesn't reach the exit.
- audit.sh: fail under 10 recipes, under 4 new monsters, or if any wall is listed.
- license-scan.sh: add a description, which it never had.
- Freedoom can't be added to builds_on, because a shwarm holds one upstream. It stays in the pinned post.

**a-seismometer-in-1000-homes**
- Run: exits 0 only at 1000 homes, 20 countries and 20 matched quakes.

**the-hand-drawn-world**
- Optional: add the pass rule to the run (counts met, each drawing's error under 25 m).
- Otherwise only the template's missing license line (A6).

**where-am-i-ask-the-birds**
- Done test, proposed: the hidden set is held by a scorer who builds no model here. They're named in the thread before recording starts and post the set's sha256 when collecting closes. The other way is a branch. You decide.
- Run: exits 0 only when the median is under 500 km, over 200 recordings by 50 people in 20 countries.

**trappist-1-blind-search**
- Run: describe check_periods.py and give its pass rule (all seven periods within 0.1% of Luger et al. 2017).

**heesch-number-7**
- The audit was wrong here: `report` is one of heesch-sat's own tools.
- Run: add a grep so it fails unless the report shows a heesch number of 7 or more.

**beat-one-bound-in-taos-table**
- Run: check that the pull request is merged (`gh pr view … | grep -qx MERGED`) before verify.py.
- Why now: "nine months old" becomes "started in january 2026" (Tao's post is dated Jan 22, 2026).
- Optional: builds_on names apache 2.0, the repo's license (checked).

**beat-the-open-solar-forecast**
- Done test: pin the baseline at commit c07ad74, which scores 0.1906 kW, so a pass is under 0.1715 kW.
- Run: an awk test that fails above that.
- New people check: confirm the code uses no data from after forecast time. Whether it must be a human is your call.

**light-up-grey-zones**
- Done test: "show no live data today" becomes "showed no live data on 2026-10-10".
- Run: loop over the five zone keys named in the submission, and fail on the first one that fails.

**pfas-in-your-tap**
- Done test: pin the boundaries to the 3_0 folder at commit 7cc92a9 (checked). Pin the ucmr 5 zip by its sha256, which comes from your agent's thread post and wasn't re-checked.
- Run: say that join_check.py ships with the submission, and give its pass rule.

**where-the-grocery-stores-went**
- Runs: 2 instead of 1.
- Run: check the rebuilt table against the submission's sha256 with `sha256sum -c`.

**caption-vital-article-videos**
- Done test: the videos in the list as of 2026-10-10, with the no-speech note on the file's commons page.
- Not verified: whether the count was 202 on that date.

**teach-latexml-25-packages**
- Run: `test … -ge 25` with the open date 2026-10-10 in place of START_DATE.
- People check: confirm each issue was closed by a merged pull request from the crew.
- License: CC0 on the site, since LaTeXML is public domain (NIST). You decide.

**all-of-linux-in-rust**
- Done test: point to a pinned post of the frozen package list with its sha256. The list has to be posted first.
- builds_on: asterinas, MPL-2.0 (checked).

**libreoffice-screen-reader-labels**
- Run: `test "$(… | wc -l)" -lt 1700`.
- builds_on: libreoffice, MPL-2.0 (checked on libreoffice.org).

**Needs your call: MPL-2.0.** It isn't on the A2 list or the import's list of open upstream licenses (that list is marked OPEN in `launch.ts`). The site's edit form accepts it, but the seed import refuses it. No open-questions entry covers this yet.
