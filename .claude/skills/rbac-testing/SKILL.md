---
name: rbac-testing
description: Build and verify the Tyre Pulse role/permission matrix across web nav, routes, mobile modules, Flutter modules, RPCs and Supabase RLS. Use for "who can see X", "role can't access", "check permissions", "RBAC audit", "access control", or after adding a module, role or grant.
---

# RBAC testing

## The permission model (layers, in the order they decide)
1. **Super admin** (`profiles.is_super_admin`) and **Admin** role: allowed everywhere in the app layer.
2. **Per-user grants** `user_access_grants` (grant/revoke, expiring, JIT elevation). Revoke wins.
   Web keys are plain module keys; mobile keys are prefixed `mobile:` (surface partitioned).
3. **Role matrix** `module_permissions` (role x module_key, global rows `org_id is null`), Title Case role names
   exactly as in `profiles.role`.
4. **Role defaults**: web `ROLE_DEFAULTS` (src), mobile `MODULES` in `mobile/lib/permissions.ts` (web mirror
   `src/lib/mobileModules.js` - drift test exists), Flutter `module_registry.dart` + `webModuleKeyAliases`.
   Custom roles are deny-by-default.
5. **Server**: `app_user_can(module, cap)` in RLS write policies, `app_is_elevated()` (= admin/manager/director -
   a Manager passes it), role literals in older policies, DEFINER RPC in-body checks, country/site scope
   (`profiles.country[]`, `profiles.sites[]`, `'ALL'` sentinel; blank = no access since V309).
Capabilities: view, create, edit, delete (always false for non-admin in `app_user_can`), approve, export.

## Steps
1. **Detect roles**: `select role, count(*) from profiles group by 1;` plus `custom_roles`. List built-ins from code.
2. **Build the matrix** (roles x modules x capabilities) from `module_permissions` + defaults. Keep it as a table
   in the report; mark each cell with its source layer.
3. **For each role, verify on every layer**:
   - Web: sidebar item visible? (`shouldShowNavItem`), route renders or Access Denied (`RoleRoute`, `ModuleRoute`)?
     `src/test/navRouteAccessParity.test.js` must pass - nav and route must agree.
   - Command palette shows the same set as the sidebar.
   - Mobile/Flutter: tile visible, tab visible, screen guard (`useModuleGuard` / Flutter router) agrees.
   - API/DB: impersonate a real user of that role (rolled back) and run the read and each write the capability
     implies. Record allowed/refused as the database decides.
4. **Record-level checks**: own records vs other users' records (e.g. `tech_activity_events` own-visibility,
   `user_signatures` own-only), other country, other site, other organisation (must be 0 rows and writes refused).
5. **Escalation checks**: a non-super Admin cannot set `is_super_admin`, move a user's org, or edit another org
   (V307); last admin cannot be demoted (V308); a role change reaches an open session via realtime without
   re-login; a revoked grant removes access.
6. **Admin actions**: console RPCs refuse non-super-admins with 42501.

## Rules
- A hidden menu item is never sufficient authorization. Each FAIL where the UI hides but the API allows is at
  least HIGH.
- Test the negative as carefully as the positive: a refused write returns 0 rows silently under RLS - count
  rows actually written (`with u as (update ... returning 1) select count(*) from u`).
- Use one impersonated user per transaction; always roll back.

## Pass / fail
PASS: matrix produced, every role checked on UI + API/DB, no case where the server allows what the role must not
do, and no case where the UI offers an action the server refuses (dead button).
