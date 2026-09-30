---
name: localization-rtl
description: English/Arabic (and Urdu on Flutter) localization and RTL correctness for the Tyre Pulse web app, marketing /ar page, Expo app and Flutter app - strings, direction, icons, numbers, dates, currencies (SAR, AED, EGP), mixed text. Use for "Arabic", "RTL", "translation missing", "raw key on screen", "mirror", "localize".
---

# Localization and RTL

## Where strings live
- Web app: `src/i18n` / locale JSON via `LanguageContext`; English is eager, Arabic lazy. `t(key, vars)` takes
  interpolation vars, **not** a fallback string. Shell strings are guarded by `src/test/shellI18nKeys.test.js`.
- Marketing: English pages; Arabic is `/ar` only. Header/Footer take `locale="ar"`; nav labels in
  `marketing/lib/nav.ts` (`labelAr`, `textAr`).
- Expo: `mobile/locales/en.json`, `ar.json` (+ partial `ur.json`). A missing key falls back to English only if the key
  exists in `en.json`; otherwise the raw key path renders. `t()` on mobile takes no interpolation vars.
- Flutter: ARB files `tyre_pulse_flutter/lib/l10n/*.arb` (en/ar/ur), key parity pinned by a test (count recorded in
  PROJECT_MEMORY); regenerate with `flutter gen-l10n`.

## Checks
1. **Key coverage**: every `t('...')` / `AppLocalizations.of(context)` key exists in every locale. Web + mobile:
   grep keys vs JSON; Flutter: ARB parity test. No raw key paths on screen.
2. **Hard-coded user-facing strings**: grep JSX/TSX/Dart for literal English in visible text; each must be a key
   (exceptions: brand names, units, ISO codes).
3. **Direction**: `dir="rtl"` + `lang="ar"` on the Arabic root; layout uses logical properties
   (`margin-inline-start`, `inset-inline-start`, `text-align: start`), not `left/right`.
4. **Icons**: arrows/chevrons that mean "forward/back" mirror in RTL. Flutter: `Icons.chevron_left/right`,
   `arrow_back*`, `arrow_forward_ios*` already mirror (`matchTextDirection`) - never write
   `isRtl ? chevron_left : chevron_right` (double flip). Web: flip with `transform: scaleX(-1)` under `.rtl` or use
   the opposite icon deliberately.
5. **Carousels / sliders / progress**: advance direction follows reading direction.
6. **Tables and forms**: column order, input alignment, validation messages, placeholders.
7. **Dialogs, toasts, sheets**: title alignment, close button side, button order.
8. **Numbers and money**: keep Western digits in data tables unless the product decides otherwise; currencies per
   country (KSA SAR, UAE AED, Egypt EGP) and **never summed across currencies**. Money uses `Intl.NumberFormat`
   / `NumberFormat` with the country's currency.
9. **Dates**: day-first display for the region; parsing of ERP dates is day-first (never a bare `::timestamptz`
   cast on dd-mm-yyyy).
10. **Phone numbers / emails / codes**: wrap in `<bdi>` or `dir="ltr"` inside Arabic text so they read correctly;
    same for asset codes (TM514), serials and mixed Arabic/English strings.
11. **Text expansion**: Arabic/Urdu labels often run longer; buttons and chips wrap or shrink, never clip.
12. **Fonts**: Arabic text uses a font with Arabic glyphs (marketing: IBM Plex Sans Arabic; Flutter/Expo bundled
    fonts). PDFs: Arabic needs a font that can load, else English only (known gap).
13. **Search**: Arabic input matches Arabic data; normalisation of alef/ya variants where search matters.

## How to test
- Web/marketing: Playwright at 1440 and 390 with the Arabic route/locale; screenshot; assert no horizontal overflow
  and that `getComputedStyle(root).direction === 'rtl'`.
- Flutter: widget tests with `Locale('ar')` and `TextDirection.rtl`, golden where they exist (goldens are generated
  on Windows CI - do not regenerate on Linux).
- Expo: `npm --prefix mobile test` + manual device check (RTL requires an app restart via `I18nManager`).

## Pass / fail
PASS: zero missing keys, zero raw keys on screen, zero hard-coded visible strings in touched files, correct
direction/mirroring on the checked screens, currencies correct and never blended.
