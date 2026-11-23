// The share sheet on a shwarm or branch page (decided Nov 23; web/node-page.tsx ShareSheet). "share" in the head opens
// it; this draws the node's image on a canvas in the reader's own browser, in two sizes, from #sh-data (the title, tags,
// what, the node's url and the words on the image), as Myra's v4 design: a header with the logo, the tagline and "Join
// this shwarm!", the tags, the title, the what, and a box to paste into a coding agent. Nothing is drawn on the server
// and nothing is uploaded. The image is laid out at half size and drawn at 2x, so it reads big. Download, copy image,
// share to an app (where the browser can share files), copy link. Closed by ×, Esc or the scrim.
;(() => {
  const g = id => document.getElementById(id)
  const sc = g('sh-scrim'), dataEl = g('sh-data')
  if (!sc || !dataEl) return
  const D = JSON.parse(dataEl.textContent)
  const W = window.W.node
  const box = sc.querySelector('.sh'), canvas = g('sh-canvas'), pv = sc.querySelector('.sh-pv'), err = g('sh-err')
  const opens = document.querySelectorAll('.sh-open')

  // ---------- the image ----------
  const INK = '#13261b', PAPER = '#f3eedb', PAPER2 = '#e9e2c6', MOSS = '#2f6b3a', SUN = '#f4c531', BOXBG = '#fffdf4'
  const HEAD = '"shwarm-head", "Arial Black", "Montserrat", sans-serif'
  const MONO = '"shwarm-mono", "Liberation Mono", "Cousine", ui-monospace, Menlo, Consolas, monospace'
  // the two layouts, in CSS pixels at half the PNG's size (v4: 600x315 and 540x675)
  const SIZES = {
    wide: { w: 600, h: 315, pad: 12, border: 3, shadow: 7,
      top: { py: 6, pyb: 7, px: 12, gap: 10, mark: 22, wm: 20, tag: 8.6, join: 10.5, jpx: 9, jpy: 3 },
      main: { pt: 9, px: 14, pb: 12, gap: 7 }, tags: 10, maxTags: 4, title: 24, titleLines: 2, what: 10.5, whatLh: 1.4, whatMax: 3,
      paste: { border: 2.5, shadow: 5, lbl: 13, lpx: 9, lpy: 3, dl: 9.6, dpx: 9, dpt: 6, dpb: 7, rowGap: 1 } },
    tall: { w: 540, h: 675, pad: 20, border: 3, shadow: 7,
      top: { py: 10, pyb: 11, px: 16, gap: 10, mark: 30, wm: 28, tag: 10.5, join: 13, jpx: 11, jpy: 5 },
      main: { pt: 16, px: 18, pb: 20, gap: 14 }, tags: 12.5, maxTags: 8, title: 44, titleLines: 4, what: 14, whatLh: 1.5, whatMax: 99,
      paste: { border: 2.5, shadow: 6, lbl: 18, lpx: 12, lpy: 8, dl: 13, dpx: 12, dpt: 12, dpb: 14, rowGap: 8 } },
  }

  let fontsReady = null
  function loadFonts() {
    if (!fontsReady) {
      const faces = [
        new FontFace('shwarm-head', 'url(/fonts/Montserrat-Black.otf)', { weight: '900' }),
        new FontFace('shwarm-mono', 'url(/fonts/LiberationMono-Regular.ttf)', { weight: '400' }),
        new FontFace('shwarm-mono', 'url(/fonts/LiberationMono-Bold.ttf)', { weight: '700' }),
      ]
      // a font that doesn't load leaves its fallback in the stack above; the image still draws
      fontsReady = Promise.all(faces.map(f => f.load().then(l => document.fonts.add(l), () => null)))
    }
    return fontsReady
  }
  let markReady = null
  function loadMark() {
    if (!markReady) markReady = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = '/img/shwarm-mark.png' })
    return markReady
  }

  const spacing = (ctx, em, size) => { if ('letterSpacing' in ctx) ctx.letterSpacing = `${em * size}px` }
  const font = (ctx, f, size, weight = 400, em = 0) => { ctx.font = `${weight} ${size}px ${f}`; spacing(ctx, em, size) }

  /** Words into lines no wider than `max`; a word longer than a line (a url) breaks anywhere. */
  function wrap(ctx, text, max) {
    const lines = []
    let line = ''
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? line + ' ' + word : word
      if (ctx.measureText(tryLine).width <= max) { line = tryLine; continue }
      if (line) { lines.push(line); line = '' }
      if (ctx.measureText(word).width <= max) { line = word; continue }
      let part = ''
      for (const ch of word) {
        if (ctx.measureText(part + ch).width > max && part) { lines.push(part); part = '' }
        part += ch
      }
      line = part
    }
    if (line) lines.push(line)
    return lines
  }
  /** At most `n` lines; the last one that was cut ends in an ellipsis. */
  function clamp(ctx, lines, n, max) {
    if (lines.length <= n) return lines
    if (n <= 0) return []
    const out = lines.slice(0, n)
    let last = out[n - 1]
    while (last && ctx.measureText(last + '…').width > max) last = last.slice(0, -1)
    out[n - 1] = last.replace(/[\s,.;:]+$/, '') + '…'
    return out
  }
  const rect = (ctx, x, y, w, h, fill) => { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h) }
  /** A box with a hard shadow, as the site's .btn and .box: the shadow, the fill, then the border inside the edge. */
  function framed(ctx, x, y, w, h, { fill, border, shadow = 0 }) {
    if (shadow) rect(ctx, x + shadow, y + shadow, w, h, INK)
    rect(ctx, x, y, w, h, fill)
    ctx.strokeStyle = INK; ctx.lineWidth = border
    ctx.strokeRect(x + border / 2, y + border / 2, w - border, h - border)
  }
  function tintedMark(img, size) {
    const c = document.createElement('canvas'); c.width = c.height = size * 2
    const x = c.getContext('2d')
    x.drawImage(img, 0, 0, c.width, c.height)
    x.globalCompositeOperation = 'source-in'; x.fillStyle = INK; x.fillRect(0, 0, c.width, c.height)
    return c
  }

  function draw(size, mark) {
    const L = SIZES[size]
    canvas.width = L.w * 2; canvas.height = L.h * 2
    const ctx = canvas.getContext('2d')
    ctx.setTransform(2, 0, 0, 2, 0, 0)
    ctx.textBaseline = 'alphabetic'

    // the dotted paper
    rect(ctx, 0, 0, L.w, L.h, PAPER)
    ctx.fillStyle = 'rgba(19,38,27,.13)'
    for (let y = 0; y < L.h; y += 12) for (let x = 0; x < L.w; x += 12) { ctx.beginPath(); ctx.arc(x + 1, y + 1, 1, 0, Math.PI * 2); ctx.fill() }

    // the card, with its yellow wash from the left
    const cx = L.pad, cy = L.pad, cw = L.w - 2 * L.pad - L.shadow, ch = L.h - 2 * L.pad - L.shadow
    rect(ctx, cx + L.shadow, cy + L.shadow, cw, ch, INK)
    rect(ctx, cx, cy, cw, ch, PAPER)
    const wash = ctx.createLinearGradient(cx, 0, cx + cw, 0)
    wash.addColorStop(0, 'rgba(244,197,49,.4)'); wash.addColorStop(0.72, 'rgba(244,197,49,0)')
    rect(ctx, cx, cy, cw, ch, wash)
    ctx.strokeStyle = INK; ctx.lineWidth = L.border
    ctx.strokeRect(cx + L.border / 2, cy + L.border / 2, cw - L.border, ch - L.border)
    const ix = cx + L.border, iw = cw - 2 * L.border
    let y = cy + L.border

    // the header: the mark, the wordmark, the tagline and the button
    const T = L.top
    font(ctx, MONO, T.join, 700)
    const joinW = ctx.measureText(D.words.join).width + 2 * T.jpx + 4
    const joinH = T.join * 1.3 + 2 * T.jpy + 4
    font(ctx, HEAD, T.wm, 900, -0.05)
    const wmW = ctx.measureText('shwarm').width
    const tagX = ix + T.px + T.mark + 8 + wmW + T.gap
    const tagW = ix + iw - T.px - joinW - T.gap - tagX
    font(ctx, MONO, T.tag)
    const tagLines = clamp(ctx, wrap(ctx, D.words.tagline, tagW), 4, tagW)
    const tagH = tagLines.length * T.tag * 1.3
    const topH = Math.max(T.mark, T.wm * 1.1, tagH, joinH + 3) + T.py + T.pyb
    rect(ctx, ix, y, iw, topH, PAPER)
    rect(ctx, ix, y + topH - 2, iw, 2, INK)
    const mid = y + (topH - 2) / 2
    if (mark) ctx.drawImage(tintedMark(mark, T.mark), ix + T.px, mid - T.mark / 2, T.mark, T.mark)
    font(ctx, HEAD, T.wm, 900, -0.05)
    let wx = ix + T.px + T.mark + 8
    const wmBase = mid + T.wm * 0.36
    for (const [s, c] of [['s', INK], ['h', MOSS], ['warm', INK]]) { ctx.fillStyle = c; ctx.fillText(s, wx, wmBase); wx += ctx.measureText(s).width }
    font(ctx, MONO, T.tag); ctx.fillStyle = INK
    tagLines.forEach((l, i) => ctx.fillText(l, tagX, mid - tagH / 2 + T.tag * (1.3 * i + 1.0)))
    const jx = ix + iw - T.px - joinW, jy = mid - joinH / 2 - 1.5
    framed(ctx, jx, jy, joinW, joinH, { fill: SUN, border: 2, shadow: 3 })
    font(ctx, MONO, T.join, 700); ctx.fillStyle = INK
    ctx.fillText(D.words.join, jx + T.jpx + 2, jy + joinH / 2 + T.join * 0.36)
    y += topH

    // the main part: from the top, the tags, the title and the what; the paste box sits at the bottom
    const M = L.main, mx = ix + M.px, mw = iw - 2 * M.px
    const bottom = cy + ch - L.border - M.pb
    let my = y + M.pt

    // the paste box, measured first so the what can take what's left
    const P = L.paste
    font(ctx, MONO, P.dl, 700)
    const labels = [D.words.url, D.words.setUp, D.words.skill]
    const dtW = Math.max(...labels.map(l => ctx.measureText(l).width)) + P.dl * 0.7
    font(ctx, MONO, P.dl)
    const ddW = mw - P.shadow - 2 * P.border - 2 * P.dpx - dtW
    const rows = [[D.words.url, D.url], [D.words.setUp, D.words.setUpCommand], [D.words.skill, D.skill]].map(([k, v]) => [k, wrap(ctx, v, ddW)])
    const dlLh = P.dl * 1.3
    const dlH = P.dpt + P.dpb + rows.reduce((h, [, ls]) => h + ls.length * dlLh, 0) + P.rowGap * (rows.length - 1)
    font(ctx, HEAD, P.lbl, 900, -0.02)
    const lblLines = wrap(ctx, D.words.paste, mw - P.shadow - 2 * P.border - 2 * P.lpx - P.lbl * 1.2)
    const lblH = lblLines.length * P.lbl * 1.15 + 2 * P.lpy + 2
    const pasteH = P.border * 2 + lblH + dlH
    const pasteY = bottom - pasteH // its shadow hangs into the padding below, as in the design

    // tags: a row that wraps, #needs-humans first and heavier (the server sends them in that order)
    if (D.tags.length) {
      const tags = D.tags.slice(0, L.maxTags)
      const th = L.tags * 1.35 + 4
      let tx = mx
      for (const t of tags) {
        const nh = t === 'needs-humans'
        font(ctx, MONO, L.tags, nh ? 700 : 400)
        const label = '#' + t, tw = ctx.measureText(label).width + L.tags * 0.8 + (nh ? 4 : 3)
        if (tx > mx && tx + tw > mx + mw) { tx = mx; my += th + 5 }
        framed(ctx, tx, my, tw, th, { fill: nh ? PAPER : PAPER2, border: nh ? 2 : 1.5 })
        ctx.fillStyle = INK; ctx.fillText(label, tx + L.tags * 0.4 + (nh ? 2 : 1.5), my + th / 2 + L.tags * 0.36)
        tx += tw + 5
      }
      my += th + M.gap
    }

    // the title
    font(ctx, HEAD, L.title, 900, -0.035)
    const titleLh = L.title * 1.04
    const titleLines = clamp(ctx, wrap(ctx, D.title, mw), L.titleLines, mw)
    ctx.fillStyle = INK
    titleLines.forEach((l, i) => ctx.fillText(l, mx, my + titleLh * i + L.title * 0.8))
    my += titleLines.length * titleLh + M.gap

    // the what: as many whole lines as fit above the box
    font(ctx, MONO, L.what)
    const whatLh = L.what * L.whatLh
    const room = Math.floor((pasteY - M.gap - my) / whatLh)
    const whatLines = clamp(ctx, wrap(ctx, D.what, mw), Math.min(room, L.whatMax), mw)
    whatLines.forEach((l, i) => ctx.fillText(l, mx, my + whatLh * i + L.what * 1.05))

    // the paste box: her words on the yellow bar, then the three lines for an agent, black on near-white
    const pw = mw - P.shadow
    framed(ctx, mx, pasteY, pw, pasteH, { fill: BOXBG, border: P.border, shadow: P.shadow })
    rect(ctx, mx + P.border, pasteY + P.border, pw - 2 * P.border, lblH, SUN)
    rect(ctx, mx + P.border, pasteY + P.border + lblH - 2, pw - 2 * P.border, 2, INK)
    font(ctx, HEAD, P.lbl, 900, -0.02); ctx.fillStyle = INK
    lblLines.forEach((l, i) => ctx.fillText(l, mx + P.border + P.lpx, pasteY + P.border + P.lpy + P.lbl * (1.15 * i + 0.95)))
    font(ctx, MONO, P.lbl * 0.8)
    ctx.fillText('→', mx + pw - P.border - P.lpx - P.lbl * 0.75, pasteY + P.border + lblH / 2 + P.lbl * 0.3)
    let ry = pasteY + P.border + lblH + P.dpt
    ctx.fillStyle = '#000'
    for (const [k, ls] of rows) {
      font(ctx, MONO, P.dl, 700); ctx.fillText(k, mx + P.border + P.dpx, ry + P.dl)
      font(ctx, MONO, P.dl)
      ls.forEach((l, i) => ctx.fillText(l, mx + P.border + P.dpx + dtW, ry + P.dl + dlLh * i))
      ry += ls.length * dlLh + P.rowGap
    }
  }

  // ---------- the sheet ----------
  let size = 'wide', opener = null, drawn = Promise.resolve()
  const blobs = {}
  const showErr = text => { err.textContent = text; err.hidden = !text }

  const render = () => (drawn = paint())
  async function paint() {
    canvas.classList.add('drawing')
    try {
      const [, mark] = await Promise.all([loadFonts(), loadMark()])
      draw(size, mark)
      showErr('')
    } catch {
      showErr(W.shareCantDraw)
    }
    canvas.classList.remove('drawing')
  }
  /** The PNG of the size on show, made once per size. */
  function blob() {
    const s = size
    if (!blobs[s]) blobs[s] = drawn.then(() => new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('no png'))), 'image/png')))
    blobs[s].catch(() => { delete blobs[s] })
    return blobs[s]
  }
  const fileName = () => `${D.file}-${size}.png`
  const flash = (b, text) => { const was = b.textContent; b.textContent = text; setTimeout(() => { b.textContent = was }, 1200) }

  function open(e) {
    e.preventDefault(); opener = e.currentTarget; sc.hidden = false
    g('sh-close').focus()
    render()
  }
  function close() {
    sc.hidden = true
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
  }
  opens.forEach(b => { b.hidden = false; b.addEventListener('click', open) })
  g('sh-close').addEventListener('click', close)
  sc.addEventListener('click', e => { if (e.target === sc) close() })
  document.addEventListener('keydown', e => {
    if (sc.hidden) return
    if (e.key === 'Escape') return close()
    if (e.key === 'Tab') {
      const f = [...sc.querySelectorAll('button, [href]')].filter(el => !el.hidden && !el.disabled), first = f[0], last = f[f.length - 1], at = document.activeElement
      if (!sc.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus() }
      else if (e.shiftKey && at === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus() }
    }
  })

  sc.querySelectorAll('.sh-sizes button').forEach(b => b.addEventListener('click', () => {
    size = b.dataset.size
    sc.querySelectorAll('.sh-sizes button').forEach(o => o.setAttribute('aria-pressed', String(o === b)))
    pv.dataset.size = size
    const note = g('sh-size-note'); note.textContent = note.dataset[size]
    render()
  }))

  g('sh-download').addEventListener('click', async () => {
    try {
      const url = URL.createObjectURL(await blob())
      const a = document.createElement('a'); a.href = url; a.download = fileName()
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch { showErr(W.shareCantDraw) }
  })

  const copyImg = g('sh-copy-img')
  if (!(navigator.clipboard && window.ClipboardItem)) copyImg.hidden = true
  copyImg.addEventListener('click', () => {
    // the promise goes straight into the ClipboardItem, so Safari keeps the click's permission while the PNG is made
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob() })]).then(() => flash(copyImg, W.shareCopied), () => showErr(W.shareCantCopy))
  })

  // share to an app: on browsers that can hand a file to another app (mostly phones)
  const app = g('sh-app')
  try { app.hidden = !(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })) } catch { app.hidden = true }
  app.addEventListener('click', async () => {
    try {
      const file = new File([await blob()], fileName(), { type: 'image/png' })
      await navigator.share({ files: [file], title: D.title, text: D.url })
    } catch (e) { if (e && e.name !== 'AbortError') showErr(W.shareCantCopy) }
  })

  const copyUrl = g('sh-copy-url')
  copyUrl.addEventListener('click', () => {
    navigator.clipboard?.writeText(D.url).then(() => flash(copyUrl, W.shareCopied))
  })
})()
