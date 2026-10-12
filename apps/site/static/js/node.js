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

// Join (go-live 8.2, as in mockups/shwarm.html and branch.html): the join button on the node's own post and the one in
// the contributors box open one "say hi!" modal, closed by ×, Esc or a click on the scrim, with focus back on the button
// that opened it. With scripts off, either button posts a plain join. Pressing join in the modal posts its form at once;
// the modal shrinks away while the page loads, and the page the join lands on plays the burst from where the modal
// was and lights the new join in the thread. With reduced motion none of it plays.
;(() => {
  const g = id => document.getElementById(id)
  const KEY = 'shwarm-join-burst'
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

  function burst(x, y) {
    const glyphs = ['✿', '❦', '˜', '✿', '❦', '✿'], colors = ['var(--leaf)', 'var(--clay)', 'var(--moss)', 'var(--sky)', 'var(--sun)']
    const rings = [[14, 90, 150, 0], [18, 170, 260, 90], [22, 250, 360, 200]]
    rings.forEach(([n, near, far, delay], k) => {
      for (let i = 0; i < n; i++) {
        const s = document.createElement('span'), a = Math.PI * 2 * (i + k * .5) / n, d = near + Math.random() * (far - near)
        s.className = 'burst'; s.setAttribute('aria-hidden', 'true'); s.textContent = glyphs[(i + k) % glyphs.length]
        s.style.cssText = `left:${x}px;top:${y}px;font-size:${16 + Math.random() * 12 | 0}px;color:${colors[(i + k) % colors.length]};` +
          `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--r:${(Math.random() * 240 - 120) | 0}deg;--d:${delay}ms;--t:${1100 + Math.random() * 400 | 0}ms`
        document.body.appendChild(s); setTimeout(() => s.remove(), 1900 + delay)
      }
    })
  }
  function glow(el) { el.classList.remove('glow'); void el.offsetWidth; el.classList.add('glow') }

  // The page a join landed on: the burst from where the modal was, if this page shows the join went through.
  let landed = null
  try { landed = JSON.parse(sessionStorage.getItem(KEY) || 'null'); sessionStorage.removeItem(KEY) } catch { landed = null }
  if (landed && landed.path === location.pathname && Date.now() - landed.t < 20000 && document.querySelector('#jn-state .joined') && !still()) {
    burst(landed.x, landed.y)
    const row = document.querySelector('.jn-mine')
    if (row) glow(row)
  }

  const sc = g('jn-scrim')
  if (!sc) return
  const box = sc.querySelector('.jn'), hi = g('jn-hi')
  let opener = null
  const focusables = () => [...sc.querySelectorAll('button, textarea, [href]')].filter(el => !el.disabled)
  const open = e => { e.preventDefault(); opener = e.currentTarget; sc.hidden = false; hi.focus() }
  const close = () => {
    sc.hidden = true; box.classList.remove('leaving')
    const f = opener || document.querySelector('.jn-open')
    if (f && document.contains(f)) f.focus({ preventScroll: true })
  }
  document.querySelectorAll('.jn-open').forEach(b => b.addEventListener('click', open))
  g('jn-close').addEventListener('click', close)
  sc.addEventListener('click', e => { if (e.target === sc) close() })
  document.addEventListener('keydown', e => {
    if (sc.hidden) return
    if (e.key === 'Escape') return close()
    if (e.key === 'Tab') {
      const f = focusables(), first = f[0], last = f[f.length - 1], at = document.activeElement
      if (!sc.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus() }
      else if (e.shiftKey && at === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus() }
    }
  })
  box.addEventListener('submit', e => {
    if (e.defaultPrevented || still()) return // a second click (the forms' one-submit rule above), or no motion wanted
    const r = box.getBoundingClientRect()
    try { sessionStorage.setItem(KEY, JSON.stringify({ path: location.pathname, x: r.left + r.width / 2, y: r.top + r.height / 2, t: Date.now() })) } catch { /* no storage: no burst */ }
    box.classList.add('leaving')
    setTimeout(() => { sc.hidden = true }, 300) // as the mockup: the modal is gone; the form is on its way
  })
  // Back to this page from the next one (the back-forward cache): the modal closed, its form ready again.
  window.addEventListener('pageshow', e => {
    if (!e.persisted) return
    sc.hidden = true; box.classList.remove('leaving'); delete box.dataset.sent
    box.querySelector('[aria-busy]')?.removeAttribute('aria-busy')
  })
})()
