# ACCIDENT & INSURANCE MANAGEMENT MODULE — TARGET ARCHITECTURE (roadmap spec)

> Canonical target design for rebuilding the Tyre Pulse Accident module from a single-owner form
> into a multi-team, workstream-driven case lifecycle. This is the reference for all future accident work.
> PROJECT_MEMORY.md points here; keep the two in sync.

## Core principle
**One accident case, multiple controlled workstreams, one final closure gate.**
- Every accident gets ONE unique case number, e.g. `TP-ACC-KSA-2026-000124` (prefix + country + year + sequence).
- The app is the source of truth. Email notifies people and collects replies, but the official record stays in Tyre Pulse.
- Do NOT treat the accident as one long form owned by one person.
- Do NOT use a single Open/Closed switch. Do NOT let users freely pick any status from a dropdown — status is driven by completed actions.
- Do NOT close a case just because the repair is done. Do NOT calculate completeness by field count — use route-based mandatory requirements.
- Do NOT send every update to every department. Do NOT hardcode country rules (Najm/Saudi Traffic/insurers/currency) into core.
- Do NOT let the same person register, approve liability, approve repair AND close a case without control.

## 1. Six workstreams (each with its own owner + status)
- **A. Incident & Evidence** — Fleet Incident Officer / Site Fleet Coordinator. Register date/time/location/asset/driver, vehicle movable/recovery, description, police/Najm report, mandatory photos, third party, injuries/property/environmental damage, submit for review. KSA: Najm + traffic-report references.
- **B. Safety & Liability** — HSE Officer / authorised Fleet Manager. Severity, preventability, driver statement, immediate + root cause, official liability %, safety violations, corrective/preventive actions, escalate injury/fatality/serious. Liability options: our driver 100% / partially / third party 100% / shared / under investigation / disputed / hit-and-run / no third party / N/A. Liability % from authorised report; after approval a change requires reason + manager approval + audit.
- **C. Insurance & Claim** — Insurance Claims Officer. Coverage applies?, policy/insurer/broker/type, policy validity on accident date, register claim + number + date, required/missing docs, insurer acknowledgement, surveyor visit, accept/partial/reject, deductible/approved/exclusions, repair route (internal/external/insurer-approved), settlement + recovery.
- **D. Repair Planning & Execution** — Workshop Planner / Supervisor. Inspect, technical damage assessment, mechanical/electrical/body/tyre/structural, repair route, labour hours, parts list, Store request, purchase/quotation when no stock, external-workshop quote comparison, schedule + start/finish dates, actual work + delays, before/during/after photos, workshop QC.
- **E. Vehicle Control & Handover** — Fleet Operations Officer. Approve off-road period, replacement-vehicle need, stop/release asset, coordinate movement, receive completion, inspect completed vehicle, remarks/reject handover, confirm returned to operation, record actual downtime.
- **F. Financial Settlement** — Finance / Cost Controller. PO value, quotation/PO/invoice match, internal labour + parts, external repair, towing/recovery/storage, insurer-approved, deductible/excess, insurer receipt, third-party recovery, uninsured/unrecovered, confirm financial closure.

## 2. End-to-end workflow (stage → owner → exit condition)
1. Draft registration (Fleet) → minimum emergency info complete
2. Fleet validation (Fleet Supervisor) → evidence accepted or returned
3. Safety & liability (HSE/Fleet Manager) → liability approved
4. Insurance triage (Insurance Officer) → claim route decided
5. Claim registration (Insurance Officer) → insurer acknowledgement received
6. Technical assessment (Workshop) → assessment approved
7. Repair decision (Fleet/Insurance) → internal/external/insurer/total-loss route approved
8. Repair planning (Workshop Planner) → Fleet accepts plan
9. Repair execution (Workshop/Vendor) → workshop QC passed
10. Fleet inspection (Fleet) → vehicle operationally released
11. Insurance settlement (Insurance/Finance) → financial items cleared
12. Closure review (Fleet Manager) → case closed

## 3. Three closure levels (never one Open/Closed switch)
- **Operationally completed** — repair done, Fleet inspected, asset back in service.
- **Operationally completed but financially open** — vehicle operating; claim/invoice/recovery/deductible/legal/CA still pending.
- **Fully closed** — only when ALL true: evidence complete AND liability complete AND insurance complete-or-N/A AND assessment complete-or-N/A AND repair complete-or-N/A AND workshop QC done where repair occurred AND Fleet handover accepted AND financial settlement complete AND corrective actions complete AND no overdue mandatory task AND no pending approval AND no missing required doc AND no open workstream AND closure review approved.
- Any field/workstream marked **Not Applicable requires a reason + user + date + approval where required** — never a silent skip.
- Closed cases are READ-ONLY. Reopening requires reason + requester + approver + new owner + new due date + audit.

## 4. Route-based completeness (not field-count)
Completion % is computed from the mandatory workstreams for the SELECTED route, not "90 of 100 fields".
- **Minor accident, no insurance:** incident evidence, liability, internal-repair/no-repair, Fleet inspection, cost recording, closure review.
- **External repair with insurance:** evidence, liability, insurance claim, assessment, insurer approval, quotations, PO, external repair, workshop QC, Fleet inspection, invoice, settlement, financial closure.
- **Total loss:** evidence, liability, insurance claim, survey, total-loss approval, asset deactivation/disposal/transfer, insurer settlement, asset-register update, financial closure, final closure.
- **Injury accident:** evidence, authority report, HSE investigation, injury details, insurance, management review, corrective actions, legal review where required.
Show separate percentages: incident, insurance, repair, financial, overall.

## 5. Status structure
**Main case statuses** (mostly action-driven, not free choice): Draft · Submitted · Evidence incomplete · Under validation · Liability assessment · Insurance processing · Awaiting insurer response · Repair decision pending · Repair planning · Awaiting parts/PO · Repair in progress · Quality inspection · Fleet inspection · Rectification required · Operationally completed · Settlement pending · Closure review · Closed · Reopened · Cancelled as duplicate · Total loss processing · Legal hold.
**Per-workstream status:** Not required · Not started · Assigned · In progress · Waiting for information · Waiting for approval · Waiting for external party · On hold · Completed · Rejected · Reopened · Cancelled.
The overview shows every workstream state, e.g. Fleet evidence: Completed / Liability: Completed / Insurance: Waiting for insurer / Repair: Completed / Handover: Completed / Finance: In progress / Overall: Settlement pending.

## 6. Case screen (desktop)
**Fixed sticky header:** case number, asset + plate, country, site/project, accident date, driver, severity, liability, vehicle condition + operational status, current stage, current owner, next action, due date, SLA condition, overall completion, repair/insurance/settlement status.
**Tabs (with pending-action counters):** Overview · Incident · Evidence · Parties · Liability & Safety · Insurance · Technical Assessment · Repair Planning · Repair Execution · Parts & Procurement · Vehicle Downtime · Handover · Cost & Recovery · Corrective Actions · Tasks · Approvals · Communication · Audit Trail.
**Team inbox** per role: my tasks / team tasks / unassigned / overdue / due today / due this week / waiting external / waiting approval / recently completed / escalated. Filters: country, company, branch, project, site, asset type, vehicle, severity, type, stage, owner, insurer, workshop, claim status, repair status, date range, SLA status.

## 7. Mobile accident-capture wizard
1. **Identify** — scan QR/RFID or search asset; auto-fill plate/chassis/company/project/site/driver; odometer/hours.
2. **Accident** — date, time, GPS, site/road, type, short description; injury / third party / movable / recovery / safe-to-operate toggles.
3. **Authority & third party** — authority involved + type (configurable per country: Najm/Traffic Police/Police/Site Security/Civil Defence/Other), report number, report available/pending, third-party name/vehicle/plate/contact/insurer, liability available/pending.
4. **Photo checklist** — configurable mandatory photos (front/rear/sides/four corners/close-up damage/scene/plate/VIN/odometer/dashboard lights/other-party vehicle+plate/road+site condition/tyres/attachment/property). Show "11 of 13 mandatory uploaded"; block final submit until mandatory met unless an authorised supervisor records an exception (reason + approval + audit).
5. **Statement & submit** — driver statement, witnesses, review screen showing missing fields/photos, recipients, initial due date. Support drafts + poor network.

## 8. Conditional toggles (reveal related fields; never bypass mandatory control)
Insurance involved · Third party involved · Injury · Fatality · Authority report available/pending · Vehicle movable · Recovery required · Vehicle off road · Replacement vehicle required · Internal repair · External repair · Insurer-approved workshop · Dealer repair · Total-loss possibility · Driver statement received · Liability disputed · Legal review required · Environmental damage · Customer property damaged · Rental/leased/subcontractor vehicle · Corrective action required · Additional repair approval required · Repair rejected · Case reopened. (e.g. External Repair → workshop, quote, estimate, PO requirement, movement date, expected completion, vendor contact, insurer approval.)

## 9. Automated email & notifications
Email directs recipients back into the app; it is NOT the record.
- **Subject:** `[TP-ACC-2026-000124] [Action Required] Register Insurance Claim | Asset MX-241`.
- **Body:** case number, asset+plate, project/site, accident date, current stage, liability, vehicle condition, required action, responsible person, due date, missing documents, secure case link, latest decision.
- **Triggers (recipient):** complete accident submitted → Fleet Supervisor/HSE/Insurance; evidence incomplete → reporter+supervisor; serious injury → HSE Manager+management; claim required → Insurance Officer; claim registered → Fleet/Workshop/Insurance Manager; insurer requests docs → doc owner+Fleet; external repair approved → Fleet/Workshop Planner/Procurement; parts required → Store+Procurement; plan completed → Fleet Ops; vehicle ready → Fleet Inspector; Fleet rejects repair → Workshop Supervisor; vehicle accepted → Insurance+Finance; settlement overdue → Insurance Manager+Fleet Manager; ready for closure → final approver.
- Send only: action-required, approval/rejection, major status change, SLA warning/breach; plus a daily digest for normal updates and escalation notices. Not every field update to everyone.
- **Reply capture:** unique case + reply token; store replies + attachments in the communication timeline; external insurers/workshops reply by email OR a secure limited-access link (upload docs, confirm dates, add quote/invoice/remarks) — never full system access.

## 10. SLA engine (configurable, internal targets << regulatory max)
Suggested internal targets: registration 2h · Fleet validation 4 working h · insurance review 4 working h · complete claim 1 business day · workshop inspection 1 business day · initial estimate 2 business days · repair-route approval 1 business day · PO after approval 1 business day · Fleet inspection after repair 4 working h · rectification plan after rejection 1 business day · closure review 2 business days.
Each timer: start, due, remaining, responsible team, owner, pause reason, restart date, escalation level, working calendar, country holidays, warning/escalation thresholds, breach duration. Pause requires a valid reason (waiting for report/third party/insurer/surveyor/approval/parts/PO/quotation/workshop capacity/vehicle unavailable/legal hold/weather/site access) AND an expected follow-up date.

## 11. Role-based home screens
- **Fleet:** accidents awaiting evidence, missing photos, vehicles awaiting off-road confirmation, vehicles ready for inspection, rejected handovers, vehicles unavailable.
- **Insurance:** new cases to review, unregistered claims, missing docs, awaiting insurer, approaching insurer SLA, rejected/partial, settlements pending.
- **Workshop planner:** vehicles awaiting inspection, pending assessments, repairs waiting parts/PO, planned today, delayed repairs, ready for QC.
- **Procurement/Store:** parts requests, stock availability, quotations required, PO pending, expected delivery, delayed items.
- **Fleet manager:** overdue cases, needing approval, high-severity, long downtime, disputed liability, high cost, reopened.
- **Finance:** invoices pending, PO/invoice mismatch, receivables, deductibles, unrecovered, awaiting financial closure.

## 12. Data architecture (normalized — NOT one 100-column accidents table)
Related records: accident_cases · accident_case_routes · accident_case_workstreams · accident_parties · accident_case_vehicles · accident_case_drivers · accident_evidence · evidence_requirements · authority_reports · witness_statements · driver_statements · liability_assessments · safety_investigations · root_causes · corrective_actions · insurance_policies · insurance_claims · claim_documents · insurance_claim_events · insurance_decisions · insurance_settlements · surveyors · damage_assessments · damage_items · repair_decisions · repair_orders · repair_tasks · repair_progress_updates · repair_quality_checks · parts_requests · parts_request_items · purchase_requests · purchase_orders · quotations · quotation_items · external_workshops · vehicle_downtime · replacement_vehicle_allocations · fleet_handover_inspections · financial_transactions · claim_recoveries · case_tasks · case_task_dependencies · case_approvals · case_comments · case_communications · email_events · notifications · sla_definitions · sla_instances · sla_pause_events · closure_requirements · closure_reviews · audit_logs · country_rule_profiles · document_requirement_profiles · accident_type_profiles · workflow_route_profiles.
Reuse existing masters (vehicles, drivers, employees, users, projects, sites, companies, branches, vendors, workshops, insurers, policies, parts, inventory, POs). Every record: created/updated by+at, version where needed, country, company, data-visibility scope, org isolation via RLS. Soft-delete only — never physically delete an accident (mark cancelled/duplicate with linkage). One accident may have >1 vehicle, >1 third party, >1 claim, several repair orders, several quotations, multiple invoices, multiple corrective actions, multiple inspections, a full communication history.

## 13. Analytics & reporting (management)
- **Operational:** total, open/closed, by site/vehicle-type/severity/type, avg reporting/claim-registration/repair-duration/downtime, cases overdue by team, reopened, repair rejection rate, repeat asset/driver.
- **Insurance:** insured vs uninsured, claim acceptance/partial/rejection, avg insurer response, avg settlement, claims pending >15/30/45 working days, insurer/broker performance, missing-document frequency, rejection reasons, recovery %.
- **Financial:** gross cost, insurer-approved, recovered, deductible, uninsured loss, unrecovered, internal/external repair, towing/storage, avg cost per accident, cost by project/asset/type.
- **Risk/safety:** preventable vs non-preventable, liability %, repeat drivers/assets/locations, root causes, corrective actions overdue, accidents per million km, per 100 active vehicles.
- **Process analytics (key):** time with Fleet/HSE/Insurance, waiting insurer/surveyor/workshop/parts/PO/vendor/Fleet-inspection/settlement/closure — shows exactly which team or external party is delaying the case.

## 14. Cases the workflow must support (each activates a different checklist + approval path)
Minor/major road, site collision, vehicle-vehicle, equipment-vehicle/equipment-equipment, third-party/customer property damage, own damage, injury/fatal, hit-and-run, theft, fire, flood/weather, glass-only, tyre/wheel, rollover, loading/unloading, falling-object, uninsured, expired-policy, rental/leased/subcontractor, no-damage, near miss, total loss, duplicate, reopened, legal/disputed.

## 15. Permissions & control
Fleet reporters create/submit but cannot approve liability. Liability approved only by authorised HSE/Fleet management. Insurance staff edit claim info but not workshop findings. Workshop edits technical repairs but not insurer decisions. Finance posts costs/recoveries but cannot close operational handover. Only Fleet inspectors accept the vehicle. Only nominated managers fully close or reopen. Closed cases are read-only. Reopening needs reason + approval + audit. Deleting an accident is not allowed — mark cancelled/duplicate. Permissions scope by country/company/branch/project/site/team; users may hold multiple roles.

## 16. Configurable business-rule engine
A rule defines, per country/company/type/severity/insurance-involvement/third-party/injury/vehicle-type/repair-route: required fields, required documents, required workstreams, required approvals, SLA definitions, notification recipients, closure requirements. Admin UI for controlled configuration. Country-rule profiles keep Najm/traffic/police/insurers/currency/regulatory timelines OUT of core code (e.g. KSA unified compulsory motor policy: up to 9 working days to notify a juristic person of missing docs, 5 to notify accept/reject after a complete claim, 45 to settle a complete juristic-person claim — configurable regulatory controls, not hardcoded).

## Decisions to confirm before full build
Drivers own login? · Microsoft 365 vs Gmail for accident emails? · Do insurance brokers need external access? · POs created in Tyre Pulse or existing ERP? Defaults if unknown: driver reporting as optional permission (Fleet-assisted now); email-provider abstraction on the existing provider; restricted external-link capability enabled by config; reuse existing Tyre Pulse/ERP procurement (store PO references if unavailable); configurable country-rule profiles seeded with KSA.

## Implementation order (small reviewable commits, additive, migrate historical data safely)
1 data model → 2 role permissions → 3 accident case core → 4 evidence → 5 workstream/task engine → 6 liability & safety → 7 insurance claims → 8 technical assessment → 9 repair planning → 10 parts & PO → 11 repair execution → 12 workshop QC → 13 Fleet handover → 14 finance & settlement → 15 closure engine → 16 email & notifications → 17 external portal → 18 SLA engine → 19 analytics → 20 data migration. Preserve existing case numbers/dates/users/comments on migration; never mark migrated historical cases complete without evidence; back up + test migration on a copy first.
