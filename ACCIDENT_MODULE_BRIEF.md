# The right structure for the Tyre Pulse accident module

The current problem is not simply missing accident fields. The accident case is passing through Fleet, Safety, Insurance, Workshop, Store, Procurement, Finance, external workshops and back to Fleet, but the app is treating it like one form owned by one person.

The better model is:

One accident case, multiple controlled workstreams, one final closure gate.

Every accident receives one unique case number, for example:

TP-ACC-KSA-2026-00124

The app remains the main source of truth. Emails should notify people and collect replies, but the official case record must stay inside Tyre Pulse.

---

## 1. Split every accident into six workstreams

### A. Incident and evidence

Owner: Fleet Incident Officer or Site Fleet Coordinator

Responsibilities:

* Register accident date, time, location and asset.
* Select driver and project/site.
* Record whether the vehicle is safe, movable or requires recovery.
* Add accident description.
* Upload police, Najm or other authority report.
* Upload mandatory photographs.
* Add third-party details.
* Record injuries, property damage and environmental damage.
* Confirm initial vehicle status.
* Submit the case for review.

For Saudi Arabia, the system should support Najm and traffic-report references. Najm provides official accident reporting, while Absher also provides electronic minor-accident reporting services in applicable cases.

### B. Safety and liability assessment

Owner: HSE Officer or authorised Fleet Manager

Responsibilities:

* Classify severity.
* Determine whether the event was preventable.
* Review driver statement.
* Record immediate and root causes.
* Record the official liability percentage.
* Identify safety violations.
* Create corrective and preventive actions.
* Escalate injury, fatality or serious property-damage cases.

The liability field should support:

* Our driver 100% liable
* Our driver partially liable
* Third party 100% liable
* Shared liability
* Liability under investigation
* Liability disputed
* Hit and run
* No third party involved
* Not applicable

The liability percentage should come from the authorised report where available. Once approved, changing it should require a reason and manager approval.

### C. Insurance and claim management

Owner: Insurance Claims Officer

Responsibilities:

* Confirm whether insurance applies.
* Identify policy, insurer, broker and coverage type.
* Check policy validity on the accident date.
* Register the insurance claim.
* Enter claim number and registration date.
* Track required and missing documents.
* Upload insurer acknowledgement.
* Track surveyor or loss-adjuster visit.
* Record acceptance, partial acceptance or rejection.
* Record deductible, approved amount and exclusions.
* Record whether repair must be internal, external or through an insurer-approved workshop.
* Track settlement and recovery.

The Insurance Authority has been the Saudi insurance-sector regulator since November 2023.

For Saudi corporate claims under the unified compulsory motor policy, the current rule provides up to nine working days for notifying a juristic person of missing documents, up to five working days to notify acceptance or rejection after receiving a complete claim, and up to 45 working days for settlement of a juristic-person claim with complete documents. These should be maintained as configurable regulatory controls because comprehensive policies and contractual arrangements may follow different conditions.

Your internal targets should be much shorter than the regulatory maximum.

### D. Repair planning and execution

Owner: Workshop Planner or Workshop Supervisor

Responsibilities:

* Inspect the vehicle.
* Add technical damage assessment.
* Identify mechanical, electrical, body, tyre and structural damage.
* Decide whether repair is technically internal or external.
* Prepare estimated labour hours.
* Prepare required-parts list.
* Request parts from Store.
* Request purchase or quotation when stock is unavailable.
* Prepare external-workshop quotation comparison.
* Create repair schedule.
* Set expected start and completion dates.
* Record actual work and delays.
* Upload before, during and after-repair photographs.
* Complete workshop quality inspection.

### E. Vehicle control and handover

Owner: Fleet Operations Officer

Responsibilities:

* Approve the proposed off-road period.
* Confirm replacement-vehicle requirement.
* Stop or release the asset according to the repair plan.
* Coordinate vehicle movement.
* Receive repair-completion notification.
* Inspect the completed vehicle.
* Add remarks or reject the handover.
* Confirm vehicle returned to operation.
* Record actual downtime.

### F. Financial settlement

Owner: Finance or Cost Controller

Responsibilities:

* Record PO value.
* Match quotation, PO and invoice.
* Record internal labour and parts cost.
* Record external repair cost.
* Record towing, recovery and storage costs.
* Record insurer-approved amount.
* Record deductible or excess.
* Record amount received from insurer.
* Record third-party recovery.
* Record uninsured or unrecovered amount.
* Confirm financial closure.

---

## 2. Recommended end-to-end workflow

| Stage | Main owner | Required action | Exit condition |
|---|---|---|---|
| 1. Draft registration | Fleet | Enter initial accident and upload evidence | Minimum emergency information complete |
| 2. Fleet validation | Fleet Supervisor | Review asset, driver, report and photographs | Evidence accepted or returned |
| 3. Safety and liability | HSE/Fleet Manager | Classify severity, liability and preventability | Liability approved |
| 4. Insurance triage | Insurance Officer | Determine coverage and required documents | Claim route decided |
| 5. Claim registration | Insurance Officer | Register claim and record claim number | Insurer acknowledgement received |
| 6. Technical assessment | Workshop | Inspect damage and prepare repair estimate | Assessment approved |
| 7. Repair decision | Fleet/Insurance | Select internal, external, insurer workshop or total loss | Repair route approved |
| 8. Repair planning | Workshop Planner | Parts, labour, PO, dates and off-road plan | Fleet accepts plan |
| 9. Repair execution | Workshop/Vendor | Complete work and record progress | Workshop QC passed |
| 10. Fleet inspection | Fleet | Inspect and accept or return for rectification | Vehicle operationally released |
| 11. Insurance settlement | Insurance/Finance | Complete claim recovery and payment | Financial items cleared |
| 12. Closure review | Fleet Manager | Review all workstreams and corrective actions | Case closed |

---

## 3. Do not use one simple Open/Closed switch

A simple switch is dangerous because somebody can close the case while the insurance recovery, invoice, corrective action or vehicle inspection remains incomplete.

Use three closure levels:

**Operationally completed**

The repair is completed, Fleet has inspected the vehicle, and the asset is back in service.

**Insurance and financial pending**

The vehicle may be operating, but the claim settlement, invoice, recovery or deductible remains outstanding.

**Fully closed**

Every mandatory operational, insurance, financial and safety control has been completed.

The main case should close only when:

Fleet evidence complete
AND liability assessment complete
AND insurance route complete or marked not applicable
AND repair route complete or marked not applicable
AND Fleet handover accepted
AND financial settlement complete
AND corrective actions complete
AND no overdue mandatory tasks

Fields marked Not Applicable must require a valid reason. They should not simply be skipped.

---

## 4. Route-based completeness, not field-count completeness

Do not calculate completion as:

90 fields filled out of 100 fields = 90%

That gives a false result because many fields will not apply to every accident.

Instead, create mandatory requirements based on the selected case route.

For example:

**Minor accident without insurance claim**

Required workstreams:

* Incident evidence
* Liability
* Internal repair
* Fleet inspection
* Cost recording

**External repair with insurance**

Required workstreams:

* Incident evidence
* Liability
* Insurance claim
* Assessment
* PO and external repair
* Fleet inspection
* Settlement and recovery

**Total loss**

Required workstreams:

* Incident evidence
* Liability
* Insurance claim
* Total-loss approval
* Vehicle disposal or transfer
* Financial settlement
* Asset-register update

**Injury accident**

Required workstreams:

* Incident evidence
* Authority report
* HSE investigation
* Medical/injury information
* Insurance
* Management review
* Corrective actions
* Legal review where required

This gives a genuine completion percentage.

---

## 5. Status structure

**Main case statuses**

1. Draft
2. Submitted
3. Evidence incomplete
4. Under validation
5. Liability assessment
6. Insurance processing
7. Awaiting insurer response
8. Repair decision pending
9. Repair planning
10. Awaiting parts or PO
11. Repair in progress
12. Quality inspection
13. Fleet inspection
14. Operationally completed
15. Settlement pending
16. Closure review
17. Closed
18. Reopened
19. Cancelled as duplicate

**Each workstream also needs its own status**

* Not started
* In progress
* Waiting for information
* Waiting for approval
* Waiting for external party
* Completed
* Not applicable
* Rejected
* Reopened

A parent case could therefore show:

* Fleet evidence: Completed
* Liability: Completed
* Insurance: Waiting for insurer
* Repair: Completed
* Fleet handover: Completed
* Finance: In progress
* Overall case: Settlement pending

That is much clearer than keeping the entire case under "Repair Completed."

---

## 6. User-friendly accident screen

**Case header**

Keep a fixed header at the top showing:

* Case number
* Asset number and plate
* Site/project
* Accident date
* Driver
* Severity
* Liability
* Vehicle status
* Current stage
* Current owner
* Next action
* Due date
* Overall completion
* SLA condition

**Recommended screen tabs**

1. Overview — A summary of the accident, current status, pending actions and important values.
2. Incident — Initial report, location, parties, driver statement and accident classification.
3. Evidence — Photographs, videos, police/Najm reports, documents and photo checklist.
4. Liability and safety — Liability percentages, preventability, root causes and corrective actions.
5. Insurance — Policy, claim number, insurer, broker, surveyor, approvals, rejection and settlement.
6. Repair — Assessment, repair route, quotations, labour, parts, PO, workshop and repair dates.
7. Handover — Workshop QC, Fleet inspection, remarks, rejection, rectification and operational release.
8. Cost and recovery — Repair cost, insurer amount, deductible, recovered amount and unrecovered loss.
9. Communication — Emails, comments, calls, decisions and attachments in chronological order.
10. Audit trail — Every change showing old value, new value, user, date and reason.

---

## 7. Mobile accident-capture wizard

The Fleet team should not see the full insurance and workshop form when registering an accident.

Use a short mobile wizard:

**Step 1: Identify**

* Scan vehicle QR/RFID
* Select asset
* Driver auto-filled
* Project/site auto-filled
* Current kilometre or hour meter

**Step 2: Accident**

* Date and time
* GPS location
* Road or project site
* Accident type
* Short description
* Injury yes/no
* Third party yes/no
* Vehicle movable yes/no

**Step 3: Authority information**

* Najm involved
* Traffic Police involved
* Report/reference number
* Liability available
* Report pending
* No report, with mandatory reason

**Step 4: Photograph checklist**

Require photographs according to the case:

* Full front
* Full rear
* Left side
* Right side
* Four-corner views
* Close-up damage
* Accident scene
* Plate number
* Chassis/VIN where required
* Other-party vehicle
* Other-party plate
* Road/site condition
* Dashboard warning lights
* Odometer

The app should show:

11 of 13 required photographs uploaded

It should not allow final submission until mandatory evidence is uploaded, unless an authorised supervisor records an exception.

**Step 5: Submit**

Show a review screen containing:

* Missing fields
* Missing photographs
* People who will receive the case
* Initial due date

---

## 8. Important toggles and conditional fields

Use toggles for case attributes, not for uncontrolled closure.

Recommended toggles:

* Insurance involved
* Third party involved
* Injury involved
* Authority report available
* Vehicle requires towing
* Vehicle off road
* Replacement vehicle required
* Internal repair
* External repair
* Insurer-approved workshop
* Total-loss possibility
* Driver statement received
* Liability disputed
* Legal review required
* Environmental damage
* Customer property damaged
* Rental or leased vehicle
* Corrective action required
* Case reopened

Each toggle should reveal only the related fields.

Example:

Turning on External Repair reveals:

* Workshop
* Vendor quotation
* Repair estimate
* PO requirement
* Vehicle movement date
* Expected completion
* Vendor contact
* Insurer approval requirement

---

## 9. Automated emails and notifications

Email must not become the workflow itself. It should direct the recipient back to the relevant action inside Tyre Pulse.

**Subject format**

[TP-ACC-2026-00124] [Action Required] Register Insurance Claim | Asset MX-241

Another example:

[TP-ACC-2026-00124] [Repair Approved] External Workshop | Due 30-Jul-2026

**Email body**

Every action email should contain:

* Case number
* Asset and plate
* Project/site
* Accident date
* Current stage
* Liability
* Vehicle condition
* Required action
* Responsible person
* Due date
* Missing documents
* Secure case link
* Latest important decision

**Trigger examples**

| Event | Recipient |
|---|---|
| Fleet submits complete accident | Fleet Supervisor, HSE, Insurance |
| Evidence incomplete | Fleet reporter and supervisor |
| Serious injury selected | HSE Manager and management |
| Insurance claim required | Insurance Claims Officer |
| Claim registered | Fleet, Workshop and Insurance Manager |
| Insurer requests documents | Document owner and Fleet |
| External repair approved | Fleet, Workshop Planner, Procurement |
| Parts required | Store and Procurement |
| Repair plan completed | Fleet Operations |
| Vehicle ready | Fleet Inspector |
| Fleet rejects repair | Workshop Supervisor |
| Vehicle accepted | Insurance and Finance |
| Settlement overdue | Insurance Manager and Fleet Manager |
| Case ready for closure | Final approver |

Do not send every field update to every person. Send:

* Action-required notifications
* Approval/rejection notifications
* Major status-change notifications
* Daily digest for normal updates
* Escalation notifications

**Email reply capture**

Use the case number and a unique reply token so that an email reply can be stored in the case communication history.

External insurers and workshops should be able to:

* Reply by email, or
* Open a secure limited-access link
* Upload requested documents
* Confirm repair dates
* Add quotation or invoice
* Add remarks

They should not receive access to the full Tyre Pulse system.

---

## 10. SLA controls

Configure different timers for internal and external activities.

Suggested internal starting targets:

| Activity | Internal target |
|---|---|
| Initial accident registration | Within 2 hours |
| Fleet validation | Within 4 working hours |
| Insurance review | Within 4 working hours |
| Submit complete claim | Within 1 business day |
| Workshop inspection | Within 1 business day |
| Initial repair estimate | Within 2 business days |
| Repair-route approval | Within 1 business day |
| PO after approval | Within 1 business day |
| Fleet inspection after repair | Within 4 working hours |
| Rejected repair rectification plan | Within 1 business day |
| Final closure review | Within 2 business days |

Every timer should have:

* Start time
* Due time
* Remaining time
* Responsible team
* Current owner
* Pause reason
* Restart date
* Escalation level

Valid pause reasons may include:

* Waiting for police/Najm report
* Waiting for third party
* Waiting for insurer
* Waiting for surveyor
* Waiting for management approval
* Waiting for parts
* Vehicle unavailable
* Workshop capacity
* Legal hold

Users must not be able to pause a timer without selecting a reason and expected follow-up date.

---

## 11. Role-based home screens

**Fleet user**

Shows:

* Accidents waiting for initial evidence
* Missing photographs
* Vehicles awaiting off-road confirmation
* Vehicles ready for inspection
* Rejected handovers
* Vehicles currently unavailable

**Insurance officer**

Shows:

* New cases requiring insurance review
* Claims not registered
* Missing claim documents
* Claims awaiting insurer response
* Claims approaching insurer SLA
* Rejected or partially accepted claims
* Settlements pending

**Workshop planner**

Shows:

* Vehicles awaiting inspection
* Assessments pending
* Repairs waiting for parts
* Repairs waiting for PO
* Work planned today
* Delayed repairs
* Vehicles ready for QC

**Procurement and Store**

Shows:

* Parts requests
* Stock availability
* Quotations required
* PO pending
* Expected-delivery dates
* Delayed items

**Fleet manager**

Shows:

* Overdue cases
* Cases requiring approval
* High-severity incidents
* Long vehicle downtime
* Disputed liability
* High repair cost
* Reopened cases

**Finance**

Shows:

* Invoices pending
* PO/invoice mismatch
* Insurance receivables
* Deductibles
* Unrecovered amounts
* Cases awaiting financial closure

---

## 12. Data architecture

Do not build one large accidents table containing 100 or more columns.

Use related records:

accident_cases
accident_parties
drivers
vehicles
accident_evidence
authority_reports
liability_assessments
safety_investigations
insurance_policies
insurance_claims
claim_documents
claim_decisions
damage_assessments
repair_orders
repair_tasks
parts_requests
purchase_orders
external_workshops
vehicle_downtime
quality_inspections
fleet_handovers
financial_transactions
claim_recoveries
corrective_actions
case_tasks
case_approvals
case_communications
sla_events
closure_requirements
audit_logs
country_rule_profiles

This allows one accident to have:

* More than one vehicle
* More than one third party
* More than one insurance claim
* Several repair orders
* Several quotations
* Multiple invoices
* Multiple corrective actions
* Multiple inspections
* A complete communication history

---

## 13. Analytics and management reporting

**Operational KPIs**

* Total accidents
* Open and closed cases
* Accidents by project/site
* Accidents by vehicle type
* Accidents by severity
* Average initial-reporting time
* Average claim-registration time
* Average repair duration
* Average vehicle downtime
* Cases overdue by team
* Reopened cases
* Repair rejection rate

**Insurance KPIs**

* Insured versus uninsured cases
* Claim acceptance rate
* Partial-acceptance rate
* Claim rejection rate
* Average insurer response time
* Average settlement time
* Claims pending over 15, 30 and 45 working days
* Insurer performance comparison
* Missing-document frequency
* Main rejection reasons
* Recovery percentage

**Financial KPIs**

* Gross accident cost
* Insurer-approved amount
* Amount recovered
* Deductible amount
* Uninsured loss
* Unrecovered amount
* Internal repair cost
* External repair cost
* Towing and storage cost
* Average cost per accident
* Cost by project, vehicle type and cause

**Risk and safety KPIs**

* Preventable accidents
* Non-preventable accidents
* Liability percentage
* Repeated drivers
* Repeated assets
* Repeated accident locations
* Main root causes
* Corrective actions overdue
* Accidents per million kilometres
* Accidents per 100 active vehicles

**Process analytics**

This is particularly important for management:

* Time spent with Fleet
* Time spent with Insurance
* Time waiting for insurer
* Time waiting for workshop
* Time waiting for parts
* Time waiting for PO
* Time waiting for Fleet inspection
* Time waiting for settlement

This will show exactly which team or external party is delaying the case.

---

## 14. Cases the module must support

The workflow should dynamically handle:

* Minor road accident
* Major road accident
* Site collision
* Third-party damage
* Own damage
* Hit and run
* Unknown liability
* Disputed liability
* Injury or fatality
* Fire
* Theft
* Flood or weather damage
* Glass-only damage
* Tyre or wheel accident
* Equipment-to-vehicle collision
* Customer-property damage
* Rental or leased vehicle
* Subcontractor vehicle
* Uninsured or expired policy
* Internal repair
* External repair
* Insurer-approved workshop
* Repair before insurer approval
* Economic or technical total loss
* No-damage incident
* Duplicate report
* Reopened repair
* Legal dispute

Each scenario should activate a different checklist and approval path.

---

## 15. Permissions and controls

* Fleet reporters can create and submit cases but cannot approve liability.
* Liability can be approved only by authorised HSE or Fleet management.
* Insurance staff can edit claim information but cannot alter workshop findings.
* Workshop users can edit technical repairs but cannot change insurer decisions.
* Finance can post costs and recoveries but cannot close the operational handover.
* Only Fleet inspectors can accept the vehicle.
* Only nominated managers can fully close or reopen a case.
* A closed case cannot be edited directly.
* Reopening requires a reason, approval and a complete audit record.
* Deleting an accident should not be allowed. It should be marked cancelled or duplicate.

---

## 16. Build-team responsibilities

For this module, the development work should be reviewed from these eight roles:

1. Workflow Architect: designs stages, handoffs, approvals, loops and exceptions.
2. Fleet Operations Specialist: confirms actual site and vehicle processes.
3. Insurance Claims Specialist: confirms claim fields, documents, liability and settlement.
4. Workshop Planning Specialist: designs assessment, repair planning, parts and QC.
5. Data Architect: creates the relational data model and audit history.
6. UX Designer: creates mobile capture, role inboxes and simplified forms.
7. BI Analyst: defines KPIs, aging reports, costs and bottleneck analysis.
8. QA and Compliance Reviewer: tests every route, permission, SLA and closure rule.

---

## My strongest recommendations

Do not add all fields to one long form.

Do not allow users to choose any status manually from a dropdown. Status should mostly move based on completed actions.

Do not use email as the official record.

Do not close a case simply because the vehicle has been repaired.

Do not calculate completeness from all available fields. Calculate it from the mandatory controls for that case route.

Do not send every update to all departments. Each user should receive only actions relevant to their role.

Do not allow the same person to register the accident, approve liability, approve repair and close the case without control.

The next step is to convert this into a full developer specification containing database tables, field names, permissions, workflow conditions, email templates, screen wireframes and acceptance tests. Before that specification, the main decisions to confirm are whether drivers will have their own login, whether your company uses Microsoft 365 or Gmail for accident emails, whether insurance brokers require external access, and whether POs will be created in Tyre Pulse or your existing ERP.

---
---

# MASTER PROMPT: TYRE PULSE ACCIDENT AND INSURANCE MANAGEMENT MODULE UPGRADE

You are working on an existing production application called Tyre Pulse. Your task is to inspect, redesign and upgrade the existing Accident Management module into a complete multi-team Accident, Insurance, Repair, Settlement and Closure workflow.

Do not rebuild the full application from scratch. Preserve working functionality, current users, existing data, design components, authentication, database integrations and reporting features unless a change is technically required.

The upgraded module must be suitable for fleet, construction, transport and heavy-equipment operations across Saudi Arabia and the GCC.

The system must support vehicle accidents, equipment incidents, site collisions, third-party damage, insurance claims, internal repairs, external repairs, total loss, downtime management, settlement and final case closure.

---

## 1. PRIMARY OBJECTIVE

Replace the current simple accident form with:

One accident case, multiple controlled workstreams, separate team responsibilities, SLA tracking, automated communication, repair management, insurance settlement and one final closure gate.

Each accident must have a unique case reference, such as:

TP-ACC-KSA-2026-000124

The accident case must remain the central source of truth. Emails, notifications and external responses must be saved back into the case.

Do not treat the accident as one long form completed by one user.

---

## 2. START WITH A COMPLETE SYSTEM AUDIT

Before changing the application, inspect and document:

1. Existing technology stack.
2. Frontend framework and component library.
3. Backend architecture.
4. Existing database tables and relationships.
5. Authentication and authorization system.
6. Existing user roles.
7. Current Accident module fields.
8. Existing Fleet, Vehicle, Driver, Workshop, Insurance, Purchase Order and Vendor modules.
9. Current file and image storage.
10. Existing email and notification services.
11. Existing audit-log system.
12. Existing task-management workflow.
13. Existing dashboard and reporting system.
14. Existing country, company, branch, project and site structures.
15. Existing ERP or external integrations.
16. Current mobile and desktop layouts.
17. Any existing accident records that require migration.
18. Existing naming conventions, coding standards and API patterns.
19. Current test coverage.
20. Current documentation.

Create an audit report before implementation containing:

* What already exists.
* What can be reused.
* What must be improved.
* What is missing.
* What may conflict with the new workflow.
* Data-migration risks.
* Security risks.
* Recommended implementation order.

Do not assume that the existing architecture is correct. Verify it through the repository and database.

Do not remove existing functionality without documenting why.

---

## 3. DESIGN PRINCIPLES

Follow these principles:

* One accident case can have many tasks, documents, parties, repairs, quotations, invoices, approvals and communications.
* Each team owns only its relevant section.
* Users should see only the information and actions relevant to their role.
* The system must clearly show the current owner, next action and due date.
* Most status changes must be generated by completed actions, not manually selected.
* The system must prevent accidental or premature closure.
* Mandatory fields must depend on the selected accident route.
* The same workflow must support KSA, UAE, Egypt and future GCC countries through configurable country profiles.
* Regulatory timelines, authority names and document requirements must be configurable.
* Do not hardcode Najm, Saudi Traffic, police, insurers, currencies or national rules into the core workflow.
* Keep the UI simple while the underlying workflow remains controlled.
* Mobile accident reporting must be fast and practical for site use.
* Desktop views must support detailed processing and management.
* Every important action must be auditable.
* Closed cases must remain historically accurate.
* The system must support Arabic and English text.
* Store dates and times safely with timezone awareness.
* Use the company currency configuration. Do not hardcode SAR, AED or any other currency.

---

## 4. ACCIDENT CASE CLASSIFICATION

Support these accident and incident types:

* Minor road accident.
* Major road accident.
* Site collision.
* Vehicle-to-vehicle accident.
* Equipment-to-vehicle collision.
* Equipment-to-equipment collision.
* Third-party property damage.
* Customer property damage.
* Own vehicle damage.
* Injury accident.
* Fatal accident.
* Hit and run.
* Theft.
* Fire.
* Flood or weather-related damage.
* Glass-only damage.
* Tyre or wheel-related accident.
* Rollover.
* Loading or unloading incident.
* Falling-object damage.
* Uninsured accident.
* Expired-policy accident.
* Rental vehicle accident.
* Leased vehicle accident.
* Subcontractor vehicle accident.
* No-damage incident.
* Near miss.
* Total-loss case.
* Duplicate case.
* Reopened accident case.
* Legal or disputed-liability case.

The selected accident type must control:

* Required fields.
* Required documents.
* Required teams.
* Approval workflow.
* SLA targets.
* Email recipients.
* Closure requirements.
* Reporting categories.

---

## 5. WORKSTREAMS AND TEAM OWNERSHIP

Create separate workstreams under each accident case.

### 5.1 Incident and Evidence Workstream

Primary owner: Fleet Incident Officer, Site Fleet Coordinator or assigned Fleet user.

Responsibilities:

* Create the accident case.
* Select company, country, region, branch, project and site.
* Select vehicle, equipment or asset.
* Select driver or operator.
* Record accident date and time.
* Record GPS location.
* Record site, road and location description.
* Record vehicle odometer or equipment hours.
* Record accident type.
* Record initial description.
* Record initial vehicle condition.
* Record whether the vehicle is movable.
* Record whether recovery or towing is required.
* Record injuries.
* Record third-party involvement.
* Record environmental or property damage.
* Record authority involvement.
* Upload accident photographs.
* Upload authority reports.
* Upload driver statement.
* Add witness information.
* Submit the case for Fleet validation.

The Fleet reporting user must not be allowed to approve liability, insurance settlement or final closure unless they have a separate authorized role.

### 5.2 Fleet Validation Workstream

Primary owner: Fleet Supervisor or Fleet Manager.

Responsibilities:

* Review the initial accident record.
* Confirm the correct asset.
* Confirm the correct driver.
* Validate accident type and severity.
* Check mandatory photographs.
* Check authority references.
* Check driver statement.
* Return incomplete records.
* Approve the case for further processing.
* Assign initial responsible teams.

### 5.3 Safety and Liability Workstream

Primary owner: HSE Officer, Safety Manager or authorized Fleet Manager.

Responsibilities:

* Classify accident severity.
* Record official liability.
* Record liability percentages.
* Record preventability.
* Identify immediate cause.
* Identify root cause.
* Identify contributing factors.
* Record driver or operator violations.
* Record unsafe condition.
* Record unsafe act.
* Record weather and road condition.
* Create corrective actions.
* Create preventive actions.
* Assign action owners.
* Track corrective-action due dates.
* Escalate serious incidents.
* Request legal review where required.

Liability options must include:

* Our driver 100% liable.
* Our driver partially liable.
* Third party 100% liable.
* Shared liability.
* Liability under investigation.
* Liability disputed.
* Hit and run.
* No third party.
* Not applicable.

Store liability percentage separately for:

* Company driver or asset.
* Third party.
* Other involved party.

Approved liability must be locked. Any later change must require:

* Change reason.
* Supporting document.
* Authorized approval.
* Full audit trail.

### 5.4 Insurance and Claim Workstream

Primary owner: Insurance Claims Officer.

Responsibilities:

* Confirm whether insurance applies.
* Identify policy.
* Confirm policy validity on the accident date.
* Identify insurer.
* Identify broker.
* Identify insurance type.
* Identify coverage.
* Identify deductible or excess.
* Determine claim eligibility.
* Create insurance claim.
* Enter claim number.
* Enter claim registration date.
* Upload claim submission.
* Track missing documents.
* Upload insurer acknowledgement.
* Track surveyor appointment.
* Track surveyor inspection.
* Record insurer decision.
* Record approval amount.
* Record rejected amount.
* Record exclusions.
* Record claim rejection reason.
* Record insurer-approved repair route.
* Track settlement.
* Track insurance recovery.
* Track third-party recovery.
* Track claim closure.

Insurance decision options:

* Claim not required.
* Claim under review.
* Claim documents incomplete.
* Claim registered.
* Awaiting insurer acknowledgement.
* Awaiting surveyor.
* Survey completed.
* Awaiting insurer decision.
* Fully approved.
* Partially approved.
* Rejected.
* Withdrawn.
* Settled.
* Disputed.
* Legal escalation.

### 5.5 Technical Assessment Workstream

Primary owner: Workshop Supervisor, Workshop Planner or Technical Inspector.

Responsibilities:

* Inspect the vehicle.
* Record visible damage.
* Record hidden or suspected damage.
* Record body damage.
* Record chassis damage.
* Record suspension damage.
* Record steering damage.
* Record tyre and wheel damage.
* Record electrical damage.
* Record mechanical damage.
* Record safety-system damage.
* Record attachments or equipment damage.
* Upload assessment photographs.
* Prepare estimated labour hours.
* Prepare parts requirement.
* Record estimated cost.
* Recommend repair route.
* Recommend vehicle off-road status.
* Record estimated downtime.
* Record whether specialist inspection is required.
* Record whether the case may be total loss.

### 5.6 Repair Decision Workstream

Primary owner: Authorized Fleet Manager, Workshop Manager or Insurance Officer depending on the case.

Repair options:

* No repair required.
* Temporary repair.
* Internal workshop repair.
* External workshop repair.
* Insurer-approved workshop.
* Dealer repair.
* Specialist repair.
* Replacement instead of repair.
* Total loss.
* Disposal.
* Case under technical review.

The system must record:

* Who recommended the repair route.
* Who approved it.
* Approval date.
* Approval remarks.
* Supporting estimate.
* Insurance conditions.
* Budget conditions.
* Whether PO is required.
* Whether insurer approval is required before repair.

### 5.7 Repair Planning Workstream

Primary owner: Workshop Planner.

Responsibilities:

* Create repair order.
* Break repair into tasks.
* Estimate labour hours.
* Assign technicians or teams.
* Check spare-parts availability.
* Create parts request.
* Create procurement request where required.
* Attach quotations.
* Compare external workshop quotations.
* Record approved workshop.
* Record PO reference.
* Record planned start date.
* Record planned completion date.
* Record off-road start date.
* Record expected downtime.
* Record dependencies.
* Submit repair plan to Fleet.

The repair plan must be approved by Fleet before the vehicle is formally scheduled off road, unless it is already immobilized for safety reasons.

### 5.8 Fleet Off-Road and Replacement Vehicle Workstream

Primary owner: Fleet Operations Officer.

Responsibilities:

* Review repair plan.
* Confirm off-road dates.
* Confirm operational impact.
* Confirm replacement vehicle requirement.
* Allocate replacement vehicle where available.
* Confirm vehicle movement.
* Record towing or recovery.
* Record vehicle delivery to workshop.
* Notify project or operations.
* Track expected return date.
* Update vehicle availability status.

The vehicle master record must show:

* Operational.
* Restricted operation.
* Awaiting recovery.
* Off road due to accident.
* Under inspection.
* Under repair.
* Ready for Fleet inspection.
* Rejected after repair.
* Returned to operation.
* Total loss.
* Disposed.

### 5.9 Repair Execution Workstream

Primary owner: Internal Workshop or External Workshop Coordinator.

Responsibilities:

* Start repair.
* Update task progress.
* Add repair notes.
* Add parts used.
* Add labour hours.
* Add delay reason.
* Update expected completion date.
* Upload during-repair photographs.
* Record outsourced jobs.
* Record additional damage discovered.
* Request revised approval when cost or scope increases.
* Complete repair.
* Submit for workshop quality inspection.

### 5.10 Workshop Quality Control Workstream

Primary owner: Workshop Quality Inspector or Workshop Supervisor.

Responsibilities:

* Perform quality check.
* Confirm work completed.
* Confirm safety systems.
* Confirm wheel alignment where applicable.
* Confirm tyre condition.
* Confirm road test.
* Confirm warning lights.
* Confirm no leaks.
* Confirm body and paint quality.
* Add inspection checklist.
* Upload completion photographs.
* Approve or reject repair completion.

### 5.11 Fleet Handover Workstream

Primary owner: Fleet Inspector or Fleet Operations Officer.

Responsibilities:

* Receive vehicle-ready notification.
* Inspect completed vehicle.
* Compare repair with approved scope.
* Verify vehicle condition.
* Perform operational test where applicable.
* Add handover photographs.
* Accept vehicle.
* Reject vehicle with remarks.
* Create rectification tasks.
* Confirm return-to-service date.
* Confirm actual downtime.
* Notify the project or vehicle user.

Vehicle acceptance must be recorded separately from workshop completion.

Workshop completion does not mean the case is closed.

### 5.12 Finance and Settlement Workstream

Primary owner: Finance Officer or Cost Controller.

Responsibilities:

* Record repair estimate.
* Record internal labour cost.
* Record internal parts cost.
* Record external repair cost.
* Record towing cost.
* Record storage cost.
* Record third-party cost.
* Record PO amount.
* Record invoice amount.
* Match invoice against PO.
* Record insurer-approved amount.
* Record deductible.
* Record insurance payment.
* Record third-party recovery.
* Record unrecovered amount.
* Record company loss.
* Confirm financial closure.

---

## 6. MAIN CASE STATUS

Create controlled main statuses:

1. Draft.
2. Submitted.
3. Evidence incomplete.
4. Under Fleet validation.
5. Liability assessment.
6. Insurance review.
7. Claim registration pending.
8. Awaiting insurer response.
9. Technical assessment.
10. Repair decision pending.
11. Repair planning.
12. Awaiting Fleet approval.
13. Awaiting parts.
14. Awaiting quotation.
15. Awaiting PO.
16. Awaiting external workshop.
17. Repair in progress.
18. Workshop quality inspection.
19. Fleet inspection.
20. Rectification required.
21. Operationally completed.
22. Insurance settlement pending.
23. Financial closure pending.
24. Corrective actions pending.
25. Closure review.
26. Closed.
27. Reopened.
28. Cancelled as duplicate.
29. Total loss processing.
30. Legal hold.

Avoid allowing users to freely choose any status.

Statuses must be derived from workflow conditions where possible.

---

## 7. WORKSTREAM STATUS

Each workstream must have its own status:

* Not required.
* Not started.
* Assigned.
* In progress.
* Waiting for information.
* Waiting for approval.
* Waiting for external party.
* On hold.
* Completed.
* Rejected.
* Reopened.
* Cancelled.

The case overview must show all workstreams and their current states.

Example:

* Incident Evidence: Completed.
* Liability: Completed.
* Insurance: Waiting for insurer.
* Repair: Completed.
* Fleet Handover: Completed.
* Finance: In progress.
* Corrective Actions: Not required.
* Overall Case: Insurance settlement pending.

---

## 8. CLOSURE MODEL

Do not use one uncontrolled Open or Closed toggle.

Create three closure levels.

### 8.1 Operationally Completed

The vehicle repair is completed, Fleet has accepted it and it has returned to service.

### 8.2 Operationally Completed but Financially Open

The vehicle is operating, but the insurance claim, invoice, recovery, deductible, legal matter or corrective action is still pending.

### 8.3 Fully Closed

The case can be fully closed only when:

* Incident registration is complete.
* Mandatory evidence is complete.
* Fleet validation is complete.
* Liability is approved or formally marked not applicable.
* Insurance workstream is complete or formally marked not applicable.
* Technical assessment is complete or formally marked not applicable.
* Repair route is complete or formally marked not applicable.
* Workshop quality control is complete where repair occurred.
* Fleet handover is accepted.
* Financial settlement is complete.
* Corrective actions are complete.
* No mandatory task is overdue and unresolved.
* No approval remains pending.
* No required document is missing.
* No workstream remains open.
* Closure review is approved.

A field or workstream marked Not Applicable must require:

* Reason.
* User.
* Date.
* Approval where required.

Closed cases must become read-only.

Reopening requires:

* Reopening reason.
* Requested by.
* Approved by.
* New assigned owner.
* New due date.
* Audit record.

---

## 9. ROUTE-BASED COMPLETENESS

Do not calculate progress by counting all possible fields.

Progress must be calculated based on the required route for that case.

Example routes:

**Minor Accident Without Insurance**

Required:

* Incident evidence.
* Liability review.
* Repair assessment.
* Internal repair or no-repair decision.
* Fleet inspection.
* Cost recording.
* Closure review.

**External Repair With Insurance**

Required:

* Incident evidence.
* Liability review.
* Insurance claim.
* Technical assessment.
* Insurer approval.
* Quotations.
* PO.
* External repair.
* Workshop quality control.
* Fleet inspection.
* Invoice.
* Insurance settlement.
* Financial closure.

**Total Loss**

Required:

* Incident evidence.
* Liability.
* Insurance claim.
* Survey.
* Total-loss approval.
* Asset deactivation.
* Insurer settlement.
* Disposal or transfer.
* Asset register update.
* Financial closure.
* Final closure.

**Injury Accident**

Required:

* Incident evidence.
* Authority report.
* HSE investigation.
* Injury details.
* Insurance.
* Management review.
* Corrective actions.
* Legal review where required.
* Final closure approval.

The progress percentage must be based only on required items for the selected route.

Display separate percentages for:

* Incident completion.
* Insurance completion.
* Repair completion.
* Financial completion.
* Overall completion.

---

## 10. MOBILE ACCIDENT CAPTURE

Create a mobile-first accident-reporting wizard.

**Step 1: Asset Identification**

* Scan QR code or RFID where supported.
* Search asset number.
* Select vehicle or equipment.
* Auto-fill plate number.
* Auto-fill chassis number.
* Auto-fill company.
* Auto-fill project and site where available.
* Auto-fill assigned driver.
* Record odometer or operating hours.

**Step 2: Accident Information**

* Date.
* Time.
* GPS location.
* Site or road.
* Accident type.
* Short description.
* Injury yes or no.
* Third party yes or no.
* Vehicle movable yes or no.
* Recovery required yes or no.
* Vehicle safe to operate yes or no.

**Step 3: Authority and Third-Party Information**

* Authority involved.
* Authority type.
* Authority report number.
* Report available.
* Report pending.
* Third-party name.
* Third-party vehicle.
* Third-party plate.
* Third-party contact.
* Third-party insurer where available.
* Liability available.
* Liability pending.

Authority types must be configurable by country.

Examples may include:

* Najm.
* Traffic Police.
* Police.
* Site Security.
* Civil Defence.
* Other authority.

**Step 4: Photograph Checklist**

Support configurable mandatory photographs:

* Full front view.
* Full rear view.
* Left side.
* Right side.
* Front-left corner.
* Front-right corner.
* Rear-left corner.
* Rear-right corner.
* Close-up damage.
* Accident scene.
* Vehicle plate.
* Chassis or VIN where required.
* Odometer.
* Dashboard warning lights.
* Other-party vehicle.
* Other-party plate.
* Road condition.
* Site condition.
* Tyres and wheels.
* Equipment attachment.
* Property damage.

Show clear progress, such as:

11 of 13 mandatory photographs uploaded

Allow authorized exception submission only with:

* Missing-photo reason.
* Supervisor approval.
* Audit entry.

**Step 5: Statement and Submission**

* Driver statement.
* Witness details.
* Immediate action taken.
* Review all information.
* Show missing requirements.
* Show teams that will receive the case.
* Submit accident.

Support draft saving and poor-network conditions where technically feasible.

---

## 11. CONDITIONAL TOGGLES

Use toggles to reveal relevant fields.

Required toggles:

* Insurance involved.
* Third party involved.
* Injury involved.
* Fatality involved.
* Authority report available.
* Authority report pending.
* Vehicle movable.
* Recovery required.
* Vehicle off road.
* Replacement vehicle required.
* Internal repair.
* External repair.
* Insurer-approved workshop.
* Dealer repair.
* Total-loss possibility.
* Driver statement received.
* Liability disputed.
* Legal review required.
* Environmental damage.
* Customer property damaged.
* Rental vehicle.
* Leased vehicle.
* Subcontractor vehicle.
* Corrective action required.
* Additional repair approval required.
* Vehicle repair rejected.
* Case reopened.

Do not use toggles to bypass mandatory control.

---

## 12. USER INTERFACE AND USER EXPERIENCE

The module must have a clean, modern and simple design consistent with the existing Tyre Pulse design system.

### 12.1 Fixed Case Header

Display:

* Case number.
* Asset number.
* Plate number.
* Country.
* Project or site.
* Accident date.
* Driver or operator.
* Severity.
* Liability.
* Vehicle condition.
* Vehicle operational status.
* Current stage.
* Current owner.
* Next action.
* Due date.
* SLA condition.
* Overall completion.
* Repair status.
* Insurance status.
* Settlement status.

### 12.2 Main Tabs

Create these tabs:

1. Overview.
2. Incident.
3. Evidence.
4. Parties.
5. Liability and Safety.
6. Insurance.
7. Technical Assessment.
8. Repair Planning.
9. Repair Execution.
10. Parts and Procurement.
11. Vehicle Downtime.
12. Handover.
13. Cost and Recovery.
14. Corrective Actions.
15. Tasks.
16. Approvals.
17. Communication.
18. Audit Trail.

Tabs with pending actions must show counters.

### 12.3 Overview Page

The Overview page must show:

* Current case summary.
* Accident severity.
* Vehicle status.
* Required workstreams.
* Workstream completion.
* Pending actions.
* Overdue tasks.
* Missing documents.
* Latest decision.
* Upcoming deadline.
* Repair timeline.
* Insurance timeline.
* Cost summary.
* Communication timeline.
* Closure blockers.

### 12.4 Team Inbox

Create role-specific task inboxes.

The inbox must allow:

* My tasks.
* My team's tasks.
* Unassigned tasks.
* Overdue tasks.
* Due today.
* Due this week.
* Waiting for external party.
* Waiting for approval.
* Recently completed.
* Escalated tasks.

Filters:

* Country.
* Company.
* Branch.
* Project.
* Site.
* Asset type.
* Vehicle.
* Accident severity.
* Accident type.
* Current stage.
* Owner.
* Insurer.
* Workshop.
* Claim status.
* Repair status.
* Date range.
* SLA status.

### 12.5 Visual Design

Use:

* Clear cards.
* Status chips.
* Progress bars.
* Timeline view.
* Action-focused buttons.
* Sticky case header.
* Responsive mobile layout.
* Accessible contrast.
* Clear warning colors.
* Confirmation dialogs for important actions.
* Tooltips for complex fields.
* Empty-state guidance.
* Skeleton loading.
* Clear error messages.
* Unsaved-change warning.

Avoid:

* Long unstructured forms.
* Excessive popup windows.
* Too many fields on one screen.
* Manual typing when information already exists.
* Duplicate data entry.
* Statuses that users cannot understand.
* Technical system terms in user-facing screens.

---

## 13. AUTOMATED EMAILS AND NOTIFICATIONS

The app must automatically notify the relevant team when a case reaches their stage.

The system must avoid sending every update to every user.

Send notifications for:

* Action required.
* Assignment.
* Approval required.
* Approval completed.
* Rejection.
* Missing documents.
* Major status change.
* SLA warning.
* SLA breach.
* Repair completed.
* Vehicle ready.
* Vehicle rejected.
* Claim approved.
* Claim rejected.
* Settlement received.
* Case ready for closure.
* Case reopened.

Support:

* In-app notification.
* Email.
* Optional daily digest.
* Optional escalation digest.
* Future WhatsApp integration through a provider abstraction.

**Email Subject Format**

Use:

[TP-ACC-2026-000124] [Action Required] Register Insurance Claim | Asset MX-241

Examples:

[TP-ACC-2026-000124] [Repair Approved] External Workshop | Due 30-Jul-2026

[TP-ACC-2026-000124] [Vehicle Ready] Fleet Inspection Required | Asset MX-241

**Email Content**

Include:

* Case number.
* Asset number.
* Plate number.
* Project or site.
* Accident date.
* Severity.
* Liability.
* Current stage.
* Required action.
* Responsible person.
* Due date.
* Missing information.
* Latest decision.
* Secure case link.

**Email Reply Capture**

Design an email-reply capture mechanism.

Where technically supported:

* Add a unique case token to outgoing emails.
* Save incoming replies to the communication timeline.
* Save attachments to the related case.
* Link the reply to the correct task or workstream.
* Prevent unauthorised commands through email.

If the existing email service does not support inbound email, create an abstraction and document the required provider configuration.

---

## 14. EXTERNAL PORTAL

Create a secure limited external-access workflow for:

* Insurers.
* Insurance brokers.
* Surveyors.
* External workshops.
* Recovery companies.
* Vendors.

External users must not see the full internal case.

They may be allowed to:

* View assigned request.
* Upload documents.
* Upload quotation.
* Upload invoice.
* Confirm survey appointment.
* Confirm repair start.
* Confirm expected completion.
* Confirm repair completion.
* Add remarks.
* Respond to a document request.

Use:

* Secure expiring links, or
* Restricted external accounts.

Record every external action in the audit log.

---

## 15. SLA MANAGEMENT

Build a configurable SLA engine.

Every task must support:

* SLA name.
* Start event.
* Due date.
* Target duration.
* Working calendar.
* Country holidays.
* Assigned user.
* Assigned team.
* Warning threshold.
* Escalation threshold.
* Completion date.
* Pause status.
* Pause reason.
* Resume date.
* Breach duration.

Suggested internal targets:

* Initial accident registration: 2 hours.
* Fleet validation: 4 working hours.
* Insurance review: 4 working hours.
* Complete claim submission: 1 business day.
* Workshop inspection: 1 business day.
* Initial repair estimate: 2 business days.
* Repair decision: 1 business day.
* PO after approval: 1 business day.
* Fleet inspection after repair: 4 working hours.
* Rectification plan after rejection: 1 business day.
* Closure review: 2 business days.

These are configurable defaults, not permanent hardcoded values.

Valid pause reasons:

* Waiting for authority report.
* Waiting for driver.
* Waiting for third party.
* Waiting for insurer.
* Waiting for surveyor.
* Waiting for management approval.
* Waiting for quotation.
* Waiting for PO.
* Waiting for parts.
* Waiting for workshop capacity.
* Vehicle unavailable.
* Legal hold.
* Weather delay.
* Site access restriction.
* Other approved reason.

Require:

* Expected follow-up date.
* Pause comments.
* User and date.
* Approval for long pauses.

---

## 16. ROLE AND PERMISSION MODEL

Create granular permissions.

Recommended roles:

* Accident Reporter.
* Driver or Operator Reporter.
* Fleet Incident Officer.
* Fleet Supervisor.
* Fleet Manager.
* HSE Officer.
* HSE Manager.
* Insurance Claims Officer.
* Insurance Manager.
* Workshop Inspector.
* Workshop Planner.
* Workshop Supervisor.
* Workshop Manager.
* Storekeeper.
* Procurement Officer.
* Procurement Manager.
* Finance Officer.
* Cost Controller.
* Fleet Inspector.
* Project Manager.
* Legal Reviewer.
* System Administrator.
* Read-Only Auditor.
* External Insurer.
* External Broker.
* External Workshop.
* External Surveyor.

Permission rules:

* Accident Reporters can create and submit cases.
* Accident Reporters cannot approve liability.
* Insurance users cannot edit workshop assessment.
* Workshop users cannot edit insurer decisions.
* Finance users cannot approve vehicle handover.
* Fleet inspectors can accept or reject vehicle handover.
* Only authorized managers can fully close cases.
* Only authorized managers can reopen cases.
* External users see only assigned records.
* Closed records are read-only.
* Deleted cases must not be physically deleted by normal users.
* Duplicate cases must be cancelled with linkage to the primary case.
* Every role action must be logged.

Support users having more than one role.

Support permissions by:

* Country.
* Company.
* Branch.
* Project.
* Site.
* Team.

---

## 17. DATABASE ARCHITECTURE

Do not place all information in one oversized accident table.

Use a normalized relational model or equivalent structured architecture.

Recommended entities:

* accident_cases
* accident_case_routes
* accident_case_workstreams
* accident_case_parties
* accident_case_vehicles
* accident_case_drivers
* accident_evidence
* evidence_requirements
* authority_reports
* witness_statements
* driver_statements
* liability_assessments
* safety_investigations
* root_causes
* corrective_actions
* insurance_policies
* insurance_claims
* insurance_claim_documents
* insurance_claim_events
* insurance_decisions
* insurance_settlements
* surveyors
* damage_assessments
* damage_items
* repair_decisions
* repair_orders
* repair_tasks
* repair_progress_updates
* repair_quality_checks
* parts_requests
* parts_request_items
* purchase_requests
* purchase_orders
* quotations
* quotation_items
* external_workshops
* vehicle_downtime
* replacement_vehicle_allocations
* fleet_handover_inspections
* financial_transactions
* claim_recoveries
* case_tasks
* case_task_dependencies
* case_approvals
* case_comments
* case_communications
* email_events
* notifications
* sla_definitions
* sla_instances
* sla_pause_events
* closure_requirements
* closure_reviews
* audit_logs
* country_rule_profiles
* document_requirement_profiles
* accident_type_profiles
* workflow_route_profiles

Reuse existing master tables for:

* Vehicles.
* Equipment.
* Drivers.
* Employees.
* Users.
* Projects.
* Sites.
* Companies.
* Branches.
* Vendors.
* Workshops.
* Insurers.
* Policies.
* Parts.
* Inventory.
* POs.

Use foreign keys, validation constraints and indexes.

Use soft deletion where necessary.

Include:

* Created by.
* Created at.
* Updated by.
* Updated at.
* Version where needed.
* Country.
* Company.
* Data-visibility scope.

---

## 18. AUDIT TRAIL

Every important action must record:

* Case number.
* Entity type.
* Entity ID.
* Action.
* Previous value.
* New value.
* User.
* Role.
* Date and time.
* IP or session information where available.
* Reason.
* Approval reference.
* Source, such as web, mobile, API or email.

Audit these actions:

* Case creation.
* Case submission.
* Field modification after submission.
* Liability approval.
* Liability change.
* Claim registration.
* Claim decision.
* Repair decision.
* PO approval.
* Repair-scope change.
* Vehicle acceptance.
* Vehicle rejection.
* Cost change.
* Settlement posting.
* Workstream marked not applicable.
* Case closure.
* Case reopening.
* Document deletion.
* Permission override.

Audit records must not be editable by normal users.

---

## 19. FILE AND DOCUMENT MANAGEMENT

Support:

* Photographs.
* Videos.
* PDF documents.
* Police or authority reports.
* Insurance policy.
* Claim form.
* Insurer acknowledgement.
* Survey report.
* Driver statement.
* Witness statement.
* Quotations.
* PO.
* Repair order.
* Invoice.
* Payment confirmation.
* Completion certificate.
* Handover report.
* Corrective-action evidence.

Each file must store:

* Category.
* Document type.
* File name.
* Uploaded by.
* Upload date.
* Related workstream.
* Version.
* Mandatory or optional.
* Expiry date where relevant.
* Verification status.
* Verified by.
* Document date.
* Notes.

Add document preview and download.

Add image compression without removing original quality where possible.

Prevent unsupported or unsafe file types.

---

## 20. TASKS, LOOPS AND DEPENDENCIES

Create task dependencies.

Examples:

* Insurance claim cannot be fully submitted until mandatory evidence is complete.
* Repair cannot start when insurer approval is required but not received, unless emergency override is approved.
* Fleet handover cannot start until Workshop QC is passed.
* Vehicle cannot be returned to operation after a failed Fleet inspection.
* Full closure cannot happen while finance settlement is pending.
* Corrective-action closure requires evidence.
* Total-loss closure requires asset-status update.

Support repair loops:

1. Workshop marks repair complete.
2. Workshop QC approves.
3. Fleet inspects.
4. Fleet rejects with remarks.
5. Rectification task is created.
6. Repair returns to In Progress.
7. Workshop completes rectification.
8. QC repeats.
9. Fleet inspection repeats.
10. Vehicle is accepted.

Support insurance loops:

1. Claim submitted.
2. Insurer requests documents.
3. Missing-document tasks are assigned.
4. Documents uploaded.
5. Claim resubmitted.
6. Insurer responds.
7. Partial approval is challenged if required.
8. Final decision recorded.
9. Settlement tracked.

Support closure loops:

1. Closure review identifies blocker.
2. Case returns to the responsible workstream.
3. Corrective task is generated.
4. Workstream completes.
5. Closure review is requested again.

---

## 21. PO AND ERP HANDLING

Inspect whether Tyre Pulse already creates POs or integrates with an ERP.

Use this decision order:

1. If PO creation already exists in Tyre Pulse, connect accident repair requests to it.
2. If an ERP integration exists, send approved purchase requests to the ERP and store the ERP reference.
3. If only manual PO references exist, allow PO number, date, value and attachment.
4. Do not create a second competing procurement process.

Record:

* Purchase request number.
* PO number.
* ERP reference.
* PO value.
* PO date.
* Vendor.
* Approval status.
* Invoice status.
* Remaining amount.

Use a provider or integration abstraction so ERP integration can be changed later.

---

## 22. DRIVER ACCESS

Inspect whether drivers or operators already have accounts.

If drivers have accounts:

* Allow them to submit basic accident information.
* Limit them to their own cases.
* Prevent access to insurance, finance and internal investigation records.

If drivers do not have accounts:

* Support a secure temporary reporting link, QR-based report or Fleet-assisted submission.
* Do not block the main module waiting for a driver-login decision.
* Implement the architecture so driver access can be enabled later.

---

## 23. EMAIL PROVIDER

Inspect whether the application uses:

* Microsoft 365.
* Gmail or Google Workspace.
* SMTP.
* Resend.
* SendGrid.
* Another email provider.

Create an email service abstraction.

Do not tightly connect workflow logic to one email provider.

Include:

* Outbound email.
* Delivery status.
* Failed-email retry.
* Template version.
* Email log.
* Inbound email support where available.
* Reply token.
* Attachment handling.
* User notification preferences.

---

## 24. ANALYTICS AND DASHBOARDS

Create operational, insurance, financial, safety and process dashboards.

### 24.1 Operational KPIs

* Total accidents.
* Open cases.
* Closed cases.
* Reopened cases.
* Accidents by country.
* Accidents by project.
* Accidents by site.
* Accidents by vehicle type.
* Accidents by severity.
* Accidents by accident type.
* Vehicles currently off road.
* Average reporting time.
* Average repair duration.
* Average vehicle downtime.
* Cases overdue by team.
* Repair rejection rate.
* Repeat-asset accidents.
* Repeat-driver accidents.

### 24.2 Insurance KPIs

* Insured cases.
* Uninsured cases.
* Claims registered.
* Claims approved.
* Claims partially approved.
* Claims rejected.
* Claims awaiting documents.
* Claims awaiting survey.
* Claims awaiting insurer decision.
* Claims awaiting settlement.
* Average claim-registration time.
* Average insurer response time.
* Average settlement time.
* Claim recovery percentage.
* Rejection reasons.
* Insurer performance.
* Broker performance.
* Claims aging.

### 24.3 Financial KPIs

* Gross accident cost.
* Internal repair cost.
* External repair cost.
* Parts cost.
* Labour cost.
* Towing cost.
* Storage cost.
* Third-party cost.
* Insurance-approved amount.
* Insurance-recovered amount.
* Deductible.
* Uninsured loss.
* Unrecovered loss.
* Cost by project.
* Cost by asset.
* Cost by accident type.
* Average cost per accident.

Use the organization's configured currency and avoid mixing currencies without clear labels.

### 24.4 Safety KPIs

* Preventable accidents.
* Non-preventable accidents.
* Liability distribution.
* Accident root causes.
* Unsafe acts.
* Unsafe conditions.
* Driver violations.
* Weather-related cases.
* Site-related cases.
* Corrective actions overdue.
* Accidents per million kilometres.
* Accidents per 100 active assets.

### 24.5 Process Analytics

Measure time spent:

* With Fleet.
* With HSE.
* With Insurance.
* Waiting for insurer.
* Waiting for surveyor.
* With Workshop.
* Waiting for parts.
* Waiting for quotation.
* Waiting for PO.
* Waiting for vendor.
* Waiting for Fleet inspection.
* Waiting for settlement.
* Waiting for closure approval.

The purpose is to identify the exact team or external party causing delay.

---

## 25. REPORTING AND EXPORTS

Provide:

* Accident case report.
* Insurance claim report.
* Repair report.
* Vehicle downtime report.
* Cost and recovery report.
* Open-actions report.
* Overdue-task report.
* Claims-aging report.
* Insurer-performance report.
* Workshop-performance report.
* Root-cause report.
* Corrective-action report.
* Monthly accident summary.
* Country comparison.
* Project comparison.
* Full case PDF export.
* Excel export.
* Management summary.

Reports must respect user permissions and data scope.

---

## 26. NOTIFICATIONS AND ESCALATIONS

Suggested escalation structure:

**Level 1** — Notify assigned user before due date.

**Level 2** — Notify assigned user and team lead when overdue.

**Level 3** — Notify department manager after configurable overdue period.

**Level 4** — Notify Fleet Manager or senior management for:

* Serious injury.
* Fatality.
* High-value case.
* Vehicle off road beyond threshold.
* Claim rejection.
* Liability dispute.
* Total loss.
* Legal escalation.
* Long-overdue settlement.

Escalation thresholds must be configurable.

---

## 27. BUSINESS RULE ENGINE

Create configurable business rules rather than hardcoding every route.

A rule should be able to define:

* Country.
* Company.
* Accident type.
* Severity.
* Insurance involvement.
* Third-party involvement.
* Injury involvement.
* Vehicle type.
* Repair route.
* Required fields.
* Required documents.
* Required workstreams.
* Required approvals.
* SLA definitions.
* Notification recipients.
* Closure requirements.

Provide an admin interface for controlled configuration where appropriate.

---

## 28. DATA MIGRATION

Inspect existing accident data.

Create a migration plan that:

* Preserves all existing case numbers.
* Maps existing status values to new statuses.
* Maps existing files to evidence categories.
* Maps existing repair fields.
* Maps existing insurance fields.
* Preserves original creation dates.
* Preserves original users.
* Preserves existing comments.
* Marks missing historical information clearly.
* Avoids falsely marking old cases as complete.
* Provides a migration log.
* Supports rollback where possible.

Create a backup before migration.

Test migration on a copy of the database first.

---

## 29. API DESIGN

Create clean service boundaries and APIs for:

* Accident case creation.
* Accident submission.
* Evidence upload.
* Workstream assignment.
* Liability assessment.
* Insurance claim creation.
* Insurance decision.
* Technical assessment.
* Repair decision.
* Repair planning.
* Parts request.
* PO linkage.
* Repair progress.
* Workshop QC.
* Fleet handover.
* Financial settlement.
* Corrective action.
* Closure review.
* Reopening.
* Notifications.
* Dashboard analytics.
* Audit history.

Apply:

* Server-side validation.
* Authorization checks.
* Idempotency where needed.
* Pagination.
* Filtering.
* Secure upload.
* Transaction handling.
* Error logging.
* Rate limiting for external access.

---

## 30. SECURITY AND COMPLIANCE

Implement:

* Role-based access control.
* Data-scope restrictions.
* Secure file access.
* Signed URLs where relevant.
* Server-side permission validation.
* Audit logging.
* Protection against cross-case data access.
* Protection against unauthorized status updates.
* Protection against direct database manipulation through the frontend.
* Input validation.
* File scanning where available.
* Secure external links.
* Expiring tokens.
* Session controls.
* Sensitive-field masking where appropriate.

Do not expose:

* Internal financial records to external users.
* Driver personal data to unauthorized users.
* Other project data to unrelated teams.
* Full policy information to users without permission.

---

## 31. TESTING REQUIREMENTS

Create automated tests and manual acceptance tests.

Test:

* Minor accident without insurance.
* Insured external repair.
* Internal workshop repair.
* Injury accident.
* Total-loss case.
* Third-party claim.
* Hit-and-run case.
* Missing authority report.
* Missing mandatory photograph.
* Claim rejection.
* Partial claim approval.
* Additional repair damage.
* Repair-cost increase.
* PO delay.
* Parts delay.
* External workshop delay.
* Fleet repair rejection.
* Repair rectification loop.
* Financial settlement pending.
* Case closure blocked.
* Reopening a closed case.
* Duplicate case.
* Unauthorized user access.
* Cross-company access attempt.
* External link expiry.
* Email failure.
* Notification retry.
* Data migration.
* Mobile responsiveness.
* Poor network or interrupted upload.
* Arabic content.
* Timezone handling.
* Country-specific configuration.

Test all permission combinations.

Test that a user cannot bypass closure requirements through API calls.

---

## 32. ACCEPTANCE CRITERIA

The implementation is accepted only when:

1. Fleet can register an accident through a mobile-friendly flow.
2. Mandatory evidence changes according to case type.
3. Incomplete cases are automatically returned with clear missing items.
4. Each workstream has a separate owner and status.
5. The case shows the current owner and next action.
6. Insurance can register and manage claims independently.
7. Workshop can assess, plan and execute repairs.
8. Store and Procurement can process required parts and POs.
9. Fleet controls vehicle off-road and return-to-service status.
10. Workshop completion requires Fleet acceptance.
11. Fleet can reject repairs and create a rectification loop.
12. Financial settlement remains open after operational completion where necessary.
13. Cases cannot be fully closed with missing mandatory requirements.
14. Not Applicable requires a reason.
15. Reopening requires approval.
16. All important actions are audited.
17. Emails and notifications are linked to the correct case.
18. External users receive restricted access only.
19. SLA timers and escalation rules function correctly.
20. Dashboards correctly identify team delays.
21. Existing accident data is safely migrated.
22. Existing Tyre Pulse functionality remains operational.
23. The module works on desktop and mobile.
24. Permissions are validated on the server.
25. Documentation and tests are complete.

---

## 33. REQUIRED DELIVERABLES

Provide the work in this sequence.

**Phase 1: Audit and Gap Analysis**

Deliver:

* Existing-system audit.
* Existing accident-module map.
* Reusable components.
* Missing components.
* Technical risks.
* Data-migration risks.
* Recommended implementation plan.

**Phase 2: Functional Specification**

Deliver:

* Full workflow map.
* Team responsibilities.
* Status definitions.
* Workstream definitions.
* Business rules.
* Closure logic.
* SLA rules.
* Notification matrix.
* Permission matrix.
* Country configuration model.

**Phase 3: Technical Design**

Deliver:

* Database ERD.
* Table definitions.
* API design.
* Service architecture.
* State-transition design.
* Email-service design.
* External-portal design.
* Audit-log design.
* Migration design.
* Security design.

**Phase 4: UI and UX Design**

Deliver:

* Accident mobile wizard.
* Accident case overview.
* Workstream tabs.
* Team inbox.
* Insurance dashboard.
* Workshop dashboard.
* Fleet dashboard.
* Finance dashboard.
* Closure screen.
* External upload screen.
* Empty states.
* Error states.
* Mobile and desktop responsive behavior.

**Phase 5: Implementation**

Implement in controlled modules.

Do not make one extremely large change.

Use small, reviewable commits.

Recommended implementation order:

1. Data model.
2. Role permissions.
3. Accident case core.
4. Evidence management.
5. Workstream and task engine.
6. Liability and Safety.
7. Insurance claims.
8. Technical assessment.
9. Repair planning.
10. Parts and PO integration.
11. Repair execution.
12. Workshop QC.
13. Fleet handover.
14. Finance and settlement.
15. Closure engine.
16. Email and notifications.
17. External portal.
18. SLA engine.
19. Analytics.
20. Data migration.

**Phase 6: Testing**

Deliver:

* Unit tests.
* Integration tests.
* Permission tests.
* Workflow tests.
* Migration tests.
* UI tests.
* Acceptance-test checklist.
* Identified defects.
* Resolved defects.

**Phase 7: Documentation**

Update:

* System architecture.
* Database documentation.
* API documentation.
* User-role guide.
* Accident workflow guide.
* Insurance processing guide.
* Workshop workflow guide.
* Fleet handover guide.
* Closure guide.
* Admin configuration guide.
* Country-rule configuration.
* Email configuration.
* Deployment notes.
* Migration notes.
* Changelog.

Keep documentation updated during implementation, not only at the end.

---

## 34. SPECIALIST REVIEW ROLES

Approach this work as though it is being reviewed by these specialists:

1. Workflow Architect.
2. Fleet Operations Specialist.
3. Insurance Claims Specialist.
4. Workshop Planning Specialist.
5. Data Architect.
6. UI and UX Designer.
7. Business Intelligence Analyst.
8. Security Engineer.
9. QA Engineer.
10. GCC Compliance Reviewer.

For every major design decision, check:

* Is it operationally practical?
* Is the responsible team clear?
* Can the workflow become stuck?
* Can a user bypass the control?
* Is the data auditable?
* Does the mobile experience remain simple?
* Can the same architecture support different GCC countries?
* Can management identify the cause of delay?

---

## 35. IMPORTANT IMPLEMENTATION RULES

* Do not agree with the current system design by default.
* Identify weak design and replace it where necessary.
* Do not add all fields to one page.
* Do not build one oversized database table.
* Do not use email as the official record.
* Do not use one Open or Closed switch.
* Do not close the accident when only the repair is complete.
* Do not allow uncontrolled manual status changes.
* Do not send every notification to every user.
* Do not allow users to bypass mandatory requirements.
* Do not duplicate existing Fleet, Workshop, Procurement or ERP functionality.
* Do not hardcode country-specific processes.
* Do not expose internal information to external users.
* Do not delete historical accident records.
* Do not silently change liability, costs or claim decisions.
* Do not mark migrated historical records as complete without evidence.
* Do not leave unfinished placeholder screens or fake sample data in production.

---

## 36. DECISION HANDLING WHEN INFORMATION IS UNKNOWN

Do not stop implementation for non-critical unknowns.

Use these defaults:

**Driver Login** — Build driver reporting as an optional permission. Support Fleet-assisted reporting now and enable driver self-reporting later.

**Email Platform** — Create an email-provider abstraction and connect it to the provider already used by the project.

**External Insurance Access** — Build restricted external-link capability that can be enabled by company configuration.

**PO Creation** — Reuse the existing Tyre Pulse or ERP procurement flow. If unavailable, store PO references and documents without building a separate accounting system.

**Regulatory Rules** — Create configurable country-rule profiles. Add initial KSA configuration without embedding KSA logic in the core code.

Document all assumptions clearly.

Ask a question only when a missing decision would create data loss, a security problem or a major architectural conflict.

---

## 37. FINAL REVIEW

Before declaring the work complete:

* Review every accident route.
* Review every team handoff.
* Review every closure blocker.
* Review all role permissions.
* Review mobile usability.
* Review email routing.
* Review external-user security.
* Review data migration.
* Review dashboard calculations.
* Review SLA calculations.
* Review audit history.
* Review Arabic and English display.
* Review existing Tyre Pulse modules for regressions.
* Run the full test suite.
* Update all documentation.
* Provide a final completion report.

The completion report must contain:

* What was changed.
* What was reused.
* Database changes.
* New screens.
* New roles.
* New workflows.
* New automation.
* Migration outcome.
* Tests completed.
* Known limitations.
* Recommended future improvements.
* Deployment and rollback instructions.

The Accident Management module is not considered finished until it supports the complete lifecycle:

Accident Registration -> Evidence -> Liability -> Insurance -> Technical Assessment -> Repair Decision -> Repair Planning -> Vehicle Off-Road Control -> Repair Execution -> Workshop QC -> Fleet Inspection -> Return to Service -> Insurance Settlement -> Financial Closure -> Final Case Closure.
