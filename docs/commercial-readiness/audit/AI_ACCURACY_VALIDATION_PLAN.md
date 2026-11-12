# AI tyre photo analysis: accuracy validation plan

Date 2026-11-12. Document only. No code, prompt, model or database change is made by this plan.
Rule that governs everything below: **no accuracy claim until accuracy has been measured on expert-labelled
photos, and then only the claim the measurement supports, with its sample size.**

## 1. Where things stand (VERIFIED, from AI_READINESS.md and the repository)

| Fact | Value |
|---|---|
| Photo jobs | 943 (935 completed, 8 failed), one company, first 2026-10-22 |
| Reviewed by a person (accept or reject of a whole job) | 3 of 943 |
| Expert labels (`ai_tyre_expert_labels`) | 0 rows |
| What is analysed automatically | Only wheels the inspector already marked worn, damaged, cut and similar. Healthy wheels are analysed only on a manual "screen" action (AI-11) |
| Deployed prompt | v3. The repository is at v4 (`tyre-photo-v4`), not deployed (AI-3) |
| Model recorded on jobs | one fast model on 937 jobs; a second provider is the fallback |
| Wheel position | Taken from the form key; the model does not verify the photo shows that wheel (AI-10) |
| Tread depth | Never estimated from a photo; any result carrying an exact depth fails the adjudication gate by design |

What this means in plain words: today the feature confirms or describes what an inspector already flagged. It
has never been tested as a detector of defects an inspector missed, and nobody has measured how often its
suggestions are right.

## 2. The tools that already exist (do not build new ones)

| Tool | What it does | Where |
|---|---|---|
| Expert labelling screen | A reviewer opens a photo and its AI result, says whether the photo is assessable, marks each AI defect correct, wrong or wrong type, and adds defects the AI missed. One row per photo per reviewer. | `/ai-tyre-inspection`, view "labelling": `src/components/aiInspection/ExpertLabellingPanel.jsx`, `src/lib/aiTyreExpertLabels.js`, `src/lib/api/aiTyreExpertLabels.js` |
| Label store | `public.ai_tyre_expert_labels`. The photo, position, model and prompt version are copied from the job by a trigger, so a label cannot point at another photo or company. Review roles only (admin, manager, director, maintenance supervisor). | migration `20261112104000_ai_tyre_expert_labels.sql` (applied) |
| Stratified queue | The labelling queue oversamples the rare cases: suspected dangerous 35%, AI reported a defect 35%, AI reported nothing 20%, AI could not assess 10%. | `STRATA`, `buildLabellingQueue` |
| Fixed split | Each tyre (by serial, else by inspection) is assigned once to train 60%, validation 20% or holdout 20% by a hash, so photos of one tyre never sit on both sides of a test. | `splitForGroup` (JS) and `ai_tyre_fnv1a` (SQL), pinned by a test |
| Two-reviewer consensus | Photos labelled twice are compared: agreed, single, or disagreement. Disagreements do not count toward the target until settled. | `consensusLabels`, `agreementStats`, `labellingProgress` |
| Export | Writes the labelled set and the matching AI predictions, leaving out disagreements (and, if chosen, single-reviewer photos). | `buildBenchmarkExport`, `labelledToCsv`, the Download button on the panel |
| Accuracy report | Per defect type precision, recall and F1; agreement on "assessable"; confusion matrix; calibration; dangerous misses; 95% intervals; a gate that returns pass, fail or **insufficient**. A metric with too few cases is reported as unknown, never as 0 or 1. | `src/lib/aiTyreAccuracy.js`, `node scripts/ai-accuracy.mjs --labelled <file> --predictions <file> [--release]` |
| Change gate | Golden cases plus reviewer decisions; blocks a prompt or model change that regresses more than 5 points. | `src/lib/aiTyreAdjudication.js`, `npm run ai:adjudicate` |
| In-app gate check | The panel runs the release gate on the current export and shows the result. | `runReleaseGate` |

Defect vocabulary (14 tokens, one list for the worker, the labels and the report): uneven_wear, shoulder_wear,
center_wear, tread_wear, sidewall_cut, tread_cut, cracking, bulge, exposed_cord, suspected_separation,
embedded_object, puncture_evidence, other_visible_damage, uncertain. **Dangerous** types, where a miss is a
safety event: exposed_cord, bulge, suspected_separation.

## 3. Who labels

- Two named tyre people with field experience (for example the tyre planning engineer and a senior tyre
  inspector or the PMV manager). Not the person who built the prompt.
- They must hold a review role in the app to see the labelling screen.
- A third person (the fleet or tyre manager) settles disagreements. The settlement is a new label by that
  person; nobody edits another reviewer's row.
- Reviewers label what the PHOTO shows, not what they know about the tyre. If the photo cannot show it, the
  answer is "not assessable".
- One written page of definitions before starting: one example photo per defect type, the difference between
  tread_wear, shoulder_wear and uneven_wear, and when to use "not assessable" (blur, dark, wrong object, wheel
  not visible). Without it two reviewers disagree on words, not on tyres.

## 4. How many photos

| Set | Size | Why |
|---|---|---|
| Pilot round | 100 photos, both reviewers | To test the definitions. Target exact agreement at or above 80% and no disagreement on a dangerous type. If lower, fix the definitions and repeat. These labels stay in the set. |
| Full benchmark | **500 or more assessable photos with an agreed label**, of which **at least 60 carry a dangerous defect** and **at least 20 per defect type that will be named in a claim** | These are the release targets already written into the code (`LABEL_TARGETS`, `RELEASE_THRESHOLDS`). |
| Double labelling | The first 100, every photo with a dangerous defect by either reviewer, and a random 20% of the rest | Gives a measured agreement rate without labelling everything twice. |
| Healthy wheels | At least 100 of the 500 from wheels the inspector marked Good | Without them recall on missed defects cannot be measured at all (see 4.1). |

Why 60 dangerous cases: with 0 misses in 60, the 95% upper bound on the true miss rate is still about 6%.
With 0 misses in 20 it is about 16%. "No dangerous misses" on a handful of photos proves nothing.

Why 500: at an observed recall of 95% on 500 defect instances the 95% interval is about 93% to 97%. On 100 it
is about 89% to 98%, too wide to publish.

### 4.1 The sampling problem that must be fixed first

The existing 943 jobs are almost all wheels an inspector already flagged. A benchmark drawn only from them
measures "does the AI agree with a known defect", and says nothing about healthy tyres wrongly flagged or
defects on wheels nobody flagged.

Before labelling the full set: run the manual "screen" action on a chosen set of inspections so that healthy
wheels are analysed too (the edge function already supports it; cost is small at the current price per photo,
and the monthly budget cap applies). Choose whole inspections across sites, vehicle types and day and night
photos, not hand-picked wheels.

Known shortage to plan for: the current fleet may not have 60 photos of exposed cord, bulge or separation.
Options, in order of preference: keep collecting until there are; add photos from the scrap yard taken through
the normal inspection flow; or publish no statement about dangerous defects at all. Synthetic or internet
photos must not enter the benchmark.

## 5. The procedure

1. **Freeze the system under test.** Deploy the repository version of the worker (prompt v4) and record the
   model id and prompt version. Every label carries both; results from different versions are never mixed in
   one figure.
2. **Screen** the chosen inspections (4.1).
3. **Pilot round** (100 photos, two reviewers). Read `agreementStats`. Fix definitions.
4. **Label** to the targets, working the stratified queue. The panel shows progress against 500 and 60.
5. **Settle disagreements.** Export with "require agreement" so only agreed or settled labels are scored.
6. **Check the split** has no leak (`splitLeaks` must be empty).
7. **Score the HOLDOUT split only** for any figure that will be quoted. Train and validation are for looking
   at mistakes and improving the prompt. If the holdout is ever used to tune the prompt, it is spent: draw and
   label a new one.
8. **Run** `node scripts/ai-accuracy.mjs --labelled holdout.csv --predictions preds.json --release --json` and
   keep the JSON output with the date, model id, prompt version and label counts.
9. **Record** the report where the product can show it (a stored accuracy report per prompt version is the
   acceptance test in AI-1).
10. **Any later prompt or model change** re-runs `npm run ai:adjudicate` against the same labels and must not
    regress; a new holdout figure is needed before the published number changes.

## 6. Acceptance thresholds to propose to the owner

These are the values already in `RELEASE_THRESHOLDS`. They are targets chosen by engineering, not measured
performance, and the owner should confirm or change them BEFORE the first score is seen.

| Measure | Proposed pass mark | Notes |
|---|---|---|
| Agreed, assessable holdout photos | 500 or more | Below this the gate answers "insufficient" |
| Reviewers | 2 or more | |
| Dangerous defects in the set | 60 or more | Below this "0 misses" is not accepted as a pass |
| Dangerous defects missed | 0 | And the report states the upper bound, for example "0 of 64 missed; true miss rate below 6% with 95% confidence" |
| Recall, all defect types together | 95% or more | Share of expert-confirmed defects the AI reported |
| Recall, each named defect type | 85% or more | Only for types with 20 or more cases; others are reported as "not enough cases" |
| Precision, all types together | 90% or more | Share of AI-reported defects the expert confirmed |
| Agreement on "assessable" | 95% or more | The AI must say "cannot assess" when the expert does |
| Calibration error | 0.10 or less | A stated 80% confidence should be right about 80% of the time |
| AI results missing for labelled photos | 0 | |
| Reviewer agreement (pilot and double-labelled) | 80% exact, and no unresolved disagreement on a dangerous type | Proposed here; not yet in the code |

An honest expectation: a general vision model on phone photos taken in a yard may not reach 95% recall. If it
does not, the right outcome is a narrower claim (section 7), not a lower pass mark chosen after the fact.

## 7. What may be said at each stage

| Stage | Evidence held | What may be said | What may NOT be said |
|---|---|---|---|
| 0. Today | 0 labels | "A pilot suggests possible tyre defects from inspection photos to assist a human reviewer. Its accuracy is still being validated." | Any number. "Detects", "catches", "screens", "every photo", "safety check". |
| 1. Pilot round done | 100 double-labelled photos, agreement known | Same as stage 0. Internally: reviewer agreement rate. | Any AI accuracy figure (100 photos is a hint, not a result). |
| 2. Benchmark complete, gate FAILS or is INSUFFICIENT | 500 labels, measured figures below target | "In testing with our customer's reviewers. Results are reviewed by a person." Internally: the measured figures, by type. | A pass, "validated", "accurate". |
| 3. Gate PASSES on the holdout | Full report | A sentence of this exact shape: "On [N] expert-labelled tyre photos from one ready-mix fleet ([date], model [id], prompt [version]), the assistant reported [x]% of the defects the experts found and [y]% of what it reported was confirmed. It is an aid for a reviewer, not a safety inspection." | Dropping N, the fleet, the date or the "aid" sentence. Generalising to other fleets, tyre types, lighting or cameras. |
| 4. Second fleet measured | A second, separate labelled set | The stage 3 sentence with both sets named. | "Proven across fleets" on two. |
| Never, at any stage | | | Tread depth in millimetres from a photo. "Replaces the inspector". "Prevents blowouts". A percentage without its sample size. A claim about missed defects on unflagged wheels unless healthy wheels were in the benchmark. |

The badge on the marketing site follows the stage: "On request (pilot)" at stages 0 to 2; "Available" only at
stage 3 with the stage 3 sentence beside it. In the product, every result that no person has reviewed carries
"unverified AI reading" at every stage (AI-8).

## 8. What can spoil the result, and the guard

| Risk | Guard |
|---|---|
| Reviewers see the AI answer first and agree with it | The labelling screen shows AI defects for a verdict by design. For the 100 healthy-wheel photos and the pilot round, have reviewers write their own finding before opening the AI result, or accept that precision is measured well and recall is measured less well. State which was done. |
| Same tyre in tuning and in the test | Fixed hash split by serial or inspection; `splitLeaks` must be empty |
| Wrong wheel photographed | Label "not assessable" or note it; the report already separates assessable agreement |
| Prompt changed mid-labelling | Labels carry prompt and model version; score one version at a time |
| Photos from a different machine compared as "previous" | Known defect AI-9 (country missing from the match); do not include the "contradicts previous" flag in any claim until fixed |
| A second customer's photos differ (other tyre sizes, cameras, light) | The claim names the fleet it was measured on; a new fleet needs its own check before the claim is repeated for it |
| Cost | About USD 0.001 per photo recorded so far; the monthly cap is platform-wide (AI-2). Screening 2,000 extra wheels is a few dollars, but confirm the cap first so the run does not pause live work |

## 9. Owner decisions needed

1. Name the two reviewers and the person who settles disagreements.
2. Confirm or change the pass marks in section 6 before any score is seen.
3. Approve deploying prompt v4 and screening healthy wheels for the benchmark (small AI spend).
4. Decide what happens if dangerous-defect photos stay below 60: keep collecting, or make no statement about
   dangerous defects.
5. Decide who signs the stage 3 sentence before it appears anywhere.

## 10. Verified and not verified

- VERIFIED by reading the code: every tool, threshold and target named above exists as described
  (`src/lib/aiTyreAccuracy.js`, `src/lib/aiTyreAdjudication.js`, `src/lib/aiTyreExpertLabels.js`,
  `scripts/ai-accuracy.mjs`, migration `20261112104000`).
- VERIFIED by SQL in AI_READINESS.md (not re-run here): the counts in section 1.
- NOT VERIFIED: that the labelling screen works end to end in a browser (no label has ever been saved); the
  size of the supply of dangerous-defect photos; the per-photo cost at prompt v4; reviewer availability.
