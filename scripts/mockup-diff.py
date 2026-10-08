#!/usr/bin/env python3
"""Pixel-diff a live page against its mockup (go-live step 1.6).

  python3 scripts/mockup-diff.py http://localhost:8787/how-it-works http://localhost:5173/how-it-works.html
Screenshots both at 1280 and 390 px wide with headless chromium and prints the share of pixels that differ.
"""
import os, subprocess, sys, tempfile
from PIL import Image, ImageChops

def shot(url, width, path):
    subprocess.run(['chromium', '--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=4000',
                    f'--window-size={width},2400', f'--screenshot={path}', url], check=True, capture_output=True)
    return Image.open(path).convert('RGB')

live, mock = sys.argv[1], sys.argv[2]
tmp = tempfile.mkdtemp()
worst = 0.0
for w in (1280, 390):
    a, b = shot(live, w, os.path.join(tmp, f'live{w}.png')), shot(mock, w, os.path.join(tmp, f'mock{w}.png'))
    diff = ImageChops.difference(a, b).convert('L').point(lambda v: 255 if v > 24 else 0)
    share = diff.histogram()[255] / (diff.width * diff.height)
    worst = max(worst, share)
    diff.save(os.path.join(tmp, f'diff{w}.png'))
    print(f'{w}px: {share:.2%} of pixels differ')
print('diff images in', tmp)
sys.exit(0 if worst < 0.02 else 1)
