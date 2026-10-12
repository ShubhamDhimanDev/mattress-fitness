---
name: accessibility-review
description: "Reviews pages and components for accessibility against the approved target (proposed WCAG 2.2 AA) using automated axe checks plus manual keyboard, screen-reader, zoom and reduced-motion passes, and records severity-ranked findings with fixes. Use for any new template or interactive component, at the Phase 7 gate, and before acceptance testing."
---

# Accessibility review

## When to use

A new page template or interactive component is built; Phase 7 (P7-05); a defect report mentions keyboard, focus, contrast or screen readers. Requirements: NFR-003, NFR-001. Target level is pending client approval (Q-012); until approved, apply WCAG 2.2 AA as the working standard.

## Steps

1. **Automated.** Run axe through Playwright (`@axe-core/playwright`) on each template and state (default, error, open drawer or dialog, filtered, empty). Zero serious or critical.
2. **Keyboard.** Complete the whole journey with the keyboard only: skip link, menu and mega menu, search listbox, filters, size selector, gallery, cart drawer, quiz, forms, checkout hand-off. Check order, visible focus (not obscured), no traps, Esc closes overlays and focus returns to the trigger.
3. **Screen reader.** Spot-check with NVDA or VoiceOver: landmarks and headings, link and button names, form labels and errors, `aria-live` for cart, filter and search updates, image alt text from the catalog, state announcements (selected size, sold out).
4. **Visual.** Contrast for text and UI components from the tokens; focus indicator contrast; touch targets at least 44 px; reflow at 320 px width and 400 percent zoom; text spacing; no information by colour alone.
5. **Motion and media.** Honour `prefers-reduced-motion`; no auto-playing media without control; carousels are pausable.
6. **Forms and errors.** Programmatic labels, instructions, error identification and suggestions, autocomplete attributes, accessible names for ZIP and quiz controls.
7. **Rank and record.** For each finding: severity (Blocker, Major, Minor), WCAG criterion, location, how to reproduce, recommended fix. Log in the phase review; accepted exceptions need written approval.

## Outputs

An accessibility report (automated results, manual pass notes, findings), fixes or tasks for each finding, and updated traceability evidence for NFR-003.

## Validation

Axe shows zero serious or critical issues on every template; the keyboard-only journey completes; at least one screen-reader pass is recorded; every Blocker and Major is fixed or has a signed exception; the Accessibility page content (REQ-CNT-001) matches the actual conformance claim and does not overstate it.
