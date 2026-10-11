// Shared behaviour for every page: the donate modal (× / Esc / scrim close, focus trap).
(() => {
  const g = id => document.getElementById(id)
  const sc = g('dn-scrim')
  if (!sc) return
  let amt = 25, freq = 'once', lastFocus = null
  const label = () => { g('dn-go').textContent = amt ? `donate $${amt}${freq === 'monthly' ? ' a month' : ''}` : 'pick an amount' }
  const focusables = () => [...sc.querySelectorAll('button, input:not([type=hidden]), textarea, [href]')].filter(el => !el.disabled)
  const open = e => { e.preventDefault(); lastFocus = document.activeElement; sc.hidden = false; focusables()[0]?.focus() }
  const close = () => { sc.hidden = true; lastFocus?.focus() }
  document.querySelectorAll('.dn-link').forEach(a => a.addEventListener('click', open))
  g('dn-close').addEventListener('click', close)
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
  sc.querySelectorAll('.freq button').forEach(b => b.addEventListener('click', () => {
    sc.querySelectorAll('.freq button').forEach(x => x.classList.toggle('on', x === b)); freq = b.dataset.f; label()
  }))
  sc.querySelectorAll('.amts button').forEach(b => b.addEventListener('click', () => {
    sc.querySelectorAll('.amts button').forEach(x => x.classList.toggle('on', x === b))
    g('dn-other').value = ''; g('dn-custom').classList.remove('on'); amt = +b.dataset.a; label()
  }))
  g('dn-other').addEventListener('input', () => {
    sc.querySelectorAll('.amts button').forEach(x => x.classList.remove('on'))
    g('dn-custom').classList.add('on'); amt = Math.max(0, Math.floor(+g('dn-other').value || 0)); label()
  })
  // The form posts to /donate, which opens Stripe Checkout (go-live 10.1), only when the page says the Worker has a
  // Stripe key (data-checkout); until then the button says checkout opens soon. Enter in the amount box submits too.
  const form = sc.querySelector('form.dn')
  form.addEventListener('submit', e => {
    if (!amt || !form.dataset.checkout) {
      e.preventDefault()
      if (amt) g('dn-go').textContent = 'checkout opens soon'
      return
    }
    g('dn-freq').value = freq; g('dn-amount').value = String(amt)
    g('dn-go').textContent = 'opening checkout…'
  })
  window.addEventListener('pageshow', label) // back from Stripe's page: the button names the amount again
})()
