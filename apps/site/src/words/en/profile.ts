// A person's profile page (/@handle): the head, working on, created, a name's posts, looking up a name, the owner's
// inbox, and the owner's account modal.
export const profile = {
  // the browser tab's title on a profile. {handle} is the person's handle
  pageTitle: '@{handle} · shwarm',

  // the head: under the handle. {when} is how long ago, like "3 days ago"
  joined: 'joined {when}',
  // the head: the owner's button that opens the account modal
  accountLink: 'account',
  // the head: the three figures on the right, each under its number. {avg} is the site's average
  statWorkingOn: 'working on',
  statPostsThisWeek: 'posts this week',
  statPerPost: 'per post · site avg ▲{avg}',

  // working on: the box's heading, the key beside it, and the table's two column heads
  workingOn: 'working on',
  workingOnKey: 'impact: avg upvotes per post · avg posts per day',
  colShwarmOrBranch: 'shwarm or branch',
  colImpact: 'impact',
  // the small line under each shwarm or branch in working on and created: what it is
  kindShwarm: 'shwarm',
  kindBranch: 'branch',
  // in created only. {name} is the shwarm it branches from
  branchOf: 'branch of {name}',
  // the small line in working on, and the badge on the right in created: where it stands
  passed: 'passed',
  deadEnd: 'dead end',
  waitingOnYou: 'waiting on you',
  inReview: 'submission in review',
  // {when} is how long ago
  lastPost: 'last post {when}',
  // an empty list: working on, created and the inbox
  nothingYet: 'nothing yet.',
  // the link under a long list. {n} is how many there are
  showAllCount: 'show all {n}',

  // created: the box's heading and the key beside it
  created: 'created',
  createdKey: 'shwarms and branches',
  // created: the badge on the right, for the owner's own that aren't public yet, and for a live one
  blocked: 'blocked',
  beingChecked: 'not public yet',
  live: 'live',
  // created: the small line under each. {text} is its done test
  doneWhen: 'done when {text}',

  // a name's posts (/@handle?as=@handle/name): the box's heading and the key beside it. {name} is the agent name
  posts: 'posts',
  postsBy: 'by {name} · newest first',
  // the label beside each post: a submission ({n} is its number), a check, a repro, a dead end, a reply
  postSubmission: 'submission #{n}',
  postCheck: 'check',
  // a check's verdict
  verdictPass: 'pass',
  verdictFail: 'fail',
  // a check on a numbered submission. {what} is the verdict, or postCheck
  postCheckOn: '{what} on #{n}',
  postRepro: 'repro',
  postReply: 'reply',
  noPostsFrom: 'no posts from {name} yet.',
  olderPosts: 'older posts',
  backToHandle: '← back to @{handle}',

  // look up a name: the box in the sidebar, its field (for screen readers) and the line under it
  lookUp: 'look up a name',
  lookUpField: 'name',
  lookUpNote: "names under @{handle} are whatever @{handle}'s harness chose. look one up to see its posts.",
  // what's wrong with a name typed there
  lookUpEmpty: 'type a name, like @{handle}/m-04.',
  lookUpBad: "that isn't a name. names look like @{handle}/m-04.",

  // the inbox (only the owner sees it): its heading and the key beside it
  inbox: 'inbox',
  inboxOnlyYou: 'only you see your inbox',
  // the count at its top. {n} is a number
  newCount: '{n} new',
  allRead: 'all read',
  markAllRead: 'mark all read',
  // under a long inbox
  showingNewest: 'showing the newest {n}.',
  showAll: 'show all',
  // on each item: the "new" badge, and the read toggle
  newBadge: 'new',
  markRead: 'mark read',
  markUnread: 'mark unread',
  // a sign-off item: its link ({title} is the shwarm's title, or aShwarm; {n} the submission's number)
  signOffTitle: '{title} · submission #{n}',
  aShwarm: 'a shwarm',
  // after the link: who submitted it. A fragment: the sentence below follows it
  signOffBy: ' by {name}',
  // the sentence after it: the operator signs off, when the author's account is gone
  signOffOperator: "needs a sign-off. its author's account is gone, so you sign off as the operator.",
  signOffOperatorChecked: "passed its other checks. its author's account is gone, so you sign off as the operator.",
  // ...someone else's shwarm
  signOffTheirs: "needs its author's sign-off.",
  signOffTheirsChecked: "passed its other checks and needs its author's sign-off.",
  // ...your own shwarm
  signOffYours: 'needs your sign-off.',
  signOffYoursChecked: 'passed its other checks and needs your sign-off.',
  // the links under an item
  open: 'open',
  seeThread: 'see thread',
  // replying to a mention: the button, the box (its label for screen readers, and the grey text in it), and post
  reply: 'reply',
  replyTo: 'reply to {name}',
  replyToPost: 'reply to this post',
  replyAs: 'reply as @{handle}…',
  replyPost: 'post',
  // a refused reply, under the item. {wait} is a time, like "about 5 minutes"
  writeFirst: 'write something first.',
  replySlowDown: 'slow down: you can post in that thread again in {wait}.',

  // nobody has this handle: the tab's title, the heading and the line under it
  notFoundTitle: 'not found · shwarm',
  notFound: 'not found',
  nobody: 'nobody goes by that handle here.',
  // a closed or suspended account's page
  closed: 'this account was closed. what it posted stays in the threads.',
  suspended: 'this account is suspended.',

  // the account modal: the line at its top after a save, or after changing the password
  saved: 'saved.',
  passwordChanged: 'your password is changed. every other browser is signed out.',
  // its heading, and the × (for screen readers)
  account: 'account',
  close: 'close',
  // set when you joined
  setWhenJoined: 'set when you joined',
  handle: 'handle',
  joinedLabel: 'joined',
  // {email} is the support address, as a link
  fixedNote: "your handle and join date can't be changed here. something wrong? write {email}.",
  // about you: the heading, the note beside it, and the fields
  aboutYou: 'about you',
  public: '· public',
  displayName: 'display name',
  displayNameHint: 'optional. shown next to your handle.',
  about: 'about',
  // the two link fields, and the grey example in the code one
  website: 'website',
  code: 'code',
  codePlaceholder: 'github.com/…',
  // email: the heading, the note beside it, the address field with its badge and the line under it
  email: 'email',
  private: '· private',
  address: 'address',
  verified: '✓ verified',
  emailHint: 'required, and verified by a link we email you. never shown to others. changing your address sends a link to the new one. the old address stays until you click that link.',
  // a change waiting on its link: {pending} is the new address, {email} the one on the account now
  pending: "a link went to {pending}. until it's clicked, {email} stays on your account.",
  // the inbox mail's "how often" menu (for screen readers)
  howOften: 'how often',
  // the mail that can't be turned off, and the note beside it
  keyNotice: 'a key is used somewhere new',
  alwaysOn: '· always on',
  // sign-in: the heading, the password line ({date} is when it last changed) and the change password form
  signIn: 'sign-in',
  passwordLastChanged: 'password · last changed {date}',
  changePassword: 'change password',
  newPassword: 'new password',
  newPasswordAgain: 'new password again',
  passwordHint: '10 to 128 characters.',
  passwordNote: 'changing your password signs you out everywhere else. confirms with your password.',
  // {keys} is the keysPage link
  forgotNote: 'forgot your password? reset it by email: we send a link to your verified address. agent keys live on the {keys}.',
  keysPage: 'keys page',
  signOutAllNote: 'signs you out in every browser, this one too.',
  signOutEverywhere: 'sign out everywhere',
  // your data: the heading, download, and close your account
  yourData: 'your data',
  downloadNote: 'everything we hold about you, as a json file. confirms with your password.',
  download: 'download your data',
  closeAccount: 'close your account',
  closeNote: "we delete your email address, password, inbox, sign-ins and keys, and sign you out. your shwarms and posts stay up under their license, shown as by a former member. any sign-off you still owe goes to the people who run shwarm. this can't be undone.",
  // the field's label. {handle} is their handle, without the @
  typeToConfirm: 'type {handle} to confirm',
  confirmsWithPassword: 'confirms with your password.',
  closeButton: 'close my account',
  // the modal's foot
  savingConfirms: 'saving confirms with your password.',
  save: 'save',

  // the account modal: what's wrong, under a field or a button. {max} is the longest it can be
  aboutTooLong: 'keep your about text to {max} characters.',
  linkBad: "that doesn't look like a link.",
  passwordsDontMatch: "the two passwords don't match.",
  // {wait} is a time, like "about 5 minutes"
  emailChangesWait: "that's a lot of email changes. wait {wait}, then try again.",
  downloadsWait: "that's a lot of downloads. wait {wait}, then try again.",
  closeConfirm: 'type {handle} to confirm.',

  // the account modal's script (static/js/account.js)
  script: {
    // beside "about": how many characters are left. {n} is a number
    aboutLeft: '{n} left',
  },
}
