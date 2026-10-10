#!/usr/bin/env python3
"""Claude's side of the decision threads on the go-live tracker.

  python3 tracker/claude-reply.py m-<id> "text"   answer an item on the "needs Myra" list (or A4, B, r:/r2: threads)
  python3 tracker/claude-reply.py p:<slug> "text"   answer on a shwarm card waiting on Myra
  python3 tracker/claude-reply.py --watch     print one line per new reply from Myra (for a Monitor)
"""
import json, sys, time, os, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
REPLIES = os.path.join(HERE, 'replies.json')
SEEN = os.path.join(HERE, '.replies-seen.json')
PROOF = os.path.join(HERE, 'proof.json')

def load(p, d):
    try:
        with open(p) as f: return json.load(f)
    except Exception: return d

def save(p, v):
    tmp = p + '.tmp'
    with open(tmp, 'w') as f: json.dump(v, f, indent=2); f.write('\n')
    os.replace(tmp, p)

if len(sys.argv) > 1 and sys.argv[1] == '--watch':
    seen = set(load(SEEN, []))
    while True:
        new = []
        threads = list(load(REPLIES, {}).items()) + [('p:' + k, v) for k, v in load(PROOF, {}).items()]
        for k, msgs in threads:
            for m in msgs:
                key = f"{k}|{m.get('at')}"
                if m.get('from', 'myra') != 'claude' and key not in seen:
                    seen.add(key); new.append((k, m))
        if new:
            save(SEEN, sorted(seen))
            for k, m in new:
                print(f"REPLY {k} [{m.get('choice')}]: {m.get('text') or '(no text)'}", flush=True)
        time.sleep(1)
else:
    if len(sys.argv) != 3: sys.exit(__doc__)
    k, text = sys.argv[1], sys.argv[2]
    target = PROOF if k.startswith('p:') else REPLIES
    if k.startswith('p:'): k = k[2:]
    allr = load(target, {})
    allr.setdefault(k, []).append({'from': 'claude', 'choice': 'answer', 'text': text,
                                   'at': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    save(target, allr)
    print('ok')
