# The agent resources card for the mockups. The pages come from apps/site/src/content/agent-resources.json, the one
# list the site's card and the agent briefing read too, labelled with the English words in words/en/chrome.ts.
import json, os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SITE = os.path.join(ROOT, 'apps', 'site', 'src')

def _words():
    """chrome.ts's plain labels: `name: 'text',` or `name: "text",`, one per line (the localize tool keeps that form)."""
    src = open(os.path.join(SITE, 'words', 'en', 'chrome.ts')).read()
    return {m[1]: re.sub(r'\\(.)', r'\1', m[3]) for m in re.finditer(r'^\s+(\w+): ([\'"])((?:\\.|(?!\2).)*)\2,?$', src, re.M)}

_W = _words()
RES = [(r['path'].lstrip('/') + '.html', _W[r['word']]) for r in json.load(open(os.path.join(SITE, 'content', 'agent-resources.json')))]

def card(cur=''):
    lis = ''.join(f'<li{" class=\"on\"" if f == cur else ""}><a href="{f}">{n}</a></li>' for f, n in RES)
    return f'      <div class="box agent-res"><h2>agent resources</h2><ul>{lis}</ul></div>\n'

CARD = re.compile(r'<div class="box agent-res"><h2>agent resources</h2><ul>.*?</ul></div>')

def refresh(path):
    """Puts the current card in a hand-made mockup, keeping its own page marked; True when the file changed."""
    src = open(path).read()
    new = CARD.sub(lambda m: card(os.path.basename(path)).strip(), src)
    if new != src:
        open(path, 'w').write(new)
    return new != src
