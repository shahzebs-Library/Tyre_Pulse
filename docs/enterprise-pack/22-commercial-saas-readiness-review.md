# 22. Commercial SaaS Readiness Review

| Field | Value |
|---|---|
| Deliverable | 22 of 29 |
| Date | 2026-11-10 |
| Status | Partly built. The product runs one real customer (Green Concrete, 3 countries) in production on a multi-tenant schema with strong tenant isolation. Billing, plan limits and self-serve onboarding are built but deliberately switched off. Verdict: GO for managed (sales-led) onboarding of a second tenant after the Phase 1 items below; NO-GO for self-serve paid SaaS today. |
| Evidence | Live counts read 2026-11-10 (organisations, profiles, subscription_plans, org_subscriptions, invoices, triggers, system_config). Code verified: `src/lib/entitlements.js`, `src/lib/subscriptionAccess.js`, `src/components/SubscriptionGate.jsx`, `src/lib/api/billing.js`, `supabase/functions/billing-*`, `src/App.jsx` legal routes, `marketing/`. Store and deployment state from PROJECT_MEMORY. |
| Related docs | [18 Tenant isolation](18-tenant-isolation-review.md), [17 Security audit](17-security-audit.md), [21 Monitoring](21-monitoring-and-support-design.md), `store-assets/PLAY_STORE_LISTING.md`, `store-assets/FLUTTER_CLOSED_TESTING.md` |

## 1. Scorecard

| Area | Score (0-5) | Verdict | Basis |
|---|---|---|---|
| Tenant isolation (org) | 4 | Go | RESTRICTIVE org policies, admin bypass limited to super admin (V306), DEFINER sweep V545-V578, TRUNCATE revoked (V379), anon base-table grants revoked (V281) |
| Country / site scoping | 4 | Go | V396 InitPlan policies, V542 write scoping, V578 armed tables. Site isolation never exercised by a narrowed real user (all on `ALL`) |
| Identity and access | 4 | Go | Invite-only, approval gate, MFA, lockout (V287), console isolation, JIT elevation, access reviews |
| Billing | 1 | No-go | Stripe checkout + signed webhook built; 0 subscriptions, 0 invoices; behind `billing` flag |
| Plan limits / entitlements | 2 | No-go | Server trigger exists but is inert for orgs without a subscription (by design) |
| Onboarding | 2 | Managed only | Self-serve org creation (V316) authored and deliberately NOT applied; onboarding wizard exists |
| White-label / branding | 3 | Partial | Company logo, report palette, org branding RPC, brand asset registry; no custom domain per tenant |
| Configurability without code | 3 | Partial | Module control, nav editor, role matrix, routing rules, report builder, intake mappings; many reports still code-defined |
| Legal and privacy | 3 | Partial | `/privacy`, `/terms`, `/data-deletion` public pages; deletion is a request workflow; no DPA template, no data-residency statement |
| Observability and support | 3 | Partial | See [21](21-monitoring-and-support-design.md) |
| Mobile distribution | 3 | Partial | Expo app live in Play production (1.6.0); Flutter app in Play closed testing; iOS submitted |
| Marketing / sales site | 3 | Partial | Live Next.js site, contact form falls back to WhatsApp/email because mail env vars are unset |
| Data portability | 4 | Go | Server-side `tenant-export` edge fn, exports everywhere |
| Backup and recovery | 3 | Partial | Nightly core-table snapshots (row recovery only); platform PITR for disaster recovery |

## 2. Multi-tenant state (live 2026-11-10)

| Organisation | Members |
|---|---|
| Default Organisation (the production customer; formerly "Company A") | 768 |
| Tyre Pulse Demo Fleet (Play reviewer account) | 1 |
| Saudi Arabia (KSA) | 0 |
| United Arab Emirates (UAE) | 0 |
| Egypt | 0 |

- All production data and users sit in ONE organisation, separated by `country` (KSA / UAE / Egypt) and `site`. The three country-named orgs are empty shells; the last member of the Egypt org was moved or deleted (memory 2026-08-13, 2026-09-25).
- Isolation was proven against a second tenant only by impersonation (V548/V551 found and fixed cross-tenant reads). A real second paying tenant has never been onboarded.
- Single-org assumptions that must be revisited before tenant two:
  - V290 `trg_stamp_import_default_org` stamps Company A on any service-role insert with a NULL org (Supabase dashboard CSV imports). A second tenant using the dashboard importer would write into the first tenant. Must become per-context or be disabled.
  - V237 `handle_new_user()` stamps new signups into Company A with country KSA by default.
  - `profiles.org_id` vs `organisation_id` split (kept in step by V311 trigger).
  - Global (org_id NULL) `module_permissions` rows are shared by all tenants; per-org matrices are possible but unused.

## 3. Billing and entitlements

| Piece | Path | State |
|---|---|---|
| Plans | `subscription_plans` | 4 rows: trial, starter, professional, enterprise |
| Subscriptions | `org_subscriptions` | 0 rows |
| Invoices | `invoices` | 0 rows |
| Checkout | edge fn `billing-checkout` (`STRIPE_SECRET_KEY`) | Built |
| Webhook | edge fn `billing-webhook` (signature verified; returns 500 on handler error so Stripe retries) | Built |
| Client plan change | `src/lib/api/billing.js changePlan` throws for any paid plan; only the webhook activates a paid plan | Built (closed a free-activation hole) |
| Billing page | `/billing` behind feature flag `billing` | Built, flagged |
| Entitlements (client) | `src/lib/entitlements.js` (fail-closed for known metered resources) | Built |
| Plan limit (server) | V313 `enforce_plan_limit()` BEFORE INSERT on `vehicle_fleet` and `api_keys` | Built, INERT: enforces only for orgs that have an `org_subscriptions` row (grandfathers the 1,600+ vehicle production fleet against a 25-vehicle trial cap) |
| Subscription status gate | `src/components/SubscriptionGate.jsx` over `subscriptionAccess` | Built, fail-open; admins never hard-blocked; UX gate, not a data boundary |
| Usage metering for AI | Global monthly budget only | Partial |

Decision recorded: member caps not enforced until billing goes live (owner, 2026-10-04).

## 4. Onboarding and configuration

| Capability | State |
|---|---|
| Self-serve workspace creation | V316 `create_workspace_owner` AUTHORED, deliberately NOT applied (owner chose invite-only, 2026-07-20) |
| Sign-up | Form gated by `system_config.registration_open` (live `true`) and `require_approval` (live `true`): a new user lands pending Reporter with no scope |
| Onboarding wizard | `src/pages/OnboardingWizard.jsx` (training phases, `20261005151000_onboarding_training_phase_and_dependency.sql`) |
| Tenant configuration | `20260910184011_tenant_administration_configuration.sql`, field synonyms, intake mapping profiles |
| Module enable/disable | `/console/module-control` (enforced app-wide via ModuleRoute, fail-open) |
| Navigation per tenant | `/console/navigation` (cosmetic, RBAC still governs) |
| Approval routing | `approval_matrix` (V477), accident routing rules |

## 5. Branding and white-label

Built: company logo (`system_config.company_logo`, Console Report Colors), report palette presets, `set_org_branding` (cross-org gate V553), `brand_asset_registry`, PDF headers with logo, public share boards with logo. Not built: per-tenant custom domain, per-tenant app icon/store listing, per-tenant email sender domain (single `FROM_EMAIL`).

## 6. Legal, privacy and compliance

| Item | State |
|---|---|
| Privacy policy | `/privacy` (`src/App.jsx` line 588), `docs/privacy.html` |
| Terms | `/terms` |
| Data deletion | `/data-deletion` public page + in-app request (V317 `account_deletion_requests`); processing is manual |
| Play Data Safety | Declared (memory 2026-07-18: Sentry is the only third-party share) |
| Audit retention | 365 days for logs (V288); business data never auto-deleted (`data_retention_months` deliberately saved-only) |
| Compliance evidence | `/console/compliance` (20 SOC2/ISO controls from live evidence + expiring attestations) |
| ISO checklist document control | V-20261108140000 form refs, review intervals, audit pack |
| DPA / subprocessor list / data residency statement | Not built |
| Penetration test | Not done (Strix installed but needs an LLM key) |

## 7. Distribution

| Channel | State |
|---|---|
| Web app | Vercel project `tyre-pulse`, serves `tyrepulse.app` + `www` |
| Marketing site | Vercel project `tyre-pulse-eezl` (root `marketing/`), live; no branded domain of its own; contact form needs `RESEND_API_KEY`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL` |
| Android, field app | Flutter `com.shahzebrahman.tyrepulse` on Play closed testing (track `alpha`); production promotion is the owner's call |
| Android, legacy | Expo `com.shahzebrahman.tyrepulseinspector` 1.6.0 in Play production; store builds retired, OTA hotfix path only from binary commit 6c27046 |
| iOS | Flutter iOS submitted for review (memory 2026-10-26); push needs APNs key + `GOOGLE_SERVICE_INFO_PLIST` secret |
| Standing rule | No mobile builds unless the owner asks |

## 8. Go / no-go

| Scenario | Verdict | Conditions |
|---|---|---|
| Continue current customer | Go | None new |
| Onboard tenant two, sales-led, invite-only | Go after Phase 1 | Fix V290 default-org stamp and V237 signup org default; run the isolation impersonation suite against the new org; per-org email sender; provision subscription row so limits apply |
| Self-serve paid SaaS | No-go | Needs V316 (owner decision), live Stripe, enforced plan limits on all metered resources, DPA, uptime/on-call, tenant-scoped AI budgets |

## Open decisions for the owner

- Keep invite-only (V316 off) or open self-serve workspaces.
- When billing goes live and which plan the production customer is placed on (grandfathered enterprise vs measured).
- Promote the Flutter app to Play production and retire the Expo listing.
- Branded domain for the marketing site and move of the app to `app.tyrepulse.app`.

## Next actions

1. Phase 1 (S): make V290 stamp conditional on a configured default org (or remove it) and have `handle_new_user()` take the org from an invite, not a constant.
2. Phase 1 (S, owner): set the three contact-form env vars on `tyre-pulse-eezl`.
3. Phase 3 (M): tenant onboarding runbook + isolation test suite parameterised by org id.
4. Phase 5 (L): billing go-live (Stripe live keys, subscription row per org, enforce limits on users and storage).
5. Phase 5 (M): DPA template, subprocessor list, data residency statement.
