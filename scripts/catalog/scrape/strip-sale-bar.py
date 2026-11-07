"""Cuts the maker's "20% Off Sitewide / Discount Code" bar off the bottom of the Helix photos in brand-catalog/images/.

Why: Helix's first and seventh photos of each model carry a navy bar with a sitewide offer and a discount code. It is the maker's
promotion, not the retailer's, and it would show on our product cards and pages next to our own prices (owner request 2026-11-07).
The bar is a solid navy strip, so it is found by colour and cut off, not guessed at by a fixed height.

Each original is first copied to .scrape/helix-with-sale-bar/ (not in git) and the cropped file replaces it under the same name,
so the importer and the replace script (../replace-cropped-images.mjs) keep working on the same names. The names that changed are
written to .scrape/helix-cropped-files.json. Safe to re-run: a file with no bar left is skipped.

Usage: python scripts/catalog/scrape/strip-sale-bar.py [--dry-run]   (needs Pillow)
"""
import glob
import json
import os
import shutil
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
BRAND_CATALOG = os.path.normpath(os.path.join(HERE, '..', 'brand-catalog'))
IMAGES = os.path.join(BRAND_CATALOG, 'images')
BACKUP = os.path.join(BRAND_CATALOG, '.scrape', 'helix-with-sale-bar')
LIST = os.path.join(BRAND_CATALOG, '.scrape', 'helix-cropped-files.json')
# Shopify stores some photos under another extension than the one the sheet names (photo 1 came back as .png although the sheet says
# .webp), and fileUpdate keeps the stored extension. So every cropped photo is also written in the three formats, same stem.
VARIANTS = os.path.join(BRAND_CATALOG, '.scrape', 'helix-cropped-variants')


def navy_share(image, y):
    """Share of the pixels in one row (every 4th) that are the deep navy of the bar."""
    width = image.size[0]
    row = [image.getpixel((x, y)) for x in range(0, width, 4)]
    return sum(1 for r, g, b in row if b > r + 25 and b > g + 10 and r < 70 and g < 90) / len(row)


def bar_height(image):
    """Rows of navy at the bottom edge; 0 when the bottom edge is not the bar."""
    height = image.size[1]
    if navy_share(image, height - 3) < 0.8:
        return 0
    y = height - 1
    while y > 0 and navy_share(image, y) > 0.6:
        y -= 1
    return height - y - 1


def main():
    dry = '--dry-run' in sys.argv
    cropped = []
    for path in sorted(glob.glob(os.path.join(IMAGES, 'helix-*'))):
        image = Image.open(path)
        image.load()
        rgb = image.convert('RGB')
        bar = bar_height(rgb)
        # A real bar is 10 to 14 percent of the photo; anything else is a dark photo, not the bar.
        if not (0.08 <= bar / rgb.size[1] <= 0.16):
            continue
        name = os.path.basename(path)
        cropped.append(name)
        print(f'{name}: {rgb.size[0]}x{rgb.size[1]} -> {rgb.size[0]}x{rgb.size[1] - bar}')
        if dry:
            continue
        os.makedirs(BACKUP, exist_ok=True)
        shutil.copy2(path, os.path.join(BACKUP, name))
        out = rgb.crop((0, 0, rgb.size[0], rgb.size[1] - bar))
        if name.lower().endswith('.webp'):
            out.save(path, 'WEBP', quality=88, method=6)
        else:
            out.save(path, 'JPEG', quality=90)
    if not dry:
        # The list is every file that has a backup, so a re-run (which finds nothing new) does not empty it.
        done = sorted(os.listdir(BACKUP)) if os.path.isdir(BACKUP) else []
        with open(LIST, 'w') as handle:
            json.dump(done, handle, indent=1)
        os.makedirs(VARIANTS, exist_ok=True)
        for name in done:
            stem = name.rsplit('.', 1)[0]
            image = Image.open(os.path.join(IMAGES, name)).convert('RGB')
            image.save(os.path.join(VARIANTS, stem + '.png'), 'PNG', optimize=True)
            image.save(os.path.join(VARIANTS, stem + '.jpg'), 'JPEG', quality=90)
            image.save(os.path.join(VARIANTS, stem + '.webp'), 'WEBP', quality=88, method=6)
    print(f'{len(cropped)} photo(s) {"would be " if dry else ""}cropped')


main()
