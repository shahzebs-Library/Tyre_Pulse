# Tenant settings design: what moves from "one value for the platform" to "one value per company"

Date 2026-11-12. Status: DESIGN plus SQL DRAFTS. Nothing is applied to any database and no web, console,
mobile or Flutter file was changed. Production was read with SELECT only.

Findings covered: MODC-01, MODC-02, MODA-17, MODA-3, MODA-4, MODB-1, MODB-2, MODC-06 (and the leak fixes that
share the same store: MODB-5, MODB-4, MODA-1, MODA-2 are listed in section 9 for completeness).

## 1. The two verdicts

| Verdict | Result | Why |
|---|---|---|
| Internal production readiness | READY, unchanged | Every draft is additive. The current company keeps the values it has today, proved on PGlite against md5-checked copies of the live functions. |
| Commercial SaaS readiness | NOT READY until the drafts are applied AND the callers listed here are switched | The drafts add the per-company store and resolvers. A second company only benefits once each caller (SQL function or web file) reads the resolver. |

## 2. The principle

1. **One store.** `public.organisation_settings (organisation_id, key, value jsonb)`. One row per company per
   setting. RESTRICTIVE organisation wall, read by active members, written by that company's Admin (or a
   super admin). Draft: `supabase/pending_migrations/20261113150000_com_organisation_settings_foundation.sql`.
2. **One named owner of the old global values.** `system_config.legacy_settings_owner_org` names the
   organisation that today's global rows belong to (the current company). Only that organisation falls back to
   a global row.
3. **Three steps in every resolver**, always in this order:
   1. the company's own row in `organisation_settings`;
   2. for the legacy owner only, the global value its screens edit today;
   3. a neutral platform default.
4. **Two ways to keep the current company byte for byte**, chosen per setting:
   - *The value lives in a table a screen edits today* (accident mailbox, company name, logo): the legacy owner
     keeps reading that same global row. Its screens keep working with no web change.
   - *The value is written into code* (ceilings, approver role names, country list, accident labels): the draft
     seeds it as the legacy owner's own row, copied from the live code, and the test proves the resolver gives
     the same answer as the live function.
5. **Functions that take an organisation id are internal** (not executable by `anon` or `authenticated`).
   Signed-in readers are `my_*` functions that use the caller's own organisation.

VERIFIED facts this rests on (SQL, 2026-11-12): 5 organisations; the global company name
(`settings.company_name`) and the global logo (`system_config.company_logo`) are NOT equal to the current
company's own `organisations` row values, so the default must be the global value, not the organisation row;
`country_currency` holds exactly KSA/SAR, UAE/AED, Egypt/EGP; no index or generated column uses
`tyre_km_life` or `tyre_life_km_cap`.

## 3. Company name and logo (MODC-02, MODA-17)

| Item | Detail |
|---|---|
| Today | `get_report_snapshot`, `get_report_snapshot_authed`, `get_workshop_snapshot`, `get_report_tyre_maintenance` read `settings.company_name`; `get_report_snapshot` reads `system_config.company_logo`. `src/pages/QrLabels.jsx:193` and about 12 other files read the same logo through `src/lib/api/brandLogo.js:96`. All global. |
| Single source proposed | `public.org_public_branding(org)` (internal) and `public.my_org_public_branding()` (signed-in). Own row key `public_branding` = `{"company_name": "...", "logo_url": "..."}`. |
| Default for the current company | The same two global rows, read with the same expressions as the live `get_report_snapshot`. `source = legacy_global`. |
| Default for a new company | `organisations.name` and its own branding logo (`settings.branding.logo_url`, else `logo_url`), else the product name and no logo. Never the current company's. |
| Draft | `20261113156000_com_tenant_settings_resolvers.sql` section 1. |
| Test | `supabase/tests/commercial_tenant_settings.test.mjs` "COM-6 branding": owner result equals the live expression; tenant B gets its own name and no logo. PASS. |
| Regression risk to the current company | None at apply (nothing calls it). LOW when callers switch: same rows, same expression. |

Callers that must change later (NOT done here):

| Where | Change |
|---|---|
| DB `get_report_snapshot`, `get_report_snapshot_authed`, `get_workshop_snapshot`, `get_report_tyre_maintenance` | Replace the two global reads with `public.org_public_branding(v_org)` after the token (or caller) organisation is known. Anchored replace on the live text, md5 guarded, as in the COM-1 draft. |
| DB `accident_apply_tokens` | `{{company}}` reads `system_config.company_name`, a key that does not exist today, so e-mails say "Tyre Pulse". Switch to `org_public_branding(acc.organisation_id) ->> 'company'`. This CHANGES the current company's e-mail text from "Tyre Pulse" to its own name: owner decision 4 below. |
| `src/lib/api/brandLogo.js:96` `getCompanyLogo()` | Call `rpc('my_org_public_branding')` and return `.logo`; keep the `system_config` read as the fallback when the RPC is absent. Fixes `src/pages/QrLabels.jsx:193`, `src/lib/checklistPdf.js`, `src/lib/washReportPdf.js`, `src/lib/inspectionChecklistReport.js`, `src/lib/checklistAuditPackPdf.js`, `src/components/Layout.jsx`, `src/components/LegacyLayout.jsx`, `src/components/disposal/DisposalDeckBuilder.jsx` in one place. |
| `src/lib/api/brandLogo.js:125` `setCompanyLogo()` and `src/console/pages/ConsoleReportAppearance.jsx` | Keep writing the global row for the platform owner. Add a company-level editor that writes `organisation_settings.public_branding` (the existing `set_org_branding` screen is the natural home). |

## 4. Countries and currency (MODA-3)

| Item | Detail |
|---|---|
| Today | `src/contexts/SettingsContext.jsx:21-23` hard-codes `COUNTRIES`, `COUNTRY_CURRENCY`, `COUNTRY_LABEL`. Sixteen further copies of the currency map (list below). SQL side already has `country_currency` and `currency_for_country()`, used by 23 functions. |
| Single source proposed | `public.org_countries(org)` and `public.my_org_countries()` returning country, currency, currency name, short label, base flag and order. Own row key `countries`. `public.org_currency_for_country(org, country)` for SQL. |
| Default for the current company | Seeded row: KSA/SAR label KSA, UAE/AED label UAE, Egypt/EGP label EGY, in that order. Identical to `SettingsContext.jsx:21-23`. |
| Default for a new company | The platform catalogue `country_currency` until its Admin (or onboarding) saves its own list. |
| Draft | Same file, section 2, plus the seed at the end. |
| Test | "COM-6 countries": owner list equals the three hard-coded constants in screen order; `org_currency_for_country` equals the live `currency_for_country` for six inputs; tenant B with a Qatar row sees only Qatar/QAR. PASS. |
| Regression risk | LOW. The web change is the risk, not the SQL: one helper must return the same three values before the 17 copies are removed. |

Web changes needed (file:line as of the working tree on 2026-11-12):

- `src/contexts/SettingsContext.jsx:21-23`: keep the three constants as the offline fallback; load
  `rpc('my_org_countries')` once per session and expose `countries`, `currencyFor(country)`, `labelFor(country)`
  from the context. `:32` `FALLBACK_SITE_ROWS` then derives from the loaded list.
- Replace each private copy with the context helper (or a pure `src/lib/countryCurrency.js` fed by it):
  `src/components/accidents/InsuranceClaimPanel.jsx:53`, `src/lib/displayDashboardView.js:11`,
  `src/lib/expenseReportAnalytics.js:15`, `src/lib/dataOpsCenter.js:15`, `src/lib/pmProgramsView.js:15`,
  `src/lib/tyreScrapView.js:10`, `src/lib/api/assetMaster.js:14`, `src/lib/api/tyrePriceBackfill.js:116`,
  `src/lib/sizeOptimizerView.js:27`, `src/lib/holdingCompanyAnalytics.js:24`, `src/lib/fleetRenewalView.js:64`,
  `src/lib/countryComparisonAnalytics.js:11`, `src/lib/tyreRecordsView.js:327`,
  `src/lib/vehicleHistoryView.js:677`, `src/pages/AssetDisposals.jsx:79`.
- Country pickers: `src/pages/FleetMaster.jsx:1257` (already maps over `COUNTRIES`, so it follows the context),
  plus the pickers the audit names in `src/pages/TyreRecords.jsx` and `src/pages/AssetManagement.jsx`
  (line numbers have moved since the audit; search for the literal `'KSA'`).
- DB follow-up (not drafted): `tyre_records` has CHECK `length(country) <= 10`; 20 functions contain a literal
  `'KSA'`, `'UAE'` or `'Egypt'` and need review one by one. `country_currency` itself can stay as the platform
  catalogue; a new country is a row there plus the company's own `countries` row.

## 5. Tyre life ceilings (MODA-4)

| Item | Detail |
|---|---|
| Today | SQL `tyre_life_km_cap(vehicle_type)`: MIXER 80,000; PUMP 56,000; LOADER 15,000; else 100,000 km. JS mirror `src/lib/tyreKm.js:18-21`. `tyre_km_life()` discards a life above the ceiling. |
| Single source proposed | `public.tyre_life_km_cap_for(org, vehicle_type)` and `public.tyre_km_life_for(org, fit, rem, total, vehicle_type)`. Own row key `tyre_life_km_caps` = `{"default_cap_km": n, "rules": [{"contains": "MIXER", "cap_km": 80000}, ...]}`; first matching rule wins, as in the live CASE. `public.my_tyre_life_km_caps()` gives the web mirror its rules. |
| Default for the current company | Seeded row with the three rules and 100,000 default, copied from the live function. |
| Default for a new company | No row: falls back to the existing `tyre_life_km_cap()` (so nothing changes anywhere at apply). What the platform default SHOULD be for a non ready-mix fleet is owner decision 2. |
| Draft | Same file, section 3 and seed. |
| Test | "COM-6 tyre ceilings": for 31 vehicle types (the 26 distinct types in production plus edge cases) the owner ceiling equals the live one; `tyre_km_life_for(owner)` equals the live `tyre_km_life` on all 7,440 combinations of fitment, removal, total and vehicle type; a tenant with a 250,000 km ceiling keeps a 180,000 km life that the live rule discards; the current company is unaffected by that tenant's row. PASS. |
| Regression risk | NONE at apply. MEDIUM at the switch: this function feeds every cost per km figure. |

Switch plan (later, one reviewed step at a time, each with a before and after hash of its output):

| Caller (live, 2026-11-12) | Change |
|---|---|
| Functions `fleet_tyre_km_by_asset`, `list_scrapped_tyres`, `_tyre_close_replaced`, `_tyre_exception_rows` | Pass the row's `organisation_id` to `tyre_km_life_for`. |
| Views `v_tyre_lifetime_fitments`, `v_tyre_life_over_cap`, `v_tyre_fitment_evidence`, `v_ksa_master_tyre_fitments` | Same. `tyre_km_life_for` is STABLE, not IMMUTABLE; that is acceptable in a view. Re-check plans, because an IMMUTABLE call can be folded and a STABLE one cannot. |
| Function `get_tyre_running_life` (holds its own class ceilings per PROJECT_MEMORY) | Read `tyre_life_km_cap_for`. Owned by the engineering drafts `20261113121000_eng2_*`; coordinate so the two do not edit the same body twice. |
| `src/lib/tyreKm.js:18-21` `tyreLifeCapKm(vehicleType)` | Take the rules as an argument (default = today's three rules), fed from `my_tyre_life_km_caps()` through `SettingsContext`. Callers: `src/lib/tyreLifetime.js`, `src/lib/tyreScrapManagementAnalytics.js`, `src/lib/warrantyTrackerAnalytics.js`, `src/lib/aiProposals.js`. The mirror test must then pin SQL and JS on the same rule set. |

## 6. Approver roles for inspections and checklists (MODB-1, MODB-2)

| Item | Detail |
|---|---|
| Today | `decide_inspection_approval` allows Admin, PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager, Tyre Data Collector. `checklist_is_supervisor()` allows Admin, Maintenance Supervisor, Workshop Supervisor, PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager, Tyre Data Collector. `checklist_is_area_manager()` allows Admin, Director, PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager. All but Admin and Director exist only as the current company's custom roles, so a new company can sign as Admin only. |
| Single source proposed | `public.org_approval_roles(org, kind)` with kinds `inspection_signers`, `checklist_supervisors`, `checklist_area_managers`; `public.my_role_in_approval_list(kind)` = `is_super_admin() or get_my_role() = any(list)` (the same shape as the live gates); `public.my_org_approval_roles()` for the client mirrors. Own row key `approval_roles`. |
| Default for the current company | Seeded row with the three live lists, copied from the live function text. |
| Default for a new company | Admin, Manager, Director for all three kinds. An empty configured list means the default, never "nobody". |
| Draft | Same file, section 4 and seed. |
| Test | "COM-6 approver roles": for 21 role names (every role in production plus casing traps) the owner answers equal the live `checklist_is_supervisor()` and `checklist_is_area_manager()` and the live inspection list; in tenant B a Manager is accepted where the live gates refuse (the defect), and the current company's custom role names mean nothing there. PASS. |
| Regression risk | NONE at apply. LOW at the switch if the seed is in place first; the switch must be one migration that edits all gates together. |

Callers that must change later:

| Where | Change |
|---|---|
| DB `checklist_is_supervisor()`, `checklist_is_area_manager()` | Body becomes `select public.my_role_in_approval_list('checklist_supervisors')` (and `..._area_managers`). Their callers (`decide_checklist_approval`, `guard_checklist_approval_stages`, `raise_checklist_corrective_actions`, policy `checklist_submissions_update`) need no edit. |
| DB `decide_inspection_approval` | Replace the literal role list test with `not public.my_role_in_approval_list('inspection_signers')`. Keep `app_cap_revoked` and `app_cap_granted` exactly as they are. |
| DB `approval_reassign_stage`, `approval_review_people`, `save_checklist_governance_policy` | Each contains the same role names (VERIFIED by search of `pg_proc`). Review and switch in the same migration. |
| `src/lib/inspectionApproval.js:27-33` `INSPECTION_SIGNER_ROLES` | Read `my_org_approval_roles().inspection_signers`, with the current constant as the fallback while loading. |
| `src/lib/checklistAccess.js:13,54` and the approver lists it exports | Same, for the two checklist kinds. |
| Mobile mirrors: `mobile/lib/permissions.ts`; Flutter `tyre_pulse_flutter/lib/features/approvals/domain/checklist_approval.dart`, `lib/core/permissions/roles.dart`, `module_registry.dart`, `capabilities.dart` | Load the same three lists at sign-in. Until then the phone shows or hides the button from a stale list while the server decides correctly. |

Overlap to settle before the switch: the governed approval engine (`approval_policies`, 3 unpublished drafts)
and `save_checklist_governance_policy` are a second place that names approvers. One of the two must own the
answer; see owner decision 3.

## 7. Accident vocabulary (MODC-06)

| Item | Detail |
|---|---|
| Today | `src/lib/accidentVocab.js:48,50` Najm and Taqdeer status lists for every country; `:141-142` internal workshop "GCC Workshop" and one named external workshop; `:161-162` liable party and payer lists start with "GCC" (the current company's abbreviation), which is also the value stored on the row. |
| Single source proposed | `public.org_accident_vocabulary(org)` and `public.my_org_accident_vocabulary()`. Own row key `accident_vocabulary` = `own_company_label`, `legacy_own_company_values`, `internal_workshops`, `external_workshops`, `country_packs`. The resolver always returns `own_company_code = "own_company"` as the neutral stored value for new records. |
| Default for the current company | Seeded row: label "GCC", legacy values ["GCC"], the two workshop lists as in the source file, and `country_packs = {"*": ["najm","taqdeer"]}` so both report fields stay visible for every country exactly as today. |
| Default for a new company | Its own organisation name, "<name> Workshop", no external workshops, no country pack (no Najm or Taqdeer fields until configured for KSA). |
| Draft | Same file, section 5 and seed. |
| Test | "COM-6 accident vocabulary": owner values equal the constants in `accidentVocab.js`; tenant B sees its own name and nothing containing "GCC". PASS. |
| Regression risk | NONE at apply. LOW at the web switch if stored values are not rewritten. |

Web changes needed later:

- `src/lib/accidentVocab.js:48,50`: `NAJM_STATUS_OPTS` and `TAQDEER_STATUS_OPTS` shown only when the record's
  country has the pack (`country_packs[country]` or `country_packs["*"]`).
- `:141-142`: `INTERNAL_WORKSHOPS`, `EXTERNAL_WORKSHOPS`, `workshopsFor()`, `canonWorkshop()` read the lists
  from the vocabulary (the "gcc" folding in `canonWorkshop` becomes "any legacy own-company value").
- `:161-162`: `LIABLE_PARTY_OPTS` and `PAYER_OPTS` built as `[own_company_label, ...]`.
  `canonLiableParty` and `canonPayer` treat any value in `legacy_own_company_values` and `own_company` as the
  company itself. DO NOT rewrite stored "GCC" values on existing rows; the claims engine
  (`src/lib/claimsAnalytics.js`) and the report packs read them.
- Consumers: `src/pages/Accidents.jsx`, `src/lib/api/accidentWorkflow.js`, the case panels under
  `src/components/accidents/`, the Flutter accident vocabulary, and SQL that names "GCC" literally
  (`gcc_liability_ratio` is a column name and stays).

## 8. Accident e-mail routing (MODC-01), the first consumer of the store

Draft `20261113151000_com_accident_mail_per_organisation.sql`. Own row key `accident_mail` =
`{"enabled": true, "to": "...", "cc": "...", "subject_prefix": "..."}`. Reader `accident_mail_config(org)`:
own row, else (legacy owner only) the four global `system_config` rows unchanged, else off with no recipients.
Both consumers are rewritten from their live text with md5 and exactly-once guards.

Test `supabase/tests/commercial_notifications.test.mjs`: before, a second company's accident is queued to the
global mailbox by both consumers; after, nothing is queued for it, and the current company's queued payload,
recipients, count, status and in-app notifications are identical before and after. PASS.

Web change needed later: `src/lib/api/accidentWorkflow.js:101,108,127-132` (the Email Delivery tab) should read
`my_org_setting('accident_mail')` and write the company's own row; for the legacy owner it may keep writing the
global rows until the owner asks to move. Until this ships, a second company has accident e-mail OFF, which is
the safe side.

## 9. Related leak fixes drafted in the same pass (not settings, listed so nothing is lost)

| Finding | Draft | Client change needed |
|---|---|---|
| MODB-5 `notify_elevated_users` has no organisation filter | `20261113152000_com_notify_elevated_users_org_scope.sql` | None. |
| MODB-4 alert rules count across organisations; tread metric reads a missing column | `20261113153000_com_alert_thresholds_org_scope.sql` | None. Follow-up: a country column on `alert_thresholds`. |
| MODA-1 scrap marks unique without organisation, step 1 (no overwrite) | `20261113154000_com_scrap_mark_org_guard.sql` | None. The web should show a plain sentence for `serial_mark_conflict`. |
| MODA-1 step 2 (per-organisation key) | `20261113154500_com_tyre_status_marks_per_org_key.sql` | REQUIRED in the same release: `src/lib/api/tyreExchange.js:48` `onConflict: 'serial,mark_type'` becomes `'organisation_id,serial,mark_type'`. |
| MODA-2 warranty claim number per organisation, minted server side | `20261113155000_com_warranty_claim_no_per_org.sql` | Optional: `src/pages/WarrantyTracker.jsx:459` stops computing the number (`src/lib/warrantyTrackerAnalytics.js:187`) and shows the one the insert returns. |

## 10. Order of work

1. Apply COM-0 (store), then COM-1, COM-2, COM-3, COM-4a, COM-5. All are safe without a client change.
2. Apply COM-6 (resolvers and seed). Nothing reads it yet.
3. Web: one context loader (`my_org_countries`, `my_tyre_life_km_caps`, `my_org_approval_roles`,
   `my_org_accident_vocabulary`, `my_org_public_branding`) with today's constants as fallbacks. Ship. No visible
   change for the current company.
4. Switch SQL callers one area at a time, each as its own md5-guarded migration with a before and after hash for
   the current company: branding in the snapshot functions, then approver gates, then tyre ceilings last.
5. COM-4b together with the `tyreExchange.js` line.
6. Company-level editors for the five keys (the platform console keeps the global rows).

## 11. Owner decisions

1. **Legacy owner.** Confirm the current company is the organisation with id ending `0001` and that the global
   company name, logo and accident mailbox are its values. (VERIFIED that 42 of 44 accident rows and all 846
   scrap marks belong to it; the name match is INFERRED, not provable from data.)
2. **Platform default tyre ceiling** for a company that has not set one: keep the ready-mix rule (draft
   behaviour), or a single high sanity ceiling such as 400,000 km with no vehicle type rules.
3. **Approver source of truth**: the simple per-company role lists in this design, or the governed approval
   policies engine. Running both is how the two will drift.
4. **`{{company}}` in accident e-mails** prints "Tyre Pulse" today because the key it reads does not exist.
   Switching it to the company name changes the current company's e-mail text. Yes or no.
5. **Who may edit a company's settings**: its Admin (draft) or the platform owner only until onboarding is
   productised.

## 12. What was verified and what was not

- VERIFIED (SQL, read only): every live definition quoted here; row counts; the absence of indexes and generated
  columns on the tyre km functions; callers of each function and view.
- VERIFIED (PGlite): the three suites `commercial_notifications`, `commercial_tyre_keys`,
  `commercial_tenant_settings`: 22 tests, 22 pass. The harness checks every copied live function by md5 against
  the value recorded from production.
- NOT VERIFIED: any of this on production or on a branch database; the web, mobile and Flutter changes listed
  (none were made); the `anum_integration.apply_reader_policies()` call on the new table (a stub in the
  harness); behaviour of the Supabase MCP confirmation gate for the two drafts that remove a constraint.
