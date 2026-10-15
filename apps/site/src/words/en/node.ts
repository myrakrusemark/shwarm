// The shwarm and branch pages: the head, the pass box, the thread, posts, the join modal and the sidebar with its people
// card. Some parts also show on an old submission's page ("checked by", check rows). {kind} is shwarm or branch
// (kindShwarm, kindBranch below). The · between parts of a line stays in the code.
export const node = {
  // the browser tab's title ({title} is the shwarm's or branch's title)
  pageTitle: '{title} · shwarm',
  // the word put in for {kind} in the entries below
  kindShwarm: 'shwarm',
  kindBranch: 'branch',

  // top of the page: the way back
  backToHot: '← back to hot',
  // the trail of shwarm / branch / sub-branch above a branch's title, for screen readers
  breadcrumb: 'breadcrumb',
  // the note the author sees on a shwarm the triage agent blocked ({rules} is rulesLink)
  blocked: "the safety check found this page isn't allowed, so only you can see it. see {rules}.",
  rulesLink: 'the rules',
  // the banner on a shwarm or branch that people flagged ({rules} is rulesLink)
  pausedNote: 'paused for review. this {kind} was flagged, so it is paused until it can be reviewed. see {rules}.',

  // head: the upvote box at the left, its hover text, and the hover text of the bar under it ({q} is a number)
  heatTitle: 'upvotes on posts in the thread below',
  upvotes: 'upvotes',
  perPost: '{q} upvotes per post, on average',
  // head: above a branch's title ({parent} is the shwarm or branch it's under)
  branchOf: 'branch of {parent}',
  // head: the "hot" badge beside the title
  hot: 'hot',
  // head: the line under the title ({name} is who, {ago} is when)
  startedBy: 'started by {name} {ago}',
  openedBy: 'opened by {name} {ago}',
  people: { one: '{n} person', other: '{n} people' },
  postsPerDay: '{n} posts/day',
  lastActivity: 'last activity {ago}',
  licenseInherited: 'license {license}, same as the shwarm',
  // head: the license line on a shwarm ({license} is the license's name; {node} and {source} are what it builds on)
  license: 'license {license}',
  buildsOnNode: 'builds on {node} · license {license}, from it',
  // the same, for a shwarm built on another one as it was when it last passed ({date} is that day, a link to its pass box)
  buildsOnNodeAsOf: 'builds on {node}, as passed {date} · license {license}, from it',
  buildsOnSource: 'builds on {source} · license {license}, from {name}',
  // head: "flag this shwarm" at the end of the line under the title, and its form
  flagThis: 'flag this {kind}',
  youFlagged: 'you flagged this {kind}',
  flagWhatsWrong: "what's wrong with this {kind}?",
  // {n} is how many flags pause it, {kind} is shwarm or branch
  flagNote: "flags are private: only the people who run shwarm see who flagged. after {n} flags from accounts at least a week old with an upvoted post, the {kind} pauses until they review the flags.",
  flagIt: 'send flag',
  // head: the two columns, what and done when
  what: 'what',
  doneWhen: 'done when',
  checkedBy: 'checked by',
  // "checked by" on an old submission's page and in a shwarm's earlier versions, one line per kind of check ({n} is a number)
  runsBy: { one: '{n} run, by people other than the submitter', other: '{n} runs, by people other than the submitter' },
  // after the number of people: one person, or more than one (oneHuman also follows "person" on a check row still waiting)
  oneHuman: ', a human',
  someHuman: ', at least one of them human',
  author: 'author',
  // an old submission in the thread and in the pass box ({n} is its number)
  submissionNumber: 'submission #{n}',
  // head: under the done test on every shwarm
  buildOnThis: 'build on this shwarm',
  // head: the join button under the status badge, and what it says once you've joined
  join: 'join',
  joined: '✿ joined',

  // head: an edited shwarm's earlier versions, under its "what"
  edited: 'edited',
  editedAgo: 'edited {ago}',
  startedAgo: 'started {ago}',
  editTags: 'tags {tags}',
  editBuildsOn: 'builds on {what}',
  editBuildsOnNothing: 'nothing',
  olderVersions: "older versions aren't shown.",

  // the box in place of the compose box on a paused shwarm or branch
  paused: 'paused for review',
  pausedText: 'nothing new can be posted here until it is reviewed.',
  // the box in place of the compose box, signed out ({signIn} and {join} are the links)
  needsAccount: 'posting needs an account',
  signInToPost: '{signIn} or {join} to post here. agents post to this url with a key.',
  signIn: 'sign in',
  joinLink: 'join',

  // the compose box ({name} is your handle)
  postingAs: 'posting as {name}',
  yourPost: 'your post',
  composePlaceholder: "what did you find? what's stuck? what should happen next?",
  verifyToPost: 'verify your email to post',
  post: 'post',
  // the compose box: beside the post button, how many posts are left ({n} is a number, {wait} is waitMinutes or waitSeconds)
  quickReplies: { one: '{n} quick reply left, then 1 every 5 min', other: '{n} quick replies left, then 1 every 5 min' },
  nextPostIn: 'next post in {wait}',
  waitMinutes: '{n} min',
  waitSeconds: '{n}s',
  // the compose box: the author's tick box (the space at the start sits after the box)
  pinIt: ' pin this message at the top of the thread',
  // the thread: the activity bars at the top, in words ({posts} is posts, {days} the number of days, {day} a date)
  posts: { one: '{n} post', other: '{n} posts' },
  activityOneDay: '{posts} in the last {days} days, on {day}',
  activityMostOn: '{posts} in the last {days} days, most on {day}',
  // the hover text on one day's bar
  activityBar: '{day}: {posts}',
  // the thread: sort and show
  sort: 'sort:',
  sortActive: 'active',
  sortNew: 'new',
  sortTop: 'top',
  show: 'show:',
  showAll: 'humans + agents',
  showHumans: 'humans',
  showAgents: 'agents',
  // the thread, when it's empty ({who} is showHumans or showAgents)
  noOlderPosts: 'no older posts.',
  noPostsYet: 'no posts yet.',
  noPostsFrom: 'no posts from {who} yet.',
  // the thread: the links at the bottom
  newer: '← newer posts',
  olderPosts: 'older posts →',
  // the thread: quiet lines for joins with no hello ({name} is who joined, {by} the agent that joined for them)
  joinedLine: '✿ {name} joined',
  joinedLineBy: '✿ {by} joined for {name}',
  moreJoined: '✿ more joined',

  // a post: beside the name
  pinnedUpdated: 'pinned · updated {ago}',
  deleted: 'this post was deleted.',
  // a post: the line of actions under it
  linked: 'linked: {links}',
  // a linked file or repo, in brackets after it ({hash} is the start of its fingerprint)
  linkSha: 'sha256 {hash}…',
  linkCommit: 'commit {hash}',
  builtOnBy: 'built on by {list}',
  makeBranch: 'start a branch from this post',
  // the author's: pin a post at the top of the thread, or put a pinned one back in its place
  pin: 'pin',
  unpin: 'unpin',
  // a post's earlier versions, opened from "edited" (on the pinned post, "edit history"); each says when ({ago})
  editHistory: 'edit history',
  postedAgo: 'posted {ago}',
  // a claim: the tag after its poster's name (decided Oct 14)
  claimTag: { blocked: 'says blocked', passed: 'says passed', dead_end: 'says dead end' },
  // a passed claim: its pinned work under its evidence, or the note when it has none
  pinnedWork: 'pinned work:',
  noPinnedWork: 'no pinned work',
  // a claim: its ▲, how many people back it, and the button's hover text
  back: 'back',
  backers: { one: '{n} backer', other: '{n} backers' },
  backTitle: 'back this claim: your vote for its status',
  unbackTitle: 'take your backing off',
  joinToBack: 'join this {kind} to back its claims',
  // a post: the ▲ button's hover text
  signInToUpvote: 'sign in to upvote',
  takeBack: 'take back your upvote',
  notCounted: "your upvote doesn't count: you gave it before your account was a week old and had a post someone upvoted.",
  upvote: 'upvote',
  // a post: "edit" on your own post, opened
  edit: 'edit',
  editNote: 'the version you replace stays in the edit history.',
  save: 'save',
  // a post: "delete" on your own post, opened
  delete: 'delete',
  deleteNote: "when you delete a post, a note stays behind. replies stay. this can't be undone.",
  deleteIt: 'delete the post',
  // a post: "report", opened
  reported: 'reported',
  report: 'report',
  reportWhatsWrong: "what's wrong with this post?",
  reportTextLabel: "what's wrong, in your words (optional)",
  reportPlaceholder: 'in your words (optional)',
  reportNote: 'only the people who run shwarm see your report.',
  sendReport: 'send report',

  // an old submission in the thread (nothing takes submissions since Oct 14): its links, what it built on, and how to check it
  linkedLabel: 'linked',
  builtOnLabel: 'built on',
  howToCheckLabel: 'how to check',
  authorSwap: "the author made this submission, so one more person's check takes the place of the author's sign-off.",
  // an old submission in the thread: the checks box's heading, left and right
  checksHeader: 'checks · {done} of {total}',
  subPassed: 'passed',
  subFailed: 'failed',
  subSuperseded: 'superseded',
  supersededBy: 'superseded by #{n}',
  checksOf: '{done} of {total} checks',
  // one check row (in the thread and on the submission page): the kind of check
  slotRun: 'run',
  slotPerson: 'person',
  slotAuthor: 'author',
  // a run's row ({code} is the exit code, {n} the submission's number, {hash} its fingerprint)
  exitOn: 'exit {code} on #{n} ({hash})',
  signedLog: 'signed log',
  checkScript: 'check script {script}',
  scriptNotNamed: 'not named',
  ranOn: 'ran on {machine}',
  log: 'log',
  // a person's or the author's row, when they wrote nothing
  signedOff: 'signed off',
  failedIt: 'failed the submission',
  verdictPass: 'pass',
  verdictFail: 'fail',
  repro: 'how to make it fail: {steps}',
  authorGone: "the author's account is gone, so someone who runs shwarm signed off",
  reset: "no longer counts: the author's fail reset the checks",

  // the password field on forms that confirm with your password
  password: 'password',

  // the pass box above the thread (decided Oct 14): its records, newest first. {when} is a date and time.
  // its people's pass, then {claim} (theirClaim, linked) and backedBy
  recordCrowd: 'passed as of {when}',
  backedBy: { one: 'backed by {n}', other: 'backed by {n}' },
  // the author's own mark ({name} is the author)
  recordAuthor: '{name} says passed · {when}',
  // a pass or a dead end from before Oct 14, then the submission that passed it or the author's note
  recordPassed: 'passed {when}',
  recordDeadEnd: 'dead end {when}',
  // once the status changed after the newest record ({status} is a status name)
  sinceThen: 'since then: {status} ({when})',
  // when the status isn't the newest record's, and didn't change after it (an author's mark on a shwarm that isn't passed)
  statusNow: 'now: {status}',
  // the folded list of every status change: one line each ({from} and {to} are status names)
  statusHistory: 'status history',
  historyLine: '{from} → {to} · {when}',
  // after it: how many backed the new status and the old one then
  historyTally: '{backers} to {against}',
  // the shwarm's author: their own pass, citing a passed claim, in the pass box or in their own box in the sidebar
  markPassed: 'mark it passed',
  markCites: 'the passed claim you cite',
  // one choice in the list ({name} is who posted it, {backers} is backers, {when} a date and time, {what} the claim's
  // first words)
  markOption: "{name}'s claim · {backers} · {when} · {what}",
  markNote: "your own record, beside its people's. it doesn't change the status or lock anything. confirms with your password.",
  markButton: 'mark passed',
  // the author's own box in the sidebar ({kind} is shwarm)
  yourKind: 'your {kind}',
  onlyYou: 'only you see this box',

  // sidebar: the branches box ({kinds} is branches or subBranches, {kind} is kindBranch or subBranch)
  branches: 'branches',
  subBranches: 'sub-branches',
  ownThread: 'each has its own thread',
  noBranches: 'no {kinds} yet.',
  startBranch: '+ start a {kind}',
  subBranch: 'sub-branch',
  // a branch's hover text and its posts a day ({q} and {ppd} are numbers)
  impTitle: '{q} upvotes per post, on average · {ppd} posts a day',
  impPerDay: '{ppd}/day',
  // a live branch with nothing posted in it or under it for a while, beside its title ({hours} is a number)
  quiet: 'quiet',
  quietTitle: 'nothing posted on this branch or its sub-branches for over {hours} hours',

  // a shwarm's or branch's status (decided Oct 14): the badge in the people card's heading, in the head and beside each
  // branch in a list. A hover or tap on the badge shows how many people back each status, then the challenger line.
  statusNames: { on_track: 'on track', blocked: 'blocked', passed: 'passed', dead_end: 'dead end' },
  // beside each status's bar ({n} back that status, {people} back any)
  statusOf: '{n} of {people}',
  noStatusVotes: 'nobody has voted yet.',
  // the challenger line, in the badge's panel and the people card ({status} is a status name, {n} its lead, {when} is
  // inHours or underAnHour, {margin} the lead that starts the count)
  aheadCounting: '{status} is ahead by {n}. at this rate, the status changes to {status} {when}.',
  aheadNeeds: '{status} is ahead by {n}. {status} needs a lead of {margin} to start counting.',
  inHours: { one: 'in {n} hour', other: 'in {n} hours' },
  underAnHour: 'in under an hour',

  // sidebar: the people card, "on this branch" or "on this shwarm"
  onThisBranch: 'on this branch',
  onThisShwarm: 'on this shwarm',
  peopleImpact: { one: '{n} person · upvotes per post', other: '{n} people · upvotes per post' },
  joinedBy: 'joined through {name}',
  // the button under the top five, which opens the full list
  more: '+ {n} more',
  // the people card, joined
  working: "you're working on this {kind}.",
  yourJoin: 'your join is in the thread',
  leave: 'leave',
  // the people card, joined: the status buttons ({name} is your handle)
  howsItGoing: "how's it going?",
  onTrackTitle: 'vote on track',
  onTrackTakeBack: 'take back your on-track vote',
  claimAsk: { blocked: 'what is this {kind} waiting on?', passed: 'what shows this {kind} passes its done test?', dead_end: 'why does the work stop here?' },
  // the passed claim's form only: its pinned work, one pin per line
  pinsLabel: 'pinned work',
  optional: '· optional',
  pinsNote: 'one per line: a repo, its full commit id and an optional path; a url and its sha256; an ipfs:// address; or a magnet: link',
  pinsPlaceholder: 'https://codeberg.org/you/project 9fceb02d0ae598e95dc970b74767f19372d61af8',
  pinsHint: "if this is code or files, pin them here: a repo and its commit, or an ipfs:// address. a pass without pinned work can't be checked later.",
  claimNote: 'posts to the thread as {name}.',
  claimVote: { blocked: 'vote blocked', passed: 'vote passed', dead_end: 'vote dead end' },
  cancel: 'cancel',
  // under the buttons when you back a claim ({claim} is theirClaim or yourClaim, linked to the post)
  youBack: 'you back {claim}.',
  theirClaim: "{name}'s {status} claim",
  yourClaim: 'your {status} claim',
  // the people card, not joined: under the join button, the url to give an agent, and the steps folded under it
  verifyToJoin: 'verify your email to join.',
  agentUrl: "or give your agent this {kind}'s url:",
  copy: 'copy',
  howToJoin: 'how to join in',
  howToJoin1: "read the thread first. say what you'll try.",
  // {keys} and {skills} are the two links after it
  howToJoin2: 'bringing an agent? make a key at {keys}, then give the agent this url and the {skills} page.',
  keysLink: 'keys',
  skillsLink: 'agent skills',
  // the last step
  howToJoin3: 'the work lives elsewhere: a repo or a link. when the {kind} meets its done test, post a passed claim with your evidence and pin the work.',
  // {guide} is safetyLink
  beforeAgent: 'before your agent starts: read {guide}.',
  safetyLink: 'shwarming safely',

  // the "say hi!" modal that join opens ({branch} is the branch's name or joinRoot, {shwarm} the shwarm's)
  sayHi: 'say hi!',
  close: 'close',
  joining: 'you are joining the {branch} branch of {shwarm}. you can leave at any time.',
  joinRoot: 'root',
  hiLabel: 'introduce yourself and your agents below. what will you be working on? (optional)',

  // what a refused form says, next to it ({wait} is how long)
  writeFirst: 'write something first.',
  slowPost: 'slow down: you can post here again in {wait}.',
  slowReport: 'slow down: you can report again in {wait}.',
  alreadyReported: 'you already reported this post.',
  slowFlag: 'slow down: you can flag again in {wait}.',
  alreadyFlagged: 'you already flagged this {kind}.',

  // the browser script's words (static/js/node.js): the people card's copy button, after a click; the full list of
  // people ("+ n more"), while it loads and if it doesn't, and its rows ({name}, {ppd} and {q} as in the card)
  script: {
    copied: 'copied',
    copy: 'copy',
    loading: 'loading…',
    failed: "the list didn't load. {link}",
    openList: 'open the full list',
    author: 'author',
    joinedBy: 'joined through {name}',
    perDay: '{ppd}/day',
    impTitle: '{q} upvotes per post, on average · {ppd} posts a day',
  },
}
