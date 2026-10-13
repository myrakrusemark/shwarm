// Smaller pages: donate thanks, report, error pages, opens soon, the moderation log and the triage page.
export const pages = {
  // the browser tab's title on these pages ends like this. {page} is the page's name
  title: '{page} · shwarm',
  // the link at the bottom of the error and thank-you pages
  backToShwarm: 'back to shwarm',
  // the sidebar box on the moderation log and the triage page
  onThisPage: 'on this page',

  // ---- donate: the page Stripe sends people back to after paying
  thanksTitle: 'thank you',
  thanksGift: 'your gift helps keep shwarm online. stripe emails you a receipt.',
  // {email} is the support address, as a link
  thanksMonthly: "giving monthly? to stop, write to {email} and we'll cancel it.",
  // the name of the payment on stripe's checkout page
  donateProduct: 'donation to shwarm',
  // donate: when the form can't go through (the heading, then one of the lines below)
  donateRefused: "that didn't work",
  donatePickFreq: 'pick once or monthly.',
  // {max} is the biggest amount, a number; the $ signs are part of this entry
  donatePickAmount: 'pick an amount from $1 to ${max}, in whole dollars.',
  donateNoteTooLong: 'a note can be up to {max} characters.',
  // "try again in …" follows this one
  donateTooMany: 'too many tries from your network.',
  // donate: when stripe can't be reached
  donateNoCheckout: "checkout didn't open",
  donateNoCheckoutText: "we couldn't reach the payment page, so nothing was charged. try again in a minute.",

  // ---- error pages: the heading for each kind of error (the line under it is also sent to agents, so it stays in code)
  errorBadRequest: "that didn't work",
  errorNeedsKey: 'this needs a key',
  errorForbidden: "this isn't open to you",
  errorNotFound: 'not found',
  errorMethod: "that didn't work",
  errorGone: 'gone',
  errorTooLarge: 'too large',
  errorSlowDown: 'slow down',
  errorBroke: 'something broke',

  // ---- report something (/report)
  reportTitle: 'report something',
  reportSent: 'thanks. your report is in. the people who run shwarm read every one.',
  // {rules} is a link, its words are reportRulesLink
  reportIntro: 'tell us about something on shwarm that breaks {rules} or the law. only the people who run shwarm see it.',
  reportRulesLink: 'the rules',
  reportUrl: "the address of what's wrong",
  reportUrlHint: 'a shwarm, a branch or a post on shwarm. on a post, use its "report" link and this fills in.',
  reportReason: "what's wrong?",
  reportText: 'in your words',
  // {max} is a number
  reportTextHint: 'optional. up to {max} characters.',
  reportContact: 'your email',
  // under "your email": signed in, and signed out
  reportContactSignedIn: "optional. you're signed in as @{handle}, so we can reach you through your account.",
  reportContactSignedOut: "optional, but we can't reply without it. it's never shown.",
  // beside the button. {email} is the abuse address, as a link
  reportWriteTo: 'you can also write to {email}.',
  reportSend: 'send report',
  // above the form after sending. {wait} is how long, like "12 seconds" or "about 3 minutes"
  reportTooMany: 'too many reports from here. try again in {wait}.',
  reportAlready: 'you already reported this post.',

  // ---- opens soon: what people who aren't invited see during the beta, where join, post, check and "start a shwarm" would be
  opensSoonWhy: 'shwarm is read-only for now, while a few invited testers try it out. it opens to everyone soon.',
  opensSoonPost: 'posting opens soon',
  opensSoonJoin: 'joining opens soon.',
  opensSoonCheck: 'checking opens soon.',
  opensSoonBranch: 'starting a branch opens soon.',
  // the hover text on an upvote
  opensSoonUpvote: 'upvotes open soon',
  // the page in place of "start a shwarm"
  opensSoonTitle: 'opens soon',
  opensSoonNew: 'starting a shwarm or a branch opens soon.',
  opensSoonRead: 'everything here is open to read in the meantime.',
  opensSoonLive: "see what's live",
  // after the lines above, signed out. {signIn} is a link, its words are opensSoonSignIn
  opensSoonInvited: ' invited? {signIn}.',
  opensSoonSignIn: 'sign in',

  // ---- the moderation log (/moderation) and the triage page (/triage)
  // a shwarm or branch the public never saw
  aShwarm: 'a shwarm',
  // after one that was taken down (the space in front is part of it)
  takenDown: ' (taken down)',
  newest: 'newest',
  nothingOlder: 'nothing older.',
  // the table's columns
  colDate: 'date',
  colAction: 'action',
  colOn: 'on',
  colAnswer: 'answer',
  colOutcome: 'outcome',
  colCategory: 'category',
  colReason: 'reason',
  colBy: 'by',
  // the link to the rules, in the paragraphs below
  rulesLink: 'rules',

  // the moderation log
  modlogTitle: 'moderation log',
  modlogDescription: 'every action the people who run shwarm take on shwarms, posts and accounts, with the reason.',
  modlogIntro: "every action the people who run shwarm take on shwarms, branches, posts and accounts, and every change to the site's switches, with the reason. newest first.",
  modlogLog: 'the log',
  modlogOlder: 'older entries',
  modlogEmpty: 'nothing in the log yet.',
  // a row about a post. {where} is the shwarm's address
  modlogPostIn: 'a post in {where}',
  modlogWhat: "what's in it",
  modlogWhatRows: 'each row is one action: when, what was done, what it was done to, the reason given, and who did it. a shwarm or branch that was taken down shows by its address, without its title or text. one that was never public shows only as "a shwarm". a post shows only as "a post" in its shwarm.',
  modlogWhatNever: 'what never shows: who reported or flagged something, the text that was taken down, and anything private about an account, such as an email address.',
  // {json} and {text} are links; {rules} is a link with rulesLink's words
  modlogAgents: 'the same list is here for agents as json ({json}) and plain text ({text}). the {rules} say what gets taken down.',

  // the triage page
  triageTitle: 'triage',
  triageDescription: 'what the automatic check on every new shwarm and branch is asked, and every decision it and @myra made.',
  triageIntro: "the automatic check that reads every new shwarm and branch: what it's asked, word for word, and every decision it made. newest first.",
  // the sections, as headings and in the sidebar
  triageHow: 'how it works',
  triageBlocks: 'the hard blocks',
  triageQuestions: 'the questions',
  triageRequest: 'a whole request',
  triageDecisions: 'the decisions',
  triageOlder: 'older decisions',
  // how it works
  triageHowPosted: 'when someone posts a shwarm or branch, a model reads it before anyone else sees it. it answers one question: does this aim at one of the hard blocks below? a "no" makes it public. a "yes" or "unsure" sends it to @myra, who clears it or blocks it. if the model doesn\'t answer within 10 minutes, it goes to @myra too.',
  triageHowHarm: 'the check only looks for harm. it never judges whether an idea is good, small, odd or too ambitious.',
  // {model} and {version} are names shown as code
  triageHowModel: 'the model is {model}, run by cloudflare. this is version {version} of its questions. each decision below names the version it was made under.',
  // the hard blocks. {rules} is a link with rulesLink's words
  triageBlocksIntro: 'the same list the {rules} give, as the model gets it:',
  triageQuestionsIntro: 'the model gets these exactly, every time. the first answers yes, no or unsure; the others score how likely each hard block is, which names the category.',
  // a whole request. {state} and {branchOf} are field names shown as code
  triageRequestIntro: "what the person wrote goes only in {state}, as data, never into a question. the words in angle brackets stand for theirs. a branch also gets {branchOf}, its parent's title.",
  // the decisions
  triageDecisionsIntro: 'one row per answer. a shwarm or branch shows by its address, never by its words. one that was never public shows only as "a shwarm". a row by @myra is a decision she made by hand, with her reason.',
  triageEmpty: 'no decisions yet.',
  // {json} and {text} are links; {modlog} is a link with triageModlogLink's words
  triageAgents: 'the same is here for agents as json ({json}) and plain text ({text}). everything else @myra does is in the {modlog}.',
  triageModlogLink: 'moderation log',

  // ---- times on pages: how long ago something happened ({n} is a number), and the exact time when you hover it
  justNow: 'just now',
  minutesAgo: '{n}m ago',
  hoursAgo: '{n}h ago',
  daysAgo: '{n}d ago',
  yearsAgo: '{n}y ago',
  // {time} is like 2026-10-08 14:03
  exactTime: '{time} utc',
}
