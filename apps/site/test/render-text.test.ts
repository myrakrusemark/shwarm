import { describe, expect, it } from 'vitest'
import { extractMentions } from '../src/core/markdown'
import { hasHidden, hiddenIn, hiddenProblem, showHidden } from '../src/render/hidden'
import { linkParts, nameHref, renderCommand, renderLink, renderLog, renderName, renderNameLink, renderText, Text } from '../src/render/text'

import { OWASP } from './owasp'

const TAGS = new Set(['p', 'br', 'a', 'code', 'pre', 'span', 'div', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'em', 'del'])
const ATTRS = new Set(['class', 'href', 'rel', 'title', 'aria-hidden', 'start'])

/** Every tag in `html` is one the renderer writes, every attribute is allowed, every href is safe. */
function inert(html: string) {
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    expect(TAGS.has(m[1]), `tag <${m[1]}> in ${html}`).toBe(true)
    const attrs = m[2].trim()
    // attributes are name="value" pairs, double-quoted, with no quote or < inside a value
    expect(attrs, html).toMatch(/^(?:[a-z-]+="[^"<]*"\s*)*\/?$/)
    for (const a of attrs.matchAll(/([a-z-]+)="([^"]*)"/g)) {
      expect(ATTRS.has(a[1]), `attribute ${a[1]} in ${html}`).toBe(true)
      if (a[1] === 'href') expect(a[2], html).toMatch(/^(\/(?!\/)|https?:\/\/)/)
    }
  }
  // no stray < > from the input
  expect(html.replace(/<\/?[a-zA-Z][^>]*>/g, '')).not.toMatch(/[<>]/)
}

/** The visible text of rendered HTML. */
const textOf = (html: string) =>
  html
    .replace(/<br>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

describe('the text renderer: XSS', () => {
  it('renders every OWASP payload as inert text, in every mode', () => {
    for (const p of OWASP) {
      inert(renderText(p))
      inert(renderText(p, { inline: true }))
      inert(renderCommand(p))
      inert(renderLog(p))
      inert(renderName(p))
      inert(renderNameLink(p))
      inert(String(Text({ text: p })))
    }
  })

  it('keeps the payload as visible text', () => {
    for (const p of OWASP) {
      expect(textOf(renderLog(p)), p).toBe(p)
      expect(textOf(renderCommand(p)), p).toBe(p)
      const shown = textOf(renderText(p, { inline: true })).replace(/ ↗/g, '')
      if (!/https?:|[`\\*_~[]/i.test(p)) expect(shown, p).toBe(p) // backticks become code, Markdown marks go, links gain ↗
    }
  })

  it('links only http and https addresses', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', 'vbscript:x', 'file:///etc/passwd', 'ftp://example.com/x', '//evil.example/x']) {
      expect(renderText(bad), bad).not.toContain('<a')
      expect(renderLink(bad), bad).toBeNull()
    }
    expect(renderText('see HTTPS://Example.com/x.')).toContain('href="https://example.com/x"')
  })

  it("never embeds media: an image address is a link, not an <img>", () => {
    const html = renderText('screenshot: https://example.com/shot.png and ![x](https://example.com/y.jpg)')
    expect(html).not.toMatch(/<img|<video|<audio|<iframe/)
    expect(html).toContain('<a class="out" href="https://example.com/shot.png"')
  })
})

describe('the text renderer: links, names, tags', () => {
  it('writes outside links with nofollow ugc noopener noreferrer and a ↗', () => {
    expect(renderText('source on https://codeberg.org/bmo/doomcraft.')).toBe(
      '<p>source on <a class="out" href="https://codeberg.org/bmo/doomcraft" rel="nofollow ugc noopener noreferrer">https://codeberg.org/bmo/doomcraft<span class="ext" aria-hidden="true"> ↗</span></a>.</p>',
    )
  })

  it('leaves trailing punctuation out of a link, but keeps balanced parentheses', () => {
    expect(renderText('(see https://en.wikipedia.org/wiki/Doom_(1993_video_game)).')).toContain('href="https://en.wikipedia.org/wiki/Doom_(1993_video_game)"')
    expect(renderText('(https://example.com/a)')).toContain('href="https://example.com/a"')
    expect(renderText('"https://example.com/a",')).toContain('href="https://example.com/a"')
  })

  it('shows punycode for a look-alike domain', () => {
    // Cyrillic "аррӏе" looks like "apple"
    const p = linkParts('https://аррӏе.com/login')!
    expect(p.href).toBe('https://xn--80ak6aa92e.com/login')
    expect(p.text).toBe('https://xn--80ak6aa92e.com/login')
    expect(renderText('log in at https://аррӏе.com/login')).toContain('>https://xn--80ak6aa92e.com/login<')
    // mixed script: Latin with one Cyrillic "о"
    expect(linkParts('https://gооgle.com/')!.text).toMatch(/^https:\/\/xn--/)
    // an ASCII address shows as typed
    expect(linkParts('https://example.com/a?b=1#c')!.text).toBe('https://example.com/a?b=1#c')
  })

  it("doesn't link an address with a user part, which can put a trusted name before the real host", () => {
    for (const bad of [
      'https://accounts.google.com\u2215signin@evil.example/\u00e9', // U+2215 division slash
      'https://google.com@evil.example/login',
      'https://accounts.google.com%2F@evil.example',
      'https://user:pass@example.com/',
    ]) {
      expect(linkParts(bad), bad).toBeNull()
      expect(renderText(`sign in: ${bad}`), bad).not.toContain('<a')
    }
  })

  it('shows the host the link goes to, not an ASCII spelling that reads otherwise', () => {
    // a backslash is a path separator to the URL parser: this goes to google.com
    expect(linkParts('https://google.com\\@evil.example')).toEqual({ href: 'https://google.com/@evil.example', text: 'https://google.com/@evil.example' })
    expect(linkParts('http://0x7f.1/x')!.text).toBe('http://127.0.0.1/x')
    expect(linkParts('https://evil%2Eexample/')!.text).toBe('https://evil.example/')
    expect(linkParts('HTTPS://Example.com/x')!.text).toBe('HTTPS://Example.com/x')
    expect(linkParts('https://example.com/caf\u00e9')!.text).toBe('https://example.com/caf\u00e9')
  })

  it('shows hidden characters in a link and ends the link at one', () => {
    expect(renderText('https://example.com/‮gpj.exe')).toContain('<span class="hid" title="right-to-left override">⟦U+202E⟧</span>')
    expect(renderText('https://example.com/‮gpj.exe')).toContain('href="https://example.com/"')
  })

  it('links @names to the profile, and agent names to that name view', () => {
    expect(nameHref('@myra')).toBe('/@myra')
    expect(nameHref('@myra/m-04')).toBe('/@myra?as=%40myra/m-04')
    expect(nameHref('@no')).toBe('/@no')
    expect(nameHref('@x')).toBeNull()
    expect(nameHref('@a..b')).toBeNull()
    expect(renderText('thanks @myra/m-07. and @finn_irl!')).toBe(
      '<p>thanks <a href="/@myra?as=%40myra/m-07">@myra/m-07</a>. and <a href="/@finn_irl">@finn_irl</a>!</p>',
    )
    // email addresses and @@ aren't mentions
    expect(renderText('mail me@example.org or @@myra')).not.toContain('<a')
    // uppercase isn't a name
    expect(renderText('@Myra')).not.toContain('<a')
  })

  it('keeps a trailing "_" that belongs to a handle, in the link and the mention', () => {
    expect(renderText('thanks @ann_ for this')).toBe('<p>thanks <a href="/@ann_">@ann_</a> for this</p>')
    expect(extractMentions('thanks @ann_ for this')).toEqual(['@ann_'])
    expect(extractMentions('ask @ann_/bot. or @ann.')).toEqual(['@ann_/bot', '@ann'])
    expect(renderText('ask @ann_/bot.')).toContain('<a href="/@ann_?as=%40ann_/bot">@ann_/bot</a>.')
  })

  it('notifies exactly the names it links: none inside an address or code', () => {
    expect(extractMentions('see https://github.com/@myra and `@bob`')).toEqual([])
    expect(renderText('see https://github.com/@myra and `@bob`')).not.toContain('href="/@')
    expect(extractMentions('```\nping @bob\n```\nand @finn_irl')).toEqual(['@finn_irl'])
    const samples = [
      'thanks @myra/m-07. and @finn_irl! mail me@example.org or @@myra',
      '`@x1` @kestrel/swarm/r-17 (@myra) https://example.com/@no?u=@ann @ann_',
      'run:\n```\n@hidden\n```\n@shown, #tag @a..b @Myra',
      'https://google.com@evil.example/@bob then @carl',
    ]
    for (const t of samples) {
      const linked = [...new Set([...renderText(t).matchAll(/<a href="[^"]*">(@[^<]+)<\/a>/g)].map(m => m[1]))]
      expect(linked, t).toEqual(extractMentions(t))
    }
  })

  it('links #tags to the feed, not "#2" or a tag inside a word', () => {
    expect(renderText('#weird and #needs-humans. submission #2, issue#4, &#39;, C#')).toBe(
      '<p><a class="t" href="/?tag=weird">#weird</a> and <a class="t" href="/?tag=needs-humans">#needs-humans</a>. submission #2, issue#4, &amp;#39;, C#</p>',
    )
    expect(renderText('#Housing')).not.toContain('<a')
    expect(renderText('#' + 'a'.repeat(40))).not.toContain('<a')
  })

  it("doesn't link inside a URL or inside code", () => {
    const html = renderText('https://example.com/@myra#tag and `@myra #tag https://example.com`')
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain('<code>@myra #tag https://example.com</code>')
  })
})

describe('the text renderer: layout', () => {
  it('keeps line breaks and paragraphs', () => {
    expect(renderText('one\ntwo\r\n\r\n\nthree')).toBe('<p>one<br>two</p>\n<p>three</p>')
    expect(renderText('one\ntwo', { inline: true })).toBe('one<br>two')
  })

  it('shows code fences as preformatted, escaped, unlinked', () => {
    const html = renderText('run this:\n```sh\nmake test && echo "<ok>" @myra\n  indented\n```\nafter')
    expect(html).toBe('<p>run this:</p>\n<pre class="code"><code>make test &amp;&amp; echo &quot;&lt;ok&gt;&quot; @myra\n  indented</code></pre>\n<p>after</p>')
  })

  it('runs an unclosed fence to the end', () => {
    expect(renderText('```\n<b>open')).toBe('<pre class="code"><code>&lt;b&gt;open</code></pre>')
  })

  it('shows run logs as escaped preformatted text', () => {
    expect(renderLog('PASS 200/200\r\n<script>x</script>\n')).toBe('<pre class="log">PASS 200/200\n&lt;script&gt;x&lt;/script&gt;\n</pre>')
  })

  it('renders through the JSX component', () => {
    expect(String(Text({ text: 'hi @myra' }))).toBe('<div class="txt"><p>hi <a href="/@myra">@myra</a></p></div>')
    expect(String(Text({ text: 'done when\n60 fps', inline: true }))).toBe('done when<br>60 fps')
  })

  it('matches the snapshot for a typical post', () => {
    const post = [
      '@myra/m-04 repro for the corner case on your edge fix: stand diagonal to a chunk corner and place on the far face.',
      'map linked: https://archive.org/details/corner-repro (sha256 3bfe…)',
      '',
      '```',
      'gzdoom -iwad freedoom2.wad -file corner-repro.lmp',
      '```',
      'tagging #games #gzdoom, see `placement.c:212`.',
    ].join('\n')
    expect(renderText(post)).toMatchInlineSnapshot(`
      "<p><a href="/@myra?as=%40myra/m-04">@myra/m-04</a> repro for the corner case on your edge fix: stand diagonal to a chunk corner and place on the far face.<br>map linked: <a class="out" href="https://archive.org/details/corner-repro" rel="nofollow ugc noopener noreferrer">https://archive.org/details/corner-repro<span class="ext" aria-hidden="true"> ↗</span></a> (sha256 3bfe…)</p>
      <pre class="code"><code>gzdoom -iwad freedoom2.wad -file corner-repro.lmp</code></pre>
      <p>tagging <a class="t" href="/?tag=games">#games</a> <a class="t" href="/?tag=gzdoom">#gzdoom</a>, see <code>placement.c:212</code>.</p>"
    `)
  })
})

describe('hidden characters (Trojan Source)', () => {
  // The "early return" sample from trojansource.codes: an RLO/LRI pair hides a return inside a comment.
  const TROJAN = 'python3 -c "access_level = \'user\'\nif access_level != \'none‮ ⁦# check if admin⁩ ⁦\':\n    print(\'you are an admin.\')"'

  it('shows the escapes in a command', () => {
    const html = renderCommand(TROJAN)
    expect(html.startsWith('<pre class="cmd"><code>')).toBe(true)
    expect(textOf(html)).toBe(showHidden(TROJAN))
    expect(textOf(html)).toContain("!= 'none⟦U+202E⟧ ⟦U+2066⟧# check if admin⟦U+2069⟧ ⟦U+2066⟧'")
    expect(html).toContain('<span class="hid" title="right-to-left override">⟦U+202E⟧</span>')
    expect(html).not.toMatch(/[‪-‮⁦-⁩]/)
    expect(renderCommand('make​test')).toBe('<code class="cmd">make<span class="hid" title="zero width space">⟦U+200B⟧</span>test</code>')
  })

  it('shows the escapes in code fences, inline code, logs and names', () => {
    for (const html of [
      renderText('```\nok‮danger\n```'),
      renderText('`ok⁧x`'),
      renderLog('a﻿b'),
      renderName('@myra‍'),
      renderName('kestrel⁠'),
    ]) {
      expect(html).toContain('<span class="hid"')
      expect(html).not.toMatch(/[​-‍‪-‮⁠⁦-⁩﻿]/)
    }
  })

  it('in prose, shows the bidi controls but leaves emoji joiners alone', () => {
    expect(renderText('safe‮txt.exe')).toContain('⟦U+202E⟧')
    expect(renderText('👩‍💻 here')).toBe('<p>👩‍💻 here</p>')
  })

  it('shows invisible letters, operators, tag characters and the soft hyphen in a command', () => {
    const html = renderCommand('node -e "const a=1,\u3164=process.env.X;eval(\u3164)" && echo ok\u2062')
    expect(html).toContain('<span class="hid" title="hangul filler">⟦U+3164⟧</span>')
    expect(html).toContain('<span class="hid" title="invisible times">⟦U+2062⟧</span>')
    expect(html).not.toMatch(/[\u3164\u2062]/)
    expect(textOf(renderCommand('echo \u{E0068}\u{E0069}'))).toBe('echo ⟦U+E0068⟧⟦U+E0069⟧')
    for (const ch of ['\u00AD', '\u034F', '\u180E', '\u2061', '\u2064', '\u115F', '\u1160', '\uFFA0', '\u{E0001}', '\u{E007F}'])
      expect(renderCommand(`a${ch}b`), ch.codePointAt(0)!.toString(16)).toContain('class="hid"')
    // prose still leaves emoji joiners and the soft hyphen alone
    expect(renderText('👩\u200D💻 co\u00ADop')).toBe('<p>👩\u200D💻 co\u00ADop</p>')
  })

  it('finds and names them', () => {
    expect(hasHidden('plain')).toBe(false)
    expect(hasHidden('a‮b')).toBe(true)
    expect(hiddenIn('a‮b‮c​')).toEqual(['U+202E right-to-left override', 'U+200B zero width space'])
    expect(hiddenProblem('npm test', 'the run command')).toBeNull()
    expect(hiddenProblem('npm⁦ test', 'the run command')).toContain('U+2066 left-to-right isolate')
  })
})
