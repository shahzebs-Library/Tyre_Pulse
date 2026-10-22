# Workforce Intelligence — implementation and release record
Updated: 2026-10-22. Source: current code and verified production schema. This document is an agent handoff, not a declaration of production acceptance.

## In scope
Web: `src/pages/WorkforceDailyWork.jsx` at `/workforce-daily`.
API: `src/lib/api/workforceAssignments.js`.
Employee directory: `src/lib/workforceEmployeeDirectory.js`.
Flutter: `tyre_pulse_flutter/lib/features/my_work/`.
Database: `workforce_*` migrations and existing `profiles` table.

## Implemented
- Daily reports, manager assignments, reviews, evidence, statuses, board/schedule, provisional work standards.
- Assignment selector: complete paginated approved/unlocked employee directory, search by employee ID/full name/username/auth ID, filter by real `profiles.role`, visible site and identity confirmation.
- Filter helpers have focused unit tests. Personnel search does not fabricate job titles.
- Existing server-side notification queue, push-device resolver, and My Work deep-link mapping.

## Verified schema distinction
`profiles` contains `id`, `employee_id`, `username`, `full_name`, `role`, `site`, `approved`, `locked`. There is **no separate designation field**. The role filter is labeled designation/role for convenience but must not be marketed as HR designation data.

## Not yet certified
- Flutter durable offline assignment status writes using the central protected command registry and conflict-safe replay.
- Physical FCM delivery confirmation on Android and iOS.
- Historical calibration of work estimates against trustworthy completed observations.
- Staff/supervisor permission and production end-to-end acceptance.
- Android/iOS release build green gates.
- All root web UI/design-system and Vehicle Washing regression tests passing.
These must be tested; never mark them complete from source presence or an unverified build.

## Release protocol
Use a single consolidated PR, do not merge until CI is green; run tests for selector, access, Flutter sync, notifications, and business workflow. Record authenticated E2E evidence and physical device receipts separately from provider push acceptance.
