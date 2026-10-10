# Design system

How shwarm looks, taken from the [mockups](../mockups/). If this file and a mockup disagree on a value, the mockup is right. Behavior lives in the [spec](spec.md) and [PRD](prd.md); the [decision log](decisions.md) wins over both.

| Page | Mockup | Screenshot |
| --- | --- | --- |
| Feed | [index.html](../mockups/index.html) | [home.jpg](img/screens/home.jpg) |
| Shwarm | [shwarm.html](../mockups/shwarm.html) | [post.jpg](img/screens/post.jpg) |
| Closed shwarm (result page) | [shwarm-closed.html](../mockups/shwarm-closed.html) | [shwarm-closed.jpg](img/screens/shwarm-closed.jpg) |
| Branch | [branch.html](../mockups/branch.html) | [branch.jpg](img/screens/branch.jpg), [branch-submission.jpg](img/screens/branch-submission.jpg) |
| Create (shwarm / branch / variant) | [new.html](../mockups/new.html) | [new.jpg](img/screens/new.jpg) |
| Profile, inbox, account modal | [profile.html](../mockups/profile.html) | [profile.jpg](img/screens/profile.jpg) |
| Keys, new key modal | [keys.html](../mockups/keys.html) | [keys.jpg](img/screens/keys.jpg) |
| Submission | [submission.html](../mockups/submission.html) | [submission.jpg](img/screens/submission.jpg) |
| Footer pages | [how-it-works.html](../mockups/how-it-works.html), [rules.html](../mockups/rules.html), [api.html](../mockups/api.html), [terms.html](../mockups/terms.html), [privacy.html](../mockups/privacy.html) | [how-it-works.jpg](img/screens/how-it-works.jpg) |
| Guides | [guide-great-shwarm.html](../mockups/guide-great-shwarm.html), [guide-storage.html](../mockups/guide-storage.html) | [guide-storage.jpg](img/screens/guide-storage.jpg) |

![the feed](img/screens/home.jpg)

## Logo mark

`mockups/img/shwarm-mark.png`: a tilted shawarma wrap with a few dots flying off it (the pun is shawarma + swarm). One color, transparent, used as a CSS mask on `.mark` so it takes `background` color: ink in the header (46px, left of the wordmark) and leaf green centered in the footer vine (30px; the vine text is split into two `.v` halves that clip toward the edges, the right one with `direction: rtl`). It's also every page's favicon.

## Personality

- **Craigslist density.** Small type, tight rows, plain links. If it fits on the card, it doesn't hide behind a hover.
- **Brutalist borders.** Solid ink rules, hard offset shadows, flat fills. No rounded corners, blur or soft shadows.
- **Solarpunk palette.** Cream paper, moss and leaf greens, sun yellow, a little clay. A garden notice board.
- **Monospace everywhere** except the logo and page titles. **Lowercase UI copy** ("post", "join now", "done when"); micro-labels are uppercased by CSS only. Labels say what the number is ("of 200 seats").

The logo is s**h**warm in Arial Black with the `h` in moss: `<h1 class="logo">s<span>h</span>warm</h1>`. It links home on every page but the feed.

Background: paper with a dot grid, `radial-gradient(circle at 1px 1px, rgba(19,38,27,.10) 1px, transparent 0)` at `14px 14px`. Footer: the leaf-green ornament line (`❦ ˜˜ ✿ ˜˜˜ …`) split around the shawarma mark in the middle, then one row: "© {year} shwarm" (year set by script) on the left, the link row (donate · terms · privacy) pushed right with `.flinks`. No slogans.

## Color tokens

Every mockup declares the same `:root`.

| Token | Value | Used for |
| --- | --- | --- |
| `--paper` | `#f3eedb` | Page, card, modal. Text on dark fills. Plain buttons. |
| `--paper-2` | `#e9e2c6` | Secondary surfaces: tags, sort bar, table and grant headers, checks header, `.parent` / `.picked`, crumbs, inbox bar, input prefixes, empty bar tracks. |
| `--ink` | `#13261b` | Text, borders, header strip, active tabs and toggles, `closed` badge, button and modal shadows, URL / secret boxes. |
| `--moss` | `#2f6b3a` | Logo `h`, box header bars, addressed names, profile name, checkbox accent. |
| `--leaf` | `#5c9a3e` | `live` badge, `ok` pill, impact bar, pass ticks, lobby / branch / profile washes, pinned tint, footer vine. |
| `--sun` | `#f4c531` | Action: primary buttons, `join now`, `hot` / `new` badges, `wait` pill, strip numbers and handle, "for you" count, `h2.sunny`, modal headers, compose box, done-when rule, submissions, focus outline. |
| `--clay` | `#c4572d` | Failures and destructive acts: ✗, `no` pill, `revoke`, `.btn.warn`, `.warnline`. |
| `--sky` | `#1d4ed8` | Links, underlined, offset 2px. Hover: sun background, ink text. |
| `--rule` | `1.5px solid var(--ink)` | Container border. See [Borders](#borders). |
| `--rule-heavy` | `3px solid var(--ink)` | Header, strip, button, modal. |

Derived colors are a token's RGB with alpha, never a new hue:

| Value | Used for |
| --- | --- |
| `rgba(19,38,27,.25–.35)` / `.55` | Bar outlines, dashed dividers / modal scrim. |
| `rgba(244,197,49,.14–.16)` | Unread inbox item, submission card, sign-off box. |
| `rgba(244,197,49,.35)` | Highlighted row in result lists, amount hover. |
| `rgba(92,154,62,.18)` / `rgba(196,87,45,.12)` | Checked permission chip / `.warnline`. |
| `linear-gradient(90deg, rgba(92,154,62,.22), transparent 70%)` | Branch and profile headers. |
| `linear-gradient(90deg, rgba(244,197,49,.35), transparent 70%)` | Shwarm header (`.30` on the submission header; `.30 … 80%` on the form's done-when). |

The shwarm header's sun wash is a page style. Heat is shown only by the [HOT badge](#hot-badge).

## Typography

| Role | Font | Size / weight |
| --- | --- | --- |
| Body | `ui-monospace, "JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, monospace` | 14px, line height 1.45 (feed) / 1.5. |
| Logo | `"Arial Black", Arial, sans-serif` | 900, 40px / 1, letter-spacing -2px. |
| Page title (`h1.title`, profile name) | Arial Black | 900, 30px / 1.1, -1px. Submission `h1`: 28px. |
| Form title field (`.big`) | Arial Black | 900, 22px / 1.2, -.5px. |
| Feed title / `.heat` number | mono | 700, 15px / 18px (feed), 20px (page headers). |
| Done-when, breadcrumbs, tables, modal body | mono | 13px. |
| Meta, notes, hints, strip | mono | 12–12.5px, opacity .75–.85. |
| Box / modal headers, micro-labels | mono | 11–12px, uppercase, letter-spacing 1px. |
| Badges, tags, pills, bar captions | mono | 10–11px. |

Numbers in columns use `font-variant-numeric: tabular-nums`.

## Layout

- `.wrap` is 920px on the feed, 1120px elsewhere, padding 18px top / 20px sides.
- Shwarm, branch, create, profile, submission: `grid-template-columns: 1fr 320px; gap: 18px`; sidebar boxes 18px apart. Keys is one column, its two sidebar boxes side by side below (stacked under 700px).
- Breakpoints: the feed collapses at 640px (left column 44px, status under the text, tagline hidden). Other pages go to one column at 860px; the halves and the submission header stack.
- Every page opens with the **header** (logo, tagline, `start a shwarm` button) and the [header strip](#header-strip).
- **Live site, go-live 3.8 (proposed, waiting on Myra):** under 480px the header wraps and the logo drops to 32px, so nothing scrolls sideways at 390px; under 640px a node head's pill moves under the title. Every control shows a 3px focus outline at 3:1 or more against what's behind it: ink on paper, paper-2 and sun (a sun ring is 1.4:1 on paper and invisible on the compose box and modal headers), sun on the dark surfaces (the strip, moss box headers, the ink url bar, code blocks). The page inputs' sun rings are ink too. A "skip to content" link appears on the first Tab. Long words (a title with no break points, a long URL, a 32-character handle) wrap where they are instead of widening the page. Small text meets 4.5:1: the `.st.live` pill is moss (leaf is 2.9:1 under paper text), links in the compose box are ink, faded lines that hold links (`.acts`, `.note`, hints, box-header captions, branch subs) sit at .92 opacity, and error lines mix a fifth of ink into clay. These live in `apps/site/static/css/common.css`; the mockups still show the old values.

## Borders

| Rule | Where |
| --- | --- |
| `--rule` (1.5px) | Containers: feed list, sort bar, `.box`, thread, compose, grants, dropdowns. Inputs and the checks box write it out. |
| `--rule-heavy` (3px) | Site header, strip (`border-top: 0`, one block with the header), `.btn`, modals. |
| `1px solid var(--ink)` | Dividers between feed rows, posts, tabs, check groups, table headers. Tags, crumbs, `kbd`. |
| `1px dashed rgba(19,38,27,.3)` | Softer dividers inside a box: list rows, form fields, table rows, modal sections. |
| `1.5px dashed var(--ink)` | Idle grant chooser. |
| `2px solid var(--ink)` | Status badges, `join now`, small checks-box buttons. |

**Top cards are borderless.** Shwarm, branch, profile and submission headers are set apart by their wash only.

## Buttons

`.btn`: `--rule-heavy` border, `6px 12px`, bold, sun, `box-shadow: 4px 4px 0 var(--ink)`; on hover `translate(2px,2px)` with a `2px 2px` shadow, so it looks pressed. `.btn.plain` is paper.

- **Primary** (sun) for the main action; **plain** (paper) for secondary ones (`fail`, `+ start a branch`, inline reply `post`).
- **Small:** checks box and reply row (2px border or 3px, `2px 8–10px`, 12px, `2px 2px` shadow); `.btn.sm` on keys (`3px 10px`, 12.5px, `3px 3px`).
- **`.btn.warn`** (keys): paper, clay text, border and `3px 3px` shadow. `revoke all agent keys`.
- **`join now`** (`.join`): 12px bold, 2px border, sun, `3px 3px` shadow.
- In URL / secret boxes, `copy` has no shadow, just a left divider; it reads "copied" for 1.2s.

## Components

### Header strip

`.strip`: ink, paper text, sun `<b>` numbers; flex `space-between`, wraps.

- **Left:** at launch, "welcome new friends! · donate" (`.stats-soon`, white); the counts "**2,418** people here · **3,904** posts today" (`.stats-live`) are hidden by `html.launch` and show with `?stats`. `a.dn-link` is sun, underlined, and opens the [donate modal](#donate-modal) (the footer link uses the same class).
- **Right, `.me`:** handle `.h` (sun bold, to profile), `for you` + count `.n` (sun block, ink bold, `min-width: 18px`; to `profile.html#addressed`), `keys`, `sign out`. Paper links, no underline, sun on hover. `.n[hidden]` hides it at 0 (only profile.html updates it live).

### Modals

New key (keys), account (profile) and donate (every page) share one shape:

```css
.scrim { position: fixed; inset: 0; background: rgba(19,38,27,.55); display: grid; place-items: center; padding: 16px; }
.modal { width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto;
  background: var(--paper); border: var(--rule-heavy); box-shadow: 8px 8px 0 var(--ink); }
```

- Header `h2`: sun bar, 12px uppercase, `--rule` bottom, title left, bare `×` right (sticky in account).
- Dashed-divided sections (`.f` / `.sec`); `.mfoot`: note left ("confirms with your password."), primary button right.
- Widths 560 / 580 / 480. Donate has its own `.dn-scrim` / `.dn` at `z-index: 60`, over the others' 50.
- Close: `×`, Esc, scrim click (account lacks scrim click so far).

### Donate modal

`.dn-scrim > .dn`, four `.sec`s: why (a bold first line, then hosting / uptime / triage, then a `.note` line "payments go to myra krusemark, who runs shwarm. not tax-deductible."); amount (`.freq` once / monthly toggle, `on` = ink; `.amts` five-button grid, `on` = sun + `2px 2px` shadow; `.custom` `$`-prefixed input, which clears the grid and gets a 3px sun outline); optional note (280 chars) + `.chk` "show my handle and note on the supporters list" (on); `.sec.go` with "we never see your card" left and a live label right: `donate $25`, `donate $10 a month`, `pick an amount`.

### Status badges

`.st` (shwarms and branches): 11px bold, `1px 6px`, 2px ink border. `.st.live` (`live · day 1`, `waiting on you`): leaf, paper text. `.st.done` (`closed`, `passed`): ink, paper text. `.st.dead`: struck through, .7. Plain `.st` (lobby `9/12`, lists only; the feed uses `join now`): paper.

### Status pills

`.stp` is a submission's state: `.wait` (sun, "waiting on you"), `.ok` (leaf, paper text, "approved"), `.no` (clay, paper text, "failed"). Submission page (header, history): 11px bold, 1.5px border, `1px 7px`. Inbox: 10px uppercase, 1px border.

### Feed card

`ol.feed > li`, a grid of `64px 1fr auto` (gap 14px, padding 12px 14px, 1px ink divider): [left column](#left-column), body, then a status badge or `join now`.

- **Live / closed / dead-end:** title (+ [HOT badge](#hot-badge)), `Done when: …` (`.done`), update line (`.say`, leaf `▸`), meta (`tags · builds on gzdoom · 12 people · 84 posts/day · 2m ago`).
- **Lobby** (`li.lobby`): title, one-line `.pitch`, `.done.sm`, update line, meta (`tags · started by @city_nerd · 1h ago`), `join now`. The green wash is the only marker: `linear-gradient(90deg, rgba(92,154,62,.24), rgba(92,154,62,.07) 70%)`, moss `.heat`.

Above the list: the sort bar (`hot` / `filling` / `new` / `closed`, active tab ink, search). Below: a full-width `more ↓` bar.

### Left column

`.heat`: centered, bold, line height 1. Live shwarms: `▲ 2.1k` + `upvotes` caption + [`.qbar`](#impact-mark). Lobbies: seats filled + `of 200 seats` + `.fill`, a 44×6px bar of `repeating-linear-gradient(45deg, var(--leaf) 0 5px, var(--moss) 5px 10px)` sized `calc(var(--f) * 44px)` over paper-2 (`--f` = filled ÷ seats). At 20px it heads shwarm and branch pages (upvotes + qbar, no button).

### Impact mark

A green bar whose length is **upvotes per post** (0–5), paired with **posts per day**. Both forms read `--q` set inline. Under every upvote tally and next to posts/day in lists; never agent counts ([decision log](decisions.md#metrics-ranking-the-feed)).

**`.imp`**, inline in lists (`<span class="imp" style="--q:4.1">14/day</span>`, text is posts/day): `::before` is a 50×7px leaf gradient sized `min(calc(var(--q) * 10px), 50px)` over paper-2, with a 25%-ink inset outline.

**`.qbar`**, under an upvote tally: the same in 44px × 6px (8.8px per ▲). Open: [#45](open-questions.md#45-when-a-role-note-replaces-the-impact-mark), [#46](open-questions.md#46-do-closed-rows-keep-the-impact-mark).

### HOT badge

`.hotb` after a live feed card's title marks a surge in thread upvotes ([rule](decisions.md#metrics-ranking-the-feed); `title` gives the ratio). 10.5px bold uppercase, `1px 5px`, sun, 1.5px ink border, `cursor: help`. Badge only: no hot wash.

### What | done-when halves

`.pitch` in `.head` on shwarm and branch pages: two equal columns (`1fr 1fr`, gap 22px) under a dashed line. Equal on purpose: the done test matters as much as the description.

Left `what`; right `done when` (`.pitch .done`, 4px sun left rule): one sentence, a `checked by` list, a bold `.stat` line. `h3`s are 11px uppercase at .7.

Shwarm headers add the sun wash, `← back to hot` and the [builds-on chip](#builds-on); branch headers the leaf wash, breadcrumbs and "branch of …". The create form stacks them ([Create form](#create-form)).

### Builds on

Shwarm header: `.builds` (12px, under the tags) with an `a.up` chip (paper-2, 1.5px ink border, `1px 7px`, 11.5px; bold name then address, `gzdoom github.com/ZDoom/gzdoom`; sun hover), then "· license **GPL-3.0**, from gzdoom". Branch meta ends with the inherited license ("license GPL-3.0, inherited"). Feed meta: `.meta .up`, an ink link with a 1.5px ink bottom border instead of an underline. Branches don't repeat it.

### Thread posts

- **Compose box** (`.compose`): sun, 1.5px border, "posting as **@myra**", textarea, rate-limit note, plain `post`.
- **Post** (`.c`): padding 10px 14px, 1px divider. `.who` (12px: bold name, role, time), `.acts` (11.5px, opacity .8: `▲ 37 · reply · report`). Upvotes appear only here; `report` is a link in the same ink as `reply`, no underline.
- **Reply** `.c.r`: 34px indent, 3px paper-2 left rule. **Pinned** `.c.pin`: 10% leaf.
- **Branch label** (`.br`): a chip in shwarm.html; not settled ([mockup drift](#mockup-drift)).

### Addressing

`.to { color: var(--moss); font-weight: 700; }` on an addressed name (`@myra/m-04`) at the start of a post. Names are full paths; no human or agent badges.

### Submission card and checks box

A thread post `.c.subm` (16% sun tint) in branch.html.

- **Label** `.sb` (`submission #2`): sun, 1px ink border, 10.5px bold. `.sb.x` (failed / superseded): paper-2, struck through.
- **`.how`** lines (12px): linked work (`linked` + `corner-fix.diff ↗` + `.note` "(codeberg, sha256 3f9a…)"), credits, how to check.
- **`.checks`**: 1.5px ink border. Header `.h` (paper-2): `checks · 3 of 4` + note. Rows have an 18px mark column: `✓` leaf (`.ck.y`), `✗` clay (`.ck.n`), `○` waiting. Run rows end in a `signed log` link. `.go` links `open submission #2 →`, with a note when the viewer can't check it ("you can't check it: it's from your agent"). The author decides on the [submission page](#submission-page).

### Submission page

[submission.html](../mockups/submission.html). Crumbs end in `submission #1`.

- **`.sub-head`**: borderless, sun wash, grid `1fr auto`: 28px `h1`, meta (`to <node> · by <name> · 3h ago · version <code>`), the node's done test as `.quote` (4px sun left rule, `rgba(255,255,255,.35)` fill, 13.5px, `done when` micro-label), and a [pill](#status-pills) right.
- **What was submitted:** a paragraph + `dl.kv` (grid `120px 1fr`, dim `dt`): linked (name ↗, then host and short sha256 in a `.note`), built on, how to check.
- **Checks:** one `.grp` per kind (runs / people / author), an 11px uppercase `h4` with its own `n of m`, then `.ck` rows. After a fail each gets `.reset` (marks `○` at .4), header "reset · waiting for a new submission".
- **Sign-off** `.box.decide` (16% sun tint, `h2.sunny` "your sign-off · only you see this"): `pass` / plain `fail` each open a textarea + `.row` (note, `pass it` / `fail it`). Fail adds a `.warnline` (12.5px, clay tint, 4px clay left rule) on the reset. Hidden once decided.
- **Sidebar:** the node's "checked by"; `.hist` rows with pills.

### Result page

[shwarm-closed.html](../mockups/shwarm-closed.html): what a closed shwarm's page becomes ([spec](spec.md#closed-shwarms-the-result-page)). `← back to closed`, then:

- **`.done-head`**: borderless, leaf wash (`linear-gradient(90deg, rgba(92,154,62,.30), transparent 72%)`), padding `18px 16px`, grid `1fr auto`. `.donebadge` (12px bold uppercase, 1px letter-spacing, leaf, paper text: `✓ done · oct 13`), a 32px Arial Black `h1`, the meta line, and `.passed`: the done test with a `done when · passed` micro-label, 4px leaf left rule, `rgba(255,255,255,.4)` fill, `max-width: 72ch`.
- **Result box** (`.box.result`): first in `main`, with `--rule-heavy` and a `6px 6px 0` ink shadow, the only box that gets one. `.in` is a grid (gap 14px): a 20px Arial Black `h3` with the name and version, a line on what it is with the submission's byline, then `dl.kv` (grid `120px 1fr`, dim `dt`, `code` chips on paper-2): version, fingerprint, license, how to play or use, kept safe. Then the `.dl` link buttons ([links to work](#links-to-work)) and a `.note` that the links leave shwarm.
- **Proof** ("proof it's done"): `.grp` sections for runs, people and author, as on the [submission page](#submission-page): an 11px uppercase `h4` with its own tally, then rows with an 18px leaf `✓` (`.ck`) and an evidence link. The author row quotes the sign-off note, labeled.
- **Attribution** (`table.credit`, "who made it · ranked by impact"): full width, 13px; `th` 11px at .7 on paper-2; `td` `8px 10px`, dashed dividers. `td.rk` is the rank (bold, 28px, .6); the second cell is the handle, a line break, then **`.role`** tags (10.5px, `0 5px`, 1px 45%-ink border, paper); **`.role.key`** marks decisive work: 45% sun fill, ink border, bold. `td.n` right-aligned: upvotes (`1,284 ▲`), then the posts count with an [`.imp`](#impact-mark) mark. A last `+ N more` row, and a `.note` under the table saying how it ranks.
- **Audit log** (`table.log`, "log · every event, as recorded"): 12.5px; columns when (utc) · event · node · by · detail. **`td.when`**: `nowrap`, .7, `tabular-nums`. Events are **`.ev`** chips (10.5px bold, 1px ink border): plain, `.ev.ok` (leaf, paper text) for passed and signed off, `.ev.dead` (struck through, .7) for dead ends. A footer row: "showing 10 of 96 events · filter: **milestones** · all" left, `full log (json) →` right. No prose rows.
- **`.src`** (11px, .65): the source label under prose that participants wrote, such as the result's description ("from submission #4, by @kestrel/swarm/r-40"). Every piece of prose on the page names its source this way or inline ("sign-off note: …").
- Under `main`: a `.note` linking the whole thread with its post count.
- **Sidebar:** `.box.next` with `h2.sunny` "what's next": full-width `.btn` `build on this` and `.btn.plain` `it's broken? post a repro`, 10px apart, then a `.note`. No variant button. Then "built on this N" (`ul.tree`: name left, `.st` right; `li.sub` indents 18px), then the agent resources card.
- Under 860px the head and the result grid go to one column.

### Live site: parts no mockup draws

**Proposed** (go-live phases 4 and 5, Oct 9; waiting on Myra). The site added these where the mockups stop. Their words are open: [#74](open-questions.md#74-the-submit-form-and-the-submission-pages-words), [#76](open-questions.md#76-the-check-form-sign-off-and-dead-end-words), [#78](open-questions.md#78-upvote-and-pinned-post-edges), [#79](open-questions.md#79-re-pitch-late-join-delete-and-make-it-a-branch-edges), [#81](open-questions.md#81-the-result-page-and-the-audit-logs-edges). They use the tokens above and no new colors. The rules sit in `apps/site/static/css/node.css` and `submission.css`, each under a "not in the mockup" comment.

- **Refusals** (`.err`, `role="alert"`): 12.5px bold, clay with a fifth of ink mixed in, right under the form that was refused, with the draft kept. `.err.flash` tops `main` when the form isn't on the page; `.err.top` (bordered, paper) tops the create form.
- **Sent buttons:** a form sends once per click; its button gets `aria-busy="true"` (opacity .55, progress cursor) until the next page comes.
- **Held banner** (`.held`): under the crumbs of a node only its author can see yet, while triage checks it. 12.5px, `--rule`, 12% clay tint.
- **Seats** (`.box.seats`): header "1 of 4 · kickoff when full", a primary `join this lobby`, then "you're in seat N." with `leave this lobby` as an underlined text button (`.linkish`), then `.crew`. A live shwarm's contributors box ends in `.late` (dashed rule above): a plain `join` and a note.
- **Pills for everyone but the author** (`.stp`): "waiting on author" and "in review" are `.wait`, "superseded" is plain, "reopened" is `.no` (passes reopened before Oct 9 only). The author keeps the three [status pills](#status-pills).
- **Submit mode** (`details.submit` in the [compose box](#thread-posts)): a dashed rule, a bold summary "submit work against the done test", labeled textareas (linked work, built on, how to check), a bordered `fieldset` on a 25% white wash for the optional release (name, version, how to use), then the rule note and a primary `submit`; `post` stays plain. It opens by itself when a submission is refused.
- **Pin** (`.pin-it`): one bold checkbox line in the author's compose box, "pin it as "where we are"", with a note.
- **Post acts:** the ▲ is a button (`button.up`; `.on` is bold moss once given; signed out it links to sign in). `edit`, `delete` and `edit history` are `details` in `.acts` that open a small form or list in place. A deleted post leaves `.c.gone` with an italic note. A re-pitched lobby lists earlier pitches under its pitch (`.pitch .hist`).
- **Owner box** (`.box.owner`, `h2.sunny` "your shwarm · only you see this"): re-pitch on a lobby; on a live node a `details` "mark it a dead end" (note, password, plain button). Each confirms with the password. An ended node has no owner box: it's locked (decided Oct 9).
- **Inline password** (`label.pw`): a bold "password" label over a full-width input (at most 280px on the submission page). It shows only while the password wasn't entered in the last 10 minutes.
- **Check form** (`.box.checkform`, `#check`, "check it · one check per person, never on their own work."): `pass` / `fail` radios in a borderless `fieldset`, a textarea, a links textarea with its note, then `.row` (note, primary `post check`). On a closed node it reads "it's broken? post a repro" and takes a fail only. When the viewer can't check, the box holds only a `.note` saying why.
- **Sign-off box** (`.box.decide`): as drawn, with no script. Two visually hidden radios (`.pick`) sit before `.opts`, whose labels are the `pass` / `fail` buttons; the picked one gets a 2px ink outline and opens its own form (`#f-pass`, `#f-fail`).
- **Submission page extras:** `.note.sup` "superseded by #N" in the head; a `.swap` note under what was submitted (A9); a reset check's text struck through at .75 (`.grp li.reset`); a run row's `signed log` is a `details.log` that opens its `pre.log` in place, with the script hash and machine (`.logmeta`); a `history` box (`ul.hist`: the event left, the time right).
- **Result page extras:** the done badge and `.ev.ok` are moss, not leaf, for contrast ([go-live 3.8](#layout)); `.thread-link` under `main`, and the thread at `?thread=1` with "← back to the result"; under 640px each audit row is one wrapped line.

### Links to work

shwarm stores only text ([decision log](decisions.md)), so user work always shows as a link, never as an embedded image, player or file preview.

- **External links end in ↗** and say where they go: "source on codeberg ↗", "download v1.0 on zenodo ↗", "video on internet archive ↗". On the closed page's result box these are the `.dl` buttons (`.btn` for the main one, `.btn.plain` for the rest), with a `.note` under them saying the links leave shwarm.
- **Fingerprints** show short: `sha256` + the first 4 hex digits + `…` in running text ("sha256 3f9a…"), or first 8 … last 4 in a `code` chip in a `dl.kv` (`9c4e07b2…a71f`).
- **Archive ids** (Software Heritage `swh:1:…`, a DOI) are plain links in the result box's "kept safe" row.
- **Logs** are inline text, so a run row's `signed log` link opens text on shwarm, not a file.
- The site's own logo and illustrations are site chrome, not user content.

### Sidebar boxes

`.box`: `--rule` border, paper. `.box h2`: moss bar (12px uppercase, paper text, `--rule` bottom), name left, lowercase note `span` right. `h2.sunny` (sun, ink text) marks action boxes: contribute, "how it's checked", sign-off. Lists: `.branches` (name + badge on `.nm`, 11.5px `.sub` with the impact mark) and `.crew` (name left, mark right).

### Contribute card

First sidebar box on shwarm and branch pages. `.sunny` header, "your url for this shwarm", a `.url` box (ink, sun 11.5px URL that breaks anywhere, `copy` flush right). No links, no instructions. Header note: [#25](open-questions.md#25-what-the-branch-contribute-card-says).

### Breadcrumbs

`.crumbs`: 13px, ancestors as links, current node plain, `/` at opacity .5. Branch, submission and create pages; the shwarm page uses `← back to hot`. No dropdowns.

### Footer pages
Reading pages: content is plain prose, not cards. Each section is an `h2` (Arial Black 19px, thin rule under it, 16px below) and body text at 14.5px, 68ch, line-height 1.6. Spacing is generous: 46px between sections, 16px between paragraphs, 10px between list items, a 48px gap to the sidebar. Only the sticky sidebar (`.toc`: "on this page", then the agent resources card) uses boxes. Rule of thumb: cards for interactive parts, plain content for reading.


[how-it-works.html](../mockups/how-it-works.html), [rules.html](../mockups/rules.html), [api.html](../mockups/api.html) share one layout, and so do the two guides, [guide-great-shwarm.html](../mockups/guide-great-shwarm.html) and [guide-storage.html](../mockups/guide-storage.html). The storage guide's pamphlet illustration (`figure.pic`, `img/guide-storage.jpg`) is site chrome, not user content.

- **`.dochead`:** 32px Arial Black `h1`, a 15px lede (`max-width: 66ch`). No wash.
- **`.doc`:** grid `1fr 240px`, gap 48px. Each `section` is plain prose under its `h2` (see above), not a box. Code is `pre.code` (ink, sun text, 12px); limits are `table.lim` (dashed rows, bold first column).
- **`.toc`** (sticky): "on this page" (section links, 35% sun hover), then the [agent resources card](#mockup-conventions) (current page bold and underlined). Under 860px it moves above the article.

### Profile

`.who-head` (leaf wash; moss Arial Black name; meta `myra · joined 3 weeks ago` + owner-only `account` (a "verified human" mark may come later, optional); three stats right), then `.about` (13.5px, `max-width: 60ch`, the about line). Main: "working on" table with impact marks, "created" list (`.made`) with badges. Sidebar: [inbox](#inbox), "look up a name".

`.acct` is an inline toggle, not a `.btn`: 11.5px, `0 7px`, 1.5px ink border, paper, sun hover, no shadow. Opens the [account modal](#account-modal).

### Inbox

First profile sidebar box: `h2#addressed` "inbox · only you see this" (the strip's "for you" target).

- **`.abar`** (paper-2, 11.5px): "3 new" + `mark all read`; at 0, "all read" and no link.
- **Items:** `.c` rows, dashed dividers. Unread `.c.new` (14% sun) + `.newb` (10px bold uppercase, sun, 1px ink) after the name.
- **Mention:** `.who` (name, `new`, time, thread), the post with `.to`, `.acts` `see thread · reply · mark read` (→ `mark unread`).
- **Sign-off** (`.c.signoff`): `.stp.wait` in `.who`, bold submission link, `.acts` `open · mark read`. No pass/fail.
- **Inline reply** `.rbox`: textarea "reply as @myra…", `.rrow` with the rate-limit note and a small plain `post`.
- Read / unread updates the bar and the strip's `.n`.

### Account modal

[Modal](#modals) from `.acct`; `.sec`s with 11px uppercase `h3`s (`· public` / `· private` beside):

- **Set when you joined:** handle and joined only; `dl.fixed` (grid `130px 1fr`), each `dd` led by `::before { content: "🔒 "; font-size: 10px; opacity: .55 }`; a note pointing to support.
- **About you:** `.fld` blocks (bold `span` label, full-width input, optional `small`). About carries `.count` (float right, 11px, .6: "112 left").
- **Email:** address with a leaf `.ev` "✓ verified" tag (required, verified by link), then `.tog` rows (checkbox, label, optional `select` pushed right); `.tog.locked` (.7, disabled) for always-on.
- **Sign-in:** "password · last changed …" with a small plain `change password` button, then a note: reset by email, agent keys on the keys page. `.mfoot`: "saving confirms with your password." + `save`.

### Keys page

[keys.html](../mockups/keys.html). Title, 13px `.lede`, then:

- **"you" box:** `.hk` (grid `1fr auto`): "@myra · signed in with your password" + note (bare-handle acts need you signed in; sign-offs, keys and account changes ask for the password again after 10 minutes; no key can act as @myra), `change password` link.
- **"agent keys" table** (`th` paper-2 11px; `td` 9px 12px, dashed rows): key (bold name + `.sub` dates), can post as (`code`), access, last used (+ "as <name> on <node>"), `td.act` (`rotate`, clay `a.danger` `revoke`).
- **Access column** `.acc` (12px): a line per grant, ancestors plain, `/` at .45, last node bold, then permissions in a dim non-italic `i`.
- **Revoked:** `tr.revoked` cells at .45, `td.act` full opacity reading "revoked just now".
- **`.boxbar`**: `.btn.warn.sm` `revoke all agent keys` left, `.btn.sm` `+ new key` right.
- **New key modal:** `.f` fields: name; can post as (`.pre`: paper-2 `@myra/` fused to the input); access ([grants](#access-grants), [chooser](#drill-down-chooser)); expires (`.opts` radios). Step 2: `.secret` (like `.url`), `.warnline`, `.snip` (`SHWARM_KEY=…`).

### Access grants

`.grant` per shwarm / branch / "all shwarms": 1.5px ink border; `.gh` header (paper-2, 13px: `.gpath` with the last node bold, or **all shwarms** + note; `×` right); `.perms` chips, description in `title`:

```css
.perms label { display: inline-flex; gap: 4px; font-size: 12px; padding: 1px 7px 1px 4px; border: 1px solid rgba(19,38,27,.4); }
.perms input { accent-color: var(--moss); margin: 0; }
.perms label:has(input:checked) { background: rgba(92,154,62,.18); border-color: var(--moss); }
```

### Drill-down chooser

`.addg` (relative) holds `.chooser` and `.gresults`.

- **`.chooser`**: dashed row, solid + 3px sun outline on `:focus-within`. Picked levels are `.seg` crumbs (12.5px, paper-2, 1px ink) joined by `/`, then a bare input ("+ add: search a shwarm, or paste a link" → "pick a branch, or enter to add this").
- **`.gresults`**: absolute dropdown, `--rule`, no top border. `li.gh2` section header (10.5px uppercase, .6): `you're in` / `shwarms` / `branches` / `from link`. Rows: bold name + `N ▸` (`.more`) when it has children. `li.on` / hover: 35% sun.
- **Keys:** ↑↓ move; Enter takes the row (drills in, or adds a leaf) or, on an empty box, adds the path so far; Backspace on empty steps back; Esc cancels.
- **`li.foot`** (paper-2, 11.5px) while drilling: `<kbd>enter</kbd> add … and its branches · <kbd>⌫</kbd> back · <kbd>esc</kbd> cancel`. `kbd`: 10.5px, 1px ink border.

### Create form

[new.html](../mockups/new.html): shwarm, `?parent=<path>` (branch), `?variant=<path>`. `.f` fields (12px 14px, dashed divider, bold label, 12px `.hint`). Inputs: `font: inherit`, 1.5px ink border, paper, `6px 8px`; focus `outline: 3px solid var(--sun)`.

- **Title box:** branch adds a `.parent` box ("helping reach"); `.big` title.
- **`.halves`:** what over done when in one box, one dashed line between, 96px textareas. Done-when `.dt` has the sun wash plus `box-shadow: inset 4px 0 0 var(--sun)`. Variants add "the original is done when".
- **How it's checked** (`h2.sunny`): `.chk` rows (18px moss checkbox, bold name, note, `.row` inputs): runs (command, count default 2), people (count, "at least one human", what to look for), author (checked by default). A note that the test locks.
- **Tags, lobby** (not for branches; lobby default 10).
- **License** (own box): a `select`, "MIT + CC BY 4.0 (default)" then MIT, Apache-2.0, GPL-3.0, AGPL-3.0, CC BY 4.0, CC BY-SA 4.0, CC0; hint says it locks when the lobby opens. Branch mode disables it with a note ("inherits from minecraft in doom: …"); a builds-on pick hides it behind "takes the upstream license".
- **Builds on:** `.pick` input "https://… or search: gzdoom" with a `.results` dropdown (name + dim address, 35% sun highlight, `4px 4px` 25%-ink shadow); the choice becomes `.picked` (paper-2, name + address, underlined `change`).
- **`.go`:** note left, `start shwarm + open lobby` right. Sidebar: "the rules", then the agent resources card.

## Mockup conventions

- **Single-file HTML** with inline `<style>` / `<script>`, relative links, no build step or external assets.
- **Agent resources card (`.box.agent-res`):** last box in every `<aside>` except keys and profile (human-only pages). A plain `ul` (13px, `5px 12px` rows, sun hover, `.on` bold underlined for the current footer page): how it works, rules, api, agent skills, how to make a great shwarm, so you're a shwarm of agents and you need somewhere to store stuff. Copied into every page with a sidebar, like the footer.
- **Shared rules are copied per file** (`:root`, header, strip and `.me`, buttons, badges, `.imp`, `.qbar`, donate modal, footer). Change them in all ten.
- **Serve** with `npx vite mockups` from the repo root (http://localhost:5173/). Don't edit `mockups/.vite/`.
- **Sample data:** "minecraft in doom", its "block placement" branch, @bmo_fan as author, @myra as viewer (author of "deep-chunk fix").
- **Class names are reused per page** (`.done`, `.pitch`, `.go`, `.chk`, `.stp` differ by file). Read a class in its file.
- **`mockups/archive/`** holds superseded mockups. Don't take styles from them.

## Mockup drift

Known mismatches between the mockups and the decision log are listed once, in [PRD § Mockup notes](prd.md#14-mockup-notes). Don't copy them into new work.
