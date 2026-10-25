# Content pages: what your team writes, where it goes and how to publish it

**Draft 2, dated 2026-10-25.** Draft 1 was written before the developer finished the content pages and said several things that are no longer true (that the footer does not check whether a page exists, that a developer must remove a flag to show most links, that the privacy and terms links conflict, that page SEO fields and the FAQ markup are unused, and that blog listings show no author or excerpt). This draft was rewritten from the committed code (branch `feat/content-pages-and-signup`, latest commit `ae8e606`). For the client's team (store managers, customer service, whoever writes the website text). Part of the handover pack; it extends section 6.7 of the [Admin guide](ADMIN_GUIDE.md). Requirement: REQ-CNT-001 (the 15 pages) and REQ-CNT-002 (blog listing and articles); the client's final text is item CLR-016.

## 0. How much of this has been checked

Nothing in this document has been tried in a development store yet. Every statement carries one of two marks:

- `[FROM CODE]` read from the storefront code on 2026-10-25 (the files are named in section 10). It describes what the code does. It has not been seen running against your store, and the code was not run to produce this document: no browser, no development store, no test run.
- `[ADMIN, NOT SEEN]` how Shopify admin normally behaves, written from general knowledge of Shopify. Menu names and button labels can differ in your admin. Nothing was verified in a development store.

**Verified in a development store: none.** The first time someone follows sections 2 to 7 on a development store, the developer or QA should replace each mark with a dated "verified" note or correct the text.

**What this document does not cover.** It gives no wording for any page. The project does not write policy, legal, warranty, financing, delivery-fee, guarantee, return or accessibility-conformance text, and it does not suggest numbers, periods or amounts. Those facts come from you. Where a page needs a fact, this document lists it as a question. The structure and shopper expectations below come from general good practice for shops, not from any other site. It also does not cover a contact form, live chat, or any new page type outside the 15 pages (those are change requests, recorded in `plans/BACKLOG.md`).

## 1. The 15 pages at a glance

The web address of a page is `/pages/<handle>`, where the handle is the "URL handle" in Shopify. The handle must match the table exactly: the links look for a page by that handle, and a page with a different handle gets no link. `[FROM CODE]` The 15 handles, the footer group and the link text of each are the registry in `storefront/app/lib/pages/content-pages.ts` (read 2026-10-25). The table below is copied from it. Privacy policy and Terms are the two exceptions: they live in Settings > Policies (section 4).

| # | Page | Handle (exact) | Footer group and link text | Other places it is linked from |
|---|---|---|---|---|
| 1 | Delivery and shipping | `delivery-and-shipping` | Customer support, "Delivery and shipping" | Footer quick-links row, "Delivery information". The header strip item "In-home delivery & setup" is still held back (section 3.4) |
| 2 | Financing | `financing` | Customer support, "Financing" | none |
| 3 | Comfort guarantee | `comfort-guarantee` | About, "Comfort guarantee" | The header strip item is still held back (section 3.4) |
| 4 | Price guarantee | `price-guarantee` | About, "Price guarantee" | The header strip item is still held back (section 3.4) |
| 5 | Warranty and returns | `warranty-and-returns` | Customer support, "Warranty and returns" | none |
| 6 | FAQ | `faq` | Customer support, "FAQ" | none |
| 7 | About | `about` | About, "About us" | none |
| 8 | Contact | `contact` | Customer support, "Contact us" | Footer quick-links row, "Get in touch"; the header top bar and the phone menu, "Contact us" |
| 9 | Size guide | `size-guide` | Sleep guide, "Size guide" | Guides menu, Buying guides (when the fixed menu is in use) |
| 10 | Comfort guide | `comfort-guide` | Sleep guide, "Comfort guide" | Guides menu, Buying guides |
| 11 | Mattress types guide | `mattress-types-guide` | Sleep guide, "Mattress types guide" | Guides menu, Buying guides |
| 12 | Adjustable base guide | `adjustable-base-guide` | Sleep guide, "Adjustable base guide" | Guides menu, Buying guides |
| 13 | Privacy policy | Shopify policy; fallback page handle `privacy-policy` | Legal row, "Privacy policy" | The cookie-consent banner links to `/policies/privacy-policy` |
| 14 | Terms | Shopify policy; fallback page handle `terms` | Legal row, "Terms" | none |
| 15 | Accessibility | `accessibility` | Legal row, "Accessibility" | none |

Also in the registry, not one of the 15: the **sleep journal** blog, handle `journal` (footer group Sleep guide, link text "Sleep journal"; also in the Guides menu under Help choosing). See section 8.

**Every link in this table appears automatically, and only, when its Shopify page exists and has content** (the rule is in section 3). You do not ask a developer to switch a link on. The exceptions are the header strip items and the order-tracking links, section 3.4.

`[FROM CODE]` Any page you create with another handle is still served at `/pages/<that handle>`, but nothing links to it. A Shopify navigation menu, when switched on (Admin guide 6.6), replaces the header menu and can point at any page.

## 2. How to create a page

`[ADMIN, NOT SEEN]` unless noted.

1. In Shopify admin open **Online Store > Pages** and click **Add page**.
2. **Title:** the name shoppers see at the top of the page. Use plain words. `[FROM CODE]` The storefront prints the title as the one main heading on the page. If Shopify gives an empty title, the registry's title for that page is used instead (for example "Frequently asked questions" for the FAQ page). The browser tab shows "Title | store name", where Title is the SEO title (section 6) if you set one and the page title otherwise.
3. **Content:** write in the editor. Use the heading styles (Heading 2, Heading 3), paragraphs, bullet and numbered lists, links and tables. Do not use Heading 1; the title is already one. `[FROM CODE]` A Heading 1 in the content is shown as a Heading 2. When a page has three or more Heading 2 and Heading 3 headings that contain text, the storefront adds an "On this page" list of links under the title, built from them. It is not shown when there are fewer than three. `[FROM CODE]` Pages show a "Last updated" date taken from Shopify's own last-edit time; you do not type it. Policies show no date.
4. **What the storefront keeps and drops** `[FROM CODE]` (`storefront/app/lib/shopify/sanitize-html.ts`, read 2026-10-25): it keeps paragraphs, line breaks, horizontal rules, bold, italic, underline, strikethrough, subscript, superscript, headings 2 to 6, bullet and numbered lists, quotes, links, images (with alt text), tables, definition lists, and figure captions. It removes scripts, styles, embedded frames (for example an embedded video, map or financing widget), objects, embeds, forms and form fields, and every colour, size and class setting. The content of a script, style or embedded frame is removed with it. Form and unknown tags are dropped but ordinary text inside them may stay, so check how it reads. Link addresses must start with `https://`, `http://`, `mailto:` or `tel:`, or be a site path starting `/` (or `#`, `?`); anything else loses its link. An image is kept only if its address starts with `https://`. Text beyond 300,000 characters is cut, **and anything after it is not shown at all**. Likewise, if the HTML leaves one of these tags open (head, title, select, template, math, svg, script, style, iframe, object, embed, noscript, textarea), everything after it is swallowed by it and does not appear on the page; this happens with pasted code more than with the normal editor. If a page ends early, look for a pasted block or for text far beyond 300,000 characters. Zero-width characters (invisible spaces) are not text: a body made only of them is empty. **Limits on large pages** `[FROM CODE]`: only the first 200 Heading 2 and Heading 3 headings get a link target, the "On this page" list shows at most 50, and the FAQ data holds at most 50 questions. A page that needs more should be split in two. This means: **a contact form, a payment-calculator widget or an embedded video cannot be put in a page body.** Paste a link instead.
5. **Images:** give every image alt text that says what the image shows. Use an image only if you own it or have the right to use it. `[FROM CODE]` A page that holds only an image still counts as having content (section 3.1).
6. **Search engine listing:** click **Edit website SEO** (the "Search engine listing" block) and set the **URL handle** to the exact handle from section 1. Shopify makes a handle from the title by default, and it may not match. Fill the page title and description as in section 6.
7. **Visibility:** the page is only available to the storefront when it is visible. `[ADMIN, NOT SEEN]` A hidden page is not returned to the storefront, so the address shows "not found" and **no footer or header link appears for it**. This is also how you hold back a promise page (Comfort guarantee, Price guarantee, Warranty and returns, Financing) until the client approves it: keep it hidden, or leave its content empty, until then. `[FROM CODE]` The links are decided only by whether the website can read the page and whether it has text; there is no separate approval switch in the code. Visible pages also appear in the site's sitemap. `[FROM CODE]` The sitemap routes ask Shopify's sitemap for the types pages, blogs and articles (`storefront/app/lib/seo/sitemap.ts`); which individual pages Shopify lists was not checked.
8. Save. After saving, wait for the delay in Admin guide section 10.2 (see section 3.5 below: more than one copy is involved) and open `/pages/<handle>` on the website to check it, then check that the footer link has appeared.
9. **Theme template** (an option Shopify may show): leave it alone. The storefront does not use Shopify themes. `[ADMIN, NOT SEEN]`

To move or rename a page later, keep the handle the same. If the handle must change, tell the developer first, because links and the sitemap use it. If you change a registered page's handle without telling anyone, its footer link simply disappears (the website no longer finds a page at the old handle).

**Printing** `[FROM CODE]`: when someone prints a page, the breadcrumb and the "On this page" list are left off. The rest of the site frame is printed as it is.

## 3. How links show in the footer (read this before you publish)

### 3.1 The one rule: a link shows only when its page exists with text

`[FROM CODE]` (`content-pages-data.ts`, `content-pages-html.ts`, `content-pages.ts`, read 2026-10-25) On every page load the website makes one batched read of Shopify asking, for each of the 15 handles in section 1, whether that page exists and what its body is, plus the two shop policies and the journal blog. A link to a Shopify page, policy or blog is shown only when the answer is yes. The same rule is used by the footer, the header and the page address itself, so they cannot disagree.

**What counts as "exists with content":**

- The page exists and is visible to the storefront (`[ADMIN, NOT SEEN]` a hidden page is not returned).
- After the storefront's clean-up (section 2, step 4) its body shows **text** or **an image**. Text is checked after special characters are decoded and spaces are trimmed, so a page whose only content is a non-breaking space (`&nbsp;`) or empty paragraphs counts as **empty**. A page that holds only an image counts as having content, provided the image address starts with `https://`. A page whose body is only a form, a video or map frame or a script counts as empty, because those are removed.
- An empty page gets **no link**. If someone opens its address anyway, they see the title and "This page has no content yet." and the page asks search engines not to list it (section 6).
- **Policies** (privacy and terms) are different: they count as existing when Shopify returns the policy at all. The code does not check its text. Whether Shopify returns a policy whose box is empty was not checked. `confirm with developer`
- **The journal blog** counts only when a blog with the handle `journal` exists **and has at least one article** (section 8).

**What this does to the links:**

- **Footer:** the Customer support, Sleep guide, About and legal groups and the quick-links row ("Delivery information", "Get in touch") list only the links whose page exists with content. A group with no link left is not shown. Links appear in the order set in the registry.
- **Header top bar and the phone menu:** "Contact us" appears only when the `contact` page exists with content. The phone number is separate: it shows only when a valid number is set (Admin guide 6.4).
- **Menu and the fixed-navigation fallback:** the website's own designed menu (used when no Shopify menu is switched on or the Shopify menu is empty or unreadable) drops its links to `/pages/...` and `/blogs/...` that do not exist. That covers the four guides under Guides > Buying guides and "Sleep journal" under Guides > Help choosing. A group left empty is dropped. The **Guides** heading itself is plain text that opens the menu; it has no page of its own to link to. A menu you build in Shopify (Admin guide 6.6) is **not** checked this way: it is your own choice of links, so click each one after you save.
- **If the read fails** (Shopify cannot be reached), the website first keeps showing the last good answer for up to 10 minutes. After that, or if there never was a good answer, it treats the failure as "nothing exists": all of these links disappear. A missing link is chosen over a link that could show "not found". The failure is logged once per run of failures. `[FROM CODE]` The links are part of the data sent with each page load, and the website does not fetch them again while a visitor clicks around inside the site. A visitor who got a page without the links keeps it that way until they reload the page or do something that sends a form (add to cart, sign in); a reload after the read recovers brings the links back.
- **The cookie banner's "Privacy policy" link** follows the same rule: it goes to the Shopify policy when that exists, to a Page with the handle `privacy-policy` when only that has text, and is left out when neither exists (4.3).
- **Pages you have not written yet:** their links are not shown; nothing stands in for them.

So the rule your team follows: **write and approve the page text, then make the page visible in Shopify, then wait for the delay in 3.5.** The link appears by itself. A developer is not needed, except for the items in 3.4.

### 3.2 What the approval step now depends on

Because a link appears as soon as a visible page has text, **the approval gate is now in Shopify, not in the code.** For the pages that make a promise (Financing, Warranty and returns, Comfort guarantee, Price guarantee) and for Privacy policy and Terms, do not make the page visible or put text in it until the person named in the checklist (section 7) has approved it. Saving a half-written draft in a visible page puts its link on the live site after the cache delay.

### 3.3 Looking for a missing link

If a link you expect is not on the site, check in this order: the handle matches section 1 exactly; the page is visible; the body has text or an image (not only blank lines); the cache delay (3.5) has passed. The code offers no list of which pages are missing. `confirm with developer` whether one is wanted.

### 3.4 What still needs a developer

`[FROM CODE]` Three things are still behind switches in code, not behind your content:

- **"Track your order" and "Order tracking"** in the footer stay hidden by a code flag (`awaitingContent` in `storefront/app/lib/navigation.ts`) until a developer has verified the order lookup on a development store and your team has acknowledged change SD-05 (Admin guide section 12; `docs/integrations/GUEST_TRACKING.md`). The reason is that the lookup has not been tried with a real order, not that a page is missing. The top-bar link "Track order" is always shown (it needs no Shopify page); it opens the lookup form, or a notice that it is unavailable when the server settings for it are incomplete.
- **The header strip** ("In-home delivery & setup", "Comfort guarantee", "Price guarantee", and the same items on the home page) stays hidden by the same kind of flag on each item. The wording is placeholder text and is yours to supply (B-15). Writing the pages does not show it. Ask the developer, naming the item, after the page is approved. The matching footer link, by contrast, appears by itself.
- **"Chat with us"** in the top bar and the phone menu is a button for a chat provider's widget, switched on by a setting in the website's environment (`PUBLIC_CHAT_PROVIDER`), not by any Shopify page. It is **off by default and no provider is chosen or approved yet (Q-011, P7-03)**, so today it is shown nowhere. The old stand-in, a link to the contact page under a chat label, promised a chat that does not exist and is gone. When a provider is configured the button appears only while its widget is loading or ready (and, by default, only after a visitor has agreed to the analytics category in the privacy choices); if the widget fails after a visitor pressed it, the button becomes a link to the contact page when that page exists, and otherwise goes away. Shopify Inbox cannot be used on this storefront as verified so far (`docs/integrations/CHAT.md`). Choosing and approving a provider is a client decision (CLR-005) followed by developer work; the switch itself needs no code change.

### 3.5 How long a change takes to show

`[FROM CODE]` The footer links, the header links and each page address are separate cached reads. They expire at different moments. After you add, edit, hide or empty a page, the footer link and the page itself may therefore change at different times, within the "long" window of Admin guide section 10.2 (the number is stated there; it has not been measured on a real store). Expect a window in which a link has appeared and its page still shows the old text, or the reverse. Check again after the full window before you report a problem. `[FROM CODE]` On top of that cached read the website keeps its own short-lived answer to "which pages exist": it asks again at most once a minute per server, so a change can take up to a minute more to reach the links. An address that does not exist is kept only briefly (a few seconds) instead of for the long window, and so is every "Load more" page of a blog; an address whose page exists is kept for the long window. So a page you create for an address you had already tried shows up within seconds to a minute, not an hour. The 15 listed pages keep the long window even when missing.

The redirect for the privacy and terms addresses (section 4.3) is sent with a `no-store` instruction, so browsers and shared caches are told not to keep it; the policy check behind it still uses the same cached read.

### 3.6 Taking a page down quickly (for example for a legal reason)

`[FROM CODE]` (`content-pages-data.ts`, `content-pages-cache.ts`; timings are the code's settings, not measured on a real store)

Unpublishing is a two-part event with two different clocks:

- **The links** to the page (footer, header, menu, cookie banner) disappear within the website's own memory of "which pages exist" (about **1 minute**), and, if Shopify cannot be read at that moment, up to **10 more minutes** (the last good answer is kept for that long). After a failed read the website also waits **15 seconds** before asking again.
- **The page text itself** can stay visible at its address for the long cache window of Admin guide section 10.2 (about an **hour**; on a rarely visited address it can be longer, up to about **24 hours** in the worst case, because a cached copy is only replaced when someone asks for it). An address that is not a listed page or an existing article gets only a few seconds of caching, so only pages that existed are affected.

To make it disappear sooner, in order of effort:

1. **Wait** for the windows above. Nothing else to do.
2. **Restart or redeploy the storefront** (a developer; on the own server this is a restart of the application, Q-003). That empties both the website's memory and its cached copies, so the page is gone as soon as the new process answers. It also resets the 10-minute and 15-second timers.
3. **Replace the text instead of hiding the page:** if the page must read differently immediately, edit its text and wait the windows; this does not help with a copy already served.
4. For search results, a page that is hidden or empty is not listed again after search engines next visit it; asking them to remove the address is done in their own tools, not here.

The privacy policy and terms (Settings > Policies) follow the same clocks.

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

A policy you have not written answers "not found" and is left out of the sitemap. The subscription policy is not shown. Policies are kept for a while like other content (Admin guide 10.2). A policy page shows its title and text, with no "Last updated" date (Shopify gives none for policies), and its breadcrumb runs Home, Policies, the policy name. `[FROM CODE]` The footer links only to the privacy policy and the terms (4.3). The shipping and refund policies are shown at their addresses and in the `/policies` list, but the footer has no link to them.

### 4.3 Privacy and terms: one copy, in Settings > Policies

`[FROM CODE]` (owner decision, 2026-10-25, recorded in `content-pages.ts`; behaviour read from `content-pages.ts`, `pages.$handle.tsx`, `policies.$handle.tsx`)

- **Where to write them:** only in **Settings > Policies** (privacy policy, terms of service). **Recommendation: edit the policies there and do not create Pages for them.** One copy means one text to keep right.
- **Footer links:** "Privacy policy" and "Terms" in the footer's legal row go to `/policies/privacy-policy` and `/policies/terms-of-service`, and appear when Shopify returns that policy (3.1).
- **The page addresses `/pages/privacy-policy` and `/pages/terms`:** when no Shopify page with that handle has content, and the matching Shopify policy exists, these addresses send the visitor on to the policy with a **temporary redirect (302)**, marked `no-store` so no cache keeps it. It is temporary because the answer follows what you edit. Any other handle that does not exist still shows "not found". If the policy does not exist either, the address shows "not found" (or, if an empty page with that handle exists, the "no content yet" page).
- **If you do create a Page with the handle `privacy-policy` or `terms` and give it text:** that page is shown at its own address, and the footer link still goes to the Shopify policy when one exists. You would then have two copies of a legal text. Do not do this; delete or empty the Page. `[FROM CODE]` The footer falls back to the Page only when no Shopify policy exists.
- The cookie banner's "Privacy policy" link `[FROM CODE]` (`ConsentBanner.tsx`, target chosen in `root.tsx` by the same rule as the footer) goes to `/policies/privacy-policy` when that policy exists, to `/pages/privacy-policy` when only a Page with that handle has text, and is not shown when neither exists. Its behaviour is in Admin guide section 13.
- Who writes and approves the text is in sections 5.13 and 5.14. The project writes no legal wording.

### 4.4 Shipping and refund policies versus the pages

Your "Delivery and shipping" and "Warranty and returns" pages are not the same objects as Shopify's shipping policy and refund policy. If you fill in Shopify's shipping and refund policies, they are shown by the storefront at `/policies/shipping-policy` and `/policies/refund-policy`, may be linked from Shopify's checkout (`[ADMIN, NOT SEEN]`), and must **say the same thing** as the Delivery and shipping and the Warranty and returns pages. Decide with your legal adviser which is the master text, and have the other point to it rather than repeat it. The website cannot check that they agree: this is a manual check each time either one changes (section 7).

## 5. The pages, one by one

For each page: the recommended headings (a suggestion; drop what does not apply), what shoppers usually expect to find, and the questions only you can answer. Answers must be your real, current business facts. Do not copy another retailer's text. Use plain words, short sentences, and descriptive link text (not "click here"). Use Heading 2 for the main sections and Heading 3 inside them.

Every page should also end with one clear next step (for example, the contact page link or a link to shop). `[FROM CODE]` Pages show a "Last updated" date automatically (section 2, step 3), so do not type your own date line unless the facts have a date you want to state, such as an effective date for terms.

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

Footer: Customer support (the link appears when the visible page has text, so keep the page hidden until the content is approved). Shoppers expect: who the lender is, how to apply, what is needed, what happens after, and clear statements that terms depend on approval. Recommended headings:

- How financing works
- Who provides it
- How to apply (online or in store)
- What you need to apply
- Terms, rates and fees (as the lender states them)
- Questions about your account or application
- Required disclosures (wording from the lender or your legal adviser)

Questions: Do you offer financing at all? Which provider or providers, and are they US lenders licensed for your states? How does a shopper apply, and where? What are the lender's terms (rates, periods, minimum purchase, fees, eligibility), written or confirmed by the lender in writing? Which legal disclosures must be shown, and what wording does the lender or your legal adviser require? Who answers financing questions? Does the lender provide a link or a widget, and if a widget, is a link to it acceptable instead (embedded widgets are removed from page text)? Do you want any financing message near prices (that is a new feature and a change request)?

### 5.3 Comfort guarantee (`comfort-guarantee`)

Footer: About (the link appears when the visible page has text, so keep the page hidden until approved); the header strip item needs a developer (3.4). Shoppers expect: exactly what is promised, for how long, what they must do, what it costs them, and what happens to the mattress. Recommended headings:

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

Footer: About (the link appears when the visible page has text, so keep the page hidden until approved); the header strip item needs a developer (3.4). Shoppers expect: what price is matched, against whom, in what window, with what proof, and what is excluded. Recommended headings:

- What the price guarantee is
- What we will match
- What qualifies as a competing offer (same item, same condition, who sells it)
- How long after purchase you can ask
- How to ask, and what to send
- What is not included
- Contact

Questions: Do you offer a price guarantee? What exactly is matched or beaten, and by how much? Against which sellers (local, online, authorised dealers only)? For which period before or after the purchase? What proof is required? What is excluded (clearance, financing offers, bundles, gifts, other discounts, outlet or membership prices)? How does a shopper ask, and who decides? How is the refund or credit paid? Can it be combined with other offers? Has your legal adviser approved the wording?

### 5.5 Warranty and returns (`warranty-and-returns`)

Footer: Customer support (the link appears when the visible page has text, so keep the page hidden until approved). Shoppers expect: separate, clear answers for the manufacturer warranty and for returning an item, and what the optional accident protection adds. Recommended headings:

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

**The format that works** `[FROM CODE]` (`extractFaqPairs` in `content-pages-html.ts`, read 2026-10-25). The storefront adds machine-readable FAQ data (schema.org FAQPage, hidden from shoppers) to the page with the handle `faq`, and only when all of this holds:

- Each question is its own **Heading 2 or Heading 3**, and its text **ends with a question mark** (`?`). A question of more than 300 characters is skipped.
- The **very next thing** after the question heading is a **normal paragraph**. A list, table, image or another heading straight after the question means that question is skipped. If the answer is a list, put one sentence before it.
- The answer is **all the text up to the next Heading 2 or Heading 3** (long answers are cut at 5,000 characters). Heading 4 and below do not end an answer. So put the closing "Still have questions?" text under its own Heading 2 that is not a question, or it becomes part of the last answer.
- Headings that are not questions (the topic headings such as "Delivery and setup") are fine; they are skipped and they end the previous answer.
- There must be **at least two** questions that pass. With fewer, no FAQ data is produced at all. At most 50 questions are used, taken from within the first 200 headings of the page.
- A page with no text produces none.

Example of the heading shape (the words are yours, this shows only the structure): Heading 2 "Delivery and setup", Heading 3 "Can I choose my delivery day?" followed by a paragraph that answers it, Heading 3 "What happens if I am out?" followed by a paragraph, and so on.

One question, one answer. The text in the data is taken from the visible page, so the data says what the page says; keep the answer on the page, not behind buttons or tabs the editor creates.

**What is separate:**

- **Collection and product FAQs** use FAQ entries in **Content > Metaobjects > FAQ** (Admin guide 6.3), which have their own separate FAQ code (`storefront/app/lib/shopify/jsonld.ts`; only its existence was checked on 2026-10-25, not what it emits). They do not affect this page.
- **Search results:** the data makes the page eligible to be understood as questions and answers. It does **not** mean a search engine will show anything special. Search engines decide that themselves and limit which sites get any FAQ display. Do not promise the client a search-result display. `[ADMIN, NOT SEEN]` (general knowledge, not checked against current search-engine documentation)

### 5.7 About (`about`)

Footer: About ("About us"). Shoppers expect: who you are, how long you have been trading, where, what you stand for, and how to reach a person. Recommended headings:

- Who we are
- What we sell and the brands we carry
- Our stores (link to the store finder, which has its own page)
- How we help you choose (link to the sleep quiz, guides)
- Contact

Questions: What is the business's story, in your words? When did it start and who owns it? Which brands do you carry (only those you may name)? How many stores and where (the store finder gets this from the store entries, so do not retype addresses and hours here)? What awards, memberships or certifications can you document? Which photos and people may be shown, and do you have permission? Which claims can you prove?

### 5.8 Contact (`contact`)

Footer: Customer support, the top bar and phone menu ("Contact us") and the quick-links row ("Get in touch"); all appear when the page has text. Shoppers expect: every way to reach you, with hours, and what to have ready. Recommended headings:

- Call us
- Email us
- Visit a store (link to the store finder)
- Hours for phone and email
- What to have ready (order number, email)
- Order questions (link to order tracking)

Questions: What phone number, with which hours? (The site header shows a phone number only when a valid US number is set, either in the Site settings entry (Admin guide 6.4) or by the developer in the website's settings, which wins if both are set `[FROM CODE]`; the page text should match.) What email address, and how fast do you answer? Which departments exist (sales, delivery, claims)? Is there a mailing address you want shown? Is chat offered now, and with which provider? (Today no "Chat with us" button is shown anywhere, because no provider is configured, `[FROM CODE]`; see 3.4.) A contact form cannot be put in the page body (section 2, step 4); if you want one, it is a change request.

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

Footer: legal row (the link goes to the Shopify policy, section 4.3); the cookie banner links to it. Edit in **Settings > Policies**. Your legal adviser writes or approves it. Shoppers expect: what you collect, why, who receives it, how long you keep it, how to see or delete it, and how to opt out. Recommended headings:

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

Footer: legal row. Shoppers, including people using assistive technology, expect: your commitment, which standard you aim for, how to get help, and a person to contact. The project is built to aim at WCAG 2.2 level AA, which the client has not yet formally approved (requirement NFR-003). **Do not claim that the site conforms to a standard until QA has tested it and the owner agrees the wording.** Recommended headings:

- Our commitment
- The standard we aim for
- What is known not to work yet (only once testing has found items)
- How to get help or report a problem (phone, email, a named role)
- Date of last review

Questions: What commitment statement do you want, and has your legal adviser approved it? Which standard and level will you name, and what has been tested (ask QA, and ask the developer for the latest test evidence)? Who receives accessibility reports, how quickly do you answer, and what alternative do you offer (phone orders, store visit)? Is there a feedback form or email address you will monitor? When will the page be reviewed again?

## 6. SEO fields to fill for each page

`[ADMIN, NOT SEEN]` In **Edit website SEO** on each page, fill in:

- **Page title** (about 50 to 60 characters): the page's subject first; the storefront adds the shop name after a bar ("Title | store name"). Unique on every page.
- **Meta description** (about 150 to 160 characters): one plain sentence on what the page tells the shopper, in your own words, with no promises that the page does not make.
- **URL handle:** exactly as in section 1.

What the storefront does with them `[FROM CODE]` (`content-pages-seo.ts`, `content-pages-view.ts`, `pages.$handle.tsx`, read 2026-10-25). The SEO fields are used:

- **Title:** the SEO title if you filled one, otherwise the page title (and, if that is empty, the registry's title). Tags are stripped, spaces tidied, and it is cut at **120 characters**.
- **Description:** the SEO description if you filled one (cut at **300 characters**); otherwise the storefront uses the **first 160 characters of the visible text of the page**. So an empty description field never leaves the page without one, but a description you write will read better than a cut-off first paragraph. Search engines usually show about 160 characters; a longer text may be shortened by them.
- **Search engines:** a page with text asks to be listed (`index,follow`). A page with no text asks **not** to be listed (`noindex,follow`), so a blank page cannot enter results.
- **Address and sharing:** the page declares its own address (canonical) and carries sharing tags (title, description, site name). The canonical address and the `og:url` tag are built from the website's configured public address (`PUBLIC_SITE_URL`, set by the developer at deployment); **if that is not set on the live site, the page has neither tag** (it is not guessed from the request outside development). `confirm with developer` that it is set at go-live.
- **Also added, not typed by you:** a breadcrumb (Home, then the page) in machine-readable form, and the FAQ data for the FAQ page (5.6a).

**Policies** (privacy, terms and the others) have no separate SEO fields in the code: the title is the policy's title and the description is the first 160 characters of its text.

Do not put the same title or description on two pages. Do not stuff keywords. Do not claim a guarantee, price, rate or period in a description unless the page states it and the client approved it.

## 7. Before publishing: checklist

For each page, a named person ticks every line.

- [ ] The facts come from the client's business, not from another site or from this document. No sample numbers remain.
- [ ] Legal, warranty, financing, guarantee, return and privacy text is approved in writing by the person you named (and your legal adviser where needed). Approval status per page is recorded (CLR-016).
- [ ] The handle is exactly as in section 1 (or section 4.2 for policies). Privacy and terms are written in Settings > Policies only, with no duplicate Page (4.3).
- [ ] Title is clear; there is no Heading 1 in the content; headings go in order (2, then 3).
- [ ] Every image has alt text; there are no embedded frames, forms or widgets (they would be removed).
- [ ] Links work: each starts with `https://`, `mailto:` or `tel:`, or is a site path starting `/`; link text says where it goes.
- [ ] Phone, email, hours and addresses match the store settings and the store entries.
- [ ] Shopify's shipping and refund policies agree with the Delivery and shipping and the Warranty and returns pages, and with checkout (section 4.4).
- [ ] SEO title and description are filled and unique. For the FAQ page: each question is a Heading 2 or 3 ending in "?" and followed directly by a paragraph, and there are at least two (5.6a).
- [ ] The page is read once on a phone-size screen, and by someone who did not write it.
- [ ] Visibility is set to visible only when everything above is done (the footer link appears by itself once the page is visible and has text, so a visible draft goes live, 3.2).
- [ ] After the Admin guide 10.2 delay (see 3.5), `/pages/<handle>` loads on the website and the footer link has appeared.
- [ ] If the page makes a promise (guarantee, delivery), ask the developer about the matching header strip item (3.4); it does not appear by itself.

### How to preview

`[ADMIN, NOT SEEN]` Shopify's own "View page" button opens the Shopify-hosted online store, not this website, and a hidden page is not returned to the storefront. A real preview therefore needs one of these, to be agreed with the developer: (a) write the text in a shared document and have it approved before pasting it in; (b) make the page visible on a development store connected to a staging copy of the site and read it there; (c) as a last resort, make it visible on the live store and read it at its address before linking it (note that visible pages join the sitemap). Option (b) is recommended. None of these has been tried. `confirm with developer`

## 8. Blog: listing and articles

**The journal handle.** `[FROM CODE]` The sleep journal is the blog whose handle is **`journal`** (constant `JOURNAL_BLOG_HANDLE` in `content-pages.ts`). Create or open it in `[ADMIN, NOT SEEN]` **Online Store > Blog posts > Manage blogs**, where the blog's handle is set under the same "Search engine listing" block. The links "Sleep journal" in the footer (Sleep guide) and in the Guides menu (Help choosing) appear **only when a blog with that handle exists and has at least one article**. A blog with no articles gets no link, so a shopper is never sent to an empty listing. Blog text goes through the same clean-up as pages (section 2, step 4). Every blog is also reachable at `/blogs/<handle>` and listed at `/blogs`, whether or not it is linked. The handle `journal` is written in three places in the code (the constant, the existence read in `content-pages-data.ts` and the fixed menu in `navigation.ts`); a different handle is a developer change to all three.

**The listing** `[FROM CODE]` (`blogs.$blogHandle._index.tsx`, `ArticleList.tsx`): shows **12 articles per page**, newest publish date first. Each card has the image (if any), the title, the date and the author ("October 5, 2026 · Name"), and the excerpt (cut at 200 characters). **Load more** is a real link that adds the next 12 (it also works without JavaScript); A "Load previous" link is also built in for a visitor who arrives part-way down; whether it shows only then was not checked. A web address with a damaged or unrecognised paging value shows the first page instead. With no articles it says "No articles yet." The listing's title and description come from the blog's own SEO fields (Shopify's blog "Search engine listing"), and every page of the listing declares the plain blog address as its canonical address.

For each article:

| Field in Shopify | What to put | What the storefront does with it (`[FROM CODE]`, read 2026-10-25) |
|---|---|---|
| Title | A clear, specific title | Main heading, listing title, and tab title ("Title | store name") unless an SEO title is set |
| Content | Body text with Heading 2 and 3, short paragraphs, lists | Shown after the same filter as pages. It is not given an "On this page" list |
| Author | The real person's name, or the team name you want shown | Shown as "By Name" next to the date on the article, and next to the date in the listing. If none is set, no author is shown. Also in the Article data (below) |
| Publish date | The real date; leave as it is unless you are scheduling | Shown as "Month day, year" (for example October 5, 2026) in the listing and on the article. The date is formatted in UTC so every visitor sees the same day; an article published late in the evening in the US may therefore show the next calendar day. Order in the listing follows this date |
| Featured image | An image you have the right to use | Top of the article and in the listing (3:2 crop). Also the sharing image |
| Image alt text | One sentence saying what is in the image | Used as the article image's description. In the listing the image is treated as decoration (the title carries the link), so alt text is not read there |
| Excerpt (summary) | One or two sentences | **Used**: shown on the listing card (cut at 200 characters), and used as the description when no SEO description is set |
| Tags | A few topic words | **Used**: shown as a list of tags under the article, and in the sharing and Article data. At most 10 per article; each is cut at 40 characters, duplicates removed |
| SEO title and description | As in section 6 | **Used**: the SEO title is the tab and sharing title; the description is the SEO description, else the excerpt, else the first 160 characters of the article text |
| URL handle | Short, lower-case, words separated by hyphens | Forms `/blogs/journal/<handle>` |

**What an article page also gets** `[FROM CODE]`: sharing tags for social sites (Open Graph and Twitter: type article, title, description, image, publish time, the blog name as the section, and the tags), a canonical address (needs `PUBLIC_SITE_URL`, 6), machine-readable **Article** data (headline, publish date, description, image, author, keywords and address; it is left out when the publish date or title is missing; **no publisher and no "modified" date are claimed**, because the data for them does not exist yet, REQ-SEO-001), a machine-readable breadcrumb, and **Newer / older** links under the article. These links come from the **100 newest** articles of the blog; an article further back than that has no such links, which is deliberate. Link order: the older article is on the left with an arrow, the newer on the right. There is no related-articles block and no share buttons; if wanted, they are change requests (CR process, `plans/BACKLOG.md`). Published articles are in the sitemap (the sitemap route covers the type articles).

Before publishing an article use the section 7 checklist, plus: no health claims, no medical advice, and no product claim you cannot support from the manufacturer's information.

## 9. Open items for the developer (confirm, then update this document)

Items that were open in draft 1 and are now settled in the code: the registry file exists and the 15 handles come from it; links appear only for pages that exist (3.1); privacy and terms are one copy in Settings > Policies (4.3); SEO title and description are used (6); the FAQ page produces FAQ data when its structure allows (5.6a); the Guides heading is plain text; the journal link depends on the blog having articles (8). What is really open:

1. **Verify everything on a development store.** Nothing here has been seen running. In particular check: a page with only `&nbsp;`, an image-only page and an empty page each behave as in 3.1; `/pages/privacy-policy` and `/pages/terms` redirect (302) to the policy when only the policy exists, and are not redirected when a page with text has that handle; the FAQ example in 5.6a produces FAQ data (QA can view the page source); the journal link appears only once the blog has an article; the "Load more" link; replace the `[ADMIN, NOT SEEN]` marks, including the visibility, preview and URL-handle steps and the Settings > Policies layout. Owner: developer or QA.
2. **Empty policy.** The footer link for privacy and terms depends on Shopify returning the policy, not on its text (3.1). Confirm on a development store whether an empty policy box is returned; if it is, an empty policy gets a footer link to a "no content yet" page. Owner: developer.
3. **Three switches still in code** (3.4): the two order-tracking footer links (after the lookup is verified and SD-05 is acknowledged, then `tests/unit/pages/shell-content.test.ts` changes too, per `docs/integrations/GUEST_TRACKING.md`); the three header-strip items (after the client's wording and pages exist); "Chat with us" (now a setting, `PUBLIC_CHAT_PROVIDER`, but it needs a provider the client has chosen and a developer to add and verify its adapter, Q-011, P7-03; `docs/integrations/CHAT.md`). Owner: developer, on the client's instruction.
4. **Public site address.** Canonical and sharing address tags and the sitemap need `PUBLIC_SITE_URL` on the live site (6). Confirm it is set at deployment (`docs/deployment/DEPLOYMENT.md`). Owner: devops.
5. **Cache delay not measured** (3.5, Admin guide 10.2). The footer read and each page read expire separately; whether a "not found" for an address opened before the page existed is kept is unknown. Owner: developer, on a development store.
6. **Journal handle** is a constant plus two literals (8); if the client's blog has another handle, one developer change to all three. Owner: developer.
7. **A Shopify menu is not checked** (3.1). If the client switches one on (Admin guide 6.6), a link to a page that does not exist shows "not found". The client's own check after saving the menu is the only protection. Owner: client, with developer on request.
8. **Printing.** `[FROM CODE]` Printing a page or article hides the breadcrumb, the "On this page" list and the newer/older links only. The site header, footer and any other element still print; a print stylesheet for the whole site is not part of this work. If that matters, it is a change request.
9. **No list of missing pages.** The code does not report which of the 15 pages are missing (3.3). Say so if the client wants one.
10. **Other documents may still describe the old behaviour** (for example the design and verification notes that say the quick links and "Chat with us" are hidden or lead to the contact page). Those are outside this document.

## 10. Code read for this draft (2026-10-25)

All under `storefront/app/`: `lib/pages/content-pages.ts`, `content-pages-html.ts`, `content-pages-seo.ts`, `content-pages-view.ts`, `content-pages-blog.ts`, `content-pages-article.ts`; `lib/shopify/content-pages-data.ts`, `sanitize-html.ts`, `cache.ts`; `lib/navigation.ts`; `lib/seo/canonical.ts`, `sitemap.ts`; `lib/site-origin.ts`; `root.tsx`; `routes/pages.$handle.tsx`, `policies.$handle.tsx`, `policies._index.tsx`, `blogs._index.tsx`, `blogs.$blogHandle._index.tsx`, `blogs.$blogHandle.$articleHandle.tsx`, `track-order.tsx`; `components/pages/ContentArticle.tsx`, `ArticleList.tsx`; `components/layout/UtilityBar.tsx`, `MobileNav.tsx`, `SiteFooter.tsx` (link wiring only). No test was run and nothing was opened in a browser. This document is the Draft 2 of 2026-10-25 and states what it does not cover in section 0.
