# TyrePulse launch-day readiness

Status: **conditional no-go** until every P0 operational check below has dated evidence.

## Completed in source

- Public Privacy, Terms, Support, Service Status and Data Deletion surfaces.
- Functional trust links from the sign-in page.
- Email/mobile recovery implementation with anti-enumeration responses, expiring OTPs and global session revocation after reset.
- SMS recovery hidden by default until `VITE_RECOVERY_SMS_ENABLED=true` is deliberately configured after Twilio provisioning.
- Shared table keyboard access, selection semantics, pagination labels and theme-safe text.
- Form required/error semantics and mobile-safe dialog titles.
- Tenant, role, module and feature gates; onboarding, billing, imports, reconciliation and monitoring foundations.
- Canonical asset routes moved from the reserved static `/assets` namespace to `/asset-management`, with an exact legacy redirect and regression coverage.
- Action Center tolerates its nullable loading state instead of crashing before the first request resolves.
- Search, filters and row-selection controls on Inspections, Work Orders and Accidents now expose accessible names.
- Settings profile, preference, threshold, notification, scheduled-report and account-deletion fields now expose accessible names.

## Authenticated production audit — 2026-08-30

Read-only Playwright coverage was completed against `https://www.tyrepulse.app` using an authenticated tenant on desktop and mobile. Production evidence was stored outside the repository because screenshots contain tenant data.

| Finding | Source status | Production status |
| --- | --- | --- |
| `/assets` returned a JavaScript asset instead of the React module | Fixed via `/asset-management` canonical route | Pending deployment and live redirect verification |
| Action Center crashed while `rows` was `null` | Fixed and regression-tested | Pending deployment and authenticated retest |
| Missing accessible names in high-use list and Settings controls | Fixed for audited controls | Pending deployment and automated accessibility retest |
| Recovery Edge Function failed its CORS preflight | Function exists in source | Blocked on Supabase authentication, secrets and deployment |
| Tenant is beyond displayed trial limits (1,617/25 vehicles; 45/3 users) | No safe source-only correction | Requires commercial/entitlement decision and live billing verification |
| Large chart bundle | ECharts is route-split but remains about 801 kB raw in the current build | Performance budget and deeper chart-import optimisation remain required |

Validation for the source fixes: production build passed (4,348 modules); targeted lint passed with zero warnings; 75 focused route, recovery, navigation and component tests passed.

## P0 operational evidence required

| Gate | Required evidence | Owner | Status |
| --- | --- | --- | --- |
| Supabase recovery | Migration applied, secrets configured, function deployed, real Resend delivery and reset completed | Platform | Pending credentials/deployment |
| Tenant isolation | Admin/Manager/Operator/Viewer tests across two seeded tenants; live RLS/grants/privileged-function inventory clean | Security | Pending live certification |
| Billing | Sandbox purchase, upgrade, downgrade, cancel, past-due and webhook replay; consequential writes enforce entitlements server-side | Product/Platform | Pending certification |
| Monitoring | Sentry/log drain, synthetic sign-in/recovery/payment/import checks, actionable alerts and named on-call | Operations | Pending configuration |
| Support | Monitored inbox/ticket routing, severity rules, acknowledgement and escalation targets | Customer Success | Pending operating procedure |
| Disaster recovery | Successful restore drill with recorded RPO/RTO and owner-approved runbook | Operations | Pending drill |
| Data integration | One real ERP/import connector maps, retries, reconciles and reports freshness | Integrations | Pending live connector |
| Legal/compliance | Terms, Privacy, DPA/subprocessors, retention/deletion and regional requirements approved by qualified counsel | Legal | Pending approval |
| Customer activation | A new tenant reaches first useful dashboard without developer intervention | Product | Pending seeded E2E |

## Launch environment

Browser-safe variables:

```text
VITE_SUPPORT_EMAIL=info@tyrepulse.app
VITE_STATUS_PAGE_URL=https://status.example.com
VITE_RECOVERY_SMS_ENABLED=false
```

Server-only recovery secrets remain in Supabase Edge Function secrets and must never use a `VITE_` prefix. See `docs/PASSWORD_RECOVERY.md`.

## Go decision

Source lint, tests and builds are necessary but do not certify the deployed service. Change this document to **go** only after all P0 rows have evidence links, dates and accountable owners.
