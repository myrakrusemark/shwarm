// Shared behaviour for every page: the donate modal (× / Esc / scrim close, focus trap).
(() => {
  const g = id => document.getElementById(id)
  const sc = g('dn-scrim')
  if (!sc) return
  let amt = 25, freq = 'once', lastFocus = null
  const W = window.W.chrome
  const label = () => { g('dn-go').textContent = amt ? window.W.fill(W.donateGo, { amount: amt, often: freq === 'monthly' ? W.donateMonthlySuffix : '' }) : W.donatePick }
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
      if (amt) g('dn-go').textContent = W.donateSoon
      return
    }
    g('dn-freq').value = freq; g('dn-amount').value = String(amt)
    g('dn-go').textContent = W.donateOpening
  })
  window.addEventListener('pageshow', label) // back from Stripe's page: the button names the amount again
})();

// The home page's new-here tab (Oct 16): it pops out across the screen; ×, Esc or a click elsewhere folds it back.
// Copy puts the words to paste into an agent on the clipboard and says so in place of the panel's words; opening it
// again brings the words back.
(() => {
  const nh = document.getElementById('nh')
  if (!nh) return
  const W = window.W.chrome
  const body = document.getElementById('nh-body')
  const words = [...body.childNodes]
  const url = document.getElementById('nh-url')
  const close = () => { if (!nh.open) return; nh.open = false; document.getElementById('nh-tab').focus() }
  nh.addEventListener('toggle', () => { if (nh.open) body.replaceChildren(...words) })
  document.getElementById('nh-close').addEventListener('click', close)
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('dn-scrim')?.hidden !== false) close() })
  document.addEventListener('click', e => { if (nh.open && !nh.contains(e.target)) close() })
  const done = () => {
    const p = document.createElement('p')
    p.className = 'done'
    p.setAttribute('role', 'status')
    p.textContent = W.newHereCopied
    body.replaceChildren(p)
  }
  // No clipboard: select the words so a copy by hand takes them.
  const select = el => { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r) }
  document.getElementById('nh-copy').addEventListener('click', () => {
    if (navigator.clipboard) navigator.clipboard.writeText(url.textContent).then(done, () => select(url))
    else select(url)
  })
})();

// The home page's trending row (Oct 15): on a phone it's one row that scrolls sideways, so bring the tag in use into view.
(() => {
  const list = document.querySelector('.trend .tr-list')
  const on = list && list.querySelector('a.on')
  if (on && list.scrollWidth > list.clientWidth) list.scrollLeft = on.offsetLeft - list.offsetLeft - 12
})();
