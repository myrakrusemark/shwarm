import re,os,glob,sys
root=os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
files=glob.glob(root+'/docs/*.md')+[root+'/README.md',root+'/CLAUDE.md']
def slug(t):
    t=t.strip().lower()
    t=re.sub(r'<[^>]+>','',t)
    t=re.sub(r'\[([^\]]*)\]\([^)]*\)',r'\1',t)
    t=t.replace('`','').replace('*','')
    t=re.sub(r'[^\w\- ]','',t)
    return t.replace(' ','-')
cache={}
def anchors(path):
    if path in cache: return cache[path]
    a=set(); seen={}
    if path.endswith('.md'):
        incode=False
        for line in open(path):
            if line.startswith('```'): incode=not incode; continue
            if incode: continue
            m=re.match(r'^(#{1,6})\s+(.*?)\s*#*\s*$',line)
            if m:
                s=slug(m.group(2)); n=seen.get(s,0)
                a.add(s if n==0 else f'{s}-{n}'); seen[s]=n+1
            for m in re.finditer(r'<a\s+(?:id|name)="([^"]+)"',line): a.add(m.group(1))
    elif path.endswith('.html'):
        for m in re.finditer(r'\bid="([^"]+)"',open(path).read()): a.add(m.group(1))
    cache[path]=a; return a
bad=0;count=0
for f in files:
    txt=open(f).read()
    txt_nocode=re.sub(r'```.*?```','',txt,flags=re.S)
    txt_nocode=re.sub(r'`[^`\n]*`','',txt_nocode)
    targets=[m.group(1) for m in re.finditer(r'\]\(([^)\s]+)(?:\s+"[^"]*")?\)',txt_nocode)]
    targets+=[m.group(1) for m in re.finditer(r'^\[[^\]]+\]:\s*(\S+)',txt_nocode,flags=re.M)]
    # reference usage check
    defs=set(m.group(1).lower() for m in re.finditer(r'^\[([^\]]+)\]:',txt_nocode,flags=re.M))
    for m in re.finditer(r'\]\[([^\]]+)\]',txt_nocode):
        if m.group(1).lower() not in defs: print(f'{f}: undefined ref [{m.group(1)}]'); bad+=1
    for t in targets:
        if re.match(r'^(https?:|mailto:)',t): continue
        count+=1
        path,_,frag=t.partition('#')
        path=path.split('?')[0]
        full=os.path.normpath(os.path.join(os.path.dirname(f),path)) if path else f
        if not os.path.exists(full): print(f'{f}: missing file {t}'); bad+=1; continue
        if frag and os.path.isfile(full) and frag not in anchors(full):
            print(f'{f}: missing anchor {t}'); bad+=1
print('checked',count,'bad',bad)
