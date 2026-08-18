# Codebase map

Measured across all 46 screens under `mobile/app/(app)/` and all 25 files under
`mobile/components/`. Counts are full-tree greps, not samples. They will drift
as screens are migrated — treat them as orientation, and re-check the specific
file you are about to touch.

---

## Copy from these

When you need a pattern, read one of these first. Deriving it again is slower
and produces drift.

| File | Why |
|---|---|
| `app/(app)/alerts.tsx` | The cleanest sheet in the app. Zero hex, zero raw font sizes, `makeStyles`, kit imports, `isRTL`, full loading/empty/error. |
| `app/(app)/team.tsx` | The RTL reference. `:67` `textAlign` derivation, `:117` icon flip, and the `isRTL && s.rowR` idiom at `:115/145/187/195/203`. |
| `app/(app)/workshop.tsx` | Quietly correct throughout. `isRTL` used 14 times, full states. |
| `app/(app)/calendar.tsx` | How to structure a typed registry (`:38-43`), even where you would argue with its colour choices. |
| `app/(app)/index.tsx:84-140` | The quick-action tone system, and the comment block at `:88-104` explaining the confetti post-mortem in the owner's own words. The best written statement of design intent in the repo. Cite the tone system, not the whole file. |
| `components/ui/Card.tsx:31-33` | Logical-edge RTL done right, with the reasoning in a comment. |

---

## Approach these as migrations, not touch-ups

Ordered by how many categories they fail.

| File | What is wrong |
|---|---|
| `app/(app)/admin/index.tsx` | Fails every category: 73 hex, 22 raw font sizes, module-level styles, no `isRTL`, no empty/error, hand-rolled skeleton, a violet sub-brand at `:485`, `fontSize: 9` labels at `:503` (below the smallest token, in an app designed for glare), and it shrinks a kit `BackButton` below the touch minimum at `:490`. |
| `app/(app)/admin/sites.tsx` | 83 hex (highest of any screen), 21 raw font sizes, 43 pressables with no `hitSlop`, a 36x36 primary create button at `:613`, no kit import, no `isRTL`. |
| `app/(app)/tasks.tsx` | Small enough to read whole and wrong in every category: off-system canvas `:229`, hand-rolled card `:246`, hand-rolled retry button `:171`, 38x38 back button `:232`, physical `paddingLeft` `:246`, no kit, no `isRTL`, no states. The best worked example if you want to demonstrate a full migration. |
| `app/(app)/serial-search.tsx` | 65 hex, 24 raw font sizes, 19 raw radii, and at `:478-491` a verbatim reimplementation of `EmptyState` and `ErrorState` in a file that never imports the kit. |
| `app/(app)/ai/index.tsx` | 48 hex, sub-pixel type (`fontSize: 13.5` at `:689`), violet sub-brand, `rgba(0,0,0,0.06)` borders that assume a white backdrop. |
| `app/(app)/checklists/approvals/[submissionId].tsx` | 66 hex, 28 raw font sizes, three sub-pixel sizes — sitting next to a sibling `index.tsx` that is fully compliant. Drift happens at file granularity, not feature granularity. |

---

## Kit adoption, measured

Usage across the 46 screens:

| Component | Screens using it |
|---|---|
| `Screen` | 30 |
| `AppText` | 26 |
| `Loading` | 21 |
| `ErrorState` | 19 |
| `Badge` | 18 |
| `Card` | 11 |
| `BackButton` | 11 |
| `Button` | 7 |
| `StatTile` | 6 |
| `EmptyState` | 4 |
| `SectionHeader` | 3 |
| `ListRow` | **0** |

Twenty-eight of 71 files never import the kit at all.

**`ListRow` has no consumers and is RTL-broken at `ListRow.tsx:48`.** Treat that
as information rather than as a rule to enforce: a primitive nobody adopts is
usually one that does not fit the job — most lists here need a trailing badge
plus a meta line, which `ListRow` does not express well. Either extend it to fit
the real shape and migrate a screen onto it, or retire it. Do not simply
instruct people to use it.

**`SectionHeader` at 3 and `EmptyState` at 4** against roughly twenty screens
that need one is the clearest adoption gap. Reach for these first.

---

## Off-scale values that recur

Repeated off-scale numbers are evidence about the scale, not only about the
files. Two are worth knowing:

- **`borderRadius: 14`** appears across a dozen unrelated files, sitting between
  `radius.md` (12) and `radius.lg` (16). It is the de-facto missing step.
- **36 and 38** are the habitual icon-button size, and both fail `HIT` (48).
  `HIT` is imported by exactly two files, both inside the kit, and by zero
  screens.

When you meet one of these, use the nearest real token and note the collision.
If the same off-scale value keeps reappearing across independent authors, raise
whether the scale needs a step rather than silently rounding for the tenth time.

Off-4pt spacing appears 293 times across 51 files, so expect it in any legacy
file.

---

## State coverage, measured

- **Full loading + empty + error:** 17 screens.
- **Bare `ActivityIndicator`, no empty, no error:** 16 screens.
- **No states at all:** `meter-logs.tsx`, `tyre-change.tsx`, `washing.tsx`,
  `analytics/index.tsx`.
- **`SkeletonLoader`:** used by 3 screens. `analytics/index.tsx` hand-rolls its
  own at `:217-228` rather than importing it. Twenty-nine screens use a bare
  spinner.

The `ErrorState` count understates real retry coverage and overstates
consistency, because several screens hand-roll a retry button instead.

---

## Known duplicate screens

Someone rewrote these correctly and never deleted the original. Check which twin
you are editing:

| Compliant | Legacy |
|---|---|
| `app/(app)/work-orders.tsx` | `app/(app)/workorders/index.tsx` |
| `app/(app)/history.tsx` | `app/(app)/records/index.tsx` |

`_layout.tsx` also declares a `records/[id]` screen that does not exist on disk.

---

## Migrating a legacy screen

The order matters — doing it the other way round means restyling twice.

1. **Check for a compliant twin** (table above). If one exists, the job may be
   deletion and a route update, not a redesign.
2. **Move to `makeStyles(theme)`.** Convert the module-level `StyleSheet.create`
   into a `makeStyles(theme)` builder consumed through
   `useMemo(() => makeStyles(theme), [theme])`. Nothing else can be fixed
   properly until colour is reachable.
3. **Replace hex with tokens.** Semantic triads for status, `color.text` /
   `textSecondary` / `textMuted` for type, `color.surface` / `surfaceAlt` for
   surfaces, `color.bg` for the root — never a per-screen canvas tint.
4. **Replace raw geometry.** Font sizes onto the `typography` ramp, radii onto
   `radius`, spacing onto the 4pt scale. Sub-pixel sizes always go.
5. **Adopt the kit.** `Screen`, `Card`, `Button`, `Badge`, and especially
   `EmptyState` / `ErrorState` / `Loading` in place of hand-rolled blocks.
6. **Fix RTL.** Logical edge props, `textAlign` from `isRTL`, flip directional
   icons.
7. **Fix touch targets.** `HIT` as the floor; add `hitSlop` where a control is
   genuinely small for visual reasons.
8. **Then compose.** Only now is the screen in a state where hierarchy, density
   and grouping decisions are worth making — and they are what the user will
   actually notice.

Steps 2 to 7 are mechanical and safe. Step 8 is the design, and it is the part
worth spending judgement on.
