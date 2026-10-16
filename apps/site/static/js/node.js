// Node pages: the people card's copy button (as in mockups/shwarm.html). The profile loads this file too, for its inbox forms.
(() => {
  const copy = document.getElementById('w-copy')
  const url = document.getElementById('w-url')
  if (!copy || !url) return
  const W = window.W.node
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(url.textContent).then(() => {
      copy.textContent = W.copied
      setTimeout(() => { copy.textContent = W.copy }, 1200)
    })
  })
})()

// The page's forms (post, join, leave, approve it, upvote, back, edit, delete, report, the on-track vote and the claims; on
// the owner's profile, the inbox's reply and read marks, and the account modal's forms; on the keys page, revoke and
// revoke all): one submit per click. The button stays off until the page comes back. The keys page loads this file for
// that alone.
document.querySelectorAll('form.compose, form.seat-act, form.owner-act, form.up-act, form.back-act, form.status-act, form.claim-act, form.edit-act, form.del-act, form.report-act, form.inbox-act, form.acct-act, form.key-act').forEach(form => {
  form.addEventListener('submit', e => {
    if (form.dataset.sent) { e.preventDefault(); return }
    form.dataset.sent = '1'
    const b = form.querySelector('button[type="submit"]')
    if (b) b.setAttribute('aria-busy', 'true')
  })
})

// Join (go-live 8.2, as in mockups/shwarm.html and branch.html): the join button on the node's own post and the one in
// the people card open one "say hi!" modal, closed by ×, Esc or a click on the scrim, with focus back on the button
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

// A branch's status badge (Myra, Oct 13: "a hover/tap shows the values"): hover and keyboard focus show its votes in CSS;
// here a tap or click opens and closes them, one panel at a time, and a tap elsewhere or Esc closes them.
;(() => {
  const badges = [...document.querySelectorAll('.vote-badge')]
  if (!badges.length) return
  // The panel hangs from the badge's right edge; where that pushes it off a small screen, slide it back in.
  const place = b => {
    const p = b.querySelector('.vb-panel')
    p.style.transform = ''
    const r = p.getBoundingClientRect()
    if (!r.width) return
    const dx = r.left < 8 ? 8 - r.left : r.right > innerWidth - 8 ? innerWidth - 8 - r.right : 0
    if (dx) p.style.transform = `translateX(${dx}px)`
  }
  const set = (b, open) => {
    b.classList.toggle('open', open)
    b.querySelector('button').setAttribute('aria-expanded', String(open))
    if (open) place(b)
  }
  badges.forEach(b => {
    b.addEventListener('mouseenter', () => place(b))
    b.addEventListener('focusin', () => place(b))
  })
  badges.forEach(b =>
    b.querySelector('button').addEventListener('click', e => {
      e.stopPropagation()
      const open = !b.classList.contains('open')
      badges.forEach(x => x !== b && set(x, false))
      set(b, open)
    }),
  )
  document.addEventListener('click', e => { if (!e.target.closest('.vote-badge')) badges.forEach(b => set(b, false)) })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') badges.forEach(b => set(b, false)) })
})()

// The people card's claim buttons (decided Oct 14): blocked, passed and dead end each open their claim form under the
// buttons, one at a time; a second press or cancel closes it. Without scripts each is a link to its form, which shows
// as the page's target.
;(() => {
  const links = [...document.querySelectorAll('.hows .vote-btns a[aria-controls]')]
  if (!links.length) return
  const formOf = a => document.getElementById(a.getAttribute('aria-controls'))
  const set = (a, open) => {
    const f = formOf(a)
    f.classList.toggle('open', open)
    a.setAttribute('aria-expanded', String(open))
    // a form opened as the page's target without scripts stays open until the target goes
    if (!open && f.matches(':target')) history.replaceState(null, '', location.pathname + location.search)
  }
  links.forEach(a => {
    a.setAttribute('aria-expanded', String(formOf(a).matches('.open, :target')))
    a.addEventListener('click', e => {
      e.preventDefault()
      const open = a.getAttribute('aria-expanded') !== 'true'
      links.forEach(x => x !== a && set(x, false))
      set(a, open)
      if (open) formOf(a).querySelector('textarea').focus()
    })
    formOf(a).querySelector('.cancel').addEventListener('click', e => {
      e.preventDefault()
      set(a, false)
      a.focus()
    })
  })
})()

// "+ n more" in the people card (decided Oct 14): everyone here in a modal, loaded from /w/<path>/people when it first
// opens, closed by ×, Esc or a click on the scrim, with focus back on "+ n more". Without scripts it's a link to the list.
;(() => {
  const opener = document.getElementById('pp-open'), sc = document.getElementById('pp-scrim')
  if (!opener || !sc) return
  const W = window.W.node
  const box = sc.querySelector('.pp'), list = document.getElementById('pp-list'), note = document.getElementById('pp-note')
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
  const perDay = x => (x >= 10 ? String(Math.round(x)) : String(Math.round(x * 10) / 10))
  // A person's name as the page links it (render/text.tsx nameHref); "former member" stays plain.
  const name = n => {
    if (!/^@[a-z0-9_]+$/i.test(n)) return el('span', null, n)
    const a = el('a', null, n)
    a.href = '/@' + n.slice(1)
    return a
  }
  const row = p => {
    const li = el('li')
    if (p.joined_by) {
      const who = el('span', 'who-by')
      who.append(name(p.name), el('span', 'jb', window.W.fill(W.joinedBy, { name: p.joined_by })))
      li.append(who)
    } else li.append(name(p.name))
    const small = el('small')
    if (p.author) small.append(p.posts > 0 ? W.author + ' · ' : W.author)
    if (p.posts > 0) {
      const q = (Math.round(Math.max(0, p.upvotes / p.posts) * 10) / 10).toFixed(1), ppd = perDay(p.posts_per_day)
      const imp = el('span', 'imp', window.W.fill(W.perDay, { ppd }))
      imp.style.setProperty('--q', q)
      imp.title = window.W.fill(W.impTitle, { q, ppd })
      small.append(imp)
    }
    li.append(small)
    return li
  }
  let loaded = false
  async function load() {
    if (loaded) return
    note.textContent = W.loading
    try {
      const r = await fetch(box.dataset.src, { headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error(String(r.status))
      const j = await r.json()
      list.replaceChildren(...j.people.map(row))
      note.textContent = ''
      loaded = true
    } catch {
      const [before, after = ''] = W.failed.split('{link}')
      const a = el('a', null, W.openList)
      a.href = opener.href
      note.replaceChildren(before, a, after)
    }
  }
  const close = () => { sc.hidden = true; opener.focus({ preventScroll: true }) }
  opener.addEventListener('click', e => {
    e.preventDefault()
    sc.hidden = false
    document.getElementById('pp-close').focus()
    load()
  })
  document.getElementById('pp-close').addEventListener('click', close)
  sc.addEventListener('click', e => { if (e.target === sc) close() })
  document.addEventListener('keydown', e => {
    if (sc.hidden) return
    if (e.key === 'Escape') return close()
    if (e.key === 'Tab') {
      const f = [...sc.querySelectorAll('button, [href]')], first = f[0], last = f[f.length - 1], at = document.activeElement
      if (!sc.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus() }
      else if (e.shiftKey && at === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus() }
    }
  })
})()
