# 08. Checklist engine parity tests

Artifact 8 of the nine required by section 75 of the Flutter migration spec.
Covers spec sections 28 (dynamic checklists), 29 (conditional logic), 30 (auto
values), 31 (approval), 18 (drafts), 21 (signatures) and Phase 6 of section 67.

This is the parity SPECIFICATION for the dynamic checklist engine. It is written
so a Flutter engineer can produce the Dart tests without reading the TypeScript.
Every rule carries the file and line that proves it.

## Confidence key

| Mark | Meaning |
|---|---|
| VERIFIED | Read directly from source in this repo (mobile/web source, or a MIGRATIONS_V*.sql) |
| RECORDED | A measured live figure or a decision quoted from PROJECT_MEMORY |
| UNVERIFIED | Needs a live database check. The Supabase connector was unauthenticated when this was written |

Everything below is VERIFIED unless marked otherwise.

---

## 0. The shape of the thing, and the four copies of it

A checklist template is a row whose `fields` column is a jsonb ARRAY of field
objects. A submission is a row whose `answers` column is a jsonb OBJECT keyed by
field id. There is no per-field table and no join: the template supplies labels
and order, the answers supply what was recorded.

The same engine exists FOUR times today, and Flutter becomes the fifth:

| Copy | File | Role |
|---|---|---|
| Web registry | `src/lib/checklist/fieldTypes.js` | The catalogue. Builder + runtime + read-only rendering |
| Mobile runtime | `mobile/lib/checklistFields.ts` | A deliberate independent port of the runtime subset |
| Mobile marks | `mobile/lib/checklistMarks.ts` | Blocking marks, meter groups, auto-fill. Mirror of `src/lib/checklist/checklistMarks.js` |
| Database | `guard_checklist_approval_stages()` + `decide_checklist_approval()` | The only copy that can refuse anything |

**Two of the four are pinned by drift tests that read the other file's SOURCE
TEXT and fail on divergence.** `src/test/checklistMarks.test.js:243-263` compares
mark tokens, exported function names and auto-fill source tokens across
`checklistMarks.js` and `checklistMarks.ts`. `src/test/checklistApproval.test.js:142-188`
does the same for the approval ladder AND compares the role arrays against the
SQL helpers.

**`checklistFields.ts` is deliberately NOT pinned.** Its header states the two
stacks "intentionally keep independent copies (as with auditDiff)"
(`mobile/lib/checklistFields.ts:5-6`). The consequence for Flutter is that the
field engine is the one place where copying behaviour is a judgement call rather
than a mechanical mirror, so the test list in section 10 has to be the contract
instead.

**Rule for Flutter: build ONE checklist domain library, pure, no widgets, no
Supabase, and mirror the two SQL predicates in it.** Spec section 29 says the
same thing about conditional evaluation and it applies to the whole engine.

---

## 1. Field type registry

Source of truth: `src/lib/checklist/fieldTypes.js:29-45` (`FIELD_TYPES`), mirrored
as a union type at `mobile/lib/checklistFields.ts:20-22`. Both stacks declare
**14 types** and they agree exactly.

| Type | Group | Answer shape stored in `answers[fieldId]` | Blank value | Validation |
|---|---|---|---|---|
| `section` | layout | NONE. Renders no answer | n/a | Always valid. `validateAnswer` returns null immediately (`fieldTypes.js:301`) |
| `text` | input | `string` | `field.default ?? ''` | required |
| `textarea` | input | `string` | `field.default ?? ''` | required |
| `number` | input | `string` as typed, coerced with `Number()` at validation | `''` | required, NaN, `min`, `max` |
| `select` | choice | `string`, the ENGLISH option value | `field.default ?? ''` | required, membership in the resolved option set |
| `multiselect` | choice | `string[]` of ENGLISH option values | `[]` | required, every element must be in the resolved option set |
| `boolean` | choice | `true` / `false` / `null` | `null` | required only |
| `date` | input | `string`, ISO `YYYY-MM-DD` | `field.default ?? ''` | required only |
| `rating` | choice | `number` 0..5 | `0` | required, then `0 <= n <= 5` |
| `asset` | reference | `string`, the asset number | `field.default ?? ''` | required only. Options are LIVE, never hand-listed |
| `site` | reference | `string`, the site name | `field.default ?? ''` | required only |
| `user` | reference | `string`, a display name (`full_name \|\| username`) | `field.default ?? ''` | required only |
| `photo` | media | NONE in `answers`. Photos live in `photos[fieldId]` as `string[]` | n/a | Skipped by `validateSubmission` entirely |
| `signature` | media | NONE in `answers`. Signatures live in `signatures[fieldId]` as a `string` | n/a | Skipped by `validateSubmission`, then validated separately by `validateSignatures` |

**LAYOUT types: exactly one, `section`.** `isLayoutField(type)` is
`type === 'section'` and nothing else (`fieldTypes.js:140-142`,
`checklistFields.ts:104-106`). `src/lib/checklistView.js:27-29` deliberately
DELEGATES to it rather than keeping a second list, with the reason stated in the
comment: a local list "would silently start disagreeing with the builder the day
a type is added". Flutter must do the same - one predicate, one home.

**A third category exists and is not the same as layout.** `isValueField(type)`
excludes `section`, `photo` AND `signature` (`fieldTypes.js:146-148`). So the
three-way split is:

- `section` - renders nothing, stores nothing
- `photo` / `signature` - renders a capture control, stores OUTSIDE `answers`
- everything else - stores in `answers`

Mobile adds a fourth predicate the web does not have: `isRecordableField(type)`
is `type !== 'section'` (`checklistFields.ts:115-117`), which is what drives the
tappable-tile list and the progress counter. Photo and signature ARE recordable
even though they are not value fields.

### Spec section 28 reconciled against the registry

Spec 28 lists 14 capabilities. Nine map one-to-one. Five do not, and each
mismatch matters:

| Spec 28 says | Registry reality | Verdict |
|---|---|---|
| text | `text` | maps, but see `textarea` below |
| number | `number` | maps |
| **date/time** | `date` only | **PARTIAL. There is NO time type and NO datetime type.** A `date` answer is an ISO calendar date. Flutter must not build a time picker for a type that does not exist |
| yes/no | `boolean` | maps |
| choice | `select` | maps |
| multi-select | `multiselect` | maps |
| photo | `photo` | maps |
| signature | `signature` | maps |
| asset reference | `asset` | maps |
| site reference | `site` | maps |
| user reference | `user` | maps |
| **auto-value** | NOT A TYPE | **It is the `autoValue` PROPERTY on any field** (`fieldTypes.js:176`). A date field with `autoValue: 'today'` is still a `date`. Modelling it as a type would break every existing template |
| **layout/display fields** | `section` only | **The plural is misleading.** One layout type exists |
| **conditional fields** | NOT A TYPE | **It is the `visibleWhen` PROPERTY on any field** (`fieldTypes.js:179`). Same correction as auto-value |
| (spec omits) | **`textarea`** | **The spec MISSES a real type.** Long text is a distinct type with its own control |
| (spec omits) | **`rating`** | **The spec MISSES a real type.** 1-5 score, validated 0..5, used for "Overall safety rating" in the field library (`fieldTypes.js:102`) |

**Rule for Flutter: the type enum has 14 members, and `autoValue` /
`visibleWhen` are field PROPERTIES, not members.**

### The full field object

Declared as an interface at `mobile/lib/checklistFields.ts:46-100`. Flutter's
model must round-trip every key, because a template is patched field-by-field by
migration and an unknown key dropped on read would be lost on any write.

Core (V123 era, `MIGRATIONS_V123_CHECKLIST_TEMPLATES.sql:13-16`):
`id`, `type`, `label`, `help`, `section`, `required`, `allow_photo`, `options`,
`min`, `max`, `default`.

Added since, all VERIFIED in the mobile interface:
`allow_note`, `options_ref`, `labels`, `options_i18n`, `visibleWhen`, `weight`,
`passValues`, `autoValue`.

The V595 workshop-sheet properties (`checklistFields.ts:72-99`), declared on the
interface specifically so a typo cannot ship silently:
`autoFrom`, `readOnly`, `locked`, `group_require_one`, `compareTo`, `unit`,
`require_note_when`, `allow_gallery`.

---

## 2. Answer storage contract

### The English-value invariant

**The stored answer is ALWAYS the English option value, whatever language it was
displayed in.** This is stated as "THE INVARIANT THAT MATTERS MOST, carried over
verbatim" at `mobile/lib/checklistI18n.ts:19-24`, and the reason given is that
"an answer whose meaning changes with the reader's language cannot be compared
across submissions, scored, exported or reported on".

It is enforced structurally rather than by discipline: every resolver returns
`{ value, label }` pairs (`checklistI18n.ts:104`, `FieldOption`), so a caller
cannot accidentally store the translation. `fieldOptions()`
(`checklistI18n.ts:114-127`) sets `value` from the untranslated list and `label`
from the translation, per index.

Two helpers exist for the two directions and must not be confused:

- `fieldOptionValues(field, template)` -> `string[]` of ENGLISH values. **Use
  this to VALIDATE** (`checklistI18n.ts:129-132`, the comment says so).
- `optionLabel(field, template, value, lang)` -> the display string for an
  already-stored English value. An unknown value renders AS ITSELF rather than
  blank (`checklistI18n.ts:135-140`).

The fill screen proves the split: `summaryFor()` at
`mobile/app/(app)/checklists/[templateId].tsx:1330-1345` localises the tile
summary through `optionLabel` precisely because "the stored value of a choice is
deliberately English".

### Shared option sets (`options_ref`)

A field may point at a shared legend on the template rather than carrying its
own list. Resolution order, from `checklistI18n.ts:114-121`:

1. `field.options_ref` looked up in `template.option_sets[ref]` - THE LIVE SOURCE
2. the field's own `field.options` + `field.options_i18n` - a FALLBACK

**The shared list wins, and the field's own copy is EXPECTED to drift.** The
mobile header quotes the builder's own words: the field's options are kept only
"as a fallback if that list is ever removed" (`checklistI18n.ts:14-18`). The bug
this caused is recorded in the same header: once an admin edited the shared
legend, "web users answered with the new vocabulary and phone users answered (and
were validated) against the old one. Two people filling 'the same' checklist
recorded different answers."

`optionSet()` returns null for a ref that names nothing OR names an empty list
(`checklistI18n.ts:96-102`), which is what makes the fallback reachable.

A SECOND resolver exists for the marks side with a different return shape:
`fieldOptionSet(template, field)` at `mobile/lib/checklistMarks.ts:89-96` returns
the whole `OptionSet` object (options, i18n, meta, blocking, require_note), not
just the values. Same precedence: shared ref first, own `options` second.
**Flutter needs both, because the marks engine needs `blocking` and
`require_note` which the i18n resolver does not carry.**

### Validation against the resolved set

`validateAnswer` takes `opts.options` = the RESOLVED English values, and falls
back to `field.options` only when the caller supplies nothing
(`checklistFields.ts:254-256`). **When NEITHER is known the membership check is
SKIPPED rather than rejecting** (`checklistFields.ts:252-253`) - refusing a valid
answer because we could not resolve the legend is worse than accepting an
unrecognised one.

### The columns

| Column | Type | Holds |
|---|---|---|
| `answers` | jsonb object | `{fieldId: value}`. NOT NULL DEFAULT `'{}'` (`V123:60`) |
| `photos` | jsonb object | `{fieldId: string[]}`. NOT NULL DEFAULT `'{}'` (`V123:61`) |
| `notes` | jsonb object | `{fieldId: string}` per-line remarks. **UNVERIFIED - see section 11** |
| `signatures` | jsonb object | `{fieldId: string}`. **UNVERIFIED - see section 11** |
| `signature_data` | text | The single PRIMARY sign-off (`V123:64`) |
| `printed_name` | text | Name beside the primary sign-off (`V123:65`) |

Mobile writes `signatures` and `notes` as `{}` rather than null when empty, and
says why: "the web viewer renders a missing key and an empty object identically,
and `{}` keeps the column's shape consistent with what the web writes"
(`mobile/lib/checklists.ts:324-328`).

---

## 3. Conditional visibility (`visibleWhen`)

### The rule shape

`field.visibleWhen` is one of three things (`fieldTypes.js:218-224`):

- `null` / absent -> always visible
- `{ field, op, value }` -> a single condition
- `[{...}, {...}]` -> ALL must hold. **AND only. There is no OR.**

`isFieldVisible` is `c.every(conditionMet)` for the array form
(`checklistFields.ts:199-204`).

### The operator set

Exactly ten, declared identically on both stacks (`fieldTypes.js:187`,
`checklistFields.ts:172`):

| Op | Semantics (`checklistFields.ts:174-191`) |
|---|---|
| `=` | `String(actual ?? '') === String(expected ?? '')`. **STRING comparison, so `5` matches `'5'`** |
| `!=` | The negation of the above |
| `>` `>=` `<` `<=` | Numeric. `''` and `null` coerce to `NaN`, and every comparison against `NaN` is false |
| `includes` | Array -> `actual.includes(expected)`. Otherwise `String(actual).includes(String(expected))` - a SUBSTRING test |
| `in` | `expected` is the array: `expected.map(String).includes(String(actual))`. A non-array `expected` degrades to `=` |
| `empty` | `null`, `''`, or `[]` |
| `not_empty` | The negation |

**`includes` and `in` are inverses of each other and are easy to swap.**
`includes` asks "does the ANSWER contain this value", `in` asks "is the ANSWER
one of these values". The comment at `fieldTypes.js:201-202` names the use case
for `in`: "this check applies to vehicle types X/Y/Z".

### Failing open

Three separate guards, all deliberate (`fieldTypes.js:211-215`):

1. no `cond`, no `cond.field`, or no `cond.op` -> visible
2. an op not in `COND_OPS` -> visible
3. `evalCondition`'s `default:` branch -> `true`

The reason is stated at `fieldTypes.js:221-223`: "A malformed/incomplete rule
fails open so a misconfigured template never hides everything."

### Section pruning

`visibleChecklistFields(fields, answers)` (`checklistFields.ts:212-224`, web
`visibleFields` at `fieldTypes.js:238-247`) does two passes:

1. drop every field whose `visibleWhen` is not satisfied
2. then drop any `section` whose NEXT surviving entry is another `section` or
   nothing at all

So an interval-scoped sheet never renders an empty "AXLE" or "BRAKE SYSTEM"
header. **The pruning is positional and runs on the ALREADY-filtered list** - a
section is judged by what survives after it, not by what the template declares
under it.

### What happens to a hidden field's ANSWER

**Nothing. It is retained and it is SUBMITTED.** Verified by reading the fill
screen: `visibleFields` is computed for rendering only
(`[templateId].tsx:790-793`), and the submit payload passes `answers` WHOLE
(`[templateId].tsx:1383`). There is no clearing path - the only `delete` on a
state map is `setFieldSignature` removing a cleared signature key
(`[templateId].tsx:774-780`).

Two other maps ARE pruned at submit and the asymmetry is deliberate:

- `notes` is rebuilt from `visibleFields` only, and only for fields with
  `allow_note` and a non-blank remark (`[templateId].tsx:1366-1371`)
- `signatures` is rebuilt from `signatureFields(template.fields)` - fields the
  template STILL HAS, regardless of visibility (`[templateId].tsx:1373-1377`)

### The rule that makes this hard, and the reason it is right

**Requirements respect visibility. The blocking check DOES NOT.**

`mobile/lib/checklistMarks.ts:139-155` carries the reasoning verbatim, and it is
the single most important comment in the engine:

- `missingNotes` and `unsatisfiedGroups` iterate `visibleAnswerableFields`
  (`checklistMarks.ts:156-158`) - "Demanding a remark, or a meter reading, on a
  line the operator cannot see is a demand they can never satisfy - the sheet
  simply refuses to submit and nothing on screen explains why."
- `blockingAnswers` iterates `answerableFields` - ALL of them
  (`checklistMarks.ts:166`) - because "`guard_checklist_approval_stages` scans
  the whole answers object and knows nothing about visibility, so if this side
  skipped a hidden field carrying a stale 'Not OK' the screen would say the sheet
  is closable and the server would then refuse it with a raw 22023 the approver
  cannot act on. Agreeing with the database matters more here than being clever."

This is confirmed against the SQL: the trigger's blocking scan is
`jsonb_each_text(coalesce(new.answers, '{}'::jsonb))`
(`MIGRATIONS_V595_WORKSHOP_DAILY_CHECKLIST.sql:280-282`) with no template
awareness at all.

RECORDED, and it is not hypothetical: the Predictive Maintenance template
already uses `visibleWhen` on 197 fields (`src/test/checklistMarks.test.js:206-207`).

**Rule for Flutter: two visibility policies, named differently, never unified.
`visibleAnswerableFields` for anything that DEMANDS, `answerableFields` for
anything that BLOCKS.**

### Test cases

Numbered in section 10, group C.

---

## 4. Auto values

There are TWO separate auto-fill mechanisms and they are unrelated. Flutter must
implement both and must not merge them.

### 4a. `autoValue` - context prefill

`AUTO_VALUES` is exactly two tokens (`fieldTypes.js:53`, `checklistFields.ts:34`):

| Token | Resolves to | Source |
|---|---|---|
| `current_user` | `ctx.userName \|\| ''` | the signed-in operator's display name |
| `today` | `ctx.today \|\| new Date().toISOString().slice(0,10)` | ISO `YYYY-MM-DD` |

`resolveAutoValue(field, ctx)` returns `''` for a field that is not auto
(`checklistFields.ts:38-42`). `isAutoField(field)` tests `field.autoValue`, NOT
`field.type` - `{ type: 'user' }` is NOT an auto field
(`src/test/checklistFieldTypes.test.js:150`).

**WHEN IT RESOLVES: once, at template open, and the field renders read-only.**
The registry comment says "prefills ... both render read-only"
(`fieldTypes.js:174-175`). Whether it re-resolves on a later edit is answered by
the draft engine rather than by the resolver: `hasDraftContent` is deliberately
strict BECAUSE "the fill screen SEEDS auto fields (today's date, the inspector's
own name) the instant a template opens"
(`mobile/lib/checklistDraft.ts:145-153`). So the seed happens on open, is stored
in `answers` like any other value, and a RESUMED draft restores the stored value
rather than re-resolving - `applyDraft` merges `d.answers` over current state
(`[templateId].tsx:1133`).

**Consequence Flutter must preserve: a sheet started yesterday and resumed today
carries YESTERDAY's date.** That is correct - it is the date the work was done -
and re-resolving would silently rewrite a record.

The field library wires two presets: "Inspector" carries `autoValue:
'current_user'` and "Date of check" carries `autoValue: 'today'`
(`fieldTypes.js:79-80`).

### 4b. `autoFrom` - register prefill

A completely separate token space, keyed on the picked ASSET rather than on the
user. `AUTO_FILL_SOURCES` is exactly eight tokens
(`mobile/lib/checklistMarks.ts:251-263`):

| Token | Reads |
|---|---|
| `asset.site` | `asset.site` |
| `asset.fleet_no` | `asset.fleet_number \|\| asset.registration_no` |
| `asset.registration` | `asset.registration_no \|\| asset.fleet_number` |
| `asset.chassis_no` | `asset.chassis_no \|\| asset.serial_no` |
| `asset.current_km` | `asset.current_km` |
| `asset.vehicle_type` | `asset.vehicle_type` |
| `asset.make` | `asset.make` |
| `asset.model` | `asset.model` |

The two fallback pairs are the owner's own rule, stated at
`checklistMarks.ts:254-256`: "the registration number IS the fleet number".

`resolveAutoFill` returns `''` for an unknown token - "a token this map does not
know resolves to nothing rather than to a guess" (`checklistMarks.ts:248-249`),
and for a blank or whitespace-only register value (`checklistMarks.ts:272`).

`autoFillAnswers(template, asset, current)` returns **ONLY the fields it filled**,
so the caller MERGES (`checklistMarks.ts:296-308`). The write rule is asymmetric
and load-bearing (`checklistMarks.ts:303-305`):

- a `readOnly` field ALWAYS takes the register value - that IS its source of truth
- an editable field fills only when the user has not typed already

### `isFieldLocked` - read-only is CONDITIONAL

`isFieldLocked(field, value)` (`checklistMarks.ts:285-289`):

- `field.locked` -> true always, whatever the value
- `field.readOnly` -> true ONLY once the value is non-blank
- otherwise false

RECORDED, and the measurement is the whole reason: `fleet_number` is populated on
398 of 1,030 KSA assets and on ZERO of the 452 UAE and 135 Egypt ones; chassis
389/0/0 (PROJECT_MEMORY, V595 session). An unconditionally read-only field would
be "permanently BLANK and unfillable for most of the fleet".

RECORDED: **km is deliberately NOT prefilled.** `current_km` is set on 248 of
1,030, and prefilling a stale figure invites submitting last month's reading.
`compareTo` WARNS on a lower reading and never blocks - `meterRegression(value,
previous)` returns false whenever either side is not a real number, because "we
have nothing to compare against" is not "the reading is wrong"
(`checklistFields.ts:390-405`).

---

## 5. Validation and completeness

### The two gates are different, and that is the design

**Submission and approval check DIFFERENT things.** RECORDED (PROJECT_MEMORY,
V595): "'NO ONE CLOSES UNTIL CORRECTED' IS ENFORCED IN THE DATABASE: the approval
trigger refuses `approved` while any answer carries a blocking mark ... **Checked
at APPROVAL, never at submit.**"

The reason, quoted in the mobile source header
(`mobile/lib/checklistMarks.ts:12-16`): "A mechanic who finds a fault on the last
item of the day must still be able to record it and go home; what must not happen
is that fault being signed off as done."

### The submit gate, in order

`handleSubmit` at `mobile/app/(app)/checklists/[templateId].tsx:1439-1511`. Five
steps, each returning early and each NAMING what is wrong:

| # | Check | Source | Behaviour on failure |
|---|---|---|---|
| 1 | `validateSubmission(fields, answers, {signatures, labelFor, optionsFor})` | `:1444-1453` | Sets per-field errors, SCROLLS to the first, alerts with THAT field's message |
| 2 | `unsatisfiedGroups` - the meter pair | `:1456-1465` | Alerts naming the group's field labels, scrolls to the first |
| 3 | `missingNotes` - a fault with no reason | `:1468-1478` | Sets per-field errors, scrolls, alerts naming the lines |
| 4 | template-level `require_signature` + printed name | `:1485-1494` | Alerts. Satisfied by the pad OR any signature field |
| 5 | `blockingAnswers` | `:1498-1508` | **CONFIRMS, never refuses.** "Submit anyway" proceeds |

**Step 5 is the one Flutter is most likely to get wrong.** A blocking mark shows
a two-button dialog listing the offending lines and submits on confirm. It is a
warning, not a gate.

**Rule for Flutter: the UI must name exactly what is missing.** Every gate above
either sets `errors[fieldId]` and scrolls to it, or interpolates the field labels
into the alert body. `validateAnswer` builds the message from the field's own
TRANSLATED label (`opts.label`, `checklistFields.ts:241`) so the error reads in
the same language as the line it points at. A generic "form invalid" is a
regression.

### `validateSubmission` semantics

`checklistFields.ts:317-336`, web `fieldTypes.js:374-392`. Identical:

1. skip `section`, `photo`, `signature` entirely (`:324`)
2. skip any field `isFieldVisible` says is hidden (`:325`)
3. run `validateAnswer` with the translated label and resolved options
4. IF `opts.signatures` was supplied, merge in `validateSignatures`

**The signature half is OPT-IN.** Omitting `opts.signatures` skips required
signature FIELDS "exactly as before, so no existing caller changes behaviour by
upgrading" (`checklistFields.ts:304-307`).

Returns `{ valid: boolean, errors: Record<fieldId, string> }`.

### `validateAnswer` order of checks

`checklistFields.ts:239-269`. The order is load-bearing:

1. layout field -> null immediately
2. compute `empty` = `null` OR `''` OR `[]`
3. `required && empty` -> "`<label>` is required"
4. **`empty` -> null.** An optional blank field skips EVERY later check
5. `number`: NaN -> "must be a number"; `< min` -> "must be at least N"; `> max` -> "must be at most N"
6. `select`: value not in the allowed set -> "Choose a valid option for `<label>`"
7. `multiselect`: any element not in the allowed set -> "Invalid option(s) for `<label>`"
8. `rating`: NaN or outside 0..5 -> "must be 0-5"

Note step 4: **a blank number field never reports a min violation.** `min: 1`
with an empty answer is VALID unless the field is also `required`.

### `group_require_one` - at least one of a named group

`meterGroups(template, answers)` builds a `Map<groupName, fields[]>` from
VISIBLE fields carrying `group_require_one` (`checklistMarks.ts:211-220`).
`unsatisfiedGroups` reports any group where no member has a non-blank answer
(`checklistMarks.ts:222-232`).

The satisfaction test is `v != null && String(v).trim() !== ''`
(`checklistMarks.ts:226-227`). **Zero IS a reading** - `String(0).trim()` is
`'0'`, which is non-empty. RECORDED (V595): 98 of 227 KSA transit mixers carry no
odometer while every one has engine hours, so requiring km would make the sheet
unfillable for them and requiring neither loses the reading.

### `require_note` and `require_note_when`

`missingNotes(template, answers, notes)` (`checklistMarks.ts:186-203`):

1. iterate VISIBLE answerable fields
2. skip any field with `allow_note === false` (note: `undefined` does NOT skip)
3. build the demand set = the option set's `require_note` UNION the field's own
   `require_note_when`
4. skip when the set is empty
5. skip unless the answer (or any element of an array answer) is in the set
6. report when `String(note ?? '').trim()` is blank

**Whitespace is not a remark** (`checklistMarks.ts:200`).

### Scoring

`computeScore(fields, answers, passThreshold)` (`checklistFields.ts:368-388`):

- only fields with a finite `weight > 0` count; a layout field never counts
- HIDDEN fields are excluded
- a field passes when its answer is in `passValues`, or - if `passValues` is
  empty - when the answer is merely non-empty
- an ARRAY answer passes when ANY element is in `passValues`
- `pct = Math.round(earned / possible * 100)`, or `null` when `possible === 0`
- `passed = pct >= passThreshold`, or `null` when either is null

Only computed at all when `template.scored` is true (`[templateId].tsx:1358`).

---

## 6. Signatures

### Signatures are a MAP keyed by field id

`mobile/lib/checklistFields.ts:7-17` records the bug this fixed at length, and
Flutter must not repeat it. The file used to take a single `signatureData:
string | null`:

> "a workshop sheet is signed off by three trades (mechanic, auto electrician,
> inspecting engineer) as three separate `signature` fields. With one slot,
> signing the second overwrote the first, only the last survived to the database,
> and `isFieldAnswered` returned true for EVERY signature field the moment any
> one of them was signed - so the progress counter read '3 of 3 done' with one
> signature captured."

`type Signatures = Record<string, string>` (`checklistFields.ts:124`).
`isFieldAnswered` for a signature reads `signatures?.[field.id]` and the comment
names the failure: "Reading a single shared value here is what made every
signature tile flip to 'done' as soon as one of them was signed"
(`checklistFields.ts:134-136`).

### The template flag versus the field

TWO separate requirements exist:

| Mechanism | Where | Satisfied by |
|---|---|---|
| `template.require_signature` | boolean column, `V123:34` | the standalone pad OR any signed signature field |
| `field.required` on a `signature` field | per field | THAT field only |

`requiresPrimarySignature(template)` is just `!!template.require_signature`
(`checklistFields.ts:352-354`).

`primarySignatureSatisfied(template, signatures, primary)`
(`checklistFields.ts:356-364`):
1. flag not set -> true
2. a non-empty `primary` string -> true
3. otherwise -> ANY signature field carrying a value

**Why the standalone pad exists at all**, quoted from `checklistFields.ts:338-351`:
the flag is on the template but the only way to capture a signature was a
signature FIELD, so "a template with the flag set and no such field was therefore
impossible to submit on mobile: the operator filled every line, pressed Submit,
was told a signature was required, and had no control anywhere on the screen that
could produce one. Work was lost on back-out."

The submit gate also demands a printed name when the flag is set - `printedName`
or the profile's `full_name` (`[templateId].tsx:1490-1493`).

### `validateSignatures`

`checklistFields.ts:282-299`. For each `signature`-type field with an id:

1. skip unless `f.required`
2. skip when `isFieldVisible` is false - **hidden signatures are exempt, exactly
   as for value fields**
3. a non-empty string in `signatures[f.id]` passes
4. otherwise `errors[f.id] = "<label> is required"` - **naming WHICH signature**

### Storage shape

Two formats are accepted, deliberately (`mobile/lib/savedSignature.ts:25-45`):

- `<svg` prefix - self-contained SVG markup, what the checklist pad emits
- `data:` prefix - a data URL, what the canvas pad emits

`normaliseSignature(value)` returns null for anything else, for a non-string, for
a blank, and for anything longer than `SIGNATURE_MAX_LEN = 200000`
(`savedSignature.ts:23`). That ceiling mirrors `user_signatures_len_chk` in V601
so "the screen offers to save something the server throws away" cannot happen.

Spec 21 asks for "vector points or SVG-like representation for durable
reconstruction". **The SVG path already satisfies that; the data-URL path does
not.** Flutter should emit SVG for new captures and must still RENDER both,
because both are already in the database.

### The saved signature, and the rule that pre-filling is not signing

RECORDED (PROJECT_MEMORY, V601, applied and verified live): "A person draws it
once and every later approval pre-fills it, visibly, with a one-click 'Draw a new
signature'. **Pre-filling is NOT signing: the mark is only placed in the pad and
the approve button still has to be pressed.**"

`resolveSignature({saved, drawn})` (`savedSignature.ts:65-73`) returns
`{value, source}` where source is `'drawn' | 'saved' | 'none'`. **A mark drawn
NOW always wins over the saved one** - "someone who has just taken the trouble to
redraw must not have it silently replaced by their old mark".

**The `source` is not decoration - it is what the screen prints**
(`savedSignature.ts:56-61`): a person has to be able to see that the mark about
to be attached is the one they saved earlier, "otherwise 'my signature came from
somewhere' is indistinguishable from 'the app signed for me'."

RECORDED, and it is why the signature lives in its own table: `profiles_select`
is `auth.role() = 'authenticated'`, so a signature image on `profiles` would hand
all 38 active users a copy of everyone's handwriting. `user_signatures` has one
rule - the row is mine.

**UNVERIFIED: the mobile checklist approval screen does not currently pre-fill
the saved signature.** `mobile/app/(app)/checklists/approvals/[submissionId].tsx`
holds `approverSig` as plain local state (`:87`) with no `resolveSignature` or
`getMySignature` call anywhere in the file. Flutter should wire it; confirm
against the web `ChecklistDecisionPanel` first.

### The primary sign-off on submit

`doSubmit` derives `primary = primarySignature || firstFieldSignature`
(`[templateId].tsx:1351-1354`) and writes it to `signature_data`, while the full
map goes to `signatures`. The web reader appends the primary to the rendered list
"only when no signature field already carries the same image, so a record is never
shown as signed twice by one person" (`src/lib/checklistView.js:324-336`).

---

## 7. Draft preservation

### A draft is NOT a row in `checklist_submissions`

This is the load-bearing decision and the header states it in capitals
(`mobile/lib/checklistDraft.ts:11-25`). V594 puts `stamp_checklist_document_no`
on BEFORE INSERT, so the document number is minted the moment a row is inserted
(`MIGRATIONS_V594_CHECKLIST_TWO_STAGE_APPROVAL.sql:116-139`). A server-side draft
row "would burn one on every started-and-abandoned sheet and leave permanent
holes in a numbered document register - which is worse than having no resume
feature at all".

**So a draft lives ON THE DEVICE and never touches the server.**

### Identity

`draftKey(userId, templateId, assetNo)` =
`` `${userId}|${templateId}|${normaliseAsset(assetNo)}` ``
(`checklistDraft.ts:131-133`), where `normaliseAsset` is `trim().toUpperCase()`
(`:121-123`).

Three properties follow, each with its own test:

- the same machine typed `' tm514 '` and `'TM514'` is ONE sheet
- two vehicles on one template are TWO sheets and never overwrite each other
- two users are always separate. `draftsForUser` returns `[]` for a blank user id
  (`:210-214`), so a shared handset can never hand one worker another's sheet

**The asset is very often picked AFTER work begins, so the sheet legitimately
changes key mid-fill.** `savedKeyRef` tracks the previous key and the migration
runs in a specific order: save under the NEW key first, then discard the old,
"so an interrupted migration leaves a duplicate rather than nothing"
(`[templateId].tsx:1244-1251`).

### Autosave triggers

Three, all in the fill screen:

| Trigger | Source | Detail |
|---|---|---|
| Debounced change | `[templateId].tsx:1259-1265` | **1200 ms** after any change to answers, photos, notes, signatures, primarySignature, printedName, assetNo, site, title or readLang |
| Backgrounding | `:1270-1279` | `AppState` `background` or `inactive` - immediate, not on a timer |
| Unmount | `:1275-1278` | The effect cleanup flushes |

Suppressed when `loading`, `submitting`, `draftClosedRef`, or nothing is dirty.

The debounce reason is stated: "every write goes to the Android Keystore over
binder IPC and hammering it on each keystroke is what caused the
permanent-spinner ANR this app has already been reported for"
(`:1230-1234`).

**The snapshot is assigned during RENDER, not in an effect**
(`[templateId].tsx:1095-1099`): "backgrounding can arrive before an effect has
run, and a flush that wrote the previous render's state would quietly lose the
last thing the operator recorded".

### What survives process death

`ChecklistDraft` (`checklistDraft.ts:88-115`): `key`, `userId`, `templateId`,
`templateName`, `assetNo`, `assignmentId`, `site`, `title`, `readLang`,
`answers`, `photos`, `notes`, `signatures`, `primarySignature`, `printedName`,
`filled`, `total`, `createdAt`, `updatedAt`.

`readLang` is stored so "a resumed sheet reads the same" (`:101`). `filled` and
`total` are progress as the SCREEN counted it - the module never re-derives it
(`:109-110`).

### Is there anything worth coming back to?

`hasDraftContent` (`checklistDraft.ts:154-162`) is **deliberately strict**:
`filled > 0` OR a primary signature OR any field signature OR any photo OR any
non-blank note. It does NOT test "are any answers non-blank", because the fill
screen SEEDS auto fields on open and "a draft judged by that would be written for
every template anybody merely looked at".

A save whose input has no content REMOVES any existing draft rather than storing
one (`:503-509`).

### Bounds and pruning

`MAX_DRAFTS = 25` (`:82`). `upsertDraft` sorts newest-first and slices, RETURNING
what it pruned so the caller can delete those photo files too (`:198-207`).

**Nothing is pruned by AGE** (`:79-81`): "a sheet abandoned for two months is
still the operator's work, and it is listed with its age so a person decides,
rather than the app deleting it quietly."

### Photos in drafts

**The trap, and it is the reason this section exists.** RECORDED and stated in
the header (`checklistDraft.ts:36-49`): the obvious store is `queued-photos/`,
and `sweepOrphanQueuedPhotos` runs after EVERY sync and deletes every file in
that folder that no live QUEUE entry references. **A draft is not a queue entry,
so the next sync would delete the operator's photos** - "turning a likely loss
into a certain one. That is the same trap a previous attempt at this fell into
and had to be reverted."

Draft photos therefore get their own folder, `checklist-drafts/`
(`checklistDraft.ts:72`), with their own sweep that reads a different folder and
a different list (`:362-384`).

Handling rules:

- `persistDraftPhoto(uri)` copies a `file://` cache path into the draft folder.
  An already-copied path returns UNTOUCHED, because "an autosave runs on every
  keystroke's worth of change - re-copying would write the same image dozens of
  times" (`:304-311`). A non-`file://` value passes straight through. A failed
  copy returns null and the caller DROPS that photo.
- `resolveDraftPhoto(stored)` heals an iOS container path change by looking for
  the same BASENAME in the current folder (`:329-352`).
- `restoreDraftPhotoMap` returns `{ photos, dropped }` and the count is SURFACED:
  "A dropped photo is a fact the operator has to be told, not a gap to paper
  over: carried on silently it would be submitted as a dead path and the sheet
  would report success with unreachable evidence" (`:404-408`).
- On submit the queue makes its OWN durable copy and only then is the draft copy
  deleted. "The two folders never share ownership of a file" (`:44-49`).

### The read rule

`readItem` answers `ok` / `absent` / `unreadable` / `torn`. Two readers exist and
the split is the whole safety property:

- `loadDrafts()` for DISPLAY never throws; an unreadable store returns
  `{ ok:false, status, drafts: [] }` so the screen can say "could not check",
  which "is a different statement from 'you have no unfinished work'"
  (`:447-458`)
- `loadForWrite()` for MUTATION THROWS `DraftStoreUnreadableError`
  (`:460-468`), so no caller can write an empty list over a full store

"The trade is deliberate and matches the queues: risk failing to save ONE
autosave tick rather than silently destroying the whole sheet" (`:62-63`).

Writes are SERIALISED through a promise chain (`:470-483`) because the autosave
timer and the backgrounding flush can fire milliseconds apart and each is a
read-modify-write over one shared blob.

### Clearing

`discardDraft` is called when the sheet is genuinely submitted, **INCLUDING an
offline submit** (`:539-546`): the work now belongs to the queue, which took its
own durable copy at enqueue, "and a draft left behind could be filled in and
submitted a second time". Only a submit that THREW keeps its draft
(`[templateId].tsx:1402-1406`).

Both the current key and any earlier key are discarded (`[templateId].tsx:1407-1414`).

### Resume

`resumeCandidates(list, {userId, templateId, assetNo})` (`:225-233`):

- with an asset known -> only THAT machine's sheet, because "offering another
  vehicle's would invite finishing the wrong one"
- with no asset yet -> every unfinished sheet for this template

The offer is answered ONCE per asset (`offerAnsweredRef`,
`[templateId].tsx:1076-1078`) and is NEVER shown once the operator has started
typing: "that would invite replacing live work with older work"
(`[templateId].tsx:1174-1177`).

`draftAge` returns a STRUCTURED `{unit, value}` rather than a formatted string,
because mobile `t()` takes no interpolation variables (`:243-252`). `unknown` is
its own answer - "a timestamp we cannot parse must not read as 'just now'".

---

## 8. Approval ladder

### The five statuses

`checklist_submissions.approval_status`, CHECK widened by V594 and by nothing
since (`MIGRATIONS_V594_CHECKLIST_TWO_STAGE_APPROVAL.sql:52-59`):

```
'not_required', 'pending', 'pending_area_manager', 'approved', 'rejected'
```

Default `'not_required'` (`MIGRATIONS_V212_CHECKLIST_APPROVAL.sql:21`).

Seeded on submit as `template.require_approval ? 'pending' : 'not_required'`
(`mobile/lib/checklists.ts:333`).

**There is no `draft` status.** `checklist_submissions.status` is a SEPARATE
column with its own CHECK `('draft','submitted','approved','rejected')`
(`V123:59-60`) and mobile always writes `'submitted'`
(`mobile/lib/checklists.ts:320`). Do not conflate the two columns.

### The two rungs

`APPROVAL_STAGES` (`mobile/lib/checklistApproval.ts:43-62`) - exactly two:

| Key | Label | Roles that may act |
|---|---|---|
| `supervisor` | "Supervisor sign-off" | Admin, Maintenance Supervisor, Workshop Supervisor, PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager, Tyre Data Collector |
| `area_manager` | "Area manager approval" | Admin, Director, PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager |

These mirror the SQL helpers `checklist_is_supervisor()` and
`checklist_is_area_manager()`, and `src/test/checklistApproval.test.js:160-188`
PARSES the migrations and asserts the arrays match.

`checklist_is_supervisor()` has FOUR versions across migrations. The current one
is `MIGRATIONS_V606_CHECKLIST_DATA_COLLECTOR_APPROVAL.sql:28-36`. Lineage:

| Migration | Change |
|---|---|
| V594:142-148 | Admin, Manager, Director, Maintenance Supervisor, Fleet Supervisor, PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager |
| V599:49-60 | + Workshop Supervisor |
| V600:79-86 | **- Manager, - Director, - Fleet Supervisor** |
| **V606:28-36** | **+ Tyre Data Collector. CURRENT** |

`checklist_is_area_manager()` is defined ONCE, `V594:150-155`, and never changed.

**The test that reads these must keep the LAST definition, not the first.** The
existing test says so and explains the trap: `lastIndexOf` on the bare function
name lands on the ROLLBACK COMMENT at the end of each file and then reads the
next array it finds, "which belongs to a different function entirely" - so it
anchors on `create or replace function public.<fn>()`
(`src/test/checklistApproval.test.js:174-183`).

RECORDED (V600): **Admin and Director are on the CLOSING rung deliberately.**
Exactly one person holds an area-manager role, "and a closing rung nobody else
can reach jams the moment they take leave. The migration ABORTS if Director is
removed from it."

RECORDED (V600): a Manager signs NOTHING. That was the tightening.

### The state machine

`stageFor(template, submission)` reads the SUBMISSION's own status, not its
position in a queue (`checklistApproval.ts:81-86`):

| `approval_status` | stage |
|---|---|
| `pending` | `supervisor` |
| `pending_area_manager` | `area_manager` |
| anything else | `null` |

`nextStatusFor(template, submission, approved)` (`:89-95`):

| Input | Result |
|---|---|
| `approved === false` | `'rejected'` - **at EITHER rung** |
| stage `supervisor` AND `isTwoStage` | `'pending_area_manager'` |
| any other stage | `'approved'` |
| no stage at all | the submission's existing status |

`isTwoStage(template)` is `Boolean(template.require_area_manager)`
(`:72-74`). Single-stage: `pending -> approved`. Two-stage:
`pending -> pending_area_manager -> approved`.

`canActOnStage(stage, role, {isSuperAdmin})` (`:97-103`): a super admin always
passes; otherwise the stage's role list is compared through `normaliseRole`,
which folds to lowercase and replaces runs of space or hyphen with underscore
(`:68-70`). **A raw compare matches NOTHING** - the DB stores `'Tyre Man'` and
this app's `UserRole` is `'tyre_man'`.

`canDecide` is `stageFor` then `canActOnStage`; a finished sheet returns false
because there is no stage (`:106-109`).

### What a rejection does

`nextStatusFor(..., false)` -> `'rejected'` regardless of rung. Client-side
(`mobile/lib/checklists.ts:456`, `:479`, `:482`):

- the signature is DROPPED (`input.approved ? sig : null`)
- `review_note` is written only on a rejection
- `locked` is false, because `status !== 'approved'`

The approval screen REFUSES a rejection with no reason
(`approvals/[submissionId].tsx:231-237`).

Server-side the trigger requires `checklist_is_supervisor()` to reject, with
errcode `42501` (`V595:253-257`).

### Rung columns - one person must not look like two

`decideApproval` writes ONE column set, chosen by the TARGET status
(`mobile/lib/checklists.ts:461-473`):

- target `pending_area_manager` -> `supervisor_name`, `supervisor_signature`,
  `supervisor_by`, `supervisor_at`
- anything else -> `approver_name`, `approver_signature`, `approved_by`,
  `approved_at`

"Writing both would make one person look like two" (`:459-460`).

`locked = (status === 'approved')` (`:482`) - "A supervisor sign-off must leave
it editable, because the area manager may send it back."

### Progress visualisation

`approvalProgress(template, submission)` (`:119-145`) returns 1 rung for a
single-stage template and 2 for a two-stage one. On a SINGLE-stage sheet the
first rung is filled from the APPROVER columns and labelled "Approval"; on a
two-stage sheet it is filled from the SUPERVISOR columns and labelled "Supervisor
sign-off". Each rung carries `{key, label, name, signature, at, done, current}`
so the panel can be opened and the signature looked at.

`statusSummary` (`:161-167`) says WHO is holding it rather than "pending":

| Status | Tone | Text |
|---|---|---|
| `approved` | good | "Closed" |
| `rejected` | bad | "Sent back" |
| `pending_area_manager` | warn | "Waiting for the area manager" |
| `pending` (two-stage) | warn | "Waiting for a supervisor" |
| `pending` (single) | warn | "Waiting for approval" |
| anything else | muted | "No approval needed" |

`isFullyClosed` is `approval_status === 'approved'` and nothing else
(`:148-150`) - "Closed means CLOSED - not 'a supervisor looked at it'."

### Document numbering

Minted by `stamp_checklist_document_no()` on **BEFORE INSERT** on
`checklist_submissions` (`V594:116-139`). Rules:

- an already-populated `document_no` is left alone
- a null `template_id`, or a template with a blank `doc_prefix`, mints NOTHING
- otherwise `next_checklist_document_no(org, prefix, asset_no, year)` runs, with
  year from `coalesce(new.submitted_at, now())`

`next_checklist_document_no` (`V594:86-111`) upserts into
`public.checklist_doc_counters`, primary key
`(organisation_id, prefix, asset_no, year)`, and returns:

```
UPPER(TRIM(prefix)) || '-' || asset || '-' || year || '-' || lpad(seq, 4, '0')
```

e.g. `WDC-TM514-2026-0001`. **The asset is NORMALISED** `upper(btrim(...))`, and
a blank asset collapses to the literal `'GEN'` so a sheet not about one machine
is still referenced. RECORDED (V594), proven live: a second sheet written
`' TM514 '` became `-0002`, not a parallel series.

`MIGRATIONS_V596_CHECKLIST_FUNCTION_GRANTS.sql:22` revokes
`next_checklist_document_no` from `public, anon, authenticated` - RECORDED, it is
DEFINER and takes `p_org`, so any signed-in user could otherwise increment
another tenant's counter. The trigger still reaches it through OWNERSHIP.

**Flutter never mints a number and never sends one.** Read `document_no` back
after the insert. `submissionReference()` returns null rather than a blank so the
screen can say "not numbered" (`mobile/lib/checklists.ts:702-711`).

### WHAT THE DATABASE ENFORCES, and what only the client does

This table is the most important thing in this artifact. A Flutter client must be
neither looser nor tighter than the server.

`guard_checklist_approval_stages()` is a BEFORE UPDATE trigger on
`checklist_submissions` (`V594:236-239`), body currently
`MIGRATIONS_V595_WORKSHOP_DAILY_CHECKLIST.sql:234-310`. It returns immediately
when `approval_status` did not change (`V595:245`).

| Rule | Enforced by DB | Enforced by client | Errcode / message |
|---|---|---|---|
| Reject requires supervisor role | YES `V595:253-256` | YES `canDecide` | `42501` "You do not have permission to reject this checklist" |
| `pending_area_manager` on a template that has no such rung | YES `V595:259-261` | YES `nextStatusFor` never produces it | `22023` "This checklist does not use an area-manager stage" |
| Supervisor rung requires supervisor role | YES `V595:262-264` | YES | `42501` "Only a supervisor can sign off this checklist" |
| Supervisor rung requires a name AND a signature | YES `V595:265-268` | YES `approvals/[submissionId].tsx:217-230` | `22023` "A supervisor name and signature are required" |
| **A blocking mark refuses `approved`** | **YES `V595:278-286`** | ADVISORY only | `22023` "This checklist still has items marked \"%\". It cannot be closed until they are corrected or re-marked." |
| Two-stage close requires a prior supervisor signature | YES `V595:288-291` | YES via `stageFor` | `22023` "A supervisor must sign off before the area manager can approve" |
| Two-stage close requires area-manager role | YES `V595:292-294` | YES | `42501` "Only an area manager can give final approval" |
| Single-stage close requires supervisor role | YES `V595:295-296` | YES | `42501` "You do not have permission to approve this checklist" |
| Close requires an approver name AND signature | YES `V595:298-302` | YES | `22023` "An approver name and signature are required" |
| Rejection requires a REASON | NO | YES `approvals/[submissionId].tsx:231-237` | client-only |
| `locked` set on close | client writes it; trigger does not | YES `checklists.ts:482` | client-only |
| `approved_by` / `approved_at` defaulted | YES `V595:303-304` `coalesce(..., auth.uid())` | client also sends them | both |

**Rule for Flutter: mirror every DB refusal in the client so the reason can be
explained BEFORE somebody signs, and treat the DB message as the fallback, never
the primary UX.** The mobile approval screen does exactly this: it computes
`closing = nextStatusFor(...) === 'approved'` and only then runs `canClose`
(`approvals/[submissionId].tsx:199-204`), so an outstanding fault blocks the
CLOSING rung and not the supervisor rung.

### The RPC versus the queued table write

`decide_checklist_approval(p_submission_id uuid, p_decision text, p_note text
default null, p_signature text default null)` returns jsonb, SECURITY DEFINER,
`search_path = public`. Current body
`MIGRATIONS_V597_DECIDE_CHECKLIST_APPROVAL_TWO_STAGE.sql:29-126`. It resolves the
rung itself from the template plus the row's own status (`V597:57-86`), refuses a
missing signature (`V597:91-93`), and carries an optimistic-concurrency guard -
its UPDATE has `and approval_status = v_status`, and `if not found` raises "This
checklist was decided by someone else while you were looking at it"
(`V597:114-118`).

**The mobile app does NOT call it.** `decideApproval` enqueues a
`CHECKLIST_APPROVAL` command, which is a blind `update` on
`checklist_submissions` matched by `id`
(`mobile/lib/checklists.ts:475-483`; command spec in artifact 06 section 2).

Artifact 06 section 4 already classifies this as the single most important
finding in the offline registry and rules it SHOULD BE ONLINE-ONLY. This artifact
adds the mechanism: the queued path skips `V597`'s concurrency guard and its
"already decided by X" message entirely, leaving the trigger as the only defence
- and the trigger cannot tell a stale replay from a fresh decision, because it
only sees the new row.

**Rule for Flutter: route every checklist decision through
`decide_checklist_approval` while online, and refuse to queue one.**

---

## 9. Targeting - how a template reaches a user

Three independent mechanisms. All three must be implemented.

### 9a. `checklist_templates.assignee_roles`

Added by `MIGRATIONS_V591_CHECKLIST_ROLE_TARGETING.sql:89-90` as `text[]`,
**NULLABLE, with NO DEFAULT**.

**NULL or empty means EVERY ROLE.** The column comment says so
(`V591:92-96`) and the migration explains the choice (`V591:29-40`): "A narrowing
column that defaults to hiding would have silently taken the three published
checklists away from the 17 Tyre Men who use them the moment it shipped."
Verified after apply: `assignee_roles is not null` matched 0 rows.

It is `text[]` and not `text` on purpose: "a workshop sheet is for the mechanics
AND the electricians, while the daily vehicle check is for the drivers alone."

**The `'{}'` hazard.** An empty array reads as "targeted at nobody" and would
hide the sheet from the whole fleet, so every migration write APPENDS to a
non-empty array and is guarded with `and assignee_roles is not null`
(`MIGRATIONS_V599_WORKSHOP_SUPERVISOR.sql:63-65`, `:77`, `:85`).
`normaliseAssigneeRoles` on the web returns null, NEVER `[]`.

**It is TARGETING, not a security boundary.** The comment says so
(`mobile/lib/checklists.ts:86-93`): templates are already walled by org and
country RLS, and a published template is a list of questions with no PII. The
filter therefore runs CLIENT-side.

### 9b. The role-vocabulary trap

**This is the defect that would have made the whole feature reach nobody.**

The database stores `profiles.role` in Title Case (`'Tyre Man'`) while the app's
`UserRole` is `'tyre_man'`. A raw string compare between the two matches NOTHING,
"so a targeted checklist would silently disappear for exactly the person it was
written for" (`mobile/lib/checklistRoles.ts:8-13`).

`normaliseRoleKey(role)` = `String(role).trim().toLowerCase().replace(/[\s-]+/g,
'_')` (`checklistRoles.ts:33-35`). **Both sides fold before comparing.** The
approval ladder has its own identical `normaliseRole`
(`checklistApproval.ts:68-70`).

RECORDED (V600): the mobile `normaliseRole` in `types.ts` "silently turns any
unlisted role into 'reporter', and EVERY supervisory role was missing", so the
PMV Manager and the Workshop Maintenance Area Manager - two real people - were
seen as reporters. **Flutter must not have an unlisted-role-becomes-reporter
fallback without a test that enumerates every DB role.**
`mobile/__tests__/whoSigns.test.ts:14-31` is that test.

### 9c. `templateAllowsRole`

`checklistRoles.ts:63-71`, in order:

1. `templateTargetsEveryone(template)` -> true. Covers NULL, non-array and `[]`
2. `isOversightRole(role, {isSuperAdmin})` -> true. Oversight is Admin, Manager,
   Director (`:31`), plus any super admin
3. a blank/unknown role key -> **false**. "An unknown role (profile still
   loading) does NOT match a targeted template - the list re-renders as soon as
   the profile arrives" (`:57-61`)
4. otherwise the normalised key must be in the template's normalised list

`CHECKLIST_TRADE_ROLES` (`:18-25`) is the shortlist the builder offers: Mechanic,
Electrician, Driver, Tyre Man, Inspector, Maintenance Supervisor.

`roleTargetLabel(template)` returns the RAW names joined, or **null when the
template is for everyone so the screen renders nothing** (`:100-105`).

### 9d. Assignments and schedules

`checklist_assignments.assignee_role` is a SINGLE nullable `text`
(`MIGRATIONS_V124_CHECKLIST_SCHEDULES.sql:54`), inherited from the schedule that
generated the row. `assignmentAllowsRole` (`checklistRoles.ts:84-91`): a null
target means anyone may pick it up; an oversight role always passes; otherwise
the keys must match after normalisation.

`checklist_assignments.status` CHECK: `pending`, `completed`, `overdue`,
`skipped`, default `pending` (`V124:57-58`).

`checklist_schedules` has `cadence` CHECK `daily`, `weekly`, `monthly`, `once`
(`V124:24-25`), `sites text[]`, `asset_nos text[]`, a singular `assignee_role`,
and `active boolean` as its state - **there is no `status` column on schedules**.

RECORDED: `checklist_schedules` held ZERO rows when V591 was written, which is why
the singular `assignee_role` "was never usable".

### 9e. The recurrence warning

`recurrenceNotice(last, minIntervalDays)` (`checklistMarks.ts:317-330`) returns
null unless `minIntervalDays` is a finite number greater than zero, `last.found`
is exactly `true`, and `days_ago` is a finite number below the interval.
Otherwise it returns `{early, daysAgo, minIntervalDays, dueInDays, documentNo}`.

**ADVISORY by design: it warns, it never refuses** (`:313-316`). A genuine early
inspection - a breakdown, a machine going out on hire - must still be recordable,
and the phone may be offline and unable to ask at all. `getLastSubmission`
resolves to null on any failure because "we could not look" is not the same as
"it is not due" (`mobile/lib/checklists.ts:487-508`).

---

## 10. The parity test suite

Every case below is a Dart test a Flutter engineer can write from this document
alone. "Proof" cites the file and line that establishes the expectation. Where an
existing TypeScript test already asserts it, that is cited instead, because a
ported test that disagrees with the original is the bug this suite exists to
catch.

### Group A - the field type registry (10 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| A1 | the registry declares 14 types | `FIELD_TYPES` | contains section, text, textarea, number, select, multiselect, boolean, date, rating, asset, site, user, photo, signature; length 14 | `fieldTypes.js:29-45`; `src/test/checklistFieldTypes.test.js:11` |
| A2 | only select and multiselect carry options | `typeHasOptions(t)` for every t | true for select, multiselect; false for the other 12 | `fieldTypes.js:34-35`, `:135-137` |
| A3 | section is the only layout type | `isLayoutField(t)` for every t | true for section only | `fieldTypes.js:140-142`; test `:32` |
| A4 | photo and signature are not value fields | `isValueField` | false for section, photo, signature; true for the other 11 | `fieldTypes.js:146-148`; test `:32-38` |
| A5 | everything except section is recordable | `isRecordableField(t)` | false for section only | `checklistFields.ts:115-117` |
| A6 | reference types resolve live | `REFERENCE_TYPES`, `referenceSource` | `['asset','site','user']`; `referenceSource('asset') === 'asset'`; `typeHasOptions('asset') === false` | `fieldTypes.js:48-50`; test `:121-131` |
| A7 | blank answers match the field kind | `blankAnswer` per type | multiselect `[]`, boolean `null`, rating `0`, number `''`, else `field.default ?? ''` | `checklistFields.ts:162-170`; test `:40-45` |
| A8 | a reference field validates like text | `validateAnswer({type:'site',required:true}, '')` | matches /required/i; `'Riyadh Depot'` -> null | test `:129-130` |
| A9 | a layout field is never validated | `validateAnswer({type:'section'}, undefined)` | null | `fieldTypes.js:301`; test `:55` |
| A10 | an unknown type does not crash the registry | `fieldTypeDef('nonsense')` | null, and `newField('nonsense')` falls back to text | `fieldTypes.js:131-133`, `:152` |

### Group B - answer storage and options (8 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| B1 | the stored value is English, the label is translated | field with `options:['OK','Not OK']`, `options_i18n:{ar:['حسنا','غير جيد']}`, lang `ar` | `[{value:'OK',label:'حسنا'},{value:'Not OK',label:'غير جيد'}]` | `checklistI18n.ts:114-127` |
| B2 | a shared set WINS over the field's own copy | field `options:['old']` + `options_ref:'legend'`, template `option_sets.legend.options:['new']` | resolves to `['new']` | `checklistI18n.ts:117-118` |
| B3 | an empty shared set falls back to the field | `option_sets.legend.options: []` | resolves to the field's own `options` | `checklistI18n.ts:99-100` |
| B4 | a short translation array falls back PER INDEX | 3 options, `i18n.ar` has 2 entries | third option's label is its English value, not blank | `checklistI18n.ts:125` |
| B5 | an unknown language degrades to English | lang `'fr'` | `normalizeLang` -> `'en'`; labels are English | `checklistI18n.ts:52-54` |
| B6 | a blank translation degrades to English | `labels.ar = '   '` | English label | `checklistI18n.ts:70-72`, `:85-88` |
| B7 | an unknown stored value renders as itself | `optionLabel(field, tpl, 'Legacy Value')` | `'Legacy Value'` | `checklistI18n.ts:138-139` |
| B8 | validation uses the resolved set, not the stale copy | field `options:['old']`, ref resolves `['new']`, answer `'new'` | valid | `checklistFields.ts:254-256` |

### Group C - conditional visibility (14 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| C1 | no rule means visible | field with no `visibleWhen` | true | `checklistFields.ts:200-201`; test `:88` |
| C2 | a single condition is honoured both ways | `{field:'q1',op:'=',value:'Fail'}` | `{q1:'Fail'}` true; `{q1:'Pass'}` false | test `:84-87` |
| C3 | an array is AND, not OR | two conditions, only one satisfied | false | `checklistFields.ts:202` |
| C4 | an unknown operator fails OPEN | `op:'BOGUS'` | true | `checklistFields.ts:195`; test `:89` |
| C5 | a malformed rule fails OPEN | `{op:'='}` with no `field` | true | `checklistFields.ts:194` |
| C6 | `=` compares as STRING | actual `5`, expected `'5'` | true | `checklistFields.ts:177` |
| C7 | numeric ops treat blank as NaN | `>` with actual `''` | false | `checklistFields.ts:175`, `:179` |
| C8 | `includes` is array-membership OR substring | `['a','b']` includes `'b'` true; `'abc'` includes `'b'` true | both true | `checklistFields.ts:183-184`; test `:79` |
| C9 | `in` asks whether the ANSWER is one of a set | actual `'TR-MIXER'`, expected `['TR-MIXER','PUMPS']` | true | `checklistFields.ts:185-186` |
| C10 | `empty` / `not_empty` treat `[]` as empty | actual `[]` | `empty` true, `not_empty` false | `checklistFields.ts:187-188` |
| C11 | a hidden required field does NOT block submit | q1=Pass hides a required `why` | `validateSubmission` valid | test `:92-103` |
| C12 | the same field blocks once visible | q1=Fail | invalid, `errors.why` set | test `:99-102` |
| C13 | an empty section header is pruned | section, section, text | the first section is dropped | `checklistFields.ts:219-223` |
| C14 | a trailing section is pruned | text, section (nothing after) | the section is dropped | `checklistFields.ts:221-222` |

### Group D - the hidden-field asymmetry (5 cases). **The highest-value group.**

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| D1 | a hidden line does NOT demand a remark | interval=250h, stale `c500='Not OK'`, no note | `missingNotes` returns `[]` | `src/test/checklistMarks.test.js:219-226` |
| D2 | the same line DOES demand one once visible | interval=500h, `c500='Not OK'`, no note | `missingNotes` returns `['c500']` | test `:225` |
| D3 | a hidden meter group is not demanded | interval=250h | `unsatisfiedGroups` returns `[]` | test `:228-231` |
| D4 | **a hidden answer STILL blocks the close** | interval=250h, stale `c500='Not OK'` | `canClose().ok === false`, `blockingAnswers` returns `['c500']` | test `:233-240`; `checklistMarks.ts:141-155` |
| D5 | an answer is never cleared when its field hides | set q1=Fail, answer `why`, then set q1=Pass | `answers.why` is still present and is submitted | `[templateId].tsx:1383` (payload passes `answers` whole); no clearing path exists |

### Group E - auto values (8 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| E1 | current_user resolves the operator's name | `{autoValue:'current_user'}`, ctx `{userName:'Sam Ali'}` | `'Sam Ali'` | test `:151` |
| E2 | today resolves the supplied ISO date | `{autoValue:'today'}`, ctx `{today:'2026-07-12'}` | `'2026-07-12'` | test `:152` |
| E3 | today defaults to now when ctx is empty | `{autoValue:'today'}`, `{}` | `YYYY-MM-DD` of today | `checklistFields.ts:40` |
| E4 | a non-auto field resolves to empty | `{type:'text'}` | `''` | test `:153` |
| E5 | `isAutoField` tests the PROPERTY, not the type | `{type:'user'}` | false | test `:150` |
| E6 | a resumed draft keeps the STORED date | save with `today='2026-07-12'`, resume tomorrow | answer is still `2026-07-12` | `[templateId].tsx:1133` merges stored answers |
| E7 | autoFrom prefers fleet number over registration | asset `{fleet_number:'F1', registration_no:'R1'}`, token `asset.fleet_no` | `'F1'` | `checklistMarks.ts:256`; `src/test/checklistMarks.test.js:145` |
| E8 | an unknown autoFrom token resolves to nothing | token `'asset.nonsense'` | `''` | `checklistMarks.ts:269`; test `:151` |

### Group F - locking and auto-fill merge (5 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| F1 | `locked` locks whatever the value | `{locked:true}`, value `''` | true | `checklistMarks.ts:286` |
| F2 | **`readOnly` locks only once a value exists** | `{readOnly:true}`, value `''` then `'TM514'` | false, then true | `checklistMarks.ts:287-288`; test `:156-167` |
| F3 | autoFill never overwrites what the user typed | editable field, current `'mine'`, register `'theirs'` | not in the patch | `checklistMarks.ts:305`; test `:168-173` |
| F4 | a read-only field DOES take the register value | `readOnly:true`, current `'stale'`, register `'fresh'` | patch has `'fresh'` | `checklistMarks.ts:305`; test `:174-178` |
| F5 | an unknown asset fills nothing, silently | asset with every source null | patch is `{}` | `checklistMarks.ts:301`; test `:179-184` |

### Group G - validation and completeness (12 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| G1 | required + empty names the field | `{label:'Name',required:true}`, `''` | `'Name is required'` | `checklistFields.ts:243`; test `:48` |
| G2 | optional + empty short-circuits every later check | `{type:'number',min:1}`, `''` | null | `checklistFields.ts:244` |
| G3 | number bounds | `{min:1,max:10}` with `0` then `5` then `11` | error, null, error | `checklistFields.ts:247-249`; test `:50-51` |
| G4 | a non-numeric number | `'abc'` | "must be a number" | `checklistFields.ts:246-247` |
| G5 | select membership | options `['a','b']`, value `'z'` | matches /valid/i | test `:52` |
| G6 | multiselect membership names it plural | options `['a','b']`, value `['a','z']` | matches /Invalid/i | test `:53` |
| G7 | membership is SKIPPED when no set is known | `{type:'select'}` no options, no opts.options, value `'x'` | null | `checklistFields.ts:257` (guard `allowed.length`) |
| G8 | rating bounds | `9` | "must be 0-5" | test `:54` |
| G9 | validateSubmission skips layout and media | fields incl. section + photo, both blank | no errors for either id | test `:58-72` |
| G10 | group_require_one accepts EITHER reading | km `''` + hours `'12'` | `unsatisfiedGroups` `[]` | `src/test/checklistMarks.test.js:117-127` |
| G11 | **zero IS a reading** | km `0` | satisfied | `checklistMarks.ts:226-227`; test `:132-138` |
| G12 | a blank string is NOT a reading | km `'   '` | unsatisfied | `checklistMarks.ts:227`; test `:128-131` |

### Group H - blocking marks (7 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| H1 | blockingAnswers NAMES the lines | one field answered `'Not OK'` | `[{id, label, value:'Not OK'}]` | `checklistMarks.ts:164-180`; test `:77-82` |
| H2 | a corrected item stops blocking | re-marked `'Repaired'` | `[]` | test `:83-87` |
| H3 | an unanswered sheet does not block | all answers absent | `[]` | `checklistMarks.ts:173` (`one != null`); test `:88-93` |
| H4 | a legend with no blocking list blocks nothing | option set without `blocking` | `blockingMarks` `[]`, `canClose.ok` true | `checklistMarks.ts:122-125`; test `:63-68` |
| H5 | an array answer blocks on ANY member | `['OK','Not OK']` | blocks, and reports once for that field | `checklistMarks.ts:171-176` (`break`) |
| H6 | markMeta never returns null | value recorded before the meta existed | `{value, icon:'na', tone:'muted', meaning:'', known:false}` | `checklistMarks.ts:108-119`; test `:54-62` |
| H7 | an unknown icon token falls back to a real glyph | meta `{icon:'invented'}` | icon `'na'` | `checklistMarks.ts:111` |

### Group I - signatures (9 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| I1 | **each signature lands under its OWN key** | sign field A then field B | `{A:..., B:...}`; both present | `checklistFields.ts:134-136` |
| I2 | isFieldAnswered is per field | only A signed | A true, B false | `checklistFields.ts:136` |
| I3 | clearing removes the key | set B then clear B | `'B' in signatures` is false | `[templateId].tsx:774-780` |
| I4 | a missing required signature names WHICH | two required signature fields, one signed | `errors` has only the unsigned id, message names its label | `checklistFields.ts:282-299` |
| I5 | a hidden required signature is exempt | required signature with an unsatisfied `visibleWhen` | no error | `checklistFields.ts:292` |
| I6 | the template flag is satisfied by ANY field | `require_signature:true`, no primary, one field signed | `primarySignatureSatisfied` true | `checklistFields.ts:363` |
| I7 | the template flag is satisfied by the pad | `require_signature:true`, primary set, no fields | true | `checklistFields.ts:362` |
| I8 | both capture formats are accepted, nothing else | `'<svg...'`, `'data:image/png;base64,...'`, `'signed by Sam'` | first two normalise, third -> null | `savedSignature.ts:39-44` |
| I9 | **a drawn mark beats the saved one** | `{saved:'<svg>A</svg>', drawn:'<svg>B</svg>'}` | `{value:'<svg>B</svg>', source:'drawn'}` | `savedSignature.ts:68-71` |

### Group J - drafts (14 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| J1 | one machine typed differently is ONE sheet | `' tm514 '` vs `'TM514'` | same key | `mobile/__tests__/checklistDraft.test.ts:150-154` |
| J2 | two vehicles are TWO sheets | same template, different assets | different keys | test `:155-158` |
| J3 | two users never collide | same template + asset, different userId | different keys | test `:159-163` |
| J4 | a merely-opened sheet is NOT a draft | `filled:0`, no photos/notes/signatures | `hasDraftContent` false | test `:165-172` |
| J5 | a photograph alone IS work | `filled:0`, one photo | true | test `:173-178` |
| J6 | a remark or a signature alone IS work | `filled:0`, one note / one signature | true | test `:179-187` |
| J7 | a blank remark is not content | `notes:{a:'   '}` | false | test `:188-194` |
| J8 | one corrupt entry does not lose the rest | array with a junk element | the junk is dropped, the rest survive | test `:196-201` |
| J9 | junk JSON reads as no drafts, never throws | `'not json'` | `[]` | test `:202-206` |
| J10 | the cap prunes the OLDEST and reports it | 26 drafts | 25 kept, 1 returned in `pruned` | test `:207-220`; `checklistDraft.ts:205-206` |
| J11 | **a failed read never destroys a draft** | store status `unreadable` | `saveDraft` throws `DraftStoreUnreadableError`; nothing written | test `:270-279` |
| J12 | an unreadable list says "could not check" | `loadDrafts` on a torn store | `{ok:false, status}` - NOT an empty success | test `:289-297` |
| J13 | an absent store IS a genuine empty | status `absent` | `{ok:true, drafts:[]}` | test `:298-303` |
| J14 | two overlapping saves do not revert each other | two concurrent `saveDraft` | both survive; writes serialised | test `:344-355`; `checklistDraft.ts:470-483` |

### Group K - draft photos (6 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| K1 | a cache photo is copied into the draft folder | `file:///cache/x.jpg` | path contains `/checklist-drafts/` | test `:385-393` |
| K2 | an already-copied path is NOT re-copied | a draft-folder path | returned unchanged | test `:394-401` |
| K3 | an upload ref passes straight through | `tp-storage://...` | unchanged | test `:402-406` |
| K4 | an uncopyable photo is DROPPED, not stored dead | source file missing | null; not in the map | test `:407-411` |
| K5 | **a missing photo is REPORTED, not silently restored** | stored path whose file is gone | `{photos, dropped:1}` | test `:412-421`, `:429-440` |
| K6 | an iOS container move is healed by basename | stored absolute path stale, same name present | resolves to the current path | test `:422-428` |

### Group L - approval ladder (16 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| L1 | two-stage: pending -> supervisor rung | `TWO`, `{approval_status:'pending'}` | `stageFor` `'supervisor'`; `nextStatusFor(...,true)` `'pending_area_manager'` | `src/test/checklistApproval.test.js:14-23` |
| L2 | two-stage: second rung closes | `{approval_status:'pending_area_manager'}` | stage `'area_manager'`; next `'approved'` | test `:20-22` |
| L3 | single-stage closes on one approval | `ONE`, pending | `'approved'` | test `:25-29` |
| L4 | rejection is available at EITHER rung | both statuses, `approved=false` | `'rejected'` | test `:31-34` |
| L5 | a finished sheet offers NO stage | approved / rejected / not_required / `''` | `stageFor` null; `canDecide` false | test `:36-41` |
| L6 | **a Manager signs NOTHING** | role `'Manager'` on both rungs | false | test `:45-53` |
| L7 | the trades' supervisors sign the first rung | Maintenance Supervisor, Workshop Supervisor | true on supervisor, false on area_manager | test `:54-62` |
| L8 | the PMV manager signs both rungs | `'PMV Manager'` | true, true | test `:63-67` |
| L9 | Admin and Director close, deliberately | on `area_manager` | true | test `:72-78` |
| L10 | a tyre data collector signs the FIRST rung only | `'Tyre Data Collector'` | true on supervisor, false on area_manager | test `:86-90`; `V606:28-36` |
| L11 | a trade or driver signs nothing | Mechanic, Driver, Tyre Man | false on both | test `:79-85` |
| L12 | **Title Case matches the lowercase UserRole** | `'Workshop Maintenance Area Manager'` vs `'workshop_maintenance_area_manager'` | both true | test `:91-99` |
| L13 | a super admin is never locked out | any role, `{isSuperAdmin:true}` | true | test `:100-103`; `checklistApproval.ts:98` |
| L14 | a loading profile grants nothing | role `null`/`undefined`/`''` | false | test `:104-108` |
| L15 | the ladder carries each signature | two-stage approved submission | 2 rungs, each with name/signature/at | test `:118-127` |
| L16 | a single-stage sheet shows ONE rung from the APPROVER columns | `ONE`, approved | 1 rung, name from `approver_name` | test `:128-135` |

### Group M - status vocabulary and history buckets (5 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| M1 | statusSummary says WHO is holding it | `pending_area_manager` | "Waiting for the area manager" | `checklistApproval.ts:165`; test `:111-117` |
| M2 | closed means CLOSED | `pending_area_manager` | `isFullyClosed` false | test `:136-141` |
| M3 | both waiting rungs fold into ONE history bucket | pending, pending_area_manager | both `'waiting'` | `mobile/lib/checklists.ts:670`; `checklistHistory.test.ts:260-270` |
| M4 | an unknown status is `no_approval`, not a crash | `''`, `'not_required'` | `'no_approval'` | `checklists.ts:671` |
| M5 | a never-minted document number is NULL, not blank | `{document_no:null}` and `{document_no:'  '}` | null both | `checklists.ts:708-711`; test `:301-310` |

### Group N - targeting (8 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| N1 | **NULL assignee_roles reaches everyone** | `{assignee_roles:null}`, any role | true | `checklistRoles.ts:47-49`; `checklistTargeting.test.ts:32-40` |
| N2 | an empty array ALSO reaches everyone | `{assignee_roles:[]}` | true | `checklistRoles.ts:44-49` |
| N3 | Title Case DB role matches lowercase app role | `['Tyre Man']` vs `'tyre_man'` | true | test `:41-49` |
| N4 | the trades get their sheet, the driver gets theirs | `['Mechanic','Electrician']` vs Driver | false for the driver | test `:50-60` |
| N5 | oversight sees everything, a mechanic does not | Manager vs Mechanic on a Driver-targeted sheet | true, false | test `:61-69` |
| N6 | **a loading profile does NOT unlock a targeted sheet** | role `''` or null | false | `checklistRoles.ts:68-69`; test `:70-76` |
| N7 | a null assignment role stays open to all | `{assignee_role:null}` | true | `checklistRoles.ts:87`; test `:77-87` |
| N8 | roleTargetLabel is null for an untargeted sheet | `{assignee_roles:null}` | null (render nothing) | `checklistRoles.ts:101-104`; test `:88-92` |

### Group O - the client/server contract (6 cases). Integration, not unit.

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| O1 | the client's blocking verdict AGREES with the trigger | a sheet carrying one `'Not OK'` | client `canClose.ok === false`; server RAISES `22023` | `checklistMarks.ts:239-242`; `V595:278-286` |
| O2 | a blocking mark does NOT stop a SUBMIT | same sheet, Submit | confirmation dialog, then submits | `[templateId].tsx:1498-1508` |
| O3 | the supervisor rung ACCEPTS a sheet with a fault | two-stage, `'Not OK'` present, supervisor signs | `pending_area_manager` written | `V595:259-269` has no blocking gate; RECORDED V595 proof |
| O4 | the closing rung REFUSES the same sheet | area manager approves | `22023` naming the mark | `V595:278-286`; RECORDED V595 proof |
| O5 | an approval is never QUEUED | offline, press Approve | refuses, tells the user to reconnect | artifact 06 section 4 |
| O6 | a stale decision is refused, not clobbered | decide a row someone else already decided | RPC raises "decided by someone else while you were looking at it" | `V597:114-118` |

**Total: 133 specified cases across 15 groups.**

---

## 11. Open questions and UNVERIFIED items

### UNVERIFIED - needs a live database check

The Supabase connector was unauthenticated when this was written. Each item below
carries the SQL to run.

**1. Five columns the clients read and write are in NO repo migration.** This is
the largest gap in this artifact. A repo-wide sweep of all 571 `MIGRATIONS_V*.sql`
found no `CREATE TABLE` or `ADD COLUMN` for any of them, yet the mobile service
SELECTS all five (`mobile/lib/checklists.ts:69`, `:393-396`) and the live approval
trigger DEPENDS on `option_sets`:

| Column | Table | Read at | Written at |
|---|---|---|---|
| `option_sets` | `checklist_templates` | `checklists.ts:69` | `V595:153`, `V595:210` |
| `name_i18n` | `checklist_templates` | `checklists.ts:69` | `V595:155` |
| `description_i18n` | `checklist_templates` | `checklists.ts:69` | referenced in V598 prose only |
| `signatures` | `checklist_submissions` | `checklists.ts:394` | `checklists.ts:327` |
| `notes` | `checklist_submissions` | `checklists.ts:394` | `checklists.ts:328` |

`pass_threshold` has ZERO occurrences in any migration, and `scored` likewise,
though both are read at `checklists.ts:69` and used at `[templateId].tsx:1358-1359`.

**They were almost certainly added outside the repo migration set.** This is the
same class the V606 header warns about: a repo file is a claim, the live object
is the evidence.

```sql
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('checklist_templates','checklist_submissions')
 order by table_name, ordinal_position;
```

**Flutter must not model these five from this document alone.** Confirm shape and
nullability first.

**2. Does any live template use an option-set key other than `legend`?** The
trigger reads a HARDCODED path `option_sets #> '{legend,blocking}'`
(`V595:247`), while the client resolves whichever key the field's `options_ref`
names (`checklistMarks.ts:89-96`). See the divergence note below.

```sql
select id, name, jsonb_object_keys(option_sets) as set_key
  from public.checklist_templates
 where option_sets is not null;
```

**3. What blocking marks are actually declared, and on which templates?**

```sql
select id, name, option_sets #> '{legend,blocking}' as blocking,
       option_sets #> '{legend,require_note}' as require_note
  from public.checklist_templates where status = 'published';
```

**4. Which field types are actually IN USE?** The registry declares 14; the
migration for the workshop sheets patches a much narrower set. Building 14
renderers when 6 are used is wasted Phase 6 effort.

```sql
select f->>'type' as field_type, count(*)
  from public.checklist_templates t, jsonb_array_elements(t.fields) f
 where t.status = 'published'
 group by 1 order by 2 desc;
```

**5. How many templates carry `visibleWhen`, and in which SHAPE?** RECORDED says
the Predictive Maintenance template uses it on 197 fields, but whether the array
(AND) form is used anywhere is unknown, and so is whether any rule uses `in`,
`includes` or the numeric operators.

```sql
select t.name, f->>'id', f->'visibleWhen'
  from public.checklist_templates t, jsonb_array_elements(t.fields) f
 where f ? 'visibleWhen' and f->'visibleWhen' <> 'null'::jsonb;
```

**6. The exact argument signature of `decide_checklist_approval` as deployed.**
The repo's V597 is the last version IN THE REPO, but V606's own header records
that it was "ALREADY APPLIED LIVE, but with NO row in supabase_migrations" - so
the repo is demonstrably not a complete record of this schema.

```sql
select p.proname, pg_get_function_arguments(p.oid), p.prosecdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('decide_checklist_approval','guard_checklist_approval_stages',
                     'checklist_is_supervisor','checklist_is_area_manager',
                     'next_checklist_document_no','checklist_last_submission');
```

**7. The live body of `guard_checklist_approval_stages`.** V595's is the last in
the repo. Confirm with `pg_get_functiondef` before Flutter mirrors its rules.

**8. `checklist_last_submission` signature and return shape.** Called at
`mobile/lib/checklists.ts:499-502` with `p_template_id` and `p_asset_no`,
consumed as `{found, days_ago, document_no, submitted_at}`
(`checklistMarks.ts:317-330`). Not defined in any repo migration that was found;
only its GRANT appears (`V596:36`).

**9. Row counts, to decide what must page on day one.**

```sql
select 'templates', count(*) from public.checklist_templates
union all select 'published', count(*) from public.checklist_templates where status='published'
union all select 'submissions', count(*) from public.checklist_submissions
union all select 'assignments', count(*) from public.checklist_assignments
union all select 'schedules', count(*) from public.checklist_schedules;
```

RECORDED: `checklist_schedules` held ZERO rows, so the "Due" list stays empty
until somebody creates a schedule. Confirm that is still true - if it is, Phase 6
should not build a due-list UI on an empty feed.

### THE DIVERGENCE THAT MATTERS MOST

**The client and the server disagree about WHICH answers can block a close, in
both directions.**

The server scans answer VALUES flat, with no template awareness:

```sql
select string_agg(distinct a.value, ', ') into v_bad
  from jsonb_each_text(coalesce(new.answers, '{}'::jsonb)) a
 where jsonb_exists(v_blocking, a.value);
```
(`MIGRATIONS_V595_WORKSHOP_DAILY_CHECKLIST.sql:280-282`)

The client iterates FIELDS and consults each field's own resolved option set
(`mobile/lib/checklistMarks.ts:166-179`). Three consequences, none of them
theoretical:

| Case | Server | Client | Effect |
|---|---|---|---|
| A `text` or `textarea` field where someone typed the exact string `Not OK` | **BLOCKS** - it is a matching answer value | does not block - that field's option set declares no `blocking` | The screen says closable; the approver signs; the server refuses with a raw `22023`. **Exactly the failure the client mirror exists to prevent.** |
| A field pointing at an option set whose key is NOT `legend`, carrying its own `blocking` list | does not block - the trigger's path is hardcoded to `{legend,blocking}` | **BLOCKS** | The screen refuses a sheet the server would happily close. Blocks real work |
| A `multiselect` answer `["Not OK"]` | does NOT block - `jsonb_each_text` yields the array's TEXT form `["Not OK"]`, which is not a member of the blocking array | **BLOCKS** - `blockingAnswers` iterates array members (`checklistMarks.ts:171-172`) | The screen refuses a sheet the server would close |

Case one is the dangerous direction, because it converts a considered refusal
into an unexplained error AFTER a person has signed. Cases two and three block
honest work but fail safe.

**Rule for Flutter: mirror the SERVER's algorithm for the blocking gate - scan
the flat answer values against the template's `{legend,blocking}` array - and
keep the field-aware version ONLY for naming which line is at fault.** That gives
the same verdict as the database and still produces a useful message. Do not
"improve" on the server here; the mobile source already argues the point at
`checklistMarks.ts:150-154` ("Agreeing with the database matters more here than
being clever").

Report this before changing anything. The Expo app is production and this
document is an audit, not a patch.

### Known client-side gaps, carried forward

1. **`CHECKLIST_APPROVAL` is queued as a blind table update** rather than routed
   through `decide_checklist_approval`. Already the headline finding of artifact
   06 section 4; this artifact adds the mechanism (section 8).
2. **The mobile checklist approval screen does not pre-fill the saved
   signature.** No `resolveSignature` or saved-signature read exists in
   `approvals/[submissionId].tsx`. The V601 engine is present and unused on this
   screen.
3. **Hindi is in `CHECKLIST_LANGS` but the app ships no `hi` UI locale**
   (`checklistI18n.ts:38`), so a Hindi template renders Hindi content inside
   English or Arabic chrome. RECORDED as a deliberate content-vs-UI split, but it
   looks mixed.
4. **`checklistFields.ts` has no drift test against the web registry.** The marks
   and approval mirrors are pinned; the field engine is not. Flutter should add
   the equivalent Dart-vs-JS pin, or accept that section 10 is the only contract.
5. **`compareTo` is declared on the field interface** (`checklistFields.ts:92`)
   and `meterRegression` implements the comparison, but no live template is known
   to use it. Confirm with query 4 above before building the warning UI.
