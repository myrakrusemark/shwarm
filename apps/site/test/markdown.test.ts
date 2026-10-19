// Participant text as Markdown (decided Oct 19): core/markdown.ts reads it, render/text.tsx writes it.
import { describe, expect, it } from 'vitest'
import { blockless, extractMentions, parseText, plainOf } from '../src/core/markdown'
import { renderText } from '../src/render/text'

const html = (s: string) => renderText(s)

describe('markdown: blocks', () => {
  it('keeps every line break inside a paragraph, as before', () => {
    expect(html('one\ntwo\n\nthree')).toBe('<p>one<br>two</p>\n<p>three</p>')
  })

  it('writes headings under the page\'s own, and leaves #tags alone', () => {
    expect(html('# plan\n## step one\n###### small')).toBe('<h3 class="mh">plan</h3>\n<h4 class="mh">step one</h4>\n<h6 class="mh">small</h6>')
    expect(html('#math is a tag')).toBe('<p><a class="t" href="/?tag=math">#math</a> is a tag</p>')
    expect(html('# C# basics')).toBe('<h3 class="mh">C# basics</h3>')
  })

  it('reads bullet and numbered lists, nested by indent, with tasks', () => {
    expect(html('steps:\n- one\n- two\n  - two a\n  - two b\n- three')).toBe(
      '<p>steps:</p>\n<ul><li>one</li><li>two\n<ul><li>two a</li><li>two b</li></ul></li><li>three</li></ul>',
    )
    expect(html('3. three\n4. four')).toBe('<ol start="3"><li>three</li><li>four</li></ol>')
    expect(html('1. one\n  - sub')).toBe('<ol><li>one\n<ul><li>sub</li></ul></li></ol>')
    expect(html('- [ ] todo\n- [x] done')).toBe(
      '<ul><li class="task"><span class="tick" aria-hidden="true">☐</span> todo</li><li class="task"><span class="tick" aria-hidden="true">☑</span> done</li></ul>',
    )
  })

  it("doesn't start a numbered list mid-paragraph unless it starts at 1", () => {
    expect(html('we tried\n2024. a bad year')).toBe('<p>we tried<br>2024. a bad year</p>')
  })

  it('reads pipe tables with alignment, escaped pipes and code', () => {
    const t = html('| map | fps | note |\n|:---|---:|:---:|\n| e1m1 | 61 | `a|b` |\n| e1m2 | 45 | x \\| y |')
    expect(t).toBe(
      '<div class="tbl"><table><thead><tr><th class="l">map</th><th class="r">fps</th><th class="c">note</th></tr></thead>' +
        '<tbody><tr><td class="l">e1m1</td><td class="r">61</td><td class="c"><code>a|b</code></td></tr>' +
        '<tr><td class="l">e1m2</td><td class="r">45</td><td class="c">x | y</td></tr></tbody></table></div>',
    )
    // without outer pipes, and a short row filled out
    expect(html('a | b\n--|--\n1 |')).toContain('<td>1</td><td></td>')
    // a line with a pipe and no delimiter row under it is prose
    expect(html('a | b\nc')).toBe('<p>a | b<br>c</p>')
  })

  it('reads quotes, rules and fences', () => {
    expect(html('> quoted\n> more\n\n---\n\n~~~\n<b>\n~~~')).toBe('<blockquote><p>quoted<br>more</p></blockquote>\n<hr>\n<pre class="code"><code>&lt;b&gt;</code></pre>')
  })

  it("leaves indented lines as prose: an agent's indent isn't a code block", () => {
    expect(html('note:\n    indented')).toBe('<p>note:<br>    indented</p>')
  })
})

describe('markdown: inline', () => {
  it('reads strong, em and struck text', () => {
    expect(renderText('**bold** *em* _em_ ~~gone~~ ***both***', { inline: true })).toBe(
      '<strong>bold</strong> <em>em</em> <em>em</em> <del>gone</del> <strong><em>both</em></strong>',
    )
    expect(renderText('*a **b** c*', { inline: true })).toBe('<em>a <strong>b</strong> c</em>')
  })

  it('leaves underscores in words, names and addresses alone, and arithmetic too', () => {
    expect(renderText('snake_case_name and x_i', { inline: true })).toBe('snake_case_name and x_i')
    expect(renderText('2 * 3 * 4', { inline: true })).toBe('2 * 3 * 4')
    expect(renderText('see https://example.com/a_b_c_d and @my_bot_', { inline: true })).toBe(
      'see <a class="out" href="https://example.com/a_b_c_d" rel="nofollow ugc noopener noreferrer">https://example.com/a_b_c_d<span class="ext" aria-hidden="true"> ↗</span></a> and <a href="/@my_bot_">@my_bot_</a>',
    )
    expect(renderText('*see https://example.com/x*', { inline: true })).toContain('<em>see <a class="out" href="https://example.com/x"')
  })

  it('takes \\ escapes', () => {
    expect(renderText('\\*not em\\* and \\_x\\_', { inline: true })).toBe('*not em* and _x_')
  })

  it('names the host beside a label that hides it, and not beside one that names it', () => {
    expect(renderText('[the repo](https://codeberg.org/x/y)', { inline: true })).toBe(
      '<a class="out" href="https://codeberg.org/x/y" rel="nofollow ugc noopener noreferrer">the repo<span class="ext" aria-hidden="true"> ↗</span></a> <span class="host">codeberg.org</span>',
    )
    expect(renderText('[on codeberg.org](https://www.codeberg.org/x)', { inline: true })).not.toContain('class="host"')
    expect(renderText('[the minecraft shwarm](/w/minecraft-in-doom)', { inline: true })).toBe('<a href="/w/minecraft-in-doom">the minecraft shwarm</a>')
  })

  it('makes an image only a link, and links nothing but http(s) and paths here', () => {
    expect(renderText('![shot](https://example.com/a.png)', { inline: true })).toBe(
      '<a class="out" href="https://example.com/a.png" rel="nofollow ugc noopener noreferrer">shot<span class="ext" aria-hidden="true"> ↗</span></a> <span class="host">example.com</span>',
    )
    for (const bad of ['[x](javascript:alert(1))', '[x](//evil.example/a)', '[x](data:text/html,hi)']) expect(renderText(bad, { inline: true }), bad).not.toContain('<a')
    // a quote can't end the address and start an attribute: the bare address is linked, the rest is text
    expect(renderText('[x](https://a.example" onmouseover="y)', { inline: true })).not.toMatch(/<a [^>]*onmouseover/)
    expect(renderText('[x](https://user@evil.example/)', { inline: true })).not.toContain('<a')
  })

  it("doesn't link or notify an @name inside a link's label", () => {
    const t = '[thanks @myra](https://example.com) and @lumpy in a list:\n- @kestrel\n\n| who |\n|--|\n| @finn |'
    expect(renderText(t)).not.toContain('href="/@myra"')
    expect(extractMentions(t)).toEqual(['@lumpy', '@kestrel', '@finn'])
  })

  it('keeps a title free of emphasis with marks off', () => {
    expect(renderText('make *this* `work`', { inline: true, marks: false })).toBe('make *this* <code>work</code>')
  })
})

describe('markdown: limits', () => {
  it('parses hostile input in one quick pass', () => {
    const t0 = Date.now()
    for (const s of ['*a'.repeat(10_000), '_ '.repeat(10_000), '['.repeat(20_000), '[a]('.repeat(5_000), '>'.repeat(20_000) + ' x', '- '.repeat(10_000) + 'x', '`'.repeat(20_000), '**'.repeat(10_000)])
      renderText(s)
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('stops nesting at a depth and reads the rest as text', () => {
    const deep = parseText('>'.repeat(50) + ' x')
    let d = 0
    for (let b = deep[0]; b && b.t === 'quote'; b = b.blocks[0]) d++
    expect(d).toBeLessThanOrEqual(9)
  })
})

describe('markdown: plain cuts', () => {
  const md = '## why\n**every** lead pipe, mapped:\n\n| city | pipes |\n|--|--|\n| flint | 9k |\n\n- [x] [the data](https://example.com)'
  it('drops block marks for a one-line cut, keeping inline marks', () => {
    expect(blockless(md)).toBe('why\n**every** lead pipe, mapped:\n\ncity · pipes\nflint · 9k\n\n[the data](https://example.com)')
  })
  it('drops every mark for a description', () => {
    expect(plainOf(md)).toBe('why\nevery lead pipe, mapped:\n\ncity · pipes\nflint · 9k\n\nthe data')
  })
})
