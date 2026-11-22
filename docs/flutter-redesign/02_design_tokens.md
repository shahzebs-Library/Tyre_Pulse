# Flutter redesign, Phase 2: proposed design tokens

**Status: proposal for the owner's approval. No app code changes until approved.**

Inputs: the current tokens in `tyre_pulse_flutter/lib/app/theme/` and the
inventory in `02_design_system_inventory.md`. Rules kept from today:

* Brand is preserved: fleet green on daylight surfaces, safety yellow on the
  night (dark) theme, navy ink. No hex value below is new to the brand; every
  colour role maps to a value that already exists in `TpPalette`.
* Light is primary and tuned for sunlight; dark is secondary.
* "Not measured" (`unknown`, violet, dashed) stays distinct from "neutral".
* Borders, not shadows, for resting surfaces. Shadow is allowed only for
  things that float over content (sheets, dialogs, the primary lift).
* 48 dp minimum touch target, always.

Naming: tokens stay on the existing classes so no feature import changes;
new names are additive, renamed names keep a deprecated alias for one release.

---

## 1. Colour roles

### 1.1 Surfaces, ink, lines (mapped from current `TpPalette`)

| Proposed role | Light (current value) | Dark (current value) | Current name | Change |
|---|---|---|---|---|
| `bg.canvas` | `#FBFCFF` | `#080C10` | `background` | rename alias |
| `bg.surface` | `#FFFFFF` | `#11161B` | `surface` | none |
| `bg.surfaceAlt` | `#F5F8FF` | `#171D23` | `surfaceAlt` | none |
| `bg.sunken` | `#EAF0FC` | `#0C1116` | `surfaceSunken` | rename alias |
| `bg.raised` (new) | `#FFFFFF` | `#171D23` | n/a | for sheets/dialogs; same values as surface/surfaceAlt, named for intent |
| `ink.primary` | `#00145A` | `#F1F5F9` | `text` | none |
| `ink.secondary` | `#173577` | `#C3CEDE` | `textSecondary` | none |
| `ink.muted` | `#5E6E9A` | `#8CA0B8` | `textMuted` | none |
| `ink.inverse` | `#FFFFFF` | `#080C10` | `textInverse` | none |
| `line.subtle` | `#DCE4F2` | `#252C33` | `border` | none |
| `line.strong` | `#BECBE1` | `#39424C` | `borderStrong` | none |
| `line.control` | `#75849F` | `#6B7A8C` | `controlBorder` | none (3:1 boundary for controls) |
| `focus` | `#07883F` | `#FFD400` | `focus` | none |
| `scrim.modal` | `#80080E18` | `#B302060E` | `overlay` | none |
| `scrim.media` (new) | `#8A000000` | `#8A000000` | n/a | replaces the 5 `Colors.black54` photo overlays |

### 1.2 Brand / action

| Proposed role | Light | Dark | Current name | Change |
|---|---|---|---|---|
| `brand.primary` | `#07883F` fleet green | `#FFD400` safety yellow | `primary` | none |
| `brand.onPrimary` | `#FFFFFF` | `#181200` | `onPrimary` | none |
| `brand.primarySoft` | `#E7F7EE` | `#332A00` | `primarySoft` | none |
| `brand.accentInk` | `#06385C` | `#EAB308` | `primaryDark` | **rename**: today `primaryDark` is navy in light and amber in dark, so the name lies. It is used as the selected/active ink (`tasks_screen.dart:226/486/500`, `calendar_screen.dart:301/365`), so it becomes the accent ink |
| `brand.ink` (new) | `#06385C` navy | `#F1F5F9` | n/a | navy brand headers in the approved mocks; same light value as `accentInk`, separate role so a header and a selected state can diverge later |

The signed-out login keeps `TpPalette.loginLight` as a scoped brand variant;
it is not merged.

### 1.3 Status (unchanged values, unchanged API)

`TpStatus` ok / warning / critical / info / neutral / unknown with base,
soft, onBase, onSoft, exactly as today. One addition:

| New | Use |
|---|---|
| `TpStatus.pending` mapped to the existing `warning` colours, with a clock icon | "saved on this device, waiting to sync" on list rows and records. Separate enum value so it can never be read as a fault. |

### 1.4 Data visualisation (new)

Today: none, so features invented purple `#7E57C2` and blue `#0648D9`. Proposal,
built only from existing palette values so charts match the app:

| Series | Light | Dark |
|---|---|---|
| `chart.1` | `#07883F` (primary) | `#FFD400` (primary) |
| `chart.2` | `#0369A1` (info.base) | `#38BDF8` |
| `chart.3` | `#06385C` (navy) | `#C3CEDE` |
| `chart.4` | `#B45309` (warning.base) | `#F59E0B` |
| `chart.5` | `#475569` (neutral.base) | `#94A3B8` |
| `chart.grid` | `line.subtle` | `line.subtle` |

Status colours are reserved for judgements, so a chart never uses critical red
for an ordinary series.

## 2. Type scale

Current scale stays; the slots features are faking with literals get names.

| Token (M3 slot) | Size / line | Weight | Current | Replaces literals |
|---|---|---|---|---|
| `kpi` (new, `displaySmall` derivative) | 32 / 38 | w800, tabular | `displaySmall` exists | 30, 32, 34 (`meter_log_screen.dart:485`, `checklists_home_screen.dart:860`) |
| `headlineMedium` | 26 / 32 | w800 | same | 26, 27 |
| `headlineSmall` | 21 / 27 | w800 | same | 19, 20 |
| `titleLarge` | 18 / 24 | w700 | same | 17, 18 |
| `titleMedium` | 16 / 22 | w700 | same | |
| `titleSmall` (new) | 14 / 20 | w700 | missing | 14 bold labels |
| `bodyLarge` | 15 / 22 | w500, ink.primary | same | 15 |
| `bodyMedium` | 15 / 22 | w500, ink.secondary | same | |
| `bodySmall` (new) | 13 / 18 | w500 | missing | 13 |
| `labelLarge` | 15 / 20 | w700 | same | |
| `labelMedium` | 13 / 17 | w700 | same | 12, 13 bold |
| `labelSmall` | 12 / 16 | w600, ink.muted | same | 11, 11.5, 12 |
| `micro` (new) | 11 / 14 | w700 | missing | 9, 9.5, 10 (diagram labels). 11 is the floor: nothing smaller is readable outdoors. |
| `identifier` | 14 / 18 | w700, tabular | same | serials, positions, asset numbers |

Weights allowed: w500, w600, w700, w800. **w900 is retired** (37 uses map to
w800). w400 is not used for UI text.

## 3. Spacing

Current 4 pt scale stays. Additions only for values used often enough to be real:

| Token | Value | Current | Note |
|---|---|---|---|
| `TpSpace.xxs` (new) | 2 | missing | 68 literal `2`s (icon-to-text nudges, hairline gaps) |
| `xs` | 4 | same | absorbs 3 and 5 |
| `sm` | 8 | same | absorbs 6, 7, 10 |
| `md` | 12 | same | absorbs 14 |
| `lg` | 16 | same | absorbs 18 |
| `xl` | 20 | same | absorbs 22 |
| `xxl` | 24 | same | absorbs 26 |
| `xxxl` | 32 | same | |
| `huge` | 40 | same | |
| `TpSpace.gutter` (alias) | 16 | n/a | page side padding, one name |
| `TpSpace.section` (alias) | 24 | n/a | gap between sections |

All asymmetric insets move to `EdgeInsetsDirectional` (RTL).

## 4. Radius

| Token | Value | Current | Absorbs |
|---|---|---|---|
| `TpRadius.xs` (new) | 4 | missing | 2, 3, 4, 5, 6 (small tags, bars) |
| `sm` | 8 | same | 9, 10 |
| `md` | 12 | same | 14, 15 (cards, inputs) |
| `lg` | 16 | same | dialogs |
| `xl` | 20 | same | bottom sheets (top corners) |
| `pill` | 999 | same | chips, status tags, segmented |

Component defaults: button md, input md, card md, chip pill, sheet xl,
dialog lg.

## 5. Elevation

Rule: resting surfaces use a hairline border; only floating layers get a shadow.

| Token | Light | Dark | Use |
|---|---|---|---|
| `TpElevation.flat` | border `line.subtle`, no shadow | border `line.subtle` | cards, rows, tiles |
| `TpElevation.lift` | `0 2 8 #1400145A` | none (dark uses `line.strong` border) | the one primary action lift (replaces `QueuePrimaryLift`, `_softLift`) |
| `TpElevation.overlay` | `0 8 24 #2400145A` | `0 8 24 #66000000` | sheets, dialogs, menus |

The 40 existing `BoxShadow`s collapse onto these three (most become `flat`).

## 6. Touch targets and sizing

| Token | Value | Current |
|---|---|---|
| `TpSizing.minTouchTarget` | 48 | same, now enforced on every tappable custom widget (chips, sync indicator, tyre chips) via a `TpTapTarget` wrapper |
| `TpSizing.controlHeight` | 52 | same |
| `TpSizing.controlHeightCompact` | 40 visual / 48 hit | same visual; hit box padded to 48 |
| `TpSizing.fieldButton` (new) | 56 | primary action on capture screens (gloved use) |
| `TpSizing.iconSm / Md / Lg / State` | 16 / 20 / 24 / 44 | same; `size:` literals map onto these |

## 7. Motion

Today only `NoSplash`. Proposal keeps motion minimal (low-memory phones,
spec section 55) and respects the system "reduce motion" setting.

| Token | Value | Use |
|---|---|---|
| `TpMotion.instant` | 0 ms | reduce-motion fallback for everything |
| `TpMotion.fast` | 120 ms, `Curves.easeOut` | press feedback, chip select, toggles |
| `TpMotion.base` | 200 ms, `Curves.easeOutCubic` | expand/collapse, tab change |
| `TpMotion.slow` | 300 ms, `Curves.easeInOutCubic` | sheet and dialog enter/exit |
| `TpMotion.skeletonPulse` | 1200 ms loop, opacity 0.5 to 1.0 | skeleton placeholders; off under reduce motion |

The 29 literal durations map onto these.

## 8. Current-to-new mapping summary

| Current | New | Kind |
|---|---|---|
| `TpPalette.background` | `bg.canvas` | alias |
| `TpPalette.surfaceSunken` | `bg.sunken` | alias |
| `TpPalette.primaryDark` | `brand.accentInk` | rename (deprecated alias kept) |
| hard-coded navy | `brand.ink` | new role, existing value |
| `Colors.black54` overlays | `scrim.media` | new role |
| `#7E57C2`, `#0648D9`, `#B39DDB`, `#082B70` | `chart.*` / `brand.*` | removed, mapped to existing palette |
| `fontSize` 9 to 34 literals | `micro`, `bodySmall`, `titleSmall`, `kpi` + existing slots | new slots |
| `FontWeight.w900` | w800 | retired |
| spacing 2, 3, 5, 6, 7, 10, 14, 18, 22, 26 | `xxs` + nearest step | new step + snap |
| radius 2 to 15 literals | `xs` + nearest step | new step + snap |
| 40 `BoxShadow` | `TpElevation.flat/lift/overlay` | new tokens |
| 29 `Duration` literals | `TpMotion.*` | new tokens |

## 9. Owner decisions (settled 2026-11-22: direction "Porcelain")

The owner chose direction A "Porcelain" (warm porcelain paper, navy ink, brand
green only where it means something). Mockups:
https://claude.ai/artifact/Lz58gKg8jLB368cbftJPo1. The five open decisions,
answered inside that direction:

1. **Navy is a named role: yes.** `TpPalette.brandInk` (#0C1626 light) is the
   ink for the hero card, the floating navigation bar and the strongest headers.
   It is also the main text colour, so headers and body read as one family.
2. **Retire w900: yes.** Porcelain's numbers are big, not heavier. The heaviest
   weight is w800; every w900 literal maps to w800 (done screen by screen in the
   widget PRs, not in the token PR).
3. **Brand-only chart palette: yes.** Charts use navy, brand green, amber, red
   and the slate pending blue, plus tints of them. The off-brand purple and
   bright blues go. `unknown` keeps its violet because "not measured" must not
   look like any measured state.
4. **Pending sync is its own status: yes.** `TpStatus.pending` (slate blue
   #2F4F7F on #E5ECF6) means "saved on this phone, waiting to sync". It is not
   amber `warning`, because nothing is wrong with the record.
5. **One soft shadow: yes, narrowly.** `TpElevation.lift` exists only for the
   single primary action; `TpElevation.overlay` for bottom sheets and the
   floating navigation bar. Cards stay `flat` with a hairline border. In dark
   mode `lift` returns `flat`.

### Porcelain token values (light)

| Role | Value | Notes |
|---|---|---|
| background | #F3F1EC | porcelain canvas |
| surface / surfaceAlt / surfaceSunken | #FFFFFF / #F8F7F3 / #ECE9E2 | |
| text / textSecondary / textMuted | #0C1626 / #3D4757 / #5E6675 | 16.1 / 7.7 / 5.1:1 on canvas |
| primary (text-bearing fills) | #12873F | white on it 4.6:1 |
| brandAccent (decoration only) | #16A34A | rings, dots; never text-bearing (3.3:1) |
| primaryDark (green ink) | #0B6B32 | green text on tint 5.8:1 |
| border / borderStrong / controlBorder | #E3DFD6 / #CFCAC0 / #737985 | control border 3.6:1 on sunken |
| warning base / soft | #9A4A06 / #FCEFD9 | 5.5:1 |
| critical base / soft | #B42318 / #FDE6E2 | 5.5:1 |
| pending base / soft | #2F4F7F / #E5ECF6 | 6.9:1 |
| TpRadius.xxl | 24 | cards and sheets |

Dark keeps the same identity: navy-black surfaces (#0B111B / #121A27) with
brand green #4ADE80 as the action colour (replaces the old safety yellow).

Typography: Porcelain is drawn in Plus Jakarta Sans. Bundling that font adds
files to the app, so it waits for the owner's go-ahead; until then the system
font is used with the same sizes and weights.
