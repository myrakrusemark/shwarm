// The account modal on the owner's profile (go-live 6.2): "account" opens it in place, ×, Esc and a click on the scrim
// close it, and focus stays inside while it's open (as the donate modal in site.js). Without script, "account" and × are
// plain links (?account=1 renders it open). The about box counts down its 160 characters, as in mockups/profile.html.
(() => {
  const g = id => document.getElementById(id)
  const sc = g('ascrim')
  if (!sc) return
  const opener = g('acct'), ta = g('about-in'), left = g('acount')
  let lastFocus = null
  const W = window.W.profile
  const count = () => { if (ta && left) left.textContent = window.W.fill(W.aboutLeft, { n: 160 - [...ta.value].length }) }
  // Visible controls only: the change password form's fields while it's closed are skipped.
  const focusables = () => [...sc.querySelectorAll('a[href], button, input, textarea, select, summary')]
    .filter(el => !el.disabled && el.type !== 'hidden' && el.getClientRects().length)
  const open = e => {
    e?.preventDefault()
    lastFocus = document.activeElement
    sc.hidden = false
    count()
    ;(ta ?? focusables()[0])?.focus()
  }
  const close = e => {
    e?.preventDefault()
    sc.hidden = true
    // Opened by ?account=: drop it, so a reload doesn't open the modal again.
    const url = new URL(location.href)
    if (url.searchParams.has('account')) { url.searchParams.delete('account'); history.replaceState(null, '', url) }
    ;(lastFocus && lastFocus !== document.body ? lastFocus : opener)?.focus()
  }
  opener?.addEventListener('click', open)
  g('aclose').addEventListener('click', close)
  sc.addEventListener('click', e => { if (e.target === sc) close() })
  document.addEventListener('keydown', e => {
    if (sc.hidden) return
    if (e.key === 'Escape') return close()
    if (e.key === 'Tab') {
      const f = focusables(), first = f[0], last = f[f.length - 1], at = document.activeElement
      // focus outside the dialog (a click on its text sends focus to body): bring it back in
      if (!sc.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus() }
      else if (e.shiftKey && at === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus() }
    }
  })
  ta?.addEventListener('input', count)
  // Opened by the server (?account=, or a refused form): the count, and focus on the field with the reason (a refused
  // password: its password field), else the about box.
  if (!sc.hidden) {
    count()
    const bad = sc.querySelector('[aria-invalid="true"]') ?? sc.querySelector('.err')?.parentElement?.querySelector('input[name="password"]')
    ;(bad ?? ta)?.focus()
  }
})()
