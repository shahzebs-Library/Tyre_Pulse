# Physical navigation audit — 2026-08-28

Product: Tyre Pulse Flutter on Samsung Galaxy M10s (`SM-M107F`), Android 11.

Task: inspect the five signed-in primary destinations and determine why the
installed application does not match the richer PMV experience planned with the
product owner.

## Captured steps

1. **Home — needs redesign.** `01-home-clean.png`
   - Functional actions and real data states are present.
   - The screen reads as a plain grid rather than an operational PMV command
     hub. Long labels truncate and the three equal-width stat cards are too
     narrow for their content.
   - The thin clipped surface at the left edge is a P1 layout defect visible on
     every captured route and makes the app look horizontally misaligned.

2. **New inspection — functional but visually inconsistent.**
   `02-inspect-current.png`
   - The three-step state, resumable draft, asset search, site and meter inputs
     render and the disabled next action is honest.
   - Large empty space and weak section grouping make the form feel unfinished.

3. **Inspection approvals — functional but tyre-only in emphasis.**
   `03-approvals-current.png`
   - Real pending records render with status, site, inspector and date.
   - The list lacks an overview/filter layer and does not communicate how this
     approval surface relates to wider PMV maintenance and accident work.

4. **Accidents — P0 missing destination.** `04-accidents-current.png`
   - The primary tab reaches `TpScreenNotAvailable` for
     `accidentDashboard`. The route exists, but no feature registration is
     wired into the composition root.
   - This blocks accident reporting, detail, case workstreams, insurance,
     workshop assessment, handover, SLA and recovery work.

5. **Profile — functional but incomplete as an operations profile.**
   `05-profile-current.png`
   - Real user, role and site state render and sign-out is available.
   - No language/display preference, sync/account health, task history or role
     scope summary appears here.

## Highest-impact correction order

1. Register and implement the four existing Accident route IDs without editing
   the protected router files.
2. Recompose Home around real operational actions and responsive information
   cards; never invent KPI values.
3. Apply the same visual hierarchy, responsive spacing and state treatment to
   Inspect, Approvals and Profile in controlled vertical slices.
4. Rebuild and compare the same five routes on the same physical device.

## Evidence limits

The screenshots support visual/layout and route-availability findings only.
They do not prove full accessibility compliance, database RLS, offline replay,
notification delivery, PDF generation, external email delivery, or the entire
accident workflow. Those need widget/integration tests and backend verification.
