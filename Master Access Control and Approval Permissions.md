## Master Access Control and Approval Permissions

Review the two existing Access Matrix pages, their database tables, permission checks, user-role logic, location assignments, and all related documentation before changing anything. Identify duplicated, conflicting, missing, or unused permissions, then consolidate them into one professional **Master Access Control** module without breaking existing users or workflows.

The system must support:

* Company, country, region, branch, project, site, workshop, department, and team-level access
* Users assigned to one or multiple locations
* Different managers and approvers for each location
* Role templates such as Tyre Man, Inspector, Site Supervisor, Fleet Supervisor, Store Keeper, Workshop Manager, PMV Manager, Finance, Operations Manager, Company Admin, and Platform Super Admin
* Module-level permissions for View, Create, Edit, Delete, Approve, Reject, Return, Assign, Export, Print, Sign, Upload, Configure, and View Financial Data
* Record-level restrictions so users only access data belonging to their authorized company and locations
* Field-level restrictions for confidential data such as costs, salaries, commercial rates, and management comments
* Temporary delegated approval during leave, with start date, expiry date, and full audit history
* Separate permissions for web, mobile application, and Tyre Man PWA where necessary0

Do not assign workflows permanently to individual names. Assign approval steps to a role within the relevant organizational scope, such as “Inspector of this site” or “PMV Manager of this country.” The system must automatically resolve the correct person based on the record’s company, country, branch, site, department, and asset location.

Create one Master Access Control interface containing:

1. **Users and Assignments**
   Show each user’s company, locations, departments, roles, manager, approval authority, account status, and effective dates.

2. **Role Templates**
   Allow administrators to create, copy, compare, activate, deactivate, and version roles.

3. **Permission Matrix**
   Display all modules and actions in a searchable expandable matrix. Support bulk selection, but show warnings before granting sensitive permissions.

4. **Location Scope**
   Configure whether access applies to the whole company, selected countries, branches, sites, workshops, departments, assigned assets, or the user’s own records.

5. **Approval Authority**
   Configure which processes a role may approve, approval limits, required signatures, replacement approvers, escalation rules, and location scope.

6. **Effective Permission Preview**
   Let administrators select a user and see exactly what that user can access, why access was granted, which role supplied it, and which restrictions apply.

7. **Access Simulation**
   Provide a safe “View as User” or permission simulation mode without exposing passwords or changing the actual account.

8. **Audit History**
   Record who changed access, previous and new values, reason, date, time, device, and affected users. Access-history records must not be editable or deleted through the normal interface.

Apply these rules throughout every module, including dashboards, fleet, tyres, inspections, daily inspections, tyre replacement, inventory, store issuance, warranty, accidents, job cards, maintenance, purchasing, finance, vendors, reports, exports, executive dashboards, documents, AI features, automation, settings, integrations, APIs, and administration.

Use a deny-by-default security model. Hiding buttons is not security. Every permission must also be validated on the backend and through Supabase Row Level Security. Never trust role or location values sent only by the frontend. Prevent users from accessing unauthorized data through direct URLs, API requests, exports, reports, shared dashboard links, or modified browser requests.

Protect critical administration access:

* A company administrator must not remove their own final administration permission accidentally.
* The last active company administrator cannot be disabled without assigning a replacement.
* Tenant administrators must never access another tenant.
* Platform Super Admin access must be isolated from normal company roles.
* Sensitive permission changes should require confirmation, reason entry, and optional second approval.
* Existing permissions must be migrated safely, with a rollback plan and no automatic broadening of access.

Create reusable centralized permission functions and route guards instead of separate permission logic inside every page. Define a consistent permission naming structure such as:

`module.resource.action`

Examples:

`inspections.daily.create`
`inspections.daily.approve`
`tyres.replacement.authorize`
`inventory.issue.approve`
`reports.executive.export`
`finance.costs.view`
`settings.access.manage`

Before implementation, produce a mapping of both existing Access Matrix pages to the new Master Access Control model. Preserve valid current permissions, identify conflicts, and request confirmation before removing uncertain rules.

Test every role, module, location scope, approval flow, API endpoint, export, PWA screen, mobile screen, and shared report. Include automated tests for unauthorized access, cross-company access, cross-site access, role changes, expired delegation, inactive users, direct URL access, and approval-limit enforcement.

Do not mark this work complete until the old duplicate pages are safely retired, all modules use the centralized permission engine, permission migration is verified, security tests pass, and administrators can clearly understand each user’s effective access.
