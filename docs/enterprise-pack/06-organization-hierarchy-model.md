# 06 - Organization Hierarchy Model

| Field | Value |
|---|---|
| Deliverable | 6 of 29 |
| Date | 2026-11-10 |
| Status | Partly built. Company > Country > Site is built and enforced in the database. Region exists only as a column on `sites`. A generic unit tree (`org_units`) is built but empty and not reachable from the UI. Branch, Project, Workshop, Department and Team are not modelled as scopes. |
| Evidence | Code read: `src/lib/orgUnits.js`, `src/lib/api/orgUnits.js`, `src/pages/OrgHierarchy.jsx`, `src/App.jsx`, `src/console/pages/ConsoleOrganizationsHome.jsx`, `src/lib/api/sites.js`, `MIGRATIONS_V206_ORG_HIERARCHY.sql`, `MIGRATIONS_V201_HOLDING_COMPANY.sql`, `MIGRATIONS_V269_SITE_ABAC.sql`, `MIGRATIONS_V309_BLANK_SCOPE_NO_ACCESS.sql`, `supabase/migrations/20261109160000_workforce_operations_core.sql`. Live read-only counts taken 2026-11-10 (stated as "live"). Older behaviour from PROJECT_MEMORY.md. |
| Related docs | [07 Master Access Control](07-master-access-control.md), [08 Approval Matrix](08-country-site-approval-matrix.md), [18 Tenant Isolation](18-tenant-isolation-review.md), `docs/workforce/TEAM_OPERATIONS_AUDIT.md` |

## 1. What the spec asks for (section 3 and 4)

One hierarchy, Company > Country > Region > Branch > Project > Site > Workshop > Department > Team > User,
applied to every record type, with multi-site, multi-country, temporary, acting and project-based
assignments, and one Organization Directory used by access, approvals, notifications and audit. Location logic
must not live separately inside each module.

## 2. What exists today

### 2.1 Levels as they are actually implemented

| Spec level | Implemented as | Enforced in DB | Notes |
|---|---|---|---|
| Company | `organisations` row; every business table carries `organisation_id` | Yes: RESTRICTIVE `*_org_isolation` policies (254 tables live) | See doc 18. Live: 5 organisations; 768 of 769 profiles and all real data are in "Default Organisation" (`00000000-...-0001`, called Company A in memory). |
| Holding company | `organisations.parent_organisation_id` + consolidation RPCs (V201) | RPCs re-check org | Measured in memory (2026-08-17): every org has a NULL parent, so it consolidates nothing. The `/holding-company` route now redirects to the console (see 2.3). |
| Country | `country` text column on 213 tables; `profiles.country text[]` | Yes: RESTRICTIVE `*_country_isolation` (213 tables live, V226, V396, V578) | Values in use: KSA, UAE, Egypt. 2 profiles live have no country scope (they see no country-scoped rows unless admin). |
| Region | `sites.region` (text, e.g. CENTRAL, WESTERN) | No | Live: 44 of 70 sites carry a region. Region is read through `siteRegionMap` / `regionForSite` in `src/lib/api/sites.js`. Rule recorded in memory: never add a second region column to a business table. |
| Branch | Not modelled | - | Nothing in schema. |
| Project | Free text `project` on `accidents` and `parts_consumption` (V300/V366) | No | Not a scope; empty on most rows. |
| Site | `site` text column on operational tables, canonicalised by `normalize_site()` triggers + `site_aliases`; registry `sites` | Yes: RESTRICTIVE `*_site_isolation` SELECT policies (62 tables live, V269) | `profiles.sites text[]`; `'ALL'` sentinel = org-wide (V309). Live: 0 users narrowed to specific sites; 12 profiles have a blank site scope (= no site-scoped rows). |
| Workshop | Not a scope. Workshop is a module (`/workshop-live`) and a site name | No | |
| Department | `departments` table (V302, accident routing only, 12 seeded); `workforce_employees.department` text | No | Descriptive. Not used by RLS. |
| Team | `workforce_employees.team` text | No | Descriptive. |
| User | `profiles` (access identity) + `workforce_employees` (job record) | Yes for identity | See 2.4. |

### 2.2 The generic unit tree (V206): built, empty, not reachable

- Tables `org_units` (self-referencing tree, `unit_type`, `parent_id`) and `user_org_assignments`
  (user, unit, role-at-unit, primary flag, effective window). Org-isolated RLS.
- Pure engine `src/lib/orgUnits.js`: `buildTree`, `descendantsOf`, `depthOf`, `assignmentsActive`,
  `summariseUnits`, `effectiveUnitIdsForUser` (assigned unit plus all descendants, active-window aware),
  `coverageByUser`. Service `src/lib/api/orgUnits.js`.
- Page `src/pages/OrgHierarchy.jsx` (tree + members + "User coverage" card).
- Live: `org_units` 0 rows, `user_org_assignments` 0 rows.
- FINDING (verified in code 2026-11-10): `/org-hierarchy` and `/holding-company` now
  `<Navigate to="/console/organisations">` (`src/App.jsx` lines ~861-862), and `ConsoleOrganizationsHome`
  renders Overview / Edit and lock / Tenant export only. Neither `OrgHierarchy` nor `HoldingCompany` is
  rendered by any route. Both components are lazy-imported and orphaned. The tree has no working UI today.
- No operational table has an `org_unit_id`. The scope resolver is not consumed by RLS. Location-scoped RLS
  over the tree (spec phase "P3-P4") was put ON HOLD by the owner (memory, 2026-07-13) and never resumed.

### 2.3 Where scope is actually decided today

Every RLS policy decides scope from two arrays on `profiles`, through zero-argument readers evaluated once
per query (V396 InitPlan pattern):

```
app_sees_all_countries() / app_country_scope()   -> profiles.country text[]
app_sees_all_sites()     / app_site_scope()      -> profiles.sites text[]  ('ALL' or '*' = org-wide)
app_current_org()                                -> profiles.org_id
is_super_admin()                                 -> crosses orgs (only this)
```

So the effective hierarchy enforced today is a flat two-level filter inside one org: a set of countries and a
set of sites. Region, department and team cannot narrow visibility. A user is either country-wide or
listed per site.

### 2.4 People: two records, deliberately split

| Record | Table | Purpose | State |
|---|---|---|---|
| Access identity | `profiles` | role (Title Case, validated by `normalize_profiles_role()`), org, country[], sites[], approved, locked, is_super_admin | 769 rows live |
| Job record | `workforce_employees` (20261109160000) | designation, department, team, supervisor, sites, status, shift; append-only history; supervisor-loop guard | 0 rows live |
| Person-keyed certifications | `workforce_employee_certifications` | qualification gates | not counted |

Decision recorded in memory (2026-11-09): `workforce_employees` is the JOB record, `profiles.role` stays
the ACCESS role. This is the start of the spec's Organization Directory but it is empty, and it does not yet
carry approval role, approval limit, functional manager, acting replacement, timezone or leave.

### 2.5 Holding company (V201)

`MIGRATIONS_V201_HOLDING_COMPANY.sql` adds parent/child organisations and `holding_consolidated_kpis`.
V569 scoped rows inside each subsidiary rather than the subsidiary list (memory). With no parents set it
reports zero subsidiaries. Consolidation across tenants is therefore available in code, unused in data.

## 3. Gap analysis against the spec

| Requirement | State | Gap |
|---|---|---|
| One hierarchy for every record | Partly | Company, country, site only. Region is derived. |
| Region scope | Not built | No `region` scope array; region filter exists only as a UI filter (Inspections, Running and Remaining). |
| Branch, Project, Workshop, Department, Team scopes | Not built | No columns, no policies. |
| Multi-site and multi-country users | Built | Arrays on `profiles`. |
| Temporary / acting / project assignments | Partly | `user_org_assignments` has an effective window but is unused. JIT elevation (doc 07) is time-boxed capability, not location. |
| Organization Directory | Partly | `workforce_employees` exists, empty, without approval fields. |
| No per-module location logic | Partly | `site` text is repeated on each table but normalised by one trigger (`normalize_site`) and one alias table. |

## 4. Proposed model

Keep the proven enforcement path (arrays read once per query) and grow it, rather than switching RLS to a
recursive tree walk, which would reintroduce the per-row cost V396 removed (85x on `work_orders`).

1. **Registry, not columns.** Extend `sites` into the location master: `country`, `region`, `branch`,
   `project`, `workshop` as typed columns on the site row (one row per physical site). Business tables keep
   only `country` + `site`; every higher level is derived by join, exactly as region is today.
2. **Unit tree for people, not records.** Use `org_units` for Department > Team and for management lines.
   Re-mount `OrgHierarchy` inside the console (Platform > Organizations > Structure tab).
3. **Scope expansion at sign-in, not per row.** A function `app_site_scope()` already returns the user's
   sites. Extend it to expand region / branch / project assignments into the site list once per query, so
   every existing `*_site_isolation` policy gains region and branch scope with no policy rewrite.
4. **Directory.** Make `workforce_employees` the Organization Directory: add `approval_role`,
   `approval_limit`, `functional_manager`, `acting_for`, `timezone`, `leave_status`. Approval routing (doc
   08) reads it. Keep `profiles` as the access identity only.
5. **Assignments with time.** Reuse `user_org_assignments` for temporary and acting location assignments;
   `app_site_scope()` honours its effective window.

## 5. Phase and effort

| Item | Phase | Effort |
|---|---|---|
| Re-mount OrgHierarchy + HoldingCompany in console (fix orphan) | 2 | S |
| Site registry columns region/branch/project/workshop + backfill | 3 | M |
| Scope expansion in `app_site_scope()` with region/branch | 3 | L (RLS-wide test matrix needed) |
| Directory fields on `workforce_employees` + load | 3 | M |
| Department / team scoping of approvals and notifications | 3-4 | L |

## 6. Standing decisions recorded

- Region lives once, on `sites`; never as a second column on business tables (memory 2026-08-25).
- Location-scoped RLS over `org_units` was paused by the owner (2026-07-13); not resumed.
- `profiles.role` is the access role; `workforce_employees` is the job record (2026-11-09).
- Site values are canonical UPPER; `-ST` store suffix retired fleet-wide; `KSP-T1` and `KSP-TP` are separate
  sites (owner rulings 2026-08-06 and 2026-08-11).

## Open decisions for the owner

- Which levels customers need beyond site: region only, or region + branch + project?
- Should department or team ever narrow data visibility, or only route approvals and notifications?
- Re-mount the Organization Hierarchy page now (it is orphaned) or wait for the directory work?

## Next actions

1. Phase 2, S: route `OrgHierarchy` and `HoldingCompany` inside `/console/organisations` so the V206 tree is
   usable; add a render test.
2. Phase 3, M: add location columns to `sites`; fill the 26 sites with no region.
3. Phase 3, L: prototype region scope in `app_site_scope()` behind a flag; prove equivalence with the V396
   method (algebraic + impersonation) before turning it on.
4. Phase 3, M: extend `workforce_employees` with approval fields; load the directory.
