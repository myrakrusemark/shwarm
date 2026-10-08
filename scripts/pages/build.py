import re, importlib.util, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from agentres import card
os.chdir(os.path.join(HERE, '..', '..', 'mockups'))
spec=importlib.util.spec_from_file_location('c', os.path.join(HERE, 'content.py')); c=importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
src=open('keys.html').read()
style=re.search(r'<style>\n(.*?)  /\* keys \*/', src, re.S).group(1)
dn_css=re.search(r'(  /\* donate \*/.*?)</style>', src, re.S).group(1)
m=re.search(r'(  \.strip \{ display: flex.*?\n)(?=  /\* keys \*/|  \.strip \.me \.n\[hidden\])', src, re.S); strip_css=m.group(1) if m else ''
head=src[src.index('  <header>'):src.index('  <h1 class="title">keys</h1>')]
donate=src[src.index('  <!-- donate modal -->'):src.index('  <footer>')]
footer=src[src.index('  <footer>'):src.index('</footer>')+len('</footer>')]
dn_js=[m for m in re.findall(r'<script>.*?</script>', src, re.S) if 'dn-scrim' in m][0]
doc_css=open('how-it-works.html').read().split('  /* doc pages */')[1].split('  /* donate */')[0]
doc_css='  /* doc pages */'+doc_css
NAV=[('how-it-works.html','how it works'),('rules.html','rules'),('api.html','api'),('terms.html','terms'),('privacy.html','privacy'),('guide-great-shwarm.html','guide: a great shwarm'),('guide-storage.html','guide: storage')]
for slug,title,lede,secs in c.PAGES:
    sec_html=''.join(f'    <section id="{i}"><h2>{h}</h2><div class="body">{b}</div></section>\n' for i,h,b in secs)
    toc=''.join(f'<li><a href="#{i}">{h}</a></li>' for i,h,_ in secs)
    others=''.join(f'<li class="{"on" if f==slug+".html" else ""}"><a href="{f}">{n}</a></li>' for f,n in NAV)
    open(slug+'.html','w').write(f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · shwarm</title>
<style>
{style}{strip_css}{doc_css}{dn_css}</style>
<script>if (!new URLSearchParams(location.search).has('stats')) document.documentElement.classList.add('launch');</script>
</head>
<body>
<div class="wrap">

{head}  <div class="dochead"><h1>{title}</h1><p>{lede}</p></div>

  <div class="doc">
    <article>
{sec_html}    </article>
    <aside class="toc">
      <div class="box"><h2>on this page</h2><ol>{toc}</ol></div>
{card(slug+'.html')}    </aside>
  </div>

{donate}{footer}
</div>
{dn_js}
<script>document.querySelectorAll('.yr').forEach(e => e.textContent = new Date().getFullYear());</script>
</body>
</html>
''')
print('built', [p[0] for p in c.PAGES])
