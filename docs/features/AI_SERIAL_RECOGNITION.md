# AI tyre serial-number recognition (DEFERRED FEATURE, DRAFT)

| | |
|---|---|
| Status | Draft code on branch `claude/ai-serial-recognition-7rxp2t`. **Nothing deployed, nothing applied, no paid call made.** |
| Priority | **Deferred.** Not a P0/P1 blocker for the current-company release. |
| Owner approvals needed | Migration, flag, edge-function deploy, pilot, optional re-analysis (each separately) |
| Related | `ai-tyre-inspection` worker, shared tyre-position service, AI review card on `/ai-tyre-inspection` |

## 1. Purpose

Inspectors photograph tyres during inspections. The AI worker already reads those photos for visible
damage. Many photos also show the tyre's own serial number, either on a printed label or moulded into
the rubber sidewall. Reading it lets the system ask one question automatically:

> Is the tyre in this photo the tyre the register says is fitted on this wheel?

When the answer is "no" or "not sure", a supervisor checks it in the existing AI review card. The
system never changes the tyre register by itself.

## 2. Scope

In scope:
- Read a serial from printed labels and moulded sidewall markings on inspection photos.
- Store what was read, how sure the model was, and whether it agrees with the register.
- Put disagreements in front of a supervisor in the existing AI review card.
- An offline evaluation harness to measure accuracy and cost before any pilot.

Out of scope (deliberately):
- Writing `tyre_records`, fitments, movements or history. Correcting the register stays a human action
  in the tyre module.
- A new review queue or a new page.
- Reading DOT week/year codes, sizes, brands or tread depth.
- Re-analysing the 988 photos already analysed (a separate, optional approval, section 9).

## 3. Design

### 3.1 Additive, flag-gated worker path

Files: `supabase/functions/ai-tyre-inspection/serial.ts` (new, pure), `logic.ts`, `index.ts`.

- Flag: `system_config.ai_tyre_serial_enabled`. Default OFF; a missing key, any value other than
  `true`, or a failed read means OFF.
- Flag OFF (today): the worker sends the unchanged v4 prompt, records `prompt_version = tyre-photo-v4`,
  writes no `serial` key and calls nothing new. `src/test/aiSerialRecognition.test.js` proves the job
  writes are byte-identical with the flag absent and with it false, and pins the v4 prompt text by hash.
- Flag ON: the prompt is the v4 prompt plus one appended section (`SERIAL_PROMPT_SECTION`) and the
  prompt version becomes `tyre-photo-v5-serial`. Because the reuse cache keys on prompt version, v4
  results are never reused as v5 (and vice versa). Damage fields are unchanged (tested).
- Same single provider call per photo. No second paid request. `max_tokens` unchanged.
- A failure in the serial step never fails the damage analysis: the job completes with an info flag
  `serial_compare_unavailable`.

### 3.2 Never invent characters

`sanitizeSerialReading()` (JS) and `ai_tyre_serial_record()` (SQL, again, as defence in depth):
- The value is derived from the raw text the model reports. The model's own "normalized" field is
  ignored for the value; if it adds characters the raw text does not contain, that is recorded as an
  issue.
- Every uncertain character must be `?`. Any `?` forces status `partial`.
- Fewer than 6 characters, a tyre size, a DOT code or a placeholder can never be `readable`
  (mirror of `tyre_serial_is_strong`).
- Partial readings are capped at `medium` confidence. Unknown values fall to the least certain value.
- Look-alike characters (O/0, I/1, S/5, B/8) are never folded: folding would turn a misread into a match.
- The sanitiser can only make a reading less certain, never more.

Output per photo: `raw`, `normalized`, `source` (label / moulded / none), `confidence`
(high / medium / low), `status` (readable / partial / unreadable), `issues`.

### 3.3 Comparison through the shared position service

Inspection photos are stored by slot id (`R1Li`, `F2R`), tyre records by ERP code (`LHF1`, `RHCO`).
The comparison reuses the live position service (`tyre_asset_layout`, `tyre_position_resolve`,
`tyre_position_compare`), exactly as `observation_erp_evaluate` does. No new wheel-code converter.

1. Layout of the asset (company, country, asset, vehicle type) as of the inspection day.
2. Resolve the photo slot to one wheel. Not resolved => `ambiguous`.
3. Tyre records of the same company, country and asset fitted that day (`issue_date <= day` and not
   removed by then) whose position resolves to the same wheel. A register row whose position cannot be
   read on that layout makes the result `ambiguous`, never a guess.
4. `ai_tyre_serial_outcome()` (SQL) / `compareSerial()` (JS), pinned by one fixture
   (`src/test/fixtures/aiSerialOutcomeCases.json`, 19 cases, both sides tested):

| Outcome | When | Review? |
|---|---|---|
| `match` | readable, same serial, confidence not low | no |
| `mismatch` | readable (medium/high) and different, or partial that conflicts | **yes** |
| `ambiguous` | wheel not resolved, two serials on the wheel, low confidence, partial that fits | **yes** |
| `unreadable` | a strong serial is registered but nothing was read | **yes** |
| `no_serial_on_record` | nothing registered on that wheel that day | no |
| `weak_serial_on_record` | the registered value is a size, DOT code or placeholder | no |

### 3.4 Existing review queue

No new queue. On `/ai-tyre-inspection`, the existing AI photo review card for each job shows a small
"Serial number (pilot)" block (`SerialReviewBlock`) only when a reading exists. With the feature off,
or before the migration, it renders nothing. The worker also adds a `serial_mismatch` /
`serial_ambiguous` / `serial_unreadable` flag to the job's analysis flags so the reason is visible with
the damage findings. Supervisors (Admin, Manager, Director, Maintenance Supervisor) record a decision
with a reason:

- Register is correct (photo misread or another tyre)
- Photo shows a different tyre (enter the serial seen; the register must be checked by a person)
- Serial genuinely not readable
- Not a serial question

The decision is appended; it never edits the register or the job.

## 4. Data model (draft migration `supabase/pending_migrations/20261117130000_ai_tyre_serial_recognition.sql`)

- `ai_tyre_serial_readings`: one row per AI job (unique `job_id`). Photo reference, prompt and model
  version, sanitised reading, resolved wheel, layout key, registered tyre ids and serials, outcome,
  reason, `needs_review`. CHECKs enforce the never-invent rules and that `needs_review` matches the
  outcome.
- `ai_tyre_serial_review_events`: reviewer decisions (decision, optional serial seen, reason,
  reviewer, time).
- Both append-only (trigger refuses update/delete for everyone), RESTRICTIVE org isolation, RESTRICTIVE
  country isolation (same expression as `tyre_records`), select only for active reviewer roles, no
  insert/update/delete grant to app roles, nothing for anon. Anum reader policies re-applied.
- `ai_tyre_serial_record(job, reading)`: service role only (the worker).
- `ai_tyre_serial_review(reading, decision, serial, note)`: signed-in reviewer of the same company and
  country; reason required.

Staging proof (local Postgres 16, private copy of `tp_mirror2`):
`supabase/tests/staging_ai_serial_recognition.sh` -> 19 mirror cases + 29 behaviour checks PASS,
including: other company's tyres never used, tyre records and AI jobs byte-identical after recording
and after reviewer decisions, append-only, grants, UAE-only manager and Tyre Man see nothing, re-apply
is a no-op, the ROLLBACK removes every object.

## 5. Flows

1. Inspector photographs a tyre (unchanged).
2. Worker claims the job, reserves budget, makes the one paid call (unchanged).
3. Flag ON: the response's `serial` object is sanitised, `ai_tyre_serial_record` stores and compares it,
   the job completes with the damage analysis plus `analysis.serial` and any serial flag.
4. Supervisor opens the inspection's AI review card; a serial needing review shows the decision form.
5. If the photo shows a different tyre, the supervisor corrects the register through the normal tyre
   module (outside this feature).

## 6. Safety rules (summary)

- No automatic write to tyre records, fitments, movements or history. Ever.
- No invented characters; `?` for uncertainty; sizes/DOT/placeholders never readable.
- Flag default OFF; any read failure means OFF.
- Damage detection byte-identical with the flag off (tested).
- A serial failure never fails a damage analysis and never triggers a second paid call.
- Company and country isolation at the database; reviewer-only reads; append-only evidence.
- No backslash-u escapes in edge-function source (the MCP deploy path decodes them).

## 7. Accuracy plan and acceptance criteria

Harness: `npm run ai:serial-eval` (`scripts/ai-serial-eval.mjs`, engine `src/lib/aiSerialEvaluation.js`).

1. `sample-sql` prints a read-only query that proposes a stratified sample. On 2026-11-16 it returns
   **80** completed photos: 40 where the wheel has exactly one strong registered serial (30 assessable,
   10 not), 24 with none registered, 16 where the register shows two serials on the wheel that day.
   The pool is mostly transit mixers (759 of 988 completed photos), with pumps, skid loaders, wheel
   loaders and buses in the "none" stratum.
2. Experts open each photo and enter `true_serial` (empty if none visible) and `source_type`
   (label / moulded / none). Keep adding photos until there are at least 15 label and 15 moulded.
   (The existing expert-label table has a `tyre_serial` column but holds 0 rows today.)
3. `run` (PAID, owner approval): calls the model once per photo with the exact v5 prompt. Refuses
   without `--confirm-paid` and `ANTHROPIC_API_KEY`; stops before passing `--max-usd` (default 0.20,
   ceiling 5). `--dry-run` is free. For 80 photos the expected spend is about $0.08.
4. `score` (free): exact match, partial (and partial consistent), unreadable, **false-read rate**
   (a serial reported as readable that is not the true one, including any readable claim on a photo
   with no serial), per source type, measured tokens, cost per photo, projected month vs the $20 budget.

Proposed gates (all must pass to be ELIGIBLE for an owner decision; passing enables nothing):

| Gate | Threshold |
|---|---|
| Sample | >= 50 photos, >= 15 label, >= 15 moulded |
| False reads | <= 1% of readable claims AND <= 1 in absolute count |
| Printed labels | >= 80% exact (readable and correct) |
| Moulded markings | >= 40% exact (rubber is hard; below this the feature adds little) |
| Cost per photo | <= $0.0015 |
| Projected month | inside the $20 budget |

## 8. Cost

Measured from production (read only, 2026-11-16): 988 completed photo jobs in the last 30 days,
average 4,129 input and 1,064 output tokens, **$0.000945 per photo** (Haiku pricing 0.10 / 0.50 USD
per million). The serial section adds roughly 150-200 prompt tokens and 40-80 output tokens:
about **+$0.00005 per photo**, i.e. about $0.001 per photo in total. At the current volume
(~1,000 photos a month) that is about **$1 a month**, about 5% of the $20 monthly budget. The
atomic budget reservation (`budget.ts`, `ai_tyre_reserve_budget_atomic`) applies unchanged.

## 9. Rollout (each step needs the owner's explicit approval)

1. **Expert sample + paid evaluation run** (~$0.08) and `score`. Stop if not eligible.
2. **Apply the migration** `20261117130000` (tables + RPCs; inert on its own).
3. **Deploy** the `ai-tyre-inspection` source from this branch with an authenticated
   `supabase functions deploy ai-tyre-inspection` (never hand-inlined through MCP). With the flag
   off the behaviour is v4, byte-identical.
4. **Pilot**: set `ai_tyre_serial_enabled = 'true'` for a limited period, watch false reads in the review
   card and cost on `/console`, then decide to keep or turn off.
5. **Optional re-analysis** of the 988 already analysed photos (~$1): a separate approval. They were
   analysed with v1-v4 prompts and carry no serial; nothing is re-run automatically.

## 10. Rollback

1. Set `ai_tyre_serial_enabled` to anything but `true` (instant; next worker run is v4 again).
2. Optionally redeploy the previous worker source.
3. Optionally export the readings and decisions, then apply
   `20261117130000_ai_tyre_serial_recognition_ROLLBACK.sql` (removes only this feature's objects).

No tyre record is touched at any step, so there is nothing to restore in the register.

## 11. Not done / open

- Not deployed, not applied, no paid evaluation run.
- No register filter for "serial needs review" in the evidence register (the per-inspection card shows
  it); add one if the pilot produces volume.
- 56 of 988 photos fall on wheels where the register shows two strong serials fitted on the same day:
  a register data issue the feature will surface as `ambiguous`.
- The Flutter / Expo apps do not show the serial result (web review only).
