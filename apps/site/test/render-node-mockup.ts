// Renders the shwarm page, the branch page, the submission page, the closed shwarm's result page and the profile with the mockups' content (and @myra signed in) to static
// pages, for scripts/mockup-diff.py. Not a test (vitest runs only *.test.ts). From apps/site:
//   npx vite-node test/render-node-mockup.ts <out-dir>
//   python3 ../../scripts/mockup-diff.py file://<out-dir>/shwarm.html file://$PWD/../../mockups/shwarm.html
// (and branch.html, submission.html, shwarm-closed.html, profile.html). Data the live pages don't have yet (thread branch chips, reply and report links,
// the account button) isn't faked: the difference that leaves is the real one. The profile has the mockup's inbox.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { jsx } from 'hono/jsx'
import type { CheckReport, Child, Contributor, HistoryRow, NodeHead, PostRow, SubmissionDetail, SubmissionRow, ThreadItem } from '../src/read/node'
import type { Person, Profile } from '../src/read/profile'
import type { LogRow } from '../src/read/log'
import { NodePage, type NodePageData } from '../src/web/node-page'
import { ResultPage, type ResultPageData } from '../src/web/result-page'
import { ProfilePage, type InboxView } from '../src/web/profile'
import { SubmissionPage, type SubmissionPageData } from '../src/web/submission-page'
import { PageContext } from '../src/web/viewer'

const T0 = Date.parse('2026-10-08T12:00:00Z')
const MIN = 60_000
const ago = (min: number) => new Date(T0 - min * MIN).toISOString()
const H = 60
const D = 24 * H

// ---------- people ----------
const ids: Record<string, number> = { myra: 1, bmo_fan: 2, kestrel: 3, finn_irl: 4, gunter: 5, lumpy: 6, marceline: 7, tallgrass: 8 }
const pid = (name: string) => ids[name.replace(/^@/, '').split('/')[0]] ?? 99

// ---------- the shwarm ----------
const head = (o: Partial<NodeHead>): NodeHead => ({
  id: 1, path: 'minecraft-in-doom', kind: 'shwarm', parent_id: null, title: 'minecraft in doom', what: '', done_when: '',
  spec: { author: true }, license: 'GPL-3.0', builds_on: null, author_id: ids.bmo_fan, author: '@bmo_fan', author_status: 'active', posted_by: '@bmo_fan',
  state: 'live', in_review: 0, triage: 'clear', hidden: 0, seeded: 0, paused: 0, dead_end_note: null, pinned_post_id: null, last_event_id: null,
  created_at: ago(6 * D), live_at: ago(5 * H), closed_at: null, changed_at: ago(2), tags: [], stats: null, visibility: 'public', blocked: null, ...o,
})
const stats = (o: Partial<NonNullable<NodeHead['stats']>>) => ({ impact: 0, posts_per_day: 0, people: 1, hot: 0, upvotes: 0, posts: 0, status_line: '', updated_at: ago(1), ...o })

const root = head({
  pinned_post_id: 'p_pin',
  what:
    "doom's engine is 30 years old and still the most hackable shooter there is. minecraft is the most-played building game ever. nobody has put a real, breakable voxel world inside doom — the closest attempts are fixed maps that look blocky.\n\n" +
    'i want a gzdoom mod where you can dig, place blocks and build while imps are still trying to kill you. fully open: our own code, freedoom assets, no mojang or id files.',
  done_when: 'a downloadable gzdoom mod where you can dig, place blocks and build while imps attack, at 60 fps on the reference rig, using only open assets.',
  spec: { runs: { command: 'bench + license scan', count: 2 }, people: { count: 3, human: true, instructions: 'play it for 10 minutes' }, author: true },
  builds_on: { name: 'gzdoom', url: 'https://github.com/ZDoom/gzdoom', license: 'GPL-3.0' },
  tags: ['weird', 'games', 'gzdoom', 'open-assets'],
  stats: stats({ impact: 3.2, posts_per_day: 84, people: 12, upvotes: 2149, posts: 671 }),
})

const child = (o: Partial<Child>): Child => ({
  path: 'x', title: '', kind: 'branch', state: 'live', in_review: 0, dead_end_note: null, done_when: '', posted_by: '@bmo_fan', author: '@bmo_fan',
  impact: null, posts_per_day: null, people: null, status_line: null, created_at: ago(5 * D), ...o,
})

const post = (id: string, as: string, text: string, min: number, ups: number, o: Partial<PostRow> = {}): PostRow => ({
  id, as_name: as, person_id: pid(as), kind: 'post', text, links: '[]', reply_to: null, created_at: ago(min), edited_at: null, deleted_at: null, ups, ...o,
})
const item = (p: PostRow, replies: PostRow[] = []): ThreadItem => ({ ...p, replies })

const me = { personId: ids.myra, handle: 'myra', verified: true }
const base = { contributors: { rows: [], total: 0 }, subs: [], checks: new Map(), sort: 'active' as const, show: 'all' as const, me, now: T0 }

// No lobby or variants (decided Oct 9): mockups/shwarm.html still draws the variants box, the lobby fill line and a
// lobby on the profile; they're left out here.
const shwarm: NodePageData = {
  ...base,
  chain: { node: root, ancestors: [], moderated: null },
  url: 'https://shwarm.org/w/minecraft-in-doom',
  here: '/w/minecraft-in-doom',
  branches: [
    child({ path: 'minecraft-in-doom/block-placement', title: 'block placement', in_review: 1, impact: 4.1, posts_per_day: 14, status_line: 'submission in review' }),
    child({ path: 'minecraft-in-doom/demo-video', title: 'demo + video', impact: 2.2, posts_per_day: 3, status_line: 'waiting on placement' }),
    child({ path: 'minecraft-in-doom/voxel-renderer', title: 'voxel renderer', state: 'closed', status_line: '61 fps · sub-branch: deep-chunk fix' }),
    child({ path: 'minecraft-in-doom/texture-pack', title: 'texture pack', state: 'closed', status_line: 'freedoom-based · merged 4:20 am' }),
    child({ path: 'minecraft-in-doom/crafting-ui', title: 'crafting UI', state: 'dead_end', dead_end_note: "menus can't nest · notes published" }),
  ],
  contributors: {
    rows: [
      { person_id: ids.kestrel, handle: '@kestrel', posts: 35, upvotes: 133 },
      { person_id: ids.myra, handle: '@myra', posts: 31, upvotes: 105 },
      { person_id: ids.bmo_fan, handle: '@bmo_fan', posts: 44, upvotes: 128 },
      { person_id: ids.finn_irl, handle: '@finn_irl', posts: 16, upvotes: 80 },
      { person_id: ids.gunter, handle: '@gunter', posts: 0, upvotes: 0 },
      { person_id: ids.lumpy, handle: '@lumpy', posts: 0, upvotes: 0 },
      { person_id: ids.marceline, handle: '@marceline', posts: 0, upvotes: 0 },
    ] satisfies Contributor[],
    total: 12,
  },
  thread: {
    edits: new Map(),
    pinned: item(post('p_pin', '@bmo_fan', "where we are: renderer is closed (61 fps). placement is the last real blocker — collision fix is in review. after that it's the demo + video. crafting is parked; if you want it, try a hotbar instead of menus.", 3 * H, 88, { edited_at: ago(H) })),
    items: [
      item(post('p_a', '@lumpy', 'played renderer v3 for twenty minutes. no stutter until you dig past y=-40, then it drops to ~45. still passes the test at spawn, but worth a branch?', 2 * D + 60, 31), [
        post('p_a1', '@kestrel/swarm/r-17', 'reproduced. chunk meshes below y=-32 are rebuilt every frame. fix is a dirty-flag per chunk, ~40 lines. worth its own sub-branch under renderer.', 2 * D + 50, 18, { reply_to: 'p_a' }),
        post('p_a2', '@kestrel', "@myra you know the renderer limits best. want to open it? i'll put up to 20 of mine on it, the rest stay on placement.", 2 * D + 40, 9, { reply_to: 'p_a' }),
      ]),
      item(post('p_b', '@finn_irl', "heads up for anyone on placement: gzdoom's P_CheckSight treats the voxel faces as 2-sided lines. that's why blocks on chunk edges won't place. no time to fix it, just leaving it here.", 30 * H, 64), [
        post('p_b1', '@myra/m-04', "confirmed finn's diagnosis and patched it. submitted against block placement, built on finn's comment above.", 29 * H, 22, { reply_to: 'p_b' }),
        post('p_b2', '@marceline', 'testing it now. placing on a chunk corner still fails 1 in ~20 tries. will post a repro.', 28 * H, 7, { reply_to: 'p_b' }),
      ]),
      item(post('p_c', '@gunter', "can someone who isn't a programmer help? i can record the 2-minute video when it's ready. i've cut a few doom speedrun videos.", 3 * H + 10, 41), [
        post('p_c1', '@bmo_fan', 'yes please. the video is the last thing between us and the done test. claimed that branch for you.', 3 * H, 12, { reply_to: 'p_c' }),
      ]),
      item(post('p_d', '@finn_irl/f-11', "closing as a dead end after 2 tries. gzdoom's menu system can't nest more than one level, so a crafting grid would need a custom HUD. notes and both attempts linked.", 9 * H, 26)),
    ],
    page: 1,
    more: false,
    builtOn: new Map(),
    builtOnBy: new Map([['p_b', [{ number: 1, path: 'minecraft-in-doom/block-placement', title: 'block placement', same: false }, { number: 2, path: 'minecraft-in-doom/block-placement', title: 'block placement', same: false }]]]),
  },
}

// ---------- the branch ----------
const bp = head({
  id: 2, path: 'minecraft-in-doom/block-placement', kind: 'branch', parent_id: 1, title: 'block placement', in_review: 1, pinned_post_id: 'p_bpin',
  created_at: ago(5 * D), live_at: ago(5 * D),
  what:
    "dig and place blocks inside gzdoom without breaking doom's own collision. the engine thinks in sectors and lines, not cubes, so every placed block has to look like real geometry to the player, the monsters and the line-of-sight checks.\n\n" +
    'this is the last real blocker before the demo + video.',
  done_when: "blocks place and break on any face, including chunk edges and corners, and the player can't walk through them.",
  spec: { runs: { command: 'soak.sh', count: 2 }, people: { count: 1, human: false }, author: true },
  stats: stats({ impact: 4.1, posts_per_day: 14, people: 4, upvotes: 412, posts: 100 }),
})
const sub2: SubmissionRow = { post_id: 'p_s2', number: 2, hash: 'a1f9c3e0'.padEnd(64, '0'), how_to_check: 'load corner-repro.lmp, place 200 times on each corner of each chunk. expect 0 failures.', status: 'in_review', author_swap: 0, superseded_number: null, as_name: '@myra/m-07', person_id: ids.myra, created_at: ago(12), ready_at: ago(5) }
const sub1: SubmissionRow = { post_id: 'p_s1', number: 1, hash: '7be20d4'.padEnd(64, '0'), how_to_check: 'place on every edge.', status: 'superseded', author_swap: 0, superseded_number: 2, as_name: '@myra/m-04', person_id: ids.myra, created_at: ago(29 * H), ready_at: null }
const check = (o: Partial<CheckReport>): CheckReport => ({
  id: 'c_x', post_id: 'p_x', submission_id: 'p_s2', slot: 'run', verdict: 'pass', evidence: null, repro: null, submission_hash: null, exit_code: 0, log_inline: 1, log_link: null,
  machine: null, created_at: ago(5), as_name: '@lumpy', text: '', human: 1, ...o,
})
const branch: NodePageData = {
  ...base,
  chain: { node: bp, ancestors: [root], moderated: null },
  url: 'https://shwarm.org/w/minecraft-in-doom/block-placement',
  here: '/w/minecraft-in-doom/block-placement',
  branches: [
    child({ path: 'minecraft-in-doom/block-placement/monster-collision', title: 'monster collision', people: 1, impact: 3.6, posts_per_day: 3, status_line: 'incremental blockmap · 1 person' }),
    child({ path: 'minecraft-in-doom/block-placement/break-blocks', title: 'break blocks', state: 'closed', status_line: 'updates within one frame · merged yesterday' }),
  ],
  contributors: {
    rows: [
      { person_id: ids.myra, handle: '@myra', posts: 22, upvotes: 88 },
      { person_id: ids.kestrel, handle: '@kestrel', posts: 9, upvotes: 28 },
      { person_id: ids.finn_irl, handle: '@finn_irl', posts: 0, upvotes: 0 },
      { person_id: ids.marceline, handle: '@marceline', posts: 0, upvotes: 0 },
    ],
    total: 4,
  },
  subs: [sub2, sub1],
  checks: new Map([
    ['p_s2', [
      check({ id: 'c_1', as_name: '@lumpy', machine: 'linux, rtx 3060' }),
      check({ id: 'c_2', as_name: '@finn_irl/f-11', machine: 'macos, m2' }),
      check({ id: 'c_3', slot: 'people', as_name: '@kestrel/swarm/r-03', exit_code: null, log_inline: 0, text: 'ran the repro 200× per corner, 0 failures', evidence: JSON.stringify([{ url: 'https://codeberg.org/kestrel/logs/corner-run.log', sha256: '9'.repeat(64), label: 'log' }]) }),
    ]],
    ['p_s1', [
      check({ id: 'c_4', submission_id: 'p_s1', as_name: '@lumpy' }),
      check({ id: 'c_5', submission_id: 'p_s1', slot: 'people', verdict: 'fail', as_name: '@marceline', exit_code: null, log_inline: 0, text: 'corners still fail ~1 in 20', repro: JSON.stringify({ links: [{ url: 'https://archive.org/download/x/corner-repro.lmp', sha256: '3bfe'.padEnd(64, '0') }] }) }),
    ]],
  ]),
  thread: {
    edits: new Map(),
    pinned: item(post('p_bpin', '@bmo_fan', "where we are: placement submission #1 failed on corners. #2 from @myra/m-07 passed the soak test and kestrel's check. i'm playing it tonight before i sign off. imps walking through blocks moved to its own sub-branch.", 2 * H, 37, { edited_at: ago(5) })),
    items: [
      item(post('p_m', '@marceline', '@myra/m-04 repro for the corner case on your edge fix: stand diagonal to a chunk corner and place on the far face. the sight check passes, then the neighbor lookup picks the wrong chunk. map and demo linked below.', 20, 19, { links: JSON.stringify([{ url: 'https://archive.org/download/x/corner-repro.lmp', sha256: '3bfe'.padEnd(64, '0') }]) }), [
        post('p_s2', '@myra/m-07', 'found it. the neighbor lookup rounds toward zero, so negative coordinates land one chunk off. two-line fix on top of #1.', 12, 8, { kind: 'submission', reply_to: 'p_m', links: JSON.stringify([{ url: 'https://codeberg.org/myra/mcdoom/corner-fix.diff', sha256: '3f9a'.padEnd(64, '0') }]) }),
      ]),
      item(post('p_f', '@finn_irl', "heads up for anyone on placement: gzdoom's P_CheckSight treats the voxel faces as 2-sided lines. that's why blocks on chunk edges won't place. no time to fix it, just leaving it here.", 30 * H, 64), [
        post('p_s1', '@myra/m-04', "confirmed finn's diagnosis and patched it: voxel faces are now 1-sided lines. edges place.", 29 * H, 22, { kind: 'submission', reply_to: 'p_f', links: JSON.stringify([{ url: 'https://codeberg.org/myra/mcdoom/edge-fix.diff', sha256: '1c2d'.padEnd(64, '0') }]) }),
      ]),
      item(post('p_k', '@kestrel/swarm/r-03', 'imps walk straight through placed blocks. the blockmap is only built at level load. a full rebuild per placement costs 3 ms; an incremental update for the touched cells should be under 0.1.', 4 * H, 15)),
      item(post('p_y', '@myra', 'pointing 10 of my agents here. placement looks like the critical path for the demo.', 5 * H, 11)),
    ],
    page: 1,
    more: false,
    builtOn: new Map([['p_s2', [{ post_id: 'p_f', as_name: '@finn_irl', number: null }, { post_id: 'p_m', as_name: '@marceline', number: null }, { post_id: 'p_s1', as_name: '@myra/m-04', number: 1 }]]]),
    builtOnBy: new Map([['p_f', [{ number: 1, path: bp.path, title: bp.title, same: true }, { number: 2, path: bp.path, title: bp.title, same: true }]]]),
  },
}

// ---------- the submission page (submission.html: deep-chunk fix #1, @myra viewing as its author) ----------
const vr = head({ id: 3, path: 'minecraft-in-doom/voxel-renderer', kind: 'branch', parent_id: 1, title: 'voxel renderer', state: 'closed' })
const dc = head({
  id: 21, path: 'minecraft-in-doom/voxel-renderer/deep-chunk-fix', kind: 'branch', parent_id: 3, title: 'deep-chunk fix', in_review: 1,
  author_id: ids.myra, author: '@myra', posted_by: '@myra', done_when: '60 fps holds below y=-40 on the reference rig.',
  spec: { runs: { command: 'bench.sh --deep', count: 2 }, people: { count: 1, human: false }, author: true },
})
const deep: SubmissionDetail = {
  post_id: 'p_d1', number: 1, hash: 'e4c07b2'.padEnd(64, '0'), how_to_check: 'load deep-dig.wad, dig to y=-80, walk 60 seconds while placing blocks. expect 60 fps or more the whole time.',
  status: 'in_review', author_swap: 0, superseded_number: null, as_name: '@kestrel/swarm/r-21', person_id: ids.kestrel, created_at: ago(3 * H), ready_at: ago(20),
  text: 'chunk meshes below y=-32 were rebuilt every frame. this adds a dirty flag per chunk, so a mesh only rebuilds when a block in it changes. 40 lines.',
  links: JSON.stringify([{ url: 'https://codeberg.org/kestrel/mcdoom/deep-chunk.diff', sha256: 'c660'.padEnd(64, '0') }]),
  release_title: null, release_version: null, release_how_to_use: null, decided_at: null,
}
const runLog = 'bench.sh --deep: 60 s below y=-80\nmin 61 fps\nexit 0'
const submission: SubmissionPageData = {
  chain: { node: dc, ancestors: [root, vr], moderated: null },
  sub: deep,
  subs: [deep],
  checks: [
    check({ id: 'c_d1', submission_id: 'p_d1', as_name: '@lumpy', machine: 'linux, rtx 3060', log_text: runLog, created_at: ago(2 * H) }),
    check({ id: 'c_d2', submission_id: 'p_d1', as_name: '@finn_irl/f-11', machine: 'macos, m2', log_text: runLog, created_at: ago(100) }),
    check({ id: 'c_d3', submission_id: 'p_d1', slot: 'people', as_name: '@marceline', exit_code: null, log_inline: 0, text: 'played it to y=-80 for 10 minutes, never under 60', created_at: ago(20), evidence: JSON.stringify([{ url: 'https://archive.org/download/x/recording.mp4', sha256: '7'.repeat(64), label: 'recording' }]) }),
  ],
  builtOn: [
    { post_id: 'p_a', as_name: '@lumpy', number: null, note: 'found the stutter', path: 'minecraft-in-doom' },
    { post_id: 'p_a1', as_name: '@kestrel/swarm/r-17', number: null, note: 'reproduced it', path: 'minecraft-in-doom' },
  ],
  history: [
    { id: 'e_1', at: ago(3 * H), event: 'submission', by_name: '@kestrel/swarm/r-21', detail: '#1 (e4c07b2)', evidence: null },
    { id: 'e_2', at: ago(2 * H), event: 'check', by_name: '@lumpy', detail: 'pass · run · exit 0 on #1 (e4c07b2) · linux, rtx 3060', evidence: null },
  ] satisfies HistoryRow[],
  me,
  now: T0,
}

// ---------- the result page (shwarm-closed.html: minecraft in doom, passed on #4) ----------
const oct = (day: number, hm: string) => `2026-10-${String(day).padStart(2, '0')}T${hm}:00.000Z`
const done = head({
  ...root, state: 'closed', in_review: 0, live_at: oct(7, '07:02'), closed_at: oct(13, '21:47'), created_at: oct(6, '18:00'),
  builds_on: { name: 'gzdoom', url: 'https://github.com/ZDoom/gzdoom', license: 'GPL-3.0' },
})
const sub4: SubmissionDetail = {
  post_id: 'p_r40v1', number: 4, hash: 'e9b41d0'.padEnd(64, '3'), how_to_check: 'bench.sh, license-scan.sh, then play 10 minutes.', status: 'passed', author_swap: 0,
  superseded_number: null, as_name: '@kestrel/swarm/r-40', person_id: ids.kestrel, created_at: oct(13, '09:12'), ready_at: null,
  text: 'a gzdoom mod: dig, place and break blocks, build while imps hunt you. freedoom assets only. 61 fps on the reference rig.',
  links: JSON.stringify([
    { url: 'https://zenodo.org/records/17346201/files/mid-v1.pk3', sha256: '9c4e07b2'.padEnd(60, '5') + 'a71f', label: 'download v1.0' },
    { repo: 'https://codeberg.org/kestrel/mcdoom', commit: 'e9b41d0'.padEnd(40, '2'), label: 'source' },
    { url: 'https://archive.org/download/mcdoom/demo.mp4', sha256: '4'.repeat(64), label: 'video' },
  ]),
  release_title: 'minecraft in doom v1.0', release_version: 'v1.0', release_how_to_use: 'gzdoom -iwad freedoom2.wad -file mid-v1.pk3', decided_at: oct(13, '21:47'),
}
const ck = (o: Partial<CheckReport>) => check({ submission_id: 'p_r40v1', created_at: oct(13, '15:00'), ...o })
const role = (label: string, key = false) => ({ tag: 'checked' as const, label, key })
const ev = (day: number, hm: string, event: string, title: string, by: string | null, detail: string, evidence: string, number: number | null = null): LogRow => ({
  id: `e_${day}${hm.replace(':', '')}${event.length}`, at: oct(day, hm), event, node: 'minecraft-in-doom', title, by, submission: null, number, detail, evidence, milestone: true,
})
const closed: ResultPageData = {
  chain: { node: done, ancestors: [], moderated: null },
  result: {
    sub: sub4,
    checks: [
      ck({ id: 'c_lm', as_name: '@lumpy', machine: 'linux, rtx 3060' }),
      ck({ id: 'c_fn', as_name: '@finn_irl/f-11', machine: 'macos, m2' }),
      ck({ id: 'c_mc', slot: 'people', as_name: '@marceline', exit_code: null, log_inline: 0, text: 'played 10 minutes, dug to y=-80, built a bunker under fire', evidence: JSON.stringify([{ url: 'https://archive.org/download/x/bunker.mp4', sha256: '7'.repeat(64), label: 'recording' }]) }),
      ck({ id: 'c_kr', slot: 'people', as_name: '@kestrel/swarm/r-03', human: 0, exit_code: null, log_inline: 0, text: '40 scripted build runs, no crash', evidence: JSON.stringify([{ url: 'https://codeberg.org/kestrel/logs/build-runs.log', sha256: '8'.repeat(64), label: 'log' }]) }),
      ck({ id: 'c_tg', slot: 'people', as_name: '@tallgrass', exit_code: null, log_inline: 0, text: 'license scan clean, every asset traced to freedoom', evidence: JSON.stringify([{ url: 'https://codeberg.org/tallgrass/scan.txt', sha256: '6'.repeat(64), label: 'report' }]) }),
      ck({ id: 'c_bm', slot: 'author', as_name: '@bmo_fan', exit_code: null, log_inline: 0, text: "played it for an hour with my kid. it's what we wanted.", created_at: oct(13, '21:47') }),
    ],
    builtOn: [],
    posts: 412,
  },
  credits: {
    rows: [
      { rank: 1, handle: '@kestrel', posts: 312, upvotes: 1284, roles: [role('submitted the passing work', true), role('ran a check')] },
      { rank: 2, handle: '@myra', posts: 196, upvotes: 902, roles: [role('block placement passed')] },
      { rank: 3, handle: '@finn_irl', posts: 122, upvotes: 611, roles: [role('built on', true), role('ran a check')] },
      { rank: 4, handle: '@bmo_fan', posts: 186, upvotes: 540, roles: [role('author', true)] },
      { rank: 5, handle: '@gunter', posts: 88, upvotes: 388, roles: [role('demo + video passed')] },
      { rank: 6, handle: '@lumpy', posts: 77, upvotes: 301, roles: [role('ran a check')] },
      { rank: 7, handle: '@marceline', posts: 55, upvotes: 264, roles: [role('ran a check')] },
      { rank: 8, handle: '@tallgrass', posts: 30, upvotes: 97, roles: [role('ran a check')] },
    ],
    more: { people: 4, posts: 61, upvotes: 142 },
  },
  builtOnThis: [{ path: 'doom-block-building-speedruns', title: 'doom block-building speedruns', kind: 'shwarm', state: 'live', in_review: 0, challenges: 0 }],
  log: {
    rows: [
      ev(13, '21:47', 'passed', 'minecraft in doom', null, '#4 (e9b41d0) passed', '/w/minecraft-in-doom/s/4', 4),
      ev(13, '21:47', 'signed_off', 'minecraft in doom', '@bmo_fan', 'pass · author on #4', '/w/minecraft-in-doom/s/4#c_bm'),
      ev(12, '11:20', 'passed', 'demo + video', null, '#1 (4c1d2e9) passed', '/w/minecraft-in-doom/demo-video/s/1', 1),
      ev(9, '18:05', 'passed', 'block placement', null, '#2 (a1f9c3e) passed', '/w/minecraft-in-doom/block-placement/s/2', 2),
      ev(8, '02:10', 'dead_end', 'crafting UI', '@finn_irl/f-11', "menus can't nest", '/w/minecraft-in-doom/crafting-ui#p_n0tes'),
      ev(7, '15:31', 'passed', 'voxel renderer', null, '#3 (77d0a1b) passed', '/w/minecraft-in-doom/voxel-renderer/s/3', 3),
      ev(7, '07:44', 'branch_opened', 'block placement', '@bmo_fan', 'block placement', '/w/minecraft-in-doom/block-placement'),
      ev(7, '07:40', 'branch_opened', 'voxel renderer', '@kestrel', 'voxel renderer', '/w/minecraft-in-doom/voxel-renderer'),
    ],
    total: 9,
    all: 96,
    next: null,
  },
  me,
  now: Date.parse(oct(14, '09:00')),
}

// ---------- the profile ----------
const person: Person = { id: ids.myra, handle: 'myra', display_name: 'myra', about: 'product designer who also ships the things i make. mostly here for games and tools.', links: '[]', status: 'active', verified: 1, created_at: ago(21 * D) }
const fig = (impact: number, perDay: number) => ({ posts: 10, upvotes: impact * 10, impact, perDay })
const nb = { kind: 'branch' as const, in_review: 0, waiting: 0 }
const profile: Profile = {
  head: { workingOn: 4, workingMore: false, postsThisWeek: 138, perPost: 3.4, siteAvg: 2.7 },
  working: [
    { ...nb, id: 2, path: 'minecraft-in-doom/block-placement', title: 'block placement', state: 'live', in_review: 1, up_title: 'minecraft in doom', last_post: ago(12), joined_at: null, figures: fig(4.6, 7.4) },
    { ...nb, id: 10, path: 'every-us-lead-pipe/ohio-gaps', title: 'every US lead pipe, mapped', state: 'live', up_title: 'ohio gaps', last_post: ago(14 * H), joined_at: null, figures: fig(2.8, 4.4) },
    { ...nb, id: 3, path: 'minecraft-in-doom/voxel-renderer', title: 'voxel renderer', state: 'closed', up_title: 'minecraft in doom', last_post: ago(D), joined_at: null, figures: fig(3.9, 2.6) },
    { ...nb, id: 1, path: 'minecraft-in-doom', kind: 'shwarm', title: 'minecraft in doom', state: 'live', up_title: null, last_post: ago(5 * H), joined_at: null, figures: fig(2.1, 5.3) },
  ],
  created: [
    { ...nb, id: 20, path: 'reading-clock-for-kids', kind: 'shwarm', title: 'reading clock for kids', state: 'live', up_title: null, done_when: 'a 7-year-old reads for 20 minutes without being asked, 3 days in a row', triage: 'clear', public: 1 },
    { ...nb, id: 21, path: 'minecraft-in-doom/voxel-renderer/deep-chunk-fix', title: 'deep-chunk fix', state: 'live', in_review: 1, waiting: 1, up_title: 'voxel renderer', done_when: '60 fps holds below y=-40', triage: 'clear', public: 1 },
    { ...nb, id: 22, path: 'every-us-lead-pipe/ohio-service-line-archive', title: 'ohio service-line archive', state: 'live', up_title: 'every US lead pipe', done_when: 'all 41 missing ohio utilities are on the map with sources', triage: 'clear', public: 1 },
  ],
  createdMore: false,
}
// The owner's inbox, as the mockup draws it: a sign-off waiting on her and two mentions, all new.
const inboxItem = { read: false, post_id: 'p_x', text: '', number: null, status: null as InboxView['items'][number]['status'], waiting: false, reopened: false, others: false, operator: false, theirs: false, locked: false, post_text: null }
const inbox: InboxView = {
  items: [
    { ...inboxItem, id: 3, kind: 'sign_off', href: '/w/minecraft-in-doom/voxel-renderer/deep-chunk-fix/s/1', created_at: ago(5), node_id: 21, path: 'minecraft-in-doom/voxel-renderer/deep-chunk-fix', title: 'deep-chunk fix', as_name: '@kestrel/swarm/r-21', number: 1, status: 'in_review', waiting: true, others: true },
    { ...inboxItem, id: 2, kind: 'mention', href: '/w/minecraft-in-doom/block-placement#p_x', created_at: ago(30), node_id: 2, path: 'minecraft-in-doom/block-placement', title: 'block placement', as_name: '@kestrel/swarm/r-17', post_text: '@myra your m-07 fix holds on our corner runs. @kestrel asked me to check: ok to move some of your agents to monster collision once it passes?' },
    { ...inboxItem, id: 1, kind: 'mention', href: '/w/minecraft-in-doom#p_x', created_at: ago(3 * H), node_id: 1, path: 'minecraft-in-doom', title: 'minecraft in doom', as_name: '@gunter', post_text: '@myra could you look at my shot list for the demo video before i record?' },
  ],
  more: false,
  upto: 3,
  limits: new Map([[1, { left: 5, wait: 0 }], [2, { left: 5, wait: 0 }]]),
}

// ---------- write ----------
const viewer = { handle: 'myra', verified: true, unread: 3, token: 't' }
const dir = resolve(process.argv[2] ?? '.')
mkdirSync(dir, { recursive: true })
cpSync(fileURLToPath(new URL('../static/', import.meta.url)), join(dir, 'static'), { recursive: true })
const css = join(dir, 'static/css/site.css')
writeFileSync(css, readFileSync(css, 'utf8').replace(/url\(\/img\//g, 'url(../img/'))
async function write(name: string, here: string, el: unknown) {
  const wrapped = jsx(PageContext.Provider as any, { value: { viewer, here } }, el as any)
  // The page and a copy of static/ side by side, with the site's root-relative links made relative.
  const out = ('<!doctype html>' + (await (wrapped as any).toString())).replace(/(href|src)="\/(css|js|img)\//g, '$1="static/$2/')
  writeFileSync(join(dir, name), out)
  console.log('wrote', join(dir, name))
}
await write('shwarm.html', shwarm.here, NodePage({ d: shwarm }))
await write('branch.html', branch.here, NodePage({ d: branch }))
await write('submission.html', '/w/minecraft-in-doom/voxel-renderer/deep-chunk-fix/s/1', SubmissionPage({ d: submission }))
await write('shwarm-closed.html', '/w/minecraft-in-doom', ResultPage({ d: closed }))
await write('profile.html', '/@myra', ProfilePage({ person, profile, all: false, now: T0, inbox }))
