// The form that starts a shwarm or a branch (/new).
export const create = {
  // the browser tab's title: for a new shwarm, and for a new branch ({title} is the shwarm or branch it goes under)
  pageTitle: 'new shwarm · shwarm',
  branchPageTitle: 'new branch · {title} · shwarm',
  // the big heading, and the line under it: for a new shwarm
  heading: 'new shwarm',
  sub: 'a goal worth a crowd. your shwarm goes live after a quick safety check.',
  // the same for a new branch (the heading is also the last part of the breadcrumb path above it)
  branchHeading: 'new branch',
  branchSub: 'your branch goes live after a quick safety check. people are already working here.',
  // the breadcrumb path's name for screen readers
  crumbsLabel: 'breadcrumb',

  // the box at the top when you're signed in but haven't verified your email
  verifyFirst: 'verify your email to start a shwarm. the link is in your inbox.',

  // branch only: the box that shows the shwarm the branch helps. {title} is its title.
  helpingReach: 'helping reach',
  parentDoneWhen: '{title} is done when',
  helpingReachHint: "your branch doesn't have to finish the shwarm or branch it's under, only move it closer.",

  // the title field
  title: 'title',
  // the what field, and the hint under it (for a shwarm, then for a branch)
  what: 'what',
  pitchHint: 'what is your shwarm, why is it worth doing, and why now?',
  branchPitchHint: "what is stuck or missing, and how your branch helps finish the shwarm or branch it's under.",
  // the done when field, and the hint under it (for a shwarm, then for a branch)
  doneWhen: 'done when',
  doneHint: 'what is true when the work is finished. people join for the finish line as much as for the idea.',
  branchDoneHint: 'what is true when the branch is finished. people on the branch say so with a passed claim and their evidence, and the others back it.',

  // the grey example text inside the empty fields, for a new shwarm
  placeTitle: 'solve warp travel',
  placeWhat: "star trek's warp drive may not stay fiction. physicists have published warp bubbles that work on paper, but the claims are scattered and few have been checked. together we can gather them, check the math in the open, and find one a lab could test…",
  placeDone: 'an open simulation of one published warp bubble predicts a result a real lab could measure, the lab setup is written down, and 2 checkers rerun the simulation and get the same numbers.',
  // the same, for a new branch
  branchPlaceTitle: 'redo the alcubierre math',
  branchPlaceWhat: "the 1994 alcubierre paper started it all, but its energy numbers have been revised many times since, and nobody here has redone them yet…",
  branchPlaceDone: "an open notebook recomputes the energy the alcubierre bubble needs and matches the paper's number.",

  // shwarm only: the note under the done test. {newShwarm} is lockNoteNew, in bold.
  lockNote: "the done test can't change once it's posted. people join for this finish line, so a different one means {newShwarm}.",
  lockNoteNew: 'starting a new shwarm',

  // shwarm only: the tags field
  tags: 'tags',
  tagsHint: 'how people find your shwarm. no categories, just tags.',
  tagsPlaceholder: '#maps #books #open-data',
  // shwarm only: the builds on field
  buildsOn: 'builds on',
  optional: '· optional',
  buildsOnHint: 'an open project your shwarm extends: a shwarm here, a github repo, or any other link.',
  buildsOnPlaceholder: "https://github.com/… or a shwarm's link",
  // the box under it naming the shwarm it builds on. {path} is its address.
  pickedLine: '/w/{path}',
  // after it, when that shwarm has passed: the pass your shwarm builds on ({date} is its day)
  pickedAsOf: 'as passed {date}',
  // a smaller field for any other link (also its name for screen readers)
  buildsOnName: "the project's name (other links)",
  buildsOnFillHint: 'github and shwarm links fill in their name by themselves.',

  // beside the button at the bottom (for a shwarm, then for a branch, where {title} is what it goes under)
  goNote: "a quick safety check reads your shwarm first, usually within a minute. until then only you can see it. after that it's live, and anyone can work on it.",
  branchGoNote: "a quick safety check reads your branch first, usually within a minute. until then only you can see it. after that it's live under {title}, and anyone can work on it.",
  // in bold after that
  fixedNote: 'once posted, nothing on this form can be changed.',
  // the button
  go: 'start shwarm',
  branchGo: 'start branch',

  // the sidebar: the rules
  rules: 'the rules',
  rulesAll: 'there are only three',
  ruleCheckable: 'checkable.',
  ruleCheckableText: ' say how anyone can tell the goal is done.',
  ruleOpen: 'open.',
  // everything posted here is MIT, with no picker (decided Oct 15); a crew names its work's own license in its words
  ruleOpenText: " everything posted here is MIT. if your work has its own license, say so in your shwarm's words or its repo's license file.",
  ruleHarmless: 'harmless.',
  ruleHarmlessText: ' nothing here hurts people.',
  // the note under the rules. {rubric} is the link (triageRubric).
  triageNote: 'a safety check reads every new shwarm and branch before anyone else sees it. the check only looks for harm, never at whether an idea is good. {rubric}',
  triageRubric: 'see what the check is asked.',

  // in place of the form, while new shwarms are paused
  paused: 'starting new shwarms and branches is paused for now. posting, joining and backing claims still work.',
  // the error page for a /new?parent= address that leads nowhere
  noNode: 'there is no shwarm or branch at this address.',
  // at the top of the form: too many new shwarms today. {wait} is a time like "about 3 hours".
  rateLimited: "you've started 3 shwarms and branches in the last 24 hours, the most for one person. you can start another in {wait}.",
  // at the top of the form: something wrong in builds on
  buildsOnNotLink: "builds on needs a web link, or a shwarm's address",
  buildsOnNotWeb: 'builds on needs a web link, starting with https:// or http://',
}
