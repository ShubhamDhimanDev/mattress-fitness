# Image prompts for the redesign (Gemini)

For the plan in [REDESIGN_PLAN](REDESIGN_PLAN.md). The `IMG-xx` labels are the ones printed on the placeholders in the preview, so each prompt shows where its picture goes. Product photos of the brands' mattresses are **not** generated: they come from the brands through Shopify.

## How to use

1. Paste the **style block** first in every new chat, then one prompt. Generate 3 or 4 options and keep the best. Keep the same chat for the whole set so the light and colours stay consistent.
2. Ask for the ratio in the prompt (Gemini follows it best when it is the first line). If it ignores it, crop afterwards; keep the subject away from the edges.
3. **No text, no logos, no brand names in any picture.** Gemini draws text badly; headlines and badges are drawn by the website. For any mattress, ask for plain unbranded bedding and a plain unbranded mattress label area.
4. Export and name each file as shown, as WebP, with these sizes (2x for sharp screens): hero 2000 px wide, others 1600 px wide, tiles 1200 px. Aim for 250 KB or less per picture (hero) and 150 KB or less for the rest. Upload them in Shopify admin, Content, Files, then attach them in the matching home block or brand entry.
5. Add the alt text shown. Record each picture in [BRAND_TOKENS](BRAND_TOKENS.md) (Provenance): "generated with Gemini, <date>, prompt <ID>". Check that your Gemini plan allows commercial use. Gemini adds an invisible watermark; that is normal.
6. Look closely at hands, faces, bed corners and pillows before accepting a picture: mattresses with melted seams, extra fingers and floating pillows are the usual faults. Regenerate rather than retouch.

## Style block (paste first)

> Photorealistic lifestyle photography for a mattress retailer's website. Bright, natural window light, soft shadows, shot on a 35 mm lens at eye level, shallow depth of field. Warm neutral palette (warm white walls, oatmeal, light oak, soft grey linen) with one small accent of strong red (#DE0510) in some scenes, such as a throw blanket or a cushion. Modern American home, calm and uncluttered. Real, relaxed, diverse people when people appear, natural expressions, no posing at the camera. Clean plain bedding with no patterns. **Absolutely no text, letters, numbers, logos, brand marks, labels or watermarks anywhere in the image.** No stock-photo clichés, no exaggerated smiles, no neon colours.

## Prompts

| ID | Where | Ratio and size | File |
| --- | --- | --- | --- |
| IMG-01 | Home hero | 5:6, 2000 x 2400 | `hero-bedroom.webp` |
| IMG-02 | How it works, delivery | 4:3, 1600 x 1200 | `delivery-setup.webp` |
| IMG-03 | Sleep quiz band | 4:3, 1600 x 1200 | `quiz-choosing.webp` |
| IMG-04 | Stores, product page "try in store" | 16:9, 2000 x 1125 | `store-showroom.webp` |
| IMG-05 | Find a store, map | 4:3, 1600 x 1200 | `store-map.webp` |
| IMG-06 to IMG-11 | Shop by feel tiles | 1:1, 1200 x 1200 each | `feel-plush.webp`, `feel-medium.webp`, `feel-firm.webp`, `feel-hybrid.webp`, `feel-memory-foam.webp`, `feel-latex.webp` |
| IMG-12 | Protection plan card | 4:3, 1600 x 1200 | `protection-plan.webp` |
| IMG-13 | Bedding category tile and signup band | 3:2, 1600 x 1067 | `bedding-flatlay.webp` |
| IMG-14 | Brand page banner (generic) | 21:9, 2400 x 1029 | `brand-banner.webp` |
| IMG-15 | Account and sign-in pages | 4:5, 1200 x 1500 | `account-calm.webp` |
| IMG-16 | 404 page | 4:3, 1200 x 900 | `not-found.webp` |
| IMG-17 | Sleep guide header | 16:9, 2000 x 1125 | `sleep-guide.webp` |
| IMG-18 | Financing banner | 3:2, 1600 x 1067 | `financing.webp` |
| IMG-19 | Empty cart | 4:3, 1200 x 900 | `empty-cart.webp` |
| IMG-21 to IMG-24 | Home category tiles | 4:5, 1200 x 1500 each | `cat-mattresses.webp`, `cat-bases.webp`, `cat-bedding.webp`, `cat-protectors-toppers.webp` |
| IMG-25 | Social share image (before text is added) | 1.91:1, 1200 x 630 | `share-base.webp` |

### IMG-01 Home hero

> Aspect ratio 5:6, portrait. A bright, airy modern bedroom in the morning. A made queen bed with plain white and light grey linen bedding and two plain pillows, a single red knitted throw folded across the foot of the bed, light oak bedside table with a small lamp, a large window with sheer curtains letting in warm sunlight, a light wood floor. Camera at a slight angle from the foot of the bed, the whole bed visible, calm and inviting. No people. Leave the top third of the image calm (soft wall) so a floating label can sit there.

Alt text: "A made queen bed in a bright, calm bedroom."

### IMG-02 Delivery and setup

> Aspect ratio 4:3, landscape. Two friendly delivery technicians in plain dark grey polo shirts and work trousers (no logos, no lettering on clothing) carrying a mattress wrapped in clear plastic through a home hallway toward a bedroom with an open door. Natural light from the bedroom. One technician glances back with a relaxed, professional expression. Realistic, documentary feel.

Alt text: "Two delivery technicians carrying a wrapped mattress into a bedroom."

### IMG-03 Sleep quiz

> Aspect ratio 4:3, landscape. A person in their thirties sitting on the edge of a made bed in a calm, softly lit bedroom, looking thoughtfully at their phone, relaxed posture, bare feet on a light rug. Plain white bedding, one red cushion. Warm window light from the left. Candid, not looking at the camera.

Alt text: "A person on the edge of a bed choosing a mattress on their phone."

### IMG-04 Store showroom

> Aspect ratio 16:9, wide. The inside of a bright, modern mattress showroom: a long row of made beds on low platforms with plain white bedding, warm lighting, light wood floor, a few shoppers in the distance lying on beds and talking with a sales associate in a plain dark top. **No signs, banners, price tags or brand names visible anywhere.** Clean and welcoming.

Alt text: "Shoppers trying mattresses in a bright showroom."

### IMG-05 Map

> Aspect ratio 4:3, landscape. A flat, minimal vector-style illustration of a city street map in warm paper tones (cream, light beige, soft grey roads, a pale blue river), with four large rounded red map pins (#DE0510) and one larger pin highlighted. **No street names, no labels, no text of any kind.** Soft rounded shapes, no gradients, plenty of empty space.

Alt text: "A stylised map with store locations marked by red pins." (If the result is poor, this one can be drawn in code instead; tell the developer.)

### IMG-06 to IMG-11 Feel tiles (generate as a set in one chat)

Common line for all six, pasted first:

> Aspect ratio 1:1, square. A clean studio render of a mattress cross-section seen at a three-quarter angle, softly lit on a warm light-grey background with a gentle floor shadow, with a thin red (#DE0510) stripe along the cut edge. Neutral cover, no logos, no text. Same camera angle and lighting for the whole set.

Then one line each:

- **IMG-06 Plush:** very thick, soft pillow-top layer on a cushioned comfort layer, edge looks deep and cloud-like.
- **IMG-07 Medium:** balanced layers, medium-thick comfort foam over a support layer.
- **IMG-08 Firm:** thin, dense top layer over a firm, tightly packed support core.
- **IMG-09 Hybrid:** thin foam layers on top of a visible layer of individually wrapped metal coils.
- **IMG-10 Memory foam:** layers of smooth foam, with a hand-shaped dent pressed into the top surface showing the foam contouring.
- **IMG-11 Latex:** a light cream natural latex layer with a visible pattern of small round pin holes in the cut edge.

Alt text: "<Feel> mattress cross-section." (Plush, Medium, Firm, Hybrid, Memory foam, Latex.)

### IMG-12 Protection plan

> Aspect ratio 4:3, landscape. A close, bright shot of a hand lifting the corner of a white mattress protector to show a spotless white mattress underneath, with a few clear water droplets beading on the protector's surface. A clean, softly lit bedroom background out of focus. Reassuring, simple.

Alt text: "A protector keeping a mattress clean and dry."

### IMG-13 Bedding flat-lay

> Aspect ratio 3:2, landscape. A tidy overhead flat-lay of folded plain white and oatmeal sheets, two plain pillows and a folded red throw on a light wood floor, soft morning light, a small ceramic cup at the edge. No patterns, no text, no logos.

Alt text: "Folded sheets, pillows and a red throw."

### IMG-14 Brand banner (generic, used for all brand pages until a brand supplies its own)

> Aspect ratio 21:9, ultra-wide. A wide, calm bedroom scene: a neatly made king bed centered in the frame with plain white bedding, soft daylight from a large window on the left, warm neutral walls, a light rug. A lot of calm empty space on the left and right so text can sit over it. No people, no text, no logos.

Alt text: "A neatly made bed in a calm bedroom."

### IMG-15 Account

> Aspect ratio 4:5, portrait. A cosy corner of a bedroom at dusk: a bed with plain linen bedding, a warm bedside lamp glowing, a book and a mug on the bedside table, a red cushion. Soft, warm, quiet mood. No people, no text.

Alt text: "A cosy bedroom corner with a bedside lamp."

### IMG-16 404

> Aspect ratio 4:3, landscape. A playful, simple photo of a single plain pillow standing upright alone in the middle of an otherwise empty, bright room with a light wood floor, as if it has been left behind. Soft shadow, minimal. No text.

Alt text: "A single pillow alone in an empty room."

### IMG-17 Sleep guide

> Aspect ratio 16:9, wide. A person asleep on their side in a bright bedroom, seen from a distance, soft morning light, plain white bedding, peaceful. Face partly hidden by the pillow. No text, no logos.

Alt text: "A person sleeping peacefully."

### IMG-18 Financing

> Aspect ratio 3:2, landscape. A relaxed couple in their thirties sitting together on a made bed looking at a laptop, smiling gently, plain white bedding, warm daylight. The screen is turned away from the camera and shows nothing readable. No text.

Alt text: "A couple planning their purchase together."

### IMG-19 Empty cart

> Aspect ratio 4:3, landscape. A flat, friendly vector illustration on a warm paper background: a shopping cart carrying a rolled-up mattress and a pillow, a small red heart-shaped tag on the cart handle. Soft rounded shapes, limited palette (warm cream, ink black, red #DE0510, a touch of amber), plenty of space around it. No text.

Alt text: "An empty cart with a mattress and a pillow."

### IMG-21 to IMG-24 Home category tiles

Common line:

> Aspect ratio 4:5, portrait. A tight, bright product-style lifestyle photo on a warm paper-coloured background, soft shadows, one red (#DE0510) accent object. No text, no logos, no brand marks.

- **IMG-21 Mattresses:** the corner of a plain white mattress on a low wooden platform, a single pillow, a red throw.
- **IMG-22 Bases and foundations:** an adjustable bed base slightly raised at the head, covered with a plain white mattress and one pillow.
- **IMG-23 Bedding and pillows:** a neat stack of folded white sheets and two pillows, a red pillowcase on top.
- **IMG-24 Protectors and toppers:** a mattress topper being unrolled across a bed, one hand smoothing it, plain white bedding.

Alt text: "<Category> at Mattress Fitness." (Mattresses, Bases and foundations, Bedding and pillows, Protectors and toppers.)

### IMG-25 Social share base

> Aspect ratio 1.91:1, landscape. A wide, bright bedroom photo with the made bed placed on the right third and a large calm empty wall on the left two thirds, so the logo and a headline can be added afterwards in a design tool. A red throw on the bed. No text.

Alt text: not needed (used only as the share image).

## Brand logos and brand photos (not generated)

For the twelve brand tiles and brand pages ask each brand (through its dealer or retailer portal) for: a logo file (SVG or transparent PNG) with its usage rules, and approved lifestyle photos. Until then the site shows brand names as text. Do not ask Gemini to draw a brand's logo or product: it would be wrong and would use the brand's mark without permission.
