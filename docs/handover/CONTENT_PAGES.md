# Content pages: what your team writes, where it goes and how to publish it

**Draft 1, dated 2026-10-25.** For the client's team (store managers, customer service, whoever writes the website text). Part of the handover pack; it extends section 6.7 of the [Admin guide](ADMIN_GUIDE.md). Requirement: REQ-CNT-001 (the 15 pages) and REQ-CNT-002 (blog listing and articles); the client's final text is item CLR-016.

## 0. How much of this has been checked

Nothing in this document has been tried in a development store yet. Every statement carries one of two marks:

- `[FROM CODE]` read from the storefront code on 2026-10-25. It describes what the code does. It has not been seen running against your store.
- `[ADMIN, NOT SEEN]` how Shopify admin normally behaves, written from general knowledge of Shopify. Menu names and button labels can differ in your admin. Nothing was verified in a development store.

**Verified in a development store: none.** The first time someone follows sections 2 to 7 on a development store, the developer or QA should replace each mark with a dated "verified" note or correct the text.

**What this document does not cover.** It gives no wording for any page. The project does not write policy, legal, warranty, financing, delivery-fee, guarantee, return or accessibility-conformance text, and it does not suggest numbers, periods or amounts. Those facts come from you. Where a page needs a fact, this document lists it as a question. The structure and shopper expectations below come from general good practice for shops, not from any other site. It also does not cover a contact form, live chat, or any new page type outside the 15 pages (those are change requests, recorded in `plans/BACKLOG.md`).

## 1. The 15 pages at a glance

The web address of a page is `/pages/<handle>`, where the handle is the "URL handle" in Shopify. The handle must match the table exactly. A page with a different handle will not be found by the links. `[FROM CODE]` Handles are taken from the footer, header and reassurance-strip links in `storefront/app/lib/navigation.ts`. The file `storefront/app/lib/pages/content-pages.ts` does not exist yet, so **confirm each handle with the developer before you create the pages.**

| # | Page | Handle (exact) | Where the storefront links to it | Link today (`[FROM CODE]`) |
|---|---|---|---|---|
| 1 | Delivery and shipping | `delivery-and-shipping` | Footer, Customer support; footer quick-links row; header strip "In-home delivery & setup" | Footer support link is shown. The quick-links row link and the header strip item are hidden until a developer removes a flag |
| 2 | Financing | `financing` | Footer, Customer support | Hidden until a developer removes a flag |
| 3 | Comfort guarantee | `comfort-guarantee` | Footer, About; header strip | Hidden until a developer removes a flag |
| 4 | Price guarantee | `price-guarantee` | Footer, About; header strip | Hidden until a developer removes a flag |
| 5 | Warranty and returns | `warranty-and-returns` | Footer, Customer support | Hidden until a developer removes a flag |
| 6 | FAQ | `faq` | Footer, Customer support | Shown |
| 7 | About | `about` | Footer, About ("About us") | Shown |
| 8 | Contact | `contact` | Footer, Customer support ("Contact us"); utility bar at the top ("Contact us" and "Chat with us", both lead here until a chat provider exists); footer quick-links row ("Get in touch") | Footer support link and utility bar are shown. The quick-links row link is hidden until a developer removes a flag |
| 9 | Size guide | `size-guide` | Footer, Sleep guide; Guides menu, Buying guides | Shown |
| 10 | Comfort guide | `comfort-guide` | Footer, Sleep guide; Guides menu | Shown |
| 11 | Mattress types guide | `mattress-types-guide` | Footer, Sleep guide; Guides menu | Shown |
| 12 | Adjustable base guide | `adjustable-base-guide` | Footer, Sleep guide; Guides menu | Shown |
| 13 | Privacy policy | see section 4.3 (conflict to settle) | Footer legal row ("Privacy policy"); cookie-consent banner | The footer link points at `/pages/privacy-policy`; see 4.3 |
| 14 | Terms | see section 4.3 (conflict to settle) | Footer legal row ("Terms") | The footer link points at `/pages/terms`; see 4.3 |
| 15 | Accessibility | `accessibility` | Footer legal row; footer, About | Shown |

Also in the code, not one of the 15: the Guides menu heading leads to `/pages/guides`, and the sleep journal link leads to `/blogs/journal`. The developer should confirm whether you want a `guides` page. Until one exists, that menu heading is a dead link. `[FROM CODE]` A Shopify navigation menu, when switched on (Admin guide 6.6), replaces the header menu and can point at any page.

## 2. How to create a page

`[ADMIN, NOT SEEN]` unless noted.

1. In Shopify admin open **Online Store > Pages** and click **Add page**.
2. **Title:** the name shoppers see at the top of the page. Use plain words. `[FROM CODE]` The storefront prints the title as the one main heading on the page, and the browser tab shows "Title, then the store name".
3. **Content:** write in the editor. Use the heading styles (Heading 2, Heading 3), paragraphs, bullet and numbered lists, links and tables. Do not use Heading 1; the title is already one. `[FROM CODE]` A Heading 1 in the content is shown as a Heading 2.
4. **What the storefront keeps and drops** `[FROM CODE]`: it keeps paragraphs, line breaks, bold, italic, underline, headings 2 to 6, bullet and numbered lists, quotes, links, images (with alt text), simple tables, definition lists, and figure captions. It removes scripts, styles, embedded frames (for example an embedded video, map or financing widget), forms and form fields, and colour or size settings. Links must start with `https://`, `http://`, `mailto:` or `tel:`. This means: **a contact form, a payment-calculator widget or an embedded video cannot be put in a page body.** Paste a link instead.
5. **Images:** give every image alt text that says what the image shows. Use an image only if you own it or have the right to use it.
6. **Search engine listing:** click **Edit website SEO** (the "Search engine listing" block) and set the **URL handle** to the exact handle from section 1. Shopify makes a handle from the title by default, and it may not match. Fill the page title and description as in section 6.
7. **Visibility:** the page is only available to the storefront when it is visible. `[ADMIN, NOT SEEN]` A hidden page is not returned to the storefront, so the address shows "not found". Pages that are visible also appear in the site's sitemap. `[FROM CODE]` The sitemap includes everything Shopify lists for pages.
8. Save. After saving, wait for the delay in Admin guide section 10.2 (content pages are kept for a while before the website re-reads them; the guide states the range) and open `/pages/<handle>` on the website to check it.
9. **Theme template** (an option Shopify may show): leave it alone. The storefront does not use Shopify themes. `[ADMIN, NOT SEEN]`

To move or rename a page later, keep the handle the same. If the handle must change, tell the developer first, because links and the sitemap use it.

## 3. How links show in the footer (read this before you publish)

`[FROM CODE]` **The footer does not check whether a page exists.** The footer is a fixed list of links in `storefront/app/lib/navigation.ts`. The code carries no information about which Shopify pages exist. Two things follow:

- **Hidden links:** Financing, Warranty and returns, Comfort guarantee, Price guarantee (and the header strip items and two quick-links) are held back on purpose. The wording of these promises is yours to supply, and the code will not show an invented promise. They appear only when a developer removes the "awaiting content" flag for that link, after the page is published and approved. **Writing the page in Shopify does not by itself make the link appear.** Ask the developer, naming the page.
- **Links that are always shown:** the other links (Delivery and shipping in the support group, FAQ, About, Contact, the four guides, Accessibility, and the privacy and terms links) are on the site from day one. If the page does not exist or is hidden, the shopper reaches a "not found" page. Publish these pages before launch, or ask the developer to flag the links until they are ready.

So the rule your team follows: **page written and approved, then visible in Shopify, then ask the developer to unhide the link where one is held back.** A developer should consider adding a check that lists the pages missing for each link; that is not built.

## 4. Policies: privacy policy, terms, and shipping and refund policies

### 4.1 Where they are edited

`[ADMIN, NOT SEEN]` Shopify keeps legal policies separate from Pages. Open **Settings > Policies**. There are boxes for refund policy, privacy policy, terms of service, shipping policy and contact information. Click the box, write or paste the text, and save. Shopify can offer a starter template. If you use one, you must replace every general statement with your own facts and have your legal adviser review it. The project writes no legal text.

### 4.2 Where the storefront shows them

`[FROM CODE]` The storefront shows policies at `/policies/<handle>` and lists them at `/policies`. The four handles it understands are:

| Shopify policy | Address |
|---|---|
| Privacy policy | `/policies/privacy-policy` |
| Shipping policy | `/policies/shipping-policy` |
| Terms of service | `/policies/terms-of-service` |
| Refund policy | `/policies/refund-policy` |

A policy you have not written answers "not found" and is left out of the sitemap. The subscription policy is not shown. Policies are kept for a while like other content (Admin guide 10.2).

### 4.3 An open conflict for the developer and owner

`[FROM CODE]` The footer's legal links point at `/pages/privacy-policy` and `/pages/terms`, while the real policy pages live at `/policies/privacy-policy` and `/policies/terms-of-service`. The cookie banner already links to `/policies/privacy-policy` (Admin guide section 13). As the code stands, the two footer links work only if you also create ordinary Pages with the handles `privacy-policy` and `terms`, which would mean two copies of a legal text. That is risky.

Recommendation for decision (not made): keep one copy in **Settings > Policies**, and have the developer point the footer links at `/policies/privacy-policy` and `/policies/terms-of-service`. Do not create duplicate Pages in the meantime. Do not publish either until this is settled. `confirm with developer`

### 4.4 Shipping and refund policies versus the pages

Your "Delivery and shipping" and "Warranty and returns" pages are not the same objects as Shopify's shipping policy and refund policy. If you fill in Shopify's shipping and refund policies, they are shown by the storefront at `/policies/...`, may be linked from Shopify's checkout (`[ADMIN, NOT SEEN]`), and must **say the same thing** as the pages. Decide with your legal adviser which is the master text, and have the other point to it rather than repeat it.

## 5. The pages, one by one

For each page: the recommended headings (a suggestion; drop what does not apply), what shoppers usually expect to find, and the questions only you can answer. Answers must be your real, current business facts. Do not copy another retailer's text. Use plain words, short sentences, and descriptive link text (not "click here"). Use Heading 2 for the main sections and Heading 3 inside them.

Every page should also end with one clear next step (for example, the contact page link or a link to shop) and show a "last updated" date where the facts can change, for the pages marked below.

### 5.1 Delivery and shipping (`delivery-and-shipping`)

Footer: Customer support. Shoppers expect: whether you deliver to them, what it costs, when it arrives, what happens on the day, and what to do if something goes wrong. Recommended headings:

- Where we deliver
- Delivery options and what each includes
- What it costs
- How long it takes and how we schedule it
- Before delivery day (access, clear space)
- On delivery day (inspection, setup, taking away the old bed if offered)
- If something is wrong
- Last updated

Questions: Which areas, by ZIP code, do you deliver to, and what do you say to people outside them? Which services do you offer (curbside, in-home, setup, haul-away, parcel) and who performs each? What is the charge for each, and when is it free? What are the lead times and delivery windows, and can the shopper choose? What must the shopper prepare? What can the delivery team not do (for example move other furniture, install on certain frames)? What does the shopper do if an item arrives damaged, and within what period must they tell you? How do they contact you about a delivery? Do these facts match the delivery zone and delivery rules configured in the store (ask the developer for the current list so the text and the checkout cannot disagree)?

SEO suggestion: title that names the page and the shop ("Delivery and shipping"), description saying what the page covers in your own words.

### 5.2 Financing (`financing`)

Footer: Customer support (hidden until you supply the content and the developer unhides it). Shoppers expect: who the lender is, how to apply, what is needed, what happens after, and clear statements that terms depend on approval. Recommended headings:

- How financing works
- Who provides it
- How to apply (online or in store)
- What you need to apply
- Terms, rates and fees (as the lender states them)
- Questions about your account or application
- Required disclosures (wording from the lender or your legal adviser)

Questions: Do you offer financing at all? Which provider or providers, and are they US lenders licensed for your states? How does a shopper apply, and where? What are the lender's terms (rates, periods, minimum purchase, fees, eligibility), written or confirmed by the lender in writing? Which legal disclosures must be shown, and what wording does the lender or your legal adviser require? Who answers financing questions? Does the lender provide a link or a widget, and if a widget, is a link to it acceptable instead (embedded widgets are removed from page text)? Do you want any financing message near prices (that is a new feature and a change request)?

### 5.3 Comfort guarantee (`comfort-guarantee`)

Footer: About (hidden until supplied); header strip. Shoppers expect: exactly what is promised, for how long, what they must do, what it costs them, and what happens to the mattress. Recommended headings:

- What the comfort guarantee is
- Which products it covers (and which it does not)
- How long it lasts
- How to make a claim
- What condition the mattress must be in
- What you will do (exchange, refund, credit) and who pays for pickup
- Exceptions and limits
- Contact for claims

Questions: Do you offer a comfort guarantee, and does it apply to all brands or only some? How long is the period, and when does it start? What must the shopper do before making a claim (for example a trial period)? What are the choices you offer afterwards? Are there fees, restocking charges or pickup charges? What condition must the product be in? Which products or purchases are excluded (clearance, floor models, bases, bedding)? How is the claim made? Are the terms set by you or by each manufacturer? Has your legal adviser approved the wording? (The code's header strip says "Comfort guarantee" as a placeholder only; the real wording is yours and will replace it.)

### 5.4 Price guarantee (`price-guarantee`)

Footer: About (hidden until supplied); header strip. Shoppers expect: what price is matched, against whom, in what window, with what proof, and what is excluded. Recommended headings:

- What the price guarantee is
- What we will match
- What qualifies as a competing offer (same item, same condition, who sells it)
- How long after purchase you can ask
- How to ask, and what to send
- What is not included
- Contact

Questions: Do you offer a price guarantee? What exactly is matched or beaten, and by how much? Against which sellers (local, online, authorised dealers only)? For which period before or after the purchase? What proof is required? What is excluded (clearance, financing offers, bundles, gifts, other discounts, outlet or membership prices)? How does a shopper ask, and who decides? How is the refund or credit paid? Can it be combined with other offers? Has your legal adviser approved the wording?

### 5.5 Warranty and returns (`warranty-and-returns`)

Footer: Customer support (hidden until supplied). Shoppers expect: separate, clear answers for the manufacturer warranty and for returning an item, and what the optional accident protection adds. Recommended headings:

- Returns: how to return an item (what can be returned, when, condition, who pays, refund method, timing)
- Items we cannot take back
- Manufacturer warranty (what it is, who provides it, where the shopper finds the terms for their brand)
- How to make a warranty claim
- Accident protection (the optional plan sold with a product, and where its terms are)
- Contact

Questions: What is the return policy for each category (mattresses, bases, furniture, bedding, protectors, clearance, special orders)? Within what period, and measured from order, delivery or something else? Who pays for return shipping or pickup, and are there fees? How is the refund made and how long does it take? What cannot be returned? How does the warranty work for each brand you sell, and where are the manufacturers' documents? How does a shopper start a warranty claim, and with whom (you or the manufacturer)? What does the protection plan cover and where are its terms? (Only supply what the plan provider confirms; the project will not describe plan coverage for you.) Does this page match Shopify's refund policy (see 4.4)?

### 5.6 FAQ (`faq`)

Footer: Customer support. See also section 5.6a for the format.

Shoppers expect: short direct answers to the questions your customers really ask, grouped under clear topics, with links to the full page on a topic. Recommended headings (Heading 2 for the topic, Heading 3 for each question):

- Ordering and payment
- Delivery and setup
- Products and choosing (sizes, comfort, types, bases)
- Returns, guarantees and warranty (link to each full page; do not repeat the terms)
- Stores and contact

Questions: What are the 10 to 20 questions customers ask most (from email, phone, chat and store staff)? For each, what is the correct answer, written from your own facts? For any question whose answer is a policy, which page holds the master text? Who keeps the FAQ up to date?

#### 5.6a FAQ format, and the structured-data point

Write each question as its own heading (Heading 3) and put the whole answer directly under it as normal paragraphs or a list, visible on the page, with no answer split into pieces under several headings. One question, one answer. Do not hide answers behind buttons or tabs that the editor creates. Use the same wording on the page as you would want shown elsewhere.

What is and is not built `[FROM CODE]`:

- **Collection and product FAQs** use FAQ entries in **Content > Metaobjects > FAQ** (Admin guide 6.3), and the storefront builds the machine-readable FAQ data (schema.org FAQPage) from them.
- **The FAQ content page does not.** The page route shows the page text only; it creates no FAQPage structured data. Writing questions and answers in the format above gives the cleanest page and is ready if the developer later reads questions from the page, but it does not produce structured data today. Producing it for this page is either a small developer change under REQ-SEO-001 (to be confirmed) or the use of FAQ entries; ask the developer. `confirm with developer`
- Search engines also limit which sites get FAQ result displays. `[ADMIN, NOT SEEN]` (general knowledge, not checked against current search-engine documentation). Do not promise the client a search-result display.

### 5.7 About (`about`)

Footer: About ("About us"). Shoppers expect: who you are, how long you have been trading, where, what you stand for, and how to reach a person. Recommended headings:

- Who we are
- What we sell and the brands we carry
- Our stores (link to the store finder, which has its own page)
- How we help you choose (link to the sleep quiz, guides)
- Contact

Questions: What is the business's story, in your words? When did it start and who owns it? Which brands do you carry (only those you may name)? How many stores and where (the store finder gets this from the store entries, so do not retype addresses and hours here)? What awards, memberships or certifications can you document? Which photos and people may be shown, and do you have permission? Which claims can you prove?

### 5.8 Contact (`contact`)

Footer: Customer support, utility bar and quick-links row. Shoppers expect: every way to reach you, with hours, and what to have ready. Recommended headings:

- Call us
- Email us
- Visit a store (link to the store finder)
- Hours for phone and email
- What to have ready (order number, email)
- Order questions (link to order tracking)

Questions: What phone number, with which hours? (The site header shows a phone number only when the number is configured in the store settings; the developer sets it, `[FROM CODE]`; the page text should match.) What email address, and how fast do you answer? Which departments exist (sales, delivery, claims)? Is there a mailing address you want shown? Is chat offered now, and with which provider? (Today "Chat with us" leads to this page, `[FROM CODE]`.) A contact form cannot be put in the page body (section 2, step 4); if you want one, it is a change request.

### 5.9 Size guide (`size-guide`)

Footer: Sleep guide; Guides menu. Shoppers expect: what each bed size is, who it suits, how big a room it needs, and that sizes differ a little between brands. Recommended headings:

- Mattress sizes at a glance (a table: size, dimensions, usually suits)
- Which size for one sleeper, a couple, a family
- Room size and bed frames
- Sizes for adjustable bases and special beds
- Link to shop each size

Questions: Which sizes do you sell (the menu lists twin, twin XL, full, queen, king and California king; do you carry others)? What dimensions does each manufacturer state for the sizes you carry (use manufacturer sheets, and say which brand if brands differ)? What room-size or clearance guidance do you give, and from what source? Do you want a link from each size to its collection?

### 5.10 Comfort guide (`comfort-guide`)

Footer: Sleep guide; Guides menu. Shoppers expect: what plush, medium and firm mean, who each tends to suit (as general guidance, not medical advice), and how to test one. Recommended headings:

- What "comfort level" means
- Plush, medium and firm: how each feels
- How sleep position and body type can affect the choice
- Try before you buy (store visit, comfort guarantee only if page 5.3 exists)
- Take the sleep quiz (link)

Questions: How do your staff describe each comfort level, and is a rating scale used by the brands you carry? What advice do your sales staff give by sleeping position, and who approves it as your position? Which statements must not be made (medical or health claims)? Do you want to link to the quiz and to the comparison page?

### 5.11 Mattress types guide (`mattress-types-guide`)

Footer: Sleep guide; Guides menu. Shoppers expect: a plain description of each type, its common strengths and trade-offs, and who it may suit. Recommended headings:

- Memory foam
- Hybrid
- Innerspring
- Latex
- Other types you sell
- How to choose between them (link to the quiz, the comparison page and the collections)

Questions: Which types do you actually sell? For each, which materials and construction do your brands describe, using manufacturer information you are allowed to use? What trade-offs do you want stated? Which terms need a one-line definition (coil, gel, zoned support)? Do not add performance or health claims that no manufacturer or your own team can back.

### 5.12 Adjustable base guide (`adjustable-base-guide`)

Footer: Sleep guide; Guides menu. Shoppers expect: what an adjustable base does, what features exist, what mattress works with it, and what size and delivery matter. Recommended headings:

- What an adjustable base is
- Features (head and foot positions, massage, memory positions, wall-hugging, remote or app), only those you sell
- Which mattresses work with an adjustable base
- Sizes, power and space needs
- Delivery and setup (link to page 5.1)
- Warranty (link to page 5.5)
- Shop adjustable bases (link)

Questions: Which bases and features do you sell? Which of your mattress types work with them (from manufacturer statements)? What size, clearance and power-outlet needs do the manufacturers state? Is setup included, and is it free? Which frames or headboards are or are not compatible?

### 5.13 Privacy policy (Shopify policy, see section 4)

Footer: legal row; the cookie banner links to it. Edit in **Settings > Policies**. Your legal adviser writes or approves it. Shoppers expect: what you collect, why, who receives it, how long you keep it, how to see or delete it, and how to opt out. Recommended headings:

- What we collect and why
- Who we share it with
- Cookies and analytics (what is switched on, and how a visitor changes their choice)
- How long we keep it
- Your choices and rights
- How to contact us about privacy
- Date of last change

Questions for you and your adviser: which state laws apply to you and which rights must be offered? Which tools process data (Shopify, analytics and ad tools, email provider, the accident-protection provider when a shopper buys a plan, financing provider)? How long is data kept? How does someone ask for access or deletion? Is a "do not sell or share" link needed? Which opt-in or opt-out approach applies to analytics cookies (Client question pack, 5.3 and 5.4)? The site also stores the delivery ZIP code in a cookie on the shopper's device; the policy should say so, and that order details go to the accident-protection provider when a plan is bought (Question pack Part 3, item 5). The policy page must be live before analytics is switched on (Question pack 5.4).

### 5.14 Terms (Shopify policy "Terms of service", see section 4)

Footer: legal row. Edit in **Settings > Policies**; your legal adviser writes it. Recommended headings: Using this site; Orders, prices and payment; Delivery and returns (point to the pages, do not repeat); Warranty and protection plans (point to the pages); Intellectual property; Limits of liability; Changes to these terms; Governing law; Contact. Questions for you and your adviser: What are your legal business name and address? Which governing law and venue apply? What is the process for pricing errors and out-of-stock orders? Which promotions have separate terms? How are changes announced? What must be said about accessibility and about third-party providers?

### 5.15 Accessibility (`accessibility`)

Footer: legal row; About group. Shoppers, including people using assistive technology, expect: your commitment, which standard you aim for, how to get help, and a person to contact. The project is built to aim at WCAG 2.2 level AA, which the client has not yet formally approved (requirement NFR-003). **Do not claim that the site conforms to a standard until QA has tested it and the owner agrees the wording.** Recommended headings:

- Our commitment
- The standard we aim for
- What is known not to work yet (only once testing has found items)
- How to get help or report a problem (phone, email, a named role)
- Date of last review

Questions: What commitment statement do you want, and has your legal adviser approved it? Which standard and level will you name, and what has been tested (ask QA, and ask the developer for the latest test evidence)? Who receives accessibility reports, how quickly do you answer, and what alternative do you offer (phone orders, store visit)? Is there a feedback form or email address you will monitor? When will the page be reviewed again?

## 6. SEO fields to fill for each page

`[ADMIN, NOT SEEN]` In **Edit website SEO** on each page, fill in:

- **Page title** (about 50 to 60 characters): the page's subject first, then the shop name is added by the storefront. Unique on every page.
- **Meta description** (about 150 to 160 characters): one plain sentence on what the page tells the shopper, in your own words, with no promises that the page does not make.
- **URL handle:** exactly as in section 1.

What the storefront does with them `[FROM CODE]`: the page route reads the SEO title and description from Shopify but only uses the **page title** for the browser tab; it sets no meta description from the page's SEO fields. Fill the fields anyway, because they do no harm and are ready, but **do not rely on them yet.** The developer should confirm whether to wire them in (ask: is the meta description for content pages in scope under REQ-SEO-001?). `confirm with developer` For the privacy and terms policies there are no separate SEO fields.

Do not put the same title or description on two pages. Do not stuff keywords. Do not claim a guarantee, price, rate or period in a description unless the page states it and the client approved it.

## 7. Before publishing: checklist

For each page, a named person ticks every line.

- [ ] The facts come from the client's business, not from another site or from this document. No sample numbers remain.
- [ ] Legal, warranty, financing, guarantee, return and privacy text is approved in writing by the person you named (and your legal adviser where needed). Approval status per page is recorded (CLR-016).
- [ ] The handle is exactly as in section 1 (or section 4.2 for policies).
- [ ] Title is clear; there is no Heading 1 in the content; headings go in order (2, then 3).
- [ ] Every image has alt text; there are no embedded frames, forms or widgets (they would be removed).
- [ ] Links work: each starts with `https://`, `mailto:` or `tel:`, or is a site path starting `/`; link text says where it goes.
- [ ] Phone, email, hours and addresses match the store settings and the store entries.
- [ ] Policy pages agree with each other (section 4.4) and with checkout.
- [ ] SEO title and description are filled and unique.
- [ ] The page is read once on a phone-size screen, and by someone who did not write it.
- [ ] Visibility is set to visible only when everything above is done.
- [ ] After the Admin guide 10.2 delay, `/pages/<handle>` loads on the website and the footer link works. For a held-back link, the developer has unhidden it.
- [ ] If the page makes a promise (guarantee, delivery, returns), the matching header strip item and links are checked with the developer.

### How to preview

`[ADMIN, NOT SEEN]` Shopify's own "View page" button opens the Shopify-hosted online store, not this website, and a hidden page is not returned to the storefront. A real preview therefore needs one of these, to be agreed with the developer: (a) write the text in a shared document and have it approved before pasting it in; (b) make the page visible on a development store connected to a staging copy of the site and read it there; (c) as a last resort, make it visible on the live store and read it at its address before linking it (note that visible pages join the sitemap). Option (b) is recommended. None of these has been tried. `confirm with developer`

## 8. Blog: listing and articles

The footer and Guides menu link to the sleep journal at `/blogs/journal`. `[FROM CODE]` So the blog's handle should be `journal`. `confirm with developer` Create or open it in `[ADMIN, NOT SEEN]` **Online Store > Blog posts > Manage blogs**, where the blog's handle is set under the same "Search engine listing" block. Blog text is shown on the storefront by the same sanitiser as pages (section 2, step 4).

For each article:

| Field in Shopify | What to put | What the storefront does with it (`[FROM CODE]`) |
|---|---|---|
| Title | A clear, specific title | Shown as the main heading, in the listing and in the tab title |
| Content | Body text with Heading 2 and 3, short paragraphs, lists | Shown after the same filter as pages |
| Author | The real person's name, or the team name you want shown | Shown next to the date on the article. If none is set, the author is blank |
| Publish date | The real date; leave as it is unless you are scheduling | Shown as "Month day, year" on the article and in the listing |
| Featured image | An image you have the right to use | Shown at the top of the article and in the listing (as a 3:2 crop) |
| Image alt text | One sentence saying what is in the image | Used in the listing; if empty, the article title is used instead |
| Excerpt (summary) | One or two sentences | Not read by the storefront today; fill it only if you want it ready |
| Tags | A few topic words | Not read by the storefront today; keep them tidy for later |
| SEO title and description | As in section 6 | Read from Shopify but not yet used for the tab title or meta description |
| URL handle | Short, lower-case, words separated by hyphens | Forms `/blogs/journal/<handle>` |

The listing page shows four articles at a time, newest first as Shopify returns them, each with the image, title and date, with paging controls for the rest (their exact look was not checked). It shows no author, excerpt or tags. `[FROM CODE]` An article page has no related-articles block, no share buttons and no article structured data in its route code; if wanted, they are change requests (CR process, `plans/BACKLOG.md`). Articles that are published are included in the sitemap.

Before publishing an article use the section 7 checklist, plus: no health claims, no medical advice, and no product claim you cannot support from the manufacturer's information.

## 9. Open items for the developer (confirm, then update this document)

1. Confirm the 15 handles in section 1 and whether a `guides` page and the `journal` blog are wanted.
2. Settle the privacy and terms link conflict (4.3).
3. Decide whether page SEO title and description are used (6) and whether the FAQ page should produce FAQPage data (5.6a).
4. Provide a way to see which linked pages are missing, or flag the always-shown links until their pages exist (3).
5. Run through sections 2 to 8 on a development store and replace the `[ADMIN, NOT SEEN]` marks. Confirm the visibility, preview and URL-handle steps and the Settings > Policies layout.
6. When the code file `storefront/app/lib/pages/content-pages.ts` appears, replace the handles in section 1 from it.
