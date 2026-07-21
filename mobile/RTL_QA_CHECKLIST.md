# RTL + Locale QA Checklist (TyrePulse Inspector, mobile)

Finding #18 follow-up. This document is the **manual QA matrix** for Arabic (RTL)
and light-mode coverage across the app.

## What the shared pass already fixed (no per-screen work needed)

These land automatically on every screen through the shared UI kit + helpers:

- **Logical spacing in the kit** - `Card` accent bar (`borderStart*`), `Badge`
  icon gap (`marginEnd`) now follow the reading direction. No physical
  left/right spacing remains in `components/ui/*`.
- **Reading-direction text** - `AppText` gained an opt-in `align="start|center|end"`
  prop (`start`/`end` flip under RTL). Use it wherever text must pin to the
  reading edge (`textAlign: 'left'` does NOT auto-flip under native RTL).
- **Locale-aware formatting helpers** - `lib/format.ts`
  (`formatDate`, `formatDateTime`, `formatNumber`, `formatCurrency`) and
  `lib/rtl.ts` (`rtlRow`, `textStart`, `textEnd`, `marginX`, `paddingX`).
  Digits stay **western** in Arabic by design (see `lib/format.ts` DIGIT CHOICE).

## What remains MANUAL (this checklist)

The shared kit fixes propagate structure and spacing, but per-screen work still
needs a human eye for: screen-local `marginLeft/Right` / `left:` / `textAlign`
in individual screen files, raw `toLocaleDateString` / `new Date().toString()` /
`toFixed()` output, absolutely-positioned elements, and chevron/arrow icons that
should mirror. **This shared pass fixes the kit + helpers, not every screen.**

## How to test

1. In the app, open **Profile > Language** and switch to **العربية (ar)**.
   The app prompts to restart; confirm. `LanguageContext` calls
   `I18nManager.forceRTL(true)` then `Updates.reloadAsync()`.
2. On a **production/dev-client build** the native RTL flip fully applies after
   the reload (Yoga mirrors `flexDirection: 'row'` and physical edges). In
   **Expo Go**, `Updates.reloadAsync()` may be a no-op, so the native mirror may
   not fully engage - verify RTL on a dev-client / internal build, not Expo Go.
3. Also test **Urdu (ur)** (RTL) and confirm **English (en)** is visually
   unchanged (LTR regression check).
4. Toggle **light** mode (default) and confirm sun-legible contrast on each screen.

## Per-screen matrix

Legend: mirror = layout/rows mirror correctly; text = labels align to reading
start; icons = chevrons/arrows/back flip; dates = dates/numbers localized (western
digits); clip = no clipped/overlapping text. Tick when verified in Arabic + light.

| Screen (`app/(app)/`) | mirror | text | icons | dates | clip |
|---|---|---|---|---|---|
| index (Home hub) | [ ] | [ ] | [ ] | [ ] | [ ] |
| overview | [ ] | [ ] | [ ] | [ ] | [ ] |
| profile | [ ] | [ ] | [ ] | [ ] | [ ] |
| notifications | [ ] | [ ] | [ ] | [ ] | [ ] |
| calendar | [ ] | [ ] | [ ] | [ ] | [ ] |
| scanner | [ ] | [ ] | [ ] | [ ] | [ ] |
| serial-search | [ ] | [ ] | [ ] | [ ] | [ ] |
| history | [ ] | [ ] | [ ] | [ ] | [ ] |
| alerts | [ ] | [ ] | [ ] | [ ] | [ ] |
| tasks | [ ] | [ ] | [ ] | [ ] | [ ] |
| team | [ ] | [ ] | [ ] | [ ] | [ ] |
| vehicles | [ ] | [ ] | [ ] | [ ] | [ ] |
| records/index | [ ] | [ ] | [ ] | [ ] | [ ] |
| stock | [ ] | [ ] | [ ] | [ ] | [ ] |
| meter-logs | [ ] | [ ] | [ ] | [ ] | [ ] |
| tyre-change | [ ] | [ ] | [ ] | [ ] | [ ] |
| rca | [ ] | [ ] | [ ] | [ ] | [ ] |
| report-issue | [ ] | [ ] | [ ] | [ ] | [ ] |
| washing | [ ] | [ ] | [ ] | [ ] | [ ] |
| maintenance | [ ] | [ ] | [ ] | [ ] | [ ] |
| workshop | [ ] | [ ] | [ ] | [ ] | [ ] |
| work-orders | [ ] | [ ] | [ ] | [ ] | [ ] |
| workorders/index | [ ] | [ ] | [ ] | [ ] | [ ] |
| inspection/new | [ ] | [ ] | [ ] | [ ] | [ ] |
| inspection/[id] | [ ] | [ ] | [ ] | [ ] | [ ] |
| inspection/approvals/index | [ ] | [ ] | [ ] | [ ] | [ ] |
| inspection/approvals/[id] | [ ] | [ ] | [ ] | [ ] | [ ] |
| checklists/index | [ ] | [ ] | [ ] | [ ] | [ ] |
| checklists/[templateId] | [ ] | [ ] | [ ] | [ ] | [ ] |
| checklists/approvals/index | [ ] | [ ] | [ ] | [ ] | [ ] |
| checklists/approvals/[submissionId] | [ ] | [ ] | [ ] | [ ] | [ ] |
| accident/report | [ ] | [ ] | [ ] | [ ] | [ ] |
| accident/dashboard | [ ] | [ ] | [ ] | [ ] | [ ] |
| accident/[id] | [ ] | [ ] | [ ] | [ ] | [ ] |
| analytics/index | [ ] | [ ] | [ ] | [ ] | [ ] |
| reports/index | [ ] | [ ] | [ ] | [ ] | [ ] |
| ai/index | [ ] | [ ] | [ ] | [ ] | [ ] |
| admin/index | [ ] | [ ] | [ ] | [ ] | [ ] |
| admin/users | [ ] | [ ] | [ ] | [ ] | [ ] |
| admin/access | [ ] | [ ] | [ ] | [ ] | [ ] |
| admin/sites | [ ] | [ ] | [ ] | [ ] | [ ] |
| admin/approvals | [ ] | [ ] | [ ] | [ ] | [ ] |
| admin/ai-chat | [ ] | [ ] | [ ] | [ ] | [ ] |

## Recommended per-screen fixes (when a row above fails)

- Replace screen-local `marginLeft/Right`, `paddingLeft/Right`, `left:`/`right:`
  with `marginStart/End`, `paddingStart/End`, `start:`/`end:` (or `marginX`/
  `paddingX` from `lib/rtl.ts`).
- Replace explicit `textAlign: 'left'` with `align="start"` on `AppText` (or
  `textStart(isRTL)` from `lib/rtl.ts`).
- Route dates/numbers/currency through `lib/format.ts` with the current
  `language` from `useLanguage()`.
- For back/forward chevrons that must point the reading direction, swap the icon
  name based on `isRTL` (e.g. `chevron-forward` and `chevron-back`). Note: the kit
  `ListRow` chevron is decorative-forward; mirror at the screen level only where
  it conveys direction.
