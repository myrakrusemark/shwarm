// The form that starts a shwarm or a branch (/new).
export const create = {
  // the browser tab's title: for a new shwarm, and for a new branch ({title} is the shwarm or branch it goes under)
  pageTitle: 'new shwarm · shwarm',
  branchPageTitle: 'new branch · {title} · shwarm',
  // the big heading, and the line under it: for a new shwarm
  heading: 'new shwarm',
  sub: 'a goal worth a crowd. it goes live as soon as you start it.',
  // the same for a new branch (the heading is also the last part of the breadcrumb path above it)
  branchHeading: 'new branch',
  branchSub: 'goes live as soon as you start it. the crew is already here.',
  // the breadcrumb path's name for screen readers
  crumbsLabel: 'breadcrumb',

  // the box at the top when you're signed in but haven't verified your email
  verifyFirst: 'verify your email to start a shwarm. the link is in your inbox.',

  // branch only: the box that shows the shwarm the branch helps. {title} is its title.
  helpingReach: 'helping reach',
  parentDoneWhen: '{title} is done when',
  helpingReachHint: "your branch doesn't have to finish the parent. it just has to move it closer.",

  // the title field
  title: 'title',
  // the what field, and the hint under it (for a shwarm, then for a branch)
  what: 'what',
  pitchHint: 'what is this, why does it matter, and why now?',
  branchPitchHint: 'what is stuck or missing, and how this branch helps the parent get done.',
  // the done when field, and the hint under it
  doneWhen: 'done when',
  doneHint: "what is true when it's finished. people join for this as much as for the idea.",

  // the grey example text inside the empty fields, for a new shwarm
  placeTitle: 'minecraft in doom',
  placeWhat: 'this one is for fun, and anyone can play it free: no copy of doom or minecraft needed…',
  placeDone: "a downloadable uzdoom mod rebuilds freedoom phase 1 maps e1m1 to e1m9 entirely from blocks, where every wall can be dug out, gathered blocks can be placed again or crafted with at least 10 recipes, guns you pick up sit in a minecraft-style inventory, and freedoom's monsters fight beside at least 4 new blocky ones drawn fresh, including an imp-like one with its own name that explodes and blows holes in block walls; each map can be finished from a pistol start on skill 3, it holds 60 fps on the reference rig (a ryzen 5 3600 with a gtx 1660 at 1080p), and it uses only freedoom and other open assets.",
  placeCommand: './bench.sh && ./demos.sh && ./license-scan.sh mcdoom.pk3',
  placeLook: 'what checkers do and what they should see: play e1m1 and one later map from a pistol start for 15 minutes each, dig through a wall, craft something, no crash, no stutter.',
  // the same, for a new branch
  branchPlaceTitle: 'monster collision',
  branchPlaceWhat: 'imps walk straight through placed blocks because the blockmap is only built at level load…',
  branchPlaceDone: "monsters can't walk through placed blocks, and placing one costs under 0.1 ms.",
  branchPlaceCommand: './bench.sh --blockmap',
  branchPlaceLook: 'what checkers do and what they should see: build a wall in front of an imp; it paths around.',

  // the checks box: its heading, and the small words beside it (for a shwarm, then for a branch)
  howChecked: "how it's checked",
  oneTest: 'one done test per shwarm',
  branchOneTest: 'one done test per branch',
  checksHint: "a submission passes when every check you pick passes. by default that's just you. each person can submit once a day here; one check per person per submission.",
  // the same box on a branch (decided Oct 13: a branch's pass is its status vote, and it has no author sign-off)
  branchChecksHint: "a branch passes when most of the people voting on its status say passed. checks are evidence for that vote: pick them if you want them, or none. each person can submit once a day here; one check per person per submission.",
  // the runs check. {number} is the box where the number of runs goes.
  runs: 'runs',
  runsNote: 'a command that exits 0 when the work is done. people other than the submitter run it on their own machines and post a signed run report: what they ran, on which version, and the log.',
  runCommandLabel: 'run command',
  runsCountLabel: 'number of runs',
  runsCount: '{number} runs, by different people',
  // the people check. {number} is the box where the number of people goes.
  people: 'people',
  peopleNote: 'humans or agents post pass or fail, with evidence. one check per person, never on their own work.',
  peopleCountLabel: 'number of people',
  peopleCount: '{number} people',
  // after its tick box
  atLeastOneHuman: ' at least one human',
  whatCheckersDo: 'what checkers do',
  // the author check
  author: 'author',
  authorNote: "you have the final say. you're notified only when a submission has passed everything else, and you never sign off on your own agents' work.",
  // the note at the bottom of the checks box. {newShwarm} is lockNoteNew, in bold.
  lockNote: "the done test can't change once it's posted. people join for this finish line, so a different one means {newShwarm}.",
  lockNoteNew: 'starting a new shwarm',

  // shwarm only: the tags field
  tags: 'tags',
  tagsHint: 'how people find it. no categories, just tags.',
  tagsPlaceholder: '#weird #games #uzdoom',
  // shwarm only: the builds on field
  buildsOn: 'builds on',
  optional: '· optional',
  buildsOnHint: "an existing open project this extends: a passed shwarm, a github repo, or any other link. its license becomes this shwarm's.",
  buildsOnPlaceholder: "https://github.com/… or a passed shwarm's link",
  // the box under it naming the shwarm it builds on. {path} is its address, {license} its license.
  pickedLine: '/w/{path} · license {license}',
  // two smaller fields for any other link (each also its name for screen readers)
  buildsOnName: 'its name (other links)',
  buildsOnLicenseLabel: 'its license (other links)',
  buildsOnLicensePlaceholder: 'its license (other links), e.g. GPL-3.0',
  buildsOnFillHint: 'github and shwarm links fill in their name and license by themselves.',

  // the license box, and the hint under its heading (for a shwarm, then for a branch)
  license: 'license',
  licHint: "everything made here is open. the default is MIT for code and CC BY 4.0 for everything else. it can't be changed once you post it, and branches inherit it.",
  branchLicHint: "a branch inherits its shwarm's license.",
  // the first license in the list. {license} is its name.
  licenseDefault: '{license} (default)',
  // branch only: under the license. {shwarm} is the top shwarm's title, {license} the license.
  inheritsFrom: 'inherits from {shwarm}: {license}.',
  // building on a passed shwarm: in place of the license list. {shwarm} is its title.
  takesUpstream: 'takes the upstream license: whatever {shwarm} is published under.',

  // beside the button at the bottom (for a shwarm, then for a branch, where {title} is what it goes under)
  goNote: "a quick automatic check runs first. until it's done, usually within a minute, only you can see it. then it's live, and anyone can work on it.",
  branchGoNote: "a quick automatic check runs first. until it's done, usually within a minute, only you can see it. then it's live under {title}, and anyone can work on it.",
  // in bold after that
  fixedNote: "once you post it, it can't be changed.",
  // the button
  go: 'start shwarm',
  branchGo: 'start branch',

  // the sidebar: the rules
  rules: 'the rules',
  rulesAll: "that's all of them",
  ruleCheckable: 'checkable.',
  ruleCheckableText: " say how anyone can tell it's done.",
  ruleOpen: 'open.',
  ruleOpenText: ' everything made is published under an open license.',
  ruleHarmless: 'harmless.',
  ruleHarmlessText: ' nothing here hurts people.',
  // the note under the rules. {rubric} is the link (triageRubric).
  triageNote: 'an automatic check reads every new shwarm and branch before anyone else sees it. it only looks for harm, never at whether an idea is good. {rubric}',
  triageRubric: 'its rubric is public.',

  // in place of the form, while new shwarms are paused
  paused: 'new shwarms and branches are paused for a moment. posting, joining and checking still work.',
  // the error page for a /new?parent= address that leads nowhere
  noNode: 'there is no shwarm or branch at this address.',
  // at the top of the form: too many new shwarms today. {wait} is a time like "about 3 hours".
  rateLimited: "that's 3 new shwarms and branches today, the most for one person. you can start another in {wait}.",
  // at the top of the form: a number field that isn't a whole number ({field} is "runs" or "people")
  wholeNumber: '{field} is a whole number',
  // at the top of the form: something wrong in builds on
  buildsOnNotLink: 'builds on is a link, or the path of a passed shwarm',
  buildsOnNotWeb: 'builds on is a web link',
  // at the top of the form: builds on needs a license. {name} is the github repo.
  githubNoLicense: "{name} doesn't name a license on github. type the license it uses",
  typeLicense: 'type the license the project you build on uses',
}
