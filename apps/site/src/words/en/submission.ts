// An old submission's page (/w/<path>/s/<n>; nothing takes submissions since Oct 14): what was submitted, its checks
// and its history.
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

  // the state pill at the top right (and beside each submission in the sidebar, and in the inbox). pillSuperseded is
  // also beside the checks box's heading when one was left in review as submissions retired, with no newer one named.
  pillPassed: 'passed',
  pillFailed: 'failed',
  pillSuperseded: 'superseded',
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
  // beside the heading once it passed
  tallyPassed: '{done} of {total} · passed',
  // beside the heading once the author failed it
  tallyReset: 'reset · waiting for a new submission',
  // beside the heading once a newer submission replaced it ({n} is its number)
  tallySuperseded: 'superseded by #{n}',
  // beside the author group: what the author did
  authorPassed: 'passed',
  authorFailedByYou: 'failed by you',
  authorFailed: 'failed',

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

  // the sidebar: the shwarm or branch box
  backToBranch: 'back to the branch →',
  backToShwarm: 'back to the shwarm →',
  // the sidebar: every submission on it
  submissions: 'submissions',
}
