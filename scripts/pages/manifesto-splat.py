#!/usr/bin/env python3
"""Draws the manifesto diagram (the zhoug, amba and grease-stain splats on six subjects). Writes radar.svg and radar.html
in the current folder; paste the <svg> into the figure.splat in mockups/holding.html, then run scripts/pages/build.py and export-site.py."""
import math, random
AX=['math','science','engineering','language','art','society']
def smooth(pts):
    n=len(pts); d=f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"
    for i in range(n):
        p0,p1,p2,p3=pts[i-1],pts[i],pts[(i+1)%n],pts[(i+2)%n]
        c1=(p1[0]+(p2[0]-p0[0])/6,p1[1]+(p2[1]-p0[1])/6); c2=(p2[0]-(p3[0]-p1[0])/6,p2[1]-(p3[1]-p1[1])/6)
        d+=f" C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}"
    return d+"Z"
def ang(i): return -math.pi/2+2*math.pi*i/6
def prof(vals,a):  # smooth periodic interpolation of the six axis values
    t=((a+math.pi/2)%(2*math.pi))/(2*math.pi)*6; i=int(t)%6; f=t-int(t); f=(1-math.cos(math.pi*f))/2
    return vals[i]*(1-f)+vals[(i+1)%6]*f
def dot(x,y,r): return f"M{x-r:.1f},{y:.1f}a{r:.1f},{r:.1f} 0 1,0 {2*r:.1f},0a{r:.1f},{r:.1f} 0 1,0 {-2*r:.1f},0Z"
def splat(cx,cy,R0,vals,seed,arms=8,drops=12,armlen=.22):
    R=random.Random(seed); pts=[]; N=120
    armang=[R.uniform(0,2*math.pi) for _ in range(arms)]; armk=[R.uniform(.6,1) for _ in armang]
    for k in range(N):
        a=-math.pi/2+2*math.pi*k/N; base=R0*prof(vals,a)
        rr=base*(1+0.05*math.sin(5*a+seed)+0.035*math.sin(11*a+2*seed)+R.uniform(-.02,.02))
        for aa,kk in zip(armang,armk):
            dd=math.atan2(math.sin(a-aa),math.cos(a-aa)); rr+=base*armlen*kk*math.exp(-(dd/0.05)**2)
        pts.append((cx+rr*math.cos(a),cy+rr*math.sin(a)))
    out=[smooth(pts)]
    for aa,kk in zip(armang,armk):
        L=R0*prof(vals,aa)*(1+armlen*kk*1.05); out.append(dot(cx+L*math.cos(aa),cy+L*math.sin(aa),R0*R.uniform(.018,.03)))
    for _ in range(drops):
        a=R.uniform(0,2*math.pi); L=R0*prof(vals,a)*R.uniform(1.15,1.45); out.append(dot(cx+L*math.cos(a),cy+L*math.sin(a),R0*R.uniform(.006,.016)))
    return " ".join(out)
cx,cy,R0=320,215,150
people=[.34,.4,.38,.6,.66,.64]; ai=[.64,.5,.6,.55,.32,.24]; together=[.96,.93,.97,.94,.95,.92]
font="ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace"
grid=''.join(f'<line x1="{cx}" y1="{cy}" x2="{cx+R0*1.08*math.cos(ang(i)):.1f}" y2="{cy+R0*1.08*math.sin(ang(i)):.1f}"/>' for i in range(6))
labels=''
for i,n in enumerate(AX):
    x=cx+R0*1.2*math.cos(ang(i)); y=cy+R0*1.2*math.sin(ang(i))+5
    anchor='middle' if abs(math.cos(ang(i)))<.2 else ('start' if math.cos(ang(i))>0 else 'end')
    labels+=f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}">{n}</text>'

def inner(cx,cy,R0,vals,seed,scale,jit=.09):
    R=random.Random(seed); pts=[]
    for k in range(70):
        a=-math.pi/2+2*math.pi*k/70; rr=R0*prof(vals,a)*scale*(1+jit*math.sin(4*a+seed)+jit*.7*math.sin(9*a+3*seed)+R.uniform(-.03,.03))
        pts.append((cx+rr*math.cos(a),cy+rr*math.sin(a)))
    return smooth(pts)
def flecks(cx,cy,R0,vals,seed,n,cols,rmin,rmax,elong=1.0):
    R=random.Random(seed); out=''
    for _ in range(n):
        a=R.uniform(0,2*math.pi); L=R0*prof(vals,a)*math.sqrt(R.uniform(0,.85)); x,y=cx+L*math.cos(a),cy+L*math.sin(a)
        r=R.uniform(rmin,rmax); c=R.choice(cols)
        out+=f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{r*elong:.1f}" ry="{r:.1f}" transform="rotate({R.uniform(0,180):.0f} {x:.1f} {y:.1f})" fill="{c}"/>'
    return out
def sauce(vals,seed,base,cid,pool,pool_op,fleck_cols,nfl,rmin,rmax,elong,shine_xy):
    body=splat(cx,cy,R0,vals,seed)
    sx,sy=shine_xy
    return (f'<clipPath id="{cid}"><path d="{body}"/></clipPath>'
      f'<path d="{body}" fill="{base}"/>'
      f'<g clip-path="url(#{cid})">'
      f'<path d="{inner(cx,cy,R0,vals,seed+3,.62)}" fill="{pool}" fill-opacity="{pool_op}"/>'
      f'<path d="{inner(cx,cy,R0,vals,seed+5,.34)}" fill="{pool}" fill-opacity="{pool_op}"/>'
      f'{flecks(cx,cy,R0,vals,seed+7,nfl,fleck_cols,rmin,rmax,elong)}'
      f'<ellipse cx="{sx}" cy="{sy}" rx="16" ry="5" transform="rotate(-25 {sx} {sy})" fill="#fff" fill-opacity=".38"/>'
      f'<ellipse cx="{sx+14}" cy="{sy+9}" rx="5" ry="2" transform="rotate(-25 {sx+14} {sy+9})" fill="#fff" fill-opacity=".3"/>'
      f'</g>')
def badges():
    out=''; y=436
    rows=[('spicy chili-cilantro zhoug','#3f8f3a','#f3eedb','what humans can accomplish'),
          ('tangy amba pickle sauce','#e3782a','#13261b','what AI can accomplish'),
          ('grease stain','#c9bf93','#13261b','what AI and humans are capable of together')]
    lx=18+max(len(r[0]) for r in rows)*7.3+18+10
    for name,fill,ink,label in rows:
        w=len(name)*7.3+18
        out+=f'<rect x="18" y="{y}" width="{w:.0f}" height="20" rx="10" fill="{fill}"/><text x="{18+w/2:.0f}" y="{y+14}" text-anchor="middle" fill="{ink}">{name}</text>'
        out+=f'<text x="{lx:.0f}" y="{y+14}" fill="#13261b" font-weight="400">{label}</text>'
        y+=28
    return out
badges=badges()
svg=f'''<svg viewBox="0 0 640 522" role="img" aria-labelledby="mf-splat-t" style="display:block;width:100%;height:auto">
<title id="mf-splat-t">six subjects around a circle: math, science, engineering, language, art and society. a splat for what people can do and a splat for what AI can do each reach partway, in different directions. a much bigger splat behind them, what people and AI accomplish together, reaches far out on every side.</title>
<g stroke="#13261b" stroke-opacity=".22" stroke-dasharray="2 4">{grid}</g>
<path d="{splat(cx,cy,R0,together,5,arms=12,drops=22,armlen=.16)}" fill="#a39a6c" fill-opacity=".40"/>
<g>
{sauce(ai,9,'#e3782a','mf-am','#c45a17','.38',['#c9611c','#ee9440','#d06a22'],60,.8,1.7,1.8,(336,170))}
{sauce(people,2,'#3f8f3a','mf-zh','#2c6e2a','.35',['#235a22','#2c6e2a','#6fb04f','#c0392b'],110,.9,2.1,2.0,(262,186))}
<g clip-path="url(#mf-zh)"><path d="{splat(cx,cy,R0,ai,9)}" fill="#e3782a" fill-opacity=".22"/><path d="{inner(cx,cy,R0,ai,14,.55)}" fill="#e3782a" fill-opacity=".14"/></g>
</g>
<g font-family="{font}" fill="#13261b" font-size="13" opacity=".8">{labels}</g>
<g font-family="{font}" font-size="12" font-weight="700">{badges}</g>
</svg>'''
open('radar.svg','w').write(svg)
open('radar.html','w').write('<html><body style="margin:0;background:#f3eedb">'+svg+'</body></html>')
