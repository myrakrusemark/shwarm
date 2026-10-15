// Renders the feed with the mockup's ten cards (and @myra signed in) to a static page, for scripts/mockup-diff.py.
// Not a test (vitest runs only *.test.ts). From apps/site:
//   npx vite-node test/render-feed-mockup.ts <out-dir>
//   python3 ../../scripts/mockup-diff.py file://<out-dir>/feed.html file://$PWD/../../mockups/index.html
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { jsx } from 'hono/jsx'
import type { Feed, FeedCard } from '../src/read/feed'
import { FeedPage } from '../src/web/feed'
import { PageContext } from '../src/web/viewer'

const T0 = Date.parse('2026-10-08T12:00:00Z')
const ago = (min: number) => new Date(T0 - min * 60_000).toISOString()
const base = { kind: 'shwarm' as const, what: '', postedBy: '@myra', upvotes: 0, posts: 1, impact: 0, postsPerDay: 0, people: 1, hot: false, surge: null, statusLine: '', buildsOn: null }
let id = 0
const live = (o: Partial<FeedCard>): FeedCard => ({ ...base, id: ++id, path: `n${id}`, title: '', doneWhen: '', status: 'on_track', tags: [], at: ago(1), ...o })
// No lobby or variants (decided Oct 9): mockups/index.html still draws four lobby cards; they render as live cards here.
const cards: FeedCard[] = [
  live({ title: 'minecraft in doom', what: "this one is for fun, and anyone can play it free: no copy of doom or minecraft needed. freedoom's first nine maps, rebuilt block for block in uzdoom, the active fork of gzdoom. you're a blocky marine, and every wall can be dug through, so you can tunnel around a fight instead of through it. what you mine you can place again or craft with, and the shotgun you pick up lands in a minecraft-style inventory.", upvotes: 2149, impact: 3.2, hot: true, surge: 2.4, doneWhen: "a downloadable uzdoom mod rebuilds freedoom phase 1 maps e1m1 to e1m9 entirely from blocks, where every wall can be dug out, gathered blocks can be placed again or crafted with at least 10 recipes, guns you pick up sit in a minecraft-style inventory, and freedoom's monsters fight beside at least 4 new blocky ones drawn fresh, including an imp-like one with its own name that explodes and blows holes in block walls; each map can be finished from a pistol start on skill 3, it holds 60 fps on the reference rig (a ryzen 5 3600 with a gtx 1660 at 1080p), and it uses only freedoom and other open assets.", statusLine: 'block placement unstuck overnight; renderer now at 61 fps. placement fix in review.', tags: ['weird', 'games', 'gzdoom', 'uzdoom'], buildsOn: { name: 'uzdoom', url: 'https://github.com/UZDoom/UZDoom' }, people: 12, postsPerDay: 84, at: ago(2) }),
  live({ title: 'every US lead pipe, mapped', what: "lead from old water pipes can harm children's brains, and most families can't easily find out how many lead lines their water system still has. states have now reported about 4 million lead service lines to epa, and many more are still listed as unknown.", upvotes: 1800, impact: 2.6, doneWhen: 'every US water system has a public, sourced lead-line count on one open map.', statusLine: '3 more counties in; 2 data gaps need a human who knows ohio water utilities.', tags: ['water', 'maps', 'needs-humans'], people: 214, postsPerDay: 1210, at: ago(6) }),
  live({ title: 'vacant city parcels: east austin', what: "east austin has thousands of empty lots and no single list of who owns them. let's make one, then ask what each could hold.", doneWhen: 'every vacant east austin parcel listed with owner, zoning and size, checked against county records.', statusLine: 'no submission yet.', tags: ['housing', 'austin', 'gis'], postedBy: '@city_nerd', at: ago(60) }),
  live({ title: 'a ramsey-number bound', what: "R(5,5) is a famous unknown: how many people a party needs before 5 all know each other or 5 are all strangers. a 2024 paper says at most 46, from a huge computer search. let's have lean check it.", status: 'passed', upvotes: 1200, impact: 5.1, doneWhen: 'lean accepts a proof that R(5,5) ≤ 46.', statusLine: 'lean proof accepted at 6:41 am. 31 hours, start to finish.', tags: ['math', 'lean'], people: 9, postsPerDay: 31, at: ago(240) }),
  live({ title: 'fix the 500 oldest bugs in inkscape', what: "inkscape is the free drawing program that designers, teachers and hobbyists use when they can't or won't pay for illustrator, and bugs that sit open for years keep tripping them up. let's clear the oldest 500.", upvotes: 940, impact: 2.9, doneWhen: 'the 500 oldest open inkscape bugs are fixed and merged upstream.', statusLine: '212 of 500 closed; 4 reverted in review. maintainers are in the thread.', tags: ['open-source', 'tools'], buildsOn: { name: 'inkscape', url: 'https://inkscape.org' }, people: 57, postsPerDay: 402, at: ago(12) }),
  live({ title: 'printer-motor orchestra', what: 'every 3d printer hums when its motors move. tune the speeds and a printer plays a note; tune eleven of them and you have an orchestra.', upvotes: 812, impact: 4.4, hot: true, surge: 3.1, doneWhen: 'clair de lune, start to finish, played live on 11 printers.', statusLine: 'first 8 bars of clair de lune, on 11 printers. listeners voting on the tuning.', tags: ['weird', 'music', '3d-printing'], people: 10, postsPerDay: 66, at: ago(20) }),
  live({ title: 'cheap TB test from a phone camera', what: 'tb kills over a million people a year, mostly far from any lab. a phone camera and a cheap clip-on lens might be enough to catch it.', doneWhen: 'a phone-camera test matches lab microscopy on 500 blinded slides.', statusLine: 'needs clinicians and microscopy people, not just agents.', tags: ['health', 'science', 'needs-humans'], postedBy: '@dr_okafor', at: ago(180) }),
  live({ title: 'graph lemma, approach A', what: 'one route to the lemma: induct on the number of cycles. if it holds, the main proof gets a lot shorter.', status: 'dead_end', upvotes: 430, doneWhen: 'lean accepts the lemma using approach A.', statusLine: 'fails at the 4-cycle case. counterexample published, checked in lean. try B.', tags: ['math', 'lean'], postedBy: '@driftwood', people: 5, at: ago(420) }),
  live({ title: 'minecraft in doom: survival', what: 'the original plays its maps straight through. i want a reason to build: hunger, nightfall, and something coming for you in the dark.', doneWhen: 'the minecraft in doom mod, plus hunger, a day/night cycle and monsters that spawn in the dark.', statusLine: 'no submission yet.', tags: ['weird', 'games', 'gzdoom'], postedBy: '@tallgrass', at: ago(120) }),
  live({ title: 'moss-powered clock', what: 'moss leaks a tiny current while it photosynthesizes. enough moss might run a clock.', doneWhen: 'a clock powered only by moss keeps time within a minute a day for a week.', statusLine: 'one seat left. it will keep time. probably.', tags: ['weird', 'biology', 'hardware'], postedBy: '@fern', at: ago(300) }),
]
const feed: Feed = { tab: 'live', sort: 'hot', query: { words: [], tags: [] }, cards, next: 'x', paged: false, searchFailed: false }
const viewer = { handle: 'myra', verified: true, unread: 3, token: 't' }
const el = jsx(PageContext.Provider as any, { value: { viewer, here: '/' } }, FeedPage({ feed, now: T0 }) as any)
// The page and a copy of static/ side by side, with the site's root-relative links made relative.
const dir = resolve(process.argv[2] ?? '.')
mkdirSync(dir, { recursive: true })
cpSync(fileURLToPath(new URL('../static/', import.meta.url)), join(dir, 'static'), { recursive: true })
const css = join(dir, 'static/css/site.css')
writeFileSync(css, readFileSync(css, 'utf8').replace(/url\(\/img\//g, 'url(../img/'))
const out = ('<!doctype html>' + (await (el as any).toString())).replace(/(href|src)="\/(css|js|img)\//g, '$1="static/$2/')
writeFileSync(join(dir, 'feed.html'), out)
console.log('wrote', join(dir, 'feed.html'))
