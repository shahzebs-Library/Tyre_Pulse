# Marketing website audit (baseline) - 2026-11-12

Target: `marketing/` (Next.js 16.4.3, React 19.2.7), production build served locally. Read-only.
Status words: see [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

This is the BASELINE audit. A premium redesign is in progress on branch `claude/marketing-premium-pass`.
It is not described or assessed here, so every finding below is recorded as it stood on the audited tree.
Re-run this audit against that branch before closing any item.

Build: clean, 24 static pages, 1 dynamic route. All 15 pages returned 200; `/product` redirects to `/platform`;
an unknown path returns 404 with noindex.

## Routes

15 pages: `/`, `/ar`, `/contact`, `/industries`, `/platform` and 4 module pages, `/pricing`, `/security`,
`/solutions` and 3 solution pages. Non-page routes: `POST /api/contact`, `robots.txt`, `sitemap.xml` (17
URLs), `llms.txt`, `llms-full.txt`, icons.

Every page: unique title and description, self canonical, Open Graph image, valid JSON-LD. Security headers on
every response (HSTS, nosniff, frame deny, referrer policy, a script-agnostic CSP, COOP, permissions policy).
Zero third-party requests.

## Findings

| ID | Sev | Finding | Evidence | Confidence | Status |
|---|---|---|---|---|---|
| WEB-1 | P1 | Mobile menu is 911 px tall inside a sticky bar and cannot scroll; last links unreachable at 360x740 and 390x844 | measured last link bottom 949 px on a 740 px screen | CONFIRMED | OPEN |
| WEB-2 | P1 if the Vercel env var is unset, P3 if set | Login, legal links and `/console` redirect default to `app.tyrepulse.app` while the code comment says that host does not exist | `lib/site.ts`, `.env.example`, `next.config.ts` | PLAUSIBLE | NOT VERIFIED |
| WEB-3 | P2 | Home h1 lives in slide 1 and is hidden after 5 s; no way to pause rotation on touch; tab pattern incomplete | carousel probe | CONFIRMED | OPEN |
| WEB-4 | P2 | Contact fallback builds a WhatsApp link with `?text=` twice | fallback href probe | CONFIRMED | OPEN |
| WEB-5 | P2 | Contact delivery depends on three mail env vars recorded as unset; a 429 offers no fallback | local 503 and 429 runs | CONFIRMED locally | OPEN (production env NOT VERIFIED) |
| WEB-6 | P2 | iOS availability stated three different ways (footer badge, llms files, schema comment) | rendered pages | CONFIRMED | OPEN (owner decides wording) |
| WEB-7 | P2 | Floating assistant + WhatsApp dock covers "Delete your data" in the footer at 1366 px | screenshots | CONFIRMED visually | OPEN |
| WEB-8 | P2 | Mobile home page is 13,326 px tall; worst lab TBT on the site | Lighthouse runs | CONFIRMED | OPEN |
| WEB-9 | P2 | LCP is render-delayed text; 4 render-blocking CSS chunks; `/ar` loads 6 font files | Lighthouse | CONFIRMED (lab) | OPEN |
| WEB-10 | P3 | 27 to 31 prefetch requests per page | request counts | CONFIRMED | OPEN |
| WEB-11 | P3 | Desktop dropdown stays open after focus leaves it | keyboard probe | CONFIRMED | OPEN |
| WEB-12 | P3 | `/ar`: `dir` set on a wrapper, not on `<html>`; Arabic journey ends on English pages | probe + Lighthouse | CONFIRMED | OPEN |
| WEB-13 | P3 | Required fields unmarked; invalid state barely visible | computed style | CONFIRMED (style) | OPEN |
| WEB-14 | P3 | Some tap targets under 44 px (all pass the 24 px minimum) | measurements | CONFIRMED | OPEN |
| WEB-15 | P3 | Walkthrough step labels truncate at 768 px on 9 pages | clipped-text scan | CONFIRMED | OPEN |
| WEB-16 | P3 | Text-only 200% resize overflows and clips on home (browser zoom 200% is clean) | zoom probe | CONFIRMED | OPEN |
| WEB-17 | P3 | SEO small items: 5 very short titles, one 69-char title, og:title mismatch on `/platform`, non-standard robots line, a schema slogan that appears nowhere on the site | crawl | CONFIRMED | OPEN |
| WEB-18 | P3 | 12 photos serve 15 pages; three photos repeat | screenshots | CONFIRMED | OPEN (needs owner photos) |
| WEB-19 | P3 | No `<header>` landmark; one unlabelled `<nav>` on home | landmark scan | CONFIRMED | OPEN |

Related item fixed elsewhere: the contact route now sends `Retry-After` on 429 (commit d5764687, STAGED). Its
per-instance rate limit is API-4 in [API_SECURITY_MATRIX.md](API_SECURITY_MATRIX.md).

Note on WEB-2: the deployment audit recorded `app.tyrepulse.app` as the app project's verified custom domain
(added 2026-10-20). If that holds, the default is right and the stale part is the code comment. Neither DNS
nor the marketing project's env could be checked from the audit host, so the status stays NOT VERIFIED.

## Lab performance (Lighthouse 12.8.2, mobile profile, localhost). Lab only.

| Page | Perf | FCP | LCP | TBT | CLS | Transfer |
|---|---|---|---|---|---|---|
| `/` run 1 | 84 | 1.6 s | 2.6 s | 490 ms | 0 | 578 kB |
| `/` run 2 | 88 | 1.4 s | 3.7 s | 110 ms | 0 | 578 kB |
| `/platform/inspections` | 94 | 1.2 s | 3.0 s | 40 ms | 0 | 487 kB |
| `/solutions/tyre-management` | 93 | 1.2 s | 3.2 s | 40 ms | 0 | 429 kB |
| `/pricing` | 94 | 1.1 s | 2.9 s | 120 ms | 0 | 362 kB |
| `/contact` | 96 | 0.9 s | 2.6 s | 120 ms | 0 | 365 kB |
| `/ar` | 90 | 1.5 s | 3.6 s | 60 ms | 0 | 512 kB |

Accessibility 96 to 97, Best Practices 100, SEO 100 on all. LCP varied 2.6 to 3.7 s between runs on the same
page; 2.5 s is not reliably met. Field Core Web Vitals are NOT VERIFIED.

## Claims review (owner rules: no fabricated claims)

| Claim | Status |
|---|---|
| 1,600+ machines, 89,000+ job cards, 216,000+ expense lines, 3 countries | Backed per project memory; re-check before each release |
| "Live TPMS pressure alerts via telematics" | Owner ruling allows it; project memory records no TPMS readings in use. Suggest wording as an integration |
| RFID passports | No evidence of deployed RFID use; label as optional on home too |
| "Removal forecasts from the tread trend" | Tread depth is not captured; forecasts run on km / hour life. Wording should say so |
| "Administrators sign in with a second factor" | Enrolment is optional; soften to "can require" |
| Single sign-on | 0 identity providers; acceptable as "on request" |
| "SLA and priority support" | No SLA document found; owner to confirm |
| AI findings and recommendations | In structured data only, not on a page |
| "COMING SOON iOS app" | WEB-6 |
| Testimonials, logos, certifications, savings percentages | None found: clean |

Claims were cross-read against project memory only, not against the live database.

## Capability gaps (owner's wanted list versus site)

Missing or thin: a tyre lifecycle module page; AI-assisted analysis (by release state); RCA; warranty; a
reporting and dashboards page; multi-site / country; buses and per-industry pages; data-protection content on
the security page; an About page; a single FAQ page. Legal pages depend on WEB-2.

## Checked and clean

- Horizontal overflow: 0 at 360, 390, 768, 1366 and 1920 px on all 16 routes.
- Console: no errors. No failed requests. 0 broken internal links or anchors.
- Images: alt and dimensions on all; modern formats.
- Colour contrast: 0 failures across 4,142 text nodes by computed style.
- Focus ring visible on every tab stop; skip link first.
- Reduced motion: 0 running animations.
- Assistant widget: focus handling correct; states it is not a live person.
- Contact API: cross-site 403, wrong content type 415, bad JSON 400, oversized body 413, missing fields 400,
  honeypot silent 200, limit 429, GET 405, 503 when unconfigured. No email was sent.

## NOT VERIFIED

- Field Core Web Vitals, real devices, Safari / iOS rendering.
- Production state of the marketing Vercel project: env vars, deployed build, which host serves it.
- External link targets (store listing, WhatsApp, legal pages).
- Contrast of text over photographs (judged by eye).
- Screen-reader output and Arabic copy quality.
- Real email delivery and any Vercel-side rate limiting.
