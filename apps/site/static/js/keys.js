// The keys page (go-live 7.2, as in mockups/keys.html): the new-key modal, its grant chooser, and making or rotating a key.
// The key pair is made here with WebCrypto (Ed25519). Only the public half goes to the server; the secret,
// shwarm_sk_<keyid>_<seed>, is put together here from the keyid the server answers with, shown once, and dropped when
// the modal closes (the page reloads to show the new row). Without script the list still shows and revoke works;
// making and rotating need this file, so "+ new key" and "rotate" stay hidden until it runs.
// Node titles are participant text: they go in with textContent, never as markup.
(() => {
  const g = id => document.getElementById(id)
  const sc = g('scrim')
  if (!sc) return
  const step1 = g('step1'), step2 = g('step2'), opener = g('newkey')
  const PERMS = ['read', 'post', 'submit', 'check', 'branch', 'join', 'pin', 'new_shwarms']
  const LATER = ['edit', 'delete'] // no calls yet (#30): shown, not settable
  const DEFAULT = ['read', 'post', 'submit', 'check']
  // The words, from the word list (w.keys.script). OPEN (#115): the join permission's title is new words, and so is the
  // pin permission's (Oct 13); OPEN (#88): so are the refusals.
  const W = window.W.keys
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e }
  /** An entry with {name} slots filled by text or elements, as pieces for append() and replaceChildren(). */
  const pieces = (entry, vars) => entry.split(/(\{\w+\})/).filter(Boolean).map(p => { const m = /^\{(\w+)\}$/.exec(p); return m && m[1] in vars ? vars[m[1]] : p })
  let lastFocus = null, made = false, busy = false

  // ---------- the key pair and the server ----------

  /** A fresh Ed25519 pair: the public half (x) and the 32-byte seed (d), both base64url, as protocol §10 writes them. */
  async function keyPair() {
    const k = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const jwk = await crypto.subtle.exportKey('jwk', k.privateKey)
    if (!jwk.d || !jwk.x) throw new Error('no ed25519')
    return { pub: jwk.x, seed: jwk.d }
  }

  /** POSTs exactly these fields (never the seed) and reads the JSON answer. */
  async function send(fields) {
    const res = await fetch('/keys', { method: 'POST', headers: { accept: 'application/json' }, body: new URLSearchParams(fields), credentials: 'same-origin' })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  }

  /** The password field of a form, if the 10-minute window was open when the page was made it's hidden: shown on demand. */
  const password = form => form.querySelector('label.pw input')

  /** Shows a refusal: at its field when the form has a place for it, else under the button. A password refusal shows the password field. */
  function refused(form, data, fallback) {
    const pw = password(form)
    if (data.field === 'password' && pw) { pw.closest('label').hidden = false; pw.required = true }
    const at = (data.field && form.querySelector(`#e-${data.field}`)) || fallback
    at.textContent = data.error || W.failed
    at.hidden = false
    const focus = data.field === 'password' ? pw : data.field === 'name' ? g('kname') : data.field === 'post_as' ? g('kscope') : data.field === 'grants' ? g('gsearch') : null
    focus?.focus()
  }

  /** Makes the pair, sends `fields` with its public half, and on success shows the secret in the modal's last step. */
  async function run(form, button, fields, fallback) {
    if (busy) return
    busy = true
    button.setAttribute('aria-busy', 'true')
    form.querySelectorAll('.err').forEach(e => { e.hidden = true; e.textContent = '' })
    try {
      let pair
      try { pair = await keyPair() } catch { return refused(form, { error: W.noCrypto }, fallback) }
      const pw = password(form)
      if (pw?.value) fields.password = pw.value
      let r
      try { r = await send({ ...fields, public_key: pair.pub }) } catch { return refused(form, { error: W.offline }, fallback) }
      if (!r.ok) return refused(form, r.data, fallback)
      if (pw) pw.value = ''
      showSecret(r.data, pair.seed)
    } finally {
      busy = false
      button.removeAttribute('aria-busy')
    }
  }

  function showSecret(data, seed) {
    const secret = `shwarm_sk_${data.keyid}_${seed}`
    g('madefor').textContent = data.name
    g('secret').textContent = secret
    g('envkey').textContent = secret
    g('scopeecho').textContent = data.can_post_as
    g('accecho').textContent = data.access && data.access.length ? data.access.join(', ') : W.nothingYet
    step1.hidden = true
    step2.hidden = false
    made = true
    if (sc.hidden) { lastFocus = document.activeElement; sc.hidden = false }
    g('copy').focus()
  }

  // ---------- the modal ----------

  const focusables = () => [...sc.querySelectorAll('a[href], button, input, textarea, select, summary')]
    .filter(e => !e.disabled && e.type !== 'hidden' && e.getClientRects().length)
  function open() {
    lastFocus = document.activeElement
    step1.reset()
    step1.querySelectorAll('.err').forEach(e => { e.hidden = true; e.textContent = '' })
    resetGrants()
    step1.hidden = false
    step2.hidden = true
    sc.hidden = false
    g('kname').focus()
  }
  function close() {
    sc.hidden = true
    if (made) {
      // The secret leaves the page; the reload shows the new key's row.
      g('secret').textContent = ''
      g('envkey').textContent = ''
      location.assign('/keys')
      return
    }
    ;(lastFocus && lastFocus !== document.body ? lastFocus : opener)?.focus()
  }
  if (opener) { opener.hidden = false; opener.addEventListener('click', open) }
  g('mclose').addEventListener('click', close)
  g('done').addEventListener('click', close)
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
  g('copy').addEventListener('click', () => {
    navigator.clipboard?.writeText(g('secret').textContent).then(() => {
      g('copy').textContent = W.copied
      setTimeout(() => { g('copy').textContent = W.copy }, 1200)
    })
  })

  step1.addEventListener('submit', e => {
    e.preventDefault()
    const f = new FormData(step1)
    run(step1, g('make'), {
      form_token: f.get('form_token'), do: 'make', name: f.get('name') ?? '', post_as: f.get('post_as') ?? '', expires: f.get('expires') ?? '90', grants: grantsJson(),
      dm: f.get('dm') ? '1' : '0',
    }, g('e-make'))
  })

  // rotate: the row's form, then the modal's last step with the new secret
  document.querySelectorAll('details.kact.rot').forEach(d => { d.hidden = false })
  document.querySelectorAll('form.rotate-act').forEach(form => form.addEventListener('submit', e => {
    e.preventDefault()
    const f = new FormData(form)
    run(form, form.querySelector('button[type="submit"]'), { form_token: f.get('form_token'), do: 'rotate', key: f.get('key') }, form.querySelector('.err'))
  }))
  // one open act at a time
  const acts = [...document.querySelectorAll('details.kact')]
  acts.forEach(d => d.addEventListener('toggle', () => { if (d.open) acts.forEach(x => { if (x !== d) x.open = false }) }))

  // ---------- grants ----------

  const grantsBox = g('grants')
  /** One grant: '*' (all shwarms) or a node path, with each step's title from the shwarm down. */
  function addGrant(node, titles) {
    if ([...grantsBox.children].some(x => x.dataset.node === node)) return
    const name = node === '*' ? W.allShwarms : titles.join(' / ')
    const box = el('div', 'grant')
    box.dataset.node = node
    const gh = el('div', 'gh')
    const head = el('div', node === '*' ? '' : 'gpath')
    if (node === '*') head.append(el('b', '', W.allShwarms), el('span', '', W.everyShwarm))
    else titles.forEach((t, i) => {
      if (i) head.append(' ', el('i', '', '/'), ' ')
      head.append(i === titles.length - 1 ? el('b', '', t) : t)
    })
    const x = el('button', '', '×')
    x.type = 'button'
    x.setAttribute('aria-label', window.W.fill(W.remove, { name }))
    x.addEventListener('click', () => { box.remove(); g('gsearch').focus() })
    gh.append(head, x)
    const perms = el('div', 'perms')
    perms.setAttribute('role', 'group')
    perms.setAttribute('aria-label', window.W.fill(W.mayDoIn, { name }))
    // new shwarms only on all shwarms, off by default: a new shwarm isn't inside one you pick
    for (const p of PERMS.filter(p => p !== 'new_shwarms' || node === '*')) {
      const l = el('label')
      l.title = W.permTitles[p]
      const i = el('input')
      i.type = 'checkbox'
      i.value = p
      i.checked = DEFAULT.includes(p)
      l.append(i, p.replace('_', ' '))
      perms.append(l)
    }
    for (const p of LATER) {
      const l = el('label', 'later')
      l.title = window.W.fill(W.laterTitle, { what: W.permTitles[p] })
      const i = el('input')
      i.type = 'checkbox'
      i.disabled = true
      l.append(i, p, ' ', el('small', '', W.later))
      perms.append(l)
    }
    box.append(gh, perms)
    grantsBox.append(box)
  }
  function resetGrants() { grantsBox.replaceChildren(); addGrant('*', []); cancel() }
  const grantsJson = () => JSON.stringify([...grantsBox.children].map(b => ({ node: b.dataset.node, perms: [...b.querySelectorAll('input:checked')].map(i => i.value) })))

  // ---------- the chooser: pick a shwarm, then keep drilling into branches; enter on an empty box adds the path so far ----------

  const input = g('gsearch'), wrap = g('gresults'), list = g('glist'), foot = g('gfoot')
  const LINK = /^(?:https?:\/\/[^/\s]+)?\/w\/([^?#\s]+)/i
  let chosen = [], rows = [], hi = 0, seq = 0, timer = 0, moved = false // moved: the arrows picked a row

  async function lookup(params) {
    try {
      const res = await fetch('/keys/nodes?' + new URLSearchParams(params), { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      const d = await res.json().catch(() => ({}))
      return res.ok ? d : { error: d.error || W.failed }
    } catch {
      return { error: W.offline }
    }
  }
  const pathOf = (path, n) => path.split('/').slice(0, n).join('/')

  async function render() {
    const mine = ++seq
    const q = input.value.trim(), lq = q.toLowerCase()
    let head, next = []
    if (!chosen.length) {
      const m = LINK.exec(q)
      if (m) {
        let path = m[1]
        try { path = decodeURIComponent(path) } catch { /* as typed */ }
        const d = await lookup({ path })
        head = d.node ? W.fromLink : d.error
        if (d.node) next = [{ path: d.node.path, titles: d.node.titles, final: true }]
      } else {
        const d = await lookup(q ? { q } : {})
        next = (!q || W.allShwarms.includes(lq) ? [{ all: true }] : []).concat((d.rows || []).map(r => ({ path: r.path, titles: [r.title], kids: r.kids })))
        head = d.error || (q ? W.shwarms : W.youreIn)
      }
    } else {
      const d = await lookup({ under: chosen[chosen.length - 1].path })
      const kids = (d.rows || []).filter(r => !q || r.title.toLowerCase().includes(lq))
      next = kids.map(r => ({ path: r.path, titles: chosen.map(c => c.title).concat(r.title), kids: r.kids }))
      head = d.error || (kids.length ? W.branches : q ? W.noBranchMatches : W.noBranches)
    }
    if (mine !== seq) return // a newer answer is on its way
    rows = next
    hi = Math.min(hi, Math.max(rows.length - 1, 0))
    draw(head)
  }

  /** What enter takes: the highlighted row, unless the box is empty inside a shwarm, where it adds the path so far. */
  const lit = () => !!input.value.trim() || moved || !chosen.length

  function draw(head) {
    g('ghead').textContent = head
    const on = lit()
    list.replaceChildren(...rows.map((r, i) => {
      const li = el('li', i === hi && on ? 'on' : '')
      li.id = `gopt-${i}`
      li.setAttribute('role', 'option')
      li.setAttribute('aria-selected', String(i === hi && on))
      if (r.all) li.append(el('b', '', W.allShwarms), ' ', el('span', '', W.everyShwarm))
      else {
        li.append(el('b', '', r.titles[r.titles.length - 1]))
        if (r.kids && !r.final) li.append(el('span', 'more', `${r.kids} ▸`))
      }
      li.addEventListener('mousedown', e => { e.preventDefault(); choose(r) })
      return li
    }))
    if (rows.length && on) input.setAttribute('aria-activedescendant', `gopt-${hi}`)
    else input.removeAttribute('aria-activedescendant')
    if (chosen.length) {
      const here = chosen[chosen.length - 1]
      foot.replaceChildren(...pieces(W.chooserFoot, {
        enter: el('kbd', '', W.keyEnter), path: el('b', '', chosen.map(c => c.title).join(' / ')), andBranches: here.kids ? W.andBranches : '',
        backspace: el('kbd', '', '⌫'), esc: el('kbd', '', W.keyEsc),
      }))
      foot.hidden = false
    } else foot.hidden = true
    wrap.hidden = false
    input.setAttribute('aria-expanded', 'true')
  }

  function crumbs() {
    g('gcrumbs').replaceChildren(...chosen.flatMap(c => [el('span', 'seg', c.title), el('i', '', '/')]))
    input.placeholder = chosen.length ? W.pickBranch : W.addPlaceholder
  }
  function hide() { wrap.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant') }
  function cancel() { chosen = []; input.value = ''; hi = 0; moved = false; crumbs(); hide() }
  function choose(r) {
    if (r.all) return finish('*', [])
    if (r.final || !r.kids) return finish(r.path, r.titles)
    chosen = r.titles.map((t, i) => ({ title: t, path: pathOf(r.path, i + 1), kids: i === r.titles.length - 1 ? r.kids : 1 }))
    input.value = ''
    hi = 0
    moved = false
    crumbs()
    render()
  }
  function finish(node, titles) {
    addGrant(node, titles)
    cancel()
    g('e-grants').hidden = true
  }

  input.addEventListener('input', () => { hi = 0; moved = false; clearTimeout(timer); timer = setTimeout(render, 150) })
  input.addEventListener('focus', render)
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (wrap.hidden) return render()
      if (moved || !chosen.length || input.value.trim()) hi = e.key === 'ArrowDown' ? Math.min(hi + 1, rows.length - 1) : Math.max(hi - 1, 0)
      moved = true
      draw(g('ghead').textContent)
    }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (lit() && rows[hi]) choose(rows[hi]) // a filter typed or a row picked: take the highlighted one
      else if (chosen.length) finish(chosen[chosen.length - 1].path, chosen.map(c => c.title)) // empty box: add the path so far
    }
    else if (e.key === 'Backspace' && !input.value && chosen.length) { chosen.pop(); moved = false; crumbs(); render() }
    else if (e.key === 'Escape' && (!wrap.hidden || chosen.length)) { e.stopPropagation(); cancel() }
  })
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) hide() }, 150))
})()
