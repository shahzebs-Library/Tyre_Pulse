# Driver fines: current capability and implementation report

Assessment date: 12 September 2026. Scope: production web source, Expo mobile source, Flutter mobile source, and read-only production database metadata/counts in project `jhssdmeruxtrlqnwfksc`. This is an assessment and implementation proposal; no application or database changes were made.

## Outcome

Add a driver-owned **My Fines** experience connected to an administrative **Traffic Fines** register. Link both through the existing driver master using a verified driver-to-login association. Driver Intelligence should show the resulting fine history, while the fine register owns notices, responses, evidence, and settlement.

The requested end-to-end workflow is not present in the inspected implementation. Existing driver analytics, approval infrastructure, signatures, and notifications provide useful foundations.

## What exists and what is pending

| Capability | Evidence and current state | Remaining work |
|---|---|---|
| Driver Intelligence | Web groups `tyre_records` by `driver_name` and calculates tyre cost, life, failure and risk statistics. | Stable identity linking and fine-specific history. Names cannot safely establish ownership. |
| Driver detail approval | `driver_violation` approval uses driver name as entity ID and `tyre_cost_risk` as violation type. | An individual traffic notice requires its own unique case ID and workflow. This approval is not evidence that traffic-fine processing exists. |
| Driver master | Live `drivers` table has UUID `id`, employee/badge identifier `driver_id`, name, licence, phone, assigned asset and scope. Live count: **0 records**. | Populate verified drivers and link each to an approved login. No dedicated login-link column was found on this table. |
| User identity | `profiles` has employee ID, role, organisation, country/site scope and approval/lock fields. No profiles with a role containing `driver` were returned. | Driver onboarding and verified account association; this query does not imply there are no drivers using other roles. |
| Driver expenses | Web has expense creation/editing, statuses and PDF/Excel export. Categories are fuel, toll, parking, meals, accommodation, maintenance, training and other. Live count: **0 records**. | A fine is not currently a dedicated category or workflow. Expense status does not establish fine acknowledgment or settlement. |
| Safety/coaching/training/documents | Related web pages and live tables exist; inspected tables use `driver_name`. | Extend verified driver identity across these modules incrementally. Do not infer personal ownership from matching names. |
| Traffic-fine data | No public table name containing fine/violation was returned; focused source search found no dedicated traffic-fine implementation. | Notice register, attachments, driver responses, resolution decisions and settlement evidence. |
| Expo mobile | Driver role/module access exists for field tasks. Signature components, notification inbox and approval infrastructure exist. No dedicated My Fines route found. | Driver fine list, detail, response, signature, receipts and notifications that open the correct fine. |
| Flutter mobile | Existing approval signature widgets and notifications are present. No dedicated fine feature/route found. | Equivalent driver experience, repositories, localization, offline handling and Android/iOS verification. |
| Fine-specific signature | General signature components exist. | Bind the signature to the authenticated driver, exact notice version, displayed statement and selected response. |
| Access control | Existing driver/expense policies include organisation/country scope and broad authenticated access conditions, without a driver-owner predicate in the inspected policies. | Add and test explicit personal ownership before exposing records to drivers. This review does not claim a complete exploit assessment of all grants, policies and triggers. |

Repository context identifies Flutter as the primary mobile direction but records recent production Expo releases and deferred Flutter rollout. Delivering only Flutter would not demonstrate delivery to the currently installed Expo users. Confirm the intended release channel during implementation; preserve existing releases and work in both codebases.

## How the link should work

1. An authorized administrator creates or verifies the driver master record from real employee records.
2. Associate that driver's UUID with their approved authenticated account within the same organisation. Add an explicit association through a migration; do not use `created_by`, phone text, or a name match as ownership.
3. Prevent duplicate active account associations and audit linking, unlinking and reassignment. Employee identifiers can suggest matches, but ambiguous matches require review.
4. Assign each fine to that driver UUID and the relevant vehicle. Record who confirmed the assignment and supporting evidence.
5. Verify who was driving at the incident time. The driver's currently assigned vehicle alone does not prove historical responsibility. If assignment history is unavailable, require manual confirmation.
6. Resolve My Fines from the signed-in account on the server. Never trust a driver ID supplied by the mobile screen as authorization.

Keep the original driver name and notice details as historical snapshots. Correcting a driver master name must not silently rewrite a signed notice. Legacy name-based records with uncertain identity remain unlinked until reviewed.

## Proposed driver journey

**Home → My Fines → Fine details → Respond → Review and sign → Submission receipt**

The list shows New, Awaiting my response, Under review and Closed, with an action badge. Detail shows notice reference, authority, incident date/time, vehicle, location, amount/currency, due date where supplied, supporting notice and assignment explanation.

The driver first acknowledges that they received and reviewed the displayed notice. Then they select an available resolution request:

- **I will pay directly:** submit the proposed payment date; later upload receipt/reference. Staff verify settlement.
- **Request company payment/recovery:** show only when enabled by company policy; route to the designated reviewer.
- **Request instalments:** show only when enabled; capture the requested schedule and submit for review.
- **Dispute / not my vehicle or assignment:** require an explanation and allow evidence. Preserve the response while staff investigate.
- **Already paid:** upload payment proof for verification.

These are proposed choices, not existing functionality. Company-payment, payroll and instalment options require approved business rules before activation. A request must not itself initiate a payment or payroll deduction. No government payment integration was established by this assessment.

Before submission show the exact acknowledgment text, response, attachments and signature. Require an explicit submit action even when reusing a saved signature. Store authenticated signer identity, server receipt time, notice version and statement version. Return a receipt the driver can reopen or download.

A dispute can acknowledge receipt without accepting responsibility. Acknowledgment does not mark the fine paid. The artifact is an operational record; this assessment makes no legal-validity determination about signatures or deductions.

## Administrative workflow

Create/import notice → validate duplicates → confirm driver assignment → issue notice → notify driver → receive response → review resolution → verify settlement or cancellation → close case.

Unassigned notices stay in a staff queue. Do not send them to a guessed recipient. Provide queues for unlinked drivers, undelivered notifications, awaiting acknowledgment, disputed assignment, pending resolution, overdue notices and unverified payments.

Keep acknowledgment, resolution and settlement as separate status fields. Record corrections and reassignment as new events. Material changes to a signed amount, assignment or statement require a new response; retain the previous signature and notice version. Reopening a case requires an audited reason.

Managers can issue/review within their authorized scope. Drivers can read and respond only to their own issued notices. Finance or another configured reviewer verifies settlement. Drivers cannot edit the official amount, replace the assigned driver, approve their own request or close a fine by changing a status field.

## Backend and shared components

The following are proposed data responsibilities, not claims that these tables or APIs already exist:

| Responsibility | Required information |
|---|---|
| Account association | Driver UUID, account UUID, organisation, active period and linking audit |
| Fine case | Unique ID, notice reference/authority, driver, vehicle, scope, incident details, amount/currency, due date, source and version |
| Driver response | Notice version, acknowledgment statement/version, chosen resolution, explanation, signer, signature reference, server timestamp and retry key |
| Evidence | Private notice/signature/payment attachments, case ownership and uploader |
| Review and settlement | Reviewer, decision/reason, approved arrangement, verified payment reference/amount and remaining balance |
| Case history | Append-only events for issue, delivery attempts, viewing, responses, corrections, reassignment and closure |

Implement schema changes with explicit migrations, foreign keys, tenant-safe constraints, controlled transitions and idempotent submission. Reuse the existing notification inbox and approval/signature components only after verifying their contracts for the new case type. A push delivery or read flag alone is not acknowledgment.

Use private attachments with authorized access. Apply ownership to reads, writes, attachments and exports, alongside existing tenant and staff scope. Test direct API access as well as hidden/visible buttons. Supabase documents that RLS enforces row access inside the database and must be combined with appropriate grants: [official RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

Cache previously fetched notices for offline reading and preserve unsent drafts. Show pending upload/submission clearly; never display acknowledged until the server accepts the response. An offline signature cannot be replayed against a changed notice: validate its version on reconnection and require renewed review if it changed. Settlement/reviewer decisions should require current server state.

## Reporting required

Driver statement: assigned notices, amounts by currency, acknowledgment dates, selected resolutions, reviewer outcomes, verified payments, balances and signed receipts.

Management register: filters for organisation/country/site, driver, vehicle, incident date, authority, acknowledgment, dispute, resolution and settlement. Include notice amount, due date, issue/view/response times, signature presence, response choice, reviewer, payment reference and closure reason. Provide filtered PDF/Excel export and a case PDF containing notice, response, signature and event history.

Dashboard: unassigned, awaiting response, overdue, disputed, awaiting payment verification and outstanding amounts. Calculate from actual case records. Keep different currencies separate and show unavailable values honestly. Fine history should appear on Driver Intelligence through stable identity; any change to driver scoring requires an explicit scoring rule rather than automatically treating a disputed fine as confirmed misconduct.

## Delivery order and acceptance

1. **Identity and permissions:** verify driver population, onboarding and account linking; define authorized staff and resolution choices.
2. **Backend and web register:** migrations, ownership, case creation/assignment, evidence, controlled responses, reviews and history.
3. **Driver mobile flow:** My Fines, detail, signed response, receipts, notification routing, loading/error/offline states and supported languages/RTL/dark mode.
4. **Reporting and related modules:** case PDF, register export, Driver Intelligence fine tab; gradually connect coaching, documents, training and expenses to verified IDs.
5. **Release acceptance:** test and release the app actually used by drivers, with Flutter parity handled explicitly.

Acceptance must demonstrate: two drivers cannot read or modify each other's notices; cross-tenant access is denied; unlinked/locked accounts cannot act; forged IDs are rejected; signatures are bound to the exact notice; repeated taps/retries create one response; changed notices require re-review; disputes preserve history; payment proof does not auto-close; notification links enforce access; offline drafts survive restart; logout does not expose cached records to another user; reports match case balances and currencies; and the complete journey works on Android/iOS.

Run focused backend/web/mobile tests during development and required package/platform gates once the implementation is stable. No application tests or builds were run for this read-only assessment and report. Authenticated end-to-end behavior on deployed web or installed phones was not tested.

Operational inputs still needed: verified driver employee/account roster, initial fine source (manual/import/integration), enabled resolution options, reviewer roles/order, reminder timing, and intended first mobile release channel. These are setup decisions, not evidence of a technical feature already completed.

## Source references

- [Driver Intelligence](../src/pages/DriverManagement.jsx): tyre-record loading and name-based aggregation.
- [Driver detail](../src/pages/DriverDetail.jsx): `driver_violation` / `tyre_cost_risk` approval context.
- [Driver expenses API](../src/lib/api/driverExpenses.js) and [page](../src/pages/DriverExpenses.jsx): existing expense fields, categories and exports.
- [Driver master migration](../MIGRATIONS_V50_SUPPLIER_DRIVER_MASTER.sql) and [expense migration](../MIGRATIONS_V152_DRIVER_EXPENSES.sql).
- [Expo permissions](../mobile/lib/permissions.ts), [signature field](../mobile/components/SignatureField.tsx), [notification inbox](../mobile/lib/notificationsInbox.ts).
- [Flutter routes](../tyre_pulse_flutter/lib/app/router/routes.dart) and [notification screen](../tyre_pulse_flutter/lib/features/notifications/presentation/notifications_screen.dart).
- Production `information_schema.columns`, `information_schema.tables`, `pg_policies`, aggregate driver/expense counts and driver-role counts, queried read-only on the assessment date. No personal records were exported.
