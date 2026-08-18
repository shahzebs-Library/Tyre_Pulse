---
name: mobile-ui-design
description: Design and build screens for the Tyre Pulse mobile app (Expo/React Native) to a calm-enterprise standard using the Daylight design system in mobile/lib/theme.ts and mobile/components/ui. Use this skill whenever the user asks to redesign, restyle, clean up, tidy, improve or "make beautiful" any mobile screen; whenever they say a screen looks messy, cluttered, ugly, busy, unprofessional, inconsistent, boring or "not correct"; whenever they complain about spacing, colours, icons, layout, hierarchy or density on the phone app; and whenever a NEW screen or component is being added under mobile/app/ or mobile/components/, so it is born consistent instead of needing a cleanup pass later. Use it even when the user never says the word "design" - "this page is a mess", "the icons look wrong", "make it look proper" all belong here.
---

# Tyre Pulse mobile: design and build beautiful screens

This app already has a good design system. Screens still come out looking wrong,
and it is almost never because a token or a component was missing. It is because
the pieces were composed without a point of view.

Your job is to bring that point of view, and to leave the codebase more
consistent than you found it.

## Read this first, every time

Two files are the ground truth and they change without this skill changing:

- `mobile/lib/theme.ts` — spacing, radius, typography, `HIT`, `elevation()`,
  the semantic status triads, the `tint` map, light + dark palettes
- `mobile/components/ui/index.ts` — what the kit already gives you

Read them before you design anything. Do not reproduce their values here from
memory; a design that hardcodes `#15803D` because you remembered the green is
a design that breaks the day someone rebrands.

## Where this codebase actually stands

A full audit of all 46 screens and 25 components found that files are almost
never *partly* consistent. They fall into two populations, and knowing which
one you are looking at tells you most of what is wrong before you read a line:

| | Themed | Legacy |
|---|---|---|
| Styles built by | `useMemo(() => makeStyles(theme), [theme])` | module-level `StyleSheet.create` |
| Count | 26 screens + 5 components | 20 screens + 19 components |
| Raw hex | ~0 | 25 to 83 per file |
| Dark mode | works | structurally impossible |
| States | `Loading` / `EmptyState` / `ErrorState` | bare `ActivityIndicator` |

A module-level stylesheet is evaluated once at import, so it can never see
`theme`. That single choice drags the whole file out of the system. **Check
which population your screen is in first** — if it is legacy, the work is a
migration, not a touch-up, and you should say so before you start.

**But `makeStyles` is necessary, not sufficient.** The worst category is the
half-tokenised file: theme colours with magic-number geometry. `inspection/new.tsx`
uses `makeStyles` and still carries the app's highest count of raw font sizes
(52). `maintenance.tsx:470` has `theme` in scope and still hardcodes its modal
scrim instead of using `theme.color.overlay`. Having the theme available does
not mean you used it — check both.

`references/codebase-map.md` names the best and worst files with line numbers.
Read the relevant entry before you start; copying a file that already does it
right is faster and safer than deriving the pattern again.

## The doctrine

Six ideas, in priority order. When two conflict, the earlier one wins.

### 1. Colour is a signal. If it does not mean something, it should be neutral.

This is the single highest-leverage rule in the whole skill, and the one this
codebase has broken most expensively.

The Home screen assigned each quick-action tile one of seven `tint` values for
variety. The result: **Accidents** (red) sat beside **Reports** (violet) and
**Tyre Change** (teal) with exactly equal visual urgency, because when
everything is coloured, colour carries no information. The owner's report was
"the icons are not correct" — they were reading a real defect through an
impressionistic word.

So: pick the colour from the meaning, never from the position in a list.

- **Green / `primary`** — the one action you want the user to take, and success
- **Red / `danger`, `critical`** — harm, blocked, overdue, destructive
- **Amber / `warning`** — needs attention, pending, unsynced
- **Blue / `info`** — informational, neutral status
- **Everything else** — `neutral`, or the plain surface + text tokens

If you cannot finish the sentence "this is coloured because it means ___",
make it neutral. A screen where four things are grey and one is green tells the
user where to go. A screen where all five are different colours does not.

Decorative colour is not merely neutral-cost — it actively destroys the
semantic channel. `overview.tsx:235` tints four KPI tiles blue, teal, red and
violet. The red one genuinely means high risk. The other three mean nothing, and
their presence is exactly what stops the red one being noticed.

**Corollary: the app canvas is not a place to express anything.** Eight screens
invent their own tinted background instead of `theme.color.bg` — `#f0f5f1`,
`#faf5ff`, `#f8f5ff`, `#f0fdf4`, `#eff6ff`, `#fff7ed` — so moving between tabs
changes the wall colour, and `admin/index.tsx:485` runs an entire violet
sub-brand. A root background is always `theme.color.bg`.

### 2. Hierarchy comes from size, weight and space — not from colour.

Partly because of rule 1, and partly because this app is used in direct GCC
sun, where colour separation washes out but size and contrast survive.

Every screen answers "what is this person here to do?" with exactly one
visually dominant element. Everything else steps back. If you cannot point at
the primary action from across the room, the screen has no hierarchy yet.

The `typography` ramp exists to do this work. Reach for a different step on the
ramp before you reach for a different colour.

### 3. Remove before you add.

The instinct when a screen looks bad is additive: a gradient, a shadow, another
icon, a helpful sublabel. The fix is almost always subtractive.

Home looked "messy" largely because every tile carried a second line of
explanatory text — "Log a wash", "Daily odometer / hrs", "Sheets I have
filled". Nobody reads the second line on a tile they tap forty times a week; it
just doubles the ink and the tile height. The owner called it "commentary" and
asked for it gone. They were right.

Before adding an element, ask what it is for on the fiftieth use, not the
first. Onboarding text is not a design.

### 4. Group tightly, separate generously.

Density is not "small". Density is correct grouping.

Related things sit close (`spacing.xs`–`spacing.sm`). Unrelated groups sit far
apart (`spacing.xl`–`spacing['3xl']`). A screen with one uniform gap everywhere
reads as an undifferentiated wall, which is the other half of "messy".

Use the whitespace to do the grouping so you do not need boxes, rules and
background tints to do it. Three visual devices doing one job is clutter.

### 5. Repetition is the aesthetic.

In an enterprise tool, beauty is consistency. The same card radius, the same
icon-chip size, the same gutter, the same type ramp, screen after screen. That
is what reads as "professional".

Novelty per screen reads as sloppiness, even when each individual screen is
defensible. So prefer an existing kit component over a new local one, and
prefer an existing pattern over a new pattern, unless you can say what the new
one earns.

The cost of ignoring this is concrete. The same retry button is hand-written in
three screens — `tasks.tsx:171`, `workorders/index.tsx:198`,
`analytics/index.tsx:245` — in three different brand colours, none of them the
primary, while `ErrorState` with an `onRetry` already does exactly this. Twenty
screens define a local `card:` style; `work-orders.tsx:259` even builds one from
correct tokens, and still diverges from `Card` because it picked `radius.lg`
where `Card` uses `radius.xl`.

**Before restyling a screen, check whether a compliant sibling already exists.**
This app contains duplicate screens for the same domain sitting on opposite
sides of the split: `work-orders.tsx` is near-perfect while `workorders/index.tsx`
carries 50 raw hex values; `history.tsx` is compliant while `records/index.tsx`
is not. Somebody rewrote these properly and never deleted the original. Restyling
the wrong twin is pure waste.

### 6. Motion confirms a change. It does not entertain.

150–250ms, ease-out, on state transitions the user caused. Never a loop, never
an entrance animation on a list the user reads every day, never anything that
delays their next tap.

These are 2GB Android handsets in the field. Prefer `LayoutAnimation` and
`Animated` with `useNativeDriver: true`. No blur, no shadow animation, no
heavyweight libraries. If motion costs a frame on a cheap phone, cut it.

## The field constraints that make this app different

Do not design this like a consumer app on a flagship phone.

- **Direct sunlight.** Contrast survives glare; shadow does not. That is why
  `elevation()` is paired with a hairline border everywhere. Keep the border.
  Avoid light-grey text for anything that matters.
- **Gloved, dusty hands.** `HIT` (48) is a floor, not a target. Put real space
  between a destructive action and its neighbour.
- **Low-end devices.** Memoise list rows, keep images small, avoid deep view
  trees.
- **Arabic RTL.** A real, used locale. See the traps below.
- **Offline-first.** "We could not load this" and "there is nothing here" are
  different sentences and must look different. Never render an error as an
  empty state — the user will conclude their data is gone.

## Diagnose before you touch pixels

Complaints arrive impressionistic. Your first job is translating one into
concrete, nameable defects, because "make it beautiful" is not actionable and
guessing produces a redesign the user likes no better than the original.

| What they say | What it usually is |
|---|---|
| "messy", "cluttered" | too many equal-weight items; no grouping; sublabels and help text nobody reads; the same information shown twice |
| "not professional" | decorative colour; mismatched radii; ad-hoc font sizes off the ramp; inconsistent icon sizes |
| "the icons are not correct" | colour carrying no meaning; mixed icon families or weights; an invented glyph rendering as `?` |
| "boring", "flat", "nothing stands out" | no primary action; uniform card sizes; hierarchy attempted with colour instead of scale |
| "hard to use" | touch targets under 48; the main action below the fold; destructive action adjacent to a common one |
| "slow", "janky" | unmemoised list, oversized images, layout thrash — a performance bug wearing a design costume |

State your diagnosis in one or two sentences before you edit anything, and say
which of the six doctrine rules is being broken. If the diagnosis is wrong the
user will correct you in a sentence, which is much cheaper than correcting a
finished redesign.

## Workflow

**1. Diagnose.** As above. Name the defects.

**2. Inventory.** Read the screen. List what it already does that must keep
working — access gating, i18n keys, offline queue events, RTL handling,
analytics, navigation params. A redesign that quietly drops a permission check
is a security regression, not a design.

**3. Design in words first.** One short paragraph: what is the primary action,
what groups exist, what recedes, what gets colour and why. This is fast to
write, fast for the user to correct, and it prevents you discovering the
concept halfway through the diff.

**4. Implement.** Tokens and kit components only. Extend the kit if a genuinely
reusable piece is missing — but put it in `mobile/components/ui/` and export it
from the barrel, so the next screen inherits it rather than reinventing it.

**5. Verify.** The checklist below. Actually run it.

## Traps that have shipped real bugs here

These are not hypothetical. Each one reached a user.

**An invented Ionicons name renders as `?`.** There is no build error and no
type error if you cast. Verify every glyph you introduce:

```bash
node -e "const m=require('/home/user/Tyre_Pulse/mobile/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'); console.log(['checkmark-circle','alert-circle-outline'].map(n=>[n, n in m]))"
```

The checklist mark icons shipped as `?` for exactly this reason: the lookup was
skipped and an `as IconName` cast hid it.

**A missing i18n key renders the raw key path on screen.** Mobile is not the
web here. `LanguageContext.resolve` falls back to English only when the key
exists in `en.json`; missing from both and the user sees
`modules.home.qa.washing.label`. Every new or renamed key goes into
`en.json` **and** `ar.json` in the same change, and you read the files back to
confirm.

**Mobile `t()` takes no interpolation variables.** `t('x', { count })` silently
does nothing and `{{count}}` renders literally. Compose by concatenation.

**A module-level `StyleSheet.create` cannot respond to the theme.** Styles that
depend on colour must be built inside `makeStyles(theme)` and consumed via
`useMemo(() => makeStyles(theme), [theme])`. Colour constants captured at module
scope are how dark mode breaks silently. Geometry-only styles are fine at module
scope.

**Physical margins break RTL.** Use `marginStart` / `marginEnd` /
`paddingStart` / `paddingEnd` / `borderStartWidth`, and `textAlign` derived from
`isRTL`. `Card`'s `accent` prop and `Badge`'s icon gap already do this — copy
the pattern.

**Directional icons must flip.** `chevron-forward`, `arrow-back`,
`arrow-forward-circle` all point the wrong way in Arabic unless you swap them on
`isRTL`. Twenty-seven files never reference `isRTL` at all, the entire `admin/`
directory among them, so assume a legacy screen is RTL-blind until you check.

**The kit is not automatically correct.** `ListRow.tsx:48` hardcodes a
`chevron-forward` with no flip, so anyone adopting it inherits an RTL bug. It has
zero consumers today, which is its own signal — a primitive nobody uses is
usually a primitive that does not fit the job. Read a kit component before
trusting it, and fix it in place rather than working around it.

**A `style` prop can defeat the kit.** `admin/index.tsx:490` uses `BackButton`
correctly and then passes `{ width: 32, height: 32 }`, shrinking it below the
minimum touch target. `HIT` is currently imported by exactly two files, both
inside the kit, and by zero screens — 36x36 and 38x38 are the habitual icon
button size here and both fail it.

**`theme.color.overlay` exists and every modal scrim ignores it**, hardcoding
`rgba(0,0,0,0.45)` instead. Camera overlays are the legitimate exception: the
backdrop there is a live preview, not a theme surface, so a fixed scrim is
correct in `scanner.tsx`, `washing.tsx` and the meter-log capture.

**User-facing strings go through `t()`.** `reports/index.tsx:62` ships English
titles and descriptions as literals in an app with a complete localisation
layer. A hardcoded string is the same class of defect as an unflipped margin.

**No em dashes or en dashes in user-facing strings.** Project-wide rule. ASCII
only.

**When you spend colour or break a rule, write the sentence saying why.** This
is the habit that most reliably separates the good files here from the bad ones.
`theme.ts:1-20` explains the sunlight rationale; `index.tsx:88-104` records the
confetti post-mortem in the owner's own words. The worst files explain nothing.
A comment costs one line and saves the next person from re-deriving or
"correcting" a deliberate decision.

## Verification checklist

Run these, do not assume them:

```bash
cd /home/user/Tyre_Pulse/mobile && npx tsc --noEmit    # must be 0 errors
cd /home/user/Tyre_Pulse/mobile && npx jest            # must be green
```

Then confirm by reading:

- [ ] Every Ionicons glyph verified against the installed glyphmap
- [ ] Every locale key present in `en.json` **and** `ar.json`
- [ ] Colour-dependent styles built inside `makeStyles(theme)`; sanity-check the
      dark palette values actually contrast
- [ ] No physical margins/padding on anything that flips; directional icons
      swapped on `isRTL`
- [ ] Every pressable at least `HIT` (48), or given `hitSlop`
- [ ] Loading, empty and error states all exist and say different things
- [ ] Access gating, offline events and navigation params still intact
- [ ] No raw hex, no font sizes off the `typography` ramp, no radii off `radius`

When the change is structural — a shared component, a rule that should hold
across screens — add a guard test under `mobile/__tests__/` in the style of the
existing ones (they read source text and registries rather than rendering).
Then **mutation-test it**: reintroduce the defect, watch the test fail, restore,
watch it pass. Report the failure message you saw. A guard you never saw fail is
not a guard.

## Be honest about what you cannot check

You cannot run this on a phone. Say so plainly rather than implying the visual
result is confirmed. What you can legitimately claim is that it typechecks, the
tests pass, the tokens are used correctly, and the states are covered.

## Going deeper

- `references/codebase-map.md` — the measured state of this codebase: which files
  to copy from, which to treat as migrations, kit adoption numbers, known
  duplicate screens, and an ordered migration recipe. Read this before touching
  an unfamiliar screen.
- `references/screen-archetypes.md` — the seven screen shapes this app uses
  (hub, register, record detail, capture form, approval queue, dashboard,
  picker), each with its correct layout, primary action and usual failure mode.
  Read the entry for the archetype you are working on before designing.
- `references/composition.md` — the practical craft: spacing rhythm, type
  pairing, icon discipline, list density, form layout, motion recipes, and
  worked before/after examples from this codebase.
