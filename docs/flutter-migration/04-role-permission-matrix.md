# 04. Role and permission matrix

Artifact 4 of the nine required by section 75 of the Flutter migration spec.

Spec section 9 says "port the effective permission logic from the React
application" and gives a three-term formula. There is no single React
implementation to port. There are THREE resolvers - one on the phone, one on the
web, one in Postgres - and they do not agree with each other or with the spec.
This file establishes which one is authoritative and what Flutter must build.

## Confidence key

| Mark | Meaning |
|---|---|
| VERIFIED | Read directly from source in this repo (mobile source, web source, or a MIGRATIONS_V*.sql) |
| RECORDED | A measured live figure quoted from PROJECT_MEMORY |
| UNVERIFIED | Needs a live database check. The Supabase connector was disconnected when this was written |

Everything below is VERIFIED unless marked otherwise.

---

## 1. The effective-access formula

### 1.1 What the spec says

Spec section 9:

```text
effective access = role default + user grants - user revocations
```

That formula is incomplete in three ways and wrong in one. It omits the
admin break-glass, it omits a fourth input (the role-level mobile matrix), and
it does not say what happens when the permission data fails to load. Build from
the code below, not from the formula above.

### 1.2 The three implementations, as they actually are

**A. Mobile, the production phone app.** `resolveModuleAccess`, in
`mobile/lib/permissions.ts`. Five terms, highest first:

| Order | Term | Result | Source |
|---|---|---|---|
| 1 | `isSuper` (from `profiles.is_super_admin`) | ALLOW | argument |
| 2 | per-user override `revoke` | DENY | `mobile:` rows in `user_access_grants` |
| 3 | per-user override `grant` | ALLOW | same |
| 4 | `isAdmin(role)`, i.e. the normalised token is exactly `admin` | ALLOW | `mobile/lib/types.ts` |
| 5a | role matrix explicit `true` / `false` | ALLOW / DENY | `mobile:` rows in `module_permissions` |
| 5b | otherwise: `moduleAllowedByRole` | the module's own `roles` list | `mobile/lib/permissions.ts` |

**B. Mobile route guard.** `resolveGuardedAccess`, same file, consumed by
`mobile/components/ModuleGuard.tsx`. Identical to A except that when
`permissionsError` is true AND the key is in `SENSITIVE_MODULES`
(`admin`, `users`, `approvals`) AND the role is not `admin`, the ONLY passing
signal is an explicit per-user `grant`. Role default and role matrix are
deliberately ignored there.

**C. Web.** `resolveAccess`, in `src/lib/accessResolver.js`, routed to by
`resolvePermission` in `src/contexts/AuthContext.jsx`:

```text
1. role === 'Admin' OR isSuperAdmin  -> ALLOW   (reason 'admin')
2. revoke                            -> DENY
3. grant                             -> ALLOW
4. roleAllows                        -> ALLOW
5. otherwise                         -> DENY
```

**D. Server.** `app_user_can(p_key, p_cap)`, `MIGRATIONS_V229_CAPABILITY_ENFORCEMENT.sql`:

```text
auth.uid() IS NULL                       -> false
is_super_admin OR profiles.role='Admin'  -> true
role default (see section 4)             -> v_default
active revoke for (user,key,cap)         -> false
v_default true                           -> true
active grant for (user,key,cap)          -> true
otherwise                                -> false
```

### 1.3 The divergences, named

**D1. A per-user revoke beats the `admin` ROLE on the phone and nowhere else.**
On mobile, term 2 fires before term 4, so a `mobile:admin` revoke row denies a
user whose role is `Admin`. On the web and in `app_user_can` the admin test is
first, so the same row is inert. The mobile source states this is deliberate
("user ask: admins were un-revokable"). A super-admin is unrevokable on all
three. Flutter MUST pick one and say which; if it copies the mobile ordering it
inherits a client-side denial the server will not honour, which means an admin
sees no button and the API still accepts the write.

**D2. The role matrix is a fourth input the spec does not mention.** Mobile
term 5a reads `module_permissions` rows whose `module_key` carries the `mobile:`
prefix, via the `get_user_module_permissions` RPC, filtered by
`mobileRoleMatrixFromRaw`. An ABSENT key means "no mobile override" and falls
through to the client role default; only an explicit boolean decides. The web
has the same layer under bare keys (`AuthContext.jsx` line 484: a key PRESENT in
`modulePerms` wins, a key ABSENT falls back to `ROLE_DEFAULTS`).

**D3. Mobile fails OPEN for ordinary modules and CLOSED for three.** When the
grants or matrix RPC throws, `permissionsError` is set and the maps are empty;
for a non-sensitive module the empty maps fall through to the client role default,
which is permissive by design so a transient RPC failure never strands a field
worker mid-shift. The web has no equivalent split. Flutter must reproduce both
halves or state that it does not.

### 1.4 What Flutter must implement

One pure function, mobile ordering, with the three divergences resolved
explicitly:

```text
resolve(key, role, isSuper, grants, roleMatrix, permissionsError):
  if isSuper                                        -> ALLOW
  if grants[key] == revoke                          -> DENY
  if grants[key] == grant                           -> ALLOW
  if permissionsError and key in SENSITIVE and role != admin -> DENY
  if role == admin                                  -> ALLOW
  if roleMatrix[key] is true                        -> ALLOW
  if roleMatrix[key] is false                       -> DENY
  return MODULES[key].roles.contains(role)
```

`SENSITIVE = {admin, users, approvals}`. This is UI reach only. The data
boundary is RLS (section 5).

---

## 2. Role catalogue

### 2.1 Two vocabularies, two silent coercions

`profiles.role` is plain `text` and stores **Title Case**. There is no CHECK
constraint - `MIGRATIONS_V282_ALLOW_CUSTOM_ROLES.sql` dropped
`profiles_role_check` because a static CHECK cannot reference `custom_roles`.
Validation is a BEFORE trigger instead.

**Server coercion.** `normalize_profiles_role()` (V282, made SECURITY DEFINER by
`MIGRATIONS_V285_NORMALIZE_ROLE_DEFINER.sql`) accepts a name only if it is in
the built-in allowlist OR exists in `public.custom_roles`. Anything else is
rewritten to `'Reporter'` and the UPDATE still reports success. V282's own
header records the symptom: "I add new roles, assign to them, it's still same".

**Client coercion.** `normaliseRole()` in `mobile/lib/types.ts` lowercases and
underscores, then checks a 15-token allowlist. An unlisted role becomes
`'reporter'`. The source names the casualty: "Tyre Data Collector ended up with
a reporter's permissions on the phone while the server correctly saw
tyre_data_collector".

So a role name can be silently downgraded twice, on two different machines, to
the same fallback. Flutter must make an unknown role a LOGGED, VISIBLE state,
not a silent Reporter.

### 2.2 The catalogue

Built-in names come from the allowlist inside `normalize_profiles_role()`
(V282/V285). Mobile tokens come from the `UserRole` union and `normaliseRole`
allowlist in `mobile/lib/types.ts`.

| DB value (Title Case) | Mobile token | Built-in or custom | Known to the phone? |
|---|---|---|---|
| `Admin` | `admin` | built-in | yes |
| `Manager` | `manager` | built-in | yes |
| `Director` | `director` | built-in | yes |
| `Inspector` | `inspector` | built-in | yes |
| `Tyre Man` | `tyre_man` | built-in | yes |
| `Reporter` | `reporter` | built-in | yes |
| `Driver` | `driver` | built-in | yes |
| `Integration Admin` | (none) | built-in | NO - coerced to `reporter` |
| `Data Engineer` | (none) | built-in | NO - coerced to `reporter` |
| `Automation` | (none) | built-in | NO - coerced to `reporter` |
| `Mechanic` | `mechanic` | custom, seeded by `MIGRATIONS_V591_CHECKLIST_ROLE_TARGETING.sql` | yes |
| `Electrician` | `electrician` | custom, seeded by V591 | yes |
| `Maintenance Supervisor` | `maintenance_supervisor` | custom, seeded by `MIGRATIONS_V592_ASSIGNABLE_ROLES.sql` | yes |
| `Workshop Supervisor` | `workshop_supervisor` | custom, seeded by `MIGRATIONS_V599_WORKSHOP_SUPERVISOR.sql` | yes |
| `Tyre Data Collector` | `tyre_data_collector` | custom, seed migration not found in repo | yes |
| `PMV Manager` | `pmv_manager` | custom, seed migration not found in repo | yes |
| `Workshop Area Manager` | `workshop_area_manager` | custom, seed migration not found in repo | yes |
| `Workshop Maintenance Area Manager` | `workshop_maintenance_area_manager` | custom, seed migration not found in repo | yes |
| `Data Monitor Officer` | (none) | custom, seeded by V592 | NO - coerced to `reporter` |
| `Store Keeper` | (none) | custom, seeded by V592 | NO - coerced to `reporter` |
| `Fleet Supervisor` | (none) | custom, named in V282 and in `checklist_is_supervisor` before V600 | NO - coerced to `reporter` |
| `Insurance Officer` | (none) | custom, named in V282 verification | NO - coerced to `reporter` |

**15 mobile tokens. 10 DB built-ins. 12 or more custom names.**

RECORDED, from PROJECT_MEMORY, measured live 2026-08-18: `profiles.role` held
`Admin` 2, `Director` 1, `Inspector` 2, `Manager` 2, `PMV Manager` 1,
`Reporter` 2, `Tire Planning Engineer` 1, `Tyre Data Collector` 9, `Tyre Man` 17,
`Workshop Maintenance Area Manager` 1. Note `Tire Planning Engineer` - a real
assigned role that appears in NO module list and in NO mobile allowlist, so that
person is a `reporter` on the phone.

**UNVERIFIED - run this before Flutter hard-codes any role list:**

```sql
select name, active, organisation_id from public.custom_roles order by name;
select role, count(*) from public.profiles group by role order by 2 desc;
```

### 2.3 Making a custom role assignable

Three things must all be true, and V592 records what happens when they are not
("three roles the web offers could never be saved"):

1. A row in `public.custom_roles` (org-scoped RESTRICTIVE RLS; INSERT requires
   `get_my_role() = 'Admin'`, `MIGRATIONS_V211_CUSTOM_ROLES.sql`). Without it
   the normalize trigger rewrites the save to Reporter.
2. The token added to the mobile `UserRole` union AND the `normaliseRole`
   allowlist. Adding it makes the role deny-by-default on every module, so it
   must also be listed on the modules that role needs - `mobile/lib/permissions.ts`
   states this explicitly: adding a role to `UserRole` "would have TAKEN AWAY
   access two real people are using today".
3. `organisation_id` set explicitly on the `custom_roles` insert. Its default is
   `app_current_org()`, which is NULL outside a user session, and a null-org row
   is invisible.

### 2.4 The mobile admin console can assign only five roles

`ROLE_DB_LABELS` in `mobile/app/(app)/admin/users.tsx` maps exactly
`admin, manager, director, inspector, tyre_man` to their Title Case DB values.
The `set_role` action of `admin_mobile_user_action`
(`MIGRATIONS_V319_MOBILE_ADMIN_USER_RPC.sql`) accepts any built-in or custom
name, so the server is not the limit - the picker is. A mobile admin today
cannot assign `Driver`, `Mechanic`, `Electrician`, `Tyre Data Collector`, or any
of the five supervisory roles, which are precisely the roles the module registry
and the approval ladder depend on.

---

## 3. The module x role matrix

31 modules, from `MODULES` in `mobile/lib/permissions.ts`. `roles` is the
DEFAULT list; `admin` is never listed because `moduleAllowedByRole` admits it
unconditionally. "Mirror agrees" compares against `MOBILE_MODULES` in
`src/lib/mobileModules.js`, key by key, role set by role set.

| Key | Label | Group | Default roles | Mirror agrees |
|---|---|---|---|---|
| `inspect` | New Inspection | Field | manager, director, inspector, tyre_man | yes |
| `scan` | Scan | Field | manager, director, inspector, tyre_man, mechanic, electrician | yes |
| `serial` | Serial Search | Field | manager, director, inspector, tyre_man, tyre_data_collector, reporter, driver, mechanic, electrician, maintenance_supervisor, workshop_supervisor, pmv_manager, workshop_area_manager, workshop_maintenance_area_manager | yes |
| `tyreChange` | Tyre Change | Field | manager, director, inspector | yes |
| `checklists` | Checklists | Field | manager, director, inspector, tyre_man, mechanic, electrician, driver, maintenance_supervisor, workshop_supervisor, pmv_manager, workshop_area_manager, workshop_maintenance_area_manager | yes |
| `meter` | Meter Log | Field | manager, director, inspector, tyre_man, reporter, driver, mechanic, electrician, maintenance_supervisor, workshop_supervisor, pmv_manager, workshop_area_manager, workshop_maintenance_area_manager | yes |
| `washing` | Vehicle Washing | Field | manager, director, inspector, driver, tyre_man | yes |
| `reportIssue` | Report Issue | Field | manager, director, reporter, driver, mechanic, electrician, maintenance_supervisor, workshop_supervisor, pmv_manager, workshop_area_manager, workshop_maintenance_area_manager | yes |
| `repairRequest` | Repair Request | Field | manager, director, inspector, tyre_man, reporter, driver, mechanic, electrician | yes |
| `records` | Tyre Records | Fleet | (none - admin only) | yes |
| `vehicles` | Vehicles | Fleet | manager, director, inspector, tyre_man, reporter, driver, mechanic, electrician, maintenance_supervisor, workshop_supervisor, pmv_manager, workshop_area_manager, workshop_maintenance_area_manager | yes |
| `history` | History | Fleet | (none - admin only) | yes |
| `alerts` | Alerts | Fleet | manager, director, inspector | yes |
| `calendar` | Calendar | Fleet | manager, director, tyre_man, reporter, maintenance_supervisor, workshop_supervisor, pmv_manager, workshop_area_manager, workshop_maintenance_area_manager | yes |
| `accidents` | Accidents | Maintenance | manager, director, inspector | yes |
| `reportAccident` | File Accident | Maintenance | manager, director, inspector | yes |
| `workorders` | Work Orders | Maintenance | (none - admin only) | yes |
| `rca` | Root Cause | Maintenance | manager, director, inspector | yes |
| `tasks` | Tasks | Maintenance | manager, director, inspector | yes |
| `stock` | Stock Count | Maintenance | manager, inspector | yes |
| `pm` | Maintenance Due | Maintenance | manager, director | yes |
| `workshop` | My Jobs | Maintenance | manager, director, inspector, tyre_man, mechanic, electrician | yes |
| `overview` | Overview | Management | (none - admin only) | yes |
| `reports` | Reports | Management | (none - admin only) | yes |
| `analytics` | Analytics | Management | (none - admin only) | yes |
| `stockManage` | Stock Management | Management | (none - admin only) | yes |
| `ai` | Fleet AI | Management | (none - admin only) | yes |
| `team` | Team | Management | (none - admin only) | yes |
| `approvals` | Approvals | Admin | director, maintenance_supervisor, workshop_supervisor, pmv_manager, workshop_area_manager, workshop_maintenance_area_manager, tyre_data_collector | yes |
| `admin` | Admin Console | Admin | (none - admin only) | yes |
| `users` | User Management | Admin | (none - admin only) | yes |

**Zero drifts today.** The two files agree on all 31 keys and all 31 role sets,
checked by re-running the comparison in `src/test/mobileModules.test.js` outside
the test runner.

### 3.1 The eleven `roles: []` modules

`records`, `history`, `workorders`, `overview`, `reports`, `analytics`,
`stockManage`, `ai`, `team`, `admin`, `users`.

`roles: []` does not mean "nobody". It means **admin and super-admin only**,
because `moduleAllowedByRole` returns true for `admin` before it looks at the
list, and a per-user `grant` still opens any of them to one named person.

The registry states the reason for the nine non-admin ones: mobile is a
field-capture app, and these were pulling whole tables onto the handset -
RECORDED, mobile Analytics paged through every `tyre_record`, 7,498 rows and
climbing, which is an out-of-memory crash on a cheap phone. The rule attached to
them is a rule for Flutter too: **do not give a bulk-listing or reporting module
a role default. Add a server-side aggregate, or grant it per user.**

### 3.2 A comment in the registry contradicts the registry

`mobile/lib/permissions.ts` carries a block comment dated 2026-07-18 stating
that "tyre_man also gets `history` ... and `reports`" and that "`inspector`
gains `reports`". Neither is true in the code: both modules carry `roles: []`,
so the only way a tyre man or an inspector reaches History or Reports today is
an explicit per-user grant. The later "MOBILE IS A FIELD-CAPTURE APP" block in
the same file is the one the code implements. **Trust the `M(...)` calls, not
the prose above them.**

### 3.3 Two role sets worth reading twice

Reachable modules by default, computed from the registry:

| Role | Count | Modules |
|---|---|---|
| admin | 31 | all |
| manager | 19 | inspect scan serial tyreChange checklists meter washing reportIssue repairRequest vehicles alerts calendar accidents reportAccident rca tasks stock pm workshop |
| director | 19 | as manager, minus stock, plus approvals |
| inspector | 16 | inspect scan serial tyreChange checklists meter washing repairRequest vehicles alerts accidents reportAccident rca tasks stock workshop |
| tyre_man | 10 | inspect scan serial checklists meter washing repairRequest vehicles calendar workshop |
| driver | 7 | serial checklists meter washing reportIssue repairRequest vehicles |
| mechanic / electrician | 8 | scan serial checklists meter reportIssue repairRequest vehicles workshop |
| maintenance_supervisor, workshop_supervisor, pmv_manager, workshop_area_manager, workshop_maintenance_area_manager | 7 | serial checklists meter reportIssue vehicles calendar approvals |
| reporter | 6 | serial meter reportIssue repairRequest vehicles calendar |
| tyre_data_collector | 2 | serial approvals |

Two of these deserve a decision before Flutter copies them:

- **`tyre_data_collector` gets `approvals` and `serial` and nothing else.** It
  is a signing role on both the checklist supervisor rung (V606) and inspection
  approval (V606), yet by default it cannot open a checklist, run an inspection,
  or see an asset list. RECORDED: nine people hold it, the largest non-Tyre-Man
  population on the system.
- **The five supervisory roles cannot `inspect` and cannot see `accidents`.**
  They approve inspections they have no default route to create.

Neither is a bug this artifact should fix. Both are product questions the
Flutter navigation work will surface immediately.

### 3.4 The mirror contract

`src/lib/mobileModules.js` is a hand-maintained web copy of the phone registry.
It exists because the two apps use DIFFERENT key spaces: the web catalog
(`src/lib/moduleCatalog.js`) says `tyre_records`, the phone says `records`. The
web Access Manager used to write `mobile:<webKey>`, which the phone never reads,
so a deny only landed on the handful of keys that happened to be spelled the
same. RECORDED: a stale `mobile:inspections` row proved it, since the phone's
key is `inspect`.

The contract, from the mirror's own header: **the `key` strings are the match
target and MUST equal the mobile ModuleKey exactly.**

`src/test/mobileModules.test.js` is the drift guard. It reads
`mobile/lib/permissions.ts` as TEXT, parses the `M(...)` calls with a regex, and
fails on any role-set difference. Two properties keep it honest and Flutter must
keep both:

- It asserts the parse found at least 25 modules, so a change to the `M(...)`
  shape cannot make every later assertion vacuously pass.
- Because it parses text, `approvals` lists its roles LITERALLY rather than
  spreading the exported `SUPERVISOR_ROLES` constant. A spread would read as the
  characters `...SUPERVISOR_ROLES` and the guard would compare a role name that
  does not exist. `mobile/__tests__/whoSigns.test.ts` pins that explicitly.
  `SUPERVISOR_ROLES` is therefore exported but referenced only by tests.

**Flutter inherits this problem in a new shape.** A Dart registry plus a JS
mirror plus a TS registry is three copies. Either generate the Dart registry
from one source at build time, or port the text-parsing drift guard into the
Dart test suite. Do not add a third hand-maintained copy.

---

## 4. Capabilities: what is enforced and what is decoration

Six capabilities are declared in `CAPABILITIES`, `src/lib/permissionMatrix.js`,
each with an `enforced` flag. That flag is the file's own claim. Here is what
the migrations actually do.

| Capability | Declared `enforced` | Server truth |
|---|---|---|
| `view` | `true` | **No RLS policy anywhere gates on `app_user_can(key,'view')`.** Grepped every `MIGRATIONS_V*.sql`: zero hits for a `'view'` capability inside a policy. `view` is a CLIENT gate fed by server data. |
| `create` | `false` | Enforced on 11 tables by PERMISSIVE policies (V238 + V241). PERMISSIVE means additive only. |
| `edit` | `false` | Same 11 tables, plus hand-written checks in V382, V608, V609. |
| `delete` | `false` | Same 11 tables. |
| `export` | `false` | No server enforcement anywhere. A client-side download. |
| `approve` | `false` | Enforced only as a NEGATIVE on two tables (V242), plus the real domain gates in 4.3. |

### 4.1 `view` is not a data boundary. Say this out loud in the Flutter code.

Turning a module off for a role writes `module_permissions.enabled = false`, and
that hides the tile and blocks the route. It does **not** stop a PostgREST read
of the underlying table. The row boundary is org + country + site RLS
(section 5), and that boundary does not know what a module is.

The consequence for Flutter: a repository must never treat "the module is
enabled" as authorisation to fetch. If a module is denied, do not call. If a
call is made anyway, RLS decides, and RLS may well return rows.

### 4.2 create / edit / delete: real, but only additive

`MIGRATIONS_V238.sql` (pilot) and `MIGRATIONS_V241.sql` (extension) generate
policies of this shape:

```sql
CREATE POLICY <t>_cap_insert ON public.<t> FOR INSERT TO authenticated
  WITH CHECK (public.app_user_can('<module>','create'));
```

Tables covered, with the module key each maps to:

| Table | Module key | Migration |
|---|---|---|
| `tyre_records` | `tyre_records` | V238 |
| `inspections` | `inspections` | V238 |
| `work_orders` | `work_orders` | V238 |
| `accidents` | `accidents` | V241 |
| `vehicle_fleet` | `fleet_master` | V241 |
| `stock_records` | `stock` | V241 |
| `gate_passes` | `gate_pass` | V241 |
| `budgets` | `budgets` | V241 |
| `corrective_actions` | `corrective_actions` | V241 |
| `alerts` | `alerts` | V241 |
| `rca_records` | `rca` | V241 |

Note the module keys are WEB keys (`tyre_records`, `fleet_master`), not mobile
keys (`records`, `vehicles`), and they carry no `mobile:` prefix. A mobile
per-user grant written as `mobile:records` therefore has NO effect on these
policies. Server capability enforcement and the mobile grant namespace are two
different key spaces that never meet.

**PERMISSIVE is the load-bearing word.** V238's own header: these policies "can
only ADD access to granted/admin users; existing writers are unaffected" and
"NOT yet enforced: revoke of a role-inherent capability (needs a restrictive
policy)". So a revoke of `edit` on a role that already has `edit` through its
normal role policy is a UI gesture and nothing more.

### 4.3 `approve` is enforced by domain functions, not by the capability system

`MIGRATIONS_V242.sql` adds `app_cap_revoked(key, cap)` and a BEFORE UPDATE
trigger on `accidents` and `work_orders` that refuses a `status` change when the
caller is explicitly revoked `approve`. It never grants; nobody is revoked by
default; admin and super are exempt. That is the whole of the generic approve
enforcement.

The approvals that matter are gated by their own SECURITY DEFINER functions with
their own hard-coded role lists.

**Inspection approval.** `decide_inspection_approval(p_inspection_id, p_decision,
p_note, p_signature)`, current body in
`MIGRATIONS_V606_CHECKLIST_DATA_COLLECTOR_APPROVAL.sql`. Allowed:
`Admin`, `PMV Manager`, `Workshop Area Manager`,
`Workshop Maintenance Area Manager`, `Tyre Data Collector`, or super-admin.
Manager and Director are NOT on this list.
`MIGRATIONS_V602_INSPECTION_APPROVAL_REQUIRES_SIGNATURE.sql` makes an unsigned
approval of a still-pending row raise. Mobile calls this RPC
(`mobile/lib/inspectionApprovals.ts` line 132) and never a direct UPDATE.

**Checklist approval ladder** (spec section 31). Two rungs, driven by
`checklist_templates.require_area_manager`:

| Rung | Function | Allowed roles |
|---|---|---|
| Supervisor | `checklist_is_supervisor()` (V600, extended by V606) | Admin, Maintenance Supervisor, Workshop Supervisor, PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager, Tyre Data Collector, super-admin |
| Area manager | `checklist_is_area_manager()` (V594) | Admin, Director, PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager, super-admin |

`checklist_submissions.approval_status` is a 5-value CHECK since V594:
`not_required`, `pending`, `pending_area_manager`, `approved`, `rejected`.

The gate is the BEFORE UPDATE trigger `guard_checklist_approval_stages()`
(V594, extended by V595). Its header states the point: "a client that forgets
the flow cannot skip a stage, and neither can a direct PostgREST call." It
refuses `pending_area_manager` on a single-stage template, refuses `approved`
on a two-stage template whose supervisor signature is blank, requires a name AND
a signature at each rung, stamps `supervisor_by` / `approved_by` from
`auth.uid()` rather than the payload, and (V595) refuses `approved` while any
answer still carries a blocking mark.

`mobile/lib/checklistApproval.ts` mirrors both role lists verbatim in
`APPROVAL_STAGES`. **That is a mirror pair. Change the SQL and the Dart port
together**, exactly as `checklistRoles.ts` says of its own web twin.

**The checklist decision does NOT go through an RPC on mobile.** Artifact 06
establishes that `CHECKLIST_APPROVAL` is a queued blind `update` on
`checklist_submissions` matched by `id`. That write is still fully
server-enforced by the UPDATE policy (`checklist_is_supervisor()`) plus the
stage-gate trigger, so nothing is bypassed - but the refusal arrives after the
phone has queued and accepted the decision, possibly days later. Route Flutter
approvals through `decide_checklist_approval` (V597) while online.

### 4.4 Non-view role defaults come from somewhere unexpected

Inside `app_user_can`, the `view` default reads `module_permissions.enabled` for
global rows (`org_id IS NULL`). Every OTHER capability reads a JSON envelope:
`app_settings` row keyed `permission_overrides`, path
`overrides -> <Role> -> <module_key> -> <cap>`, defaulting to false and
swallowing any parse error. `permissionMatrix.js` writes that envelope as a
sparse diff from defaults. **UNVERIFIED**: whether that row exists and what it
contains.

```sql
select key, left(value, 400) from public.app_settings where key = 'permission_overrides';
```

### 4.5 What a Flutter engineer must not believe

- Do not believe `view` gates data. It gates screens.
- Do not believe a `revoke` removes a capability a role already has. Only a
  RESTRICTIVE policy could, and none exists.
- Do not believe `export` is checked. It is not, anywhere.
- Do not believe the mobile `mobile:` grant namespace reaches `app_user_can`. It
  does not; `app_user_can` matches bare web keys.
- Do believe the domain RPCs. `tyre_scrap_allowed` / `tyre_unscrap_allowed`
  (V382) exist precisely so the client ASKS the server instead of inferring from
  a role string. That is the pattern to copy.

---

## 5. Workspace scope: tenant, org, country, site

Three RESTRICTIVE layers stack on the business tables. RESTRICTIVE means they
AND together with each other and with every permissive policy, so none of them
can be widened by adding another policy.

### 5.1 Organisation

`<t>_org_isolation`, RESTRICTIVE, `organisation_id = app_current_org()`.

`app_current_org()` reads **`profiles.org_id`**. Data rows carry
**`organisation_id`**. Those are two different columns on `profiles`, and
`MIGRATIONS_V311_PROFILE_ORG_SYNC.sql` exists because a row where one is set and
the other is NULL "would be visible under one boundary and invisible under the
other". Its trigger `tr_sync_profile_org` copies whichever is set into whichever
is NULL and prefers `org_id` when both are set and differ.

That file's STATUS header says NOT YET APPLIED; PROJECT_MEMORY RECORDS it as
applied in the 2026-07-20 phase-1 batch. A STATUS header is a claim, not
evidence. **UNVERIFIED:**

```sql
select tgname, tgenabled from pg_trigger
 where tgrelid = 'public.profiles'::regclass and not tgisinternal order by tgname;
select count(*) from public.profiles where org_id is distinct from organisation_id;
```

### 5.2 Country

`profiles.country` is `text[]`. Current helper, after
`MIGRATIONS_V558_COUNTRY_HELPER_ORG_ADMIN_BYPASS.sql`:

```sql
select p_country is null
  or public.is_super_admin()
  or exists (select 1 from public.profiles pr
             where pr.id = auth.uid()
               and pr.country is not null and cardinality(pr.country) > 0
               and exists (select 1 from unnest(pr.country) x
                           where lower(btrim(x)) = 'all'
                              or lower(btrim(x)) = lower(btrim(p_country))));
```

Three things follow. A row with `country IS NULL` is visible to everyone. Only a
super-admin bypasses; V558 removed the `app_is_org_admin()` term, which had let a
plain org Admin cross every country. A blank or empty array grants NOTHING
(`MIGRATIONS_V309_BLANK_SCOPE_NO_ACCESS.sql`).

`MIGRATIONS_V396_RLS_INITPLAN_SCOPE.sql` added zero-argument readers
(`app_sees_all_countries()`, `app_country_scope()`) so a policy can hoist the
lookup to a once-per-query InitPlan. 74 policies were rewritten onto them.

### 5.3 Site

`profiles.sites` is `text[]`.
`MIGRATIONS_V269_SITE_ABAC.sql` added RESTRICTIVE **SELECT-only**
`<t>_site_isolation` policies to 21 operational tables: accidents, alerts,
budgets, corrective_actions, drivers, fleet_master, gate_passes, goods_receipts,
incident_reports, inspections, purchase_orders, rca_records, requisitions,
stock_movements, stock_records, tyre_records, tyre_rotations,
tyre_service_events, vehicle_fleet, warranty_claims, work_orders. Writes are not
site-gated.

```sql
select case
  when p_site is null or btrim(p_site) = '' then true
  else coalesce((select p.is_super_admin or p.role = 'Admin'
                   or (p.sites is not null and exists (select 1 from unnest(p.sites) s
                        where upper(btrim(s)) in ('ALL','*')))
                   or (p.sites is not null and cardinality(p.sites) > 0
                       and upper(btrim(p_site)) in (select upper(btrim(s)) from unnest(p.sites) s))
                 from public.profiles p where p.id = auth.uid()), false)
end;
```

### 5.4 Four scope traps

**T1. The `ALL` sentinel, and the reversal.** V269's header says "NULL/empty =
ALL sites". V309 REVERSED that: blank means no access, org-wide must be the
explicit sentinel. V309 backfilled every blank `sites` to `ARRAY['ALL']` so
nobody was blacked out. V269's header is still in the repo saying the old rule.
Later file wins.

**T2. Country and site sentinels are cased differently.** Sites match
`upper(btrim(s)) in ('ALL','*')`. Country matches `lower(btrim(x)) = 'all'`.
`'All'` works for both; `'ALL'` works for country only because it is lowercased
first, and `'*'` is a SITE-only sentinel. Do not build one shared sentinel
helper without normalising both ways.

**T3. Country and site disagree about who is exempt.** After V558, country is
bypassed by `is_super_admin()` alone. Site is still bypassed by
`p.role = 'Admin'` as well, in both `app_can_see_site` (V309) and
`app_sees_all_sites` (V396). A plain org Admin sees every SITE and not every
COUNTRY. RECORDED: 0 plain Admins exist today, so the asymmetry is latent.

**T4. The same asset code exists in more than one country, and they are
different machines.** `MIGRATIONS_V376_ASSET_OWNERSHIP.sql`, measured on 216,792
live rows: 1,300 asset codes carry spend, 221 in two countries, 77 billing
concurrently, 57 in two or more months. Confirmed on identity - `GN103` is a
CATERPILLAR generator in KSA and a Sany one in UAE; `BP041` is a KICE batch plant
in KSA and a different plant in Egypt. The numbering is a per-country sequence
per asset class. **An asset is identified by (country, asset_no). Never by
`asset_no` alone.** A picker keyed on the code alone will attach the wrong
vehicle to an accident.

### 5.5 The client-side null-safe convention

RLS is the boundary; a client country filter is a convenience. It must be
written null-safe or it hides the country-less rows RLS deliberately shows:

```text
q.or('country.eq.' + country + ',country.is.null')
```

Five mobile call sites already do exactly that (`accidentCase.ts:162`,
`checklists.ts:74,151,195`, `inspectionApprovals.ts:63`). RECORDED: a strict
`.eq` on `work_orders` hid 55,606 country-less job cards from every country
view. Flutter needs ONE `applyCountry` helper and every scoped read must go
through it.

### 5.6 What the phone carries today versus what spec section 8 requires

Spec section 8 requires `tenantId, companyId, country, currency, siteIds,
userId, role, effectivePermissions`.

`mobile/contexts/AuthContext.tsx` line 559 selects exactly:

```text
id, full_name, username, role, email, employee_id, site, country,
approved, locked, is_super_admin, created_at
```

| Spec field | On the phone today |
|---|---|
| `tenantId` / `companyId` | **absent.** Neither `org_id` nor `organisation_id` is selected. Org scope is 100% server-side. |
| `country` | present, but collapsed by `normaliseCountry` to a single string or null |
| `currency` | **absent.** See below. |
| `siteIds` | **absent.** `profiles.sites` is never selected. Only the legacy scalar `profiles.site` is read, and only to pre-fill forms and label a header. |
| `userId`, `role` | present |
| `effectivePermissions` | present as `grants` + `roleMatrix` + `canAccess` |

**The hard-coded currency the spec warns about is still live.**
`mobile/lib/execReportPdf.ts:90` reads `const currency = opts.currency ?? 'SAR'`,
and its only caller, `mobile/app/(app)/reports/index.tsx:132`, calls
`buildExecReportHtml(snapshot, { language, elevated })` with no currency. Every
exported report is labelled SAR regardless of country. This is the exact defect
spec section 8 attributes to the Kotlin build, alive in the Expo app.

### 5.7 What Flutter must invalidate on a workspace change

Spec section 8 lists five obligations. Concretely:

1. Rebuild `WorkspaceContext` and re-fetch the profile - `country` and `sites`
   are server-owned and can change under the user (V227 realtime).
2. Drop every scoped query cache. A cached `vehicle_fleet` page from country A
   is not a subset of country B, it is a different fleet with colliding keys
   (trap T4).
3. Re-resolve navigation: `canAccess` for all 31 keys, then the tab set.
4. Do NOT touch the outbound command queue. A queued observation was recorded in
   the workspace it was captured in and must sync with the country it was
   stamped with, not the one now selected.
5. Re-derive currency and locale from the new country, never from a default.

---

## 6. Data-type traps

Spec section 6 records that the Kotlin app treated `profiles.country` as a
String when the database stores an array, and that this broke login for most
users. It is one of several.

| Column / value | Real type | Dart type | Proof |
|---|---|---|---|
| `profiles.country` | `text[]` | `List<String>` | `unnest(pr.country)` and `cardinality(pr.country)` in V309, V396, V558. Never index it as a scalar. |
| `profiles.sites` | `text[]` | `List<String>` | `unnest(p.sites)`, `cardinality(p.sites)` in V309/V396. Same shape as country, different sentinel casing. |
| `profiles.site` | `text` | `String?` | selected by mobile AuthContext. This is the LEGACY scalar and is NOT the ABAC scope. Do not conflate with `sites`. |
| `profiles.role` | `text`, Title Case, no CHECK | `String` raw + a normalised enum | CHECK dropped in V282. Keep the raw string; an unmapped value must not silently become Reporter. |
| `profiles.is_super_admin` | `boolean`, NULLABLE | `bool?` then `== true` | mobile reads `is_super_admin?: boolean \| null` and compares `=== true`. A null must not be truthy. |
| `profiles.locked` | `boolean`, NULLABLE | `bool?` | same shape in `Profile` |
| `profiles.approved` | `boolean` | `bool` | non-null in the mobile `Profile` interface |
| `profiles.org_id` | `uuid` | `String?` | the column `app_current_org()` reads (V311) |
| `profiles.organisation_id` | `uuid` | `String?` | the column data rows are matched against (V311). Two columns, not one. |
| `get_my_access_grants()` | `jsonb` object, values are the STRINGS `'grant'` / `'revoke'` | `Map<String, String>` | V225 aggregates `effect`, a text column |
| `get_user_module_permissions()` | `jsonb` object, values are BOOLEANS | `Map<String, bool>` | `mobileRoleMatrixFromRaw` keeps `typeof v === 'boolean'` and drops everything else |
| `get_my_capabilities()` | `jsonb`, TWO levels: `{module: {capability: effect}}` | `Map<String, Map<String, String>>` | V229 nests `jsonb_object_agg` inside `jsonb_object_agg` |
| `user_access_grants.effect` | `text` CHECK `('grant','revoke')` | enum, parsed defensively | V225 |
| `user_access_grants.expires_at` | `timestamptz`, NULLABLE | `DateTime?` | every helper tests `expires_at IS NULL OR expires_at > now()`. A null means never expires, not expired. |
| `user_access_grants.capability` | `text` default `'view'` | `String` | V225. The 2-arg `user_has_capability` hard-codes `'view'`; the 3-arg V229 overload does not. |
| `module_permissions.enabled` | `boolean` | `bool` | read by `app_user_can` |
| `module_permissions.org_id` | `uuid`, NULLABLE, and NULL is the GLOBAL row | `String?` | `app_user_can` selects `where org_id is null`; V239's unique index coalesces NULL to the zero uuid |
| `checklist_templates.assignee_roles` | `text[]`, NULLABLE | `List<String>?` | V591. NULL or empty means EVERY role, not no role. |
| `checklist_templates.require_area_manager` | `boolean` | `bool` | V594; drives the two-stage ladder |
| `checklist_assignments.assignee_role` | `text`, SINGULAR, NULLABLE | `String?` | V124. Note the template column is plural and an array; the assignment column is singular and a scalar. |
| `checklist_submissions.approval_status` | `text`, 5-value CHECK | enum with an unknown fallback | V594 |
| `custom_roles.active` | `boolean` | `bool` | V211. `normalize_profiles_role` does NOT check it, so an inactive custom role is still assignable. |

**UNVERIFIED**: the full column list and nullability of `profiles` and
`module_permissions`. `module_permissions` has no `CREATE TABLE` in any
`MIGRATIONS_V*.sql` in this repo; its columns are only inferable from the SQL
that reads it.

```sql
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name in ('profiles','module_permissions','user_access_grants','custom_roles')
 order by table_name, ordinal_position;
```

---

## 7. Per-role navigation

### 7.1 What the spec proposes

Spec section 10 offers four sets: Field/Tyre Technician
(Home, Inspect, Work, Scan, Profile), Supervisor (Home, Approvals, Fleet, Work,
Profile), Workshop User (Home, Jobs, Fleet, Scan, Profile), Administrator
(Home, Operations, Approvals, Reports, Profile). It labels them "possible".

### 7.2 What the code does

`TAB_BAR` in `mobile/lib/permissions.ts`, rendered by
`mobile/app/(app)/_layout.tsx`. Only entries flagged `primary` reach the bottom
bar; the rest are declared with `href: null` so expo-router never auto-adds them
as stray tabs, and are reached from the Home hub.

| Tab | Route | Module | Primary |
|---|---|---|---|
| Home | `index` | (none) | yes |
| Inspect | `inspection/new` | `inspect` | yes |
| Accidents | `accident/dashboard` | `accidents` | yes |
| Meter Log | `meter-logs` | `meter` | yes |
| Washing | `washing` | `washing` | yes |
| Profile | `profile` | (none) | yes |
| Records | `records/index` | `records` | no |
| Work Orders | `workorders/index` | `workorders` | no |
| Analytics | `analytics/index` | `analytics` | no |
| Reports | `reports/index` | `reports` | no |
| Fleet AI | `ai/index` | `ai` | no |
| Admin | `admin/index` | `admin` | no |

So the real primary sets, after `canAccess` filtering, are:

| Role | Bottom bar |
|---|---|
| admin | Home, Inspect, Accidents, Washing, Profile (Meter hidden - see 7.3) |
| manager / director / inspector | Home, Inspect, Accidents, Washing, Profile |
| tyre_man | Home, Inspect, Washing, Profile |
| driver | Home, Meter Log, Washing, Profile |
| mechanic / electrician | Home, Profile |
| reporter | Home, Profile |
| tyre_data_collector | Home, Profile |
| the five supervisory roles | Home, Profile |

### 7.3 Three findings a Flutter port would otherwise inherit

**F1. `TabDescriptor.visible` is dead code.** The layout computes
`const allowed = tab.moduleKey ? canAccess(tab.moduleKey) : true` and never
calls `tab.visible`. Grepped: `visible` is referenced nowhere outside the
declaration. Porting the descriptor faithfully and wiring `visible` would gate
the bar on the ROLE DEFAULT ONLY, silently dropping the per-user grant and role
matrix layers - a user granted `analytics` would still not see it.

**F2. The Meter Log tab is gated by a role literal, not a module.** Its
`visible` is `(r) => r === 'driver'`. Since `visible` is dead, the tab is
actually gated by `canAccess('meter')`, which 13 roles hold - so Meter Log is a
PRIMARY tab for almost everyone, not for drivers only. Whichever behaviour is
wanted, the descriptor and the layout currently describe different apps.

**F3. Hiding a tab is not a route guard.** `href: null` hides a tab; it does not
block `router.push()` or a cold deep link. That is why
`mobile/lib/routeAccess.ts` exists: an ordered, most-specific-first regex map
from every deep-linkable route to its `ModuleKey`, consumed by `ModuleGuard`.
Its fallback is the safe one - an UNMAPPED route resolves to `undefined` and is
treated as authenticated-only, so an unmapped screen is never a hole that
silently grants a gated module.

### 7.4 Which is authoritative

**The code.** Spec section 10 is a proposal ("possible primary navigation") and
its four archetypes do not map onto the 15 real roles: there is no "Supervisor"
role, the five supervisory roles reach neither Fleet nor Work by default, and
"Workshop User" corresponds to `mechanic` / `electrician`, who get neither a
Jobs tab nor a Scan tab in the bar because neither is `primary`.

Flutter should ship the code's sets and treat section 10 as a backlog item to
put to the product owner - specifically the two gaps in 3.3, plus F2.

---

## 8. Flutter implementation contract

### 8.1 One resolver, one registry, zero inline checks

```text
lib/access/
  module_registry.dart   // the 31 ModuleDef records. Generated or drift-guarded.
  access_resolver.dart   // ONE pure function. No I/O, no Riverpod, no BuildContext.
  route_access.dart      // ordered route -> ModuleKey map, unmapped = authenticated-only
  workspace_context.dart // the 8 spec fields, immutable
```

`access_resolver.dart` must contain the ONLY copy of the precedence in section
1.4. `mobile/lib/permissions.ts` calls itself "the SINGLE source of truth" and
still needed `resolveGuardedAccess` bolted on beside `resolveModuleAccess`
because a guard needed different failure behaviour. Build the failure mode into
the one function from the start, as a parameter.

Widgets never test a role string. `if (role == 'admin')` must not appear
anywhere. The `canX` convenience predicates in the Expo app
(`canInspect`, `canWash`, ...) are thin wrappers over `moduleAllowedByRole` and
therefore see the ROLE DEFAULT ONLY, not the grant overlay - port them only if
that is genuinely what a call site wants, and name them so.

### 8.2 Repository and provider shape

- `AccessRepository` loads three things and reports which failed independently:
  the profile, `get_my_access_grants()`, `get_user_module_permissions()`.
  `Future.wait` with no per-member error handling turns one failure into three,
  which is exactly the `permissionsError` condition that must stay narrow.
- Subscribe to realtime on `user_access_grants` filtered to the user, and on
  `module_permissions`. The Expo app does both, so an admin's change reaches an
  open session without a re-login (V227). Without this, a revoke takes effect at
  next sign-in, which for a field phone can be weeks.
- Expose `AccessState { role, isSuperAdmin, grants, roleMatrix, permissionsError }`
  and a single `bool canAccess(ModuleKey)`.

### 8.3 What fails closed and what fails open

| Situation | Behaviour | Why |
|---|---|---|
| Profile fetch fails, cached profile present and fresh | proceed on cache | RECORDED: a live-profile requirement locked field workers out of inspections queued on their own phone |
| Profile fetch fails, no cache | fail closed, sign-in screen | no identity, no decisions |
| Grants or matrix RPC fails, ordinary module | fall back to role default | never strand a field user mid-shift |
| Grants or matrix RPC fails, `admin` / `users` / `approvals` | fail closed unless super, hard `admin` role, or an explicit pre-failure grant | an empty matrix must never fall through to a permissive default on an administration surface |
| Role string not in the registry | treat as no modules, and LOG IT | do NOT silently coerce to reporter; that is the defect in section 2.1 |
| A `tyre_scrap_allowed`-style server permission probe fails | fail closed | the client must ask, never infer |

### 8.4 Tests that must pin this

1. **Precedence table.** Every combination of {super, revoke, grant, admin role,
   matrix true/false/absent, role default true/false} against the expected
   answer. The web has a 216-combination parity test
   (`src/test/accessResolver.test.js`); match that rigour.
2. **Registry drift.** Parse `mobile/lib/permissions.ts` as text and compare all
   31 keys and role sets to the Dart registry, asserting the parse found at
   least 25 modules so a shape change cannot make it pass vacuously. This is a
   direct port of `src/test/mobileModules.test.js`.
3. **Sensitive fail-closed.** With `permissionsError = true`, assert that a
   `manager` with a permissive role matrix is DENIED `admin`, `users` and
   `approvals`, and that a pre-loaded explicit grant still passes.
4. **Route map completeness.** Every routable screen resolves to a rule, and an
   unmapped path returns authenticated-only rather than a module.
5. **Approval ladder mirror.** Assert the Dart `APPROVAL_STAGES` role lists are
   byte-equal to the arrays in `checklist_is_supervisor()` and
   `checklist_is_area_manager()`. This is a mirror pair and it will drift.
6. **Type round-trips.** `country` and `sites` decode from a JSON array;
   `is_super_admin: null` is not truthy; `get_my_access_grants` values decode as
   strings and `get_user_module_permissions` values as booleans; a non-boolean
   in the matrix is DROPPED, not coerced.
7. **No inline role literals.** A source scan asserting that no widget file
   contains a role string comparison.

### 8.5 Open decisions for the product owner

1. **D1 from section 1.3**: does a per-user revoke deny an `admin`? The phone
   says yes, the web and the server say no.
2. `tyre_data_collector` signs checklists and inspections but by default cannot
   open a checklist, run an inspection, or see the asset list (section 3.3).
3. The five supervisory roles approve inspections they cannot create.
4. The mobile admin console can assign only 5 of 15+ roles (section 2.4).
5. F2: is Meter Log a driver tab or an everyone tab?
6. The `execReportPdf` SAR default (section 5.6) is a live instance of the exact
   defect spec section 8 forbids.

---

## 9. What still needs a live check

1. The `custom_roles` roster and the live `profiles.role` distribution
   (section 2.2). Flutter's role enum depends on it.
2. Whether `tr_sync_profile_org` (V311) is actually installed, and whether any
   profile has `org_id` differing from `organisation_id` (section 5.1).
3. The `app_settings` row keyed `permission_overrides`, which supplies every
   non-view role default (section 4.4).
4. The real column list and nullability of `profiles` and `module_permissions`
   (section 6).
5. How many `module_permissions` rows carry the `mobile:` prefix, and for which
   roles - the role matrix layer may be entirely empty in production, in which
   case term 5a never fires and the client role default is the whole story.

```sql
select role, count(*) filter (where module_key like 'mobile:%') as mobile_rows,
       count(*) as total_rows
  from public.module_permissions group by role order by 2 desc;
select module_key, capability, effect, count(*)
  from public.user_access_grants group by 1,2,3 order by 4 desc limit 50;
```
