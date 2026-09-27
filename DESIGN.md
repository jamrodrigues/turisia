---
name: turia
description: Tourism-agency operations console — WhatsApp CRM, automated closing, and logistics for Porto de Galinhas agencies
colors:
  petrol: "oklch(0.451 0.047 195.6)"
  petrol-hover: "oklch(0.344 0.036 195.6)"
  petrol-soft: "oklch(0.938 0.007 185.3 / 1)"
  petrol-soft-2: "oklch(0.417 0.043 193.4 / 1)"
  primary-foreground: "oklch(1 0 0)"
  page-ground: "oklch(0.979 0.004 214.3)"
  panel: "oklch(1 0 0)"
  panel-2: "oklch(0.96 0.007 208.8)"
  paper-ink: "oklch(0.276 0.018 220.3)"
  border-line: "oklch(0.918 0.011 211)"
  muted-surface: "oklch(0.96 0.007 208.8)"
  muted-ink: "oklch(0.507 0.023 229.4)"
  header-band: "oklch(0.417 0.043 193.4)"
  header-band-2: "oklch(0.336 0.036 192.8)"
  good: "oklch(0.455 0.073 158.1)"
  good-soft: "oklch(0.945 0.019 162.9)"
  warn: "oklch(0.498 0.092 74.7)"
  warn-soft: "oklch(0.942 0.028 86.6)"
  alert-red: "oklch(0.487 0.128 24.2)"
  alert-red-soft: "oklch(0.931 0.02 13.6)"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  2xl: "18px"
  full: "9999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.petrol}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "{colors.petrol-hover}"
    textColor: "{colors.primary-foreground}"
  button-outline:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.md}"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.md}"
    height: "32px"
  input-field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "4px 10px"
  panel-wrapper:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.md}"
    padding: "16px"
  card-surface:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.md}"
    padding: "16px"
  badge-default:
    backgroundColor: "{colors.petrol-soft}"
    textColor: "{colors.petrol}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-secondary:
    backgroundColor: "{colors.muted-surface}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  nav-item-active:
    backgroundColor: "transparent"
    textColor: "oklch(1 0 0)"
    rounded: "0"
    padding: "12px 15px"
---

# Design System: Turia

## 1. Overview

**Creative North Star: "The Front Desk"**

Turia is what a tourism-agency operator opens between WhatsApp messages: a working
console, dense and scan-first — but one that reads as *familiar* to someone who has
used a travel-agency system before, not as a piece of differentiated software design.
This is a deliberate reversal of the product's original "Control Tower" direction
(2026-09, dark-mode instrument panel with a single violet signal color): the operator
audience explicitly asked, after seeing the market's actual tools, to align with what
agencies already use daily — Tindo, PaxPro, Toursys — rather than stand apart from them.
Familiarity earns adoption here; distinctiveness didn't.

**Key Characteristics:**
- **Light-first** (branco-gelo — a cool, luminous off-white, not a warm cream). This
  supersedes the former dark-mode default; dark mode may remain available as a toggle
  but is no longer the console's home state.
- A colored top header band (deep, desaturated petrol-teal) carries the brand and the
  primary horizontal navigation — replacing the persistent left sidebar. This is the one
  place the accent is allowed as a large fill; everywhere else it stays restrained (text,
  borders, small pill fills, buttons), same discipline as before.
- Flat panels with a *subtle* shadow (not the old zero-shadow rule) — `shadow-sm`-class
  elevation, matching how PaxPro/Toursys-class tools separate cards from the page.
- Dense, scan-first typography — Inter throughout, unchanged from before.
- Filter-bar-above-table is now a named, reused pattern (see §5) — every list surface
  that benefits from narrowing (Reservas, CRM, Agenda) gets one, mirroring the
  "Consultar X" idiom every competitor tool already uses.

## 2. Colors

One saturated accent (**Petrol**), same One Signal discipline as before, just a
different hue family (~195° teal-blue instead of 293° violet) and now also licensed to
appear as the header band's large fill — the one deliberate exception to "accent never
as a large fill," because a colored header band is the market's own convention for "this
is a serious agency tool," and hiding it as thin borders/text only would undercut the
familiarity goal.

### Primary
- **Petrol** (`oklch(0.451 0.047 195.6)`): primary buttons, links, focus rings, active
  tab underline, chart accents, header band base color.
- **Petrol Hover** (`oklch(0.344 0.036 195.6)`): darker step for hover/active states and
  the header band's gradient far edge.
- **Petrol Soft** (`oklch(0.938 0.007 185.3)`): tinted wash for pill/badge backgrounds
  (funnel-stage chips, info status pills, active-tab backgrounds when not on the header
  band itself).

### Neutral
- **Page Ground** (`oklch(0.979 0.004 214.3)`): default page background — branco-gelo,
  a cool off-white. Chosen explicitly over a warm/cream off-white in an A/B the operator
  reviewed directly; keep it cool, not warm.
- **Panel** (`oklch(1 0 0)`) / **Panel 2** (`oklch(0.96 0.007 208.8)`): card/table
  surface (pure white) and its one recessed step (table header rows, hover washes).
  **Never make a "shaded band" inside a white panel the same lightness as Page Ground**
  — that reads as a hole through to the page behind it, not a recessed strip. Panel 2
  must stay visibly darker than Page Ground even though both are pale.
- **Paper Ink** (`oklch(0.276 0.018 220.3)`): primary text.
- **Border Line** (`oklch(0.918 0.011 211)`): the only border color.
- **Muted Surface** (`oklch(0.96 0.007 208.8)`) / **Muted Ink** (`oklch(0.507 0.023
  229.4)`): secondary backgrounds and secondary text. Muted Ink is deliberately darker
  than a first pass shipped with — verify any secondary-text color against Panel at
  **4.5:1 contrast minimum** before shipping; a WCAG audit of the approved mock caught
  three token values that read fine visually but failed AA (labels, warning badges).
- **Header Band** (`oklch(0.417 0.043 193.4)` → `oklch(0.336 0.036 192.8)` gradient):
  the top nav bar's own background — darker/more saturated than the Petrol accent used
  elsewhere, so header text can go white/near-white on top of it.
- **Good** (`oklch(0.455 0.073 158.1)`) / **Good Soft**, **Warn** (`oklch(0.498 0.092
  74.7)`) / **Warn Soft**: status colors, muted/earthy rather than bright — kept
  deliberately less saturated than a typical SaaS green/amber to stay "sophisticated,"
  per the operator's explicit ask.
- **Alert Red** (`oklch(0.487 0.128 24.2)`): destructive actions and error states only.

### Named Rules
**The One Signal Rule (carried over).** Petrol marks the primary action, the active
state, and — as the one new exception — the header band. If a third element competes
for it, demote it.

**The Contrast-Check Rule (new).** Every text/background pairing introduced by this
redesign must be verified at ≥4.5:1 (small text) before shipping, not eyeballed. The
approved mock shipped a first pass of `muted-ink` and status-badge colors that looked
fine on screen but measured 3.2–4.4:1; darkening them was a real fix, not a nitpick —
treat this as a checklist item on every future palette change, not a one-time patch.

**The No-Fake-Data Rule (carried over, unchanged).** A color never implies confidence
the underlying data doesn't have.

## 3. Typography

Unchanged from the prior system: **Inter** end to end (display through label), **Geist
Mono** reserved for short machine-readable strings. The One Family Rule still holds —
this redesign changed color and elevation, not type.

## 4. Elevation

**This reverses the old No-Shadow Rule.** Panels now carry a real, subtle
`box-shadow` (roughly `0 1px 2px rgba(ink,.04), 0 4px 14px rgba(ink,.06)`) in addition
to the 1px border — this is what makes a white card read as "lifted" off the
branco-gelo page the way PaxPro/Toursys-class tools do; a flush border alone
disappeared into the page in the approved mock's first pass (the filter-bar-blends-
with-page-background bug the operator caught directly). Overlays (dialogs, dropdowns,
popovers) get a slightly stronger version of the same shadow, no separate ring idiom
needed anymore.

### Named Rules
**The Shaded-Band Rule.** Any recessed strip living *inside* a white panel (a filter
bar, a table header) must be clearly darker than the page background behind the panel,
never close to it in lightness — see Panel 2 above. This bit the mock once; don't
repeat it.

**The Drag Exception (carried over, unchanged).** Flow-canvas nodes and kanban deal
cards still get a stronger drag-specific shadow.

## 5. Components

### Navigation — top header band (replaces the left sidebar)
The persistent left `Sidebar` is retired. Primary navigation becomes a horizontal tab
row inside the colored header band: brand mark + name on the left, tabs (Hoje, Pacotes,
Reservas, CRM, Logística, Financeiro) in the middle/left-aligned, search + avatar on the
right. Active tab: white text + white underline. Inactive: a dimmed header-band-tinted
text color (verify contrast — see Contrast-Check Rule). This is the single biggest
structural change in this redesign; every page's layout shell changes, not just its
colors.
- **Mobile:** collapse the tab row into a horizontally-scrollable strip (`overflow-x:
  auto`), same idiom as the day-strip below — no hamburger drawer needed at this
  information density.

### Filter bar (new, named pattern)
Any list/table section gets an optional filter bar directly under its panel header:
a row of labeled compact fields (select/text) plus a primary "Filtrar" button, on the
same white Panel background as the rest of the card (never Panel 2 — see Shaded-Band
Rule), separated only by a 1px bottom border. This is the "Consultar X" idiom every
competitor tool (Tindo especially) already trained users on.

### Buttons
- **Shape:** `rounded-md` (8px, down from the old 10px — slightly tighter to read as
  "business tool" rather than "consumer app"), height 32px default.
- **Primary:** Petrol background, white text — **always verify white-on-Petrol
  contrast after any accent hue tweak**; a first pass of this redesign shipped dark
  text on a dark button by mistake and it read as broken/muddy, not just low-contrast.
- Otherwise unchanged from the prior button system (hover/press/outline/ghost/
  destructive behavior).

### Cards / Containers
One idiom now, not two: `rounded-md` (8px), white Panel background, 1px Border Line,
plus the new subtle shadow (see Elevation). The old ring-only overlay idiom merges into
the same shadow treatment.

### Tables
Unchanged in spirit (compact, horizontal rules only, header row distinguished by
Panel-2 background + uppercase Label-size text) — now typically preceded by a Filter
Bar (see above) rather than standing alone.

### Badges / Status Chips
Unchanged shape/behavior; colors move to the new muted-earthy Good/Warn/Alert-red
family (§2), verified at ≥4.5:1 on their soft backgrounds.

### Catalog Card (signature component — unchanged, keep as-is)
Pacotes stays a photo-forward card grid (`repeat(auto-fit, minmax(240px, 1fr))`). This
predates and survives the redesign untouched — it was already the right call and the
market comparison (PaxPro, Tindo, Toursys are all pure tables/forms with zero product
photography) only reinforces it as a genuine differentiator worth keeping, not a
"looks different for its own sake" choice.

### Upcoming-days strip (signature component — unchanged, keep as-is)
Reservas' 14-day horizontal strip carries over exactly as documented before, just
restyled onto the new light/Petrol palette (soft-petrol count pill instead of soft-
violet).

### Automation-status indicator (signature component — MUST reappear, was missing from the mock)
The IA/Fluxo vs. Atendente badge is the product's single most important signature
element (per PRODUCT.md) and was **not** represented in the approved visual-identity
mock, which focused on chrome/nav/color. Any implementation pass must reintroduce it on
every reservas/agenda row — it is not optional just because the mock didn't show it.

## 6. Do's and Don'ts

### Do:
- **Do** reserve Petrol for the primary action, the active state, and the header band —
  nowhere else as a fill (The One Signal Rule).
- **Do** run a real contrast check (not a visual guess) on every new color pairing
  (The Contrast-Check Rule).
- **Do** keep a recessed strip inside a panel clearly darker than the page ground
  behind the panel (The Shaded-Band Rule).
- **Do** keep every number on screen traceable to a live source (PRODUCT.md's "real
  data or nothing," unchanged by this redesign).
- **Do** show automation origin (IA/Fluxo vs. Atendente) wherever a record could have
  been closed either way — reintroduce this in the new nav/table components.
- **Do** keep the catalog-card and upcoming-days-strip signature components; they
  predate this redesign and remain correct.

### Don't:
- **Don't** introduce a second typeface — Inter still carries the whole system.
- **Don't** let a filter bar or table-header band match the page background's
  lightness — that's the one visual bug this redesign already shipped once.
- **Don't** use Petrol as a large fill anywhere except the header band.
- **Don't** ship a status/number that looks confirmed before it actually is.
- **Don't** treat "market-aligned" as license to stop checking contrast or to skip the
  automation-status signature component — those are still non-negotiable per PRODUCT.md.
