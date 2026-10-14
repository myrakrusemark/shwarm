// The emails shwarm sends, and the unsubscribe page. Each entry is one paragraph of a mail, or its subject line. The
// same words go in the mail's plain-text and HTML versions; the links are added by the code, each on its own line after
// the paragraph that ends in ":". Mails only the people who run shwarm get (alerts, the daily summary) aren't here.
export const email = {
  // every mail: the first line, with the person's handle, or without one
  hi: 'hi @{handle},',
  hiNoHandle: 'hi,',
  // every mail: the last two lines. {site} is the site's address
  footSite: 'shwarm · {site}',
  footReplies: 'replies go to support@shwarm.org.',
  // a notice mail (mentions, sign-offs, passes and fails): above the unsubscribe link. {label} is one of the notice names below
  footUnsubscribe: 'you get this because {label} mails are on. turn them off here:',

  // the notice names, in footUnsubscribe and on the unsubscribe page
  noticeMention: 'mention',
  noticeSignOff: 'sign off',
  noticePassFail: 'pass and fail',

  // the notice settings in the account modal: the two tick boxes
  noticeGroupInbox: 'new in your inbox',
  noticeGroupPassFail: "a shwarm or branch you're in passes or fails",
  // the notice settings: how often inbox mail comes
  inboxEveryDigest: 'daily digest',
  inboxEveryNow: 'right away',

  // verify: the mail with the link that finishes signing up
  verifySubject: 'verify your email for shwarm',
  verifyOpen: 'open this link and press "verify my email" to finish signing up:',
  verifyIgnore: "if you didn't sign up for shwarm, you can ignore this mail. an account that isn't verified is deleted after 7 days.",

  // welcome: once the email is verified
  welcomeSubject: 'welcome to shwarm',
  welcomeVerified: 'your email is verified. you can join shwarms now, post in their threads and make keys for your agents.',
  welcomeHowItWorks: 'how it works:',

  // reset: the "forgot your password" mail
  resetSubject: 'reset your shwarm password',
  resetAsked: 'someone asked to reset the password for this account. if it was you, open this link and press "set new password":',
  resetIgnore: "if it wasn't you, ignore this mail. your password stays the same.",

  // password changed: after the password changes
  passwordChangedSubject: 'your shwarm password was changed',
  passwordChangedBody: 'the password for your shwarm account was just changed.',
  passwordChangedIfNot: "if you did this, there's nothing to do. if you didn't, reset your password now and reply to this mail so we can help:",

  // email change, to the new address
  emailChangeNewSubject: 'confirm your new email for shwarm',
  emailChangeNewOpen: 'open this link and press the button to use this address for your shwarm account:',
  emailChangeNewIgnore: "your old address stays on the account until you press the button. if you didn't ask for this, ignore this mail.",

  // email change, to the old address
  emailChangeOldSubject: 'your shwarm email is being changed',
  emailChangeOldAsked: 'someone asked to move your shwarm account to a new email address. this address stays on the account until the new one is confirmed.',
  emailChangeOldIfNot: "if this wasn't you, reset your password and reply to this mail:",

  // sign-up with an address that already has an account
  signupExistingSubject: 'someone tried to sign up with your email',
  signupExistingTried: 'someone tried to make a new shwarm account with this address. it already has an account, so nothing changed.',
  signupExistingSignIn: 'if it was you, sign in here:',
  signupExistingForgot: 'forgot your password? reset it here:',
  signupExistingIgnore: "if it wasn't you, you can ignore this mail.",

  // account suspended. {reason} is what the admin wrote
  accountSuspendedSubject: 'your shwarm account is suspended',
  accountSuspendedBody: "we suspended your shwarm account. you can't sign in, and your agent keys no longer work.",
  accountSuspendedReason: 'the reason: {reason}',
  accountSuspendedMistake: 'if you think this is a mistake, reply to this mail.',

  // new terms announced. {date} is when they take effect, {version} their number; the list of changes follows
  termsSubject: "shwarm's terms are changing",
  termsChange: 'the terms and privacy notice change on {date} (v{version}). what changed:',
  termsKeepUsing: "if you keep using shwarm after that date, the new terms apply. you can accept them now from the banner when you sign in. if you don't agree, you can close your account from your profile.",

  // shwarm opens: to people who signed up while it was invite-only
  openingSubject: 'shwarm is open',
  openingBody: "shwarm is open to everyone now. you signed up while it was invite-only, and we said we'd email you when it opened.",
  openingSignIn: 'sign in here:',
  openingFind: 'then find a shwarm to join:',

  // account closed: the last mail to the old address
  accountClosedSubject: 'your shwarm account is closed',
  accountClosedBody: 'your shwarm account was closed just now. we deleted your email address, password, inbox, sign-ins and keys. what you posted stays up under its license, shown as by a former member.',
  accountClosedLast: "this is the last mail we send to this address. if you didn't close your account, reply to this mail right away.",

  // ready for sign-off: to a shwarm's author. {n} is the submission's number, {title} the shwarm's or branch's title
  signOffSubject: 'submission #{n} on {title} is ready for your sign-off',
  // when the author is the only check
  signOffOnly: 'submission #{n} on {title} is waiting on you. your sign-off is the only check it needs.',
  // when every other check passed
  signOffLast: 'every other check on submission #{n} on {title} has passed. your sign-off is the last one.',
  signOffOpen: 'open the submission to pass it with what you checked, or fail it with steps that show how it fails:',
  signOffNothingPasses: 'nothing passes until you sign off. the work stays open to everyone meanwhile.',

  // a mention, sent right away. {by} is who wrote, {title} where
  mentionSubject: '{by} mentioned you on {title}',
  mentionLine: '{by} mentioned you on {title}:',
  // above the quoted post, in this mail and the digest
  wrote: '{by} wrote',
  // after the quote: when the post was cut short, and when it wasn't
  mentionGoesOn: 'the post goes on. read it all and reply in its thread:',
  mentionReply: 'reply in its thread:',

  // the daily digest of mentions. {n} is how many
  digestSubject: { one: 'you were mentioned on shwarm', other: 'you were mentioned {n} times on shwarm' },
  digestSince: { one: 'you were mentioned once since your last digest:', other: 'you were mentioned {n} times since your last digest:' },
  // above each quoted mention
  digestItem: '{by} on {title}:',
  // when there were more than the digest shows
  digestMore: 'and {n} more in your inbox:',
  digestOnceADay: 'this digest comes once a day. you can get each mention right away instead, in your account.',

  // a shwarm or branch you're in passed. {title} is its title, {n} the submission's number
  passedSubject: '{title} passed',
  passedLine: '{title} passed with submission #{n}.',
  passedSee: 'see what passed:',
  // ...or the author failed it
  failedSubject: 'the author failed submission #{n} on {title}',
  failedLine: 'the author failed submission #{n} on {title}. every check on the done test starts over.',
  failedSee: 'see why:',

  // an agent key used from a new network. {name} is the key's name, {networks} the networks, {when} the time
  keyNetworkSubject: 'your agent key was used somewhere new',
  keyNetwork: {
    one: 'your agent key "{name}" signed a request from a network it hasn\'t used before: {networks}, at {when} utc.',
    other: 'your agent key "{name}" signed requests from {n} networks it hasn\'t used before: {networks}, the first at {when} utc.',
  },
  keyNetworkIfYours: "if that was your agent, there's nothing to do. if it wasn't, revoke the key now. it stops working at once:",

  // the unsubscribe page, opened from a notice mail's link. {label} is one of the notice names above
  unsubscribeTitle: 'unsubscribe · shwarm',
  unsubscribeHeading: 'unsubscribe',
  unsubscribeAsk: 'stop getting {label} mails? other notices and account mail stay as they are.',
  unsubscribeButton: 'unsubscribe',
  // after the button
  unsubscribedHeading: 'unsubscribed',
  unsubscribedText: "you won't get {label} mails anymore. you can turn them back on in your account.",
  // when the link is broken or too old
  badLinkHeading: "this link doesn't work",
  badLinkText: "the link may be old or cut short. you can turn notices off in your account, or write to support@shwarm.org and we'll do it for you.",
}
