// A submission's page (/w/<path>/s/<n>): what was submitted, its checks, the check form and the author's sign-off.
export const submission = {
  // the browser tab's title. {n} is the submission's number, {title} the shwarm or branch.
  pageTitle: 'submission #{n} · {title} · shwarm',
  // the breadcrumb path's name for screen readers
  crumbsLabel: 'breadcrumb',
  // the end of the breadcrumb path, and the big heading
  heading: 'submission #{n}',
  // the line under the heading. {node} is the shwarm or branch, {by} who submitted it, {when} how long ago, {version}
  // the short fingerprint of what was submitted.
  meta: 'to {node} · by {by} · {when} · version {version}',
  // hover text on that fingerprint ({hash} is the whole thing)
  hashTitle: 'sha256 {hash}',
  // above the done test it answers
  doneWhen: 'done when',
  // under it, when a newer submission replaced this one. {link} is the newer one's number.
  supersededBy: 'superseded by {link}. the checks on this submission stay on the record.',

  // the state pill at the top right (and beside each submission in the sidebar, and in the inbox)
  pillReopened: 'reopened',
  pillApproved: 'passed',
  pillFailed: 'failed',
  pillSuperseded: 'superseded',
  pillWaitingOnYou: 'waiting on you',
  pillWaitingOnAuthor: 'waiting on author',
  pillInReview: 'in review',

  // the box with what was submitted
  whatWasSubmitted: 'what was submitted',
  linked: 'linked',
  nothingLinked: 'nothing linked',
  builtOn: 'built on',
  howToCheck: 'how to check',
  release: 'release',
  // {version} is the release's version
  releaseVersion: 'version {version}',
  howToUse: 'how to use',
  // under it, when the author submitted their own work
  authorSwap: "the author made this submission, so one more person's check takes the place of the author's sign-off.",

  // the checks box: its heading
  checks: 'checks',
  // beside the heading, and beside each group: how many checks are in ({done} and {total} are numbers)
  tally: '{done} of {total}',
  // beside the heading once it passed ({title} is the shwarm or branch)
  tallyDone: '{done} of {total} · {title} is done',
  // beside the heading for a pass that a repro reopened (only before oct 9)
  tallyReopened: '{done} of {total} · passed · reopened when someone showed it failing',
  // a branch's submission that passed its checks: the branch stays open, its pass is its status vote (Oct 13)
  tallyPassedChecks: '{done} of {total} · every check passed',
  // beside the heading once the author failed it
  tallyReset: 'reset · waiting for a new submission',
  // beside the heading once a newer submission replaced it ({n} is its number)
  tallySuperseded: 'superseded by #{n}',
  // beside the author group: what the author did, or how long it has waited on them ({n} is a number of days)
  authorPassed: 'passed',
  authorFailedByYou: 'failed by you',
  authorFailed: 'failed',
  authorWaitingDays: { one: 'waiting {n} day', other: 'waiting {n} days' },
  authorWaiting: 'waiting',
  // the author's own row while it waits on them. {name} is the author.
  authorRowYou: '{name} · you · the last check',

  // the history box: its heading, and what happened. historyBy comes right after the event's word, as its own piece
  // ("submitted" + " by @someone"); {name} is who did it.
  history: 'history',
  historySubmitted: 'submitted',
  historyChecked: 'checked',
  historySignedOff: 'signed off',
  historyPassed: 'passed',
  historyFailed: 'failed the author check',
  historyReopened: 'reopened when someone showed it failing',
  historyBy: 'by {name}',

  // the check form: its heading, and the words beside it
  checkIt: 'check this submission',
  checkItRule: 'one check per person, never on their own work.',
  // in place of the form, signed out. {link} is the sign in link.
  signInToCheck: '{link} to check this submission. agents send run reports with a key.',
  signIn: 'sign in',
  // in place of the form, for someone who can't check this one
  verifyToCheck: 'verify your email to check this submission.',
  cantCheckAgent: "you can't check this submission: your agent made it.",
  cantCheckYours: "you can't check your own submission.",
  alreadyChecked: 'you already checked this submission.',
  // the form: pass or fail (after their round buttons), the two fields, and the button
  yourCheck: 'your check',
  checkPass: ' pass',
  checkFail: ' fail',
  checkText: 'what you checked, or what fails and how to see it',
  links: 'links',
  linksNote: 'one per line: a url and its sha256, or a repo and a full commit id. a pass needs at least one link, to a recording or a rerun.',
  checkNeeds: 'a pass needs evidence. a fail needs steps that show it failing.',
  postCheck: 'post check',

  // the author's sign-off box: its heading, and the words beside it
  signOff: 'your sign-off',
  onlyYou: 'only you see this box',
  yourCall: 'every other check passed. you decide whether this submission meets the done test.',
  // when the author's account is gone and an admin signs off
  asOperator: "the author's account is gone, so you sign off as the operator.",
  // the two choices
  pass: 'pass',
  fail: 'fail',
  // pass: the text box (its name for screen readers, and its grey example text), the note and the button.
  // {title} is the shwarm or branch.
  passLabel: 'what you checked',
  passPlaceholder: 'what you checked: ran it on a clean machine and went through the done test line by line…',
  passNote: 'passing closes {title} as done. confirms with your password.',
  passIt: 'pass it',
  // fail: the same, plus the warning
  failLabel: 'what fails and how to see it',
  failPlaceholder: 'what fails and how to see it: step 2 of how to check crashes on windows. steps…',
  failWarning: 'failing resets every check on this done test. the runs and the people check start over, and the next submission begins from zero.',
  failNote: 'confirms with your password.',
  failIt: 'fail it',

  // the sidebar: the shwarm or branch box
  checkedBy: 'checked by',
  backToBranch: 'back to the branch →',
  backToShwarm: 'back to the shwarm →',
  // the sidebar: every submission on it
  submissions: 'submissions',
  oneADay: 'one submission per person per day.',
}
