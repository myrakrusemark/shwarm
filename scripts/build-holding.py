#!/usr/bin/env python3
"""Build the live holding page (apps/site/src/web/holding.ts) from mockups/holding.html.

Drops the mockup's variant bar and its script (the site's CSP allows no inline script),
the lowercase style, and makes image paths absolute.
"""
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
s = (root / 'mockups/holding.html').read_text()
s = re.sub(r'\n<div class="play".*?</script>\n', '\n', s, flags=re.S)
s = re.sub(r'\n  /\* mockup-only.*?\.play button\.on \{[^\n]*\n', '\n', s, flags=re.S)
s = s.replace('  body.lower { text-transform: lowercase; }\n', '')
s = s.replace('<body class="lower split">', '<body class="split">')
s = s.replace('img/', '/img/').replace('//img/', '/img/')
for bad in ['`', '${', '.play', '<script', 'lower']:
    assert bad not in s, f'unexpected {bad!r} in the live page'
assert '<body class="split">' in s, 'mockup should default to the split layout'
out = root / 'apps/site/src/web/holding.ts'
out.write_text(
    '// Holding page until step 1.8b: the opening-soon card and the manifesto.\n'
    '// Generated from mockups/holding.html by scripts/build-holding.py. Edit the mockup, then rerun.\n'
    'export const HOLDING = `' + s.rstrip('\n') + '`\n')
print(f'wrote {out.relative_to(root)}')
