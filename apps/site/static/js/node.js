// Node pages: the contribute card's copy button (as in mockups/shwarm.html). The profile loads this file too, for its inbox forms.
(() => {
  const copy = document.getElementById('w-copy')
  const url = document.getElementById('w-url')
  if (!copy || !url) return
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(url.textContent).then(() => {
      copy.textContent = 'copied'
      setTimeout(() => { copy.textContent = 'copy' }, 1200)
    })
  })
})()

// The page's forms (post, join, leave, re-pitch, dead end, upvote, edit, delete, report; on the owner's profile, the inbox's
// reply and read marks, and the account modal's forms; on the keys page, revoke and revoke all): one submit per click.
// The button stays off until the page comes back. The keys page loads this file for that alone.
document.querySelectorAll('form.compose, form.seat-act, form.owner-act, form.up-act, form.edit-act, form.del-act, form.report-act, form.inbox-act, form.acct-act, form.key-act').forEach(form => {
  form.addEventListener('submit', e => {
    if (form.dataset.sent) { e.preventDefault(); return }
    form.dataset.sent = '1'
    const b = form.querySelector('button[type="submit"]')
    if (b) b.setAttribute('aria-busy', 'true')
  })
})
