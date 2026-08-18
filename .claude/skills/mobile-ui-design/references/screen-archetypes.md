# Screen archetypes

Every screen in this app is one of seven shapes. Naming the shape before you
design tells you what the primary action is, what can be cut, and which failure
mode to guard against — so you are not inventing a layout from nothing.

Read the entry for the archetype you are working on. If a screen genuinely
belongs to two archetypes it is usually two screens.

---

## 1. Hub / launcher

**Examples:** `(app)/index.tsx` (Home), `admin/index.tsx`

**Job:** get someone to the thing they came to do, in one tap, without reading.

**Shape**
- Identity strip: who, when, and anything urgent about *them* (unsynced work,
  unread notifications). Small.
- At most one KPI row — three tiles, numbers only.
- **One** primary call to action, visually dominant, for the job this role does
  most. On Home that is Start New Inspection, and it is the one place a large
  filled green block is correct.
- A grid of destinations, grouped under quiet section labels, in a consistent
  rhythm.

**Primary action:** the single most-repeated task for that role.

**Failure modes**
- Every tile equal weight, so nothing is a destination — it becomes a menu, and
  a menu of 28 items is a wall.
- Tiles carrying explanatory sublabels. On a hub the label *is* the explanation.
- Colour assigned per tile for variety. See doctrine rule 1.
- The grid growing without bound as modules are added. If one role sees more
  than roughly a dozen tiles, group harder or put the long tail behind a
  disclosure — but never hide something a role needs daily.

**Watch for:** access gating. Tiles are filtered by `canAccess(module)`; a
section renders only when it has at least one visible tile. Do not break that,
and do not let a role end up with a screen that looks empty.

---

## 2. Register / list

**Examples:** `records/index.tsx`, `vehicles.tsx`, `workorders/index.tsx`,
`history.tsx`, `alerts.tsx`, `checklists/history.tsx`

**Job:** find one row among many, then act on it.

**Shape**
- Search pinned at the top, always reachable, never behind a menu.
- Filters as chips directly under search when there are few; behind a sheet with
  an active count when there are many. A filter the user cannot see is a filter
  they will not use.
- Rows: one strong identifier, one line of supporting meta, one status. Three
  levels of information, not five.
- Result count stated honestly, including when it is truncated.

**Primary action:** open a row. Everything else is secondary.

**Failure modes**
- Rows dense with six fields at equal weight, so scanning fails. Pick the one
  field the user searches by and make it dominant.
- Status shown as a coloured row background — it fights the text and destroys
  scannability. Use `Badge`.
- No empty state, or an empty state that cannot be told apart from a failed
  load. These are different sentences.
- Unmemoised rows. These lists get long and the devices are slow; use
  `FlatList` and memoise the row.

---

## 3. Record detail

**Examples:** `accident/[id].tsx`, `inspection/[id].tsx`, `accident/case.tsx`

**Job:** understand one record fully, and act on it.

**Shape**
- Header: what this is, its current state, and the one action available now.
- Body grouped into labelled sections in the order someone actually reads them
  — identity, then status, then evidence, then history.
- Long or rarely-read sections collapsed by default.
- Actions at the bottom or pinned, never scattered through the body.

**Primary action:** whatever moves the record to its next state. Exactly one
should be prominent; a record in "pending approval" offers Approve, not a row
of six equal buttons.

**Failure modes**
- A flat wall of label/value pairs with no grouping.
- Every field rendered even when empty, so the screen is half dashes. Omit
  empty groups, or say plainly that nothing was recorded — those differ.
- Destructive actions sitting next to routine ones.

---

## 4. Capture form

**Examples:** `inspection/new.tsx`, `accident/report.tsx`, `meter-logs.tsx`,
`washing.tsx`, `tyre-change.tsx`, `report-issue.tsx`,
`checklists/[templateId].tsx`

**Job:** get accurate data out of someone standing in the sun wearing gloves.

**Shape**
- Identify the asset **first**. Scan or search, then everything the register
  already knows auto-fills and locks. Asking someone to retype what the system
  knows is both slower and less accurate.
- Group fields into short labelled steps. Progress visible when there is more
  than one step.
- Big inputs, big targets, numeric keyboards for numbers.
- Submit is always reachable and always says what will happen.

**Primary action:** submit. It should be impossible to lose work reaching it.

**Failure modes**
- Duplicate entry: asking for the asset in a header block *and* again inside
  the template. This shipped, and the owner reported it. Derive the fields from
  the template rather than hardcoding a header.
- A field locked unconditionally when the register only sometimes has a value —
  then it is permanently blank and unfillable. Lock only once a value actually
  arrived.
- Validation that only appears on submit, after scrolling.
- No draft. Field work gets interrupted; a form that loses everything on
  backgrounding will be worked around, not used.

---

## 5. Approval queue

**Examples:** `inspection/approvals/index.tsx`, `checklists/approvals/index.tsx`,
`admin/approvals.tsx`, `tasks.tsx`

**Job:** clear a stack of decisions quickly and without mistakes.

**Shape**
- Count first: how many are waiting, and how long the oldest has waited.
- Each item shows only what is needed to decide — not the whole record.
- Approve and Reject visually distinct and physically separated.
- After deciding, the user **stays in the queue**. Bouncing them out after every
  signature makes a ten-item queue ten round trips, and this exact defect was
  reported twice.

**Primary action:** decide the top item.

**Failure modes**
- Sending the user Home when they lack access, so a refusal looks like a crash
  or an infinite spinner. Render a refusal that says so; do not navigate away.
- Approve and Reject the same size, same weight, side by side.
- No optimistic update, so the list appears frozen after a decision.

---

## 6. Dashboard / KPI

**Examples:** `overview.tsx`, `analytics/index.tsx`, `accident/dashboard.tsx`

**Job:** answer "is anything wrong?" in about five seconds.

**Shape**
- Headline numbers first, largest type on the screen, three to six of them.
- Then the exceptions — what is overdue, critical, unassigned. This is the part
  people actually came for.
- Then breakdowns.
- Every figure states its window and its scope. A number with no period is not
  a measurement.

**Primary action:** drill into the exception.

**Failure modes**
- A zero rendered where the truth is "we could not read this". Distinguish
  them; a false zero on a safety metric reads as good news.
- Charts before numbers. On a phone in the sun, a number wins.
- Colour on every tile, so the one genuinely alarming figure does not stand out.
- No period label, so the same screenshot means different things next month.

---

## 7. Search / picker

**Examples:** `serial-search.tsx`, `scanner.tsx`, asset pickers inside forms

**Job:** resolve a code or a name to one record, fast, often one-handed.

**Shape**
- Input focused on mount, with the scan affordance immediately beside it.
- Results begin appearing as they type; do not require a submit.
- Show the top results with enough context to pick confidently — a bare code is
  not enough when codes repeat across countries.
- State how many matched, and say plainly when the list is truncated.

**Primary action:** pick a result. Scanning is a faster route to the same end,
not a separate feature.

**Failure modes**
- Requiring a minimum character count before showing anything, so someone who
  does not know the code sees a blank screen and concludes the asset is
  missing. This shipped once.
- Client-side filtering over a server-capped page, which silently hides matches
  past the cap.
- A no-match state that does not say what to do next.

---

## Choosing when a screen is genuinely new

If it does not fit one of these, ask whether it is really two screens, or
whether an existing archetype with a different primary action would serve. A
new shape is occasionally right — but it costs the consistency that makes the
rest of the app feel finished, so it should earn that cost explicitly.
