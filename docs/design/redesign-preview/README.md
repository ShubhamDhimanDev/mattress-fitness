# Redesign preview source (CR-31)

The source of the private preview canvas (https://claude.ai/artifact/3Hx5jbtnEtfQAP2kXbK536) as of 2026-10-27. These are **reference mock-ups, not production code**: they use inline hex values, class names and placeholders so a developer can read the exact layout, sizes, spacing, colours and copy tone. The production build must use the project's tokens and components ([REDESIGN_PLAN](../REDESIGN_PLAN.md), `.claude/rules/ui-implementation.md`), never these hex values.

| File | Shows |
| --- | --- |
| `Main.dc.html` | home page, desktop (1440 px) |
| `Home-Mobile.dc.html` | home page, phone (390 px) |
| `Cart.dc.html` | cart page, desktop, with working size, quantity, protection, add-on, haul-away and code logic (read its script for the intended behaviour and totals) |
| `Cart-Mobile.dc.html` | cart page, phone, with the sticky checkout bar |
| `Cart-Drawer.dc.html` | mini-cart drawer |
| `Style.dc.html` | colours with contrast, type scale, buttons, chips, shape, depth, space, icons |

`IMG-xx` labels are image placeholders; the matching prompts are in [IMAGE_PROMPTS](../IMAGE_PROMPTS.md). Prices and offers in the mock-ups are samples.
