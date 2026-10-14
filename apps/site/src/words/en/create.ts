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
  // the done when field, and the hint under it
  doneWhen: 'done when',
  doneHint: 'what is true when the work is finished. people join for the finish line as much as for the idea.',

  // the grey example text inside the empty fields, for a new shwarm
  placeTitle: 'map every place sherlock holmes went',
  placeWhat: 'the stories name hundreds of real streets, towns and moors. one open map would let anyone follow the cases…',
  placeDone: 'an open geojson file lists every named real-world place in all 60 stories with coordinates and the quote that names it, and 2 checkers find at least 97 of 100 random rows correct.',
  placeCommand: './validate.sh places.geojson',
  placeLook: 'what checkers do and what they should see: pick 10 random rows, find each quote in its story, and look up the place on a map.',
  // the same, for a new branch
  branchPlaceTitle: 'places in the four novels',
  branchPlaceWhat: 'the short stories are mapped, but nobody has started on the four novels yet…',
  branchPlaceDone: 'every named real-world place in the four novels is in places.geojson, with coordinates and the quote that names it.',
  branchPlaceCommand: './validate.sh places.geojson --novels',
  branchPlaceLook: 'what checkers do and what they should see: pick 5 rows from the novels and find each quote in the text.',

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
  tagsHint: 'how people find your shwarm. no categories, just tags.',
  tagsPlaceholder: '#maps #books #open-data',
  // shwarm only: the builds on field
  buildsOn: 'builds on',
  optional: '· optional',
  buildsOnHint: "an open project your shwarm extends: a passed shwarm, a github repo, or any other link. that project's license becomes your shwarm's.",
  buildsOnPlaceholder: "https://github.com/… or a passed shwarm's link",
  // the box under it naming the shwarm it builds on. {path} is its address, {license} its license.
  pickedLine: '/w/{path} · license {license}',
  // two smaller fields for any other link (each also its name for screen readers)
  buildsOnName: "the project's name (other links)",
  buildsOnLicenseLabel: "the project's license (other links)",
  buildsOnLicensePlaceholder: "the project's license (other links), e.g. GPL-3.0",
  buildsOnFillHint: 'github and shwarm links fill in their name and license by themselves.',

  // the license box, and the hint under its heading (for a shwarm, then for a branch)
  license: 'license',
  licHint: "everything made here is open. the default is MIT for code and CC BY 4.0 for everything else. the license can't be changed once you post, and branches inherit it.",
  branchLicHint: "a branch inherits its shwarm's license.",
  // the first license in the list. {license} is its name.
  licenseDefault: '{license} (default)',
  // branch only: under the license. {shwarm} is the top shwarm's title, {license} the license.
  inheritsFrom: 'inherits from {shwarm}: {license}.',
  // building on a passed shwarm: in place of the license list. {shwarm} is its title.
  takesUpstream: 'your shwarm uses the license {shwarm} is published under.',

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
  ruleOpenText: ' everything made is published under an open license.',
  ruleHarmless: 'harmless.',
  ruleHarmlessText: ' nothing here hurts people.',
  // the note under the rules. {rubric} is the link (triageRubric).
  triageNote: 'a safety check reads every new shwarm and branch before anyone else sees it. the check only looks for harm, never at whether an idea is good. {rubric}',
  triageRubric: 'see what the check is asked.',

  // in place of the form, while new shwarms are paused
  paused: 'starting new shwarms and branches is paused for now. posting, joining and checking still work.',
  // the error page for a /new?parent= address that leads nowhere
  noNode: 'there is no shwarm or branch at this address.',
  // at the top of the form: too many new shwarms today. {wait} is a time like "about 3 hours".
  rateLimited: "you've started 3 shwarms and branches in the last 24 hours, the most for one person. you can start another in {wait}.",
  // at the top of the form: a number field that isn't a whole number ({field} is "runs" or "people")
  wholeNumber: '{field} needs a whole number, like 2',
  // at the top of the form: something wrong in builds on
  buildsOnNotLink: "builds on needs a web link, or a passed shwarm's address",
  buildsOnNotWeb: 'builds on needs a web link, starting with https:// or http://',
  // at the top of the form: builds on needs a license. {name} is the github repo.
  githubNoLicense: "{name} doesn't name a license on github. type the license it uses",
  typeLicense: 'type the license the project you build on uses',
}
