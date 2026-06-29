You are the lead SaaS product architect, senior React engineer, Supabase/PostgreSQL database architect, data-import engineer, security engineer, mobile reliability engineer, and QA lead for the existing TyrePulse project.

Your task is to transform the current upload and column-mapping features into a complete Multi-Country Data Intake Center for the entire TyrePulse platform.

This is not a simple Excel upload improvement. It must become a controlled company data system that safely receives, preserves, cleans, validates, approves, imports, traces, and reports operational data across three countries.

Do not rebuild the whole application. Do not migrate to Go, Kotlin, Next.js, or another database in this task. Improve the existing Vite React, Expo React Native, Supabase PostgreSQL, Supabase Storage, Edge Functions, and current working modules.

Build this in a way that is ready for a future Go backend. Keep business rules, mapping logic, validation, and import workflows isolated behind reusable services rather than spreading them across page components.

1. Business context

TyrePulse is used for fleet, tyre management, tyre inspections, workshop operations, accident management, insurance claims, stock, suppliers, warranty, work orders, reporting, and executive dashboards.

The company operates across three countries.

The system must support:

* Different countries
* Different companies or legal entities where applicable
* Different projects and sites
* Different warehouses and stock locations
* Different currencies
* Different date formats
* Different time zones
* Different tyre suppliers and local naming conventions
* Different site names and aliases
* Different country-specific insurance, registration, and compliance data
* Consolidated reporting for authorised management only

The app must never mix records from one country into another country by accident.

2. Core principle

Every upload must keep all original data, even when the system does not currently understand every column.

Use this model:

Original private file
→ Import batch
→ Individual sheet records
→ Raw source rows
→ Cleaned and mapped rows
→ Validation and conflict review
→ Approval
→ Live operational records
→ Audit trail, reporting, reprocessing, and rollback

Do not insert Excel rows directly into live fleet, tyre, stock, accident, inspection, or work-order tables from the browser.

Do not rely only on extra_fields in live records.

Every source value must remain retrievable later from the original source file and raw import row.

3. Mandatory multi-country data hierarchy

Use this hierarchy consistently after inspecting existing schema:

Organisation
  → Country
    → Legal Entity / Company where applicable
      → Project
        → Site
          → Warehouse / Workshop
            → Asset / Vehicle

Every operational record must be scoped correctly.

At minimum, records must support:

* organisation_id
* country_id
* legal_entity_id or company_id where applicable
* project_id where applicable
* site_id where applicable
* created_by
* created_at
* updated_by where applicable
* updated_at
* source_batch_id where imported
* source_row_id where imported

Do not invent incompatible schema. Inspect existing tables and use backward-compatible migrations.

Country rules

1. Country selection must be mandatory when an import begins.
2. The selected country becomes the import scope.
3. Preserve any country value found inside the original source file.
4. When source-file country conflicts with selected country:
    * Show a blocking warning or review requirement.
    * Do not silently replace the original value.
    * Record the override decision and user who approved it.
5. A user assigned only to Country A must not access Country B or Country C data.
6. Cross-country users, directors, and group admins must receive explicit country scope permissions.
7. The same asset number may exist in more than one country. Do not treat it as a duplicate without country and company context.
8. The same supplier name may exist in more than one country but be treated as different local supplier records if required.
9. Stock cannot transfer between countries without an explicit cross-country transfer workflow and audit record.
10. Currency must always be stored with ISO currency code.
11. Never convert currency silently. Store:

* original amount
* original currency
* converted amount only when an approved exchange rate and conversion date exist

12. Support country-specific time zones and date formats.
13. Ambiguous dates such as 03/04/2026 must not be auto-imported without a selected date format or an approved mapping profile.
14. Preserve original units and normalised units when conversion occurs:

* PSI, kPa, bar
* kilometres, miles, hours
* kilograms, tonnes
* litres, gallons where applicable

4. Current system findings to verify before changes

Inspect the actual code and SQL migrations to confirm these known risks:

* Current Upload Data has strong tyre mapping features, fuzzy detection, Arabic/English synonyms, saved mappings, data-quality preview, duplicate review, and extra_fields.
* Tyre upload preserves unknown columns better than fleet and stock import.
* Fleet Master has separate mapping logic and can drop unknown columns.
* Stock import can discard unmapped columns.
* Accident bulk upload uses fixed columns and direct inserts.
* Generic upload can detect some file types but does not complete all module flows safely.
* Current pending_uploads.rows stores imported rows as one large JSON block.
* Original uploaded Excel and CSV files are not consistently retained in private storage.
* Mapping profiles use header fingerprint too broadly and need module, source, country, company, and version scope.
* Mobile and web may insert records directly into Supabase tables.
* Accident photo flows may generate public URLs.
* Current PWA caching may cache authenticated API traffic.
* Existing duplicate checks may be too simplistic for multi-country operations.

Do not delete or rename existing production data structures before completing a documented migration and reconciliation plan.

5. Build one Unified Data Intake Center

Create one reusable import engine used throughout the platform.

Every module page can have an “Import Data” action, but it must open the same controlled intake engine with the module pre-selected.

Examples:

Fleet page → Import Fleet / Asset Data
Tyre page → Import Tyre Lifecycle Data
Stock page → Import Stock Data
Accidents page → Import Accident and Insurance Data
Inspection page → Import Inspection Results
Workshop page → Import Work Orders / Job Cards
Suppliers page → Import Supplier and Price Data
Warranty page → Import Warranty Claims
Drivers page → Import Drivers and Operators
ERP/GPS page → Import Integration Data

Do not create separate weak uploaders for each module.

The shared engine must provide:

* Excel, CSV, and supported structured-data imports
* Multi-sheet Excel support
* Sheet selection
* Header row detection
* Arabic and English header recognition
* Mapping profiles
* Source-system profiles
* Country and company-aware mapping
* Transformation rules
* Raw data preservation
* Row-level validation
* Duplicate and conflict detection
* Import approval queue
* Private original-file storage
* Document attachment matching
* Audit trail
* Reprocess corrected rows
* Rollback or reversal workflow
* Import history
* Error export
* Custom field catalogue
* Integration logs
* API-ready service layer for future Go migration

6. Modules that must use the shared import engine

Implement the architecture for all of these. Fully implement the first three as priority, then use the same adapter pattern for the rest.

Priority imports

1. Fleet / Asset Master
2. Tyre Lifecycle and Tyre Records
3. Stock, Procurement, and Supplier Price Lists

Next imports

4. Accidents and Insurance Claims
5. Inspections and Pressure/Tread Records
6. Work Orders and Workshop Job Cards
7. Warranty Claims
8. Suppliers
9. Drivers and Operators
10. Gate Pass and Vehicle Release Records
11. GPS / Telematics / ERP source files
12. Custom Data and special company reports

7. Import data architecture

Create backward-compatible SQL migrations for a staging and audit system.

Use actual existing tenant and user fields after inspecting the schema.

Create or improve these tables:

import_files
import_batches
import_batch_sheets
import_mapping_profiles
import_mapping_rules
import_rows
import_row_issues
import_attachment_matches
custom_field_catalog
import_audit_events

import_files

Store:

* private storage path
* original filename
* MIME type
* file size
* SHA-256 file hash
* source system
* selected country
* selected company/legal entity
* uploader
* upload timestamp
* retention status
* virus or file validation status if supported

Original files must be stored in a private Supabase Storage bucket.

Never use permanent public URLs.

import_batches

Store:

* batch ID
* import module
* source file ID
* selected sheet
* source system / supplier / broker / ERP name
* selected country
* selected company/legal entity
* selected project/site if applicable
* detected header row
* confirmed header row
* mapping profile ID
* mapping profile version
* source date format
* source timezone
* source currency
* source unit system
* uploader
* reviewer
* approver
* approval status
* import status
* total rows
* ready rows
* warning rows
* error rows
* duplicate rows
* conflict rows
* imported rows
* skipped rows
* created, approved, and completed timestamps

import_batch_sheets

Store:

* batch ID
* sheet name
* sheet order
* detected header row
* total source rows
* selected or ignored status
* source columns
* import summary

Do not lose source-sheet identity when multiple sheets are processed.

import_rows

Store every source row individually.

Each row must contain:

* batch ID
* sheet name
* original row number
* raw source data JSONB exactly as received
* mapped source data JSONB
* transformed data JSONB
* custom/unmapped data JSONB
* validation status
* duplicate/conflict status
* action: insert, update, skip, review, reject
* target module
* target record ID after import
* source row fingerprint/hash
* created timestamp
* processing timestamp

Do not store all staging rows only inside one pending_uploads.rows JSON field.

Keep old pending upload history readable, but move new imports into the new batch-and-row structure.

import_row_issues

Store:

* row ID
* source field
* target field
* severity: info, warning, error
* issue code
* readable message
* original value
* transformed value
* suggested fix
* resolved status
* resolved by
* resolved timestamp

import_mapping_profiles

Mapping profiles must be reusable, controlled, and versioned.

Example profile names:

Saudi ERP Tyre Consumption Report
UAE Fleet Master GPS Export
Country C Weekly Stock Opening Sheet
Insurance Broker Claims Report
Workshop Job Card Export
Supplier Tyre Price List
Daily Pressure Inspection Report

Each profile must include:

* profile name
* module
* source system / supplier / broker
* country scope
* company/legal entity scope
* header fingerprint
* date format
* timezone
* source currency
* unit settings
* mapping rules
* transformation rules
* alias rules
* profile version
* approved by
* active/inactive status
* last used timestamp

Do not use header fingerprint alone as the mapping identity.

8. Mapping experience

Create a professional column-mapping interface.

For each incoming source column, show:

Source Header	Example Values	Fill Rate	Detected Type	Map To	Transformation	Confidence	Action

Actions must include:

* Map to canonical field
* Preserve as custom field
* Ignore for live record but preserve raw source
* Split one source field into multiple fields
* Combine multiple source fields
* Apply trim/case cleanup
* Apply date format conversion
* Convert number with unit
* Convert currency only after approval
* Map aliases to official master values
* Create reusable synonym
* Create reusable transformation rule
* Save mapping profile
* Apply existing mapping profile

Mapping confidence rules:

* Below 60% confidence: do not auto-map.
* 60% to 89%: suggest mapping and require user confirmation.
* 90% or above: auto-map but show clearly.
* Never silently map two source headers into one target field unless the user deliberately selects a combine rule.
* Never discard an unrecognised column.

Support Arabic and English headers, including spelling variations.

Examples:

Vehicle No / Asset No / Fleet No / رقم المعدة / رقم المركبة
Tyre Serial / Serial No / Tire ID / رقم الإطار
Fitment Date / Date Fitted / تاريخ التركيب
Site / Project / Location / الموقع / المشروع
Pressure / PSI / Air Pressure / ضغط الهواء
Claim Number / Insurance Ref / رقم المطالبة

Scope synonyms by module. A tyre synonym must not map incorrectly inside stock or accident imports.

9. Master data matching and alias control

Create a controlled alias and master-data matching system for:

* Country
* Company/legal entity
* Project
* Site
* Warehouse
* Asset number
* Vehicle type
* Tyre brand
* Tyre pattern
* Tyre size
* Tyre position
* Supplier
* Driver/operator
* Insurer
* Broker
* Currency
* Damage category
* Failure category
* Work-order status
* Stock item code

Example alias handling:

Qiddiya G1
Qiddiya-1
QD G1
Qiddiya Group 1
→ Qiddiya G1
Bridgestone
BRIDGESTONE
Bridge Stone
→ Bridgestone

Do not auto-create live master records silently.

When a source value cannot be matched:

* show it as an exception
* allow user to map it to existing master data
* allow authorised user to create a new master record
* record who created or approved the alias
* keep original source value in raw data

10. Data preservation and custom fields

Every original source column must remain available.

Use three layers:

1. Raw source data
2. Validated mapping data
3. Live canonical data

Do not use only tyre_records.extra_fields as preservation.

For unknown fields:

* Preserve them in import_rows.raw_source_data.
* Preserve the mapped decision in import_rows.custom_data.
* Optionally copy approved useful values into live-record extra_fields.
* Add a Custom Field Catalogue.

The Custom Field Catalogue must show:

* field name
* module
* country/company/source-system scope
* occurrence count
* example values
* first seen date
* last seen date
* mapping status
* recommendation
* promote to canonical field action
* archive action

This lets management identify useful fields that should become permanent product fields later.

11. Validation, duplicates, and conflicts

Do not treat all duplicate records the same.

Use module-specific natural keys.

Fleet / asset master

organisation + country + legal entity/company + asset number

Tyre master

organisation + country + tyre serial number

Tyre event

tyre serial + asset + event type + event date + source document or job card when available

Stock opening

item code + country + warehouse + bin + snapshot date

Stock movement

source document number + line number + country/company scope

Accident / insurance claim

country/company scope + accident number or claim number

If no accident or claim number exists, use a review match based on:

asset + date + driver + site + approximate cost

Inspection

asset + inspection template + inspection date/time + inspector + source reference

Show clear record states:

Ready
Warning
Error
Duplicate
Conflict
Skipped
Imported
Rejected
Pending Approval

Examples of critical validation:

* Required asset or tyre serial missing
* Unknown country/site/warehouse
* Invalid date
* Ambiguous date
* Invalid currency
* Tyre fitted before manufacturing or purchase date
* Removal mileage lower than fitment mileage
* Tyre cost missing
* Stock quantity negative without approved adjustment
* Accident actual cost higher than approved amount
* Claim recovery greater than claim amount
* Warranty claim without tyre serial
* Supplier price list missing currency
* Cross-country data mismatch

12. Country-specific financial, date, and unit controls

Implement country-aware rules.

Currency

Store:

* amount_original
* currency_original
* exchange_rate
* exchange_rate_date
* amount_base_currency only when conversion is approved
* conversion source

Do not mix SAR, AED, and other currencies in dashboards without a clear conversion rule and displayed currency.

Dates

Every profile must define:

* date format
* timezone
* whether dates are date-only or full timestamp

Show parsed-date preview before approval.

Support Excel serial dates.

Units

Support:

* PSI / kPa / bar
* km / miles / hours
* kg / tonnes
* litres / gallons where needed

Keep original and normalised values with conversion rule history.

13. Accident and insurance bulk import

Replace the existing fixed-column accident bulk uploader with a Data Intake Center adapter.

It must support:

* Excel and CSV
* Optional ZIP package for files
* Photos
* Police reports
* Invoices
* Quotations
* Repair estimates
* Insurance documents
* Claim documents
* Workshop documents

Attachment matching should support:

* accident number
* claim number
* asset number
* source document number
* configurable filename pattern

Accident import fields must support:

* accident number
* accident date and time
* country
* company/legal entity
* project/site
* asset number
* driver/operator
* insurer
* broker
* policy number
* claim number
* repair vendor
* estimate amount
* approved amount
* actual repair cost
* claim amount
* recovered amount
* excess amount
* unrecovered loss
* downtime
* root cause
* repair status
* closure status
* remarks

Do not auto-post accident imports without validation and approval.

After approval:

* link each accident to import batch and source row
* save all documents privately
* create follow-up tasks for missing claim data
* flag overdue claims
* flag unrecovered amounts
* flag missing estimate, invoice, approval, or closure
* link tyre and wheel damage to tyre lifecycle when serial numbers are available
* link downtime to asset history
* include financial impact in executive reports

Urgent field accident reporting must remain separate and fast, but use the same underlying accident data model, validation rules, private file rules, and audit history.

14. Tyre lifecycle import

Tyre import must not be a simple tyre list uploader.

Support:

* tyre master records
* tyre purchase
* tyre receipt
* tyre fitment
* tyre removal
* tyre rotation
* tyre inspection
* pressure measurement
* tread depth
* puncture/repair
* retread
* warranty claim
* scrap
* tyre transfer
* tyre stock movement

The importer must identify whether the file represents:

* a master tyre list
* a lifecycle event report
* a stock opening
* a supplier delivery report
* an inspection result
* a warranty claim report

Do not treat every row with a tyre serial as the same type of record.

15. Fleet / asset import

Fleet import must support:

* asset number
* fleet number
* plate number
* chassis/VIN
* vehicle type
* make/model/year
* project/site
* country/company
* current status
* meter reading
* tyre configuration
* tyre size
* tyre count
* pressure standard
* inspection frequency
* registration and insurance fields
* GPS group
* driver/operator
* custom operational fields

Unknown fields such as Driver Name, GPS Group, Registration Expiry, Fuel Type, Contract Number, and Workshop Group must remain preserved.

16. Stock and procurement import

Stock imports must support:

* item code
* item description
* tyre serial where relevant
* brand/pattern/size
* warehouse
* bin
* country/company
* project/site
* quantity
* unit of measure
* purchase price
* currency
* supplier
* PO number
* GRN number
* invoice number
* snapshot date
* movement type
* remarks
* custom values

Do not allow bulk stock imports to overwrite live stock balance without approval.

Use stock movement logic and controlled adjustment workflow.

17. Private storage and security

All import files, photos, documents, invoices, reports, and attachments must be private.

Requirements:

* No permanent public URLs
* Store only storage paths and file metadata in database
* Authorised users receive short-lived signed URLs
* Validate MIME type, extension, size, upload path, user scope, and country scope
* File paths must include organisation, country, module, batch, and unique ID
* Users must not download files from another country or company
* Admin actions must be audited
* No service role key, AI key, database password, or storage secret in frontend/mobile variables
* Do not cache authenticated REST data, private files, or authentication responses in generic PWA cache
* Clear country/user scoped cache on logout

18. Approval workflow

Each import must follow role-based approval.

Suggested rules:

Import Type	Action
Fleet enrichment	Auto-import after validation if source is trusted
Tyre lifecycle event	Auto-import only when no conflict exists
Stock adjustment	Approval required
Stock opening	Approval required
Supplier price list	Approval required
Accident and insurance claim	Approval required
Warranty claim	Approval required
Financial cost data	Approval required
Inspection file from trusted device/system	Can auto-import after validation
ERP/GPS scheduled integration	Can auto-import after profile approval

Roles must be country-scoped.

Examples:

* Country Data Officer can stage and correct data.
* Country PMV Manager can approve operational imports.
* Country Finance/Stock Approver can approve stock and financial changes.
* Group Director can see cross-country imports only when explicitly assigned.
* Platform Admin can manage profiles but must not bypass audit records.

No user should approve their own high-risk financial import unless a specific policy allows it and it is logged.

19. Server-side processing

Do not directly insert final live records from browser chunk uploads.

Use this workflow:

Upload file
→ create import file record
→ create import batch
→ parse sheets and rows
→ store raw rows
→ apply mapping profile
→ validate and classify
→ allow correction and review
→ approval
→ secure server-side commit
→ create/update live records
→ link source row to target record
→ write audit events
→ generate final import report

Use secure Supabase RPC functions or Edge Functions for final commit processing.

Requirements:

* Permission checks
* Country/company/site scope checks
* Idempotency
* Transactional processing where possible
* Clear partial failure results
* No silent partial imports
* Reprocess failed or corrected rows
* Preserve source rows permanently according to retention policy
* Support controlled reversal of imported changes
* Never delete later valid business activity during reversal

20. Value-producing automation

The Data Intake Center must create operational value, not only store Excel.

After import, generate useful actions and alerts.

Examples:

Tyre import finds tyres below legal or company tread limit
→ create tyre review/action list
Inspection import finds repeated low pressure on same vehicle
→ create corrective action and supervisor alert
Stock import finds stock below minimum level
→ create replenishment recommendation
Supplier file finds price increase above threshold
→ flag for procurement review
Accident import finds claim older than target days
→ create claim follow-up task
Accident import finds unrecovered cost
→ flag finance and insurance team
Fleet import finds registration or insurance expired
→ create compliance alert
GPS import finds missing current KM
→ flag asset master data issue

All created actions must link back to the source import batch and source row.

21. Analytics and reporting

Create an Import Control Dashboard with:

* imports by country
* imports by module
* import success rate
* validation error rate
* duplicate/conflict rate
* average approval time
* pending approvals
* failed rows
* top unknown/custom fields
* sources causing poor-quality data
* users uploading data
* latest imports
* cross-country data quality comparison

Add filters:

* country
* company/legal entity
* project
* site
* module
* source system
* uploader
* date period
* status

Country executives should see their own country. Group executives may see consolidated comparison only with explicit permission.

22. User experience requirements

Create one clean Data Intake Center with these main areas:

Upload Data
Import History
Saved Mapping Profiles
Validation and Errors
Duplicate and Conflict Review
Approval Queue
Original Files
Custom Fields
Source Systems
Integration Logs
Data Quality Dashboard

Each module page should open this same engine in the correct module context.

Make it simple enough for operational users:

* clear labels
* no technical database language
* visible file progress
* row counts
* clear errors
* bulk fix tools
* downloadable error file
* safe confirmation before posting live data
* automatic saved profile suggestion
* Arabic-ready labels and RTL compatibility

23. Migration strategy

Do not replace all current uploaders at once.

Implement in phases:

Phase 0: Audit

Create:

* docs/IMPORT_CENTER_MULTICOUNTRY_AUDIT.md
* docs/IMPORT_CENTER_DATA_MODEL.md
* docs/IMPORT_CENTER_SECURITY_PLAN.md
* docs/IMPORT_CENTER_MIGRATION_PLAN.md
* docs/IMPORT_CENTER_TEST_CASES.md

Document existing importers, current tables, direct writes, storage buckets, mapping logic, data loss risks, and migration plan.

Phase 1: Shared engine foundation

Implement:

* private original file storage
* import files/batches/rows/issues schema
* mapping profile system
* raw row preservation
* country/company scope
* data validation engine
* import history
* secure server-side commit framework

Phase 2: Tyre, Fleet, Stock

Migrate:

1. Tyre imports
2. Fleet Master imports
3. Stock and procurement imports

Keep existing upload history readable.

Phase 3: Accident and insurance

Migrate accident bulk import and attachment package processing.

Phase 4: Remaining adapters

Add inspections, work orders, warranty, suppliers, drivers, GPS/ERP integrations, gate pass, and custom data.

24. Testing requirements

Before calling any phase complete, run existing project checks and add new tests.

Required test scenarios:

1. Country A fleet file with Arabic headers and unknown columns.
2. Country B tyre lifecycle file with same asset number as Country A but different legitimate country record.
3. Country C stock file with mixed units and local currency.
4. Accident broker file with ZIP attachments.
5. Same file uploaded twice, detected by file hash.
6. Ambiguous dates requiring user confirmation.
7. Cross-country user trying to access another country’s import.
8. Mapping profile reused correctly on next month’s ERP file.
9. Unknown fields preserved and visible in Custom Field Catalogue.
10. Duplicate tyre serial handled as a lifecycle event instead of being incorrectly skipped.
11. Stock adjustment blocked until approved.
12. Original file and raw source row remain available after import.
13. Reprocess a corrected failed row.
14. Controlled rollback does not delete later valid records.
15. Existing web build, tests, and mobile typecheck remain passing.

25. Completion reporting

After each phase, provide:

1. What changed
2. Files changed
3. Database migrations created
4. Modules migrated
5. Country-scope rules implemented
6. Security improvements
7. Tests run and results
8. Data reconciliation result
9. Remaining risks
10. Exact next phase

Do not claim that anything is complete unless it is implemented, tested, and connected to the actual user flow.

Start with Phase 0 audit. Do not make destructive changes before the audit, migration plan, and data model are written.
