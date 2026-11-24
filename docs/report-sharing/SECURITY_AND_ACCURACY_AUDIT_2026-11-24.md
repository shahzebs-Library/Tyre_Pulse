# Report Sharing: integration and security closure (2026-11-24)

Status: review branch only. No production SQL, RLS, config or data changes.

## Verified live observations (read-only)
- Two report shares, both active, both without password or expiry; combined view_count = 260.
- get_report_snapshot/get_report_tyre_maintenance/get_workshop_snapshot are anon-executable, SECURITY DEFINER; report_shares is not directly SELECT-granted to anon.
- Public snapshot still calculates `tyre_spend` using `tyre_records.cost_per_tyre * qty`, whereas governed operational expense uses `parts_consumption`.
- `get_report_snapshot` reads global `settings.company_name` and `system_config.company_logo` without organisation scoping.
- `breakdowns.accidents_by_site` and `breakdowns.tyres_by_site` ignore `p_site` while other aggregates respect it.
- Share manager filters active links only and cannot report revoked history; share manager has no viewer-level access log. Current counters do not identify distinct viewers.
- Password attempt-lockout migration documents an applied change but an uncompleted runtime verification.

## Implemented in this branch
- The anonymous viewer now clears existing data on positive server revocation, expiry, invalid token, or newly required password. Temporary network/backend failures still preserve its last good board.
- Regression tests cover authorization outcomes independently of network failures.

## Required database work, NOT applied
1. Audit the complete `get_report_snapshot`, `get_report_tyre_maintenance`, and `get_workshop_snapshot` bodies and every field for organisation/country/site/date scope.
2. Enforce a maximum server-side share scope: a viewer must never expand from authorised single-site/single-country scope to `All` by manipulating query parameters. Store immutable allowed scopes per share and validate before aggregation.
3. Replace tyre-record-based spend with the correct authorised governed expense metric, with coverage, currency and date basis. Confirm the product decision whether a physical-tyre lifetime CPK is distinct from period maintenance spend.
4. Resolve company name/logo using the share's organisation, not unscoped globals. Test with two tenants.
5. Apply selected-site constraints to site breakdown aggregates, or explicitly label organisation-wide breakdowns and forbid them on site-restricted shares.
6. Add server-side share audit events (created/changed/revoked, successful/failed access, download where supported). Respect privacy/retention requirements and avoid exposing bearer tokens.
7. Add recipient-level authorisation for confidential reports, scoped read-only share tokens, expiry policy and optional password/OTP; legacy public TV boards remain a distinct mode.
8. Verify and test password lockout, rate-limits, token rotation, RLS and SECURITY DEFINER least privilege against anonymous and cross-tenant users.
9. Introduce approved, versioned PDF/Excel snapshots separately from live TV boards, with generated-at, definition version and provenance.
10. Ensure public table exports cannot bypass dataset or download permissions, including printable browser output.

## Required acceptance tests
- Revoke while viewer is already open; verify board disappears on next response. Expired/invalid/password-changed flows likewise.
- Network outage must not masquerade as revocation; stale-data warning is still a follow-up.
- Query a scoped share using `site=All` or a different country; no out-of-scope aggregate or available filter values.
- Verify each KPI/filter with independent read-only SQL, including governed expense, period boundaries, multi-currency, and null/unknown semantics.
- Verify two-tenant logos, no leaked names, RLS, token replay, lockout and authorized download audit.
- Verify report, print and PDF parity before marking a report enterprise-ready.

This is a deliberately bounded code fix plus a verified remediation backlog, **not** a claim that enterprise Report Sharing is complete.
