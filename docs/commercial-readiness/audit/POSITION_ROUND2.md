# POSITION stream, round 2 (2026-11-15)

Branch `claude/tyre-position-service-7rxp2t` (from main, with the PR #514 branch merged in for rework).
Not pushed, no PR. PR #514 itself was not merged or pushed to. Nothing was applied to production.

## What was built

- `src/lib/tyrePositionService.js`: the one place that answers "which wheel is this?". It takes the
  asset's actual layout (vehicle type, asset class prefix, recorded axle count, admin layouts from
  `vehicle_diagram_configs`) and resolves an inspection slot id or an ERP code to one canonical wheel:
  `{ canonical, slot, status: resolved | ambiguous | unknown | inconsistent, reason }`.
  Anything but `resolved` is neither a match nor a mismatch: pending manual review.
- SQL mirror, draft `supabase/pending_migrations/20261115110000_tyre_position_service.sql`.
- PR #514 reworked on top of it, draft `supabase/pending_migrations/20261115120000_observation_erp_reconciliation.sql`
  (replaces the #514 migration, which was moved out of `supabase/migrations/`).
- `src/lib/erpObservationMatch.js` and `src/lib/api/observationErpEvidence.js` now compare wheels through
  the service, on the asset's own registered build.

## Files changed

New: `src/lib/tyrePositionService.js`, `src/test/fixtures/tyrePositionCases.json`,
`src/test/tyrePositionMirror.test.js`, `src/test/tyrePositionConsumers.test.js`,
`supabase/tests/tyre_position_service.test.mjs`, `supabase/tests/staging/observation_erp_position_tests.py`,
both drafts above, this file.
Changed: `src/lib/erpObservationMatch.js`, `src/lib/api/observationErpEvidence.js`,
`src/lib/api/vehicleDiagrams.js` (layout change date), `src/lib/tyreBay.js`, `src/lib/rotationScheduleView.js`,
`src/lib/vehicleTyreLayout.js` (strict resolver, no pickup fallback), `src/components/inspections/ObservationErpEvidence.jsx`,
`src/test/erpObservationMatch.test.js`, `supabase/pending_migrations/README.md`.
From the #514 merge (unchanged by me): `ObservationDetail.jsx`, `observationReportPdf.js`, `ErpIntake.jsx`.

## Tests run

| Test | Result | Status |
|---|---|---|
| vitest, 44 files that touch positions (new ones included) | 753 passed | Verified Fixed |
| JS to SQL mirror, PGlite, 6,624 generated cases plus 44 pinned and 20 comparisons | 4 of 4 tests, 0 rows differ | Verified Fixed (synthetic) |
| Mutation: one rule removed from the SQL | mirror test fails with 54 differing rows | guard has teeth |
| Local staging copy `tp_position` (synthetic Alpha, Beta), both drafts applied | 105 passed, 0 failed | Verified Fixed (synthetic only) |
| Both drafts applied twice on a fresh copy, then the staging isolation suite | apply clean both times, 35 of 35 isolation checks | Verified Fixed (synthetic) |
| eslint on changed files, one `vite build` | clean | |
| Production | read only, counts below | Not Tested (no draft applied) |
| Browser | not opened | Not Tested |

Staging covers: mixer 12, mixer 13 (admin layout with spare), pump 14, pump 12 (4 axle build), 6x4 10,
line pump 12, loader, pickup 4, tyreless, unknown type; other tenant, other country, other site,
non elevated roles, anon and PUBLIC; missing, ambiguous and inconsistent positions; strong, weak and
conflicting serials; dates; append only history; nothing historical rewritten (hash of tyre records,
costs, work orders, inspections, fleet and every action field except the link).

## Rules that hold (each tested)

Never auto confirms (evaluate writes nothing). Never changes a tyre cost, tyre record, work order or
inspection. Never closes or changes the status of a corrective action (confirm sets `work_order_id`
only when empty). Ambiguous, missing or inconsistent position stays pending and Confirm is refused.
Cross tenant, cross country, cross site and wrong role are refused.

## Production recheck (read only, counts only, 2026-11-15)

24 open inspection sourced tyre actions: 19 damage, 5 life due. All 24 assets are registered once and
their vehicle type resolves to a layout. No admin layout exists (0 rows), so no layout history question
arises today.

19 damage actions through the new service:

| Outcome | Count |
|---|---|
| No later tyre movement on the asset | 12 |
| Would be offered for review (same canonical wheel, movement after the inspection, job card exists and opened after it) | 1 |
| Pending manual review (ERP code cannot be placed on that vehicle) | 3 |
| Different wheel (movement was on another wheel of the same vehicle) | 3 |

The seven potential ERP matches measured earlier are those last three rows: 1 offered, 3 pending, 3 on
a different wheel. For all seven the movement is after the inspection and the job card exists. The three
"different wheel" ones are transit mixers where the ERP moved the inner tyre or the other drive axle,
not the observed wheel. The old text compare could not tell any of these apart.

## Found on production data

Concrete pumps carry three ERP spellings for the rear wheels on the same vehicle type: `LHRCO` / `LHRRI`
(rear centre, rear rear), `LHCO` (centre) and `RHR1-O` (numbered). The diagram numbers pump rear axles.
The service reads all three but will not guess that "centre" is rear axle 1 on a pump, so those rows stay
pending. On transit mixers, whose layout itself uses centre and rear, they resolve.

## Displayed results deliberately NOT changed

- Tyre bay, diagram, PDF labels, AI labels: `canonicalToSlotId` now runs through the service but keeps
  its old narrow rule. Parity proven on 2,700+ type and token pairs. Two things the service could now do
  were held back: `LHF` on a pickup (before: stored text, after would be LHF1) and `LHRCO` on a mixer
  (before: stored text, after would be LHCO).
- Unknown vehicle types still draw a pickup in pickers. The service says "unknown" instead; switching the
  pickers would empty lists that show four wheels today.

## Layout history

None is stored. `vehicle_diagram_configs` keeps the current row and its `updated_at`. The service accepts
a history if one is supplied, otherwise uses the current layout and treats an admin layout changed after
the record date as "changed since record" (pending). No history table was added.

## Migration order, dependencies, rollback

1. `20261115110000_tyre_position_service.sql` (functions only).
2. `20261115120000_observation_erp_reconciliation.sql` (needs 1, `tyre_serial_is_strong`,
   `app_can_see_site`, `anum_integration.apply_reader_policies`). Its text contains "delete" and "drop"
   (foreign keys, trigger, rollback comment), so the MCP confirm prompt fires.
Rollback statements are in each header. The client degrades without them: evidence lookup works, Confirm
returns a clean error.

## Impact

Current company: ERP evidence review becomes usable. Today 1 action would be offered, 6 more are explained
instead of silently unmatched. No number on any existing screen moves.
Commercial: one position model for every tenant and layout, including admin designed ones, with SQL and
JS pinned together. A new tenant with other ERP spellings gets "pending" rather than a wrong match.

## Remaining risks

- Proven on synthetic staging only. Not run against production, not opened in a browser.
- Life due actions store an ERP code as their position; two of five use the pump spelling and stay pending.
- A tyre record's `job_card` is the fitting job. A removal recorded on the old tyre's row points at the
  earlier job card, so some real replacements show "no dated movement" until the new tyre row is loaded.
- `mobile/` and `tyre_pulse_flutter/` keep their own copies of the layout tables.

## What else still interprets positions on its own

- `src/lib/positionIntelligenceAnalytics.js` and `src/lib/inspectionWorkspaceView.js`: own `positionGroup`
  (axle group only, not a wheel).
- `src/pages/FleetHealthBoard.jsx`: own front, rear and side reader with a regex fallback.
- `src/lib/tyreChangeTracking.js` `positionKey`: type blind folding after the display conversion.
- `src/lib/exportUtils.js`: its own wheel coordinates per layout for the PDF map.
- `src/components/VehicleTyreDiagram.jsx`, `src/pages/Inspections.jsx`, `src/lib/tyreCompleteness.js`,
  `src/components/tyreExchange/NewExchangePanel.jsx`: call `legacyPositionCode` directly (allow list in
  the ratchet test, may only shrink).
- `mobile/lib/tyreDiagramLayouts.ts`, `mobile/lib/tyreLayout.ts`, Flutter `tyre_diagram_layouts.dart`,
  `tyre_replacement_position.dart`.
- SQL: `guard_tyre_active_fitment`, `_tyre_close_replaced`, `tyre_close_rotations`, `get_tyre_running_life`
  `_tyre_close_serial_elsewhere`, `tyre_import_reconcile` compare position text (trimmed or upper cased at
  most). Correct while both sides are ERP codes, blind to spelling variants.
- `supabase/functions/ai-tyre-inspection`: matches the previous reading on the stored position text.

## Questions for the owner

1. On concrete pumps, is "rear centre" (`LHRCO`, `LHCO`) the first rear axle and "rear rear" (`LHRRI`) the
   second? A yes lets 3 pending actions be offered.
2. Should Confirm be allowed on serial evidence alone when the wheel cannot be read (built that way, strong
   serials only)?
3. Should the tyre bay rename `LHRCO` to `LHCO` on mixers, or keep the ERP spelling as stored?
4. Is a layout history table wanted before admins start editing layouts?

## Integration of #522 (Codex, `fix/observation-erp-focused-lookup-20261115`)

Merged into this branch so there is one result.

Kept from #522:
- Focused loading in `src/lib/api/observationErpEvidence.js`: only tyre movements on or after the
  inspection date, job cards taken from those movements, then tyre related job cards opened after the
  inspection. No whole asset history scan. `evidenceLimited` flag kept.
- The redesigned panel (`ObservationErpEvidence.jsx`): automatic lookup, review / evidence / exception
  states, per candidate reason box, and the inspection photo shown before the ERP evidence.
- Suppression of unrelated job cards (`relevant`). Widened by one case: a job card with any tyre movement
  after the inspection stays visible even when its wheel is pending or different, so a reviewer can see why.
- Its three new matcher tests, unchanged, all passing.
- From its SQL: `tyre_position` is read before `position` (now in the draft and the JS).

Replaced, and why:
- `displayPositionCode` + `positionKey` in the matcher: replaced by `tyrePositionService.comparePositions`.
  The display helper keeps unplaced text as it is stored, so two unknown tokens could compare equal as text.
- The SQL `CASE` table in `supabase/migrations`: not kept. It substitutes text, lets an unknown slot fall
  through as raw text, treats every non mixer as "R1 is rear axle 1", and ignores the asset's registered
  build. The service based draft in `supabase/pending_migrations` stays the only SQL. The file does not
  exist in `supabase/migrations`.
- Its "empty position raises PT409" guard: already covered. An empty or unknown position evaluates to
  pending manual review and Confirm is refused with PT409.
- "Needs more evidence" for an unresolved wheel: now shows "Pending manual review" with the reason.

Not set up yet (the feature is on main while its tables are not in production):
- `getObservationErpReviewState` reports `provisioned: false` on 42P01, PGRST205, PGRST202, 42883
  (`isNotProvisioned`). The panel shows "ERP evidence review is not set up yet", the evidence lookup still
  runs (it reads existing tables only), Confirm and Reject are not offered. Any other failure is still an
  error. The observation PDF prints "Not confirmed" instead of "lookup unavailable" in that case.

Tests after integration: 46 vitest files, 773 passed (20 new: service 12, panel 5, plus Codex's 3);
mirror 4 of 4; staging 105 passed; eslint 0 errors (1 hook dependency warning that came with #522);
`vite build` clean.

Could not preserve from #522: nothing functional. Its SQL change is intentionally dropped.
