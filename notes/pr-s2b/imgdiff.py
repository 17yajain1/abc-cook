"""Pixel-diff two directories of PNGs: python imgdiff.py baseline after1"""
import glob
import os
import sys

from PIL import Image, ImageChops

a_dir, b_dir = sys.argv[1], sys.argv[2]
bad = 0
for f in sorted(glob.glob(os.path.join(a_dir, "*.png"))):
    a = Image.open(f).convert("RGB")
    b = Image.open(os.path.join(b_dir, os.path.basename(f))).convert("RGB")
    differs = a.size != b.size or ImageChops.difference(a, b).getbbox() is not None
    bad += differs
    print(os.path.basename(f), a.size, "DIFF" if differs else "identical")
print("RESULT:", "pixel-identical" if not bad else f"{bad} differ")
