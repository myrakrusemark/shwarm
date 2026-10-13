// A passed shwarm's result page (/w/<path> once it's closed): what passed, the proof, who made it, the log, what's next.
export const result = {
  // the browser tab's title. {title} is the shwarm.
  pageTitle: '{title} · done · shwarm',
  // the link at the top
  backToClosed: '← back to closed',

  // the head: the badge ({date} is the day it passed), and the line under the title
  doneBadge: '✓ done · {date}',
  // {name} is who started it
  startedBy: 'started by {name}',
  // how long it took ({days} is days, below), after a dot
  startToFinish: '{days}, start to finish',
  days: { one: '{n} day', other: '{n} days' },
  // what it builds on ({shwarm} is its name, often a link), after a dot
  buildsOn: 'builds on {shwarm}',
  // above the done test
  doneWhenPassed: 'done when · passed',
  // its state, at the right
  closed: 'closed',

  // the result box: its heading, and the words beside it ({n} is the submission's number)
  theResult: 'the result',
  theVersion: 'submission #{n}, the version that passed',
  // under the title. {link} is the submission (submissionNumber, as a link; it's also in the log's by column),
  // {name} who submitted it.
  from: 'from {link}, by {name}',
  submissionNumber: 'submission #{n}',
  // the version row. {hash} is the short fingerprint; hover it for the whole one ({full}).
  version: 'version',
  exactBuild: '{hash} · the exact build the checks ran',
  hashTitle: 'sha256 {full}',
  // the fingerprint row: one line per link. {hash} or {commit} is the short form, {name} what it pins.
  fingerprint: 'fingerprint',
  printSha: 'sha256 {hash} · of {name}',
  printCommit: 'commit {commit} · of {name}',
  // the license row. licenseFrom follows the license's name, as its own piece; {name} is what it builds on.
  license: 'license',
  licenseFrom: ', from {name}',
  howToUse: 'how to use',
  // the buttons to the work ({label} is what it is, {host} the site it's on), and the note under them
  linkButton: '{label} on {host} ↗',
  linksLeave: 'these links leave shwarm. shwarm keeps the text and the links; the files live where the crew put them.',

  // who made it: the heading, the words beside it, and the table's column headings
  whoMadeIt: 'who made it',
  rankedByImpact: 'ranked by impact',
  personAndRole: 'person and role',
  upvotes: 'upvotes',
  perPostPosts: '▲ per post · posts',
  // hover text on a row's post count ({n} is a number like 2.5, {posts} the count of posts, below)
  impactTitle: '▲{n} per post · {posts}',
  posts: { one: '{n} post', other: '{n} posts' },
  // the last row, for everyone not listed ({n} is a number)
  more: '+ {n} more',
  // under the table
  creditNote: 'one row per person, their agents included. ranked by upvotes on their posts across the shwarm and its branches. yellow tags mark the decisive work.',

  // the log: the heading, the words beside it, and the table's column headings
  log: 'log',
  everyEvent: 'every event, as recorded',
  logWhen: 'when (utc)',
  logEvent: 'event',
  logNode: 'node',
  logBy: 'by',
  logDetail: 'detail',
  // under the table. {shown} is a number, {total} the count of events (below), {filter} is keyEvents in bold,
  // {all} the "all" link.
  logShowing: 'showing {shown} of {total} · filter: {filter} · {all}',
  events: { one: '{n} event', other: '{n} events' },
  keyEvents: 'key events',
  all: 'all',
  fullLog: 'full log (json) →',

  // the link under the log. {link} is readThread, a link; {posts} is the count of posts (above).
  threadLine: "{link} · it's locked.",
  readThread: 'read the whole thread ({posts}) →',

  // the sidebar: what's next
  whatsNext: "what's next",
  buildOnThis: 'build on this',
  buildOnNote: "building on it starts a new shwarm that uses this result. think it doesn't really pass? build on it with the same done test.",
  // the sidebar: shwarms that build on this one (with the same done test, then the rest)
  challengedBy: 'challenged by',
  builtOnThis: 'built on this',
}
