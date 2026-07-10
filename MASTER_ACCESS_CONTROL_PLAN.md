# Master Access Control — Consolidation Plan (Review + Mapping)

> **Status: PLAN ONLY.** No page, table, RPC, or permission rule is changed by this
> document. Per the spec (`Master Access Control and Approval Permissions.md`), we
> first review the existing surfaces, map every rule to a target model, and flag
> everything **Uncertain** for confirmation **before** any removal. Nothing is
> retired until migration is verified, the centralized engine is live, and security
> tests pass.

---

## 0. Scope & sources reviewed

- Spec (authoritative): `Master Access Control and Approval Permissions.md`
- Approval engine (must integrate, do not rebuild): `APPROVAL_WORKFLOW_ENGINE.md`,
  migrations **V97** (base engine), **V116/V117/V118/V119** (expanded steps,
  actions, dashboard, notify).
- Frontend: `src/contexts/AuthContext.jsx`, `src/components/ProtectedRoute.jsx`,
  `src/App.jsx`, `src/pages/PermissionMatrix.jsx`, `src/pages/UserManagement.jsx`,
  `src/components/AccessControlMatrix.jsx`, `src/console/pages/ConsolePermissions.jsx`,
  `src/lib/permissionMatrix.js`, `src/lib/moduleCatalog.js`,
  `src/lib/api/modulePermissions.js`, `src/lib/featureFlags.js`,
  `src/lib/api/workflows.js`.
- Backend: V42 (org helpers `app_current_org` / `app_in_org`), V64
  (`set_module_permissions`), V65 (super-admin cross-org), V66/V67 (country orgs +
  `admin_update_profile`), V70 (profiles org isolation), V107 (integration roles +
  `app_settings` write scoping), V108/V109 (country addresses, sites master),
  V110–V115 (org/country isolation hardening), V116/V117 (workflow step schema +
  actions).

---

## 1. Current state

### 1.1 The permission surfaces that exist today

There are **four** places that read or write role×module access, plus one static
display table. This scattering is the core problem the consolidation solves.

| # | Surface | File | Writes to | Roles source | Notes |
|---|---------|------|-----------|--------------|-------|
| **A** | **Permission Matrix** page (`/permission-matrix`) | `src/pages/PermissionMatrix.jsx` | `module_permissions` (via `set_module_permissions` RPC) for **view**; `app_settings.permission_overrides` for create/edit/delete/export/approve (**stored, NOT enforced**) | `ACCESS_ROLES` from `moduleCatalog.js` | Admin-gated in JS (`profile.role==='Admin'`). Capability dimension exists but only `view` is enforced. |
| **B** | **Access Control Matrix** (embedded tab in User Management) | `src/components/AccessControlMatrix.jsx` (rendered by `src/pages/UserManagement.jsx:1059`) | `module_permissions` (via `set_module_permissions` RPC) — **view only** | `ACCESS_ROLES` from `moduleCatalog.js` | Simpler role×module on/off grid. **Overlaps A's `view` layer exactly** — both write the same global `module_permissions` rows through the same RPC. |
| **C** | **Console Permissions** (Platform Super-Admin console) | `src/console/pages/ConsolePermissions.jsx` | `module_permissions` via **direct `.upsert()`** (not the RPC), supports **per-org** rows (`org_id = <org>` or global) | Local hardcoded `ROLES` + `MODULES` arrays (duplicated, drifted) | Separate isolated console auth. Can write per-tenant overrides that A/B cannot see. |
| **D** | Static role capability table (display only) | `src/pages/UserManagement.jsx:65-79` `PERMISSION_MATRIX` | nothing (read-only reference) | inline literal | Human-readable "Full/Read/Write/Checklist" per module; **drifts** from A/B/C and from `ROLE_DEFAULTS`. |
| **E** | Location assignment (part of the user editor) | `src/pages/UserManagement.jsx` + `admin_update_profile` RPC | `profiles.country[]`, `profiles.region`, `profiles.site`, `profiles.org_id` | — | The only "location scope" wiring today; single-valued (except `country` which is an array). |

> **Two "Access Matrix" pages the spec refers to = A (`PermissionMatrix.jsx`) and B
> (`AccessControlMatrix.jsx`, embedded in `UserManagement.jsx`).** C
> (`ConsolePermissions.jsx`) is a third editor in the isolated super-admin console and
> is folded into the consolidation as well.

### 1.2 The enforcement path (how a check actually resolves today)

**Frontend:**
- `AuthContext.hasPermission(moduleKey)` (`AuthContext.jsx:196`) is the single
  runtime gate. Order: `Admin → true`; else if `modulePerms` (from
  `get_user_module_permissions` RPC) is non-empty → `modulePerms[moduleKey]===true`;
  else fall back to hardcoded `ROLE_DEFAULTS` (`AuthContext.jsx:11-23`).
- Route guards in `App.jsx` use `<ModuleRoute moduleKey=…>` and `<RoleRoute allowed=…>`
  (`ProtectedRoute.jsx:73-81`, `63-71`). `<ProtectedRoute>` also blocks `locked` and
  `approved===false` accounts.
- `permissionMatrix.js` mirrors `ROLE_DEFAULTS` as `ROLE_VIEW_DEFAULTS` and is
  guarded by a "defaults-mirror" test (`src/test/permissionMatrix.test.js`).

**Backend / RLS:**
- Org isolation is the real boundary: `app_current_org()` (V42) reads
  `profiles.org_id`; ~38 `*_org_isolation` RESTRICTIVE policies scope every business
  table (V43+), with `OR is_super_admin()` added in V65. Profiles themselves are
  isolated in V70. Country/site isolation hardened in V108–V115.
- `set_module_permissions` (V64) is the Admin-gated writer (checks `role='Admin'`
  OR `is_super_admin`), writes **global** (`org_id IS NULL`) rows.
- Role vocabulary is enforced by a CHECK on `profiles.role` (widened in V107).
- `app_settings` writes are scoped in V107 (only Admin writes
  `permission_overrides`; integration roles limited to `erp_connection`).

**Approval authority (already built — must integrate):**
- Steps are role- or user-assigned: `{assignee_type:'role'|'user', approver_role, approver_user_id}`
  (V116). `workflow_act` (V117) authorises the caller against the current step's
  role (via `get_my_role()`) or specific user, enforces per-step capture
  requirements **server-side**, supports approve/reject/**return**, auto-skips
  conditional steps, and notifies the next assignee by **role-in-org**
  (`notify_role_in_org`) — **not** by hardcoded name. This is exactly the
  "resolve the approver by scope" primitive the spec asks for, but it currently
  resolves by **org + role only**, not by the record's country/site/branch.

### 1.3 Data shapes today

- **`profiles`**: `id, full_name, username, role, email, employee_id, site (text),
  country (text[]), region (text), org_id/organisation_id, approved, locked,
  is_super_admin`.
- **`module_permissions`**: `(org_id nullable, role, module_key, enabled)` unique on
  `(org_id, role, module_key)`; NULL org_id = global default.
- **`app_settings`**: key/value JSON store — holds `feature_flags`,
  `permission_overrides`, `erp_connection`.
- **`organisations`**: one org per country today (KSA/UAE/Egypt, V66) — country is
  modeled as a **tenant**, not a location dimension.
- **`sites`**: real per-org master (V109): `name, site_code, site_type
  (depot/workshop/warehouse/camp/branch/project/yard/other), country, region, city`.
- **Workflow**: `workflow_definitions.steps[]`, `workflow_instances`,
  `workflow_step_events` (append-only audit).

---

## 2. Duplications / conflicts / gaps

### Duplications
- **D1 — Three editors of the same `module_permissions.view` layer.** Page A,
  component B, and console C all write role×module `enabled`. A and B are byte-identical
  in effect (same RPC, same global rows). C bypasses the RPC with a raw upsert and
  adds a per-org dimension the others ignore.
- **D2 — Four copies of the module list.** `moduleCatalog.MODULE_GROUPS`,
  `ConsolePermissions.MODULES`, `UserManagement.PERMISSION_MATRIX` keys, and the
  `<ModuleRoute moduleKey>` literals in `App.jsx`. They have already drifted
  (Console lacks `rca` grouping parity; `PERMISSION_MATRIX` uses label strings not keys).
- **D3 — Three copies of role defaults.** `AuthContext.ROLE_DEFAULTS`,
  `permissionMatrix.ROLE_VIEW_DEFAULTS` (kept in sync only by a test), and a third
  inline copy in `ConsolePermissions.load()`.
- **D4 — Role list duplicated** in `moduleCatalog.ACCESS_ROLES`,
  `ConsolePermissions.ROLES`, `UserManagement` role arrays, and the DB CHECK.

### Conflicts
- **C1 — RPC vs. raw upsert.** Console C writes `module_permissions` directly,
  skipping the `set_module_permissions` audit/guard path used by A/B. Two write
  paths, one with an audit action (`update_permissions`) and one without.
- **C2 — Global vs. per-org rows.** C can set an org-specific row that shadows the
  global row A/B edit; A/B have no UI to see or reconcile it → an admin editing A/B
  may believe access is X while a console override makes it Y.
- **C3 — Static table D contradicts live data.** `PERMISSION_MATRIX` (D) shows
  "Inspector: Inspections = Full" while `ROLE_DEFAULTS` gives Inspector only
  module *view*; there is no create/edit granularity enforced at all.

### Gaps vs. spec
- **G1 — Capability enforcement.** Only `view` is enforced. create/edit/delete/
  approve/reject/return/assign/export/print/sign/upload/configure/view_financial are
  **not** enforced anywhere (stored-only in `permission_overrides`). The spec's
  14-action model is unimplemented on the backend.
- **G2 — `module.resource.action` naming absent.** Permissions are `(role, module_key)`
  booleans, not `module.resource.action` strings.
- **G3 — Location scope is single-valued.** A user has one `site`, one `region`, an
  array of `country`. No company/region/branch/project/workshop/department/team
  hierarchy, no **users→multiple locations** junction, no per-location manager/approver.
- **G4 — Record-level & field-level restrictions.** Record-level exists only as org
  (and partial country) RLS. **Field-level** (hide cost/salary/rate/mgmt comments) is
  **not modeled** — financial columns are returned to any role that can read the row.
- **G5 — Approval authority not scope-resolved.** Steps resolve approver by
  **org+role**, not by the record's country/site/branch/department. The spec forbids
  hardcoded names (already satisfied) but requires scope resolution (not yet).
- **G6 — Delegation.** No temporary delegated-approval model (start/expiry + audit).
- **G7 — Role templates.** Roles are a fixed enum + hardcoded defaults; no
  create/copy/compare/activate/deactivate/**version** capability.
- **G8 — Deny-by-default.** `hasPermission` falls back to `ROLE_DEFAULTS` when DB is
  empty (fail-partial-open per role); `featureFlags.isEnabled` fails **open** for
  unknown keys. Spec requires **deny-by-default** everywhere.
- **G9 — Effective-permission preview, access simulation ("view as user"),
  consolidated audit history** — none exist.
- **G10 — Last-admin / self-lockout / super-admin-isolation / sensitive-change
  confirmation** protections are partial: V64 guards who can write, V65 isolates
  super admin at RLS, but there is no "cannot disable the last active admin",
  no reason-entry/second-approval on sensitive grants.
- **G11 — Channel scope (web / mobile / Tyre Man PWA).** No per-surface permission
  dimension.

---

## 3. Target model

### 3.1 Permission identity — `module.resource.action`

A permission is a dotted string `module.resource.action`. The registry is the
**single source of truth** (replaces `moduleCatalog`, the console/UM copies, and the
capability list). Wildcards allowed in grants: `module.*.*`, `module.resource.*`.

**Action set (14, canonical):**
`view · create · edit · delete · approve · reject · return · assign · export ·
print · sign · upload · configure · view_financial`

**Module → resource registry (proposed, full):**

```
dashboards.overview.{view,configure,export}
dashboards.executive.{view,export,print,configure,view_financial}
fleet.vehicles.{view,create,edit,delete,assign,export,print}
fleet.assets.{view,create,edit,delete,assign,export}
fleet.analytics.{view,export,view_financial}
tyres.records.{view,create,edit,delete,assign,export,print,upload}
tyres.lifecycle.{view,edit,export}
tyres.replacement.{view,create,edit,approve,reject,return,sign,print,upload}
tyres.scrap.{view,create,approve,reject,return,export}
tyres.retread.{view,create,edit,approve,export}
inspections.tyre.{view,create,edit,delete,approve,reject,return,sign,upload,export,print}
inspections.daily.{view,create,edit,approve,reject,return,sign,upload,export,print}
inspections.planner.{view,create,edit,assign,configure}
inventory.stock.{view,create,edit,delete,export,view_financial}
inventory.replenishment.{view,create,approve,reject,export}
inventory.issuance.{view,create,approve,reject,return,sign,print}
inventory.transfer.{view,create,approve,reject,return}
inventory.returns.{view,create,approve,reject,return}
warranty.claims.{view,create,edit,approve,reject,return,upload,export,view_financial}
accidents.reports.{view,create,edit,approve,reject,return,sign,upload,export,view_financial}
jobcards.orders.{view,create,edit,delete,approve,reject,return,assign,sign,print,view_financial}
maintenance.calendar.{view,create,edit,delete,assign,configure}
maintenance.requests.{view,create,approve,reject,return,assign}
maintenance.corrective.{view,create,edit,approve,export}
maintenance.gatepass.{view,create,approve,reject,print,sign}
purchasing.requests.{view,create,edit,approve,reject,return,export,view_financial}
purchasing.orders.{view,create,edit,approve,reject,print,export,view_financial}
purchasing.grn.{view,create,approve,reject,sign,print}
finance.costs.{view,view_financial,export,configure}
finance.budgets.{view,create,edit,approve,export,view_financial}
finance.billing.{view,configure,export,view_financial}
vendors.directory.{view,create,edit,delete,export}
vendors.intelligence.{view,export,view_financial}
reports.standard.{view,create,export,print,configure}
reports.builder.{view,create,edit,delete,configure}
reports.scheduled.{view,create,edit,delete,configure}
reports.executive.{view,export,print,sign,view_financial,configure}
exports.data.{export}                         # cross-cutting export authority
documents.library.{view,upload,delete,approve,sign,export}
ai.assistant.{view,configure}
ai.analytics.{view,export,configure}
automation.workflows.{view,create,edit,delete,configure,approve}
automation.rules.{view,create,edit,delete,configure}
automation.events.{view,export,configure}
settings.general.{view,configure}
settings.access.{view,configure}              # Master Access Control itself
settings.featureflags.{view,configure}
integrations.erp.{view,configure,export}
integrations.connectors.{view,create,edit,delete,configure}
apis.keys.{view,create,delete,configure}
apis.webhooks.{view,create,edit,delete,configure}
administration.users.{view,create,edit,delete,assign,configure}
administration.roles.{view,create,edit,delete,configure}
administration.audit.{view,export}
administration.tenants.{view,configure}       # platform super-admin only
```

> The action list per resource above is the **maximum** meaningful set; the registry
> stores, for each resource, which of the 14 actions are *applicable* so the matrix
> never shows nonsensical cells (e.g. `finance.costs.sign`).

### 3.2 Role templates → default permission sets

Templates are **data** (`role_templates` rows), copyable/versionable. Defaults below
are the *seed*; deny-by-default means anything not listed is **denied**.

| Template | Default grant summary |
|---|---|
| **Tyre Man** | `dashboards.overview.view`; `tyres.records.{view,create,upload}`; `tyres.replacement.{view,create,sign,upload}`; `inspections.{tyre,daily}.{view,create,sign,upload}`; `inventory.issuance.{view,create}`; `maintenance.gatepass.{view,create}`. No financial, no approve. |
| **Inspector** | Tyre Man read set **+** `inspections.{tyre,daily}.{approve,reject,return,sign}`; `tyres.replacement.approve` (scope: own site); `fleet.vehicles.view`. |
| **Site Supervisor** | Inspector set **+** `inspections.*.approve`, `tyres.scrap.approve`, `maintenance.gatepass.approve`, `inventory.issuance.approve`, `administration.users.view` (own site), `reports.standard.view` — scoped to assigned site(s). |
| **Fleet Supervisor** | Cross-site read on `fleet.*`, `tyres.*.view`, `inspections.*.view/approve` (final review), `fleet.analytics.view`, `reports.standard.export`. Scope: assigned region(s). |
| **Store Keeper** | `inventory.stock.{view,create,edit}`, `inventory.{replenishment,issuance,transfer,returns}.{view,create,approve}`, `purchasing.grn.{view,create,sign}`, `inventory.stock.view_financial`. |
| **Workshop Manager** | `jobcards.orders.*` (incl. approve, view_financial), `maintenance.*` approve, `tyres.replacement.approve`, `accidents.reports.{view,approve}`, `purchasing.requests.approve` (limit), scope: assigned workshop(s). |
| **PMV Manager** | Fleet + maintenance authority across country: `fleet.*`, `maintenance.*`, `jobcards.*` approve, `tyres.*` approve, `reports.executive.view`, `finance.costs.view`. Scope: assigned country. |
| **Finance** | `finance.*` incl. `view_financial`, `purchasing.*.{view,approve,view_financial}`, `warranty.claims.view_financial`, `reports.executive.{view,export,view_financial}`, `exports.data.export`. No operational create. |
| **Operations Manager** | Broad approve authority across operational modules (`inspections/tyres/maintenance/purchasing/accidents .approve`), `dashboards.executive.view`, `reports.*`, `finance.costs.view`. Scope: company or multi-country. |
| **Company Admin** | `settings.*`, `administration.{users,roles,audit}.*`, `automation.*`, `integrations.*`, `apis.*`, full operational `*` within their **own tenant only**. Cannot access other tenants; cannot self-remove last-admin. |
| **Platform Super Admin** | Everything **including** `administration.tenants.*`, cross-tenant. Isolated from company roles; never assignable via the normal company Master Access Control UI (managed only in the Console). |

### 3.3 Effective permission resolution (deny-by-default)

```
effective(user, permission) =
  DENY  if user.locked or not user.approved
  DENY  unless user's org matches record's org (tenant isolation, RLS)
  ALLOW if any active grant to (user's role templates ∪ user's direct grants)
        matches permission (with wildcard), AND
        the grant's location scope covers the record's scope, AND
        (field-level: view_financial required for financial columns), AND
        not overridden by an explicit DENY grant
  else DENY
```

Grants resolve at three layers, most-specific wins, **DENY beats ALLOW**:
platform defaults (template seed) → tenant role-template overrides → per-user
overrides → active delegations.

---

## 4. Location scope model

### 4.1 Hierarchy (new `locations` tree, additive)

`company → country → region → branch → project → site → workshop → department → team`

- New table **`locations`** `(id, org_id, parent_id, type CHECK(company|country|region|
  branch|project|site|workshop|department|team), code, name, active)` — a
  self-referencing tree, org-scoped, RLS-isolated. `sites` (V109) becomes a
  projection/seed into `locations` of type `site`/`workshop`/`branch`/etc. (its
  `site_type` maps directly).
- **`user_locations`** `(user_id, location_id, is_manager bool, is_approver bool,
  effective_from, effective_to)` — the users→**multiple** locations junction with
  per-location manager/approver flags and effective dates. Replaces the single
  `profiles.site`/`region` for scoping (those stay as legacy display until migration
  completes).
- A grant carries a **scope**: `{ mode: 'company'|'assigned'|'own_records'|'specific',
  location_ids?: uuid[] }`. "assigned" = the union of the user's `user_locations`
  subtree; "own_records" = rows the user created/owns.

### 4.2 Record-level + field-level restrictions

- **Record-level:** every business table already carries `organisation_id`; we add
  `location_id` (nullable, additive) so RLS can filter `location_id IN
  (user's assigned subtree)` for roles whose grant scope is `assigned`. Enforced in
  RLS + in SECURITY DEFINER read RPCs — never client-only.
- **Field-level:** financial/sensitive columns (`cost`, `unit_price`, `salary`,
  `commercial_rate`, `management_comment`, …) are exposed only through
  scope-checked views / RPCs that null those columns unless the caller holds the
  resource's `view_financial`. A `sensitive_fields` registry maps
  `resource → [columns]`.

### 4.3 Scope-based approver resolution (extends V117)

The engine already resolves the next approver by **org + role** and never by name.
We extend the step schema and resolver so the person is chosen by the **record's
scope**:

- Step gains optional `scope_selector` (e.g. `approver_role: 'inspector',
  scope: 'record_site'` → "the Inspector assigned as approver at this record's site").
- New resolver `resolve_step_approvers(step, instance_context)` returns the set of
  `user_id`s whose `user_locations` (with `is_approver`) cover the record's
  `location_id`/country/site/department from `context`. Falls back to
  `notify_role_in_org` when no location-specific approver exists.
- `workflow_act` authorisation is widened: caller passes if they are admin, the
  step's specific user, **or** a member of the resolved scoped-approver set.

---

## 5. Delegation

New **`approval_delegations`** `(id, org_id, delegator_id, delegate_id,
scope_permission text|null, location_id null, starts_at, expires_at, reason,
created_by, created_at, revoked_at)`:

- During `[starts_at, expires_at]` the delegate inherits the delegator's approval
  authority (optionally narrowed to a permission/location).
- Resolution: `resolve_step_approvers` and `effective()` include active,
  non-revoked, non-expired delegations. Expiry is evaluated **server-side** at act
  time (never trust a cached client).
- **Fully audited:** create/revoke/auto-expire each write an immutable
  `access_audit` row; a delegated approval's `workflow_step_events` row records both
  the delegate (`actor_id`) and the delegator (`on_behalf_of`).

---

## 6. Security model

- **Deny-by-default.** Empty grants = no access. Remove the `ROLE_DEFAULTS`
  fail-open fallback (migrate defaults into seeded template grants first, then flip
  `hasPermission`/`can()` to deny when unresolved). `featureFlags` unknown-key
  fail-open is out of scope but noted for a follow-up.
- **Backend + RLS enforcement, not hidden buttons.** Every `can()` in the UI has a
  matching RLS policy and/or SECURITY DEFINER RPC check. UI gating is convenience
  only. Direct URL / API / export / shared-link paths all hit the same RLS.
- **Tenant isolation.** Keep org RLS (`app_current_org`, V65/V70). A tenant admin
  can never resolve another tenant's users, locations, or grants.
- **Super-admin isolation.** Platform Super Admin stays in the isolated Console
  (`ConsoleAuthContext`); the company Master Access Control UI can neither grant nor
  display `administration.tenants.*` nor the super-admin flag.
- **Last-admin protection.** A DB trigger/RPC forbids removing the final active
  `administration.roles.configure` holder in an org, and forbids an admin removing
  their own last admin grant, without naming a replacement.
- **Sensitive-change confirmation.** Granting `*.view_financial`,
  `settings.access.configure`, `administration.*`, or cross-scope approve requires a
  typed reason and (configurable) a second approver; recorded in `access_audit`.
- **Immutable audit.** New append-only **`access_audit`** `(actor, action,
  target_user, permission/scope, old_value, new_value, reason, ip, device, at)` —
  no UPDATE/DELETE grants; only INSERT + SELECT. Mirrors `workflow_step_events`.

---

## 7. Mapping (existing rule → target)  — **nothing removed until confirmed**

| # | Existing rule / artifact | Target | Disposition |
|---|---|---|---|
| M1 | `module_permissions.(role,module_key,enabled).view` (global rows) | `role_template_grants` with `<module>.<resource>.view` | **Merge** (migrate rows) |
| M2 | `AuthContext.ROLE_DEFAULTS` | Seed grants for the 11 role templates | **Merge**, then **Remove** fallback (after seed verified) |
| M3 | `permissionMatrix.ROLE_VIEW_DEFAULTS` (+ mirror test) | Same seed as M2 | **Merge → Remove** duplicate |
| M4 | `app_settings.permission_overrides` (stored create/edit/delete/export/approve, unenforced) | Real per-role/per-user grants (now enforced) | **Merge** (import as grants), then **Remove** key |
| M5 | Page **A** `PermissionMatrix.jsx` | Master Access Control → Permission Matrix tab | **Merge → Remove page** (Phase F) |
| M6 | Component **B** `AccessControlMatrix.jsx` (User Mgmt tab) | Same tab as M5 | **Merge → Remove component** (Phase F) |
| M7 | Console **C** `ConsolePermissions.jsx` (per-org direct upsert) | Console reads new engine (per-tenant template overrides) via RPC | **Conflict** — must reconcile per-org rows vs global before retiring raw upsert. **Uncertain: are any live per-org `module_permissions` rows in production?** → confirm before migrating. |
| M8 | Static **D** `UserManagement.PERMISSION_MATRIX` (Full/Read/Write/Checklist) | Effective-Permission Preview (computed, not authored) | **Remove** (replace with computed view) |
| M9 | `set_module_permissions` RPC (V64) | Superseded by `set_role_grants` / `set_user_grants` RPCs | **Preserve** during migration (dual-write), **Remove** after cutover |
| M10 | `profiles.site` / `region` (single) | `user_locations` rows (type site/region) | **Merge** (backfill), keep columns as legacy display — **Uncertain: keep or drop columns?** → confirm |
| M11 | `profiles.country[]` array | `user_locations` (type country) + org (tenant) | **Merge**; org stays the tenant boundary |
| M12 | `sites` master (V109) | Seed `locations` (site/workshop/branch/…) | **Preserve** as source; **Merge** into tree |
| M13 | Org isolation RLS (V43/V65/V70) + country RLS (V110–V115) | Kept as-is; location RLS layered additively | **Preserve** |
| M14 | Workflow step `approver_role`/`approver_user_id` (V116) + `notify_role_in_org` (V117) | Extended with `scope_selector` + `resolve_step_approvers` | **Preserve + extend** (additive) |
| M15 | `is_super_admin` / Console auth isolation (V65) | Platform Super Admin template, Console-only | **Preserve** |
| M16 | Role enum CHECK on `profiles.role` (V107) | Keep as coarse role tag; fine access via templates/grants | **Preserve** (templates map onto it) |
| M17 | Feature flags (`featureFlags.js`) | Orthogonal capability gate (kept; runs *before* permission checks) | **Preserve** |
| M18 | `ProtectedRoute` locked/approved gates | Kept; deny-by-default `can()` added on top | **Preserve** |
| M19 | Channel (web/mobile/PWA) separation | Optional `channel` qualifier on grants | **Uncertain** — confirm whether per-channel differences are actually required now |

---

## 8. Phased implementation plan

All DB work is **additive first**; nothing existing is dropped until the new engine
is verified live and behind the `automation_platform`-style gate.

### Phase A — Additive DB foundation (new migrations, no drops)
- `Vxxx_access_registry`: `permission_registry` (module/resource/action + applicable
  actions), `role_templates`, `role_template_versions`, `role_template_grants`,
  `user_grants`, `user_role_assignments`.
- `Vxxx_locations`: `locations` tree, `user_locations`, additive nullable
  `location_id` on business tables; seed `locations` from `sites` (V109).
- `Vxxx_delegation_audit`: `approval_delegations`, append-only `access_audit`
  (INSERT/SELECT grants only), `sensitive_fields` registry.
- `Vxxx_rpcs`: `can(user, perm, ctx)`, `effective_permissions(user)`,
  `set_role_grants`, `set_user_grants`, `resolve_step_approvers`,
  last-admin trigger, sensitive-change guard. All SECURITY DEFINER, deny-by-default,
  org-scoped, super-admin-aware.
- **Backfill (idempotent):** import `module_permissions.view` → grants;
  `permission_overrides` → grants; `ROLE_DEFAULTS` → template seeds;
  `profiles.site/region/country` → `user_locations`.
- Verify each migration live via Supabase MCP (prereqs + smoke test + `get_advisors`
  security = 0 errors). **Dual-write:** keep `set_module_permissions` working.

### Phase B — Centralized core + guards (`src/lib/permissions/`)
- `registry.js` (single source: modules/resources/actions/templates — replaces
  `moduleCatalog`, the console/UM copies, the capability list).
- `can.js` (`can(perm, ctx)`), `useCan()` hook, `<Can perm ctx>` component,
  `<PermRoute perm>` route guard. `AuthContext` loads effective grants once and
  exposes `can`. Keep `hasPermission` as a thin shim → `can('<module>.*.view')`
  during migration.
- Unit tests: deny-by-default, wildcard, DENY-beats-ALLOW, scope, delegation expiry.

### Phase C — Master Access Control UI (one module, 8 tabs, per spec)
1. **Users & Assignments** — company, locations, departments, roles, manager,
   approval authority, status, effective dates.
2. **Role Templates** — create/copy/compare/activate/deactivate/**version**.
3. **Permission Matrix** — searchable, expandable module×resource×action grid, bulk
   select **with sensitive-grant warnings**. (Supersedes A + B.)
4. **Location Scope** — company/country/region/branch/site/workshop/dept/team +
   assigned-assets + own-records config.
5. **Approval Authority** — which processes a role may approve, limits, required
   signatures, replacement approvers, escalation, location scope (wires to V116/V117
   step schema + `resolve_step_approvers`).
6. **Effective Permission Preview** — pick a user → exactly what they can access,
   why, which template supplied it, which restrictions apply. (Supersedes D.)
7. **Access Simulation** — safe "View as User" (no password, no account change).
8. **Audit History** — from `access_audit`, read-only, non-editable/deletable.

### Phase D — Module migration (deny-by-default rollout)
Wire `can()`/`<Can>` into modules in value order, each replacing ad-hoc
`profile.role` checks with `<module>.<resource>.<action>` and adding the RLS/RPC
enforcement. Order: Inspections → Tyres (replacement/scrap/issuance) → Accidents →
Purchasing → Finance/Reports (field-level `view_financial`) → remainder. Approval
steps switch to scoped resolution as each module lands.

### Phase E — Console reconciliation
Point Console C at the new engine (per-tenant template overrides via RPC, not raw
upsert). Reconcile any live per-org `module_permissions` rows (M7) **after
confirmation**.

### Phase F — Safe retirement
Only after Phases A–E verified and security tests green: remove page A, component B,
static table D, the `ROLE_DEFAULTS` fallback, `permission_overrides` key, and
`set_module_permissions` (drop dual-write). Update `App.jsx` route to the new module.

### Migration + rollback plan
- Every migration is additive and reversible; each ships with an explicit rollback
  block (as V116/V117 already do). Backfills are idempotent and **never broaden**
  access (import is exact; anything ambiguous imports as **DENY** and is flagged).
- Cutover behind a per-tenant `master_access_control` flag (same pattern as
  `automation_platform`). Rollback = flip flag off → `can` shim falls back to
  `module_permissions`/`ROLE_DEFAULTS`, old pages still routable until Phase F.
- Snapshot `module_permissions` + `permission_overrides` + `profiles` scope columns
  pre-migration for point-in-time restore.

### Security-test list (must pass before "complete")
Unauthorized access (no grant → 403 at RLS, not just hidden UI); cross-tenant access
(org A cannot read/act on org B via URL/API/export/shared link); cross-site access
(assigned-scope user blocked from other sites); field-level (no `view_financial` →
financial columns null in API/export/report/PDF); role change takes effect live;
expired/revoked delegation denied; inactive/locked/unapproved user denied
everywhere; direct-URL & modified-request bypass blocked; approval-limit enforcement;
last-admin cannot be removed; super-admin isolation (company admin cannot touch
tenants/super flag); sensitive-change requires reason (+2nd approver); every role ×
module × location × approval flow × PWA/mobile screen × shared report covered by an
automated test.

---

## Confirmation needed before any removal (Uncertain items)
- **M7** — Are there live per-org `module_permissions` rows written by Console C in
  production? (Determines reconciliation strategy.)
- **M10** — Keep `profiles.site/region` columns as legacy display, or drop after
  `user_locations` backfill?
- **M19** — Are per-channel (web / mobile / Tyre Man PWA) permission *differences*
  actually required now, or is a single permission set per user sufficient for v1?
