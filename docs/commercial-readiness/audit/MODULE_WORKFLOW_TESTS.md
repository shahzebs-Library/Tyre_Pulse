# Module workflow tests (31 core modules)

Generated 2026-11-15. Executed in a real browser (headless Chromium driven by Playwright) against the production build of the web app,
talking to a real PostgREST on a local copy of the staging database with synthetic companies. Production was not touched.
How to run it again: `e2e/staging/README.md`.

## What was real and what was a stand-in

- Real: the built web app, the login page, every page and form, PostgREST, the full database schema with its row level security, triggers and functions.
- Stand-in: sign-in service (a local shim checks the bcrypt password and signs the token). Storage, edge functions and realtime do not exist locally and answer 501.
- So NOT covered: photo or file upload, emails, push, live updates, MFA, mobile apps.
- The 31 modules were set to live only in the copy `tyrepulse_e2e`.

## Result counts

| Status | Modules |
|---|---|
| Verified Passed | 29 |
| Verified Failed | 1 |
| Not Tested | 1 |
| Blocked | 0 |

Status rule: a module is Verified Passed only when every one of the seven checks below ran in the browser and passed. Any check that failed makes it Verified Failed. Any check that could not be exercised makes it Not Tested.

## Per module

Users: Alpha Manager, Alpha Admin, Alpha Tyre Man (low role), Beta Manager or Beta Admin (other company), Gamma Admin (empty company).

| Module | Route | Who may open | Open | Role access | Empty state (Gamma) | Create | Update | Error handling | Tenant | Status | Defects |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Battery Lifecycle | /batteries | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D6 |
| Bay Scheduling | /bay-scheduling | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D6 |
| Breakdown Callouts | /breakdowns | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D2, D6 |
| Certifications | /certifications | Admin, Manager, Director | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** |  |
| Combinations | /combinations | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D6 |
| Driver Documents | /driver-documents | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D6 |
| Driver Training | /driver-training | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D2, D6 |
| DVIR Reports | /dvir | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D2, D6 |
| Tool and Equipment | /equipment | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D2, D6 |
| Fleet Groups | /fleet-groups | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D6 |
| Goods Receipt | /goods-receipt | Admin, Manager, Director | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** |  |
| Insurance Claims | /insurance-claims | Admin, Manager, Director | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** |  |
| Materials | /materials | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D6 |
| Parts Catalog | /parts-catalog | Admin, Manager, Director | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** |  |
| Parts Requests | /parts-requests | Admin, Manager, Director | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** |  |
| Preventive Maintenance | /pm-programs | Admin, Manager, Director | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** |  |
| Policy Management | /policies | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D6 |
| Recall Tracker | /recall-tracker | Admin | Passed | Passed | Passed | FAILED | Not tested | Passed | Not tested | **Verified Failed** | D6, D1 |
| Repair Requests (RFR) | /repair-requests | Admin, Manager, Director | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D3 |
| Requisitions | /requisitions | Admin, Manager, Director | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** |  |
| Vehicle Reservations | /reservations | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D6 |
| Retread Management | /retread | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D6 |
| Retread Claims | /retread-claims | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D2, D6 |
| Rotation Schedule | /rotation | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D2, D6 |
| Service Requests | /service-requests | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D2, D6 |
| Shift Scheduling | /shifts | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D2, D6 |
| Tyre Pool | /tyre-pool | any signed-in role | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D2, D5 |
| Tyre Service Events | /tyre-service-events | Admin, Manager, Director | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** |  |
| Vehicle Check In/Out | /vehicle-checkinout | Admin | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D6 |
| Warranty Tracker | /warranty | any signed-in role | Passed | Passed | Passed | Passed | Passed | Passed | Passed | **Verified Passed** | D2, D5, D4 |
| Absence and Attendance | /workshop-absence | Admin, Manager, Director | Passed | Passed | Passed | Not tested | Not tested | Not tested | Not tested | **Not Tested** |  |

## Notes and evidence per module

### Battery Lifecycle (batteries) : Verified Passed

- Opened as alpha admin: heading "Battery Lifecycle Management"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in batteries with the Alpha company id (marker E2EVZR5A); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "Enter an asset number or a serial number."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/batteries.png`, database check: select count(*) from public.batteries t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EVZR5A%' -> 1; other companies -> 0

### Bay Scheduling (bay_scheduling) : Verified Passed

- Opened as alpha admin: heading "Bay Scheduling"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in bay_schedules with the Alpha company id (marker E2EETD22); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "A bay name is required."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/bay_scheduling.png`, database check: select count(*) from public.bay_schedules t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EETD22%' -> 1; other companies -> 0

### Breakdown Callouts (breakdowns) : Verified Passed

- Opened as alpha admin: heading "Breakdown Callouts"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in breakdown_callouts with the Alpha company id (marker E2EKFZID); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused by the browser required-field prompt on the first required field; form stayed open; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/breakdowns.png`, database check: select count(*) from public.breakdown_callouts t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EKFZID%' -> 1; other companies -> 0

### Certifications (certifications) : Verified Passed

- Opened as alpha manager: heading "Certifications"
- Roles: Manager opens; Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in certifications with the Alpha company id (marker E2E9P24A); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "Subject name is required."; no row written
- Tenant: beta manager opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/certifications.png`, database check: select count(*) from public.certifications t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2E9P24A%' -> 1; other companies -> 0

### Combinations (combinations) : Verified Passed

- Opened as alpha admin: heading "Combination Manager"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in asset_combinations with the Alpha company id (marker E2E4AYBO); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "browser validation: Please fill out this field."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/combinations.png`, database check: select count(*) from public.asset_combinations t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2E4AYBO%' -> 1; other companies -> 0

### Driver Documents (driver_documents) : Verified Passed

- Opened as alpha admin: heading "Driver Documents"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in driver_documents with the Alpha company id (marker E2EI6KA9); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "Driver name is required."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/driver_documents.png`, database check: select count(*) from public.driver_documents t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EI6KA9%' -> 1; other companies -> 0

### Driver Training (driver_training) : Verified Passed

- Opened as alpha admin: heading "Driver Training Records"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in driver_training with the Alpha company id (marker E2EMCDCV); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "A driver name is required."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/driver_training.png`, database check: select count(*) from public.driver_training t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EMCDCV%' -> 1; other companies -> 0

### DVIR Reports (dvir) : Verified Passed

- Opened as alpha admin: heading "DVIR Reports"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in dvir_reports with the Alpha company id (marker E2ES0CRB); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "An asset number is required."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/dvir.png`, database check: select count(*) from public.dvir_reports t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2ES0CRB%' -> 1; other companies -> 0

### Tool and Equipment (equipment) : Verified Passed

- Opened as alpha admin: heading "Tool & Equipment Registry"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in equipment with the Alpha company id (marker E2EPWBVE); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "Please enter an equipment name."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/equipment.png`, database check: select count(*) from public.equipment t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EPWBVE%' -> 1; other companies -> 0

### Fleet Groups (fleet_groups) : Verified Passed

- Opened as alpha admin: heading "Fleet Groups"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in fleet_groups with the Alpha company id (marker E2E1JJD2); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "A group name is required."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/fleet_groups.png`, database check: select count(*) from public.fleet_groups t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2E1JJD2%' -> 1; other companies -> 0

### Goods Receipt (goods_receipt) : Verified Passed

- Opened as alpha manager: heading "Goods Receipt"
- Roles: Manager opens; Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in goods_receipts with the Alpha company id (marker E2EGTAS4); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "No goods receipts have been recorded yet. Every figure on this page is therefore zero because nothing has been entered, not because there is nothing to report. Receipts appear once stock is received against a purchase order."; no row written
- Tenant: beta manager opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/goods_receipt.png`, database check: select count(*) from public.goods_receipts t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EGTAS4%' -> 1; other companies -> 0

### Insurance Claims (insurance_claims) : Verified Passed

- Opened as alpha manager: heading "Insurance Claims"
- Roles: Manager opens; Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in insurance_claims with the Alpha company id (marker E2EE73RU); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "Provide an insurer or an asset number."; no row written
- Tenant: beta manager opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/insurance_claims.png`, database check: select count(*) from public.insurance_claims t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EE73RU%' -> 1; other companies -> 0

### Materials (materials) : Verified Passed

- Opened as alpha admin: heading "Materials Management"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in materials with the Alpha company id (marker E2EQA0YY); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused by the browser required-field prompt on the first required field; form stayed open; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/materials.png`, database check: select count(*) from public.materials t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EQA0YY%' -> 1; other companies -> 0

### Parts Catalog (parts_catalog) : Verified Passed

- Opened as alpha manager: heading "Parts Catalog"
- Roles: Manager opens; Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in parts_catalog with the Alpha company id (marker E2EM2KIE); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "A part number is required."; no row written
- Tenant: beta manager opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/parts_catalog.png`, database check: select count(*) from public.parts_catalog t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EM2KIE%' -> 1; other companies -> 0

### Parts Requests (parts_requests) : Verified Passed

- Opened as alpha manager: heading "Parts Requests"
- Roles: Manager opens; Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in parts_requests with the Alpha company id (marker E2ETMYER); still listed after reload
- Update: workflow action: Approve, status requested to approved in the database
- Empty form refused with: "Select a part or enter a part name."; no row written
- Tenant: beta manager opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/parts_requests.png`, database check: select count(*) from public.parts_requests t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2ETMYER%' -> 1; other companies -> 0

### Preventive Maintenance (pm_programs) : Verified Passed

- Opened as alpha manager: heading "Preventive Maintenance"
- Roles: Manager opens; Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in pm_programs with the Alpha company id (marker E2EDEFGN); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "Program name is required."; no row written
- Tenant: beta manager opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/pm_programs.png`, database check: select count(*) from public.pm_programs t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EDEFGN%' -> 1; other companies -> 0

### Policy Management (policies) : Verified Passed

- Opened as alpha admin: heading "Policy Management"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in policies with the Alpha company id (marker E2EFSXPF); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "A policy title is required."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/policies.png`, database check: select count(*) from public.policies t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EFSXPF%' -> 1; other companies -> 0

### Recall Tracker (recall_tracker) : Verified Failed

- Opened as alpha admin: heading "Tyre Recall & Batch Quality Tracker"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Create did not save: You do not have permission to do that. ; 403 POST /rest/v1/recalls?select=id%2Crecall_number%2Cbrand%2Caffected_sizes%2Caffected_serial_prefix%2Cissue_date%2Cseverity%2Cdescription%2Caction_required%2Csource%2Cstatus%2Ccountry%2Ccreated_by%2Ccreated_at%2Cclosed_at
- Update not reached because create failed
- Empty form refused with: "Recall number required"; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/recall_tracker.png`, database check: select count(*) from public.recalls t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EDBE6B%' -> 0; other companies -> 0

### Repair Requests (RFR) (repair_requests) : Verified Passed

- Opened as alpha manager: heading "Repair Requests (RFR)"
- Roles: Manager opens; Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in repair_requests with the Alpha company id (marker E2E1S0VF), shown in the list as GC/RFR/0003/1126; still listed after reload
- Update: workflow action: Acknowledge, status submitted to acknowledged in the database
- Empty form refused by the browser required-field prompt on the first required field; form stayed open; no row written
- Tenant: beta manager opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/repair_requests.png`, database check: select count(*) from public.repair_requests t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2E1S0VF%' -> 1; other companies -> 0

### Requisitions (requisitions) : Verified Passed

- Opened as alpha manager: heading "Requisitions"
- Roles: Manager opens; Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in requisitions with the Alpha company id (marker E2EDOMLC); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "Please enter the item being requested."; no row written
- Tenant: beta manager opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/requisitions.png`, database check: select count(*) from public.requisitions t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EDOMLC%' -> 1; other companies -> 0

### Vehicle Reservations (reservations) : Verified Passed

- Opened as alpha admin: heading "Vehicle Reservations"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in vehicle_reservations with the Alpha company id (marker E2E94QD6); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "An asset number is required."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/reservations.png`, database check: select count(*) from public.vehicle_reservations t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2E94QD6%' -> 1; other companies -> 0

### Retread Management (retread) : Verified Passed

- Opened as alpha admin: heading "Retread Management"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in retread_jobs with the Alpha company id (marker E2E9DKYJ); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "No retread records have been recorded yet. Every figure on this page is therefore zero because nothing has been entered, not because there is nothing to report. Records appear once a tyre record is categorised as a retread."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/retread.png`, database check: select count(*) from public.retread_jobs t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2E9DKYJ%' -> 1; other companies -> 0

### Retread Claims (retread_claims) : Verified Passed

- Opened as alpha admin: heading "Retread Claims"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in retread_claims with the Alpha company id (marker E2E4PY58); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "No retread claims have been recorded yet. Every figure on this page is therefore zero because nothing has been entered, not because there is nothing to report. Claims appear once one is raised with a retread supplier."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/retread_claims.png`, database check: select count(*) from public.retread_claims t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2E4PY58%' -> 1; other companies -> 0

### Rotation Schedule (rotation) : Verified Passed

- Opened as alpha admin: heading "Rotation Schedule"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in tyre_rotations with the Alpha company id (marker E2ET1UEP); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "No tyre rotations have been recorded yet. Every figure on this page is therefore zero because nothing has been entered, not because there is nothing to report. Rotations appear once one is planned or recorded."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/rotation.png`, database check: select count(*) from public.tyre_rotations t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2ET1UEP%' -> 1; other companies -> 0

### Service Requests (service_requests) : Verified Passed

- Opened as alpha admin: heading "Service Requests"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in service_requests with the Alpha company id (marker E2EU7VRU); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused by the browser required-field prompt on the first required field; form stayed open; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/service_requests.png`, database check: select count(*) from public.service_requests t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EU7VRU%' -> 1; other companies -> 0

### Shift Scheduling (shifts) : Verified Passed

- Opened as alpha admin: heading "Shift Scheduling"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in shifts with the Alpha company id (marker E2ERJFPK); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused by the browser required-field prompt on the first required field; form stayed open; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/shifts.png`, database check: select count(*) from public.shifts t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2ERJFPK%' -> 1; other companies -> 0

### Tyre Pool (tyre_pool) : Verified Passed

- Opened as alpha manager: heading "Tyre Pool"
- Roles: Manager opens; Admin opens; Tyre Man OPENS the page (route has no role guard)
- Created through the form, row found in tyre_pool with the Alpha company id (marker E2EMF660); still listed after reload
- Update: workflow action: Deploy, status available to deployed in the database
- Empty form refused with: "A tyre serial is required."; no row written
- Tenant: beta manager opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/tyre_pool.png`, database check: select count(*) from public.tyre_pool t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EMF660%' -> 1; other companies -> 0

### Tyre Service Events (tyre_service_events) : Verified Passed

- Opened as alpha manager: heading "Tyre Service Events"
- Roles: Manager opens; Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in tyre_service_events with the Alpha company id (marker E2EVWCHU); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "Provide a tyre serial or an asset number."; no row written
- Tenant: beta manager opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/tyre_service_events.png`, database check: select count(*) from public.tyre_service_events t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EVWCHU%' -> 1; other companies -> 0

### Vehicle Check In/Out (vehicle_checkinout) : Verified Passed

- Opened as alpha admin: heading "Vehicle Check In / Out"
- Roles: Manager refused (Access Restricted); Admin opens; Tyre Man refused (Access Restricted)
- Created through the form, row found in vehicle_checkinout with the Alpha company id (marker E2ETT13N); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "An asset number is required."; no row written
- Tenant: beta admin opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/vehicle_checkinout.png`, database check: select count(*) from public.vehicle_checkinout t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2ETT13N%' -> 1; other companies -> 0

### Warranty Tracker (warranty) : Verified Passed

- Opened as alpha manager: heading "Warranty & Claims Tracker"
- Roles: Manager opens; Admin opens; Tyre Man OPENS the page (route has no role guard)
- Created through the form, row found in warranty_claims with the Alpha company id (marker E2EL1467); still listed after reload
- Update: edited a text field and saved, new value found in the database
- Empty form refused with: "No warranty claims have been recorded yet. Every figure on this page is therefore zero because nothing has been entered, not because there is nothing to report. Claims appear once one is raised against a tyre."; no row written
- Tenant: beta manager opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/warranty.png`, database check: select count(*) from public.warranty_claims t where organisation_id = <Alpha> and row_to_json(t)::text like '%E2EL1467%' -> 1; other companies -> 0

### Absence and Attendance (workshop_absence) : Not Tested

- Opened as alpha manager: heading "Absence & Attendance"
- Roles: Manager opens; Admin opens; Tyre Man refused (Access Restricted)
- Read-only report: no create or update action on the page. The attendance data path (roster plus check-in) was not exercised.
- Tenant: beta manager opens the page and does not see the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors
- Evidence: spec `e2e/staging/specs/module_workflow.cjs`, screenshot `e2e/staging/evidence/workshop_absence.png`

## Defects found

| Id | Severity | Module | Defect | What was seen | Likely cause | File |
|---|---|---|---|---|---|---|
| D1 | High | recall_tracker | An Admin cannot save a recall | Alpha Admin filled Add recall and pressed Save recall. The API answered 403 and the page said "You do not have permission to do that." No row was written. | src/pages/RecallTracker.jsx line 444 sends country: form.country || profile?.country. profiles.country is an array, recalls.country is a single text value, so the row fails the country write policy (recalls_country_write). The same insert with country null succeeds for the same user (checked in SQL). In production today only a super admin passes because that policy lets super admins through. | src/pages/RecallTracker.jsx |
| D2 | Medium | breakdowns, driver_training, dvir, equipment, retread_claims, rotation, service_requests, shifts, tyre_pool, warranty | Saved table views call a table that is not in the database | Every page that uses saved views requests /rest/v1/user_view_prefs and gets 404, with a console error. The page still works; saved views do not. | supabase/migrations/20260921090000_user_view_prefs.sql exists in the repository but the table is absent from the staging schema, which was copied from the production catalog. The migration appears not to be applied. | supabase/migrations/20260921090000_user_view_prefs.sql |
| D3 | Medium | repair_requests | Request numbers carry another company's prefix | Alpha Readymix received request number GC/RFR/0001/1126. | Database function next_rfr_no falls back to the fixed prefix GC when the company has no row in repair_request_number_config. A new customer has no row. | database function public.next_rfr_no |
| D4 | Low | warranty | Country on a warranty claim is free text and a wrong value reads as a permission error | With a Country value that is not one of the user's countries the save answered 403 and "You do not have permission to do that." With KSA the same claim saved. | The Country field in the Add Claim form is a text box; the country write policy refuses unknown values and the message does not say which field is wrong. | src/pages/WarrantyTracker.jsx |
| D5 | Low | tyre_pool, warranty | No role guard on two routes | Alpha Tyre Man opened /tyre-pool and /warranty and saw the page with its Add button. Whether a Tyre Man can save there was not tested. | These two routes have no RoleRoute in src/App.jsx. This may be intended; it should be a decision, not an accident. | src/App.jsx |
| D6 | Info | 19 of the 31 routes | Most restored modules are Admin only | Alpha Manager got Access Restricted on 19 routes. Restoring the module switch alone gives managers nothing on those pages. | RoleRoute allowed={["Admin"]} in src/App.jsx. | src/App.jsx |

## Dependencies seen

- The seed has assets, sites, tyres and work orders for Alpha and Beta. It has no drivers, parts, suppliers or technicians. No module was blocked by that: driver, supplier, technician and asset fields on these forms are free text.
- Free text also means these forms do not check that an asset number or driver exists. That was not tested further.
- Parts Requests offered Alpha's open work orders and catalog parts only.
- Preventive Maintenance needs the asset confirmed with Find vehicle before it saves; TM001 was found.
- Rotation needs at least one current wheel position picked.
- Tyre Pool refuses a serial already in the pool with a plain message.
- Absence and Attendance reads rosters and check-ins. No web screen in these 31 modules records a check-in, so its data path was not exercised.

## Recommendation

**Safe to restore (29), tested end to end:** batteries, bay_scheduling, breakdowns, certifications, combinations, driver_documents, driver_training, dvir, equipment, fleet_groups, goods_receipt, insurance_claims, materials, parts_catalog, parts_requests, pm_programs, policies, repair_requests, requisitions, reservations, retread, retread_claims, rotation, service_requests, shifts, tyre_pool, tyre_service_events, vehicle_checkinout, warranty.

**Not safe to restore yet (1):** recall_tracker. Recall Tracker: fix D1 first, an Admin cannot save a recall.

**Not tested (1):** workshop_absence. Absence and Attendance opens cleanly with correct access and an empty state, but nothing proved it shows real attendance.

Before restoring for a second customer also settle D2 (saved views table), D3 (request number prefix) and decide D5 and D6.

Not tested anywhere in this run: delete actions, exports (Excel, PDF), file upload, approvals beyond one status step, Arabic, phone widths, Director and Inspector roles, and whether a low role can write through the two unguarded routes. The 17 optional, 6 misleading and 21 unsupported modules were out of scope.
