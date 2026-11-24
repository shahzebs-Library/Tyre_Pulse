# Tyre Pulse | Ready-mix PMV control and implementation brief

24 November 2026 · For the PMV manager, process owners and implementation team

## Decision and scope

Extend the existing Tyre Pulse workflows around the job card. A mixer repair should be traceable from the driver's complaint to the mechanic, the part issued, its installation, the removed component, the independent release and the amount charged. At every open step a named person or staffed queue must own the next action. The same model must support scheduled servicing, field breakdowns, plant equipment and office approvals.

The operating model below is a proposed design. Departments are logical responsibilities. A small site can assign several roles to one person subject to the approval rules. Company-specific thresholds, signatories, labour rates, shifts and SLA times must come from approved configuration. Examples are test fixtures.

## 1. What Tyre Pulse already does

Reviewed selected source files at main commit 5d59ac7c47c7f537af9db13006b93c381736b276 and relevant merged change records. “Source” means implementation inspected. “Release record” means the repository documents an earlier deployment. Neither certifies today's database configuration, workers, mobile binary or site permissions. “Verify” means run the stated scenario before deciding to build.

| Control | Evidence and current behaviour | Engineering decision |
|---|---|---|
| Asset identity and history | Source E1 reads an asset timeline by country and asset number, bounds its queries and identifies unreadable sources. PR 547 tightened company-scoped joins. | Reuse Vehicle 360. Resolve native asset ID within company and country. Verify transfers, renamed codes and identical codes across companies. |
| People and work | Source E2 and PR 577 show assignment subscriptions, offline status transitions and a refreshed web daily board. PR 479 records reassignment alerts. | Keep My Work and the board. Bind the assignment, task line, shift, labour interval and handover. Show last confirmed activity and offline backlog. |
| Field evidence | E3 expressly requires a connection for workforce files. PR 597 describes an encrypted inventory outbox and role-labelled photos. | Build durable evidence capture for workforce assignments. Verify inventory's existing design for reuse, including partial upload recovery. This is a confirmed workflow difference. |
| Permissions and quality | E4 includes distinct progress, QC, close, cost and cost-approval rights. E5 models submit, return, approve and fault acknowledgement. Both refer to SQL drafts. | Test the actual installed functions using a mechanic, reviewer and supervisor. Reuse existing decisions and audit trail. Connect release eligibility to those decisions. |
| Parts and stores | E6 exposes historical material issue slips linked to job cards and a returns register. The source flags returns booked as charges and distinguishes the legacy issue entry from live balances. E7 documents inventory migrations, reconciliation and blind-count verification. | Reconcile the two paths on real document keys. Confirm exactly which writer moves stock, which posts expense and which only displays ERP history. An issue slip alone cannot confirm fitment. |
| Counting and material identity | E8 handles physical inventory, private photos, duplicate attachments and an explicit setup state. PRs 597 and 606 cover Flutter counts, bins, OEM refs, brand/type and posted versus pending stock. | Keep the master and counts. Add links from approved material variants and stock movements to requested, fitted and removed lines wherever absent. |
| Preventive maintenance and meters | E9 presents PM schedules, analytics and due indicators. PRs 499 and 534 distinguish fitment distance and engineering KPI definitions. | Verify the due-to-job-to-next-service loop for road km, engine hours, pump hours and calendar intervals. Preserve raw readings and meter changes. |
| Tyres | PRs 472, 473 and 568 cover serial exceptions, fitment history, lifetime CPK, wheel position and site. | Use tyre fitment and casing custody for tyre jobs, including rotation and warranty. A removal needs an explicit disposition. |
| Fuel and lubricants | PR 109 documents delivery analytics by site and supplier. PR 499 addresses distance used for fuel reporting. | Verify receipt, tank stock, dispense, vehicle/operator meter and closing dip as a single reconciliation. Delivery analytics alone establish only part of the chain. |
| Ready-mix production and cost | E10 calculates regional cost per m³ using approved production and named expense sources, separated by country. | Preserve that definition. Verify load ticket, dispatch availability, pump attendance, downtime and substitute asset integration separately. |
| Long storage, recovery and sale | E11 reads proposed disposals against fleet, job-card, spend and tyre records. | Extend the case to physical location, preservation, component recovery, approvals, collection, proceeds and final asset status after verifying existing actions. |
| Sharing and executive reports | E12 documents a public-board audit and PR 609 adds scoped links and migration source. The audit records prior gaps around spend, scope and access history. | Verify installed SQL and scope against the exact report used. Tie approved snapshots to the same posted facts as the job, stock and finance views. |
| Items requiring discovery | Sampled evidence does not establish full dispatch holds, tool calibration gates, contractor acceptance, employee time allocation or an end-to-end closure notification. | Search remaining schema, jobs, integrations and Flutter routes by business event. Mark each proven, partial or missing with a reproducible case. |

## 2. Who hands work to whom

| Responsibility | What the person does and records | Next person and decision |
|---|---|---|
| Driver / operator | Accept assigned asset and shift. Scan asset, confirm location and meters, perform class-specific check, attach defect and note loaded/empty status. | Dispatch sees availability. Duty foreman accepts each actionable defect. |
| Batching / dispatch | Link shift plan, plant, trip or batch ticket, customer site, mixer/pump and backup. Log planned and actual interruption. | Planner arranges replacement. Plant or site acknowledges the changed plan. |
| Workshop control / planner | Link duplicate complaints, classify severity, choose workshop/field/vendor, allocate bay, trade, due time, parts and test plan. | Foreman accepts, reassigns with reason or sends missing details back. |
| Field service / workshop foreman | Name lead and helpers, confirm isolation/permit status where applicable, tools, location, estimates and tasks. | Assigned mechanics acknowledge individual tasks. |
| Mechanic / electrician / hydraulic technician / tyreman | Record work, measurements, time, parts needed, diagnosis, replacements and evidence per task. Note blocked reason and responsible party. | Store handles material, then independent reviewer receives completed work. |
| Storekeeper / controller | Reserve, pick, issue and receive returns by bin, quantity, unit, condition, batch/serial and job. Keep custody signatures. | Mechanic confirms receipt. Controller handles shortages, damage or count discrepancies. |
| Procurement / vendor | Receive approved shortages, check compatible alternatives and contracts, obtain authority, order, track ETA and repairable cores. | Receiving confirms quantity and condition. Technical owner accepts substitutions or vendor repair. |
| Fleet engineer / quality inspector | Choose job-specific checklist, compare required result with observed reading, attach evidence and approve or return each failed line. | Foreman owns rework. Fleet release authority handles accepted work. |
| HSE / incident lead | Take ownership of incident-linked holds, evidence and any required investigation or clearance. | Release authority receives recorded clearance where required by policy. |
| Site manager / operations | Accept vehicle back into service with location, meter, recipient and time. Link any remaining restrictions and expiry. | Dispatch receives updated availability. Follow-up work has its own assignee. |
| Finance / cost controller | Match issued and returned material, labour, vendor invoice, warranty recovery and cost centre. Resolve mismatches with the originating department. | Authorised finance approver posts or reverses with a reason. |
| PMV manager / command centre | Review jobs without owners, delays by cause, critical holds, repeat defects, pending parts, cost exceptions and capacity across sites. | Department owner receives a named action and deadline. |
| Internal auditor / management / CEO | Auditor traces transactions and exceptions. CEO sees summarised availability, production impact and approved spend with drill-down under access rights. | Corrective action assigned to process owner, verified independently and closed with evidence. |
| HR / admin / master-data owner | Maintain employee identity, supervisor, roster, delegation, trade and authorisation dates. Maintain asset, material and location masters. | Expired or missing assignment routes to supervisor queue. Rate changes require effective dating. |

## 3. Required job workflow and acceptance rules

Use existing status vocabularies and map them to the milestones below. Keep asset availability, job progress, quality review and financial posting independently visible. A truck released today may still have an invoice outstanding.

| Milestone | Trigger and evidence | Server action and next owner |
|---|---|---|
| Reported | Driver, PM due event, breakdown call, inspection, repeat failure or audit finding. Require asset, site, source, event time, reporter, defect or service code. | Create or link one case per source event. Assign triage. Critical class raises a dispatch hold according to approved policy. |
| Triaged | Foreman records severity, diagnosis to confirm, impact, initial meter and target. Duplicate requires reference to open parent. | Start applicable SLA. Notify planner. Preserve both original reports. |
| Planned / accepted | Planner records job lines, trade, estimate, required items, responsible lead, site/bay and QC checklist version. | Assign tasks. Unaccepted work escalates to duty supervisor. A reassignment shows who passed it and why. |
| Working / blocked | Each worker starts, pauses or resumes a task and selects reason. Capture actual service location separately from home site. | Track active time and waiting time independently. Parts wait goes to store, purchase wait to buyer, decision wait to approver. Keep overall downtime running where asset is unavailable. |
| Material requested / issued | Record requested, approved, reserved, issued and received quantities. Allow partial supply, compatible substitution with engineering approval and unused returns. | One inventory transaction per confirmed movement. Log store issuer and recipient. Backorder remainder with ETA. |
| Installed / accounted for | Mechanic chooses issue line, component position, installed quantity or serial, removal reason, old serial, condition, photos and disposition. Permit consumables by quantity. | Check unit and fitment compatibility. Reconcile issued = installed/consumed + unused returned + outstanding + approved loss, in one base unit. Old-part recovery has its own custody trail. |
| Submitted for QC | Lead signs completed task list, time and readings. Mandatory photos must have server receipts. | Route to qualified reviewer. Reject missing evidence with item-level reasons. Leave completed work visible. |
| Passed or returned | Reviewer records test method, measured result, limit source, pass/fail and reviewer identity. Record each rework cycle. | Failed line returns to named technician with due time. Preserve prior result. New sign-off required before release. |
| Released / received | Authorised release checks blockers and records time, meter and any approved restriction. Operator/site accepts handback. | Update availability and notify dispatch once. Keep financial and warranty follow-up open with named owners. |
| Costed / closed / corrected | Finance reconciles material, labour, outside service and credits. Supervisor checks all required outcomes. | Post exactly once. Subsequent change requires linked reversal or amendment, reason, approver, recalculated totals and a new report version. |

Exceptions: emergency field jobs may start under a configured duty authority with justification and retrospective approval due. Cancelled jobs release reservations, account for issued stock and preserve worked time. Shift transfer records outgoing and incoming staff, pending lines, tools, photos and acknowledgement. A vendor or inter-site transfer retains the sending owner until receipt, with a separate in-transit status.

## 4. Equipment, controls and accounting rules

| Requirement | Implement through existing modules | Acceptance evidence |
|---|---|---|
| PMV-01 Asset and location | Support mixer chassis, drum/PTO, pump chassis and boom, loader, generator, compressor, bus, service van and stationary plant. Track parent/component, asset tag, serial, ownership, home/current site, bay/bin, custodian and effective dates. | Moving a component preserves both assets' histories. A repeated fleet number in another country returns separate records. |
| PMV-02 Meter integrity | Record meter type, unit, source, time, photo or import key, who read it and validation status. Quarantine unexplained decreases, improbable jumps and conflicting same-time readings. Authorise resets with old/new readings, effective offset and reason. | Replacing a generator hour meter preserves lifetime hours. A stale offline reading is ordered by observation time and cannot overwrite the current reading. |
| PMV-03 Scheduled maintenance | Apply by asset class, manufacturer programme and duty cycle. Support date, km, engine/drum/pump hours and whichever comes first. Generate one job per due event. Capture service result, actual meter and basis for next due. | Date and km becoming due together produce one planned service. Deferral requires approver, reason and revised due limit. |
| PMV-04 Fuel and oil | Record supplier receipt, tank, opening/closing dip, transfers, dispenser totalizer, asset issue, litres, grade, receipt, operator and meter. Handle bulk oil, grease and packaged units with explicit conversions. | Expected closing = opening + receipts + transfers in − transfers out − issues ± approved adjustments. Compare with measured closing. Attribute each exception to a named investigator. |
| PMV-05 Consumption controls | Calculate L/100 km for eligible road use and L/engine-hour for stationary equipment. Keep idle/PTO data and missing coverage visible. Compare within asset class and duty cycle. Link lubricant issue to service, top-up or leak case. | Zero denominator shows unavailable. A mixer on site with drum running does not acquire invented travel km. Unusual top-ups open an investigation. |
| PMV-06 Tyres and components | Capture wheel position, old/new serial, pressure/inspection, fitment meter, removal reason and destination. Preserve successive fitment intervals. Maintain cores, batteries and repairables by serial when applicable. | One active tyre per wheel and one active location per serial. Transfer and refit keep lifetime distance. Warranty or inspection can receive a removed tyre. |
| PMV-07 Parts and purchasing | Use material master, OEM/manufacturer reference, allowed variants, stock owner, location, lead time and unit. Shortage can trigger transfer or requisition. Link demand to PO, goods receipt, discrepancy, invoice and warranty. | Partial receipt leaves balance due. Consignment retains vendor ownership until contract trigger. Supplier return, price variance and rejected substitute remain visible. |
| PMV-08 Tools and external work | Register assigned tool or kit, checkout, return, condition, calibration expiry where required. Vendor jobs retain estimate, purchase approval, custody, report, acceptance and warranty term. | An expired required measuring instrument blocks the relevant test. Vendor invoice alone cannot mark a repair passed. |
| PMV-09 Ready-mix continuity | Connect dispatch to authoritative plant/ticket references. Track loaded breakdown, plant interruption, replacement mixer/pump, affected tickets, site acknowledgement and actual delay. Concrete acceptance/rejection belongs to plant/lab authority. | One incident affecting three tickets counts as one PMV failure and three affected tickets. Delay, rejected volume and estimates remain distinguishable. |
| PMV-10 Long storage and disposal | Tag asset, zone/bay, ownership papers, transferable status pending verification, condition, missing components, preservation schedule, photos and committee decision. Record recovered parts in quarantine until inspected. For disposal retain approved lot, valuation, bids, buyer, collection, weighbridge where relevant and proceeds. | Proposed disposal leaves asset history intact. Sold asset cannot be dispatched. A recovered engine has a traceable receiving bin and carries its donor identity. |
| PMV-11 Labour and SLA | Link each person's time to assignment, job line, date, shift and site. Store team lead, helpers, travel, direct work, delay codes and approved amendments. Calendar and urgency determine deadlines. | Two mechanics working one hour produce two labour-hours and one elapsed job-hour. Overlaps are flagged. Procurement waiting is attributed to the responsible queue. |
| PMV-12 Finance and warranty | Separate estimate, commitment, posted cost and recovery. Use signed stock movements, effective labour rates and accepted outside charges. Link imported ERP expense and originating movement to prevent double counting. Store local currency and any approved reporting FX rate/date. | A returned spare reduces net job cost once. Warranty claim submitted is distinct from credit received. Missing unit cost is unvalued. Show SAR, AED and EGP separately until conversion is documented. |
| PMV-13 Audit and correction | Record actor, role, organisation/site, source, observed/server time, prior/new value, reason, evidence, approval, correlation ID and superseded event. Retain original approvals and issued PDFs. | Auditor can work backwards from a KPI to postings and signed records, then forwards from an original correction to the amended report. |
| PMV-14 Office and approvals | Route budget approvals, technical substitutions, HSE clearance, supplier discrepancies and credit claims through action queues with delegates, SLA, escalation and receipt. Version approval limits by country/currency. | An absent manager's valid delegate can act within limit. A requester cannot approve their own controlled adjustment. Expired delegation is refused. |

## 5. Data and software contract

These are logical records. Map them to existing relations and RPCs before adding a table. Within an organisation use immutable IDs for writes. External document numbers are searchable references qualified by origin, country and source line.

| Record family | Required links and fields |
|---|---|
| Asset, component, meter, location history | Organisation, country, asset ID, parent asset/component, meter type and unit, effective dates, location and custody. |
| Case, job, job line, assignment | Source event → case → job → task. Each open action has owner/queue, due time, status, reason, priority and version. One job can resolve several linked observations with independent outcomes. |
| Employee, shift and labour interval | Employee ID, role at event, supervisor, site, shift, job line, start/end, activity, delay owner, rate reference and approval. Distinguish recorder from person who performed work. |
| Demand, issue, fitment and custody | Job line → request line → reservation/issue or transfer → receipt → install/consume → return/core disposition. Record units, quantities, serial/lot where applicable and original ERP keys. Support split issues and multiple jobs on one purchasing document through line-level allocations. |
| Review, release, evidence | Checklist and version, task, required/actual value and unit, outcome, attachment ID/hash/upload status, reviewer, decision time, failure/rework and operator acknowledgement. |
| Posting, recovery, production | Job, asset, cost centre/site, dates, original currency, amount, posting state, invoice/credit, allocation, reversal pointer and ERP key. Reference dispatch/ticket and approved m³ series separately. |
| Event delivery and correction | Operation ID, entity version, dependency IDs, actor, source device, timestamps, decision/result, delivery attempts and correction/supersession link. |

Server command contract: each mutation accepts the business record ID, expected version, client operation UUID, scope and typed payload. Derive user and permitted scope on the server. In one transaction validate rights, predecessor, stock/serial availability and version, then write business change, audit entry and outbound event. A replay returns the original result. Conflicts return current state and an actionable reason. Existing ERP imports require uniqueness by source system + company + document + line + event type or a reviewed mapping if no stable key exists.

Notification contract: create one event per committed transition. Route by site, role, named owner and escalation policy. Store channel, delivery state, next retry and acknowledgement. Completion email goes to configured recipients after the defined release or close event. Retrying email cannot close a job twice. Expired staff assignments or missing recipients go to the duty supervisor queue. Notify only people authorised to open the record.

## 6. What each screen must let someone do

**Flutter My Work.** Start at today's assigned jobs by site and urgency. The mechanic can accept, scan asset, open task, see required parts, log work or waiting, request or acknowledge parts, record old/new items, capture photos and submit for QC. Keep the current asset and job visible throughout. A failed scan permits controlled manual lookup. Support the existing app languages, RTL, large targets and camera failure recovery.

**Offline field work.** Cache assigned tasks, relevant asset details and permitted reference data per signed-in user. Persist queued commands and evidence on device before showing “saved on device”. Queue photos with durable local references. Sync in dependency order, confirm metadata and file receipt, then mark synced. A reassigned job, conflicting stock, revoked permission or changed version enters review. Show oldest pending item, per-item error and retry. Server-only decisions such as stock posting, final approval and dispatch release take effect after server confirmation. Managers see last sync time. They cannot see unsent work on a disconnected device.

**Store desk.** From the job demand show requested, reserved, picked, collected, consumed, returned and outstanding with unit, bin, custody and document reference. Permit a partial issue and quantity still needed. Open the associated PR/PO or transfer from the same line. Flag outstanding removed cores separately from unused new stock.

**Workshop supervisor.** One shift board by employee, asset, bay and site. Each card shows last confirmed action, current blocker, next owner, due time, evidence status and ETA source. Open the full job from the card. Compare planned versus actual work and external waits. Record handover at shift end.

**Quality and release.** Open line-specific checks with procedure reference, before/after evidence, measurement and reviewer decision. Return individual lines for rework. Show unresolved holds and the person authorised to clear each one. Release and site handback remain separately timestamped.

**Manager, auditor and CEO.** Manager gets overdue handoffs, parts waiting, lack of labour, repeat repairs, unreconciled fuel, unreturned cores and cost exceptions. Auditor can follow a selected transaction in both directions, see original evidence and export a dated case pack. CEO sees availability, measured downtime, production affected, approved cost and recoveries by country/site with coverage and drill-down. Apply existing scope to exports, email and shared reports.

## 7. Measures and tests for sign-off

| Measure | Definition and safeguards |
|---|---|
| Fleet availability | (Scheduled asset-hours − union of unavailable intervals within schedule) / scheduled asset-hours. Publish eligibility, missing schedule coverage and planned/unplanned splits. |
| Repair time and waiting | Define MTTR start/end in the metric version, show sample count, active repair hours and elapsed restoration hours separately. Report waiting for parts/approval/vendor by owner. |
| First-pass quality and repeat faults | Jobs passing first submitted QC / reviewed jobs. Repeat faults match reviewed subsystem and failure mode within configurable days or usage; flag candidates for engineer confirmation. |
| Labour and SLA | Direct approved hours / available roster hours with leave, training and coverage disclosed. Report SLA by priority, task type, shift and delay owner. Employee drill-down includes case mix, safety holds, rework and supporting records. |
| PMV spend and productivity | Net posted parts + approved labour + accepted external charges under a versioned scope. Display recoveries separately and avoid invoice/stock double counting. Use existing governed tyre lifetime CPK and approved production m³ measures where applicable. Label estimated loss separately. |

### Acceptance scenarios for engineering

1. **Mixer breakdown at a customer site.** Driver reports a loaded mixer. Dispatch sees the hold and links the affected ticket and substitute. Two mechanics attend. Store issues parts, lead records installation, reviewer rejects one test, technician corrects it, reviewer passes and site accepts handback. One incident, two review cycles, one release and one notification per intended recipient.
2. **Parts and labour arithmetic.** Issue three filters at SAR 80, install two and return one. Two mechanics each work one hour at SAR 50/hour. Net material SAR 160, labour SAR 100, expected job total SAR 260 before other charges. Reimporting the corresponding issue or replaying the return leaves it SAR 260.
3. **Poor connectivity.** Mechanic captures a photo and work details offline, closes the app, restarts and reconnects twice. Evidence survives, is visible only in permitted scope and is attached once. Loss of connection after file upload but before metadata confirmation recovers. QC cannot pass until all mandatory evidence has arrived.
4. **Race for last part.** Two sites or workers request the final available unit from one bin. Only one posting succeeds. The other demand remains open with a shortage and next owner. No negative balance or silent substitution.
5. **Meter replacement.** Generator moves from 9,900 to 10 indicated hours after approved replacement, then accrues 20 hours. Only 20 hours accrue between the two new-meter readings. PM due logic uses approved lifetime offsets. No km or road fuel rate appears.
6. **Fuel reconciliation.** Open with 1,000 L, receive 500 L, issue 380 L, physical close 1,100 L. Show expected 1,120 L and variance −20 L. A correction records who authorised it and retains original readings.
7. **Recovery and warranty.** Remove a failed pump, record donor, replacement, condition, old part receipt and warranty claim. Vendor receives core, approves credit and finance posts it once. Lost core becomes an exception with an owner.
8. **Access and shift transfer.** Own assigned mechanic may progress a job, another company's user cannot view it, an unqualified reviewer cannot sign, and an outgoing shift remains accountable until receipt. Test via web, Flutter, API, reports and export.
9. **Audit correction.** Finance corrects a wrong material return after month close. Original document remains traceable, reversal and adjustment are linked, audit history has both approvers and the amended report reconciles with the ledger.
10. **Ready-mix and holdings.** A stored generator gets a periodic preservation task. A proposed-for-disposal mixer with fitted tyres is flagged. Recovering those tyres preserves custody. Disposal completion removes the asset from dispatch eligibility while preserving all job history.
11. **Preventive work.** Two scheduler runs against the same due engine-hour interval create one job. A deferred service retains its approver and expiry. An unrelated breakdown repair cannot reset the service interval.
12. **Management drill-down.** From a site KPI select a reported downtime interval and reconcile it to the job, asset, employee work intervals, parts and release. A failed source displays incomplete coverage. Changing country retains the proper currency and access scope.

## 8. Implementation instruction to give the software team

Use this brief as the acceptance contract. Work in the existing Tyre Pulse web, Flutter and Supabase codebase. Start with one complete mixer job using the existing job card, assignment, material issue and corrective-action records. For every requirement return the current route, service/RPC, relation, mobile entry point, permissions, test and runtime provisioning status. If an existing flow passes its scenario, retain it and record evidence. If it partially passes, fix the missing step in its normal entry point.

Deliver in dependency order:

1. **Trace and reconcile.** Select one completed case and one open case in an authorised test dataset. Trace IDs through assignment, material issue, consumption, QC, ERP and report. Identify missing or ambiguous links, duplicated writers, unapplied migrations and mobile build version. Publish the requirement matrix with proof and owner.
2. **Close one repair.** Deliver the complete driver-to-release workflow, labour intervals, line-level stock and old-part control, offline evidence, independent QC, rework, posting and notifications. Demonstrate scenarios 1–4 and 8–9 on the same records in web and Flutter.
3. **Extend across the fleet.** Deliver meter integrity, preventive jobs, fuel and lubricant reconciliation, vendor/warranty returns, tools, storage/disposal and dispatch ticket impact. Demonstrate scenarios 5–7 and 10–11 with road and stationary assets.
4. **Prove the management totals.** Deliver drill-downs, audit packs, shared report parity and role-specific dashboards. Reconcile period totals against source records. Demonstrate scenario 12 plus cross-country and missing-data behaviour.
5. **Roll out by site.** Use versioned additive migrations, scoped backfill previews, exception queues and reversible feature activation. Preserve historical postings, tyre fitments and closed jobs. A historical match is automatic only when unambiguous. Run current regression suites plus the new failure cases. Record exact builds, migration versions, roles, test evidence, reconciliation totals, remaining exceptions and rollback method before requesting production approval.

Operational verification must include a populated site and a newly configured site, a real authorised user per role in the test environment, intermittent connectivity, concurrent stock movement and large histories with pagination. Benchmark current and changed response times with representative loads; show p95, rows scanned and device sync backlog. Use the existing SLA policy or obtain business approval for a new target. Management should be able to open one job and answer who worked, where, when, what changed, who checked, what it cost and who owns anything still outstanding.

## Evidence index

The links point to the reviewed snapshot or the named change record. They support the audit above. All workflow extensions, tests and acceptance decisions are proposals.

- E1. [assetHistory.js](https://github.com/shahzebs-Library/Tyre_Pulse/blob/5d59ac7c47c7f537af9db13006b93c381736b276/src/lib/api/assetHistory.js)
- E2. [workforce_sync_providers.dart](https://github.com/shahzebs-Library/Tyre_Pulse/blob/5d59ac7c47c7f537af9db13006b93c381736b276/tyre_pulse_flutter/lib/features/my_work/workforce_sync_providers.dart)
- E3. [workforce_assignment_evidence.dart](https://github.com/shahzebs-Library/Tyre_Pulse/blob/5d59ac7c47c7f537af9db13006b93c381736b276/tyre_pulse_flutter/lib/features/my_work/data/workforce_assignment_evidence.dart)
- E4. [workOrderAccess.js](https://github.com/shahzebs-Library/Tyre_Pulse/blob/5d59ac7c47c7f537af9db13006b93c381736b276/src/lib/workOrderAccess.js)
- E5. [closureWorkflow.js](https://github.com/shahzebs-Library/Tyre_Pulse/blob/5d59ac7c47c7f537af9db13006b93c381736b276/src/lib/closureWorkflow.js)
- E6. [StoreMaterialIssue.jsx](https://github.com/shahzebs-Library/Tyre_Pulse/blob/5d59ac7c47c7f537af9db13006b93c381736b276/src/pages/StoreMaterialIssue.jsx)
- E7. [96_PRODUCTION_RELEASE_RECORD.md](https://github.com/shahzebs-Library/Tyre_Pulse/blob/5d59ac7c47c7f537af9db13006b93c381736b276/docs/inventory/96_PRODUCTION_RELEASE_RECORD.md)
- E8. [physicalInventory.js](https://github.com/shahzebs-Library/Tyre_Pulse/blob/5d59ac7c47c7f537af9db13006b93c381736b276/src/lib/api/physicalInventory.js)
- E9. [pmProgramsView.js](https://github.com/shahzebs-Library/Tyre_Pulse/blob/5d59ac7c47c7f537af9db13006b93c381736b276/src/lib/pmProgramsView.js)
- E10. [costPerM3.js](https://github.com/shahzebs-Library/Tyre_Pulse/blob/5d59ac7c47c7f537af9db13006b93c381736b276/src/lib/api/costPerM3.js)
- E11. [assetDisposals.js](https://github.com/shahzebs-Library/Tyre_Pulse/blob/5d59ac7c47c7f537af9db13006b93c381736b276/src/lib/api/assetDisposals.js)
- E12. [SECURITY_AND_ACCURACY_AUDIT_2026-11-24.md](https://github.com/shahzebs-Library/Tyre_Pulse/blob/5d59ac7c47c7f537af9db13006b93c381736b276/docs/report-sharing/SECURITY_AND_ACCURACY_AUDIT_2026-11-24.md)

Related change records: [#109](https://github.com/shahzebs-Library/Tyre_Pulse/pull/109), [#472](https://github.com/shahzebs-Library/Tyre_Pulse/pull/472), [#473](https://github.com/shahzebs-Library/Tyre_Pulse/pull/473), [#479](https://github.com/shahzebs-Library/Tyre_Pulse/pull/479), [#499](https://github.com/shahzebs-Library/Tyre_Pulse/pull/499), [#519](https://github.com/shahzebs-Library/Tyre_Pulse/pull/519), [#520](https://github.com/shahzebs-Library/Tyre_Pulse/pull/520), [#534](https://github.com/shahzebs-Library/Tyre_Pulse/pull/534), [#547](https://github.com/shahzebs-Library/Tyre_Pulse/pull/547), [#568](https://github.com/shahzebs-Library/Tyre_Pulse/pull/568), [#569](https://github.com/shahzebs-Library/Tyre_Pulse/pull/569), [#577](https://github.com/shahzebs-Library/Tyre_Pulse/pull/577), [#597](https://github.com/shahzebs-Library/Tyre_Pulse/pull/597), [#606](https://github.com/shahzebs-Library/Tyre_Pulse/pull/606), [#609](https://github.com/shahzebs-Library/Tyre_Pulse/pull/609).
