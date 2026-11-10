# 07 - Master Access Control

| Field | Value |
|---|---|
| Deliverable | 7 of 29 |
| Date | 2026-11-10 |
| Status | Partly built. RBAC (role x module matrix + per-user grants/revokes) and ABAC (org, country, site) are built and enforced in the database. One consolidated Access Control area exists in the super-admin console. Capability enforcement (create/edit/delete/approve) covers 45 tables, not all. Sub-module keys and region/department/team scopes are stored or absent, not enforced. |
| Evidence | Code read: `src/lib/accessResolver.js`, `src/lib/permissionMatrix.js`, `src/lib/navAccess.js`, `src/lib/scopeSentinel.js`, `src/lib/mobileModules.js`, `mobile/lib/permissions.ts`, `tyre_pulse_flutter/lib/core/auth/access_permissions_repository.dart`, `tyre_pulse_flutter/lib/core/permissions/module_registry.dart`, `src/console/pages/ConsoleAccessControl.jsx`, `src/console/pages/access/*`, `src/components/ProtectedRoute.jsx`, `src/App.jsx`. Live read-only catalog and row counts on 2026-11-10. History of fixes from PROJECT_MEMORY.md. |
| Related docs | [06 Hierarchy](06-organization-hierarchy-model.md), [08 Approvals](08-country-site-approval-matrix.md), [09 Console](09-admin-console-structure.md), [18 Tenant Isolation](18-tenant-isolation-review.md) |

## 1. One access area (spec: consolidate the two Access Matrix pages)

Done. `/master-access-control`, `/permission-matrix` and `/security-center` all redirect into
`/console/access` (`src/App.jsx`, `<Navigate>` routes). The console is super-admin only. The access page is
`src/console/pages/ConsoleAccessControl.jsx` with these tabs (verified in code):

| Tab key | Purpose | Component |
|---|---|---|
| roles | Role x module matrix | `access/RoleMatrix.jsx`, `AccessManager.jsx` |
| web | Web access per role/user, Web / Mobile / Both scope | `AccessManager.jsx` |
| mobile | Phone modules using the real mobile keys | `MobileAccessPanel.jsx`, `MobileAccessTab.jsx` |
| people | Per-user grants and revokes | `PeopleGrants.jsx`, `UserDirectory.jsx` |
| custom | Custom roles (create, clone) | `CustomRolesQuick.jsx` |
| reviews | Access review campaigns | `ConsoleAccessReviews.jsx` |
| temporary | JIT elevation | `ConsoleJitElevation.jsx` |
| approvals | Dual-control queue | `ConsoleApprovals.jsx` |
| policies | IP allowlist, per-org SSO-required | `ConsoleAccessPolicies.jsx` |
| newareas | Modules nobody has been given yet | `NewNotShared.jsx` |
| history | Access change history | `AccessAudit.jsx` |
| check | Effective access of one person | `EffectivePermissions.jsx` |
| who | Who can do this | `WhoCanDoThis.jsx` |
| preview | Preview and override ("view as") | `AccessPreviewOverride.jsx` |
| country | Country scope editor | `CountryScope.jsx` |
| bulk | Bulk role / grant changes | `BulkOperations.jsx` |
| delegation | Approval delegations | `approvalDelegations` service |
| capabilities | Capability catalogue | `permissionMatrix.CAPABILITIES` |
| security | Security center | `SecurityCenter` |

## 2. RBAC as built

### 2.1 Roles

- Built-in roles: Admin, Manager, Director, Inspector, Tyre Man, Reporter, Driver, plus checklist roles.
  `profiles.role` is Title Case and validated by trigger `normalize_profiles_role()` (V282): a built-in role
  or any name in `custom_roles`, otherwise coerced to Reporter.
- Live: 42 distinct roles in `module_permissions`, 32 `custom_roles`, 769 profiles (Driver 674, Tyre Man 17,
  Tyre Data Collector 7, Store Keeper 7, Workshop Supervisor 7, Admin 2, Manager 3 ...). 0 plain Admins:
  both Admins are super admins.
- Custom roles are deny-by-default in the web nav (`navItemAllowedForCustomRole`).

### 2.2 Role x module matrix

- Table `module_permissions(role, module_key, enabled, org_id)`; unique per role/module/org since V239
  (518 duplicate rows were the cause of "access changes revert"). Live: 1,346 rows, 359 of them `mobile:`.
- Read by `get_user_module_permissions`; precedence per key: explicit DB row wins, else `ROLE_DEFAULTS`.
- Writers `set_module_permissions` / `save_access_control_matrix` are super-admin only since V-20260924090000
  (they write the GLOBAL matrix every org reads).

### 2.3 Per-user grants and revokes (V225)

- Table `user_access_grants(user_id, module_key, capability, effect grant|revoke, expires_at, org_id)`.
  Live: 85 rows, 41 revokes, 33 sub-module keys (`parent:child`), 1 `mobile:` row, 0 with expiry.
- Server helpers: `user_has_capability`, `get_my_access_grants`, `app_user_can(module, cap)`.
- Precedence, single source `src/lib/accessResolver.js` `resolveAccess`:
  1. Admin or super admin: allow (break-glass, not revocable here)
  2. explicit revoke: deny
  3. explicit grant: allow
  4. role / matrix allows: allow
  5. otherwise deny
  The legacy copies `resolvePermission` (AuthContext) and `resolveCapability` (permissionMatrix.js) are
  parity-tested against it and are still called; migration of call sites to the single resolver is open.
- Exception recorded 2026-07-17: a per-user Deny applies to admins on mobile.

### 2.4 Capabilities and where the database enforces them

`src/lib/permissionMatrix.js CAPABILITIES`:

| Capability | Enforcement point | Coverage |
|---|---|---|
| view | Route + nav (`ModuleRoute`, `RoleRoute`, `hasPermission`) and table RLS | Every module key |
| create / edit | Permissive policies using `app_user_can(module, cap)` (V238, V241, later) | 45 tables live (core ops tables + 28 accident case tables + AI tyre inspection + stock entry + repair requests + material issues) |
| delete | Reserved for Admin / super; `app_user_can` returns false for delete for everyone else | All tables with delete policies |
| export | App only (`guardExport` / `canExport` in `exportUtils.js`), every refusal audited | Browser is not a boundary; RLS is the read boundary |
| approve | DB: `app_cap_revoked(module,'approve')` guard in inspection, checklist, work order / tyre change execution and accident closure writers (V-20261025153000); grant admits to first approval rung | Those writers only |

Spec permissions not modelled: assign, return, cancel, close, reopen, sign, upload, download, print,
configure, publish, share, view financial, view confidential, use AI, run automation, manage integrations.
The spec format `module.resource.action` is not used; keys are `module` or `parent:child`.

### 2.5 Sub-modules

`SUBMODULES` / `FULL_REGISTRY` in `src/lib/moduleCatalog.js` produce composite keys. They are STORED (33 live
grant rows) but no route or policy reads them. The UI labels this honestly.

## 3. ABAC as built

| Attribute | Column | Policy family | Notes |
|---|---|---|---|
| Company | `organisation_id` / `profiles.org_id` | RESTRICTIVE `*_org_isolation`, 254 tables | Only `is_super_admin()` crosses (V306, V314). |
| Country | `country` / `profiles.country text[]` | RESTRICTIVE `*_country_isolation`, 213 tables | V226 added; V396 rewrote 74 policies to InitPlan readers (85x faster, equivalence proven); V498 removed plain-Admin bypass; V578 added FOR ALL write checks. |
| Site | `site` / `profiles.sites text[]` | RESTRICTIVE `*_site_isolation` SELECT, 62 tables | V269; blank = no access, `'ALL'` / `'*'` = org-wide (V309). Live: 0 users narrowed to specific sites, so site isolation is untested by real use. |
| Region / branch / dept / team / asset / record / field | - | none | Not built. |

Writes: V542 added FOR ALL policies with both USING and WITH CHECK copied from each table's own expression on
78 country + 55 site tables (a KSA-only Manager could previously insert a UAE row).

SECURITY DEFINER functions bypass RLS (the owner role holds BYPASSRLS; V580 proved FORCE RLS is a no-op here).
V545 to V576 added explicit org/country/site re-checks to several hundred definer functions. Rule: every new
definer function must re-check org, country and site itself. See doc 17.

## 4. Mobile and Flutter

- Expo (`mobile/lib/permissions.ts`, MODULES registry) is retired for builds but its registry is the
  reference; web mirror `src/lib/mobileModules.js` is drift-tested by parsing the TS file.
- Phone grants are namespaced `mobile:<mobileKey>` in both `module_permissions` and `user_access_grants`,
  so web and phone access are independent. Use the Mobile App panel (real keys), not the web tree's scope
  control, to close a phone module.
- Flutter loads `get_my_access_grants` + `get_user_module_permissions` at sign-in and on resume (max once a
  minute) via `access_permissions_repository.dart`; `webModuleKeyAliases` in `module_registry.dart` maps web
  keys to phone keys. No realtime refresh. Code only until a Flutter build ships (owner controls builds).

## 5. Spec features: status

| Feature | Status | Where |
|---|---|---|
| Role templates / custom roles / cloning | Built | `custom_roles`, `admin_clone_role` (V230) |
| Role comparison | Partly | Role matrix shows side by side; no diff view |
| Permission preview / effective access | Built | `admin_get_effective_access`, Check a person tab |
| View as user | Partly | Preview and override shows the resolved matrix, not a full UI impersonation |
| Temporary access / expiry | Built | JIT elevation: `jit_elevation_requests`, 5 to 480 min, one capability, reason, cron `jit-elevation-expiry` every 5 min (live). 0 requests ever. |
| Emergency access | Built | Break-glass notifications on console login and risky actions (V-20260924091000) |
| Access request and approval | Built | `/request-access` page + `request_elevation` |
| Access-change audit | Built | `access_audit` (V228), 4,300 rows live, super-admin read only |
| Access reviews | Built, unused | `access_review_campaigns` 0 live |
| Last company admin protection | Built | `guard_last_admin` (V308) + bulk role guard |
| Tenant admin cannot reach platform functions | Built | Console gate requires `is_super_admin`; V307 blocks self-escalation |
| Deny by default | Built | resolver step 5, custom roles deny |
| Direct URL bypass | Built | 20 unguarded routes fixed; `navRouteAccessParity.test.js` pins nav = route |
| Unauthorized exports | Partly | App-level only; RLS limits data read |
| Unauthorized shared links | Built | Share tokens resolved by DEFINER RPCs that derive org from the token row |

## 6. Gaps ranked

1. Capability enforcement covers 45 of 479 tables. Create/edit grants on other modules are UI-only.
2. Sub-module keys stored, not enforced.
3. Spec action vocabulary (approve/reject/return/sign/financial view...) mostly absent.
4. No region/department/team/asset/field-level scope.
5. Three resolver copies remain (parity-tested, but drift risk).
6. `profiles` is readable by every active member of the org (`profiles_select` = authenticated), including
   `push_token` (memory open item 2026-09-30). Directory-style read is needed, but a column-limited view
   would reduce exposure.
7. A live `anum_integration` reader layer (RESTRICTIVE `anum_reader_*` policies on 447 tables, 1 reader row)
   exists with no repository migration and no PROJECT_MEMORY entry. See doc 17.

## 7. Recommended target

- Adopt `module.resource.action` keys as an alias layer over current keys (no rename of stored rows).
- Generate capability policies from a registry (`capability_table_map`) so coverage is declared, testable and
  extendable table by table, instead of hand-written per migration.
- Route every client check through `resolveAccess`; delete the two legacy copies.
- Add field-level masking for financial columns via column-limited views (cost fields are the main ask).

## Open decisions for the owner

- Which spec actions matter first (likely approve, export, view financial)?
- Should export become a server-enforced capability (signed export through an RPC) rather than app-level?
- Confirm the purpose and owner of the `anum_integration` reader layer and bring it under migration control.
- Restrict `profiles` reads to a directory view without `push_token`?

## Next actions

1. Phase 1, S: commit a migration file documenting `anum_integration` as it exists live.
2. Phase 2, M: migrate all client call sites to `accessResolver.resolveAccess`; remove duplicates.
3. Phase 2, M: profiles directory view; revoke direct column access to `push_token` for non-self.
4. Phase 3, L: capability registry + generated policies; extend to purchase, warranty, gate pass, PM tables.
5. Phase 3, M: approve/export/view-financial as first-class capabilities with RLS or RPC enforcement.
