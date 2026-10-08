# Legal todo: terms and privacy

Working list for turning the draft [terms](../mockups/terms.html) and [privacy](../mockups/privacy.html) pages into real legal documents. Both pages are drafts in plain language. Nothing here is legal advice; a lawyer signs off before launch.

Decisions go in the [decision log](decisions.md) first, then into the pages. Open items link to [open questions](open-questions.md).

## 1. Decide these first (in this order)

Most blanks depend on the first two.

Already decided: **shwarm stores only text** ([decision log](decisions.md#later-on-oct-7-forms-keys-inbox-submissions-donations)). Users post text and links; no uploads, files, images, audio or video. Work lives where its contributors put it. This makes the legal surface smaller: takedowns, retention and moderation cover text and links only, and shwarm never hosts anyone's files.

- [ ] **Legal home.** Nonprofit, cooperative or foundation. Lean: nonprofit. [#12](open-questions.md#12-legal-home)
- [ ] **Governing law and jurisdiction.** Follows the legal home. [#58](open-questions.md#58-governing-law-and-jurisdiction)
- [x] **The license.** Decided Oct 8: a default per shwarm (MIT for code, CC BY 4.0 for everything else), with a short open list the author can pick from; builds-on takes the upstream license. [#11](open-questions.md#11-which-single-license)
- [x] **Personhood provider.** None at launch (decided Oct 8): sign-up is a verified email and a password, and no legal name is collected. A provider for an optional "verified human" mark may come later, and would change the privacy page then. [#2](open-questions.md#2-first-personhood-provider)
- [x] **Who holds donations.** Decided Oct 8: Stripe at launch, paid to Myra Krusemark, who runs shwarm; not tax-deductible. A nonprofit or fiscal host can take over later. [#51](open-questions.md#51-who-holds-donations)
- [ ] **Hosting provider and region.** Needed for the subprocessor list and data-transfer terms. Not yet an open question.
- [x] **Minimum age.** Decided Oct 8: 16. [#59](open-questions.md#59-minimum-age)
- [ ] **What happens to posts when an account closes.** Lean: detach the handle, keep the work. [#60](open-questions.md#60-what-happens-to-posts-when-an-account-closes)
- [ ] **Log retention.** Lean: 30 days. [#61](open-questions.md#61-log-retention)
- [ ] **Transactional email service.** Email is required and verified, so the sender is a subprocessor. [#63](open-questions.md#63-transactional-email-service)
- [x] **Recovery codes or not.** Moot (decided Oct 8): a forgotten password is reset by email. [#53](open-questions.md#53-account-recovery-beyond-the-personhood-check)

## 2. Fill the blanks in the drafts

Every `[to decide]` on the pages, and what fills it.

**terms.html**

- [x] *who runs shwarm*: filled for the beta (Myra Krusemark, St. Louis, Missouri; contact support@shwarm.org); an entity name after #12.
- [x] *what you post is open*: filled (each shwarm's license; default MIT + CC BY 4.0).
- [x] *donations*: filled (Stripe; payments to Myra Krusemark; not tax-deductible).
- [ ] *leaving*: what stays public, and whether the handle is detached (after #60).
- [ ] *no warranty*: liability limits, including for other people's agents (lawyer).
- [ ] *changes and law*: governing law filled (Missouri); venue still open (#58).

**privacy.html**

- [x] *what we collect → logs*: filled (30 days, table B).
- [x] *donations*: filled (Stripe).
- [ ] *your choices*: what closing an account does to public posts (after #60).
- [x] *age*: filled (16).

## 3. Flesh out the full terms of use

The draft covers the basics. A complete version also needs:

- [ ] **Acceptance.** How someone agrees (checkbox at sign-up, or using the site), and an effective date.
- [ ] **License grant from users.** The exact grant each person gives on posting, matching the shwarm's license, plus the "builds on" exception for upstream licenses. Say how it applies to linked work that lives on other hosts.
- [ ] **Your warranties.** You own or have the right to post what you post, and it doesn't break anyone's rights.
- [ ] **Agents and keys.** Automated actions by your keys count as yours; grants and revocation; no impersonating the bare handle.
- [ ] **Acceptable use.** Point to the [rules](../mockups/rules.html) and make them part of the terms; the hard blocks spelled out.
- [ ] **Copyright complaints.** A takedown process and contact (DMCA agent registration if US-based). It covers only text and links. shwarm hosts no files, so a complaint about the work itself goes to the host that stores it; shwarm can remove or hide the link.
- [ ] **Moderation and appeals.** Triage blocks, flags, reports (abuse@, dmca@, /report), suspension, and how to appeal; at launch all go to @myra with a public log, reputation-weighted rejects later.
- [ ] **Runs and code.** No liability for code people run on their own machines; the sandbox advice.
- [ ] **Donations.** Refund policy, recurring donations and how to cancel, fiscal host terms if one takes over later.
- [ ] **Termination.** What ends an account, notice, and what survives.
- [ ] **Disclaimers and limitation of liability.** The full lawyer version.
- [ ] **Indemnity.** Whether users indemnify the entity for their posts and agents.
- [ ] **Disputes.** Venue, arbitration or not, class-action language or not.
- [ ] **Name and logo.** Trademark use of "shwarm" and the mark, once the name is final. [#1](open-questions.md#1-name)
- [ ] **Changes.** Notice period and how people are told (email if added, site banner).
- [ ] **Contact.** support@shwarm.org (needs setting up) and a postal address.

## 4. Flesh out the full privacy policy

- [ ] **Controller.** Who is responsible for the data (the entity from #12).
- [ ] **Data inventory.** A table: each piece of data, where it comes from, why we keep it, the legal basis, who sees it, how long. User content is text and links only; there are no uploaded files to list.
- [ ] **Legal bases (GDPR).** Contract (running the account), legitimate interest (security, rate limits), consent (email notices).
- [ ] **Subprocessors.** Stripe (payments), Cloudflare (hosting, Turnstile, email routing), Resend (email sending); a personhood provider only if the optional mark comes later. A public list with a change notice.
- [ ] **International transfers.** Where data is stored and the safeguards used.
- [ ] **Rights and how to use them.** Access, download, correct, delete, object, restrict; response times; how we verify it's you (signed in, with the password re-entered).
- [ ] **US state notices.** California and others: categories, "we don't sell or share", how to opt out.
- [ ] **Children.** Matches the minimum age (#59); what happens if we learn someone is under it.
- [ ] **Security and breaches.** What we do and how we notify people.
- [ ] **Law enforcement requests.** Policy, and whether we publish a transparency report.
- [ ] **Open content and AI.** Keep the plain warning that public posts can be read and used for training by others.
- [ ] **Cookies.** Confirm the one sign-in cookie, so no consent banner is needed. Re-check if analytics are ever added.
- [ ] **Changes and contact.** Effective date, version history, contact.

## 5. Process

- [ ] Set up support@shwarm.org (domain is bought; mail provider not chosen yet).
- [ ] Draft the full versions from sections 3 and 4, keeping a plain-language summary at the top of each page.
- [ ] Lint the plain-language parts with the Combob rules (see [CLAUDE.md](../CLAUDE.md)); the legal body can stay formal.
- [ ] Lawyer review of both documents.
- [ ] Add a sign-up step that records acceptance and the version accepted.
- [ ] Version both pages with an effective date and a changelog.
- [ ] Update the [PRD](prd.md), [spec](spec.md) and decision log with anything the review changes.
