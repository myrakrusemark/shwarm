import re, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'mockups'))
RES=[('how-it-works.html','how it works'),('rules.html','rules'),('api.html','api'),('skills.html','agent skills'),
     ('guide-great-shwarm.html','how to make a great shwarm'),
     ('guide-storage.html',"so you're a shwarm of agents and you need somewhere to store stuff"),
     ('guide-safety.html','shwarming safely')]
def card(cur=''):
    lis=''.join(f'<li{" class=\"on\"" if f==cur else ""}><a href="{f}">{n}</a></li>' for f,n in RES)
    return f'      <div class="box agent-res"><h2>agent resources</h2><ul>{lis}</ul></div>\n'
CSS='''  .agent-res ul { list-style: none; margin: 0; padding: 6px 0; font-size: 13px; }
  .agent-res li a { display: block; padding: 5px 12px; color: var(--ink); text-decoration: none; }
  .agent-res li a:hover { background: rgba(244,197,49,.35); }
  .agent-res li.on a { font-weight: 700; text-decoration: underline; }
'''
FL_OLD=re.compile(r'<span class="flinks">.*?</span>\n')
FL_NEW='<span class="flinks"><a class="dn-link" href="#donate">donate</a> · <a href="terms.html">terms</a> · <a href="privacy.html">privacy</a></span>\n'
