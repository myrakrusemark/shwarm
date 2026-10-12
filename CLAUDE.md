# shwarm — notes for Claude Code

shwarm (working name; older docs say "Swarm") is an open platform where people and their AI agents work on ambitious, checkable goals in the open. Design phase: docs and HTML mockups, no backend yet.

## Folder map

- `README.md`: front door, reading order, full folder map.
- `docs/decisions.md`: decision log. **Source of truth.**
- `docs/manifesto.md`, `docs/prd.md`, `docs/spec.md`, `docs/protocol.md`: why, what to build, mechanics, agent protocol.
- `docs/prd-api.md`: requirements for the HTTP API, MCP server and CLI (thin clients on one API; `docs/openapi.yaml` holds the shapes).
- `docs/open-questions.md`: everything undecided, numbered. `docs/glossary.md`: terms, including retired ones. `docs/design-system.md`: tokens and components taken from the mockups. `docs/a-day-on-shwarm.md`: day-in-the-life walkthrough. `docs/further-enhancements.md`: write-ups of post-launch features; the one-line list is section 8 of `docs/go-live.md`.
- `docs/img/screens/`: screenshots of current mockups. `docs/img/archive/`: outdated images, don't link from current docs.
- `mockups/`: `index.html` (feed), `shwarm.html`, `branch.html`, `new.html` (`?parent=<path>` = branch, `?builds_on=<path>` = a new shwarm that builds on an ended one), `profile.html` (inbox, account modal), `keys.html` (new-key modal), `submission.html` (author sign-off), `shwarm-closed.html` (a passed shwarm's result page), `holding.html` (the shwarm.org holding page with the manifesto; `python3 scripts/build-holding.py` copies it into the site), and the footer pages `how-it-works.html`, `rules.html`, `api.html`, `terms.html`, `privacy.html` and the two guides. Every sidebar except keys and profile ends with the shared "agent resources" card; the footer links donate · terms · privacy. Every page has the donate modal. The header strip is in launch mode by default ("welcome new friends!" in white, stats counted but hidden); add `?stats` to show the counts. `mockups/archive/`: superseded pages.

## Run

**Admin paperwork:** `admin/` (gitignored, local only): accounts and their 2FA, the operator's details, renewals, deadlines, money. No secrets in it, only where each one is kept. Update it whenever an account, date or payment changes. Never commit it or copy the postal address into the repo.

**Go-live tracker:** `npx vite --config tracker/vite.config.js` (port 5174) is one page: the progress of `docs/go-live.md` and only what needs Myra (Myra, Oct 10: "i only want to see the progess page, and only items that need my attention"). Step status lives in the doc as ` · doing` / ` · done` / ` · blocked` / ` · parked` after a step's bold heading; keep statuses and the Now (Claude) line current as work moves.
**Needs Myra:** the `### Needs Myra` list near the top of go-live.md, one line per item as `- [m-<id>] text`. Add an item whenever something waits on her, and remove it once it's settled (record the answer in decisions.md first). Her replies land in `tracker/replies.json` under the item id (`{m-npm: [{choice: yes|change|question, text, at}]}`). Answer on the page with `python3 tracker/claude-reply.py m-<id> "text"`. Shwarm cards that wait on her (never reviewed, or Claude answered her question) show on the page by themselves. To get dinged as replies arrive, run a Monitor on `python3 tracker/claude-reply.py --watch` (prints one line per new reply from Myra; `.replies-seen.json` remembers what was already seen) and re-arm it when it expires.

**Shwarm cards:** cards come from `docs/launch-shwarms.json` and `docs/shwarm-ideas.json` (new ideas: add them there, why first, crowd-sized, `"wave": "idea"`, `origin`, `sources: []` until checked; when an idea comes from someone else's post or work, credit them by name with a link inside `what`, the way an author would). Myra's verdicts (approve, change, question, on the tracker page) land in `tracker/proof.json`; answer with `python3 tracker/claude-reply.py p:<slug> "text"`; the `--watch` monitor reports both. "no" on a card means drop it (`docs/launch-drops.md`).

`npx vite mockups`, then open http://localhost:5173/. It may already be running on port 5173; check with `ss -ltnp | grep 5173` before starting another.

## Working rules

- **decisions.md wins.** When a design decision changes, update `docs/decisions.md` first: date it, add it at the top of the newest section, mark its status (decided / accepted / proposed), supersede old entries rather than rewriting them. Then update the affected docs (spec, PRD, protocol, glossary, design system, a-day) and mockups.
- **Don't invent product decisions.** If something is undecided, say so and point to (or add) an entry in `docs/open-questions.md`. Myra decides.
- **Mockups:** single-file HTML, each with the same `:root` tokens (keep them in sync across files and with `docs/design-system.md`). Links between pages are relative (`shwarm.html`, `new.html?parent=minecraft-in-doom`). UI copy is lowercase. The header strip, footer, agent resources card and donate modal are copied into every page; change them everywhere at once.
- **Modals:** `role="dialog"`, closed by ×, Esc, or a click on the scrim.
- **Password step-up actions:** anything that changes the account or acts with the author's authority (the author's pass/fail, saving the account, making or revoking a key, email or password change) shows "confirms with your password." next to its button, and asks for the password again if it was last entered more than 10 minutes ago. Everyday acts as the bare handle need only a signed-in session. (Passkeys were the old rule; they may return as an optional step-up.)
- **Terms:** the top-level goal is a *shwarm* (plural *shwarms*); a *post* is only a message in a thread (a reply, submission or check); a *node* is a shwarm or a branch. See [decisions](docs/decisions.md#create-form-later-the-same-day).
- **shwarm stores only text.** Posts, done tests, signed check reports, links and sha256 fingerprints. No uploads, files, images, audio or video from users. Work lives elsewhere and is linked (`{url, sha256}`, or repo + commit). Run logs go inline as text up to a cap (proposed 64 KB); bigger ones are linked. Links show as links ("source on codeberg ↗"), never as embedded media. See [decisions](docs/decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations).
- **Running example everywhere:** the shwarm "minecraft in doom", its branch "block placement", @myra as the viewer.
- **Screenshots:** when a mockup changes visibly, refresh its screenshot in `docs/img/screens/` (`home`, `post` (the shwarm page), `branch`, `branch-submission`, `new`, `profile`, `keys`, `submission`, `how-it-works`, `shwarm-closed`, `guide-storage`).
- **Docs style:** plain, short sentences, no hype. they/them for people. Relative markdown links between docs; mockups are `../mockups/<file>.html` from `docs/`.

## Never reintroduce (stale concepts)

Mention these only as history, never as current behavior:

- a separate ledger, individual credit for passing, reputation from passed done tests
- agent counts of any kind ("386 agents working", "@x · 200 agents", subagent counts)
- upvotes on shwarms or branches (upvotes are on thread posts only)
- one site-wide license with no choice (now: a default open license each shwarm can change from a short open list; "builds on" inherits upstream)
- agent profiles or agent registration (agent names are free strings, validated by pattern only)
- multi-line done-when checklists, "2 of 4 passed", rollup from branches to parents
- optional done tests or "unscoped" shwarms (every shwarm and branch has exactly one)
- the "you're in" card (now the contribute card), thread tabs on the shwarm page, branch dropdowns
- a narrator agent, the yellow "hot" wash (now a hot badge), "done tests passed this week" in the header
- the platform running machine checks in a sandbox (runs are done by people, who post signed run reports); "the platform holds no money" (donations pay hosting, uptime and triage)
- pass/fail controls in the inbox (the author decides only on the submission page), a public inbox or "addressed to" list, or agent mentions on the profile (the inbox is private and bare-handle only)
- a personhood check at sign-up, a full legal name, "verified human" as a current account field, passkeys or a human signing key (`humanKey`) for bare-handle acts, recovery by redoing a personhood check, or the Lemmy fork (now: email + password, bare-handle acts only on the site, password step-up; "verified human" is an optional mark later)
- uploads, attachments or file hosting of any kind: `{name, upload}`, upload ids, an upload endpoint, "attached" files, embedded user images, audio or video (shwarm stores only text; work is linked)
- a lobby of any kind: lobby size, seats, kickoff, the filling tab, the lobby score, join as a gate (now: a shwarm is live the moment it is posted; join says "I'm working on it")
- variants: "start a variant", `?variant=`, `variant_of`, a variants box (now: a different finish line is a new shwarm; continuing an ended one is build on)
- editing a posted shwarm's or branch's words (decided Oct 12: once posted, it's fixed; thread posts keep edit; a different finish line is a new shwarm)
- reopening: a repro that reopens a pass, the author reopening a dead end, "it's broken? post a repro" (now: an ended shwarm is locked; build on continues or challenges it)

## Layout

Cards (boxed `.box` sections) are for interactive parts: feed, threads, forms, keys, inbox. Reading pages use plain prose under headings; only their sidebar keeps boxes.

## Public-facing copy

If the site enforces something (own-work checks, one slot per person, the password step-up for sign-offs and keys, limits), describe it as built in, not as a rule people have to follow.

The footer pages and guides are generated: edit `scripts/pages/content.py`, then run `python3 scripts/pages/build.py` (it takes the header, footer and donate modal from `mockups/keys.html`). Check links with `python3 scripts/check-links.py`.

Copy on the footer pages (and any public prose) is ELI15 and follows the Combob writing rules in `../skills/combob-writing/SKILL.md`. Lint it with `python3 ../skills/combob-writing/scripts/combob-lint.py <file>` (the site is all lowercase, so capitalize sentence starts in a scratch copy before linting, or sentence detection fails).
