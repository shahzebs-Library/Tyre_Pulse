Tyre Pulse Enterprise Platform Master Audit, Consolidation and Implementation Plan

Act as a Principal Enterprise Architect, SaaS Product Architect, Fleet and Tyre Management Domain Expert, Security Architect, Data Architect, Workflow Architect, UX Lead, DevOps Architect, AI Systems Architect, and Commercial SaaS Product Owner.

Do not treat this as a small feature update.

Perform a complete audit of the entire Tyre Pulse platform, including:

* Source code
* Database schema
* Supabase configuration
* APIs
* Authentication
* Row Level Security
* User roles
* Access Matrix pages
* Approval workflows
* Navigation
* Dashboards
* Reports
* Mobile application
* Tyre Man PWA
* Admin areas
* AI features
* Automation
* Imported or merged modules from previous applications
* Fleet maintenance logic
* Tyre management logic
* Data intake
* Documentation
* Existing calculations
* Existing business rules

Before implementing changes, identify what currently exists, what is duplicated, what conflicts, what is incomplete, what is insecure, and what should be merged or retired.

Do not remove or merge anything until its database dependencies, workflows, permissions, reports, API usage, and business purpose are understood.

⸻

1. Complete Module Audit and Consolidation

Inspect every module, page, route, component, database table, API, report, and navigation item.

Identify modules that:

* Have different names but perform the same function
* Duplicate the same business process
* Use separate tables for similar records
* Calculate the same KPI differently
* Show the same data through different interfaces
* Were imported from another application
* Are no longer used
* Are incomplete or disconnected
* Contain conflicting business logic

For each module, recommend one of the following:

* Keep as the primary module
* Merge into another module
* Convert into a shared service
* Move under another navigation group
* Move into the Admin Console
* Retire after safe migration
* Keep separate because its business function is genuinely different

Produce a full module inventory containing:

* Current module name
* Function
* Users
* Dependencies
* Database tables
* APIs
* Permissions
* Reports
* Recommended future name
* Merge or keep decision
* Migration risk

Use one consistent naming structure across navigation, routes, database records, permissions, reports, notifications, and documentation.

⸻

2. Enterprise Navigation and Information Architecture

Redesign the navigation so related functions remain under one clear parent module.

Recommended enterprise structure:

Home and Intelligence

* Role-based Dashboard
* Personal Workspace
* Tasks
* Approvals
* Notifications
* Global Search

Fleet Operations

* Fleet Register
* Vehicle Profiles
* Drivers and Operators
* Vehicle Assignments
* Availability
* Utilization
* Site Transfers
* Documents and Compliance

Tyre Management

* Tyre Register
* Tyre Inventory
* Fitment and Removal
* Tyre Position History
* Inspections
* Pressure and Tread
* Replacements
* Repairs
* Retreading
* Scrapping
* Warranty Claims
* CPK and Tyre Life
* Vendor and Brand Performance

Maintenance and Workshop

* Preventive Maintenance
* Corrective Maintenance
* Job Cards
* Breakdown Management
* Workshop Planning
* Labour and Technician Productivity
* Spare Parts
* Maintenance History
* MTBF and MTTR

Inspections

* Daily Inspections
* Vehicle Inspections
* Tyre Inspections
* Safety Inspections
* Quality Inspections
* Defects and Corrective Actions
* Inspection Templates

Inventory and Store

* Stock
* Tyre Store
* Spare Parts Store
* Issues
* Returns
* Transfers
* Adjustments
* Stock Counts
* Reorder Levels
* Goods Receipt

Procurement and Vendors

* Purchase Requests
* RFQs
* Quotations
* Approvals
* Purchase Orders
* Vendor Management
* Contracts
* Price Lists
* Invoice Matching

Accident and Insurance

* Accident Reports
* Claims
* Assessments
* Repair Tracking
* Insurance Follow-up
* Vehicle Release

Reports and Analytics

* Operational Reports
* Tyre Reports
* Fleet Reports
* Maintenance Reports
* Financial Reports
* Saved Reports
* Scheduled Reports
* Report Builder

Executive Intelligence

* Executive Dashboard
* Live Display Dashboard
* KPI Scorecards
* Risk and Forecasting
* Executive Reports
* PDF, PPTX, and Excel Exports

Administration

* Organization
* Users
* Roles
* Access Control
* Approval Workflows
* Master Data
* Business Rules
* Locations
* Countries
* Notifications
* Integrations
* API Management
* Themes and Branding
* AI Administration
* Security
* Audit Logs
* System Health

Do not show modules a user cannot access.

Navigation must be role-aware, country-aware, location-aware, responsive, searchable, and consistent across Web, PWA, and Mobile.

⸻

3. Enterprise Organization Hierarchy

Implement one centralized organization hierarchy:

Company
→ Country
→ Region
→ Branch
→ Project
→ Site
→ Workshop
→ Department
→ Team
→ User

Every record must be associated with the correct organizational scope.

Apply this hierarchy to:

* Users
* Vehicles
* Tyres
* Inspections
* Job cards
* Inventory
* Purchase requests
* Approvals
* Reports
* Dashboards
* Notifications
* Documents
* Budgets
* Vendors
* Cost centres
* AI access
* Automations

Support users assigned to:

* One site
* Multiple sites
* One country
* Multiple countries
* One department
* Multiple departments
* Temporary locations
* Acting assignments
* Project-based assignments

Avoid storing location logic independently inside each module.

⸻

4. Organization Directory and Employee Structure

Create a centralized Organization Directory containing:

* Employee ID
* User account
* Full name
* Job title
* Department
* Team
* Company
* Country
* Region
* Branch
* Project
* Site
* Workshop
* Direct manager
* Functional manager
* Approval role
* Approval limit
* Work email
* Phone number
* WhatsApp number
* Employment status
* Start and end dates
* Assigned devices
* Preferred language
* Timezone
* Working hours
* Leave status
* Acting replacement
* Emergency contact
* Active and inactive status

This directory must be used by:

* Access control
* Approval routing
* Notifications
* Task assignments
* Reports
* Escalations
* Audit logs
* Email delivery
* WhatsApp delivery
* Mobile access
* PWA access

Do not maintain duplicate user profile records in separate modules.

⸻

5. Master Access Control

Review the two current Access Matrix pages and consolidate them into one professional Master Access Control area in the Admin Console.

Support:

* Role-based access
* Attribute-based access
* Company scope
* Country scope
* Region scope
* Branch scope
* Project scope
* Site scope
* Workshop scope
* Department scope
* Team scope
* Asset-level scope
* Record-level scope
* Field-level restrictions

Permissions must include:

* View
* Create
* Edit
* Delete
* Assign
* Approve
* Reject
* Return
* Cancel
* Close
* Reopen
* Sign
* Upload
* Download
* Export
* Print
* Configure
* Publish
* Share
* View financial data
* View confidential data
* Use AI
* Run automation
* Manage integrations
* Manage access

Use a consistent format:

module.resource.action

Examples:

inspections.daily.create
inspections.daily.approve
tyres.replacement.authorize
inventory.issue.approve
reports.executive.export
finance.costs.view
settings.access.manage

Use deny-by-default.

Hiding a button is not security. Every permission must also be enforced through:

* Backend validation
* Supabase Row Level Security
* API authorization
* Storage policies
* Export authorization
* Shared dashboard authorization

Provide:

* Role templates
* Custom roles
* Role cloning
* Role comparison
* Permission preview
* Effective access explanation
* “View as User” simulation
* Temporary access
* Access expiry
* Emergency access
* Access request and approval
* Complete access-change audit history

Prevent:

* Cross-company access
* Cross-country access
* Cross-site access
* Direct URL bypass
* Modified API requests
* Unauthorized exports
* Unauthorized shared links
* Users removing the last company administrator
* Tenant admins accessing Platform Super Admin functions

⸻

6. Country, Region, Site and Department Approval Matrix

Create one configurable Approval and Workflow Engine in the Admin Console.

Do not hardcode approver names inside individual modules.

Approval steps must resolve dynamically based on:

* Company
* Country
* Region
* Branch
* Project
* Site
* Workshop
* Department
* Role
* Cost
* Risk
* Record type
* Asset category
* Urgency
* Business rule

Example:

A daily inspection from Qiddiya G2 should route to:

Tyre Man
→ Inspector assigned to Qiddiya G2
→ Site Fleet Supervisor
→ Riyadh Workshop Manager, when required
→ KSA PMV Manager, when required

A UAE site may have a completely different approval chain.

Support:

* Country-specific workflows
* Site-specific workflows
* Department-specific workflows
* Sequential approvals
* Parallel approvals
* Conditional approvals
* Optional approvals
* Emergency approvals
* Auto approvals
* Escalations
* Approval limits
* Cost limits
* Acting managers
* Leave delegation
* Backup approvers
* Temporary delegation
* SLA timers
* Reminder schedules
* Automatic reassignment
* Rejection
* Return for correction
* Resubmission
* Cancellation
* Workflow versioning

Every approval step may require:

* Digital signature
* Typed confirmation
* PIN
* Comment
* Reason
* Photo
* Document
* GPS
* Date and time
* Device information
* QR confirmation
* OTP
* Checklist completion

Approval history must be immutable and include:

* User
* Role
* Location
* Action
* Comment
* Signature
* Date
* Time
* Device
* Previous status
* New status

Apply the workflow engine to:

* Daily inspections
* Tyre inspections
* Vehicle inspections
* Tyre replacement
* Tyre repair
* Tyre scrapping
* Warranty claims
* Tyre issuance
* Tyre transfer
* Store returns
* Job cards
* Maintenance requests
* Purchase requests
* Purchase orders
* Vendor approval
* Accidents
* Insurance claims
* Invoice approval
* Vehicle release
* Asset disposal
* Executive report publishing

⸻

7. Centralized Admin Console

Move all platform configuration into one Admin Console.

The Admin Console must contain:

Organization

* Companies
* Countries
* Regions
* Branches
* Projects
* Sites
* Workshops
* Departments
* Teams
* Cost centres

Identity and Access

* Users
* Organization Directory
* Roles
* Access Matrix
* Location assignments
* Approval authorities
* Delegations
* Sessions
* Devices
* MFA

Workflow

* Workflow templates
* Approval matrix
* Escalation rules
* Notification rules
* SLA configuration
* Business rules

Master Data

* Vehicle types
* Equipment types
* Tyre sizes
* Tyre brands
* Tyre patterns
* Defect codes
* Failure reasons
* Maintenance categories
* Inspection templates
* Units
* Statuses
* Numbering sequences

Platform

* Themes
* Branding
* Feature flags
* Countries and localization
* Languages
* Reports
* Notifications
* Integrations
* API keys
* Webhooks
* AI
* Automation
* Security
* Audit logs
* System health
* Data retention
* Backups

Operational pages should not contain system configuration unless a user has explicit administrative permission.

⸻

8. Fleet, Tyre and Maintenance Logic Alignment

Audit all fleet, tyre, maintenance, and workshop logic merged from other applications.

Identify and resolve:

* Duplicate calculations
* Different CPK formulas
* Different tyre life formulas
* Different odometer logic
* Conflicting inspection statuses
* Conflicting maintenance intervals
* Duplicate asset records
* Duplicate tyre histories
* Incorrect cost allocation
* Missing fitment and removal history
* Missing position tracking
* Incorrect warranty logic
* Missing maintenance dependencies

Create centralized calculation services for:

* Cost per kilometre
* Tyre life
* Remaining tread life
* Pressure compliance
* Replacement frequency
* Failure rate
* Warranty recovery
* Fleet availability
* Downtime
* MTBF
* MTTR
* Maintenance compliance
* Cost per asset
* Cost per site
* Cost per country
* Budget variance
* Forecast consumption

Every dashboard, report, API, PDF, PPTX, and Excel export must use the same calculation service.

⸻

9. Advanced Data Intake Centre

Create a centralized Data Intake Centre for:

* Excel
* CSV
* API
* ERP
* GPS
* TPMS
* RFID
* OCR
* QR
* Barcode
* Images
* Documents
* Bulk updates
* Historical migrations

Required capabilities:

* Upload wizard
* Column mapping
* Reusable mapping templates
* Data preview
* Validation
* Duplicate detection
* Master-data matching
* Unit conversion
* Date conversion
* Currency conversion
* Country-aware mapping
* AI-assisted cleaning
* Error classification
* Partial import controls
* Import approval
* Import audit history
* Rollback
* Reprocessing
* Scheduled imports
* API intake monitoring
* Quarantine for invalid records
* Data lineage

Show:

* Source
* Import time
* Imported by
* Accepted rows
* Rejected rows
* Updated rows
* Duplicate rows
* Validation errors
* Rollback status

All imported data must respect company and location scope.

⸻

10. Reporting and Executive Intelligence

Fix the current reporting architecture.

The PDF, PPTX, and Excel export must use the same:

* Data
* Filters
* Date range
* Sorting
* Grouping
* Visible columns
* KPI calculations
* Charts
* Branding
* Language
* User scope

Provide three export modes:

1. Current View
2. Full Filtered Report
3. Executive Report

Use:

* ECharts for executive dashboards
* Playwright with HTML templates for PDF
* PptxGenJS or python-pptx for PPTX
* ExcelJS, pandas, or openpyxl for Excel
* Background workers for large reports
* Object storage for completed reports

Executive reports must focus on numbers and decisions, including:

* KPI achieved versus target
* Current value
* Previous value
* Percentage change
* Variance
* Trend
* Risk
* Cost
* Saving
* Forecast
* Recommended action
* Responsible owner
* Due date

Avoid unnecessary long AI narratives.

AI output should be concise and structured as:

* Finding
* Supporting number
* Business impact
* Recommended action
* Priority
* Responsible role

Create a secure Executive Display Mode with:

* Read-only URL
* Token expiry
* Full-screen mode
* Auto-refresh
* Auto-rotation
* TV layout
* Company branding
* Location filters
* Emergency alerts
* Revocable access

⸻

11. Notification and Communication Engine

Create one centralized communication service supporting:

* In-app notifications
* Email
* Push notifications
* WhatsApp
* SMS
* Microsoft Teams
* Slack
* Future channels

Allow configuration based on:

* Workflow
* Country
* Location
* Role
* Department
* Priority
* Business hours
* Escalation stage
* User preference

Support:

* Templates
* Arabic and English
* Delivery status
* Retry
* Failure logs
* Rate limits
* Unsubscribe rules
* Quiet hours
* Escalation
* Notification digest
* Approval reminders

Email and phone information must come from the Organization Directory.

Do not duplicate contact data inside workflows.

⸻

12. AI and Automation Administration

Remove the AI Command Centre from normal dashboards.

Move AI administration into the Admin Console.

Include:

* AI models
* Model routing
* Prompt library
* Prompt versioning
* AI agents
* MCP tools
* Knowledge sources
* RAG
* pgvector
* Document approval
* AI permissions
* Token limits
* Cost limits
* AI logs
* Accuracy feedback
* Langfuse monitoring
* AI failure handling
* Human approval rules

Operational users should only see approved AI functions relevant to their role.

Use n8n for:

* Notifications
* Scheduled summaries
* Integrations
* Simple approvals
* WhatsApp automation
* Email automation

Use background workers for:

* Heavy reports
* Bulk imports
* Image processing
* AI reports
* Large exports

Consider Temporal only when long-running workflows become too complex for normal queues and n8n.

⸻

13. API and Integration Platform

Audit all APIs and consolidate duplicates.

Implement:

* API versioning
* Consistent naming
* Authentication
* Authorization
* Tenant isolation
* Request validation
* Zod or equivalent schema validation
* Pagination
* Sorting
* Filtering
* Bulk endpoints
* Idempotency
* Rate limiting
* Error codes
* Retry handling
* API logs
* API usage analytics
* Documentation
* OpenAPI specification
* Webhooks
* API keys
* Key rotation
* IP restrictions
* Integration health

Prepare integrations for:

* SAP
* Oracle
* Microsoft Dynamics
* Power BI
* GPS providers
* TPMS
* Accounting systems
* HR systems
* WhatsApp providers
* Email providers

⸻

14. Security and Tenant Isolation

Perform a complete security audit aligned with OWASP standards.

Review:

* Public signup
* Invitation-only onboarding
* Organization codes
* Authentication
* Password policy
* MFA
* PIN and biometric mobile access
* Session security
* Device registration
* Login history
* Suspicious access
* API authorization
* RLS
* Storage policies
* File scanning
* Malware protection
* Rate limiting
* SQL injection
* XSS
* CSRF
* Secrets
* Environment variables
* Audit logs
* Shared links
* Export access
* Admin impersonation
* Platform Super Admin access

Public employee signup should be disabled.

Recommended onboarding:

Platform Admin
→ Create Company
→ Create Company Admin
→ Company Admin creates or invites users
→ Assign role and location
→ User activates account

Support:

* Company code
* Employee ID or email
* Password
* MFA
* Mobile PIN or biometric after first login

Every tenant must be isolated at database, API, storage, cache, reporting, and background-worker level.

⸻

15. Themes, Branding and White Labelling

Create a Theme and Branding Manager inside the Admin Console.

Allow authorized administrators to configure:

* Light mode
* Dark mode
* Automatic mode
* Primary colour
* Secondary colour
* Status colours
* Logo
* Favicon
* Login image
* Font
* Density
* Border radius
* Shadows
* Navigation style
* Dashboard layout
* Report branding
* PDF branding
* PPTX branding
* Email branding

Ensure WCAG AA contrast in both themes.

Support Arabic RTL and English LTR throughout:

* Web
* PWA
* Mobile
* Emails
* PDFs
* PPTX
* Excel
* Onboarding
* Reports

⸻

16. Commercial SaaS Readiness

Add or validate:

* Multi-tenant architecture
* Subscription plans
* Trials
* Per-user pricing
* Per-vehicle pricing
* Add-ons
* Feature flags
* Usage limits
* Billing
* Invoices
* Tax configuration
* Currency
* Contract dates
* Customer onboarding
* Customer offboarding
* Data export
* Data retention
* Data deletion
* White labelling
* Customer support
* SLA
* Service status
* Tenant health
* Storage usage
* API usage
* AI usage
* Automation usage

⸻

17. Reliability, Monitoring and Support

Add:

* Sentry
* PostHog
* OpenTelemetry
* Centralized application logs
* Database monitoring
* API monitoring
* Queue monitoring
* Worker monitoring
* Storage monitoring
* Integration monitoring
* Email and WhatsApp delivery monitoring
* AI monitoring
* Uptime monitoring
* Status page

Create a Platform Operations Console showing:

* Service status
* Database health
* Supabase health
* Storage health
* API latency
* Error rate
* Queue backlog
* Failed jobs
* Integration status
* Tenant status
* Subscription status
* Recent incidents

The Help and Support menu must connect to the Admin Console and support:

* Tickets
* Priority
* Category
* Screenshots
* Logs
* User and tenant context
* Assignment
* SLA
* Status
* Resolution
* Knowledge base
* Release notes

⸻

18. Data Governance and Master Data

Create governance for:

* Vehicle master
* Tyre master
* Vendor master
* Location master
* User master
* Cost centre master
* Inspection templates
* Failure codes
* Status values
* Units
* Currencies
* Country settings

Support:

* Approval before master-data changes
* Duplicate prevention
* Merge records
* Archived records
* Effective dates
* Version history
* Data ownership
* Data steward role
* Data-quality score
* Mandatory fields
* Country-specific rules

⸻

19. Backup, Disaster Recovery and Compliance

Define:

* Automated backups
* Backup frequency
* Retention periods
* Point-in-time recovery
* Restore testing
* Disaster recovery process
* Recovery Time Objective
* Recovery Point Objective
* Tenant-level restoration
* Data archival
* Data deletion
* Legal hold
* Data residency
* Privacy compliance
* Consent tracking
* Audit-log retention

Do not claim backup readiness until a restore test has been completed.

⸻

20. DevOps and Release Management

Review:

* Development environment
* Staging environment
* Production environment
* Database migrations
* Migration rollback
* Feature flags
* CI/CD
* Automated testing
* Security scanning
* Dependency scanning
* Secret scanning
* Build monitoring
* Release approval
* Release notes
* Mobile and PWA versioning

No direct untested changes should be made in production.

⸻

21. Testing Requirements

Test all modules across:

* Platform Super Admin
* Company Admin
* Country Manager
* Regional Manager
* Branch Manager
* Site Manager
* PMV Manager
* Fleet Manager
* Workshop Manager
* Fleet Supervisor
* Inspector
* Tyre Supervisor
* Tyre Man
* Store Keeper
* Procurement
* Finance
* Operations
* Read-only executive

Test:

* Multiple companies
* Multiple countries
* Multiple branches
* Multiple sites
* Shared users
* Acting managers
* Expired delegation
* Inactive users
* Approval limits
* Cross-tenant attacks
* Direct URL access
* API manipulation
* Export security
* Shared dashboard links
* Mobile
* PWA
* Desktop
* Arabic RTL
* English LTR
* Light theme
* Dark theme
* Offline mode
* Poor network
* Large data volumes

Include:

* Unit tests
* Integration tests
* Permission tests
* RLS tests
* Workflow tests
* End-to-end tests
* Performance tests
* Security tests
* Migration tests
* Report comparison tests

⸻

22. Required Deliverables

Before implementation, provide:

1. Current system architecture
2. Complete module inventory
3. Duplicate module report
4. Merge and retirement recommendations
5. Navigation redesign
6. Organization hierarchy model
7. Master Access Control design
8. Country and site approval matrix design
9. Admin Console structure
10. Data model recommendations
11. Fleet, tyre, and maintenance logic audit
12. Data Intake Centre design
13. Reporting architecture
14. PDF, PPTX, and Excel solution
15. Executive dashboard design
16. API audit
17. Security audit
18. Tenant-isolation review
19. Data-governance plan
20. AI and automation architecture
21. Monitoring and support design
22. Commercial SaaS readiness review
23. Migration plan
24. Rollback plan
25. Test plan
26. Priority roadmap
27. Cost and complexity estimate
28. Risks and dependencies
29. List of every proposed file, database, API, and configuration change

Use implementation phases:

Phase 1

Audit, map, document, and secure the current platform.

Phase 2

Consolidate duplicate modules, navigation, permissions, and shared business logic.

Phase 3

Implement the Admin Console, organization hierarchy, approval engine, and data governance.

Phase 4

Implement the advanced report engine, executive dashboard, Data Intake Centre, notifications, and integrations.

Phase 5

Implement enterprise AI, automation, billing, monitoring, support, and advanced commercial SaaS functions.

Do not change everything at once.

Do not mark work complete based only on successful compilation.

Completion requires:

* Data migration verified
* Existing workflows preserved
* Permission tests passed
* RLS tests passed
* Approval routing verified
* Reports match on-screen data
* PDF and PPTX exports validated
* Duplicate modules safely retired
* Admin Console fully connected
* All roles tested
* Arabic and English tested
* Mobile, PWA, and Web tested
* Monitoring active
* Rollback available
* Documentation updated

Enterprise Error Handling, Validation and Exception Management (Mandatory)

Perform a complete audit of error handling across the entire Tyre Pulse platform. No internal system errors, stack traces, SQL errors, API responses, Supabase errors, technical messages, database names, server information, environment variables, file paths, or sensitive implementation details should ever be exposed to end users.

Create a centralized Error Handling Framework used consistently by the Web application, Mobile application, Tyre Man PWA, APIs, background workers, AI services, imports, exports, reports, notifications, and integrations.

Implement user-friendly error messages that clearly explain what happened and what the user should do next without exposing technical details. Every error should provide an appropriate severity level, optional recovery actions, and a unique Error Reference ID for support purposes.

Support different error categories including:

* Validation Errors
* Permission Errors
* Authentication Errors
* Authorization Errors
* Business Rule Violations
* Approval Errors
* Data Integrity Errors
* Network Errors
* Offline Errors
* Sync Errors
* API Errors
* Database Errors
* File Upload Errors
* Import Errors
* Export Errors
* PDF/PPTX Generation Errors
* AI Errors
* Integration Errors
* Background Job Errors
* Unexpected System Errors

Display friendly messages such as:

* You do not have permission to perform this action.
* No records were found matching your filters.
* Your session has expired. Please sign in again.
* The report is being generated. You will be notified when it is ready.
* Unable to connect. Working in offline mode.
* Something went wrong. Please try again or contact your administrator using the reference number below.

Never display raw exceptions, SQL queries, stack traces, API payloads, Supabase error messages, database table names, internal IDs, file paths, or debugging information to end users.

Log all technical details securely for administrators, including:

* Error Reference ID
* User
* Company
* Country
* Branch
* Site
* Module
* Screen
* Action
* API Endpoint
* Request ID
* Correlation ID
* Device
* Browser
* App Version
* Network Status
* Timestamp
* Full Stack Trace
* Request Payload (sanitized)
* Response Payload (sanitized)

Integrate centralized error logging with Sentry and system monitoring so administrators receive alerts for critical failures while users receive only safe and meaningful messages.

Provide graceful handling for empty states, loading states, offline mode, slow network conditions, failed synchronizations, expired sessions, missing permissions, and temporary service outages. Where possible, allow retry, recovery, draft saving, or background processing instead of blocking the user.

Finally, audit every module, API, report, workflow, import, export, AI feature, notification, and approval process to ensure all exceptions are handled consistently, securely, and professionally, providing an enterprise-grade user experience without exposing sensitive implementation details.

The final platform must remain configurable, secure, maintainable, scalable, and commercially suitable for multinational fleet and tyre operations without requiring code changes for every new customer, country, site, role, approval chain, report, or workflow.
