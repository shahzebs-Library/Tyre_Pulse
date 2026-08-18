# Composition craft

The doctrine in SKILL.md says what to aim for. This is how to actually get
there: the small decisions that separate a screen that merely uses the tokens
from one that looks designed.

---

## Spacing rhythm

The `spacing` scale is a 4pt ramp. Using it is necessary but not sufficient —
`spacing.md` everywhere is still a wall. What creates rhythm is *varying* the
gap to express relationship:

| Relationship | Gap |
|---|---|
| Parts of one thing (icon and its label, value and its caption) | `xs` (4) |
| Items in a group (rows in a card, chips in a row) | `sm`–`md` (8–12) |
| Inside a container (card padding) | `lg` (16) |
| Between groups | `xl`–`2xl` (20–24) |
| Between major sections | `3xl` (32) |

A reader infers structure from these gaps before reading a single word. If your
screen has one gap value, it has no structure.

**Vertical rhythm beats horizontal decoration.** When a screen feels
cluttered, increasing the gap between groups fixes it more often than adding
dividers, boxes or background tints.

---

## Type pairing

The `typography` ramp is already tuned larger and bolder than a typical app,
for sun and arm's length. Use it as a ramp, not a palette.

Practical pairings that work here:

- **Card headline + supporting line:** `title` over `caption` in `textMuted`
- **KPI:** `h1` value over `caption` label. Never the reverse; the number is
  the content
- **Section label:** `label`, uppercase, `textMuted` — deliberately quiet, it
  is a signpost not a heading
- **List row:** `bodyStrong` identifier over `caption` meta
- **Screen title:** `h1`; `display` only where a screen is genuinely a landing
  surface

Two adjacent steps on the ramp read as "same importance, slightly different" —
usually a mistake. Skip a step when you mean a real difference in importance.

**Never introduce a font size that is not on the ramp.** If none fits, the
layout is asking for a hierarchy the ramp does not support, which usually means
the hierarchy is wrong.

---

## Icon discipline

- One family throughout: Ionicons. Never mix in a second icon set.
- One weight per surface. This app uses `-outline` variants for navigation and
  neutral actions; filled variants read as "active" or "selected". Mixing them
  arbitrarily on one screen is a common source of "the icons look wrong".
- Consistent size per context: 22 in a tile chip, 18–20 inline with text, 16 in
  a badge, 34 in an empty state.
- The chip around an icon is a fixed square with a fixed radius so icons align
  across tiles regardless of glyph width.
- Directional glyphs flip in RTL.
- **Verify every glyph against the installed glyphmap.** An invented name
  renders as `?` with no build error. See SKILL.md.

Icons support a label; they rarely replace one. An icon-only control needs an
`accessibilityLabel` regardless.

---

## Colour, concretely

Given doctrine rule 1, the practical question is: what does a neutral tile look
like when most tiles are neutral?

- Icon chip: `theme.color.surfaceAlt` background, `theme.color.textSecondary`
  glyph. Calm, still legible in sun, clearly a chip.
- Signal tiles keep their semantic triad: `danger.soft` background with
  `danger.base` glyph for genuinely urgent destinations, `primarySoft` with
  `primary` for the promoted action.
- The `tint` map is for *categorical* colour where categories genuinely matter
  — a chart series, a status legend. It is not a decoration palette, which is
  how it came to be misused on Home.

**One accent per screen.** If green is the primary action, nothing else on that
screen is green.

**Never encode meaning in colour alone.** Colour-blind users and glare both
defeat it. Pair with an icon, a label or position.

---

## Cards and surfaces

- Use `Card` rather than hand-rolling a surface. It already carries the correct
  radius, hairline border, elevation pairing and the RTL-safe `accent` edge.
- `level={1}` is the default and correct for almost everything. `level={2}` for
  something genuinely lifted, like the primary CTA. `level={3}` is for sheets.
- Do not nest cards. A card inside a card means the grouping is wrong; use
  spacing or a `SectionHeader`.
- Radius consistency matters more than the specific value. `radius.xl` for
  cards, `radius.lg` for controls, `radius.md` for small chips, `radius.pill`
  for badges — pick from the scale and keep it uniform on a screen.

---

## Lists

- `FlatList` once a list can exceed roughly a screen and a half; `ScrollView`
  only for short, interactive, mixed content. Never nest a `FlatList` in a
  `ScrollView`.
- Memoise the row component. These devices are slow and these lists get long.
- Row height should be uniform where possible; ragged rows destroy scannability.
- Separators: prefer a gap over a rule. A hairline between every row is a lot of
  ink for a weak signal.
- Give `keyExtractor` a real stable id, never the index.

---

## Forms

- One column. Two-column form fields do not work at this width with gloves.
- Label above the input, not inside it as a placeholder — a placeholder
  disappears exactly when the user needs to check what they typed.
- Group into short sections with headers; a 20-field form is five groups of
  four.
- Validate on blur, not only on submit, and put the message directly under the
  field.
- The submit control should never be the thing the keyboard covers.
- Auto-fill everything the register already knows, and lock it *only once a
  value actually arrived* — a field locked while empty is unfillable.

---

## States

Four states, all of them real:

- **Loading:** skeletons where the shape is known (`SkeletonLoader`), because a
  skeleton communicates what is coming; a bare spinner communicates nothing.
- **Empty:** `EmptyState` with a title that says what is missing and, where
  there is one, an action to create the first item.
- **Error:** `ErrorState` with a retry. Distinct wording from empty — "we could
  not load this" is not "there is nothing here".
- **Partial / stale:** offline-first means data is often real but old. Say so
  rather than presenting it as live.

A screen that renders an error as an empty state is telling the user their data
is gone. That is the worst failure in this list.

---

## Motion recipes

Sparing, native-driven, 150–250ms.

- **List insert/remove:** `LayoutAnimation.configureNext` with a short easeInEaseOut
  before the state update. One line, big perceived quality gain.
- **Sheet / drawer:** slide plus fade, 200ms ease-out; scrim fades with it.
- **Press feedback:** `activeOpacity` around 0.8. Enough to feel, not enough to
  flash.
- **Value change on a KPI:** cross-fade, or nothing. Never a count-up on a
  screen someone reads all day.
- **Nothing loops.** A looping animation on a screen open for eight hours is a
  battery cost and an irritation.

Anything that cannot use `useNativeDriver: true` should probably not be
animated on these devices.

---

## Worked example: the Home quick-action grid

**Before.** 28 tiles across five sections. Each tile: a coloured icon chip
drawn from a seven-value `tint` map assigned per entry, a bold label, and a
muted sublabel. Tile `minHeight: 124` to fit two lines of label plus two of
sublabel. Grid `flexBasis: '30%'` with `flexGrow: 1`.

**What was actually wrong**
1. *Colour without meaning* (doctrine 1). Seven hues assigned for variety, so
   Accidents in red carried no more urgency than Reports in violet. The owner
   read this as "the icons are not correct".
2. *Additive clutter* (doctrine 3). The sublabel repeated what the label said
   on a control tapped dozens of times a week. The owner called it "commentary".
3. *No rhythm* (doctrine 4). One uniform gap, five equally-weighted sections.
4. *Ragged geometry* (doctrine 5). `flexGrow` on a `30%` basis stretches the
   last row's tiles to different widths than the rows above.

**The direction**
- Neutral icon chips by default; semantic colour reserved for the genuinely
  urgent destinations and the promoted action.
- Sublabels removed; any label left ambiguous by the removal gets a better
  label instead.
- Tile height reduced to fit the remaining content, so more fits above the fold.
- Fixed column count so every row aligns.
- The one green filled block on the screen stays the primary CTA.

The lesson generalises: the complaint named the icons, the defect was the
information architecture. Diagnose before you touch pixels.
