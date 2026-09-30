---
name: visual-regression
description: Before/after screenshot comparison for Tyre Pulse web surfaces (Vite app, System Console, marketing site) at fixed viewports, to prove a UI change fixed what it claimed and broke nothing else. Use before and after any frontend change, "fix responsive", "compare before and after", "did this break the layout".
---

# Visual regression

Never declare UI fixed because it compiles. Render it, capture it, compare it.

## Environment
- Chromium is preinstalled: launch Playwright with `executablePath: '/opt/pw-browsers/chromium'`.
  Never run `playwright install`.
- Serve a production build, not dev: marketing `npm --prefix marketing run build && npx next start -p 3999`
  (from `marketing/`); app `npx vite build && npx vite preview --port 4173`.
- **Stale-server trap**: rebuilding while `next start` runs leaves the old server serving HTML that points at
  CSS chunks that no longer exist -> unstyled page, huge "overflow". Kill the server (`ps -eo pid,cmd | awk '/next-server/'`,
  then `kill <pid>`; never `pkill -f` from the same shell - it kills itself) and restart before measuring.
- The app needs a signed-in session for most pages; use a test account's storage state, never a real user's.
- Put screenshots in the session scratchpad, never in the repo.

## Viewports (width x height)
1920x1080, 1600x900, 1440x900, 1366x768, 1280x720, 1024x768, 768x1024, 430x932, 390x844, 375x812
(add 320x568 for the smallest phones). Use the same list before and after.

## Procedure
1. **Baseline** (before editing): for each target page and viewport save `before_<page>_<w>x<h>.png`
   (full page) plus a JSON of metrics: `scrollWidth - innerWidth`, `document.documentElement.scrollHeight`,
   h1 line count, elements whose right edge exceeds the viewport, console errors, failed requests.
2. Make the change.
3. **After**: same pages, same viewports, same wait condition (`networkidle`, fonts loaded,
   `reducedMotion: 'reduce'` so animations and scroll reveals do not hide content in full-page captures).
4. **Compare**: pixel diff where layout is meant to be identical (e.g. `pixelmatch` or ImageMagick `compare`
   if available), otherwise side-by-side review. Check spacing, alignment, fonts, colors, wrapping, clipping,
   overflow, hidden elements, nav, header, footer, modals, forms, tables, cards, images.
5. Every visual difference must be either intended (listed) or fixed.

## Measurable fail conditions
- any horizontal overflow (`scrollWidth > innerWidth`) at any viewport
- text clipped (element `scrollWidth > clientWidth` with `overflow:hidden` and no ellipsis intent)
- tap target < 44x44 px on touch viewports
- H1 more than 3 lines
- console error or failed same-origin request
- a section's content invisible in the capture (opacity 0) under reduced motion
- contrast below WCAG AA (4.5:1 text, 3:1 large text/UI)

## Report
Table: page x viewport -> PASS/FAIL with the metric that failed, plus the before/after image paths for every
change. State the pages NOT captured (e.g. behind auth with no test account).
