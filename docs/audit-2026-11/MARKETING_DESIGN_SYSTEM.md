# Marketing design system (as built) - 2026-11-12

This documents what exists today in `marketing/`, read from `app/globals.css`, `app/pmv.css`, `app/motion.css`,
`app/layout.tsx`, `lib/site.ts` and `lib/nav.ts`.

A premium redesign is in progress on branch `claude/marketing-premium-pass`. It is NOT described here. When
that branch merges, this document must be rewritten from the merged files.

## 1. Brand rules (owner)

- Signal yellow on asphalt. Yellow is a FILL behind dark text only; never yellow text on white.
- Real photographs supplied by the owner; product screens are drawn in HTML and tagged "Sample data".
- No real asset codes, serials or site names. No testimonials, customer logos or certifications.
- Copy: benefit first, specific headlines, no em dashes, no fabricated claims.

## 2. Colour tokens (`app/globals.css` `:root`)

| Token | Value | Use |
|---|---|---|
| `--bg`, `--surface` | `#ffffff` | Page and card surface |
| `--surface-2` | `#f4f4f1` | Alternate band |
| `--ink` | `#161616` | Text, dark buttons |
| `--muted` | `#56564f` | Secondary text |
| `--line` | `#e3e3dd` | Borders |
| `--brand`, `--brand-strong` | `#ffc629` | Primary action fill, highlights |
| `--brand-ink` | `#8a5a00` | Readable accent on white |
| `--brand-2` | `#e0a800` | Darker yellow |
| `--deep` / `--navy` | `#161616` | Dark bands (alias kept from an older palette) |
| `--success` / `--warning` / `--danger` / `--info` | `#1f8a4c` / `#b86e00` / `#c8312f` / `#2459c7` | Status only |
| `--shadow` | `0 20px 50px rgba(22,22,22,.14)` | Raised panels |
| `--radius` | `10px` | Default radius |

Dark surfaces used directly in `pmv.css`: top bar `#161616`, dark band `#1c1c1c`, primary hover `#ffd24f`,
dark button hover `#2b2b2b`.

Chart palette (`app/motion.css`): `--v-ink #1c1c1a`, `--v-ink2 #4a4a44`, `--v-ink3 #8a877c`, `--v-ink4 #d6d3c8`,
`--v-good #1f7a4d`, `--v-warn #b7791f`, `--v-bad #b42318`, `--v-track #efede5`. Rule: ink greys carry data,
brand yellow marks only the key value, green / amber / red mean status only.

Known leftovers (audit): a few legacy rules in `globals.css` still carry greenish greys from the retired
palette (for example nav link and footer link colours); `pmv.css` and `motion.css` override them where used.

## 3. Layout tokens

| Token | Value |
|---|---|
| `--shell-max` | `1440px` (`1680px` from 2200 px wide) |
| `--gutter` | `clamp(16px, 4vw, 64px)` |
| `.site-shell` | `min(var(--shell-max), 100% - 2 * var(--gutter))`, centred |
| `.section` / `.section-tight` | `78px 0` / `64px 0` |
| `.dark-band` | `56px 0 64px` |
| Hero spacing | `--hero-pad-top`, `--hero-pad-bottom`, `--hero-gap`, `--hero-cta-space` (sized by width, capped by height) |
| z-index | `--z-header: 50`, `--z-float: 60` |

Breakpoints in use (max-width): 1180, 1080, 900, 860, 760, 720, 640, 560, 480 px. There is no single
breakpoint scale; 560 and 1080 are the most used.

## 4. Typography

- Display: Archivo (weights 700, 800), variable `--font-display`.
- Body: Inter, variable `--font-body`.
- Arabic page: IBM Plex Sans Arabic (400, 700), variable `--font-arabic`; `.ar-page` swaps both variables.
- All self-hosted through `next/font`, `display: swap`.

| Class | Size | Notes |
|---|---|---|
| `.hero-h1` | `clamp(2.5rem, 5.4vw, 4.3rem)` | weight 800, tracking -0.035em, line-height 0.98 |
| `.page-h1` | `clamp(2.1rem, 4.2vw, 3.3rem)` | line-height 1.02 |
| `.display` (legacy) | `clamp(2.1rem, 4.4vw, 3.75rem)` | phones `clamp(1.95rem, 8.4vw, 2.75rem)` |
| `.sec-h` | `clamp(1.6rem, 2.8vw, 2.25rem)` | 48 x 4 px yellow bar under the heading |
| `.h2` / `.h3` | `clamp(1.55rem, 2.5vw, 2.35rem)` / `1.05rem` | |
| `.hero-lead` | `clamp(1.05rem, 1.5vw, 1.28rem)` | max 34ch |
| `.page-lead` / `.lead` | `1.08rem` / `clamp(1rem, 1.25vw, 1.1rem)` | max 60ch / 580px |
| `.kicker` | `.92rem`, weight 700 | |
| `.eyebrow` | `.78rem`, uppercase, tracking 0.08em | |
| `.muted-sm` / `.muted-xs` | `.78rem` / `.7rem` | |
| body | line-height 1.6 | |

Audit observation: the scale jumps from the hero size to 14 to 15 px body with 13 px card copy, and section
headings share one size.

## 5. Components

Files under `marketing/components/`:

| Component | Role |
|---|---|
| `Header`, `Footer` | Read one menu definition (`MENU_GROUPS` in `lib/nav.ts`); `locale="ar"` supported |
| `Logo`, `StoreBadges` | Brand mark, store badge |
| `HeroCarousel` | 5 rotating slides, slide picker with a yellow timing bar; class prefix `hc-` |
| `PageTop` | Inner page banner with optional photo; places the `#details` anchor |
| `PageFrame`, `SectionTitle` | Page wrapper, section heading |
| `ProofStrip` | Proof figures (one source) |
| `Tabs` | Module tabs with optional autoplay |
| `TourBand` + `motion/walkthrough/*` | Product walkthroughs (inspection, tyre intelligence, workshop, accident, maintenance, cost) and a chart kit (`charts.tsx`) |
| `RolesShowcase` | Web + phone view per role |
| `mock/Screens` | HTML product screens over sample data |
| `art/Photos`, `art/FleetVehicles` | Photographs and vehicle art |
| `CTA`, `CtaBand` | Call-to-action blocks; band has slow hazard stripes |
| `AssistantWidget`, `AnumAvatar` | Scripted guide (not AI) |
| `WhatsAppButton`, `MobileActionBar` | Floating contact button, phone bottom bar |
| `LocaleSync`, `A11yStyles` | `lang` per path, accessibility styles |
| `motion/MotionRoot`, `CountUp`, `Spotlight`, `HeroLive`, `InspectionDemo` | Motion layer |

Buttons (`.btn`): min-height 48 px, radius 6 px (`pmv.css` overrides the 14 px legacy value), weight 750.
Variants: `.btn-primary` (yellow fill, ink text), `.btn-dark` (ink fill, white text), `.btn-secondary`
(light, bordered), `.btn-text` (inline link style). Hero and page-top primaries are 52 px high.

Focus: 3 px ink outline with a 5 px yellow ring on light surfaces; yellow outline on dark surfaces.

Cards: bento cells (radius 14 px, `#fafaf8`, 1 px line), price cards, module grid cells, flow cards. The
audit noted these use different radius, border and padding values; there is no single card primitive.

## 6. Navigation and links (`lib/nav.ts`, `lib/site.ts`)

- One page map: `PLATFORM_PAGES` (5), `SOLUTION_PAGES` (5), `RESOURCE_PAGES` (2), `TOURS_LINK`.
  `MENU_GROUPS` is the single menu order for header and footer.
- `menuHref()` appends `#details` so a menu click lands where the module detail starts.
- `SITE_URL` (canonical origin) and `APP_URL` (login and legal links) each come from one env var with a
  default. `LEGAL_LINKS` point at the app host. `WHATSAPP_NUMBER` and `CONTACT_EMAIL` are defined once.
- Note: the comment above `APP_URL` contradicts its default value (see WEB-2).

## 7. Motion rules (`app/motion.css`)

1. Only transform and opacity animate (plus clip-path on two reveals).
2. Every hidden state sits under a class JavaScript adds (`.rv`, `.rv-group`), so the page is fully visible
   with scripts off.
3. One easing family: `--ease-out cubic-bezier(.16,1,.3,1)` for entrances, `--ease-spring
   cubic-bezier(.34,1.56,.64,1)` for presses, `--ease-swift cubic-bezier(.32,.72,0,1)` for wipes.
4. `--rise: 22px` is the reveal distance; reveals run 0.7 to 0.8 s with a per-child `--rv-delay`.
5. One reveal engine: `MotionRoot` (one IntersectionObserver). No scroll listeners. A second CSS
   view-timeline reveal was removed to avoid double animation.
6. Endless loops (marquee, CTA stripes, live dot) run only while on screen (`.in-view`).
7. Below-the-fold sections on hero pages use `content-visibility: auto`; print forces them visible.
8. `prefers-reduced-motion: reduce` turns all animation and transition off, stops the carousel and
   walkthroughs on step 1, and removes hover transforms. Print shows all reveal content.
9. No pause button on the hero carousel (owner instruction). It holds on hover, focus and a hidden tab.
   The audit flags this against WCAG 2.2.2 (WEB-3).

## 8. Gaps recorded by the audit (inputs for the redesign, not yet done here)

- No fixed type scale; no single card primitive; no status badge for released / on request / planned.
- No scrollable mobile menu sheet (WEB-1); no footer-aware floating dock (WEB-7).
- Form fields lack required and visible error states (WEB-13).
- `dir` is set on a wrapper for Arabic, not on `<html>` (WEB-12).
