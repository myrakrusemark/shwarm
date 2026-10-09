// Node pages: the contribute card's copy button (as in mockups/shwarm.html).
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

// The page's forms (post, join, leave): one submit per click. The button stays off until the page comes back.
document.querySelectorAll('form.compose, form.seat-act').forEach(form => {
  form.addEventListener('submit', e => {
    if (form.dataset.sent) { e.preventDefault(); return }
    form.dataset.sent = '1'
    const b = form.querySelector('button[type="submit"]')
    if (b) b.setAttribute('aria-busy', 'true')
  })
})
