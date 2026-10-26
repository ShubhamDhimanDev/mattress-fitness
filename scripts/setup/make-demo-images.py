"""Writes labelled placeholder JPEGs for the names in scripts/catalog/sample/images.txt (and offer-images.txt).

Why: the sample catalog names image files that are not in the repository, and the importer will not upload without them.
These are obviously fake ("DEMO PLACEHOLDER") and meant for a development store only.

Usage: python scripts/setup/make-demo-images.py <names.txt> <output folder>   (needs Pillow)
"""
import hashlib
import os
import sys

from PIL import Image, ImageDraw

names_file, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)
names = [line.strip() for line in open(names_file) if line.strip() and not line.startswith('#')]
for name in names:
    stem = name.rsplit('.', 1)[0]
    # One colour per product so a grid of them is easy to tell apart.
    seed = int(hashlib.md5(stem.rsplit('-', 1)[0].encode()).hexdigest()[:6], 16)
    base = (60 + seed % 120, 80 + (seed >> 8) % 100, 110 + (seed >> 16) % 100)
    image = Image.new('RGB', (1200, 900), base)
    draw = ImageDraw.Draw(image)
    draw.rectangle([150, 380, 1050, 640], fill=(245, 245, 240), outline=(255, 255, 255), width=6)
    draw.rectangle([150, 640, 1050, 700], fill=(200, 200, 195))
    draw.text((60, 60), 'DEMO PLACEHOLDER - ' + stem, fill=(255, 255, 255))
    image.save(os.path.join(out_dir, name), 'JPEG', quality=82)
print(len(names), 'images in', out_dir)
