# Tyre Pulse marketing design system

What is implemented in `marketing/` after the premium pass (November 2026). The
source of truth is the code: tokens and components in `app/premium.css`,
product recreations in `components/product/`, shared components in
`components/ui/`. When this file and the code disagree, fix this file.

## 1. Brand rules that do not change

| Rule | Detail |
| --- | --- |
| Signal yellow `#FFC629` | A FILL behind dark text only. Never yellow text on white. |
| Asphalt `#161616` | Header, footer, dark sections, dark card. |
| Readable accent on white | `--brand-ink #8a5a00` for small labels and icons. |
| Type | Archivo 800 for display, Inter for body, both through `next/font`. Arabic: IBM Plex Sans Arabic 400 and 700. |
| Photos | Owner-supplied photos in `public/photos` only. No stock, no third-party logos. One use per page. |
| Product screens | Built in HTML and CSS from invented sample data, each tagged "Sample data". Never a screenshot of the live app. |
| Copy | Benefit first, specific headlines, verb plus outcome on buttons, no em or en dashes, no invented claims, customers, prices or certifications. |

## 2. Tokens (`:root` in `app/premium.css`)

### Colour

| Token | Value | Use |
| --- | --- | --- |
| `--brand` | `#ffc629` | Primary button fill, selected state, one highlight per section |
| `--ink` | `#161616` | Text, dark surfaces |
| `--ink-2` / `--ink-3` | `#33332e` / `#4a4a44` | Leads, secondary text |
| `--muted` | `#56564f` | Card body text |
| `--line` | `#e3e3dd` | Hairline borders |
| `--surface-soft` | `#fafaf8` | Soft section band |
| `--surface-dark` | `#1c1c1c` (sections render `#181818`) | Dark section and dark card |
| `--on-dark` / `--on-dark-2` | `#f4f4f0` / `#c9c9c2` | Text on dark |
| Status | green `#14592f` on `#e3f4e9`, amber `#5c3d00` on `#fff1c2`, red `#8f1f1c` on `#fde3e2` | Status only, never decoration |

### Type scale

Desktop 56 / 36 / 24 / 17, stepping down fluidly to 36 / 26 / 19 / 16 on phones.

| Token | Value | Applied to |
| --- | --- | --- |
| `--fs-display` | `clamp(2.25rem, 1.35rem + 4vw, 3.5rem)` | `.hero-h1`, `.page-h1` (one per page) |
| `--fs-h2` | `clamp(1.625rem, 1.2rem + 1.8vw, 2.25rem)` | `.sec-h`, proof and CTA headings |
| `--fs-h3` | `clamp(1.1875rem, 1.08rem + .5vw, 1.5rem)` | Card titles, feature rows, story steps |
| `--fs-body` | `1rem`, `1.0625rem` from 900px | `body` |
| `--fs-lead` | `clamp(1.0625rem, 1rem + .35vw, 1.25rem)` | `.hero-lead`, `.page-lead`, `.tp-lead` |
| `--fs-small` | `.875rem` | Notes, legends, labels |

Line heights: display 1.02, headings 1.12, body 1.6. Arabic headings use 1.25 to 1.3 and no negative tracking.

### Spacing

| Token | Value | Use |
| --- | --- | --- |
| `--space-section` | `clamp(56px, 7vw, 96px)` | Top and bottom padding of every section |
| `--space-section-tight` | `clamp(36px, 4.5vw, 64px)` | Sections that follow the page top, proof strip |
| `--space-head` | `clamp(22px, 2.6vw, 36px)` | Gap between a section heading and its content |
| `--space-grid` | `clamp(14px, 1.6vw, 24px)` | Gap between cards |
| `--space-card` | `clamp(20px, 2vw, 28px)` | Card padding |
| `--gutter` | `clamp(16px, 4vw, 64px)` | Page side gutter (`.site-shell`, max 1440px) |

### Shape and elevation

`--radius-card: 12px`, `--radius-control: 8px`, `--shadow-card`, `--shadow-card-hover`.
Legacy surfaces (`.card`, `.price-card`, `.panel`, photo frames) take the same radius.

## 3. Components

### Card (`components/ui/Card.tsx`)

One card, three variants. Props: `variant`, `icon`, `photo`, `title`, `text`, `status`, `note`, `href`, `linkLabel`, `linkAria`, `titleAs`, `className`.

| Variant | Class | Use |
| --- | --- | --- |
| plain | `.tp-card--plain` | Default. White, hairline border, soft shadow. |
| dark | `.tp-card--dark` | Asphalt surface. At most one per grid. |
| photo | `.tp-card--photo` | A real photo on top (16:9), the same body below. Text never sits on the photo. |

A card with a link is clickable as a whole (the link's `::after` covers the card), lifts 3px on hover and shows a focus ring on the whole card. `.is-wide` spans two columns from 1081px.

`CardGrid cols={2|3|4}` gives `.tp-grid`: 4 or 3 columns on desktop, 2 from 1080px, 1 from 640px. `.tp-grid--compact` keeps two columns on phones and hides the card text (used for the home "areas" menu).

### Status badge (`components/ui/StatusBadge.tsx`)

`<StatusBadge status="available | on-request | planned" />`, plus `<StatusLegend />` under any list that uses it.

| Status | Meaning | Look |
| --- | --- | --- |
| Available | In the product today | Green tint, solid dot |
| On request | Set up per customer: integrations, single sign-on, support terms, TPMS feed, RFID | Yellow tint, solid dot |
| Planned | Not released (iOS app) | White, dashed border, hollow dot |

When unsure, use On request. A Planned item never sits beside a download or sign-up link.

### Section, heading, lists (`components/ui/Section.tsx`)

- `Section` : `tone="plain | soft | dark"`, `tight`. Renders the `h2.sec-h` (with the 48px yellow rule) and an optional lead.
- `FaqList` : the question and answer list used on every page with FAQs.
- `CapabilityList` : rows of name, one line, status badge.
- `.tp-feature` : copy on one side, a product screen on the other; `.is-flip` swaps sides.
- `.tp-two` : two equal columns that stack at 900px.
- `.tp-steps`, `.next-steps` : numbered steps.
- `.tp-chips` : short facts under a hero lead.

### Buttons

| Class | Use |
| --- | --- |
| `.btn.btn-primary` | The one primary action, yellow fill, dark text. "Book a demo" appears at most twice in a page's content (top and closing band). |
| `.btn.btn-dark` | The action on the yellow CTA band; WhatsApp. |
| `.btn.btn-secondary` | White with a border, for second choices. |
| `.btn-text` | Text link with an arrow. |

Minimum height 48px (52px for hero, page top and CTA band). Press feedback 120ms. The primary button has one light sweep on hover.

### Page patterns

- `PageTop` : breadcrumb, `h1`, lead, one button, and either a `photo` or a `visual` (a product screen).
- `CtaBand` : the yellow closing band.
- `ProofStrip` : the four measured figures from `lib/proof.ts`.
- Header : `<header>`, dropdown menus from `lib/nav.ts`, a scrollable mobile sheet that locks the page behind it and keeps Tab inside.
- Footer : menu groups from `lib/nav.ts`, Google Play badge, the iOS "Planned" line from `lib/site.ts`.

### Forms

Required fields carry a red asterisk and "(required)" for screen readers; optional fields say "(optional)". An invalid field gets a 2px red border, a tinted background, an error line under it (`.field-error`, linked with `aria-describedby`) and focus. When the form cannot deliver (5xx, 429 or no network) it offers the same details as a prefilled WhatsApp message and email (`lib/contactFallback.ts`).

## 4. Product recreations (`components/product/`)

| Component | What it is | Interaction |
| --- | --- | --- |
| `ProductScene` | Home hero: the web Command Center with the field app in front | KPI tiles open a 12 week trend that draws in, tabs switch panels, the activity feed ticks and can be paused, layers shift a few pixels with the mouse |
| `WheelBoard` | Tyre board: top view of a 10 tyre mixer | Each wheel is a button; selecting one shows its serial, brand, condition, pressure against the vehicle median and life used |
| `SignOff` | Supervisor sign-off | "Sign and approve" draws the signature and locks the record; "Clear" resets |
| `ProductStory` + `StoryScreens` | Home story: one tyre in seven steps | Pinned stage on desktop, swipe row on phones, stacked list under reduced motion |

Palette inside product screens: ink greys carry data, yellow marks the selected or key value, green, amber and red are status only. Sample data lives in `components/product/data.ts` (MX-214, Riyadh, Brand A to C, invented serials).

## 5. Motion

| Kind | Timing | Notes |
| --- | --- | --- |
| UI feedback (press, hover, tab switch) | 120 to 250ms, ease-out | transform and opacity only |
| Entrances (sections, cards, story screens) | 400 to 700ms | `MotionRoot` is the one reveal engine: IntersectionObserver, no scroll listeners. `CardGrid` opts in with `data-reveal-group`. |
| Chart draws | 700 to 900ms | `stroke-dashoffset` for lines and the signature, `scaleX` for bars, dash sweep for the donut |
| Page transitions | 180ms out, 320ms in | View Transitions API through `components/motion/ViewTransitions.tsx`; the header and the page `h1` keep their own transition names. Falls back to a normal navigation. |
| Story | sticky stage, step chosen by IntersectionObserver | Each step is real text; the numbered rail is real buttons |

Nothing loops without a purpose. The hero feed stops off screen, in a hidden tab and when paused. The wheel pulse runs three times and stops.

`prefers-reduced-motion: reduce`: reveals are not armed, the feed does not tick and has no pause button to need, charts render finished, the story becomes a stacked list with each screen inline, page transitions are skipped.

## 6. Responsive rules

| Width | Behaviour |
| --- | --- |
| 1081px and up | Desktop menu, 3 and 4 column grids, pinned story stage, hero in two columns |
| 901 to 1080px | Mobile menu sheet, 2 column grids, pinned story still on |
| 900px and below | Hero stacks, feature rows stack, story becomes a swipe row |
| 768px and below | Bottom action bar (Book a demo, WhatsApp, guide) replaces the floating dock |
| 640px and below | Card grids go to one column (compact grids to two), proof figures two by two |
| 560px and below | Hero phone frame hidden, header "Book a demo" hidden (the action bar carries it), footer links in two columns |

Touch targets are at least 44px. No horizontal scroll at 360, 390, 768, 1366 or 1920.

## 7. Single sources

| Fact | Lives in |
| --- | --- |
| App host, site origin, WhatsApp number, email, legal links, iOS statement | `lib/site.ts` |
| Menus, page list (`ALL_ROUTES`) | `lib/nav.ts` (checked against the sitemap and `llms.txt` in `test/site-map.test.mjs`) |
| FAQs | `lib/faqs.ts` |
| Proof figures | `lib/proof.ts` |
| Roles | `lib/roles.ts` |
