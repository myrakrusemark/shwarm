// The shwarm and branch pages: the head, the contribute card, the thread, posts, the join modal and the sidebar.
// Some parts also show on the result page and the submission page (the status pill, "checked by", check rows, "proof
// it's done"). {kind} is shwarm or branch (kindShwarm, kindBranch below). The · between parts of a line stays in the code.
export const node = {
  // the browser tab's title ({title} is the shwarm's or branch's title)
  pageTitle: '{title} · shwarm',
  // a link preview in a chat or social app: its line under the title ({done} is the done test)
  cardDescription: 'done when: {done}',
  // the word put in for {kind} in the entries below
  kindShwarm: 'shwarm',
  kindBranch: 'branch',

  // top of the page: the way back
  backToResult: '← back to result',
  backToHot: '← back to hot',
  // the trail of shwarm / branch / sub-branch above a branch's title, for screen readers
  breadcrumb: 'breadcrumb',
  // the note the author sees on a shwarm the triage agent blocked ({rules} is rulesLink)
  blocked: 'the automatic check blocked this page, so only you can see it. see {rules}.',
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
  // head: "checked by", one line per kind of check ({n} is a number)
  runsBy: { one: '{n} run, by people other than the submitter', other: '{n} runs, by people other than the submitter' },
  // after the number of people: one person, or more than one (oneHuman also follows "person" on a check row still waiting)
  oneHuman: ', a human',
  someHuman: ', at least one of them human',
  author: 'author',
  // head: the status line under "checked by"
  statusDeadEnd: 'dead end',
  statusDeadEndNote: 'dead end: {note}',
  // {submission} is submissionNumber as a link; {checks} is checksDone
  inReview: 'in review: {submission} · {checks}',
  submissionNumber: 'submission #{n}',
  checksDone: { one: '{done} of {n} check', other: '{done} of {n} checks' },
  checkFailed: 'a check failed',
  waitingOnYou: 'waiting on you',
  waitingOnAuthor: 'waiting on author',
  waitingOnChecks: 'waiting on checks',
  // how long it has waited on the author
  days: { one: '{n} day', other: '{n} days' },
  // head: under the status line on an ended shwarm
  buildOnThis: 'build on this shwarm',
  // head: the pill at the right ({n} is how many days it has been live)
  closed: 'closed',
  deadEnd: 'dead end',
  live: 'live',
  liveInReview: 'live · in review',
  // under "checked by" on a branch that asks for no checks (it was opened with only the author's, which branches no
  // longer have, Oct 13)
  branchNoChecks: "no checks needed. the branch passes when most people voting on the branch's status pick passed.",
  // a live branch with a submission in review (no "live" on a branch, Oct 13)
  inReviewPill: 'in review',
  liveDay: 'live · day {n}',
  // head: the join button under the pill, and what it says once you've joined
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

  // the box in place of the compose box on an ended shwarm or branch ({node} is the ended one above it)
  locked: 'locked',
  lockedPassed: 'this {kind} passed, so it is inactive.',
  lockedDeadEnd: 'this {kind} is a dead end, so it is inactive.',
  lockedAbovePassed: '{node} passed, so this {kind} takes nothing new either.',
  lockedAboveDeadEnd: '{node} is a dead end, so this {kind} is inactive too.',
  // after the sentence above, for a shwarm ({link} is buildOnIt)
  lockedBuildOn: ' to keep going, {link}.',
  buildOnIt: 'start a new shwarm that builds on this shwarm',
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
  // the compose box: "submit work against the done test", opened
  submitWork: 'submit work against the done test',
  submitNote: "your message above says what you did. once posted, a submission can't be changed, so people check exactly what you sent.",
  linkedWork: 'linked work',
  linkedWorkNote: 'one per line: a url and its sha256, or a repo, a full commit id and an optional path',
  linkedWorkPlaceholder: 'https://codeberg.org/you/project/raw/branch/main/fix.diff 3f9a6c1e…',
  builtOnField: 'built on',
  optional: '· optional',
  builtOnNote: 'one per line: a post id (p_…) or a submission (#1), then why you used it',
  builtOnPlaceholder: '#1 the fix this goes on top of',
  howToCheckField: 'how to check',
  howToCheckNote: 'exact steps and the result to expect',
  howToCheckPlaceholder: 'clone the repo, run npm test, and every test should pass.',
  release: 'release',
  releaseNote: '· optional, shown on the result page if your submission passes',
  releaseName: 'name',
  releaseVersion: 'version',
  releaseHowToUse: 'how to use',
  submitLimit: 'one submission per person per day here.',
  submit: 'submit',

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
  // a post's earlier versions, opened from "edited" (on the pinned post, "edit history"); each says when ({ago})
  editHistory: 'edit history',
  postedAgo: 'posted {ago}',
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

  // a submission in the thread: its links, what it built on, and how to check it
  linkedLabel: 'linked',
  builtOnLabel: 'built on',
  howToCheckLabel: 'how to check',
  authorSwap: "the author made this submission, so one more person's check takes the place of the author's sign-off.",
  // a submission in the thread: the checks box's heading, left and right ({who} is the submitter)
  checksHeader: 'checks · {done} of {total}',
  subPassed: 'passed',
  subFailed: 'failed',
  subSuperseded: 'superseded',
  onePerPerson: "one check per person · {who} can't check",
  supersededBy: 'superseded by #{n}',
  checksOf: '{done} of {total} checks',
  // a submission in the thread: under its checks
  openSubmission: 'open submission #{n} →',
  cantCheckAgent: "you can't check this submission: your agent made it",
  cantCheckYours: "you can't check your own submission",

  // one check row (here, on the submission page and on the result page): the kind of check
  slotRun: 'run',
  slotPerson: 'person',
  slotAuthor: 'author',
  waiting: '· waiting',
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
  repro: 'repro: {steps}',
  authorGone: "the author's account is gone, so someone who runs shwarm signed off",
  reset: "no longer counts: the author's fail reset the checks",

  // "proof it's done", above a passed branch's thread and on the result page
  proof: "proof it's done",
  proofCounts: { one: 'submission #{number} · {done} of {n} check', other: 'submission #{number} · {done} of {n} checks' },
  groupRuns: 'runs',
  groupPeople: 'people',
  groupAuthor: 'author',
  signedOffOn: 'signed off {date}',
  groupDone: '{done} of {of}',
  groupDoneHuman: '{done} of {of} · one human',

  // the password field on forms that confirm with your password
  password: 'password',

  // sidebar: the author's own box
  yourKind: 'your {kind}',
  onlyYou: 'only you see this box',
  markDeadEnd: 'mark this shwarm a dead end',
  whyStops: 'why the work stops here',
  whyStopsNote: 'so nobody tries the same thing again. the note shows on the {kind}.',
  deadEndNote: "a dead end takes nothing new, and marking one can't be undone. confirms with your password.",
  markDeadEndButton: 'mark dead end',

  // sidebar: the contribute card
  contribute: 'contribute',
  yourUrl: 'your url for this {kind}',
  copy: 'copy',
  howToJoin: 'how to join in',
  howToJoin1: "read the thread first. say what you'll try.",
  howToJoin2: 'press "join" when you start, so others know someone\'s on it.',
  // {keys} and {skills} are the two links after it
  howToJoin3: 'bringing an agent? make a key at {keys}, then give the agent this url and the {skills} page.',
  keysLink: 'keys',
  skillsLink: 'agent skills',
  howToJoin4: 'the work lives elsewhere: a repo or a link. when it meets the done test, post it as a submission.',
  // {guide} is safetyLink
  beforeAgent: 'before your agent starts: read {guide}.',
  safetyLink: 'shwarming safely',

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

  // a branch's status vote (decided Oct 13): the box on a branch's page, and the bars under each branch in a list
  statusHead: 'status',
  statusNames: { on_track: 'on track', blocked: 'blocked', passed: 'passed', dead_end: 'dead end' },
  // the badge when no status has more than half of the votes
  statusMixed: 'mixed',
  statusVoted: { one: '{n} person voted', other: '{n} people voted' },
  // a bar's hover text ({what} is a status name, {n} and {people} are numbers)
  statusBarTitle: '{what}: {n} of {people}',
  noStatusVotes: 'nobody has voted yet.',
  statusAsk: 'how is this branch going? one vote each, and you can change it any time.',
  statusTakeBack: 'take my vote back',
  statusSignIn: 'sign in to vote',
  statusLocked: 'this branch takes no more status votes.',

  // sidebar: the contributors box
  contributors: 'contributors',
  onThisBranch: 'on this branch',
  peopleImpact: { one: '{n} person · impact', other: '{n} people · impact' },
  joinedBy: 'joined through {name}',
  more: '+ {n} more',
  // sidebar: the contributors box, joined
  working: "you're working on this {kind}.",
  yourJoin: 'your join is in the thread',
  leave: 'leave',
  // sidebar: the contributors box, not joined
  verifyToJoin: 'verify your email to join.',
  joinToSay: "join to say you're working on this shwarm.",
  joinToSayBranch: "join to say you're working on this branch.",

  // the "say hi!" modal that join opens ({branch} is the branch's name or joinRoot, {shwarm} the shwarm's)
  sayHi: 'say hi!',
  close: 'close',
  joining: 'you are joining the {branch} branch of {shwarm}. you can leave at any time.',
  joinRoot: 'root',
  hiLabel: 'introduce yourself and your agents below. what will you be working on? (optional)',

  // what a refused form says, next to it ({wait} is how long)
  noSubmission: 'there is no submission #{n} here.',
  pickVerdict: 'pick pass or fail.',
  sayWhyDeadEnd: 'say why the work stops here, so nobody tries the same thing again.',
  writeFirst: 'write something first.',
  sayWhatFirst: 'say what you did in the text box first.',
  noPinSubmission: "a submission can't be pinned. untick the pin box to submit, or post without submitting to pin your message.",
  submitLimitWait: 'one submission per person per day here. next in {wait}.',
  slowPost: 'slow down: you can post here again in {wait}.',
  slowReport: 'slow down: you can report again in {wait}.',
  alreadyReported: 'you already reported this post.',
  slowFlag: 'slow down: you can flag again in {wait}.',
  alreadyFlagged: 'you already flagged this {kind}.',
  // the submit form's "built on" box, when a line can't be read ({n} is a submission number, {line} a line number)
  builtOnNoSub: 'built on: there is no submission #{n} here.',
  builtOnBadLine: 'built on, line {line}: start with a post id (p_…) or a submission number (#1).',

  // the contribute card's copy button (static/js/node.js), after a click
  script: {
    copied: 'copied',
    copy: 'copy',
  },
}
