// Joining, signing in, email checks, password resets, the password step-up and accepting the terms.
export const auth = {
  // every account page: the browser tab's title. {title} is the page's name, from the entries below
  pageTitle: '{title} · shwarm',
  // the bot check on join, sign in and forgot, for a browser with javascript off
  turnstileNoScript: 'this check needs javascript.',

  // join: the page's name in the tab, and its heading
  joinTitle: 'join',
  joinHeading: 'join shwarm',
  // join: under the box. {link} is the signIn link below
  haveAccount: 'have an account? {link}',
  // the "sign in" link on join, the verified page, an expired verify link and the email changed page
  signIn: 'sign in',
  // join: the green note at the top while shwarm is invite-only
  joinInviteOnly: "shwarm is invite-only for now. if you have an invite, join with the address it came to. if not, join anyway and we'll email you when it opens to everyone.",
  // join: the fields, each with the small line under its label
  handle: 'handle',
  handleHint: "your name here, like @myra. 2 to 32 lowercase letters, numbers or underscores. it can't change later.",
  displayName: 'display name',
  displayNameHint: 'optional. shown next to your handle.',
  // the email field on join, sign in and forgot
  email: 'email',
  emailHint: "we send a link to check it. it's never shown.",
  // the password field on join, sign in and the step-up page
  password: 'password',
  // under the password on join and on set a new password
  passwordHint: '10 to 128 characters.',
  // join: the two boxes to tick. {terms} and {privacy} are the two links after it
  age: "i'm 16 or older.",
  agree: 'i agree to the {terms} and the {privacy}.',
  agreeTerms: 'terms',
  agreePrivacy: 'privacy notice',
  // join: beside the button, and the button
  joinNote: 'you can read everything without an account.',
  joinButton: 'join',

  // join: what's wrong with a field, shown under it
  handlePattern: 'use 2 to 32 lowercase letters, numbers or underscores.',
  handleReserved: 'that handle is reserved. pick another one.',
  handleTaken: 'that handle is taken. pick another one.',
  // also on the account modal's display name. {max} is the longest it can be
  displayNameTooLong: 'keep it to {max} characters.',
  // also on the account modal's email
  emailBad: "that doesn't look like an email address.",
  disposable: "we can't take addresses from throwaway mail services.",
  // a new password that's too short, too long or known from a breach: on join, set a new password and the account modal
  tooShort: 'use at least 10 characters.',
  tooLong: 'use at most 128 characters.',
  pwned: 'that password has turned up in a data breach. pick another one.',
  ageNeeded: 'you need to be 16 or older to join.',
  termsNeeded: 'you need to agree to the terms to join.',
  // the bot check failed: on join, sign in, forgot and the report form
  turnstileFailed: "the bot check didn't go through. please try again.",

  // check your email: the page's name and heading
  checkEmail: 'check your email',
  // after "send it again"
  sentAgain: 'sent again. it can take a minute or two.',
  // for someone who joined from an address that isn't invited yet
  waiting: "you're on the list. shwarm is invite-only for now, so we'll email you when it opens to everyone.",
  // after asking for a password reset. {link} is askAgain
  resetSent: 'if that address has an account, a link to set a new password is on its way. it works for 1 hour.',
  resetNothing: 'nothing there? look in spam, or {link}.',
  askAgain: 'ask again',
  // after joining, or signing in before the email is verified
  unverified: "your email isn't verified yet. until it is, you can read and sign in, nothing else.",
  verifySent: 'we sent the next step to your email address. it will expire after 7 days.',
  checkSpam: 'be sure to check your spam folder!',
  sendAgain: 'send it again',

  // verify your email (the page the emailed link opens): its name and heading
  verifyEmail: 'verify your email',
  // {handle} is the new account's @handle, in bold
  verifyFinishes: 'this link finishes joining as {handle}.',
  verifyNotYou: "didn't sign up as @{handle}? don't press the button. an account that's never verified is deleted after 7 days.",
  // beside the button, and the button
  verifyPress: 'press the button to finish joining.',
  verifyButton: 'verify my email',

  // after verifying: the tab's name, the heading and the line under it
  verifiedTitle: 'verified',
  verifiedHeading: "you're in",
  verifiedWelcome: 'your email is verified. welcome to shwarm.',
  // the way back: {place} is the page they came from (a shwarm's title, or whereYouWere), or @handle after an email change
  backTo: 'back to {place}',
  // signed out: {link} is the signIn link
  signInToGoBack: '{link} to go back to {place}.',
  // what to call the page they came from when it has no title
  whereYouWere: 'where you were',
  // no page to go back to, signed in
  goToShwarm: 'go to shwarm',

  // an emailed link that's used or too old: the tab's name and the heading
  linkExpiredTitle: 'link expired',
  linkExpiredHeading: "this link doesn't work anymore",
  // an email change link to an address another account took in the meantime
  emailTaken: "that address is on another shwarm account now, so this one can't move to it. your old address stays.",
  // an old email change link
  emailChangeExpired: 'it was already used, or it ran out of time. email change links last 24 hours.',
  emailChangeAgain: 'to try again, open "account" on your profile and change the address there.',
  // an old verify or reset link
  linkUsed: 'it was already used, or it ran out of time. verify links last 7 days and reset links 1 hour.',
  newResetLink: 'ask for a new reset link',
  // {link} is the signIn link
  alreadyVerified: 'already verified? {link}. if not, sign in and send a new link from there.',

  // the page an email change link opens: its name and heading
  confirmNewEmail: 'confirm your new email',
  // {handle} and {email} are in bold
  emailChangeMoves: 'this link moves {handle} to {email}. until you press the button, the old address stays on the account.',
  emailChangeNotYou: "didn't ask for this? don't press the button.",
  // beside the button, and the button
  emailChangePress: 'press the button to use this address.',
  emailChangeButton: 'use this address',
  // after the button: the tab's name, the heading and the line under it
  emailChangedTitle: 'email changed',
  emailChangedHeading: 'your new email is set',
  emailChangedText: 'shwarm sends your mail here from now on, and you sign in with it.',

  // sign in: the page's name and heading, and its button
  signInHeading: 'sign in',
  signInButton: 'sign in',
  // under the box. {link} is joinLink
  newHere: 'new here? {link}',
  joinLink: 'join',
  // the green notes at the top: after a password reset, and after "sign out everywhere"
  resetDone: 'your new password is set. sign in with it.',
  signedOutEverywhere: "you're signed out everywhere.",
  // for someone already signed in, with a sign out button after it
  signedInAs: "you're signed in as @{handle}.",
  signOut: 'sign out',
  // the link under the password label
  forgotIt: 'forgot it?',
  badSignIn: "that email and password don't match.",

  // forgot your password: the tab's name, the heading, the link under the box
  forgotTitle: 'forgot your password',
  forgotHeading: 'forgot your password?',
  backToSignIn: 'back to sign in',
  // under the email label, and the button
  forgotHint: "if it has an account, we'll send a link to set a new password.",
  sendLink: 'send the link',

  // set a new password (the page a reset link opens): its name and heading, the fields, the note and the button
  newPasswordHeading: 'set a new password',
  newPassword: 'new password',
  newPasswordAgain: 'new password again',
  passwordsDontMatch: "the two passwords don't match.",
  resetNote: 'this signs you out everywhere.',
  resetButton: 'set new password',

  // confirm it's you (the password step-up page): its name and heading, the hint, beside the button, the button
  stepUpHeading: "confirm it's you",
  stepUpHint: 'enter your password to go on. it stays confirmed for 10 minutes.',
  stepUpSignedInAs: 'signed in as @{handle}',
  stepUpButton: 'confirm',
  // a wrong password: on the step-up page, and wherever a form confirms with your password
  wrongPassword: "that password doesn't match.",
  // a form that confirms with your password, sent with the password empty
  enterPassword: 'enter your password to confirm.',
  // too many tries: on the too many tries page, and wherever a form confirms with your password. {minutes} is a number, at least 1
  tooManyTries: 'there have been too many tries from here. wait about {minutes} minutes, then try again.',

  // the too many tries page: its name and heading, and the link under it
  tooManyTriesHeading: 'too many tries',
  backToShwarm: 'back to shwarm',
  // a form that sat open too long: the page's name and heading (also on the shwarm, profile, keys and messages pages)
  formExpired: 'this form expired',
  // the line under it on the account pages
  formExpiredText: 'go back, reload the page, and try again.',
  // the line under it on the shwarm, profile, keys and messages pages
  formExpiredRetry: 'go back, reload the page and try again.',
  // a made-up form on the shwarm, profile, keys or messages page
  unknownForm: 'that form asked for nothing we know.',
  // a form posted from another website (a plain text page)
  crossSite: 'this form came from another site, so it was refused.',
}
