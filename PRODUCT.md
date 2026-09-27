# Product

## Register

product

## Users

Tourism-agency staff in Porto de Galinhas, Brazil (piloted with Arretada Turismo): the
owner/admin who configures pacotes, horários, agency profile, payments, and AI/flow
behavior; attendants (vendedores) who work the WhatsApp inbox and step in only when
automation can't close a booking; and logistics staff who build the daily operational
manifest (motoristas, guias, veículos). End customers never open this app — they only
ever interact via WhatsApp, so the UI's real job is making the humans behind the scenes
fast and confident, not selling anyone on the product.

## Product Purpose

Turia is the operations brain of a tourism agency built on top of a WhatsApp CRM base
(forked from wacrm). It exists to let a WhatsApp-only agency stop running on spreadsheets
and manual replies: an AI/Flow-driven pipeline talks to the customer, checks real
availability, books the reservation with a race-safe capacity guard, charges Pix payment,
and sends a voucher — with a human agent only as the last resort when automation can't
confidently close. Success looks like: most bookings close with zero human typing, the
daily manifest tells logistics exactly who goes where in which vehicle, and nothing in
the interface ever makes an admin doubt whether a number (price, vaga, payment status) is
real or stale.

## Brand Personality

Confiável e direto. This is a working tool for people managing other people's money,
bookings, and vacations — every screen should read as competent and unhurried, never
cute or salesy. Calm confidence over cleverness: state the number, state the status, get
out of the way. A restrained, deliberate touch of Porto de Galinhas warmth belongs in
tone and color choices, never in decoration — this must never feel like a beach-themed
skin bolted onto a generic dashboard.

## Anti-references

**Updated 2026-09-27, superseding the original "generic cold SaaS" line below**: the
operator explicitly chose to align the console's chrome/nav/color with the tools
agencies already use daily (Tindo, PaxPro, Toursys) rather than differentiate from
them — familiarity for adoption, deliberately, after seeing those tools directly. A
header band, top tab nav, and dense filter-bar-over-table pattern that read as
"the same kind of tool as what our staff already knows" is now the goal, not an
anti-pattern. See DESIGN.md §1 for the full rationale.

What's still an anti-reference: AI-slop tells that carry no functional job — gradient
text, identical icon-card grids used as decoration, hero-metric templates sized for a
landing page rather than an operational screen. A field label in a dense filter bar
(uppercase, small, e.g. "PERÍODO", "STATUS") is a standard form affordance shared by
every competitor tool in this category and is explicitly **not** what this rule means
by "eyebrow" — the distinction is functional label vs. decorative section marker with
nothing under it.

## Design Principles

- **Real data or nothing.** Every number on screen (price, vaga, payment status,
  occupancy) must be traceable to a live source; the interface never implies confidence
  the data doesn't have. Grounded in the AI/reservation architecture's own rule: never
  invent a price or a slot.
- **Automation-first hierarchy.** Screens should make it obvious what the AI/Flow already
  handled versus what needs a human — the agency's whole reason for existing is minimizing
  the second category, and the UI should never bury that signal.
- **Operators, not customers, are the audience.** Every screen is read by someone doing a
  job under time pressure (closing a sale mid-conversation, building tomorrow's van
  manifest) — optimize for scan-and-act, not for persuasion or delight-for-its-own-sake.
- **One agency's tool, not a demo.** Placeholder/fake data (CNPJ, Pix keys, driver names)
  never ships into a real account's records — verified live over placeholder confidence
  throughout this project's build history, and the same discipline applies to design work.
- **Composable within the existing system.** New surfaces reuse the established OKLCH
  token infrastructure and shadcn component patterns in `globals.css` — the 2026-09-27
  redesign changes *which* tokens (new Petrol accent, light-mode default, header-band
  fill, subtle shadow) but stays inside the same token/theming mechanism rather than
  bolting on a second one; see DESIGN.md for current values.

## Accessibility & Inclusion

WCAG AA. No specific user accommodations known beyond that; keep contrast, keyboard
navigation, and focus states solid by default across both the light (default, since
2026-09-27) and dark modes and all accent themes. Verify contrast numerically
(≥4.5:1 for small text) on any new color pairing — don't rely on eyeballing; see
DESIGN.md's Contrast-Check Rule.
