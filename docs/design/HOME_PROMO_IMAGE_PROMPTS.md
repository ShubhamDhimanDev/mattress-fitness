# Image prompts for a promo-style home page

Prompts for the sections of a sale-style mattress retailer home page (the layout seen on mattresswarehouse.com, 2026-11-05), below the hero banner. They describe new scenes, not copies of that site's pictures. The redesign pictures (IMG-01 to IMG-14) are in [IMAGE_PROMPTS](IMAGE_PROMPTS.md); the labels here start with `HP-` so they do not clash.

## How to use

1. Every prompt below is complete: it starts with the ratio, then the scene, then the shared style. Copy one block, paste it, generate 3 or 4 options, keep the best. Stay in the same chat for the whole set so light and colours stay consistent.
2. **No text, no logos, no brand names in any picture.** Image tools draw text and logos badly. Headlines, prices, badges and brand logos are drawn by the website. For the real mattress, use the maker's own product photo and put it over these backgrounds.
3. Export as WebP, 1600 px wide for banners, 1200 px for tiles, 150 KB or less each. Name the file as shown. Add alt text where the picture carries meaning.
4. Check hands, faces, bed corners and pillows before accepting a picture. Melted seams, extra fingers and floating pillows are the usual faults. Regenerate instead of retouching.
5. Record each picture in [BRAND_TOKENS](BRAND_TOKENS.md) (Provenance): "generated with <tool>, <date>, prompt <ID>". Check that your plan allows commercial use.

| ID | Where | Ratio | File |
| --- | --- | --- | --- |
| HP-01 | Brand promo cards (3 cards) | 4:5 | `promo-card-1.webp` to `promo-card-3.webp` |
| HP-02 | Brand tiles on gold (4 tiles) | 4:5 | `tile-gold.webp` |
| HP-03 | Wide offer banner, woman on bed | 16:9 | `offer-lifestyle.webp` |
| HP-04 | Dark "shop now" mattress banner | 16:9 | `offer-dark-mattress.webp` |
| HP-05 | Financing strip | 4:1 | `financing-strip.webp` |
| HP-06 | Adjustable base lifestyle | 16:9 | `adjustable-couple.webp` |
| HP-07 | "Lowest price" cards | 2:1 | `price-cards-gold.webp` |
| HP-08 | Mattress and free base, black | 16:9 | `bundle-black.webp` |
| HP-09 | Floor model blowout | 16:9 | `blowout-gold.webp` |
| HP-10 | Category tiles (6) | 3:2 | `cat-mattresses.webp`, `cat-bases.webp`, `cat-frames.webp`, `cat-protectors.webp`, `cat-sheets.webp`, `cat-pillows.webp` |
| HP-11 | "Find your mattress" section | 16:9 | `match-science.webp` |
| HP-12 | "Find your mattress" step icons (4) | 1:1 | `step-1.webp` to `step-4.webp` |
| HP-13 | Email sign-up band | 3:1 | `signup-band.webp` |

## Prompts

### HP-01 Brand promo cards (make three, change only the cover colour)

```
Aspect ratio 4:5, portrait. A single premium hybrid mattress with a quilted white cover, shown at a slight angle on a low wooden platform in a calm, sunlit bedroom. Two plush plain pillows and a folded throw on top, a small gift box with a ribbon beside the bed. Dark navy gradient background fading toward the bottom, with empty space for a price badge. Photorealistic, bright and clean, soft natural window light, warm neutral palette with navy and red accents, shallow depth of field. No text, no logos, no brand names, no watermarks.
```

Change "quilted white cover" to "cream", "grey" and "deep blue" for the other two cards.

### HP-02 Brand tiles on gold (one background, cropped four times)

```
Aspect ratio 4:5, portrait. Abstract festive background of fine gold glitter and soft bokeh sparkles on a dark champagne gradient, gentle vignette, a large clean empty area in the centre for a big percentage number. Premium sale mood, shallow depth of field. No text, no logos, no objects, no watermarks.
```

### HP-03 Wide offer banner, woman on bed

```
Aspect ratio 16:9, wide. A woman in light pyjamas relaxing on a white mattress in a bright modern bedroom, one arm behind her head, reading a tablet and smiling softly. Sage-green wall, wooden nightstand with a lamp, large window with sheer curtains. She sits on the left third of the frame, with empty space on the right for a headline. Photorealistic, bright and clean, soft natural window light, warm neutral palette, shallow depth of field. No text, no logos, no brand names, no watermarks.
```

### HP-04 Dark "shop now" mattress banner

```
Aspect ratio 16:9, wide. Cinematic low-angle shot of a luxury pillow-top mattress with a textured silver cover on a dark upholstered bed in a dim, elegant bedroom. Warm bedside lamp glow, moody navy shadows, fabric texture in sharp detail. Empty space on the left for a button. Photorealistic, shallow depth of field. No text, no logos, no brand names, no watermarks.
```

### HP-05 Financing strip

```
Aspect ratio 4:1, very wide and short. A clean light-grey abstract background with subtle diagonal soft lines and a faint pattern of rounded coins and a calendar outline, very low contrast, professional and trustworthy. Large empty space in the middle for text. No text, no logos, no watermarks.
```

### HP-06 Adjustable base lifestyle

```
Aspect ratio 16:9, wide. A smiling couple sitting up in an adjustable bed with the head raised, reading and sharing a tablet. Bright airy bedroom, white linen bedding, light wooden floor, plants by the window. Natural, relaxed, unposed. Both people are centred, with empty space above them for text. Photorealistic, soft natural window light, warm neutral palette, shallow depth of field. No text, no logos, no brand names, no watermarks.
```

### HP-07 "Lowest price" cards

```
Aspect ratio 2:1, wide. Festive background of fine gold glitter with two matte black rounded rectangles placed side by side, each with a soft glow and plenty of empty space inside for a price. Elegant sale look, subtle confetti shimmer. No text, no numbers, no logos, no watermarks.
```

### HP-08 Mattress and free base, black

```
Aspect ratio 16:9, wide. A queen mattress resting on a slim adjustable base with the head slightly raised, floating on a pure black studio background with a thin gold rim light. Dramatic product-shot lighting, soft reflection on a glossy floor, large empty space on the left for a big price. Photorealistic. No text, no logos, no brand names, no watermarks.
```

### HP-09 Floor model blowout

```
Aspect ratio 16:9, wide. A thick luxury pillow-top mattress with a deep blue quilted cover, shown at an angle on a warm gold glitter background, sparkles in the foreground, a soft spotlight on the edge detail. The right side is empty for a headline. Photorealistic, shallow depth of field. No text, no logos, no brand names, no watermarks.
```

### HP-10 Category tiles (six prompts; use the same chat and lighting)

Each starts with: `Aspect ratio 3:2, landscape.` and ends with: `Photorealistic, soft natural light, warm neutral palette with navy accents, shallow depth of field. No text, no logos, no brand names, no watermarks.`

```
Aspect ratio 3:2, landscape. A neatly made queen bed with white linen, side view, calm bedroom, dark navy backdrop. Photorealistic, soft natural light, warm neutral palette with navy accents, shallow depth of field. No text, no logos, no brand names, no watermarks.
```
```
Aspect ratio 3:2, landscape. A slim adjustable bed base with the head and foot lifted, simple white bedding, studio-like bedroom. Photorealistic, soft natural light, warm neutral palette with navy accents, shallow depth of field. No text, no logos, no brand names, no watermarks.
```
```
Aspect ratio 3:2, landscape. A solid walnut platform bed frame with a tufted headboard, empty mattress area, bright room. Photorealistic, soft natural light, warm neutral palette with navy accents, shallow depth of field. No text, no logos, no brand names, no watermarks.
```
```
Aspect ratio 3:2, landscape. A hand smoothing a white quilted mattress protector over a mattress corner, close-up. Photorealistic, soft natural light, warm neutral palette with navy accents, shallow depth of field. No text, no logos, no brand names, no watermarks.
```
```
Aspect ratio 3:2, landscape. A stack of folded sheets in soft blue and cream with a small plant on top, on a bright shelf, close-up. Photorealistic, soft natural light, warm neutral palette with navy accents, shallow depth of field. No text, no logos, no brand names, no watermarks.
```
```
Aspect ratio 3:2, landscape. Three plush white pillows stacked on a bed with a light-blue headboard in the background, close-up. Photorealistic, soft natural light, warm neutral palette with navy accents, shallow depth of field. No text, no logos, no brand names, no watermarks.
```

### HP-11 "Find your mattress" section

```
Aspect ratio 16:9, wide. A person lying on a mattress while a soft digital pressure map glows in blue and white across the surface, gentle scan lines, clean modern showroom, scientific but friendly look. Subject on the left, empty space on the right. Photorealistic with a subtle graphic overlay, shallow depth of field. No text, no numbers, no logos, no watermarks.
```

### HP-12 Step icons (make four; keep one colour and one line weight)

Each starts with: `Aspect ratio 1:1, square. Flat line icon, single navy colour on a white background, centred, generous margin, no text.`

```
Aspect ratio 1:1, square. Flat line icon, single navy colour on a white background, centred, generous margin, no text. A card with a question mark.
```
```
Aspect ratio 1:1, square. Flat line icon, single navy colour on a white background, centred, generous margin, no text. A body outline lying on a bed with small support markers along the spine.
```
```
Aspect ratio 1:1, square. Flat line icon, single navy colour on a white background, centred, generous margin, no text. A checklist with a star.
```
```
Aspect ratio 1:1, square. Flat line icon, single navy colour on a white background, centred, generous margin, no text. A bed beside a shop door sign, for a try-before-you-buy visit.
```

### HP-13 Email sign-up band

```
Aspect ratio 3:1, very wide. A folded envelope with a gold ribbon and tiny stars beside a soft white pillow and a smartphone, on a pale blue background, top-down view, clean. The right third is empty for a sign-up form. Photorealistic, soft light. No text, no logos, no watermarks.
```
