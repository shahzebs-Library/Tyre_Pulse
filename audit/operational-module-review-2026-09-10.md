# Operational module review — 10 September 2026

Scope: production React web source. Changes are on `fix/operational-module-correctness`; deployment and real-user acceptance are separate checks.

| Module | Corrections implemented | Operational follow-up |
| --- | --- | --- |
| Vehicle Asset History | Exact asset links replace description substring matching; related history is paged, country-filtered and reports failures. | Confirm duplicate asset numbers in the All-countries view are disambiguated before using cross-country totals. |
| QR labels | Label source records follow the active country; old requests cannot overwrite a new selection. Module settings gate direct access. | Physically scan a printed vehicle and tyre label using the deployed mobile app. |
| Tyre Records | PDF/Excel downloads reject failed or incomplete filtered reads, report errors and prevent repeated clicks during export. | Validate a real filtered export with the intended user's permissions. |
| Tyre Passport | Fix the records-array contract; page primary and auxiliary histories; warn when auxiliary sources fail. Ignore obsolete requests. | Enter actual tyre-service events to populate repair/service history. |
| Serial Tracker | Page exact serial lookups, escape wildcard characters, apply country scope and ignore obsolete results. | Confirm real serial formats and scrap-action permissions with an operational account. |
| Workshop Live Control | Apply active country and module settings; core load errors no longer become a falsely empty board. | Exercise assignment, start, pause, completion and QA using real test jobs; optional staffing feeds still degrade independently. |
| CPK Intelligence | Clear old scope results and prevent an obsolete refresh overwriting current results; enforce module settings. | Reconcile a closed period against approved tyre costs and vehicle distance. |
| Preventive Maintenance | Page plans/service records; report history/meter failures; country-scope meter reads; preserve unknown meters; avoid ambiguous duplicate-asset meters. | Approved intervals, meter basis and first due values are required. No programs or service records were present in the read-only production check. |
| Predictive Maintenance | Clear stale country data and reject obsolete loads. | Validate wear and remaining-life estimates against actual removals. Existing predictions remain estimates, not validated automatic maintenance decisions. |
| Shift Scheduling | Page the roster, surface read failures and enforce module settings. | Approved shift times, staff assignments and sites are required. No shifts were present in the read-only production check. |

The production check also found no tyre-service events. Empty setup is not evidence of a working end-to-end operational workflow. No production schedules, records, schema or permissions were changed in this task. Database RLS remains the authority; frontend gates do not replace a policy audit.

Recommended order: populate approved PM and shift setup; run an operational-account acceptance check for each workflow; reconcile one real vehicle/tyre end to end; then consider automation based on those verified records. This review does not certify every module as fully complete.

Verification: production web build passed; full web lint passed with three request-counter cleanup warnings, then focused lint passed clean after those warnings were addressed. Full web suite: 9,239 passed and four failures in two changed contracts. The corrected targets subsequently passed (row-cap guard: 8; PM API: 12). No second full-suite run was performed. Additional focused checks passed for history pagination/error handling (9) and access/release metadata (32). Browser acceptance with real operational users remains outstanding.
