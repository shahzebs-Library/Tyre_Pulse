# Driver workspace and traffic fines delivery report

Updated: 21 September 2026

## Current delivery status

The production web module is named **Driver Workspace** and is available at `/driver-workspace`. Its backend is live in Supabase. It uses verified driver UUIDs and explicit driver-to-login links; names are never used to authorize access.

| Area | Delivered now | Still pending |
|---|---|---|
| Driver web experience | Own fines, notice details, evidence, balances, work records, assignments, acknowledgment, resolution request, exact notice version, statement version and signature. | Operational acceptance with real linked-driver accounts and real fine data. |
| Supervisor web experience | Assigned-driver roster, workflow counts, fine issue, evidence, signed response review, return/cancel actions, and team/vehicle history. | Operational user acceptance with real supervisor accounts. |
| Manager web experience | All supervisor functions plus driver/login/team/work-record administration, fine correction and driver reassignment with preserved lineage. | Real roster and fine data onboarding. |
| Finance web experience | Separate finance queue and approval after supervisor approval, verified partial/full payment recording, payment reference and balance history. | Configure the intended Finance users or `driver_workspace:finance` capability in each tenant. |
| Reporting | Scoped fine register, search/status/stage/overdue filters, complete filtered Excel/PDF export, individual case PDF with signed responses, signatures, reviews, payments, evidence, reminders and events. | Business dashboards beyond the delivered queue counts and register. |
| Notifications | Driver, supervisor, manager and finance notifications; daily due-in-seven-days, due-today and overdue reminder job; idempotent reminder log. | Confirm notification delivery preferences and any external push provider policy. |
| Expo app (`mobile/`) | A basic Driver Workspace implementation exists in source. | Enterprise workflow parity and release verification are deferred at the user's direction. No Expo source is changed by the current web repair. |
| Flutter app (`tyre_pulse_flutter/`) | A basic Driver Workspace implementation exists in source. | Enterprise workflow parity, Android/iOS gates and release are deferred at the user's direction. No Flutter source is changed by the current web repair. |

## End-to-end workflow

1. A manager verifies a driver, links the approved login, and assigns the supervisor, manager and vehicle.
2. A manager or assigned supervisor issues a fine with the official notice reference, authority, vehicle, incident date, amount, due date and assignment evidence.
3. The linked driver can read only their own case, choose direct payment, already paid, dispute, company recovery or instalments, explicitly acknowledge the statement and sign it.
4. The assigned supervisor reviews the signed response and approves it for finance, returns it to the driver, or cancels it with a reason.
5. A separate finance reviewer approves the arrangement. The same person cannot perform both the supervisor and finance approval.
6. Finance records only verified payments, including reference and amount. The case settles only when the verified paid amount reaches the notice amount.
7. Every material action writes an immutable review/event record. A signed correction requires a new driver acknowledgment while retaining the earlier signature. Reassignment cancels the old case, creates a linked case for the new driver, and does not expose the old driver's response or evidence to the new driver.
8. The daily job records and sends due reminders once per fine, reminder date and reminder type.

Company recovery and instalment selections are requests for staff review. They do not initiate government payment, company payment, payroll deduction or an instalment transaction.

## Access and data controls

- Driver access resolves from the authenticated account link on the server. A supplied driver ID does not grant ownership.
- Organisation, country, site, active-account and current-team scope are enforced by database functions and row-level security.
- Drivers cannot approve their own case, edit official fine data, reassign a fine, record payment or close a case.
- Corrections and decisions use optimistic case versions. A stale screen must refresh instead of overwriting a newer decision.
- Request IDs make repeated submissions idempotent.
- Evidence stays in the private `driver-fine-evidence` bucket and is opened through short-lived signed URLs.
- Signed response history is retained by notice version. Reports retrieve signatures only through authorized access.
- Direct execution of the internal command function is revoked from authenticated users; clients use the guarded public RPC.

## Data model and services

The implementation uses `drivers`, `driver_account_links`, `driver_team_assignments`, `driver_fines`, `driver_fine_responses`, `driver_fine_evidence`, `driver_fine_reviews`, `driver_fine_reminders`, `driver_record_links`, `driver_workspace_events`, notifications and private request-id records.

The web client calls:

- `driver_workspace` for roster and case detail.
- `driver_workspace_command` for controlled state transitions.
- `driver_workspace_options` for scoped user, driver, vehicle and work-record pickers.
- `driver_fine_register` for paged, filtered staff reporting.
- `driver_workspace_run_reminders` for an authorized manual reminder run.

The scheduled `driver-fine-daily-reminders` job runs at 05:15 UTC. The server uses the database date for its due calculations.

## Verification completed

- Database workflow test: 12 passed. It covers same-name separation, tenant/team scope, duplicate protection, private evidence, signed version binding, idempotent retry, supervisor/finance separation, verified payment, signed correction, reassignment lineage, reminders, staff register, locked users and anonymous denial.
- Production error `ERR-3I2FD0VO` was traced to roster/detail state crossing during Back navigation. The web response is now bound to the requested driver context and malformed response collections fail at the API boundary.
- Focused Driver Workspace component test: 8 passed, including the exact driver-detail-to-roster transition that caused `ERR-3I2FD0VO`.
- Focused ESLint: passed for the changed web files.
- The enterprise web release build passed before deployment. The later isolated navigation repair was verified with its focused test and lint; no broad rebuild was repeated.
- Production database migration: applied as `20260921134725_driver_fine_enterprise_workflows`.
- Live database verification: register RPC, reminder RPC, workflow stage column and scheduled reminder job are present.
- Supabase advisors were checked after migration. The new tables have RLS policies and the new security-definer functions pin an empty search path. The project still reports pre-existing repository-wide advisor items outside this module.

## Operational work before staff rollout

Live readiness was checked on 21 September 2026: 674 drivers exist, 88 have login links, all 674 have no recorded site, and there are no current team assignments, fines, fine responses, reviews, evidence records, reminders or configured Finance users/grants. The daily reminder job is active but has no cases to process.

1. Correct driver sites from an authorized operational source; do not infer or fabricate them.
2. Populate and verify driver-to-login links and current supervisor/manager/vehicle assignments.
3. Assign Finance users or grant the `driver_workspace:finance` capability.
4. Confirm which resolution options are permitted by company policy and document who may approve recovery or instalments.
5. Validate the 05:15 UTC reminder time for each operating region.
6. Run acceptance with one driver, one supervisor, one different finance reviewer and one manager using real scoped accounts.
7. Authorize a separate mobile phase when Expo and Flutter enterprise parity is required.

## Main implementation references

- [Driver Workspace page](../src/pages/DriverWorkspace.jsx)
- [Fine register](../src/components/driver/DriverFineRegister.jsx)
- [Web API](../src/lib/api/driverWorkspace.js)
- [Fine reports](../src/lib/driverFineReports.js)
- [Enterprise migration](../supabase/migrations/20260921134725_driver_fine_enterprise_workflows.sql)
- [Database workflow tests](../supabase/tests/driver_workspace.test.mjs)
- [Web workflow tests](../src/test/driverWorkspace.test.jsx)
